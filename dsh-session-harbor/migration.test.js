import test from 'node:test';
import assert from 'node:assert/strict';
import { settleExistingSessions } from './migration.js';

function setup() {
  const migrations = new Map();
  const placements = new Map();
  const calls = [];
  const rows = [
    { sessionId: 'old', running: false, blank: false },
    { sessionId: 'pinned', running: false, blank: false },
    { sessionId: 'running', running: true, blank: false },
    { sessionId: 'blank', running: false, blank: true },
    { sessionId: 'archived', running: false, blank: false },
    { sessionId: 'child', running: false, blank: false, origin: 'subagent' },
  ];
  const args = {
    migrations: { get: key => migrations.get(key), async put(key, value) { migrations.set(key, structuredClone(value)); } },
    placements: { get: id => placements.get(id) },
    controller: { async settle(id) { calls.push(id); placements.set(id, { settled: true, settledAt: 100, unsettledAt: null }); } },
    listSessions: async () => rows,
    listArchived: async () => ['archived'],
    now: () => 100,
  };
  return { args, rows, calls, migrations, placements };
}

test('migrates the original idle sessions once, retaining future choices', async () => {
  const f = setup();
  await settleExistingSessions(f.args);
  assert.deepEqual(f.calls, ['old', 'pinned']);
  f.placements.set('old', { settled: false, settledAt: null, unsettledAt: 200 });
  f.rows.push({ sessionId: 'new', running: false, blank: false });
  await settleExistingSessions(f.args);
  assert.deepEqual(f.calls, ['old', 'pinned']);
  assert.equal(f.placements.get('old').settled, false);
  assert.equal(f.placements.has('new'), false);
});

test('resumes captured work without overwriting a newer user choice', async () => {
  const f = setup();
  let firstFailure = true;
  const original = f.args.controller.settle;
  f.args.controller.settle = async id => {
    if (id === 'pinned' && firstFailure) { firstFailure = false; throw new Error('offline'); }
    await original(id);
  };
  await assert.rejects(settleExistingSessions(f.args), /offline/);
  f.rows.push({ sessionId: 'new', running: false, blank: false });
  f.placements.set('pinned', { settled: false, settledAt: null, unsettledAt: 101 });
  await settleExistingSessions(f.args);
  assert.deepEqual(f.calls, ['old']);
  assert.equal(f.placements.get('pinned').settled, false);
  assert.equal(f.placements.has('new'), false);
});
