import { createHash } from 'node:crypto';
import { SSH_PROXY_PREFIX } from './ssh/remote-bridge.js';

const OFFICIAL = /^@deepseek-ai\/[a-z0-9][a-z0-9._-]{0,120}$/;
const ID = /^[A-Za-z0-9-]{1,80}$/;
const REVISION = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_BOOTSTRAP = 2 * 1024 * 1024;
const MAX_RESOURCE = 8 * 1024 * 1024;
const STATIC_MODULES = new Set([
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', 'zod',
  '@deepseek-ai/cordis', '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store', '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives', '@deepseek-ai/dsh-client-ui-dockkit',
]);
const OMIT_GLOBAL = /(?:TRANSPORT|TOKEN|COOKIE|SECRET|PASSWORD|CREDENTIAL|AUTHORIZATION|STORAGE|MODULE_LOADER|FILE_UPLOAD|HOST_PATHS|BOOT_READY|SSH_)/i;
const OMIT_FIELD = /^(?:__proto__|prototype|constructor|(?:access|refresh|launch)?token|cookie|password|secret|credentials?|authorization)$/i;

function failure(code, message) {
  return Object.assign(new Error(message), { code: `t3-native/${code}` });
}
function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function checkId(value, name) {
  if (typeof value !== 'string' || !ID.test(value)) throw failure('invalid-request', `Invalid ${name}.`);
}
function checkCancelled(signal) { signal?.throwIfAborted(); }
function cancellable(operation, signal) {
  if (!signal) return operation;
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
    Promise.resolve(operation).then(value => {
      signal.removeEventListener('abort', abort);
      resolve(value);
    }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}
function sameRelease(left, right) {
  return left.version === right.version && (!left.commit || !right.commit || left.commit === right.commit);
}
function releaseOf(value) {
  if (!plain(value) || typeof value.version !== 'string' || !REVISION.test(value.version)
    || (value.commit != null && (typeof value.commit !== 'string' || !REVISION.test(value.commit)))) {
    throw failure('invalid-graph', 'The DSH release identity is invalid.');
  }
  return { version: value.version, ...(value.commit ? { commit: value.commit } : {}) };
}

// DSH emits structured JSON assignments; neither remote HTML nor scripts are evaluated.
function bootstrapGlobals(html) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > MAX_BOOTSTRAP) throw failure('invalid-bootstrap', 'Remote DSH bootstrap is too large or invalid.');
  const globals = Object.create(null);
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const assignment = /^\s*globalThis\[("(?:[^"\\]|\\.)*")\]\s*=\s*([\s\S]*?)\s*;?\s*$/.exec(match[1]);
    if (!assignment) continue;
    let name, value;
    try { name = JSON.parse(assignment[1]); value = JSON.parse(assignment[2]); } catch { continue; }
    if (typeof name !== 'string' || !/^__DSH_[A-Z0-9_]+__$/.test(name)) continue;
    if (Object.hasOwn(globals, name)) throw failure('invalid-bootstrap', `Duplicate bootstrap field ${name}.`);
    globals[name] = value;
  }
  if (!globals.__DSH_BOOT__) throw failure('invalid-bootstrap', 'Remote DSH did not provide a structured Client graph.');
  return globals;
}

function graphOf(input) {
  if (!plain(input) || typeof input.rev !== 'string' || !REVISION.test(input.rev)
    || !Array.isArray(input.entries) || input.entries.length > 1000
    || !Array.isArray(input.batches) || input.batches.length > 1000) {
    throw failure('invalid-graph', 'The DSH Client graph is unsupported.');
  }
  const seen = new Set();
  const entries = input.entries.map(row => {
    if (!plain(row) || typeof row.id !== 'string' || seen.has(row.id)
      || typeof row.url !== 'string' || row.url.length > 16384
      || typeof row.rev !== 'string' || !REVISION.test(row.rev)
      || !Array.isArray(row.inject ?? []) || !Array.isArray(row.external ?? [])
      || [...(row.inject ?? []), ...(row.external ?? [])].some(dep => typeof dep !== 'string' || dep.length > 300)) {
      throw failure('invalid-graph', 'The DSH Client graph contains an invalid package.');
    }
    seen.add(row.id);
    return { id: row.id, url: row.url, rev: row.rev, inject: [...(row.inject ?? [])], external: [...(row.external ?? [])], ...(row.immediately === true ? { immediately: true } : {}) };
  });
  return { rev: input.rev, release: releaseOf(input.release), entries, batches: input.batches };
}

function packageOf(request) {
  const parts = request.split('/');
  return request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}
function clientPath(row) {
  const expected = `plugins/??${row.id}/client.js&rev=${row.rev}`;
  if (row.url !== expected && row.url !== '/' + expected) throw failure('invalid-resource', 'The trusted Client resource URL is unsupported.');
  return '/' + expected;
}
function selectGraph(trusted, remote) {
  const offered = new Set(remote.entries.map(row => row.id));
  let entries = trusted.entries.filter(row => OFFICIAL.test(row.id) && offered.has(row.id));
  for (;;) {
    const selected = new Set(entries.map(row => row.id));
    const next = entries.filter(row => [...row.inject, ...row.external].every(dep =>
      STATIC_MODULES.has(dep) || STATIC_MODULES.has(packageOf(dep)) || selected.has(packageOf(dep))));
    if (next.length === entries.length) break;
    entries = next;
  }
  if (!entries.length) throw failure('unsupported-release', 'No compatible official Client packages are available.');
  for (const row of entries) clientPath(row);
  const rev = createHash('sha256').update(JSON.stringify([trusted.rev, remote.rev, entries])).digest('hex');
  return {
    rev, release: { ...trusted.release }, entries,
    batches: entries.map(row => ({ phase: row.id === '@deepseek-ai/dsh-client-modules' ? 'bootstrap' : 'application', url: row.url, rev: row.rev, entries: [row.id] })),
  };
}
function safeData(value) {
  if (Array.isArray(value)) return value.map(safeData);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !OMIT_FIELD.test(key)).map(([key, item]) => [key, safeData(item)]));
}
function safeGlobals(globals, graph) {
  const output = Object.fromEntries(Object.entries(globals)
    .filter(([name]) => name !== '__DSH_BOOT__' && !OMIT_GLOBAL.test(name))
    .map(([name, value]) => [name, safeData(value)]));
  output.__DSH_BOOT__ = graph;
  return output;
}

async function readScript(response, signal) {
  if (!(response instanceof Response) || response.status !== 200) throw failure('resource-unavailable', 'The trusted Client resource is unavailable.');
  const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (type !== 'text/javascript' && type !== 'application/javascript') {
    await response.body?.cancel();
    throw failure('invalid-resource', 'The trusted Client resource is not JavaScript.');
  }
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_RESOURCE) {
    await response.body?.cancel();
    throw failure('resource-too-large', 'The trusted Client resource exceeds the size limit.');
  }
  const reader = response.body?.getReader();
  if (!reader) throw failure('invalid-resource', 'The trusted Client resource has no body.');
  const chunks = [];
  let size = 0;
  const abort = () => { void reader.cancel(signal.reason).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    for (;;) {
      checkCancelled(signal);
      const item = await reader.read();
      if (item.done) break;
      size += item.value.byteLength;
      if (size > MAX_RESOURCE) throw failure('resource-too-large', 'The trusted Client resource exceeds the size limit.');
      chunks.push(item.value);
    }
    checkCancelled(signal);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)); }
    catch { throw failure('invalid-resource', 'The trusted Client resource is not valid UTF-8.'); }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally {
    signal?.removeEventListener('abort', abort);
    reader.releaseLock();
  }
}

/** Trusted native Client code, scoped to one already-connected device without navigating. */
export function createNativeRuntimeBroker({ ssh, bridge, webServer, connection }) {
  if (!ssh || typeof ssh.connectionFor !== 'function' || !bridge || typeof bridge.readBootstrap !== 'function'
    || !webServer || typeof webServer.collectIndexInjections !== 'function' || typeof webServer.readResource !== 'function'
    || !connection?.browserPeer) throw new TypeError('The native runtime broker requires SSH, bootstrap, resource, and browser admission services.');
  const records = new Map();

  function live(targetId, expectedId) {
    checkId(targetId, 'target ID');
    const state = ssh.connectionFor(targetId);
    if (!state || state.status !== 'connected') {
      records.delete(targetId);
      throw failure('connection-changed', 'The device connection is unavailable or has changed.');
    }
    if (expectedId !== undefined && state.id !== expectedId) {
      throw failure('connection-changed', 'The device connection is unavailable or has changed.');
    }
    checkId(state.id, 'connection ID');
    return state;
  }

  async function describe(targetId, { signal } = {}) {
    checkCancelled(signal);
    const state = live(targetId);
    const localRows = webServer.collectIndexInjections(connection.browserPeer);
    const trustedLocal = graphOf(localRows.find(row => row.kind === 'global' && row.name === '__DSH_BOOT__')?.value);
    const remoteGlobals = bootstrapGlobals(await cancellable(bridge.readBootstrap(state.id, { signal }), signal));
    checkCancelled(signal);
    live(targetId, state.id);
    const remote = graphOf(remoteGlobals.__DSH_BOOT__);
    if (!sameRelease(trustedLocal.release, remote.release)) {
      throw failure('unsupported-release', 'The remote DSH release must match the local DSH release.');
    }
    const graph = selectGraph(trustedLocal, remote);
    const description = bridge.describe(state.id);
    if (typeof description?.namespace !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(description.namespace)) throw failure('invalid-bootstrap', 'The SSH storage namespace is invalid.');
    const baseUrl = `${SSH_PROXY_PREFIX}${state.id}/`;
    const runtimeKey = 't3-' + createHash('sha256').update(JSON.stringify([targetId, state.id, graph.rev, graph.release])).digest('hex').slice(0, 40);
    const descriptor = {
      targetId, connectionId: state.id, namespace: description.namespace, baseUrl,
      release: { ...graph.release }, graph, globals: safeGlobals(remoteGlobals, graph), runtimeKey,
    };
    live(targetId, state.id);
    records.set(targetId, { descriptor, entries: new Map(graph.entries.map(row => [row.id, row])) });
    return structuredClone(descriptor);
  }

  async function resource(targetId, { connectionId, packageId, file, runtimeKey, signal } = {}) {
    checkCancelled(signal);
    checkId(connectionId, 'connection ID');
    live(targetId, connectionId);
    const record = records.get(targetId);
    if (!record || record.descriptor.connectionId !== connectionId) throw failure('describe-required', 'Prepare this device runtime before requesting its Client resources.');
    if (runtimeKey !== undefined && runtimeKey !== record.descriptor.runtimeKey) throw failure('connection-changed', 'The device Client graph has changed.');
    if (typeof packageId !== 'string' || !OFFICIAL.test(packageId) || !record.entries.has(packageId)
      || typeof file !== 'string' || file.length > 200 || !(file === 'client.js' || /^client\.[A-Za-z0-9][A-Za-z0-9._-]*\.js$/.test(file)) || /^client\.(?:node|server)(?:\.|$)/.test(file)) {
      throw failure('invalid-resource', 'The requested Client resource is not in this device graph.');
    }
    const row = record.entries.get(packageId);
    const path = file === 'client.js' ? clientPath(row) : `/plugins/${packageId}/${file}?rev=${row.rev}`;
    const response = await webServer.readResource(new Request(new URL(path, webServer.getOrigin()), { signal }), connection.browserPeer);
    const source = await readScript(response, signal);
    live(targetId, connectionId);
    if (records.get(targetId) !== record) throw failure('connection-changed', 'The device runtime changed while loading its Client resource.');
    const key = JSON.stringify(record.descriptor.runtimeKey);
    const wrapped = `;(function(realm){\nif(!realm)throw new Error('Device runtime is not registered');\n(function(window,globalThis,localStorage,sessionStorage,document){\n${source}\n})(realm.window,realm.globalThis,realm.localStorage,realm.sessionStorage,realm.document);\n})(globalThis.__T3_DEVICE_REALMS__.get(${key}));\n`;
    return new Response(wrapped, { headers: {
      'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    } });
  }

  return { describe, resource };
}
