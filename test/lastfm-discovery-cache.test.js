'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_ENTRIES, getPersistableDiscoveryCacheEntries, isNormalizedPoolValue, setBoundedDiscoveryCacheEntry } = require('../app/lastfm-discovery-cache');
const { restoreCacheEntries } = require('../app/lastfm-client');

test('raw Last.fm API responses are excluded from durable discovery cache', () => {
  const now = Date.now();
  const candidate = { providerId: 'lastfm', itemKind: 'candidate', id: 'lastfm:track:name:a::b', artist: 'A', title: 'B', discovery: {} };
  const cache = new Map([
    ['tag.gettoptracks|tag=rock', { expiresAt: now + 1000, value: { toptracks: { track: [{ name: 'raw' }] } } }],
    ['pool:rock', { expiresAt: now + 1000, value: { version: 1, genreId: 'rock', pools: { core: [candidate], discovery: [], deep: [] } } }],
  ]);
  assert.deepEqual(getPersistableDiscoveryCacheEntries(cache, now).map(([key]) => key), ['pool:rock']);
});

test('a restored normalized discovery pool is accepted without becoming an API response', () => {
  const now = Date.now();
  const candidate = { providerId: 'lastfm', itemKind: 'candidate', id: 'lastfm:track:name:a::b', artist: 'A', title: 'B', discovery: {} };
  const pool = { expiresAt: now + 1000, value: { version: 1, genreId: 'rock', pools: { core: [candidate], discovery: [], deep: [] } } };
  const restored = restoreCacheEntries({ entries: [['pool:rock', pool]] }, now);
  assert.equal(restored.length, 1);
  assert.equal(isNormalizedPoolValue(restored[0][1]), true);
  assert.equal(restored[0][1].value.tracks, undefined);
});

test('bounds the runtime discovery cache and removes expired pools', () => {
  const cache = new Map([['expired', { expiresAt: 1 }]]);
  for (let index = 0; index < MAX_ENTRIES + 1; index++) {
    setBoundedDiscoveryCacheEntry(cache, 'pool:' + index, { expiresAt: 1000 + index }, 100);
  }
  assert.equal(cache.has('expired'), false);
  assert.equal(cache.size, MAX_ENTRIES);
  assert.equal(cache.has('pool:0'), false);
  assert.equal(cache.has('pool:' + MAX_ENTRIES), true);
});
