import test from 'node:test';
import assert from 'node:assert/strict';
import { groupOf, groupSessions, transitionPlacement, shouldAutoSettle, createWorkingTracker } from './logic.js';

test('settled and pinned take precedence over working; a conflicting pin remains visible', () => {
  assert.equal(groupOf({ settled: true, pinned: true, running: true }), 'pinned');
  assert.equal(groupOf({ pinned: true, running: true }), 'pinned');
  assert.equal(groupOf({ running: true }), 'working');
  assert.equal(groupOf({ running: true, pendingInteraction: 'approval' }), 'active');
  assert.equal(groupOf({ running: false }), 'active');
});

test('explicit placement transitions preserve unrelated data and enforce exclusivity', () => {
  const pinned = transitionPlacement({ pinned: false, settled: true, settledAt: 1, other: 42 }, 'pin', 10);
  assert.deepEqual(pinned, { pinned: true, settled: false, settledAt: null, other: 42 });
  const settled = transitionPlacement(pinned, 'settle', 11);
  assert.equal(settled.pinned, false);
  assert.equal(settled.settled, true);
  assert.equal(settled.settledAt, 11);
  assert.equal(transitionPlacement(settled, 'unsettle', 12).unsettledAt, 12);
  assert.equal(transitionPlacement(pinned, 'unpin').pinned, false);
  assert.throws(() => transitionPlacement({}, 'unknown'), TypeError);
});

test('automatic settlement fails closed for incomplete or active facts', () => {
  const quiet = { running: false, pendingInteraction: false, hasBackgroundWork: false, updatedAt: 100 };
  assert.equal(shouldAutoSettle(quiet, 200, 100), true);
  assert.equal(shouldAutoSettle(quiet, 199, 100), false);
  assert.equal(shouldAutoSettle({ ...quiet, unsettledAt: 199 }, 200, 100), false);
  for (const patch of [{ pinned: true }, { settled: true }, { archived: true }, { running: true }, { running: undefined }, { pendingInteraction: undefined }, { pendingInteraction: true }, { hasBackgroundWork: undefined }, { hasBackgroundWork: true }]) {
    assert.equal(shouldAutoSettle({ ...quiet, ...patch }, 200, 100), false);
  }
});

test('working exit is delayed, but attention and explicit placement are immediate', () => {
  let now = 100;
  const tracker = createWorkingTracker(() => now);
  const session = { id: 'a', running: true };
  assert.equal(groupOf(tracker.observe([session]).sessions[0]), 'working');
  now = 200;
  let result = tracker.observe([{ ...session, running: false }]);
  assert.equal(groupOf(result.sessions[0]), 'working');
  assert.equal(result.nextDeadline, 2200);
  now = 2200;
  assert.equal(groupOf(tracker.observe([{ ...session, running: false }]).sessions[0]), 'active');
  tracker.observe([session]);
  assert.equal(groupOf(tracker.observe([{ ...session, pendingInteraction: 'question' }]).sessions[0]), 'active');
  tracker.observe([session]);
  assert.equal(groupOf(tracker.observe([{ ...session, running: false, settled: true }]).sessions[0]), 'settled');
  tracker.observe([session]);
  assert.equal(groupOf(tracker.observe([{ ...session, running: false, failed: true }]).sessions[0]), 'active');
  now = 100_000;
  tracker.observe([session]);
  const stale = tracker.observe([{ ...session, running: false, completedAt: 1 }]);
  assert.equal(groupOf(stale.sessions[0]), 'active');
  assert.equal(stale.sessions[0].returnedAt, now);
});

test('sessions partition once and sort by time with stable id tie break', () => {
  const result = groupSessions([
    { id: 'b', running: false, updatedAt: 10 },
    { id: 'a', running: false, updatedAt: 10 },
    { id: 'c', running: true, updatedAt: 1 },
    { id: 'd', pinned: true, updatedAt: 2 },
    { id: 'e', settled: true, updatedAt: 3 },
  ]);
  assert.deepEqual(Object.fromEntries(Object.entries(result).map(([group, rows]) => [group, rows.map(row => row.id)])), {
    pinned: ['d'], active: ['a', 'b'], working: ['c'], settled: ['e'],
  });
});
