'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeCreatedPlaylists, normalizeCreatedPlaylist } = require('../app/listenbrainz-playlists');

const id = '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11';
const recording = '10adbe5e-a2c0-4bf3-8249-2b4cbf6e6ca8';
const playlist = { identifier: 'https://listenbrainz.org/playlist/' + id, title: 'Weekly Exploration' };

test('normalizes generated playlist wrappers and treats a valid empty list as empty', () => {
  assert.deepEqual(normalizeCreatedPlaylists({ playlists: [] }), []);
  assert.deepEqual(normalizeCreatedPlaylists({ playlists: [{ playlist }, { playlist }] }), [{ id, name: playlist.title, date: '' }]);
  assert.throws(() => normalizeCreatedPlaylists({ error: 'unavailable' }));
});

test('keeps source order and accepts MusicBrainz recording identifiers only', () => {
  const track = [
    { title: 'First', creator: 'Artist', identifier: ['https://musicbrainz.org/recording/' + recording] },
    { title: 'Second', creator: 'Artist', identifier: 'https://example.org/recording/' + recording },
  ];
  const result = normalizeCreatedPlaylist({ playlist: { ...playlist, track } }, id);
  assert.deepEqual(result.records.map(row => [row.Song, row.TrackMbid]), [['First', recording], ['Second', '']]);
  assert.throws(() => normalizeCreatedPlaylist({ playlist: { ...playlist, track } }, recording));
});
