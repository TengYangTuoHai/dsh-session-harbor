import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { createPlacementController } from './placement-controller.js';
import { createRemoteIndex, REMOTE_INDEX_DOMAIN, remoteIndexSpec } from './remote-index.js';
import { TargetSupervisor } from './remote-supervisor.js';
import { createNativeRuntimeBroker } from './native-runtime-host.js';
import { settleExistingSessions } from './migration.js';
import { SshService } from './ssh/ssh-service.js';
import { RemoteBridge } from './ssh/remote-bridge.js';
import { createSshSettingsHandler, mountSshTransport, sshTargetsSpec, SSH_SETTINGS_PATH } from './ssh/host.js';

export const inject = ['storageDomain', 'workspaceRegistry', 'workspaceController', 'sessionController', 'connection', 'tools'];

// Preserve the on-disk domain when users replace the old bundle.
const DOMAIN = 'local_t3_session_sidebar';

import { PLACEMENT_CONTRACT } from './contract.js';

export { PLACEMENT_CONTRACT };
const recordSchema = z.object({
  settled: z.boolean(),
  settledAt: z.number().finite().nullable(),
  unsettledAt: z.number().finite().nullable(),
}).strict();
const actionSchema = z.object({
  sessionId: z.string().min(1).max(200),
  action: z.enum(['pin', 'unpin', 'settle', 'unsettle']),
}).strict();
const snapshotSchema = z.object({
  epoch: z.string().max(100).optional(),
  revision: z.number().int().nonnegative().optional(),
}).strict();
const migrationSchema = z.object({
  sessionIds: z.array(z.string()),
  next: z.number().int().nonnegative(),
  startedAt: z.number().finite(),
}).strict();

/** Serve trusted, device-scoped Client factories to the existing authenticated page. */
export function createNativeResourceHandler(connection, getBroker) {
  return async (req, res) => {
    const sendError = (status, message) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(message);
    };
    const admission = connection.admit(req);
    if ('rejection' in admission) return sendError(admission.rejection, 'DSH authentication required');
    if (admission.peer.principal.kind !== 'owner') return sendError(403, 'Device conversations require the DSH owner');
    if (req.method !== 'GET') return sendError(405, 'Use GET');
    const url = new URL(req.url, 'http://localhost');
    const targetId = url.pathname.slice('/t3-remote/native/'.length);
    if (!/^[A-Za-z0-9-]{1,80}$/.test(targetId)) return sendError(400, 'Invalid device');
    const controller = new AbortController();
    const abort = () => { if (!res.writableEnded) controller.abort(); };
    req.once('aborted', abort);
    res.once('close', abort);
    try {
      const broker = getBroker();
      if (!broker) return sendError(503, 'Device conversation support is unavailable');
      const response = await broker.resource(targetId, {
        connectionId: url.searchParams.get('connectionId'),
        packageId: url.searchParams.get('packageId'),
        file: url.searchParams.get('file') ?? 'client.js',
        runtimeKey: url.searchParams.get('runtimeKey'),
        signal: controller.signal,
      });
      const bytes = Buffer.from(await response.arrayBuffer());
      if (res.destroyed || controller.signal.aborted) return;
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(bytes);
    } catch (error) {
      if (!res.destroyed && !res.writableEnded) sendError(409, error instanceof Error ? error.message : 'Device resource unavailable');
    } finally {
      req.off('aborted', abort);
      res.off('close', abort);
    }
  };
}

export async function apply(ctx) {
  const domain = await ctx.storageDomain.open({
    name: DOMAIN, version: 1, tables: { placements: { valueSchema: recordSchema } },
  });
  const table = domain.table('placements');
  ctx.effect(() => () => domain.close());

  const epoch = randomUUID();
  let revision = 0;

  // A machine describes itself. The mirror on the other side never runs a command here,
  // so anything it wants to know about this box has to be said by this box. Optional in
  // the contract: an older mirror simply ignores that it is missing.
  const self = Object.freeze({ platform: String(process.platform).slice(0, 20), wsl: runsInsideWsl() });

  function runsInsideWsl() {
    if (process.env.WSL_DISTRO_NAME) return true;
    try {
      return /microsoft/i.test(readFileSync('/proc/version', 'utf8').slice(0, 512));
    } catch {
      return false;
    }
  }
  const waiters = new Set();
  // Liveness is a fact about this machine, not about whoever happens to be watching it.
  // The host already announces every start and stop; carrying it in the snapshot means a
  // mirror moves when the work moves instead of when the next heartbeat happens to land.
  const statuses = new Map();
  function report(sessionId, running) {
    if (typeof sessionId !== 'string' || !sessionId) return;
    if (statuses.get(sessionId) === running) return;
    statuses.set(sessionId, running);
    revision += 1;
    notify();
  }
  ctx.on('api-session/status', (sessionId, running) => report(sessionId, running === true));
  ctx.on('api-session/added', (summary) => report(summary?.sessionId, summary?.running === true));
  ctx.on('api-session/removed', (sessionId) => { if (statuses.delete(sessionId)) { revision += 1; notify(); } });
  let closed = false;
  const notify = () => { for (const done of [...waiters]) done(); };
  ctx.on('domain/changed', (change) => {
    if (change.domain !== DOMAIN) return;
    revision++;
    notify();
  });

  async function workspaceBaseline(signal) {
    const iterator = ctx.workspaceController.follow(signal)[Symbol.asyncIterator]();
    try {
      const first = await iterator.next();
      if (first.done || first.value.type !== 'baseline') throw new Error('Workspace baseline unavailable');
      return first.value.value;
    } finally {
      await iterator.return?.();
    }
  }

  const controller = createPlacementController({
    storage: {
      get: (id) => table.get(id),
      set: (id, value) => table.put(id, recordSchema.parse(value)),
    },
    host: {
      async getPinned(id) {
        const abort = new AbortController();
        try {
          return (await workspaceBaseline(abort.signal)).pinnedSessionIds.includes(id);
        } finally {
          abort.abort();
        }
      },
      async setPinned(id, pinned) {
        if (pinned) await ctx.workspaceRegistry.pinSession(id);
        else await ctx.workspaceRegistry.unpinSession(id);
      },
    },
  });

  const migrationDomain = await ctx.storageDomain.open({
    name: 'local_t3_sidebar_migrations', version: 1,
    tables: { migrations: { valueSchema: migrationSchema } },
  });
  ctx.effect(() => () => migrationDomain.close());
  const migrationAbort = new AbortController();
  ctx.effect(() => () => migrationAbort.abort());
  const migrationTable = migrationDomain.table('migrations');
  await settleExistingSessions({
    migrations: {
      get: (key) => migrationTable.get(key),
      put: (key, value) => migrationTable.put(key, migrationSchema.parse(value)),
    },
    placements: table,
    controller,
    listSessions: async (signal) => (await ctx.sessionController.list({}, signal)).items,
    listArchived: async (signal) => (await workspaceBaseline(signal)).archivedSessionIds,
  }, migrationAbort.signal);

  let operationTail = Promise.resolve();
  function perform(input, signal) {
    const { sessionId, action } = actionSchema.parse(input);
    const checkCancelled = () => {
      if (signal?.aborted) throw new Error('Request cancelled');
    };
    const operation = operationTail.then(async () => {
      checkCancelled();
      // The current Session Controller exposes list rather than inspect.
      // Validate without resuming the target Agent, within the action queue.
      const sessions = await ctx.sessionController.list({}, signal);
      if (!sessions.items.some((item) => item.sessionId === sessionId)) throw new Error('Session not found');
      checkCancelled();
      // Once started, the controller drains both writes even if the caller
      // disconnects: interruption between them would leave a partial change.
      await controller.apply(sessionId, action);
      return { sessionId, action };
    });
    operationTail = operation.catch(() => {});
    return operation;
  }

  function currentSnapshot() {
    return { contract: PLACEMENT_CONTRACT, epoch, revision, self, placements: Object.fromEntries(table.entries()), statuses: Object.fromEntries(statuses) };
  }
  function waitForChange(signal) {
    return new Promise((resolve) => {
      if (closed || signal.aborted) return resolve();
      let timer;
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', done);
        waiters.delete(done);
        resolve();
      };
      waiters.add(done);
      signal.addEventListener('abort', done, { once: true });
      timer = setTimeout(done, 25000);
    });
  }

  // Connection authenticates exact routes and refuses non-owner peers before
  // dispatch. Speak its ordinary unary envelope so the Client can use its
  // existing transport, including desktop base URLs and request cancellation.
  const envelopeSchema = z.object({
    type: z.literal('client-request'), rpcId: z.string().min(1).max(200),
    method: z.string(), payload: z.unknown(),
  }).strict();
  for (const endpoint of ['t3-session-sidebar/action', 't3-session-sidebar/snapshot']) {
    const dispose = ctx.connection.fetch.register({
      path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        let message;
        try {
          message = envelopeSchema.parse(await request.json());
          if (message.method !== endpoint) throw new Error('Unexpected endpoint');
        } catch {
          return new Response('Invalid request', { status: 400 });
        }
        let result;
        try {
          if (endpoint.endsWith('/action')) result = { ok: true, value: await perform(message.payload, request.signal) };
          else {
            const cursor = snapshotSchema.parse(message.payload);
            if (cursor.epoch === epoch && cursor.revision === revision) await waitForChange(request.signal);
            if (closed || request.signal.aborted) throw new Error('Request cancelled');
            result = { ok: true, value: currentSnapshot() };
          }
        } catch (error) {
          result = { ok: false, error: { code: 't3-sidebar/error', message: error instanceof Error ? error.message : String(error), details: {} } };
        }
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result });
      },
    });
    ctx.effect(() => dispose);
  }
  // Desktop may have only the native OS chooser. Use the installed browse
  // backend in a private scope to leave the application's chooser available.
  let folderBrowser;
  function localFolderBrowser() {
    return folderBrowser ??= (async () => {
      const configured = ctx.get('directoryPicker')?.capability();
      if (configured?.kind === 'browse') return configured;
      const anchor = ctx.get('profileContext')?.installAnchor;
      const require = createRequire(anchor ?? import.meta.url);
      const source = require.resolve('@deepseek-ai/dsh-host-directory-picker-browse');
      const { default: BrowseDirectoryPicker } = await import(pathToFileURL(source).href);
      if (closed) throw new Error('Directory browser is closed');
      const scoped = ctx.isolate('directoryPicker');
      await scoped.plugin(BrowseDirectoryPicker, { maxEntries: 1000 });
      return scoped.get('directoryPicker').capability();
    })().catch(error => { folderBrowser = undefined; throw error; });
  }
  const folderPath = z.string().min(1).max(4096).regex(/^[^\0]+$/);
  const folderList = z.object({ path: folderPath.optional() }).strict();
  const folderCreate = z.object({ path: folderPath, name: z.string().trim().min(1).max(200)
    .regex(/^[^/\\\0]+$/).refine(name => name !== '.' && name !== '..') }).strict();
  for (const endpoint of ['t3-project-directory/list', 't3-project-directory/create']) {
    const list = endpoint.endsWith('/list');
    const dispose = ctx.connection.fetch.register({
      path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        let message, input;
        try {
          message = envelopeSchema.parse(await request.json());
          if (message.method !== endpoint) throw new Error('Unexpected endpoint');
          input = (list ? folderList : folderCreate).parse(message.payload);
        } catch {
          return new Response('Invalid request', { status: 400 });
        }
        let result;
        try {
          request.signal.throwIfAborted();
          const browser = await localFolderBrowser();
          request.signal.throwIfAborted();
          const value = list ? await browser.list(input.path, request.signal) : await browser.createDirectory(input.path, input.name);
          result = { ok: true, value };
        } catch (error) {
          result = { ok: false, error: { code: 't3-project-directory/error', message: error?.message ?? String(error), details: {} } };
        }
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result });
      },
    });
    ctx.effect(() => dispose);
  }
  // Wake pending long polls before withdrawing their transport and storage.
  ctx.effect(() => () => { closed = true; notify(); });

  // The remote mirror is a local cache of data owned by the connected devices.
  let remoteClosed = false;
  let closeRemoteWeb;
  let supervisor = null;
  let nativeBroker = null;
  const remoteWaiters = new Set();
  const remoteNotify = () => { for (const done of [...remoteWaiters]) done(); };
  const remoteDomain = await ctx.storageDomain.open(remoteIndexSpec);
  let remoteDisposal;
  ctx.effect(() => () => {
    remoteClosed = true;
    remoteNotify();
    return remoteDisposal ??= (async () => {
      try { await closeRemoteWeb?.(); }
      finally { await remoteDomain.close(); }
    })();
  });
  const remoteLog = (level, message) => { try { ctx.logger?.[level]?.(message); } catch { /* diagnostics are contained */ } };
  const remoteIndex = createRemoteIndex({
    onWriteError(error) {
      remoteRevision += 1;
      remoteNotify();
      remoteLog('warn', 'Remote mirror persistence failed: ' + String(error?.message ?? error));
    },
    storage: {
      targets: remoteDomain.table('targets'),
      workspaces: remoteDomain.table('workspaces'),
      sessions: remoteDomain.table('sessions'),
    },
  });
  const remoteEpoch = randomUUID();
  let remoteRevision = 0;
  const remoteChanged = () => { remoteRevision += 1; remoteNotify(); };
  const readRemoteIndex = () => supervisor ? remoteIndex.snapshot() : { targets: {}, workspaces: {}, sessions: {} };
  ctx.on('domain/changed', (change) => {
    if (change.domain === REMOTE_INDEX_DOMAIN) remoteChanged();
  });

  ctx.inject(['webServer'], host => {
    if (remoteClosed) return;
    const { webServer, connection } = host;
    let disposed = false;
    let domain;
    let ssh;
    let bridge;
    let unmount;
    let ownedSupervisor;
    host.effect(() => webServer.register({
      kind: 'prefix', path: '/t3-remote/native',
      handler: createNativeResourceHandler(connection, () => nativeBroker),
    }));
    host.effect(() => webServer.register({
      kind: 'exact', path: SSH_SETTINGS_PATH,
      handler: createSshSettingsHandler(connection, () => ownedSupervisor && !disposed ? ssh : null, async targetId => {
        remoteIndex.removeTarget(targetId);
        await remoteIndex.flush();
      }),
    }));

    const initialize = (async () => {
      domain = await host.storageDomain.open(sshTargetsSpec);
      if (disposed || remoteClosed) return;
      ssh = new SshService({ targets: domain.table('targets') });
      await ssh.initialize();
      if (disposed || remoteClosed) return;
      // The saved device IDs distinguish live devices from obsolete mirrored IDs,
      // even when both sets contain the same SSH host alias.
      remoteIndex.retainTargets(new Set(ssh.targets.keys()));
      await remoteIndex.flush();
      if (disposed || remoteClosed) return;
      bridge = new RemoteBridge({ manager: ssh.manager, connection, requestTimeoutMs: 60000 });
      unmount = mountSshTransport({ webServer, connection, bridge, manager: ssh.manager });
      nativeBroker = createNativeRuntimeBroker({ ssh, bridge, webServer, connection });
      supervisor = ownedSupervisor = new TargetSupervisor({ ssh, bridge, index: remoteIndex, logger: remoteLog });
      ownedSupervisor.start();
      ssh.startAutoConnect({ logger: remoteLog });
      remoteChanged();
    })().catch(error => remoteLog('warn', 'SSH service startup failed: ' + String(error?.message ?? error)));

    let closing;
    function dispose() {
      disposed = true;
      if (supervisor === ownedSupervisor) {
        supervisor = null;
        nativeBroker = null;
        remoteChanged();
      }
      return closing ??= (async () => {
        await initialize;
        ssh?.stopAutoConnect();
        try { await ownedSupervisor?.stop({ markDown: false }); }
        finally {
          try { unmount?.(); await bridge?.dispose(); }
          finally {
            try { await ssh?.dispose(); }
            finally { await domain?.close(); }
          }
        }
      })();
    }
    closeRemoteWeb = dispose;
    host.effect(() => async () => {
      try { await dispose(); }
      finally { if (closeRemoteWeb === dispose) closeRemoteWeb = undefined; }
    });
  });
  ctx.effect(() => () => { remoteClosed = true; remoteNotify(); });

  const remoteSnapshotSchema = z.object({
    epoch: z.string().max(100).optional(),
    revision: z.number().int().nonnegative().optional(),
  }).strict();
  const disposeRemoteRoute = ctx.connection.fetch.register({
    path: '/api/t3-remote/snapshot', methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      let message;
      try {
        message = envelopeSchema.parse(await request.json());
        if (message.method !== 't3-remote/snapshot') throw new Error('Unexpected endpoint');
      } catch {
        return new Response('Invalid request', { status: 400 });
      }
      let result;
      try {
        const cursor = remoteSnapshotSchema.parse(message.payload);
        if (cursor.epoch === remoteEpoch && cursor.revision === remoteRevision) {
          await new Promise((resolve) => {
            if (remoteClosed || request.signal.aborted) return resolve();
            let timer;
            const done = () => { clearTimeout(timer); request.signal.removeEventListener('abort', done); remoteWaiters.delete(done); resolve(); };
            remoteWaiters.add(done);
            request.signal.addEventListener('abort', done, { once: true });
            timer = setTimeout(done, 25000);
          });
        }
        if (remoteClosed || request.signal.aborted) throw new Error('Request cancelled');
        await remoteIndex.flush();
        if (remoteClosed || request.signal.aborted) throw new Error('Request cancelled');
        result = { ok: true, value: { contract: PLACEMENT_CONTRACT, epoch: remoteEpoch, revision: remoteRevision,
          ...readRemoteIndex(), connections: supervisor?.runtimeConnections() ?? {} } };
      } catch (error) {
        result = { ok: false, error: { code: 't3-remote/error', message: error instanceof Error ? error.message : String(error), details: {} } };
      }
      return Response.json({ type: 'server-response', rpcId: message.rpcId, result });
    },
  });
  ctx.effect(() => disposeRemoteRoute);

  // ---- the doors that write to a machine through its own Remote surface ----
  // The machine stays the authority. These routes only validate and hand the call to
  // the supervisor, which serializes writes per machine and kicks its own refresh so
  // the mirror answers without waiting a beat. Nothing here writes the mirror itself.
  const targetIdSchema = z.string().min(1).max(200);
  const pathSchema = z.string().min(1).max(4096);
  const writeSchemas = {
    't3-remote/runtime': z.object({ targetId: z.string().regex(/^[A-Za-z0-9-]{1,80}$/) }).strict(),
    't3-remote/browse': z.object({ targetId: targetIdSchema, path: z.string().max(4096).optional(), refresh: z.boolean().optional() }).strict(),
    // A name is one path segment: no separator, no NUL, no empty.
    't3-remote/create-directory': z.object({ targetId: targetIdSchema, path: pathSchema, name: z.string().min(1).max(200).regex(/^[^/\0]+$/) }).strict(),
    't3-remote/workspace-create': z.object({ targetId: targetIdSchema, path: pathSchema }).strict(),
    // Deleting a project is the one irreversible write in this feature, so the
    // request has to carry the confirmation rather than imply it.
    't3-remote/workspace-delete': z.object({ targetId: targetIdSchema, workspaceId: z.string().min(1).max(200), confirmed: z.literal(true) }).strict(),
    // The same four verbs the local rows offer, handed to the machine that owns them.
    't3-remote/action': z.object({ targetId: targetIdSchema, sessionId: z.string().min(1).max(200), action: z.enum(['pin', 'unpin', 'settle', 'unsettle']) }).strict(),
    't3-remote/session-create': z.object({ targetId: targetIdSchema, workspaceId: z.string().min(1).max(200) }).strict(),
    't3-remote/session-command': z.discriminatedUnion('action', [
      z.object({ targetId: targetIdSchema, sessionId: z.string().min(1).max(200), action: z.literal('rename'), title: z.string().trim().min(1).max(500) }).strict(),
      z.object({ targetId: targetIdSchema, sessionId: z.string().min(1).max(200), action: z.literal('fork') }).strict(),
      z.object({ targetId: targetIdSchema, sessionId: z.string().min(1).max(200), action: z.literal('archive') }).strict(),
    ]),
  };
  const runWrite = (endpoint, call, signal) => {
    if (endpoint === 't3-remote/runtime') {
      if (!nativeBroker) throw Object.assign(new Error('The SSH connection service cannot provide native device conversations.'), { code: 't3-native/unavailable' });
      return nativeBroker.describe(call.targetId, { signal });
    }
    if (endpoint === 't3-remote/browse') return supervisor.browse(call.targetId, call.path, { refresh: call.refresh === true, signal }).then(listing => ({ listing }));
    if (endpoint === 't3-remote/create-directory') return supervisor.createDirectory(call.targetId, call.path, call.name).then(path => ({ path }));
    if (endpoint === 't3-remote/workspace-create') return supervisor.createWorkspace(call.targetId, call.path).then(value => ({ workspace: value?.workspace ?? null }));
    if (endpoint === 't3-remote/action') return supervisor.act(call.targetId, call.sessionId, call.action, { signal }).then(done => ({ done: done ?? null }));
    if (endpoint === 't3-remote/session-create') return supervisor.createSession(call.targetId, call.workspaceId, { signal }).then(session => ({ session }));
    if (endpoint === 't3-remote/session-command') return supervisor.sessionCommand(call.targetId, call.sessionId, call.action, { title: call.title, signal });
    return supervisor.deleteWorkspace(call.targetId, call.workspaceId, { confirmed: true }).then(value => ({ deleted: value?.deleted === true }));
  };
  for (const endpoint of Object.keys(writeSchemas)) {
    const dispose = ctx.connection.fetch.register({
      path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        let message;
        try {
          message = envelopeSchema.parse(await request.json());
          if (message.method !== endpoint) throw new Error('Unexpected endpoint');
        } catch {
          return new Response('Invalid request', { status: 400 });
        }
        let result;
        try {
          const call = writeSchemas[endpoint].parse(message.payload);
          if (!supervisor) throw Object.assign(new Error('The SSH connection service is unavailable.'), { code: 't3-remote/plugin-unavailable' });
          result = { ok: true, value: await runWrite(endpoint, call, request.signal) };
        } catch (error) {
          result = { ok: false, error: { code: typeof error?.code === 'string' ? error.code : 't3-remote/error', message: error instanceof Error ? error.message : String(error), details: error?.details ?? {} } };
        }
        return Response.json({ type: 'server-response', rpcId: message.rpcId, result });
      },
    });
    ctx.effect(() => dispose);
  }

  ctx.tools.register({
    name: 't3_sidebar_status',
    description: 'Read SSH mirror health and session counts used by Session Harbor. This does not connect devices or change sessions.',
    parameters: { type: 'object', properties: { targetId: { type: 'string' } }, additionalProperties: false },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute({ targetId } = {}) {
      await remoteIndex.flush();
      const snapshot = readRemoteIndex();
      return {
        epoch: remoteEpoch, revision: remoteRevision, supervisor: supervisor !== null, nativeRuntime: nativeBroker !== null,
        targets: Object.values(snapshot.targets).filter(target => targetId === undefined || target.targetId === targetId).map(target => {
          const sessions = Object.values(snapshot.sessions).filter(row => row.targetId === target.targetId);
          return { ...target, connectionId: supervisor?.runtimeConnections()[target.targetId] ?? null,
            workspaces: Object.values(snapshot.workspaces).filter(row => row.targetId === target.targetId).length,
            sessions: sessions.length,
            visible: sessions.filter(row => !row.blank && !row.archived && row.origin !== 'subagent').length,
            blank: sessions.filter(row => row.blank).length, archived: sessions.filter(row => row.archived).length,
            examples: sessions.slice(0, 8).map(({ sessionId, blank, archived, origin, running }) => ({ sessionId, blank, archived, origin, running })),
          };
        }),
      };
    },
  });

  ctx.tools.register({
    name: 't3_remote_session',
    description: 'Create, rename, fork, or archive a session on one connected SSH device. The session stays on that device.',
    parameters: {
      type: 'object', properties: {
        targetId: { type: 'string', description: 'Saved SSH device ID.' },
        action: { type: 'string', enum: ['create', 'rename', 'fork', 'archive'] },
        workspaceId: { type: 'string', description: 'Project on that device; required for create.' },
        sessionId: { type: 'string', description: 'Session on that device; required for rename, fork, or archive.' },
        title: { type: 'string', description: 'New title; required only for rename.' },
      }, required: ['targetId', 'action'], additionalProperties: false,
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, execution) {
      const endpoint = args.action === 'create' ? 't3-remote/session-create' : 't3-remote/session-command';
      const payload = args.action === 'create'
        ? { targetId: args.targetId, workspaceId: args.workspaceId }
        : { targetId: args.targetId, sessionId: args.sessionId, action: args.action, ...(args.title === undefined ? {} : { title: args.title }) };
      const call = writeSchemas[endpoint].parse(payload);
      if (!supervisor) throw new Error('The SSH device service is unavailable');
      return runWrite(endpoint, call, execution?.signal);
    },
  });

  ctx.tools.register({
    name: 't3_session_placement',
    description: 'Pin, unpin, settle, or restore a session in Session Harbor. Supply targetId for a session on an SSH device.',
    parameters: {
      type: 'object', properties: {
        sessionId: { type: 'string', description: 'ID of the session to organize.' },
        targetId: { type: 'string', description: 'Saved SSH device ID; omit for a local session.' },
        action: { type: 'string', enum: ['pin', 'unpin', 'settle', 'unsettle'], description: 'The placement action to apply.' },
      }, required: ['sessionId', 'action'], additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { sessionId: { type: 'string' }, action: { type: 'string' }, targetId: { type: 'string' } }, required: ['sessionId', 'action'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, execution) {
      if (args.targetId === undefined) return perform(args, execution?.signal);
      const call = writeSchemas['t3-remote/action'].parse(args);
      if (!supervisor) throw new Error('The SSH device service is unavailable');
      await supervisor.act(call.targetId, call.sessionId, call.action, { signal: execution?.signal });
      return call;
    },
  });
}
