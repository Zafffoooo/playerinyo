const test = require('node:test');
const assert = require('node:assert/strict');
const { consume } = require('../app/radio-discovery-bias');

test('More Like This budget is consumed only by accepted playable tracks', () => {
  const session = { discoveryBias: { remainingSelections: 10, strength: 1 } };

  consume(session, 0); // A blocked, ambiguous, or failed candidate.
  assert.equal(session.discoveryBias.remainingSelections, 10);
  assert.equal(session.discoveryBias.strength, 1);

  consume(session, 3);
  assert.equal(session.discoveryBias.remainingSelections, 7);
  assert.equal(session.discoveryBias.strength, 0.7);
});

test('More Like This bias clears exactly when accepted tracks exhaust it', () => {
  const session = { discoveryBias: { remainingSelections: 2, strength: 0.2 } };
  consume(session, 5);
  assert.equal(session.discoveryBias, null);
});
