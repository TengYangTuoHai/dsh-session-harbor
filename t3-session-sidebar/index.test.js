import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from './index.js';

async function fixture(options = {}) {
  const listeners = new Map();
  const effects = [];
  const records = new Map();
  const pinned = new Set();
  const routes = new Map();
  let tool;
  const ctx = {
    effect(fn) { effects.push(fn()); },
    on(name, fn) { listeners.set(name, fn); },
    storageDomain: { async open(spec) {
      const data = spec.name === 'local_t3_session_sidebar' ? records : new Map();
      return {
        table() { return {
          get: id => data.get(id),
          entries: () => data.entries(),
          async put(id, value) { data.set(id, value); listeners.get('domain/changed')({ domain: spec.name, table: 'placements', key: id, operation: 'put', value }); },
        }; },
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
  return { routes, call, tool, pinned, records, async close() { for (const cleanup of effects.reverse()) await cleanup?.(); } };
}

const signal = () => new AbortController().signal;

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
