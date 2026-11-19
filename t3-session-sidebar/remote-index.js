/**
 * Aggregated, read-only mirror of every connected machine's sidebar state.
 *
 * The rows are a cache: the machine that owns a session stays the source of truth
 * (D1), so a dropped connection keeps its rows visible but marked, never deleted.
 */
import { z } from 'zod';

export const REMOTE_INDEX_DOMAIN = 'local_t3_remote_index';

const ID = /^[A-Za-z0-9-]{1,80}$/;
const ROW = /^[A-Za-z0-9_-]{1,200}$/;

export const targetStateSchema = z.object({
  targetId: z.string().regex(ID).min(1).max(80),
  label: z.string().min(1).max(120),
  host: z.string().min(1).max(255),
  // What sort of machine this is, so the sidebar can draw the right glyph. Inferred, never asserted.
  kind: z.enum(['linux', 'wsl', 'macos', 'windows', 'server']).nullable().default(null),
  release: z.object({ version: z.string().max(60), commit: z.string().max(60).nullable() }).nullable(),
  pluginContract: z.number().int().nonnegative().nullable(),
  status: z.enum(['connecting', 'ready', 'stale', 'down', 'incompatible']),
  lastSyncAt: z.number().finite().nullable(),
  lastError: z.string().max(500).nullable(),
}).strict();

export const workspaceRowSchema = z.object({
  targetId: z.string().regex(ID).min(1).max(80),
  workspaceId: z.string().regex(ROW).min(1).max(200),
  path: z.string().min(1).max(4096),
  title: z.string().max(500),
  sessionIds: z.array(z.string().regex(ROW).max(200)).max(5000),
  pinnedSessionIds: z.array(z.string().regex(ROW).max(200)).max(5000),
  archivedSessionIds: z.array(z.string().regex(ROW).max(200)).max(5000),
}).strict();

export const sessionRowSchema = z.object({
  targetId: z.string().regex(ID).min(1).max(80),
  sessionId: z.string().regex(ROW).min(1).max(200),
  workspaceId: z.string().regex(ROW).max(200).nullable(),
  displayTitle: z.string().max(500),
  cwd: z.string().max(4096).nullable(),
  updatedAt: z.number().finite(),
  running: z.boolean(),
  blank: z.boolean(),
  agentAvailable: z.boolean(),
  origin: z.string().max(40).nullable(),
  pinned: z.boolean(),
  archived: z.boolean(),
  settled: z.boolean(),
}).strict();

/** Passed straight to `ctx.storageDomain.open`. */
export const remoteIndexSpec = {
  name: REMOTE_INDEX_DOMAIN,
  version: 1,
  tables: {
    targets: { valueSchema: targetStateSchema },
    workspaces: { valueSchema: workspaceRowSchema },
    sessions: { valueSchema: sessionRowSchema },
  },
};

export const workspaceRef = (targetId, workspaceId) => `${targetId}/${workspaceId}`;
export const sessionRef = (targetId, sessionId) => `${targetId}/${sessionId}`;

/**
 * @param storage - the three open tables, each with `get`, `put`, `delete`, `entries`.
 */
export function createRemoteIndex({ storage, onWriteError = () => {} }) {
  const pendingWrites = new Set();
  const writeErrors = [];
  let flushing = null;
  const table = source => {
    // Native tables publish changes only after durability. Merge against the
    // latest submitted row so consecutive independent patches cannot undo one
    // another while the previous write is still queued.
    const rows = new Map(source.entries());
    return {
      get: key => rows.get(key),
      entries: () => rows.entries(),
      put(key, value) {
        const result = source.put(key, value);
        rows.set(key, value);
        return observe(result);
      },
      delete(key) {
        const result = source.delete(key);
        rows.delete(key);
        return observe(result);
      },
    };
  };
  function observe(result) {
    if (!result || typeof result.then !== 'function') return result;
    const observed = Promise.resolve(result).then(undefined, error => {
      writeErrors.push(error);
      try { onWriteError(error); } catch { /* error reporting cannot leak another rejection */ }
    });
    pendingWrites.add(observed);
    void observed.then(() => pendingWrites.delete(observed));
    return result;
  }
  function flush() {
    if (flushing) return flushing;
    const task = (async () => {
      while (pendingWrites.size) await Promise.all([...pendingWrites]);
      if (writeErrors.length) throw new AggregateError(writeErrors.splice(0), 'Remote mirror persistence failed');
    })();
    flushing = task;
    const clear = () => { if (flushing === task) flushing = null; };
    void task.then(clear, clear);
    return task;
  }
  const targets = table(storage.targets), workspaces = table(storage.workspaces), sessions = table(storage.sessions);

  function putTarget(state) {
    const value = targetStateSchema.parse(state);
    targets.put(value.targetId, value);
    return value;
  }

  /** Drop a machine and everything mirrored from it. */
  function removeTarget(targetId) {
    targets.delete(targetId);
    for (const [key] of [...workspaces.entries()]) if (key.startsWith(targetId + '/')) workspaces.delete(key);
    for (const [key] of [...sessions.entries()]) if (key.startsWith(targetId + '/')) sessions.delete(key);
  }

  function markAllDown(reason = 'The SSH connection is gone.') {
    for (const [targetId, state] of [...targets.entries()]) {
      if (state.status === 'down' && state.lastError === reason) continue;
      targets.put(targetId, { ...state, status: 'down', lastError: reason });
    }
  }

  /**
   * Replace a machine's workspace mirror. `pinnedSessionIds` and `archivedSessionIds`
   * arrive on the same baseline, so they are written here rather than per row.
   */
  function syncWorkspaces(targetId, rows) {
    const seen = new Set();
    for (const row of rows) {
      const value = workspaceRowSchema.parse({ ...row, targetId });
      seen.add(workspaceRef(targetId, value.workspaceId));
      workspaces.put(workspaceRef(targetId, value.workspaceId), value);
    }
    for (const [key] of [...workspaces.entries()]) {
      if (key.startsWith(targetId + '/') && !seen.has(key)) workspaces.delete(key);
    }
    return seen.size;
  }

  /**
   * Merge a machine's session baseline. Titles and placement flags come from other
   * sources, so an incoming row keeps whatever is already cached for fields it lacks.
   */
  function syncSessions(targetId, rows) {
    const seen = new Set();
    for (const row of rows) {
      const key = sessionRef(targetId, row.sessionId);
      const previous = sessions.get(key);
      // A short id is the placeholder shown until a title arrives from the machine.
      const value = sessionRowSchema.parse({
        displayTitle: String(previous?.displayTitle ?? String(row.sessionId).slice(0, 8)),
        cwd: null,
        workspaceId: null,
        origin: null,
        pinned: false,
        archived: false,
        settled: false,
        ...row,
        targetId,
      });
      if (previous && row.displayTitle === undefined) value.displayTitle = previous.displayTitle;
      if (previous && row.settled === undefined) value.settled = previous.settled;
      if (previous && row.pinned === undefined) value.pinned = previous.pinned;
      if (previous && row.archived === undefined) value.archived = previous.archived;
      if (previous && row.workspaceId === undefined) value.workspaceId = previous.workspaceId;
      seen.add(key);
      sessions.put(key, value);
    }
    for (const [key] of [...sessions.entries()]) {
      if (key.startsWith(targetId + '/') && !seen.has(key)) sessions.delete(key);
    }
    return seen.size;
  }

  /** Copy the placement truth from the owning machine onto the cached rows. */
  function applyPlacements(targetId, placements) {
    let changed = 0;
    for (const [sessionId, record] of Object.entries(placements ?? {})) {
      const key = sessionRef(targetId, sessionId);
      const previous = sessions.get(key);
      if (!previous || previous.settled === Boolean(record?.settled)) continue;
      sessions.put(key, { ...previous, settled: Boolean(record?.settled) });
      changed += 1;
    }
    return changed;
  }

  /** Copy pin/archive flags from the workspace baseline onto the cached rows. */
  function applyWorkspaceFlags(targetId, flags = {}) {
    const globalPins = Array.isArray(flags.pinnedSessionIds);
    const globalArchives = Array.isArray(flags.archivedSessionIds);
    const pinned = new Set(globalPins ? flags.pinnedSessionIds : []);
    const archived = new Set(globalArchives ? flags.archivedSessionIds : []);
    const membership = new Map();
    for (const [key, row] of workspaces.entries()) {
      if (!key.startsWith(targetId + '/')) continue;
      if (!globalPins) for (const id of row.pinnedSessionIds) pinned.add(id);
      if (!globalArchives) for (const id of row.archivedSessionIds) archived.add(id);
      for (const id of row.sessionIds) membership.set(id, row.workspaceId);
    }
    let changed = 0;
    for (const [key, row] of [...sessions.entries()]) {
      if (!key.startsWith(targetId + '/')) continue;
      const next = {
        ...row,
        pinned: pinned.has(row.sessionId),
        archived: archived.has(row.sessionId),
        workspaceId: membership.get(row.sessionId) ?? null,
      };
      if (next.pinned === row.pinned && next.archived === row.archived && next.workspaceId === row.workspaceId) continue;
      sessions.put(key, next);
      changed += 1;
    }
    return changed;
  }

  function setTitle(targetId, sessionId, title) {
    const key = sessionRef(targetId, sessionId);
    const previous = sessions.get(key);
    if (!previous) return false;
    const display = String(title || '').trim() || sessionId.slice(0, 8);
    if (previous.displayTitle === display) return false;
    sessions.put(key, { ...previous, displayTitle: display.slice(0, 500) });
    return true;
  }

  /**
   * Copy liveness the owning machine reported between full lists. Ids with no row are
   * counted, which is how the caller learns a session appeared and goes to fetch it.
   */
  function applyStatuses(targetId, statuses) {
    let unknown = 0;
    for (const [sessionId, running] of Object.entries(statuses ?? {})) {
      const previous = sessions.get(sessionRef(targetId, sessionId));
      if (!previous) { unknown += 1; continue; }
      const value = running === true;
      if (previous.running === value) continue;
      sessions.put(sessionRef(targetId, sessionId), { ...previous, running: value });
    }
    return unknown;
  }

  function snapshot() {
    return {
      targets: Object.fromEntries([...targets.entries()]),
      workspaces: Object.fromEntries([...workspaces.entries()]),
      sessions: Object.fromEntries([...sessions.entries()]),
    };
  }

  return {
    putTarget, removeTarget, markAllDown, flush,
    syncWorkspaces, syncSessions, applyPlacements, applyWorkspaceFlags, applyStatuses, setTitle,
    getTarget: id => targets.get(id),
    listTargets: () => Object.fromEntries([...targets.entries()]),
    workspace: (targetId, workspaceId) => workspaces.get(targetId + '/' + workspaceId),
    // The machine's own sidebar reuses a blank session before making one, and it
    // matches them by cwd — so the mirror has to answer the same question.
    blankSession: (targetId, cwd) => {
      for (const [key, row] of sessions.entries()) {
        if (!key.startsWith(targetId + '/')) continue;
        if (row.blank && !row.running && !row.archived && row.cwd === cwd) return row;
      }
      return null;
    },
    snapshot,
  };
}
