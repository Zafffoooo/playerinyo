'use strict';
function setPendingAdvance(session, generation, reason) { if (session) session.awaitingNextPlayable = { generation, reason }; }
function clearPendingAdvance(session) { if (session) session.awaitingNextPlayable = null; }
function consumePendingAdvance(session, stationId, generation) {
  const intent = session && session.awaitingNextPlayable;
  if (!intent || session.stationId !== stationId || intent.generation !== generation) return null;
  session.awaitingNextPlayable = null; return intent;
}
module.exports = { setPendingAdvance, clearPendingAdvance, consumePendingAdvance };
