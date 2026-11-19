import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { TargetSupervisor, sessionRow, workspaceRows } from './remote-supervisor.js';
import { createRemoteIndex, sessionRef } from './remote-index.js';
import { RemoteFailure } from './remote-target-client.js';

const test = (name, run) => nodeTest(name, { timeout: 8000 }, run);

function memoryStorage() {
  const table = () => {
    const rows = new Map();
    return { get: id => rows.get(id), put: (id, value) => rows.set(id, value), delete: id => rows.delete(id), entries: () => [...rows.entries()] };
  };
  return { targets: table(), workspaces: table(), sessions: table() };
}

function fakeSsh(connections, { localRelease = null } = {}) {
  const listeners = new Set();
  return {
    manager: {
      list: () => [...connections],
      get: id => connections.find(state => state.id === id),
      onChange: listener => { listeners.add(listener); return () => listeners.delete(listener); },
      emit: state => { for (const listener of [...listeners]) listener(state); },
    },
    targetIdForConnection: state => state.targetId ?? null,
    connectionFor: targetId => connections.find(state => state.targetId === targetId
      && (state.status === 'connected' || state.status === 'connecting')),
    snapshot: () => ({ native: { release: localRelease } }),
  };
}

function fakeClient(behaviour) {
  const calls = [];
  return {
    calls,
    closed: false,
    async call(endpoint, args) {
      calls.push([endpoint, args]);
      if (behaviour.failOn === endpoint) throw new RemoteFailure('remote/test', 'the machine refused');
      if (endpoint === 'session/list') return { items: behaviour.sessions ?? [] };
      if (endpoint === 'session/projections') return { values: { title: (behaviour.titles ?? {})[args.request.sessionId] ?? '' } };
      if (endpoint === 'directoryPicker/list') {
        behaviour.listings = (behaviour.listings ?? 0) + 1;
        return behaviour.listing ?? { path: args.path ?? '/home/dev', home: '/home/dev', crumbs: [], entries: [], truncated: false };
      }
      if (endpoint === 'directoryPicker/createDirectory') return `${args.path}/${args.name}`;
      if (endpoint === 'workspace/create') return { workspace: { workspaceId: 'w-new', path: args.request.path, title: 'new', sessionIds: [], createdAt: '', updatedAt: '' }, created: true };
      if (endpoint === 'workspace/delete') return { deleted: true };
      if (endpoint === 'session/create') return { sessionId: 'session-new', agentPreset: 'standard' };
      return {};
    },
    follow(endpoint, args, { signal } = {}) {
      calls.push(['follow:' + endpoint, {}]);
      const iterator = frameQueue(signal);
      iterator.push(behaviour.baseline ?? { items: [] });
      const close = iterator.return;
      iterator.return = async () => { calls.push(['cancel:' + endpoint, {}]); return close(); };
      return iterator;
    },
    async pluginCall(endpoint, payload, options) {
      calls.push(['plugin:' + endpoint, payload ?? {}]);
      if (endpoint.endsWith('/action')) return { sessionId: payload?.sessionId, action: payload?.action };
      if (Array.isArray(behaviour.snapshots)) {
        if (behaviour.snapshots.length) return (behaviour.latestSnapshot = behaviour.snapshots.shift());
        if (!payload?.epoch) return behaviour.latestSnapshot;
        // Like the real route: a cursor already at the current revision waits for the next one.
        return new Promise((resolve, reject) => {
          const signal = options?.signal;
          if (signal?.aborted) reject(new RemoteFailure('remote/cancelled', 'cancelled'));
          else signal?.addEventListener('abort', () => reject(new RemoteFailure('remote/cancelled', 'cancelled')), { once: true });
        });
      }
      if (!behaviour.placements) throw new RemoteFailure('remote/404', 'no such route');
      if (payload?.epoch && payload.epoch === behaviour.placements.epoch && payload.revision === behaviour.placements.revision) {
        return new Promise((resolve, reject) => {
          const signal = options?.signal;
          const cancel = () => reject(new RemoteFailure('remote/cancelled', 'cancelled'));
          signal?.addEventListener('abort', cancel, { once: true });
          if (signal?.aborted) cancel();
        });
      }
      return behaviour.placements;
    },
    async close() { this.closed = true; },
  };
}

const bridge = {
  readBootstrap: async () => '{"version":"0.2.2-rc.1","commit":"c59d10a"}',
  describe: id => ({ id, host: 'fixture', url: `/ssh/environment/${id}/`, namespace: 'namespace00000000000000aa' }),
};

async function harness(behaviour, { connections, options = {}, localRelease = null } = {}) {
  const storage = memoryStorage();
  const index = createRemoteIndex({ storage });
  const ssh = fakeSsh(connections, { localRelease });
  const client = fakeClient(behaviour);
  const logs = [];
  const supervisor = new TargetSupervisor({
    ssh, bridge, index,
    logger: (level, message) => logs.push([level, message]),
    createClient: () => client,
    heartbeatMs: 50,
    backoffMs: [5],
    ...options,
  });
  supervisor.start();
  const waitFor = async predicate => {
    const deadline = Date.now() + 3000;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error('the mirror never reached the expected state: ' + JSON.stringify(index.snapshot().targets));
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  return { storage, index, ssh, client, supervisor, logs, waitFor };
}

const connection = { id: 'conn-1', targetId: 'target-1', status: 'connected', host: 'wsl', label: 'wsl' };

test('a live machine is mirrored end to end', async t => {
  const { index, client, supervisor, waitFor } = await harness(
    {
      sessions: [{ sessionId: 's-1', updatedAt: 5, running: false, blank: false, agentAvailable: true, cwd: '/srv/app' }],
      baseline: { items: [{ workspaceId: 'w-1', path: '/srv/app', title: 'app', sessionIds: ['s-1'] }], pinnedSessionIds: ['s-1'], archivedSessionIds: [] },
      placements: { contract: 1, epoch: 'e1', revision: 0, placements: { 's-1': { settled: true } } },
      titles: { 's-1': 'Fix the deploy' },
    },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  const row = index.snapshot().sessions[sessionRef('target-1', 's-1')];
  assert.deepEqual([row.displayTitle, row.pinned, row.settled, row.workspaceId, row.cwd], ['Fix the deploy', true, true, 'w-1', '/srv/app']);
  const target = index.getTarget('target-1');
  assert.deepEqual([target.pluginContract, target.release], [1, { version: '0.2.2-rc.1', commit: 'c59d10a' }]);
  assert.equal(client.calls.filter(([name]) => name === 'follow:workspace/follow').length, 1);
  assert.ok(!client.calls.some(([name]) => name === 'cancel:workspace/follow'), 'the workspace stream remains open for later changes');
  await supervisor.stop();
  assert.ok(client.calls.some(([name]) => name === 'cancel:workspace/follow'), 'stopping cancels the stream');
});

test('a machine without the placement route still mirrors, marked by contract', async t => {
  const { index, supervisor, waitFor } = await harness(
    { sessions: [{ sessionId: 's-1', updatedAt: 1, running: false, blank: false, agentAvailable: false }] },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  assert.equal(index.getTarget('target-1').pluginContract, null);
  assert.equal(index.snapshot().sessions[sessionRef('target-1', 's-1')].settled, false);
});

test('a mismatched contract marks the machine incompatible but keeps rows', async t => {
  const { index, supervisor, waitFor } = await harness(
    {
      sessions: [{ sessionId: 's-1', updatedAt: 1, running: false, blank: false, agentAvailable: false }],
      placements: { contract: 99, epoch: 'e1', revision: 0, placements: {} },
    },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'incompatible');
  assert.equal(index.getTarget('target-1').pluginContract, 99);
  assert.equal(Object.keys(index.snapshot().sessions).length, 1);
});

test('a failing machine backs off and retries', async t => {
  const { index, client, supervisor, waitFor } = await harness(
    { sessions: [{ sessionId: 's-1', updatedAt: 1, running: false, blank: false, agentAvailable: false }], failOn: 'session/list' },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'stale');
  assert.match(index.getTarget('target-1').lastError, /the machine refused/);
  const first = client.calls.filter(([name]) => name === 'session/list').length;
  await waitFor(() => client.calls.filter(([name]) => name === 'session/list').length > first);
});

test('a closed connection marks the mirror down without dropping rows', async t => {
  const { index, ssh, client, supervisor, waitFor } = await harness(
    { sessions: [{ sessionId: 's-1', updatedAt: 1, running: false, blank: false, agentAvailable: false }], placements: { contract: 1, placements: {} } },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  ssh.manager.emit({ ...connection, status: 'disconnected' });
  await waitFor(() => index.getTarget('target-1')?.status === 'down');
  assert.equal(Object.keys(index.snapshot().sessions).length, 1, 'the rows stay readable');
  assert.equal(client.closed, true);
});

test('titles are only fetched for rows still showing a fallback', async t => {
  const { index, client, supervisor, waitFor } = await harness(
    {
      sessions: [
        { sessionId: 's-1', updatedAt: 1, running: false, blank: false, agentAvailable: false },
        { sessionId: 's-2', updatedAt: 1, running: false, blank: false, agentAvailable: false },
      ],
      titles: { 's-1': 'Named', 's-2': 'Also named' },
    },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  const firstRound = client.calls.filter(([name]) => name === 'session/projections').length;
  assert.equal(firstRound, 2);
  await waitFor(() => client.calls.filter(([name]) => name === 'session/list').length >= 2);
  const later = client.calls.filter(([name]) => name === 'session/projections').length;
  assert.equal(later, firstRound, 'titled rows are not fetched again');
  assert.equal(index.snapshot().sessions[sessionRef('target-1', 's-2')].displayTitle, 'Also named');
});

test('writes to one machine run one at a time', async t => {
  const { supervisor } = await harness({}, { connections: [] });
  const order = [];
  const first = supervisor.mutate('target-1', async () => { order.push('a:start'); await new Promise(r => setTimeout(r, 30)); order.push('a:end'); });
  const second = supervisor.mutate('target-1', async () => { order.push('b'); });
  await Promise.all([first, second]);
  assert.deepEqual(order, ['a:start', 'a:end', 'b']);
});

test('the live session/list shape maps without a second title call', async t => {
  // Captured from a real remote DSH 0.2.2-rc.1 baseline.
  const listed = {
    sessionId: '815f6ea2-b81c-4c7a-ad2a-9aac0a523bc0',
    updatedAt: 1794399541151,
    agentAvailable: false,
    formatStatus: 'current',
    running: false,
    blank: false,
    cwd: '/home/dev',
    projections: { kind: 'cached', asOfSeq: 42, values: { title: 'GitHub Key Configuration', workingDirectory: '/home/dev' } },
  };
  assert.deepEqual(sessionRow(listed), {
    sessionId: '815f6ea2-b81c-4c7a-ad2a-9aac0a523bc0',
    updatedAt: 1794399541151,
    running: false,
    blank: false,
    agentAvailable: false,
    cwd: '/home/dev',
    origin: null,
    displayTitle: 'GitHub Key Configuration',
  });
  const { index, client, supervisor, waitFor } = await harness(
    { sessions: [listed] },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  assert.equal(index.snapshot().sessions[sessionRef('target-1', listed.sessionId)].displayTitle, 'GitHub Key Configuration');
  assert.equal(client.calls.filter(([name]) => name === 'session/projections').length, 0, 'cached projections need no extra round trip');
});

test('a session whose projections are not cached waits for the title pass', () => {
  // No title in the baseline leaves the field out; the mirror keeps its placeholder.
  assert.equal(sessionRow({ sessionId: 's-1234567890', updatedAt: 1, projections: { kind: 'pending' } }).displayTitle, undefined);
  assert.equal(sessionRow({ sessionId: 's-1234567890', updatedAt: 1 }).displayTitle, undefined);
  assert.equal(sessionRow({ sessionId: 's-1234567890', updatedAt: 1, projections: { kind: 'cached', values: { title: '  ' } } }).displayTitle, undefined);
});

test('the live workspace/follow envelope maps to rows', () => {
  const envelope = {
    type: 'baseline',
    value: {
      items: [
        { workspaceId: '1ec0a40a-6108-4056-b836-a5c071b74a07', path: '/home/dev/bl_local', title: 'bl_local', sessionIds: [], createdAt: '2026-11-11T15:59:52.221Z', updatedAt: '2026-11-11T15:59:52.278Z' },
        { workspaceId: '33fdfc67', path: '/home/dev', title: 'dev', sessionIds: ['s-1', 's-2'], createdAt: '2026-11-11T10:18:30.223Z', updatedAt: '2026-11-11T12:18:39.133Z' },
      ],
      archivedSessionIds: [],
      pinnedSessionIds: ['s-2'],
    },
  };
  assert.deepEqual(workspaceRows(envelope), [
    { workspaceId: '1ec0a40a-6108-4056-b836-a5c071b74a07', path: '/home/dev/bl_local', title: 'bl_local', sessionIds: [], pinnedSessionIds: [], archivedSessionIds: [] },
    { workspaceId: '33fdfc67', path: '/home/dev', title: 'dev', sessionIds: ['s-1', 's-2'], pinnedSessionIds: ['s-2'], archivedSessionIds: [] },
  ]);
});

test('mapping helpers ignore fields this version does not know', () => {
  assert.deepEqual(sessionRow({ sessionId: 's-1', updatedAt: 'nope', future: 1 }), {
    sessionId: 's-1', updatedAt: 0, running: false, blank: false, agentAvailable: false, cwd: null, origin: null,
  });
  assert.deepEqual(workspaceRows({ items: [{ workspaceId: 'w-1', path: '/p', title: 't', sessions: [{ sessionId: 's-1' }, null] }], pinnedSessionIds: ['s-1'], archivedSessionIds: [] }), [
    { workspaceId: 'w-1', path: '/p', title: 't', sessionIds: ['s-1'], pinnedSessionIds: ['s-1'], archivedSessionIds: [] },
  ]);
  assert.deepEqual(workspaceRows(null), []);
});

test('a directory level is read once and cached until refreshed', async t => {
  const { index, client, supervisor, waitFor } = await harness(
    { sessions: [], listing: { path: '/home/dev', home: '/home/dev', crumbs: [{ name: 'x', path: '/home/dev', hidden: false }], entries: [{ name: 'app', path: '/home/dev/app', hidden: false }], truncated: false } },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  // The sync already read the home level to learn what kind of machine this is, so the
  // counts below are measured from there, not from the start of the connection.
  const levelCalls = () => client.calls.filter(([name]) => name === 'directoryPicker/list');
  const probe = levelCalls().length;
  const first = await supervisor.browse('target-1', '/home/dev');
  const second = await supervisor.browse('target-1', '/home/dev');
  assert.deepEqual([first.entries.length, levelCalls().length - probe], [1, 1]);
  assert.equal(second.entries[0].path, '/home/dev/app');
  await supervisor.browse('target-1', '/home/dev', { refresh: true });
  assert.equal(levelCalls().length - probe, 2);
  const bare = await supervisor.browse('target-1');
  assert.equal(bare.home, '/home/dev');
  assert.deepEqual(levelCalls().slice(probe).map(([, args]) => args), [{ path: '/home/dev' }, { path: '/home/dev' }]);
  // The home level came from the sync's own read, which is what warmed the cache.
  assert.deepEqual(levelCalls().slice(0, probe).map(([, args]) => args), [{}]);
});

test('an abandoned browse aborts the remote call and leaves the directory cache unchanged', async t => {
  const { index, client, supervisor, waitFor } = await harness({ sessions: [] }, { connections: [connection] });
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  const path = '/home/dev/project';
  const original = client.call.bind(client);
  const started = deferred();
  const delayed = deferred();
  client.call = (method, args, options) => {
    if (method !== 'directoryPicker/list' || args.path !== path) return original(method, args, options);
    started.resolve(options.signal);
    return delayed.promise;
  };
  const controller = new AbortController();
  const abandoned = supervisor.browse('target-1', path, { signal: controller.signal });
  const remoteSignal = await started.promise;
  controller.abort();
  assert.equal(remoteSignal.aborted, true);
  delayed.resolve({ path: '/stale', entries: [] });
  await assert.rejects(abandoned, { name: 'AbortError' });

  client.call = original;
  assert.equal((await supervisor.browse('target-1', path)).path, path);
});

test('a machine that is not connected cannot be browsed or written', async t => {
  const { supervisor } = await harness({ sessions: [] }, { connections: [] });
  t.after(() => supervisor.stop());
  for (const attempt of [
    () => supervisor.browse('target-9', '/tmp'),
    () => supervisor.createDirectory('target-9', '/tmp', 'x'),
    () => supervisor.createWorkspace('target-9', '/tmp/x'),
    () => supervisor.deleteWorkspace('target-9', 'w-1', { confirmed: true }),
  ]) {
    await assert.rejects(attempt, error => error.code === 't3-remote/target-unavailable');
  }
});

test('creating a directory drops the cached levels of that machine', async t => {
  const { index, client, supervisor, waitFor } = await harness({ sessions: [] }, { connections: [connection] });
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  const probe = client.calls.filter(([name]) => name === 'directoryPicker/list').length;
  await supervisor.browse('target-1', '/home/dev');
  const created = await supervisor.createDirectory('target-1', '/home/dev', 'app');
  assert.equal(created, '/home/dev/app');
  assert.deepEqual(client.calls.find(([name]) => name === 'directoryPicker/createDirectory')?.[1], { path: '/home/dev', name: 'app' });
  await supervisor.browse('target-1', '/home/dev');
  assert.equal(client.calls.filter(([name]) => name === 'directoryPicker/list').length - probe, 2);
});

test('adding a project writes through the machine and refreshes the mirror at once', async t => {
  const { index, client, supervisor, waitFor } = await harness({ sessions: [] }, { connections: [connection], options: { heartbeatMs: 5000 } });
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  const before = client.calls.filter(([name]) => name === 'session/list').length;
  const value = await supervisor.createWorkspace('target-1', '/home/dev/app');
  assert.deepEqual([value.created, value.workspace.path], [true, '/home/dev/app']);
  assert.deepEqual(client.calls.find(([name]) => name === 'workspace/create')?.[1], { request: { path: '/home/dev/app' } });
  // The heartbeat was cut short, so the mirror learns about the project now
  // rather than up to one beat later.
  await waitFor(() => client.calls.filter(([name]) => name === 'session/list').length > before);
});

test('deleting a project needs an explicit confirmation', async t => {
  const { index, client, supervisor, waitFor } = await harness({ sessions: [] }, { connections: [connection] });
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  await assert.rejects(() => supervisor.deleteWorkspace('target-1', 'w-1'), error => error.code === 't3-remote/confirmation-required');
  assert.equal(client.calls.some(([name]) => name === 'workspace/delete'), false);
  const value = await supervisor.deleteWorkspace('target-1', 'w-1', { confirmed: true });
  assert.deepEqual([value.deleted, client.calls.find(([name]) => name === 'workspace/delete')?.[1]], [true, { request: { workspaceId: 'w-1' } }]);
});

test('a machine reports its family from the shape of its home directory', async t => {
  for (const [home, kind] of [['/home/dev', 'linux'], ['/Users/dev', 'macos'], ['C:\\\\Users\\\\amyrxci', 'windows'], ['/srv/data', 'linux']]) {
    const { index, supervisor, waitFor } = await harness(
      { sessions: [], listing: { path: home, home, crumbs: [], entries: [], truncated: false } },
      { connections: [connection] },
    );
    t.after(() => supervisor.stop());
    await waitFor(() => index.getTarget('target-1')?.kind === kind);
    assert.equal(index.getTarget('target-1').kind, kind);
    assert.equal(index.snapshot().targets['target-1'].kind, kind);
  }
});

test('a machine that reports its own platform costs no directory read', async t => {
  const { index, client, supervisor, waitFor } = await harness(
    { sessions: [], placements: { contract: 1, placements: {}, self: { platform: 'linux', wsl: true } } },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.kind === 'wsl');
  assert.equal(client.calls.filter(([name]) => name === 'directoryPicker/list').length, 0);
});

test('a self-report is mapped, and an unusable one falls back to the home shape', async t => {
  for (const [self, home, kind] of [
    [{ platform: 'darwin' }, '/', 'macos'],
    [{ platform: 'win32' }, '/', 'windows'],
    [{ platform: 42 }, '/Users/dev', 'macos'],
  ]) {
    const { index, supervisor, waitFor } = await harness(
      { sessions: [], placements: { contract: 1, placements: {}, self }, listing: { path: home, home, crumbs: [], entries: [], truncated: false } },
      { connections: [connection] },
    );
    t.after(() => supervisor.stop());
    await waitFor(() => index.getTarget('target-1')?.kind === kind);
    assert.equal(index.getTarget('target-1').kind, kind);
  }
});

test('a row verb is handed to the machine that owns the session', async t => {
  const { index, client, supervisor, waitFor } = await harness(
    { sessions: [], placements: { contract: 1, placements: {} } },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.pluginContract === 1);
  const done = await supervisor.act('target-1', 's-1', 'settle');
  assert.deepEqual(done, { sessionId: 's-1', action: 'settle' });
  assert.deepEqual(client.calls.find(([name]) => name === 'plugin:t3-session-sidebar/action')?.[1], { sessionId: 's-1', action: 'settle' });
});

test('a machine without the plugin is refused before anything is sent', async t => {
  const { index, client, supervisor, waitFor } = await harness(
    { sessions: [], placements: { contract: 99, placements: {} } },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'incompatible');
  await assert.rejects(() => supervisor.act('target-1', 's-1', 'settle'), (error) => error?.code === 't3-remote/plugin-missing');
  assert.ok(!client.calls.some(([name]) => name === 'plugin:t3-session-sidebar/action'));
});

test('a machine that is not connected cannot take a verb', async t => {
  const { supervisor } = await harness({ sessions: [] }, { connections: [] });
  t.after(() => supervisor.stop());
  await assert.rejects(() => supervisor.act('target-1', 's-1', 'pin'), (error) => error?.code === 't3-remote/target-unavailable');
});

const project = { items: [{ workspaceId: 'w-1', path: '/srv/app', title: 'app', sessionIds: ['s-1'] }] };

test('a session starts inside a mirrored project, never at a typed path', async t => {
  const { index, client, supervisor, waitFor } = await harness(
    { sessions: [{ sessionId: 's-1', updatedAt: 1, running: false, blank: false, cwd: '/srv/app' }], baseline: project, placements: { contract: 1, placements: {} } },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  const created = await supervisor.createSession('target-1', 'w-1');
  assert.deepEqual(created, { sessionId: 'session-new', reused: false });
  assert.deepEqual(client.calls.find(([endpoint]) => endpoint === 'session/create')?.[1], { request: { workspaceId: 'w-1' } });
});

test('a blank session already in that project is reused instead of making another', async t => {
  const { index, client, supervisor, waitFor } = await harness(
    { sessions: [{ sessionId: 's-blank', updatedAt: 1, running: false, blank: true, cwd: '/srv/app' }], baseline: project, placements: { contract: 1, placements: {} } },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  const created = await supervisor.createSession('target-1', 'w-1');
  assert.deepEqual(created, { sessionId: 's-blank', reused: true });
  assert.ok(!client.calls.some(([endpoint]) => endpoint === 'session/create'));
});

test('a project the mirror does not know cannot start a session', async t => {
  const { index, supervisor, waitFor } = await harness(
    { sessions: [], baseline: project, placements: { contract: 1, placements: {} } },
    { connections: [connection] },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => index.getTarget('target-1')?.status === 'ready');
  await assert.rejects(() => supervisor.createSession('target-1', 'w-nope'), (error) => error?.code === 't3-remote/workspace-unknown');
});

test('a change on the machine moves the mirror without waiting for a heartbeat', async t => {
  const { index, supervisor, waitFor } = await harness(
    {
      sessions: [{ sessionId: 's-1', updatedAt: 1, running: false, blank: false, cwd: '/srv/app' }],
      snapshots: [
        { contract: 1, epoch: 'e1', revision: 1, placements: {}, statuses: {} },
        { contract: 1, epoch: 'e1', revision: 2, placements: { 's-1': { settled: true } }, statuses: { 's-1': true } },
      ],
    },
    { connections: [connection], options: { heartbeatMs: 5000 } },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => {
    const row = index.snapshot().sessions[sessionRef('target-1', 's-1')];
    return row?.settled === true && row?.running === true;
  });
});

test('a session that appears on the machine pulls a fresh list at once', async t => {
  const { index, client, supervisor, waitFor } = await harness(
    {
      sessions: [{ sessionId: 's-1', updatedAt: 1, running: false, blank: false, cwd: '/srv/app' }],
      snapshots: [
        { contract: 1, epoch: 'e1', revision: 1, placements: {}, statuses: {} },
        { contract: 1, epoch: 'e1', revision: 2, placements: {}, statuses: { 's-new': true } },
      ],
    },
    { connections: [connection], options: { heartbeatMs: 5000 } },
  );
  t.after(() => supervisor.stop());
  await waitFor(() => client.calls.filter(([endpoint]) => endpoint === 'session/list').length > 1);
  assert.ok(index.getTarget('target-1'));
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function frameQueue(signal) {
  const entries = [];
  let waiter = null;
  let closed = false;
  const flush = () => {
    if (!waiter || (!closed && entries.length === 0)) return;
    const next = waiter;
    waiter = null;
    if (entries.length) {
      const entry = entries.shift();
      if (entry.error) next.reject(entry.error);
      else next.resolve({ value: entry.value, done: false });
    } else next.resolve({ value: undefined, done: true });
  };
  const queue = {
    [Symbol.asyncIterator]() { return queue; },
    next() { const pending = deferred(); waiter = pending; flush(); return pending.promise; },
    return() { closed = true; entries.length = 0; flush(); return Promise.resolve({ done: true }); },
    push(value) { if (!closed) { entries.push({ value }); flush(); } },
    fail(error) { if (!closed) { entries.push({ error }); flush(); } },
    get closed() { return closed; },
  };
  signal?.addEventListener('abort', () => { void queue.return(); }, { once: true });
  if (signal?.aborted) void queue.return();
  return queue;
}

function controlledMirror({ sessions = [], initialSnapshot, onList, onCreate, onSnapshot, onCommand, cachedTarget, connections = [connection], options = {} } = {}) {
  const listeners = new Set();
  const changes = [];
  const storage = memoryStorage();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  for (const [name, table] of Object.entries(storage)) {
    const put = table.put;
    table.put = (key, value) => {
      const result = put(key, value);
      const changed = () => { changes.push({ name, key, value }); notify(); };
      if (result && typeof result.then === 'function') void Promise.resolve(result).then(changed, () => {});
      else queueMicrotask(changed);
      return result;
    };
  }
  const until = predicate => {
    if (predicate()) return Promise.resolve();
    const pending = deferred();
    const check = () => { if (predicate()) { listeners.delete(check); pending.resolve(); } };
    listeners.add(check);
    return pending.promise;
  };
  const index = createRemoteIndex({ storage });
  if (cachedTarget) index.putTarget(cachedTarget);
  const ssh = fakeSsh(connections);
  const clients = [];
  let snapshot = initialSnapshot ?? { contract: 1, epoch: 'epoch-1', revision: 1, placements: {}, statuses: {}, self: { platform: 'linux' } };
  const makeClient = (targetId, connectionId) => {
    const calls = [];
    const streams = [];
    const polls = new Set();
    const client = {
      connectionId, calls, streams, closed: false,
      async call(endpoint, args, options) {
        calls.push([endpoint, args]); notify();
        if (endpoint === 'session/list') return onList ? onList(client, calls.filter(([name]) => name === endpoint).length, options) : { items: sessions };
        if (endpoint === 'session/create') return onCreate ? onCreate(client, args, options) : { sessionId: 'created-1' };
        if (['session/rename', 'session/fork', 'workspace/archiveSession'].includes(endpoint)) return onCommand?.(client, endpoint, args, options);
        if (endpoint === 'workspace/create') return { workspace: { workspaceId: 'w-new', path: args.request.path }, created: true };
        if (endpoint === 'session/projections') return { values: { title: args.request.sessionId } };
        if (endpoint === 'directoryPicker/list') return { path: '/srv', home: '/srv', entries: [], crumbs: [] };
        return {};
      },
      follow(endpoint, args, { signal } = {}) {
        calls.push(['follow:' + endpoint, args]);
        const stream = frameQueue(signal);
        streams.push(stream);
        stream.push({ type: 'baseline', value: project });
        notify();
        return stream;
      },
      async pluginCall(endpoint, payload, { signal } = {}) {
        calls.push(['plugin:' + endpoint, payload]); notify();
        if (endpoint.endsWith('/action')) return { sessionId: payload.sessionId, action: payload.action };
        const override = onSnapshot?.(client, payload, { signal });
        if (override !== undefined) return override;
        if (payload?.epoch !== snapshot.epoch || payload?.revision !== snapshot.revision) return snapshot;
        const pending = deferred();
        polls.add(pending);
        const cancel = () => { polls.delete(pending); pending.reject(new RemoteFailure('remote/cancelled', 'cancelled')); };
        signal?.addEventListener('abort', cancel, { once: true });
        if (signal?.aborted) cancel();
        return pending.promise.finally(() => { polls.delete(pending); signal?.removeEventListener('abort', cancel); });
      },
      async close() { client.closed = true; for (const stream of streams) await stream.return(); notify(); },
      update(value) { snapshot = value; for (const pending of [...polls]) pending.resolve(value); },
    };
    clients.push(client);
    return client;
  };
  const supervisor = new TargetSupervisor({ ssh, bridge, index, createClient: makeClient, heartbeatMs: 60000, backoffMs: [5], ...options });
  supervisor.start();
  const readyCount = () => changes.filter(change => change.name === 'targets' && change.value.status === 'ready').length;
  return { supervisor, index, storage, ssh, clients, changes, until, readyCount };
}

const ordinary = { sessionId: 's-1', updatedAt: 1, running: false, blank: false, agentAvailable: true, cwd: '/srv/app', projections: { values: { title: 'one' } } };
const settleTurn = () => new Promise(resolve => setImmediate(resolve));

test('cached ready targets are invalidated at start and a stopped mirror stays down', async t => {
  const cachedTarget = { targetId: 'target-1', label: 'wsl', host: 'wsl', kind: 'wsl', release: null, pluginContract: 1, status: 'ready', lastSyncAt: 123, lastError: null };
  const empty = controlledMirror({ cachedTarget, connections: [] });
  t.after(() => empty.supervisor.stop());
  assert.equal(empty.index.getTarget('target-1').status, 'down');
  assert.equal(empty.index.getTarget('target-1').lastSyncAt, 123);
  const live = controlledMirror({ sessions: [ordinary], cachedTarget });
  t.after(() => live.supervisor.stop());
  await live.until(() => live.index.getTarget('target-1')?.status === 'ready');
  await live.supervisor.stop();
  assert.equal(live.index.getTarget('target-1').status, 'down');
  assert.ok(live.index.snapshot().sessions['target-1/s-1']);
});

test('a late old list cannot overwrite a newer watched running status', async t => {
  const oldList = deferred();
  const listStarted = deferred();
  const h = controlledMirror({ sessions: [ordinary], onList: (client, count) => {
    if (count === 2) { listStarted.resolve(); return oldList.promise; }
    return { items: [ordinary] };
  } });
  t.after(() => h.supervisor.stop());
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  await h.supervisor.createWorkspace('target-1', '/srv/other');
  await listStarted.promise;
  h.clients[0].update({ contract: 1, epoch: 'epoch-1', revision: 2, placements: {}, statuses: { 's-1': true } });
  await h.until(() => h.index.snapshot().sessions['target-1/s-1']?.running === true);
  const beforeCommit = h.readyCount();
  oldList.resolve({ items: [ordinary] });
  await h.until(() => h.readyCount() > beforeCommit);
  assert.equal(h.index.snapshot().sessions['target-1/s-1'].running, true);
});

test('old generation responses and disconnects cannot mutate or close the new client', async t => {
  const oldList = deferred();
  const oldStarted = deferred();
  const fresh = { ...ordinary, sessionId: 's-new' };
  const h = controlledMirror({ onList: client => {
    if (client.connectionId === 'conn-1') { oldStarted.resolve(); return oldList.promise; }
    return { items: [fresh] };
  } });
  t.after(() => h.supervisor.stop());
  await oldStarted.promise;
  h.ssh.manager.emit({ ...connection, status: 'disconnected' });
  h.ssh.manager.emit({ ...connection, id: 'conn-2', status: 'connected' });
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  const current = h.clients.find(client => client.connectionId === 'conn-2');
  oldList.resolve({ items: [ordinary] });
  await settleTurn();
  h.ssh.manager.emit({ ...connection, status: 'disconnected' });
  assert.equal(current.closed, false);
  assert.equal(h.index.getTarget('target-1').status, 'ready');
  assert.deepEqual(Object.keys(h.index.snapshot().sessions), ['target-1/s-new']);
});

test('same-project creation is single flight and reuses its result before the mirror catches up', async t => {
  const create = deferred();
  const createStarted = deferred();
  const refreshing = deferred();
  const h = controlledMirror({ sessions: [ordinary], onList: (client, count) => count > 1 ? refreshing.promise : { items: [ordinary] }, onCreate: () => {
    createStarted.resolve(); return create.promise;
  } });
  t.after(() => { refreshing.resolve({ items: [ordinary] }); return h.supervisor.stop(); });
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  const first = h.supervisor.createSession('target-1', 'w-1');
  const second = h.supervisor.createSession('target-1', 'w-1');
  await createStarted.promise;
  create.resolve({ sessionId: 'created-1' });
  const results = await Promise.all([first, second]);
  assert.deepEqual(results, [{ sessionId: 'created-1', reused: false }, { sessionId: 'created-1', reused: false }]);
  const third = await h.supervisor.createSession('target-1', 'w-1');
  assert.deepEqual(third, { sessionId: 'created-1', reused: true });
  assert.equal(h.clients[0].calls.filter(([name]) => name === 'session/create').length, 1);
});

test('a kick received during an in-flight sync causes another pass without waiting a heartbeat', async t => {
  const secondList = deferred();
  const secondStarted = deferred();
  const thirdStarted = deferred();
  const h = controlledMirror({ onList: (client, count) => {
    if (count === 2) { secondStarted.resolve(); return secondList.promise; }
    if (count === 3) thirdStarted.resolve();
    return { items: [ordinary] };
  } });
  t.after(() => h.supervisor.stop());
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  await h.supervisor.createWorkspace('target-1', '/srv/a');
  await secondStarted.promise;
  await h.supervisor.createWorkspace('target-1', '/srv/b');
  secondList.resolve({ items: [ordinary] });
  await thirdStarted.promise;
  assert.equal(h.clients[0].calls.filter(([name]) => name === 'session/list').length, 3);
});

test('workspace changes remain subscribed and update flags and membership immediately', async t => {
  const h = controlledMirror({ sessions: [ordinary] });
  t.after(() => h.supervisor.stop());
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  const client = h.clients[0];
  const stream = client.streams[0];
  assert.equal(stream.closed, false);
  stream.push({ type: 'pinned', pinnedSessionIds: ['s-1'] });
  await h.until(() => h.index.snapshot().sessions['target-1/s-1']?.pinned === true);
  stream.push({ type: 'archived', archivedSessionIds: ['s-1'] });
  await h.until(() => h.index.snapshot().sessions['target-1/s-1']?.archived === true);
  stream.push({ type: 'upsert', workspace: { workspaceId: 'w-1', path: '/srv/app', title: 'renamed', sessionIds: ['s-1'] } });
  await h.until(() => h.index.workspace('target-1', 'w-1')?.title === 'renamed');
  stream.push({ type: 'remove', workspaceId: 'w-1' });
  await h.until(() => h.index.snapshot().sessions['target-1/s-1']?.workspaceId === null);
  assert.equal(h.index.snapshot().sessions['target-1/s-1'].pinned, true, 'global pins survive removal of a workspace');
  assert.equal(client.calls.filter(([name]) => name === 'follow:workspace/follow').length, 1);
  await h.supervisor.stop();
  assert.equal(stream.closed, true);
});

test('a delayed older snapshot cannot roll back a newer revision or a replacement epoch', async t => {
  for (const epoch of ['epoch-1', 'epoch-2']) {
    const pending = deferred();
    const requested = deferred();
    let block = false;
    const h = controlledMirror({ sessions: [ordinary], onSnapshot: (client, payload) => {
      if (block && !payload?.epoch) { block = false; requested.resolve(); return pending.promise; }
    } });
    t.after(() => h.supervisor.stop());
    await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
    block = true;
    await h.supervisor.createWorkspace('target-1', '/srv/other');
    await requested.promise;
    h.clients[0].update({ contract: 1, epoch, revision: epoch === 'epoch-1' ? 2 : 0, placements: { 's-1': { settled: true } }, statuses: { 's-1': true } });
    await h.until(() => h.index.snapshot().sessions['target-1/s-1']?.running === true);
    const before = h.readyCount();
    pending.resolve({ contract: 1, epoch: 'epoch-1', revision: 1, placements: { 's-1': { settled: false } }, statuses: { 's-1': false } });
    await h.until(() => h.readyCount() > before);
    assert.equal(h.index.snapshot().sessions['target-1/s-1'].running, true);
    assert.equal(h.index.snapshot().sessions['target-1/s-1'].settled, true);
    await h.supervisor.stop();
  }
});

test('a workspace subscription failure remains stale through a successful heartbeat until its baseline recovers', async t => {
  const retry = deferred();
  const h = controlledMirror({ sessions: [ordinary], options: {
    setTimeoutFn: (callback, ms) => {
      if (ms === 5) { retry.resolve(callback); return null; }
      return setTimeout(callback, ms);
    },
  } });
  t.after(() => h.supervisor.stop());
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  h.clients[0].streams[0].fail(new Error('workspace subscription lost'));
  await h.until(() => h.index.getTarget('target-1')?.status === 'stale');
  const resume = await retry.promise;
  const before = h.changes.filter(change => change.name === 'targets').length;
  await h.supervisor.createWorkspace('target-1', '/srv/other');
  await h.until(() => h.changes.filter(change => change.name === 'targets').length > before);
  assert.equal(h.index.getTarget('target-1').status, 'stale');
  assert.match(h.index.getTarget('target-1').lastError, /workspace subscription lost/);
  resume();
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  assert.equal(h.clients[0].streams.length, 2);
  assert.equal(h.clients[0].streams[0].closed, true);
});

test('a replacement workspace baseline clears removed membership and obsolete flags', async t => {
  const h = controlledMirror({ sessions: [ordinary] });
  t.after(() => h.supervisor.stop());
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  const stream = h.clients[0].streams[0];
  stream.push({ type: 'pinned', pinnedSessionIds: ['s-1'] });
  await h.until(() => h.index.snapshot().sessions['target-1/s-1']?.pinned === true);
  stream.push({ type: 'replace', value: { items: [], pinnedSessionIds: [], archivedSessionIds: [] } });
  await h.until(() => h.index.snapshot().sessions['target-1/s-1']?.workspaceId === null);
  assert.equal(h.index.snapshot().sessions['target-1/s-1'].pinned, false);
  assert.equal(h.index.workspace('target-1', 'w-1'), undefined);
});

test('a confirmed nonblank create result releases the pending id for the next new session', async t => {
  const firstRefresh = deferred();
  const refreshed = deferred();
  let created = 0;
  const h = controlledMirror({ onList: (client, count) => {
    if (count === 2) { refreshed.resolve(); return firstRefresh.promise; }
    return { items: [ordinary] };
  }, onCreate: () => ({ sessionId: 'created-' + (++created) }) });
  t.after(() => { firstRefresh.resolve({ items: [ordinary] }); return h.supervisor.stop(); });
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  await h.supervisor.createSession('target-1', 'w-1');
  await refreshed.promise;
  const before = h.readyCount();
  firstRefresh.resolve({ items: [ordinary, { ...ordinary, sessionId: 'created-1', blank: false }] });
  await h.until(() => h.readyCount() > before);
  assert.deepEqual(await h.supervisor.createSession('target-1', 'w-1'), { sessionId: 'created-2', reused: false });
  assert.equal(created, 2);
});

test('session commands use the owning machine native RPC and keep acknowledged changes through stale mirrors', async t => {
  let listedTitle = 'one';
  const h = controlledMirror({ onList: () => ({ items: [{ ...ordinary, projections: { values: { title: listedTitle } } }] }), onCommand: (client, endpoint) => {
    if (endpoint === 'session/fork') return { sessionId: 'forked-1' };
    if (endpoint === 'workspace/archiveSession') return { archivedSessionIds: ['s-1'] };
    return {};
  } });
  t.after(() => h.supervisor.stop());
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  const before = h.readyCount();
  assert.deepEqual(await h.supervisor.sessionCommand('target-1', 's-1', 'rename', { title: 'Renamed' }), { done: true });
  assert.equal(h.index.snapshot().sessions['target-1/s-1'].displayTitle, 'Renamed');
  await h.until(() => h.readyCount() > before);
  assert.equal(h.index.snapshot().sessions['target-1/s-1'].displayTitle, 'Renamed', 'stale cached titles cannot undo a rename');
  for (const title of ['Renamed', 'Changed elsewhere']) {
    listedTitle = title;
    const previous = h.readyCount();
    await h.supervisor.createWorkspace('target-1', '/srv/refresh');
    await h.until(() => h.readyCount() > previous);
  }
  assert.equal(h.index.snapshot().sessions['target-1/s-1'].displayTitle, 'Changed elsewhere', 'confirmation releases the temporary title guard');
  assert.deepEqual(await h.supervisor.sessionCommand('target-1', 's-1', 'fork'), { sessionId: 'forked-1' });
  assert.deepEqual(await h.supervisor.sessionCommand('target-1', 's-1', 'archive'), { done: true });
  assert.equal(h.index.snapshot().sessions['target-1/s-1'].archived, true);
  h.clients[0].streams[0].push({ type: 'baseline', value: { ...project, archivedSessionIds: [] } });
  await settleTurn();
  assert.equal(h.index.snapshot().sessions['target-1/s-1'].archived, true, 'an older stream baseline cannot undo an acknowledged archive');
  h.clients[0].streams[0].push({ type: 'archived', archivedSessionIds: ['s-1'] });
  h.clients[0].streams[0].push({ type: 'archived', archivedSessionIds: [] });
  await h.until(() => h.index.snapshot().sessions['target-1/s-1']?.archived === false);
  assert.deepEqual(h.clients[0].calls.filter(([name]) => ['session/rename', 'session/fork', 'workspace/archiveSession'].includes(name)), [
    ['session/rename', { request: { sessionId: 's-1', title: 'Renamed' } }],
    ['session/fork', { request: { sessionId: 's-1' } }],
    ['workspace/archiveSession', { request: { sessionId: 's-1' } }],
  ]);
});

test('session commands reject offline, unsupported actions, missing titles, and malformed fork replies', async t => {
  const offline = controlledMirror({ connections: [] });
  t.after(() => offline.supervisor.stop());
  for (const action of ['rename', 'fork', 'archive']) {
    await assert.rejects(() => offline.supervisor.sessionCommand('target-1', 's-1', action, { title: 'name' }), error => error.code === 't3-remote/target-unavailable');
  }
  const h = controlledMirror({ sessions: [ordinary], onCommand: () => ({ sessionId: '' }) });
  t.after(() => h.supervisor.stop());
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  await assert.rejects(() => h.supervisor.sessionCommand('target-1', 's-1', 'delete'), error => error.code === 't3-remote/invalid-action');
  await assert.rejects(() => h.supervisor.sessionCommand('target-1', 's-1', 'rename'), error => error.code === 't3-remote/invalid-title');
  await assert.rejects(() => h.supervisor.sessionCommand('target-1', 's-1', 'fork'), error => error.code === 't3-remote/fork-failed');
});

test('session command failures and cancellations preserve the mirror and do not block later writes', async t => {
  const pending = deferred();
  const started = deferred();
  let commandSignal;
  let fail = true;
  const h = controlledMirror({ sessions: [ordinary], onCommand: (client, endpoint, args, { signal }) => {
    if (fail) { fail = false; throw new RemoteFailure('session/refused', 'refused'); }
    if (args.request.title === 'cancelled') { commandSignal = signal; started.resolve(); return pending.promise; }
    return {};
  } });
  t.after(() => { pending.resolve({}); return h.supervisor.stop(); });
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  await assert.rejects(() => h.supervisor.sessionCommand('target-1', 's-1', 'rename', { title: 'refused' }), error => error.code === 'session/refused');
  assert.equal(h.index.snapshot().sessions['target-1/s-1'].displayTitle, 'one');
  const abort = new AbortController();
  const operation = h.supervisor.sessionCommand('target-1', 's-1', 'rename', { title: 'cancelled', signal: abort.signal });
  await started.promise;
  abort.abort();
  await assert.rejects(operation, error => error.code === 'remote/cancelled');
  assert.equal(commandSignal.aborted, true);
  assert.deepEqual(await h.supervisor.sessionCommand('target-1', 's-1', 'rename', { title: 'later' }), { done: true });
  pending.resolve({});
  await settleTurn();
  assert.equal(h.index.snapshot().sessions['target-1/s-1'].displayTitle, 'later');
});

test('retiring a command generation cancels it and a queued caller abort dispatches no RPC', async t => {
  const pending = deferred();
  const started = deferred();
  const h = controlledMirror({ sessions: [ordinary], onCommand: (client, endpoint, args, { signal }) => {
    if (client.connectionId === 'conn-1') { started.resolve(signal); return pending.promise; }
    return {};
  } });
  t.after(() => { pending.resolve({}); return h.supervisor.stop(); });
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  const operation = h.supervisor.sessionCommand('target-1', 's-1', 'rename', { title: 'old generation' });
  const commandSignal = await started.promise;
  const abort = new AbortController();
  const queued = h.supervisor.sessionCommand('target-1', 's-1', 'rename', { title: 'queued', signal: abort.signal });
  abort.abort();
  await assert.rejects(queued, error => error.code === 'remote/cancelled');
  h.ssh.manager.emit({ ...connection, status: 'disconnected' });
  h.ssh.manager.emit({ ...connection, id: 'conn-2', status: 'connected' });
  await assert.rejects(operation, error => error.code === 'remote/cancelled' || error.code === 't3-remote/target-unavailable');
  assert.equal(commandSignal.aborted, true);
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  pending.resolve({});
  await settleTurn();
  assert.equal(h.index.snapshot().sessions['target-1/s-1'].displayTitle, 'one');
  assert.equal(h.clients[0].calls.filter(([name]) => name === 'session/rename').length, 1);
  assert.deepEqual(await h.supervisor.sessionCommand('target-1', 's-1', 'rename', { title: 'fresh' }), { done: true });
  assert.equal(h.clients[1].calls.filter(([name]) => name === 'session/rename').length, 1);
});

function domainGuard(storage) {
  let closed = false;
  let rejected = 0;
  const error = Object.assign(new Error('Storage domain is closed'), { name: 'DomainError' });
  for (const table of Object.values(storage)) {
    for (const key of ['get', 'put', 'delete', 'entries']) {
      const original = table[key];
      table[key] = (...args) => {
        if (closed) { rejected += 1; throw error; }
        return original(...args);
      };
    }
  }
  return { close: () => { closed = true; }, reopen: () => { closed = false; }, get rejected() { return rejected; }, error };
}

test('stop is single flight and repeated disposal never touches a subsequently closed domain', async t => {
  const h = controlledMirror({ sessions: [ordinary], options: { heartbeatMs: 25 } });
  const guard = domainGuard(h.storage);
  t.after(async () => { guard.reopen(); await h.supervisor.stop(); });
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  const closeStarted = deferred();
  const closeAllowed = deferred();
  const originalClose = h.clients[0].close;
  let closes = 0;
  h.clients[0].close = async () => { closes += 1; closeStarted.resolve(); await closeAllowed.promise; return originalClose(); };
  t.after(() => closeAllowed.resolve());
  const first = h.supervisor.stop();
  const concurrent = h.supervisor.stop();
  assert.deepEqual(h.supervisor.runtimeConnections(), {}, 'current generations are withdrawn synchronously');
  const samePromise = first === concurrent;
  await closeStarted.promise;
  closeAllowed.resolve();
  await Promise.all([first, concurrent]);
  assert.equal(samePromise, true);
  assert.equal(closes, 1);
  guard.close();
  const repeated = h.supervisor.stop();
  await repeated.catch(() => {});
  assert.equal(repeated, first);
  await h.supervisor.stop();
  assert.equal(guard.rejected, 0);
});

test('stop without markDown closes clients and watchers after their storage domain has closed', async t => {
  const h = controlledMirror({ sessions: [ordinary], options: { heartbeatMs: 25 } });
  const guard = domainGuard(h.storage);
  t.after(async () => { guard.reopen(); await h.supervisor.stop(); });
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  guard.close();
  h.index.flush = () => { throw new Error('A markDown:false stop must not access storage flush'); };
  await h.supervisor.stop({ markDown: false });
  assert.equal(guard.rejected, 0);
  assert.equal(h.clients[0].closed, true);
  assert.ok(h.clients[0].streams.every(stream => stream.closed));
  await h.supervisor.stop();
  assert.equal(guard.rejected, 0);
});

test('a markDown domain error is returned only after all owned resources have retired', async t => {
  const h = controlledMirror({ sessions: [ordinary], options: { heartbeatMs: 25 } });
  const guard = domainGuard(h.storage);
  t.after(async () => { guard.reopen(); await h.supervisor.stop().catch(() => {}); });
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  guard.close();
  const failure = h.supervisor.stop();
  await assert.rejects(failure, error => error === guard.error);
  assert.equal(h.clients[0].closed, true);
  assert.ok(h.clients[0].streams.every(stream => stream.closed));
  const repeated = h.supervisor.stop();
  await repeated.catch(() => {});
  assert.equal(repeated, failure, 'a failed stop is still idempotent');
  await assert.rejects(h.supervisor.stop(), error => error === guard.error);
  assert.equal(guard.rejected, 1, 'no duplicate domain write after the first failure');
});

test('an asynchronous markDown rejection still closes clients before returning the original domain error', async t => {
  const h = controlledMirror({ sessions: [ordinary] });
  t.after(() => h.supervisor.stop().catch(() => {}));
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  const error = Object.assign(new Error('Storage domain is closed'), { name: 'DomainError' });
  let writes = 0;
  h.index.markAllDown = async () => { writes += 1; throw error; };
  const failure = h.supervisor.stop();
  await assert.rejects(failure, actual => actual === error);
  assert.equal(h.clients[0].closed, true);
  assert.ok(h.clients[0].streams.every(stream => stream.closed));
  assert.equal(h.supervisor.stop(), failure);
  await assert.rejects(failure, actual => actual === error);
  assert.equal(writes, 1);
});

test('a persistence flush failure follows the normal sync error and recovery path', async t => {
  const h = controlledMirror({ sessions: [ordinary] });
  t.after(() => h.supervisor.stop());
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  let fail = true;
  h.index.flush = async () => { if (fail) throw new Error('persistence write rejected'); };
  await h.supervisor.createWorkspace('target-1', '/srv/flush');
  await h.until(() => h.index.getTarget('target-1')?.lastError === 'persistence write rejected');
  assert.equal(h.index.getTarget('target-1').status, 'stale');
  assert.equal(h.clients[0].closed, false);
  fail = false;
  await h.supervisor.createWorkspace('target-1', '/srv/recover');
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
});

test('a completed stop can be restarted with a new stop owner', async t => {
  const h = controlledMirror({ sessions: [ordinary] });
  t.after(() => h.supervisor.stop());
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  const first = h.supervisor.stop();
  await first;
  h.supervisor.start();
  await h.until(() => h.index.getTarget('target-1')?.status === 'ready');
  assert.equal(h.clients.length, 2);
  assert.equal(h.clients[1].closed, false);
  const second = h.supervisor.stop();
  assert.notEqual(second, first);
  await second;
  assert.equal(h.clients[1].closed, true);
});

test('background domain and logger failures cannot become fatal unhandled rejections', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { TargetSupervisor } from ${JSON.stringify(new URL('./remote-supervisor.js', import.meta.url).href)};
    import { createRemoteIndex } from ${JSON.stringify(new URL('./remote-index.js', import.meta.url).href)};
    let closedDomain = false;
    const check = () => { if (closedDomain) throw Object.assign(new Error('Storage domain is closed'), { name: 'DomainError' }); };
    const table = () => { const rows = new Map(); return {
      get: key => { check(); return rows.get(key); }, put: (key, value) => { check(); rows.set(key, value); },
      delete: key => { check(); rows.delete(key); }, entries: () => { check(); return [...rows.entries()]; },
    }; };
    const index = createRemoteIndex({ storage: { targets: table(), workspaces: table(), sessions: table() } });
    const state = { id: 'conn-1', targetId: 'target-1', status: 'connected', host: 'wsl' };
    let started, rejectList, clientClosed = false;
    const listStarted = new Promise(resolve => { started = resolve; });
    const client = {
      call: () => new Promise((resolve, reject) => { rejectList = reject; started(); }),
      pluginCall: (endpoint, payload, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true });
      }),
      follow(endpoint, args, { signal }) {
        let first = true, finish;
        const iterator = {
          [Symbol.asyncIterator]() { return this; },
          next() {
            if (first) { first = false; return Promise.resolve({ value: { type: 'baseline', value: { items: [] } }, done: false }); }
            return new Promise(resolve => { finish = () => resolve({ done: true }); signal.addEventListener('abort', finish, { once: true }); });
          },
          return() { finish?.(); return Promise.resolve({ done: true }); },
        };
        return iterator;
      },
      close: async () => { clientClosed = true; throw new Error('close failure'); },
    };
    const supervisor = new TargetSupervisor({
      ssh: { manager: { list: () => [state], onChange: () => () => {} }, targetIdForConnection: value => value.targetId },
      bridge: { readBootstrap: async () => '{}' }, index, createClient: () => client,
      logger: () => { throw new Error('logger failure'); },
    });
    supervisor.start();
    await listStarted;
    closedDomain = true;
    rejectList(new Error('forced sync failure'));
    await new Promise(resolve => setImmediate(resolve));
    await supervisor.stop({ markDown: false });
    assert.equal(clientClosed, true);
    console.log('background failures drained');
  `;
  const output = execFileSync(process.execPath, ['--unhandled-rejections=strict', '--input-type=module', '-e', script], { encoding: 'utf8', timeout: 3000 });
  assert.match(output, /background failures drained/);
});
