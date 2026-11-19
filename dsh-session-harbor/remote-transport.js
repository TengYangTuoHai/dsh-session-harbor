/**
 * Per-device ConnectionHandle for the installed DSH 0.2.2-rc.3 API Gateway.
 * RPC decoding and recovery semantics follow @deepseek-ai/dsh-client-connection
 * src/client/{index,connection,rpc,socket}.ts; no DSH runtime imports are needed.
 */
const CHANNEL = /^\/[A-Za-z0-9._~-]+$/;
const SEGMENT = /^[A-Za-z0-9_$.-]+$/;
const MAX_TIMER = 2_147_483_647;
const DEFAULT_RECOVERY = Object.freeze({
  backoffBaseMs: 500, backoffFactor: 2, backoffMaxMs: 10_000,
  generationReadyWarnMs: 3_000, generationReadyTimeoutMs: 15_000,
});
const MANUAL_RECONNECT = new Error('connection: manual reconnect requested');
const NETWORK_CHANGED = new Error('connection: browser network state changed');
let sequence = 0;

const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const abortError = () => new DOMException('Device connection disposed', 'AbortError');
const safeCall = callback => {
  try { callback?.(); } catch (error) { console.error('[device-connection] listener threw:', error); }
};

function recoveryConfig(input = {}) {
  if (!isRecord(input)) throw new TypeError('connection recovery config must be an object');
  const config = { ...DEFAULT_RECOVERY };
  for (const key of Object.keys(config)) {
    if (input[key] === undefined) continue;
    const value = input[key];
    if (!Number.isFinite(value) || value < 1 || (key !== 'backoffFactor' && (!Number.isInteger(value) || value > MAX_TIMER))) {
      throw new RangeError(`connection recovery ${key} must be ${key === 'backoffFactor' ? 'finite and at least 1' : 'a positive timer integer'}`);
    }
    config[key] = value;
  }
  return config;
}

function assertRoute(path) {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')
    || path.slice(1).split('/').some(part => !SEGMENT.test(part) || part === '.' || part === '..')) {
    throw new TypeError('connection: invalid logical transport path');
  }
}

function mountRoutes(baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl) throw new TypeError('connection: baseUrl is required');
  const absolute = /^https?:\/\//.test(baseUrl);
  const base = new URL(baseUrl, 'http://device.invalid');
  if ((!absolute && (!baseUrl.startsWith('/') || baseUrl.startsWith('//')))
    || !['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash
    || !base.pathname.endsWith('/') || /(?:^|\/)\.\.?\//.test(baseUrl) || baseUrl.includes('\\')
    || !/^\/t3-remote\/ssh\/[A-Za-z0-9_-]+\/$/.test(base.pathname)) {
    throw new TypeError('connection: baseUrl must name a Session Harbor SSH device route');
  }
  return (path, socket = false) => {
    assertRoute(path);
    const url = new URL(path.slice(1), base);
    if (!absolute) return url.pathname;
    if (socket) url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.href;
  };
}

function parseResponse(value) {
  if (!isRecord(value) || value.type !== 'server-response' || typeof value.rpcId !== 'string') {
    throw new TypeError('connection: invalid server-response envelope');
  }
  const result = value.result;
  if (!isRecord(result)) throw new TypeError('connection: invalid server-response result');
  if (result.ok === true) return { rpcId: value.rpcId, result: { ok: true, value: result.value } };
  if (result.ok !== false || !isRecord(result.error) || typeof result.error.code !== 'string'
    || typeof result.error.message !== 'string' || !isRecord(result.error.details)) {
    throw new TypeError('connection: invalid server-response failure');
  }
  const { code, message, details } = result.error;
  return { rpcId: value.rpcId, result: { ok: false, error: { code, message, details } } };
}

async function parseMultipart(response) {
  const fields = new Map();
  for (const [name, value] of await response.formData()) {
    if (fields.has(name)) throw new TypeError('connection: invalid binary response fields');
    fields.set(name, value);
  }
  const metadata = fields.get('metadata');
  fields.delete('metadata');
  if (typeof metadata !== 'string') throw new TypeError('connection: invalid binary response fields');
  const envelope = JSON.parse(metadata);
  const full = parseResponse(envelope);
  if (!full.result.ok || !Array.isArray(envelope.attachments) || !envelope.attachments.length) {
    throw new TypeError('connection: invalid binary response result');
  }
  const root = { value: full.result.value };
  for (const attachment of envelope.attachments) {
    if (!isRecord(attachment) || attachment.codec !== 'bytes' || typeof attachment.part !== 'string' || !Array.isArray(attachment.path)) {
      throw new TypeError('connection: invalid binary response attachment');
    }
    const bytes = fields.get(attachment.part);
    fields.delete(attachment.part);
    if (!(bytes instanceof Blob)) throw new TypeError('connection: invalid binary response fields');
    let parent = root;
    let key = 'value';
    for (const segment of attachment.path) {
      const value = Reflect.get(parent, key);
      if (typeof value !== 'object' || value === null
        || (Array.isArray(value)
          ? typeof segment !== 'number' || !Number.isSafeInteger(segment) || segment < 0 || segment >= value.length
          : typeof segment !== 'string')
        || !Object.hasOwn(value, segment)) {
        throw new TypeError('connection: invalid binary response path');
      }
      parent = value;
      key = segment;
    }
    if (Reflect.get(parent, key) !== null) throw new TypeError('connection: invalid binary response placeholder');
    Object.defineProperty(parent, key, {
      value: new Uint8Array(await bytes.arrayBuffer()), enumerable: true, writable: true, configurable: true,
    });
  }
  if (fields.size) throw new TypeError('connection: invalid binary response fields');
  return { rpcId: full.rpcId, result: { ok: true, value: root.value } };
}

function waitForAbort(signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
}

function delay(ms, signal) {
  if (signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

function awaitReady(ready, config, signal) {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(warning);
      clearTimeout(timeout);
      signal.removeEventListener('abort', aborted);
      if (error) reject(error); else resolve(value);
    };
    const warning = setTimeout(() => {
      console.warn(`[connection] generation is still not ready after ${config.generationReadyWarnMs}ms`);
    }, config.generationReadyWarnMs);
    const timeout = setTimeout(() => finish(new Error(`connection generation was not ready within ${config.generationReadyTimeoutMs}ms`)), config.generationReadyTimeoutMs);
    const aborted = () => finish(new Error('connection generation aborted', { cause: signal.reason }));
    signal.addEventListener('abort', aborted, { once: true });
    ready.then(value => finish(null, value), error => finish(error));
  });
}

/** The source owns $events readiness; Gateway owns its mux and event replies. */
class RecoveryLoop {
  constructor(source, sinks, config) {
    this.source = source;
    this.sinks = sinks;
    this.config = config;
    this.running = false;
    this.available = true;
    this.immediate = false;
    this.attempt = 0;
    this.lastState = undefined;
    this.current = null;
    this.retryDelay = null;
    this.done = Promise.resolve();
  }
  emit(state) {
    if (this.lastState === state) return;
    this.lastState = state;
    safeCall(() => this.sinks.onStateChange?.(state));
  }
  start(before) {
    this.running = true;
    this.done = Promise.resolve(before).then(() => this.run());
  }
  stop() {
    this.running = false;
    this.current?.abort();
    this.retryDelay?.abort();
    return this.done;
  }
  reconnect() {
    if (!this.running) return;
    this.attempt = 0;
    this.immediate = true;
    this.emit('connecting');
    if (!this.running) return;
    this.current?.abort(MANUAL_RECONNECT);
    this.retryDelay?.abort(MANUAL_RECONNECT);
  }
  setNetworkAvailable(available) {
    if (this.available === available) return;
    this.available = available;
    this.attempt = 0;
    this.immediate = false;
    if (!this.running) return;
    this.emit(available ? 'connecting' : 'disconnected');
    if (!this.running) return;
    this.current?.abort(NETWORK_CHANGED);
    this.retryDelay?.abort(NETWORK_CHANGED);
  }
  async run() {
    let retry = false;
    while (this.running) {
      if (!this.available && !this.immediate) {
        const ac = new AbortController();
        this.retryDelay = ac;
        this.emit('disconnected');
        if (!this.running || this.available || this.immediate) ac.abort();
        await waitForAbort(ac.signal);
        if (this.retryDelay === ac) this.retryDelay = null;
        if (!this.running) return;
        retry = true;
        continue;
      }
      let manual = false;
      if (retry) {
        manual = this.immediate;
        this.immediate = false;
        if (manual) this.attempt = 0;
        const attempt = ++this.attempt;
        this.emit('connecting');
        if (!this.running) return;
        if (this.immediate || (!this.available && !manual)) continue;
        if (!manual) {
          const cap = Math.min(this.config.backoffMaxMs, this.config.backoffBaseMs * this.config.backoffFactor ** Math.max(0, attempt - 1));
          const ac = new AbortController();
          this.retryDelay = ac;
          await delay(cap / 2 + Math.random() * cap / 2, ac.signal);
          if (this.retryDelay === ac) this.retryDelay = null;
          if (!this.running) return;
          if (ac.signal.aborted) continue;
        }
        safeCall(() => this.sinks.onReconnectRequested?.());
        if (!this.running) return;
      }
      const ac = new AbortController();
      this.current = ac;
      let reported = false;
      let resolveReady, rejectReady, rejectLost;
      const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      const lost = new Promise((_, reject) => { rejectLost = reject; });
      const source = Promise.resolve().then(() => {
        if (ac.signal.aborted || !this.running) return;
        return this.source(ac.signal, host => {
          if (reported || ac.signal.aborted || !this.running || this.current !== ac) return;
          reported = true;
          resolveReady(host);
        });
      });
      const ended = source.then(
        () => new Error('connection generation ended'),
        error => error instanceof Error ? error : new Error('connection generation failed', { cause: error }),
      ).then(error => {
        if (!reported) rejectReady(error);
        rejectLost(error);
        if (!ac.signal.aborted) ac.abort(error);
      });
      try {
        const host = await Promise.race([awaitReady(ready, this.config, ac.signal), lost]);
        if (!ac.signal.aborted && this.running && this.current === ac) {
          this.attempt = 0;
          this.emit('connected');
          if (!ac.signal.aborted && this.running && this.current === ac) safeCall(() => this.sinks.onConnected?.(host));
        }
      } catch (error) {
        if (!ac.signal.aborted) ac.abort(error);
      }
      await ended;
      if (this.current === ac) this.current = null;
      if (!this.running) return;
      if (manual) this.attempt = 0;
      retry = true;
    }
  }
}

function watchNetwork(loop) {
  const target = globalThis.window;
  if (typeof target?.navigator?.onLine !== 'boolean' || typeof target.addEventListener !== 'function') return () => {};
  const online = () => loop.setNetworkAvailable(true);
  const offline = () => loop.setNetworkAvailable(false);
  loop.setNetworkAvailable(target.navigator.onLine);
  target.addEventListener('online', online);
  target.addEventListener('offline', offline);
  return () => { target.removeEventListener('online', online); target.removeEventListener('offline', offline); };
}

/**
 * Create an independent ConnectionHandle plus an idempotent async dispose().
 * With a relative baseUrl, fetch/createWebSocket receive a mount-absolute path
 * (for example /t3-remote/ssh/id/api/remote.mux). They must use the local
 * authenticated carrier. An absolute baseUrl yields absolute HTTP/WS URLs.
 * No underlying RPC caller or generation is borrowed from baseConnection.
 * API Gateway registers the generation source and calls start(); onReset is
 * optional, since Gateway's onConnected may already emit connection/reset.
 */
export function createDeviceConnection({ baseConnection, baseUrl, fetch: fetchInput, createWebSocket, recovery = {}, onReset, signal } = {}) {
  const route = mountRoutes(baseUrl);
  const send = fetchInput ?? baseConnection?.fetch;
  const socketFactory = createWebSocket ?? (typeof baseConnection?.openWebSocket === 'function'
    ? path => baseConnection.openWebSocket(path.startsWith('/') ? path : new URL(path).pathname) : null);
  if (typeof send !== 'function' || typeof socketFactory !== 'function') {
    throw new TypeError('connection: authenticated fetch and WebSocket transports are required');
  }
  const config = recoveryConfig(recovery);
  const lifetime = new AbortController();
  const sockets = new Map();
  const drains = new Set();
  const generationListeners = new Set();
  const stateListeners = new Set();
  let generation;
  let state;
  let generationId = 0;
  let source;
  let owner;
  let drain = Promise.resolve();
  let disposed = false;
  let disposal;
  const assertLive = () => { if (disposed) throw abortError(); };
  const publish = listeners => { for (const listener of [...listeners]) safeCall(listener); };
  const publishGeneration = next => {
    if (Object.is(generation, next)) return;
    generation = next;
    publish(generationListeners);
  };
  const publishState = next => {
    if (state === next) return;
    state = next;
    publish(stateListeners);
  };
  const release = current => {
    if (owner !== current) return drain;
    owner = undefined;
    current.unwatch();
    drain = current.loop.stop();
    publishGeneration(undefined);
    publishState(undefined);
    return drain;
  };
  const connection = {
    interactions: 'answer',
    isLoopback: false,
    generation: {
      getSnapshot: () => generation,
      subscribe(listener) { assertLive(); generationListeners.add(listener); return () => generationListeners.delete(listener); },
    },
    state: {
      getSnapshot: () => state,
      subscribe(listener) { assertLive(); stateListeners.add(listener); return () => stateListeners.delete(listener); },
    },
    rpc: {
      async call(channel, endpoint, payload, requestSignal) {
        assertLive();
        if (typeof channel !== 'string' || !CHANNEL.test(channel) || typeof endpoint !== 'string'
          || endpoint.split('/').some(part => !SEGMENT.test(part) || part === '.' || part === '..')) {
          throw new TypeError('connection: invalid RPC target');
        }
        const combined = requestSignal ? AbortSignal.any([lifetime.signal, requestSignal]) : lifetime.signal;
        combined.throwIfAborted();
        const rpcId = globalThis.crypto?.randomUUID?.() ?? `device-${Date.now()}-${++sequence}-${Math.random()}`;
        const response = await send(route(`${channel}/${endpoint}`), {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'client-request', rpcId, method: endpoint, payload }), signal: combined,
        });
        if (!response.ok) throw new Error(`transport failure for ${channel}/${endpoint}: HTTP ${response.status}`);
        const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
        const full = mediaType === 'multipart/form-data' ? await parseMultipart(response) : parseResponse(await response.json());
        combined.throwIfAborted();
        if (full.rpcId !== rpcId) throw new Error(`rpcId mismatch for ${endpoint}: sent ${rpcId}, got ${full.rpcId}`);
        return full.result;
      },
    },
    openWebSocket(path) {
      assertLive();
      const socket = socketFactory(route(path, true));
      const remove = () => { sockets.delete(socket); socket.removeEventListener('close', remove); };
      sockets.set(socket, remove);
      socket.addEventListener('close', remove, { once: true });
      if (disposed) { remove(); socket.close(1000, 'device disposed'); }
      return socket;
    },
    reconnect() { if (!disposed) owner?.loop.reconnect(); },
    registerGenerationSource(next) {
      assertLive();
      if (typeof next !== 'function') throw new TypeError('connection: generation source must be a function');
      if (source !== undefined) throw new Error('connection: a generation source is already registered');
      source = next;
      return () => {
        if (source !== next) return;
        source = undefined;
        if (owner?.source === next) release(owner);
      };
    },
    start(sinks = {}, overrides) {
      assertLive();
      if (owner) throw new Error('connection: the stream loop is already owned by another consumer');
      if (!source) throw new Error('connection: no generation source is registered');
      const current = { source, loop: null, unwatch: () => {} };
      const owns = () => owner === current && !disposed;
      const loop = new RecoveryLoop(source, {
        ...sinks,
        onConnected(host) {
          if (!owns()) return;
          const next = { id: ++generationId, host };
          publishGeneration(next);
          if (!owns() || generation !== next) return;
          safeCall(() => onReset?.(next));
          if (owns() && generation === next) sinks.onConnected?.(host);
        },
        onStateChange(next) {
          if (!owns()) return;
          if (next !== 'connected') publishGeneration(undefined);
          if (!owns()) return;
          publishState(next);
          if (owns()) sinks.onStateChange?.(next);
        },
      }, recoveryConfig({ ...config, ...overrides }));
      current.loop = loop;
      current.unwatch = watchNetwork(loop);
      owner = current;
      loop.start(drain);
      drains.add(loop.done);
      void loop.done.then(() => drains.delete(loop.done), () => drains.delete(loop.done));
      return { stop: () => release(current) };
    },
    dispose() {
      if (disposal) return disposal;
      let finished;
      disposal = new Promise(resolve => { finished = resolve; });
      disposed = true;
      lifetime.abort(abortError());
      signal?.removeEventListener('abort', onAbort);
      if (owner) release(owner);
      source = undefined;
      for (const [socket, remove] of [...sockets]) {
        remove();
        safeCall(() => socket.close(1000, 'device disposed'));
      }
      generationListeners.clear();
      stateListeners.clear();
      void Promise.allSettled([...drains]).then(() => finished());
      return disposal;
    },
  };
  const onAbort = () => { void connection.dispose(); };
  if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true });
  return connection;
}
