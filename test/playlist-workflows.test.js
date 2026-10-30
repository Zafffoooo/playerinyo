'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const espree = require('espree');
function loadFunction(context, file, name) {
  const source = fs.readFileSync(require.resolve('../app/' + file), 'utf8');
  const ast = espree.parse(source, { ecmaVersion: 2022, sourceType: 'script', range: true });
  const node = ast.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === name);
  assert.ok(node, name);
  vm.runInContext(source.slice(...node.range), context);
}
function setup() {
  const record = { EntryId: 'entry', Song: 'Song', Artist: 'Artist' };
  const playlist = { id: 'pl_test', tracks: [record] };
  const calls = { saves: 0, plays: 0, cancelled: [] };
  const track = { csvRecord: record, title: 'Song', artist: 'Artist', album: '-', sourcePlaylistId: playlist.id, isDisabled: true };
  const c = vm.createContext({ state: { playlists: [playlist], musicFiles: [], currentView: 'home' },
    activeMissingPlaylistRequest: '', missingPlaylistBatchRunning: false, missingPlaylistBatchCancelled: false,
    missingPlaylistSearchGeneration: 0, playbackGeneration: 1, missingBatchProgress: '', playlistSearchStates: new WeakMap(),
    libraryMissingFilePaths: new Set(), createQueueEntryId: () => 'id', renderMissingPlaylistRowStates() {}, showMissingPlaylistStatus() {}, showToast() {}, initAudioCtx() {},
    persistPlaylists: async () => { calls.saves++; }, playTrack: async () => { calls.plays++; },
    playlistRecordToPlaybackTrack: () => ({ ...track, playback: { kind: 'youtube', videoId: record.VideoId }, isDisabled: false }),
    playbackResolver: { resolve: async () => ({ playback: { kind: 'youtube', videoId: 'abcdefghijk' } }) },
    openVersionPicker() {}, window: { api: { cancelRadioResolverRequest: async id => { calls.cancelled.push(id); } } }
  });
  for (const name of ['findMissingPlaylistTrack', 'findSelectedMissingTracks', 'cancelMissingPlaylistSearch']) loadFunction(c, 'renderer-artist-profile.js', name);
  return { c, record, playlist, track, calls };
}
test('missing playlist match saves only its stable source and starts explicit playback', async () => {
  const { c, track, record, calls } = setup();
  assert.equal(await c.findMissingPlaylistTrack(track, true), 'matched');
  assert.equal(record.VideoId, 'abcdefghijk'); assert.equal(record.PlaybackSource, 'youtube');
  assert.equal(calls.saves, 1); assert.equal(calls.plays, 1);
});
test('a delayed match never replaces playback started while the search was running', async () => {
  const { c, track, calls } = setup(); let finish;
  c.playbackResolver.resolve = () => new Promise(resolve => { finish = resolve; });
  const pending = c.findMissingPlaylistTrack(track, true); c.playbackGeneration++;
  finish({ playback: { kind: 'youtube', videoId: 'abcdefghijk' } }); await pending;
  assert.equal(calls.saves, 1); assert.equal(calls.plays, 0);
});
test('cancelling a search rejects its late result without saving or playing', async () => {
  const { c, track, calls } = setup(); let finish;
  c.playbackResolver.resolve = () => new Promise(resolve => { finish = resolve; });
  const pending = c.findMissingPlaylistTrack(track, true); c.cancelMissingPlaylistSearch();
  finish({ playback: { kind: 'youtube', videoId: 'abcdefghijk' } }); await pending;
  assert.equal(calls.saves, 0); assert.equal(calls.plays, 0); assert.equal(calls.cancelled.length, 1);
});
test('failed playlist save restores the previous record and exposes Retry', async () => {
  const { c, track, record, calls } = setup(); c.persistPlaylists = async () => { throw new Error('disk full'); };
  assert.equal(await c.findMissingPlaylistTrack(track, true), 'failed');
  assert.equal(record.VideoId, undefined); assert.equal(calls.plays, 0); assert.equal(c.playlistSearchStates.get(record), 'Retry');
});
test('batch matching never starts playback and releases its running state', async () => {
  const { c, track, calls } = setup(); await c.findSelectedMissingTracks([track]);
  assert.equal(calls.saves, 1); assert.equal(calls.plays, 0); assert.equal(c.missingPlaylistBatchRunning, false);
});

test('playlist row migration gives repeated songs separate identities and is idempotent', () => {
  let id = 0;
  const c = vm.createContext({ state: { playlists: [{ tracks: [{ Song: 'Same' }, { Song: 'Same' }, { EntryId: 'old' }, { EntryId: 'old' }] }] }, createQueueEntryId: () => 'new-' + (++id) });
  loadFunction(c, 'renderer-artist-profile.js', 'normalizePlaylistEntryIds');
  assert.equal(c.normalizePlaylistEntryIds(), true);
  assert.equal(new Set(c.state.playlists[0].tracks.map(r => r.EntryId)).size, 4);
  assert.equal(c.normalizePlaylistEntryIds(), false);
});
test('block reorder retains selected row order and captures Undo before mutation', async () => {
  const records = ['A', 'B', 'C', 'D'].map(EntryId => ({ EntryId }));
  const playlist = { id: 'pl_test', tracks: records.slice(), sortBy: 'Custom Order' };
  const selected = new Set(['B', 'C']); let snapshot;
  const c = vm.createContext({ state: { currentView: playlist.id, playlists: [playlist], currentTracks: records.map(csvRecord => ({ csvRecord })) },
    trackRenderState: { allowReorder: true }, selectedTrackKeys: selected,
    getTrackRowFromEventTarget: target => target, getTrackSelectionKey: track => track.csvRecord.EntryId,
    getSelectedCurrentTracks: () => records.filter(r => selected.has(r.EntryId)).map(csvRecord => ({ csvRecord })),
    pushUndoSnapshot: () => { snapshot = playlist.tracks.slice(); return {}; }, persistPlaylists: async () => {}, renderPlaylist() {}, showUndoToast() {}, discardUndoSnapshot() {}, showToast() {} });
  loadFunction(c, 'renderer-library-playback.js', 'handleTrackTableDrop');
  await c.handleTrackTableDrop({ target: { dataset: { trackIndex: '0' }, classList: { remove() {} }, getBoundingClientRect: () => ({ top: 0, height: 50 }) }, clientY: 0, dataTransfer: { getData: () => '1' }, preventDefault() {} });
  assert.deepEqual(playlist.tracks.map(r => r.EntryId), ['B', 'C', 'A', 'D']);
  assert.deepEqual(snapshot.map(r => r.EntryId), ['A', 'B', 'C', 'D']);
});
test('failed folder save restores membership and folder definitions', async () => {
  const playlist = { id: 'pl_one', folderId: 'folder-one' }; let saves = 0;
  const c = vm.createContext({ playlistFolderWritePending: false, appSettings: { playlistFolders: [{ id: 'folder-one', name: 'Music' }] }, state: { playlists: [playlist] },
    persistPlaylists: async () => {}, persistSettings: async () => { if (++saves === 1) throw new Error('disk full'); }, renderSidebarPlaylists() {}, showToast() {}, console });
  loadFunction(c, 'renderer-artist-profile.js', 'commitPlaylistFolderChange');
  assert.equal(await c.commitPlaylistFolderChange(() => { c.appSettings.playlistFolders = []; delete playlist.folderId; }, true), false);
  assert.equal(playlist.folderId, 'folder-one'); assert.equal(c.appSettings.playlistFolders[0].name, 'Music');
  assert.equal(c.playlistFolderWritePending, false);
});

test('selection clears on blank clicks while rows, menus and dialogs preserve it', () => {
  let cleared = 0;
  const c = vm.createContext({ selectedTrackKeys: new Set(['one']), modalStack: [], clearTrackSelection() { cleared++; } });
  loadFunction(c, 'renderer-library-playback.js', 'handleTrackSelectionOutsidePointerDown');
  c.handleTrackSelectionOutsidePointerDown({ button: 0, target: { closest: () => null } });
  assert.equal(cleared, 1);
  for (const protectedTarget of ['row', 'menu', 'modal']) {
    c.handleTrackSelectionOutsidePointerDown({ button: 0, target: { closest: () => protectedTarget } });
  }
  c.modalStack.push({});
  c.handleTrackSelectionOutsidePointerDown({ button: 0, target: { closest: () => null } });
  assert.equal(cleared, 1);
});
test('saved online tracks receive stable queue ownership before remote preparation', async () => {
  const ownerships = [];
  const c = vm.createContext({ queueEntrySequence: 0, state: { radioSession: null }, playbackGeneration: 1,
    audioEls: [{ load() {} }], remotePreparationInFlight: null, preparedRadioSlot: null,
    performance: { now: () => 0 }, console: { info() {}, warn() {} },
    isPreparedRadioTrack: () => false, nextRadioResolverRequestId: () => 'request', releaseRadioLeaseFromAudio() {},
    waitForRadioAudioReady: async () => true,
    playbackResolver: { preparePlayback: async (track, context) => {
      assert.ok(c.sanitizeRadioLeaseOwnership(context.ownership), 'main process accepts generated ownership');
      ownerships.push(context.ownership.queueEntryId);
      return { src: 'https://example.test/audio', leaseId: 'lease' };
    } }
  });
  loadFunction(c, 'main.js', 'sanitizeRadioLeaseOwnership');
  for (const name of ['createQueueEntryId', 'ensureQueueEntryId']) loadFunction(c, 'renderer.js', name);
  for (const name of ['isRemotePlaybackTrack', 'getRemotePreparationKey', 'prepareRemoteTrackInSlotOwned', 'prepareRemoteTrackInSlot']) loadFunction(c, 'renderer-playback-downloads.js', name);
  const first = { title: 'Saved song', artist: 'Artist', playback: { kind: 'youtube', videoId: 'abcdefghijk' } };
  const second = { ...first };
  assert.equal(await c.prepareRemoteTrackInSlot(first, 0, 1), true);
  assert.equal(await c.prepareRemoteTrackInSlot(first, 0, 1), true);
  assert.equal(await c.prepareRemoteTrackInSlot(second, 0, 1), true);
  assert.equal(ownerships[0], ownerships[1]); assert.notEqual(ownerships[0], ownerships[2]);
});

test('playlist status, genre and text filters combine without changing source metadata', () => {
  const c = vm.createContext({ trackRenderState: { statusView: 'pl_one', statusFilter: 'local', genreFilter: 'metal' }, state: { currentView: 'pl_one' }, isRemotePlaybackTrack: track => track.playback?.kind === 'youtube' });
  loadFunction(c, 'renderer-playback-ui.js', 'getDiscoveryGenreLabels');
  loadFunction(c, 'renderer-artist-profile.js', 'playlistTrackGenres');
  loadFunction(c, 'renderer-library-playback.js', 'trackMatchesTableFilter');
  const track = { title: 'Long Song', artist: 'Artist', matchedFile: { genre: ['Metal', 'Rock'] } };
  assert.equal(c.trackMatchesTableFilter(track, 'song'), true);
  assert.equal(c.trackMatchesTableFilter(track, 'other'), false);
  assert.equal(c.trackMatchesTableFilter({ ...track, matchedFile: { genre: 'Jazz' } }, ''), false);
  assert.equal(c.trackMatchesTableFilter({ title: 'Song', csvRecord: { Genre: 'Metal' }, playback: { kind: 'youtube' } }, ''), false);
  c.trackRenderState.statusFilter = 'all';
  assert.equal(c.trackMatchesTableFilter({ title: 'Song', csvRecord: { Genre: 'Metal; Rock' } }, ''), true);
});
