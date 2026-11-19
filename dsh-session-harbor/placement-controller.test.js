import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlacementController } from './placement-controller.js';

function fixture(initial = {}, pinned = {}) {
  const records = new Map(Object.entries(structuredClone(initial)));
  const pins = new Map(Object.entries(pinned));
  const calls = [];
  const storage = {
    async get(id) { calls.push(['get', id]); return records.get(id); },
    async set(id, value) { calls.push(['set', id, structuredClone(value)]); records.set(id, structuredClone(value)); },
  };
  const host = {
    async getPinned(id) { calls.push(['getPinned', id]); return pins.get(id) ?? false; },
    async setPinned(id, value) { calls.push(['setPinned', id, value]); pins.set(id, value); },
  };
  return { records, pins, calls, storage, host };
}

test('transitions use separate host pin and persistent settlement state', async () => {
  const f = fixture({ a: { settled: true, settledAt: 2, extra: { value: 42 }, pinned: true } });
  let time = 10;
  const c = createPlacementController({ ...f, now: () => time });
  assert.deepEqual(await c.snapshot('new'), { settled: false, settledAt: null, unsettledAt: null, pinned: false });
  await c.pin('a');
  assert.deepEqual(await c.snapshot('a'), { settled: false, settledAt: null, unsettledAt: null, extra: { value: 42 }, pinned: true });
  assert.equal('pinned' in f.records.get('a'), false);
  time = 20;
  await c.settle('a');
  assert.deepEqual(await c.snapshot('a'), { settled: true, settledAt: 20, unsettledAt: null, extra: { value: 42 }, pinned: false });
  time = 30;
  await c.unsettle('a');
  assert.deepEqual(await c.snapshot('a'), { settled: false, settledAt: null, unsettledAt: 30, extra: { value: 42 }, pinned: false });
  await c.pin('a');
  await c.unpin('a');
  assert.equal((await c.snapshot('a')).pinned, false);
  const snap = await c.snapshot('a');
  snap.extra.value = 99;
  assert.equal(f.records.get('a').extra.value, 42);
});

test('reports actual conflicting state and repairs it in safe order', async () => {
  const f = fixture({ a: { settled: true, settledAt: 1 } }, { a: true });
  const c = createPlacementController({ ...f, now: () => 2 });
  assert.equal((await c.snapshot('a')).pinned, true);
  assert.equal((await c.snapshot('a')).settled, true);
  f.calls.length = 0;
  await c.pin('a');
  assert.deepEqual(f.calls.map(c => c[0]), ['get', 'setPinned', 'set']);
  f.calls.length = 0;
  await c.settle('a');
  assert.deepEqual(f.calls.map(c => c[0]), ['get', 'setPinned', 'set']);
});

test('serializes async mutations and snapshots in call order across ids', async () => {
  const f = fixture();
  let release;
  let started;
  const entered = new Promise(resolve => { started = resolve; });
  const gate = new Promise(resolve => { release = resolve; });
  const originalSet = f.storage.set;
  f.storage.set = async (...args) => { started(); await gate; return originalSet(...args); };
  const c = createPlacementController({ ...f, now: () => 10 });
  const first = c.pin('a');
  await entered;
  const second = c.settle('a');
  const snapshot = c.snapshot('a');
  const other = c.pin('b');
  assert.deepEqual(f.calls.map(call => call[0]), ['get', 'setPinned']);
  release();
  await first;
  await second;
  assert.deepEqual(await snapshot, { settled: true, settledAt: 10, unsettledAt: null, pinned: false });
  await other;
  assert.equal((await c.snapshot('b')).pinned, true);
});

test('failed first or second write propagates, preserves partial effects and queue continues', async () => {
  for (const action of ['pin', 'settle']) {
    for (const failure of ['first', 'second']) {
      const f = fixture({ a: { settled: action === 'pin', settledAt: action === 'pin' ? 1 : null } }, { a: action === 'settle' });
      const firstMethod = [f.host, 'setPinned'];
      const secondMethod = [f.storage, 'set'];
      const [adapter, method] = failure === 'first' ? firstMethod : secondMethod;
      const original = adapter[method];
      let failed = false;
      adapter[method] = async (...args) => {
        if (!failed) { failed = true; throw new Error(`${action}-${failure}`); }
        return original(...args);
      };
      const c = createPlacementController({ ...f, now: () => 5 });
      const rejected = c[action]('a');
      const after = c.snapshot('a');
      await assert.rejects(rejected, new RegExp(`${action}-${failure}`));
      const state = await after;
      if (failure === 'second') assert.deepEqual([state.settled, state.pinned], action === 'pin' ? [true, true] : [false, false]);
      else assert.deepEqual([state.settled, state.pinned], action === 'pin' ? [true, false] : [false, true]);
      await c[action]('a');
      const recovered = await c.snapshot('a');
      assert.deepEqual([recovered.settled, recovered.pinned], action === 'pin' ? [false, true] : [true, false]);
    }
  }
});

test('rejected write can have taken effect; snapshot exposes the actual result', async () => {
  const f = fixture();
  const original = f.host.setPinned;
  f.host.setPinned = async (...args) => { await original(...args); throw new Error('response lost'); };
  const c = createPlacementController(f);
  await assert.rejects(c.pin('a'), /response lost/);
  assert.equal((await c.snapshot('a')).pinned, true);
});

test('validates adapters, ids, actions, records, clock and host results', async () => {
  assert.throws(() => createPlacementController(), TypeError);
  const f = fixture();
  assert.throws(() => createPlacementController({ ...f, now: 1 }), TypeError);
  const c = createPlacementController(f);
  for (const id of [null, 0, '', '  ']) {
    await assert.rejects(c.snapshot(id), TypeError);
    await assert.rejects(c.settle(id), TypeError);
  }
  await assert.rejects(c.apply('a', 'erase'), TypeError);
  assert.deepEqual(f.calls, []);
  f.records.set('a', { settled: 'yes' });
  await assert.rejects(c.pin('a'), TypeError);
  f.records.set('a', { settledAt: Infinity });
  await assert.rejects(c.snapshot('a'), TypeError);
  f.records.set('a', new Date());
  await assert.rejects(c.snapshot('a'), TypeError);
  f.records.set('a', { settled: undefined, settledAt: undefined });
  assert.deepEqual(await c.snapshot('a'), { settled: false, settledAt: null, unsettledAt: null, pinned: false });
  f.records.delete('a');
  f.pins.set('a', 'yes');
  await assert.rejects(c.snapshot('a'), TypeError);
  const invalidClock = createPlacementController({ ...f, now: () => NaN });
  await assert.rejects(invalidClock.settle('a'), TypeError);
  assert.equal(f.pins.get('a'), 'yes');
});

test('unpin can proceed while storage is unavailable', async () => {
  const f = fixture({}, { a: true });
  f.storage.get = async () => { throw new Error('offline'); };
  const c = createPlacementController(f);
  await c.unpin('a');
  assert.equal(f.pins.get('a'), false);
});
