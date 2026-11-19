import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { apply, createNativeResourceHandler } from './index.js';
import { REMOTE_INDEX_DOMAIN } from './remote-index.js';
import { SshService } from './ssh/ssh-service.js';
import { RemoteBridge } from './ssh/remote-bridge.js';

async function fixture(options = {}) {
  const listeners = new Map();
  const effects = [];
  const records = new Map();
  const domains = options.domains ?? new Map();
  const pinned = new Set();
  const routes = new Map();
  const injected = [];
  let tool;
  const emit = (name, ...args) => { for (const fn of [...(listeners.get(name) ?? [])]) fn(...args); };
  const ctx = {
    get: name => options.services?.[name],
    effect(fn) { effects.push(fn()); },
    on(name, fn) {
      const list = listeners.get(name) ?? [];
      list.push(fn);
      listeners.set(name, list);
      return () => listeners.set(name, list.filter(entry => entry !== fn));
    },
    inject(deps, callback) {
      const missing = deps.filter(name => options.services?.[name] === undefined);
      injected.push({ deps, missing });
      if (missing.length) return;
      const host = { ...ctx, ...options.services };
      callback(host);
    },
    storageDomain: { async open(spec) {
      const tables = domains.get(spec.name) ?? {};
      domains.set(spec.name, tables);
      return {
        table(name) {
          const data = spec.name === 'local_t3_session_sidebar' ? records : (tables[name] ??= new Map());
          return {
            get: id => data.get(id),
            entries: () => data.entries(),
            async delete(id) {
              if (data.delete(id)) emit('domain/changed', { domain: spec.name, table: name, key: id, operation: 'delete' });
            },
            async put(id, value) { data.set(id, value); emit('domain/changed', { domain: spec.name, table: name, key: id, operation: 'put', value }); },
          };
        },
        async close() {},
      };
    } },
    workspaceRegistry: {
      async pinSession(id) { pinned.add(id); },
      async unpinSession(id) { pinned.delete(id); },
    },
    workspaceController: { async *follow() { yield { type: 'baseline', value: { pinnedSessionIds: [...pinned], archivedSessionIds: [] } }; } },
    sessionController: { async list(_request, signal) { if (tool) await options.inspect?.('valid', signal); return { items: [{ sessionId: 'valid', running: true, blank: false }] }; } },
    connection: { fetch: { register(route) { routes.set(route.path, route); return async () => routes.delete(route.path); } } },
    tools: { register(definition) { tool = definition; } },
  };
  await apply(ctx);
  async function call(endpoint, payload, signal) {
    const route = routes.get(`/api/${endpoint}`);
    assert.deepEqual(route.methods, ['POST']);
    assert.equal(route.requestBody, 'buffered');
    const request = new Request(`http://localhost/api/${endpoint}`, { method: 'POST', signal, body: JSON.stringify({ type: 'client-request', rpcId: 'test-id', method: endpoint, payload }) });
    const response = await route.fetch(request);
    const envelope = await response.json();
    assert.equal(envelope.rpcId, 'test-id');
    assert.equal(envelope.type, 'server-response');
    return envelope.result;
  }
  return { routes, call, tool, pinned, records, emit, async close() { for (const cleanup of effects.reverse()) await cleanup?.(); } };
}

const signal = () => new AbortController().signal;

test('local folder requests use the local browse capability without SSH and validate folder names', async () => {
  const calls = [];
  const browser = {
    kind: 'browse',
    async list(path, signal) { calls.push([path, signal.aborted]); return { path: path ?? '/fixture', entries: [] }; },
    async createDirectory(path, name) { calls.push([path, name]); return `${path}/${name}`; },
  };
  const f = await fixture({ services: { directoryPicker: { capability: () => browser } } });
  try {
    assert.deepEqual(await f.call('t3-project-directory/list', {}, signal()), { ok: true, value: { path: '/fixture', entries: [] } });
    assert.deepEqual(await f.call('t3-project-directory/create', { path: '/fixture', name: 'New folder' }, signal()), { ok: true, value: '/fixture/New folder' });
    const route = f.routes.get('/api/t3-project-directory/create');
    for (const name of ['..', 'a/b', 'a\\b', 'a\0b']) {
      const response = await route.fetch(new Request('http://localhost/api/t3-project-directory/create', {
        method: 'POST', body: JSON.stringify({ type: 'client-request', rpcId: 'test-id', method: 't3-project-directory/create', payload: { path: '/fixture', name } }),
      }));
      assert.equal(response.status, 400);
    }
    const cancelled = await f.call('t3-project-directory/list', {}, AbortSignal.abort());
    assert.equal(cancelled.ok, false);
    assert.deepEqual(calls, [[undefined, false], ['/fixture', 'New folder']]);
  } finally { await f.close(); }
});

test('requests retain arrival order and cancelled queued requests do not write', async () => {
  let release;
  let entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  let inspections = 0;
  const f = await fixture({ inspect: async () => { if (++inspections === 1) { entered(); await gate; } } });
  try {
    const first = f.call('t3-session-sidebar/action', { sessionId: 'valid', action: 'settle' }, signal());
    await started;
    const second = f.call('t3-session-sidebar/action', { sessionId: 'valid', action: 'pin' }, signal());
    const abort = new AbortController();
    const third = f.call('t3-session-sidebar/action', { sessionId: 'valid', action: 'settle' }, abort.signal);
    await new Promise(resolve => setImmediate(resolve));
    abort.abort();
    release();
    assert.equal((await first).ok, true);
    assert.equal((await second).ok, true);
    assert.equal((await third).ok, false);
    assert.equal(f.pinned.has('valid'), true);
    assert.equal(f.records.get('valid').settled, false);
    assert.equal(inspections, 2);
  } finally { release(); await f.close(); }
});

test('actions persist settled independently of archive and use the same tool path', async () => {
  const f = await fixture();
  try {
    let result = await f.call('t3-session-sidebar/action', { sessionId: 'valid', action: 'settle' }, signal());
    assert.equal(result.ok, true);
    assert.equal(f.records.get('valid').settled, true);
    await f.tool.execute({ sessionId: 'valid', action: 'pin' });
    assert.equal(f.records.get('valid').settled, false);
    assert.equal(f.pinned.has('valid'), true);
    result = await f.call('t3-session-sidebar/action', { sessionId: 'valid', action: 'bad' }, signal());
    assert.equal(result.ok, false);
    assert.equal((await f.call('t3-session-sidebar/action', { sessionId: 'missing', action: 'settle' }, signal())).ok, false);
    const bad = new Request('http://localhost/api/t3-session-sidebar/action', { method: 'POST', body: JSON.stringify({ type: 'invalid' }) });
    assert.equal((await f.routes.get('/api/t3-session-sidebar/action').fetch(bad)).status, 400);
  } finally { await f.close(); }
});

test('a machine reports its own liveness, and a held snapshot carries it out', async () => {
  const f = await fixture();
  try {
    const initial = await f.call('t3-session-sidebar/snapshot', {}, signal());
    assert.deepEqual(initial.value.statuses, {});
    const held = f.call('t3-session-sidebar/snapshot', { epoch: initial.value.epoch, revision: initial.value.revision }, signal());
    f.emit('api-session/status', 'valid', true);
    const changed = await held;
    assert.equal(changed.value.statuses.valid, true);
    assert.ok(changed.value.revision > initial.value.revision);
    f.emit('api-session/removed', 'valid');
    assert.deepEqual((await f.call('t3-session-sidebar/snapshot', {}, signal())).value.statuses, {});
  } finally {
    await f.close();
  }
});
test('snapshot long poll wakes after durable placement changes and aborts cleanly', async () => {
  const f = await fixture();
  try {
    const initial = await f.call('t3-session-sidebar/snapshot', {}, signal());
    const pending = f.call('t3-session-sidebar/snapshot', { epoch: initial.value.epoch, revision: initial.value.revision }, signal());
    await f.tool.execute({ sessionId: 'valid', action: 'settle' });
    const changed = await pending;
    assert.equal(changed.value.revision, initial.value.revision + 1);
    assert.equal(changed.value.placements.valid.settled, true);
    const abort = new AbortController();
    const cancelled = f.call('t3-session-sidebar/snapshot', { epoch: changed.value.epoch, revision: changed.value.revision }, abort.signal);
    await new Promise(resolve => setImmediate(resolve));
    abort.abort();
    assert.equal((await cancelled).ok, false);
  } finally { await f.close(); }
});

test('the remote mirror is empty without a Web host', async () => {
  const f = await fixture();
  try {
    const result = await f.call('t3-remote/snapshot', {}, signal());
    assert.equal(result.ok, true);
    assert.equal(result.value.contract, 1);
    assert.deepEqual([result.value.targets, result.value.workspaces, result.value.sessions], [{}, {}, {}]);
    assert.ok(result.value.epoch);
    assert.equal(result.value.revision, 0);
  } finally { await f.close(); }
});

function remoteDevice(t, state, bridge) {
  t.mock.method(SshService.prototype, 'initialize', async function () {
    this.targets.set(state.targetId, { id: state.targetId, host: state.host, label: state.label, cwd: '', dshPath: 'dsh', profile: 'web' });
    this.manager = {
      list: () => [state], get: id => id === state.id ? state : undefined,
      getOpenUrl() { assert.fail('fixture should not use the network'); },
      onChange: () => () => {}, async dispose() {},
    };
  });
  Object.assign(state, { cwd: '', dshPath: 'dsh', profile: 'web' });
  t.mock.method(SshService.prototype, 'startAutoConnect', () => {});
  for (const [name, method] of Object.entries(bridge)) t.mock.method(RemoteBridge.prototype, name, method);
  const peer = { principal: { kind: 'owner' } };
  return {
    connection: { browserPeer: peer, admit: () => ({ peer }) },
    webServer: { register: () => () => {}, registerUpgrade: () => () => {}, collectIndexInjections: () => [], readResource() {} },
  };
}

test('a connected machine is mirrored into the remote snapshot route', async t => {
  const connection = { id: 'conn-1', targetId: 'target-1', status: 'connected', host: 'wsl', label: 'wsl' };
  const services = remoteDevice(t, connection, {
    readBootstrap: async () => '{"version":"0.2.2-rc.1","commit":"c59d10a"}',
    upgrade: async () => { throw new Error('streams are unavailable here'); },
    async requestJson(id, path, envelope) {
      if (path === '/api/session/list') return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { items: [{ sessionId: 's-1', updatedAt: 7, running: false, blank: false, agentAvailable: true, cwd: '/home/dev', projections: { kind: 'cached', values: { title: 'Deploy fix' } } }] } } } };
      if (path === '/api/t3-session-sidebar/snapshot') return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { contract: 1, epoch: 'remote-epoch', revision: 4, placements: { 's-1': { settled: true, settledAt: 1, unsettledAt: null } } } } } };
      return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: false, error: { code: 'gateway/unknown', message: 'no such route', details: {} } } } };
    },
  });
  const f = await fixture({ services });
  try {
    let value;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      value = (await f.call('t3-remote/snapshot', {}, signal())).value;
      if (value.targets['target-1']?.status === 'stale' && value.targets['target-1']?.release && value.targets['target-1']?.pluginContract === 1 && value.sessions['target-1/s-1']?.settled) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(value.targets['target-1'].status, 'stale');
    assert.match(value.targets['target-1'].lastError, /stream|workspace|project/i, 'failed live subscriptions must remain visible');
    assert.deepEqual(value.targets['target-1'].release, { version: '0.2.2-rc.1', commit: 'c59d10a' });
    assert.equal(value.targets['target-1'].pluginContract, 1);
    assert.equal(value.sessions['target-1/s-1'].displayTitle, 'Deploy fix');
    assert.equal(value.sessions['target-1/s-1'].settled, true, 'the owning machine decides placement');
    assert.ok(value.revision > 0, 'mirror writes advance the revision');
  } finally { await f.close(); }
});

test('the remote snapshot long poll wakes when the mirror changes', async t => {
  const connection = { id: 'conn-1', targetId: 'target-1', status: 'connected', host: 'wsl', label: 'wsl' };
  const f = await fixture({ services: remoteDevice(t, connection, {
    readBootstrap: async () => '{"version":"1.2.3","commit":"abc"}',
    upgrade: async () => { throw new Error('no streams here'); },
    async requestJson(id, path, envelope) {
      const value = path === '/api/session/list' ? { items: [] } : { contract: 1, epoch: 'e', revision: 0, placements: {} };
      return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value } } };
    },
  }) });
  try {
    let value;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      value = (await f.call('t3-remote/snapshot', {}, signal())).value;
      if (value.targets['target-1']?.status === 'stale' && value.targets['target-1']?.release && value.targets['target-1']?.pluginContract === 1) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    assert.equal(value.targets['target-1'].status, 'stale');
    assert.match(value.targets['target-1'].lastError, /stream|workspace|project/i, 'failed live subscriptions must remain visible');
    // A cursor behind the mirror answers at once; a current cursor waits.
    const behind = await f.call('t3-remote/snapshot', { epoch: value.epoch, revision: 0 }, signal());
    assert.equal(behind.ok, true);
    assert.ok(behind.value.revision >= value.revision, 'later changes may advance the mirror while a stale cursor is served');
    const abort = new AbortController();
    const pending = f.call('t3-remote/snapshot', { epoch: behind.value.epoch, revision: behind.value.revision }, abort.signal);
    await new Promise(resolve => setImmediate(resolve));
    abort.abort();
    let cancelled = await pending;
    if (cancelled.ok) {
      assert.ok(cancelled.value.revision > behind.value.revision, 'a concurrent durable update may win the cancellation race');
      cancelled = await f.call('t3-remote/snapshot', { epoch: cancelled.value.epoch, revision: cancelled.value.revision }, abort.signal);
    }
    assert.equal(cancelled.ok, false, 'a current cursor waits until something changes or the caller leaves');
    assert.match(cancelled.error.message, /cancelled/i);
  } finally { await f.close(); }
});

test('the machine doors validate, wait for the SSH service, and write through it', async t => {
  const bare = await fixture();
  try {
    const refused = await bare.call('t3-remote/browse', { targetId: 'target-1' }, signal());
    assert.equal(refused.ok, false);
    assert.equal(refused.error.code, 't3-remote/plugin-unavailable');
  } finally { await bare.close(); }

  const connection = { id: 'conn-1', targetId: 'target-1', status: 'connected', host: 'wsl', label: 'wsl' };
  const seen = [];
  const services = remoteDevice(t, connection, {
    readBootstrap: async () => '{"version":"0.2.2-rc.1","commit":"c59d10a"}',
    upgrade: async () => { throw new Error('streams are unavailable here'); },
    async requestJson(id, path, envelope) {
      seen.push(path);
      const args = envelope.payload.args;
      if (path === '/api/session/list') return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { items: [] } } } };
      if (path === '/api/t3-session-sidebar/snapshot') return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { contract: 1, epoch: 'remote-epoch', revision: 4, placements: {} } } } };
      // The plugin's own endpoints carry their body at the payload root, not under args.
      if (path === '/api/t3-session-sidebar/action') return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { sessionId: envelope.payload.sessionId, action: envelope.payload.action } } } };
      if (path === '/api/directoryPicker/list') return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { path: args.path, home: '/home/dev', crumbs: [], entries: [{ name: 'app', path: '/home/dev/app', hidden: false }], truncated: false } } } };
      if (path === '/api/workspace/create') return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { workspace: { workspaceId: 'w-new', path: args.request.path, title: 'app', sessionIds: [], createdAt: '', updatedAt: '' }, created: true } } } };
      if (path === '/api/workspace/delete') return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { deleted: true } } } };
      if (path === '/api/session/rename') return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { title: args.request.title, seq: 3 } } } };
      if (path === '/api/session/fork') return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { sessionId: 'forked-session' } } } };
      if (path === '/api/workspace/archiveSession') return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value: { archivedSessionIds: [args.request.sessionId] } } } };
      return { status: 200, headers: {}, value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: false, error: { code: 'gateway/unknown', message: 'no such route', details: {} } } } };
    },
  });
  const f = await fixture({ services });
  try {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const value = (await f.call('t3-remote/snapshot', {}, signal())).value;
      if (value.targets['target-1']?.status === 'stale' && value.targets['target-1']?.release && value.targets['target-1']?.pluginContract === 1) break;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    const browse = await f.call('t3-remote/browse', { targetId: 'target-1', path: '/home/dev' }, signal());
    assert.deepEqual(browse.value.listing.entries.map(entry => entry.path), ['/home/dev/app']);
    const created = await f.call('t3-remote/workspace-create', { targetId: 'target-1', path: '/home/dev/app' }, signal());
    assert.deepEqual([created.value.workspace.workspaceId, created.value.workspace.path], ['w-new', '/home/dev/app']);

    // The one irreversible write has to arrive with its confirmation.
    const unconfirmed = await f.call('t3-remote/workspace-delete', { targetId: 'target-1', workspaceId: 'w-new' }, signal());
    assert.equal(unconfirmed.ok, false);
    assert.ok(!seen.includes('/api/workspace/delete'), 'an unconfirmed delete never reaches the machine');
    const deleted = await f.call('t3-remote/workspace-delete', { targetId: 'target-1', workspaceId: 'w-new', confirmed: true }, signal());
    assert.equal(deleted.value.deleted, true);

    // Pin and settle are the machine's own state, so the door only forwards them.
    const settled = await f.call('t3-remote/action', { targetId: 'target-1', sessionId: 's-1', action: 'settle' }, signal());
    assert.deepEqual([settled.value.done.sessionId, settled.value.done.action], ['s-1', 'settle']);
    assert.ok(seen.includes('/api/t3-session-sidebar/action'));
    const renamed = await f.call('t3-remote/session-command', { targetId: 'target-1', sessionId: 's-1', action: 'rename', title: '  New title  ' }, signal());
    assert.deepEqual(renamed.value, { done: true });
    const forked = await f.call('t3-remote/session-command', { targetId: 'target-1', sessionId: 's-1', action: 'fork' }, signal());
    assert.deepEqual(forked.value, { sessionId: 'forked-session' });
    const archived = await f.call('t3-remote/session-command', { targetId: 'target-1', sessionId: 's-1', action: 'archive' }, signal());
    assert.deepEqual(archived.value, { done: true });
    const writes = seen.filter(path => path === '/api/session/rename').length;
    const invalidTitle = await f.call('t3-remote/session-command', { targetId: 'target-1', sessionId: 's-1', action: 'rename', title: '   ' }, signal());
    assert.equal(invalidTitle.ok, false);
    assert.equal(seen.filter(path => path === '/api/session/rename').length, writes, 'invalid commands never reach a device');
    // A verb the placement model does not have never reaches the machine.
    const badVerb = await f.call('t3-remote/action', { targetId: 'target-1', sessionId: 's-1', action: 'delete' }, signal());
    assert.equal(badVerb.ok, false);

    // A directory name is one segment, so a path in the name never gets through.
    const badName = await f.call('t3-remote/create-directory', { targetId: 'target-1', path: '/home/dev', name: 'nested/app' }, signal());
    assert.equal(badName.ok, false);
    assert.ok(!seen.includes('/api/directoryPicker/createDirectory'));
    const unknownField = await f.call('t3-remote/workspace-create', { targetId: 'target-1', path: '/home/dev/app', force: true }, signal());
    assert.equal(unknownField.ok, false);
  } finally { await f.close(); }
});

function httpFixture(url, method = 'GET') {
  const req = Object.assign(new EventEmitter(), { url, method });
  const res = Object.assign(new EventEmitter(), {
    writableEnded: false, destroyed: false, status: null, body: null, headers: null,
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body) { this.body = body; this.writableEnded = true; },
  });
  return { req, res };
}

test('SSH settings persist saved devices and prune only orphaned mirrors at startup', async t => {
  // Keep the real storage and initialization path while leaving the saved host offline.
  t.mock.method(SshService.prototype, 'startAutoConnect', () => {});
  const savedDevice = { id: 't3-wsl', host: 'wsl', label: 'T3 WSL', cwd: '', dshPath: 'dsh', profile: 'web' };
  const cachedTargets = new Map(['old-wsl', 't3-wsl'].map(targetId => [targetId, {
    targetId, label: 'wsl', host: 'wsl', kind: 'wsl', release: null, pluginContract: null,
    status: 'ready', lastSyncAt: 3, lastError: null,
  }]));
  const cachedWorkspaces = new Map(['old-wsl', 't3-wsl', 'orphan'].map(targetId => [targetId + '/w-1', { targetId, workspaceId: 'w-1' }]));
  const cachedSessions = new Map(['old-wsl', 't3-wsl', 'orphan'].map(targetId => [targetId + '/s-1', { targetId, sessionId: 's-1' }]));
  const domains = new Map([
    [REMOTE_INDEX_DOMAIN, { targets: cachedTargets, workspaces: cachedWorkspaces, sessions: cachedSessions }],
    ['local_t3_ssh', { targets: new Map([[savedDevice.id, savedDevice]]) }],
  ]);
  const routes = new Map();
  const peer = { principal: { kind: 'owner' } };
  const f = await fixture({ domains, services: {
    connection: { browserPeer: peer, admit: req => req.admission ?? { peer } },
    webServer: {
      register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path); },
      registerUpgrade() { assert.fail('no fixture device should connect'); },
      collectIndexInjections() { return []; },
      readResource() { assert.fail('no fixture should load a resource'); },
    },
  } });
  try {
    const settings = routes.get('/api/t3-ssh');
    assert.equal(typeof settings, 'function');
    const callSettings = async (input, admission) => {
      const method = input === undefined ? 'GET' : 'POST';
      const { req, res } = httpFixture('/api/t3-ssh', method);
      const request = Object.assign(Readable.from(input === undefined ? [] : [JSON.stringify(input)]), {
        url: req.url, method, admission, headers: { 'content-type': 'application/json' },
      });
      await settings(request, res);
      return { status: res.status, body: JSON.parse(res.body) };
    };
    assert.equal((await callSettings(undefined, { rejection: 401 })).status, 401);
    assert.equal((await callSettings(undefined, { peer: { principal: { kind: 'guest' } } })).status, 403);
    for (let attempt = 0; !routes.has('/t3-remote/ssh') && attempt < 50; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    const initialSettings = await callSettings();
    assert.equal(initialSettings.status, 200);
    assert.deepEqual(initialSettings.body.targets, [savedDevice]);
    const { value } = await f.call('t3-remote/snapshot', {}, signal());
    assert.deepEqual(Object.keys(value.targets), ['t3-wsl']);
    assert.equal(value.targets['t3-wsl'].status, 'down');
    assert.deepEqual([...cachedTargets.keys()], ['t3-wsl']);
    assert.deepEqual([...cachedWorkspaces.keys()], ['t3-wsl/w-1']);
    assert.deepEqual([...cachedSessions.keys()], ['t3-wsl/s-1']);
    assert.deepEqual(Object.keys(value.workspaces), ['t3-wsl/w-1']);
    assert.deepEqual(Object.keys(value.sessions), ['t3-wsl/s-1']);
    const saved = await callSettings({ action: 'save', target: { host: 'fixture.invalid', label: 'Fixture' } });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.target.label, 'Fixture');
    const { id } = saved.body.target;
    assert.deepEqual((await callSettings()).body.targets, [savedDevice, saved.body.target]);
    assert.equal((await callSettings({ action: 'save', target: { host: 'fixture.invalid' } })).body.target.id, id);
    assert.equal((await callSettings({ action: 'environment', id })).status, 400);
    const proxy = routes.get('/t3-remote/ssh');
    const { req, res } = httpFixture('/t3-remote/ssh/conn-1/');
    await proxy(req, res);
    assert.equal(res.status, 404);
    assert.equal(res.headers.location, undefined);
    assert.equal(routes.has('/ssh/environment'), false);
    assert.deepEqual((await callSettings({ action: 'remove', id })).body, { removed: true });
    assert.deepEqual((await callSettings()).body.targets, [savedDevice]);
  } finally { await f.close(); }
  assert.equal(routes.size, 0);
});

test('native Client resources require the local owner and never dispatch rejected requests', async () => {
  let calls = 0;
  const broker = { resource: async () => { calls++; return new Response('trusted'); } };
  for (const [admission, status] of [
    [{ rejection: 401 }, 401],
    [{ peer: { principal: { kind: 'guest' } } }, 403],
  ]) {
    const { req, res } = httpFixture('/t3-remote/native/target-1');
    await createNativeResourceHandler({ admit: () => admission }, () => broker)(req, res);
    assert.equal(res.status, status);
  }
  assert.equal(calls, 0);
});

test('native Client resources carry device, connection and runtime identities without a page redirect', async () => {
  const seen = [];
  const handler = createNativeResourceHandler({ admit: () => ({ peer: { principal: { kind: 'owner' } } }) }, () => ({
    async resource(targetId, args) {
      seen.push([targetId, args]);
      return new Response('trusted factory', { headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' } });
    },
  }));
  const { req, res } = httpFixture('/t3-remote/native/target-1?connectionId=conn-1&packageId=%40deepseek-ai%2Fdsh-client-ui-chat&file=client.chat.js&runtimeKey=realm-1');
  await handler(req, res);
  assert.equal(res.status, 200);
  assert.equal(res.body.toString(), 'trusted factory');
  assert.equal(res.headers.location, undefined);
  const [targetId, args] = seen[0];
  assert.equal(targetId, 'target-1');
  assert.deepEqual([args.connectionId, args.packageId, args.file, args.runtimeKey], ['conn-1', '@deepseek-ai/dsh-client-ui-chat', 'client.chat.js', 'realm-1']);
  assert.equal(args.signal.aborted, false);
  assert.equal(req.listenerCount('aborted'), 0);
  assert.equal(res.listenerCount('close'), 0);
});

test('native Client resource failures cannot return another device or local application code', async () => {
  const connection = { admit: () => ({ peer: { principal: { kind: 'owner' } } }) };
  const stale = createNativeResourceHandler(connection, () => ({ resource: async () => { throw new Error('SSH connection changed'); } }));
  const failed = httpFixture('/t3-remote/native/target-1?connectionId=old-connection');
  await stale(failed.req, failed.res);
  assert.equal(failed.res.status, 409);
  assert.match(failed.res.body, /connection changed/);
  const absent = httpFixture('/t3-remote/native/target-1');
  await createNativeResourceHandler(connection, () => null)(absent.req, absent.res);
  assert.equal(absent.res.status, 503);
  const invalid = httpFixture('/t3-remote/native/target-1/extra');
  await stale(invalid.req, invalid.res);
  assert.equal(invalid.res.status, 400);
});

test('native runtime requests validate their device scope and report unavailable composition', async () => {
  const f = await fixture();
  try {
    const missing = await f.call('t3-remote/runtime', { targetId: 'target-1' }, signal());
    assert.equal(missing.ok, false);
    assert.equal(missing.error.code, 't3-remote/plugin-unavailable');
    const escaped = await f.call('t3-remote/runtime', { targetId: '../other' }, signal());
    assert.equal(escaped.ok, false);
    const extra = await f.call('t3-remote/runtime', { targetId: 'target-1', enter: true }, signal());
    assert.equal(extra.ok, false);
  } finally { await f.close(); }
});
