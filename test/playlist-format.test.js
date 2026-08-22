'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseM3u, setLocalRecordExistence, buildM3u } = require('../app/playlist-format');

test('parses extended M3U metadata, BOM, local paths, URLs, order, and duplicates', () => {
  const input = '\uFEFF#EXTM3U\r\n#PLAYLIST:Road Set\r\n# comment\r\n#EXTINF:123.4,Artist - First Song\r\n../audio/first.mp3\r\n\r\n#EXTINF:-1,Second Song\r\nfile:///music/second.flac\r\n../audio/first.mp3\r\nhttps://example.com/live.mp3\r\n';
  const parsed = parseM3u(input, '/music/lists/road.m3u');

  assert.equal(parsed.name, 'Road Set');
  assert.equal(parsed.records.length, 4);
  assert.deepEqual(parsed.records.slice(0, 3).map(record => record.FilePath), [
    '/music/audio/first.mp3',
    '/music/second.flac',
    '/music/audio/first.mp3',
  ]);
  assert.equal(parsed.records[0].Artist, 'Artist');
  assert.equal(parsed.records[0].Song, 'First Song');
  assert.equal(parsed.records[0].Duration, 123.4);
  assert.equal(parsed.records[1].Song, 'Second Song');
  assert.equal(parsed.records[3].SourceStatus, 'remote-unsupported');
  setLocalRecordExistence(parsed.records[0], true);
  assert.equal(parsed.records[0].SourceStatus, 'local-existing');
});

test('marks HLS manifests and nested playlists as unsupported', () => {
  const hls = parseM3u('#EXTM3U\n#EXT-X-VERSION:3\n#EXTINF:10,Segment\nsegment.aac\n', '/music/live.m3u8');
  assert.equal(hls.hls, true);
  assert.equal(hls.records[0].SourceStatus, 'hls-unsupported');

  const nested = parseM3u('#EXTM3U\nother.m3u8\n', '/music/list.m3u');
  assert.equal(nested.records[0].SourceStatus, 'hls-unsupported');
});

test('does not probe network shares as local files', () => {
  const parsed = parseM3u('#EXTM3U\n\\\\attacker\\share\\song.mp3\nfile://attacker/share/song.mp3\n', 'C:\\Music\\list.m3u');
  assert.deepEqual(parsed.records.map(record => record.SourceStatus), ['remote-unsupported', 'remote-unsupported']);
  assert.ok(parsed.records.every(record => record.SourceLocal === false));
});

test('enforces bounded lines and entry counts', () => {
  assert.throws(() => parseM3u('a'.repeat(1024 * 1024 + 1), '/music/list.m3u'), /line 1 exceeds/);
  const tooManyEntries = Array.from({ length: 250001 }, () => 'track.mp3').join('\n');
  assert.throws(() => parseM3u(tooManyEntries, '/music/list.m3u'), /more than 250000 entries/);
});

test('writes M3U variants with the required BOM and portable relative paths', () => {
  const playlist = {
    name: 'Night Drive',
    tracks: [
      { Song: 'One', Artist: 'A', Duration: 61.2, FilePath: 'C:\\Music\\Artist\\one.mp3' },
      { Song: 'One again', Artist: 'A', Duration: 61.2, FilePath: 'C:\\Music\\Artist\\one.mp3' },
      { Song: 'Other drive', FilePath: 'D:\\Audio\\other.flac' },
      { Song: 'No path' },
    ],
  };
  const m3u = buildM3u(playlist, 'C:\\Music\\lists\\night.m3u', 'm3u');
  const m3u8 = buildM3u(playlist, 'C:\\Music\\lists\\night.m3u8', 'm3u8');

  assert.equal(m3u.content.charCodeAt(0), 0xFEFF);
  assert.notEqual(m3u8.content.charCodeAt(0), 0xFEFF);
  assert.match(m3u8.content, /#PLAYLIST:Night Drive/);
  assert.equal((m3u8.content.match(/\.\.\\Artist\\one\.mp3/g) || []).length, 2);
  assert.match(m3u8.content, /D:\\Audio\\other\.flac/);
  assert.equal(m3u8.skipped, 1);
  assert.equal(m3u8.written, 3);
});

test('rejects line injection in exported metadata and paths', () => {
  assert.throws(() => buildM3u({ name: 'Bad\nName', tracks: [] }, '/music/bad.m3u8', 'm3u8'), /forbidden/);
  assert.throws(() => buildM3u({ name: 'Safe', tracks: [{ Song: 'Bad\n#EXTINF', FilePath: '/music/a.mp3' }] }, '/music/bad.m3u8', 'm3u8'), /forbidden/);
  assert.throws(() => buildM3u({ name: 'Safe', tracks: [{ Song: 'Track', FilePath: '/music/a.mp3\0evil' }] }, '/music/bad.m3u8', 'm3u8'), /forbidden/);
});

test('exports comment-like filenames as file URLs so they round-trip', () => {
  const result = buildM3u({ name: 'Safe', tracks: [{ Song: 'Hash', FilePath: '/music/#song.mp3' }] }, '/music/list.m3u8', 'm3u8');
  assert.match(result.content, /file:\/\/\/music\/%23song\.mp3/);
  const parsed = parseM3u(result.content, '/music/list.m3u8');
  assert.equal(parsed.records[0].FilePath, '/music/#song.mp3');
});
