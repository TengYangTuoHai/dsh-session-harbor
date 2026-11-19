/** Keeps each connected machine's mirror within its owning connection generation. */
import { PLACEMENT_CONTRACT } from './contract.js';
import { TargetClient, RemoteFailure } from './remote-target-client.js';

export const DEFAULT_BACKOFF_MS = [5000, 10000, 30000, 60000, 300000];
const HEARTBEAT_MS = 30000;
const BROWSE_TTL_MS = 10000;
const TITLE_LIMIT = 40;
const TITLE_CONCURRENCY = 4;

function readSelf(value) {
  const platform = typeof value?.platform === 'string' ? value.platform.slice(0, 20) : '';
  return platform ? { platform, wsl: value.wsl === true } : null;
}

function kindFromSelf(self) {
  if (self === null) return null;
  if (self.platform === 'win32') return 'windows';
  if (self.platform === 'darwin') return 'macos';
  if (self.platform === 'linux') return self.wsl ? 'wsl' : 'linux';
  return 'server';
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function withSignal(promise, signal) {
  if (!signal) return promise;
  const cancelled = () => new RemoteFailure('remote/cancelled', 'The Remote operation was cancelled.');
  if (signal.aborted) return Promise.reject(cancelled());
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** Unknown fields in a remote SessionSummary are intentionally ignored. */
export function sessionRow(item) {
  const values = item?.projections?.values ?? {};
  const title = typeof values.title === 'string' ? values.title.trim() : '';
  const cwd = typeof item?.cwd === 'string' ? item.cwd : typeof values.workingDirectory === 'string' ? values.workingDirectory : null;
  const row = {
    sessionId: String(item.sessionId),
    updatedAt: Number.isFinite(item.updatedAt) ? item.updatedAt : 0,
    running: Boolean(item.running),
    blank: Boolean(item.blank),
    agentAvailable: Boolean(item.agentAvailable),
    cwd: cwd || null,
    origin: typeof item.origin === 'string' ? item.origin : null,
  };
  if (title) row.displayTitle = title;
  return row;
}

/** Both current baseline envelopes and older plain baselines are accepted. */
export function workspaceRows(envelope) {
  const baseline = envelope && envelope.type === 'baseline' ? envelope.value : envelope;
  const globalPins = Array.isArray(baseline?.pinnedSessionIds);
  const globalArchives = Array.isArray(baseline?.archivedSessionIds);
  const pinned = new Set(globalPins ? baseline.pinnedSessionIds : []);
  const archived = new Set(globalArchives ? baseline.archivedSessionIds : []);
  const views = Array.isArray(baseline?.items) ? baseline.items : [];
  for (const view of views) {
    if (!globalPins) for (const id of Array.isArray(view?.pinnedSessionIds) ? view.pinnedSessionIds : []) pinned.add(String(id));
    if (!globalArchives) for (const id of Array.isArray(view?.archivedSessionIds) ? view.archivedSessionIds : []) archived.add(String(id));
  }
  return views.map(view => {
    const ids = (Array.isArray(view?.sessionIds) ? view.sessionIds
      : Array.isArray(view?.sessions) ? view.sessions.map(entry => entry?.sessionId) : [])
      .filter(id => typeof id === 'string' && id).map(String);
    return {
      workspaceId: String(view?.workspaceId ?? view?.id ?? ''),
      path: String(view?.path ?? ''),
      title: String(view?.title ?? ''),
      sessionIds: ids,
      pinnedSessionIds: ids.filter(id => pinned.has(id)),
      archivedSessionIds: ids.filter(id => archived.has(id)),
    };
  }).filter(row => row.workspaceId && row.path);
}

function workspaceChange(previous, frame) {
  if (frame?.type === 'baseline' || frame?.type === 'replace' || (!frame?.type && Array.isArray(frame?.items))) {
    const value = frame.type ? frame.value : frame;
    if (!Array.isArray(value?.items)) throw new Error('Invalid remote workspace baseline.');
    return { ...value, items: value.items.slice() };
  }
  if (!previous) throw new Error('Remote workspace stream did not start with a baseline.');
  switch (frame?.type) {
    case 'upsert': {
      const workspace = frame.workspace;
      const id = workspace?.workspaceId ?? workspace?.id;
      if (typeof id !== 'string') throw new Error('Invalid remote workspace update.');
      const items = previous.items.slice();
      const position = items.findIndex(item => (item.workspaceId ?? item.id) === id);
      if (position === -1) items.push(workspace);
      else items[position] = workspace;
      return { ...previous, items };
    }
    case 'remove': return { ...previous, items: previous.items.filter(item => (item.workspaceId ?? item.id) !== frame.workspaceId) };
    case 'order': {
      const order = Array.isArray(frame.workspaceIds) ? frame.workspaceIds : [];
      const rank = id => { const position = order.indexOf(id); return position === -1 ? order.length : position; };
      return { ...previous, items: previous.items.slice().sort((a, b) => rank(a.workspaceId ?? a.id) - rank(b.workspaceId ?? b.id)) };
    }
    case 'pinned': return { ...previous, pinnedSessionIds: frame.pinnedSessionIds };
    case 'archived': return { ...previous, archivedSessionIds: frame.archivedSessionIds };
    default: return previous;
  }
}

export class TargetSupervisor {
  #ssh;
  #bridge;
  #index;
  #logger;
  #createClient;
  #heartbeatMs;
  #backoff;
  #setTimeout;
  #clearTimeout;
  #tasks = new Map();
  #connections = new Map();
  #runs = new Set();
  #queues = new Map();
  #browseCache = new Map();
  #releases = new Map();
  #kinds = new Map();
  #follow = null;
  #stopped = false;
  #stopping = false;
  #stopPromise = null;

  constructor({ ssh, bridge, index, logger, createClient, heartbeatMs = HEARTBEAT_MS, backoffMs = DEFAULT_BACKOFF_MS, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout }) {
    if (!ssh || !index) throw new Error('ssh and index are required');
    this.#ssh = ssh;
    this.#bridge = bridge;
    this.#index = index;
    this.#logger = (level, message) => {
      try {
        const result = logger?.(level, message);
        if (result && typeof result.then === 'function') void Promise.resolve(result).catch(() => {});
      } catch { /* Diagnostics must not turn disposal into a process failure. */ }
    };
    this.#createClient = createClient ?? ((targetId, connectionId) => new TargetClient({ targetId, bridge, connectionId, logger: (level, message) => this.#logger(level, message) }));
    this.#heartbeatMs = heartbeatMs;
    this.#backoff = Array.isArray(backoffMs) && backoffMs.length ? backoffMs : DEFAULT_BACKOFF_MS;
    this.#setTimeout = setTimeoutFn;
    this.#clearTimeout = clearTimeoutFn;
  }

  start() {
    if (this.#follow) return;
    if (this.#stopping) throw new Error('The remote mirror is still stopping.');
    this.#stopPromise = null;
    this.#stopped = false;
    this.#index.markAllDown('Waiting for a current SSH connection.');
    this.#follow = this.#ssh.manager.onChange(state => this.#observe(state));
    for (const state of this.#ssh.manager.list()) this.#observe(state);
  }

  stop({ markDown = true } = {}) {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopped = true;
    this.#stopping = true;
    const unsubscribe = this.#follow;
    this.#follow = null;
    const tasks = [...this.#tasks.values()];
    const runs = [...this.#runs];
    this.#tasks.clear();
    this.#connections.clear();
    this.#stopPromise = Promise.resolve().then(async () => {
      const errors = [];
      try { unsubscribe?.(); } catch (error) { errors.push(error); }
      if (markDown) {
        try {
          await this.#index.markAllDown('The remote mirror is stopped.');
          await this.#index.flush?.();
        } catch (error) { errors.push(error); }
      }
      const retired = await Promise.allSettled(tasks.map(task => Promise.resolve().then(() => this.#retire(task))));
      for (const result of retired) if (result.status === 'rejected') errors.push(result.reason);
      await Promise.allSettled(runs);
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, 'Remote mirror disposal failed.');
    }).finally(() => { this.#stopping = false; });
    return this.#stopPromise;
  }

  /** Ephemeral connection identities accompany snapshots without changing stored schemas. */
  runtimeConnections() {
    return Object.fromEntries([...this.#tasks].filter(([, task]) => this.#current(task))
      .map(([targetId, task]) => [targetId, task.connectionId]));
  }

  /** Public writes retain their per-machine ordering; generation checks belong to their caller. */
  async mutate(targetId, run) {
    const previous = this.#queues.get(targetId) ?? Promise.resolve();
    const next = previous.then(() => run(), () => run());
    this.#queues.set(targetId, next.catch(() => {}));
    return next;
  }

  #current(task) {
    return !this.#stopped && !task.abort.signal.aborted && this.#tasks.get(task.targetId) === task;
  }

  #assertCurrent(task) {
    if (!this.#current(task)) throw new RemoteFailure('t3-remote/target-unavailable', 'That SSH connection is no longer current.', { targetId: task.targetId });
  }

  #observe(state) {
    if (this.#stopped || !state) return;
    const targetId = this.#ssh.targetIdForConnection(state);
    if (!targetId) return;
    if (state.status === 'connected') { this.#ensure(targetId, state); return; }
    const task = this.#tasks.get(targetId);
    if (state.status === 'connecting') {
      if (task?.connectionId === state.id) return;
      if (task) { this.#tasks.delete(targetId); void this.#retire(task); }
      this.#connections.set(targetId, state.id);
      this.#mark(targetId, state, 'connecting', null);
      return;
    }
    if (this.#connections.has(targetId) && this.#connections.get(targetId) !== state.id) return;
    if (task) { this.#tasks.delete(targetId); void this.#retire(task); }
    this.#connections.delete(targetId);
    this.#mark(targetId, state, 'down', 'The SSH connection closed.');
  }

  #mark(targetId, state, status, lastError) {
    const previous = this.#index.getTarget(targetId);
    this.#index.putTarget({
      ...previous,
      targetId,
      label: previous?.label ?? state?.label ?? state?.host ?? targetId.slice(0, 8),
      host: previous?.host ?? state?.host ?? '',
      release: previous?.release ?? null,
      pluginContract: previous?.pluginContract ?? null,
      status,
      lastSyncAt: previous?.lastSyncAt ?? null,
      lastError,
    });
  }

  #ensure(targetId, state) {
    const previous = this.#tasks.get(targetId);
    if (previous?.connectionId === state.id && this.#current(previous)) return;
    if (previous) { this.#tasks.delete(targetId); void this.#retire(previous); }
    const task = {
      targetId, connectionId: state.id, state,
      client: this.#createClient(targetId, state.id), abort: new AbortController(), close: null,
      refresh: 0, wake: null, failures: 0, syncReady: false, syncError: null,
      workspaceFirst: deferred(), workspaceState: null, workspaceError: null,
      snapshot: null, snapshotCursor: null, retiredEpochs: new Set(), snapshotRequest: 0, snapshotOrder: 0,
      pluginContract: null, pluginError: null, self: null, release: null, kind: null, lastSyncAt: null,
      listRequest: 0, creations: new Map(), pendingCreations: new Map(),
      renamedTitles: new Map(), pendingArchives: new Set(),
    };
    this.#tasks.set(targetId, task);
    this.#connections.set(targetId, state.id);
    this.#mark(targetId, state, 'connecting', null);
    const run = this.#run(task);
    this.#runs.add(run);
    void run.then(() => this.#runs.delete(run), error => {
      this.#runs.delete(run);
      try { this.#logger('error', `remote ${targetId} task failed: ${String(error?.message ?? error)}`); } catch {}
    });
  }

  #retire(task) {
    task.abort.abort();
    task.workspaceFirst.resolve();
    if (!task.close) {
      this.#dropBrowseCache(task.targetId);
      this.#releases.delete(task.connectionId);
      this.#kinds.delete(task.connectionId);
      task.close = Promise.resolve().then(() => task.client.close()).catch(error => {
        this.#logger('warn', `remote ${task.targetId} close failed: ${String(error?.message ?? error)}`);
      });
    }
    return task.close;
  }

  #publish(task) {
    if (!this.#current(task)) return;
    const previous = this.#index.getTarget(task.targetId);
    const error = task.syncError ?? task.workspaceError ?? task.pluginError;
    const status = error ? (task.failures >= 3 ? 'down' : 'stale')
      : !task.syncReady ? 'connecting'
        : task.pluginContract !== null && task.pluginContract !== PLACEMENT_CONTRACT ? 'incompatible' : 'ready';
    this.#index.putTarget({
      ...previous,
      targetId: task.targetId,
      label: String(task.state.label ?? task.state.host ?? previous?.label ?? task.targetId.slice(0, 8)).slice(0, 120),
      host: String(task.state.host ?? previous?.host ?? '').slice(0, 255),
      kind: task.kind ?? previous?.kind ?? null,
      release: task.release,
      pluginContract: task.pluginContract,
      status,
      lastSyncAt: task.lastSyncAt ?? previous?.lastSyncAt ?? null,
      lastError: error ? String(error.message ?? error).slice(0, 500) : null,
    });
  }

  async #run(task) {
    const watchers = [this.#watch(task), this.#watchWorkspaces(task)];
    const drained = Promise.allSettled(watchers.map(watch => watch.catch(error => {
      task.abort.abort();
      this.#logger('error', `remote ${task.targetId} watcher failed: ${String(error?.message ?? error)}`);
    })));
    try {
      while (this.#current(task)) {
        const refresh = task.refresh;
        try {
          await this.#sync(task);
          await this.#index.flush?.();
          this.#assertCurrent(task);
          task.failures = 0;
          task.syncError = null;
          task.syncReady = true;
          task.lastSyncAt = Date.now();
        } catch (error) {
          if (!this.#current(task)) break;
          task.failures += 1;
          task.syncError = error;
          this.#logger('warn', `remote ${task.targetId} sync failed: ${String(error?.message ?? error)}`);
        }
        this.#publish(task);
        if (!this.#current(task)) break;
        if (task.refresh !== refresh) continue;
        const delay = task.syncError ? this.#backoff[Math.min(task.failures - 1, this.#backoff.length - 1)] : this.#heartbeatMs;
        const wake = { current: null };
        task.wake = () => wake.current?.();
        await this.#sleep(delay, task.abort.signal, wake);
        task.wake = null;
      }
    } finally {
      try {
        if (this.#tasks.get(task.targetId) === task) {
          this.#tasks.delete(task.targetId);
          this.#mark(task.targetId, task.state, 'down', 'The remote mirror stopped synchronizing.');
          await this.#index.flush?.();
        }
      } finally {
        try { await this.#retire(task); }
        finally { await drained; }
      }
    }
  }

  #sleep(ms, signal, wake) {
    if (signal.aborted) return Promise.resolve();
    return new Promise(resolve => {
      let timer;
      const done = () => {
        this.#clearTimeout(timer);
        signal.removeEventListener('abort', done);
        if (wake) wake.current = null;
        resolve();
      };
      if (wake) wake.current = done;
      signal.addEventListener('abort', done, { once: true });
      timer = this.#setTimeout(done, ms);
      if (signal.aborted) done();
    });
  }

  #applyWorkspaceFlags(task) {
    let flags = task.workspaceState ?? {};
    if (task.pendingArchives.size) {
      const archived = flags.archivedSessionIds ?? Object.values(this.#index.snapshot().sessions)
        .filter(row => row.targetId === task.targetId && row.archived).map(row => row.sessionId);
      flags = { ...flags, archivedSessionIds: [...new Set([...archived, ...task.pendingArchives])] };
    }
    this.#index.applyWorkspaceFlags(task.targetId, flags);
  }

  async #sync(task) {
    const { client, targetId, abort: { signal } } = task;
    task.release = await this.#release(task);
    this.#assertCurrent(task);
    const listRequest = ++task.listRequest;
    const listed = await client.call('session/list', { _request: {} }, { signal });
    this.#assertCurrent(task);
    const rows = (Array.isArray(listed?.items) ? listed.items : []).map(item => {
      const row = sessionRow(item);
      if (Object.hasOwn(task.snapshot?.statuses ?? {}, row.sessionId)) row.running = task.snapshot.statuses[row.sessionId] === true;
      const renamed = task.renamedTitles.get(row.sessionId);
      if (renamed) {
        if (listRequest > renamed.afterListRequest && row.displayTitle === renamed.title) task.renamedTitles.delete(row.sessionId);
        else row.displayTitle = renamed.title;
      }
      return row;
    });
    this.#index.syncSessions(targetId, rows);
    await this.#index.flush?.();
    this.#assertCurrent(task);
    this.#index.applyPlacements(targetId, task.snapshot?.placements ?? {});
    this.#index.applyStatuses(targetId, task.snapshot?.statuses ?? {});
    this.#applyWorkspaceFlags(task);
    for (const [workspaceId, pending] of task.pendingCreations) {
      const row = rows.find(row => row.sessionId === pending.sessionId);
      if (row || listRequest > pending.afterListRequest) task.pendingCreations.delete(workspaceId);
    }
    await task.workspaceFirst.promise;
    this.#assertCurrent(task);
    try {
      const order = ++task.snapshotRequest;
      const update = await client.pluginCall('t3-session-sidebar/snapshot', {}, { signal });
      this.#assertCurrent(task);
      this.#acceptSnapshot(task, update, order);
      task.pluginError = null;
    } catch (error) {
      this.#assertCurrent(task);
      if (task.snapshot) task.pluginError = error;
      this.#logger('warn', `remote ${targetId} placement snapshot failed: ${String(error?.message ?? error)}`);
    }
    await this.#titles(task);
    task.kind = await this.#kind(task);
    this.#assertCurrent(task);
  }

  #acceptSnapshot(task, update, order) {
    this.#assertCurrent(task);
    const epoch = typeof update?.epoch === 'string' ? update.epoch : null;
    const revision = Number.isInteger(update?.revision) && update.revision >= 0 ? update.revision : null;
    const cursor = epoch !== null && revision !== null ? { epoch, revision } : null;
    if (cursor) {
      if (task.retiredEpochs.has(epoch)) return false;
      if (task.snapshotCursor?.epoch === epoch && revision <= task.snapshotCursor.revision) return false;
      if (task.snapshotCursor && task.snapshotCursor.epoch !== epoch) task.retiredEpochs.add(task.snapshotCursor.epoch);
    } else if (task.snapshotCursor || order < task.snapshotOrder) return false;
    task.snapshotOrder = order;
    task.snapshotCursor = cursor;
    task.snapshot = update;
    task.pluginContract = Number.isInteger(update?.contract) ? update.contract : 0;
    task.self = readSelf(update?.self) ?? task.self;
    task.pluginError = null;
    this.#index.applyPlacements(task.targetId, update?.placements ?? {});
    if (this.#index.applyStatuses(task.targetId, update?.statuses ?? {}) > 0) this.#kick(task.targetId);
    return true;
  }

  async #watch(task) {
    const signal = task.abort.signal;
    while (this.#current(task)) {
      try {
        const order = ++task.snapshotRequest;
        const update = await task.client.pluginCall('t3-session-sidebar/snapshot', task.snapshotCursor ?? {}, { signal });
        if (!this.#current(task)) return;
        const changed = this.#acceptSnapshot(task, update, order);
        if (changed) this.#publish(task);
        if (!task.snapshotCursor) return;
        if (!changed) await this.#sleep(250, signal);
      } catch (error) {
        if (!this.#current(task)) return;
        const quiet = /timed out|cancel|closed/i.test(String(error?.message ?? error));
        if (!quiet) {
          if (task.snapshot) { task.pluginError = error; this.#publish(task); }
          this.#logger('warn', `remote ${task.targetId} change watch failed: ${String(error?.message ?? error)}`);
        }
        await this.#sleep(quiet ? 0 : 2000, signal);
      }
    }
  }

  async #watchWorkspaces(task) {
    const signal = task.abort.signal;
    let failures = 0;
    try {
      while (this.#current(task)) {
        let baseline = null;
        try {
          const iterator = task.client.follow('workspace/follow', {}, { signal })[Symbol.asyncIterator]();
          try {
            for await (const frame of iterator) {
              if (!this.#current(task)) return;
              const next = workspaceChange(baseline, frame);
              if (next === baseline) continue;
              baseline = next;
              task.workspaceState = next;
              for (const id of task.pendingArchives) if (next.archivedSessionIds?.includes(id)) task.pendingArchives.delete(id);
              this.#index.syncWorkspaces(task.targetId, workspaceRows(next));
              await this.#index.flush?.();
              this.#assertCurrent(task);
              this.#applyWorkspaceFlags(task);
              await this.#index.flush?.();
              this.#assertCurrent(task);
              task.workspaceError = null;
              task.workspaceFirst.resolve();
              failures = 0;
              this.#publish(task);
            }
          } finally {
            await iterator.return?.();
          }
          if (!this.#current(task)) return;
          throw new Error('The remote workspace stream ended.');
        } catch (error) {
          if (!this.#current(task)) return;
          task.workspaceError = error;
          task.workspaceFirst.resolve();
          this.#publish(task);
          this.#logger('warn', `remote ${task.targetId} workspace watch failed: ${String(error?.message ?? error)}`);
          await this.#sleep(this.#backoff[Math.min(failures++, this.#backoff.length - 1)], signal);
        }
      }
    } finally {
      task.workspaceFirst.resolve();
    }
  }

  async #titles(task) {
    const rows = Object.values(this.#index.snapshot().sessions)
      .filter(row => row.targetId === task.targetId && row.displayTitle === row.sessionId.slice(0, 8))
      .slice(0, TITLE_LIMIT);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(TITLE_CONCURRENCY, rows.length) }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++];
        this.#assertCurrent(task);
        try {
          const projections = await task.client.call('session/projections', { request: { sessionId: row.sessionId } }, { signal: task.abort.signal });
          this.#assertCurrent(task);
          this.#index.setTitle(task.targetId, row.sessionId, task.renamedTitles.get(row.sessionId)?.title ?? projections?.values?.title ?? '');
        } catch (error) {
          this.#assertCurrent(task);
          this.#logger('warn', `remote ${task.targetId} title lookup failed: ${String(error?.message ?? error)}`);
        }
      }
    });
    await Promise.all(workers);
  }

  async #kind(task) {
    if (this.#kinds.has(task.connectionId)) return this.#kinds.get(task.connectionId);
    const reported = kindFromSelf(task.self);
    if (reported !== null) { this.#kinds.set(task.connectionId, reported); return reported; }
    let kind = null;
    try {
      const listing = await task.client.call('directoryPicker/list', {}, { signal: task.abort.signal });
      this.#assertCurrent(task);
      this.#browseCache.set(task.targetId + '|', { at: Date.now(), value: listing });
      const home = String(listing?.home ?? '');
      if (/^[A-Za-z]:[\\/]/.test(home)) kind = 'windows';
      else if (home.startsWith('/Users/')) kind = 'macos';
      else if (home.startsWith('/')) kind = 'linux';
      else if (home) kind = 'server';
    } catch (error) {
      this.#assertCurrent(task);
      this.#logger('warn', `remote kind lookup failed: ${String(error?.message ?? error)}`);
    }
    this.#kinds.set(task.connectionId, kind);
    return kind;
  }

  async #release(task) {
    if (this.#releases.has(task.connectionId)) return this.#releases.get(task.connectionId);
    let release = null;
    try {
      const bootstrap = await withSignal(this.#bridge.readBootstrap(task.connectionId, { signal: task.abort.signal }), task.abort.signal);
      this.#assertCurrent(task);
      const version = /"version"\s*:\s*"([^"]{1,60})"/.exec(bootstrap)?.[1] ?? null;
      const commit = /"commit"\s*:\s*"([^"]{1,60})"/.exec(bootstrap)?.[1] ?? null;
      if (version) release = { version, commit };
    } catch (error) {
      this.#assertCurrent(task);
      this.#logger('warn', `remote release lookup failed: ${String(error?.message ?? error)}`);
    }
    this.#releases.set(task.connectionId, release);
    return release;
  }

  async browse(targetId, path, { refresh = false, signal } = {}) {
    const task = this.#live(targetId);
    const wanted = typeof path === 'string' && path ? path : '';
    const key = targetId + '|' + wanted;
    if (!refresh) {
      const cached = this.#browseCache.get(key);
      if (cached && Date.now() - cached.at < BROWSE_TTL_MS) return cached.value;
    }
    const listing = await task.client.call('directoryPicker/list', wanted ? { path: wanted } : {}, { signal: signal ?? task.abort.signal });
    this.#assertCurrent(task);
    this.#browseCache.set(key, { at: Date.now(), value: listing });
    return listing;
  }

  #write(task, run) {
    return this.mutate(task.targetId, async () => {
      this.#assertCurrent(task);
      const value = await run(task.client, task.abort.signal);
      this.#assertCurrent(task);
      return value;
    });
  }

  async createDirectory(targetId, path, name) {
    const task = this.#live(targetId);
    const value = await this.#write(task, (client, signal) => client.call('directoryPicker/createDirectory', { path, name }, { signal }));
    this.#dropBrowseCache(targetId);
    return value;
  }

  async createWorkspace(targetId, path) {
    const task = this.#live(targetId);
    const value = await this.#write(task, (client, signal) => client.call('workspace/create', { request: { path } }, { signal }));
    this.#kick(targetId);
    return value;
  }

  async deleteWorkspace(targetId, workspaceId, { confirmed = false } = {}) {
    if (confirmed !== true) throw new RemoteFailure('t3-remote/confirmation-required', 'Deleting a project needs an explicit confirmation.', { targetId, workspaceId });
    const task = this.#live(targetId);
    const value = await this.#write(task, (client, signal) => client.call('workspace/delete', { request: { workspaceId } }, { signal }));
    task.pendingCreations.delete(workspaceId);
    this.#kick(targetId);
    return value;
  }

  async createSession(targetId, workspaceId, { signal } = {}) {
    if (signal?.aborted) throw new RemoteFailure('remote/cancelled', 'The Remote operation was cancelled.');
    const task = this.#live(targetId);
    if (task.creations.has(workspaceId)) return withSignal(task.creations.get(workspaceId), signal);
    const creation = this.#write(task, async (client, operationSignal) => {
      const workspace = this.#index.workspace?.(targetId, workspaceId);
      if (!workspace) throw new RemoteFailure('t3-remote/workspace-unknown', 'That project is not in the mirror, so a session cannot start in it.', { targetId, workspaceId });
      const reusable = this.#index.blankSession?.(targetId, workspace.path);
      if (reusable) return { sessionId: reusable.sessionId, reused: true };
      const pending = task.pendingCreations.get(workspaceId);
      if (pending?.cwd === workspace.path) return { sessionId: pending.sessionId, reused: true };
      const value = await client.call('session/create', { request: { workspaceId } }, { signal: operationSignal });
      this.#assertCurrent(task);
      const sessionId = typeof value?.sessionId === 'string' ? value.sessionId : null;
      if (!sessionId) throw new RemoteFailure('t3-remote/create-failed', 'That machine did not answer with a session id.', { targetId, workspaceId });
      task.pendingCreations.set(workspaceId, { sessionId, cwd: workspace.path, afterListRequest: task.listRequest });
      this.#kick(targetId);
      return { sessionId, reused: false };
    });
    task.creations.set(workspaceId, creation);
    const clear = () => { if (task.creations.get(workspaceId) === creation) task.creations.delete(workspaceId); };
    void creation.then(clear, clear);
    return withSignal(creation, signal);
  }

  async sessionCommand(targetId, sessionId, action, { title, signal } = {}) {
    const task = this.#live(targetId);
    const endpoint = { rename: 'session/rename', fork: 'session/fork', archive: 'workspace/archiveSession' }[action];
    if (!['rename', 'fork', 'archive'].includes(action)) throw new RemoteFailure('t3-remote/invalid-action', 'Unknown session command.', { action });
    if (action === 'rename' && (typeof title !== 'string' || !title.trim() || title.trim().length > 500)) {
      throw new RemoteFailure('t3-remote/invalid-title', 'A session title must contain 1 to 500 characters.');
    }
    const request = { sessionId, ...(action === 'rename' ? { title: title.trim() } : {}) };
    const operationSignal = signal ? AbortSignal.any([task.abort.signal, signal]) : task.abort.signal;
    return withSignal(this.#write(task, async client => {
      if (operationSignal.aborted) throw new RemoteFailure('remote/cancelled', 'The Remote operation was cancelled.');
      const value = await withSignal(client.call(endpoint, { request }, { signal: operationSignal }), operationSignal);
      this.#assertCurrent(task);
      let result = { done: true };
      if (action === 'rename') {
        task.renamedTitles.set(sessionId, { title: request.title, afterListRequest: task.listRequest });
        this.#index.setTitle(targetId, sessionId, request.title);
      } else if (action === 'archive') {
        if (!Array.isArray(value?.archivedSessionIds) || !value.archivedSessionIds.includes(sessionId)) {
          throw new RemoteFailure('t3-remote/archive-failed', 'That machine did not confirm the archived session.');
        }
        if (!task.workspaceState?.archivedSessionIds?.includes(sessionId)) task.pendingArchives.add(sessionId);
        this.#applyWorkspaceFlags(task);
      } else {
        if (typeof value?.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(value.sessionId)) {
          throw new RemoteFailure('t3-remote/fork-failed', 'That machine did not answer with a valid session id.');
        }
        result = { sessionId: value.sessionId };
      }
      this.#kick(targetId);
      return result;
    }), operationSignal);
  }

  async act(targetId, sessionId, action, { signal } = {}) {
    const task = this.#live(targetId);
    const contract = this.#index.getTarget(targetId)?.pluginContract;
    if (contract !== PLACEMENT_CONTRACT) throw new RemoteFailure('t3-remote/plugin-missing', 'That machine has no sidebar plugin, so its sessions cannot be pinned or settled from here.', { targetId, contract: contract ?? null });
    const value = await withSignal(this.#write(task, (client, operationSignal) => client.pluginCall('t3-session-sidebar/action', { sessionId, action }, { signal: operationSignal })), signal);
    this.#kick(targetId);
    return value;
  }

  #live(targetId) {
    const task = this.#tasks.get(targetId);
    if (!task || !this.#current(task)) throw new RemoteFailure('t3-remote/target-unavailable', 'That machine is not connected right now.', { targetId });
    return task;
  }

  #kick(targetId) {
    const task = this.#tasks.get(targetId);
    if (!task || !this.#current(task)) return;
    task.refresh += 1;
    task.wake?.();
  }

  #dropBrowseCache(targetId) {
    const prefix = targetId + '|';
    for (const key of this.#browseCache.keys()) if (key.startsWith(prefix)) this.#browseCache.delete(key);
  }
}
