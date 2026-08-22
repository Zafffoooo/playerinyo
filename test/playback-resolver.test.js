'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { matchLocalTrack } = require('../app/local-track-matcher');
const { chooseYouTubeMatch, scoreYouTubeResult, equivalentRecording } = require('../app/youtube-track-matcher');
const { createPlaybackResolver } = require('../app/playback-resolver');

const candidate = { candidateId: 'lastfm:1', trackMbid: 'ba0d7e6f-550d-4a61-9d58-3565f1f9bf61', title: 'Teardrop', artist: 'Massive Attack', album: 'Mezzanine', duration: 331 };
test('local matcher prefers a unique recording MBID', () => {
  const file = { filePath: '/music/teardrop.flac', title: 'Different', artist: 'Other', trackMbid: candidate.trackMbid };
  assert.equal(matchLocalTrack(candidate, [file]), file);
});
test('local matcher rejects an ambiguous title/artist instead of using album as a false positive', () => {
  const files = [{ filePath: '/a', title: 'Song', artist: 'Artist', album: 'One', duration: 180 }, { filePath: '/b', title: 'Song', artist: 'Artist', album: 'Two', duration: 240 }];
  assert.equal(matchLocalTrack({ title: 'Song', artist: 'Artist', album: 'Wrong', duration: 180 }, files), null);
});
test('local matcher permits album and duration only as an exact-match tie breaker', () => {
  const files = [{ filePath: '/a', title: 'Song', artist: 'Artist', album: 'One', duration: 180 }, { filePath: '/b', title: 'Song', artist: 'Artist', album: 'Two', duration: 240 }];
  assert.equal(matchLocalTrack({ title: 'Song', artist: 'Artist', album: 'Two', duration: 241 }, files), files[1]);
});
test('local matcher rejects a unique title/artist match when album or duration identifies another version', () => {
  const file = { filePath: '/live.flac', title: 'Song', artist: 'Artist', album: 'Live', duration: 420 };
  assert.equal(matchLocalTrack({ title: 'Song', artist: 'Artist', album: 'Studio', duration: 240 }, [file]), null);
});
test('YouTube scorer accepts official/Topic audio and rejects incompatible versions', () => {
  const good = scoreYouTubeResult(candidate, { id: 'abcdefghijk', title: 'Massive Attack - Teardrop', uploader: 'Massive Attack - Topic', duration: 331 });
  const bad = scoreYouTubeResult(candidate, { id: 'abcdefghijk', title: 'Massive Attack - Teardrop (slowed)', uploader: 'Massive Attack - Topic', duration: 331 });
  assert.equal(good.accepted, true); assert.equal(bad.accepted, false);
});
test('YouTube scorer keeps intentional live/remix modifiers version-aware', () => {
  const live = { candidateId: 'x', title: 'Song Live', artist: 'Artist', duration: 200 };
  assert.equal(scoreYouTubeResult(live, { id: 'abcdefghijk', title: 'Artist - Song Live', uploader: 'Artist - Topic', duration: 200 }).accepted, true);
});
test('YouTube scorer skips duration scoring when the Last.fm candidate duration is unknown', () => {
  const unknownDuration = { candidateId: 'x', title: 'Roads', artist: 'Portishead', duration: 0 };
  const result = scoreYouTubeResult(unknownDuration, { id: '7x4xsJcFI3M', title: 'PORTISHEAD-ROADS HD', channel: 'Portishead', duration: 307 });
  assert.equal(result.accepted, true);
  assert.equal(result.closeDuration, false);
});
test('YouTube scorer accepts correct channel evidence when yt-dlp artist is missing', () => {
  const result = scoreYouTubeResult({ candidateId: 'x', title: 'Roads', artist: 'Portishead' }, { id: '7x4xsJcFI3M', title: 'Roads (Official Video)', artist: '', uploader: '', channel: 'Portishead' });
  assert.equal(result.accepted, true);
});
test('YouTube scorer ignores presentation qualifiers but rejects incompatible versions', () => {
  const candidate = { candidateId: 'x', title: 'Roads', artist: 'Portishead' };
  assert.equal(scoreYouTubeResult(candidate, { id: '7x4xsJcFI3M', title: 'PORTISHEAD-ROADS HD', channel: 'Portishead' }).accepted, true);
  assert.equal(scoreYouTubeResult(candidate, { id: 'abcdefghijk', title: 'Roads (Official Video)', channel: 'Portishead' }).accepted, true);
  assert.equal(scoreYouTubeResult(candidate, { id: 'abcdefghijk', title: 'Roads Live', channel: 'Portishead' }).accepted, false);
  assert.equal(scoreYouTubeResult(candidate, { id: 'abcdefghijk', title: 'Roads slowed + reverb', channel: 'Portishead' }).accepted, false);
});
test('YouTube match treats equivalent official and Topic uploads as one recording cluster', () => {
  const results = [{ id: 'abcdefghijk', title: 'Massive Attack - Teardrop', uploader: 'Massive Attack - Topic', duration: 331 }, { id: 'zyxwvutsrqp', title: 'Massive Attack - Teardrop', uploader: 'Massive Attack - Topic', duration: 331 }];
  assert.equal(chooseYouTubeMatch(candidate, results).videoId, 'abcdefghijk');
});
test('YouTube match preserves ambiguity protection across different accepted recording clusters', () => {
  const recording = { candidateId: 'x', title: 'Song Live', artist: 'Artist', duration: 200 };
  const results = [
    { id: 'abcdefghijk', title: 'Artist - Song Live', uploader: 'Artist - Topic', duration: 200 },
    { id: 'zyxwvutsrqp', title: 'Artist - Song Live', uploader: 'Artist - Topic', duration: 220 },
  ];
  assert.equal(chooseYouTubeMatch(recording, results), null);
});
test('live, remix, and cover versions never share an equivalent recording cluster', () => {
  const live = scoreYouTubeResult({ candidateId: 'x', title: 'Song Live', artist: 'Artist', duration: 200 }, { id: 'abcdefghijk', title: 'Artist - Song Live', uploader: 'Artist - Topic', duration: 200 });
  const remix = scoreYouTubeResult({ candidateId: 'x', title: 'Song Remix', artist: 'Artist', duration: 200 }, { id: 'zyxwvutsrqp', title: 'Artist - Song Remix', uploader: 'Artist - Topic', duration: 200 });
  const cover = scoreYouTubeResult({ candidateId: 'x', title: 'Song Cover', artist: 'Artist', duration: 200 }, { id: 'lmnopqrstuv', title: 'Artist - Song Cover', uploader: 'Artist - Topic', duration: 200 });
  assert.equal(equivalentRecording(live, remix), false);
  assert.equal(equivalentRecording(live, cover), false);
});
test('resolver never calls remote search after a safe local match', async () => {
  let remote = 0; const file = { filePath: '/music/x.mp3', title: 'Teardrop', artist: 'Massive Attack', album: 'Mezzanine', duration: 331 };
  const resolver = createPlaybackResolver({ resolveYouTube: async () => { remote++; return { videoId: 'abcdefghijk' }; } });
  const resolved = await resolver.resolve({ ...candidate, trackMbid: '' }, { musicFiles: [file] });
  assert.equal(resolved.playback.kind, 'local-file'); assert.equal(remote, 0);
});
test('resolver falls back to remote for an uncorroborated unique title/artist match', async () => {
  let remote = 0;
  const file = { filePath: '/music/unknown-version.mp3', title: 'Teardrop', artist: 'Massive Attack' };
  const resolver = createPlaybackResolver({ resolveYouTube: async () => { remote++; return { videoId: 'abcdefghijk' }; } });
  const resolved = await resolver.resolve({ ...candidate, trackMbid: '' }, { musicFiles: [file] });
  assert.equal(resolved.playback.kind, 'youtube');
  assert.equal(remote, 1);
});
test('resolver falls back to remote when the only local match is marked missing', async () => {
  let remote = 0; const file = { filePath: '/music/missing.mp3', title: 'Teardrop', artist: 'Massive Attack' };
  const resolver = createPlaybackResolver({ resolveYouTube: async () => { remote++; return { videoId: 'abcdefghijk' }; } });
  const resolved = await resolver.resolve({ ...candidate, trackMbid: '' }, { musicFiles: [file], unplayableFilePaths: new Set([file.filePath]) });
  assert.equal(resolved.playback.kind, 'youtube'); assert.equal(remote, 1);
});
test('remote resolved tracks retain display metadata and only a stable video ID', async () => {
  const resolver = createPlaybackResolver({ resolveYouTube: async () => ({ videoId: 'abcdefghijk', rawUrl: 'https://forbidden.example/lease' }) });
  const resolved = await resolver.resolve(candidate, { musicFiles: [] });
  assert.deepEqual(resolved, {
    candidateId: candidate.candidateId,
    trackMbid: candidate.trackMbid,
    title: candidate.title,
    artist: candidate.artist,
    album: candidate.album,
    duration: candidate.duration,
    playback: { kind: 'youtube', videoId: 'abcdefghijk' },
    resolvedSource: 'youtube',
    playbackSource: 'youtube',
  });
});
