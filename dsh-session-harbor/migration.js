export const MIGRATION_KEY = 'settle_existing_v1';

/** One-time, resumable migration of the idle sidebar sessions present at start. */
export async function settleExistingSessions({ migrations, placements, controller, listSessions, listArchived, now = Date.now }, signal) {
  const key = MIGRATION_KEY;
  const checkCancelled = () => { if (signal?.aborted) throw new Error('Migration cancelled'); };
  let state = migrations.get(key);
  if (!state) {
    checkCancelled();
    const [sessions, archivedIds] = await Promise.all([listSessions(signal), listArchived(signal)]);
    checkCancelled();
    const archived = new Set(archivedIds);
    const sessionIds = sessions.filter(session => !session.running && !session.blank && session.origin !== 'subagent' && !archived.has(session.sessionId)).map(session => session.sessionId);
    state = { sessionIds, next: 0, startedAt: now() };
    await migrations.put(key, state);
    state = migrations.get(key);
  }
  while (state.next < state.sessionIds.length) {
    checkCancelled();
    const sessionId = state.sessionIds[state.next];
    const record = placements.get(sessionId);
    // The legacy timestamps also protect choices imported from older versions.
    if (!(record?.settledAt >= state.startedAt || record?.unsettledAt >= state.startedAt)) {
      await controller.settle(sessionId, state.startedAt);
    }
    await migrations.put(key, { ...state, next: state.next + 1 });
    state = migrations.get(key);
  }
  return { migrated: state.sessionIds.length };
}
