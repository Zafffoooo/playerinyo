'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createKnownTrackIndex, indexTrack, hasKnownTrack, ingestLastfmRecentPage,
  getIncrementalFrom, beginLastfmSync, getLastfmRecentTracksRequest,
  MAX_SERIALIZED_BYTES, serializeKnownTrackIndex,
} = require('./known-track-index');

const MBID = 'e0d4f2ca-99f8-4d37-8de0-5cfdf2ea791b';

test('MBID and normalized artist/title identities are both indexed without title-only matches', () => {
  const index = createKnownTrackIndex();
  indexTrack(index, { artist: 'Portishead', title: 'Roads', mbid: MBID }, 'local', 10);
  assert.equal(hasKnownTrack(index, { artist: 'Unrelated', title: 'Roads' }), false);
  assert.equal(hasKnownTrack(index, { artist: 'Portishead', title: ' Roads ' }), true);
  assert.equal(hasKnownTrack(index, { artist: 'Other', title: 'Different', mbid: MBID }), true);
  assert.equal(hasKnownTrack(index, { artist: 'Portishead', title: 'It Could Be Sweet' }), false);
});

test('initial and incremental Last.fm sync are idempotent and username scoped', () => {
  const index = createKnownTrackIndex();
  const page = {
    recenttracks: {
      track: [
        { name: 'Roads', mbid: MBID, artist: { '#text': 'Portishead' }, date: { uts: '1000' } },
        { name: 'Now Playing', artist: { '#text': 'Portishead' }, '@attr': { nowplaying: 'true' } },
      ],
      '@attr': { page: '1', totalPages: '1' },
    },
  };
  ingestLastfmRecentPage(index, page, 'zafer', 1100);
  ingestLastfmRecentPage(index, page, 'zafer', 1101);
  assert.equal(Object.keys(index.tracksByMbid).length, 1);
  assert.equal(index.lastfmSync.initialComplete, true);
  assert.equal(getIncrementalFrom(index, 300), 700);
  beginLastfmSync(index, 'other-user', 1200);
  assert.equal(index.lastfmSync.username, 'other-user');
  assert.equal(index.lastfmSync.lastSeenUts, 0);
});

test('paged Last.fm sync advances a resumable cursor before completion', () => {
  const index = createKnownTrackIndex();
  const first = { recenttracks: { track: [{ name: 'One', artist: { '#text': 'A' }, date: { uts: '10' } }], '@attr': { page: '1', totalPages: '2' } } };
  const second = { recenttracks: { track: [{ name: 'Two', artist: { '#text': 'B' }, date: { uts: '20' } }], '@attr': { page: '2', totalPages: '2' } } };
  assert.equal(ingestLastfmRecentPage(index, first, 'zafer', 30).complete, false);
  assert.equal(index.lastfmSync.resumePage, 2);
  assert.equal(ingestLastfmRecentPage(index, second, 'zafer', 31).complete, true);
  assert.equal(index.lastfmSync.resumePage, 1);
  assert.equal(index.lastfmSync.lastSeenUts, 20);
});

test('incremental multi-page sync keeps one fixed from/to snapshot', () => {
  const index = createKnownTrackIndex({ version: 1, tracksByMbid: {}, tracksByName: {}, lastfmSync: { username: 'zafer', initialComplete: true, lastSeenUts: 1000 } });
  beginLastfmSync(index, 'zafer', 2000, 300);
  const firstRequest = getLastfmRecentTracksRequest(index, 'zafer');
  ingestLastfmRecentPage(index, { recenttracks: { track: [{ name: 'New', artist: { '#text': 'A' }, date: { uts: '1900' } }], '@attr': { page: '1', totalPages: '2' } } }, 'zafer', 2001);
  const secondRequest = getLastfmRecentTracksRequest(index, 'zafer');
  assert.deepEqual(firstRequest, { user: 'zafer', limit: 200, page: 1, from: 700, to: 2000 });
  assert.deepEqual(secondRequest, { user: 'zafer', limit: 200, page: 2, from: 700, to: 2000 });
});

test('malformed recent tracks page never marks sync complete', () => {
  const index = createKnownTrackIndex();
  assert.throws(() => ingestLastfmRecentPage(index, {}, 'zafer', 100), /invalid shape/);
  assert.equal(index.lastfmSync.initialComplete, false);
  assert.equal(index.lastfmSync.resumePage, 1);
});

test('known track index persistence is byte bounded', () => {
  const index = createKnownTrackIndex();
  for (let number = 0; number < 100; number++) indexTrack(index, { artist: `Artist ${number}`, title: 'x'.repeat(600) + number }, 'local', number);
  const serialized = serializeKnownTrackIndex(index, 4096);
  assert.ok(Buffer.byteLength(serialized, 'utf8') <= 4096);
  assert.ok(MAX_SERIALIZED_BYTES >= 4096);
});

test('malformed and legacy index data recover to a bounded empty schema', () => {
  assert.deepEqual(createKnownTrackIndex({ version: 99 }), createKnownTrackIndex());
  const malformed = createKnownTrackIndex({ version: 1, tracksByMbid: { bad: 'row' }, tracksByName: null, lastfmSync: 'bad' });
  assert.deepEqual(malformed.tracksByMbid, {});
  assert.deepEqual(malformed.tracksByName, {});
});
