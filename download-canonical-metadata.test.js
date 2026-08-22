'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { enrichCanonicalDownloadMetadata, getLastfmTrackInfoParams, stripYoutubeTopicSuffix } = require('./download-canonical-metadata');

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
