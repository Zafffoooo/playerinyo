'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createListenbrainzRadio } = require('../app/listenbrainz-radio');
const { createListenbrainzProvider, musicBrainzTagForGenre } = require('../app/radio-providers');
const { selectDiscoveryBatch } = require('../app/lastfm-discovery');

const seed = '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11';
const related = 'cb67438a-7f50-4f2b-a6f1-2bb2729fd538';
const recording = '8acec354-a9f8-4783-a4ca-668ebe85a52d';
const metadata = { [recording]: { recording: { name: 'Song', length: 123000 }, artist: { name: 'Air' }, release: { name: 'Album' } } };

test('genre radio maps tags, hydrates recordings and works with the existing known-track filter', async () => {
  const radio = createListenbrainzRadio({
    request: async endpoint => {
      if (endpoint.startsWith('metadata/')) return metadata;
      const params = new URLSearchParams(endpoint.split('?')[1]);
      assert.equal(params.get('tag'), 'trip hop');
      return params.get('pop_begin') === '70' ? [{ recording_mbid: recording }] : [];
    },
  });
  const pools = await radio.genrePools('trip-hop');
  assert.equal(pools.core[0].providerId, 'listenbrainz');
  assert.equal(pools.core[0].duration, 123);
  assert.equal(selectDiscoveryBatch(pools, { requestedCount: 1, excludeKnownTracks: true, knownTrackIndex: { has: () => true } }).selected.length, 0);
  assert.equal(createListenbrainzProvider(null).id, 'listenbrainz');
  assert.equal(musicBrainzTagForGenre('unknown'), '');
});

test('song radio hydrates related recordings and deduplicates fallback tracks', async () => {
  const radio = createListenbrainzRadio({
    resolveArtist: async () => ({ mbid: seed, name: 'Portishead' }),
    similarArtists: async () => [{ mbid: related, name: 'Air' }],
    request: async endpoint => {
      if (endpoint.startsWith('lb-radio/artist/')) {
        return { [seed]: [{ recording_mbid: seed }], [related]: [{ recording_mbid: recording }] };
      }
      if (endpoint.startsWith('metadata/')) return metadata;
      return [{ recording_mbid: recording, recording_name: 'Song', artist_name: 'Air' }];
    },
  });
  const items = await radio.songCandidates({ artist: 'Portishead', title: 'Seed' });
  assert.deepEqual(items.map(item => item.trackMbid), [recording]);
});
