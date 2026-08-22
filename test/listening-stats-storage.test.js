const test = require('node:test');
const assert = require('node:assert/strict');
const { splitSerializedSettings } = require('../app/listening-stats-storage');

test('moves listening statistics out of the regular settings snapshot', () => {
  const stats = { 'name:artist::track': { count: 2, time: 31 } };
  const result = splitSerializedSettings({ volume: 0.5, listeningStats: stats });

  assert.deepEqual(result.settingsSnapshot, { volume: 0.5 });
  assert.equal(result.listeningStats, stats);
});

test('uses an empty sidecar for invalid or absent statistics', () => {
  assert.deepEqual(splitSerializedSettings({ volume: 1 }).listeningStats, {});
  assert.deepEqual(splitSerializedSettings({ listeningStats: [] }).listeningStats, {});
});
