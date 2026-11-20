import { createDeviceConnection } from './remote-transport.js';
import { createDeviceRealm } from './device-realm.js';
import { createShortcutRouter } from './shortcuts-bridge.js';

// These packages own the outer application or its carrier. The embedded
// composition supplies those services; ordinary conversation features stay native.
const OUTER_PACKAGES = new Set([
  'dsh-client-modules', 'dsh-client-connection', 'dsh-client-hmr',
  'dsh-client-ui-layout', 'dsh-client-ui-sidebar',
  'dsh-client-product-analytics', 'dsh-cordis-client-runner',
  'dsh-client-ui-cordis', 'dsh-client-ui-directory-picker-native',
  'dsh-client-ui-open-in-app',
]);
const OFFICIAL = '@deepseek-ai/';
const LOCALE_PACKAGE = OFFICIAL + 'dsh-client-locale';
const CORE_SLOTS = new Set([
  'root', 'main', 'main.conversation', 'conversation.composer.bar', 'factory:conversation.content',
]);

export function nativeRosterOf(graph) {
  return (graph?.entries ?? []).filter(row => row.id.startsWith(OFFICIAL)
    && !OUTER_PACKAGES.has(row.id.slice(OFFICIAL.length)));
}

// Feed the official locale runtime the workbench's resolved display language.
// Its own dictionaries remain scoped to the device Client.
export function createDeviceLocaleForm(locale) {
  let snapshot;
  return {
    getSnapshot() {
      const { active, revision } = locale.getSnapshot();
      if (snapshot?.value.preference !== active) {
        snapshot = { status: 'ready', value: { preference: active }, base: undefined, user: undefined, revision, writable: true };
      }
      return snapshot;
    },
    subscribe(listener) {
      let previous = locale.getSnapshot().active;
      return locale.subscribe(() => {
        const { active } = locale.getSnapshot();
        if (active === previous) return;
        previous = active;
        listener();
      });
    },
    async set(field, value) {
      if (field !== 'preference' || typeof value !== 'string') return false;
      locale.setLocale(value);
      return true;
    },
  };
}

function observable(initial) {
  let snapshot = initial;
  const listeners = new Set();
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(value) {
      if (Object.is(value, snapshot)) return;
      snapshot = value;
      for (const listener of [...listeners]) listener();
    },
  };
}

export function createRuntimeLayout({ sidebar, hasPanel = () => true } = {}) {
  const panelInfo = observable({ activePanelId: null });
  const geometry = observable({ track: false, fullscreen: false, viewportWidth: 1000 });
  let navigation = new AbortController();
  return {
    panelInfo,
    geometry,
    selectPanel(panelId) {
      if (panelId !== null && !hasPanel(panelId)) throw new Error(`Unknown device panel: ${panelId}`);
      navigation.abort();
      panelInfo.set({ activePanelId: panelId });
    },
    beginNavigation() {
      navigation.abort();
      navigation = new AbortController();
      return navigation.signal;
    },
    toggleSidebar() { sidebar?.toggleSidebar(); },
    openRightbar(track, fullscreen) { geometry.set({ ...geometry.getSnapshot(), track, fullscreen }); },
    closeRightbar() { geometry.set({ ...geometry.getSnapshot(), track: false, fullscreen: false }); },
    setViewportWidth(viewportWidth) {
      if (Math.abs(geometry.getSnapshot().viewportWidth - viewportWidth) < 1) return;
      geometry.set({ ...geometry.getSnapshot(), viewportWidth });
    },
    dispose() { navigation.abort(); },
  };
}

/** Keep the native navigation service stable without running its restore/create
 * policy while a device is merely subscribed for status and approvals. */
export function createDeferredNavigation({ context, activate, onChooseDevice, targetId, Service }) {
  let actual = null;
  let activation = null;
  let showWorkspaces = () => {};
  const methods = ['openSession', 'openWorkspace', 'forkSession', 'connectWorkspace', 'startSession',
    'archiveSession', 'unarchiveSession', 'pinSession', 'unpinSession', 'pickDirectory', 'listDirectory', 'createDirectory'];
  const service = Service ? new Service(context, 'uiWorkspace') : { ctx: context };
  for (const name of methods) service[name] = function(...args) {
    if (!actual) throw new Error('Open a device session before using its navigation');
    if (name === 'startSession' && args[0] === undefined && onChooseDevice) return onChooseDevice(targetId);
    return actual[name](...args);
  };
  service.whenAccess = function(workspaceId, action, callback) {
    return this.ctx.remoteAccess.whenResourceAccess('workspace', workspaceId, action, callback);
  };
  return {
    service,
    async open(sessionId, isCurrent = () => true) {
      if (typeof sessionId !== 'string' || !sessionId) throw new Error('A device session is required to start navigation');
      if (!activation) {
        activation = Promise.resolve().then(activate).then(result => {
          const value = result?.service;
          if (!value || value === service || typeof value.openSession !== 'function') throw new Error('Native device navigation did not activate');
          actual = value;
          showWorkspaces = result.showWorkspaces;
          if (onChooseDevice && typeof actual.startSession === 'function') {
            const nativeStart = actual.startSession;
            actual.startSession = function(workspaceId, ...args) {
              if (workspaceId === undefined) return onChooseDevice(targetId);
              return nativeStart.call(this, workspaceId, ...args);
            };
          }
        }).catch(error => { activation = null; throw error; });
      }
      await activation;
      if (!isCurrent()) return;
      await actual.openSession(sessionId);
      showWorkspaces();
    },
  };
}

function defaultScriptLoader(pageGlobal) {
  return (url, { signal } = {}) => new Promise((resolve, reject) => {
    signal?.throwIfAborted();
    const script = pageGlobal.document.createElement('script');
    script.src = url;
    script.async = true;
    const finish = error => {
      script.remove();
      script.onload = null;
      script.onerror = null;
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve();
    };
    const abort = () => finish(signal.reason ?? new Error('Device module loading cancelled'));
    script.onload = () => finish();
    script.onerror = () => finish(new Error('Could not load the device conversation components'));
    signal?.addEventListener('abort', abort, { once: true });
    pageGlobal.document.head.appendChild(script);
  });
}

function waitForSource(source, predicate, signal, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let timer;
    let unsubscribe = () => {};
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      unsubscribe();
      signal?.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const check = () => {
      const value = source.getSnapshot();
      if (predicate(value)) finish(null, value);
    };
    const abort = () => finish(signal.reason ?? new Error('Device conversation cancelled'));
    if (signal?.aborted) return abort();
    unsubscribe = source.subscribe(check);
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => finish(new Error('The device did not finish connecting in time')), timeoutMs);
    check();
  });
}

/** Keeps the local application resident while native Client trees address devices. */
export function createDeviceRuntimePool({
  context, React, platformRequire, describe, onChooseDevice, installWorkspacePicker,
  installSessionOpenNotice,
  onStatusChange = () => {}, pageGlobal = globalThis, fetch: suppliedFetch,
  loadScript: suppliedScriptLoader, buildRuntime: suppliedBuilder,
}) {
  const h = React?.createElement;
  const state = observable({ active: null, phase: 'idle', error: null, revision: 0 });
  const instances = new Map();
  const pending = new Map();
  const generations = new Map();
  const owners = new Set();
  const registry = pageGlobal.__T3_DEVICE_REALMS__ ?? new Map();
  if (!(registry instanceof Map)) throw new Error('The device module registry is unavailable');
  pageGlobal.__T3_DEVICE_REALMS__ = registry;
  const pageFetch = suppliedFetch ?? ((input, init) => pageGlobal.fetch(input, { ...init, credentials: 'same-origin' }));
  const loadScript = suppliedScriptLoader ?? defaultScriptLoader(pageGlobal);
  let stopped = false;
  let navigation = 0;
  let nativePlatform;
  let shortcutRouter;

  const update = patch => state.set({ ...state.getSnapshot(), ...patch, revision: state.getSnapshot().revision + 1 });
  const platformImport = specifier => context.modules.import(specifier, '', {});
  platformImport.sync = platformRequire;

  function routeShortcuts() {
    if (suppliedBuilder || shortcutRouter) return;
    shortcutRouter = createShortcutRouter({
      shortcuts: context.shortcuts,
      getTarget() {
        const selected = state.getSnapshot();
        if (!selected.active) return null;
        if (selected.phase !== 'ready') return { blocked: true };
        const instance = instances.get(selected.active.targetId);
        return instance?.realm.active ? {
          shortcuts: instance.shortcuts, ownsElement: instance.realm.contains,
        } : { blocked: true };
      },
    });
  }

  async function disposeInstance(instance) {
    if (!instance || instance.closed) return;
    instance.closed = true;
    instance.realm.active = false;
    for (const dispose of instance.subscriptions.splice(0)) dispose();
    instance.layout?.dispose();
    // Official effects release their retained sessions and streams while the
    // device carrier is still live, before its shared abort closes the sockets.
    await Promise.allSettled([Promise.resolve().then(() => instance.ctx?.fiber.dispose())]);
    instance.abort?.abort();
    await instance.connection?.dispose();
    await instance.realm.dispose();
    if (registry.get(instance.descriptor.runtimeKey) === instance.realm) registry.delete(instance.descriptor.runtimeKey);
    owners.delete(instance);
  }

  function installEmbeddedRoot(instance) {
    const device = instance.ctx;
    const layout = createRuntimeLayout({
      sidebar: context.layout,
      hasPanel: key => device.slots.entries('main').some(entry => entry.options.key === key),
    });
    instance.layout = layout;
    device.provide('layout', layout);
    device.slots.provideRoot({ hooks: { panelInfo: layout.panelInfo, t3DeviceGeometry: layout.geometry } });

    const overlaySlot = 'shell.overlay';
    const subscribeOverlays = listener => device.slots.subscribe(overlaySlot, listener);
    const readOverlayEntries = () => device.slots.entries(overlaySlot);

    function Root({ renderSlot, usePanelInfo, useT3DeviceGeometry }) {
      const panel = usePanelInfo(value => value.activePanelId);
      const geometry = useT3DeviceGeometry(value => value);
      const overlays = React.useSyncExternalStore(subscribeOverlays, readOverlayEntries);
      const element = React.useRef(null);
      const [portal, setPortal] = React.useState(null);
      const bindPortal = React.useCallback(node => {
        instance.realm.portalElement = node;
        setPortal(node);
      }, []);
      React.useLayoutEffect(() => {
        if (!portal) return;
        return instance.realm.registerPortalRoot(portal);
      }, [portal]);
      React.useLayoutEffect(() => {
        instance.realm.rootElement = element.current;
        const measure = () => layout.setViewportWidth(element.current?.clientWidth ?? 1000);
        measure();
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
        if (element.current) observer?.observe(element.current);
        return () => { observer?.disconnect(); instance.realm.rootElement = null; };
      }, []);
      const { viewportWidth } = geometry;
      const rightWidth = Math.min(380, Math.max(300, viewportWidth * .32), Math.max(0, viewportWidth - 400));
      const trackWidth = geometry.track && viewportWidth >= 768 ? rightWidth : 0;
      return h('div', { className: 't3-native-region', ref: element, 'data-device': instance.descriptor.targetId },
        h('style', null, '.t3-native-right [data-sidebar-right-panel="fullscreen"]{max-width:100%;--dsh-sidebar-width:100%!important}'),
        portal && h('div', { className: 't3-native-body', style: { position: 'relative' } },
          h('div', { className: 't3-native-conversation' }, renderSlot('main', {}, { entryKey: panel ?? 'conversation' })),
          h('div', { className: 't3-native-right', style: { width: trackWidth, flexBasis: trackWidth } },
            renderSlot('rightbar', { width: rightWidth, viewportWidth, canShow: rightWidth >= 300 }))),
        portal && renderSlot('shell.bottom', {}),
        // First-run onboarding is owned by the desktop shell. Its backdrop
        // hides the workbench, which also contains the embedded portal.
        portal && [...new Set(overlays.slice()
          .sort((a, b) => (a.options.order ?? 0) - (b.options.order ?? 0))
          .map(entry => entry.options.id))]
          .filter(id => id !== 'desktop-onboarding')
          .map(id => h(React.Fragment, { key: id }, renderSlot(overlaySlot, {}, { only: id }))),
        h('div', { className: 't3-native-portals', ref: bindPortal }));
    }

    // This root belongs solely to the private device registry. It is rendered
    // inside the local main slot and never replaces the application's AppFrame.
    device.slots.register({
      name: 'root',
      children: {
        main: { kind: 'keyed', scope: 'root' },
        rightbar: { kind: 'single', scope: 'root' },
        'shell.bottom': { kind: 'single', scope: 'root' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
    }, Root);
  }

  async function build(descriptor, { signal } = {}) {
    signal?.throwIfAborted();
    nativePlatform ??= await platformImport('@deepseek-ai/cordis');
    signal?.throwIfAborted();
    const Context = nativePlatform.Context;
    const Loader = Object.getPrototypeOf(context.loader).constructor;
    if (typeof Context !== 'function' || typeof Loader !== 'function' || typeof nativePlatform.Service !== 'function') throw new Error('The installed Client does not support device composition');
    const abort = new AbortController();
    const realm = createDeviceRealm({ descriptor, platformImport, loadScript, pageGlobal,
      shortcuts: context.shortcuts, externalKeyboard: true,
      fetch: pageFetch, createWebSocket: path => context.connection.openWebSocket(path), signal: abort.signal });
    const instance = { descriptor, abort, realm, ctx: null, subscriptions: [], closed: false, status: null };
    const cancel = () => abort.abort(signal.reason);
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
    instance.subscriptions.push(() => signal?.removeEventListener('abort', cancel));
    owners.add(instance);
    registry.set(descriptor.runtimeKey, realm);
    try {
      const device = new Context();
      instance.ctx = device;
      await device.plugin(Loader, { baseUrl: descriptor.baseUrl });
      device.loader.internal = realm.modules;
      device.provide('modules', realm.modules);
      const connection = createDeviceConnection({
        baseUrl: descriptor.baseUrl, baseConnection: context.connection,
        fetch: pageFetch, signal: abort.signal,
      });
      instance.connection = connection;
      device.provide('connection', connection);
      const roster = nativeRosterOf(descriptor.graph);
      const renderer = roster.find(row => row.id === OFFICIAL + 'dsh-client-ui-renderer');
      if (!renderer) throw new Error('The device has no compatible native conversation renderer');
      await device.loader.create({ name: renderer.id });
      if (!device.get('slots')) throw new Error('The device renderer could not initialize');
      if (typeof device.slots.onEntryError === 'function') {
        instance.subscriptions.push(device.slots.onEntryError((key, registration, error) => {
          const selected = state.getSnapshot();
          if (!CORE_SLOTS.has(key) || instance.closed || !realm.active || selected.phase !== 'ready'
            || selected.active?.targetId !== descriptor.targetId
            || (key === 'main' && registration?.options?.key !== 'conversation')) return;
          instance.renderFailed = true;
          realm.active = false;
          update({ phase: 'error', error: error?.message ?? String(error) });
        }));
      }
      installEmbeddedRoot(instance);
      if (installWorkspacePicker) instance.subscriptions.push(installWorkspacePicker(device, descriptor.targetId));
      const navigationRow = roster.find(row => row.id === OFFICIAL + 'dsh-client-ui-workspace');
      if (!navigationRow) throw new Error('The device has no compatible native project navigation');
      instance.navigation = createDeferredNavigation({
        context: device, Service: nativePlatform.Service,
        targetId: descriptor.targetId, onChooseDevice,
        async activate() {
          abort.signal.throwIfAborted();
          const namespace = await realm.import(navigationRow.id);
          const workspaces = device.workspaces;
          const pendingWorkspaceList = { ...workspaces.list.getSnapshot(), phase: 'pending' };
          let ready = false;
          const listeners = new Set();
          // Official Workspace startup restores or creates a session as soon as
          // both lists are ready. Let the explicit selection win that race.
          const list = {
            getSnapshot: () => ready ? workspaces.list.getSnapshot() : pendingWorkspaceList,
            subscribe(listener) {
              listeners.add(listener);
              const unsubscribe = workspaces.list.subscribe(() => { if (ready) listener(); });
              return () => { listeners.delete(listener); unsubscribe(); };
            },
          };
          const navigationContext = device.isolate('uiWorkspace').isolate('workspaces');
          const workspaceFacade = Object.create(workspaces, { list: { value: list } });
          const plugin = device.loader.unwrapExports(namespace);
          const fiber = navigationContext.plugin({
            name: 't3-device-workspace',
            async apply(ctx) {
              ctx.provide('workspaces', workspaceFacade);
              await ctx.plugin(plugin);
            },
          });
          try {
            await fiber;
            abort.signal.throwIfAborted();
            const service = navigationContext.get('uiWorkspace');
            if (!service) throw new Error('Native device workspace services did not activate');
            return { service, showWorkspaces() {
              if (ready) return;
              ready = true;
              for (const listener of [...listeners]) listener();
            } };
          } catch (error) {
            await fiber.dispose();
            throw error;
          }
        },
      });
      await Promise.all(roster.filter(row => row !== renderer && row !== navigationRow).map(async row => {
        if (row.id !== LOCALE_PACKAGE) return device.loader.create({ name: row.id });
        const plugin = device.loader.unwrapExports(await realm.import(row.id));
        abort.signal.throwIfAborted();
        const localeContext = device.isolate('configForms');
        const form = createDeviceLocaleForm(context.locale);
        // Only the locale plugin sees this form. Other device settings retain
        // their original provider and transport.
        localeContext.provide('configForms', { get: () => form });
        await localeContext.plugin(plugin);
      }));
      await device.loader.await();
      for (const service of ['remote', 'locale', 'sessions', 'uiSession', 'uiConversation', 'uiWorkspace', 'conversation', 'fileUpload', 'shortcuts', 'workspaces']) {
        if (!device.get(service)) {
          const failures = await Promise.all([...device.loader.entries()]
            .filter(entry => entry.fiber?.state !== 2)
            .map(async entry => {
              if (!entry.fiber) return `${entry.options.name}: ${realm.modules.importError(entry.options.name)?.message ?? 'import failed'}`;
              try {
                await entry.fiber.await();
              } catch (error) {
                return `${entry.options.name}: ${error?.message ?? String(error)}`;
              }
              const missing = Object.keys(entry.fiber.inject).filter(name => !device.get(name));
              return `${entry.options.name}: ${missing.length ? `waiting for ${missing.join(', ')}` : 'activation failed'}`;
            }));
          throw new Error(`The device conversation is missing ${service}${failures.length ? ': ' + failures.join('; ') : ''}`);
        }
      }
      if (installSessionOpenNotice) instance.subscriptions.push(installSessionOpenNotice(device));
      const shortcuts = device.shortcuts;
      instance.shortcuts = shortcuts;
      if (typeof shortcuts.registry?.configure !== 'function' || typeof shortcuts.registry.dispatch !== 'function'
        || typeof shortcuts.registry.invoke !== 'function' || typeof shortcuts.fixedInput !== 'function') {
        throw new Error('This device Client has no compatible keyboard routing boundary');
      }
      const syncBindings = () => shortcuts.registry.configure(context.shortcuts.config.getSnapshot());
      syncBindings();
      instance.subscriptions.push(context.shortcuts.config.subscribe(syncBindings), shortcuts.config.subscribe(syncBindings));
      shortcuts.edit = (...args) => context.shortcuts.edit(...args);
      shortcuts.recording = (...args) => context.shortcuts.recording(...args);
      await waitForSource(connection.generation, value => value !== undefined, abort.signal);
      await device.sessions.refresh();
      instance.status = device.uiSession.sessionStatus.getSnapshot();
      instance.subscriptions.push(device.uiSession.sessionStatus.subscribe(() => {
        instance.status = device.uiSession.sessionStatus.getSnapshot();
        onStatusChange(descriptor.targetId, instance.status);
        update({});
      }));
      instance.syncSelection = () => {
        const selected = state.getSnapshot();
        if (instance.closed || !realm.active || selected.active?.targetId !== descriptor.targetId) return;
        const byId = device.sessions.list.getSnapshot().byId;
        const sessionId = Object.keys(byId).find(id => (byId[id].retainedBy?.mainView ?? 0) > 0);
        if (sessionId !== undefined && sessionId !== selected.active.sessionId) {
          update({ active: { targetId: descriptor.targetId, sessionId } });
        } else if (sessionId === undefined && connection.generation.getSnapshot() !== undefined && selected.phase === 'ready') {
          update({ active: { targetId: descriptor.targetId, sessionId: null } });
        }
      };
      instance.subscriptions.push(device.uiSession.adapter.current.subscribe(instance.syncSelection));
      instance.subscriptions.push(connection.state.subscribe(() => { update({}); }));
      onStatusChange(descriptor.targetId, instance.status);
      return instance;
    } catch (error) {
      await disposeInstance(instance);
      throw error;
    }
  }

  async function ensure(targetId, { refresh = false, connectionId } = {}) {
    if (stopped) throw new Error('The device workspace is closed');
    const pendingAttempt = pending.get(targetId);
    if (pendingAttempt) {
      if (!connectionId || !pendingAttempt.connectionId || pendingAttempt.connectionId === connectionId) {
        const ready = await pendingAttempt.operation;
        if (!connectionId || ready.descriptor.connectionId === connectionId) return ready;
        if (pending.get(targetId) === pendingAttempt) pending.delete(targetId);
        return ensure(targetId, { refresh: true, connectionId });
      }
      // A click on a replacement connection must not wait for an older warmup.
      pending.delete(targetId);
      pendingAttempt.controller.abort();
    }
    const current = instances.get(targetId);
    if (current && !current.closed && !current.renderFailed && !refresh
      && (!connectionId || current.descriptor.connectionId === connectionId)) return current;
    const generation = generations.get(targetId) ?? 0;
    const controller = new AbortController();
    const isCurrent = () => !stopped && !controller.signal.aborted && (generations.get(targetId) ?? 0) === generation;
    const attempt = { connectionId, controller, operation: null };
    const operation = (async () => {
      const descriptor = await describe(targetId, { signal: controller.signal });
      if (!isCurrent() || descriptor.targetId !== targetId || (connectionId && descriptor.connectionId !== connectionId)) {
        throw new Error('The device connection changed while loading');
      }
      if (current && !current.closed && !current.renderFailed && current.descriptor.runtimeKey === descriptor.runtimeKey) return current;
      if (current && state.getSnapshot().active?.targetId === targetId) {
        current.realm.active = false;
        update({ phase: 'loading', error: null });
      }
      const next = await (suppliedBuilder ?? build)(descriptor, { signal: controller.signal });
      owners.add(next);
      if (!isCurrent()) {
        await disposeInstance(next);
        throw new Error('The device connection changed while loading');
      }
      instances.set(targetId, next);
      await disposeInstance(current);
      return next;
    })().catch(error => {
      if (isCurrent() && state.getSnapshot().active?.targetId === targetId) {
        update({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    });
    attempt.operation = operation;
    pending.set(targetId, attempt);
    try { return await operation; }
    finally { if (pending.get(targetId) === attempt) pending.delete(targetId); }
  }

  async function open(reference, { connectionId, refresh = false } = {}) {
    const token = ++navigation;
    const current = () => !stopped && token === navigation;
    update({ active: reference, phase: 'loading', error: null });
    for (const instance of instances.values()) instance.realm.active = false;
    try {
      routeShortcuts();
      const instance = await ensure(reference.targetId, { refresh, connectionId });
      const canSelect = () => current() && !instance.closed;
      if (!canSelect()) return;
      if (reference.sessionId !== null) {
        const sessions = instance.ctx.sessions;
        const list = sessions.list.getSnapshot();
        // The live device catalog is already primed. A new or missing session
        // still gets an authoritative refresh before we report it unavailable.
        if (refresh || list.phase !== 'ready' || !Object.hasOwn(list.byId, reference.sessionId)) {
          await sessions.refresh();
          if (!canSelect()) return;
        }
        if (!Object.hasOwn(sessions.list.getSnapshot().byId, reference.sessionId)) throw new Error('That device session is no longer available');
        if (instance.navigation) {
          await instance.navigation.open(reference.sessionId, canSelect);
        } else {
          await instance.ctx.uiWorkspace.openSession(reference.sessionId);
        }
        if (!canSelect()) return;
        const binding = instance.ctx.sessions.binding(reference.sessionId);
        if (!binding) throw new Error('The device session could not be retained');
      } else if (instance.navigation) {
        // The chooser owns this route. Opening an empty realm must not invoke
        // the native Workspace startup policy to create a default session.
        onChooseDevice?.(reference.targetId);
        if (!canSelect()) return;
      }
      instance.realm.active = true;
      update({ phase: 'ready', error: null });
      instance.syncSelection?.();
    } catch (error) {
      if (stopped || token !== navigation) return;
      update({ phase: 'error', error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  return {
    state,
    ensure,
    open,
    deactivate() {
      navigation++;
      for (const instance of instances.values()) instance.realm.active = false;
      update({ active: null, phase: 'idle', error: null });
    },
    status(targetId, sessionId) { return instances.get(targetId)?.status?.get(sessionId); },
    connectionStatus(targetId) { return instances.get(targetId)?.connection?.state?.getSnapshot(); },
    render(targetId) { return instances.get(targetId)?.ctx.slots.renderSlot('root', {}) ?? null; },
    async retire(targetId) {
      generations.set(targetId, (generations.get(targetId) ?? 0) + 1);
      const attempt = pending.get(targetId);
      pending.delete(targetId);
      attempt?.controller.abort();
      const instance = instances.get(targetId);
      instances.delete(targetId);
      if (state.getSnapshot().active?.targetId === targetId) {
        navigation++;
        update({ phase: 'error', error: 'The device disconnected. Reconnect it and retry.' });
      }
      await disposeInstance(instance);
    },
    async dispose() {
      if (stopped) return;
      stopped = true;
      navigation++;
      shortcutRouter?.dispose();
      const attempts = [...pending.values()];
      for (const attempt of attempts) attempt.controller.abort();
      await Promise.allSettled(attempts.map(attempt => attempt.operation));
      await Promise.allSettled([...owners].map(disposeInstance));
      instances.clear();
      pending.clear();
      generations.clear();
    },
  };
}
