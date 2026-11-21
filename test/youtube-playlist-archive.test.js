'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { readArchiveInput, makeArchiveVersion, playlistChanges } = require('../app/youtube-playlist-archive');

test('Takeout IDs recover names from user-supplied versions without changing the source order', () => {
  const [named] = readArchiveInput(Buffer.from('Song,Artist,Video ID\nVideo Games,Lana Del Rey,abcdefghijk'), 'Lana.csv');
  const old = makeArchiveVersion(named.name, named.tracks, [], 1);
  const [takeout] = readArchiveInput(Buffer.from('Video ID,Playlist Video Creation Timestamp\nabcdefghijk,2026-01-01'), 'Lana.csv');
  const recovered = makeArchiveVersion(takeout.name, takeout.tracks, [old], 2);
  assert.equal(recovered.tracks[0].name, 'Video Games');
  assert.equal(recovered.tracks[0].artist, 'Lana Del Rey');
  assert.equal(recovered.id, old.id);
});

test('detects removed entries without collapsing duplicate entries', () => {
  const rows = [{ key: 'same', name: 'Track' }, { key: 'same', name: 'Other copy' }];
  assert.deepEqual(playlistChanges(rows, [rows[0]]), [rows[1]]);
  assert.throws(() => readArchiveInput(Buffer.from('Unsupported\nvalue'), 'test.csv'));
});

test('archive append targets one playlist, preserves source, and counts repeated copies', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../app/renderer-import-review'), 'utf8');
  const start = source.indexOf('function appendArchiveImport(');
  const end = source.indexOf('function playlistImportIdentity(', start);
  const context = { stampPlaylistTrackAddedAt: row => row };
  vm.runInNewContext(source.slice(start, end), context);
  const existing = { Song: 'A', VideoId: 'AAAAAAAAAAA' };
  const other = { id: 'other', name: 'Favorites', tracks: [existing] };
  const target = { id: 'target', name: other.name, tracks: [existing], importSource: { path: 'original' } };
  const tracks = [{ ...existing }, { ...existing }, { Song: 'B', VideoId: 'BBBBBBBBBBB' }];
  assert.equal(context.appendArchiveImport(target, tracks).rows.length, 2);
  assert.equal(context.appendArchiveImport(target, tracks).rows.length, 0);
  assert.deepEqual(target.tracks, [existing, tracks[1], tracks[2]]);
  assert.deepEqual(other.tracks, [existing]);
  assert.equal(target.importSource.path, 'original');
});
