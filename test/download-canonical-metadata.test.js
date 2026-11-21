'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichCanonicalDownloadMetadata, getLastfmTrackInfoParams, stripYoutubeTopicSuffix } = require('../app/download-canonical-metadata');

function info(overrides) {
  return {
    track: {
      name: 'Dirge',
      artist: { name: 'Death in Vegas' },
      album: { title: 'The Contino Sessions' },
      mbid: 'e0d4f2ca-99f8-4d37-8de0-5cfdf2ea791b',
      wiki: { published: '01 Jan 1999, 00:00' },
      ...(overrides || {}),
    },
  };
}

test('single remote track without an album accepts a verified Last.fm release', () => {
  const result = enrichCanonicalDownloadMetadata({ title: 'Dirge', artist: 'Death in Vegas', album: '' }, info());
  assert.equal(result.enriched, true);
  assert.equal(result.meta.album, 'The Contino Sessions');
  assert.equal(result.meta.albumArtist, 'Death in Vegas');
  assert.equal(result.meta.albumDate, '1999');
  assert.equal(result.meta.trackMbid, 'e0d4f2ca-99f8-4d37-8de0-5cfdf2ea791b');
});

test('explicit album metadata bypasses Last.fm enrichment for bulk jobs', () => {
  const result = enrichCanonicalDownloadMetadata({ title: 'Dirge', artist: 'Death in Vegas', album: 'The Contino Sessions' }, info());
  assert.equal(result.enriched, false);
  assert.equal(result.reason, 'album-present');
});

test('Last.fm lookup prefers a track MBID and otherwise uses exact artist and title', () => {
  assert.deepEqual(getLastfmTrackInfoParams({ title: 'Dirge', artist: 'Death in Vegas', trackMbid: 'e0d4f2ca-99f8-4d37-8de0-5cfdf2ea791b' }), {
    mbid: 'e0d4f2ca-99f8-4d37-8de0-5cfdf2ea791b',
  });
  assert.deepEqual(getLastfmTrackInfoParams({ title: 'Dirge', artist: 'Death in Vegas' }), {
    artist: 'Death in Vegas', track: 'Dirge', autocorrect: 0,
  });
});

test('mismatched Last.fm identity leaves the Singles fallback untouched', () => {
  const result = enrichCanonicalDownloadMetadata({ title: 'Dirge', artist: 'Death in Vegas', album: '' }, info({ name: 'Dirge (Live)' }));
  assert.equal(result.enriched, false);
  assert.equal(result.meta.album, '');
});

test('missing or malformed album data leaves the Singles fallback untouched', () => {
  const result = enrichCanonicalDownloadMetadata({ title: 'Dirge', artist: 'Death in Vegas', album: '' }, { track: { name: 'Dirge', artist: { name: 'Death in Vegas' } } });
  assert.equal(result.enriched, false);
  assert.equal(result.meta.album, '');
});

test('YouTube Topic suffix cleaner only removes a terminal channel suffix', () => {
  assert.equal(stripYoutubeTopicSuffix('Massive Attack - Topic'), 'Massive Attack');
  assert.equal(stripYoutubeTopicSuffix('Massive Attack — Topic'), 'Massive Attack');
  assert.equal(stripYoutubeTopicSuffix('Topic'), 'Topic');
  assert.equal(stripYoutubeTopicSuffix('The Topic Makers'), 'The Topic Makers');
});

const { lookupCanonicalDownloadMetadata } = require('../app/download-canonical-metadata');
const recordingMbid = '34745941-69c5-401a-bdb9-ae761a9b3562';
const albumMbid = '46b38f09-e90b-39eb-b04f-002da20f7f96';
const metadata = { artist: 'Portishead', title: 'Western Eyes' };
const credits = [{ name: 'Portishead', joinphrase: '' }];
const recording = { id: recordingMbid, title: metadata.title, 'artist-credit': credits };
const release = {
  status: 'Official', date: '1997-09-29', 'artist-credit': credits,
  'release-group': { id: albumMbid, title: 'Portishead', 'primary-type': 'Album', 'secondary-types': [] },
};

test('MusicBrainz enriches a unique recording with the official album and release year', async () => {
  const endpoints = [];
  const enriched = await lookupCanonicalDownloadMetadata(metadata, {
    musicbrainz: async endpoint => {
      endpoints.push(endpoint);
      return endpoint.startsWith('recording?') ? { recordings: [recording] } : { ...recording, releases: [release] };
    },
  });
  assert.match(endpoints[1], /artist-credits%2Breleases%2Brelease-groups/);
  assert.deepEqual(enriched, { ...metadata, trackMbid: recordingMbid, album: 'Portishead', albumArtist: 'Portishead', albumDate: '1997' });
});

test('MusicBrainz version mismatches leave download metadata unchanged', async () => {
  const input = { ...metadata, trackMbid: recordingMbid };
  for (const other of [{ title: 'Western Eyes (Remix)' }, { disambiguation: 'live' }]) {
    const result = await lookupCanonicalDownloadMetadata(input, {
      musicbrainz: async () => ({ ...recording, ...other, releases: [release] }),
    });
    assert.deepEqual(result, input);
  }
});

test('ambiguous official albums are left blank while the verified recording ID is retained', async () => {
  const other = { ...release, 'release-group': { ...release['release-group'], id: recordingMbid, title: 'Other Album' } };
  const result = await lookupCanonicalDownloadMetadata({ ...metadata, trackMbid: recordingMbid }, {
    musicbrainz: async () => ({ ...recording, releases: [release, other] }),
  });
  assert.equal(result.trackMbid, recordingMbid);
  assert.equal(result.album, '');
  assert.equal(result.albumDate, '');
});

test('ListenBrainz falls back by a known recording ID when MusicBrainz is unavailable', async () => {
  const result = await lookupCanonicalDownloadMetadata({ ...metadata, trackMbid: recordingMbid }, {
    musicbrainz: async () => { throw new Error('unavailable'); },
    listenbrainz: async endpoint => {
      assert.match(endpoint, new RegExp(recordingMbid));
      return { [recordingMbid]: { recording: { name: metadata.title }, artist: { name: metadata.artist },
        release: { album_artist_name: metadata.artist, name: 'Portishead', year: 1997 } } };
    },
  });
  assert.equal(result.albumDate, '1997');
});
