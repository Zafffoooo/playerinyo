const test = require('node:test');
const assert = require('node:assert/strict');
const { getFreshEntry, setBoundedEntry } = require('../app/bounded-runtime-cache');

test('bounded cache evicts expired and oldest entries before adding a new result', () => {
  const cache = new Map([
    ['expired', { createdAt: 0, result: 1 }],
    ['oldest', { createdAt: 90, result: 2 }],
    ['recent', { createdAt: 95, result: 3 }],
  ]);
  setBoundedEntry(cache, 'new', { createdAt: 100, result: 4 }, { now: 100, ttlMs: 20, maxEntries: 2 });

  assert.deepEqual([...cache.keys()], ['recent', 'new']);
  assert.equal(getFreshEntry(cache, 'recent', 100, 20).result, 3);
  assert.equal(getFreshEntry(cache, 'expired', 100, 20), null);
});
