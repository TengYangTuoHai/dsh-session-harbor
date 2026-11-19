import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceRealm } from './device-realm.js';

const A = '@deepseek-ai/test-device-a';
const B = '@deepseek-ai/test-device-b';
const STORE = '@deepseek-ai/dsh-client-store';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
function backingStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.get(String(key)) ?? null,
    setItem: (key, value) => { values.set(String(key), String(value)); },
    removeItem: key => { values.delete(String(key)); },
  };
}
const row = (id, extras = {}) => ({ id, rev: 'r1', url: 'https://must-not-load.example/remote.js', inject: [], external: [], ...extras });
function descriptor(namespace = 'device-a', entries = [row(A)]) {
  return {
    targetId: namespace, connectionId: `connection-${namespace}`, namespace, runtimeKey: `runtime-${namespace}-r1`,
    baseUrl: `/ssh/environment/connection-${namespace}/`,
    graph: { rev: 'graph-r1', release: { version: '0.2.2-rc.3', commit: 'trusted' }, entries, batches: [] },
    globals: { __DSH_REMOTE_ACCESS__: { owner: true, resources: [] }, __DSH_TEST__: { value: namespace } },
  };
}
function fixture({ desc = descriptor(), scripts = {}, platform = {}, pageGlobal, loadScript: loadInput, ...options } = {}) {
  let realm;
  const loads = [];
  const root = pageGlobal ?? { localStorage: backingStorage(), sessionStorage: backingStorage(), __DSH_TEST__: { value: 'local' }, __DSH_TRANSPORT__: { local: true } };
  const platformImport = specifier => {
    if (!Object.hasOwn(platform, specifier)) throw new Error(`unknown platform seed ${specifier}`);
    return platform[specifier];
  };
  platformImport.sync = platformImport;
  realm = createDeviceRealm({
    descriptor: desc, pageGlobal: root, platformImport,
    loadScript: async (url, options) => {
      loads.push([url, options]);
      if (loadInput) return await loadInput(url, options, realm);
      const entry = scripts[`${options.packageId}/${options.file}`];
      if (!entry) throw new Error('test script missing');
      realm.window.__ModuleLoader__.load({ id: options.packageId, ...(options.file === 'client.js' ? {} : { chunk: options.file }), factory: entry });
    },
    ...options,
  });
  return { realm, loads, pageGlobal: root };
}

test('trusted graph loads through the broker and retains platform singletons', async t => {
  const react = { createElement() {} };
  const cordis = { Context: class Context {} };
  const slots = { identity: Symbol('renderer-context') };
  const { realm, loads } = fixture({
    desc: descriptor('device-a', [row(A, { external: ['react'], inject: [B] }), row(B)]),
    scripts: {
      [`${A}/client.js`]: require => ({ react: require('react'), cordis: require('@deepseek-ai/cordis'), slots: require('@deepseek-ai/dsh-client-ui-slots'), dependency: require(`${B}/client`) }),
      [`${B}/client.js`]: () => ({ devicePrivate: Symbol('private') }),
    },
    platform: { react, '@deepseek-ai/cordis': cordis, '@deepseek-ai/dsh-client-ui-slots': slots },
  });
  t.after(() => realm.dispose());
  const exports = await realm.modules.import(`${A}/client`, '', {});
  assert.equal(exports.react, react);
  assert.equal(exports.cordis, cordis);
  assert.equal(exports.slots, slots);
  assert.equal(await realm.import('react'), react);
  assert.equal(await realm.import(A), exports);
  assert.equal(exports.dependency, await realm.import(B));
  assert.equal(realm.modules.version, 'client');
  assert.equal(realm.modules.manifest.plugins.length, 2);
  assert.deepEqual(loads.map(([, options]) => options.packageId), [B, A]);
  for (const [url, options] of loads) {
    const parsed = new URL(url, 'https://local.example');
    assert.equal(parsed.pathname, '/t3-remote/native/device-a');
    assert.equal(parsed.searchParams.get('connectionId'), 'connection-device-a');
    assert.equal(parsed.searchParams.get('runtimeKey'), 'runtime-device-a-r1');
    assert.equal(parsed.searchParams.get('file'), 'client.js');
    assert.equal(parsed.searchParams.get('packageId'), options.packageId);
    assert.equal(options.signal.aborted, false);
    assert.ok(!url.includes('must-not-load.example'));
  }
});

test('same session ids on two devices get private factories, globals and persisted storage', async t => {
  const pageGlobal = { localStorage: backingStorage(), sessionStorage: backingStorage(), __DSH_TEST__: { value: 'local' }, __DSH_UNLISTED__: { local: true } };
  pageGlobal.localStorage.setItem('dsh.sessions.current', 'local-session');
  const scripts = { [`${A}/client.js`]: () => ({ value: {} }) };
  const first = fixture({ desc: descriptor('first'), scripts, pageGlobal }).realm;
  const second = fixture({ desc: descriptor('second'), scripts, pageGlobal }).realm;
  t.after(() => first.dispose());
  t.after(() => second.dispose());
  assert.notEqual(await first.import(A), await second.import(A));
  first.localStorage.setItem('dsh.sessions.current', 'same-session-id');
  second.localStorage.setItem('dsh.sessions.current', 'same-session-id');
  first.localStorage['draft.same-session-id'] = 'first-device draft';
  second.localStorage['draft.same-session-id'] = 'second-device draft';
  assert.equal(first.localStorage['draft.same-session-id'], 'first-device draft');
  assert.equal(second.localStorage['draft.same-session-id'], 'second-device draft');
  assert.equal(pageGlobal.localStorage.getItem('dsh.sessions.current'), 'local-session');
  assert.equal(pageGlobal.localStorage.getItem(`${first.storagePrefix}draft.same-session-id`), 'first-device draft');
  assert.deepEqual(Object.keys(first.localStorage), ['dsh.sessions.current', 'draft.same-session-id']);
  assert.equal(first.localStorage.length, 2);
  assert.equal(first.localStorage.key(1), 'draft.same-session-id');
  assert.equal(first.localStorage.key(20), null);
  assert.equal(first.window, first.globalThis);
  assert.equal(first.window.window, first.window);
  assert.equal(first.window.globalThis, first.window);
  first.window.__DSH_TEST__.value = 'changed private bootstrap';
  first.window.__DSH_ADDED__ = { private: true };
  assert.equal(pageGlobal.__DSH_TEST__.value, 'local');
  assert.equal(second.window.__DSH_TEST__.value, 'second');
  assert.equal(pageGlobal.__DSH_ADDED__, undefined);
  assert.equal(first.window.__DSH_UNLISTED__, undefined);
  assert.equal(first.window.__T3_DEVICE_REALMS__, undefined);
  first.sessionStorage.setItem('transient', 'first');
  assert.equal(second.sessionStorage.getItem('transient'), null);
  first.localStorage.clear();
  assert.equal(first.localStorage.length, 0);
  assert.equal(second.localStorage.length, 2);
  assert.equal(pageGlobal.localStorage.getItem('dsh.sessions.current'), 'local-session');
});

test('platform store facade prefixes real persistence using exactly the direct-storage namespace', async t => {
  const pageGlobal = { localStorage: backingStorage(), sessionStorage: backingStorage() };
  const calls = [];
  const sentinel = {};
  const platformStore = {
    token: Symbol('platform implementation'),
    defineStore(spec, ...rest) { assert.equal(this, platformStore); calls.push(['defineStore', spec, rest]); return sentinel; },
    createSnapshotStore(initial, options, ...rest) { assert.equal(this, platformStore); calls.push(['createSnapshotStore', initial, options, rest]); return sentinel; },
  };
  const { realm } = fixture({ pageGlobal, platform: { [STORE]: platformStore } });
  t.after(() => realm.dispose());
  const store = await realm.import(STORE);
  assert.equal(await realm.import(`${STORE}/client`), store);
  assert.notEqual(store, platformStore);
  assert.equal(store.token, platformStore.token);
  const spec = Object.freeze({ init: () => ({}), persist: 'same-session-id.draft' });
  const options = Object.freeze({ persist: Object.freeze({ name: 'same-session-id.draft', version: 7 }), other: true });
  assert.equal(store.defineStore(spec, 'extra'), sentinel);
  assert.equal(store.createSnapshotStore({}, options, 'extra'), sentinel);
  assert.equal(calls[0][1].persist, `${realm.storagePrefix}same-session-id.draft`);
  assert.deepEqual(calls[0][2], ['extra']);
  assert.deepEqual(calls[1][2], { persist: { name: `${realm.storagePrefix}same-session-id.draft`, version: 7 }, other: true });
  assert.deepEqual(calls[1][3], ['extra']);
  assert.equal(spec.persist, 'same-session-id.draft');
  assert.equal(options.persist.name, 'same-session-id.draft');
  pageGlobal.localStorage.setItem(calls[0][1].persist, 'platform-write');
  assert.equal(realm.localStorage.getItem('same-session-id.draft'), 'platform-write');
  realm.localStorage.setItem('same-session-id.draft', 'lexical-write');
  assert.equal(pageGlobal.localStorage.getItem(calls[1][2].persist.name), 'lexical-write');
});

test('declared async platform dependencies prepare synchronous requires before materialization', async t => {
  const identity = {};
  const desc = descriptor('async-platform', [row(A, { external: ['react'] })]);
  let realm;
  const requested = [];
  realm = createDeviceRealm({ descriptor: desc, pageGlobal: {},
    platformImport: async request => { requested.push(request); return identity; },
    loadScript: async () => realm.window.__ModuleLoader__.load({ id: A, factory: require => ({ react: require('react') }) }),
  });
  t.after(() => realm.dispose());
  assert.equal((await realm.import(A)).react, identity);
  assert.deepEqual(requested, ['react']);
});

test('package chunks share one load, keep package ownership and retry after transport registration failure', async t => {
  let failed = true;
  const { realm, loads } = fixture({
    loadScript: async (_, options, realm) => {
      if (options.file === 'client.js') {
        realm.window.__ModuleLoader__.load({ id: A, factory: require => ({ load: () => require.async('./client.lazy.js'), invalid: () => require.async('../evil.js') }) });
        return;
      }
      realm.window.__ModuleLoader__.load({ id: A, chunk: 'client.lazy.js', factory: () => ({ lazy: {} }) });
      if (failed) { failed = false; throw new Error('script failed after registration'); }
    },
  });
  t.after(() => realm.dispose());
  const exports = await realm.import(A);
  await assert.rejects(exports.load(), /failed after registration/);
  const [first, second] = await Promise.all([exports.load(), exports.load()]);
  assert.equal(first, second);
  assert.equal(await exports.load(), first);
  assert.equal(loads.filter(([, options]) => options.file === 'client.lazy.js').length, 2);
  assert.equal(realm.modules.loadCache.get(`${A}/client.lazy.js`).exports, first);
  await assert.rejects(exports.invalid(), /platform seed|invalid/);
});

test('missing registration and failed factory require leave no partial exports or stuck guard', async t => {
  let register = false;
  let resolveSeed = false;
  let executions = 0;
  const platformImport = specifier => {
    if (!resolveSeed) throw new Error(`seed missing: ${specifier}`);
    return { ready: true };
  };
  platformImport.sync = platformImport;
  const { realm, loads } = fixture({ platformImport,
    loadScript: async (_, __, realm) => {
      if (!register) return;
      realm.window.__ModuleLoader__.load({ id: A, factory: require => { executions += 1; return require('late-platform'); } });
    },
  });
  t.after(() => realm.dispose());
  await assert.rejects(realm.import(A), /without registering/);
  register = true;
  await assert.rejects(realm.import(A), /seed missing/);
  assert.equal(realm.modules.loadCache.has(A), false);
  assert.match(realm.modules.importError(A).message, /seed missing/);
  resolveSeed = true;
  assert.deepEqual(await realm.import(A), { ready: true });
  assert.equal(executions, 2);
  assert.equal(loads.length, 2);
  assert.equal(realm.modules.importError(A), undefined);
});

test('declared dependency cycles and synchronous require cycles reject without deadlocking', async t => {
  const { realm, loads } = fixture({ desc: descriptor('cycle', [row(A, { external: [B] }), row(B, { external: [A] })]) });
  t.after(() => realm.dispose());
  await assert.rejects(realm.import(A), /dependency cycle/);
  assert.equal(loads.length, 0);
  const second = fixture({ desc: descriptor('require-cycle', [row(A), row(B)]) }).realm;
  t.after(() => second.dispose());
  let cyclic = true;
  second.window.__ModuleLoader__.load({ id: A, factory: require => cyclic ? require(B) : { recovered: true } });
  second.window.__ModuleLoader__.load({ id: B, factory: require => require(A) });
  await assert.rejects(second.import(A), /require cycle/);
  assert.equal(second.modules.loadCache.size, 0);
  cyclic = false;
  assert.deepEqual(await second.import(A), { recovered: true });
});

test('require.asset maps only trusted package assets to the selected device mount', async t => {
  const { realm } = fixture({ scripts: { [`${A}/client.js`]: require => ({ asset: require.asset }) } });
  t.after(() => realm.dispose());
  const { asset } = await realm.import(A);
  assert.equal(asset(`plugins/${A}/assets/a%20b.0123456789ab.svg`), `/ssh/environment/connection-device-a/plugins/${A}/assets/a%20b.0123456789ab.svg`);
  for (const input of [`plugins/${B}/assets/a.svg`, `plugins/${A}/assets/../local.svg`, `plugins/${A}/assets/%2e%2e/local.svg`, `plugins/${A}/assets/a%2fb.svg`, 'https://remote.example/a.svg']) {
    assert.throws(() => asset(input), /asset/);
  }
});

test('private transport and raw-upload hooks always map paths into the same environment', async t => {
  const calls = [];
  const sockets = [];
  const pageGlobal = { __DSH_TRANSPORT__: { local: true }, __DSH_FILE_UPLOAD__: { local: true } };
  const { realm } = fixture({ pageGlobal,
    fetch: async (...args) => { calls.push(args); return new Response('remote'); },
    createWebSocket: path => { sockets.push(path); return { path }; },
  });
  t.after(() => realm.dispose());
  const transport = realm.window.__DSH_TRANSPORT__;
  await transport.fetch('api/session/list', { method: 'POST' });
  await realm.globalThis.__DSH_FILE_UPLOAD__.fetch('/api/file-uploads?sessionId=same-id', { body: 'bytes' });
  transport.createWebSocket('/api/remote.mux');
  assert.deepEqual(calls.map(([url]) => url), [
    '/ssh/environment/connection-device-a/api/session/list', '/ssh/environment/connection-device-a/api/file-uploads?sessionId=same-id',
  ]);
  assert.deepEqual(sockets, ['/ssh/environment/connection-device-a/api/remote.mux']);
  assert.equal(pageGlobal.__DSH_TRANSPORT__.local, true);
  assert.equal(pageGlobal.__DSH_FILE_UPLOAD__.local, true);
  for (const path of ['/ssh/environment/connection-device-a/api/../local', 'api/%2e%2e/local', 'api/a%2fb', '//other/api', 'https://other/api']) {
    assert.throws(() => transport.createWebSocket(path), /path|mount/);
  }
});

test('dispose aborts in-flight script loading and blocks late registration without touching other realms', async t => {
  const opened = deferred();
  let inputSignal;
  const { realm } = fixture({ loadScript: (_, options) => {
    inputSignal = options.signal;
    opened.resolve();
    return new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true }));
  } });
  const pending = realm.import(A);
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  await opened.promise;
  const disposal = realm.dispose();
  assert.equal(disposal, realm.dispose());
  await disposal;
  await rejected;
  assert.equal(inputSignal.aborted, true);
  assert.throws(() => realm.window.__ModuleLoader__.load({ id: A, factory: () => ({}) }), error => error.name === 'AbortError');
  assert.equal(realm.modules.loadCache.size, 0);
  await assert.rejects(realm.import(A), error => error.name === 'AbortError');
  const other = fixture({ scripts: { [`${A}/client.js`]: () => ({ live: true }) } }).realm;
  t.after(() => other.dispose());
  assert.deepEqual(await other.import(A), { live: true });
});

test('invalidation discards a cached entry and its chunks before loading the replacement', async t => {
  let revision = 1;
  const { realm, loads } = fixture({ loadScript: (_, options, realm) => {
    if (options.file === 'client.js') realm.window.__ModuleLoader__.load({ id: A, factory: require => ({ revision, lazy: () => require.async('./client.lazy.js') }) });
    else realm.window.__ModuleLoader__.load({ id: A, chunk: options.file, factory: () => ({ revision }) });
  } });
  t.after(() => realm.dispose());
  const first = await realm.import(A);
  assert.equal((await first.lazy()).revision, 1);
  revision = 2;
  realm.modules.invalidate(A);
  const second = await realm.import(A);
  assert.notEqual(second, first);
  assert.equal(second.revision, 2);
  assert.equal((await second.lazy()).revision, 2);
  assert.equal(loads.length, 4);
});

test('untrusted registrations and graphs cannot expand the broker script surface', async t => {
  const { realm, loads } = fixture();
  t.after(() => realm.dispose());
  assert.throws(() => realm.window.__ModuleLoader__.load({ id: '@local/other-plugin', factory: () => ({}) }), /outside trusted graph/);
  assert.throws(() => realm.window.__ModuleLoader__.load({ id: A, chunk: '../outside.js', factory: () => ({}) }), /invalid.*chunk/);
  await assert.rejects(realm.import('@local/other-plugin'), /unknown platform seed/);
  assert.equal(loads.length, 0);
  assert.throws(() => fixture({ desc: descriptor('bad', [row('@local/other-plugin')]) }), /official/);
  assert.throws(() => fixture({ desc: descriptor('duplicate', [row(A), row(A)]) }), /unique/);
});

test('native keyboard facade gates callbacks by active focus and releases only its subscriptions', async t => {
  const nativeCallbacks = new Set();
  const calls = [];
  let releases = 0;
  const keyboard = Object.freeze({
    subscribe(listener) {
      assert.equal(this, keyboard);
      nativeCallbacks.add(listener);
      return () => { releases += 1; nativeCallbacks.delete(listener); };
    },
    async closeWindow(revision) { assert.equal(this, keyboard); calls.push(revision); },
  });
  const extra = Object.freeze({ identity: true });
  const desktop = Object.freeze({ keyboard, extra, identity() { assert.equal(this, desktop); return extra; } });
  const root = Object.freeze({ identity: 'device-root' });
  const focus = { activeElement: root };
  const { realm } = fixture({ pageGlobal: { dshDesktop: desktop, document: focus } });
  t.after(() => realm.dispose());
  realm.rootElement = root;
  const facade = realm.window.dshDesktop;
  assert.notEqual(facade, desktop);
  assert.equal(facade.extra, extra);
  assert.equal(facade.identity(), extra);
  assert.equal(desktop.keyboard, keyboard);
  const received = [];
  const off = facade.keyboard.subscribe(input => received.push(input));
  const callback = [...nativeCallbacks][0];
  callback('inactive');
  assert.deepEqual(received, []);
  assert.throws(() => facade.keyboard.closeWindow('inactive'), /active conversation/);
  realm.active = true;
  focus.activeElement = {};
  callback('wrong focus');
  assert.deepEqual(received, []);
  focus.activeElement = root;
  callback('device input');
  assert.deepEqual(received, ['device input']);
  await facade.keyboard.closeWindow('accepted-revision');
  assert.deepEqual(calls, ['accepted-revision']);
  off(); off();
  callback('late input after release');
  assert.deepEqual(received, ['device input']);
  assert.equal(releases, 1);
  facade.keyboard.subscribe(() => {});
  await realm.dispose();
  assert.equal(nativeCallbacks.size, 0);
  assert.equal(releases, 2);
  assert.throws(() => facade.keyboard.closeWindow('disposed'), error => error.name === 'AbortError');
});

test('external dispatcher mode skips private window/native keyboard input but preserves local document handlers', async t => {
  const windowAdded = [];
  const windowRemoved = [];
  const documentCallbacks = new Map();
  let nativeSubscriptions = 0;
  const root = Object.freeze({ identity: 'root' });
  const body = Object.freeze({ identity: 'host-body' });
  const doc = {
    activeElement: root, body,
    addEventListener(type, listener) { documentCallbacks.set(type, listener); },
    removeEventListener(type, listener) { if (documentCallbacks.get(type) === listener) documentCallbacks.delete(type); },
  };
  const keyboard = { subscribe() { nativeSubscriptions += 1; return () => {}; } };
  const pageGlobal = {
    document: doc, dshDesktop: { keyboard },
    addEventListener(type) { windowAdded.push(type); },
    removeEventListener(type) { windowRemoved.push(type); },
  };
  const { realm } = fixture({ pageGlobal, externalKeyboard: true });
  t.after(() => realm.dispose());
  realm.active = true;
  realm.rootElement = root;
  const off = realm.window.dshDesktop.keyboard.subscribe(() => { throw new Error('private native input must not subscribe'); });
  off();
  for (const type of ['keydown', 'keyup', 'keypress']) realm.window.addEventListener(type, () => {});
  realm.window.addEventListener('paste', () => {});
  assert.equal(nativeSubscriptions, 0);
  assert.deepEqual(windowAdded, ['paste']);
  let dismissed = 0;
  const dismiss = () => { dismissed += 1; };
  realm.document.addEventListener('keydown', dismiss);
  assert.ok(documentCallbacks.has('keydown'));
  documentCallbacks.get('keydown')({ target: root });
  documentCallbacks.get('keydown')({ target: {} });
  assert.equal(dismissed, 1);
  const portal = Object.freeze({ identity: 'device-portal' });
  const releasePortal = realm.registerPortalRoot(portal);
  realm.portalElement = portal;
  assert.equal(realm.document.body, portal);
  assert.equal(doc.body, body);
  documentCallbacks.get('keydown')({ target: portal });
  assert.equal(dismissed, 2);
  realm.active = false;
  documentCallbacks.get('keydown')({ target: portal });
  assert.equal(dismissed, 2);
  realm.document.removeEventListener('keydown', dismiss);
  assert.equal(documentCallbacks.has('keydown'), false);
  releasePortal();
  realm.portalElement = null;
  assert.equal(realm.document.body, body);
  await realm.dispose();
  assert.deepEqual(windowRemoved, ['paste']);
});

test('device locale, theme, and native window closing leave workbench presentation owned by the shell', async t => {
  const inserted = [];
  const makeElement = tagName => ({
    tagName, dataset: {}, children: [],
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.append(child); return child; },
    cloneNode() { return { ...makeElement(tagName), lang: this.lang }; },
    remove() {},
  });
  const document = {
    documentElement: { ...makeElement('html'), lang: 'en' },
    body: makeElement('body'),
    head: { appendChild(child) { inserted.push(child); return child; } },
    createElement: makeElement,
  };
  const { realm } = fixture({ externalKeyboard: true, pageGlobal: {
    document, dshDesktop: { keyboard: { closeWindow() { assert.fail('closed workbench'); } } },
  } });
  t.after(() => realm.dispose());
  realm.document.documentElement.lang = 'ja';
  realm.document.body.append(makeElement('sprite'));
  const theme = { ...makeElement('style'), dataset: { pluginCss: '@deepseek-ai/dsh-client-ui-theme/base.css' } };
  const feature = makeElement('style');
  assert.equal(realm.document.head.appendChild(theme), theme);
  assert.equal(realm.document.head.appendChild(feature), feature);
  assert.equal(document.documentElement.lang, 'en');
  assert.deepEqual(document.body.children, []);
  assert.deepEqual(inserted, [feature]);
  await realm.window.dshDesktop.keyboard.closeWindow('workbench-revision');
});

test('private shortcut adapter reads and edits public parent config without publishing device definitions to preload', async t => {
  let snapshot = { revision: 'accepted-parent', sequence: 1 };
  const listeners = new Set();
  const published = [];
  const edits = [];
  const recording = [];
  let rawReads = 0;
  let releases = 0;
  const config = {
    getSnapshot() { assert.equal(this, config); return snapshot; },
    subscribe(listener) {
      assert.equal(this, config);
      listeners.add(listener);
      return () => { releases += 1; listeners.delete(listener); };
    },
  };
  const shortcuts = {
    config,
    edit(...args) { assert.equal(this, shortcuts); edits.push(args); return Promise.resolve({ status: 'saved' }); },
    recording(...args) { assert.equal(this, shortcuts); recording.push(args); return Promise.resolve(); },
  };
  const preloadShortcuts = Object.freeze({
    get() { rawReads += 1; throw new Error('device definitions must not be sent to preload'); },
  });
  const desktop = Object.freeze({ shortcuts: preloadShortcuts });
  const { realm } = fixture({ pageGlobal: { dshDesktop: desktop }, shortcuts, externalKeyboard: true });
  t.after(() => realm.dispose());
  const adapter = realm.window.dshDesktop.shortcuts;
  assert.equal(await adapter.get([{ id: 'device-only-definition' }]), snapshot);
  assert.equal(rawReads, 0);
  const off = adapter.subscribe(value => published.push(value));
  const stale = [...listeners][0];
  snapshot = { revision: 'parent-next', sequence: 2 };
  for (const listener of listeners) listener();
  assert.deepEqual(published, [snapshot]);
  assert.deepEqual(await adapter.edit({ id: 'session.new' }, 'parent-next'), { status: 'saved' });
  await adapter.recording(false);
  assert.deepEqual(edits, [[{ id: 'session.new' }, 'parent-next']]);
  assert.deepEqual(recording, [[false]]);
  assert.equal(desktop.shortcuts, preloadShortcuts);
  off(); off(); stale();
  assert.deepEqual(published, [snapshot]);
  adapter.subscribe(() => {});
  await realm.dispose();
  assert.equal(releases, 2);
  assert.equal(listeners.size, 0);
  assert.equal(rawReads, 0);
});

test('selection fallback applies only to native main-selection snapshot stores and remains namespaced', async t => {
  const calls = [];
  const store = {
    createSnapshotStore(initial, options, ...rest) {
      assert.equal(this, store);
      calls.push({ initial, options, rest });
      return initial;
    },
  };
  const selection = Object.freeze({ sessionId: 'explicit-session' });
  const { realm } = fixture({ platform: { [STORE]: store }, initialSelection: selection });
  t.after(() => realm.dispose());
  const api = await realm.import(STORE);
  const options = Object.freeze({ persist: Object.freeze({ name: 'dsh.sessions.current' }) });
  assert.deepEqual(api.createSnapshotStore({}, options, 'rest'), selection);
  assert.notEqual(calls[0].initial, selection);
  assert.equal(calls[0].options.persist.name, `${realm.storagePrefix}dsh.sessions.current`);
  assert.deepEqual(calls[0].rest, ['rest']);
  assert.equal(options.persist.name, 'dsh.sessions.current');
  const unrelated = { draft: 'preserved' };
  assert.equal(api.createSnapshotStore(unrelated, { persist: { name: 'draft.current' } }), unrelated);
  realm.initialSelection = { sessionId: 'later-explicit-session' };
  assert.deepEqual(api.createSnapshotStore({}, options), { sessionId: 'later-explicit-session' });
  realm.initialSelection = undefined;
  const initial = {};
  assert.equal(api.createSnapshotStore(initial, options), initial);
});
