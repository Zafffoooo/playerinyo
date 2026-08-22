'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');
const {
  applyPathRemap,
  buildRelinkProposals,
  inferRootReplacements,
  scoreRelinkCandidate,
} = require('../app/moved-file-relink');

function track(filePath, overrides = {}) {
  return {
    filePath,
    filename: filePath.split('/').pop(),
    title: 'Signal',
    artist: 'North',
    album: 'Room',
    duration: 201,
    fileSize: 5000,
    ...overrides,
  };
}

test('exact relative root moves score above filename-only matches', () => {
  const missing = track('/old-library/North/Room/01 Signal.flac');
  const exact = track('/new-library/North/Room/01 Signal.flac');
  const filenameOnly = track('/search/Other/01 Signal.flac', { fileSize: 9000, title: 'Other', artist: 'Other', album: 'Other', duration: 500 });
  const options = { oldRoots: ['/old-library'], searchRoot: '/new-library' };
  assert.ok(scoreRelinkCandidate(missing, exact, options).score > scoreRelinkCandidate(missing, filenameOnly, options).score);
  assert.match(scoreRelinkCandidate(missing, exact, options).reasons.join(' '), /relative path/i);
});

test('near ties remain ambiguous and are not auto-selected', () => {
  const missing = track('/lost/Room/Signal.flac');
  const candidates = [
    track('/found/A/Signal.flac', { fileSize: 5000 }),
    track('/found/B/Signal.flac', { fileSize: 5001 }),
  ];
  const [proposal] = buildRelinkProposals([missing], candidates, { searchRoot: '/found' });
  assert.equal(proposal.ambiguous, true);
  assert.equal(proposal.autoSelected, false);
  assert.ok(proposal.secondBestScore !== null);
});

test('assignment never proposes one destination for two missing entries', () => {
  const missing = [
    track('/lost/A/Signal.flac', { title: 'Signal A' }),
    track('/lost/B/Signal.flac', { title: 'Signal B' }),
  ];
  const candidates = [
    track('/found/A/Signal.flac', { title: 'Signal A' }),
    track('/found/B/Signal.flac', { title: 'Signal B' }),
  ];
  const proposals = buildRelinkProposals(missing, candidates, { searchRoot: '/found' });
  const destinations = proposals.filter((proposal) => proposal.candidate).map((proposal) => proposal.candidate.filePath);
  assert.equal(new Set(destinations).size, destinations.length);
});

test('root replacement requires a complete relative move', () => {
  const remap = {
    '/old/Artist/one.flac': '/new/Artist/one.flac',
    '/old/Artist/two.flac': '/new/Artist/two.flac',
  };
  const complete = inferRootReplacements(['/old'], remap, {
    searchRoot: '/new',
    libraryPaths: Object.keys(remap),
    missingPaths: Object.keys(remap),
  });
  assert.deepEqual(complete, { '/old': '/new' });
  const partial = inferRootReplacements(['/old'], { '/old/Artist/one.flac': '/new/Artist/one.flac' }, {
    searchRoot: '/new',
    libraryPaths: Object.keys(remap),
    missingPaths: Object.keys(remap),
  });
  assert.deepEqual(partial, {});
});

test('path remap covers library, playlists, mappings, liked songs, and playback settings', () => {
  const oldPath = '/old/Artist/Signal.flac';
  const newPath = '/new/Artist/Signal.flac';
  const result = applyPathRemap({
    library: [track(oldPath, { addedAtMs: 123, customField: 'kept' })],
    playlists: [{ id: 'p', name: 'P', tracks: [{ FilePath: oldPath, filePath: oldPath, Path: oldPath, path: oldPath }] }],
    mappings: { signal: oldPath },
    likedSongs: [oldPath],
    settings: {
      unknownSetting: { keep: true },
      libraryRoots: ['/old'],
      playCounts: { [oldPath]: 2 },
      playTimes: { [oldPath]: 10 },
      listeningStats: { 'name:north::signal': { count: 2, time: 10, filePath: oldPath } },
      lyricsOffsets: { [oldPath]: 1.5 },
      savedQueue: [oldPath],
      playbackSession: {
        queue: [{ filePath: oldPath, sourceRadio: { providerId: 'local-library', genreIds: ['rock'] } }], userQueue: [{ filePath: oldPath }], shuffleQueue: [{ filePath: oldPath }],
        currentTrack: { filePath: oldPath }, playQueueCursor: { filePath: oldPath }, shuffleQueueCursor: { filePath: oldPath },
        radioContext: { providerId: 'local-library', genreIds: ['rock'], providerSession: { genreIds: ['rock'], remainingItemIds: ['local:' + oldPath], recentItemIds: [] } },
      },
      lastTrack: { filePath: oldPath },
      playHistory: [{ filePath: oldPath }],
      lastPlayed: { path: oldPath, at: 9 },
      customSmartPlaylists: [{ id: 's', trackPaths: [oldPath] }],
    },
  }, { [oldPath]: newPath }, {
    candidateByOldPath: { [oldPath]: track(newPath, { fileSize: 9000, modifiedAtMs: 456, addedAtMs: 999 }) },
    rootReplacements: { '/old': '/new' },
  });
  assert.equal(result.library[0].filePath, newPath);
  assert.equal(result.library[0].fileSize, 9000);
  assert.equal(result.library[0].addedAtMs, 123);
  assert.equal(result.library[0].customField, 'kept');
  assert.deepEqual(result.playlists[0].tracks[0], { FilePath: newPath, filePath: newPath, Path: newPath, path: newPath });
  assert.equal(result.mappings.signal, newPath);
  assert.deepEqual(result.likedSongs, [newPath]);
  assert.deepEqual(result.settings.unknownSetting, { keep: true });
  assert.deepEqual(result.settings.libraryRoots, ['/new']);
  assert.equal(result.settings.playCounts[newPath], 2);
  assert.equal(result.settings.playTimes[newPath], 10);
  assert.equal(result.settings.listeningStats['name:north::signal'].filePath, newPath);
  assert.equal(result.settings.lyricsOffsets[newPath], 1.5);
  assert.equal(result.settings.savedQueue[0], newPath);
  assert.equal(result.settings.playbackSession.currentTrack.filePath, newPath);
  assert.equal(result.settings.playbackSession.queue[0].filePath, newPath);
  assert.deepEqual(result.settings.playbackSession.queue[0].sourceRadio, { providerId: 'local-library', genreIds: ['rock'] });
  assert.deepEqual(result.settings.playbackSession.radioContext, { providerId: 'local-library', genreIds: ['rock'], providerSession: { genreIds: ['rock'], remainingItemIds: ['local:' + oldPath], recentItemIds: [] } });
  assert.equal(result.settings.playbackSession.userQueue[0].filePath, newPath);
  assert.equal(result.settings.playbackSession.shuffleQueue[0].filePath, newPath);
  assert.equal(result.settings.playbackSession.playQueueCursor.filePath, newPath);
  assert.equal(result.settings.playbackSession.shuffleQueueCursor.filePath, newPath);
  assert.equal(result.settings.lastTrack.filePath, newPath);
  assert.equal(result.settings.playHistory[0].filePath, newPath);
  assert.equal(result.settings.lastPlayed.path, newPath);
  assert.equal(result.settings.lastPlayed.at, 9);
  assert.equal(result.settings.customSmartPlaylists[0].trackPaths[0], newPath);
});

test('path remap preserves file URL representation', () => {
  const oldPath = path.join(path.sep, 'old music', 'track.mp3');
  const newPath = path.join(path.sep, 'new music', 'track.mp3');
  const result = applyPathRemap({
    library: [],
    playlists: [{ id: 'p', tracks: [{ FilePath: pathToFileURL(oldPath).href }] }],
    mappings: {},
    likedSongs: [],
    settings: {},
  }, { [oldPath]: newPath });
  assert.equal(result.playlists[0].tracks[0].FilePath, pathToFileURL(newPath).href);
});

test('duplicate filenames are always review-only', () => {
  const missing = track('/lost/Signal.flac');
  const proposals = buildRelinkProposals([missing], [
    track('/found/Disc 1/Signal.flac'),
    track('/found/Disc 2/Signal.flac'),
  ], { searchRoot: '/found' });
  assert.equal(proposals[0].ambiguous, true);
  assert.equal(proposals[0].autoSelected, false);
  assert.match(proposals[0].ambiguityReasons.join(' '), /duplicate filename/i);
});
