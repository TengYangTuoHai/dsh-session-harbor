/** Pure grouping rules, adapted from T3 Code's thread inbox and sidebar. */
export const GROUPS = Object.freeze(['pinned', 'active', 'working', 'settled']);
export const WORKING_EXIT_GRACE_MS = 2000;

/** Pending interaction takes precedence over a running agent. */
export function isWorking(session) {
  return Boolean(session.running && !session.pendingInteraction);
}

/** Both flags can coexist when another DSH surface pins a settled session. */
export function groupOf(session) {
  if (session.pinned) return 'pinned';
  if (session.settled) return 'settled';
  return isWorking(session) ? 'working' : 'active';
}

/** Apply explicit placement operations without conflating settlement with archival. */
export function transitionPlacement(placement, action, timestamp = Date.now()) {
  switch (action) {
    case 'settle':
      return { ...placement, settled: true, pinned: false, settledAt: timestamp };
    case 'unsettle':
      return { ...placement, settled: false, settledAt: null, unsettledAt: timestamp };
    case 'pin':
      return { ...placement, pinned: true, settled: false, settledAt: null };
    case 'unpin':
      return { ...placement, pinned: false };
    default:
      throw new TypeError(`Unknown placement action: ${action}`);
  }
}

/** Automatically settle only when every required safety fact is known. */
export function shouldAutoSettle(session, now, delayMs) {
  if (!Number.isFinite(now) || !Number.isFinite(delayMs) || delayMs < 0) return false;
  if (session.pinned || session.settled || session.archived) return false;
  if (session.running !== false || session.pendingInteraction !== false || session.hasBackgroundWork !== false) return false;
  if (!Number.isFinite(session.updatedAt)) return false;
  const lastActivity = Math.max(session.updatedAt, session.unsettledAt ?? 0);
  return now - lastActivity >= delayMs;
}

/** Group-specific T3 ordering; absent timestamps fall back to list activity. */
export function groupSessions(sessions) {
  const groups = Object.fromEntries(GROUPS.map((group) => [group, []]));
  for (const session of sessions) groups[groupOf(session)].push(session);
  const time = (session, group) => {
    if (group === 'pinned') return session.pinOrder ?? 0;
    if (group === 'settled') return session.settledAt ?? session.updatedAt ?? 0;
    if (group === 'working') return session.lastUserMessageAt ?? session.updatedAt ?? 0;
    return Math.max(session.createdAt ?? 0, session.unsettledAt ?? 0,
      session.requestedAt ?? 0, session.completedAt ?? 0, session.returnedAt ?? 0,
      session.updatedAt ?? 0);
  };
  for (const group of GROUPS) {
    groups[group].sort((a, b) => group === 'pinned'
      ? (time(a, group) - time(b, group) || a.id.localeCompare(b.id))
      : (time(b, group) - time(a, group) || a.id.localeCompare(b.id)));
  }
  return groups;
}

/**
 * Keep short gaps between successive agent turns in Working. Actionable
 * interactions and explicit placement changes take effect immediately.
 */
export function createWorkingTracker(now = () => Date.now()) {
  const states = new Map();
  return {
    observe(sessions) {
      const timestamp = now();
      const present = new Set();
      const result = sessions.map((session) => {
        present.add(session.id);
        const current = isWorking(session);
        const previous = states.get(session.id);
        const placement = `${Boolean(session.pinned)}:${Boolean(session.settled)}`;
        const excluded = session.pinned || session.settled || session.pendingInteraction || session.failed;
        const stale = Number.isFinite(session.completedAt) && session.completedAt <= timestamp - 60_000;
        const canWait = !current && previous?.working && !excluded && !stale && previous.placement === placement;
        const deadline = canWait ? (previous.deadline ?? timestamp + WORKING_EXIT_GRACE_MS) : null;
        const working = current || (deadline !== null && deadline > timestamp);
        const returnedAt = previous?.working && !working ? timestamp : previous?.returnedAt;
        states.set(session.id, { working, deadline: working ? deadline : null, placement, returnedAt });
        return { ...session, returnedAt: returnedAt ?? session.returnedAt, running: working && !session.pendingInteraction };
      });
      for (const id of states.keys()) if (!present.has(id)) states.delete(id);
      const deadlines = [...states.values()].map((state) => state.deadline).filter((deadline) => deadline !== null);
      return { sessions: result, nextDeadline: deadlines.length ? Math.min(...deadlines) : null };
    },
    clear() { states.clear(); },
  };
}
