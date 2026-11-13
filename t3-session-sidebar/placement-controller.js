import { transitionPlacement } from './logic.js';

const ACTIONS = new Set(['settle', 'unsettle', 'pin', 'unpin']);

/**
 * Create a host-independent placement controller.
 *
 * storage.get(id) returns a structured-cloneable record or null/undefined;
 * storage.set(id, record) replaces it. host.getPinned(id) returns a boolean;
 * host.setPinned(id, boolean) writes it. All four methods may be async.
 * The record owns settled, settledAt and unsettledAt; the host owns pinned.
 * Extra record fields are preserved. An adapter should reject on failed writes.
 *
 * Calls through this controller, including snapshots, execute in invocation
 * order. Other writers are not locked. A rejected write may already have taken
 * effect; callers should re-read snapshot before deciding how to recover.
 */
export function createPlacementController({ storage, host, now = Date.now } = {}) {
  if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
    throw new TypeError('storage must provide get and set methods');
  }
  if (!host || typeof host.getPinned !== 'function' || typeof host.setPinned !== 'function') {
    throw new TypeError('host must provide getPinned and setPinned methods');
  }
  if (typeof now !== 'function') throw new TypeError('now must be a function');

  let tail = Promise.resolve();
  function enqueue(task) {
    const result = tail.then(task);
    tail = result.catch(() => {});
    return result;
  }
  function validateId(id) {
    if (typeof id !== 'string' || id.trim().length === 0) {
      throw new TypeError('id must be a non-empty string');
    }
  }
  async function readRecord(id) {
    const value = await storage.get(id);
    if (value == null) return { settled: false, settledAt: null, unsettledAt: null };
    if (typeof value !== 'object' || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
      throw new TypeError('invalid placement record');
    }
    const record = structuredClone(value);
    if (record.settled !== undefined && typeof record.settled !== 'boolean') {
      throw new TypeError('record.settled must be a boolean');
    }
    for (const key of ['settledAt', 'unsettledAt']) {
      if (record[key] != null && !Number.isFinite(record[key])) {
        throw new TypeError(`record.${key} must be a finite number or null`);
      }
    }
    // Never trust or persist a stale copy of the host-owned flag.
    delete record.pinned;
    return { ...record, settled: record.settled ?? false, settledAt: record.settledAt ?? null, unsettledAt: record.unsettledAt ?? null };
  }
  async function readPinned(id) {
    const pinned = await host.getPinned(id);
    if (typeof pinned !== 'boolean') throw new TypeError('host pinned state must be a boolean');
    return pinned;
  }
  async function snapshot(id) {
    validateId(id);
    return enqueue(async () => ({ ...await readRecord(id), pinned: await readPinned(id) }));
  }
  async function apply(id, action) {
    validateId(id);
    if (!ACTIONS.has(action)) throw new TypeError(`Unknown placement action: ${String(action)}`);
    return enqueue(async () => {
      if (action === 'unpin') {
        await host.setPinned(id, false);
        return;
      }
      const record = await readRecord(id);
      let timestamp = 0;
      if (action === 'settle' || action === 'unsettle') {
        timestamp = now();
        if (!Number.isFinite(timestamp)) throw new TypeError('now must return a finite number');
      }
      const next = transitionPlacement(record, action, timestamp);
      delete next.pinned;
      if (action === 'settle') {
        await host.setPinned(id, false);
        await storage.set(id, next);
      } else if (action === 'pin') {
        // A refused pin (e.g. for an archived session) must preserve settled.
        // A later storage failure can leave both flags set until a retry.
        await host.setPinned(id, true);
        await storage.set(id, next);
      } else {
        await storage.set(id, next);
      }
    });
  }
  return Object.freeze({
    snapshot,
    apply,
    settle: (id) => apply(id, 'settle'),
    unsettle: (id) => apply(id, 'unsettle'),
    pin: (id) => apply(id, 'pin'),
    unpin: (id) => apply(id, 'unpin'),
  });
}
