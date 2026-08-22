const test = require('node:test');
const assert = require('node:assert/strict');
const { createBoundedLyricsCache } = require('../app/lyrics-cache');

test('lyrics cache is bounded and refreshes recently used entries', () => {
  const cache = createBoundedLyricsCache(2);
  cache.set('a', { syncedLyrics: 'a' });
  cache.set('b', { syncedLyrics: 'b' });
  assert.equal(cache.get('a').syncedLyrics, 'a');
  cache.set('c', { syncedLyrics: 'c' });
  assert.equal(cache.get('b'), null);
  assert.equal(cache.get('a').syncedLyrics, 'a');
  assert.equal(cache.get('c').syncedLyrics, 'c');
});
