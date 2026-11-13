import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createPlacementController } from './placement-controller.js';
import { settleExistingSessions } from './migration.js';

export const inject = ['storageDomain', 'workspaceRegistry', 'workspaceController', 'sessionController', 'connection', 'tools'];

const DOMAIN = 'local_t3_session_sidebar';
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

export async function apply(ctx) {
  const domain = await ctx.storageDomain.open({
    name: DOMAIN, version: 1, tables: { placements: { valueSchema: recordSchema } },
  });
  const table = domain.table('placements');
  ctx.effect(() => () => domain.close());

  const epoch = randomUUID();
  let revision = 0;
  const waiters = new Set();
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
    return { epoch, revision, placements: Object.fromEntries(table.entries()) };
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
  // Wake pending long polls before withdrawing their transport and storage.
  ctx.effect(() => () => { closed = true; notify(); });

  ctx.tools.register({
    name: 't3_session_placement',
    description: 'Pin, unpin, settle, or restore a session in the T3 session sidebar.',
    parameters: {
      type: 'object', properties: {
        sessionId: { type: 'string', description: 'ID of the session to organize.' },
        action: { type: 'string', enum: ['pin', 'unpin', 'settle', 'unsettle'], description: 'The placement action to apply.' },
      }, required: ['sessionId', 'action'], additionalProperties: false,
    },
    output: {
      schema: { type: 'object', properties: { sessionId: { type: 'string' }, action: { type: 'string' } }, required: ['sessionId', 'action'], additionalProperties: false },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: (args, execution) => perform(args, execution?.signal),
  });
}
