import test from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceConnection } from './remote-transport.js';

const baseUrl = '/ssh/environment/connection-123/';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const untilAborted = signal => signal.aborted ? Promise.resolve() : new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
const flush = async () => { for (let n = 0; n < 12; n += 1) await Promise.resolve(); };

class FakeSocket {
  readyState = 0;
  listeners = new Map();
  closed = [];
  send() {}
  addEventListener(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
  }
  removeEventListener(type, callback) { this.listeners.get(type)?.delete(callback); }
  close(code, reason) {
    this.closed.push([code, reason]);
    this.readyState = 3;
    for (const callback of [...(this.listeners.get('close') ?? [])]) callback({});
  }
}

function harness(options = {}) {
  const calls = [];
  const sockets = [];
  const connection = createDeviceConnection({
    baseUrl,
    fetch: async (url, init) => {
      calls.push([url, init]);
      const request = JSON.parse(init.body);
      return Response.json({ type: 'server-response', rpcId: request.rpcId, result: { ok: true, value: request.payload } });
    },
    createWebSocket: url => { const socket = new FakeSocket(); sockets.push([url, socket]); return socket; },
    ...options,
  });
  return { connection, calls, sockets };
}

function nextGeneration(connection) {
  const outcome = deferred();
  const unsubscribe = connection.generation.subscribe(() => {
    const current = connection.generation.getSnapshot();
    if (current) { unsubscribe(); outcome.resolve(current); }
  });
  return outcome.promise;
}

function multipart(request, { value = { files: [null], nested: { data: null } }, attachments, parts, extra = [] } = {}) {
  const data = new FormData();
  data.append('metadata', JSON.stringify({
    type: 'server-response', rpcId: request.rpcId, result: { ok: true, value },
    attachments: attachments ?? [
      { path: ['files', 0], codec: 'bytes', part: 'file-1' },
      { path: ['nested', 'data'], codec: 'bytes', part: 'file-2' },
    ],
  }));
  for (const [name, bytes] of parts ?? [['file-1', new Uint8Array([0, 128, 255])], ['file-2', new Uint8Array([4, 5])]]) {
    data.append(name, new Blob([bytes]), name);
  }
  for (const [name, value] of extra) data.append(name, value);
  return new Response(data);
}

test('JSON RPC stays under the selected mount and preserves native result semantics', async t => {
  const { connection, calls } = harness();
  t.after(() => connection.dispose());
  const payload = { args: { request: { sessionId: 'same-id-on-two-devices' } } };
  assert.deepEqual(await connection.rpc.call('/api', 'session/events', payload), { ok: true, value: payload });
  assert.equal(calls[0][0], `${baseUrl}api/session/events`);
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0][1].body).payload, payload);
  assert.equal(connection.interactions, 'answer');
  assert.equal(connection.isLoopback, false);

  const failure = { code: 'session/writer-held', message: 'Already owned', details: { sessionId: 's-1' } };
  const remote = harness({ fetch: async (_, init) => Response.json({
    type: 'server-response', rpcId: JSON.parse(init.body).rpcId, result: { ok: false, error: failure },
  }) }).connection;
  t.after(() => remote.dispose());
  assert.deepEqual(await remote.rpc.call('/api', 'session/prompt', {}), { ok: false, error: failure });
});

test('invalid routes, HTTP errors, malformed envelopes and unrelated replies fail closed', async t => {
  const { connection, calls } = harness();
  t.after(() => connection.dispose());
  for (const [channel, endpoint] of [['/api', '../list'], ['/api', 'session//list'], ['/api', 'session/%2e%2e/list'], ['/api?local', 'session/list']]) {
    await assert.rejects(connection.rpc.call(channel, endpoint, {}), /invalid RPC target/);
  }
  assert.equal(calls.length, 0);
  for (const [response, pattern] of [
    [() => new Response('Denied', { status: 401 }), /HTTP 401/],
    [() => Response.json({ type: 'server-response', rpcId: 'wrong-id', result: { ok: true, value: 'local-data' } }), /rpcId mismatch/],
    [() => Response.json({ type: 'other', rpcId: 'x', result: { ok: true } }), /invalid server-response envelope/],
    [(_, init) => Response.json({ type: 'server-response', rpcId: JSON.parse(init.body).rpcId, result: { ok: false, error: { code: 'x', message: 'x', details: [] } } }), /invalid server-response failure/],
  ]) {
    const transport = harness({ fetch: response }).connection;
    t.after(() => transport.dispose());
    await assert.rejects(transport.rpc.call('/api', 'session/list', {}), pattern);
  }
});

test('multipart native RPC restores nested bytes, including an entire root byte value', async t => {
  const nested = harness({ fetch: async (_, init) => multipart(JSON.parse(init.body)) }).connection;
  t.after(() => nested.dispose());
  const result = await nested.rpc.call('/api', 'session/attachment', {});
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.files[0], new Uint8Array([0, 128, 255]));
  assert.deepEqual(result.value.nested.data, new Uint8Array([4, 5]));
  assert.ok(result.value.files[0].buffer instanceof ArrayBuffer);

  const root = harness({ fetch: async (_, init) => multipart(JSON.parse(init.body), {
    value: null, attachments: [{ path: [], codec: 'bytes', part: 'bytes' }], parts: [['bytes', new Uint8Array([9])]],
  }) }).connection;
  t.after(() => root.dispose());
  assert.deepEqual(await root.rpc.call('/api', 'session/attachment', {}), { ok: true, value: new Uint8Array([9]) });
  const unrelated = harness({ fetch: async () => multipart({ rpcId: 'unrelated-binary-response' }) }).connection;
  t.after(() => unrelated.dispose());
  await assert.rejects(unrelated.rpc.call('/api', 'session/attachment', {}), /rpcId mismatch/);
});

test('multipart rejects missing, duplicated, unused or invalid attachment paths and placeholders', async t => {
  const cases = [
    { attachments: [] },
    { attachments: [{ path: ['files', '0'], codec: 'bytes', part: 'file-1' }] },
    { attachments: [{ path: ['missing'], codec: 'bytes', part: 'file-1' }] },
    { attachments: [{ path: ['__proto__', 'polluted'], codec: 'bytes', part: 'file-1' }] },
    { attachments: [{ path: ['files', 1], codec: 'bytes', part: 'file-1' }] },
    { attachments: [{ path: ['files', 0], codec: 'json', part: 'file-1' }] },
    { parts: [['file-1', new Uint8Array([1])]] },
    { value: { files: ['already-set'], nested: { data: null } } },
    { extra: [['file-1', new Blob(['duplicate'])]] },
    { extra: [['unexpected', 'unused']] },
  ];
  for (const fixture of cases) {
    const connection = harness({ fetch: async (_, init) => multipart(JSON.parse(init.body), fixture) }).connection;
    t.after(() => connection.dispose());
    await assert.rejects(connection.rpc.call('/api', 'session/attachment', {}), /invalid binary response/);
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test('caller cancellation and disposal abort requests and refuse a late successful response', async t => {
  const pending = [];
  const connection = harness({ fetch: (_, init) => {
    const outcome = deferred();
    pending.push({ init, outcome });
    return outcome.promise;
  } }).connection;
  t.after(() => connection.dispose());
  const caller = new AbortController();
  const first = connection.rpc.call('/api', 'session/events', {}, caller.signal);
  const rejected = assert.rejects(first, error => error.name === 'AbortError');
  caller.abort();
  assert.equal(pending[0].init.signal.aborted, true);
  pending[0].outcome.resolve(Response.json({ type: 'server-response', rpcId: JSON.parse(pending[0].init.body).rpcId, result: { ok: true, value: 'late' } }));
  await rejected;
  const second = connection.rpc.call('/api', 'session/events', {});
  const disposed = assert.rejects(second, error => error.name === 'AbortError');
  let reentrantDisposal;
  pending[1].init.signal.addEventListener('abort', () => { reentrantDisposal = connection.dispose(); }, { once: true });
  const disposal = connection.dispose();
  assert.equal(reentrantDisposal, disposal);
  await disposal;
  assert.equal(pending[1].init.signal.aborted, true);
  pending[1].outcome.resolve(Response.json({ type: 'server-response', rpcId: JSON.parse(pending[1].init.body).rpcId, result: { ok: true, value: 'late' } }));
  await disposed;
  await assert.rejects(connection.rpc.call('/api', 'session/list', {}), error => error.name === 'AbortError');
});

test('socket carrier receives the selected mount and every remaining owned socket is closed on disposal', async () => {
  const { connection, sockets } = harness();
  const first = connection.openWebSocket('/api/remote.mux');
  const second = connection.openWebSocket('/api/remote.mux');
  assert.equal(sockets[0][0], `${baseUrl}api/remote.mux`);
  assert.throws(() => connection.openWebSocket('//api/remote.mux'), /invalid logical/);
  assert.throws(() => connection.openWebSocket('/api/../remote.mux'), /invalid logical/);
  first.close(1000, 'consumer closed');
  await connection.dispose();
  assert.equal(first.closed.length, 1);
  assert.deepEqual(second.closed, [[1000, 'device disposed']]);
  assert.throws(() => connection.openWebSocket('/api/remote.mux'), error => error.name === 'AbortError');
});

test('absolute mount selects HTTP/WS schemes; baseConnection supplies only a socket opener', async t => {
  const { connection, calls, sockets } = harness({ baseUrl: 'https://local.example/ssh/environment/connection-123/' });
  t.after(() => connection.dispose());
  await connection.rpc.call('/api', 'session/list', {});
  connection.openWebSocket('/api/remote.mux');
  assert.equal(calls[0][0], 'https://local.example/ssh/environment/connection-123/api/session/list');
  assert.equal(sockets[0][0], 'wss://local.example/ssh/environment/connection-123/api/remote.mux');
  let opened;
  const base = {
    get generation() { throw new Error('local generation must never be read'); },
    get state() { throw new Error('local state must never be read'); },
    rpc: { call() { throw new Error('local RPC must never be used'); } },
    openWebSocket(path) { opened = path; return new FakeSocket(); },
  };
  const remote = createDeviceConnection({ baseConnection: base, baseUrl: 'https://local.example/ssh/environment/connection-123/', fetch: async (_, init) => Response.json({
    type: 'server-response', rpcId: JSON.parse(init.body).rpcId, result: { ok: true, value: 'remote' },
  }) });
  t.after(() => remote.dispose());
  remote.openWebSocket('/api/remote.mux');
  assert.equal(opened, `${baseUrl}api/remote.mux`);
  assert.deepEqual(await remote.rpc.call('/api', 'session/list', {}), { ok: true, value: 'remote' });
});

test('only the registered remote readiness source publishes its own generation and reset', async t => {
  const resets = [];
  const { connection } = harness({ onReset: value => resets.push(value.id) });
  t.after(() => connection.dispose());
  assert.equal(connection.generation.getSnapshot(), undefined);
  assert.equal(connection.state.getSnapshot(), undefined);
  assert.throws(() => connection.start(), /no generation source/);
  const opened = deferred();
  let report;
  const unregister = connection.registerGenerationSource(async (signal, ready) => {
    report = ready;
    opened.resolve();
    await untilAborted(signal);
  });
  assert.throws(() => connection.registerGenerationSource(() => {}), /already registered/);
  const states = [];
  connection.state.subscribe(() => states.push(connection.state.getSnapshot()));
  const ready = nextGeneration(connection);
  const loop = connection.start({ onConnected: host => assert.equal(host.home, '/remote/home') });
  assert.throws(() => connection.start(), /already owned/);
  await opened.promise;
  assert.equal(connection.generation.getSnapshot(), undefined);
  report({ home: '/remote/home' });
  assert.deepEqual(await ready, { id: 1, host: { home: '/remote/home' } });
  assert.deepEqual(resets, [1]);
  assert.deepEqual(states, ['connected']);
  report({ home: '/wrong' });
  assert.equal(connection.generation.getSnapshot().host.home, '/remote/home');
  await loop.stop();
  assert.equal(connection.generation.getSnapshot(), undefined);
  assert.equal(connection.state.getSnapshot(), undefined);
  unregister();
});

test('manual reconnect rejects stale readiness and waits for old source cleanup before replacement', async t => {
  const { connection } = harness();
  t.after(() => connection.dispose());
  const firstOpened = deferred();
  const firstAborted = deferred();
  const releaseFirst = deferred();
  const secondOpened = deferred();
  const attempts = [];
  connection.registerGenerationSource(async (signal, ready) => {
    attempts.push({ signal, ready });
    if (attempts.length === 1) {
      firstOpened.resolve();
      await untilAborted(signal);
      firstAborted.resolve();
      await releaseFirst.promise;
    } else {
      secondOpened.resolve();
      await untilAborted(signal);
    }
  });
  let physicalRetries = 0;
  connection.start({ onReconnectRequested: () => { physicalRetries += 1; } });
  await firstOpened.promise;
  connection.reconnect();
  await firstAborted.promise;
  attempts[0].ready({ home: '/stale' });
  assert.equal(connection.generation.getSnapshot(), undefined);
  assert.equal(connection.state.getSnapshot(), 'connecting');
  assert.equal(attempts.length, 1);
  releaseFirst.resolve();
  await secondOpened.promise;
  assert.equal(physicalRetries, 1);
  const ready = nextGeneration(connection);
  attempts[1].ready({ home: '/remote' });
  assert.deepEqual(await ready, { id: 1, host: { home: '/remote' } });
  connection.reconnect();
  const third = nextGeneration(connection);
  await flush();
  attempts[2].ready({ home: '/remote-again' });
  assert.deepEqual(await third, { id: 2, host: { home: '/remote-again' } });
});

test('loss clears a generation, retries with a fresh physical carrier, then publishes the next generation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { connection } = harness({ recovery: { backoffBaseMs: 10, backoffMaxMs: 10 } });
  t.after(() => connection.dispose());
  const attempts = [];
  connection.registerGenerationSource((signal, ready) => {
    const end = deferred();
    attempts.push({ signal, ready, end });
    signal.addEventListener('abort', () => end.resolve(), { once: true });
    return end.promise;
  });
  let retries = 0;
  connection.start({ onReconnectRequested: () => { retries += 1; } });
  await flush();
  const first = nextGeneration(connection);
  attempts[0].ready({ home: '/remote' });
  await first;
  attempts[0].end.reject(new Error('remote disconnected'));
  await flush();
  assert.equal(connection.generation.getSnapshot(), undefined);
  assert.equal(connection.state.getSnapshot(), 'connecting');
  t.mock.timers.tick(10);
  await flush();
  assert.equal(attempts.length, 2);
  assert.equal(retries, 1);
  const next = nextGeneration(connection);
  attempts[1].ready({ home: '/remote-new' });
  assert.equal((await next).id, 2);
});

test('withdrawal, scope abort and disposal suppress late ready and await resource cleanup', async t => {
  const lifetime = new AbortController();
  const { connection } = harness({ signal: lifetime.signal });
  t.after(() => connection.dispose());
  const opened = deferred();
  const aborted = deferred();
  const cleaned = deferred();
  let ready;
  connection.registerGenerationSource(async (signal, report) => {
    ready = report;
    opened.resolve();
    await untilAborted(signal);
    aborted.resolve();
    await cleaned.promise;
  });
  connection.start();
  await opened.promise;
  lifetime.abort();
  await aborted.promise;
  ready({ home: '/too-late' });
  assert.equal(connection.generation.getSnapshot(), undefined);
  const disposal = connection.dispose();
  assert.equal(connection.dispose(), disposal);
  let finished = false;
  disposal.then(() => { finished = true; });
  await flush();
  assert.equal(finished, false);
  cleaned.resolve();
  await disposal;
  assert.equal(finished, true);
  assert.throws(() => connection.registerGenerationSource(() => {}), error => error.name === 'AbortError');
});

test('source withdrawal permits a replacement only after the prior source releases its resources', async t => {
  const { connection } = harness();
  t.after(() => connection.dispose());
  const opened = deferred();
  const cleanup = deferred();
  const unregister = connection.registerGenerationSource(async signal => {
    opened.resolve();
    await untilAborted(signal);
    await cleanup.promise;
  });
  connection.start();
  await opened.promise;
  unregister();
  const secondOpened = deferred();
  connection.registerGenerationSource(async (signal, ready) => {
    secondOpened.resolve();
    ready({ home: '/second' });
    await untilAborted(signal);
  });
  connection.start();
  await flush();
  assert.equal(connection.generation.getSnapshot(), undefined);
  cleanup.resolve();
  await secondOpened.promise;
  await flush();
  assert.equal(connection.generation.getSnapshot().host.home, '/second');
});

test('readiness deadline aborts its source; cancelled late ready cannot publish', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { connection } = harness({ recovery: { generationReadyTimeoutMs: 20, generationReadyWarnMs: 30 } });
  t.after(() => connection.dispose());
  const attempts = [];
  connection.registerGenerationSource(async (signal, ready) => {
    attempts.push({ signal, ready });
    await untilAborted(signal);
  });
  connection.start();
  await flush();
  t.mock.timers.tick(20);
  await flush();
  assert.equal(attempts[0].signal.aborted, true);
  attempts[0].ready({ home: '/late' });
  assert.equal(connection.generation.getSnapshot(), undefined);
  assert.equal(connection.state.getSnapshot(), 'connecting');
});

test('invalid or absent mounts and authentication functions never fall back to page transports', () => {
  for (const baseUrl of [undefined, '/', '//elsewhere/ssh/environment/id/', '/ssh/environment/id', '/ssh/environment/../', 'https://user:secret@local/ssh/environment/id/', '/ssh/environment/id/?x=1']) {
    assert.throws(() => harness({ baseUrl }), /baseUrl/);
  }
  assert.throws(() => createDeviceConnection({ baseUrl }), /authenticated fetch/);
  assert.throws(() => harness({ recovery: { backoffFactor: Infinity } }), /backoffFactor/);
  assert.throws(() => harness({ recovery: { backoffBaseMs: 0 } }), /backoffBaseMs/);
});
