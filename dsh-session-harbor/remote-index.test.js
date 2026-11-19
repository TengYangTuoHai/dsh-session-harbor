import nodeTest from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteIndex, remoteIndexSpec, sessionRef, workspaceRef } from './remote-index.js';

const test = (name, run) => nodeTest(name, { timeout: 5000 }, run);

function memoryStorage() {
  const table = () => {
    const rows = new Map();
    return { get: id => rows.get(id), put: (id, value) => rows.set(id, value), delete: id => rows.delete(id), entries: () => [...rows.entries()] };
  };
  return { targets: table(), workspaces: table(), sessions: table() };
}

const target = { targetId: 'target-1', label: 'wsl', host: 'wsl', release: null, pluginContract: null, status: 'connecting', lastSyncAt: null, lastError: null };
const session = (sessionId, extra = {}) => ({ sessionId, updatedAt: 100, running: false, blank: false, agentAvailable: true, ...extra });

test('the domain name and tables follow the storage naming rules', () => {
  assert.equal(remoteIndexSpec.name, 'local_t3_remote_index');
  assert.deepEqual(Object.keys(remoteIndexSpec.tables), ['targets', 'workspaces', 'sessions']);
});

test('targets are keyed by the saved ssh target id', () => {
  const storage = memoryStorage();
  const index = createRemoteIndex({ storage });
  index.putTarget(target);
  assert.equal(index.getTarget('target-1').label, 'wsl');
  index.putTarget({ ...target, status: 'ready', lastSyncAt: 5 });
  assert.equal(storage.targets.entries().length, 1);
  assert.equal(index.getTarget('target-1').status, 'ready');
});

test('a target is rejected when its id cannot be a safe key prefix', () => {
  const index = createRemoteIndex({ storage: memoryStorage() });
  assert.throws(() => index.putTarget({ ...target, targetId: 'bad/id' }), /targetId/);
});

test('workspace sync replaces the machine mirror', () => {
  const storage = memoryStorage();
  const index = createRemoteIndex({ storage });
  index.syncWorkspaces('target-1', [
    { workspaceId: 'w-1', path: '/srv/app', title: 'app', sessionIds: ['s-1', 's-2'], pinnedSessionIds: ['s-2'], archivedSessionIds: [] },
    { workspaceId: 'w-2', path: '/srv/other', title: 'other', sessionIds: [], pinnedSessionIds: [], archivedSessionIds: [] },
  ]);
  assert.equal(storage.workspaces.entries().length, 2);
  index.syncWorkspaces('target-1', [{ workspaceId: 'w-2', path: '/srv/other', title: 'other', sessionIds: [], pinnedSessionIds: [], archivedSessionIds: [] }]);
  assert.deepEqual([...storage.workspaces.keys?.() ?? storage.workspaces.entries().map(([key]) => key)], ['target-1/w-2']);
  index.syncWorkspaces('target-2', [{ workspaceId: 'w-1', path: '/srv/app', title: 'app', sessionIds: [], pinnedSessionIds: [], archivedSessionIds: [] }]);
  assert.equal(storage.workspaces.entries().length, 2, 'another machine keeps its own rows');
});

test('session sync keeps cached titles and flags when the baseline omits them', () => {
  const storage = memoryStorage();
  const index = createRemoteIndex({ storage });
  index.syncSessions('target-1', [session('s-1', { cwd: '/srv/app' })]);
  index.setTitle('target-1', 's-1', 'Fix the deploy');
  index.applyPlacements('target-1', { 's-1': { settled: true } });
  index.syncSessions('target-1', [session('s-1', { cwd: '/srv/app', updatedAt: 200 })]);
  const row = storage.sessions.get(sessionRef('target-1', 's-1'));
  assert.deepEqual([row.displayTitle, row.settled, row.updatedAt], ['Fix the deploy', true, 200]);
});

test('session sync drops rows the machine no longer reports', () => {
  const storage = memoryStorage();
  const index = createRemoteIndex({ storage });
  index.syncSessions('target-1', [session('s-1'), session('s-2')]);
  index.syncSessions('target-1', [session('s-2')]);
  assert.deepEqual(storage.sessions.entries().map(([key]) => key), ['target-1/s-2']);
});

test('workspace flags land on the session rows', () => {
  const storage = memoryStorage();
  const index = createRemoteIndex({ storage });
  index.syncSessions('target-1', [session('s-1'), session('s-2')]);
  index.syncWorkspaces('target-1', [{ workspaceId: 'w-1', path: '/srv/app', title: 'app', sessionIds: ['s-1'], pinnedSessionIds: ['s-1'], archivedSessionIds: [] }]);
  assert.equal(index.applyWorkspaceFlags('target-1'), 1);
  const row = storage.sessions.get(sessionRef('target-1', 's-1'));
  assert.deepEqual([row.pinned, row.workspaceId], [true, 'w-1']);
  assert.equal(storage.sessions.get(sessionRef('target-1', 's-2')).workspaceId, null);
  index.applyWorkspaceFlags('target-1', { pinnedSessionIds: ['s-2'], archivedSessionIds: ['s-2'] });
  assert.equal(storage.sessions.get(sessionRef('target-1', 's-1')).pinned, false, 'global state supersedes stale per-workspace flags');
  assert.deepEqual([
    storage.sessions.get(sessionRef('target-1', 's-2')).pinned,
    storage.sessions.get(sessionRef('target-1', 's-2')).archived,
  ], [true, true], 'ungrouped sessions still have global flags');
  index.syncWorkspaces('target-1', []);
  index.applyWorkspaceFlags('target-1', { pinnedSessionIds: ['s-2'], archivedSessionIds: ['s-2'] });
  assert.equal(storage.sessions.get(sessionRef('target-1', 's-2')).pinned, true);
});

test('placements only touch rows that exist', () => {
  const storage = memoryStorage();
  const index = createRemoteIndex({ storage });
  index.syncSessions('target-1', [session('s-1')]);
  assert.equal(index.applyPlacements('target-1', { 's-1': { settled: true }, 'ghost': { settled: true } }), 1);
  assert.equal(storage.sessions.entries().length, 1);
});

test('losing the connection marks rows down instead of deleting them', () => {
  const storage = memoryStorage();
  const index = createRemoteIndex({ storage });
  index.putTarget({ ...target, status: 'ready' });
  index.syncSessions('target-1', [session('s-1')]);
  index.markAllDown();
  assert.equal(index.getTarget('target-1').status, 'down');
  assert.equal(storage.sessions.entries().length, 1, 'the mirror stays readable');
  index.markAllDown('The remote mirror is stopped.');
  assert.equal(index.getTarget('target-1').lastError, 'The remote mirror is stopped.');
});

test('removing a target cascades its mirror away', () => {
  const storage = memoryStorage();
  const index = createRemoteIndex({ storage });
  index.putTarget(target);
  index.syncWorkspaces('target-1', [{ workspaceId: 'w-1', path: '/srv/app', title: 'app', sessionIds: [], pinnedSessionIds: [], archivedSessionIds: [] }]);
  index.syncSessions('target-1', [session('s-1')]);
  index.syncSessions('target-2', [session('s-9')]);
  index.removeTarget('target-1');
  assert.deepEqual(storage.sessions.entries().map(([key]) => key), ['target-2/s-9']);
  assert.deepEqual(storage.workspaces.entries().map(([key]) => key), []);
  assert.equal(index.getTarget('target-1'), undefined);
});

test('an empty title falls back to the short session id', () => {
  const storage = memoryStorage();
  const index = createRemoteIndex({ storage });
  index.syncSessions('target-1', [session('s-1234567890ab')]);
  index.setTitle('target-1', 's-1234567890ab', '   ');
  assert.equal(storage.sessions.get(sessionRef('target-1', 's-1234567890ab')).displayTitle, 's-123456');
});

test('blank reuse excludes running and archived rows and stays within its machine', () => {
  const index = createRemoteIndex({ storage: memoryStorage() });
  index.syncSessions('target-1', [
    session('busy', { blank: true, running: true, cwd: '/srv/app' }),
    session('archived', { blank: true, archived: true, cwd: '/srv/app' }),
    session('eligible', { blank: true, cwd: '/srv/app' }),
  ]);
  index.syncSessions('target-2', [session('elsewhere', { blank: true, cwd: '/srv/app' })]);
  assert.equal(index.blankSession('target-1', '/srv/app')?.sessionId, 'eligible');
  assert.equal(index.blankSession('target-2', '/srv/app')?.sessionId, 'elsewhere');
  assert.equal(index.blankSession('target-1', '/srv/missing'), null);
});

test('the snapshot is a plain JSON mirror for the client', () => {
  const storage = memoryStorage();
  const index = createRemoteIndex({ storage });
  index.putTarget(target);
  index.syncSessions('target-1', [session('s-1')]);
  const value = index.snapshot();
  assert.deepEqual(Object.keys(value), ['targets', 'workspaces', 'sessions']);
  assert.equal(value.sessions[sessionRef('target-1', 's-1')].sessionId, 's-1');
  assert.equal(JSON.parse(JSON.stringify(value)).targets[workspaceRef('target-1', 'x')] ?? undefined, undefined);
});

function durableStorage(control = {}) {
  const table = () => {
    const rows = new Map();
    let tail = Promise.resolve();
    const enqueue = operation => {
      if (control.error) return Promise.reject(control.error);
      const result = tail.then(async () => { await control.gate; return operation(); });
      tail = result.catch(() => {});
      return result;
    };
    return {
      get: key => rows.get(key), entries: () => rows.entries(),
      put: (key, value) => enqueue(() => rows.set(key, value)),
      delete: key => enqueue(() => rows.delete(key)),
    };
  };
  return { targets: table(), workspaces: table(), sessions: table() };
}

test('independent patches merge before native asynchronous durability and flush publishes the complete row', async () => {
  let release;
  const storage = durableStorage({ gate: new Promise(resolve => { release = resolve; }) });
  const index = createRemoteIndex({ storage });
  index.putTarget(target);
  index.syncSessions('target-1', [session('s-1')]);
  index.applyPlacements('target-1', { 's-1': { settled: true } });
  index.applyStatuses('target-1', { 's-1': true });
  index.syncWorkspaces('target-1', [{ workspaceId: 'w-1', path: '/srv/app', title: 'app', sessionIds: ['s-1'], pinnedSessionIds: [], archivedSessionIds: [] }]);
  index.applyWorkspaceFlags('target-1', { pinnedSessionIds: ['s-1'], archivedSessionIds: [] });
  index.setTitle('target-1', 's-1', 'Latest title');
  assert.equal(storage.sessions.get('target-1/s-1'), undefined, 'the native table cannot see queued rows yet');
  const first = index.flush();
  assert.equal(index.flush(), first, 'concurrent readers share one durability barrier');
  release();
  await first;
  const persisted = storage.sessions.get('target-1/s-1');
  assert.deepEqual([persisted.settled, persisted.running, persisted.pinned, persisted.workspaceId, persisted.displayTitle], [true, true, true, 'w-1', 'Latest title']);
  assert.deepEqual(index.snapshot().sessions['target-1/s-1'], persisted);
  index.removeTarget('target-1');
  await index.flush();
  assert.equal([...storage.sessions.entries()].length, 0);
  assert.equal([...storage.workspaces.entries()].length, 0);
});

test('native rejected writes and failing diagnostics remain observed until flush reports the storage error', async () => {
  const control = {};
  const reported = [];
  const storage = durableStorage(control);
  const index = createRemoteIndex({ storage, onWriteError(error) { reported.push(error); throw new Error('logger failed'); } });
  index.putTarget({ ...target, status: 'ready' });
  await index.flush();
  const closed = new Error("domain 'local_t3_remote_index' is closed");
  control.error = closed;
  assert.doesNotThrow(() => index.markAllDown());
  await assert.rejects(index.flush(), error => error instanceof AggregateError && error.errors.includes(closed));
  assert.deepEqual(reported, [closed]);
  assert.equal(storage.targets.get('target-1').status, 'ready', 'a failed write never changes durable storage');
});
