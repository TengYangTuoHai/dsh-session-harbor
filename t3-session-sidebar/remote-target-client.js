/**
 * One Remote API client per connected machine.
 *
 * Unary calls ride the ssh plugin's authenticated bridge (`POST /api/<namespace>/<method>`);
 * streams ride one multiplexed WebSocket (`/api/remote.mux`) opened through the same bridge.
 * Endpoint names and `args` keys are the remote DSH's declared Remote surface, so unknown
 * fields are tolerated and never invented here.
 */
import { WebSocketClient } from './remote-ws.js';

// DSH namespaces are camelCase as often as they are lowercase (directoryPicker/list),
// so only the shape is fenced: no dots, no slashes beyond the one separator.
const ID_PATTERN = /^[a-z][A-Za-z0-9-]*(?:\/[a-z][A-Za-z0-9-]*)*$/;

export class RemoteFailure extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'RemoteFailure';
    this.code = code;
    this.details = details ?? {};
  }
}

const isPlainObject = value => typeof value === 'object' && value !== null && !Array.isArray(value);

export class TargetClient {
  #targetId;
  #bridge;
  #connectionId;
  #muxPath;
  #maxResponseBytes;
  #logger;
  #socket = null;
  #connecting = null;
  #streams = new Map();
  #sequence = 0;
  #closed = false;

  constructor({ targetId, bridge, connectionId, muxPath = '/api/remote.mux', maxResponseBytes, logger }) {
    if (!targetId || !bridge || !connectionId) throw new Error('targetId, bridge and connectionId are required');
    this.#targetId = targetId;
    this.#bridge = bridge;
    this.#connectionId = connectionId;
    this.#muxPath = muxPath;
    this.#maxResponseBytes = maxResponseBytes;
    this.#logger = logger ?? (() => {});
  }

  get targetId() { return this.#targetId; }

  /** One unary Remote call. `args` is the remote method's argument object, keyed by declared parameter name. */
  async call(endpoint, args = {}, { signal } = {}) {
    const name = this.#endpoint(endpoint);
    if (!isPlainObject(args)) throw new RemoteFailure('remote/invalid-args', 'Remote args must be a plain object.', { endpoint: name });
    const rpcId = 'rpc-' + String(++this.#sequence);
    const reply = await this.#bridge.requestJson(this.#connectionId, '/api/' + name, {
      type: 'client-request', rpcId, method: name, payload: { args },
    }, { ...(signal ? { signal } : {}), ...(this.#maxResponseBytes ? { maxResponseBytes: this.#maxResponseBytes } : {}) });
    return this.#unwrap(reply.value, rpcId, name);
  }

  /** A route owned by this same plugin on the remote host; the payload is passed through as-is. */
  async pluginCall(endpoint, payload = {}, { signal } = {}) {
    const name = this.#endpoint(endpoint);
    const rpcId = 'rpc-' + String(++this.#sequence);
    const reply = await this.#bridge.requestJson(this.#connectionId, '/api/' + name, {
      type: 'client-request', rpcId, method: name, payload,
    }, { ...(signal ? { signal } : {}), ...(this.#maxResponseBytes ? { maxResponseBytes: this.#maxResponseBytes } : {}) });
    return this.#unwrap(reply.value, rpcId, name);
  }

  /**
   * Open one Remote stream and iterate its `item` values until `end`.
   * A hand-rolled iterator (not a generator) so `return()` can settle a pending
   * wait immediately: a consumer that breaks out must send `cancel` right away
   * instead of waiting for the next frame.
   */
  follow(endpoint, args = {}, { signal } = {}) {
    const name = this.#endpoint(endpoint);
    if (!isPlainObject(args)) throw new RemoteFailure('remote/invalid-args', 'Remote args must be a plain object.', { endpoint: name });
    const streamId = 'stream-' + String(++this.#sequence);
    const state = { items: [], end: false, error: null, notify: null };
    const client = this;
    let socket = null;
    let closed = false;
    const wake = () => { const done = state.notify; state.notify = null; done?.(); };
    const finish = () => {
      if (closed) return;
      closed = true;
      this.#streams.delete(streamId);
      if (socket?.state === 'open') { try { socket.send(JSON.stringify({ type: 'cancel', streamId })); } catch { /* already down */ } }
      wake();
    };
    const open = async () => {
      const connection = await client.#connect(signal);
      if (closed) return null;
      socket = connection;
      connection.send(JSON.stringify({ type: 'open', streamId, endpoint: name, payload: { args } }));
      return connection;
    };
    const iterator = {
      [Symbol.asyncIterator]() { return iterator; },
      async next() {
        if (closed) return { value: undefined, done: true };
        for (;;) {
          if (state.items.length) return { value: state.items.shift(), done: false };
          if (state.error) { const error = state.error; finish(); throw error; }
          if (state.end) { finish(); return { value: undefined, done: true }; }
          if (socket === null) { await open(); if (closed) return { value: undefined, done: true }; continue; }
          await client.#wait(state, signal);
          if (closed) return { value: undefined, done: true };
          if (signal?.aborted) { finish(); throw new RemoteFailure('remote/cancelled', 'The Remote stream was cancelled.', { endpoint: name }); }
        }
      },
      async return() { finish(); return { value: undefined, done: true }; },
      async throw(error) { finish(); throw error; },
    };
    this.#streams.set(streamId, state);
    return iterator;
  }

  async close() {
    this.#closed = true;
    for (const state of this.#streams.values()) { state.error = new RemoteFailure('remote/closed', 'The Remote client closed.'); state.notify?.(); }
    this.#streams.clear();
    const socket = this.#socket;
    this.#socket = null;
    this.#connecting = null;
    socket?.close(1000, 'client closing');
  }

  #endpoint(endpoint) {
    if (typeof endpoint !== 'string' || !ID_PATTERN.test(endpoint)) throw new RemoteFailure('remote/invalid-endpoint', 'Invalid Remote endpoint.', { endpoint: String(endpoint) });
    return endpoint;
  }

  #unwrap(envelope, rpcId, endpoint) {
    if (!isPlainObject(envelope) || envelope.type !== 'server-response' || envelope.rpcId !== rpcId) {
      throw new RemoteFailure('remote/bad-envelope', 'The remote DSH returned an unexpected envelope.', { endpoint });
    }
    const result = envelope.result;
    if (!isPlainObject(result)) throw new RemoteFailure('remote/bad-envelope', 'The remote DSH returned no result.', { endpoint });
    if (result.ok !== true) {
      const failure = isPlainObject(result.error) ? result.error : {};
      throw new RemoteFailure(String(failure.code ?? 'remote/error'), String(failure.message ?? 'The remote DSH call failed.'), failure.details ?? {});
    }
    return result.value;
  }

  #wait(state, signal, wake) {
    return new Promise(resolve => {
      const done = () => { signal?.removeEventListener('abort', done); state.notify = null; resolve(); };
      state.notify = done;
      signal?.addEventListener('abort', done, { once: true });
    });
  }

  #connect(signal) {
    if (this.#closed) return Promise.reject(new RemoteFailure('remote/closed', 'The Remote client closed.'));
    if (this.#socket && this.#socket.state === 'open') return Promise.resolve(this.#socket);
    if (this.#connecting) return this.#connecting;
    const connecting = this.#bridge.upgrade(this.#connectionId, this.#muxPath, signal ? { signal } : {})
      .then(({ socket, head }) => {
        if (this.#closed) { socket.destroy(); throw new RemoteFailure('remote/closed', 'The Remote client closed.'); }
        const client = new WebSocketClient({
          socket,
          ...(head && head.length ? { head } : {}),
          onMessage: text => this.#onFrame(text),
          onClose: code => this.#onSocketClosed(code, client),
          onError: error => this.#logger('warn', `remote mux socket error for ${this.#targetId}: ${error?.message ?? error}`),
        });
        this.#socket = client;
        this.#connecting = null;
        return client;
      })
      .catch(error => { this.#connecting = null; throw error; });
    this.#connecting = connecting;
    return connecting;
  }

  #onSocketClosed(code, client) {
    if (this.#socket === client) this.#socket = null;
    this.#logger('info', `remote mux socket closed for ${this.#targetId}: ${String(code)}`);
    for (const state of this.#streams.values()) {
      state.error = new RemoteFailure('remote/stream-closed', 'The Remote stream connection closed.', { code });
      state.notify?.();
    }
  }

  #onFrame(text) {
    let frame;
    try { frame = JSON.parse(text); } catch { this.#logger('warn', `remote mux sent a non-JSON frame for ${this.#targetId}`); return; }
    if (!isPlainObject(frame) || typeof frame.streamId !== 'string') return;
    const state = this.#streams.get(frame.streamId);
    if (!state) return; // cancelled or unknown stream: nothing to deliver
    if (frame.type === 'item') { state.items.push(frame.value); state.notify?.(); return; }
    if (frame.type === 'end') { state.end = true; state.notify?.(); return; }
    if (frame.type === 'error') {
      const failure = isPlainObject(frame.error) ? frame.error : {};
      state.error = new RemoteFailure(String(failure.code ?? 'remote/stream'), String(failure.message ?? 'The Remote stream failed.'), failure.details ?? {});
      state.notify?.();
    }
  }
}
