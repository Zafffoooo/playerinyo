'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RadioResolutionController, HIGH_WATER, MAX_CANDIDATES_PER_FILL } = require('../app/radio-resolution-controller');
function candidates(from, count) { return Array.from({ length: count }, (_, i) => ({ id: String(from + i) })); }
test('controller consumes more than one provider batch to reach 24 playable tracks while preserving candidate order', async () => {
  let next = 0; const controller = new RadioResolutionController({ nextBatch: async () => ({ items: candidates(next += 24, 24), exhausted: next >= 48 }), resolve: async (candidate) => Number(candidate.id) % 3 ? { id: candidate.id } : null });
  const result = await controller.fill({}, candidates(0, 24));
  assert.equal(result.length, HIGH_WATER); assert.deepEqual(result.map(x => x.id), result.map(x => x.id).slice().sort((a, b) => Number(a) - Number(b)));
});
test('controller bounds candidate consumption and allows short exhausted pools', async () => {
  const controller = new RadioResolutionController({ nextBatch: async () => ({ items: candidates(0, 24), exhausted: false }), resolve: async () => null });
  assert.deepEqual(await controller.fill({}, candidates(100, MAX_CANDIDATES_PER_FILL)), []);
});
test('controller cancellation makes stale results uncommittable', async () => {
  let release; const controller = new RadioResolutionController({ resolve: () => new Promise(r => { release = r; }) }); const pending = controller.fill({}, candidates(0, 1)); controller.cancel(); release({ id: 'late' }); assert.deepEqual(await pending, []);
});
