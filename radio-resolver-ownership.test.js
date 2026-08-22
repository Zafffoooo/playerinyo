'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { registerRequest, unregisterRequest, cancelRequests } = require('./radio-resolver-ownership');

function session() { return { resolverRequestIds: new Set(), fillRequestIds: new Set(), transitionRequestIds: new Set() }; }
test('Next cancels obsolete transition preparation without cancelling station fill', () => {
  const value = session(); registerRequest(value, 'fill-a', 'fill'); registerRequest(value, 'prepare-a', 'transition');
  const cancelled = cancelRequests(value, 'transition', function () {});
  assert.deepEqual(cancelled, ['prepare-a']);
  assert.deepEqual(Array.from(value.fillRequestIds), ['fill-a']);
});
test('Stop Radio and station replacement cancel both fill and transition work', () => {
  const value = session(); registerRequest(value, 'fill-a', 'fill'); registerRequest(value, 'prepare-a', 'transition');
  assert.deepEqual(cancelRequests(value, undefined, function () {}).sort(), ['fill-a', 'prepare-a']);
  assert.equal(value.resolverRequestIds.size, 0);
});
test('starting station B cancels station A work without touching station B work', () => {
  const stationA = session(); const stationB = session();
  registerRequest(stationA, 'a-fill', 'fill'); registerRequest(stationA, 'a-prepare', 'transition'); registerRequest(stationB, 'b-fill', 'fill');
  assert.deepEqual(cancelRequests(stationA, undefined, function () {}).sort(), ['a-fill', 'a-prepare']);
  assert.deepEqual(Array.from(stationB.fillRequestIds), ['b-fill']);
});
test('completed request unregistering leaves concurrent station fill intact', () => {
  const value = session(); registerRequest(value, 'fill-a', 'fill'); registerRequest(value, 'fill-b', 'fill'); unregisterRequest(value, 'fill-a', 'fill');
  assert.deepEqual(Array.from(value.fillRequestIds), ['fill-b']);
});
