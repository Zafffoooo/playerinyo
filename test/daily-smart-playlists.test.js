'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { selectTracks } = require('../app/daily-smart-playlists');

function track(index, album, played) {
  return { filePath: `/music/${album}/${index}.flac`, album, artist: 'Artist', played };
}

test('daily Smart Playlist selection is stable for a date and bounds tracks per album', () => {
  const files = Array.from({ length: 90 }, (_, index) => track(index, `Album ${Math.floor(index / 9)}`));
  const options = { files, mode: 'discovery', dayKey: '2026-08-28', limit: 50, albumLimit: 2 };
  const first = selectTracks(options);
  const second = selectTracks(options);
  assert.deepEqual(first.map((file) => file.filePath), second.map((file) => file.filePath));
  assert.equal(first.length, 20);
  const counts = new Map();
  first.forEach((file) => counts.set(file.album, (counts.get(file.album) || 0) + 1));
  counts.forEach((count) => assert.ok(count <= 2));
});

test('daily Smart Playlist modes respect played and unplayed eligibility', () => {
  const files = [track(1, 'A'), track(2, 'A'), track(3, 'B'), track(4, 'B')];
  const playedPaths = new Set([files[0].filePath, files[2].filePath]);
  const base = { files, dayKey: '2026-08-28', playedPaths, limit: 50, albumLimit: 2 };
  assert.deepEqual(selectTracks({ ...base, mode: 'rediscover' }).map((file) => file.filePath).sort(), [files[0].filePath, files[2].filePath].sort());
  assert.deepEqual(selectTracks({ ...base, mode: 'unplayed' }).map((file) => file.filePath).sort(), [files[1].filePath, files[3].filePath].sort());
});
