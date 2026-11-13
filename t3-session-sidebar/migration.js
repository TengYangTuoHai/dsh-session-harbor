/** One-time, resumable migration of the idle sidebar sessions present at start. */
export async function settleExistingSessions({ migrations, placements, controller, listSessions, listArchived, now = Date.now }, signal) {
  const key = 'settle_existing_v1';
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
  }
  while (state.next < state.sessionIds.length) {
    checkCancelled();
    const sessionId = state.sessionIds[state.next];
    const record = placements.get(sessionId);
    // If a prior run completed the change or the user changed it after this
    // migration started, do not overwrite that newer choice during recovery.
    if (!(record?.settledAt >= state.startedAt || record?.unsettledAt >= state.startedAt)) {
      await controller.settle(sessionId);
    }
    state = { ...state, next: state.next + 1 };
    await migrations.put(key, state);
  }
  return { migrated: state.sessionIds.length };
}
