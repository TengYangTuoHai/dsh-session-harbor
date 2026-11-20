/** Private lazy-CJS module realm for trusted DSH client bundles; no runtime imports. */
const OFFICIAL = /^@deepseek-ai\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const CHUNK = /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/;
const STORE = '@deepseek-ai/dsh-client-store';
const KEYBOARD_EVENTS = new Set(['keydown', 'keyup', 'keypress']);
const INTERACTIONS = new Set(['keydown', 'keyup', 'keypress', 'paste', 'copy', 'cut', 'click', 'dblclick', 'contextmenu', 'mousedown', 'mouseup', 'mousemove', 'pointerdown', 'pointerup', 'pointermove']);
const WINDOW_METHODS = new Set(['addEventListener', 'removeEventListener', 'dispatchEvent', 'requestAnimationFrame', 'cancelAnimationFrame', 'getComputedStyle', 'matchMedia', 'postMessage', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']);
const stripClient = value => value.endsWith('/client') ? value.slice(0, -7) : value;
const aborted = () => new DOMException('Device realm disposed', 'AbortError');
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const thenable = value => value != null && typeof value.then === 'function';

// Embedded Clients stay on their boot graph. The workbench owns release prompts and reloads.
const fixedEntries = Object.freeze({
  releaseChange: Object.freeze({ getSnapshot: () => undefined, subscribe: () => () => {} }),
  dismissRelease() {},
});

function cloneData(value) {
  return JSON.parse(JSON.stringify(value));
}

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; }, key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => values.set(String(key), String(value)), removeItem: key => values.delete(String(key)),
  };
}

function namespaceStorage(backing, prefix, assertLive) {
  const source = backing ?? memoryStorage();
  const keys = () => {
    const result = [];
    for (let n = 0; n < source.length; n += 1) {
      const key = source.key(n);
      if (typeof key === 'string' && key.startsWith(prefix)) result.push(key.slice(prefix.length));
    }
    return result;
  };
  const methods = {
    getItem(key) { assertLive(); return source.getItem(prefix + String(key)); },
    setItem(key, value) { assertLive(); source.setItem(prefix + String(key), String(value)); },
    removeItem(key) { assertLive(); source.removeItem(prefix + String(key)); },
    clear() { assertLive(); for (const key of keys()) source.removeItem(prefix + key); },
    key(index) { assertLive(); const number = Number(index); return Number.isFinite(number) && number >= 0 ? keys()[Math.trunc(number)] ?? null : null; },
  };
  return new Proxy(Object.create(null), {
    get(_, key) {
      if (key === 'length') { assertLive(); return keys().length; }
      if (key === Symbol.toStringTag) return 'Storage';
      if (typeof key !== 'string') return undefined;
      if (Object.hasOwn(methods, key)) return methods[key];
      return methods.getItem(key) ?? undefined;
    },
    set(_, key, value) { if (typeof key !== 'string') return false; methods.setItem(key, value); return true; },
    deleteProperty(_, key) { if (typeof key === 'string') methods.removeItem(key); return true; },
    ownKeys() { assertLive(); return keys(); },
    has(_, key) { return Object.hasOwn(methods, key) || (typeof key === 'string' && methods.getItem(key) !== null); },
    getOwnPropertyDescriptor(_, key) {
      if (typeof key !== 'string') return undefined;
      const value = methods.getItem(key);
      return value === null ? undefined : { value, writable: true, enumerable: true, configurable: true };
    },
  });
}

function transportMapper(baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl.startsWith('/') || baseUrl.startsWith('//') || !/^\/t3-remote\/ssh\/[A-Za-z0-9_-]+\/$/.test(baseUrl)) {
    throw new TypeError('device realm requires a Session Harbor SSH device baseUrl');
  }
  return input => {
    const path = String(input);
    if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(path) || path.startsWith('//') || path.includes('\\') || path.includes('#')) {
      throw new TypeError('device realm transport cannot leave its environment mount');
    }
    const relative = path.startsWith(baseUrl) ? path.slice(baseUrl.length) : path.startsWith('/') ? path.slice(1) : path;
    const pathname = relative.split('?', 1)[0];
    if (!pathname || pathname.split('/').some(part => {
      const decoded = decodeURIComponent(part);
      return !decoded || decoded === '..' || decoded === '.' || /[\/\\\0]/.test(decoded);
    })) {
      throw new TypeError('invalid device realm transport path');
    }
    return baseUrl + relative;
  };
}

function createBrowserFetch(send, location, mapTransport, assertLive) {
  return async (input, init) => {
    assertLive();
    const request = input instanceof Request ? input : null;
    const value = request?.url ?? String(input);
    if (!/^[A-Za-z][A-Za-z\d+.-]*:|^\/\//.test(value)) return send(mapTransport(value), init);

    // Browser sources such as blob URLs still use the browser. Absolute URLs
    // on the desktop origin address the same device as relative API requests.
    const url = new URL(value, location?.href);
    if (url.protocol !== location?.protocol || url.host !== location?.host) return send(input, init);
    const path = mapTransport(url.pathname + url.search + url.hash);
    const mapped = request ? new Request(new URL(path, location.href), request) : path;
    return send(mapped, init);
  };
}

function capabilityFacade(target, overrides, beforeCall) {
  const methods = new Map();
  const source = target ?? Object.create(null);
  return new Proxy(Object.create(null), {
    get(_, key) {
      if (Object.hasOwn(overrides, key)) return overrides[key];
      const value = Reflect.get(source, key, source);
      if (typeof value !== 'function') return value;
      if (methods.get(key)?.value !== value) methods.set(key, {
        value, bound: (...args) => { beforeCall?.(); return value.apply(source, args); },
      });
      return methods.get(key).bound;
    },
    ownKeys: () => [...new Set([...Reflect.ownKeys(source), ...Reflect.ownKeys(overrides)])],
    getOwnPropertyDescriptor(_, key) {
      return Object.hasOwn(source, key) || Object.hasOwn(overrides, key)
        ? { configurable: true, enumerable: true } : undefined;
    },
    set: () => false,
  });
}

function storeFacade(platform, prefix, getInitialSelection) {
  if (!isRecord(platform)) throw new TypeError('device realm store platform export must be an object');
  const namespacePersist = persist => {
    if (typeof persist === 'string') return prefix + persist;
    if (isRecord(persist) && typeof persist.name === 'string') return { ...persist, name: prefix + persist.name };
    return persist;
  };
  return {
    ...platform,
    ...(typeof platform.defineStore === 'function' ? {
      defineStore(spec, ...args) {
        return platform.defineStore({ ...spec, ...Object.hasOwn(spec, 'persist') ? { persist: namespacePersist(spec.persist) } : {} }, ...args);
      },
    } : {}),
    ...(typeof platform.createSnapshotStore === 'function' ? {
      createSnapshotStore(initial, options, ...args) {
        const selection = options?.persist?.name === 'dsh.sessions.current' ? getInitialSelection?.() : undefined;
        const value = selection === undefined ? initial : cloneData(selection);
        return platform.createSnapshotStore(value, options === undefined ? options : {
          ...options, ...Object.hasOwn(options, 'persist') ? { persist: namespacePersist(options.persist) } : {},
        }, ...args);
      },
    } : {}),
  };
}

/**
 * platformImport may be asynchronous for import(), but native factory require()
 * needs a synchronous seed reader: provide platformImport.sync, or make the
 * function itself synchronous for seed words. Returned platform identities are
 * reused verbatim except the storage-name facade for dsh-client-store.
 * loadScript(url, {signal,runtimeKey,packageId,file}) executes the broker's
 * lexical wrapper; it does not return source text. The caller owns the real
 * __T3_DEVICE_REALMS__ registry and removes this realm before disposal completes.
 * shortcuts is the parent public preference service. externalKeyboard leaves
 * window/native command input to the parent dispatcher; scoped document keys
 * still reach local components. The caller owns portalElement and registers
 * that container as a portal root. initialSelection is a fallback only: an
 * explicit persisted navigation seed is the caller's responsibility.
 */
export function createDeviceRealm({ descriptor, platformImport, loadScript, pageGlobal = globalThis, fetch: doFetch, createWebSocket, shortcuts, externalKeyboard = false, initialSelection, signal } = {}) {
  if (!isRecord(descriptor) || !Array.isArray(descriptor.graph?.entries)
    || !/^[A-Za-z0-9_-]{1,200}$/.test(descriptor.namespace ?? '')
    || typeof descriptor.runtimeKey !== 'string' || !descriptor.runtimeKey
    || !/^[A-Za-z0-9_-]{1,200}$/.test(descriptor.targetId ?? '')
    || !/^[A-Za-z0-9_-]{1,200}$/.test(descriptor.connectionId ?? '')) {
    throw new TypeError('invalid device realm descriptor');
  }
  if (typeof platformImport !== 'function' || typeof loadScript !== 'function') throw new TypeError('device realm requires platformImport and loadScript');
  const mapTransport = transportMapper(descriptor.baseUrl);
  const lifetime = new AbortController();
  const rows = new Map();
  for (const input of descriptor.graph.entries) {
    if (!isRecord(input) || !OFFICIAL.test(input.id) || rows.has(input.id)
      || ![input.external ?? [], input.inject ?? []].every(values => Array.isArray(values) && values.every(value => typeof value === 'string'))) {
      throw new TypeError('device realm graph must contain unique official package rows');
    }
    rows.set(input.id, { ...input, external: [...input.external ?? []], inject: [...input.inject ?? []] });
  }
  const prefix = `t3.device.${descriptor.namespace}.`;
  const factories = new Map();
  const cache = new Map();
  const platforms = new Map();
  const platformTasks = new Map();
  const arrivals = new Map();
  const epochs = new Map();
  const materializing = new Set();
  const errors = new Map();
  const styles = new Set();
  const cachedStyles = () => new Set([...cache.values()].flatMap(record => record.styles));
  const eventRemovers = new Set();
  const portalRoots = new Set();
  let disposed = false;
  let disposal;
  let realm;
  const assertLive = () => { if (disposed || lifetime.signal.aborted) throw aborted(); };
  const localStorage = namespaceStorage(pageGlobal.localStorage, prefix, assertLive);
  const sessionStorage = namespaceStorage(pageGlobal.sessionStorage, prefix, assertLive);
  const rememberPlatform = (specifier, value) => {
    assertLive();
    const resolved = stripClient(specifier) === STORE ? storeFacade(value, prefix, () => realm.initialSelection) : value;
    platforms.set(specifier, resolved);
    if (stripClient(specifier) === STORE) { platforms.set(STORE, resolved); platforms.set(`${STORE}/client`, resolved); }
    return resolved;
  };
  const platformSync = specifier => {
    if (platforms.has(specifier)) return platforms.get(specifier);
    const value = (platformImport.sync ?? platformImport)(specifier);
    if (thenable(value)) {
      void Promise.resolve(value).catch(() => {});
      throw new Error(`device realm require("${specifier}") needs a prepared platform dependency or platformImport.sync`);
    }
    return rememberPlatform(specifier, value);
  };
  const platformAsync = async specifier => {
    if (platforms.has(specifier)) return platforms.get(specifier);
    if (!platformTasks.has(specifier)) {
      const pending = Promise.resolve().then(() => platformImport(specifier))
        .then(value => platforms.has(specifier) ? platforms.get(specifier) : rememberPlatform(specifier, value))
        .finally(() => platformTasks.delete(specifier));
      platformTasks.set(specifier, pending);
    }
    return await platformTasks.get(specifier);
  };
  const resourceUrl = (packageId, file) => {
    const params = new URLSearchParams({ connectionId: descriptor.connectionId, packageId, file, runtimeKey: descriptor.runtimeKey });
    return `/t3-remote/native/${encodeURIComponent(descriptor.targetId)}?${params}`;
  };
  const moduleKey = (id, file) => file === 'client.js' ? id : `${id}/${file}`;
  const register = registration => {
    assertLive();
    if (!isRecord(registration) || typeof registration.id !== 'string' || typeof registration.factory !== 'function') throw new TypeError('invalid device factory registration');
    const owner = stripClient(registration.id);
    if (!rows.has(owner)) throw new Error(`device factory is outside trusted graph: ${owner}`);
    if (registration.chunk !== undefined && !CHUNK.test(registration.chunk)) throw new Error('invalid device package-local chunk');
    const key = registration.chunk === undefined ? owner : `${owner}/${registration.chunk}`;
    if (factories.has(key) || cache.has(key)) throw new Error(`duplicate device factory registration: ${key}`);
    factories.set(key, { factory: registration.factory, owner, epoch: epochs.get(owner) ?? 0 });
  };
  const arriveFile = async (owner, file = 'client.js') => {
    assertLive();
    const key = moduleKey(owner, file);
    if (cache.has(key) || factories.has(key)) return;
    if (!arrivals.has(key)) {
      const epoch = epochs.get(owner) ?? 0;
      const pending = Promise.resolve().then(() => {
        assertLive();
        return loadScript(resourceUrl(owner, file), { signal: lifetime.signal, runtimeKey: descriptor.runtimeKey, packageId: owner, file });
      }).then(() => {
        assertLive();
        if ((epochs.get(owner) ?? 0) !== epoch) throw new Error('device module changed while loading');
        if (!factories.has(key)) throw new Error(`device script loaded without registering ${key}`);
      }).catch(error => {
        if (factories.get(key)?.epoch === epoch) factories.delete(key);
        cache.delete(key);
        throw error;
      }).finally(() => { if (arrivals.get(key) === pending) arrivals.delete(key); });
      arrivals.set(key, pending);
    }
    await arrivals.get(key);
  };
  const arriveGraph = async (id, open = [], visited = new Set()) => {
    assertLive();
    if (open.includes(id)) throw new Error(`device module dependency cycle: ${[...open, id].join(' -> ')}`);
    if (visited.has(id) || cache.has(id)) return;
    visited.add(id);
    const row = rows.get(id);
    const next = [...open, id];
    for (const specifier of row.external) {
      const dependency = stripClient(specifier);
      if (rows.has(dependency)) await arriveGraph(dependency, next, visited);
      else await platformAsync(specifier);
    }
    for (const specifier of row.inject) {
      const dependency = stripClient(specifier);
      if (rows.has(dependency)) await arriveGraph(dependency, [], visited);
      else await platformAsync(specifier);
    }
    await arriveFile(id);
  };
  const asset = reference => {
    assertLive();
    if (typeof reference !== 'string' || reference.includes('\\') || reference.includes('?') || reference.includes('#')) throw new TypeError('invalid device asset reference');
    const match = /^plugins\/(@deepseek-ai\/[^/]+)\/assets\/(.+)$/.exec(reference);
    if (!match || !rows.has(match[1]) || match[2].split('/').some(part => {
      const decoded = decodeURIComponent(part);
      return !decoded || decoded === '.' || decoded === '..' || /[\/\\\0]/.test(decoded);
    })) throw new TypeError('device asset is outside trusted package graph');
    return mapTransport(reference);
  };
  const materialize = (id, owner = id) => {
    assertLive();
    if (cache.has(id)) return cache.get(id).exports;
    if (materializing.has(id)) throw new Error(`device require cycle through ${id}`);
    const registered = factories.get(id);
    if (!registered) throw new Error(`device require missed registered factory: ${id}`);
    materializing.add(id);
    const before = new Set(styles);
    const edges = new Set();
    const require = specifier => {
      assertLive();
      if (typeof specifier !== 'string' || specifier.startsWith('.')) throw new Error('device synchronous relative chunks are unsupported');
      edges.add(specifier);
      const target = stripClient(specifier);
      if (rows.has(target)) return materialize(target);
      return platformSync(specifier);
    };
    require.async = async specifier => {
      assertLive();
      if (!specifier.startsWith('./')) return await importModule(specifier);
      const file = specifier.slice(2);
      if (!CHUNK.test(file)) throw new Error('invalid relative device chunk request');
      const key = moduleKey(owner, file);
      await arriveFile(owner, file);
      return materialize(key, owner);
    };
    require.asset = asset;
    try {
      const exports = registered.factory(require);
      assertLive();
      const retained = cachedStyles();
      cache.set(id, { id, exports, edges, styles: [...styles].filter(style => !before.has(style) && !retained.has(style)) });
      return exports;
    } catch (error) {
      const retained = cachedStyles();
      for (const style of [...styles]) if (!before.has(style) && !retained.has(style)) { style.remove(); styles.delete(style); }
      throw error;
    } finally { materializing.delete(id); }
  };
  const importModule = async specifier => {
    assertLive();
    if (typeof specifier !== 'string') throw new TypeError('invalid device module specifier');
    const id = stripClient(specifier);
    try {
      const value = rows.has(id) ? (await arriveGraph(id), materialize(id)) : await platformAsync(specifier);
      assertLive();
      errors.delete(id);
      return value;
    } catch (error) { if (!disposed) errors.set(id, error); throw error; }
  };
  const contains = target => realm.active && [realm.rootElement, ...portalRoots].some(root =>
    root && (target === root || (typeof target?.nodeType === 'number' && root.contains?.(target))));
  const inside = event => [event.target, ...event.composedPath?.() ?? []].some(contains);
  const wrapEvents = target => {
    const registrations = [];
    return {
      add(type, listener, options) {
        assertLive();
        if (realm.externalKeyboard && target === pageGlobal && KEYBOARD_EVENTS.has(type)) return;
        const capture = typeof options === 'boolean' ? options : !!options?.capture;
        if (registrations.some(row => row.type === type && row.listener === listener && row.capture === capture)) return;
        let cleanup;
        const wrapper = event => {
          if (disposed || (realm.externalKeyboard && target === pageGlobal && KEYBOARD_EVENTS.has(type))
            || (INTERACTIONS.has(type) && !inside(event))) return;
          if (typeof options === 'object' && options?.once) cleanup();
          if (typeof listener === 'function') listener.call(target === pageGlobal ? realm.window : realm.document, event); else listener?.handleEvent?.(event);
        };
        const row = { type, listener, capture, wrapper, cleanup: null };
        cleanup = () => {
          target.removeEventListener(type, wrapper, capture);
          options?.signal?.removeEventListener('abort', cleanup);
          const index = registrations.indexOf(row);
          if (index >= 0) registrations.splice(index, 1);
          eventRemovers.delete(cleanup);
        };
        row.cleanup = cleanup;
        if (options?.signal?.aborted) return;
        registrations.push(row);
        eventRemovers.add(cleanup);
        target.addEventListener(type, wrapper, typeof options === 'object' ? { ...options, once: false } : options);
        options?.signal?.addEventListener('abort', cleanup, { once: true });
      },
      remove(type, listener, options) {
        const capture = typeof options === 'boolean' ? options : !!options?.capture;
        const row = registrations.find(row => row.type === type && row.listener === listener && row.capture === capture);
        row?.cleanup();
      },
    };
  };
  const trackStyles = node => {
    if (String(node?.tagName).toLowerCase() === 'style') styles.add(node);
    for (const style of node?.querySelectorAll?.('style') ?? []) styles.add(style);
  };
  const realDocument = pageGlobal.document;
  const documentEvents = realDocument?.addEventListener ? wrapEvents(realDocument) : null;
  // Official locale and theme set documentElement.lang and style even during
  // prewarming. Keep those writes and pre-mount body content in the device.
  const detachedRoot = realDocument?.documentElement?.cloneNode?.(false);
  const detachedBody = realDocument?.createElement?.('body');
  if (detachedRoot && detachedBody) detachedRoot.append(detachedBody);
  const detachedHead = realDocument?.createElement?.('head');
  const head = realDocument?.head && new Proxy(realDocument.head, {
    get(target, property) {
      const value = Reflect.get(target, property, target);
      if (['append', 'appendChild', 'prepend', 'insertBefore', 'replaceChild'].includes(property)) return (...nodes) => {
        assertLive();
        const inserted = property === 'append' || property === 'prepend' ? nodes : nodes.slice(0, 1);
        for (const node of inserted) trackStyles(node);
        // The workbench already owns the global official theme sheets.
        if (detachedHead && property === 'appendChild' && nodes[0]?.dataset?.pluginCss?.startsWith('@deepseek-ai/dsh-client-ui-theme/')) {
          return detachedHead.appendChild(nodes[0]);
        }
        return value.apply(target, nodes);
      };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const documentFacade = realDocument && new Proxy(realDocument, {
    get(target, property) {
      if (property === 'head') return head;
      if (property === 'body') return realm.portalElement ?? detachedBody ?? target.body;
      if (property === 'documentElement' && detachedRoot) return detachedRoot;
      if (property === 'defaultView') return realm.window;
      // The workbench's #root contains both the conversation and its portals.
      // Embedded overlays must never make that background inert or invisible.
      if (property === 'getElementById') return id => String(id) === 'root'
        ? null : target.getElementById(id);
      if (property === 'addEventListener' && documentEvents) return documentEvents.add;
      if (property === 'removeEventListener' && documentEvents) return documentEvents.remove;
      const value = Reflect.get(target, property, target);
      if (property === 'createElement') return (...args) => { assertLive(); const element = value.apply(target, args); trackStyles(element); return element; };
      if ((property === 'querySelector' || property === 'querySelectorAll') && typeof value === 'function') return (selector, ...args) => {
        if (/^style(?:\[|:|\s|$)/.test(selector)) {
          const found = [...target.querySelectorAll(selector)].filter(style => styles.has(style));
          return property === 'querySelector' ? found[0] ?? null : found;
        }
        return value.call(target, selector, ...args);
      };
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const ownSubscription = subscribe => {
    let stopped = false;
    let off;
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      eventRemovers.delete(cleanup);
      off?.();
    };
    eventRemovers.add(cleanup);
    try {
      off = subscribe(() => !stopped && !disposed);
      if (stopped) off?.();
    } catch (error) { cleanup(); throw error; }
    return cleanup;
  };
  const nativeDesktop = pageGlobal.dshDesktop;
  const nativeKeyboard = nativeDesktop?.keyboard;
  const keyboardFacade = nativeKeyboard && capabilityFacade(nativeKeyboard, {
    subscribe(listener) {
      assertLive();
      if (realm.externalKeyboard) return () => {};
      return ownSubscription(live => nativeKeyboard.subscribe(input => {
        if (live() && !realm.externalKeyboard && inside({ target: realDocument?.activeElement })) listener(input);
      }));
    },
    ...(externalKeyboard ? { async closeWindow() {} } : {}),
  }, () => {
    assertLive();
    if (!realm.active) throw new Error('Device keyboard capability requires an active conversation');
  });
  const shortcutAdapter = shortcuts && {
    async get() { assertLive(); return shortcuts.config.getSnapshot(); },
    subscribe(listener) {
      assertLive();
      return ownSubscription(live => shortcuts.config.subscribe(() => {
        if (live()) listener(shortcuts.config.getSnapshot());
      }));
    },
    edit(...args) { assertLive(); return shortcuts.edit(...args); },
    recording(...args) { assertLive(); return shortcuts.recording(...args); },
  };
  const desktopFacade = nativeDesktop || shortcuts ? capabilityFacade(nativeDesktop, {
    keyboard: keyboardFacade, shortcuts: shortcutAdapter,
  }) : undefined;
  const ownGlobals = Object.assign(Object.create(null), cloneData(descriptor.globals ?? {}));
  const windowEvents = typeof pageGlobal.addEventListener === 'function' ? wrapEvents(pageGlobal) : null;
  const mappedFetch = typeof doFetch === 'function' ? (input, init) => { assertLive(); return doFetch(mapTransport(input), init); } : undefined;
  const mappedSocket = typeof createWebSocket === 'function' ? input => { assertLive(); return createWebSocket(mapTransport(input)); } : undefined;
  const browserFetch = mappedFetch && createBrowserFetch(doFetch, pageGlobal.location, mapTransport, assertLive);
  Object.assign(ownGlobals, {
    __DSH_BOOT__: cloneData(descriptor.graph), __ModuleLoader__: { mode: 'live', load: register },
    __DSH_TRANSPORT__: { ...(mappedFetch ? { fetch: mappedFetch } : {}), ...(mappedSocket ? { createWebSocket: mappedSocket } : {}) },
    __DSH_FILE_UPLOAD__: mappedFetch ? { fetch: mappedFetch } : undefined,
    localStorage, sessionStorage, document: documentFacade, dshDesktop: desktopFacade, fetch: browserFetch,
  });
  const windowFacade = new Proxy(ownGlobals, {
    get(target, property) {
      if (['window', 'self', 'globalThis'].includes(property)) return windowFacade;
      if (Object.hasOwn(target, property)) return target[property];
      if (property === 'addEventListener' && windowEvents) return windowEvents.add;
      if (property === 'removeEventListener' && windowEvents) return windowEvents.remove;
      if (typeof property === 'string' && (property.startsWith('__DSH_') || property === '__T3_DEVICE_REALMS__')) return undefined;
      const value = Reflect.get(pageGlobal, property, pageGlobal);
      return typeof value === 'function' && WINDOW_METHODS.has(property) ? value.bind(pageGlobal) : value;
    },
    set(target, property, value) { target[property] = value; return true; },
    deleteProperty(target, property) { return Reflect.deleteProperty(target, property); },
  });
  const manifest = {
    rev: descriptor.graph.rev, ...(descriptor.graph.release ? { release: cloneData(descriptor.graph.release) } : {}),
    modules: [...rows.values()].map(row => ({ ...row, url: resourceUrl(row.id, 'client.js'), initialUrl: resourceUrl(row.id, 'client.js') })),
    plugins: [...rows.values()].map(row => ({ id: row.id, inject: [...row.inject], immediately: !!row.immediately })),
  };
  const modules = {
    version: 'client', manifest, entries: fixedEntries, loadCache: cache, import: importModule,
    async prefetch(specifier) { assertLive(); const id = stripClient(specifier); if (!rows.has(id)) throw new Error('device prefetch is outside trusted graph'); await arriveGraph(id); },
    importError: specifier => errors.get(stripClient(specifier)),
    invalidate(specifier) {
      assertLive();
      const id = stripClient(specifier);
      epochs.set(id, (epochs.get(id) ?? 0) + 1);
      const removedStyles = new Set();
      for (const key of [...factories.keys()]) if (key === id || key.startsWith(`${id}/client.`)) {
        for (const style of cache.get(key)?.styles ?? []) removedStyles.add(style);
        factories.delete(key); cache.delete(key);
      }
      const retained = cachedStyles();
      for (const style of removedStyles) if (!retained.has(style)) { style.remove(); styles.delete(style); }
      errors.delete(id);
    },
  };
  realm = {
    window: windowFacade, globalThis: windowFacade, localStorage, sessionStorage, document: documentFacade,
    storagePrefix: prefix, runtimeKey: descriptor.runtimeKey, modules, import: importModule,
    active: false, rootElement: null, portalElement: null, initialSelection, externalKeyboard: !!externalKeyboard,
    contains,
    registerPortalRoot(element) { assertLive(); portalRoots.add(element); return () => portalRoots.delete(element); },
    dispose() {
      if (disposal) return disposal;
      disposal = Promise.resolve();
      disposed = true;
      realm.active = false;
      lifetime.abort(aborted());
      signal?.removeEventListener('abort', onAbort);
      for (const remove of [...eventRemovers]) remove();
      for (const style of styles) style.remove();
      styles.clear();
      factories.clear(); cache.clear(); materializing.clear(); platforms.clear(); platformTasks.clear(); arrivals.clear(); errors.clear(); portalRoots.clear();
      return disposal;
    },
  };
  const onAbort = () => { void realm.dispose(); };
  if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  return realm;
}
