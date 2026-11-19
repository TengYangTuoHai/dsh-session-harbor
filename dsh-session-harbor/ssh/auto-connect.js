/** Reconnect policy for saved SSH targets: staggered startup, per-target backoff, manual opt-out. */

export const DEFAULT_BACKOFF_MS = [5000, 10000, 30000, 60000, 300000];
const ID = /^[A-Za-z0-9-]{1,80}$/;

function checkTargetId(value) { return typeof value === 'string' && ID.test(value); }

/**
 * Keeps every saved target reachable without stampeding at startup.
 * One target's failure never blocks another's, and a deliberate disconnect
 * is respected until the user connects that target again.
 */
export class AutoConnect {
  #targets; #connect; #isActive; #logger; #concurrency; #staggerMs; #backoff; #setTimeout; #clearTimeout; #now;
  #attempts = new Map();
  #suppressed = new Set();
  #scheduled = new Map();
  #queued = [];
  #inFlight = new Set();
  #drainTimer;
  #lastStartAt = Number.NEGATIVE_INFINITY;
  #started = false;
  #stopped = false;

  constructor({
    targets, connect, isActive, logger, concurrency = 2, staggerMs = 500,
    backoffMs = DEFAULT_BACKOFF_MS, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout, now = () => Date.now(),
  } = {}) {
    if (typeof targets !== 'function') throw new TypeError('AutoConnect requires a targets provider.');
    if (typeof connect !== 'function') throw new TypeError('AutoConnect requires a connect function.');
    if (typeof isActive !== 'function') throw new TypeError('AutoConnect requires an active-connection probe.');
    if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new TypeError('AutoConnect concurrency must be a safe integer between 1 and 16.');
    if (!Number.isSafeInteger(staggerMs) || staggerMs < 0 || staggerMs > 60000) throw new TypeError('AutoConnect stagger must be a safe integer between 0 and 60000 ms.');
    if (!Array.isArray(backoffMs) || !backoffMs.length || backoffMs.some(value => !Number.isSafeInteger(value) || value < 0 || value > 3600000)) {
      throw new TypeError('AutoConnect backoff must be a nonempty array of safe-integer delays in milliseconds.');
    }
    this.#targets = targets;
    this.#connect = connect;
    this.#isActive = isActive;
    this.#logger = typeof logger === 'function' ? logger : () => {};
    this.#concurrency = concurrency;
    this.#staggerMs = staggerMs;
    this.#backoff = [...backoffMs];
    this.#setTimeout = setTimeoutFn;
    this.#clearTimeout = clearTimeoutFn;
    this.#now = now;
  }

  start() {
    if (this.#stopped) throw new Error('AutoConnect has stopped.');
    this.#started = true;
    this.#sweep();
    return this;
  }

  stop() {
    this.#stopped = true;
    for (const timer of this.#scheduled.values()) this.#clearTimeout(timer);
    this.#scheduled.clear();
    if (this.#drainTimer !== undefined) this.#clearTimeout(this.#drainTimer);
    this.#drainTimer = undefined;
    this.#queued.length = 0;
  }

  /** A saved target appeared or the user asked for it: connect it and forget earlier failures. */
  noteTarget(targetId) {
    if (!this.#started || this.#stopped || !checkTargetId(targetId)) return;
    this.#suppressed.delete(targetId);
    this.#attempts.delete(targetId);
    this.#enqueue(targetId, 0);
  }

  /** The user disconnected this target on purpose: stop retrying until they connect again. */
  suppress(targetId) {
    if (!checkTargetId(targetId)) return;
    this.#suppressed.add(targetId);
    this.#attempts.delete(targetId);
    this.#cancel(targetId);
  }

  /** A connection attempt failed: retry this target alone, with growing delay. */
  noteFailure(targetId) {
    if (!this.#started || this.#stopped || !checkTargetId(targetId) || this.#suppressed.has(targetId) || this.#inFlight.has(targetId)) return;
    const attempt = (this.#attempts.get(targetId) ?? 0) + 1;
    this.#attempts.set(targetId, attempt);
    this.#logger('warn', `auto-connect: attempt ${attempt} failed for target ${targetId}`);
    this.#enqueue(targetId, this.#backoff[Math.min(attempt - 1, this.#backoff.length - 1)]);
  }

  noteSuccess(targetId) {
    if (!checkTargetId(targetId)) return;
    this.#attempts.delete(targetId);
    this.#cancel(targetId);
  }

  status() {
    return {
      enabled: this.#started && !this.#stopped,
      concurrency: this.#concurrency,
      staggerMs: this.#staggerMs,
      backoffMs: [...this.#backoff],
      connecting: [...this.#inFlight],
      retrying: [...this.#attempts.entries()].map(([targetId, attempt]) => ({ targetId, attempt })),
      suppressed: [...this.#suppressed],
    };
  }

  #safeTargets() {
    try { return [...this.#targets() ?? []].filter(checkTargetId); } catch { return []; }
  }

  #cancel(targetId) {
    const timer = this.#scheduled.get(targetId);
    if (timer !== undefined) { this.#clearTimeout(timer); this.#scheduled.delete(targetId); }
    const index = this.#queued.indexOf(targetId);
    if (index >= 0) this.#queued.splice(index, 1);
  }

  #sweep() {
    if (!this.#started || this.#stopped) return;
    for (const targetId of this.#safeTargets()) {
      if (this.#suppressed.has(targetId) || this.#inFlight.has(targetId) || this.#scheduled.has(targetId)) continue;
      if (this.#isActive(targetId)) continue;
      this.#queued.push(targetId);
    }
    this.#drain();
  }

  #enqueue(targetId, delayMs) {
    if (this.#suppressed.has(targetId) || this.#inFlight.has(targetId) || this.#scheduled.has(targetId)) return;
    if (delayMs <= 0) {
      if (!this.#queued.includes(targetId)) this.#queued.push(targetId);
      this.#drain();
      return;
    }
    this.#scheduled.set(targetId, this.#setTimeout(() => {
      this.#scheduled.delete(targetId);
      if (!this.#queued.includes(targetId)) this.#queued.push(targetId);
      this.#drain();
    }, delayMs));
  }

  #drain() {
    if (this.#stopped) return;
    while (this.#inFlight.size < this.#concurrency && this.#queued.length) {
      const targetId = this.#queued[0];
      this.#queued.shift();
      if (this.#suppressed.has(targetId) || this.#inFlight.has(targetId) || this.#isActive(targetId)) continue;
      const wait = this.#lastStartAt + this.#staggerMs - this.#now();
      if (wait > 0) {
        this.#queued.unshift(targetId);
        if (this.#drainTimer === undefined) {
          this.#drainTimer = this.#setTimeout(() => { this.#drainTimer = undefined; this.#drain(); }, wait);
        }
        return;
      }
      this.#lastStartAt = this.#now();
      this.#inFlight.add(targetId);
      Promise.resolve().then(() => this.#connect(targetId)).then(
        () => { this.#inFlight.delete(targetId); this.#attempts.delete(targetId); this.#sweep(); },
        error => {
          this.#inFlight.delete(targetId);
          this.#logger('warn', `auto-connect: target ${targetId} failed: ${String(error?.message ?? error).slice(0, 300)}`);
          this.noteFailure(targetId);
        },
      );
    }
  }
}
