'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createKnownTrackIndex, serializeKnownTrackIndex, selectListenbrainzAccount,
  beginListenbrainzWindow, ingestListenbrainzPage, indexTrack, hasKnownTrack,
} = require('../app/known-track-index');

function listen(timestamp, title) {
  return { listened_at: timestamp, track_metadata: { artist_name: 'Artist', track_name: title } };
}

test('resumes a bounded ListenBrainz window and re-reads the timestamp boundary', () => {
  const now = 1700000000;
  let index = createKnownTrackIndex();
  const sync = selectListenbrainzAccount(index, 'first');
  beginListenbrainzWindow(sync, now);
  assert.equal(sync.from, now - 14 * 86400);
  assert.equal(ingestListenbrainzPage(index, [listen(now, 'One'), listen(now - 1, 'Two')], 2), false);
  index = createKnownTrackIndex(JSON.parse(serializeKnownTrackIndex(index)));
  assert.equal(index.listenbrainzSync.cursor, now);
  assert.equal(ingestListenbrainzPage(index, [listen(now - 1, 'Three'), listen(now - 2, 'Four')], 3), true);
  assert.equal(Object.keys(index.tracksByName).length, 4);
  beginListenbrainzWindow(index.listenbrainzSync, now + 10);
  assert.equal(index.listenbrainzSync.from, now - 300);
});

test('switching ListenBrainz accounts removes only the previous ListenBrainz contribution', () => {
  const index = createKnownTrackIndex();
  selectListenbrainzAccount(index, 'first');
  indexTrack(index, { artist: 'Artist', title: 'Local' }, 'local', 1);
  indexTrack(index, { artist: 'Artist', title: 'Last.fm' }, 'lastfm', 1);
  indexTrack(index, { artist: 'Artist', title: 'Old account' }, 'listenbrainz', 2);
  indexTrack(index, { artist: 'Artist', title: 'Last.fm' }, 'listenbrainz', 2);
  selectListenbrainzAccount(index, 'second');
  assert.equal(hasKnownTrack(index, { artist: 'Artist', title: 'Old account' }), false);
  assert.equal(hasKnownTrack(index, { artist: 'Artist', title: 'Local' }), true);
  assert.equal(hasKnownTrack(index, { artist: 'Artist', title: 'Last.fm' }), true);
});
