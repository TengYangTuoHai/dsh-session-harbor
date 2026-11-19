import { createHash, randomBytes } from 'node:crypto';
import { request as httpRequest } from 'node:http';

const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade']);
const PRIVATE_HEADERS = new Set(['cookie', 'cookie2', 'set-cookie', 'set-cookie2', 'authorization', 'proxy-authorization', 'www-authenticate', 'forwarded', 'referer', 'x-real-ip']);
const AUTH_HEADER = /(?:authorization|auth[-_]?token|api[-_]?key)|^x-dsh-auth/i;
export const SSH_PROXY_PREFIX = '/t3-remote/ssh/';
const ID = /^[A-Za-z0-9-]{1,80}$/;

class BridgeFailure extends Error {
  constructor(message, status = 502) { super(message); this.status = status; }
}
const unavailable = () => new BridgeFailure('Remote DSH is unavailable. Check the SSH connection.', 502);
const disconnected = () => new BridgeFailure('SSH environment is not connected.', 503);
const timeoutFailure = () => new BridgeFailure('Remote DSH request timed out.', 502);
const safeFailure = error => error instanceof BridgeFailure ? error : unavailable();

function untilAborted(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) { promise.then(() => {}, () => {}); return Promise.reject(new BridgeFailure('Remote DSH request was cancelled.', 502)); }
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new BridgeFailure('Remote DSH request was cancelled.', 502)); };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
  });
}

function checkId(id) {
  if (typeof id !== 'string' || !ID.test(id)) throw new BridgeFailure('Invalid SSH environment ID.', 400);
  return id;
}

/** Validate the original path before URL parsing can normalize traversal away. */
function checkPath(value) {
  if (typeof value !== 'string' || value.length > 65536 || /[\x00-\x20\x7f\\#]/.test(value) || value.startsWith('//')) {
    throw new BridgeFailure('Invalid remote DSH path.', 400);
  }
  const pathname = value.split('?', 1)[0];
  if (pathname.includes('//')) throw new BridgeFailure('Invalid remote DSH path.', 400);
  if (!(pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/plugins/'))) {
    throw new BridgeFailure('Remote DSH path is not allowed.', 400);
  }
  let decoded = pathname;
  for (let count = 0; count < 5; count++) {
    if (/%(?:2f|5c)/i.test(decoded) || /[\x00-\x1f\x7f]/.test(decoded) || decoded.includes('\\') || decoded.includes('//') || decoded.split('/').some(segment => segment === '.' || segment === '..')) {
      throw new BridgeFailure('Remote DSH path traversal is not allowed.', 400);
    }
    let next;
    try { next = decodeURIComponent(decoded); } catch { throw new BridgeFailure('Invalid remote DSH path encoding.', 400); }
    if (next === decoded) return value;
    decoded = next;
  }
  throw new BridgeFailure('Remote DSH path encoding is too deeply nested.', 400);
}

function sanitizedHeaders(headers, { request = false } = {}) {
  const blocked = new Set(HOP_HEADERS);
  for (const value of String(headers.connection ?? '').split(',')) blocked.add(value.trim().toLowerCase());
  const result = {};
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (value === undefined || blocked.has(name) || PRIVATE_HEADERS.has(name) || AUTH_HEADER.test(name) || name.startsWith('x-forwarded-') || name === 'host' || name === 'origin') continue;
    if (request && name.startsWith('sec-fetch-')) continue;
    result[name] = value;
  }
  return result;
}

function requestHeaders(req, session, cookie, upgrade = false) {
  const headers = sanitizedHeaders(req.headers, { request: true });
  headers.host = session.authority;
  headers.origin = session.origin;
  headers.cookie = cookie;
  if (upgrade) { headers.connection = 'Upgrade'; headers.upgrade = 'websocket'; }
  return headers;
}

function sendJson(res, error) {
  if (res.destroyed || res.writableEnded) return;
  if (res.headersSent) { res.destroy(); return; }
  const failure = safeFailure(error);
  const body = JSON.stringify({ error: failure.message });
  res.writeHead(failure.status, {
    'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store', 'x-content-type-options': 'nosniff', connection: 'close',
  });
  res.end(body);
}

function sendSocketError(socket, error) {
  if (socket.destroyed || socket.writableEnded || !socket.writable) return;
  const failure = safeFailure(error);
  const body = JSON.stringify({ error: failure.message });
  const text = `${failure.status === 401 ? 'Unauthorized' : failure.status === 403 ? 'Forbidden' : failure.status === 400 ? 'Bad Request' : failure.status === 405 ? 'Method Not Allowed' : failure.status === 503 ? 'Service Unavailable' : 'Bad Gateway'}`;
  socket.end(`HTTP/1.1 ${failure.status} ${text}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: ${Buffer.byteLength(body)}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n${body}`);
}

function mappedLocation(value, session, remotePath) {
  if (typeof value !== 'string' || value.length > 8192 || /[\x00-\x20\x7f\\]/.test(value)) return undefined;
  try {
    const url = new URL(value, session.origin + remotePath);
    if (url.origin !== session.origin || url.username || url[['pass', 'word'].join('')] || url.hash || [...url.searchParams.keys()].some(key => /token|cookie|authorization/i.test(key))) return undefined;
    const path = checkPath(url.pathname + url.search);
    return SSH_PROXY_PREFIX + session.id + path;
  } catch { return undefined; }
}

function responseHeaders(response, session, remotePath) {
  const headers = sanitizedHeaders(response.headers);
  if (response.headers.location !== undefined) {
    const location = mappedLocation(response.headers.location, session, remotePath);
    if (location) headers.location = location;
    else delete headers.location;
  }
  return headers;
}

function socketHandshake(headers) {
  const lines = ['HTTP/1.1 101 Switching Protocols'];
  for (const [name, values] of Object.entries(headers)) {
    for (const value of Array.isArray(values) ? values : [values]) {
      if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(name) || /[\x00-\x1f\x7f]/.test(String(value))) continue;
      lines.push(`${name}: ${value}`);
    }
  }
  return lines.join('\r\n') + '\r\n\r\n';
}

/** Host-only authenticated bridge. Remote cookies never cross the local browser boundary. */
export class RemoteBridge {
  #manager;
  #connection;
  #timeout;
  #maxBootstrap;
  #maxResponse;
  #sessions = new Map();
  #pending = new Set();
  #unsubscribe;
  #disposed = false;
  #disposePromise;

  constructor({ manager, connection, requestTimeoutMs = 15000, maxBootstrapBytes = 2 * 1024 * 1024, maxResponseBytes = 8 * 1024 * 1024 } = {}) {
    if (!manager || typeof manager.get !== 'function' || typeof manager.getOpenUrl !== 'function' || typeof manager.onChange !== 'function') throw new TypeError('RemoteBridge requires a connection manager.');
    if (!connection || typeof connection.admit !== 'function') throw new TypeError('RemoteBridge requires DSH connection admission.');
    if (!Number.isSafeInteger(requestTimeoutMs) || requestTimeoutMs < 1 || !Number.isSafeInteger(maxBootstrapBytes) || maxBootstrapBytes < 1 || !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) throw new TypeError('RemoteBridge limits must be positive safe integers.');
    this.#manager = manager;
    this.#connection = connection;
    this.#timeout = requestTimeoutMs;
    this.#maxBootstrap = maxBootstrapBytes;
    this.#maxResponse = maxResponseBytes;
    this.#unsubscribe = manager.onChange(state => {
      const session = this.#sessions.get(state.id);
      if (session && (state.status !== 'connected' || Number(state.localPort) !== session.port)) this.#invalidate(session);
    });
  }

  describe(id) {
    try {
      const state = this.#state(id);
      const { host, dshPath, profile, cwd } = state;
      const namespace = createHash('sha256').update(JSON.stringify([host, profile, cwd, dshPath])).digest('hex').slice(0, 24);
      return { id, host, dshPath, profile, cwd, url: `${SSH_PROXY_PREFIX}${id}/`, namespace };
    } catch (error) { throw safeFailure(error); }
  }

  readBootstrap(id) { return this.#watch(this.#bootstrap(id)); }
  proxyHttp(id, remotePath, req, res) { return this.#watch(this.#http(id, remotePath, req, res)); }
  proxyUpgrade(id, remotePath, req, socket, head = Buffer.alloc(0)) { return this.#watch(this.#upgrade(id, remotePath, req, socket, head)); }

  /**
   * Authenticated Host-side request to the remote DSH over one live connection.
   * Reuses that connection's owner credential; nothing crosses the local browser boundary.
   */
  request(id, path, { method = 'GET', body, headers, signal, maxResponseBytes } = {}) {
    return this.#watch(this.#hostRequest(id, method, path, body, headers, signal, maxResponseBytes));
  }

  /** JSON convenience for Host-side callers: send a JSON payload and parse a JSON reply. */
  async requestJson(id, path, payload, { method = 'POST', signal, maxResponseBytes } = {}) {
    const text = payload === undefined ? undefined : JSON.stringify(payload);
    const response = await this.request(id, path, {
      method,
      ...(text === undefined ? {} : { body: text, headers: { 'content-type': 'application/json' } }),
      ...(signal ? { signal } : {}),
      ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
    });
    if (response.status < 200 || response.status >= 300) {
      throw new BridgeFailure(`Remote DSH request failed with status ${response.status}.`, response.status === 401 || response.status === 403 ? response.status : 502);
    }
    try { return { status: response.status, headers: response.headers, value: JSON.parse(response.body.toString('utf8')) }; }
    catch { throw new BridgeFailure('Remote DSH returned a response that is not JSON.', 502); }
  }


  /**
   * Authenticated Host-side WebSocket upgrade over one live connection.
   * Hands back the raw post-handshake duplex socket; framing is the caller's protocol.
   */
  upgrade(id, path, { headers, signal, subprotocols } = {}) {
    return this.#watch(this.#hostUpgrade(id, path, headers, signal, subprotocols));
  }

  dispose() {
    if (!this.#disposePromise) {
      this.#disposed = true;
      this.#unsubscribe?.();
      for (const session of [...this.#sessions.values()]) this.#invalidate(session);
      this.#disposePromise = Promise.allSettled([...this.#pending]).then(() => {});
    }
    return this.#disposePromise;
  }

  #watch(promise) {
    this.#pending.add(promise);
    promise.then(() => this.#pending.delete(promise), () => this.#pending.delete(promise));
    return promise;
  }

  #state(id) {
    checkId(id);
    if (this.#disposed) throw disconnected();
    const state = this.#manager.get(id);
    if (!state || state.status !== 'connected') throw disconnected();
    return state;
  }

  #session(id) {
    const state = this.#state(id);
    let url;
    try { url = new URL(this.#manager.getOpenUrl(id)); } catch { throw disconnected(); }
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url[['pass', 'word'].join('')] || url.pathname !== '/' || url.hash || !/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535 || Number(state.localPort) !== Number(url.port) || url.href.length > 8192 || url.searchParams.getAll('token').length !== 1 || !url.searchParams.get('token') || [...url.searchParams.keys()].some(key => key !== 'token')) {
      throw new BridgeFailure('Remote DSH endpoint must be an authenticated HTTP loopback root.', 502);
    }
    let session = this.#sessions.get(id);
    if (session && session.loginUrl !== url.href) { this.#invalidate(session); session = undefined; }
    if (!session) {
      session = { id, port: Number(url.port), authority: url.host, origin: url.origin, loginUrl: url.href, cookie: null, authenticating: null, authenticationWaiters: 0, cancelAuthentication: null, closed: false, active: new Set() };
      this.#sessions.set(id, session);
    }
    return session;
  }

  #assert(session) { if (this.#disposed || session.closed || this.#sessions.get(session.id) !== session) throw disconnected(); }
  #track(session, abort) { this.#assert(session); session.active.add(abort); return () => session.active.delete(abort); }
  #invalidate(session) {
    if (session.closed) return;
    session.closed = true;
    session.cookie = null;
    session.loginUrl = null;
    if (this.#sessions.get(session.id) === session) this.#sessions.delete(session.id);
    for (const abort of [...session.active]) { try { abort(disconnected()); } catch { /* cancel the remaining owned requests even if a peer already closed */ } }
    session.active.clear();
  }

  #admit(req) {
    let result;
    try { result = this.#connection.admit(req); } catch { throw new BridgeFailure('DSH authentication required.', 401); }
    if (result?.rejection) throw new BridgeFailure('DSH authentication required.', result.rejection === 403 ? 403 : 401);
    if (result?.peer?.principal?.kind !== 'owner') throw new BridgeFailure('Remote DSH access requires the local DSH owner.', 403);
  }

  async #cookie(session, signal) {
    this.#assert(session);
    if (session.cookie) return session.cookie;
    if (!session.authenticating) {
      session.authenticating = (async () => {
        const login = new URL(session.loginUrl);
        const result = await this.#buffered(session, login.pathname + login.search, null, 16384, abort => { session.cancelAuthentication = abort; });
        this.#assert(session);
        if (result.status !== 303 || result.headers.location !== './') throw new BridgeFailure('Remote DSH authentication was rejected.', 502);
        const values = result.headers['set-cookie'] ?? [];
        const cookie = values.find(value => /^dsh-auth-[A-Za-z0-9_-]+=[^;\s]+(?:;|$)/.test(value) && /(?:^|;)\s*HttpOnly\s*(?:;|$)/i.test(value));
        if (!cookie || cookie.length > 16384 || /[\x00-\x1f\x7f]/.test(cookie)) throw new BridgeFailure('Remote DSH did not provide a browser credential.', 502);
        session.cookie = cookie.split(';', 1)[0];
        return session.cookie;
      })().catch(error => { throw safeFailure(error); }).finally(() => { session.authenticating = null; session.cancelAuthentication = null; });
    }
    const pending = session.authenticating;
    session.authenticationWaiters++;
    try { return await untilAborted(pending, signal); }
    finally {
      session.authenticationWaiters--;
      if (!session.authenticationWaiters && !session.cookie && session.authenticating === pending) session.cancelAuthentication?.(new BridgeFailure('Remote DSH request was cancelled.', 502));
    }
  }

  async #bootstrap(id) {
    try {
      const session = this.#session(id);
      const cookie = await this.#cookie(session);
      this.#assert(session);
      const result = await this.#buffered(session, '/', cookie, this.#maxBootstrap);
      if (result.status !== 200) throw new BridgeFailure('Remote DSH bootstrap is unavailable.', 502);
      if (result.headers['content-encoding'] && result.headers['content-encoding'] !== 'identity') throw new BridgeFailure('Remote DSH bootstrap encoding is unsupported.', 502);
      return result.body.toString('utf8');
    } catch (error) { throw safeFailure(error); }
  }

  #buffered(session, path, cookie, limit, observeAbort) {
    return this.#watch(new Promise((resolve, reject) => {
      let response;
      let settled = false;
      let untrack = () => {};
      let timer;
      const done = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        untrack();
        error ? reject(safeFailure(error)) : resolve(value);
      };
      let upstream;
      const abort = error => { done(error); upstream?.destroy(); response?.destroy(); };
      try {
        observeAbort?.(abort);
        untrack = this.#track(session, abort);
        upstream = httpRequest({ hostname: '127.0.0.1', port: session.port, method: 'GET', path,
          headers: { host: session.authority, origin: session.origin, 'accept-encoding': 'identity', ...(cookie ? { cookie } : {}) }, agent: false,
        }, remote => {
          response = remote;
          const chunks = [];
          let bytes = 0;
          if (Number(remote.headers['content-length']) > limit) { abort(new BridgeFailure('Remote DSH bootstrap exceeds the size limit.', 502)); return; }
          remote.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > limit) { abort(new BridgeFailure('Remote DSH bootstrap exceeds the size limit.', 502)); return; }
            chunks.push(chunk);
          });
          remote.on('end', () => done(null, { status: remote.statusCode, headers: remote.headers, body: Buffer.concat(chunks, bytes) }));
          remote.on('error', error => done(error));
          remote.on('aborted', () => done(unavailable()));
        });
        upstream.on('error', error => done(error));
        timer = setTimeout(() => abort(timeoutFailure()), this.#timeout);
        upstream.end();
      } catch (error) { abort(error); }
    }));
  }

  async #http(id, remotePath, req, res) {
    let session;
    let upstream;
    let response;
    let untrack = () => {};
    let clientClosed = false;
    const clientCancel = new AbortController();
    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    const onClientClose = () => {
      if (res.writableEnded) return;
      clientClosed = true;
      clientCancel.abort();
      upstream?.destroy(); response?.destroy(); finish();
    };
    const onRequestAbort = () => { clientClosed = true; clientCancel.abort(); upstream?.destroy(); response?.destroy(); finish(); };
    try {
      this.#admit(req);
      checkPath(remotePath);
      if (!['GET', 'POST', 'HEAD'].includes(req.method)) throw new BridgeFailure('Remote DSH supports GET, POST and HEAD.', 405);
      session = this.#session(id);
      res.on('close', onClientClose);
      res.on('finish', finish);
      req.on('aborted', onRequestAbort);
      req.on('error', onRequestAbort);
      const cookie = await this.#cookie(session, clientCancel.signal);
      this.#assert(session);
      if (clientClosed || res.destroyed) return;
      untrack = this.#track(session, error => { upstream?.destroy(); response?.destroy(); sendJson(res, error); finish(); });
      upstream = httpRequest({ hostname: '127.0.0.1', port: session.port, method: req.method, path: remotePath, headers: requestHeaders(req, session, cookie), agent: false }, remote => {
        response = remote;
        if (remote.statusCode === 401) session.cookie = null;
        res.writeHead(remote.statusCode ?? 502, responseHeaders(remote, session, remotePath));
        remote.on('error', () => { res.destroy(); finish(); });
        remote.on('aborted', () => { res.destroy(); finish(); });
        remote.pipe(res);
      });
      upstream.on('error', error => { if (!clientClosed) sendJson(res, safeFailure(error)); finish(); });
      upstream.setTimeout(this.#timeout, () => { upstream.destroy(timeoutFailure()); });
      req.pipe(upstream);
      await completed;
    } catch (error) { if (!clientClosed) sendJson(res, safeFailure(error)); }
    finally {
      untrack();
      res.off('close', onClientClose);
      res.off('finish', finish);
      req.off('aborted', onRequestAbort);
      req.off('error', onRequestAbort);
    }
  }


  async #hostRequest(id, method, path, body, extraHeaders, signal, maxResponseBytes) {
    const allowed = checkPath(path);
    const verb = String(method ?? 'GET').toUpperCase();
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].includes(verb)) throw new BridgeFailure('Remote DSH request method is not allowed.', 400);
    const payload = body === undefined || body === null ? undefined : Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    if (payload && payload.length > 4 * 1024 * 1024) throw new BridgeFailure('Remote DSH request body is too large.', 400);
    const limit = maxResponseBytes === undefined ? this.#maxResponse : maxResponseBytes;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 32 * 1024 * 1024) throw new BridgeFailure('Remote DSH response limit is invalid.', 400);
    const session = this.#session(id);
    return this.#cookie(session, signal).then(cookie => {
      this.#assert(session);
      return new Promise((resolve, reject) => {
        let upstream;
        let response;
        let settled = false;
        let untrack = () => {};
        let timer;
        const onAbort = () => abort(new BridgeFailure('Remote DSH request was cancelled.', 502));
        const done = (error, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          untrack();
          signal?.removeEventListener('abort', onAbort);
          error ? reject(safeFailure(error)) : resolve(value);
        };
        const abort = error => { done(error); upstream?.destroy(); response?.destroy(); };
        try {
          if (signal?.aborted) { abort(new BridgeFailure('Remote DSH request was cancelled.', 502)); return; }
          untrack = this.#track(session, abort);
          signal?.addEventListener('abort', onAbort, { once: true });
          const headers = { ...sanitizedHeaders(extraHeaders ?? {}) };
          headers.host = session.authority;
          headers.origin = session.origin;
          headers.cookie = cookie;
          headers.accept = headers.accept ?? 'application/json';
          headers['accept-encoding'] = 'identity';
          if (payload) headers['content-length'] = String(payload.length);
          upstream = httpRequest({ hostname: '127.0.0.1', port: session.port, method: verb, path: allowed, headers, agent: false }, remote => {
            response = remote;
            const chunks = [];
            let bytes = 0;
            if (Number(remote.headers['content-length']) > limit) { abort(new BridgeFailure('Remote DSH response exceeds the size limit.', 502)); return; }
            remote.on('data', chunk => {
              bytes += chunk.length;
              if (bytes > limit) { abort(new BridgeFailure('Remote DSH response exceeds the size limit.', 502)); return; }
              chunks.push(chunk);
            });
            remote.on('end', () => done(null, { status: remote.statusCode, headers: remote.headers, body: Buffer.concat(chunks, bytes) }));
            remote.on('error', error => done(error));
            remote.on('aborted', () => done(unavailable()));
          });
          upstream.on('error', error => done(error));
          upstream.setTimeout(this.#timeout, () => upstream.destroy(timeoutFailure()));
          if (payload) upstream.end(payload); else upstream.end();
        } catch (error) { abort(error); }
      });
    });
  }

  async #hostUpgrade(id, path, extraHeaders, signal, subprotocols) {
    const allowed = checkPath(path);
    if (subprotocols !== undefined && (!Array.isArray(subprotocols) || subprotocols.some(name => typeof name !== 'string' || !name))) {
      throw new BridgeFailure('Remote DSH WebSocket subprotocols are invalid.', 400);
    }
    const session = this.#session(id);
    const cookie = await this.#cookie(session, signal);
    this.#assert(session);
    return new Promise((resolve, reject) => {
      let upstream;
      let peer;
      let settled = false;
      let untrack = () => {};
      let timer;
      const key = randomBytes(16).toString('base64');
      const onAbort = () => abort(new BridgeFailure('Remote DSH request was cancelled.', 502));
      const done = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        error ? reject(safeFailure(error)) : resolve(value);
      };
      // The tracker keeps the socket alive for the session: disposing the bridge or
      // losing the connection closes it, and a closed socket stops tracking it.
      const close = error => { done(error); untrack(); upstream?.destroy(); peer?.destroy(); };
      try {
        if (signal?.aborted) { done(new BridgeFailure('Remote DSH request was cancelled.', 502)); return; }
        untrack = this.#track(session, error => { upstream?.destroy(); peer?.destroy(); done(error); });
        signal?.addEventListener('abort', onAbort, { once: true });
        const headers = { ...sanitizedHeaders(extraHeaders ?? {}) };
        headers.host = session.authority;
        headers.origin = session.origin;
        headers.cookie = cookie;
        headers.connection = 'Upgrade';
        headers.upgrade = 'websocket';
        headers['sec-websocket-version'] = '13';
        headers['sec-websocket-key'] = key;
        if (subprotocols?.length) headers['sec-websocket-protocol'] = subprotocols.join(', ');
        upstream = httpRequest({ hostname: '127.0.0.1', port: session.port, method: 'GET', path: allowed, headers, agent: false });
        upstream.on('error', error => close(error));
        upstream.on('response', response => {
          if (response.statusCode === 401) session.cookie = null;
          response.destroy();
          close(new BridgeFailure('Remote DSH rejected the WebSocket upgrade.', 502));
        });
        upstream.on('upgrade', (response, socket, head) => {
          // The remote DSH gateway terminates the mux upgrade itself, so its
          // Sec-WebSocket-Accept is not derived from this key; what must hold is a
          // 101 that upgrades to websocket.
          if (response.statusCode !== 101 || !/websocket/i.test(String(response.headers.upgrade ?? '')) || !response.headers['sec-websocket-accept']) {
            socket.destroy();
            close(new BridgeFailure('Remote DSH returned an invalid WebSocket handshake.', 502));
            return;
          }
          peer = socket;
          upstream.setTimeout(0);
          socket.on('error', () => close());
          socket.on('close', () => close());
          done(null, { socket, head });
        });
        upstream.setTimeout(this.#timeout, () => upstream.destroy(timeoutFailure()));
        upstream.end();
      } catch (error) { close(error); }
    });
  }

  async #upgrade(id, remotePath, req, socket, head) {
    let upstream;
    let remoteSocket;
    let untrack = () => {};
    let ended = false;
    let upgraded = false;
    const clientCancel = new AbortController();
    let finish;
    const completed = new Promise(resolve => { finish = resolve; });
    const close = () => {
      if (ended) return;
      ended = true;
      clientCancel.abort();
      upstream?.destroy(); remoteSocket?.destroy(); socket.destroy(); finish();
    };
    // Even rejected upgrades need a socket error listener until close.
    socket.on('error', close);
    socket.on('close', close);
    try {
      this.#admit(req);
      checkPath(remotePath);
      if (req.method !== 'GET' || String(req.headers.upgrade ?? '').toLowerCase() !== 'websocket') throw new BridgeFailure('A WebSocket upgrade is required.', 400);
      const session = this.#session(id);
      const cookie = await this.#cookie(session, clientCancel.signal);
      this.#assert(session);
      if (ended || socket.destroyed) return;
      untrack = this.#track(session, error => {
        if (upgraded) close();
        else { upstream?.destroy(); sendSocketError(socket, error); finish(); }
      });
      upstream = httpRequest({ hostname: '127.0.0.1', port: session.port, method: 'GET', path: remotePath, headers: requestHeaders(req, session, cookie, true), agent: false });
      upstream.on('error', error => { if (!ended) { sendSocketError(socket, safeFailure(error)); upstream.destroy(); finish(); } });
      upstream.on('response', response => {
        if (response.statusCode === 401) session.cookie = null;
        response.destroy();
        sendSocketError(socket, new BridgeFailure('Remote DSH rejected the WebSocket upgrade.', 502));
        finish();
      });
      upstream.on('upgrade', (response, peerSocket, remoteHead) => {
        remoteSocket = peerSocket;
        if (ended || session.closed || response.statusCode !== 101 || String(response.headers.upgrade ?? '').toLowerCase() !== 'websocket') { close(); return; }
        upgraded = true;
        upstream.setTimeout(0);
        const headers = responseHeaders(response, session, remotePath);
        headers.connection = 'Upgrade'; headers.upgrade = 'websocket';
        socket.write(socketHandshake(headers));
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remoteSocket.write(head);
        remoteSocket.on('error', close);
        remoteSocket.on('close', close);
        socket.pipe(remoteSocket);
        remoteSocket.pipe(socket);
      });
      upstream.setTimeout(this.#timeout, () => upstream.destroy(timeoutFailure()));
      upstream.end();
      await completed;
    } catch (error) { if (!ended) sendSocketError(socket, safeFailure(error)); }
    finally { untrack(); }
  }
}
