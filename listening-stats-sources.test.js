const test = require('node:test');
const assert = require('node:assert/strict');
const sources = require('./listening-stats-sources');

test('source statistics preserve local and remote totals independently', () => {
  const row = { count: 3, time: 70 };
  sources.add(row, 'local', 2, 50);
  sources.add(row, 'remote', 1, 20);

  assert.deepEqual(sources.values(row, 'local'), { count: 2, time: 50 });
  assert.deepEqual(sources.values(row, 'remote'), { count: 1, time: 20 });
  assert.deepEqual(sources.values(row, 'all'), { count: 3, time: 70 });
});

test('source statistics merge identity upgrades without losing either source', () => {
  const target = { count: 1, time: 12, sources: { remote: { count: 1, time: 12 } } };
  const legacyNameRow = { sources: { local: { count: 3, time: 80 } } };

  sources.merge(target, legacyNameRow);

  assert.deepEqual(sources.values(target, 'local'), { count: 3, time: 80 });
  assert.deepEqual(sources.values(target, 'remote'), { count: 1, time: 12 });
});

test('invalid persisted source values are bounded to non-negative numbers', () => {
  assert.deepEqual(sources.normalize({ local: { count: -2, time: 'bad' }, remote: { count: 4, time: 9 } }), {
    local: { count: 0, time: 0 }, remote: { count: 4, time: 9 }
  });
});
