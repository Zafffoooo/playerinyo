'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { setImmediate: flush } = require('node:timers/promises');
const { CHECK_INTERVAL, playlistIdFromUrl, decodePlaylistResult, createPlaylistLinkTracker } = require('../app/youtube-playlist-links');

const id = 'PL_fixture_a';
const otherId = 'PL_fixture_b';
const first = { id: 'AAAAAAAAAAA', title: 'First Song', artist: 'First Artist' };
const second = { id: 'BBBBBBBBBBB', title: 'Second Song', artist: 'Second Artist' };
const third = { id: 'CCCCCCCCCCC', title: 'Third Song', artist: 'Third Artist' };
const response = (entries, extra = {}) => ({
  ok: true, stdout: JSON.stringify({ id, title: 'Test playlist', availability: 'unlisted', entries, ...extra })
});
const snapshot = entries => decodePlaylistResult(response(entries), id);

test('sharing URL variants identify the same playlist and reject unrelated links', () => {
  for (const link of [
    `https://music.youtube.com/playlist?list=${id}&si=one`,
    `https://www.youtube.com/watch?v=AAAAAAAAAAA&list=${id}`,
    `https://youtu.be/AAAAAAAAAAA?list=${id}`
  ]) assert.equal(playlistIdFromUrl(new URL(link)), id);
  for (const link of [
    `http://music.youtube.com/playlist?list=${id}`,
    `https://youtube.com.example.com/playlist?list=${id}`,
    'https://music.youtube.com/playlist?list=invalid'
  ]) assert.equal(playlistIdFromUrl(new URL(link)), null);
});

test('reader distinguishes missing yt-dlp, private, timed out, empty, and incomplete responses', () => {
  assert.equal(snapshot([first]).ok, true);
  assert.match(decodePlaylistResult({ error: { code: 'ENOENT' } }, id).error, /yt-dlp/);
  assert.match(decodePlaylistResult({ stderr: 'ERROR: This playlist is private' }, id).error, /private/);
  assert.match(decodePlaylistResult({ timedOut: true }, id).error, /timed out/);
  assert.match(snapshot([]).error, /empty/);
  for (const result of [
    response([first], { playlist_count: 2 }), response([first, null]), response([first], { id: otherId }),
    { ...response([first]), stderr: 'WARNING: Incomplete data received' },
    { ...response([first]), stdout: '{' }
  ]) assert.match(decodePlaylistResult(result, id).error, /incomplete/);
});

test('archive preserves duplicate counts, unavailable metadata, and the last success through restart and failures', async () => {
  let disk = [];
  let now = 10;
  let remote = snapshot([first, first, second]);
  const dependencies = {
    load: () => structuredClone(disk), save: async rows => { disk = structuredClone(rows); },
    now: () => now, read: async () => remote
  };
  let tracker = createPlaylistLinkTracker(dependencies);
  await tracker.follow(id, remote, now);
  await tracker.follow(id, snapshot([third]), now);
  assert.equal(tracker.list().length, 1);
  assert.equal(tracker.get(id).tracks.length, 3);

  now++;
  remote = snapshot([{ id: first.id, title: '[Private video]' }, second, third]);
  const changed = await tracker.check(id);
  assert.deepEqual(changed.added.map(row => row.name), ['Third Song']);
  assert.deepEqual(changed.removed.map(row => [row.name, row.artist]), [['First Song', 'First Artist']]);
  assert.deepEqual(changed.tracks[0], { videoId: first.id, name: first.title, artist: first.artist, unavailable: true });
  tracker = createPlaylistLinkTracker(dependencies);
  assert.deepEqual(tracker.get(id), changed);

  for (const result of [snapshot([]), decodePlaylistResult({ timedOut: true }, id),
    decodePlaylistResult({ stderr: 'ERROR: This playlist is private' }, id)]) {
    now++;
    remote = result;
    const failed = await tracker.check(id);
    assert.deepEqual(failed, { ...changed, lastAttempt: now, error: result.error });
  }

  now++;
  remote = snapshot([{ ...first, artist: '' }, first, third]);
  const returned = await tracker.check(id);
  assert.equal(returned.lastSuccess, now);
  assert.equal(returned.error, '');
  assert.deepEqual(returned.added.map(row => row.videoId), [first.id, first.id]);
  assert.equal(returned.tracks[0].artist, first.artist);
  assert.deepEqual(returned.removed.map(row => row.name), ['Second Song']);
  await tracker.stop(id);
  assert.deepEqual(await tracker.check(id), { ...returned, following: false });
  assert.equal(createPlaylistLinkTracker(dependencies).get(id).removed[0].artist, second.artist);
});

test('automatic checks run in order on startup and retry four hours after an attempt', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: CHECK_INTERVAL + 500 });
  const seed = snapshot([first]);
  let disk = [];
  const calls = [];
  const tracker = createPlaylistLinkTracker({
    load: () => disk, save: async rows => { disk = rows; },
    read: async id => { calls.push(id); return { ok: false, error: 'Offline' }; }
  });
  t.after(() => tracker.close());
  await tracker.follow(id, seed, 500);
  await tracker.follow(otherId, seed, 500);
  tracker.start();
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(calls, [id, otherId]);
  assert.equal(tracker.get(id).error, 'Offline');
  assert.equal(tracker.get(id).lastSuccess, 500);
  t.mock.timers.tick(CHECK_INTERVAL - 1);
  await flush();
  assert.equal(calls.length, 2);
  t.mock.timers.tick(1);
  await flush();
  assert.deepEqual(calls, [id, otherId, id, otherId]);
});

test('stopping a link during its check preserves the archived snapshot', async () => {
  let finishRead;
  const tracker = createPlaylistLinkTracker({
    load: () => [], save: async () => {}, read: () => new Promise(resolve => { finishRead = resolve; })
  });
  await tracker.follow(id, snapshot([first]), Date.now());
  const check = tracker.check(id);
  await flush();
  const stopped = await tracker.stop(id);
  assert.equal(stopped.following, false);
  finishRead(snapshot([second]));
  assert.deepEqual(await check, stopped);
  assert.equal(tracker.get(id).tracks[0].name, first.title);
});
