#!/usr/bin/env node
/**
 * Real installed Cordis + Storage + storage-domain lifecycle verification.
 * Run: node tools/verify-host-lifecycle.mjs
 * Re-executes the installed Electron in Node mode with strict rejection handling.
 * Only the KV medium and Host/SSH protocol edges are fixtures; Context, fibers,
 * injection/disposal, Storage, DomainFacility, DomainImpl and repository plugins
 * are real. No profile, GUI, filesystem storage, network or SSH process is used.
 */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mock } from 'node:test';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!process.versions.electron || !process.execArgv.includes('--unhandled-rejections=strict')) {
  assert.ok(process.env.DSH_NODE_EXECUTABLE, 'DSH_NODE_EXECUTABLE must identify the installed Electron executable');
  const result = spawnSync(process.env.DSH_NODE_EXECUTABLE,
    ['--unhandled-rejections=strict', fileURLToPath(import.meta.url)], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit',
    });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
assert.ok(process.env.DSH_INSTALL_DIR, 'DSH_INSTALL_DIR is required to resolve the installed public SDK');
const installedRequire = createRequire(`${process.env.DSH_INSTALL_DIR}/package.json`);
const load = id => import(pathToFileURL(installedRequire.resolve(id)).href);
const [{ Context, Logger }, { default: Storage, storageBackendServiceKey, StorageError }, domainModule] = await Promise.all([
  load('@deepseek-ai/cordis'), load('@deepseek-ai/dsh-storage'), load('@deepseek-ai/dsh-storage-domain'),
]);
const runtimeVersion = installedRequire('@deepseek-ai/dsh/package.json').version;
assert.equal(installedRequire('@deepseek-ai/dsh-storage-domain/package.json').version, runtimeVersion);
const plugin = await import('../t3-session-sidebar/index.js');
const { SshService } = await import('../t3-session-sidebar/ssh/ssh-service.js');
const { RemoteBridge } = await import('../t3-session-sidebar/ssh/remote-bridge.js');
const { createRemoteIndex, remoteIndexSpec, REMOTE_INDEX_DOMAIN } = await import('../t3-session-sidebar/remote-index.js');
const turn = () => new Promise(resolve => setImmediate(resolve));
const workspace = { workspaceId: 'fixture-workspace', path: '/fixture/project', title: 'Fixture', sessionIds: ['fixture-session'] };
const baseline = { items: [workspace], pinnedSessionIds: [], archivedSessionIds: [] };
const state = { id: 'fixture-connection', targetId: 'fixture-target', status: 'connected', host: 'fixture.invalid', label: 'Fixture', cwd: '', dshPath: 'dsh', profile: 'web' };

function memoryBackend(events) {
  const snapshots = new Map();
  const units = new Map();
  return {
    snapshots, units,
    kv: {
      async open(descriptor) {
        assert.ok(!units.has(descriptor.name), `unit opened twice: ${descriptor.name}`);
        const data = snapshots.get(descriptor.name) ?? {
          tables: Object.fromEntries(descriptor.tables.map(table => [table, {}])), global: null,
        };
        snapshots.set(descriptor.name, data);
        let closed = false;
        let closing;
        const check = () => { if (closed) throw new StorageError('closed', 'Fixture KV unit is closed'); };
        const mutate = async operation => { check(); await turn(); check(); operation(); };
        const unit = {
          async loadAll() { check(); return structuredClone(data); },
          putRecord: (table, key, value) => mutate(() => { data.tables[table][key] = structuredClone(value); }),
          deleteRecord: (table, key) => mutate(() => { delete data.tables[table][key]; }),
          deleteRecords: (table, keys) => mutate(() => { for (const key of keys) delete data.tables[table][key]; }),
          setGlobal: value => mutate(() => { data.global = structuredClone(value); }),
          close() {
            return closing ??= (async () => {
              closed = true;
              await turn();
              events.push({ type: 'unit-close', domain: descriptor.name });
              units.delete(descriptor.name);
            })();
          },
        };
        units.set(descriptor.name, unit);
        return unit;
      },
    },
    async close() { await Promise.all([...units.values()].map(unit => unit.close())); },
  };
}

function serverFrame(value) {
  const data = Buffer.from(JSON.stringify(value));
  assert.ok(data.length < 65536, 'fixture frame cap');
  const header = Buffer.alloc(data.length < 126 ? 2 : 4);
  header[0] = 0x81;
  if (header.length === 2) header[1] = data.length;
  else { header[1] = 126; header.writeUInt16BE(data.length, 2); }
  return Buffer.concat([header, data]);
}
class ProtocolSocket extends EventEmitter {
  constructor(events) { super(); this.events = events; this.ended = false; this.destroyed = false; }
  write(bytes) {
    assert.equal(bytes[0] & 0x80, 0x80, 'complete client frame');
    assert.equal(bytes[1] & 0x80, 0x80, 'masked client frame');
    let length = bytes[1] & 0x7f;
    let offset = 2;
    if (length === 126) { length = bytes.readUInt16BE(2); offset = 4; }
    assert.notEqual(length, 127, 'bounded fixture frame');
    const mask = bytes.subarray(offset, offset + 4);
    const data = Buffer.from(bytes.subarray(offset + 4));
    assert.equal(data.length, length);
    for (let index = 0; index < length; index++) data[index] ^= mask[index & 3];
    const opcode = bytes[0] & 0xf;
    if (opcode === 8) { this.events.push({ type: 'client-close-frame' }); return true; }
    assert.equal(opcode, 1);
    const frame = JSON.parse(data.toString('utf8'));
    if (frame.type === 'open') {
      assert.equal(frame.endpoint, 'workspace/follow');
      this.emit('data', serverFrame({ type: 'item', streamId: frame.streamId, value: { type: 'baseline', value: baseline } }));
    } else assert.equal(frame.type, 'cancel');
    return true;
  }
  end() { if (!this.ended) { this.ended = true; this.events.push({ type: 'client-close' }); } }
  destroy() { if (!this.destroyed) { this.destroyed = true; this.emit('close'); } }
}
function bridgeFixture(events) {
  const sockets = [];
  return {
    sockets,
    async readBootstrap(id) { assert.equal(id, state.id); return '<script>globalThis["__DSH_BOOT__"]={"release":{"version":"0.2.2-rc.3","commit":"fixture"}}</script>'; },
    async requestJson(id, path, envelope, { signal } = {}) {
      assert.equal(id, state.id);
      signal?.throwIfAborted();
      let value;
      if (path === '/api/session/list') value = { items: [{ sessionId: 'fixture-session', updatedAt: 123, running: false, blank: false,
        agentAvailable: true, cwd: workspace.path, projections: { values: { title: 'Fixture session' } } }] };
      else if (path === '/api/t3-session-sidebar/snapshot') {
        if (envelope.payload.epoch) {
          await new Promise((resolve, reject) => {
            const abort = () => reject(signal.reason ?? new Error('Fixture long poll cancelled'));
            signal.addEventListener('abort', abort, { once: true });
            if (signal.aborted) abort();
          });
        }
        value = { contract: plugin.PLACEMENT_CONTRACT, epoch: 'fixture-epoch', revision: 0, self: { platform: 'linux', wsl: false }, placements: {}, statuses: { 'fixture-session': false } };
      } else throw new Error(`Unexpected fixture RPC: ${path}`);
      return { value: { type: 'server-response', rpcId: envelope.rpcId, result: { ok: true, value } } };
    },
    async upgrade(id, path, { signal } = {}) {
      assert.equal(id, state.id);
      assert.equal(path, '/api/remote.mux');
      signal?.throwIfAborted();
      const socket = new ProtocolSocket(events);
      sockets.push(socket);
      return { socket, head: Buffer.alloc(0) };
    },
  };
}
function until(check, changes, label) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { clearTimeout(timer); changes.off('changed', probe); };
    const probe = () => {
      try { if (check()) { cleanup(); resolve(); } }
      catch (error) { cleanup(); reject(error); }
    };
    const timer = setTimeout(() => { cleanup(); reject(new Error(`Timed out: ${label}`)); }, 3000);
    changes.on('changed', probe);
    probe();
  });
}
async function environment() {
  const ctx = new Context();
  const events = [];
  const logs = [];
  const changes = new EventEmitter();
  ctx.logger.exporter({ export(message) { logs.push({ type: message.type, text: Logger.format({}, message) }); } });
  ctx.on('domain/changed', () => changes.emit('changed'));
  const backend = memoryBackend(events);
  const storage = ctx.plugin(Storage);
  await storage.await();
  const medium = ctx.plugin({
    name: 'lifecycle-memory-backend', inject: ['storage'],
    apply(host) {
      host.effect(() => host.storage.backend.register('lifecycle-memory', backend));
      host.provide(storageBackendServiceKey('lifecycle-memory'), backend);
      host.effect(() => () => backend.close());
    },
  });
  await medium.await();
  const form = ctx.plugin(domainModule, domainModule.Config({ backend: 'lifecycle-memory' }));
  await form.await();
  assert.ok(ctx.storageDomain, 'native storage-domain is provided');
  return { ctx, events, logs, changes, backend, form };
}
function instrumentClose(domain, events) {
  const original = domain.close;
  let entered = false;
  domain.close = function (...args) {
    if (!entered) { entered = true; events.push({ type: 'domain-close', domain: domain.name }); }
    return Reflect.apply(original, this, args);
  };
}
function assertHealthy(logs) {
  assert.deepEqual(logs.filter(row => row.type === 'error' || /DomainError|domain[^\n]*closed|persistence failed|cleanup failed/i.test(row.text)), []);
}
async function lifecycle(order) {
  const env = await environment();
  const { ctx, events, logs, changes, backend } = env;
  const bridge = bridgeFixture(events);
  const routes = new Map();
  const peer = { principal: { kind: 'owner' } };
  const serviceEdges = ctx.plugin({
    name: 'lifecycle-host-protocols',
    apply(host) {
      host.provide('sessionController', { async list() { return { items: [] }; } });
      host.provide('workspaceController', { async *follow() { yield { type: 'baseline', value: { items: [], pinnedSessionIds: [], archivedSessionIds: [] } }; } });
      host.provide('workspaceRegistry', { pinSession() { throw new Error('Unexpected local mutation'); }, unpinSession() { throw new Error('Unexpected local mutation'); } });
      host.provide('connection', { browserPeer: peer, admit: () => ({ peer }), fetch: { register(route) { assert.ok(!routes.has(route.path)); routes.set(route.path, route); return () => routes.delete(route.path); } } });
      host.provide('tools', { register() {} });
    },
  });
  await serviceEdges.await();
  let subscriptions = 0;
  let managerDisposed = false;
  const sshManager = {
    list: () => [state],
    get: id => id === state.id ? state : undefined,
    getOpenUrl() { assert.fail('the fixture must not open a network connection'); },
    onChange() {
      subscriptions++;
      return () => { subscriptions--; };
    },
    async dispose() { managerDisposed = true; },
  };
  mock.method(SshService.prototype, 'initialize', async function () {
    this.manager = sshManager;
    this.targets.set(state.targetId, { ...state, id: state.targetId });
  });
  mock.method(SshService.prototype, 'startAutoConnect', () => {});
  for (const [name, method] of Object.entries(bridge)) {
    if (typeof method === 'function') mock.method(RemoteBridge.prototype, name, method);
  }
  const web = ctx.plugin({
    name: 'lifecycle-web-carrier',
    apply(host) {
      host.provide('webServer', {
        register(route) { assert.ok(!routes.has(route.path)); routes.set(route.path, route); return () => routes.delete(route.path); },
        registerUpgrade() { return () => {}; },
        collectIndexInjections() { return []; },
        readResource() { assert.fail('the fixture must not read resources'); },
      });
    },
  });
  await web.await();
  const parent = ctx.plugin(plugin);
  try {
    await parent.await();
    const domain = ctx.storageDomain.get(REMOTE_INDEX_DOMAIN);
    assert.ok(domain, 'repository plugin opened the real native domain');
    instrumentClose(domain, events);
    await until(() => domain.table('targets').get(state.targetId)?.status === 'ready'
      && domain.table('sessions').get('fixture-target/fixture-session')?.sessionId === 'fixture-session', changes, 'durable connected mirror baseline');
    assert.ok(backend.snapshots.get(REMOTE_INDEX_DOMAIN).tables.sessions['fixture-target/fixture-session'], 'session row reached the asynchronous KV medium');
    assert.equal(bridge.sockets.length, 1, 'real TargetClient opened its mux');
    if (order === 'parent-first') {
      await Promise.all([parent.dispose(), parent.dispose()]);
      await web.dispose();
    } else if (order === 'web-first') {
      await web.dispose();
      assert.equal(routes.has('/api/t3-ssh'), false);
      assert.equal(managerDisposed, true);
      assert.equal(events.some(event => event.type === 'domain-close' && event.domain === REMOTE_INDEX_DOMAIN), false);
      await Promise.all([parent.dispose(), parent.dispose()]);
    } else if (order === 'simultaneous') {
      await Promise.all([parent.dispose(), web.dispose(), parent.dispose()]);
    } else if (order === 'storage-form-first') {
      await env.form.dispose();
      await Promise.all([parent.dispose(), web.dispose()]);
    } else throw new Error(`Unknown order: ${order}`);
    const closed = events.findIndex(event => event.type === 'client-close');
    const domainClosed = events.findIndex(event => event.type === 'domain-close' && event.domain === REMOTE_INDEX_DOMAIN);
    assert.ok(closed >= 0 && domainClosed > closed, `client must close before domain teardown: ${JSON.stringify(events)}`);
    assert.equal(bridge.sockets.every(socket => socket.destroyed), true);
    assert.equal(subscriptions, 0);
    assert.equal(managerDisposed, true);
    assert.equal(routes.size, 0, 'parent routes withdrew with its real fiber');
    assert.ok(backend.snapshots.get(REMOTE_INDEX_DOMAIN).tables.sessions['fixture-target/fixture-session'], 'durable mirror row survives teardown');
    assert.equal(events.filter(event => event.type === 'unit-close' && event.domain === REMOTE_INDEX_DOMAIN).length, 1);
    await turn();
    assertHealthy(logs);
    console.log(`PASS ${order}: TargetClient socket close < SDK Domain.close; durable session retained; no DomainError`);
  } finally {
    try { await ctx.fiber.dispose(); }
    finally { mock.restoreAll(); }
  }
  assert.equal(backend.units.size, 0, 'all native domain handles closed');
  assertHealthy(logs);
}
async function closedWriteContainment() {
  const { ctx, logs } = await environment();
  try {
    const domain = await ctx.storageDomain.open(remoteIndexSpec);
    const seen = [];
    const index = createRemoteIndex({ storage: {
      targets: domain.table('targets'), workspaces: domain.table('workspaces'), sessions: domain.table('sessions'),
    }, onWriteError: error => seen.push(error) });
    await domain.close();
    // Intentionally discard the write's result, exactly as the historical crash
    // did. The real SDK returns a rejected Promise; RemoteIndex must observe it.
    index.putTarget({ targetId: state.targetId, host: state.host, label: state.label, release: null, pluginContract: null,
      status: 'down', lastSyncAt: null, lastError: null });
    await assert.rejects(index.flush(), error => error instanceof AggregateError && error.errors.some(item => item instanceof domainModule.DomainError && item.code === 'closed'));
    assert.equal(seen.length, 1);
    await turn();
    assertHealthy(logs);
    console.log('PASS native closed-write rejection: observed by RemoteIndex and reported by flush; no unhandled rejection');
  } finally { await ctx.fiber.dispose(); }
}

const watchdog = setTimeout(() => { console.error('FAIL lifecycle verification exceeded 20 seconds'); process.exit(1); }, 20000);
try {
  console.log(`Installed SDK: ${installedRequire.resolve('@deepseek-ai/cordis')} / storage-domain ${runtimeVersion}`);
  for (const order of ['parent-first', 'web-first', 'simultaneous', 'storage-form-first']) await lifecycle(order);
  await closedWriteContainment();
  console.log('PASS 5 real-SDK Host lifecycle scenarios (strict unhandled rejections; no GUI/profile/SSH activity)');
} finally { clearTimeout(watchdog); }
