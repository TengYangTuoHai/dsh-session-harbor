import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createNativeRuntimeBroker } from './native-runtime-host.js';

const modulesId = '@deepseek-ai/dsh-client-modules';
const chatId = '@deepseek-ai/dsh-client-ui-chat';
const connectionId = 'connection-1';
const release = { version: '0.2.2-rc.3', commit: '6b729fe' };
function entry(id, options = {}) {
  return { id, rev: 'rev1', url: `plugins/??${id}/client.js&rev=rev1`, inject: [], external: [], ...options };
}
function graph(entries = [entry(modulesId), entry(chatId)], version = release) {
  return { rev: 'graph1', release: version, entries, batches: entries.map(row => ({ phase: row.id === modulesId ? 'bootstrap' : 'application', url: row.url, rev: row.rev, entries: [row.id] })) };
}
function html(globals) {
  return Object.entries(globals).map(([name, value]) => `<script>globalThis[${JSON.stringify(name)}] = ${JSON.stringify(value)};</script>`).join('\n');
}
function harness({ localGraph = graph(), remoteGraph = graph(), globals = {}, source, cache, build } = {}) {
  const calls = [];
  let state = { id: connectionId, status: 'connected' };
  const peer = { principal: { kind: 'owner' } };
  const resources = new Map();
  const ssh = {
    connectionFor(id) { calls.push(['connectionFor', id]); return id === 'target-1' ? state : undefined; },
    environments: {
      uiById: new Map(),
      async build(id, passedPeer) {
        calls.push(['build', id, passedPeer]);
        if (build) return build(id, passedPeer);
        if (cache) this.uiById.set(id, cache);
      },
    },
  };
  const bridge = {
    async readBootstrap(id) { calls.push(['bootstrap', id]); return html({ __DSH_BOOT__: remoteGraph, ...globals }); },
    describe(id) { calls.push(['bridge.describe', id]); return { namespace: 'safe-namespace' }; },
  };
  const webServer = {
    getOrigin: () => 'http://127.0.0.1:57548',
    collectIndexInjections(passedPeer) { calls.push(['injections', passedPeer]); return [{ kind: 'global', name: '__DSH_BOOT__', value: localGraph }]; },
    async readResource(request, passedPeer) {
      calls.push(['resource', new URL(request.url).pathname + new URL(request.url).search, passedPeer]);
      return resources.get(new URL(request.url).pathname + new URL(request.url).search)?.()
        ?? new Response(source ?? 'window.__ModuleLoader__.load({id:"fixture",factory(){return localStorage.getItem("draft")}});', { headers: { 'content-type': 'text/javascript; charset=utf-8' } });
    },
  };
  return {
    broker: createNativeRuntimeBroker({ ssh, bridge, webServer, connection: { browserPeer: peer } }),
    calls, ssh, bridge, webServer, resources, peer,
    setState(value) { state = value; },
  };
}

const resourceRequest = { connectionId, packageId: chatId, file: 'client.js' };

test('descriptor uses trusted official graph intersection and removes unavailable dependencies', async () => {
  const other = '@deepseek-ai/dsh-client-ui-other';
  const dependent = '@deepseek-ai/dsh-client-ui-dependent';
  const local = '@local/unsafe';
  const h = harness({
    localGraph: graph([entry(modulesId), entry(chatId, { external: ['react', '@deepseek-ai/dsh-client-ui-primitives'] }), entry(other), entry(dependent, { inject: [other] }), entry(local)]),
    remoteGraph: graph([entry(modulesId), entry(chatId), entry(dependent), entry(local)]),
    globals: {
      __DSH_LOCALE__: { language: 'en', token: 'hidden' },
      __DSH_REMOTE_ACCESS__: { type: 'baseline', owner: true },
      __DSH_TRANSPORT__: { rpc: 'remote-controlled' },
      __DSH_FILE_UPLOAD__: { path: 'wrong' },
      __DSH_HOST_PATHS__: { path: '/local/path' },
      __DSH_TOKEN__: 'hidden', __DSH_STORAGE__: { data: 'hidden' },
    },
  });
  const description = await h.broker.describe('target-1');
  assert.deepEqual(description.graph.entries.map(row => row.id), [modulesId, chatId]);
  assert.deepEqual(description.release, release);
  assert.equal(description.connectionId, connectionId);
  assert.equal(description.baseUrl, '/ssh/environment/connection-1/');
  assert.equal(description.namespace, 'safe-namespace');
  assert.match(description.runtimeKey, /^t3-[a-f0-9]{40}$/);
  assert.deepEqual(description.globals.__DSH_LOCALE__, { language: 'en' });
  for (const name of ['__DSH_TRANSPORT__', '__DSH_FILE_UPLOAD__', '__DSH_HOST_PATHS__', '__DSH_TOKEN__', '__DSH_STORAGE__']) assert.equal(description.globals[name], undefined);
  assert.deepEqual(description.globals.__DSH_BOOT__, description.graph);
  assert.equal(h.calls.some(([name]) => name === 'resource' || name === 'build'), false);
  description.graph.entries.length = 0;
  assert.equal((await h.broker.resource('target-1', resourceRequest)).status, 200, 'returned descriptors cannot mutate the broker authorization');
});

test('wrapped official source registers only in its lexical device realm', async () => {
  const h = harness({ source: 'window.__ModuleLoader__.load({id:"fixture",factory(){globalThis.selected=localStorage.getItem("draft");sessionStorage.setItem("seen","yes");return globalThis.selected;}});' });
  const descriptor = await h.broker.describe('target-1');
  const response = await h.broker.resource('target-1', resourceRequest);
  const registrations = [];
  const values = new Map([['draft', 'remote draft']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const realmGlobal = {};
  const realm = { window: { __ModuleLoader__: { load: value => registrations.push(value) } }, globalThis: realmGlobal, localStorage: storage, sessionStorage: storage };
  const outer = { __T3_DEVICE_REALMS__: new Map([[descriptor.runtimeKey, realm]]), selected: 'local selection' };
  vm.runInNewContext(await response.text(), outer);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].factory(), 'remote draft');
  assert.equal(realmGlobal.selected, 'remote draft');
  assert.equal(outer.selected, 'local selection');
  assert.equal(values.get('seen'), 'yes');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(h.calls.find(([name]) => name === 'resource').slice(1), [`/plugins/??${chatId}/client.js&rev=rev1`, h.peer]);
});

test('chunk resources stay in the prepared package and revision', async () => {
  const h = harness();
  await h.broker.describe('target-1');
  await h.broker.resource('target-1', { ...resourceRequest, file: 'client.editor-123.js' });
  assert.equal(h.calls.find(([name]) => name === 'resource')[1], `/plugins/${chatId}/client.editor-123.js?rev=rev1`);
  for (const input of [
    { file: '../client.js' }, { file: 'client.js?token=x' }, { file: 'client.node.js' },
    { file: 'client.server.js' }, { packageId: '@local/unsafe' },
    { packageId: '@deepseek-ai/missing' }, { packageId: '../escape' },
  ]) await assert.rejects(h.broker.resource('target-1', { ...resourceRequest, ...input }), { code: 't3-native/invalid-resource' });
  assert.equal(h.calls.filter(([name]) => name === 'resource').length, 1);
});

test('missing, unprepared, and replaced connections never load Client bytes', async () => {
  const h = harness();
  await assert.rejects(h.broker.resource('target-1', resourceRequest), { code: 't3-native/describe-required' });
  await h.broker.describe('target-1');
  h.setState({ id: 'connection-2', status: 'connected' });
  await assert.rejects(h.broker.resource('target-1', resourceRequest), { code: 't3-native/connection-changed' });
  h.setState(undefined);
  await assert.rejects(h.broker.describe('target-1'), { code: 't3-native/connection-changed' });
  assert.equal(h.calls.some(([name]) => name === 'resource'), false);
});

test('connection changes during preparation and resource reads are refused', async () => {
  const h = harness();
  const original = h.bridge.readBootstrap;
  h.bridge.readBootstrap = async id => { const result = await original(id); h.setState({ id: 'connection-2', status: 'connected' }); return result; };
  await assert.rejects(h.broker.describe('target-1'), { code: 't3-native/connection-changed' });
  h.setState({ id: connectionId, status: 'connected' });
  h.bridge.readBootstrap = original;
  await h.broker.describe('target-1');
  h.resources.set(`/plugins/??${chatId}/client.js&rev=rev1`, () => { h.setState({ id: 'connection-2', status: 'connected' }); return new Response('valid();', { headers: { 'content-type': 'application/javascript' } }); });
  await assert.rejects(h.broker.resource('target-1', resourceRequest), { code: 't3-native/connection-changed' });
});

test('cross release uses only the existing verified official cache', async () => {
  const oldRelease = { version: '0.2.2-rc.1', commit: 'c59d10a' };
  const cacheCalls = [];
  const cache = { version: oldRelease.version, graph: graph(undefined, oldRelease), async readResource(path) { cacheCalls.push(path); return new Response('window.__ModuleLoader__.load({id:"old-official"});', { headers: { 'content-type': 'text/javascript' } }); } };
  const h = harness({ remoteGraph: graph(undefined, oldRelease), cache });
  const descriptor = await h.broker.describe('target-1');
  assert.deepEqual(descriptor.release, oldRelease);
  const source = await (await h.broker.resource('target-1', resourceRequest)).text();
  assert.match(source, /old-official/);
  assert.equal(cacheCalls.length, 1);
  assert.equal(h.calls.some(([name]) => name === 'resource'), false);
  assert.deepEqual(h.calls.find(([name]) => name === 'build').slice(1), [connectionId, h.peer]);
  cache.readResource = async () => null;
  await assert.rejects(h.broker.resource('target-1', resourceRequest), { code: 't3-native/resource-unavailable' });
  assert.equal(h.calls.some(([name]) => name === 'resource'), false, 'a cache miss must not use another release from the local install');
});

test('missing or mismatched verified cache fails before any resource request', async () => {
  const oldRelease = { version: '0.2.2-rc.1', commit: 'c59d10a' };
  for (const cache of [undefined, { version: oldRelease.version, graph: graph(), readResource() {} }]) {
    const h = harness({ remoteGraph: graph(undefined, oldRelease), cache });
    await assert.rejects(h.broker.describe('target-1'), { code: 't3-native/unsupported-release' });
    assert.equal(h.calls.some(([name]) => name === 'resource'), false);
  }
});

test('resource response validates status, JavaScript MIME, UTF-8, and bounded size', async () => {
  const h = harness();
  await h.broker.describe('target-1');
  const path = `/plugins/??${chatId}/client.js&rev=rev1`;
  for (const [response, code] of [
    [() => new Response('no', { status: 404 }), 'resource-unavailable'],
    [() => new Response('<html/>', { headers: { 'content-type': 'text/html' } }), 'invalid-resource'],
    [() => new Response(new Uint8Array([255]), { headers: { 'content-type': 'text/javascript' } }), 'invalid-resource'],
    [() => new Response('small', { headers: { 'content-type': 'text/javascript', 'content-length': String(9 * 1024 * 1024) } }), 'resource-too-large'],
    [() => new Response(new Uint8Array(8 * 1024 * 1024 + 1), { headers: { 'content-type': 'text/javascript' } }), 'resource-too-large'],
  ]) {
    h.resources.set(path, response);
    await assert.rejects(h.broker.resource('target-1', resourceRequest), { code: 't3-native/' + code });
  }
});

test('old resource requests cannot invalidate a replacement runtime', async () => {
  const h = harness();
  await h.broker.describe('target-1');
  h.setState({ id: 'connection-2', status: 'connected' });
  const current = await h.broker.describe('target-1');
  await assert.rejects(h.broker.resource('target-1', resourceRequest), { code: 't3-native/connection-changed' });
  await assert.rejects(h.broker.resource('target-1', { ...resourceRequest, connectionId: current.connectionId, runtimeKey: 'obsolete' }), { code: 't3-native/connection-changed' });
  assert.equal((await h.broker.resource('target-1', { ...resourceRequest, connectionId: current.connectionId, runtimeKey: current.runtimeKey })).status, 200);
});

test('aborting a pending script read cancels its body', async () => {
  const h = harness();
  await h.broker.describe('target-1');
  const waiting = Promise.withResolvers();
  let reads = 0;
  let cancelled = false;
  h.resources.set(`/plugins/??${chatId}/client.js&rev=rev1`, () => new Response(new ReadableStream({
    pull(controller) {
      if (reads++ === 0) { controller.enqueue(new TextEncoder().encode('start;')); return; }
      waiting.resolve();
      return new Promise(() => {});
    },
    cancel() { cancelled = true; },
  }), { headers: { 'content-type': 'text/javascript' } }));
  const controller = new AbortController();
  const pending = h.broker.resource('target-1', { ...resourceRequest, signal: controller.signal });
  await waiting.promise;
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(cancelled, true);
});

test('aborting bootstrap preparation settles without waiting for the SSH bridge', async () => {
  const h = harness();
  const waiting = Promise.withResolvers();
  h.bridge.readBootstrap = () => waiting.promise;
  const controller = new AbortController();
  const pending = h.broker.describe('target-1', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  waiting.resolve(html({ __DSH_BOOT__: graph() }));
  await assert.rejects(h.broker.resource('target-1', resourceRequest), { code: 't3-native/describe-required' });
});

test('bootstrap parsing stays data-only and cancellation prevents remote reads', async () => {
  const h = harness();
  h.bridge.readBootstrap = async () => '<script>globalThis["__DSH_BOOT__"] = (() => { throw new Error("must not execute") })();</script>';
  await assert.rejects(h.broker.describe('target-1'), { code: 't3-native/invalid-bootstrap' });
  const aborted = new AbortController();
  aborted.abort();
  const clean = harness();
  await assert.rejects(clean.broker.describe('target-1', { signal: aborted.signal }), { name: 'AbortError' });
  assert.equal(clean.calls.length, 0);
});
