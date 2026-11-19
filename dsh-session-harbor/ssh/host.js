import { pipeline } from 'node:stream/promises';
import { z } from 'zod';
import { SSH_PROXY_PREFIX } from './remote-bridge.js';

export const SSH_SETTINGS_PATH = '/api/t3-ssh';
const id = z.string().regex(/^[A-Za-z0-9-]{1,80}$/);
const options = z.object({
  host: z.string().min(1).max(512),
  label: z.string().max(120).optional(),
  cwd: z.string().max(4096).optional(),
  dshPath: z.string().max(4096).optional(),
  profile: z.string().max(4096).optional(),
}).strict();
const target = options.extend({ id });
export const sshTargetsSpec = { name: 'local_t3_ssh', version: 1, tables: { targets: { valueSchema: target } } };
const actionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('refresh') }).strict(),
  z.object({ action: z.literal('save'), target: options.extend({ id: id.optional() }) }).strict(),
  ...['connect', 'disconnect', 'remove'].map(action => z.object({ action: z.literal(action), id }).strict()),
]);
const maxBodyBytes = 48 * 1024;
const apiPath = /^\/api(?:\/[^?]*)?(?:\?.*)?$/;
const assetPath = /^\/plugins\/@deepseek-ai\/[a-z0-9][a-z0-9._-]*\/assets\/[^?#]+$/;

function sendJson(res, status, value) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

function admissionStatus(admission) {
  if (admission?.rejection) return admission.rejection;
  return admission?.peer?.principal?.kind === 'owner' ? 200 : 403;
}

async function readAction(req) {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) throw new Error('Expected application/json');
  if (Number(req.headers['content-length']) > maxBodyBytes) throw new Error('SSH request is too large');
  const chunks = [];
  let bytes = 0;
  // Stop reading an oversized request without destroying the response socket.
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxBodyBytes) throw new Error('SSH request is too large');
    chunks.push(buffer);
  }
  const result = actionSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  if (!result.success) throw new Error('Invalid SSH settings request');
  return result.data;
}

function publicConnection({ id, host, label, dshPath, profile, cwd, status, error }) {
  return { id, host, label, dshPath, profile, cwd, status, error };
}

function publicTarget({ id, host, label, dshPath, profile, cwd }) {
  return { id, host, label, dshPath, profile, cwd };
}

function publicSnapshot({ config, targets, connections }) {
  return {
    config: {
      hosts: config.hosts.map(({ alias, hostname, user }) => ({ alias, hostname, user })),
      warnings: config.warnings,
    },
    targets: targets.map(publicTarget),
    connections: connections.map(publicConnection),
  };
}

/** The settings dialog can act only with the local DSH owner's credentials. */
export function createSshSettingsHandler(connection, getService, removeMirror) {
  return async (req, res) => {
    const admission = connection.admit(req);
    const status = admissionStatus(admission);
    if (status !== 200) return sendJson(res, status, { error: 'SSH settings require the local DSH owner.' });
    if (!['GET', 'POST'].includes(req.method)) return sendJson(res, 405, { error: 'Use GET or POST.' });
    const ssh = getService();
    if (!ssh) {
      return sendJson(res, 503, { error: 'SSH settings are unavailable.' });
    }
    try {
      if (req.method === 'GET') return sendJson(res, 200, publicSnapshot(ssh.snapshot()));
      const request = await readAction(req);
      if (getService() !== ssh) return sendJson(res, 503, { error: 'The SSH service is unavailable.' });
      const result = await ssh.execute(request);
      if (request.action === 'remove' && result.removed) await removeMirror(request.id);
      if (request.action === 'refresh') return sendJson(res, 200, publicSnapshot(result));
      if (result.target) return sendJson(res, 200, { target: publicTarget(result.target) });
      if (result.connection) return sendJson(res, 200, { connection: publicConnection(result.connection) });
      return sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : 'SSH operation failed.' });
    }
  };
}

/** Per-connection transport for the embedded conversations and their trusted local assets. */
export function mountSshTransport({ webServer, connection, bridge, manager }) {
  const upgrades = new Map();
  const disposers = [];
  const dispose = () => {
    for (const stop of disposers.reverse()) stop();
    for (const stop of upgrades.values()) stop();
    upgrades.clear();
  };
  const update = state => {
    if (state.status !== 'connected') {
      upgrades.get(state.id)?.();
      upgrades.delete(state.id);
    } else if (!upgrades.has(state.id)) {
      const remotePath = '/api/remote.mux';
      const path = SSH_PROXY_PREFIX + state.id + remotePath;
      upgrades.set(state.id, webServer.registerUpgrade({ path, handler: (req, socket, head) => bridge.proxyUpgrade(state.id, remotePath, req, socket, head) }));
    }
  };
  try {
    disposers.push(webServer.register({ kind: 'prefix', path: SSH_PROXY_PREFIX.slice(0, -1), async handler(req, res) {
      const path = req.url ?? '';
      const match = path.startsWith(SSH_PROXY_PREFIX) && /^([A-Za-z0-9-]{1,80})(\/.*)$/.exec(path.slice(SSH_PROXY_PREFIX.length));
      if (!match) return sendJson(res, 404, { error: 'Unknown SSH device route.' });
      const [, connectionId, remotePath] = match;
      if (apiPath.test(remotePath)) return bridge.proxyHttp(connectionId, remotePath, req, res);
      const admission = connection.admit(req);
      const status = admissionStatus(admission);
      if (status !== 200) return sendJson(res, status, { error: 'SSH access requires the local DSH owner.' });
      if (!['GET', 'HEAD'].includes(req.method) || !assetPath.test(remotePath) || /%(?:2e|2f|5c|25)|[\\\x00-\x20\x7f]/i.test(remotePath)
        || remotePath.slice(1).split('/').some(part => !part || part === '.' || part === '..')) {
        return sendJson(res, 404, { error: 'Unknown SSH device route.' });
      }
      if (manager.get(connectionId)?.status !== 'connected') return sendJson(res, 503, { error: 'SSH device is disconnected.' });
      try {
        const resource = new Request(new URL(remotePath, webServer.getOrigin()), { method: req.method });
        const response = await webServer.readResource(resource, admission.peer);
        res.writeHead(response.status, Object.fromEntries(response.headers));
        if (response.body && req.method !== 'HEAD') await pipeline(response.body, res);
        else { await response.body?.cancel(); res.end(); }
      } catch {
        if (res.headersSent) res.destroy();
        else sendJson(res, 502, { error: 'Could not load the local device asset.' });
      }
    } }));
    disposers.push(manager.onChange(update));
    for (const state of manager.list()) update(state);
  } catch (error) {
    dispose();
    throw error;
  }
  return dispose;
}
