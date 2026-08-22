'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setPendingAdvance, clearPendingAdvance, consumePendingAdvance } = require('./radio-pending-advance');
test('tail intent consumes once when a same-station append becomes playable', () => {
  const session = { stationId: 'a' }; setPendingAdvance(session, 4, 'manual-next');
  assert.equal(consumePendingAdvance(session, 'a', 4).reason, 'manual-next');
  assert.equal(consumePendingAdvance(session, 'a', 4), null);
});
test('Previous, Stop, or station replacement clears/stales a pending advance', () => {
  const session = { stationId: 'a' }; setPendingAdvance(session, 4, 'ended'); clearPendingAdvance(session);
  assert.equal(consumePendingAdvance(session, 'a', 4), null);
  setPendingAdvance(session, 4, 'ended'); assert.equal(consumePendingAdvance(session, 'b', 4), null);
});
