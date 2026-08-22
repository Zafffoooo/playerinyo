const PALETTE = ['#F5F5F5', '#D4D4D4', '#A3A3A3', '#737373', '#525252', '#404040', '#2B2B2B', '#1B1B1B'];
const DEFAULT_THEME_COLORS = {
  accent: '#F5F5F5',
  bg: '#070707',
  panel: '#111111',
  glass: '#1B1B1B',
  border: '#363636',
  text: '#F5F5F5',
  muted: '#A3A3A3',
  danger: '#E5484D'
};
const DOWNLOAD_QUEUE_STORAGE_KEY = 'playerinyoDownloadQueue:v1';
let state = {
  musicFiles: [], playlists: [], mappings: {}, currentView: 'library', currentTracks: [],
  currentPlayingTrack: null, isPlaying: false, isShuffle: false, loopMode: 0,
  likedSongs: parseStoredArray('likedSongs'),
  shuffleQueue: [], playHistory: [], navHistory: [], navIndex: -1,
  activeAlbumName: null, userQueue: [], playQueueTracks: [], playQueueCursor: null, shuffleQueueCursor: null,
  sourcePlaylistId: null, radioSession: null,
  currentPlaybackPreservesQueueCursors: false, currentRadioHistoryPlayback: false
};
const DEFAULT_APP_SETTINGS = { minimizeToTray: false, audioMode: 'stereo', sidebarWidth: 560, glassEffects: true, isPlaylistGridView: true, dockMode: 'collapsed', ytdlDownloadFolder: '', ytdlDownloadQuality: 'best-native', ytdlCookiesMode: 'none', ytdlCookiesBrowser: 'firefox', ytdlCookiesFile: '', automaticBackupsEnabled: true, radioPreferences: window.RadioPreferences ? window.RadioPreferences.sanitizeRadioPreferences() : {}, radioBlocklist: window.RadioPreferences ? window.RadioPreferences.sanitizeRadioBlocklist() : { version: 1, tracks: [], artists: [] } };
let appSettings = Object.assign({}, DEFAULT_APP_SETTINGS);
let audioCtx, audioGainNode, audioCompressor;
let isPlaylistGridView = true;
let currentContextMenuTrack = null;
let currentContextMenuPlaylist = null;
let addToPlaylistTracks = [];
let addToPlaylistFlyoutOpener = null;
let currentZoom = 180;
let isQueueOpen = false;
let queueRenderLimit = 250;
let queueRefreshScheduled = false;
let queueDragInProgress = false;
let lyricsOpen = false;
let lyricsCurrentTrackKey = null;
let lyricsData = [];
let plainLyricsText = '';
let lyricsOffsetSec = 0;
let lyricsActiveIdx = -2;
let npLyricsActiveIdx = -2;
let lyricsLastScrollAt = 0;
let npLyricsLastScrollAt = 0;
let lyricsCache = window.LyricsCache && window.LyricsCache.createBoundedLyricsCache
  ? window.LyricsCache.createBoundedLyricsCache(100)
  : new Map();
let volumeBeforeMute = 1;
let cpSelectedColor = PALETTE[0];
let cpSelectedCoverPath = null;
let playlistToDelete = null;
let smartPlaylistToDelete = null;
let smartPlaylistBeingEditedId = null;
let pendingPlaylistImport = null;
let playlistImportSearching = false;
let playlistImportSearchGeneration = 0;
let candidateSearchRequestSeq = 0;
let directDownloadSearchRequestSeq = 0;
let directDownloadSearchRequestId = '';
let activeCandidateSearchRequestIds = new Set();
let playlistImportProgress = { active: false, label: '', current: 0, total: 0 };
let downloadQueue = [];
let downloadQueueProcessing = false;
let downloadQueuePanelOpen = false;
let downloadQueueReview = { jobId: '', itemIndex: -1 };
let downloadJobSeq = 0;
let downloadQueuePersistenceReady = false;
let downloadQueueSaveTimer = null;
let downloadQueueProgressFrame = null;
let downloadQueueItemsByRequestId = new Map();
let albumDownloadContext = null;
let albumDownloadSelectedRelease = null;
let albumDownloadOrigin = '';
let albumDownloadRequestSeq = 0;
let tagHealthProgress = { active: false, label: '', current: 0, total: 0, summary: '' };
let isMultiSelectMode = false;
let selectedAlbumsForEdit = new Set();
let libraryMissingFilePaths = new Set();
let missingFileScanComplete = false;
let movedFilePreview = null;
let movedFileOperation = '';
let undoStack = [];
let selectedTrackKeys = new Set();
let nativeTitleBarActive = false;
let atTrackOrderMenuOpen = false;
let settingsSaveTimer = null;
let appInitializationComplete = false;
let startupErrorRendered = false;
let startupInProgress = true;
let rendererPersistenceSuspended = false;
let libraryRevision = 0;
let mappingsRevision = 0;
let libraryIndexCache = null;
let matchingFileCache = new Map();
let matchingFileCacheRevision = '';
let undoSnapshotSeq = 0;
let toastHideTimer = null;
let playbackFeedbackToken = 0;
let playbackFeedbackTimer = null;
let playbackFeedbackMessage = '';
function syncPlaybackFeedback() {
  ['playback-feedback', 'np-playback-feedback'].forEach(function (id) {
    var el = $(id); if (!el) return;
    el.textContent = playbackFeedbackMessage;
    el.hidden = !playbackFeedbackMessage;
  });
}
function setPlaybackFeedback(message, holdMs) {
  var token = ++playbackFeedbackToken; clearTimeout(playbackFeedbackTimer);
  playbackFeedbackMessage = message || '';
  syncPlaybackFeedback();
  if (message && holdMs !== false) playbackFeedbackTimer = setTimeout(function () { if (token === playbackFeedbackToken) { playbackFeedbackMessage = ''; syncPlaybackFeedback(); } }, Number(holdMs) || 1200);
  return token;
}
let homeRenderGeneration = 0;
let recentPlaylistDockResizeObserver = null;
let recentPlaylistDockCapacityFrame = null;
const modalOpeners = new WeakMap();
let modalStack = [];
let activeContextMenu = null;
let contextMenuOpener = null;
let contextMenuActionOpener = null;
let addToPlaylistReturnFocus = null;
let playbackGeneration = 0;
let playbackRestoreToken = 0;
let playbackTransitionPending = false;
let crossfadeActive = false;
let crossfadeStopTimer = null;
let playbackSeekActive = false;
let pendingPlaybackTrack = null;
let crossfadeSuppressedTrack = null;
let lastPlaybackSessionCheckpointAt = 0;
let metadataWriteLockedPaths = new Set();
let libraryScanGeneration = 0;
let libraryScanInProgress = 0;
let appStateCommitInProgress = false;
let automaticBackupUiBusy = false;
let automaticBackupUiStatus = null;
const BACKFILL_METADATA_FIELDS = ['addedAtMs', 'duration', 'trackMbid', 'year', 'genre', 'discNo', 'discTotal', 'trackTotal', 'replayGainTrackDb', 'replayGainAlbumDb', 'replayGainTrackPeak', 'replayGainAlbumPeak'];

window.addEventListener('error', function (event) {
  if (startupInProgress) renderStartupError(event.error || new Error(event.message || 'Renderer startup failed.'));
});
window.addEventListener('unhandledrejection', function (event) {
  if (startupInProgress) renderStartupError(event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Renderer startup failed.')));
});

function $(id) { return document.getElementById(id); }
function parseStoredArray(key) { try { var value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch (e) { return []; } }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]; }); }
function getSafePlaylistColor(color, fallback) { return PALETTE.indexOf(color) !== -1 ? color : (fallback || '#333333'); }
function showToast(message, options) {
  options = options || {};
  var toast = $('app-toast');
  if (!toast) return;
  clearTimeout(toastHideTimer);
  toast.replaceChildren();
  var text = document.createElement('span');
  text.className = 'app-toast-message';
  text.textContent = message;
  toast.appendChild(text);
  var dismiss = function () {
    toast.classList.remove('visible');
    toastHideTimer = setTimeout(function () { toast.hidden = true; toast.replaceChildren(); }, 180);
  };
  if (options.actionLabel && typeof options.onAction === 'function') {
    var action = document.createElement('button');
    action.type = 'button';
    action.className = 'app-toast-action';
    action.textContent = options.actionLabel;
    action.addEventListener('click', async function () {
      action.disabled = true;
      try { await options.onAction(); }
      catch (e) { console.error(e); showToast('Undo failed. Try Ctrl+Z or open the command palette.'); }
    });
    toast.appendChild(action);
  }
  if (options.dismissible !== false) {
    var dismissButton = document.createElement('button');
    dismissButton.type = 'button';
    dismissButton.className = 'app-toast-dismiss';
    dismissButton.setAttribute('aria-label', 'Dismiss notification');
    dismissButton.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
    dismissButton.addEventListener('click', dismiss);
    toast.appendChild(dismissButton);
  }
  toast.hidden = false;
  requestAnimationFrame(function () { toast.classList.add('visible'); });
  if (!options.persistent) {
    var duration = options.duration || (options.actionLabel ? 8000 : 3600);
    toastHideTimer = setTimeout(dismiss, duration);
    toast.onmouseenter = function () { clearTimeout(toastHideTimer); };
    toast.onmouseleave = function () { toastHideTimer = setTimeout(dismiss, 1200); };
    toast.onfocusin = function () { clearTimeout(toastHideTimer); };
    toast.onfocusout = function () { toastHideTimer = setTimeout(dismiss, 1200); };
  } else {
    toast.onmouseenter = toast.onmouseleave = toast.onfocusin = toast.onfocusout = null;
  }
}
const PERSISTENCE_METHODS = {
  library: 'saveLibrary',
  playlists: 'savePlaylists',
  mappings: 'saveMappings',
  settings: 'saveSettings',
  likedSongs: 'saveLikedSongs'
};
let lastPersistenceErrorAt = 0;
let settingsSaveInFlight = Promise.resolve(true);
let listeningStatsSaveInFlight = Promise.resolve(true);
let listeningStatsSaveTimer = null;
let listeningStats = {};
let playlistMembershipRevision = 0;
const lastfmRadioDiscoveryClient = window.api ? {
  start: function (request) { return window.api.lastfmDiscoveryStart(request); },
  next: function (session, options) { return window.api.lastfmDiscoveryNext(session, options); }
} : null;
const radioProviderRegistry = window.RadioProviders ? window.RadioProviders.createRadioProviderRegistry([
  window.RadioProviders.createLocalLibraryProvider(),
  window.RadioProviders.createLastfmProvider(lastfmRadioDiscoveryClient)
]) : null;
let radioUiState = { providerId: 'local-library', genres: [], selectedGenreId: '', search: '', loading: false, starting: false, startingStationId: '', error: '', loaded: false, preparation: '' };
const RADIO_REFILL_THRESHOLD = 8;
const RADIO_PLAYABLE_HIGH_WATER = 24;
const RADIO_PLAYABLE_HARD_CAP = 32;
const RADIO_FILL_CANDIDATE_LIMIT = 72;
let radioStationSequence = 0;
let queueEntrySequence = 0;
let preparedRadioSlot = null;
let remotePreparationInFlight = window.RemotePreparationCoordinator && window.RemotePreparationCoordinator.createRemotePreparationCoordinator
  ? window.RemotePreparationCoordinator.createRemotePreparationCoordinator()
  : null;
let radioResolverRequestSequence = 0;
let pendingRadioStartSession = null;
function radioDebug(stage, fields) {
  if (window.api && window.api.radioDebugEvent) window.api.radioDebugEvent({ stage: stage, fields: fields || {} });
}
async function persistState(kind, data) {
  if (rendererPersistenceSuspended) {
    if (startupErrorRendered && !appStateCommitInProgress) throw new Error('App data is unavailable because startup failed. Retry startup or restore a backup.');
    return true;
  }
  var method = PERSISTENCE_METHODS[kind];
  if (!method || !window.api[method]) throw new Error('Unknown persistence target: ' + kind);
  var result;
  try { result = await window.api[method](data); }
  catch (e) {
    console.error('Failed to save ' + kind + ':', e);
    if (Date.now() - lastPersistenceErrorAt > 1500) showToast('Could not save ' + kind + '. Check disk space and permissions.');
    lastPersistenceErrorAt = Date.now();
    throw e;
  }
  if (result !== true) {
    var error = new Error('The main process rejected the ' + kind + ' write.');
    console.error(error);
    if (Date.now() - lastPersistenceErrorAt > 1500) showToast('Could not save ' + kind + '. Check disk space and permissions.');
    lastPersistenceErrorAt = Date.now();
    throw error;
  }
  return true;
}
function persistLibrary(data) { return persistState('library', data); }
function invalidatePlaylistMembership() {
  playlistMembershipRevision++;
  window._playlistMembership = null;
  window._playlistMembershipRevision = -1;
}
function persistPlaylists(data) {
  // Playlist mutations are persisted through this boundary. Invalidate before
  // the async write so a render during the write cannot expose stale badges.
  invalidatePlaylistMembership();
  return persistState('playlists', data);
}
function persistMappings(data) { mappingsRevision++; matchingFileCache.clear(); return persistState('mappings', data); }
function persistLikedSongs(data) { return persistState('likedSongs', data); }
function persistSettings(data) {
  var snapshot;
  try {
    var settingsOnly = Object.assign({}, data);
    delete settingsOnly.listeningStats;
    snapshot = typeof structuredClone === 'function' ? structuredClone(settingsOnly) : JSON.parse(JSON.stringify(settingsOnly));
  }
  catch (e) { return Promise.reject(e); }
  var next = settingsSaveInFlight.catch(function () { }).then(function () { return persistState('settings', snapshot); });
  settingsSaveInFlight = next;
  return next;
}
function persistListeningStats(data) {
  if (rendererPersistenceSuspended || !window.api || !window.api.saveListeningStats) return Promise.resolve(true);
  var snapshot;
  try { snapshot = typeof structuredClone === 'function' ? structuredClone(data || {}) : JSON.parse(JSON.stringify(data || {})); }
  catch (e) { return Promise.reject(e); }
  var next = listeningStatsSaveInFlight.catch(function () { }).then(function () { return window.api.saveListeningStats(snapshot); }).then(function (result) {
    if (result !== true) throw new Error('The main process rejected the listening statistics write.');
    return true;
  });
  listeningStatsSaveInFlight = next;
  return next;
}
function saveListeningStatsDebounced(delay) {
  clearTimeout(listeningStatsSaveTimer);
  listeningStatsSaveTimer = setTimeout(function () {
    listeningStatsSaveTimer = null;
    persistInBackground(persistListeningStats(listeningStats));
  }, delay || 1000);
}
function findTrackIndexByIdentity(tracks, track) {
  if (window.RadioQueueHelpers && window.RadioQueueHelpers.findTrackIndexByIdentity) {
    return window.RadioQueueHelpers.findTrackIndexByIdentity(tracks, track, getPlaybackTrackKey);
  }
  if (!track || !Array.isArray(tracks)) return -1;
  var index = tracks.indexOf(track);
  if (index !== -1) return index;
  var key = getPlaybackTrackKey(track);
  return key ? tracks.findIndex(function (candidate) { return getPlaybackTrackKey(candidate) === key; }) : -1;
}
function createQueueEntryId() { queueEntrySequence++; return 'queue_' + Date.now() + '_' + queueEntrySequence; }
function ensureQueueEntryId(track) {
  if (track && (!track.queueEntryId || typeof track.queueEntryId !== 'string')) track.queueEntryId = createQueueEntryId();
  return track;
}
function makeManualQueueEntry(track) {
  if (!track) return track;
  var copy = Object.assign({}, track, { queueEntryId: createQueueEntryId() });
  return copy;
}
function getValidSourcePlaylistId(value) {
  if (value === 'liked_songs') return value;
  if (typeof value !== 'string' || !value) return null;
  if (state.playlists.some(function (playlist) { return !playlist.isSpecial && playlist.id === value; })) return value;
  return typeof getSmartPlaylistById === 'function' && getSmartPlaylistById(value) ? value : null;
}
function updatePlaybackQueueCursors(track) {
  if (window.RadioQueueHelpers && !window.RadioQueueHelpers.shouldUpdateQueueCursors(state.currentPlaybackPreservesQueueCursors)) return;
  if (state.currentPlaybackPreservesQueueCursors) return;
  var playIndex = findTrackIndexByIdentity(state.playQueueTracks, track);
  if (playIndex !== -1) state.playQueueCursor = state.playQueueTracks[playIndex];
  var shuffleIndex = findTrackIndexByIdentity(state.shuffleQueue, track);
  if (shuffleIndex !== -1) state.shuffleQueueCursor = state.shuffleQueue[shuffleIndex];
}
function getPlaybackSequenceCursorIndex(tracks) {
  var cursor = state.isShuffle ? state.shuffleQueueCursor : state.playQueueCursor;
  if (window.RadioQueueHelpers && window.RadioQueueHelpers.resolvePlaybackSequenceCursorIndex) {
    return window.RadioQueueHelpers.resolvePlaybackSequenceCursorIndex(tracks, state.currentPlayingTrack, cursor, state.currentPlaybackPreservesQueueCursors, getPlaybackTrackKey);
  }
  if (!state.currentPlaybackPreservesQueueCursors) {
    var currentIndex = findTrackIndexByIdentity(tracks, state.currentPlayingTrack);
    if (currentIndex !== -1) return currentIndex;
  }
  return findTrackIndexByIdentity(tracks, cursor);
}
function getPlaybackSessionPosition(audio) {
  if (!state.currentPlayingTrack || !audio || !Number.isFinite(audio.currentTime)) return 0;
  return Math.max(0, audio.currentTime);
}
function syncPlaybackSessionStructure() {
  updatePlaybackQueueCursors(state.currentPlayingTrack);
  appSettings.savedQueue = state.playQueueTracks.map(function (item) { return item && item.matchedFile ? item.matchedFile.filePath : null; }).filter(Boolean);
  var playQueueIndex = findTrackIndexByIdentity(state.playQueueTracks, state.playQueueCursor);
  var shuffleQueueIndex = findTrackIndexByIdentity(state.shuffleQueue, state.shuffleQueueCursor);
  appSettings.savedQueueIndex = playQueueIndex >= 0 ? playQueueIndex : 0;
  appSettings.playbackSession = {
    version: 1,
    queue: state.playQueueTracks.map(toLightTrackRef).filter(Boolean),
    userQueue: state.userQueue.map(toLightTrackRef).filter(Boolean),
    shuffleQueue: state.shuffleQueue.map(toLightTrackRef).filter(Boolean),
    currentTrack: toLightTrackRef(state.currentPlayingTrack),
    positionSeconds: getPlaybackSessionPosition(getActiveAudioEl()),
    wasPlaying: !!state.isPlaying,
    shuffleMode: state.shuffleMode || (state.isShuffle ? 1 : 0),
    loopMode: state.loopMode || 0,
    playQueueIndex: playQueueIndex,
    shuffleQueueIndex: shuffleQueueIndex,
    playQueueCursor: toLightTrackRef(state.playQueueCursor),
    shuffleQueueCursor: toLightTrackRef(state.shuffleQueueCursor),
    sourcePlaylistId: getValidSourcePlaylistId(state.sourcePlaylistId),
    manualQueuePlayback: !!state.currentPlaybackPreservesQueueCursors,
    savedAtMs: Date.now(),
  };
  var radioContext = serializeRadioContext(state.radioSession);
  if (radioContext) appSettings.playbackSession.radioContext = radioContext;
  appSettings.lastTrack = appSettings.playbackSession.currentTrack;
}
function checkpointPlaybackSession(audio, persistDelay) {
  if (!appSettings.playbackSession || appSettings.playbackSession.version !== 1) syncPlaybackSessionStructure();
  var session = appSettings.playbackSession;
  updatePlaybackQueueCursors(state.currentPlayingTrack);
  session.currentTrack = toLightTrackRef(state.currentPlayingTrack);
  session.positionSeconds = getPlaybackSessionPosition(audio || getActiveAudioEl());
  session.wasPlaying = !!state.isPlaying;
  session.shuffleMode = state.shuffleMode || (state.isShuffle ? 1 : 0);
  session.loopMode = state.loopMode || 0;
  session.playQueueIndex = findTrackIndexByIdentity(state.playQueueTracks, state.playQueueCursor);
  session.shuffleQueueIndex = findTrackIndexByIdentity(state.shuffleQueue, state.shuffleQueueCursor);
  session.playQueueCursor = toLightTrackRef(state.playQueueCursor);
  session.shuffleQueueCursor = toLightTrackRef(state.shuffleQueueCursor);
  session.sourcePlaylistId = getValidSourcePlaylistId(state.sourcePlaylistId);
  session.manualQueuePlayback = !!state.currentPlaybackPreservesQueueCursors;
  var radioContext = serializeRadioContext(state.radioSession);
  if (radioContext) session.radioContext = radioContext;
  else delete session.radioContext;
  session.savedAtMs = Date.now();
  appSettings.lastTrack = session.currentTrack;
  appSettings.savedQueueIndex = Math.max(0, session.playQueueIndex);
  if (persistDelay !== false && appInitializationComplete) saveSettingsDebounced(persistDelay || 1000);
}
function checkpointPlaybackSessionProgress(audio) {
  if (!state.isPlaying || !state.currentPlayingTrack) return;
  var now = Date.now();
  if (now - lastPlaybackSessionCheckpointAt < 10000) return;
  lastPlaybackSessionCheckpointAt = now;
  checkpointPlaybackSession(audio, 1000);
}
function syncSavedQueuePaths() {
  syncPlaybackSessionStructure();
}
function reconcilePlaybackQueuesWithLibrary() {
  var index = getLibraryIndex();
  function replacementFor(track) {
    if (!track) return track;
    var oldPath = track.matchedFile && track.matchedFile.filePath;
    var file = oldPath ? (index.byPath.get(oldPath) || index.byStrippedPath.get(stripFileUrl(oldPath))) : null;
    if (!file) file = findMatchingFile(track.title, track.artist, track.album, '');
    return file ? { matchedFile: file, title: file.title, artist: file.artist, album: file.album, duration: file.duration, trackMbid: file.trackMbid || track.trackMbid || '', playback: { kind: 'local-file', filePath: file.filePath }, resolvedSource: 'local', playbackSource: 'local', isDisabled: !!track.isDisabled, queueEntryId: track.queueEntryId, sourcePlaylistId: getValidSourcePlaylistId(track.sourcePlaylistId), sourceRadio: normalizeSourceRadio(track.sourceRadio), radioSessionId: track.radioSessionId } : track;
  }
  var collections = { playQueueTracks: state.playQueueTracks, shuffleQueue: state.shuffleQueue, userQueue: state.userQueue, playQueueCursor: state.playQueueCursor, shuffleQueueCursor: state.shuffleQueueCursor, currentPlayingTrack: state.currentPlayingTrack };
  var reconciled = window.PlaybackLocalUpgrade && window.PlaybackLocalUpgrade.reconcilePlaybackCollections
    ? window.PlaybackLocalUpgrade.reconcilePlaybackCollections(collections, replacementFor)
    : collections;
  state.playQueueTracks = reconciled.playQueueTracks;
  state.shuffleQueue = reconciled.shuffleQueue;
  state.userQueue = reconciled.userQueue;
  state.playQueueCursor = reconciled.playQueueCursor;
  state.shuffleQueueCursor = reconciled.shuffleQueueCursor;
  state.currentPlayingTrack = reconciled.currentPlayingTrack;
  syncSavedQueuePaths();
}
function persistInBackground(promise) { promise.catch(function (e) { console.error(e); }); }
function saveSettingsDebounced(delay) {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(function () {
    settingsSaveTimer = null;
    persistInBackground(persistSettings(appSettings));
  }, delay || 300);
}
function flushSettingsSave() {
  if (settingsSaveTimer) {
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = null;
  }
  if (!appInitializationComplete) {
    if (startupErrorRendered && !appStateCommitInProgress) return Promise.reject(new Error('Settings cannot be saved because startup failed.'));
    return Promise.resolve(true);
  }
  syncSavedQueuePaths();
  if (listeningStatsSaveTimer) {
    clearTimeout(listeningStatsSaveTimer);
    listeningStatsSaveTimer = null;
  }
  return Promise.all([persistSettings(appSettings), persistListeningStats(listeningStats)]).then(function () { return true; });
}
window.addEventListener('beforeunload', function () { flushSettingsSave().catch(function (e) { console.error(e); }); persistDownloadQueueStateNow(); });
if (window.api.onPrepareAppClose && window.api.appCloseReady) {
  window.api.onPrepareAppClose(async function () {
    persistDownloadQueueStateNow();
    try { await flushSettingsSave(); }
    catch (e) { console.error(e); }
    window.api.appCloseReady();
  });
}
async function mergeBackfilledMetadata(result) {
  if (!result || result.ok !== true || !Array.isArray(result.updates)) return;
  var index = getLibraryIndex();
  var changed = false;
  result.updates.forEach(function (patch) {
    if (!patch || !patch.filePath) return;
    var current = index.byPath.get(patch.filePath) || index.byStrippedPath.get(stripFileUrl(patch.filePath));
    if (!current) return;
    BACKFILL_METADATA_FIELDS.forEach(function (field) {
      var isMissing = field === 'duration' ? !(Number(current.duration) > 0) : (current[field] === null || current[field] === undefined);
      if (isMissing && Object.prototype.hasOwnProperty.call(patch, field) && !Object.is(current[field], patch[field])) {
        current[field] = patch[field];
        if (field === 'duration') {
          state.currentTracks.forEach(function (track) {
            if (track && track.matchedFile && track.matchedFile.filePath === current.filePath) track.duration = current.duration;
          });
        }
        changed = true;
      }
    });
  });
  if (!changed) return;
  markLibraryDirty();
  await persistLibrary(state.musicFiles);
  if (state.currentView && state.currentView.indexOf('album:') === 0) renderTracksTable(false);
}
function getPendingMetadataBackfillFiles(files) {
  var mainFields = BACKFILL_METADATA_FIELDS.filter(function (field) { return field !== 'addedAtMs' && field !== 'duration'; });
  return (Array.isArray(files) ? files : []).filter(function (file) {
    if (!file || !file.filePath) return false;
    return !(Number(file.duration) > 0) || mainFields.some(function (field) { return file[field] === null || file[field] === undefined; });
  });
}
function toFileUrl(filePath) {
  if (!filePath) return '';
  if (/^file:\/\//i.test(filePath)) return filePath;
  var normalized = String(filePath).replace(/\\/g, '/');
  if (normalized.startsWith('//')) {
    var uncParts = normalized.replace(/^\/\/+/, '').split('/');
    var host = uncParts.shift() || '';
    return 'file://' + host + '/' + uncParts.map(encodeURIComponent).join('/');
  }
  if (/^[A-Za-z]:\//.test(normalized)) normalized = '/' + normalized;
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  return 'file://' + normalized.split('/').map(function (segment, index) {
    if (index === 0) return '';
    if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment;
    return encodeURIComponent(segment);
  }).join('/');
}
function fromFileUrl(url) {
  if (!url) return null;
  if (!/^file:\/\//i.test(url)) return url;
  var parsed = new URL(url);
  var pathname = decodeURIComponent(parsed.pathname || '');
  if (parsed.hostname) return '\\\\' + parsed.hostname + pathname.replace(/\//g, '\\');
  return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1).replace(/\//g, '\\') : pathname;
}
function showFileLocation(filePath) {
  var fp = stripFileUrl(filePath || '');
  if (fp && window.api.showItemInFolder) window.api.showItemInFolder(fp);
}
var lastMprisPositionSyncAt = 0;
function getActiveAudioEl() {
  var list = window.audioEls || (typeof audioEls !== 'undefined' ? audioEls : null);
  return list && list.length ? list[activeAudioIdx || 0] : $('audio-player-0');
}
function getMprisLoopStatus() {
  if (state.loopMode === 2) return 'Track';
  if (state.loopMode === 1) return 'Playlist';
  return 'None';
}
function syncMpris(seeked) {
  if (!window.api.updateMpris) return;
  var track = state.currentPlayingTrack;
  if (!track) {
    window.api.updateMpris({ isPlaying: false, loopStatus: getMprisLoopStatus(), shuffle: !!state.isShuffle });
    return;
  }
  var audio = getActiveAudioEl();
  var matched = track.matchedFile || {};
  var duration = audio && !isNaN(audio.duration) && audio.duration > 0 ? audio.duration : (track.duration || matched.duration || 0);
  var position = audio && !isNaN(audio.currentTime) ? audio.currentTime : 0;
  var filePath = matched.filePath || track.filePath || '';
  window.api.updateMpris({
    title: track.title || matched.title || 'Unknown Track',
    artist: track.artist || matched.artist || 'Unknown Artist',
    album: track.album || matched.album || '',
    filePath: filePath,
    fileUrl: filePath ? toFileUrl(filePath) : '',
    artUrl: matched.picture || '',
    durationSeconds: duration,
    positionSeconds: position,
    isPlaying: !!state.isPlaying,
    shuffle: !!state.isShuffle,
    loopStatus: getMprisLoopStatus(),
    volume: audio && typeof audio.volume === 'number' ? audio.volume : (appSettings.volume || 1),
    seeked: !!seeked
  });
}
function syncMprisPositionThrottled() {
  var now = Date.now();
  if (now - lastMprisPositionSyncAt < 2000) return;
  lastMprisPositionSyncAt = now;
  syncMpris(false);
}
function setActiveAudioPosition(seconds, seeked) {
  var audio = getActiveAudioEl();
  if (!audio || isNaN(audio.duration)) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration, seconds));
  checkpointPlaybackSession(audio, 200);
  syncMpris(!!seeked);
}
function applyTitleBarMode() {
  document.body.classList.toggle('native-titlebar', nativeTitleBarActive);
}
function fmt(s) { if (!s || isNaN(s)) return '0:00'; return Math.floor(s / 60) + ':' + (Math.floor(s % 60) + '').padStart(2, '0'); }
function getModalFocusable(modal) {
  if (!modal) return [];
  return Array.from(modal.querySelectorAll('button:not([disabled]),a[href],summary,input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')).filter(function (el) {
    return !el.hidden && el.getClientRects().length > 0 && !el.closest('[inert]');
  });
}
function isRestorableFocusTarget(el) {
  if (!el || !el.isConnected || typeof el.focus !== 'function' || el.hidden || !el.getClientRects().length) return false;
  return !el.closest('[inert], [aria-hidden="true"], [hidden]');
}
function restoreFocusWithFallback(preferred) {
  if (isRestorableFocusTarget(preferred)) { preferred.focus(); return preferred; }
  var fallback = $('view-title');
  if (!fallback || !fallback.getClientRects().length || fallback.closest('[inert]')) fallback = $('main-content');
  if (!fallback || !fallback.getClientRects().length || fallback.closest('[inert]')) return null;
  if (!fallback.hasAttribute('tabindex')) fallback.tabIndex = -1;
  fallback.classList.add('focus-restore-fallback');
  fallback.focus();
  setTimeout(function () { fallback.classList.remove('focus-restore-fallback'); }, 2200);
  return fallback;
}
function setModalBackgroundInert(inert) {
  ['.window-titlebar', '.app-container'].forEach(function (selector) {
    var el = document.querySelector(selector);
    if (el) el.inert = !!inert;
  });
}
function syncModalIsolation() {
  var top = modalStack[modalStack.length - 1] || null;
  document.querySelectorAll('.modal-overlay').forEach(function (modal) {
    var active = modalStack.includes(modal) && modal.classList.contains('active');
    modal.inert = !active || modal !== top;
    modal.setAttribute('aria-hidden', active && modal === top ? 'false' : 'true');
    modal.setAttribute('aria-modal', active && modal === top ? 'true' : 'false');
    modal.style.zIndex = active ? String(9999 + modalStack.indexOf(modal)) : '';
  });
  var nowPlaying = $('now-playing-overlay');
  if (nowPlaying) {
    var nowPlayingVisible = typeof npOverlayOpen !== 'undefined' && npOverlayOpen;
    nowPlaying.inert = !nowPlayingVisible || !!top;
    nowPlaying.setAttribute('aria-hidden', nowPlayingVisible && !top ? 'false' : 'true');
  }
  setModalBackgroundInert(!!top || (typeof npOverlayOpen !== 'undefined' && npOverlayOpen));
}
function prepareModalSemantics(el) {
  if (!el) return;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  var heading = el.querySelector('h1,h2,h3');
  if (heading) {
    if (!heading.id) heading.id = el.id + '-title';
    el.setAttribute('aria-labelledby', heading.id);
  } else if (!el.hasAttribute('aria-label')) {
    el.setAttribute('aria-label', 'Dialog');
  }
  var content = el.querySelector('.modal-content');
  if (content && !content.hasAttribute('tabindex')) content.tabIndex = -1;
}
function showModal(el, options) {
  if (!el) return;
  options = options || {};
  prepareModalSemantics(el);
  var opener = isRestorableFocusTarget(contextMenuActionOpener) ? contextMenuActionOpener : (activeContextMenu && isRestorableFocusTarget(contextMenuOpener) ? contextMenuOpener : document.activeElement);
  contextMenuActionOpener = null;
  modalOpeners.set(el, opener);
  modalStack = modalStack.filter(function (item) { return item !== el; });
  modalStack.push(el);
  el.classList.add('active');
  syncModalIsolation();
  requestAnimationFrame(function () {
    var target = options.initialFocus ? el.querySelector(options.initialFocus) : null;
    if (!target) target = getModalFocusable(el)[0] || el.querySelector('.modal-content');
    if (target) target.focus();
  });
}
function hideModal(el, options) {
  if (!el) return;
  options = options || {};
  var wasTop = modalStack[modalStack.length - 1] === el;
  el.classList.remove('active');
  modalStack = modalStack.filter(function (item) { return item !== el; });
  syncModalIsolation();
  if (wasTop && options.restoreFocus !== false) {
    var opener = modalOpeners.get(el);
    if (!restoreFocusWithFallback(opener)) {
      var remainingModal = modalStack[modalStack.length - 1];
      var fallback = remainingModal ? (getModalFocusable(remainingModal)[0] || remainingModal.querySelector('.modal-content')) : null;
      if (fallback && !fallback.closest('[inert]')) { if (!fallback.hasAttribute('tabindex')) fallback.tabIndex = -1; fallback.focus(); }
    }
  }
  modalOpeners.delete(el);
}
function requestCloseModal(el) {
  if (!el) return;
  if (el.id === 'playlist-import-modal') { var pic = $('playlist-import-cancel-x') || $('playlist-import-cancel'); if (pic) pic.click(); return; }
  if (el.id === 'album-download-modal') { closeAlbumDownloadModal(); return; }
  if (el.id === 'add-songs-modal') { var asc = $('btn-close-add-songs'); if (asc) asc.click(); return; }
  if (el.id === 'delete-confirm-modal') { var dc = $('delete-cancel-btn'); if (dc) dc.click(); return; }
  if (el.id === 'metadata-modal') { var mc = $('meta-cancel-btn'); if (mc && !mc.disabled) mc.click(); return; }
  if (el.id === 'moved-files-modal') { var movedCancel = $('moved-files-cancel'); if (movedCancel && !movedCancel.disabled) movedCancel.click(); return; }
  if (el.id === 'command-palette-modal') { closeCommandPalette(); return; }
  hideModal(el);
}
document.querySelectorAll('.modal-overlay').forEach(function (modal) {
  prepareModalSemantics(modal);
  modal.setAttribute('aria-hidden', 'true');
  modal.inert = true;
});
document.addEventListener('keydown', function (e) {
  var modal = modalStack[modalStack.length - 1];
  if (!modal || !modal.classList.contains('active')) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopImmediatePropagation();
    requestCloseModal(modal);
    return;
  }
  if (e.key !== 'Tab') return;
  var focusable = getModalFocusable(modal);
  if (!focusable.length) { e.preventDefault(); var content = modal.querySelector('.modal-content'); if (content) content.focus(); return; }
  var first = focusable[0], last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}, true);
function hideAllContextMenus(restoreFocus) {
  document.querySelectorAll('.context-menu').forEach(function (m) {
    m.classList.remove('visible');
    m.querySelectorAll('.context-menu-more[open]').forEach(function (details) { details.open = false; });
  });
  if (addToPlaylistFlyoutOpener) addToPlaylistFlyoutOpener.setAttribute('aria-expanded', 'false');
  activeContextMenu = null;
  if (restoreFocus) restoreFocusWithFallback(contextMenuOpener);
  contextMenuOpener = null;
}
function openSettingsModal() {
  var modal = $('settings-modal');
  showModal(modal);
  var content = modal ? modal.querySelector('.modal-content') : null;
  if (content) content.scrollTop = 0;
  if (typeof refreshSafeStorageStatus === 'function') refreshSafeStorageStatus();
  if (typeof refreshDownloadFolderUi === 'function') refreshDownloadFolderUi();
  if (typeof refreshAutomaticBackupStatus === 'function') refreshAutomaticBackupStatus();
}
function deepCloneForUndo(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (e) { }
  }
  return JSON.parse(JSON.stringify(value));
}
function pushUndoSnapshot(label, collections) {
  try {
    collections = collections || ['library', 'playlists', 'mappings', 'likedSongs', 'settings'];
    var snap = { id: ++undoSnapshotSeq, label: label || 'Last action' };
    if (collections.includes('library')) snap.library = deepCloneForUndo(state.musicFiles || []);
    if (collections.includes('playlists')) snap.playlists = deepCloneForUndo(state.playlists || []);
    if (collections.includes('mappings')) snap.mappings = deepCloneForUndo(state.mappings || {});
    if (collections.includes('likedSongs')) snap.likedSongs = deepCloneForUndo(state.likedSongs || []);
    if (collections.includes('settings')) snap.settings = deepCloneForUndo(appSettings || {});
    if (collections.includes('libraryRoots')) snap.libraryRoots = deepCloneForUndo(appSettings.libraryRoots);
    if (collections.includes('playbackQueues')) {
      snap.playbackQueues = {
        play: state.playQueueTracks.map(toLightTrackRef).filter(Boolean),
        shuffle: state.shuffleQueue.map(toLightTrackRef).filter(Boolean),
        user: state.userQueue.map(toLightTrackRef).filter(Boolean),
        current: toLightTrackRef(state.currentPlayingTrack),
        playCursor: toLightTrackRef(state.playQueueCursor),
        shuffleCursor: toLightTrackRef(state.shuffleQueueCursor),
        manualQueuePlayback: !!state.currentPlaybackPreservesQueueCursors,
        history: state.playHistory.map(toLightTrackRef).filter(Boolean),
        sourcePlaylistId: getValidSourcePlaylistId(state.sourcePlaylistId),
        isShuffle: !!state.isShuffle,
        shuffleMode: state.shuffleMode || 0,
        loopMode: state.loopMode || 0,
      };
      var radioContext = serializeRadioContext(state.radioSession);
      if (radioContext) snap.playbackQueues.radioContext = radioContext;
    }
    undoStack.push(snap);
    var entryCount = state.musicFiles.length + state.playlists.reduce(function (count, playlist) { return count + ((playlist.tracks && playlist.tracks.length) || 0); }, 0);
    var maxSnapshots = entryCount > 50000 ? 2 : (entryCount > 10000 ? 5 : 10);
    while (undoStack.length > maxSnapshots) undoStack.shift();
    return snap;
  } catch (e) { console.error('Failed to create undo snapshot:', e); return null; }
}
function discardUndoSnapshot(snapshot) {
  if (!snapshot) return;
  var index = undoStack.indexOf(snapshot);
  if (index !== -1) undoStack.splice(index, 1);
}
function restorePlaybackQueuesSnapshot(playbackQueues) {
  if (!playbackQueues) return;
  resetPlaybackRuntime({ clearCurrent: true, clearQueues: true, clearHistory: true, preserveSettings: true });
  state.playQueueTracks = (playbackQueues.play || []).map(hydrateTrackRef).filter(Boolean);
  state.shuffleQueue = (playbackQueues.shuffle || []).map(hydrateTrackRef).filter(Boolean);
  state.userQueue = (playbackQueues.user || []).map(hydrateTrackRef).filter(Boolean);
  state.playHistory = (playbackQueues.history || []).map(hydrateTrackRef).filter(Boolean);
  state.isShuffle = !!playbackQueues.isShuffle;
  state.shuffleMode = playbackQueues.shuffleMode || (state.isShuffle ? 1 : 0);
  state.loopMode = playbackQueues.loopMode || 0;
  state.currentPlaybackPreservesQueueCursors = !!playbackQueues.manualQueuePlayback;
  state.currentRadioHistoryPlayback = false;
  var restoredCurrent = hydrateTrackRef(playbackQueues.current);
  var preferredTracks = state.isShuffle
    ? state.shuffleQueue.concat(state.userQueue, state.playQueueTracks)
    : state.playQueueTracks.concat(state.userQueue, state.shuffleQueue);
  state.currentPlayingTrack = findSessionTrack(preferredTracks, playbackQueues.current) || restoredCurrent;
  state.playQueueCursor = findSessionTrack(state.playQueueTracks, playbackQueues.playCursor) || null;
  state.shuffleQueueCursor = findSessionTrack(state.shuffleQueue, playbackQueues.shuffleCursor) || null;
  state.sourcePlaylistId = getValidSourcePlaylistId(playbackQueues.sourcePlaylistId || (state.currentPlayingTrack && state.currentPlayingTrack.sourcePlaylistId));
  if (!state.currentPlaybackPreservesQueueCursors) updatePlaybackQueueCursors(state.currentPlayingTrack);
  state.currentTracks = state.playQueueTracks.slice();
  restoreRadioSessionFromContext(playbackQueues.radioContext);
  appSettings.playHistory = state.playHistory.map(toLightTrackRef).filter(Boolean);
  syncSavedQueuePaths();
  maybeRefillRadioQueue();
}
async function reloadRendererAppState(fallbackLikedSongs) {
  var loaded = await Promise.all([window.api.loadLibrary(), window.api.loadPlaylists(), window.api.loadMappings(), window.api.loadSettings(), window.api.loadLikedSongs(), window.api.loadListeningStats ? window.api.loadListeningStats() : Promise.resolve({})]);
  setMusicFiles(Array.isArray(loaded[0]) ? loaded[0] : []);
  state.playlists = Array.isArray(loaded[1]) ? loaded[1] : [];
  state.mappings = loaded[2] && typeof loaded[2] === 'object' ? loaded[2] : {};
  mappingsRevision++;
  matchingFileCache.clear();
  appSettings = settingsWithDefaults(loaded[3]);
  state.likedSongs = Array.isArray(loaded[4]) ? loaded[4] : (Array.isArray(fallbackLikedSongs) ? fallbackLikedSongs : []);
  listeningStats = loaded[5] && typeof loaded[5] === 'object' ? loaded[5] : {};
  if (migrateLegacyPathStats()) persistInBackground(Promise.all([persistListeningStats(listeningStats), persistSettings(appSettings)]));
}
async function undoAtomicAppState(snap) {
  if (appStateCommitInProgress) { showToast('Wait for the current app-state restore to finish.'); return false; }
  if (!window.api.restoreAppState) {
    showUndoToast('Undo requires the app-state restore API. Restart Playerinyo and try again.', snap);
    return false;
  }
  var runtimeWasInitialized = appInitializationComplete;
  var persistenceWasSuspended = rendererPersistenceSuspended;
  var restoreCommitted = false;
  beginAppStateCommit();
  rendererPersistenceSuspended = true;
  appInitializationComplete = false;
  resetPlaybackRuntime({ clearCurrent: true, clearQueues: true, clearHistory: true, preserveSettings: true });
  try {
    var result = await window.api.restoreAppState({
      library: snap.library || [],
      playlists: snap.playlists || [],
      mappings: snap.mappings || {},
      settings: snap.settings || {},
      likedSongs: snap.likedSongs || []
    });
    if (!(result === true || (result && result.ok === true))) throw new Error((result && result.error) || 'The main process rejected the app-state restore.');
    restoreCommitted = true;
    await reloadRendererAppState(snap.likedSongs);
    state.navHistory = [];
    state.navIndex = -1;
    clearTrackSelection();
    selectedAlbumsForEdit.clear();
    libraryMissingFilePaths.clear();
    await applyRuntimeSettings({ preserveTitleBarMode: true });
    restorePlaybackStateFromSettings();
    rendererPersistenceSuspended = false;
    appInitializationComplete = true;
    endAppStateCommit();
    if (undoStack[undoStack.length - 1] && undoStack[undoStack.length - 1].id === snap.id) undoStack.pop();
    renderSidebarPlaylists();
    switchView(state.musicFiles.length ? 'library' : 'home', false);
    syncPlaybackStateUi();
    if (isQueueOpen) renderQueue();
    showToast('Undone: ' + snap.label + '.');
    return true;
  } catch (e) {
    console.error('Atomic Undo failed:', e);
    if (restoreCommitted) {
      renderStartupError(e);
    } else {
      rendererPersistenceSuspended = persistenceWasSuspended;
      appInitializationComplete = runtimeWasInitialized;
      restorePlaybackStateFromSettings();
      renderSidebarPlaylists();
      switchView(state.musicFiles.length ? 'library' : 'home', false);
    }
    showUndoToast('Undo stopped: ' + (e.message || 'The complete app state could not be restored.'), snap);
    return false;
  } finally {
    if (appStateCommitInProgress) endAppStateCommit();
  }
}
async function undoLastAction(expectedSnapshotId) {
  var snap = undoStack[undoStack.length - 1];
  if (!snap) { showToast('Nothing to undo.'); return false; }
  if (expectedSnapshotId && snap.id !== expectedSnapshotId) { showToast('This Undo action expired because a newer change was made. Use Ctrl+Z to undo the latest action.'); return false; }
  if (snap.atomicAppState) return undoAtomicAppState(snap);
  var writes = [];
  if (Object.prototype.hasOwnProperty.call(snap, 'library')) { setMusicFiles(snap.library || []); writes.push(persistLibrary(state.musicFiles)); }
  if (Object.prototype.hasOwnProperty.call(snap, 'playlists')) { state.playlists = snap.playlists || []; writes.push(persistPlaylists(state.playlists)); }
  if (Object.prototype.hasOwnProperty.call(snap, 'mappings')) { state.mappings = snap.mappings || {}; writes.push(persistMappings(state.mappings)); }
  if (Object.prototype.hasOwnProperty.call(snap, 'likedSongs')) { state.likedSongs = snap.likedSongs || []; writes.push(persistLikedSongs(state.likedSongs)); }
  if (Object.prototype.hasOwnProperty.call(snap, 'settings')) { appSettings = settingsWithDefaults(snap.settings); writes.push(persistSettings(appSettings)); }
  if (Object.prototype.hasOwnProperty.call(snap, 'libraryRoots')) {
    if (snap.libraryRoots === undefined) delete appSettings.libraryRoots;
    else appSettings.libraryRoots = snap.libraryRoots;
    writes.push(persistSettings(appSettings));
  }
  if (snap.playbackQueues) restorePlaybackQueuesSnapshot(snap.playbackQueues);
  if (Object.prototype.hasOwnProperty.call(snap, 'library')) { reconcilePlaybackQueuesWithLibrary(); writes.push(persistSettings(appSettings)); }
  try { await Promise.all(writes); }
  catch (e) {
    console.error('Undo persistence failed:', e);
    showUndoToast('Undo could not be saved. Check disk space and permissions, then retry.', snap);
    return false;
  }
  if (undoStack[undoStack.length - 1] && undoStack[undoStack.length - 1].id === snap.id) undoStack.pop();
  await applyRuntimeSettings({ preserveTitleBarMode: true });
  syncPlaybackStateUi();
  if (isQueueOpen) renderQueue();
  renderSidebarPlaylists();
  if (state.currentView === 'metadata_health') renderMetadataHealthView();
  else if (state.currentView === 'library') renderLibrary();
  else switchView('library', false);
  showToast('Undone: ' + snap.label + '.');
  return true;
}
function showUndoToast(message, snapshot) {
  if (!snapshot) { showToast(message); return; }
  showToast(message, { actionLabel: 'Undo', persistent: true, onAction: function () { return undoLastAction(snapshot.id); } });
}
function getContextMenuItems(menu) {
  if (!menu) return [];
  return Array.from(menu.querySelectorAll('.menu-item')).filter(function (item) {
    return !item.hidden && !item.disabled && item.getClientRects().length > 0;
  });
}
function focusContextMenuItem(menu, item) {
  var items = getContextMenuItems(menu);
  items.forEach(function (candidate) { candidate.tabIndex = candidate === item ? 0 : -1; candidate.classList.toggle('keyboard-active', candidate === item); });
  if (item) item.focus();
}
function positionContextMenu(menu, x, y, opener) {
  if (!menu) return;
  hideAllContextMenus();
  activeContextMenu = menu;
  contextMenuOpener = opener || document.activeElement;
  menu.setAttribute('role', menu.getAttribute('role') || 'menu');
  menu.querySelectorAll('.menu-item').forEach(function (item) { if (!item.hasAttribute('role')) item.setAttribute('role', 'menuitem'); item.tabIndex = -1; });
  menu.classList.add('visible');
  menu.style.left = '0px'; menu.style.top = '0px';
  if ((!x && !y) && contextMenuOpener && contextMenuOpener.getBoundingClientRect) {
    var openerRect = contextMenuOpener.getBoundingClientRect();
    x = openerRect.left + Math.min(24, openerRect.width / 2);
    y = openerRect.top + Math.min(24, openerRect.height / 2);
  }
  var mw = menu.offsetWidth, mh = menu.offsetHeight;
  x = Math.max(8, Number(x) || 8); y = Math.max(8, Number(y) || 8);
  menu.style.left = Math.max(8, x + mw > window.innerWidth - 8 ? x - mw : x) + 'px';
  menu.style.top = Math.max(8, y + mh > window.innerHeight - 8 ? y - mh : y) + 'px';
  requestAnimationFrame(function () { if (activeContextMenu === menu) focusContextMenuItem(menu, getContextMenuItems(menu)[0]); });
}
function positionSubmenu(menu, anchorEl) {
  if (!menu || !anchorEl) return;
  menu.classList.add('visible');
  menu.style.left = '0px'; menu.style.top = '0px';
  var r = anchorEl.getBoundingClientRect();
  var mw = menu.offsetWidth, mh = menu.offsetHeight;
  var gap = 6;
  var left = r.right + gap;
  if (left + mw > window.innerWidth - 8) left = r.left - mw - gap;
  var top = r.top - 6;
  if (top + mh > window.innerHeight - 8) top = window.innerHeight - mh - 8;
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
}
function isTextEditingShortcutTarget(target) {
  if (!target || !target.closest) return false;
  return !!(target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'));
}
function shouldIgnoreAppShortcut(e) {
  if (!e || e.defaultPrevented || modalStack.length || startupErrorRendered) return true;
  var target = e.target;
  if (!target || !target.closest) return false;
  if (isTextEditingShortcutTarget(target)) return true;
  return !!target.closest('input, textarea, select, button, summary, [role="slider"]');
}
// Space is a player shortcut, not a repeat activation of the last clicked
// control. Capture it before a focused button receives its native key action.
function handleGlobalPlaybackSpace(event) {
  if (!event || event.code !== 'Space' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  if (isTextEditingShortcutTarget(event.target) || (activeContextMenu && activeContextMenu.classList.contains('visible'))) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.type === 'keydown' && !event.repeat) togglePlay();
}
document.addEventListener('keydown', handleGlobalPlaybackSpace, true);
document.addEventListener('keyup', handleGlobalPlaybackSpace, true);
document.addEventListener('keydown', function (e) {
  var menu = activeContextMenu;
  if (!menu || !menu.classList.contains('visible')) return;
  if (e.target && e.target.closest && e.target.closest('#add-to-playlist-menu')) return;
  var items = getContextMenuItems(menu);
  var index = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); hideAllContextMenus(true); return; }
  if (e.key === 'Tab') { hideAllContextMenus(false); return; }
  if (!items.length) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Home' || e.key === 'End') {
    e.preventDefault();
    if (e.key === 'Home') index = 0;
    else if (e.key === 'End') index = items.length - 1;
    else if (e.key === 'ArrowDown') index = index < 0 ? 0 : (index + 1) % items.length;
    else index = index <= 0 ? items.length - 1 : index - 1;
    focusContextMenuItem(menu, items[index]);
    return;
  }
  if (e.key === 'ArrowRight' && document.activeElement && document.activeElement.matches('.context-menu-more-summary')) {
    e.preventDefault();
    var details = document.activeElement.closest('details');
    if (details) { details.open = true; requestAnimationFrame(function () { focusContextMenuItem(menu, getContextMenuItems(menu)[index + 1]); }); }
    return;
  }
  if (e.key === 'ArrowLeft') {
    var openDetails = document.activeElement && document.activeElement.closest('.context-menu-more[open]');
    if (openDetails) { e.preventDefault(); openDetails.open = false; focusContextMenuItem(menu, openDetails.querySelector('summary')); }
    return;
  }
  if ((e.key === 'Enter' || e.key === ' ') && document.activeElement && document.activeElement.classList.contains('menu-item')) {
    e.preventDefault(); document.activeElement.click();
  }
}, true);
function initAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    var src0 = audioCtx.createMediaElementSource($('audio-player-0'));
    var src1 = audioCtx.createMediaElementSource($('audio-player-1'));
    audioGainNodes = [audioCtx.createGain(), audioCtx.createGain()];
    src0.connect(audioGainNodes[0]);
    src1.connect(audioGainNodes[1]);

    var merger = audioCtx.createGain();
    audioGainNodes[0].connect(merger);
    audioGainNodes[1].connect(merger);
    state.mediaElementSource = merger;

    // Normalization / Compressor
    audioCompressor = audioCtx.createDynamicsCompressor();
    // Default loudness-normalization settings
    audioCompressor.threshold.value = -24;
    audioCompressor.knee.value = 30;
    audioCompressor.ratio.value = 12;
    audioCompressor.attack.value = 0.003;
    audioCompressor.release.value = 0.25;

    audioGainNode = audioCtx.createGain();

    // Wire: source -> Compressor (if enabled) -> Equalizer -> gain -> destination
    if (typeof initEq === 'function') initEq();
    else {
      updateAudioChain();
    }
    applyAudioMode();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function updateAudioChain() {
  if (!audioCtx || !state.mediaElementSource) return;
  state.mediaElementSource.disconnect();
  if (audioCompressor) audioCompressor.disconnect();
  if (eqBands && eqBands.length) eqBands[eqBands.length - 1].disconnect();
  if (typeof analyserNode !== 'undefined' && analyserNode) analyserNode.disconnect();
  if (audioGainNode) audioGainNode.disconnect();

  let lastNode = state.mediaElementSource;

  if (appSettings.normalization && audioCompressor) {
    lastNode.connect(audioCompressor);
    lastNode = audioCompressor;
  }

  if (eqBands && eqBands.length) {
    lastNode.connect(eqBands[0]);
    // The EQ chain is already connected internally in initEq
    lastNode = eqBands[eqBands.length - 1];
    if (typeof analyserNode !== 'undefined' && analyserNode) {
      lastNode.connect(analyserNode);
      lastNode = analyserNode;
    }
  }

  lastNode.connect(audioGainNode);
  audioGainNode.gain.value = appSettings.masterGain !== undefined ? (appSettings.masterGain / 100.0) : 1.0;
  audioGainNode.connect(audioCtx.destination);
}
function applyAudioMode() {
  if (!audioGainNode) return;
  if (appSettings.audioMode === 'mono') { audioGainNode.channelCount = 1; audioGainNode.channelCountMode = 'explicit'; }
  else { audioGainNode.channelCount = 2; audioGainNode.channelCountMode = 'max'; }
}

// FIX 7: pushNav now works for all view types including library sub-views
function pushNav(viewId) {
  if (state.navHistory[state.navIndex] === viewId) return;
  state.navHistory = state.navHistory.slice(0, state.navIndex + 1);
  state.navHistory.push(viewId);
  if (state.navHistory.length > 20) state.navHistory.shift(); else state.navIndex++;
  updateNavBtns();
}
function updateNavBtns() {
  var back = $('btn-nav-back'), fwd = $('btn-nav-forward');
  if (back) back.disabled = state.navIndex <= 0;
  if (fwd) fwd.disabled = state.navIndex >= state.navHistory.length - 1;
}

function applyThemeSettings() {
  var colors = DEFAULT_THEME_COLORS;
  document.documentElement.style.setProperty('--accent', colors.accent);
  document.documentElement.style.setProperty('--accent-hover', '#FFFFFF');
  document.documentElement.style.setProperty('--accent-rgb', '245,245,245');
  document.documentElement.style.setProperty('--bg-base', colors.bg);
  document.documentElement.style.setProperty('--bg-highlight', colors.panel);
  document.documentElement.style.setProperty('--bg-elevated', colors.glass);
  document.documentElement.style.setProperty('--text-base', colors.text);
  document.documentElement.style.setProperty('--text-subdued', colors.muted);
  document.documentElement.style.setProperty('--border', colors.border);
  document.documentElement.style.setProperty('--danger', colors.danger);
  document.documentElement.style.setProperty('--theme-bg-rgb', '7,7,7');
  document.documentElement.style.setProperty('--theme-panel-rgb', '17,17,17');
  document.documentElement.style.setProperty('--theme-glass-rgb', '27,27,27');
  document.documentElement.style.setProperty('--theme-border-rgb', '54,54,54');
  document.documentElement.style.setProperty('--theme-text-rgb', '245,245,245');
  document.body.classList.toggle('no-glass', appSettings.glassEffects === false);
  applyTitleBarMode();
}
function normalize(s) { return s ? String(s).normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/feat\.?[^,]*/giu, '').replace(/[^\p{L}\p{N}]/gu, '') : '' }
function getAlbumKey(file) { return (file.album || 'Unknown Album') + '::' + (file.albumArtist || file.artist || 'Unknown Artist'); }
function buildFileSearchText(file) { return [file.title, file.artist, file.album, file.albumArtist, file.genre, file.year, file.filename].map(function (v) { return v == null ? '' : String(v); }).join(' ').toLowerCase(); }
function buildFileExtText(file) {
  var fp = stripFileUrl(file.filePath || '') || file.filePath || '';
  var m = String(fp).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}
function getLibraryEntriesForScanRoot(rootPath) {
  var filter = window.ScanRootFilter && window.ScanRootFilter.isPathInsideScanRoot;
  if (typeof filter !== 'function') return state.musicFiles.slice();
  return state.musicFiles.filter(function (file) {
    return file && file.filePath && filter(stripFileUrl(file.filePath) || file.filePath, rootPath);
  });
}
function markLibraryDirty() { libraryRevision++; libraryIndexCache = null; }
function setMusicFiles(files) {
  state.musicFiles = Array.isArray(files) ? files : [];
  libraryMissingFilePaths = new Set(); missingFileScanComplete = false; markLibraryDirty();
  // Main process owns the bounded recursive-size cache. This covers rescan,
  // ingest, remove and relink paths because they all replace the library set.
  if (window.api && window.api.invalidateAlbumSizeCache) window.api.invalidateAlbumSizeCache().catch(function () { });
}
function formatAlbumSize(bytes) {
  bytes = Number(bytes);
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  var units = ['B', 'KB', 'MB', 'GB', 'TB']; var value = bytes; var unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  var precision = unit < 2 ? 0 : (value < 10 ? 2 : 1);
  return value.toFixed(precision).replace(/\.0+$/, '').replace(/(\.\d)0$/, '$1') + ' ' + units[unit];
}
function getLibraryIndex() {
  if (libraryIndexCache && libraryIndexCache.revision === libraryRevision) return libraryIndexCache;
  var byPath = new Map();
  var byStrippedPath = new Map();
  var searchTextByFile = new WeakMap();
  var extByFile = new WeakMap();
  var byNormalizedTitleArtistAlbum = new Map();
  var byNormalizedTitleAlbum = new Map();
  var byNormalizedTitleArtist = new Map();
  var byNormalizedTitle = new Map();
  var byNormalizedFilename = new Map();
  var albumsByKey = new Map();
  var albums = [];
  function rememberCandidate(map, key, file) {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(file);
  }
  state.musicFiles.forEach(function (f) {
    if (!f) return;
    searchTextByFile.set(f, buildFileSearchText(f));
    extByFile.set(f, buildFileExtText(f));
    if (f.filePath) {
      byPath.set(f.filePath, f);
      byStrippedPath.set(stripFileUrl(f.filePath), f);
    }
    var normTitle = normalize(f.title);
    var normArtist = normalize(f.artist);
    var normAlbum = normalize(f.album);
    if (normTitle) {
      if (normArtist && normAlbum) rememberCandidate(byNormalizedTitleArtistAlbum, normTitle + '::' + normArtist + '::' + normAlbum, f);
      if (normAlbum) rememberCandidate(byNormalizedTitleAlbum, normTitle + '::' + normAlbum, f);
      if (normArtist) rememberCandidate(byNormalizedTitleArtist, normTitle + '::' + normArtist, f);
      rememberCandidate(byNormalizedTitle, normTitle, f);
    }
    if (f.filename) rememberCandidate(byNormalizedFilename, normalize(f.filename.replace(/\.[^.]+$/, '')), f);
    var key = getAlbumKey(f);
    var album = albumsByKey.get(key);
    if (!album) {
      album = { id: key, name: f.album || 'Unknown Album', artist: f.albumArtist || f.artist || 'Unknown Artist', cover: null, tracks: [], year: f.year || 0, addedIdx: albums.length };
      albumsByKey.set(key, album);
      albums.push(album);
    }
    if (!album.cover && f.picture) album.cover = f.picture;
    if (f.year && !album.year) album.year = f.year;
    album.tracks.push(f);
  });
  libraryIndexCache = {
    revision: libraryRevision,
    byPath: byPath,
    byStrippedPath: byStrippedPath,
    searchTextByFile: searchTextByFile,
    extByFile: extByFile,
    byNormalizedTitleArtistAlbum: byNormalizedTitleArtistAlbum,
    byNormalizedTitleAlbum: byNormalizedTitleAlbum,
    byNormalizedTitleArtist: byNormalizedTitleArtist,
    byNormalizedTitle: byNormalizedTitle,
    byNormalizedFilename: byNormalizedFilename,
    albumsByKey: albumsByKey,
    albums: albums
  };
  return libraryIndexCache;
}
function isEditableMetadataFile(file) { return !!(file && file.filePath && /\.(mp3|flac|opus|ogg|m4a)$/i.test(stripFileUrl(file.filePath) || file.filePath)); }
function getAlbumAddedAt(album) {
  var m = 0;
  (album && album.tracks || []).forEach(function (t) { if ((t.addedAtMs || 0) > m) m = t.addedAtMs; });
  return m;
}
function getPlaylistTrackFilePath(record) { return record ? (record.FilePath || record.filePath || record.Path || record.path || '') : ''; }
function getPlaylistTrackAddedAtMs(record) {
  if (!record) return 0;
  var value = Number(record.AddedAtMs !== undefined ? record.AddedAtMs : record.addedAtMs);
  return Number.isFinite(value) && value > 0 ? value : 0;
}
function stampPlaylistTrackAddedAt(record, timestamp) {
  if (record) record.AddedAtMs = getPlaylistTrackAddedAtMs(record) || timestamp || Date.now();
  return record;
}
function sortRecentlyAddedEntries(entries, getTimestamp, direction) {
  var multiplier = direction === 'asc' ? 1 : -1;
  return entries.map(function (entry, index) { return { entry: entry, index: index, addedAtMs: getTimestamp(entry) }; }).sort(function (a, b) {
    if (a.addedAtMs !== b.addedAtMs) return (a.addedAtMs - b.addedAtMs) * multiplier;
    return a.index - b.index;
  }).map(function (decorated) { return decorated.entry; });
}
function getTrackSelectionKey(track) {
  if (!track) return '';
  var fp = (track.matchedFile && track.matchedFile.filePath) || track.filePath || getPlaylistTrackFilePath(track.csvRecord);
  if (fp) return 'path::' + stripFileUrl(fp);
  return 'meta::' + (track.title || '') + '::' + (track.artist || '') + '::' + (track.album || '');
}
function getSelectedCurrentTracks() {
  if (!selectedTrackKeys.size) return [];
  return (state.currentTracks || []).filter(function (track) { return selectedTrackKeys.has(getTrackSelectionKey(track)); });
}
function getCurrentRegularPlaylist() {
  return state.playlists.find(function (p) { return p.id === state.currentView && !p.isSpecial; }) || null;
}
function clearTrackSelection() {
  selectedTrackKeys.clear();
  document.querySelectorAll('#tracks-body tr.track-selected').forEach(function (row) { row.classList.remove('track-selected'); });
}
function makePlaylistTrackRecord(track) {
  var filePath = track.filePath || (track.matchedFile && track.matchedFile.filePath) || '';
  var record = { Song: track.title || '', Artist: track.artist || '', Album: track.album || '', FilePath: filePath, AddedAtMs: Date.now() };
  if (track.trackMbid) record.TrackMbid = String(track.trackMbid).slice(0, 80);
  if (track.candidateId) record.CandidateId = String(track.candidateId).slice(0, 420);
  if (isRemotePlaybackTrack(track)) {
    record.PlaybackSource = 'youtube';
    record.VideoId = track.playback.videoId;
    record.Duration = Number(track.duration) || 0;
    if (track.artwork) record.Artwork = String(track.artwork).slice(0, 4096);
  }
  return record;
}
function samePlaylistTrack(record, track) {
  var recordPath = getPlaylistTrackFilePath(record);
  var trackPath = track && (track.filePath || (track.matchedFile && track.matchedFile.filePath));
  if (recordPath && trackPath) return stripFileUrl(recordPath) === stripFileUrl(trackPath);
  if (record.VideoId && isRemotePlaybackTrack(track) && record.VideoId === track.playback.videoId) return true;
  var rt = (record.Song || record.title || '').toLowerCase();
  var ra = (record.Artist || record.artist || '').toLowerCase();
  var rb = (record.Album || record.album || '').toLowerCase();
  var tt = (track.title || '').toLowerCase();
  var ta = (track.artist || '').toLowerCase();
  var tb = (track.album || '').toLowerCase();
  return rt === tt && ra === ta && rb === tb;
}

function playlistRecordToPlaybackTrack(record, playlistId) {
  var file = findPlaylistRecordMatch(record);
  var videoId = String(record && record.VideoId || '');
  var remote = record && record.PlaybackSource === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(videoId);
  // Local lookup remains first so a later imported/downloaded copy upgrades
  // an existing remote playlist reference without changing the playlist row.
  return {
    csvRecord: record,
    matchedFile: file,
    title: record.Song || record.title || (file && file.title) || '',
    artist: record.Artist || record.artist || (file && file.artist) || '',
    album: record.Album || record.album || (file && file.album) || '-',
    duration: (file && Number(file.duration) > 0) ? file.duration : (Number(record.Duration || record.duration) || 0),
    trackMbid: String(record.TrackMbid || ''), candidateId: String(record.CandidateId || ''),
    playback: !file && remote ? { kind: 'youtube', videoId: videoId } : undefined,
    resolvedSource: !file && remote ? 'youtube' : undefined, playbackSource: !file && remote ? 'youtube' : undefined,
    artwork: String(record.Artwork || record.artwork || ''),
    isDisabled: !file && !remote, sourcePlaylistId: playlistId
  };
}
function getDiscNumber(file) {
  if (!file) return 1;
  if (file.__displayDiscNo && file.__displayDiscNo > 0) return file.__displayDiscNo;
  if (file.discNo && file.discNo > 0) return file.discNo;
  var fullPath = file.filePath || '';
  var folderMatch = fullPath.match(/(?:^|[\\/])(?:cd|disc|disk)\s*0*(\d{1,2})(?:[\\/]|$)/i);
  if (folderMatch) return parseInt(folderMatch[1], 10) || 1;
  var name = file.filename || fullPath.split(/[\\/]/).pop() || '';
  var prefixMatch = name.match(/^\s*(\d{1,2})\s*[-_. ]\s*\d{1,3}\b/);
  if (prefixMatch) return parseInt(prefixMatch[1], 10) || 1;
  return 1;
}
function albumHasMultipleDiscs(tracks) {
  var seen = new Set();
  (tracks || []).forEach(function (track) {
    if (track && track.matchedFile) seen.add(getDiscNumber(track.matchedFile));
    else if (track) seen.add(getDiscNumber(track));
  });
  return seen.size > 1;
}
function compareAlbumTrackOrder(a, b) {
  return (getDiscNumber(a) - getDiscNumber(b)) || ((a.trackNo || 0) - (b.trackNo || 0)) || (a.title || '').localeCompare(b.title || '');
}
function suppressSpuriousDiscOutliers(tracks) {
  var counts = {};
  var hasDeclaredMultiDisc = false;
  (tracks || []).forEach(function (f) {
    var disc = parseInt(f && f.discNo || 0, 10);
    var total = parseInt(f && f.discTotal || 0, 10);
    if (total > 1) hasDeclaredMultiDisc = true;
    if (disc > 0) counts[disc] = (counts[disc] || 0) + 1;
  });
  var discKeys = Object.keys(counts).map(function (d) { return parseInt(d, 10); }).filter(Boolean);
  if (hasDeclaredMultiDisc || discKeys.length <= 1) return;
  var baseCount = (counts[1] || 0) + (tracks.length - discKeys.reduce(function (sum, d) { return sum + counts[d]; }, 0));
  if (baseCount < Math.max(3, tracks.length - 1)) return;
  tracks.forEach(function (f) {
    var disc = parseInt(f && f.discNo || 0, 10);
    if (f && disc > 1 && counts[disc] === 1) f.__displayDiscNo = 1;
  });
}
function inferDiscsFromDuplicateTrackNumbers(tracks) {
  var groups = {};
  tracks.forEach(function (f) {
    var no = parseInt(f.trackNo || 0, 10);
    if (!no) return;
    if (!groups[no]) groups[no] = [];
    groups[no].push(f);
  });
  var duplicateGroups = Object.values(groups).filter(function (g) { return g.length > 1; });
  if (duplicateGroups.length < 2) return null;
  tracks.forEach(function (f) { delete f.__displayDiscNo; });
  var occurrenceByTrackNo = {};
  tracks.slice().sort(function (a, b) {
    return ((a.trackNo || 0) - (b.trackNo || 0)) || (a.title || '').localeCompare(b.title || '');
  }).forEach(function (f) {
    var no = parseInt(f.trackNo || 0, 10);
    if (!no) return;
    occurrenceByTrackNo[no] = (occurrenceByTrackNo[no] || 0) + 1;
    f.__displayDiscNo = occurrenceByTrackNo[no];
  });
  return tracks.slice().sort(compareAlbumTrackOrder);
}
function getSortedAlbumTracks(album) {
  var tracks = album && album.tracks ? album.tracks.slice() : [];
  tracks.forEach(function (f) { delete f.__displayDiscNo; });
  suppressSpuriousDiscOutliers(tracks);
  if (albumHasMultipleDiscs(tracks)) return tracks.sort(compareAlbumTrackOrder);
  return inferDiscsFromDuplicateTrackNumbers(tracks) || tracks.sort(compareAlbumTrackOrder);
}
function fuzzyMatch(a, b) { var na = normalize(a), nb = normalize(b); return !!na && !!nb && (na === nb || na.includes(nb) || nb.includes(na)); }
function indexedMatchResult(map, key, predicate) {
  var candidates = key ? (map.get(key) || []) : [];
  if (predicate) candidates = candidates.filter(predicate);
  return { match: candidates.length === 1 ? candidates[0] : null, ambiguous: candidates.length > 1 };
}
function fuzzyMatchResult(predicate) {
  var match = null;
  for (var i = 0; i < state.musicFiles.length; i++) {
    if (!predicate(state.musicFiles[i])) continue;
    if (match) return { match: null, ambiguous: true };
    match = state.musicFiles[i];
  }
  return { match: match, ambiguous: false };
}
function findMatchingFile(songName, artistName, albumName, filePath) {
  var revision = libraryRevision + ':' + mappingsRevision;
  if (matchingFileCacheRevision !== revision) {
    matchingFileCacheRevision = revision;
    matchingFileCache.clear();
  }
  var cacheKey = JSON.stringify([songName || '', artistName || '', albumName || '', stripFileUrl(filePath || '')]);
  if (matchingFileCache.has(cacheKey)) return matchingFileCache.get(cacheKey);
  var match = findMatchingFileUncached(songName, artistName, albumName, filePath);
  if (matchingFileCache.size >= 20000) matchingFileCache.clear();
  matchingFileCache.set(cacheKey, match);
  return match;
}
function findMatchingFileUncached(songName, artistName, albumName, filePath) {
  var libIndex = getLibraryIndex();
  if (filePath) {
    var wantedPath = stripFileUrl(filePath);
    var byPath = libIndex.byStrippedPath.get(wantedPath);
    if (byPath) return byPath;
  }
  var keyWithAlbum = songName + '-' + artistName + '-' + (albumName || '');
  var key = songName + '-' + artistName; // fallback for backwards compatibility
  
  if (state.mappings[keyWithAlbum] === 'NO_MATCH' || state.mappings[key] === 'NO_MATCH') return null;
  
  if (state.mappings[keyWithAlbum]) {
    var m = libIndex.byPath.get(state.mappings[keyWithAlbum]) || libIndex.byStrippedPath.get(stripFileUrl(state.mappings[keyWithAlbum]));
    if (m) return m;
  }
  if (state.mappings[key]) {
    var m = libIndex.byPath.get(state.mappings[key]) || libIndex.byStrippedPath.get(stripFileUrl(state.mappings[key]));
    if (m) return m;
  }
  var normTitle = normalize(songName);
  var normArtist = normalize(artistName);
  var normAlbum = normalize(albumName);
  if (normTitle && normAlbum) {
    var exactAlbumResult = normArtist ? indexedMatchResult(libIndex.byNormalizedTitleArtistAlbum, normTitle + '::' + normArtist + '::' + normAlbum) : indexedMatchResult(libIndex.byNormalizedTitleAlbum, normTitle + '::' + normAlbum);
    if (exactAlbumResult.match) return exactAlbumResult.match;
    if (exactAlbumResult.ambiguous) return null;
  }
  
  // First pass: try to match all three (Song + Artist + Album)
  if (albumName) {
    var albumFuzzyResult = fuzzyMatchResult(function (f) { return fuzzyMatch(f.title, songName) && (!artistName || fuzzyMatch(f.artist, artistName)) && fuzzyMatch(f.album, albumName); });
    if (albumFuzzyResult.match) return albumFuzzyResult.match;
    if (albumFuzzyResult.ambiguous) return null;
  }

  // Second pass: Song + Artist (ignore album)
  if (normTitle) {
    var exactTrackResult = normArtist ? indexedMatchResult(libIndex.byNormalizedTitleArtist, normTitle + '::' + normArtist) : indexedMatchResult(libIndex.byNormalizedTitle, normTitle);
    if (exactTrackResult.match) return exactTrackResult.match;
    if (exactTrackResult.ambiguous) return null;
    var exactFilenameResult = indexedMatchResult(libIndex.byNormalizedFilename, normTitle, function (f) {
      return (!artistName || fuzzyMatch(f.artist, artistName)) && (!albumName || fuzzyMatch(f.album, albumName));
    });
    if (exactFilenameResult.match) return exactFilenameResult.match;
    if (exactFilenameResult.ambiguous) return null;
  }
  var trackFuzzyResult = fuzzyMatchResult(function (f) { return fuzzyMatch(f.title, songName) && (!artistName || fuzzyMatch(f.artist, artistName)); });
  if (trackFuzzyResult.match) return trackFuzzyResult.match;
  if (trackFuzzyResult.ambiguous) return null;
  var filenameFuzzyResult = fuzzyMatchResult(function (f) {
    var fn = f.filename ? f.filename.replace(/\.[^.]+$/, '') : '';
    return fuzzyMatch(fn, songName) && (!artistName || fuzzyMatch(f.artist, artistName)) && (!albumName || fuzzyMatch(f.album, albumName));
  });
  if (filenameFuzzyResult.match) return filenameFuzzyResult.match;
  return null;
}
// FIX 4: buildShuffleQueue resets existing queue entirely
function buildShuffleQueue() {
  var v = state.playQueueTracks.filter(function (t) { return !t.isDisabled; }).slice();
  for (var i = v.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var item = v[i]; v[i] = v[j]; v[j] = item;
  }
  state.shuffleQueue = v;
}

function rebuildShuffleQueueForMode() {
  if ((state.shuffleMode || 0) === 2) buildSmartShuffleQueue();
  else buildShuffleQueue();
}

function moveTrackToShuffleQueueStart(track) {
  if (!state.isShuffle || !track || track.isDisabled) return;
  var idx = findTrackIndexByIdentity(state.shuffleQueue, track);
  if (!state.shuffleQueue.length || idx === -1) {
    rebuildShuffleQueueForMode();
    idx = findTrackIndexByIdentity(state.shuffleQueue, track);
  }
  if (idx > 0) {
    var queuedTrack = state.shuffleQueue.splice(idx, 1)[0];
    state.shuffleQueue.unshift(queuedTrack);
  }
}
function applyZoom() { $('albums-grid').style.gridTemplateColumns = 'repeat(auto-fill,minmax(' + currentZoom + 'px,1fr))'; }
function setViewKind(kind) {
  document.body.dataset.view = kind || '';
  syncDockPlaylistStates();
}
function hideAllViewRoots() {
  ['home-dashboard-container', 'albums-grid-container', 'tracks-table-container', 'search-albums-container', 'playlists-grid-container', 'stats-container', 'metadata-health-container', 'radio-container'].forEach(function (id) {
    var el = $(id); if (el) el.style.display = 'none';
  });
  var detail = $('album-detail-header'); if (detail) detail.style.display = 'none';
  var zoom = $('zoom-controls'); if (zoom) zoom.style.display = 'none';
  var sort = $('library-sort-controls'); if (sort) sort.style.display = 'none';
  var playlistActions = $('playlist-detail-actions'); if (playlistActions) playlistActions.hidden = true;
  var smartMixActions = $('smart-mix-detail-actions'); if (smartMixActions) smartMixActions.hidden = true;
}

function getRadioProvider(providerId) {
  return radioProviderRegistry && radioProviderRegistry.get(providerId || radioUiState.providerId || 'local-library');
}

function getRadioProviderContext() {
  return { musicFiles: state.musicFiles, missingFilePaths: libraryMissingFilePaths, unplayableFilePaths: libraryMissingFilePaths };
}

function getRadioPreferences() { return window.RadioPreferences ? window.RadioPreferences.sanitizeRadioPreferences(appSettings.radioPreferences) : {}; }
function getRadioBlocklist() { return window.RadioPreferences ? window.RadioPreferences.sanitizeRadioBlocklist(appSettings.radioBlocklist) : { version: 1, tracks: [], artists: [] }; }
function persistRadioPersonalization() { appSettings.radioPreferences = getRadioPreferences(); appSettings.radioBlocklist = getRadioBlocklist(); saveSettingsDebounced(150); }
function isRadioCandidateBlocked(candidate) { return window.RadioPreferences ? window.RadioPreferences.isBlocked(candidate, getRadioBlocklist()) : { track: false, artist: false }; }
function getRadioDiscoveryOptions(session) {
  var prefs = getRadioPreferences(); var bias = session && session.discoveryBias;
  return { discoveryDepth: prefs.discoveryDepth, excludeKnownTracks: prefs.excludeKnownTracks === true, similarityBias: bias && bias.candidateIds && bias.remainingSelections > 0 ? { candidateIds: bias.candidateIds, strength: Math.max(0, Math.min(1, Number(bias.strength) || 0)), remainingSelections: bias.remainingSelections } : null };
}
function consumeRadioDiscoveryBias(session, count) {
  if (window.RadioDiscoveryBias) return window.RadioDiscoveryBias.consume(session, count);
  if (!session || !session.discoveryBias) return;
  session.discoveryBias.remainingSelections = Math.max(0, session.discoveryBias.remainingSelections - Math.max(0, Number(count) || 0));
  session.discoveryBias.strength = Math.max(0, Math.min(1, session.discoveryBias.remainingSelections / 10));
  if (!session.discoveryBias.remainingSelections) session.discoveryBias = null;
}
async function setMoreLikeThis(track) {
  var session = state.radioSession;
  if (!session || session.providerId !== 'lastfm' || !track || !window.api || !window.api.lastfmDiscoverySimilarity) return;
  var seed = { artist: track.artist || '', title: track.title || '', trackMbid: track.trackMbid || track.recordingMbid || '' };
  if (!seed.artist || !seed.title) return;
  try {
    var result = await window.api.lastfmDiscoverySimilarity(seed, session.genreIds[0]);
    if (!isCurrentRadioSession(session, session.stationId)) return;
    session.discoveryBias = { type: 'more-like-this', seedTrack: seed, strength: 1, remainingSelections: 10, candidateIds: Array.isArray(result && result.candidateIds) ? result.candidateIds.slice(0, 80) : [] };
    showToast(session.discoveryBias.candidateIds.length ? 'More Like This is guiding the next selections.' : 'Similarity is unavailable for this station; normal discovery continues.');
    if (state.currentView === 'radio') renderRadioView();
  } catch (error) { console.warn('More Like This failed:', error); showToast('Similarity is unavailable; normal Radio discovery continues.'); }
}
function clearMoreLikeThis() { if (state.radioSession) { state.radioSession.discoveryBias = null; if (state.currentView === 'radio') renderRadioView(); } }
function scheduleQueueRefresh() {
  if ((!isQueueOpen && !isFullscreenQueueOpen()) || queueRefreshScheduled || queueDragInProgress) return;
  queueRefreshScheduled = true;
  requestAnimationFrame(function () { queueRefreshScheduled = false; if (!queueDragInProgress) { if (isQueueOpen) renderQueue({ preserveScroll: true }); if (isFullscreenQueueOpen()) renderFullscreenQueue({ preserveScroll: true }); } });
}

function radioGenreIdsMatch(providerId, left, right) {
  if (!left || !right) return false;
  if (providerId === 'lastfm' && window.RadioProviders && window.RadioProviders.normalizeLastfmGenreKey) {
    return window.RadioProviders.normalizeLastfmGenreKey(left) === window.RadioProviders.normalizeLastfmGenreKey(right);
  }
  return left === right;
}

function createRadioStationId() {
  radioStationSequence++;
  return 'radio_' + Date.now() + '_' + radioStationSequence;
}

function normalizeSourceRadio(value) {
  if (!value || typeof value !== 'object') return null;
  var providerId = typeof value.providerId === 'string' ? value.providerId.trim() : '';
  var genreIds = Array.isArray(value.genreIds) ? value.genreIds.map(function (genre) { return String(genre || '').trim(); }).filter(Boolean) : [];
  return providerId && genreIds.length ? { providerId: providerId, genreIds: Array.from(new Set(genreIds)) } : null;
}

function normalizeRadioProviderSession(value, fallbackGenreIds, providerId) {
  var source = value && typeof value === 'object' ? value : {};
  var genreIds = Array.isArray(source.genreIds) ? source.genreIds : fallbackGenreIds;
  var normalizedGenres = Array.from(new Set((genreIds || []).map(function (genre) { return String(genre || '').trim(); }).filter(Boolean)));
  if (!normalizedGenres.length) return null;
  if (providerId === 'lastfm') {
    if (source.version !== 1 || typeof source.poolKey !== 'string' || !source.poolKey) return null;
    return {
      version: 1,
      genreIds: normalizedGenres,
      mode: 'balanced',
      excludeKnownTracks: source.excludeKnownTracks === true,
      poolKey: source.poolKey.slice(0, 240),
      remainingItemIds: Array.isArray(source.remainingItemIds) ? source.remainingItemIds.map(function (id) { return String(id || ''); }).filter(Boolean).slice(0, 2000) : [],
      recentItemIds: Array.isArray(source.recentItemIds) ? source.recentItemIds.map(function (id) { return String(id || ''); }).filter(Boolean).slice(-5) : [],
      lastArtistKey: typeof source.lastArtistKey === 'string' ? source.lastArtistKey.slice(0, 500) : ''
    };
  }
  return {
    genreIds: normalizedGenres,
    remainingItemIds: Array.isArray(source.remainingItemIds) ? source.remainingItemIds.map(function (id) { return String(id || ''); }).filter(Boolean) : [],
    recentItemIds: Array.isArray(source.recentItemIds) ? source.recentItemIds.map(function (id) { return String(id || ''); }).filter(Boolean).slice(-5) : []
  };
}

function serializeRadioContext(session) {
  if (!session) return null;
  var sourceRadio = normalizeSourceRadio({ providerId: session.providerId, genreIds: session.genreIds });
  var providerSession = normalizeRadioProviderSession(session.providerSession, sourceRadio && sourceRadio.genreIds, sourceRadio && sourceRadio.providerId);
  return sourceRadio && providerSession ? { providerId: sourceRadio.providerId, genreIds: sourceRadio.genreIds, providerSession: providerSession, playedTracks: (session.playedTracks || []).slice(-100).map(toLightTrackRef).filter(Boolean) } : null;
}

function isCurrentRadioSession(session, stationId) {
  return !!session && state.radioSession === session && session.stationId === stationId;
}

function isCurrentRadioStart(stationId) {
  if (window.RadioQueueHelpers && window.RadioQueueHelpers.isCurrentPendingRadioStart) {
    return window.RadioQueueHelpers.isCurrentPendingRadioStart(radioUiState.starting, radioUiState.startingStationId, stationId);
  }
  return radioUiState.starting && radioUiState.startingStationId === stationId;
}

function cancelPendingRadioStart() {
  cancelRadioResolverRequests(pendingRadioStartSession);
  pendingRadioStartSession = null;
  if (!radioUiState.startingStationId) return;
  radioUiState.starting = false;
  radioUiState.startingStationId = '';
}

function nextRadioResolverRequestId(session) {
  radioResolverRequestSequence++;
  return 'station_' + (session && session.stationId || 'none') + '_' + radioResolverRequestSequence;
}

function cancelRadioResolverRequests(session, scope) {
  if (!session || !window.RadioResolverOwnership) return;
  window.RadioResolverOwnership.cancelRequests(session, scope, function (requestId) {
    if (window.api && window.api.cancelRadioResolverRequest) window.api.cancelRadioResolverRequest(requestId).catch(function () { });
  });
}

function disposeRadioSession() {
  var session = state.radioSession;
  state.radioSession = null;
  cancelRadioResolverRequests(session);
  if (session && preparedRadioSlot && preparedRadioSlot.stationId === session.stationId) clearPreparedRadioSlot(true);
  if (session && radioUiState.startingStationId === session.stationId) {
    radioUiState.starting = false;
    radioUiState.startingStationId = '';
  }
  if (!session || !session.provider || !session.provider.dispose) return;
  Promise.resolve(session.provider.dispose(session.providerSession)).catch(function (error) { console.error('Could not dispose radio session:', error); });
}

function disposeRadioProviderSession(provider, providerSession) {
  if (!provider || !provider.dispose || !providerSession) return;
  Promise.resolve(provider.dispose(providerSession)).catch(function (error) { console.error('Could not dispose radio provider session:', error); });
}

function radioItemToPlaybackTrack(item, session) {
  if (!item || !item.playback || item.playback.kind !== 'local-file' || !item.playback.filePath) return null;
  var library = getLibraryIndex();
  var file = library.byPath.get(item.playback.filePath) || library.byStrippedPath.get(stripFileUrl(item.playback.filePath));
  if (!file) return null;
  var sourceRadio = normalizeSourceRadio({ providerId: session.providerId, genreIds: session.genreIds });
  return {
    matchedFile: file,
    title: item.title || file.title,
    artist: item.artist || file.artist,
    album: item.album || file.album,
    duration: item.duration || file.duration,
    isDisabled: false,
    queueEntryId: createQueueEntryId(),
    radioSessionId: session.stationId,
    sourceRadio: sourceRadio
  };
}

// Stable resolver descriptors deliberately exclude expiring media URLs. Local
// matching happens in the renderer against the in-memory library; remote
// search and stream preparation remain in the trusted main process.
var playbackResolver = window.PlaybackResolver ? window.PlaybackResolver.createPlaybackResolver({
  matchLocal: function (candidate, files, options) { return window.LocalTrackMatcher.matchLocalTrack(candidate, files, options); },
  resolveYouTube: async function (candidate, context) {
    if (!window.api || !window.api.resolveRadioCandidate) return null;
    return window.api.resolveRadioCandidate(candidate, context && context.requestId, getRadioPreferences());
  },
  prepareYouTube: async function (videoId, context) {
    if (!window.api || !window.api.prepareRadioPlayback) throw new Error('Radio streaming is unavailable.');
    return window.api.prepareRadioPlayback(videoId, context && context.ownership, context && context.requestId);
  },
  toFileUrl: toFileUrl
}) : null;

async function resolveRadioItemToPlaybackTrack(item, session) {
  var trace = session.radioDebug;
  var traceCandidate = !!(trace && trace.candidateLogged < 3);
  if (traceCandidate) {
    trace.candidateLogged++;
    radioDebug('resolve-dispatch', { stationId: session.stationId, candidateId: item && (item.id || item.candidateId) || '', itemKind: item && item.itemKind || '', providerId: item && item.providerId || '', hasResolver: !!playbackResolver });
  }
  if (!item) {
    if (trace) trace.rejected++;
    if (traceCandidate) radioDebug('resolve-return', { stationId: session.stationId, result: 'null', reason: 'missing-item' });
    return null;
  }
  if (item.itemKind === 'candidate') {
    var blockedCandidate = isRadioCandidateBlocked(item);
    if (blockedCandidate.track || blockedCandidate.artist) {
      if (trace) trace.rejected++;
      if (traceCandidate) radioDebug('resolve-return', { stationId: session.stationId, result: 'null', reason: blockedCandidate.artist ? 'artist-blocked' : 'track-blocked' });
      return null;
    }
  }
  if (item.playback && item.playback.kind === 'local-file') {
    var localTrack = radioItemToPlaybackTrack(item, session);
    if (!localTrack && trace) trace.rejected++;
    if (traceCandidate) radioDebug('resolve-return', { stationId: session.stationId, result: localTrack ? 'local' : 'null', reason: localTrack ? '' : 'invalid-local-item' });
    return localTrack;
  }
  if (item.itemKind !== 'candidate' || !playbackResolver) {
    if (trace) trace.rejected++;
    if (traceCandidate) radioDebug('resolve-return', { stationId: session.stationId, result: 'null', reason: item.itemKind !== 'candidate' ? 'unsupported-item-kind' : 'playback-resolver-unavailable' });
    return null;
  }
  var requestId = nextRadioResolverRequestId(session);
  if (traceCandidate) radioDebug('candidate', { stationId: session.stationId, artist: item.artist || '', title: item.title || '', candidateId: item.id || item.candidateId || '' });
  window.RadioResolverOwnership.registerRequest(session, requestId, 'fill');
  try {
    var candidate = { candidateId: item.id || item.candidateId, trackMbid: item.trackMbid || item.recordingMbid || item.mbid || '', artistMbid: item.artistMbid || '', title: item.title || '', artist: item.artist || '', album: item.album || '', duration: Number(item.duration) || 0, radioDebug: traceCandidate };
    var local = window.LocalTrackMatcher.matchLocalTrack(candidate, state.musicFiles, { unplayableFilePaths: libraryMissingFilePaths });
    if (trace) {
      if (local) trace.localMatches++;
      if (traceCandidate) radioDebug('local-resolve', { stationId: session.stationId, candidateId: candidate.candidateId, matched: !!local });
    }
    var resolved = await playbackResolver.resolve(candidate, {
      musicFiles: state.musicFiles,
      requestId: requestId,
      onRemoteResolved: function (remote) {
        if (trace) {
          trace.youtubeSearches += Math.max(0, Number(remote && remote.debugSearchCount) || 0);
          var metrics = remote && remote.debugMetrics || {};
          radioDebug('resolution-metrics', { stationId: session.stationId, candidateId: candidate.candidateId, youtubeSearchMs: Number(metrics.totalMs) || 0, flatSearchMs: Number(metrics.flatSearchMs) || 0, flatSearchCount: Number(metrics.flatSearchCount) || 0, detailedExtractionCount: Number(metrics.detailedExtractionCount) || 0, shortlistSize: Number(metrics.shortlistSize) || 0, rateLimitTrips: Number(metrics.rateLimitTrips) || 0, ytDlpSearches: Number(metrics.searches) || 0, matcherMs: Number(metrics.matcherMs) || 0, cached: remote && remote.cached === true });
        }
        if (remote && remote.rateLimited) session.youtubeRateLimited = true;
      }
    });
    if (!isCurrentRadioSession(session, session.stationId) && !isCurrentRadioStart(session.stationId)) {
      if (traceCandidate) radioDebug('resolve-return', { stationId: session.stationId, result: 'null', reason: 'stale-session' });
      return null;
    }
    if (!resolved) {
      if (trace) trace.rejected++;
      if (traceCandidate) radioDebug('resolve-return', { stationId: session.stationId, result: 'null', reason: 'resolver-returned-null' });
      if (traceCandidate) radioDebug('playable-conversion', { stationId: session.stationId, playbackKind: '', hasVideoId: false, acceptedByController: false });
      return null;
    }
    if (trace) {
      if (resolved.playback && resolved.playback.kind === 'youtube') {
        trace.youtubeAccepted++;
      }
      if (traceCandidate) radioDebug('playable-conversion', { stationId: session.stationId, playbackKind: resolved.playback && resolved.playback.kind || '', hasVideoId: !!(resolved.playback && resolved.playback.videoId), acceptedByController: true });
    }
    if (traceCandidate) radioDebug('resolve-return', { stationId: session.stationId, result: resolved.playback && resolved.playback.kind || 'null', reason: '' });
    return Object.assign(resolved, {
      isDisabled: false,
      queueEntryId: createQueueEntryId(),
      radioSessionId: session.stationId,
      sourceRadio: normalizeSourceRadio({ providerId: session.providerId, genreIds: session.genreIds })
    });
  } catch (error) {
    if (trace) trace.rejected++;
    if (traceCandidate) radioDebug('resolve-return', { stationId: session.stationId, result: 'null', reason: 'resolver-error' });
    if (traceCandidate) radioDebug('playable-conversion', { stationId: session.stationId, playbackKind: '', hasVideoId: false, acceptedByController: false });
    if (!/cancelled/i.test(String(error && error.message || error))) console.warn('Radio candidate skipped:', error && error.message ? error.message : error);
    return null;
  } finally {
    window.RadioResolverOwnership.unregisterRequest(session, requestId, 'fill');
  }
}

function trackMatchesRadioContext(track, context) {
  var sourceRadio = normalizeSourceRadio(track && track.sourceRadio);
  if (!sourceRadio || !context || sourceRadio.providerId !== context.providerId || sourceRadio.genreIds.length !== context.genreIds.length) return false;
  return sourceRadio.genreIds.every(function (genre, index) { return genre === context.genreIds[index]; });
}

function markRadioTracksForSession(tracks, context, session) {
  (tracks || []).forEach(function (track) {
    if (trackMatchesRadioContext(track, context)) track.radioSessionId = session.stationId;
  });
}

function getActiveRadioSequence() {
  return state.isShuffle ? state.shuffleQueue : state.playQueueTracks;
}

function getRemainingRadioTrackCount(session) {
  if (!session) return 0;
  var sequence = getActiveRadioSequence();
  var cursor = state.isShuffle ? state.shuffleQueueCursor : state.playQueueCursor;
  var cursorIndex = findTrackIndexByIdentity(sequence, cursor);
  var currentIndex = sequence.indexOf(state.currentPlayingTrack);
  if (currentIndex !== -1 && state.currentPlayingTrack && state.currentPlayingTrack.radioSessionId === session.stationId) cursorIndex = currentIndex;
  var start = cursorIndex >= 0 ? cursorIndex + 1 : 0;
  return sequence.slice(start).filter(function (track) { return !track.isDisabled && track.radioSessionId === session.stationId; }).length;
}

function rememberPlayedRadioTrack(session, track) {
  if (!session || !track || track.radioSessionId !== session.stationId) return;
  if (!session.playedTracks) session.playedTracks = [];
  session.playedTracks = window.RadioQueueHelpers && window.RadioQueueHelpers.appendPlayedRadioTrack
    ? window.RadioQueueHelpers.appendPlayedRadioTrack(session.playedTracks, Object.assign({}, track), 100)
    : session.playedTracks.concat([Object.assign({}, track)]).slice(-100);
}

function canAppendRadioPlayable(session) {
  return getRemainingRadioTrackCount(session) < RADIO_PLAYABLE_HARD_CAP;
}

async function resolveRadioBatch(session, result, limit, onResolved) {
  var items = (result && result.items || []).slice(0, limit || RADIO_FILL_CANDIDATE_LIMIT);
  var tracks = new Array(items.length);
  for (var offset = 0; offset < items.length; offset += 2) {
    var settled = await Promise.all(items.slice(offset, offset + 2).map(async function (item) {
      var track = await resolveRadioItemToPlaybackTrack(item, session);
      if (track && typeof onResolved === 'function') onResolved(track);
      return track;
    }));
    settled.forEach(function (track, index) { tracks[offset + index] = track; });
    if (!isCurrentRadioSession(session, session.stationId) && !isCurrentRadioStart(session.stationId)) return [];
  }
  return tracks.filter(Boolean);
}

async function appendRadioBatch(session, result) {
  var appended = 0;
  var tracks = await resolveRadioBatch(session, result, RADIO_FILL_CANDIDATE_LIMIT, function (track) {
    if (!isCurrentRadioSession(session, session.stationId)) return;
    // Resolution is concurrent in pairs.  The append boundary is the hard
    // limit, so a late result cannot grow the active Radio tail without bound.
    var ahead = getRemainingRadioTrackCount(session);
    var mayAppend = window.RadioQueueHelpers && window.RadioQueueHelpers.shouldAppendProviderRadioTrack
      ? window.RadioQueueHelpers.shouldAppendProviderRadioTrack(ahead, RADIO_PLAYABLE_HIGH_WATER, RADIO_PLAYABLE_HARD_CAP)
      : ahead < RADIO_PLAYABLE_HIGH_WATER && ahead < RADIO_PLAYABLE_HARD_CAP;
    if (!mayAppend || !canAppendRadioPlayable(session)) return;
    if (window.RadioQueueHelpers && window.RadioQueueHelpers.appendRadioTracksToQueues) {
      window.RadioQueueHelpers.appendRadioTracksToQueues(state.playQueueTracks, state.shuffleQueue, [track], state.isShuffle);
    } else {
      state.playQueueTracks.push(track);
      if (state.isShuffle) state.shuffleQueue.push(track);
    }
    appended++;
    session.trackCount = (session.trackCount || 0) + 1;
    prepareNextRadioTrack();
    scheduleQueueRefresh();
    var pending = session.awaitingNextPlayable;
    if (pending && pending.generation === playbackGeneration) {
      session.awaitingNextPlayable = null;
      playNextTrack({ automaticAdvance: pending.reason !== 'manual-next', waitedForRadioRefill: true });
    }
  });
  if (!tracks.length) {
    if (result && result.providerSession) session.providerSession = result.providerSession;
    return 0;
  }
  session.providerSession = result.providerSession;
  return appended;
}

function maybeRefillRadioQueue(options) {
  options = options || {};
  var session = state.radioSession;
  if (!session || session.starting || session.refillPromise) return session && session.refillPromise;
  if (session.refillError && !options.retry) return null;
  if (!options.force && getRemainingRadioTrackCount(session) >= RADIO_REFILL_THRESHOLD) return null;
  var provider = session.provider;
  if (!provider || !provider.nextBatch) return null;
  var stationId = session.stationId;
  session.refillError = '';
  var refillPromise = Promise.resolve().then(async function () {
    var consumed = 0; var appended = 0; var result = null;
    while (consumed < RADIO_FILL_CANDIDATE_LIMIT && getRemainingRadioTrackCount(session) < RADIO_PLAYABLE_HIGH_WATER && canAppendRadioPlayable(session)) {
      if (session.candidateBacklog && session.candidateBacklog.length) {
        result = { items: session.candidateBacklog.splice(0, Math.min(24, RADIO_FILL_CANDIDATE_LIMIT - consumed)), providerSession: session.providerSession, exhausted: false };
      } else {
        result = await provider.nextBatch(session.providerSession, Object.assign({ genreIds: session.genreIds.slice() }, getRadioDiscoveryOptions(session)), getRadioProviderContext());
      }
      if (!isCurrentRadioSession(session, stationId)) return { appended: 0, result: result };
      consumed += (result && result.items || []).length;
      var accepted = await appendRadioBatch(session, result || {});
      appended += accepted;
      consumeRadioDiscoveryBias(session, accepted);
      if (!result || result.exhausted || !(result.items || []).length) break;
    }
    return { appended: appended, result: result };
  });
  session.refillPromise = refillPromise;
  refillPromise.then(function (fill) {
    if (!isCurrentRadioSession(session, stationId)) return;
    var appended = fill && fill.appended || 0;
    var result = fill && fill.result;
    if (!appended) {
      var shouldCheckpoint = window.RadioQueueHelpers && window.RadioQueueHelpers.shouldCheckpointEmptyRadioRefill
        ? window.RadioQueueHelpers.shouldCheckpointEmptyRadioRefill(result && result.providerSession, appended)
        : !!(result && result.providerSession);
      if (shouldCheckpoint) {
        syncSavedQueuePaths();
        saveSettingsDebounced(300);
      }
      session.refillError = session.youtubeRateLimited ? 'YouTube is temporarily rate limited. Local/cached radio will continue.' : 'No playable tracks are available for this radio station.';
      return;
    }
    syncSavedQueuePaths();
    saveSettingsDebounced(300);
    if (isQueueOpen) renderQueue();
  }).catch(function (error) {
    if (!isCurrentRadioSession(session, stationId)) return;
    console.error('Could not refill radio:', error);
    session.refillError = 'Radio could not load more tracks. Try again while the current queue keeps playing.';
  }).finally(function () {
    if (!isCurrentRadioSession(session, stationId) || session.refillPromise !== refillPromise) return;
    session.refillPromise = null;
    if (state.currentView === 'radio') renderRadioView();
  });
  if (state.currentView === 'radio') renderRadioView();
  return refillPromise;
}

function retryRadioRefill() {
  maybeRefillRadioQueue({ force: true, retry: true });
}

function restoreRadioSessionFromContext(value) {
  var context = value && typeof value === 'object' ? value : null;
  var sourceRadio = normalizeSourceRadio(context);
  var providerSession = normalizeRadioProviderSession(context && context.providerSession, sourceRadio && sourceRadio.genreIds, sourceRadio && sourceRadio.providerId);
  var provider = sourceRadio && getRadioProvider(sourceRadio.providerId);
  if (!sourceRadio || !provider || !providerSession) return null;
  var session = { stationId: createRadioStationId(), providerId: sourceRadio.providerId, provider: provider, providerSession: providerSession, genreIds: sourceRadio.genreIds, trackCount: 0, refillPromise: null, refillError: '', restored: true, resolverRequestIds: new Set(), fillRequestIds: new Set(), transitionRequestIds: new Set(), candidateBacklog: [], playedTracks: Array.isArray(context.playedTracks) ? context.playedTracks.map(hydrateTrackRef).filter(Boolean).slice(-100) : [] };
  markRadioTracksForSession(state.playQueueTracks, sourceRadio, session);
  markRadioTracksForSession(state.shuffleQueue, sourceRadio, session);
  markRadioTracksForSession(state.currentTracks, sourceRadio, session);
  if (trackMatchesRadioContext(state.currentPlayingTrack, sourceRadio)) state.currentPlayingTrack.radioSessionId = session.stationId;
  var hasRadioTrack = state.playQueueTracks.concat(state.shuffleQueue).some(function (track) { return track.radioSessionId === session.stationId; });
  if (!hasRadioTrack) return null;
  session.trackCount = state.playQueueTracks.filter(function (track) { return track.radioSessionId === session.stationId; }).length;
  state.radioSession = session;
  radioUiState.providerId = sourceRadio.providerId;
  return session;
}

function radioElement(tag, className, text) {
  var el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function blockRadioTrack(track) {
  if (!window.RadioPreferences) return;
  var entry = window.RadioPreferences.radioDisplayTrack(track); if (!entry.key) return;
  var list = getRadioBlocklist(); if (!list.tracks.some(function (item) { return item.key === entry.key; })) list.tracks.push(entry);
  appSettings.radioBlocklist = list; var removed = removeBlockedRadioQueueEntries(); persistRadioPersonalization(); showToast('Blocked from Radio: ' + (entry.title || 'track') + (removed ? '. Removed ' + removed + ' queued track' + (removed === 1 ? '' : 's') + '.' : '.'));
  if (state.currentView === 'radio') renderRadioView();
}
function blockRadioArtist(track) {
  if (!window.RadioPreferences) return;
  var entry = window.RadioPreferences.radioDisplayArtist(track); if (!entry.key) return;
  var list = getRadioBlocklist(); if (!list.artists.some(function (item) { return item.key === entry.key; })) list.artists.push(entry);
  appSettings.radioBlocklist = list; var removed = removeBlockedRadioQueueEntries(); persistRadioPersonalization(); showToast('Blocked from Radio: ' + (entry.artist || 'artist') + (removed ? '. Removed ' + removed + ' queued track' + (removed === 1 ? '' : 's') + '.' : '.'));
  if (state.currentView === 'radio') renderRadioView();
}
function addManualRadioBlock(kind, artist, title) {
  if (!window.RadioPreferences) return;
  var source = { artist: String(artist || '').trim(), title: String(title || '').trim() };
  var entry = kind === 'track' ? window.RadioPreferences.radioDisplayTrack(source) : window.RadioPreferences.radioDisplayArtist(source);
  if (!entry.key) { showToast(kind === 'track' ? 'Enter both artist and track.' : 'Enter an artist name.'); return; }
  var list = getRadioBlocklist(); var bucket = kind === 'track' ? 'tracks' : 'artists';
  if (list[bucket].some(function (item) { return item.key === entry.key; })) { showToast('Already blocked from Radio.'); return; }
  list[bucket].push(entry);
  appSettings.radioBlocklist = list;
  var removed = removeBlockedRadioQueueEntries();
  persistRadioPersonalization();
  showToast('Blocked from Radio: ' + (kind === 'track' ? entry.title : entry.artist) + (removed ? '. Removed ' + removed + ' queued track' + (removed === 1 ? '' : 's') + '.' : '.'));
  renderRadioView();
}

function removeBlockedRadioQueueEntries() {
  if (!window.RadioPreferences) return 0;
  var removed = 0;
  function blocked(track) {
    if (!track || !(track.radioSessionId || track.sourceRadio)) return false;
    var result = isRadioCandidateBlocked(track);
    return !!(result.track || result.artist);
  }
  var removedIds = new Set();
  ['playQueueTracks', 'shuffleQueue', 'userQueue'].forEach(function (key) {
    state[key] = state[key].filter(function (track) {
      if (!blocked(track)) return true;
      removed++;
      if (track.queueEntryId) removedIds.add(track.queueEntryId);
      return false;
    });
  });
  if (state.playQueueCursor && blocked(state.playQueueCursor)) state.playQueueCursor = null;
  if (state.shuffleQueueCursor && blocked(state.shuffleQueueCursor)) state.shuffleQueueCursor = null;
  if (preparedRadioSlot && removedIds.has(preparedRadioSlot.queueEntryId)) clearPreparedRadioSlot(true);
  if (removed) {
    syncSavedQueuePaths();
    persistInBackground(persistSettings(appSettings));
    scheduleQueueRefresh();
    maybeRefillRadioQueue();
  }
  return removed;
}
function renderRadioRules() {
  var details = radioElement('details', 'radio-rules');
  details.appendChild(radioElement('summary', '', 'Discovery Rules'));
  var body = radioElement('div', 'radio-rules-body');
  var prefs = getRadioPreferences();
  var depth = radioElement('label', 'radio-depth-control');
  depth.appendChild(radioElement('span', 'radio-depth-label', 'Discovery depth'));
  var depthEnds = radioElement('div', 'radio-depth-ends'); depthEnds.append(radioElement('span', '', 'Essentials'), radioElement('span', '', 'Deep Cuts'));
  var range = document.createElement('input'); range.type = 'range'; range.min = '0'; range.max = '1'; range.step = '0.1'; range.value = String(prefs.discoveryDepth); range.setAttribute('aria-label', 'Discovery depth: Essentials to Deep Cuts');
  range.addEventListener('input', function () { var next = getRadioPreferences(); next.discoveryDepth = Number(range.value); appSettings.radioPreferences = next; persistRadioPersonalization(); });
  depth.append(depthEnds, range, radioElement('small', 'radio-rule-scope', state.radioSession ? 'Applies to the next discovery batch' : 'Used when a station starts'));
  body.appendChild(depth);
  [['excludeKnownTracks', 'Skip previously heard tracks'], ['avoidClean', 'Avoid clean / censored versions'], ['avoidLive', 'Avoid live versions'], ['avoidCovers', 'Avoid covers'], ['avoidRemixes', 'Avoid remixes'], ['avoidSlowedSped', 'Avoid slowed / sped-up versions']].forEach(function (row) {
    var label = radioElement('label', 'radio-rule-toggle'); var input = document.createElement('input'); input.type = 'checkbox'; input.checked = prefs[row[0]] === true;
    input.addEventListener('change', function () {
      var next = getRadioPreferences(); next[row[0]] = input.checked; appSettings.radioPreferences = next;
      if (row[0] === 'excludeKnownTracks' && state.radioSession && state.radioSession.providerId === 'lastfm' && state.radioSession.providerSession) {
        state.radioSession.providerSession = Object.assign({}, state.radioSession.providerSession, { excludeKnownTracks: next.excludeKnownTracks === true });
        maybeRefillRadioQueue({ force: true });
      }
      persistRadioPersonalization();
    });
    var copy = radioElement('span', 'radio-rule-copy');
    copy.append(radioElement('span', '', row[1]));
    var scope = row[0] === 'excludeKnownTracks' && state.radioSession && state.radioSession.providerId === 'lastfm'
      ? 'Current station'
      : (state.radioSession ? 'Next resolution' : 'New stations');
    copy.appendChild(radioElement('small', 'radio-rule-scope', scope));
    label.append(input, copy); body.appendChild(label);
  });
  var manual = radioElement('div', 'radio-manual-block');
  manual.appendChild(radioElement('h3', '', 'Manual blocklist'));
  var artistInput = document.createElement('input'); artistInput.type = 'text'; artistInput.placeholder = 'Artist'; artistInput.setAttribute('aria-label', 'Artist to block from Radio');
  var titleInput = document.createElement('input'); titleInput.type = 'text'; titleInput.placeholder = 'Track (optional)'; titleInput.setAttribute('aria-label', 'Track to block from Radio');
  var addButton = radioElement('button', 'btn btn-outline', 'Block'); addButton.type = 'button';
  addButton.addEventListener('click', function () { addManualRadioBlock(titleInput.value.trim() ? 'track' : 'artist', artistInput.value, titleInput.value); });
  manual.append(artistInput, titleInput, addButton); body.appendChild(manual);
  var list = getRadioBlocklist(); var manage = radioElement('details', 'radio-blocked-manager');
  manage.appendChild(radioElement('summary', '', 'Blocked: ' + list.tracks.length + ' tracks · ' + list.artists.length + ' artists'));
  var managerBody = radioElement('div', 'radio-blocked-body');
  var search = document.createElement('input'); search.type = 'search'; search.placeholder = 'Search blocked artists and tracks'; search.className = 'radio-blocked-search'; search.setAttribute('aria-label', 'Search blocked Radio entries'); managerBody.appendChild(search);
  var refreshBlocked = function () {
    Array.from(managerBody.querySelectorAll('.radio-blocked-section')).forEach(function (node) { node.remove(); });
    var query = String(search.value || '').trim().toLocaleLowerCase();
    [['tracks', 'Blocked Tracks', function (item) { return (item.artist || 'Unknown Artist') + ' — ' + (item.title || 'Unknown Track'); }], ['artists', 'Blocked Artists', function (item) { return item.artist || 'Unknown Artist'; }]].forEach(function (section) {
      var sectionEl = radioElement('section', 'radio-blocked-section'); sectionEl.appendChild(radioElement('h3', '', section[1]));
      var items = list[section[0]].filter(function (item) { return !query || section[2](item).toLocaleLowerCase().includes(query); });
      if (!items.length) sectionEl.appendChild(radioElement('p', 'radio-blocked-empty', query ? 'No matches.' : 'Nothing blocked.'));
      items.forEach(function (item) { var row = radioElement('div', 'radio-blocked-row'); row.appendChild(radioElement('span', '', section[2](item))); var remove = radioElement('button', 'btn btn-outline', 'Unban'); remove.type = 'button'; remove.addEventListener('click', function () { list[section[0]] = list[section[0]].filter(function (entry) { return entry.key !== item.key; }); appSettings.radioBlocklist = list; persistRadioPersonalization(); renderRadioView(); }); row.appendChild(remove); sectionEl.appendChild(row); });
      managerBody.appendChild(sectionEl);
    });
  };
  search.addEventListener('input', refreshBlocked);
  refreshBlocked();
  manage.appendChild(managerBody); body.appendChild(manage); details.appendChild(body); return details;
}

function renderRadioView() {
  var container = $('radio-container');
  if (!container) return;
  var provider = getRadioProvider(radioUiState.providerId);
  container.replaceChildren();
  var header = radioElement('header', 'radio-view-header');
  var title = radioElement('h1', '', 'Radio'); title.id = 'radio-title';
  var subtitle = radioElement('p', 'radio-subtitle', provider && provider.id === 'lastfm' ? 'Discover genre-based candidates through Last.fm, then play only verified local or YouTube matches.' : 'Choose one genre and begin a local station from your collection.');
  header.append(title, subtitle);
  container.appendChild(header);

  if (!provider) {
    container.appendChild(radioElement('p', 'radio-state radio-state-error', 'Radio provider is unavailable.'));
    return;
  }
  if (provider && provider.id === 'local-library' && !state.musicFiles.length) {
    container.appendChild(radioElement('p', 'radio-state', 'Your library is empty. Import music to start a radio station.'));
    return;
  }

  var controlBar = radioElement('div', 'radio-control-bar');
  var providerPanel = radioElement('div', 'radio-provider-panel');
  providerPanel.appendChild(radioElement('span', 'radio-field-label', 'PROVIDER'));
  var providerPicker = radioElement('div', 'radio-provider-picker');
  (radioProviderRegistry ? radioProviderRegistry.list() : []).forEach(function (candidateProvider) {
    var button = radioElement('button', 'btn btn-outline radio-provider-choice', candidateProvider.label);
    button.type = 'button'; button.classList.toggle('active', candidateProvider.id === radioUiState.providerId);
    button.disabled = !!state.radioSession || radioUiState.starting;
    button.addEventListener('click', function () {
      radioUiState.providerId = candidateProvider.id; radioUiState.loaded = false; radioUiState.genres = []; radioUiState.selectedGenreId = ''; radioUiState.error = ''; renderRadioView(); loadRadioGenres(true);
    });
    providerPicker.appendChild(button);
  });
  providerPanel.appendChild(providerPicker);
  controlBar.appendChild(providerPanel);
  if (state.radioSession) {
    var activeGenre = radioUiState.genres.find(function (genre) { return genre.id === state.radioSession.genreIds[0]; });
    var stationActions = radioElement('div', 'radio-station-actions');
    var summary = radioElement('div', 'radio-station-summary');
    var summaryText = (activeGenre ? activeGenre.label : state.radioSession.genreIds[0]) + ' · ' + getRemainingRadioTrackCount(state.radioSession) + ' tracks remaining · ' + ((state.radioSession.playedTracks || []).length) + ' played';
    if (state.radioSession.refillPromise) summaryText += ' · loading more';
    summary.append(radioElement('span', 'radio-field-label', 'ACTIVE STATION'), radioElement('strong', '', summaryText));
    var viewQueueButton = radioElement('button', 'btn ghost radio-view-queue', 'View Queue');
    viewQueueButton.type = 'button';
    viewQueueButton.addEventListener('click', function () { setQueueOpen(true); });
    summary.appendChild(viewQueueButton);
    stationActions.appendChild(summary);
    var activeStopButton = radioElement('button', 'btn btn-outline radio-stop-button', 'Stop Radio');
    activeStopButton.type = 'button'; activeStopButton.addEventListener('click', stopRadioStation);
    stationActions.appendChild(activeStopButton);
    controlBar.appendChild(stationActions);
  } else {
    var stopButton = radioElement('button', 'btn btn-outline radio-stop-button', radioUiState.starting ? 'Cancel Start' : 'Stop Radio');
    stopButton.type = 'button'; stopButton.disabled = !radioUiState.starting;
    stopButton.addEventListener('click', stopRadioStation);
    controlBar.appendChild(stopButton);
  }
  container.appendChild(controlBar);

  if (radioUiState.preparation) container.appendChild(radioElement('p', 'radio-preparation-state', radioUiState.preparation));
  if (provider.id === 'lastfm') container.appendChild(renderRadioRules());
  if (state.radioSession && state.radioSession.discoveryBias) {
    var bias = state.radioSession.discoveryBias; var biasNote = radioElement('div', 'radio-bias-note');
    biasNote.append(radioElement('span', '', 'More like: ' + bias.seedTrack.artist + ' — ' + bias.seedTrack.title + ' · ' + bias.remainingSelections + ' selections remaining'));
    var clearBias = radioElement('button', 'btn ghost', 'Clear'); clearBias.type = 'button'; clearBias.addEventListener('click', clearMoreLikeThis); biasNote.appendChild(clearBias); container.appendChild(biasNote);
  }

  if (state.radioSession && state.radioSession.refillError) {
    var refillState = radioElement('div', 'radio-refill-error');
    refillState.appendChild(radioElement('span', '', state.radioSession.refillError));
    var retryRefill = radioElement('button', 'btn btn-outline', state.radioSession.refillPromise ? 'Retrying…' : 'Retry');
    retryRefill.type = 'button'; retryRefill.disabled = !!state.radioSession.refillPromise;
    retryRefill.addEventListener('click', retryRadioRefill);
    refillState.appendChild(retryRefill); container.appendChild(refillState);
  }

  if (radioUiState.loading) {
    container.appendChild(radioElement('p', 'radio-state', 'Loading genres…'));
    return;
  }
  if (radioUiState.error) {
    var errorState = radioElement('div', 'radio-state radio-state-error');
    errorState.appendChild(radioElement('span', '', radioUiState.error));
    var retry = radioElement('button', 'btn btn-outline', 'Retry'); retry.type = 'button'; retry.addEventListener('click', function () { loadRadioGenres(true); });
    errorState.appendChild(retry); container.appendChild(errorState);
    return;
  }
  if (!radioUiState.genres.length) {
    container.appendChild(radioElement('p', 'radio-state', 'No tagged genres are available in this library yet. Add genre metadata to start radio.'));
    return;
  }

  var picker = radioElement('section', 'radio-genre-picker');
  picker.appendChild(radioElement('h2', '', 'Choose a genre'));
  var search = radioElement('input', 'radio-genre-search');
  search.type = 'search'; search.placeholder = 'Search genres'; search.value = radioUiState.search; search.setAttribute('aria-label', 'Search genres');
  search.addEventListener('input', function () {
    var selectionStart = search.selectionStart;
    var selectionEnd = search.selectionEnd;
    radioUiState.search = search.value;
    renderRadioView();
    var nextSearch = container.querySelector('.radio-genre-search');
    if (!nextSearch) return;
    nextSearch.focus({ preventScroll: true });
    nextSearch.setSelectionRange(selectionStart, selectionEnd);
  });
  picker.appendChild(search);
  var list = radioElement('div', 'radio-genre-list'); list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', 'Genres');
  var query = radioUiState.search.trim();
  var visibleGenres = provider.id === 'lastfm' && window.RadioProviders && window.RadioProviders.searchLastfmGenreCatalog
    ? window.RadioProviders.searchLastfmGenreCatalog(query)
    : radioUiState.genres.filter(function (genre) { return !query || genre.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()); });
  if (!visibleGenres.length) list.appendChild(radioElement('p', 'radio-genre-empty', 'No genres match this search.'));
  visibleGenres.forEach(function (genre) {
    var button = radioElement('button', 'radio-genre-option'); button.type = 'button'; button.setAttribute('role', 'option');
    var selected = radioUiState.selectedGenreId === genre.id;
    button.classList.toggle('selected', selected); button.setAttribute('aria-selected', String(selected));
    button.appendChild(radioElement('span', '', genre.label));
    if (Number.isFinite(genre.trackCount) && genre.trackCount >= 0) button.appendChild(radioElement('small', '', String(genre.trackCount)));
    button.addEventListener('click', function () { radioUiState.selectedGenreId = genre.id; renderRadioView(); });
    list.appendChild(button);
  });
  picker.appendChild(list); container.appendChild(picker);
  var activeGenreId = state.radioSession && state.radioSession.providerId === provider.id ? state.radioSession.genreIds[0] : '';
  var sameAsActive = radioGenreIdsMatch(provider.id, activeGenreId, radioUiState.selectedGenreId);
  var startLabel = radioUiState.starting ? 'Starting Radio…' : state.radioSession ? (sameAsActive ? 'Current Station' : 'Start New Station') : 'Start Radio';
  var start = radioElement('button', 'btn btn-primary radio-start-button', startLabel);
  start.type = 'button'; start.disabled = !radioUiState.selectedGenreId || sameAsActive || radioUiState.starting;
  if (sameAsActive) start.setAttribute('aria-describedby', 'radio-active-station-note');
  start.addEventListener('click', startRadioStation); container.appendChild(start);
  if (sameAsActive) {
    var activeNote = radioElement('p', 'radio-active-station-note', 'This genre is already playing. Choose another genre to start a new station.');
    activeNote.id = 'radio-active-station-note'; container.appendChild(activeNote);
  }
}

async function loadRadioGenres(force) {
  if (radioUiState.loading || (radioUiState.loaded && !force)) return;
  var provider = getRadioProvider();
  if (!provider) return;
  radioUiState.loading = true; radioUiState.error = ''; renderRadioView();
  try {
    radioUiState.genres = await provider.listGenres(getRadioProviderContext());
    radioUiState.loaded = true;
    if (radioUiState.selectedGenreId && !radioUiState.genres.some(function (genre) { return genre.id === radioUiState.selectedGenreId; })) radioUiState.selectedGenreId = '';
  } catch (error) {
    console.error('Could not load radio genres:', error); radioUiState.error = 'Genres could not be loaded.';
  } finally {
    radioUiState.loading = false; renderRadioView();
  }
}

async function startRadioStation() {
  var provider = getRadioProvider();
  if (!provider || !radioUiState.selectedGenreId) return;
  if (radioUiState.starting) cancelPendingRadioStart();
  radioUiState.starting = true; radioUiState.error = ''; renderRadioView();
  disposeRadioSession();
  radioUiState.starting = true;
  var session = { stationId: createRadioStationId(), providerId: provider.id, provider: provider, providerSession: null, genreIds: [radioUiState.selectedGenreId], trackCount: 0, refillPromise: null, refillError: '', starting: true, resolverRequestIds: new Set(), fillRequestIds: new Set(), transitionRequestIds: new Set(), candidateBacklog: [], playedTracks: [], radioDebug: { candidateLogged: 0, candidatesReceived: 0, candidatesConsumed: 0, localMatches: 0, youtubeSearches: 0, youtubeAccepted: 0, rejected: 0 } };
  pendingRadioStartSession = session;
  var stationId = session.stationId;
  radioUiState.startingStationId = stationId;
  try {
    var result = await provider.startStation({ genreIds: [radioUiState.selectedGenreId], stationId: stationId, excludeKnownTracks: getRadioPreferences().excludeKnownTracks === true, discoveryDepth: getRadioPreferences().discoveryDepth }, getRadioProviderContext());
    // A Start action has already atomically disposed any restored/old session.
    // Do not reject its own result merely because a prior radio context existed.
    if (!isCurrentRadioStart(stationId)) {
      disposeRadioProviderSession(provider, result && result.providerSession);
      return;
    }
    session.providerSession = result.providerSession;
    var tracks = [];
    var batches = 1;
    session.candidateBacklog.push.apply(session.candidateBacklog, result && result.items || []);
    session.radioDebug.candidatesReceived += (result && result.items || []).length;
    radioDebug('resolution-start', { stationId: stationId, candidateBacklogSize: session.candidateBacklog.length });
    // Scan the provider-selected batch locally before any remote work. This
    // keeps Last.fm ordering/tiering intact while avoiding needless yt-dlp
    // startup when a later discovery candidate is already in the library.
    var bootstrap = window.RadioLocalBootstrap && window.RadioLocalBootstrap.findFirstLocalCandidate
      ? window.RadioLocalBootstrap.findFirstLocalCandidate(session.candidateBacklog, window.LocalTrackMatcher.matchLocalTrack, state.musicFiles, { unplayableFilePaths: libraryMissingFilePaths })
      : null;
    if (bootstrap) {
      session.candidateBacklog.splice(bootstrap.index, 1);
      session.radioDebug.candidatesConsumed++;
      var bootstrapTrack = await resolveRadioItemToPlaybackTrack(bootstrap.item, session);
      if (bootstrapTrack && isCurrentRadioStart(stationId)) tracks.push(bootstrapTrack);
    }
    var startupFlow = window.RadioStartupFlow && window.RadioStartupFlow.resolveInitialPlayable;
    if (!startupFlow) throw new Error('Radio startup resolver is unavailable.');
    var initial = tracks.length ? { track: null } : await startupFlow({
      maxCandidates: RADIO_FILL_CANDIDATE_LIMIT,
      nextItem: async function () {
        while (!session.candidateBacklog.length && result && !result.exhausted && batches < 3) {
          result = await provider.nextBatch(session.providerSession, { genreIds: session.genreIds.slice() }, getRadioProviderContext());
          session.providerSession = result && result.providerSession;
          session.candidateBacklog.push.apply(session.candidateBacklog, result && result.items || []);
          session.radioDebug.candidatesReceived += (result && result.items || []).length;
          batches++;
        }
        return session.candidateBacklog.shift() || null;
      },
      onConsumed: function () { session.radioDebug.candidatesConsumed++; },
      resolve: async function (item) {
        var track = await resolveRadioItemToPlaybackTrack(item, session);
        return isCurrentRadioStart(stationId) ? track : null;
      }
    });
    if (!isCurrentRadioStart(stationId)) return;
    if (initial.track) tracks.push(initial.track);
    var shouldDisposeUnplayable = window.RadioQueueHelpers && window.RadioQueueHelpers.shouldDisposeUnplayableRadioStart
      ? window.RadioQueueHelpers.shouldDisposeUnplayableRadioStart(session.providerSession, tracks.length)
      : !tracks.length && !!session.providerSession;
    if (!tracks.length) {
      if (shouldDisposeUnplayable) disposeRadioProviderSession(provider, session.providerSession);
      session.providerSession = null;
      if (session.youtubeRateLimited) throw new Error('YouTube is temporarily rate limited. Local/cached radio will continue when available.');
      throw new Error('No playable tracks were found for this genre.');
    }
    // Commit the first resolved track before playback.  The remaining backlog
    // is resolved by the existing refill path after play starts.
    session.trackCount = tracks.length;
    state.playQueueTracks = tracks;
    state.currentTracks = tracks.slice();
    state.shuffleQueue = [];
    if (state.isShuffle) rebuildShuffleQueueForMode();
    state.radioSession = session;
    session.starting = false;
    if (pendingRadioStartSession === session) pendingRadioStartSession = null;
    if (radioUiState.startingStationId === stationId) {
      radioUiState.starting = false;
      radioUiState.startingStationId = '';
    }
    initAudioCtx();
    var first = state.isShuffle ? state.shuffleQueue[0] : tracks[0];
    if (!await playTrack(first, { preserveRadioSession: true })) throw new Error('The first radio track could not be played.');
  } catch (error) {
    if (isCurrentRadioSession(session, stationId) || isCurrentRadioStart(stationId)) {
      console.error('Could not start radio:', error);
      if (isCurrentRadioSession(session, stationId)) disposeRadioSession();
      radioUiState.error = error.message || 'Radio could not be started.';
    }
  } finally {
    radioDebug('fill-summary', { stationId: stationId, candidatesReceived: session.radioDebug.candidatesReceived, candidatesConsumed: session.radioDebug.candidatesConsumed, localMatches: session.radioDebug.localMatches, youtubeSearches: session.radioDebug.youtubeSearches, youtubeAccepted: session.radioDebug.youtubeAccepted, rejected: session.radioDebug.rejected, playableCount: tracks && tracks.length || 0, providerExhausted: !!(result && result.exhausted), reason: tracks && tracks.length ? '' : 'No playable tracks' });
    if (pendingRadioStartSession === session) pendingRadioStartSession = null;
    if (radioUiState.startingStationId === stationId) {
      radioUiState.starting = false;
      radioUiState.startingStationId = '';
    }
    renderRadioView();
  }
}

function stopRadioStation() {
  var session = state.radioSession;
  if (!session) {
    cancelPendingRadioStart();
    if (state.currentView === 'radio') renderRadioView();
    return;
  }
  var currentIsRadio = state.currentPlayingTrack && state.currentPlayingTrack.radioSessionId === session.stationId
    && (!state.currentPlaybackPreservesQueueCursors || state.currentRadioHistoryPlayback);
  disposeRadioSession();
  state.playQueueTracks = state.playQueueTracks.filter(function (track) { return track.radioSessionId !== session.stationId; });
  state.shuffleQueue = state.shuffleQueue.filter(function (track) { return track.radioSessionId !== session.stationId; });
  state.currentTracks = state.currentTracks.filter(function (track) { return track.radioSessionId !== session.stationId; });
  if (state.playQueueCursor && state.playQueueCursor.radioSessionId === session.stationId) state.playQueueCursor = null;
  if (state.shuffleQueueCursor && state.shuffleQueueCursor.radioSessionId === session.stationId) state.shuffleQueueCursor = null;
  if (currentIsRadio) {
    stopPlaybackState({ resetPosition: true });
    state.currentPlayingTrack = null;
    state.sourcePlaylistId = null;
    state.currentPlaybackPreservesQueueCursors = false;
    state.currentRadioHistoryPlayback = false;
  }
  syncSavedQueuePaths(); saveSettingsDebounced(300); renderRadioView();
}
function setDisclosureState(panel, trigger, open) {
  var restoreTriggerFocus = !!(panel && !open && panel.contains(document.activeElement));
  if (panel) {
    panel.classList.toggle('open', !!open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    panel.inert = !open;
  }
  if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (restoreTriggerFocus && trigger) trigger.focus();
}
function setQueueOpen(open) {
  isQueueOpen = !!open;
  if (isQueueOpen && lyricsOpen) setLyricsOpen(false);
  if (isQueueOpen) queueRenderLimit = 250;
  var trigger = $('btn-queue-toggle');
  setDisclosureState($('queue-panel'), trigger, isQueueOpen);
  if (trigger) trigger.style.color = isQueueOpen ? 'var(--accent)' : '';
  if (isQueueOpen) renderQueue();
}
function toggleQueue() { setQueueOpen(!isQueueOpen); }

// A remote Radio queue entry persists only a stable YouTube video ID.  Build
// the thumbnail from that ID instead of carrying an arbitrary remote URL.
function getTrackArtworkUrl(track) {
  if (!track) return '';
  if (track.matchedFile && typeof track.matchedFile.picture === 'string' && track.matchedFile.picture) return track.matchedFile.picture;
  if (isRemotePlaybackTrack(track)) return 'https://i.ytimg.com/vi/' + track.playback.videoId + '/hqdefault.jpg';
  return '';
}
function isLastfmRadioTrack(track) {
  return !!(track && state.radioSession && track.radioSessionId === state.radioSession.stationId && state.radioSession.providerId === 'lastfm');
}
function makeQueueActionMarkup(track, includeRemove, removeIndex) {
  var actions = '<button type="button" class="icon-btn ghost btn-add-queue-playlist" aria-label="Add to playlist" title="Add to playlist"><i class="ph ph-plus" aria-hidden="true"></i></button>';
  if (isLastfmRadioTrack(track)) actions += '<button type="button" class="icon-btn ghost btn-more-like-queue" aria-label="More Like This" title="More Like This"><i class="ph ph-sparkle" aria-hidden="true"></i></button>';
  if (track && (track.sourceRadio || isLastfmRadioTrack(track))) {
    actions += '<button type="button" class="icon-btn ghost btn-block-radio-track" aria-label="Never play ' + esc(track.title || 'track') + ' on Radio" title="Never play this track"><i class="ph ph-prohibit" aria-hidden="true"></i></button>';
    actions += '<button type="button" class="icon-btn ghost btn-block-radio-artist" aria-label="Never play ' + esc(track.artist || 'artist') + ' on Radio" title="Never play this artist"><i class="ph ph-user-minus" aria-hidden="true"></i></button>';
  }
  if (includeRemove) actions += '<button type="button" class="icon-btn ghost btn-remove-queue" aria-label="Remove ' + esc(track.title || 'track') + ' from queue" data-idx="' + removeIndex + '"><i class="ph ph-x" aria-hidden="true"></i></button>';
  return '<span class="queue-row-actions">' + actions + '</span>';
}
function bindQueueActionHandlers(row, track) {
  var addButton = row.querySelector('.btn-add-queue-playlist');
  if (addButton) addButton.addEventListener('click', function (event) { event.stopPropagation(); showAddToPlaylistModal([track]); });
  var moreButton = row.querySelector('.btn-more-like-queue');
  if (moreButton) moreButton.addEventListener('click', function (event) { event.stopPropagation(); setMoreLikeThis(track); });
  var blockTrackButton = row.querySelector('.btn-block-radio-track');
  if (blockTrackButton) blockTrackButton.addEventListener('click', function (event) { event.stopPropagation(); blockRadioTrack(track); });
  var blockArtistButton = row.querySelector('.btn-block-radio-artist');
  if (blockArtistButton) blockArtistButton.addEventListener('click', function (event) { event.stopPropagation(); blockRadioArtist(track); });
}

// Queue: Now Playing + Next Up sections
function renderQueue(options) {
  options = options || {};
  var ql = options.target || $('queue-list'); if (!ql) return;
  var preservedScrollTop = options.preserveScroll ? ql.scrollTop : 0;
  ql.innerHTML = '';
  var allTracks = state.isShuffle ? state.shuffleQueue : state.playQueueTracks.filter(function (t) { return !t.isDisabled; });
  var curIdx = getPlaybackSequenceCursorIndex(allTracks);
  var cur = state.currentPlayingTrack;
  var dragIndex = -1;
  var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
  function makePic(track) { var artwork = getTrackArtworkUrl(track); var label = track && (track.album || track.title) || 'track'; return artwork ? '<img src="' + esc(artwork) + '" alt="Artwork for ' + esc(label) + '"' + lazy + ' style="width:36px;height:36px;border-radius:3px;object-fit:cover;flex-shrink:0;" />' : '<div style="width:36px;height:36px;background:#333;border-radius:3px;flex-shrink:0;"></div>'; }
  if (options.includeRadioPlayed && state.radioSession && (state.radioSession.playedTracks || []).length) {
    var playedHeader = document.createElement('div');
    playedHeader.style.cssText = 'padding:8px 8px 4px;font-size:10px;font-weight:700;color:var(--text-subdued);letter-spacing:0.1em;';
    playedHeader.textContent = 'PLAYED'; ql.appendChild(playedHeader);
    state.radioSession.playedTracks.forEach(function (playedTrack) {
      var playedRow = document.createElement('div'); playedRow.className = 'queue-item'; playedRow.tabIndex = 0; playedRow.setAttribute('role', 'button');
      playedRow.setAttribute('aria-label', 'Play again: ' + (playedTrack.title || 'track') + ' by ' + (playedTrack.artist || 'Unknown Artist'));
      playedRow.innerHTML = makePic(playedTrack) + '<div class="queue-item-info"><div class="queue-item-title">' + esc(playedTrack.title) + '</div><div class="queue-item-artist">' + esc(playedTrack.artist) + '</div></div><button type="button" class="icon-btn ghost btn-add-queue-playlist" aria-label="Add to playlist"><i class="ph ph-plus" aria-hidden="true"></i></button>';
      function replayPlayedTrack() { initAudioCtx(); playTrack(playedTrack, { preserveRadioSession: true, preserveQueueCursors: true, radioHistoryPlayback: true }); }
      playedRow.addEventListener('click', replayPlayedTrack);
      playedRow.querySelector('.btn-add-queue-playlist').addEventListener('click', function (event) { event.stopPropagation(); showAddToPlaylistModal([playedTrack]); });
      playedRow.addEventListener('keydown', function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); replayPlayedTrack(); } });
      ql.appendChild(playedRow);
    });
  }
  if (cur) {
    var h1 = document.createElement('div');
    h1.style.cssText = 'padding:8px 8px 4px;font-size:10px;font-weight:700;color:var(--text-subdued);letter-spacing:0.1em;';
    h1.textContent = 'NOW PLAYING'; ql.appendChild(h1);
    var npDiv = document.createElement('div'); npDiv.className = 'queue-item playing';
    npDiv.innerHTML = makePic(cur) + '<div class="queue-item-info"><div class="queue-item-title">' + esc(cur.title) + '</div><div class="queue-item-artist">' + esc(cur.artist) + '</div></div>' + makeQueueActionMarkup(cur, false, -1);
    bindQueueActionHandlers(npDiv, cur);
    ql.appendChild(npDiv);
  }
  var nextTracks = curIdx >= 0 ? allTracks.slice(curIdx + 1) : allTracks;
  var combinedQueue = (state.userQueue || []).concat(nextTracks);
  if (combinedQueue.length > 0) {
    var h2 = document.createElement('div');
    h2.style.cssText = 'padding:12px 8px 4px;font-size:10px;font-weight:700;color:var(--text-subdued);letter-spacing:0.1em;';
    h2.textContent = 'NEXT UP'; ql.appendChild(h2);

    var nextUpContainer = document.createElement('div');
    nextUpContainer.id = ql.id + '-next-up-list';
    nextUpContainer.className = 'queue-next-up-list';
    function reorderCombinedQueue(fromIndex, toIndex) {
      if (fromIndex < 0 || toIndex < 0 || fromIndex >= combinedQueue.length || toIndex >= combinedQueue.length || fromIndex === toIndex) return;
      var userQueueLength = (state.userQueue || []).length;
      var movedItem = combinedQueue.splice(fromIndex, 1)[0];
      combinedQueue.splice(toIndex, 0, movedItem);
      state.userQueue = combinedQueue.slice(0, userQueueLength);
      var nextUpQueue = combinedQueue.slice(userQueueLength);
      if (state.isShuffle) {
        var previousShuffleTracks = curIdx >= 0 ? state.shuffleQueue.slice(0, curIdx + 1) : [];
        state.shuffleQueue = previousShuffleTracks.concat(nextUpQueue);
      } else {
        var allNonDisabled = state.playQueueTracks.filter(function (t) { return !t.isDisabled; });
        var previousTracks = curIdx >= 0 ? allNonDisabled.slice(0, curIdx + 1) : [];
        state.playQueueTracks = previousTracks.concat(nextUpQueue);
      }
      syncSavedQueuePaths();
      saveSettingsDebounced(300);
      renderQueue(); if (isFullscreenQueueOpen()) renderFullscreenQueue();
      requestAnimationFrame(function () {
        var currentList = $(ql.id + '-next-up-list');
        var movedRow = currentList && currentList.querySelector('[data-queue-index="' + toIndex + '"]');
        if (movedRow) movedRow.focus();
      });
    }

    combinedQueue.slice(0, queueRenderLimit).forEach(function (track, i) {
      var isUserQueue = i < (state.userQueue || []).length;
      var isRadioContinuation = !isUserQueue && !!(track && (track.radioSessionId || track.sourceRadio));
      var queueSourceLabel = isUserQueue ? 'Manual Up Next' : (isRadioContinuation ? 'Radio continuation' : 'Queue');
      var sourceBadge = (isUserQueue || isRadioContinuation) ? '<span class="queue-source-badge" aria-hidden="true">' + (isUserQueue ? 'Manual' : 'Radio') + '</span>' : '';
      var div = document.createElement('div'); div.className = 'queue-item' + (isUserQueue ? ' queue-item-manual' : '') + (isRadioContinuation ? ' queue-item-radio' : '');
      div.draggable = !options.readOnly;
      div.dataset.queueIndex = String(i);
      div.tabIndex = 0;
      div.setAttribute('role', 'button');
      div.setAttribute('aria-label', queueSourceLabel + ': play ' + (track.title || 'track') + ' by ' + (track.artist || 'Unknown Artist') + (options.readOnly ? '.' : '. Use Alt plus Up or Down to reorder.'));
      div.innerHTML = makePic(track) + '<div class="queue-item-info"><div class="queue-item-title">' + esc(track.title) + sourceBadge + '</div><div class="queue-item-artist">' + esc(track.artist) + '</div></div>' + makeQueueActionMarkup(track, isUserQueue, i);
      if (!options.readOnly) div.addEventListener('dragstart', function (e) { queueDragInProgress = true; dragIndex = i; div.style.opacity = '0.5'; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
      if (!options.readOnly) div.addEventListener('dragend', function () { queueDragInProgress = false; dragIndex = -1; div.style.opacity = ''; div.classList.remove('drag-over'); scheduleQueueRefresh(); });
      if (!options.readOnly) div.addEventListener('dragover', function (e) { e.preventDefault(); if (dragIndex !== -1 && dragIndex !== i) div.classList.add('drag-over'); });
      if (!options.readOnly) div.addEventListener('dragleave', function () { div.classList.remove('drag-over'); });
      if (!options.readOnly) div.addEventListener('drop', function (e) {
        e.preventDefault();
        div.classList.remove('drag-over');
        if (dragIndex === -1 || dragIndex === i) return;
        reorderCombinedQueue(dragIndex, i);
      });
      div.addEventListener('click', function (e) {
        if (e.target.closest && e.target.closest('.btn-more-like-queue')) {
          e.stopPropagation(); setMoreLikeThis(track);
        } else if (e.target.closest && e.target.closest('.btn-block-radio-track')) {
          e.stopPropagation(); blockRadioTrack(track);
        } else if (e.target.closest && e.target.closest('.btn-block-radio-artist')) {
          e.stopPropagation(); blockRadioArtist(track);
        } else if (e.target.closest && e.target.closest('.btn-remove-queue')) {
          e.stopPropagation();
          state.userQueue.splice(i, 1);
          syncSavedQueuePaths();
          saveSettingsDebounced(300);
          renderQueue();
          if (isFullscreenQueueOpen()) renderFullscreenQueue();
        } else if (e.target.closest && e.target.closest('.btn-add-queue-playlist')) {
          e.stopPropagation(); showAddToPlaylistModal([track]);
        } else if (!e.target.classList.contains('drag-handle')) {
          initAudioCtx();
          playTrack(track, { preserveRadioSession: isUserQueue, preserveQueueCursors: isUserQueue, selectedQueueTrack: true }).then(function (started) {
            if (!started || !isUserQueue) return;
            var queuedIndex = state.userQueue[i] === track ? i : state.userQueue.indexOf(track);
            if (queuedIndex !== -1) state.userQueue.splice(queuedIndex, 1);
            syncSavedQueuePaths();
            saveSettingsDebounced(300);
            if (isQueueOpen) renderQueue();
            if (isFullscreenQueueOpen()) renderFullscreenQueue();
          });
        }
      });
      div.addEventListener('keydown', function (e) {
        if (e.target !== div) return;
        if (!options.readOnly && e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) { e.preventDefault(); reorderCombinedQueue(i, i + (e.key === 'ArrowUp' ? -1 : 1)); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); div.click(); }
      });
      nextUpContainer.appendChild(div);
    });
    ql.appendChild(nextUpContainer);
    if (combinedQueue.length > queueRenderLimit) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn btn-outline';
      more.style.cssText = 'width:calc(100% - 16px);margin:8px;';
      more.textContent = 'Show ' + Math.min(250, combinedQueue.length - queueRenderLimit) + ' more';
      more.addEventListener('click', function () { queueRenderLimit += 250; renderQueue(); if (isFullscreenQueueOpen()) renderFullscreenQueue(); });
      ql.appendChild(more);
    }
  }
  if (!cur && combinedQueue.length === 0) { ql.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-subdued);font-size:13px;">Queue is empty</div>'; }
  if (options.preserveScroll) ql.scrollTop = Math.min(preservedScrollTop, ql.scrollHeight);
}

function renderFullscreenQueue(options) {
  var target = $('np-queue-content');
  if (target) renderQueue(Object.assign({}, options || {}, { target: target, readOnly: true, includeRadioPlayed: true }));
}

// FIX 7: switchView always pushes to nav history, including album detail
function switchView(viewId, addToHistory) {
  if (addToHistory === undefined) addToHistory = true;
  if (viewId === 'playlists_fullscreen') viewId = 'playlists';
  if (viewId !== state.currentView) clearTrackSelection();

  var ca = $('content-area');
  if (state.currentView === 'library' && viewId !== 'library') {
    state.libraryScrollPos = ca ? ca.scrollTop : 0;
  }

  state.currentView = viewId;
  var gs = $('global-search'); if (gs && viewId !== 'search') gs.value = '';
  // FIX 5: scroll reset on every view change
  if (ca) ca.scrollTop = 0;
  document.querySelectorAll('.nav-item').forEach(function (el) { el.classList.remove('active'); el.removeAttribute('aria-current'); });
  document.querySelectorAll('.playlist-item').forEach(function (el) { el.classList.remove('active'); el.removeAttribute('aria-current'); });
  hideAllViewRoots();
  var hdc = $('home-dashboard-container');
  var sac = $('search-albums-container');
  var pcontainer = $('playlists-grid-container'); if (pcontainer) pcontainer.style.display = 'none';
  var radioContainer = $('radio-container'); if (radioContainer) radioContainer.style.display = 'none';
  var sc = $('stats-container');
  var mhc = $('metadata-health-container');
  var lsc = $('library-sort-controls');
  if (addToHistory) pushNav(viewId);
  $('view-title').style.display = 'block';
  if (viewId === 'library') {
    setViewKind('library');
    $('view-title').textContent = 'Library';
    $('nav-library').classList.add('active');
    $('nav-library').setAttribute('aria-current', 'page');
    $('zoom-controls').style.display = 'flex';
    renderLibrary();
    if (state.libraryScrollPos && ca) {
      setTimeout(function () { ca.scrollTop = state.libraryScrollPos; }, 50);
    }
  } else if (viewId === 'playlists') {
    setViewKind('playlists');
    $('view-title').style.display = 'none';
    var navPlaylists = $('nav-playlists'); if (navPlaylists) { navPlaylists.classList.add('active'); navPlaylists.setAttribute('aria-current', 'page'); }
    if (pcontainer) pcontainer.style.display = 'block';
    renderSidebarPlaylists();
  } else if (viewId === 'radio') {
    setViewKind('radio');
    $('view-title').style.display = 'none';
    var navRadio = $('nav-radio'); if (navRadio) { navRadio.classList.add('active'); navRadio.setAttribute('aria-current', 'page'); }
    if (radioContainer) radioContainer.style.display = 'block';
    renderRadioView();
    loadRadioGenres();
  } else if (viewId === 'home') {
    setViewKind('home');
    $('view-title').textContent = 'Home';
    $('nav-home').classList.add('active');
    $('nav-home').setAttribute('aria-current', 'page');
    $('view-title').style.display = 'none'; // hide generic title
    $('albums-grid-container').style.display = 'none';
    $('tracks-table-container').style.display = 'none';

    var hdc = $('home-dashboard-container');
    if (hdc) {
      hdc.style.display = 'block';
      renderHomeDashboard();
    }
  } else if (viewId === 'metadata_health') {
    setViewKind('health');
    $('view-title').textContent = 'Tag Health';
    var navHealth = $('nav-health'); if (navHealth) { navHealth.classList.add('active'); navHealth.setAttribute('aria-current', 'page'); }
    if (mhc) { mhc.style.display = 'block'; renderMetadataHealthView(); }
  } else if (viewId === 'stats') {
    setViewKind('stats');
    $('view-title').style.display = 'none';
    var navStats = $('nav-stats'); if (navStats) { navStats.classList.add('active'); navStats.setAttribute('aria-current', 'page'); }
    renderStatsView();
  } else if (viewId === 'search') {
    setViewKind('search');
    $('view-title').textContent = 'Search Results';
    $('view-title').style.display = 'none';
    if (gs && gs.value) {
      // Re-trigger the input event so that search renders results
      gs.dispatchEvent(new Event('input'));
    }
  } else if (getSmartPlaylistById(viewId)) {
    setViewKind('playlist');
    var smartNav = $('nav-playlists'); if (smartNav) { smartNav.classList.add('active'); smartNav.setAttribute('aria-current', 'page'); }
    openSmartPlaylist(getSmartPlaylistById(viewId));
  } else {
    setViewKind('playlist');
    $('tracks-table-container').style.display = 'block';
    var playlistNav = $('nav-playlists'); if (playlistNav) { playlistNav.classList.add('active'); playlistNav.setAttribute('aria-current', 'page'); }
    var el = document.getElementById(viewId); if (el) { el.classList.add('active'); el.setAttribute('aria-current', 'page'); }
    renderPlaylist(viewId);
  }
  syncDockPlaylistStates();
}

function renderHomeDashboard() {
  var renderGeneration = ++homeRenderGeneration;
  var emptyState = $('home-empty-library');
  var libraryContent = $('home-library-content');
  var isEmptyLibrary = state.musicFiles.length === 0;
  if (emptyState) emptyState.hidden = !isEmptyLibrary;
  if (libraryContent) libraryContent.hidden = isEmptyLibrary;
  var recGrid = $('home-recommendations');
  var recEmpty = $('home-recommendations-empty');
  var lfTxt = $('lastfm-status-text');
  if (isEmptyLibrary) {
    if (recGrid) recGrid.replaceChildren();
    if (lfTxt) lfTxt.textContent = 'Available after import';
    return;
  }

  // Helper to create album card
  function addAlbumCard(album, gridEl) {
    var card = document.createElement('article'); card.className = 'album-card' + (isAlbumActive(album) ? ' playing' : ''); card.dataset.albumKey = album.id || '';
    var active = isAlbumActive(album);
    var playBtnIcon = active && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
    var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
    var cov = album.cover ? '<img src="' + esc(album.cover) + '" alt=""' + lazy + ' />' : '<i class="ph ph-music-notes" aria-hidden="true"></i>';
    card.innerHTML = '<div class="album-card-img-wrapper" style="position:relative;">' + cov + '<button type="button" class="album-card-play-btn" aria-label="Play ' + esc(album.name) + '" data-album="' + encodeURIComponent(album.name) + '"><i class="' + playBtnIcon + '" aria-hidden="true"></i></button></div><button type="button" class="album-card-open" aria-label="Open ' + esc(album.name) + ' by ' + esc(album.artist || 'Unknown Artist') + '"><span class="album-card-info"><span class="album-card-title" title="' + esc(album.name) + '">' + esc(album.name) + '</span><span class="album-card-artist">' + esc(album.artist) + '</span></span></button>';
    // Set blurred bg for non-square covers
    if (album.cover) {
      var wrapper = card.querySelector('.album-card-img-wrapper');
      if (wrapper) wrapper.style.setProperty('--cover-bg', 'url("' + album.cover.replace(/"/g, '\\"') + '")');
    }
    
    card.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      window.currentContextMenuAlbum = album;
      positionContextMenu($('album-context-menu'), e.clientX, e.clientY, card);
    });
    card.querySelector('.album-card-play-btn').addEventListener('click', function (e) {
      e.stopPropagation(); initAudioCtx();
      if (isAlbumActive(album)) { togglePlay(); var icon = e.currentTarget.querySelector('i'); if (icon) icon.className = state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play'; return; }
      state.playQueueTracks = getSortedAlbumTracks(album).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
      state.shuffleQueue = []; if (state.isShuffle) rebuildShuffleQueueForMode();
      playTrack(state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks[0]);
    });
    card.addEventListener('click', function () { pushNav('album:' + album.id); renderAlbumDetail(album); });
    card.querySelector('.album-card-open').addEventListener('keydown', function (e) {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); window.currentContextMenuAlbum = album; positionContextMenu($('album-context-menu'), 0, 0, card); }
    });
    gridEl.appendChild(card);
  }

  var albumList = getLibraryIndex().albums;

  // ── Compact Stats Bar ──
  var statsBar = $('home-stats-bar');
  if (statsBar) {
    var listeningEntries2 = getListeningStatEntries();
    var totalPlays2 = listeningEntries2.reduce(function(sum, entry) { return sum + entry.count; }, 0);
    var totalSecs2 = listeningEntries2.reduce(function(sum, entry) { return sum + entry.time; }, 0);
    var totalHrs2 = Math.floor(totalSecs2/3600);
    var totalMins2 = Math.floor((totalSecs2%3600)/60);
    var uniqueTracks2 = listeningEntries2.length;
    var statItems = [
      { icon: 'ph-play', val: totalPlays2 || '—', label: 'Total plays' },
      { icon: 'ph-clock', val: totalPlays2 ? (totalHrs2 + 'h ' + totalMins2 + 'm') : '—', label: 'Listened' },
      { icon: 'ph-music-notes', val: uniqueTracks2 || '—', label: 'Tracks played' },
      { icon: 'ph-vinyl-record', val: albumList.length, label: 'Albums' },
    ];
    statsBar.innerHTML = statItems.map(function(s) {
      return '<button type="button" class="home-stat-button" aria-label="Open listening statistics. ' + s.label + ': ' + s.val + '">' +
        '<i class="ph ' + s.icon + '" aria-hidden="true"></i>' +
        '<span class="home-stat-copy"><strong>' + s.val + '</strong><span>' + s.label + '</span></span>' +
        '<i class="ph ph-caret-right home-stat-open" aria-hidden="true"></i>' +
        '</button>';
    }).join('');
    statsBar.querySelectorAll('.home-stat-button').forEach(function (button) { button.addEventListener('click', function () { switchView('stats'); }); });
  }

  // Recently Added (by real added-at timestamp; falls back to insertion order for old entries)
  var gridRecent = $('home-recently-added');
  if (gridRecent) {
    gridRecent.innerHTML = '';
    var recent = albumList.map(function (album, index) { return { album: album, addedAt: getAlbumAddedAt(album), index: index }; });
    recent.sort(function (a, b) { return b.addedAt - a.addedAt || b.index - a.index; });
    recent.slice(0, 6).forEach(function(entry) { addAlbumCard(entry.album, gridRecent); });
  }

  // Most Played (For now, sort by track count as proxy)
  var gridMost = $('home-most-played');
  if (gridMost) {
    gridMost.innerHTML = '';
    var listeningCounts = new Map(getListeningStatEntries().map(function (entry) { return [entry.key, entry.count]; }));
    var mostPlayed = albumList.map(function (album) {
      return { album: album, count: album.tracks.reduce(function (sum, track) { return sum + (listeningCounts.get(getListeningStatIdentity(track)) || 0); }, 0) };
    }).sort(function(a, b) { return b.count - a.count || b.album.tracks.length - a.album.tracks.length; });
    if (mostPlayed.some(function (entry) { return entry.count > 0; })) {
      mostPlayed.filter(function (entry) { return entry.count > 0; }).slice(0, 6).forEach(function(entry) { addAlbumCard(entry.album, gridMost); });
    } else {
      gridMost.innerHTML = '<div class="home-shelf-empty"><i class="ph ph-waveform" aria-hidden="true"></i><span>Play a few tracks to build your listening history.</span></div>';
    }
  }

  // Discover / Random Albums
  var gridRandom = $('home-random-albums');
  if (gridRandom) {
    gridRandom.innerHTML = '';
    var randoms = albumList.slice();
    for (var randomIndex = 0; randomIndex < Math.min(6, randoms.length); randomIndex++) {
      var swapIndex = randomIndex + Math.floor(Math.random() * (randoms.length - randomIndex));
      var swapAlbum = randoms[randomIndex]; randoms[randomIndex] = randoms[swapIndex]; randoms[swapIndex] = swapAlbum;
    }
    randoms = randoms.slice(0, 6);
    randoms.forEach(function(a) { addAlbumCard(a, gridRandom); });
  }

  var btnRefRandom = $('btn-refresh-random-albums');
  if (btnRefRandom) btnRefRandom.onclick = function() { renderHomeDashboard(); };

  // Last.fm Recommendations
  var btnRefLfm = $('btn-refresh-lastfm');
  if (appSettings.lastfmConnected) {
    lfTxt.textContent = 'Connected as ' + appSettings.lastfmUsername;
    recEmpty.style.display = 'none';
    if (btnRefLfm) {
      btnRefLfm.style.display = 'flex';
      btnRefLfm.onclick = function() { state.lastfmRecsCache = null; renderHomeDashboard(); };
    }

    function renderRecs(recs) {
      recGrid.innerHTML = '';
      if (!recs || recs.length === 0) {
        recGrid.innerHTML = '<div class="home-recommendations-empty home-recommendations-inline">No recommendations found yet. Listen to more tracks to help Last.fm learn your taste.</div>';
      } else {
        recs.forEach(function (r) {
          var card = document.createElement('button'); card.type = 'button'; card.className = 'album-card recommendation-card';
          card.setAttribute('aria-label', 'Search YouTube for ' + r.artist + ' ' + r.name);
          var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
          var cov = r.image ? '<img src="' + esc(r.image) + '" alt=""' + lazy + '/>' : '<i class="ph ph-music-notes" aria-hidden="true"></i>';
          card.innerHTML = '<div class="album-card-img-wrapper">' + cov + '</div><div class="album-card-info"><div class="album-card-title" title="' + esc(r.name) + '">' + esc(r.name) + '</div><div class="album-card-artist">' + esc(r.artist) + '</div></div>';
          card.addEventListener('click', function () {
            window.api.openExternal('https://www.youtube.com/results?search_query=' + encodeURIComponent(r.artist + ' ' + r.name));
          });
          recGrid.appendChild(card);
        });
      }
    }

    if (state.lastfmRecsCache && state.lastfmRecsCacheTime && (Date.now() - state.lastfmRecsCacheTime < 3600000)) {
      renderRecs(state.lastfmRecsCache);
    } else {
      recGrid.innerHTML = '<div class="home-recommendations-state"><i class="ph ph-spinner ph-spin" aria-hidden="true"></i><p>Fetching personalized recommendations...</p></div>';
      window.api.getLastfmRecommendations().then(function (recs) {
        if (renderGeneration !== homeRenderGeneration || state.currentView !== 'home' || !state.musicFiles.length || !appSettings.lastfmConnected) return;
        state.lastfmRecsCache = recs;
        state.lastfmRecsCacheTime = Date.now();
        renderRecs(recs);
      }).catch(function (err) {
        if (renderGeneration !== homeRenderGeneration || state.currentView !== 'home' || !state.musicFiles.length) return;
        recGrid.innerHTML = '<div class="home-recommendations-state error">Recommendations could not be loaded. Try refreshing this section.</div>';
      });
    }
  } else {
    lfTxt.textContent = 'Not connected';
    recEmpty.style.display = 'grid';
    recGrid.innerHTML = '';
    if (btnRefLfm) btnRefLfm.style.display = 'none';
  }
}

// FIX 1+2+3: Sidebar playlist render - grid fix, pin/lastPlayed separate, auto cover

function renderSidebarPlaylists() {
  var list = $('playlists-list'); if (!list) return; list.innerHTML = '';
  if (state.currentView === 'playlists') renderSmartPlaylistsGrid();
  var recentCovers = new Map();
  var libIndex = getLibraryIndex();
  var titleArtistMap = new Map();
  var titleArtistAlbumMap = new Map();
  var filenameMap = new Map();
  state.musicFiles.forEach(function (file) {
    var titleKey = normalize(file.title) + '::' + normalize(file.artist);
    var albumKey = titleKey + '::' + normalize(file.album);
    var filenameKey = normalize(file.filename ? file.filename.replace(/\.[^.]+$/, '') : '');
    if (titleKey && !titleArtistMap.has(titleKey)) titleArtistMap.set(titleKey, file);
    if (albumKey && !titleArtistAlbumMap.has(albumKey)) titleArtistAlbumMap.set(albumKey, file);
    if (filenameKey && !filenameMap.has(filenameKey)) filenameMap.set(filenameKey, file);
  });

  var likedSet = new Set(state.likedSongs);
  var pseudoLiked = {
    id: 'liked_songs',
    name: 'Liked Songs',
    pinned: false,
    color: 'linear-gradient(135deg, #171717, #4A4A4A)',
    isSpecial: true,
    tracks: state.musicFiles.filter(function (f) { return likedSet.has(f.filePath); }),
    lastPlayed: localStorage.getItem('likedSongsLastPlayed') || null
  };

  var pinned = state.playlists.filter(function (p) { return p.pinned; });
  var unpinned = state.playlists.filter(function (p) { return !p.pinned; });
  unpinned.push(pseudoLiked);

  unpinned.sort(function (a, b) {
    if (!a.lastPlayed && !b.lastPlayed) return 0;
    if (!a.lastPlayed) return 1; if (!b.lastPlayed) return -1;
    return new Date(b.lastPlayed) - new Date(a.lastPlayed);
  });
  var sorted = pinned.concat(unpinned);

  list.className = 'playlists-container playlists-grid';
  list.removeAttribute('style');
  if($('playlist-search')) $('playlist-search').style.display = 'block';

  sorted.forEach(function (pl) {
    var autoCover = pl.cover || null;
    if (!autoCover && !pl.isSpecial) {
      for (var i = 0; i < (pl.tracks || []).length; i++) {
        var r = pl.tracks[i];
        var sn = r.Song || r.title || '', an = r.Artist || r.artist || '', al = r.Album || r.album || '';
        var trackPath = getPlaylistTrackFilePath(r);
        var m = isM3uImportRecord(r) ? findPlaylistRecordMatch(r) : ((trackPath ? libIndex.byStrippedPath.get(stripFileUrl(trackPath)) : null) || titleArtistAlbumMap.get(normalize(sn) + '::' + normalize(an) + '::' + normalize(al)) || titleArtistMap.get(normalize(sn) + '::' + normalize(an)) || filenameMap.get(normalize(sn)) || findMatchingFile(sn, an, al, trackPath));
        if (m && m.picture) { autoCover = m.picture; break; }
      }
    }
    recentCovers.set(pl.id, autoCover);

    var el = document.createElement('button');
    el.type = 'button';
    var isActive = state.currentView === pl.id;
    var isPlayingSource = state.sourcePlaylistId === pl.id;
    el.className = 'playlist-item playlist-card' + (pl.pinned ? ' pinned' : '') + (isActive ? ' active' : '') + (isPlayingSource ? ' playing-source' : '');
    el.id = pl.id;
    if (isActive) el.setAttribute('aria-current', 'page');

    var trackCount = pl.tracks ? pl.tracks.length : 0;
    var subText = trackCount + ' tracks';

    var innerIcon = pl.isSpecial ? '<i class="ph-fill ph-heart"></i>' : '<i class="ph ph-music-notes"></i>';
    var bgStyle = pl.id === 'liked_songs' ? 'background:linear-gradient(135deg, #171717, #4A4A4A);' : 'background:' + getSafePlaylistColor(pl.color) + ';';
    var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
    var coverHtml = autoCover ? '<img class="playlist-card-cover" src="' + esc(autoCover) + '"' + lazy + ' alt="" />'
      : '<div class="playlist-card-cover playlist-card-cover-placeholder" style="' + bgStyle + '">' + innerIcon + '</div>';
    var pinHtml = pl.pinned ? '<span class="playlist-card-pin" title="Pinned"><i class="ph-fill ph-push-pin" aria-hidden="true"></i></span>' : '';
    var playingHtml = '<span class="playlist-card-playing" title="Playing from this playlist"><i class="ph ph-waveform" aria-hidden="true"></i></span>';

    el.innerHTML = '<span class="playlist-card-cover-shell">' + coverHtml + pinHtml + playingHtml + '</span><span class="playlist-card-title" title="' + esc(pl.name) + '">' + esc(pl.name) + '</span><span class="playlist-card-meta">' + subText + '</span>';

    el.addEventListener('click', function () { switchView(pl.id); });
    el.addEventListener('contextmenu', function (e) { e.preventDefault(); openPlaylistContextMenu(pl, e.clientX, e.clientY, el); });
    if (!pl.isSpecial) bindPlaylistTrackDropTarget(el, pl);
    list.appendChild(el);
  });
  var dockPinned = state.playlists.filter(function (playlist) { return playlist.pinned; });
  var dockRecent = state.playlists.filter(function (playlist) { return !playlist.pinned; }).concat(pseudoLiked).sort(function (a, b) {
    return (Date.parse(b.lastPlayed || '') || 0) - (Date.parse(a.lastPlayed || '') || 0);
  });
  var dockPlaylists = dockPinned.concat(dockRecent);
  renderRecentPlaylistDock(dockPlaylists, recentCovers);
  var playlistSearch = $('playlist-search');
  if (playlistSearch && playlistSearch.value) filterPlaylists(playlistSearch.value);
}

function getEffectiveDockMode() {
  return appSettings.dockMode === 'expanded' && window.innerWidth > 1180 ? 'expanded' : 'collapsed';
}

function applyDockMode() {
  var effectiveMode = getEffectiveDockMode();
  var changed = document.body.dataset.dockMode !== effectiveMode;
  document.body.dataset.dockMode = effectiveMode;
  var sidebar = $('sidebar');
  if (sidebar) sidebar.dataset.dockMode = effectiveMode;
  var toggle = $('dock-mode-toggle');
  if (toggle) {
    var prefersExpanded = appSettings.dockMode === 'expanded';
    var effectivelyExpanded = effectiveMode === 'expanded';
    toggle.setAttribute('aria-pressed', effectivelyExpanded ? 'true' : 'false');
    toggle.setAttribute('aria-label', effectivelyExpanded ? 'Collapse playlist dock' : 'Expand playlist dock');
    toggle.title = effectivelyExpanded ? 'Collapse playlist dock' : (prefersExpanded && window.innerWidth <= 1180 ? 'Expanded dock is saved and will return when the window is wider' : 'Expand playlist dock');
  }
  return changed;
}

function appendDockPlaylistCover(target, pl, cover) {
  var coverFrame = document.createElement('span');
  coverFrame.className = 'dock-playlist-cover';
  function showFallback() {
    coverFrame.replaceChildren();
    coverFrame.classList.add('placeholder');
    coverFrame.style.background = pl.id === 'liked_songs' ? 'linear-gradient(135deg, #171717, #4A4A4A)' : getSafePlaylistColor(pl.color);
    var fallbackIcon = document.createElement('i');
    fallbackIcon.className = pl.id === 'liked_songs' ? 'ph-fill ph-heart' : 'ph ph-playlist';
    fallbackIcon.setAttribute('aria-hidden', 'true');
    coverFrame.appendChild(fallbackIcon);
  }
  if (cover) {
    var image = document.createElement('img');
    image.src = cover;
    image.alt = '';
    if (appSettings.lazyLoading) image.loading = 'lazy';
    image.addEventListener('error', showFallback, { once: true });
    coverFrame.appendChild(image);
  } else showFallback();
  target.appendChild(coverFrame);
}

function getDockPlaylistPlaybackTracks(pl) {
  if (pl.id === 'liked_songs') {
    var byPath = getLibraryIndex().byStrippedPath;
    return state.likedSongs.map(function (record) {
      var file = typeof record === 'string' ? byPath.get(stripFileUrl(record)) : state.musicFiles.find(function (candidate) { return candidate && record && candidate && likedIdentity(candidate) === record.identity; });
      if (file) return { matchedFile: file, title: file.title, artist: file.artist, album: file.album, duration: file.duration, isDisabled: false, sourcePlaylistId: pl.id };
      return record && typeof record === 'object' && /^[A-Za-z0-9_-]{11}$/.test(record.videoId || '') ? { title: record.title, artist: record.artist, album: record.album, duration: record.duration, trackMbid: record.trackMbid, playback: { kind: 'youtube', videoId: record.videoId }, artwork: record.artwork, isDisabled: false, sourcePlaylistId: pl.id } : null;
    }).filter(Boolean);
  }
  return (pl.tracks || []).map(function (record) { return playlistRecordToPlaybackTrack(record, pl.id); });
}

function toggleDockPlaylistPlayback(pl) {
  if (state.sourcePlaylistId === pl.id && state.currentPlayingTrack) {
    initAudioCtx();
    togglePlay();
    return;
  }
  var tracks = getDockPlaylistPlaybackTracks(pl);
  var firstPlayable = tracks.find(function (track) { return !track.isDisabled; });
  if (!firstPlayable) {
    showToast('"' + (pl.name || 'This playlist') + '" has no playable tracks.');
    return;
  }
  initAudioCtx();
  state.playQueueTracks = tracks.slice();
  state.shuffleQueue = [];
  if (state.isShuffle) rebuildShuffleQueueForMode();
  playTrack(state.isShuffle ? state.shuffleQueue[0] : firstPlayable);
}

function createDockPlaylistButton(pl, covers) {
  var card = document.createElement('div');
  card.dataset.playlistId = pl.id;
  card.dataset.playlistName = pl.name;
  card.className = 'dock-recent-playlist';

  var openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'dock-playlist-open';
  openButton.setAttribute('aria-label', 'Open playlist ' + pl.name);
  appendDockPlaylistCover(openButton, pl, covers.get(pl.id));
  var label = document.createElement('span');
  label.className = 'dock-playlist-name';
  label.title = pl.name;
  var labelText = document.createElement('span');
  labelText.className = 'dock-playlist-name-text';
  labelText.textContent = pl.name;
  label.appendChild(labelText);
  openButton.appendChild(label);
  openButton.addEventListener('click', function () { switchView(pl.id); });

  var playButton = document.createElement('button');
  playButton.type = 'button';
  playButton.className = 'dock-playlist-play';
  playButton.setAttribute('aria-label', 'Play ' + pl.name);
  playButton.innerHTML = '<i class="ph-fill ph-play" aria-hidden="true"></i>';
  playButton.addEventListener('click', function (event) {
    event.stopPropagation();
    toggleDockPlaylistPlayback(pl);
  });

  card.append(openButton, playButton);
  card.addEventListener('contextmenu', function (event) { event.preventDefault(); openPlaylistContextMenu(pl, event.clientX, event.clientY, card); });
  if (!pl.isSpecial) bindPlaylistTrackDropTarget(card, pl);
  return card;
}

function appendExpandedDockSection(dock, label, playlists, covers) {
  if (!playlists.length) return;
  var section = document.createElement('section');
  section.className = 'dock-playlist-section';
  var heading = document.createElement('span');
  heading.className = 'dock-playlist-section-label';
  heading.textContent = label;
  section.appendChild(heading);
  var grid = document.createElement('div');
  grid.className = 'dock-playlist-grid';
  playlists.forEach(function (playlist) {
    var card = createDockPlaylistButton(playlist, covers);
    grid.appendChild(card);
  });
  section.appendChild(grid);
  dock.appendChild(section);
}

function renderRecentPlaylistDock(playlists, covers) {
  var dock = $('dock-recent-playlists');
  if (!dock) return;
  applyDockMode();
  dock.classList.remove('dock-capacity-ready');
  dock.replaceChildren();
  dock.hidden = !playlists.length;
  if (document.body.dataset.dockMode === 'expanded') {
    dock.setAttribute('aria-label', 'Pinned and recent playlists');
    var pinned = playlists.filter(function (playlist) { return playlist.pinned; });
    var remaining = playlists.filter(function (playlist) { return !playlist.pinned; }).sort(function (a, b) {
      return (Date.parse(b.lastPlayed || '') || 0) - (Date.parse(a.lastPlayed || '') || 0);
    });
    appendExpandedDockSection(dock, 'Pinned', pinned, covers);
    appendExpandedDockSection(dock, 'Recent playlists', remaining, covers);
  } else {
    dock.setAttribute('aria-label', 'Playlists, recent first');
    playlists.forEach(function (playlist) { dock.appendChild(createDockPlaylistButton(playlist, covers)); });
  }
  syncDockPlaylistStates();
  observeRecentPlaylistDock();
  scheduleRecentPlaylistDockCapacityUpdate();
}

function updateDockPlayingNameOverflow() {
  document.querySelectorAll('.dock-recent-playlist.playing-name-overflow').forEach(function (card) {
    card.classList.remove('playing-name-overflow');
    var previousName = card.querySelector('.dock-playlist-name');
    if (previousName) previousName.style.removeProperty('--dock-name-overflow');
  });
}

function syncDockPlaylistStates() {
  document.querySelectorAll('.dock-recent-playlist[data-playlist-id]').forEach(function (card) {
    var viewed = card.dataset.playlistId === state.currentView;
    var playingSource = card.dataset.playlistId === state.sourcePlaylistId;
    var playlistName = card.dataset.playlistName || '';
    var openButton = card.querySelector('.dock-playlist-open');
    var playButton = card.querySelector('.dock-playlist-play');
    card.classList.toggle('viewed', viewed);
    card.classList.toggle('playing-source', playingSource);
    if (openButton) {
      if (viewed) openButton.setAttribute('aria-current', 'page');
      else openButton.removeAttribute('aria-current');
      openButton.setAttribute('aria-label', 'Open playlist ' + playlistName + (viewed ? '. Currently viewed.' : '') + (playingSource ? '. Current playback source.' : ''));
    }
    if (playButton) {
      var isActivePlayback = playingSource && !!state.currentPlayingTrack;
      var isPlaying = isActivePlayback && state.isPlaying;
      playButton.setAttribute('aria-label', (isPlaying ? 'Pause ' : 'Play ') + playlistName);
      playButton.title = isPlaying ? 'Pause' : 'Play';
      var icon = playButton.querySelector('i');
      if (icon) icon.className = isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
    }
  });
  updateDockPlayingNameOverflow();
}

function scheduleRecentPlaylistDockCapacityUpdate() {
  if (recentPlaylistDockCapacityFrame !== null) cancelAnimationFrame(recentPlaylistDockCapacityFrame);
  recentPlaylistDockCapacityFrame = requestAnimationFrame(function () {
    recentPlaylistDockCapacityFrame = null;
    updateRecentPlaylistDockCapacity();
    updateDockPlayingNameOverflow();
  });
}

function observeRecentPlaylistDock() {
  var dock = $('dock-recent-playlists');
  if (!dock || recentPlaylistDockResizeObserver || typeof ResizeObserver === 'undefined') return;
  recentPlaylistDockResizeObserver = new ResizeObserver(scheduleRecentPlaylistDockCapacityUpdate);
  recentPlaylistDockResizeObserver.observe(dock);
  window.addEventListener('resize', function () {
    if (applyDockMode()) renderSidebarPlaylists();
    else { scheduleRecentPlaylistDockCapacityUpdate(); updateDockPlayingNameOverflow(); }
  });
}

function updateRecentPlaylistDockCapacity() {
  var dock = $('dock-recent-playlists');
  if (!dock) return;
  var buttons = Array.from(dock.querySelectorAll('.dock-recent-playlist'));
  buttons.forEach(function (button) { button.classList.remove('dock-capacity-hidden'); });
  if (dock.hidden || document.body.dataset.dockMode === 'expanded' || window.innerWidth <= 760 || !buttons.length) {
    dock.classList.add('dock-capacity-ready');
    return;
  }
  var styles = getComputedStyle(dock);
  var padding = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
  var gap = parseFloat(styles.rowGap || styles.gap) || 0;
  var buttonHeight = buttons[0].offsetHeight || 36;
  var availableHeight = Math.max(0, dock.clientHeight - padding);
  var capacity = Math.max(0, Math.floor((availableHeight + gap) / (buttonHeight + gap)));
  var visible = new Set(buttons.slice(0, capacity));
  var priorityButtons = buttons.filter(function (button) { return button.classList.contains('viewed') || button.classList.contains('playing-source'); });
  priorityButtons.slice(0, capacity).forEach(function (priorityButton) {
    if (visible.has(priorityButton)) return;
    var replacement = Array.from(visible).reverse().find(function (button) { return !priorityButtons.includes(button); });
    if (replacement) visible.delete(replacement);
    if (visible.size < capacity) visible.add(priorityButton);
  });
  buttons.forEach(function (button) { button.classList.toggle('dock-capacity-hidden', !visible.has(button)); });
  dock.classList.add('dock-capacity-ready');
}

// FIX 9: playlist search - filters on name, case-insensitive, works for both list/grid
function filterPlaylists(q) {
  var query = String(q || '').trim().toLowerCase();
  var visibleRegular = 0;
  document.querySelectorAll('#playlists-list .playlist-item').forEach(function (el) {
    var nameEl = el.querySelector('.playlist-card-title');
    var txt = nameEl ? nameEl.textContent.toLowerCase() : el.textContent.toLowerCase();
    var visible = txt.includes(query);
    el.style.display = visible ? '' : 'none';
    if (visible) visibleRegular++;
  });
  var visibleSmart = 0;
  document.querySelectorAll('#smart-mixes-list .smart-mix-card').forEach(function (el) {
    var visible = String(el.dataset.searchText || el.textContent || '').toLowerCase().includes(query);
    el.style.display = visible ? '' : 'none';
    if (visible) visibleSmart++;
  });
  var smartSection = $('smart-mixes-section'); if (smartSection) smartSection.hidden = visibleSmart === 0;
  var regularSection = $('regular-playlists-section'); if (regularSection) regularSection.hidden = visibleRegular === 0;
  var empty = $('playlist-search-empty'); if (empty) empty.hidden = visibleSmart + visibleRegular > 0;
}

// FIX 6: album play button state - track which album is active
function isAlbumActive(album) {
  return state.currentPlayingTrack && state.currentPlayingTrack.matchedFile &&
    album.tracks.some(function (t) { return t.filePath === state.currentPlayingTrack.matchedFile.filePath; });
}

function setTagHealthProgress(active, label, current, total, summary) {
  tagHealthProgress = {
    active: !!active,
    label: label || '',
    current: Number(current || 0),
    total: Number(total || 0),
    summary: summary || ''
  };
  updateTagHealthProgressUi();
}
function getTagHealthProgressPercent() {
  var total = tagHealthProgress.total || 0;
  return total ? Math.max(0, Math.min(100, Math.round((tagHealthProgress.current / total) * 100))) : 0;
}
function getTagHealthProgressText() {
  var pct = getTagHealthProgressPercent();
  if (tagHealthProgress.active) return (tagHealthProgress.label || 'Working') + ' ' + tagHealthProgress.current + '/' + tagHealthProgress.total + (tagHealthProgress.total ? ' (' + pct + '%)' : '');
  return tagHealthProgress.summary || '';
}
function renderTagHealthProgressHtml() {
  var pct = getTagHealthProgressPercent();
  var text = getTagHealthProgressText();
  var hidden = !tagHealthProgress.active && !tagHealthProgress.summary ? ' hidden' : '';
  return '<div class="tag-health-progress" id="tag-health-progress" role="status" aria-live="polite"' + hidden + '><div class="tag-health-progress-head"><span id="tag-health-progress-text">' + esc(text) + '</span></div><div class="tag-health-progress-bar"><span id="tag-health-progress-fill" style="width:' + pct + '%"></span></div></div>';
}
function updateTagHealthProgressUi() {
  var root = $('metadata-health-container');
  if (root) root.querySelectorAll('.tag-health-action').forEach(function (btn) { btn.disabled = !!tagHealthProgress.active; });
  var wrap = $('tag-health-progress');
  if (!wrap) return;
  var text = $('tag-health-progress-text');
  var fill = $('tag-health-progress-fill');
  var pct = getTagHealthProgressPercent();
  wrap.hidden = !tagHealthProgress.active && !tagHealthProgress.summary;
  if (text) text.textContent = getTagHealthProgressText();
  if (fill) fill.style.width = pct + '%';
}

function renderMetadataHealthView() {
  var root = $('metadata-health-container'); if (!root) return;
  var albumDiscCounts = {};
  getLibraryIndex().albums.forEach(function (album) {
    albumDiscCounts[album.id] = new Set();
    album.tracks.forEach(function (f) { albumDiscCounts[album.id].add(getDiscNumber(f)); });
  });
  function isMissingTrackOrDisc(f) {
    return !f.trackNo || (albumDiscCounts[getAlbumKey(f)] && albumDiscCounts[getAlbumKey(f)].size > 1 && !f.discNo && !f.__displayDiscNo);
  }
  var checks = [
    { id: 'missing_files', label: 'Missing Files', icon: 'ph-file-x', test: function (f) { return libraryMissingFilePaths.has(f.filePath); } },
    { id: 'missing_cover', label: 'Missing Cover', icon: 'ph-image-broken', test: function (f) { return !f.picture; } },
    { id: 'missing_year', label: 'Missing Year', icon: 'ph-calendar-x', test: function (f) { return !f.year; } },
    { id: 'missing_genre', label: 'Missing Genre', icon: 'ph-tag', test: function (f) { return !f.genre; } },
    { id: 'missing_track', label: 'Missing Track/Disc', icon: 'ph-list-numbers', test: isMissingTrackOrDisc },
    { id: 'missing_replaygain', label: 'Missing ReplayGain', icon: 'ph-waveform', test: function (f) { return f.replayGainTrackDb === null || f.replayGainTrackDb === undefined; } }
  ];
  var activeId = root.dataset.filter || checks[0].id;
  var active = checks.find(function (c) { return c.id === activeId; }) || checks[0];
  // Single pass over the library: card counts + the active filter's matches together
  var checkCounts = {};
  checks.forEach(function (c) { checkCounts[c.id] = 0; });
  var allFiltered = [];
  state.musicFiles.forEach(function (f) {
    checks.forEach(function (c) {
      if (c.test(f)) {
        checkCounts[c.id]++;
        if (c.id === active.id) allFiltered.push(f);
      }
    });
  });
  var filtered = allFiltered.slice(0, 250);
  var busyAttr = tagHealthProgress.active ? ' disabled' : '';
  var contextualActions = '';
  if (active.id === 'missing_files') {
    var reviewDisabled = tagHealthProgress.active || !missingFileScanComplete || !checkCounts.missing_files ? ' disabled' : '';
    contextualActions = '<button class="tag-health-action accent" id="tag-health-relink-folder"' + reviewDisabled + ' title="' + (!missingFileScanComplete ? 'Run Scan Missing Files first' : 'Choose a folder and review proposed path changes') + '">Review Moves</button>';
  }
  else if (active.id === 'missing_replaygain') contextualActions = '<button class="tag-health-action accent" id="tag-health-analyze-visible"' + busyAttr + '>Analyze Next Batch</button><button class="tag-health-action" id="tag-health-analyze-all-rg"' + busyAttr + '>Analyze All</button>';
  else if (active.id === 'missing_cover') contextualActions = '<button class="tag-health-action accent" id="tag-health-quick-visible"' + busyAttr + '>Use Folder Images</button>';
  else if (active.id === 'missing_track') contextualActions = '<button class="tag-health-action accent" id="tag-health-quick-visible"' + busyAttr + '>Infer Listed Numbers</button>';
  else contextualActions = '<button class="tag-health-action accent" id="tag-health-quick-visible"' + busyAttr + '>Open Metadata Editor</button>';
  root.innerHTML = '<div class="tag-health-toolbar"><div><div class="tag-health-title">Library Tag Health</div><div class="tag-health-subtitle">Choose an issue category, then use only the actions that apply to it.</div></div><div class="tag-health-actions"><button class="tag-health-action" id="tag-health-album-cleanup"' + busyAttr + '>Album Cleanup</button><button class="tag-health-action" id="tag-health-scan-missing"' + busyAttr + '>Scan Missing Files</button><button class="tag-health-action" id="tag-health-rescan"' + busyAttr + '>Refresh</button>' + contextualActions + '</div></div>' + renderTagHealthProgressHtml() + '<div class="tag-health-cards" id="metadata-health-cards"></div><div id="metadata-health-list"></div>';
  var albumCleanupBtn = $('tag-health-album-cleanup');
  if (albumCleanupBtn) albumCleanupBtn.onclick = renderAlbumCleanupHelper;
  var scanMissingBtn = $('tag-health-scan-missing');
  if (scanMissingBtn) scanMissingBtn.onclick = scanMissingLibraryFiles;
  var relinkFolderBtn = $('tag-health-relink-folder');
  if (relinkFolderBtn) relinkFolderBtn.onclick = relinkMissingFilesFromFolder;
  var refreshBtn = $('tag-health-rescan');
  if (refreshBtn) refreshBtn.onclick = renderMetadataHealthView;
  var analyzeVisibleBtn = $('tag-health-analyze-visible');
  if (analyzeVisibleBtn) analyzeVisibleBtn.onclick = function () { active.id === 'missing_replaygain' ? analyzeReplayGainBatch(filtered) : analyzeLoudnessForFiles(filtered); };
  var analyzeAllRgBtn = $('tag-health-analyze-all-rg');
  if (analyzeAllRgBtn) analyzeAllRgBtn.onclick = function () { analyzeAllMissingReplayGain(); };
  var quickVisibleBtn = $('tag-health-quick-visible');
  if (quickVisibleBtn) quickVisibleBtn.onclick = function () { quickFixMetadataFiles(active.id, filtered); };
  var cards = $('metadata-health-cards');
  checks.forEach(function (check) {
    var count = checkCounts[check.id];
    var card = document.createElement('button');
    card.className = 'tag-health-card' + (check.id === active.id ? ' active' : '');
    card.innerHTML = '<span class="tag-health-card-icon"><i class="ph ' + check.icon + '"></i></span><span class="tag-health-card-body"><span class="tag-health-card-label">' + esc(check.label) + '</span><span class="tag-health-card-count">' + count + '</span></span>';
    card.onclick = function () { root.dataset.filter = check.id; renderMetadataHealthView(); };
    cards.appendChild(card);
  });
  var list = $('metadata-health-list');
  if (!filtered.length) { list.innerHTML = '<div class="tag-health-empty"><i class="ph ph-check-circle"></i><div>No issues in this category.</div></div>'; return; }
  list.innerHTML = '<div class="tag-health-list-head"><h2>' + esc(active.label) + '</h2><span>Showing ' + filtered.length + ' of ' + allFiltered.length + '</span></div><div class="tag-health-rows" id="tag-health-rows"></div>';
  var rows = $('tag-health-rows');
  filtered.forEach(function (f) {
    var row = document.createElement('div');
    row.className = 'tag-health-row';
    var cover = f.picture ? '<img class="tag-health-cover" src="' + esc(f.picture) + '" alt="Artwork for ' + esc(f.album || f.title || 'track') + '">' : '<div class="tag-health-cover placeholder"><i class="ph ph-music-notes"></i></div>';
    var details = [];
    if (libraryMissingFilePaths.has(f.filePath)) details.push('missing file');
    if (!f.year) details.push('no year');
    if (!f.genre) details.push('no genre');
    if (!f.trackNo) details.push('no track #');
    if (f.replayGainTrackDb === null || f.replayGainTrackDb === undefined) details.push('no ReplayGain');
    var quickLabel = active.id === 'missing_replaygain' ? 'Batch Analyze' : (active.id === 'missing_track' ? 'Infer #' : (active.id === 'missing_cover' ? 'Use Image' : 'Auto Tag'));
    var editAlbumBtn = active.id === 'missing_track' ? '<button class="tag-health-action edit-album">Edit Album</button>' : '';
    var quickButton = active.id === 'missing_files' ? '' : '<button class="tag-health-action quick">' + esc(quickLabel) + '</button>';
    row.innerHTML = cover + '<div class="tag-health-track"><div class="tag-health-track-title">' + esc(f.title || f.filename || 'Unknown Track') + '</div><div class="tag-health-track-meta">' + esc(f.artist || 'Unknown Artist') + ' • ' + esc(f.album || 'Unknown Album') + '</div><div class="tag-health-badges">' + details.slice(0, 4).map(function (d) { return '<span>' + esc(d) + '</span>'; }).join('') + '</div></div><div class="tag-health-row-actions"><button class="tag-health-action edit">Edit</button>' + editAlbumBtn + quickButton + '</div>';
    row.querySelector('.edit').onclick = function () { openMetadataEditor([f]); };
    var editAlbum = row.querySelector('.edit-album');
    if (editAlbum) editAlbum.onclick = function () { openMetadataEditor(getAlbumFilesForTrack(f)); };
    var quickButtonEl = row.querySelector('.quick');
    if (quickButtonEl) quickButtonEl.onclick = function () { quickFixMetadataFiles(active.id, [f]); };
    rows.appendChild(row);
  });
}

function getFileFolderPath(file) {
  var fp = stripFileUrl((file && file.filePath) || '') || (file && file.filePath) || '';
  return fp.replace(/[^\/\\]+$/, '');
}
function getAlbumFilesForTrack(file) {
  var key = getAlbumKey(file);
  var album = getLibraryIndex().albumsByKey.get(key);
  var files = album ? album.tracks : [];
  return files.length ? files : [file];
}
function pickBestFolderImage(images) {
  if (!images || !images.length) return '';
  var preferred = ['folder', 'cover', 'front', 'artwork', 'album'];
  var sorted = images.slice().sort(function (a, b) {
    var la = a.toLowerCase(), lb = b.toLowerCase();
    var ia = preferred.findIndex(function (p) { return la.indexOf(p) !== -1; });
    var ib = preferred.findIndex(function (p) { return lb.indexOf(p) !== -1; });
    ia = ia === -1 ? 99 : ia;
    ib = ib === -1 ? 99 : ib;
    return ia - ib;
  });
  return sorted[0] || '';
}
async function scanMissingLibraryFiles() {
  if (!window.api.checkLibraryFiles) return;
  var btn = $('tag-health-scan-missing');
  var oldText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = 'Scanning...'; btn.disabled = true; }
  setTagHealthProgress(true, 'Scanning missing files', 0, 1, '');
  try {
    var res = await window.api.checkLibraryFiles(state.musicFiles);
    if (!res || res.ok !== true) throw new Error((res && res.error) || 'The main process rejected the missing-file scan.');
    libraryMissingFilePaths = new Set((res && res.missing) || []);
    missingFileScanComplete = true;
    var root = $('metadata-health-container');
    if (root) root.dataset.filter = 'missing_files';
    setTagHealthProgress(false, '', 1, 1, 'Missing file scan complete: ' + libraryMissingFilePaths.size + ' missing entr' + (libraryMissingFilePaths.size === 1 ? 'y' : 'ies') + '.');
    renderMetadataHealthView();
    showToast('Missing file scan complete.');
    return res;
  } catch (e) {
    console.error(e);
    missingFileScanComplete = false;
    setTagHealthProgress(false, '', 0, 1, 'Missing file scan failed.');
    alert('Missing file scan failed: ' + (e.message || e));
    return null;
  } finally {
    if (btn) { btn.textContent = oldText || 'Scan Missing Files'; btn.disabled = false; }
  }
}

function setMovedFilesState(message, isError) {
  var stateEl = $('moved-files-state');
  if (!stateEl) return;
  stateEl.textContent = message || '';
  stateEl.classList.toggle('error', !!isError);
}

function updateMovedFileSelection() {
  var selected = Array.from(document.querySelectorAll('#moved-files-rows .moved-file-check:checked:not(:disabled)'));
  var count = $('moved-files-selection-count');
  var apply = $('moved-files-apply');
  if (count) count.textContent = selected.length + ' selected';
  if (apply) {
    apply.disabled = movedFileOperation === 'commit' || selected.length === 0;
    apply.textContent = selected.length ? 'Apply ' + selected.length + ' selected' : 'Apply selected';
  }
}

function setMovedFilesModalBusy(busy) {
  var modal = $('moved-files-modal');
  if (!modal) return;
  modal.querySelectorAll('button, input').forEach(function (control) { control.disabled = !!busy || (control.classList.contains('moved-file-check') && !control.dataset.candidateId); });
  var progress = $('moved-files-progress');
  if (progress) progress.hidden = !busy;
  var apply = $('moved-files-apply');
  if (!busy && apply) updateMovedFileSelection();
  modal.setAttribute('aria-busy', busy ? 'true' : 'false');
}

function updateMovedFilesProgress(data) {
  if (!data) return;
  var total = Number(data.total || 0);
  var current = Number(data.current || 0);
  var pct = total ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0;
  var label = $('moved-files-progress-label');
  var fill = $('moved-files-progress-fill');
  if (label) label.textContent = (data.label || 'Working') + (total ? ' ' + current + '/' + total : '');
  if (fill) fill.style.width = pct + '%';
}

function renderMovedFilesPreview(preview) {
  var rows = $('moved-files-rows');
  var summary = $('moved-files-summary');
  if (!rows || !summary) return;
  rows.replaceChildren();
  var info = preview.summary || {};
  summary.textContent = (info.suggested || 0) + ' suggestions for ' + (info.missing || 0) + ' missing entries in ' + (preview.searchRoot || 'the selected folder') + '. Ambiguous matches stay unchecked.';
  (preview.proposals || []).forEach(function (proposal, index) {
    var row = document.createElement('tr');
    row.className = proposal.ambiguous ? 'ambiguous' : (proposal.candidateId ? 'proposed' : 'unmatched');

    var selectCell = document.createElement('td');
    var checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'moved-file-check';
    checkbox.dataset.candidateId = proposal.candidateId || '';
    checkbox.dataset.highConfidence = proposal.confidence === 'high' && !proposal.ambiguous ? 'true' : 'false';
    checkbox.disabled = !proposal.candidateId;
    checkbox.checked = !!proposal.autoSelected;
    checkbox.setAttribute('aria-label', 'Apply suggestion for ' + (proposal.title || proposal.oldPath || ('missing entry ' + (index + 1))));
    checkbox.addEventListener('change', updateMovedFileSelection);
    selectCell.appendChild(checkbox);
    row.appendChild(selectCell);

    var trackCell = document.createElement('td');
    var title = document.createElement('strong');
    title.textContent = proposal.title || 'Unknown track';
    var meta = document.createElement('span');
    meta.textContent = [proposal.artist || 'Unknown artist', proposal.album || 'Unknown album'].join(' / ');
    trackCell.append(title, meta);
    row.appendChild(trackCell);

    [proposal.oldPath, proposal.newPath].forEach(function (filePath) {
      var pathCell = document.createElement('td');
      var code = document.createElement('code');
      code.textContent = filePath || 'No plausible candidate';
      code.title = filePath || '';
      pathCell.appendChild(code);
      row.appendChild(pathCell);
    });

    var matchCell = document.createElement('td');
    var confidence = document.createElement('strong');
    confidence.className = 'moved-file-confidence ' + (proposal.confidence || 'low');
    confidence.textContent = proposal.candidateId ? (proposal.confidence || 'low') + ' confidence' : 'unmatched';
    var reason = document.createElement('span');
    var reasonParts = (proposal.reasons || []).slice(0, 3);
    if (proposal.ambiguous) reasonParts = ['Ambiguous match'].concat(reasonParts, proposal.ambiguityReasons || []);
    reason.textContent = reasonParts.join('. ') || 'No reliable evidence';
    matchCell.append(confidence, reason);
    row.appendChild(matchCell);
    rows.appendChild(row);
  });
  setMovedFilesState((preview.warnings || []).length ? 'Scan completed with ' + preview.warnings.length + ' warning(s). Inaccessible items were not proposed.' : '', false);
  setMovedFilesModalBusy(false);
  updateMovedFileSelection();
}

async function cancelMovedFileReview() {
  if (movedFileOperation === 'commit') return;
  var preview = movedFilePreview;
  movedFilePreview = null;
  hideModal($('moved-files-modal'));
  if (preview && preview.token && window.api.cancelMovedFilesPreview) {
    try { await window.api.cancelMovedFilesPreview(preview.token); } catch (e) { console.error(e); }
  }
}

async function relinkMissingFilesFromFolder() {
  if (!missingFileScanComplete) { alert('Run Scan Missing Files first, then review moved-file suggestions.'); return; }
  var missingPaths = Array.from(libraryMissingFilePaths);
  if (!missingPaths.length) { alert('No missing library entries were found in the latest scan.'); return; }
  if (!window.api.previewMovedFiles) { alert('Moved-file review needs a full app restart to load the main-process workflow.'); return; }
  if (hasActiveDownloadQueueJobs()) { alert('Wait for queued or active downloads to finish before reviewing moved files.'); return; }
  var scanGeneration = beginLibraryScan();
  if (!scanGeneration) return;
  movedFileOperation = 'preview';
  setTagHealthProgress(true, 'Preparing moved-file review', 0, 0, '');
  try {
    if (movedFilePreview && movedFilePreview.token && window.api.cancelMovedFilesPreview) window.api.cancelMovedFilesPreview(movedFilePreview.token).catch(function () { });
    movedFilePreview = null;
    var result = await window.api.previewMovedFiles(missingPaths);
    if (!libraryScanIsCurrent(scanGeneration)) return;
    if (!result || !result.ok) {
      if (!(result && result.canceled)) alert('Moved-file scan failed: ' + ((result && result.error) || 'unknown error'));
      setTagHealthProgress(false, '', 0, 0, result && result.canceled ? 'Moved-file search canceled.' : 'Moved-file search failed.');
      return;
    }
    movedFilePreview = result;
    renderMovedFilesPreview(result);
    setTagHealthProgress(false, '', result.summary && result.summary.candidates || 0, result.summary && result.summary.candidates || 0, 'Moved-file review ready: ' + ((result.summary && result.summary.suggested) || 0) + ' suggestion(s).');
    showModal($('moved-files-modal'), { initialFocus: '#moved-files-select-high' });
  } catch (e) {
    if (!libraryScanIsCurrent(scanGeneration)) return;
    console.error(e);
    setTagHealthProgress(false, '', 0, 0, 'Moved-file search failed.');
    alert('Moved-file scan failed: ' + (e.message || e));
  } finally {
    movedFileOperation = '';
    finishLibraryScan();
    if (state.currentView === 'metadata_health') renderMetadataHealthView();
  }
}

function refreshPlaybackRuntimeAfterMovedFiles(remap) {
  var index = getLibraryIndex();
  var replacements = new Map();
  function refresh(track) {
    if (!track) return track;
    if (replacements.has(track)) return replacements.get(track);
    var oldPath = track.matchedFile ? track.matchedFile.filePath : track.filePath;
    var nextPath = oldPath && remap[oldPath] ? remap[oldPath] : oldPath;
    var file = nextPath ? (index.byPath.get(nextPath) || index.byStrippedPath.get(stripFileUrl(nextPath))) : null;
    var next = file ? Object.assign({}, track, { matchedFile: file, filePath: undefined, title: file.title, artist: file.artist, album: file.album, duration: file.duration }) : track;
    replacements.set(track, next);
    return next;
  }
  state.playQueueTracks = state.playQueueTracks.map(refresh).filter(Boolean);
  state.userQueue = state.userQueue.map(refresh).filter(Boolean);
  state.shuffleQueue = state.shuffleQueue.map(refresh).filter(Boolean);
  state.currentTracks = state.currentTracks.map(refresh).filter(Boolean);
  state.playHistory = state.playHistory.map(refresh).filter(Boolean);
  state.playQueueCursor = refresh(state.playQueueCursor);
  state.shuffleQueueCursor = refresh(state.shuffleQueueCursor);
  state.currentPlayingTrack = refresh(state.currentPlayingTrack);
  pendingPlaybackTrack = refresh(pendingPlaybackTrack);
  appSettings.playHistory = state.playHistory.map(toLightTrackRef).filter(Boolean);
  syncSavedQueuePaths();
}

async function applyMovedFileReview() {
  if (!movedFilePreview || movedFileOperation || appStateCommitInProgress) return;
  var selected = Array.from(document.querySelectorAll('#moved-files-rows .moved-file-check:checked:not(:disabled)'));
  var selectedIds = selected.map(function (checkbox) { return checkbox.dataset.candidateId; }).filter(Boolean);
  if (!selectedIds.length) { setMovedFilesState('Select at least one proposed move.', true); return; }
  if (hasActiveDownloadQueueJobs()) { setMovedFilesState('Wait for queued or active downloads to finish, then apply again.', true); return; }
  if (metadataWriteLockedPaths.size || (typeof metaSaveInProgress !== 'undefined' && metaSaveInProgress)) { setMovedFilesState('Wait for metadata writing to finish, then apply again.', true); return; }
  var selectedIdSet = new Set(selectedIds);
  var affectedOldPaths = new Set((movedFilePreview.proposals || []).filter(function (proposal) { return selectedIdSet.has(proposal.candidateId); }).map(function (proposal) { return proposal.oldPath; }));
  var currentPath = state.currentPlayingTrack && state.currentPlayingTrack.matchedFile && state.currentPlayingTrack.matchedFile.filePath;
  var pendingPath = pendingPlaybackTrack && pendingPlaybackTrack.matchedFile && pendingPlaybackTrack.matchedFile.filePath;
  var playbackAffected = affectedOldPaths.has(currentPath) || affectedOldPaths.has(pendingPath);
  var previousMissingPaths = new Set(libraryMissingFilePaths);
  var runtimeWasInitialized = appInitializationComplete;
  var persistenceWasSuspended = rendererPersistenceSuspended;
  var snapshot = null;
  var committed = false;
  movedFileOperation = 'commit';
  setMovedFilesState('', false);
  setMovedFilesModalBusy(true);
  updateMovedFilesProgress({ label: 'Preparing app state', current: 0, total: selectedIds.length });
  try {
    if (playbackAffected) stopPlaybackState();
    syncSavedQueuePaths();
    await flushSettingsSave();
    snapshot = pushUndoSnapshot('Relink moved files', ['library', 'playlists', 'mappings', 'likedSongs', 'settings', 'playbackQueues']);
    if (!snapshot) throw new Error('The current app state could not be captured for Undo.');
    snapshot.atomicAppState = true;
    beginAppStateCommit();
    rendererPersistenceSuspended = true;
    appInitializationComplete = false;
    var result = await window.api.commitMovedFiles(movedFilePreview.token, selectedIds);
    if (!result || !result.ok) throw new Error((result && result.error) || 'The main process rejected the moved-file commit.');
    committed = true;
    remapDownloadQueuePaths(result.remap || {});
    if (playbackAffected) resetPlaybackRuntime({ clearCurrent: true, clearQueues: true, clearHistory: true, preserveSettings: true });
    await reloadRendererAppState();
    await applyRuntimeSettings({ preserveTitleBarMode: true });
    if (playbackAffected) restorePlaybackStateFromSettings();
    else refreshPlaybackRuntimeAfterMovedFiles(result.remap || {});
    libraryMissingFilePaths = new Set(Array.from(previousMissingPaths).filter(function (filePath) { return !(result.remap && result.remap[filePath]); }));
    missingFileScanComplete = true;
    clearTrackSelection();
    selectedAlbumsForEdit.clear();
    rendererPersistenceSuspended = false;
    appInitializationComplete = true;
    endAppStateCommit();
    movedFilePreview = null;
    hideModal($('moved-files-modal'));
    renderSidebarPlaylists();
    renderCurrentCollectionState();
    syncPlaybackStateUi();
    if (isQueueOpen) renderQueue();
    var warningText = Array.isArray(result.warnings) && result.warnings.length ? ' ' + result.warnings.length + ' warning(s) were reported.' : '';
    showUndoToast('Relinked ' + result.count + ' moved file' + (result.count === 1 ? '' : 's') + '. Playback remains paused when its active path changed.' + warningText, snapshot);
  } catch (e) {
    console.error('Moved-file commit failed:', e);
    if (!committed) {
      rendererPersistenceSuspended = persistenceWasSuspended;
      appInitializationComplete = runtimeWasInitialized;
      discardUndoSnapshot(snapshot);
      setMovedFilesState('Nothing changed. ' + (e.message || e), true);
    } else {
      renderStartupError(e);
      setMovedFilesState('Paths were committed, but the app state could not be reloaded. Restart Playerinyo.', true);
    }
  } finally {
    if (appStateCommitInProgress) endAppStateCommit();
    movedFileOperation = '';
    if (movedFilePreview) setMovedFilesModalBusy(false);
  }
}

if (window.api.onMovedFilesProgress) window.api.onMovedFilesProgress(function (data) {
  if (movedFileOperation === 'preview') {
    setTagHealthProgress(true, data && data.label || 'Scanning moved files', data && data.current || 0, data && data.total || 0, '');
  } else if (movedFileOperation === 'commit') {
    updateMovedFilesProgress(data);
  }
});

var movedFilesSelectHigh = $('moved-files-select-high');
if (movedFilesSelectHigh) movedFilesSelectHigh.addEventListener('click', function () {
  document.querySelectorAll('#moved-files-rows .moved-file-check').forEach(function (checkbox) { checkbox.checked = !checkbox.disabled && checkbox.dataset.highConfidence === 'true'; });
  updateMovedFileSelection();
});
var movedFilesApply = $('moved-files-apply');
if (movedFilesApply) movedFilesApply.addEventListener('click', applyMovedFileReview);
var movedFilesCancel = $('moved-files-cancel');
if (movedFilesCancel) movedFilesCancel.addEventListener('click', cancelMovedFileReview);
var movedFilesClose = $('moved-files-close');
if (movedFilesClose) movedFilesClose.addEventListener('click', cancelMovedFileReview);
var movedFilesModal = $('moved-files-modal');
if (movedFilesModal) movedFilesModal.addEventListener('click', function (event) { if (event.target === movedFilesModal) cancelMovedFileReview(); });
function countMetadataIssues(files) {
  files = files || [];
  return {
    missingCover: files.filter(function (f) { return !f.picture; }).length,
    missingYear: files.filter(function (f) { return !f.year; }).length,
    missingGenre: files.filter(function (f) { return !f.genre; }).length,
    missingReplayGain: files.filter(function (f) { return f.replayGainTrackDb === null || f.replayGainTrackDb === undefined; }).length
  };
}
function showImportReview(summary) {
  var modal = $('import-review-modal');
  var grid = $('import-review-grid');
  var subtitle = $('import-review-subtitle');
  if (!modal || !grid) return;
  if (subtitle) subtitle.textContent = summary.folder ? ('Scanned: ' + summary.folder) : 'Library scan complete.';
  var cards = [
    { label: 'Added', value: summary.added || 0, icon: 'ph-plus-circle' },
    { label: 'Updated', value: summary.updated || 0, icon: 'ph-arrows-clockwise' },
    { label: 'Already In Library', value: summary.unchanged || 0, icon: 'ph-check-circle' },
    { label: 'Missing Covers', value: summary.missingCover || 0, icon: 'ph-image-broken' },
    { label: 'Missing Year', value: summary.missingYear || 0, icon: 'ph-calendar-x' },
    { label: 'Missing Genre', value: summary.missingGenre || 0, icon: 'ph-tag' },
    { label: 'Missing ReplayGain', value: summary.missingReplayGain || 0, icon: 'ph-waveform' }
  ];
  grid.innerHTML = cards.map(function (card) {
    return '<div class="import-review-card"><i class="ph ' + card.icon + '"></i><strong>' + esc(card.value) + '</strong><span>' + esc(card.label) + '</span></div>';
  }).join('');
  showModal(modal);
}
function buildImportReviewSummary(folderPath, scannedFiles, beforeMap, afterFiles) {
  var added = 0, updated = 0, unchanged = 0;
  (scannedFiles || []).forEach(function (f) {
    if (!f || !f.filePath) return;
    var before = beforeMap[f.filePath];
    if (!before) added++;
    else if ((before.modifiedAtMs !== f.modifiedAtMs) || (before.fileSize !== f.fileSize) || JSON.stringify(before) !== JSON.stringify(f)) updated++;
    else unchanged++;
  });
  var issues = countMetadataIssues(afterFiles || []);
  return Object.assign({ folder: folderPath, added: added, updated: updated, unchanged: unchanged }, issues);
}
async function quickFixMissingCover(files) {
  var fixed = 0;
  var folderCache = {};
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    if (!f || f.picture || !f.filePath || !window.api.scanFolderImages) continue;
    var folder = getFileFolderPath(f);
    if (!folderCache[folder]) folderCache[folder] = window.api.scanFolderImages(folder).then(pickBestFolderImage).catch(function () { return ''; });
    var image = await folderCache[folder];
    if (image) { f.picture = image; fixed++; }
  }
  if (fixed) { markLibraryDirty(); await persistLibrary(state.musicFiles); }
  return fixed;
}
function inferTrackDiscForFile(file) {
  if (!file || !file.filePath) return false;
  var fp = stripFileUrl(file.filePath) || file.filePath;
  var normalized = fp.replace(/\\/g, '/');
  var parts = normalized.split('/');
  var filename = parts.pop() || file.filename || '';
  var basename = filename.replace(/\.[^.]+$/, '');
  var changed = false;
  var discMatch = normalized.match(/(?:^|\/)(?:cd|disc|disk)[\s._-]*(\d{1,2})(?:\/|$)/i) || basename.match(/(?:^|\D)(\d{1,2})[\s._-]+(\d{1,3})(?:\D|$)/);
  if (!file.discNo && discMatch) {
    file.discNo = parseInt(discMatch[1], 10) || file.discNo;
    changed = !!file.discNo;
  }
  var trackMatch = basename.match(/(?:^|\D)(\d{1,2})[\s._-]+(\d{1,3})(?:\D|$)/) || basename.match(/^\s*(\d{1,3})(?:\D|$)/);
  var trackNo = trackMatch ? parseInt(trackMatch[2] || trackMatch[1], 10) : 0;
  if (!file.trackNo && trackNo) { file.trackNo = trackNo; changed = true; }
  return changed;
}
async function quickFixTrackNumbers(files) {
  var changed = 0;
  files.forEach(function (f) { if (inferTrackDiscForFile(f)) changed++; });
  if (changed) { markLibraryDirty(); await persistLibrary(state.musicFiles); }
  return changed;
}
function renderCurrentCollectionState() {
  updatePlayerUI();
  if (isQueueOpen) renderQueue();
  renderSidebarPlaylists();
  if (state.currentView === 'metadata_health') renderMetadataHealthView();
  else if (state.currentView === 'library') renderLibrary();
  else if (state.currentView === 'home') renderHomeDashboard();
  else if (state.currentView === 'playlists') switchView('playlists', false);
  else if (state.currentView === 'stats') renderStatsView();
  else if (state.currentView === 'search') { var search = $('global-search'); if (search) search.dispatchEvent(new Event('input')); }
  else if (state.currentView && state.currentView.indexOf('album:') === 0) {
    var album = getFullAlbumByKey(decodeURIComponent(state.currentView.slice(6)));
    if (album) renderAlbumDetail(album);
    else switchView(state.musicFiles.length ? 'library' : 'home', false);
  } else if (state.currentView) {
    var smartPlaylist = getSmartPlaylistById(state.currentView);
    if (smartPlaylist) openSmartPlaylist(smartPlaylist);
    else renderPlaylist(state.currentView);
  }
}
function refreshSearchAfterLibraryMutation() {
  var search = $('global-search');
  if (state.currentView !== 'search' || !search || !search.value.trim()) return false;
  clearTimeout(gSearchTimeout);
  search.dispatchEvent(new Event('input'));
  return true;
}
async function removeLibraryFiles(files, undoLabel) {
  var libraryPaths = new Set(state.musicFiles.map(function (f) { return f && f.filePath; }).filter(Boolean));
  files = (files || []).filter(function (f, index, list) {
    return f && f.filePath && libraryPaths.has(f.filePath) && list.findIndex(function (item) { return item && item.filePath === f.filePath; }) === index;
  });
  if (!files.length) return { count: 0, snapshot: null };
  var snapshot = pushUndoSnapshot(undoLabel || 'Remove from library', ['library', 'playbackQueues']);
  if (!snapshot) { showToast('Nothing was removed because an Undo snapshot could not be created.'); return { count: 0, snapshot: null, failed: true }; }
  var previousSettings = deepCloneForUndo(appSettings);
  var previousMissingPaths = new Set(libraryMissingFilePaths);
  var removeSet = new Set(files.map(function (f) { return f.filePath; }));
  var libraryPersisted = false;
  try {
    setMusicFiles(state.musicFiles.filter(function (f) { return !removeSet.has(f.filePath); }));
    reconcilePlaybackAfterLibraryRemoval(removeSet);
    removeSet.forEach(function (fp) { libraryMissingFilePaths.delete(fp); });
    await persistLibrary(state.musicFiles);
    libraryPersisted = true;
    await persistSettings(appSettings);
    return { count: removeSet.size, snapshot: snapshot };
  } catch (e) {
    console.error('Library removal persistence failed:', e);
    setMusicFiles(snapshot.library || []);
    appSettings = settingsWithDefaults(previousSettings);
    libraryMissingFilePaths = previousMissingPaths;
    if (snapshot && snapshot.playbackQueues) restorePlaybackQueuesSnapshot(snapshot.playbackQueues);
    discardUndoSnapshot(snapshot);
    if (libraryPersisted) {
      try { await persistLibrary(state.musicFiles); }
      catch (rollbackError) { console.error('Could not roll back the library write:', rollbackError); }
    }
    renderCurrentCollectionState();
    showToast('Nothing was removed because Playerinyo could not save the complete change.');
    return { count: 0, snapshot: null, failed: true };
  }
}
async function quickFixMetadataFiles(filterId, files) {
  files = (files || []).filter(Boolean);
  if (!files.length) return;
  try {
    var changed = 0;
    var quickFixSnapshot = null;
    setTagHealthProgress(true, 'Fixing listed items', 0, files.length, '');
    if (filterId === 'missing_files') {
      setTagHealthProgress(false, '', 0, files.length, 'Missing entries can only be changed through reviewed moved-file suggestions.');
      return;
    }
    else if (filterId === 'missing_cover') { quickFixSnapshot = pushUndoSnapshot('Fix missing covers', ['library']); changed = await quickFixMissingCover(files); }
    else if (filterId === 'missing_track') { quickFixSnapshot = pushUndoSnapshot('Infer track/disc numbers', ['library']); changed = await quickFixTrackNumbers(files); }
    else if (filterId === 'missing_replaygain') { await analyzeReplayGainBatch(files); return; }
    else {
      var albumKey = getAlbumKey(files[0]);
      var album = getLibraryIndex().albumsByKey.get(albumKey);
      var albumFiles = album ? album.tracks : [];
      openMetadataEditor(albumFiles.length > 1 ? albumFiles : files);
      setTagHealthProgress(false, '', 0, files.length, 'Open the metadata editor to finish this cleanup.');
      return;
    }
    if (!changed) discardUndoSnapshot(quickFixSnapshot);
    setTagHealthProgress(false, '', files.length, files.length, 'Quick fix updated ' + changed + ' track(s).');
    renderMetadataHealthView();
    if (state.currentView === 'library') renderLibrary();
    if (isQueueOpen) renderQueue();
    showToast('Quick fix updated ' + changed + ' track(s).');
  } catch (e) {
    console.error(e);
    setTagHealthProgress(false, '', 0, files.length, 'Quick fix failed.');
    alert('Quick fix failed: ' + (e.message || e));
  }
}

function albumCleanupBaseName(name) {
  return normalize(String(name || 'Unknown Album')
    .replace(/\((?:cd|disc|disk)\s*\d+\)/ig, '')
    .replace(/\b(?:cd|disc|disk)\s*\d+\b/ig, '')
    .replace(/[-_]+\s*$/g, '')
    .trim());
}
function getAlbumCleanupSuggestions() {
  var groups = {};
  getLibraryIndex().albums.forEach(function (album) {
    var cleanupKey = albumCleanupBaseName(album.name) + '::' + normalize(album.artist);
    if (!groups[cleanupKey]) groups[cleanupKey] = [];
    groups[cleanupKey].push(album);
  });
  return Object.keys(groups).map(function (key) { return groups[key]; }).filter(function (group) {
    return group.length > 1 && new Set(group.map(function (a) { return a.name; })).size > 1;
  }).sort(function (a, b) {
    var ac = a.reduce(function (sum, album) { return sum + album.tracks.length; }, 0);
    var bc = b.reduce(function (sum, album) { return sum + album.tracks.length; }, 0);
    return bc - ac;
  });
}
function renderAlbumCleanupHelper() {
  var root = $('metadata-health-container'); if (!root) return;
  state.currentView = 'metadata_health';
  $('view-title').textContent = 'Album Cleanup';
  var suggestions = getAlbumCleanupSuggestions();
  root.innerHTML = '<div class="tag-health-toolbar"><div><div class="tag-health-title">Album Cleanup Helper</div><div class="tag-health-subtitle">Possible split albums. Review them in the metadata editor before applying changes.</div></div><div class="tag-health-actions"><button class="tag-health-action" id="album-cleanup-back">Back to Tag Health</button></div></div><div class="tag-health-rows" id="album-cleanup-rows"></div>';
  var back = $('album-cleanup-back');
  if (back) back.onclick = renderMetadataHealthView;
  var rows = $('album-cleanup-rows');
  if (!rows) return;
  if (!suggestions.length) { rows.innerHTML = '<div class="tag-health-empty"><i class="ph ph-check-circle"></i><div>No obvious split albums found.</div></div>'; return; }
  suggestions.slice(0, 80).forEach(function (group) {
    var allTracks = [];
    group.forEach(function (album) { allTracks = allTracks.concat(album.tracks); });
    var row = document.createElement('div');
    row.className = 'tag-health-row album-cleanup-row';
    var names = group.map(function (album) { return album.name + ' (' + album.tracks.length + ')'; }).join(' • ');
    var cover = allTracks.find(function (f) { return f.picture; });
    var coverHtml = cover ? '<img class="tag-health-cover" src="' + esc(cover.picture) + '" alt="Artwork for ' + esc(cover.album || group[0].name || 'album') + '">' : '<div class="tag-health-cover placeholder"><i class="ph ph-vinyl-record"></i></div>';
    row.innerHTML = coverHtml + '<div class="tag-health-track"><div class="tag-health-track-title">' + esc(group[0].artist) + '</div><div class="tag-health-track-meta">' + esc(names) + '</div><div class="tag-health-badges"><span>' + allTracks.length + ' tracks</span><span>' + group.length + ' album groups</span></div></div><div class="tag-health-row-actions"><button class="tag-health-action edit-group">Review in Editor</button></div>';
    row.querySelector('.edit-group').onclick = function () { openMetadataEditor(allTracks); };
    rows.appendChild(row);
  });
}

function renderLibrary() {
  $('view-title').textContent = 'Library';
  $('albums-grid-container').style.display = 'block';
  $('tracks-table-container').style.display = 'none';

  // Show sort controls
  var sortCtrl = $('library-sort-controls');
  var isEmptyLibrary = state.musicFiles.length === 0;
  if (sortCtrl) sortCtrl.style.display = isEmptyLibrary ? 'none' : 'flex';
  var zoomControls = $('zoom-controls');
  if (zoomControls) zoomControls.style.display = isEmptyLibrary ? 'none' : 'flex';
  var libraryEmptyState = $('library-empty-state');
  if (libraryEmptyState) libraryEmptyState.hidden = !isEmptyLibrary;

  // Sort based on dropdown
  var sortSel = $('library-sort-select');
  var sortMode = sortSel ? sortSel.value : 'artist';
  var albums = getLibraryIndex().albums.slice();
  if (sortMode === 'artist') {
    albums.sort(function(a,b) { return (a.artist||'').localeCompare(b.artist||''); });
  } else if (sortMode === 'album') {
    albums.sort(function(a,b) { return (a.name||'').localeCompare(b.name||''); });
  } else if (sortMode === 'year') {
    albums.sort(function(a,b) { return (b.year||0) - (a.year||0); });
  } else if (sortMode === 'recent') {
    // Real added-at timestamps, newest first; reversed insertion order is the
    // tiebreak for entries without a timestamp (stable sort keeps it)
    albums.reverse();
    albums.sort(function (a, b) { return getAlbumAddedAt(b) - getAlbumAddedAt(a); });
  }

  var grid = $('albums-grid');
  grid.innerHTML = '';
  grid.hidden = isEmptyLibrary;
  grid.style.display = '';
  if (isEmptyLibrary) {
    window._libAlbumsToRender = [];
    window._libRenderIndex = 0;
    return;
  }
  window._libAlbumsToRender = albums;
  window._libRenderIndex = 0;
  window._libRenderChunk = appSettings.virtualScrolling ? 60 : 80;
  window._libRenderAll = !appSettings.virtualScrolling;
  window._libRenderToken = (window._libRenderToken || 0) + 1;
  if (window._libRenderFrame) {
    cancelAnimationFrame(window._libRenderFrame);
    window._libRenderFrame = null;
  }
  
  if (!window.renderLibraryChunk) {
    window.renderLibraryChunk = function() {
      if (state.currentView !== 'library') return;
      if (!window._libAlbumsToRender || window._libRenderIndex >= window._libAlbumsToRender.length) return;
      var renderToken = window._libRenderToken;
      var chunk = window._libAlbumsToRender.slice(window._libRenderIndex, window._libRenderIndex + window._libRenderChunk);
      var grid = $('albums-grid');
      var fragment = document.createDocumentFragment();
      chunk.forEach(function (album) {
        var card = document.createElement('article'); card.className = 'album-card' + (isAlbumActive(album) ? ' playing' : ''); card.dataset.albumKey = album.id || '';
        var active = isAlbumActive(album);
        var playBtnIcon = active && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
        var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
        var cov = album.cover ? '<img src="' + esc(album.cover) + '" alt=""' + lazy + ' />' : '<i class="ph ph-music-notes" aria-hidden="true"></i>';
        card.innerHTML = '<div class="album-card-img-wrapper" style="position:relative;">' + cov + '<button type="button" class="album-card-play-btn" aria-label="Play ' + esc(album.name) + '" data-album="' + encodeURIComponent(album.name) + '"><i class="' + playBtnIcon + '" aria-hidden="true"></i></button></div><button type="button" class="album-card-open" aria-label="Open ' + esc(album.name) + ' by ' + esc(album.artist || 'Unknown Artist') + '"><span class="album-card-info"><span class="album-card-title" title="' + esc(album.name) + '">' + esc(album.name) + '</span><span class="album-card-artist">' + esc(album.artist) + '</span></span></button>';
        if (album.cover) {
          var wrapper = card.querySelector('.album-card-img-wrapper');
          if (wrapper) wrapper.style.setProperty('--cover-bg', 'url("' + album.cover.replace(/"/g, '\\"') + '")');
        }
        card.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          window.currentContextMenuAlbum = album;
          positionContextMenu($('album-context-menu'), e.clientX, e.clientY, card);
        });
        card.querySelector('.album-card-play-btn').addEventListener('click', function (e) {
          e.stopPropagation(); initAudioCtx();
          if (isAlbumActive(album)) {
            togglePlay();
            var icon = e.currentTarget.querySelector('i');
            if (icon) icon.className = state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
            return;
          }
          state.playQueueTracks = getSortedAlbumTracks(album).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
          state.shuffleQueue = [];
          if (state.isShuffle) rebuildShuffleQueueForMode();
          playTrack(state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks[0]);
        });
        card.addEventListener('click', function () {
          if (isMultiSelectMode) {
            if (selectedAlbumsForEdit.has(album.id)) selectedAlbumsForEdit.delete(album.id);
            else selectedAlbumsForEdit.add(album.id);
            var selected = selectedAlbumsForEdit.has(album.id);
            card.style.border = selected ? '2px solid var(--accent)' : '';
            card.style.transform = selected ? 'scale(0.95)' : '';
            card.style.opacity = selected ? '0.8' : '';
            updateMultiSelectControls();
            return;
          }
          pushNav('album:' + album.id);
          renderAlbumDetail(album);
        });
        card.querySelector('.album-card-open').addEventListener('keydown', function (e) {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); window.currentContextMenuAlbum = album; positionContextMenu($('album-context-menu'), 0, 0, card); }
        });
        if (typeof isMultiSelectMode !== 'undefined' && isMultiSelectMode && selectedAlbumsForEdit.has(album.id)) {
          card.style.border = '2px solid var(--accent)';
          card.style.transform = 'scale(0.95)';
          card.style.opacity = '0.8';
        }
        fragment.appendChild(card);
      });
      grid.appendChild(fragment);
      window._libRenderIndex += window._libRenderChunk;
      if (window._libRenderIndex < window._libAlbumsToRender.length) {
        window._libRenderFrame = requestAnimationFrame(function () {
          if (window._libRenderToken !== renderToken) return;
          var contentArea = $('content-area');
          if (window._libRenderAll || (contentArea && contentArea.scrollHeight <= contentArea.clientHeight + 1)) window.renderLibraryChunk();
        });
      }
    };
  }
  window.renderLibraryChunk();
}


// FIX 5+6: renderAlbumDetail resets scroll, correct play button
async function renderAlbumDetail(album, focusFilePath) {
  var ca = $('content-area');
  if (state.currentView === 'library') {
    state.libraryScrollPos = ca ? ca.scrollTop : 0;
  }

  state.currentView = 'album:' + (album.id || album.name);
  setViewKind('album');
  hideAllViewRoots();
  // FIX 5: scroll reset
  if (ca) ca.scrollTop = 0;
  var c1 = $('albums-grid-container'); if(c1) c1.style.display = 'none';
  var c2 = $('home-dashboard-container'); if(c2) c2.style.display = 'none';
  var c3 = $('search-albums-container'); if(c3) c3.style.display = 'none';
  var c4 = $('playlists-grid-container'); if(c4) c4.style.display = 'none';
  var c5 = $('tracks-table-container'); if(c5) c5.style.display = 'block'; 
  var c6 = $('album-detail-header'); if(c6) { c6.style.display = 'flex'; c6.dataset.albumKey = album.id || ''; }
  var detailWrap = $('album-detail-cover-wrap');
  var c7 = $('playlist-controls-container'); if(c7) c7.style.display = 'none';
  var playlistActions = $('playlist-detail-actions'); if (playlistActions) playlistActions.hidden = true;
  $('album-detail-type').textContent = 'Album'; $('album-detail-title').textContent = album.name;
  var metaEl = $('album-detail-meta'); metaEl.textContent = '';
  if (album.tracks && album.tracks.length > 0) {
    $('album-detail-artist').textContent = album.artist;
    var albumViewKey = 'album:' + (album.id || album.name);
    Promise.all([
      window.api.getMetadata(album.tracks[0].filePath).catch(function () { return null; }),
      window.api.getAlbumSize ? window.api.getAlbumSize(album.id) .catch(function () { return null; }) : Promise.resolve(null)
    ]).then(function (results) {
      var meta = results[0]; var albumSize = results[1];
      if (!meta || state.currentView !== albumViewKey) return;
      var arr = [];
      if (meta.genre) {
        if (Array.isArray(meta.genre)) arr.push(meta.genre.join(', '));
        else arr.push(meta.genre);
      }
      if (meta.codec) arr.push(String(meta.codec).toUpperCase()); else arr.push('MP3');
      if (meta.sampleRate) arr.push((meta.sampleRate / 1000) + ' kHz');
      if (meta.bitrate) arr.push(Math.round(meta.bitrate / 1000) + 'k');
      var sizeText = albumSize && formatAlbumSize(albumSize.bytes);
      if (sizeText) arr.push(sizeText);
      var rgReady = album.tracks.filter(function (f) { return f.replayGainTrackDb !== null && f.replayGainTrackDb !== undefined; }).length;
      arr.push('ReplayGain ' + rgReady + '/' + album.tracks.length);
      var str = arr.join(' • ');
      if (meta.year) str = meta.year + ' • ' + str;
      metaEl.textContent = str;
    }).catch(function (e) { console.error('Could not load album metadata:', e); });
  } else { $('album-detail-artist').textContent = album.artist; }

  $('album-edit-metadata-btn').style.display = 'flex';

  var cov = $('album-detail-cover');
  var ppb = $('album-cover-play-btn');
  if (album.cover) {
    if (detailWrap) detailWrap.style.display = '';
    if (ppb) { ppb.hidden = false; ppb.tabIndex = 0; }
    cov.src = album.cover; cov.alt = 'Cover for ' + album.name; cov.style.display = 'block';
    cov.style.cursor = 'pointer'; cov.tabIndex = 0; cov.setAttribute('role', 'button'); cov.setAttribute('aria-label', 'Open artwork for ' + album.name);
    cov.onclick = function () { openArtworkLightbox(album.cover, album.name); };
    cov.onkeydown = function (event) { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openArtworkLightbox(album.cover, album.name); } };
  } else {
    if (detailWrap) detailWrap.style.display = 'none';
    if (ppb) { ppb.hidden = true; ppb.tabIndex = -1; }
    cov.removeAttribute('src'); cov.alt = ''; cov.style.display = 'none'; cov.style.cursor = 'default'; cov.tabIndex = -1; cov.removeAttribute('role'); cov.removeAttribute('aria-label'); cov.onclick = null; cov.onkeydown = null;
  }
  state.currentTracks = getSortedAlbumTracks(album).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
  clearTrackTableFilter();
  // FIX 6: play btn state
  if (ppb) {
    ppb.setAttribute('aria-label', 'Play ' + album.name);
    var updateAlbumPlayBtn = function () {
      var active = isAlbumActive(album);
      var icon = ppb.querySelector('i');
      if (icon) icon.className = active && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
    };
    updateAlbumPlayBtn();
    ppb.onclick = function () {
      initAudioCtx();
      if (isAlbumActive(album)) { togglePlay(); updateAlbumPlayBtn(); return; }
      // FIX 4: clear old queue
      state.playQueueTracks = state.currentTracks.slice();
      state.shuffleQueue = [];
      if (state.isShuffle) rebuildShuffleQueueForMode();
      playTrack(state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks[0]);
    };
  }
  renderTracksTable(false);
  if (focusFilePath) focusTrackInTable(focusFilePath);
}

var playlistSortValue = 'Custom Order';
var playlistSortActiveIndex = 0;
var playlistSortSelectHandler = null;
var playlistSortDirectionHandler = null;

function getPlaylistSortOptions() {
  var listbox = $('playlist-sort-listbox');
  return listbox ? Array.from(listbox.querySelectorAll('[role="option"]')) : [];
}

function closePlaylistSortListbox(restoreFocus) {
  var button = $('playlist-sort-button');
  var listbox = $('playlist-sort-listbox');
  if (!button || !listbox) return;
  listbox.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  if (restoreFocus) button.focus();
}

function focusPlaylistSortOption(index) {
  var listbox = $('playlist-sort-listbox');
  var options = getPlaylistSortOptions();
  if (!listbox || !options.length) return;
  playlistSortActiveIndex = Math.max(0, Math.min(options.length - 1, index));
  options.forEach(function (option, optionIndex) { option.classList.toggle('keyboard-active', optionIndex === playlistSortActiveIndex); });
  listbox.setAttribute('aria-activedescendant', options[playlistSortActiveIndex].id);
  // This list is short and fully visible. Calling scrollIntoView here also
  // scrolls the central content stage in Chromium, making the header jump.
}

function openPlaylistSortListbox(preferredIndex) {
  var button = $('playlist-sort-button');
  var listbox = $('playlist-sort-listbox');
  var options = getPlaylistSortOptions();
  if (!button || !listbox || !options.length) return;
  var selectedIndex = options.findIndex(function (option) { return option.dataset.value === playlistSortValue; });
  // Keep the menu out of the playlist header's layout and stacking context.
  // The header can scroll and clip descendants, whereas this portal remains a
  // true overlay anchored to its button.
  if (listbox.parentElement !== document.body) document.body.appendChild(listbox);
  listbox.style.minWidth = Math.round(button.getBoundingClientRect().width) + 'px';
  listbox.hidden = false;
  positionPlaylistSortListbox();
  button.setAttribute('aria-expanded', 'true');
  listbox.focus();
  focusPlaylistSortOption(preferredIndex === undefined ? Math.max(0, selectedIndex) : preferredIndex);
}

function positionPlaylistSortListbox() {
  var button = $('playlist-sort-button');
  var listbox = $('playlist-sort-listbox');
  if (!button || !listbox || listbox.hidden) return;
  var viewportPadding = 12;
  var rect = button.getBoundingClientRect();
  var menuWidth = listbox.offsetWidth || Math.max(rect.width, 178);
  var menuHeight = listbox.offsetHeight || 0;
  var left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - menuWidth - viewportPadding));
  var top = rect.bottom + 6;
  if (top + menuHeight > window.innerHeight - viewportPadding) top = rect.top - menuHeight - 6;
  top = Math.max(viewportPadding, Math.min(top, window.innerHeight - menuHeight - viewportPadding));
  listbox.style.left = Math.round(left) + 'px';
  listbox.style.top = Math.round(top) + 'px';
}

function choosePlaylistSortOption(option) {
  if (!option || !playlistSortSelectHandler) return;
  var nextValue = option.dataset.value;
  closePlaylistSortListbox(true);
  if (nextValue !== playlistSortValue) playlistSortSelectHandler(nextValue);
}

function configurePlaylistSortControl(value, direction, onSelect, onDirection) {
  playlistSortValue = value || 'Custom Order';
  playlistSortSelectHandler = onSelect;
  playlistSortDirectionHandler = onDirection;
  var valueEl = $('playlist-sort-value');
  if (valueEl) valueEl.textContent = playlistSortValue;
  getPlaylistSortOptions().forEach(function (option) { option.setAttribute('aria-selected', option.dataset.value === playlistSortValue ? 'true' : 'false'); });
  var directionButton = $('playlist-sort-dir-btn');
  if (directionButton) {
    var customOrder = playlistSortValue === 'Custom Order';
    var ascending = direction !== 'desc';
    directionButton.disabled = customOrder;
    directionButton.setAttribute('aria-label', customOrder ? 'Sort direction unavailable for Custom Order' : (ascending ? 'Sort ascending' : 'Sort descending'));
    directionButton.title = customOrder ? 'Custom Order uses the saved track order' : (ascending ? 'Sort ascending' : 'Sort descending');
    directionButton.innerHTML = '<i class="ph ' + (ascending ? 'ph-sort-ascending' : 'ph-sort-descending') + '" aria-hidden="true"></i>';
  }
  closePlaylistSortListbox(false);
}

function bindPlaylistSortControl() {
  var button = $('playlist-sort-button');
  var listbox = $('playlist-sort-listbox');
  var directionButton = $('playlist-sort-dir-btn');
  if (!button || !listbox || button.dataset.bound === 'true') return;
  button.dataset.bound = 'true';
  button.addEventListener('click', function (event) {
    event.stopPropagation();
    if (listbox.hidden) openPlaylistSortListbox();
    else closePlaylistSortListbox(true);
  });
  button.addEventListener('keydown', function (event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
    if (event.key === 'Escape') { if (!listbox.hidden) { event.preventDefault(); closePlaylistSortListbox(true); } return; }
    event.preventDefault();
    var options = getPlaylistSortOptions();
    if (event.key === 'Home') openPlaylistSortListbox(0);
    else if (event.key === 'End') openPlaylistSortListbox(options.length - 1);
    else if (event.key === 'ArrowUp') openPlaylistSortListbox(Math.max(0, options.findIndex(function (option) { return option.dataset.value === playlistSortValue; }) - 1));
    else if (event.key === 'ArrowDown') openPlaylistSortListbox(Math.min(options.length - 1, options.findIndex(function (option) { return option.dataset.value === playlistSortValue; }) + 1));
    else openPlaylistSortListbox();
  });
  listbox.addEventListener('keydown', function (event) {
    var options = getPlaylistSortOptions();
    if (event.key === 'Escape') { event.preventDefault(); closePlaylistSortListbox(true); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (event.key === 'Home') focusPlaylistSortOption(0);
      else if (event.key === 'End') focusPlaylistSortOption(options.length - 1);
      else focusPlaylistSortOption(playlistSortActiveIndex + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      choosePlaylistSortOption(options[playlistSortActiveIndex]);
    } else if (event.key === 'Tab') closePlaylistSortListbox(false);
  });
  listbox.addEventListener('click', function (event) {
    var option = event.target.closest('[role="option"]');
    if (option) choosePlaylistSortOption(option);
  });
  directionButton.addEventListener('click', function () { if (!directionButton.disabled && playlistSortDirectionHandler) playlistSortDirectionHandler(); });
  document.addEventListener('click', function (event) {
    if (!event.target.closest('#playlist-sort-container') && !event.target.closest('#playlist-sort-listbox')) closePlaylistSortListbox(false);
  });
}

bindPlaylistSortControl();

function focusTrackInTable(filePath) {
  var target = stripFileUrl(filePath || '') || filePath;
  if (!target) return;
  var attempts = 0;
  function findAndFocus() {
    attempts++;
    var row = document.querySelector('#tracks-body tr[data-file-path="' + CSS.escape(target) + '"]');
    if (!row && window._tracksVirtualized && window.renderVirtualTracksWindow && window._trackRowsToRender && attempts < 4) {
      var rowIndex = window._trackRowsToRender.findIndex(function (entry) {
        var trackPath = entry && entry.track && entry.track.matchedFile && entry.track.matchedFile.filePath;
        return (stripFileUrl(trackPath || '') || trackPath) === target;
      });
      var contentArea = $('content-area');
      var table = document.querySelector('.tracks-table');
      if (rowIndex >= 0 && contentArea && table) {
        var contentRect = contentArea.getBoundingClientRect();
        var tableTop = contentArea.scrollTop + table.getBoundingClientRect().top - contentRect.top;
        var headerHeight = table.tHead ? table.tHead.getBoundingClientRect().height : 0;
        contentArea.scrollTop = Math.max(0, tableTop + headerHeight + (rowIndex * TRACK_TABLE_VIRTUAL_ROW_HEIGHT) - (contentArea.clientHeight / 2));
        window.renderVirtualTracksWindow(true);
        requestAnimationFrame(findAndFocus);
        return;
      }
    }
    if (!row && window.renderTracksChunk && window._tracksToRender && window._tracksRenderIndex < window._tracksToRender.length && attempts < 80) {
      window.renderTracksChunk();
      requestAnimationFrame(findAndFocus);
      return;
    }
    if (!row) return;
    row.scrollIntoView({ block: 'center' });
    row.classList.add('track-focus');
    setTimeout(function () { row.classList.remove('track-focus'); }, 2800);
  }
  requestAnimationFrame(findAndFocus);
}

function focusTrackTableRowBySourceIndex(sourceIndex) {
  if (!Number.isInteger(sourceIndex)) return;
  var selector = '#tracks-body tr[data-track-index="' + sourceIndex + '"]';
  var row = document.querySelector(selector);
  if (row) { row.focus(); return; }
  if (!window._tracksVirtualized || !window.renderVirtualTracksWindow || !window._trackRowsToRender) return;
  var virtualIndex = window._trackRowsToRender.findIndex(function(entry) { return entry && entry.sourceIndex === sourceIndex; });
  var contentArea = $('content-area');
  var table = document.querySelector('.tracks-table');
  if (virtualIndex < 0 || !contentArea || !table) return;
  var contentRect = contentArea.getBoundingClientRect();
  var tableTop = contentArea.scrollTop + table.getBoundingClientRect().top - contentRect.top;
  var headerHeight = table.tHead ? table.tHead.getBoundingClientRect().height : 0;
  contentArea.scrollTop = Math.max(0, tableTop + headerHeight + (virtualIndex * TRACK_TABLE_VIRTUAL_ROW_HEIGHT) - (contentArea.clientHeight / 2));
  window.renderVirtualTracksWindow(true);
  requestAnimationFrame(function() {
    var renderedRow = document.querySelector(selector);
    if (renderedRow) renderedRow.focus();
  });
}

function getFullAlbumByKey(albumId) {
  return getLibraryIndex().albumsByKey.get(albumId) || null;
}

function refreshCurrentAlbumViewAfterDownload(job) {
  if (!state.currentView || !state.currentView.startsWith('album:')) return false;
  var currentAlbumId = state.currentView.slice(6);
  var refreshed = getFullAlbumByKey(currentAlbumId);
  if (refreshed) {
    renderAlbumDetail(refreshed);
    return true;
  }
  var downloaded = (job && job.items ? job.items : []).map(function (item) {
    return item.filePath ? getLibraryIndex().byStrippedPath.get(stripFileUrl(item.filePath)) : null;
  }).filter(Boolean);
  if (downloaded.length) {
    var fallback = getFullAlbumByKey(getAlbumKey(downloaded[0]));
    if (fallback) {
      pushNav('album:' + fallback.id);
      renderAlbumDetail(fallback);
      return true;
    }
  }
  return false;
}

function renderPlaylist(playlistId) {
  setViewKind('playlist');
  hideAllViewRoots();
  $('tracks-table-container').style.display = 'block';
  // FIX 5: scroll reset
  var ca = $('content-area'); if (ca) ca.scrollTop = 0;
  $('view-title').style.display = 'none';
  $('playlist-controls-container').style.display = 'none';
  $('album-detail-meta').textContent = '';
  $('album-edit-metadata-btn').style.display = 'none';
  var playlistActions = $('playlist-detail-actions');
  if (playlistActions) { playlistActions.hidden = true; playlistActions.onclick = null; }

  if (playlistId === 'liked_songs') {
    $('view-title').textContent = 'Liked Songs';
    $('album-detail-header').style.display = 'flex';
    $('album-detail-type').textContent = 'Playlist';
    $('album-detail-title').textContent = 'Liked Songs';
    $('album-detail-artist').textContent = state.likedSongs.length + ' tracks';
    $('album-detail-meta').textContent = 'Sorted like your playlists';
    $('album-edit-metadata-btn').style.display = 'none';
    var likedWrap = $('album-detail-cover-wrap'); if (likedWrap) likedWrap.style.display = 'none';
    $('playlist-controls-container').style.display = 'flex';
    $('playlist-track-search').value = '';
    clearTrackTableFilter();
    var likedSortBy = appSettings.likedSongsSortBy || 'Recently Added';
    var likedDirection = appSettings.likedSongsSortAscending === true ? 'asc' : 'desc';
    configurePlaylistSortControl(likedSortBy, likedDirection, async function (nextSort) {
      var previousSort = appSettings.likedSongsSortBy;
      appSettings.likedSongsSortBy = nextSort;
      try { await persistSettings(appSettings); }
      catch (error) { appSettings.likedSongsSortBy = previousSort; }
      if (state.currentView === 'liked_songs') renderPlaylist('liked_songs');
    }, async function () {
      var previousDirection = appSettings.likedSongsSortAscending;
      appSettings.likedSongsSortAscending = !(appSettings.likedSongsSortAscending === true);
      try { await persistSettings(appSettings); }
      catch (error) { appSettings.likedSongsSortAscending = previousDirection; }
      if (state.currentView === 'liked_songs') renderPlaylist('liked_songs');
    });
    var byPath = getLibraryIndex().byStrippedPath;
    var likedFiles = state.likedSongs.map(function (record) {
      if (typeof record === 'string') return byPath.get(stripFileUrl(record));
      if (!record || typeof record !== 'object') return null;
      var local = state.musicFiles.find(function (file) { return likedIdentity(file) === record.identity; });
      return local || { __remoteLiked: true, title: record.title, artist: record.artist, album: record.album, duration: record.duration, trackMbid: record.trackMbid, playback: { kind: 'youtube', videoId: record.videoId }, artwork: record.artwork, dateAdded: record.dateAdded };
    }).filter(Boolean);
    var sortBy = likedSortBy;
    var dir = likedDirection === 'asc' ? 1 : -1;
    if (sortBy === 'Title') likedFiles.sort(function (a, b) { return (a.title || '').localeCompare(b.title || '') * dir; });
    else if (sortBy === 'Artist') likedFiles.sort(function (a, b) { return (a.artist || '').localeCompare(b.artist || '') * dir; });
    else if (sortBy === 'Album') likedFiles.sort(function (a, b) { return (a.album || '').localeCompare(b.album || '') * dir; });
    else if (sortBy === 'Recently Added') likedFiles = sortRecentlyAddedEntries(likedFiles, function (file) { return Number(file.addedAtMs) || 0; }, likedDirection);
    state.currentTracks = likedFiles.map(function (f) { return f.__remoteLiked ? { title: f.title, artist: f.artist, album: f.album, duration: f.duration, trackMbid: f.trackMbid, playback: f.playback, artwork: f.artwork, isDisabled: false, sourcePlaylistId: 'liked_songs' } : { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false, sourcePlaylistId: 'liked_songs' }; });
    renderTracksTable(false); return;
  }
  var pl = state.playlists.find(function (p) { return p.id === playlistId; }); if (!pl) return;
  $('album-detail-header').style.display = 'flex'; $('album-detail-type').textContent = 'Playlist';
  var plWrap = $('album-detail-cover-wrap'); if (plWrap) plWrap.style.display = '';
  $('playlist-controls-container').style.display = 'flex';
  $('playlist-track-search').value = ''; // clear search when opening a new playlist
  clearTrackTableFilter();
  var playlistSortBy = pl.sortBy || 'Custom Order';
  var playlistSortDirection = pl.sortDirection === 'desc' || pl.sortDirection === 'asc'
    ? pl.sortDirection
    : (playlistSortBy === 'Recently Added' ? 'desc' : (appSettings.sortAscending === false ? 'desc' : 'asc'));
  configurePlaylistSortControl(playlistSortBy, playlistSortDirection, async function (nextSort) {
    var previousSort = pl.sortBy;
    var previousDirection = pl.sortDirection;
    pl.sortBy = nextSort;
    if (nextSort === 'Recently Added' && previousSort !== 'Recently Added') pl.sortDirection = 'desc';
    else if (nextSort !== 'Custom Order' && pl.sortDirection !== 'asc' && pl.sortDirection !== 'desc') pl.sortDirection = 'asc';
    try { await persistPlaylists(state.playlists); }
    catch (error) { pl.sortBy = previousSort; pl.sortDirection = previousDirection; }
    if (state.currentView === pl.id) renderPlaylist(pl.id);
  }, async function () {
    var previousDirection = pl.sortDirection;
    pl.sortDirection = playlistSortDirection === 'asc' ? 'desc' : 'asc';
    try { await persistPlaylists(state.playlists); }
    catch (error) { pl.sortDirection = previousDirection; }
    if (state.currentView === pl.id) renderPlaylist(pl.id);
  });

  $('album-detail-title').textContent = pl.name; $('album-detail-artist').textContent = (pl.tracks || []).length + ' tracks';
  if (playlistActions) {
    playlistActions.hidden = false;
    playlistActions.onclick = function (event) { event.stopPropagation(); openPlaylistContextMenu(pl, 0, 0, playlistActions); };
  }

  var sortedTracks = (pl.tracks || []).slice();
  var dir = playlistSortDirection === 'asc' ? 1 : -1;
  if (pl.sortBy === 'Title') { sortedTracks.sort((a, b) => (a.Song || a.title || '').localeCompare(b.Song || b.title || '') * dir); }
  else if (pl.sortBy === 'Artist') { sortedTracks.sort((a, b) => (a.Artist || a.artist || '').localeCompare(b.Artist || b.artist || '') * dir); }
  else if (pl.sortBy === 'Album') { sortedTracks.sort((a, b) => (a.Album || '').localeCompare(b.Album || '') * dir); }
  else if (pl.sortBy === 'Recently Added') sortedTracks = sortRecentlyAddedEntries(sortedTracks, getPlaylistTrackAddedAtMs, playlistSortDirection);


  state.currentTracks = sortedTracks.map(function (r) { return playlistRecordToPlaybackTrack(r, pl.id); });
  // FIX 3: auto cover from first matched track
  var firstCover = null;
  for (var i = 0; i < state.currentTracks.length; i++) { if (state.currentTracks[i].matchedFile && state.currentTracks[i].matchedFile.picture) { firstCover = state.currentTracks[i].matchedFile.picture; break; } }
  var cover = pl.cover || firstCover;
  var covEl = $('album-detail-cover'), wrap = $('album-detail-cover-wrap');
  if (cover) { covEl.src = cover; covEl.alt = 'Cover for ' + pl.name; covEl.style.display = 'block'; } else { covEl.removeAttribute('src'); covEl.alt = ''; covEl.style.display = 'none'; if (wrap) wrap.style.background = getSafePlaylistColor(pl.color); }
  covEl.style.cursor = 'pointer';
  covEl.onclick = async function () { var img = await window.api.openImage(); if (img) { pl.cover = img; await persistPlaylists(state.playlists); renderSidebarPlaylists(); renderPlaylist(pl.id); } };
  var ppb = $('album-cover-play-btn');
  if (ppb) {
    ppb.setAttribute('aria-label', 'Play ' + pl.name);
    ppb.onclick = function () { initAudioCtx(); state.playQueueTracks = state.currentTracks.slice(); state.shuffleQueue = []; if (state.isShuffle) rebuildShuffleQueueForMode(); var first = state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks.find(function (t) { return !t.isDisabled; }); if (first) playTrack(first); };
  }
  // lastPlayed is NOT updated here, only when a track actually plays. Opening
  // a playlist only changes dock selection, so keep existing cover nodes alive.
  syncDockPlaylistStates();
  renderTracksTable(playlistId.startsWith('pl_') && (!pl.sortBy || pl.sortBy === 'Custom Order'));
}

function clearTrackTableFilter() {
  window._tracksFilterValue = '';
  window._tracksFilterView = '';
}

function trackTableFilterValue() {
  if (window._tracksFilterView !== state.currentView) return '';
  return String(window._tracksFilterValue || '').toLowerCase().trim();
}

function trackMatchesTableFilter(track, query) {
  if (!query) return true;
  var csv = track && track.csvRecord ? track.csvRecord : null;
  var hay = [
    track && track.title,
    track && track.artist,
    track && track.album,
    csv && (csv.Song || csv.title),
    csv && (csv.Artist || csv.artist),
    csv && (csv.Album || csv.album)
  ].join(' ').toLowerCase();
  return hay.indexOf(query) !== -1;
}

function buildTrackRowsForTable(source, query) {
  var rows = [];
  for (var i = 0; i < source.length; i++) {
    if (trackMatchesTableFilter(source[i], query)) rows.push({ track: source[i], sourceIndex: i });
  }
  return rows;
}

function buildPlaylistMembershipMap() {
  if (window._playlistMembership && window._playlistMembershipRevision === playlistMembershipRevision) {
    return window._playlistMembership;
  }
  var playlistMembership = new Map();
  state.playlists.forEach(function (p) {
    if (p.isSpecial || !p.tracks) return;
    p.tracks.forEach(function (t) {
      var filePath = getPlaylistTrackFilePath(t);
      var title = (t.title || t.Song || '').toLowerCase();
      var artist = (t.artist || t.Artist || '').toLowerCase();
      var album = (t.album || t.Album || '').toLowerCase();
      if (!filePath && (!title || !artist)) return;
      var key = filePath ? 'path::' + stripFileUrl(filePath) : 'meta::' + title + '::' + artist + '::' + album;
      if (!playlistMembership.has(key)) playlistMembership.set(key, []);
      playlistMembership.get(key).push(p);
    });
  });
  window._playlistMembership = playlistMembership;
  window._playlistMembershipRevision = playlistMembershipRevision;
  return playlistMembership;
}

function trackPlaylistMembershipKey(track) {
  if (!track) return '';
  var fp = track.matchedFile ? track.matchedFile.filePath : '';
  if (fp) return 'path::' + stripFileUrl(fp);
  return track.title && track.artist ? 'meta::' + track.title.toLowerCase() + '::' + track.artist.toLowerCase() + '::' + (track.album || '').toLowerCase() : '';
}

function getTrackPlaylistMembership(track) {
  var key = trackPlaylistMembershipKey(track);
  return key && window._playlistMembership ? (window._playlistMembership.get(key) || []) : [];
}

function getTrackRowFromEventTarget(target) {
  var row = target && target.closest ? target.closest('tr[data-track-index]') : null;
  var tbody = $('tracks-body');
  return row && tbody && row.parentNode === tbody ? row : null;
}

function getTrackFromTableRow(row) {
  var index = row ? parseInt(row.dataset.trackIndex, 10) : NaN;
  return !isNaN(index) && window._tracksSource ? window._tracksSource[index] : null;
}

function openTrackContextMenu(track, x, y, opener) {
  if (!track) return;
  currentContextMenuTrack = track;
  updateTrackContextDownloadState(track);
  positionContextMenu($('track-context-menu'), x, y, opener);
}

function toggleTrackLike(filePath, controlEl) {
  if (!filePath) return;
  var file = getLibraryIndex().byPath.get(filePath) || getLibraryIndex().byStrippedPath.get(stripFileUrl(filePath));
  if (!file || !toggleTrackLikeByIdentity({ matchedFile: file, title: file.title, artist: file.artist, trackMbid: file.trackMbid || file.recordingMbid })) return;
  var liked = isTrackLiked({ matchedFile: file, title: file.title, artist: file.artist, trackMbid: file.trackMbid || file.recordingMbid });
  if (controlEl) {
    var iconEl = controlEl.matches && controlEl.matches('button') ? controlEl.querySelector('i') : controlEl;
    if (iconEl) iconEl.className = liked ? 'ph-fill ph-heart' : 'ph ph-heart';
    if (controlEl.matches && controlEl.matches('button')) { controlEl.setAttribute('aria-pressed', liked ? 'true' : 'false'); controlEl.setAttribute('aria-label', liked ? 'Unlike track' : 'Like track'); }
  }
  if (state.currentPlayingTrack && state.currentPlayingTrack.matchedFile && state.currentPlayingTrack.matchedFile.filePath === filePath) updatePlayerUI();
  if (state.currentView === 'liked_songs') renderPlaylist('liked_songs');
}

function showTrackPlaylistsMenu(track, x, y, opener) {
  var menu = $('track-playlists-menu');
  var list = $('track-playlists-list');
  if (!menu || !list) return;
  var inPlaylists = getTrackPlaylistMembership(track);
  list.innerHTML = '';
  var fragment = document.createDocumentFragment();
  inPlaylists.forEach(function (p) {
    var item = document.createElement('button');
    item.type = 'button';
    item.className = 'menu-item';
    item.setAttribute('role', 'menuitem');
    item.innerHTML = '<i class="ph ph-music-notes" style="margin-right:8px;color:var(--text-subdued);"></i>' + esc(p.name);
    item.onclick = function () { hideAllContextMenus(); switchView(p.id); };
    fragment.appendChild(item);
  });
  list.appendChild(fragment);
  positionContextMenu(menu, x, y, opener);
}

function handleTrackTableClick(e) {
  var likeBtn = e.target.closest ? e.target.closest('.track-like-btn') : null;
  if (likeBtn) {
    var likeRow = getTrackRowFromEventTarget(likeBtn);
    if (!likeRow) return;
    e.stopPropagation();
    likeBtn.style.transform = 'scale(1.3)';
    setTimeout(function () { likeBtn.style.transform = ''; }, 200);
    toggleTrackLike(likeBtn.dataset.fp, likeBtn);
    return;
  }

  var playlistBtn = e.target.closest ? e.target.closest('.track-in-pl-btn') : null;
  if (playlistBtn) {
    var playlistRow = getTrackRowFromEventTarget(playlistBtn);
    var playlistTrack = getTrackFromTableRow(playlistRow);
    if (!playlistTrack) return;
    e.stopPropagation();
    showTrackPlaylistsMenu(playlistTrack, e.clientX, e.clientY, playlistBtn);
    return;
  }

  var optionsBtn = e.target.closest ? e.target.closest('.track-options-btn') : null;
  if (optionsBtn) {
    var optionsRow = getTrackRowFromEventTarget(optionsBtn);
    e.stopPropagation();
    openTrackContextMenu(getTrackFromTableRow(optionsRow), e.clientX, e.clientY, optionsBtn);
    return;
  }

  var row = getTrackRowFromEventTarget(e.target);
  var track = getTrackFromTableRow(row);
  if (!track || track.isDisabled) return;
  if (e.target.closest && (e.target.closest('button') || e.target.closest('.track-like-btn') || e.target.closest('.track-in-pl-btn'))) return;
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    var key = getTrackSelectionKey(track);
    if (!key) return;
    if (selectedTrackKeys.has(key)) { selectedTrackKeys.delete(key); row.classList.remove('track-selected'); }
    else { selectedTrackKeys.add(key); row.classList.add('track-selected'); }
  } else if (selectedTrackKeys.size) {
    clearTrackSelection();
  }
}

function handleTrackTableDblClick(e) {
  if (e.target.closest && (e.target.closest('button') || e.target.closest('.track-like-btn') || e.target.closest('.track-in-pl-btn'))) return;
  var row = getTrackRowFromEventTarget(e.target);
  var track = getTrackFromTableRow(row);
  if (!track || track.isDisabled) return;
  initAudioCtx();
  state.playQueueTracks = (window._tracksSource || state.currentTracks).slice();
  moveTrackToShuffleQueueStart(track);
  playTrack(track);
}

function handleTrackTableContextMenu(e) {
  var row = getTrackRowFromEventTarget(e.target);
  var track = getTrackFromTableRow(row);
  if (!track) return;
  e.preventDefault();
  var key = getTrackSelectionKey(track);
  if (key && selectedTrackKeys.size && !selectedTrackKeys.has(key)) clearTrackSelection();
  openTrackContextMenu(track, e.clientX, e.clientY, row);
}

function handleTrackTableKeyDown(e) {
  if (e.target && e.target.closest && e.target.closest('button, input, [contenteditable="true"]')) return;
  var row = getTrackRowFromEventTarget(e.target);
  var track = getTrackFromTableRow(row);
  if (!row || !track) return;
  if (e.altKey && window._tracksAllowReorder && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
    e.preventDefault();
    var fromIndex = parseInt(row.dataset.trackIndex, 10);
    var toIndex = fromIndex + (e.key === 'ArrowUp' ? -1 : 1);
    var playlist = state.playlists.find(function (p) { return p.id === state.currentView; });
    if (!playlist || toIndex < 0 || toIndex >= playlist.tracks.length) return;
    var previousTracks = playlist.tracks.slice();
    var previousSort = playlist.sortBy;
    var moved = playlist.tracks.splice(fromIndex, 1)[0];
    playlist.tracks.splice(toIndex, 0, moved);
    playlist.sortBy = 'Custom Order';
    persistPlaylists(state.playlists).then(function () {
      renderPlaylist(state.currentView);
      requestAnimationFrame(function () { var nextRow = $('tracks-body').querySelector('tr[data-track-index="' + toIndex + '"]'); if (nextRow) nextRow.focus(); });
    }).catch(function () {
      playlist.tracks = previousTracks;
      playlist.sortBy = previousSort;
      renderPlaylist(state.currentView);
    });
  } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
    e.preventDefault();
    openTrackContextMenu(track, 0, 0, row);
  } else if (e.key === 'Enter' && !track.isDisabled) {
    e.preventDefault();
    initAudioCtx();
    state.playQueueTracks = (window._tracksSource || state.currentTracks).slice();
    moveTrackToShuffleQueueStart(track);
    playTrack(track);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    var currentSourceIndex = parseInt(row.dataset.trackIndex, 10);
    var entries = window._trackRowsToRender || [];
    var entryIndex = entries.findIndex(function(entry) { return entry && entry.sourceIndex === currentSourceIndex; });
    var step = e.key === 'ArrowDown' ? 1 : -1;
    for (var nextIndex = entryIndex + step; entryIndex >= 0 && nextIndex >= 0 && nextIndex < entries.length; nextIndex += step) {
      var nextEntry = entries[nextIndex];
      if (nextEntry && nextEntry.track && !nextEntry.track.isDisabled) {
        focusTrackTableRowBySourceIndex(nextEntry.sourceIndex);
        break;
      }
    }
  }
}

function handleTrackTableDragStart(e) {
  var row = getTrackRowFromEventTarget(e.target);
  var track = getTrackFromTableRow(row);
  if (!track || track.isDisabled || !e.dataTransfer) { e.preventDefault(); return; }
  e.dataTransfer.setData('text/plain', JSON.stringify({ title: track.title, artist: track.artist, album: track.album, filePath: track.matchedFile ? track.matchedFile.filePath : '', sourcePlaylistId: getValidSourcePlaylistId(track.sourcePlaylistId) }));
  if (window._tracksAllowReorder) e.dataTransfer.setData('reorder-index', row.dataset.trackIndex);
  row.style.opacity = '0.5';
}

function handleTrackTableDragEnd(e) {
  var row = getTrackRowFromEventTarget(e.target);
  if (row) row.style.opacity = '';
}

function handleTrackTableDragOver(e) {
  if (!window._tracksAllowReorder) return;
  var row = getTrackRowFromEventTarget(e.target);
  if (!row) return;
  e.preventDefault();
  row.classList.add('drag-over');
}

function handleTrackTableDragLeave(e) {
  var row = getTrackRowFromEventTarget(e.target);
  if (row) row.classList.remove('drag-over');
}

async function handleTrackTableDrop(e) {
  if (!window._tracksAllowReorder) return;
  var row = getTrackRowFromEventTarget(e.target);
  if (!row || !e.dataTransfer) return;
  e.preventDefault();
  row.classList.remove('drag-over');
  var fromIndex = parseInt(e.dataTransfer.getData('reorder-index'), 10);
  var toIndex = parseInt(row.dataset.trackIndex, 10);
  if (isNaN(fromIndex) || isNaN(toIndex) || fromIndex === toIndex) return;
  var pl = state.playlists.find(function (p) { return p.id === state.currentView; });
  if (!pl) return;
  var previousTracks = pl.tracks.slice();
  var previousSort = pl.sortBy;
  var moved = pl.tracks.splice(fromIndex, 1)[0];
  pl.tracks.splice(toIndex, 0, moved);
  pl.sortBy = 'Custom Order';
  var mutatedTracks = pl.tracks.slice();
  try { await persistPlaylists(state.playlists); }
  catch (e) {
    var unchangedSinceMutation = pl.tracks.length === mutatedTracks.length && pl.tracks.every(function (track, index) { return track === mutatedTracks[index]; });
    if (unchangedSinceMutation) { pl.tracks = previousTracks; pl.sortBy = previousSort; }
  }
  renderPlaylist(state.currentView);
}

function ensureTrackTableDelegation(tbody) {
  if (!tbody || tbody._trackTableDelegated) return;
  tbody._trackTableDelegated = true;
  tbody.addEventListener('click', handleTrackTableClick);
  tbody.addEventListener('dblclick', handleTrackTableDblClick);
  tbody.addEventListener('contextmenu', handleTrackTableContextMenu);
  tbody.addEventListener('keydown', handleTrackTableKeyDown);
  tbody.addEventListener('dragstart', handleTrackTableDragStart);
  tbody.addEventListener('dragend', handleTrackTableDragEnd);
  tbody.addEventListener('dragover', handleTrackTableDragOver);
  tbody.addEventListener('dragleave', handleTrackTableDragLeave);
  tbody.addEventListener('drop', handleTrackTableDrop);
}

const TRACK_TABLE_VIRTUAL_ROW_HEIGHT = 70;
const TRACK_TABLE_VIRTUAL_OVERSCAN = 36;
const TRACK_TABLE_VIRTUAL_WINDOW = 120;
function appendVirtualTrackTableRow(fragment, entry) {
  var track = entry.track;
  var sourceIndex = entry.sourceIndex;
  var tr = document.createElement('tr');
  tr.dataset.trackIndex = String(sourceIndex);
  tr.setAttribute('aria-label', (track.title || 'Track') + ' by ' + (track.artist || 'Unknown Artist'));
  if (track.matchedFile && track.matchedFile.filePath) tr.dataset.filePath = stripFileUrl(track.matchedFile.filePath) || track.matchedFile.filePath;
  var selectionKey = getTrackSelectionKey(track);
  if (selectionKey && selectedTrackKeys.has(selectionKey)) tr.classList.add('track-selected');
  if (track.isDisabled) { tr.classList.add('disabled'); tr.setAttribute('aria-disabled', 'true'); }
  else { tr.style.cursor = 'pointer'; tr.draggable = true; tr.tabIndex = 0; }
  if (state.currentPlayingTrack && state.currentPlayingTrack.matchedFile && track.matchedFile && state.currentPlayingTrack.matchedFile.filePath === track.matchedFile.filePath) tr.classList.add('playing');
  var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
  var trackArtwork = track.matchedFile && track.matchedFile.picture ? track.matchedFile.picture : getTrackArtworkUrl(track);
  var pic = trackArtwork ? '<img src="' + esc(trackArtwork) + '" alt="Artwork for ' + esc(track.album || track.title || 'track') + '"' + lazy + ' class="track-img" />' : '<div class="track-img" aria-hidden="true" style="display:flex;align-items:center;justify-content:center;"><i class="ph ph-music-notes" style="color:var(--text-subdued);"></i></div>';
  var fp = track.matchedFile ? track.matchedFile.filePath : '';
  var liked = fp ? isTrackLiked(track) : false;
  var inPlaylists = getTrackPlaylistMembership(track);
  var streamOnly = !track.matchedFile && isRemotePlaybackTrack(track);
  var streamIndicator = streamOnly ? '<span class="track-stream-indicator" role="img" aria-label="Streamed from Radio — not downloaded" title="Streamed from Radio — not downloaded"><i class="ph ph-broadcast" aria-hidden="true"></i></span>' : '';
  tr.innerHTML = '<td style="width:20px;padding-left:8px;"></td>'
    + '<td class="col-num">' + (sourceIndex + 1) + '</td>'
    + '<td class="col-title"><div class="track-info">' + pic + '<div class="track-text"><div class="title">' + esc(track.title) + streamIndicator + '<button type="button" class="track-inline-action track-like-btn" data-fp="' + esc(fp) + '" aria-label="' + (liked ? 'Unlike' : 'Like') + ' track" aria-pressed="' + (liked ? 'true' : 'false') + '"><i class="' + (liked ? 'ph-fill ph-heart' : 'ph ph-heart') + '" aria-hidden="true"></i></button>' + (inPlaylists.length > 0 ? '<button type="button" class="track-inline-action track-in-pl-btn" aria-label="Show playlists containing this track"><i class="ph-fill ph-check-circle" aria-hidden="true"></i></button>' : '') + '</div><div class="artist">' + esc(track.artist) + '</div></div></div></td>'
    + '<td class="col-album">' + esc(track.album) + '</td>'
    + '<td class="col-duration">' + fmt(track.duration) + '</td>'
    + '<td style="width:40px;text-align:center;"><button class="icon-btn ghost track-options-btn" aria-label="More actions for ' + esc(track.title || 'track') + '"><i class="ph ph-dots-three" aria-hidden="true"></i></button></td>';
  fragment.appendChild(tr);
}
function appendVirtualTrackSpacer(fragment, height) {
  if (height <= 0) return;
  var spacer = document.createElement('tr');
  spacer.className = 'track-virtual-spacer';
  var cell = document.createElement('td');
  cell.colSpan = 6;
  cell.style.height = Math.round(height) + 'px';
  spacer.appendChild(cell);
  fragment.appendChild(spacer);
}

function renderTracksTable(allowReorder) {
  var tbody = $('tracks-body');
  if (!tbody) return;
  ensureTrackTableDelegation(tbody);
  tbody.innerHTML = '';
  var source = state.currentTracks || [];
  window._tracksSource = source;
  window._tracksRenderToken = (window._tracksRenderToken || 0) + 1;
  // A previous large-list view may have installed a virtual window renderer.
  // Clear it before every render so empty/non-virtual states cannot reuse it.
  window._tracksVirtualized = false;
  window.renderVirtualTracksWindow = null;
  if (!source.length) {
    window._tracksToRender = [];
    window._trackRowsToRender = [];
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-subdued);">No tracks</td></tr>';
    return;
  }
  var filterValue = trackTableFilterValue();
  var tableRows = buildTrackRowsForTable(source, filterValue);
  window._tracksToRender = tableRows.map(function (entry) { return entry.track; });
  window._trackRowsToRender = tableRows;
  window._tracksRenderIndex = 0;
  window._tracksRenderChunk = appSettings.virtualScrolling ? 60 : 80;
  window._tracksRenderAll = !appSettings.virtualScrolling;
  window._tracksAllowReorder = allowReorder;
  window._likedSongsSet = new Set(state.likedSongs);
  window._playlistMembership = buildPlaylistMembershipMap();
  window._tracksHasMultipleDiscs = !!(state.currentView && state.currentView.startsWith('album:') && albumHasMultipleDiscs(state.currentTracks));
  window._tracksVirtualized = !!(appSettings.virtualScrolling && !allowReorder && !window._tracksHasMultipleDiscs && tableRows.length > 300);
  if (window._tracksRenderFrame) {
    cancelAnimationFrame(window._tracksRenderFrame);
    window._tracksRenderFrame = null;
  }
  if (!tableRows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-subdued);">No matching tracks</td></tr>';
    return;
  }

  if (window._tracksVirtualized) {
    window._tracksVirtualStart = -1;
    window._tracksVirtualEnd = -1;
    window.renderVirtualTracksWindow = function(force) {
      var rows = window._trackRowsToRender;
      var tableBody = $('tracks-body');
      var contentArea = $('content-area');
      var table = tableBody && tableBody.closest('table');
      if (!rows || !tableBody || !contentArea || !table) return;
      var contentRect = contentArea.getBoundingClientRect();
      var tableRect = table.getBoundingClientRect();
      var tableTop = contentArea.scrollTop + tableRect.top - contentRect.top;
      var headerHeight = table.tHead ? table.tHead.getBoundingClientRect().height : 0;
      var firstVisible = Math.floor((contentArea.scrollTop - tableTop - headerHeight) / TRACK_TABLE_VIRTUAL_ROW_HEIGHT);
      var start = Math.max(0, firstVisible - TRACK_TABLE_VIRTUAL_OVERSCAN);
      var end = Math.min(rows.length, start + TRACK_TABLE_VIRTUAL_WINDOW);
      if (!force && start === window._tracksVirtualStart && end === window._tracksVirtualEnd) return;
      window._tracksVirtualStart = start;
      window._tracksVirtualEnd = end;
      var fragment = document.createDocumentFragment();
      appendVirtualTrackSpacer(fragment, start * TRACK_TABLE_VIRTUAL_ROW_HEIGHT);
      rows.slice(start, end).forEach(function(entry) { appendVirtualTrackTableRow(fragment, entry); });
      appendVirtualTrackSpacer(fragment, (rows.length - end) * TRACK_TABLE_VIRTUAL_ROW_HEIGHT);
      tableBody.replaceChildren(fragment);
    };
    window.renderVirtualTracksWindow(true);
    return;
  }
  window.renderVirtualTracksWindow = null;

  if (!window.renderTracksChunk) {
    window.renderTracksChunk = function(renderToken) {
      if (renderToken !== undefined && renderToken !== window._tracksRenderToken) return;
      if (!window._trackRowsToRender || window._tracksRenderIndex >= window._trackRowsToRender.length) return;
      var activeToken = window._tracksRenderToken;
      var rows = window._trackRowsToRender;
      var chunk = rows.slice(window._tracksRenderIndex, window._tracksRenderIndex + window._tracksRenderChunk);
      var tbody = $('tracks-body');
      if (!tbody) return;
      var fragment = document.createDocumentFragment();
      chunk.forEach(function (entry, i) {
        var renderIndex = window._tracksRenderIndex + i;
        var track = entry.track;
        var sourceIndex = entry.sourceIndex;
        var tr = document.createElement('tr');
        tr.dataset.trackIndex = String(sourceIndex);
        tr.setAttribute('aria-label', (track.title || 'Track') + ' by ' + (track.artist || 'Unknown Artist') + (window._tracksAllowReorder ? '. Use Alt plus Up or Down to reorder.' : ''));
        if (track.matchedFile && track.matchedFile.filePath) tr.dataset.filePath = stripFileUrl(track.matchedFile.filePath) || track.matchedFile.filePath;
        var selectionKey = getTrackSelectionKey(track);
        if (selectionKey && selectedTrackKeys.has(selectionKey)) tr.classList.add('track-selected');
        if (track.isDisabled) { tr.classList.add('disabled'); tr.setAttribute('aria-disabled', 'true'); }
        else { tr.style.cursor = 'pointer'; tr.draggable = true; tr.tabIndex = 0; }
        if (state.currentPlayingTrack && state.currentPlayingTrack.matchedFile && track.matchedFile && state.currentPlayingTrack.matchedFile.filePath === track.matchedFile.filePath) tr.classList.add('playing');
        var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
        var trackArtwork = track.matchedFile && track.matchedFile.picture ? track.matchedFile.picture : getTrackArtworkUrl(track);
        var pic = trackArtwork ? '<img src="' + esc(trackArtwork) + '" alt="Artwork for ' + esc(track.album || track.title || 'track') + '"' + lazy + ' class="track-img" />' : '<div class="track-img" aria-hidden="true" style="display:flex;align-items:center;justify-content:center;"><i class="ph ph-music-notes" style="color:var(--text-subdued);"></i></div>';
        var fp = track.matchedFile ? track.matchedFile.filePath : '';
        var liked = fp ? isTrackLiked(track) : false;
        var inPlaylists = getTrackPlaylistMembership(track);
        var streamOnly = !track.matchedFile && isRemotePlaybackTrack(track);
        var streamIndicator = streamOnly ? '<span class="track-stream-indicator" role="img" aria-label="Streamed from Radio — not downloaded" title="Streamed from Radio — not downloaded"><i class="ph ph-broadcast" aria-hidden="true"></i></span>' : '';
        var discNo = track.matchedFile ? getDiscNumber(track.matchedFile) : 1;
        var hasMultipleDiscs = window._tracksHasMultipleDiscs;
        var prevEntry = rows[renderIndex - 1];
        var prevTrack = prevEntry && prevEntry.track;
        var prevDiscNo = prevTrack && prevTrack.matchedFile ? getDiscNumber(prevTrack.matchedFile) : 1;
        if (hasMultipleDiscs && discNo && (!prevTrack || prevDiscNo !== discNo)) {
          var discRow = document.createElement('tr');
          discRow.className = 'disc-separator-row';
          discRow.innerHTML = '<td colspan="6"><span class="disc-separator-label"><i class="ph ph-vinyl-record"></i> Disc ' + esc(discNo) + '</span></td>';
          fragment.appendChild(discRow);
        }
        var displayNo = state.currentView && state.currentView.startsWith('album:') && track.matchedFile && track.matchedFile.trackNo ? track.matchedFile.trackNo : (sourceIndex + 1);
        tr.innerHTML = '<td style="width:20px;padding-left:8px;">' + (window._tracksAllowReorder ? '<i class="ph ph-dots-six-vertical drag-handle"></i>' : '') + '</td>'
          + '<td class="col-num">' + displayNo + '</td>'
          + '<td class="col-title"><div class="track-info">' + pic + '<div class="track-text"><div class="title">' + esc(track.title) + streamIndicator + '<button type="button" class="track-inline-action track-like-btn" data-fp="' + esc(fp) + '" aria-label="' + (liked ? 'Unlike' : 'Like') + ' track" aria-pressed="' + (liked ? 'true' : 'false') + '"><i class="' + (liked ? 'ph-fill ph-heart' : 'ph ph-heart') + '" aria-hidden="true"></i></button>' + (inPlaylists.length > 0 ? '<button type="button" class="track-inline-action track-in-pl-btn" aria-label="Show playlists containing this track"><i class="ph-fill ph-check-circle" aria-hidden="true"></i></button>' : '') + '</div><div class="artist">' + esc(track.artist) + '</div></div></div></td>'
          + '<td class="col-album">' + esc(track.album) + '</td>'
          + '<td class="col-duration">' + fmt(track.duration) + '</td>'
          + '<td style="width:40px;text-align:center;"><button class="icon-btn ghost track-options-btn" aria-label="More actions for ' + esc(track.title || 'track') + '"><i class="ph ph-dots-three" aria-hidden="true"></i></button></td>';
        fragment.appendChild(tr);
      });
      if (activeToken !== window._tracksRenderToken) return;
      tbody.appendChild(fragment);
      window._tracksRenderIndex += window._tracksRenderChunk;
      if (window._tracksRenderIndex < rows.length) {
        window._tracksRenderFrame = requestAnimationFrame(function () {
          if (activeToken !== window._tracksRenderToken) return;
          var contentArea = $('content-area');
          if (window._tracksRenderAll || (contentArea && contentArea.scrollHeight <= contentArea.clientHeight + 1)) window.renderTracksChunk(activeToken);
        });
      }
    };
  }
  window.renderTracksChunk(window._tracksRenderToken);
}

function renderPlaylistPreservingScroll(playlistId) {
  var ca = $('content-area');
  var scrollTop = ca ? ca.scrollTop : 0;
  var searchInput = $('playlist-track-search');
  var searchValue = searchInput ? searchInput.value : '';
  renderPlaylist(playlistId);
  requestAnimationFrame(function () {
    var nextSearch = $('playlist-track-search');
    if (nextSearch && searchValue) {
      nextSearch.value = searchValue;
      filterPlaylistTrackRows(searchValue);
    }
    var next = $('content-area');
    if (next) next.scrollTop = Math.min(scrollTop, Math.max(0, next.scrollHeight - next.clientHeight));
  });
}

function getNormalizationGain(track) {
  if (!appSettings.normalization || !track || !track.matchedFile) return 1;
  var f = track.matchedFile;
  var db = typeof f.replayGainTrackDb === 'number' ? f.replayGainTrackDb : f.replayGainAlbumDb;
  if (typeof db !== 'number' || isNaN(db)) return 1;
  var gain = Math.pow(10, db / 20);
  var peak = typeof f.replayGainTrackPeak === 'number' ? f.replayGainTrackPeak : f.replayGainAlbumPeak;
  if (typeof peak === 'number' && peak > 0 && gain * peak > 0.98) gain = 0.98 / peak;
  return Math.max(0.25, Math.min(2.5, gain));
}

async function analyzeTrackLoudness(file) {
  if (!file || !file.filePath || !window.api.getAudioFile) return null;
  var raw = await window.api.getAudioFile(stripFileUrl(file.filePath));
  if (!raw) return null;
  var bytes = raw instanceof ArrayBuffer ? raw : (raw.buffer ? raw.buffer.slice(raw.byteOffset || 0, (raw.byteOffset || 0) + raw.byteLength) : new Uint8Array(raw).buffer);
  var ctx = new (window.AudioContext || window.webkitAudioContext)();
  var decoded = await ctx.decodeAudioData(bytes.slice(0));
  var sum = 0, count = 0, peak = 0;
  for (var ch = 0; ch < decoded.numberOfChannels; ch++) {
    var data = decoded.getChannelData(ch);
    var step = Math.max(1, Math.floor(data.length / 300000));
    for (var i = 0; i < data.length; i += step) {
      var v = data[i];
      var av = Math.abs(v);
      if (av > peak) peak = av;
      sum += v * v;
      count++;
    }
  }
  if (ctx.close) ctx.close();
  var rms = Math.sqrt(sum / Math.max(1, count));
  var rmsDb = 20 * Math.log10(Math.max(rms, 0.000001));
  var targetDb = -18;
  var gainDb = Math.max(-18, Math.min(18, targetDb - rmsDb));
  file.replayGainTrackDb = gainDb;
  file.replayGainTrackPeak = peak || null;
  return { gainDb: gainDb, peak: peak };
}

async function analyzeLoudnessForFiles(files) {
  files = (files || []).filter(function (f) { return f && f.filePath; });
  if (!files.length) return;
  document.body.style.cursor = 'wait';
  var oldTitle = $('view-title') ? $('view-title').textContent : '';
  try {
    for (var i = 0; i < files.length; i++) {
      if (state.currentView === 'metadata_health') setTagHealthProgress(true, 'Analyzing loudness', i + 1, files.length, '');
      else if (files.length > 1) $('view-title').textContent = 'Analyzing loudness ' + (i + 1) + '/' + files.length;
      await analyzeTrackLoudness(files[i]);
    }
    markLibraryDirty();
    await persistLibrary(state.musicFiles);
    setTagHealthProgress(false, '', files.length, files.length, 'Loudness analysis complete for ' + files.length + ' track(s).');
    if (state.currentView === 'metadata_health') renderMetadataHealthView();
    showToast('Loudness analysis complete for ' + files.length + ' track(s).');
  } catch (e) {
    console.error(e);
    setTagHealthProgress(false, '', 0, files.length, 'Loudness analysis failed.');
    alert('Loudness analysis failed: ' + (e.message || e));
  } finally {
    document.body.style.cursor = '';
    if ($('view-title') && oldTitle) $('view-title').textContent = oldTitle;
  }
}

async function analyzeReplayGainBatch(files, batchSize) {
  batchSize = batchSize || 25;
  files = (files || []).filter(function (f) { return f && f.filePath && (f.replayGainTrackDb === null || f.replayGainTrackDb === undefined); }).slice(0, batchSize);
  if (!files.length) { setTagHealthProgress(false, '', 0, 0, 'No missing ReplayGain tracks in this batch.'); showToast('No missing ReplayGain tracks in this batch.'); return; }
  document.body.style.cursor = 'wait';
  var oldTitle = $('view-title') ? $('view-title').textContent : '';
  try {
    for (var i = 0; i < files.length; i++) {
      if (state.currentView === 'metadata_health') setTagHealthProgress(true, 'Analyzing ReplayGain batch', i + 1, files.length, '');
      else if ($('view-title')) $('view-title').textContent = 'Analyzing ReplayGain batch ' + (i + 1) + '/' + files.length;
      await analyzeTrackLoudness(files[i]);
      await new Promise(function (resolve) { setTimeout(resolve, 20); });
    }
    markLibraryDirty();
    await persistLibrary(state.musicFiles);
    setTagHealthProgress(false, '', files.length, files.length, 'Analyzed ' + files.length + ' track(s). Click Analyze Next Batch for the next batch.');
    if (state.currentView === 'metadata_health') renderMetadataHealthView();
    showToast('Analyzed ' + files.length + ' ReplayGain track(s).');
  } catch (e) {
    console.error(e);
    setTagHealthProgress(false, '', 0, files.length, 'ReplayGain batch failed.');
    alert('ReplayGain batch failed: ' + (e.message || e));
  } finally {
    document.body.style.cursor = '';
    if ($('view-title') && oldTitle && state.currentView !== 'metadata_health') $('view-title').textContent = oldTitle;
  }
}

async function analyzeAllMissingReplayGain() {
  var allMissing = state.musicFiles.filter(function (f) { return f && f.filePath && (f.replayGainTrackDb === null || f.replayGainTrackDb === undefined); });
  if (!allMissing.length) { setTagHealthProgress(false, '', 0, 0, 'No missing ReplayGain tracks found.'); showToast('No missing ReplayGain tracks found.'); return; }
  if (!confirm('Analyze ReplayGain for ' + allMissing.length + ' missing track(s)?\n\nThis runs in batches and may take a while for large libraries.')) return;
  var batchSize = 25;
  var done = 0;
  document.body.style.cursor = 'wait';
  var matchSnapshot = null;
  try {
    while (true) {
      var batch = state.musicFiles.filter(function (f) { return f && f.filePath && (f.replayGainTrackDb === null || f.replayGainTrackDb === undefined); }).slice(0, batchSize);
      if (!batch.length) break;
      for (var i = 0; i < batch.length; i++) {
        done++;
        if (state.currentView === 'metadata_health') setTagHealthProgress(true, 'Analyzing ReplayGain', done, allMissing.length, '');
        else if ($('view-title')) $('view-title').textContent = 'Analyzing ReplayGain ' + done + '/' + allMissing.length;
        await analyzeTrackLoudness(batch[i]);
        await new Promise(function (resolve) { setTimeout(resolve, 20); });
      }
      markLibraryDirty();
      await persistLibrary(state.musicFiles);
      if (state.currentView === 'metadata_health') renderMetadataHealthView();
      await new Promise(function (resolve) { setTimeout(resolve, 60); });
    }
    setTagHealthProgress(false, '', done, allMissing.length, 'ReplayGain analysis complete for ' + done + ' track(s).');
    if (state.currentView === 'metadata_health') renderMetadataHealthView();
    showToast('ReplayGain analysis complete for ' + done + ' track(s).');
  } catch (e) {
    console.error(e);
    setTagHealthProgress(false, '', done, allMissing.length, 'ReplayGain analysis failed after ' + done + ' track(s).');
    alert('ReplayGain analysis failed: ' + (e.message || e));
  } finally {
    document.body.style.cursor = '';
    if ($('view-title') && state.currentView === 'metadata_health') $('view-title').textContent = 'Tag Health';
  }
}

// Settings persistence stores tracks as light refs (path + display fields), not
// full objects with matchedFile, to keep the settings file small.
function toLightTrackRef(t) {
  if (!t) return null;
  ensureQueueEntryId(t);
  var fp = t.matchedFile ? t.matchedFile.filePath : t.filePath;
  var ref = { filePath: fp || null, title: t.title, artist: t.artist, album: t.album, duration: t.duration, queueEntryId: t.queueEntryId };
  if (typeof t.candidateId === 'string') ref.candidateId = t.candidateId;
  if (typeof t.trackMbid === 'string') ref.trackMbid = t.trackMbid;
  if (t.playback && t.playback.kind === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(t.playback.videoId || '')) {
    ref.playback = { kind: 'youtube', videoId: t.playback.videoId };
    ref.resolvedSource = 'youtube'; ref.playbackSource = 'youtube';
  }
  var sourcePlaylistId = getValidSourcePlaylistId(t.sourcePlaylistId);
  if (sourcePlaylistId) ref.sourcePlaylistId = sourcePlaylistId;
  var sourceRadio = normalizeSourceRadio(t.sourceRadio);
  if (sourceRadio) ref.sourceRadio = sourceRadio;
  return ref;
}
function hydrateTrackRef(ref) {
  if (!ref) return null;
  var fp = ref.matchedFile ? ref.matchedFile.filePath : ref.filePath;
  var idx = getLibraryIndex();
  var f = fp ? (idx.byPath.get(fp) || idx.byStrippedPath.get(stripFileUrl(fp))) : null;
  var sourceRadio = normalizeSourceRadio(ref.sourceRadio);
  if (ref.playback && ref.playback.kind === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(ref.playback.videoId || '')) {
    return { candidateId: typeof ref.candidateId === 'string' && ref.candidateId ? ref.candidateId : undefined, trackMbid: typeof ref.trackMbid === 'string' ? ref.trackMbid : '', title: ref.title || 'Unknown Track', artist: ref.artist || 'Unknown Artist', album: ref.album || '', duration: Number(ref.duration) || 0, playback: { kind: 'youtube', videoId: ref.playback.videoId }, resolvedSource: 'youtube', playbackSource: 'youtube', isDisabled: false, queueEntryId: typeof ref.queueEntryId === 'string' && ref.queueEntryId ? ref.queueEntryId : createQueueEntryId(), sourcePlaylistId: getValidSourcePlaylistId(ref.sourcePlaylistId), sourceRadio: sourceRadio };
  }
  if (f) return { matchedFile: f, title: f.title || ref.title, artist: f.artist || ref.artist, album: f.album || ref.album, duration: f.duration || ref.duration, isDisabled: false, queueEntryId: typeof ref.queueEntryId === 'string' && ref.queueEntryId ? ref.queueEntryId : createQueueEntryId(), sourcePlaylistId: getValidSourcePlaylistId(ref.sourcePlaylistId), sourceRadio: sourceRadio };
  if (ref.matchedFile) return ensureQueueEntryId(ref); // old full-object format, file no longer in library index
  return null;
}

function holdPlaybackGain(gainNode) {
  if (!audioCtx || !gainNode) return;
  var param = gainNode.gain;
  var now = audioCtx.currentTime;
  try {
    if (typeof param.cancelAndHoldAtTime === 'function') param.cancelAndHoldAtTime(now);
    else {
      var value = param.value;
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    }
  } catch (e) { }
}

function setPlaybackGain(gainNode, value, duration) {
  if (!gainNode) return;
  value = Number(value);
  if (!audioCtx) { gainNode.gain.value = value; return; }
  holdPlaybackGain(gainNode);
  if (duration > 0) gainNode.gain.linearRampToValueAtTime(value, audioCtx.currentTime + duration);
  else gainNode.gain.setValueAtTime(value, audioCtx.currentTime);
}

function cancelCrossfadeTransition(pauseInactive) {
  if (crossfadeStopTimer) clearTimeout(crossfadeStopTimer);
  crossfadeStopTimer = null;
  crossfadeActive = false;
  state.crossfadingNext = false;
  var list = window.audioEls || [];
  var gains = window.audioGainNodes || [];
  gains.forEach(holdPlaybackGain);
  if (pauseInactive) {
    list.forEach(function (audioEl, index) {
      if (index !== activeAudioIdx && audioEl && !audioEl.paused) audioEl.pause();
    });
  }
  var activeGain = gains[activeAudioIdx];
  if (activeGain) setPlaybackGain(activeGain, getNormalizationGain(state.currentPlayingTrack), 0.04);
}

function updatePlaybackMarkers() {
  var activeFile = state.currentPlayingTrack && state.currentPlayingTrack.matchedFile;
  var activePath = activeFile && activeFile.filePath ? stripFileUrl(activeFile.filePath) : '';
  var activeAlbumKey = activeFile ? getAlbumKey(activeFile) : '';
  document.querySelectorAll('.album-card[data-album-key]').forEach(function (card) {
    var active = !!activeAlbumKey && card.dataset.albumKey === activeAlbumKey;
    card.classList.toggle('playing', active);
    var icon = card.querySelector('.album-card-play-btn i');
    if (icon) icon.className = active && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
  });
  document.querySelectorAll('#tracks-body tr.playing').forEach(function (row) { row.classList.remove('playing'); });
  if (activePath) {
    document.querySelectorAll('#tracks-body tr[data-file-path]').forEach(function (row) {
      if (row.dataset.filePath === activePath) row.classList.add('playing');
    });
  }
  var albumPlayIcon = $('album-cover-play-btn');
  albumPlayIcon = albumPlayIcon ? albumPlayIcon.querySelector('i') : null;
  var albumHeader = $('album-detail-header');
  var displayedAlbumActive = !!(state.currentView && state.currentView.startsWith('album:') && albumHeader && activeAlbumKey && albumHeader.dataset.albumKey === activeAlbumKey);
  if (albumPlayIcon) albumPlayIcon.className = displayedAlbumActive && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
  document.querySelectorAll('#playlists-list .playlist-card').forEach(function (card) {
    card.classList.toggle('playing-source', card.id === state.sourcePlaylistId);
  });
  syncDockPlaylistStates();
}

function syncPlaybackStateUi() {
  updatePlayerUI();
  if (window.api.updateThumbar) window.api.updateThumbar(state.isPlaying);
  if (state.isPlaying && analyserNode && !visualizerFrame) drawVisualizer();
  updatePlaybackMarkers();
  if (npOverlayOpen) updateNowPlayingOverlay();
  if (isFullscreenQueueOpen()) renderFullscreenQueue({ preserveScroll: true });
}

function metadataPathIsLocked(filePath) {
  var normalized = stripFileUrl(filePath || '');
  return !!normalized && metadataWriteLockedPaths.has(normalized);
}

function isRemotePlaybackTrack(track) { return !!(track && track.playback && track.playback.kind === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(track.playback.videoId || '')); }
function releaseRadioLeaseFromAudio(audioEl) {
  if (!audioEl) return;
  var leaseId = audioEl._radioLeaseId;
  audioEl._radioLeaseId = '';
  audioEl._radioLeaseExpiresAt = 0;
  if (!leaseId) return;
  if (window.api && window.api.releaseRadioPlayback) window.api.releaseRadioPlayback(leaseId).catch(function () { });
}
function clearPreparedRadioSlot(release) {
  if (!preparedRadioSlot) return;
  var audio = window.audioEls && window.audioEls[preparedRadioSlot.audioIndex];
  if (release) releaseRadioLeaseFromAudio(audio);
  preparedRadioSlot = null;
}
function isPreparedRadioTrack(track, audioIndex) {
  var audio = window.audioEls && window.audioEls[audioIndex];
  return !!(preparedRadioSlot && preparedRadioSlot.audioIndex === audioIndex && preparedRadioSlot.queueEntryId === track.queueEntryId && preparedRadioSlot.ready && audio && (!audio._radioLeaseExpiresAt || audio._radioLeaseExpiresAt > Date.now() + 20000));
}
function getRemotePreparationKey(track, audioIndex, generation) {
  return [audioIndex, track && track.queueEntryId || '', track && track.playback && track.playback.videoId || '', generation].join('::');
}
function waitForRadioAudioReady(audioEl, generation) {
  if (audioEl.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) return Promise.resolve(true);
  return new Promise(function (resolve) {
    var done = false;
    var timer = setTimeout(function () { finish(false); }, 12000);
    function finish(value) { if (done) return; done = true; clearTimeout(timer); audioEl.removeEventListener('canplay', onReady); audioEl.removeEventListener('error', onError); resolve(value); }
    function onReady() { finish(audioEl._playbackGeneration === generation && (audioEl.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA || (audioEl.buffered && audioEl.buffered.length))); }
    function onError() { finish(false); }
    audioEl.addEventListener('canplay', onReady, { once: true }); audioEl.addEventListener('error', onError, { once: true });
  });
}
async function prepareRemoteTrackInSlot(track, audioIndex, generation) {
  if (!isRemotePlaybackTrack(track) || !playbackResolver || !window.audioEls || !window.audioEls[audioIndex]) return false;
  if (isPreparedRadioTrack(track, audioIndex)) return true;
  var key = getRemotePreparationKey(track, audioIndex, generation);
  if (!remotePreparationInFlight) return prepareRemoteTrackInSlotOwned(track, audioIndex, generation, key);
  return remotePreparationInFlight.run(audioIndex, key, function () { return prepareRemoteTrackInSlotOwned(track, audioIndex, generation, key); });
}
async function prepareRemoteTrackInSlotOwned(track, audioIndex, generation, key) {
  var session = state.radioSession;
  var requestId = nextRadioResolverRequestId(session);
  if (session) window.RadioResolverOwnership.registerRequest(session, requestId, 'transition');
  var audio = window.audioEls[audioIndex];
  try {
    releaseRadioLeaseFromAudio(audio);
    var prepared = await playbackResolver.preparePlayback(track, { requestId: requestId, ownership: { stationId: track.radioSessionId || 'manual', queueEntryId: track.queueEntryId, generation: generation } });
    var current = remotePreparationInFlight && remotePreparationInFlight.get(audioIndex);
    if ((remotePreparationInFlight && (!current || current.key !== key)) || (generation !== playbackGeneration && state.currentPlayingTrack !== track)) {
      if (prepared.leaseId && window.api.releaseRadioPlayback) window.api.releaseRadioPlayback(prepared.leaseId).catch(function () { });
      return false;
    }
    audio._playbackGeneration = generation;
    audio._radioLeaseId = prepared.leaseId || '';
    audio._radioLeaseExpiresAt = Number(prepared.expiresAt) || 0;
    audio.src = prepared.src;
    audio.preload = 'auto';
    audio.load();
    var ready = await waitForRadioAudioReady(audio, generation);
    current = remotePreparationInFlight && remotePreparationInFlight.get(audioIndex);
    if (!ready || (remotePreparationInFlight && (!current || current.key !== key))) { releaseRadioLeaseFromAudio(audio); return false; }
    preparedRadioSlot = { audioIndex: audioIndex, queueEntryId: track.queueEntryId, stationId: track.radioSessionId || '', generation: generation, ready: true };
    return true;
  } catch (error) {
    console.warn('Could not prepare radio stream:', error && error.message ? error.message : error);
    releaseRadioLeaseFromAudio(audio);
    return false;
  } finally {
    if (session) window.RadioResolverOwnership.unregisterRequest(session, requestId, 'transition');
  }
}
function prepareNextRadioTrack() {
  var selection = getNextTrackSelection();
  if (!selection || !isRemotePlaybackTrack(selection.track)) return;
  var target = 1 - activeAudioIdx;
  if (isPreparedRadioTrack(selection.track, target)) return;
  var generation = playbackGeneration;
  var delayed = setTimeout(function () { if (generation === playbackGeneration && state.currentPlayingTrack) { radioUiState.preparation = 'Preparing next track…'; if (state.currentView === 'radio') renderRadioView(); } }, 700);
  prepareRemoteTrackInSlot(selection.track, target, generation).then(function () {
    clearTimeout(delayed); if (generation === playbackGeneration) { radioUiState.preparation = ''; if (state.currentView === 'radio') renderRadioView(); }
  });
}

async function playTrack(track, options) {
  options = options || {};
  if (!track || (!track.matchedFile && !isRemotePlaybackTrack(track))) return false;
  var radioSessionToClose = state.radioSession && track.radioSessionId !== state.radioSession.stationId && !options.preserveRadioSession ? state.radioSession : null;
  if (track.matchedFile && metadataPathIsLocked(track.matchedFile.filePath)) { showToast('Wait for metadata writing to finish for this track.'); return false; }
  var generation = ++playbackGeneration;
  playbackTransitionPending = true;
  pendingPlaybackTrack = track;
  // A manual Next/Previous invalidates only an obsolete stream preparation.
  // Candidate-to-queue fill belongs to the station and must survive it.
  if (!options.automaticAdvance && state.radioSession) cancelRadioResolverRequests(state.radioSession, 'transition');
  // A direct selection starts a new listening session, even when the caller
  // passes the same track object again (for example, replay from History).
  pauseLastfmScrobbleCycle(true);
  try { initAudioCtx(); } catch (e) { console.error(e); }

  if (!window.audioEls) window.audioEls = [$('audio-player-0'), $('audio-player-1')];
  invalidateRestoredPlaybackPreparation();
  cancelCrossfadeTransition(true);
  var previousIndex = activeAudioIdx;
  var nextIndex = 1 - previousIndex;
  var prevAudio = window.audioEls[previousIndex];
  var nextAudio = window.audioEls[nextIndex];
  var prevGain = window.audioGainNodes ? window.audioGainNodes[previousIndex] : null;
  var nextGain = window.audioGainNodes ? window.audioGainNodes[nextIndex] : null;
  var targetGain = getNormalizationGain(track);
  var cfDuration = Math.max(0, parseInt(appSettings.crossfade || 0, 10) || 0);
  var shouldCrossfade = cfDuration > 0 && prevAudio && !prevAudio.paused && audioCtx && nextGain && prevGain;

  nextAudio._playbackGeneration = generation;
  if (!nextAudio.paused) nextAudio.pause();
  var reusePrepared = isRemotePlaybackTrack(track) && isPreparedRadioTrack(track, nextIndex);
  if (isRemotePlaybackTrack(track) && !reusePrepared) {
    var feedbackToken = setPlaybackFeedback(options.selectedQueueTrack ? 'Preparing selected track…' : 'Switching track…', false);
    radioUiState.preparation = 'Preparing track…'; if (state.currentView === 'radio') renderRadioView();
    if (!await prepareRemoteTrackInSlot(track, nextIndex, generation)) {
      if (feedbackToken === playbackFeedbackToken) setPlaybackFeedback('', false);
      radioUiState.preparation = ''; playbackTransitionPending = false; pendingPlaybackTrack = null; return false;
    }
    if (feedbackToken === playbackFeedbackToken) setPlaybackFeedback('', false);
    radioUiState.preparation = '';
  } else if (!isRemotePlaybackTrack(track)) {
    releaseRadioLeaseFromAudio(nextAudio);
    nextAudio.src = toFileUrl(track.matchedFile.filePath);
    nextAudio.load();
  }
  if (nextGain) setPlaybackGain(nextGain, shouldCrossfade ? 0 : targetGain, 0);

  try {
    await nextAudio.play();
  } catch (e) {
    if (generation !== playbackGeneration || nextAudio._playbackGeneration !== generation) return false;
    console.error(e);
    nextAudio.pause();
    playbackTransitionPending = false;
    pendingPlaybackTrack = null;
    state.crossfadingNext = false;
    state.isPlaying = !!(prevAudio && !prevAudio.paused);
    if (prevGain) setPlaybackGain(prevGain, getNormalizationGain(state.currentPlayingTrack), 0.06);
    syncPlaybackStateUi();
    showToast('Could not play ' + (track.title || 'the selected track') + '.');
    return false;
  }

  if (generation !== playbackGeneration || nextAudio._playbackGeneration !== generation) {
    if (nextAudio._playbackGeneration === generation) nextAudio.pause();
    return false;
  }

  activeAudioIdx = nextIndex;
  if (state.radioSession) state.radioSession.awaitingNextPlayable = null;
  if (reusePrepared || isRemotePlaybackTrack(track)) preparedRadioSlot = null;
  if (radioSessionToClose && state.radioSession === radioSessionToClose) disposeRadioSession();
  var shouldCancelPendingStart = window.RadioQueueHelpers && window.RadioQueueHelpers.shouldCancelPendingRadioStart
    ? window.RadioQueueHelpers.shouldCancelPendingRadioStart(options)
    : !options.automaticAdvance;
  if (!options.preserveRadioSession && shouldCancelPendingStart) cancelPendingRadioStart();
  var previousTrack = state.currentPlayingTrack;
  if (state.radioSession && previousTrack && previousTrack !== track) rememberPlayedRadioTrack(state.radioSession, previousTrack);
  state.currentPlayingTrack = track;
  if (isRemotePlaybackTrack(track) && Number(track._restoredPosition) > 0 && Number.isFinite(nextAudio.duration)) {
    try { nextAudio.currentTime = Math.min(Math.max(0, Number(track._restoredPosition)), Math.max(0, nextAudio.duration - .25)); } catch (_) { }
    delete track._restoredPosition;
  }
  state.currentPlaybackPreservesQueueCursors = !!options.preserveQueueCursors;
  state.currentRadioHistoryPlayback = !!options.radioHistoryPlayback;
  state.sourcePlaylistId = getValidSourcePlaylistId(track.sourcePlaylistId);
  state.isPlaying = true;
  state.crossfadingNext = false;
  playbackTransitionPending = false;
  pendingPlaybackTrack = null;
  crossfadeSuppressedTrack = null;
  clearInterval(_npSlideshowTimer);
  _npSlideshowTimer = null;
  state.npSlideImages = [];
  state._lastStatsTime = null;
  state.playHistory.push(track);
  if (state.playHistory.length > 50) state.playHistory.shift();
  appSettings.playHistory = state.playHistory.map(toLightTrackRef).filter(Boolean);
  if (window.api.recordKnownTrackPlay) {
    window.api.recordKnownTrackPlay({ artist: track.artist || '', title: track.title || '', mbid: track.trackMbid || '' }).catch(function (error) {
      console.warn('Could not record known track:', error);
    });
  }

  if (state.isShuffle && !state.shuffleQueue.length) {
    rebuildShuffleQueueForMode();
  }
  syncSavedQueuePaths();
  saveSettingsDebounced(500);

  if (shouldCrossfade) {
    crossfadeActive = true;
    setPlaybackGain(nextGain, targetGain, cfDuration);
    setPlaybackGain(prevGain, 0, cfDuration);
    crossfadeStopTimer = setTimeout(function () {
      if (generation !== playbackGeneration) return;
      if (prevAudio && prevAudio !== window.audioEls[activeAudioIdx]) { prevAudio.pause(); releaseRadioLeaseFromAudio(prevAudio); }
      crossfadeStopTimer = null;
      crossfadeActive = false;
    }, cfDuration * 1000);
  } else {
    if (prevAudio && prevAudio !== nextAudio) { prevAudio.pause(); releaseRadioLeaseFromAudio(prevAudio); }
    if (prevGain) setPlaybackGain(prevGain, 0, 0);
    if (nextGain) setPlaybackGain(nextGain, targetGain, 0);
  }

  if (state.sourcePlaylistId && state.sourcePlaylistId.startsWith('pl_')) {
    var activePl = state.playlists.find(function (p) { return p.id === state.sourcePlaylistId; });
    if (activePl) { activePl.lastPlayed = new Date().toISOString(); persistInBackground(persistPlaylists(state.playlists)); renderSidebarPlaylists(); }
  } else if (state.sourcePlaylistId === 'liked_songs') {
    localStorage.setItem('likedSongsLastPlayed', new Date().toISOString());
    renderSidebarPlaylists();
  }

  recordPlayStat(track);
  maybeRefillRadioQueue();
  prepareNextRadioTrack();
  syncPlaybackStateUi();
  if (isQueueOpen) renderQueue();
  if (lyricsOpen) fetchLyricsForTrack(track);
  if (npOverlayOpen) { updateNowPlayingOverlay(); fetchLyricsForTrack(track).then(function () { if (generation === playbackGeneration) mirrorLyricsToNP(); }); }
  // Discord Rich Presence
  if (appSettings.discordRpc && window.api.discordUpdate) {
    window.api.discordUpdate(track.title, track.artist, track.album, Date.now());
  }
  // Album cover slideshow: scan folder for extra images
  if (npOverlayOpen && track.matchedFile && track.matchedFile.filePath) {
    var trackFolder = track.matchedFile.filePath.replace(/[^\\/\\\\]+$/, '');
    window.api.scanFolderImages(trackFolder).then(function (imgs) {
      if (generation !== playbackGeneration || state.currentPlayingTrack !== track) return;
      if (_npFolderImageCache.size >= 100) {
        var oldestFolder = _npFolderImageCache.keys().next().value;
        _npFolderImageCache.delete(oldestFolder);
        _npFolderImageCacheTimes.delete(oldestFolder);
      }
      _npFolderImageCache.set(trackFolder, imgs);
      _npFolderImageCacheTimes.set(trackFolder, Date.now());
      state.npSlideImages = imgs;
      state.npSlideIdx = 0;
      startNPSlideshow();
    });
  }
  if (appSettings.notifications !== false) {
    if (Notification.permission === 'granted') new Notification(track.title, { body: track.artist, silent: true });
    else if (Notification.permission !== 'denied') Notification.requestPermission().then(function (p) { if (p === 'granted' && generation === playbackGeneration) new Notification(track.title, { body: track.artist, silent: true }); });
  }

  triggerLastfmScrobbleCycle(track);
  return true;
}

function triggerLastfmScrobbleCycle(track) {
  if (!appSettings.lastfmConnected || !track) return;
  var now = Date.now();
  var progress = state.scrobbleProgress;
  if (!progress || progress.track !== track) {
    progress = state.scrobbleProgress = { track: track, startedAtSeconds: Math.floor(now / 1000), listenedMs: 0, resumedAtMs: now, scrobbled: false };
    window.api.lastfmUpdateNowPlaying(track.artist, track.title);
  } else if (!progress.resumedAtMs) {
    progress.resumedAtMs = now;
  }
  clearTimeout(state.scrobbleTimer);
  if (progress.scrobbled) return;
  var threshold = Math.max(10000, Math.min((track.duration || 120) * 500, 240000));
  var remaining = Math.max(0, threshold - progress.listenedMs);
  state.scrobbleTimer = setTimeout(function () {
    if (state.currentPlayingTrack !== track || !state.isPlaying) return;
    pauseLastfmScrobbleCycle(false);
    if (progress.scrobbled || progress.listenedMs < threshold) { triggerLastfmScrobbleCycle(track); return; }
    progress.scrobbled = true;
    window.api.lastfmScrobble(track.artist, track.title, progress.startedAtSeconds);
  }, Math.max(1, remaining));
}

function pauseLastfmScrobbleCycle(reset) {
  clearTimeout(state.scrobbleTimer);
  var progress = state.scrobbleProgress;
  if (progress && progress.resumedAtMs) {
    progress.listenedMs += Math.max(0, Date.now() - progress.resumedAtMs);
    progress.resumedAtMs = 0;
  }
  if (reset) state.scrobbleProgress = null;
}

async function togglePlay() {
  var audio = window.audioEls ? window.audioEls[activeAudioIdx] : $('audio-player-0');
  if (playbackTransitionPending) { stopPlaybackState(); return; }
  if (!state.currentPlayingTrack) return;
  if (state.currentPlayingTrack.matchedFile && metadataPathIsLocked(state.currentPlayingTrack.matchedFile.filePath)) { showToast('Wait for metadata writing to finish for this track.'); return; }
  initAudioCtx();
  if (!state.isPlaying && isRemotePlaybackTrack(state.currentPlayingTrack) && (!audio.src || !audio._radioLeaseId)) {
    await playTrack(state.currentPlayingTrack, { preserveRadioSession: true, preserveQueueCursors: state.currentPlaybackPreservesQueueCursors });
    return;
  }
  if (!audio.src || audio.src.endsWith(window.location.pathname) || audio.src === '') {
    if (state.currentPlayingTrack.matchedFile && state.currentPlayingTrack.matchedFile.filePath) {
      audio.src = toFileUrl(state.currentPlayingTrack.matchedFile.filePath);
    }
  }
  if (state.isPlaying) {
    playbackTransitionPending = false;
    cancelCrossfadeTransition(false);
    state.isPlaying = false;
    (window.audioEls || [audio]).forEach(function (audioEl) { if (audioEl && !audioEl.paused) audioEl.pause(); });
    pauseLastfmScrobbleCycle(false);
  } else {
    var generation = ++playbackGeneration;
    playbackTransitionPending = true;
    cancelCrossfadeTransition(true);
    var activeGain = window.audioGainNodes ? window.audioGainNodes[activeAudioIdx] : null;
    if (activeGain) setPlaybackGain(activeGain, getNormalizationGain(state.currentPlayingTrack), 0.04);
    try {
      await audio.play();
      if (generation !== playbackGeneration) return;
      playbackTransitionPending = false;
      state.isPlaying = true;
      triggerLastfmScrobbleCycle(state.currentPlayingTrack);
    } catch (e) {
      console.error(e);
      if (generation !== playbackGeneration) return;
      playbackTransitionPending = false;
      state.isPlaying = false;
    }
  }
  checkpointPlaybackSession(audio, 200);
  syncPlaybackStateUi();
}
// shuffleMode: 0=off, 1=random shuffle, 2=smart shuffle (no same-artist back-to-back, avoid recent)
function buildSmartShuffleQueue() {
  var tracks = state.playQueueTracks.filter(function(t) { return !t.isDisabled; });
  if (!tracks.length) { state.shuffleQueue = []; return; }
  // Group by artist
  var byArtist = Object.create(null);
  tracks.forEach(function(t) {
    var a = (t.artist || 'Unknown').toLowerCase();
    if (!byArtist[a]) byArtist[a] = [];
    byArtist[a].push(t);
  });
  // Shuffle within each artist group
  Object.values(byArtist).forEach(function(arr) { arr.sort(function() { return Math.random() - 0.5; }); });
  // Interleave artists so same artist never appears consecutively
  var artistQueues = Object.values(byArtist).sort(function() { return Math.random() - 0.5; });
  var result = [];
  var previousArtist = state.currentPlayingTrack ? (state.currentPlayingTrack.artist || '').toLowerCase() : '';
  var maxIter = tracks.length * 3;
  while (result.length < tracks.length && maxIter-- > 0) {
    for (var i = 0; i < artistQueues.length && result.length < tracks.length; i++) {
      if (artistQueues[i].length > 0) {
        var candidate = artistQueues[i][0];
        var lastArtist = result.length > 0 ? (result[result.length-1].artist||'').toLowerCase() : previousArtist;
        if ((candidate.artist||'').toLowerCase() !== lastArtist || artistQueues.every(function(q) { return q.length === 0 || (result.length > 0 && (q[0].artist||'').toLowerCase() === lastArtist); })) {
          result.push(artistQueues[i].shift());
        }
      }
    }
  }
  // Add any remaining (shouldn't happen but safety)
  artistQueues.forEach(function(q) { q.forEach(function(t) { if (result.indexOf(t) === -1) result.push(t); }); });
  state.shuffleQueue = result;
}

function toggleShuffle() {
  // Cycle: 0=off, 1=shuffle, 2=smart shuffle, 0=off.
  state.shuffleMode = ((state.shuffleMode || 0) + 1) % 3;
  state.isShuffle = state.shuffleMode > 0;
  state.shuffleQueue = [];
  if (state.isShuffle) {
    rebuildShuffleQueueForMode();
    moveTrackToShuffleQueueStart(state.currentPlayingTrack);
  }
  syncSavedQueuePaths();
  saveSettingsDebounced(300);
  if (isQueueOpen) renderQueue();
  syncTransportControls();
  syncMpris(false);
}
function cycleLoop() { state.loopMode = (state.loopMode + 1) % 3; checkpointPlaybackSession(null, 300); syncTransportControls(); syncMpris(false); }
function setShuffleEnabled(enabled) {
  enabled = !!enabled;
  state.shuffleMode = enabled ? (state.shuffleMode || 1) : 0;
  state.isShuffle = enabled;
  state.shuffleQueue = [];
  if (state.isShuffle) {
    rebuildShuffleQueueForMode();
    moveTrackToShuffleQueueStart(state.currentPlayingTrack);
  }
  syncSavedQueuePaths();
  saveSettingsDebounced(300);
  if (isQueueOpen) renderQueue();
  syncTransportControls();
  syncMpris(false);
}
function setLoopStatus(status) {
  var loopModes = { None: 0, Playlist: 1, Track: 2 };
  if (!Object.prototype.hasOwnProperty.call(loopModes, status)) return;
  state.loopMode = loopModes[status];
  checkpointPlaybackSession(null, 300);
  syncTransportControls();
  syncMpris(false);
}

function syncTransportControls() {
  var playing = !!state.isPlaying;
  [['btn-play', 'play-icon'], ['np-btn-play', 'np-play-icon']].forEach(function (ids) {
    var button = $(ids[0]); var icon = $(ids[1]);
    if (button) button.setAttribute('aria-label', playing ? 'Pause' : 'Play');
    if (icon) icon.className = playing ? 'ph ph-pause-circle' : 'ph ph-play-circle';
  });
  var shuffleMode = state.shuffleMode || (state.isShuffle ? 1 : 0);
  var shuffleState = shuffleMode === 2
    ? { mode: 'smart', label: 'SMART', name: 'Smart', next: 'Off', icon: 'ph-sparkle' }
    : (shuffleMode === 1
      ? { mode: 'random', label: 'RANDOM', name: 'Random', next: 'Smart', icon: 'ph-shuffle' }
      : { mode: 'off', label: 'OFF', name: 'Off', next: 'Random', icon: 'ph-shuffle' });
  ['btn-shuffle', 'np-btn-shuffle'].forEach(function (id) {
    var button = $(id); if (!button) return;
    button.dataset.mode = shuffleState.mode;
    button.setAttribute('aria-label', 'Shuffle mode: ' + shuffleState.name + '. Activate for ' + shuffleState.next + '.');
    button.setAttribute('aria-pressed', shuffleMode ? 'true' : 'false');
    button.title = 'Shuffle: ' + shuffleState.name + ' (next: ' + shuffleState.next + ')';
    var icon = button.querySelector('.playback-mode-icon i');
    if (icon) icon.className = 'ph ' + shuffleState.icon;
    var label = button.querySelector('.playback-mode-label');
    if (label) label.textContent = shuffleState.label;
  });
  var repeatState = state.loopMode === 2
    ? { mode: 'one', label: 'ONE', name: 'One', next: 'Off', icon: 'ph-repeat-once' }
    : (state.loopMode === 1
      ? { mode: 'all', label: 'ALL', name: 'All', next: 'One', icon: 'ph-repeat' }
      : { mode: 'off', label: 'OFF', name: 'Off', next: 'All', icon: 'ph-repeat' });
  ['btn-loop', 'np-btn-loop'].forEach(function (id) {
    var button = $(id); if (!button) return;
    button.dataset.mode = repeatState.mode;
    button.setAttribute('aria-label', 'Repeat mode: ' + repeatState.name + '. Activate for ' + repeatState.next + '.');
    button.setAttribute('aria-pressed', state.loopMode ? 'true' : 'false');
    button.title = 'Repeat: ' + repeatState.name + ' (next: ' + repeatState.next + ')';
    var icon = button.querySelector('.playback-mode-icon i');
    if (icon) icon.className = 'ph ' + repeatState.icon;
    var label = button.querySelector('.playback-mode-label');
    if (label) label.textContent = repeatState.label;
  });
  var track = state.currentPlayingTrack;
  var liked = !!(track && isTrackLiked(track));
  [['btn-like', 'like-icon'], ['np-btn-like', 'np-like-icon']].forEach(function (ids) {
    var button = $(ids[0]); var icon = $(ids[1]);
    if (button) { button.disabled = !track || !likedIdentity(track); button.setAttribute('aria-label', liked ? 'Unlike current track' : 'Like current track'); button.setAttribute('aria-pressed', liked ? 'true' : 'false'); }
    if (icon) { icon.className = liked ? 'ph-fill ph-heart' : 'ph ph-heart'; icon.style.color = liked ? 'var(--accent)' : ''; }
  });
}

function getPlaybackTrackKey(track) {
  if (!track) return '';
  var filePath = track.matchedFile ? track.matchedFile.filePath : track.filePath;
  return filePath || [track.title || '', track.artist || '', track.album || ''].join('::');
}

function likedIdentity(track) {
  var mbid = String(track && (track.trackMbid || track.recordingMbid || track.mbid || track.matchedFile && (track.matchedFile.trackMbid || track.matchedFile.recordingMbid)) || '').trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(mbid)) return 'mbid:' + mbid;
  var clean = function (value) { return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); };
  var artist = clean(track && (track.artist || track.matchedFile && track.matchedFile.artist)); var title = clean(track && (track.title || track.name || track.matchedFile && track.matchedFile.title));
  return artist && title ? 'name:' + artist + '::' + title : '';
}
function likedRecordMatches(record, track) {
  if (typeof record === 'string') return !!(track && track.matchedFile && record === track.matchedFile.filePath);
  return !!(record && typeof record === 'object' && record.identity && record.identity === likedIdentity(track));
}
function isTrackLiked(track) { return state.likedSongs.some(function (record) { return likedRecordMatches(record, track); }); }
function makeRemoteLikedRecord(track) {
  return { version: 1, identity: likedIdentity(track), title: String(track.title || '').slice(0, 2000), artist: String(track.artist || '').slice(0, 2000), album: String(track.album || '').slice(0, 2000), duration: Math.max(0, Number(track.duration) || 0), trackMbid: String(track.trackMbid || track.recordingMbid || '').slice(0, 80), videoId: String(track.playback && track.playback.videoId || '').slice(0, 11), playbackSource: 'youtube', artwork: typeof track.artwork === 'string' ? track.artwork.slice(0, 4096) : '', dateAdded: new Date().toISOString() };
}
function toggleTrackLikeByIdentity(track) {
  if (!track || !likedIdentity(track)) return false;
  var index = state.likedSongs.findIndex(function (record) { return likedRecordMatches(record, track); });
  if (index !== -1) state.likedSongs.splice(index, 1);
  else if (track.matchedFile) state.likedSongs.push(track.matchedFile.filePath);
  else if (isRemotePlaybackTrack(track)) state.likedSongs.push(makeRemoteLikedRecord(track));
  else return false;
  window._likedSongsSet = new Set(state.likedSongs.filter(function (item) { return typeof item === 'string'; }));
  persistInBackground(persistLikedSongs(state.likedSongs));
  return true;
}

function getNextTrackSelection(skippedKeys) {
  skippedKeys = skippedKeys || new Set();
  if (state.userQueue && state.userQueue.length > 0) {
    var pendingQueueIndex = pendingPlaybackTrack ? state.userQueue.indexOf(pendingPlaybackTrack) : -1;
    for (var uq = pendingQueueIndex + 1; uq < state.userQueue.length; uq++) {
      if (!skippedKeys.has(getPlaybackTrackKey(state.userQueue[uq]))) return { track: state.userQueue[uq], userQueue: true, userQueueIndex: uq, consumeQueuePrefix: pendingQueueIndex >= 0, rebuildShuffle: false };
    }
  }
  var baseTrack = pendingPlaybackTrack || state.currentPlayingTrack;
  var preferCursor = !pendingPlaybackTrack && state.currentPlaybackPreservesQueueCursors;
  if (state.isShuffle) {
    if (!state.shuffleQueue.length) rebuildShuffleQueueForMode();
    var si = preferCursor ? -1 : findTrackIndexByIdentity(state.shuffleQueue, baseTrack);
    if (si === -1) si = findTrackIndexByIdentity(state.shuffleQueue, state.shuffleQueueCursor);
    for (var shuffleIndex = si + 1; shuffleIndex < state.shuffleQueue.length; shuffleIndex++) {
      if (!state.shuffleQueue[shuffleIndex].isDisabled && !skippedKeys.has(getPlaybackTrackKey(state.shuffleQueue[shuffleIndex]))) return { track: state.shuffleQueue[shuffleIndex], userQueue: false, rebuildShuffle: false };
    }
    var availableShuffle = state.shuffleQueue.filter(function (t) { return !t.isDisabled && !skippedKeys.has(getPlaybackTrackKey(t)); });
    var mayWrapShuffle = window.RadioQueueHelpers && window.RadioQueueHelpers.shouldWrapQueueAtTail
      ? window.RadioQueueHelpers.shouldWrapQueueAtTail(!!state.radioSession, baseTrack, state.radioSession && state.radioSession.stationId, state.loopMode)
      : !(state.radioSession && baseTrack && baseTrack.radioSessionId === state.radioSession.stationId) && state.loopMode >= 1;
    if (mayWrapShuffle && availableShuffle.length) return { track: availableShuffle[0], userQueue: false, rebuildShuffle: true };
    return null;
  }
  var i = preferCursor ? -1 : findTrackIndexByIdentity(state.playQueueTracks, baseTrack);
  if (i === -1) i = findTrackIndexByIdentity(state.playQueueTracks, state.playQueueCursor);
  for (var queueIndex = i + 1; queueIndex < state.playQueueTracks.length; queueIndex++) {
    var queuedTrack = state.playQueueTracks[queueIndex];
    if (!queuedTrack.isDisabled && !skippedKeys.has(getPlaybackTrackKey(queuedTrack))) return { track: queuedTrack, userQueue: false, rebuildShuffle: false };
  }
  var v = state.playQueueTracks.filter(function (t) { return !t.isDisabled && !skippedKeys.has(getPlaybackTrackKey(t)); });
  var mayWrap = window.RadioQueueHelpers && window.RadioQueueHelpers.shouldWrapQueueAtTail
    ? window.RadioQueueHelpers.shouldWrapQueueAtTail(!!state.radioSession, baseTrack, state.radioSession && state.radioSession.stationId, state.loopMode)
    : !(state.radioSession && baseTrack && baseTrack.radioSessionId === state.radioSession.stationId) && state.loopMode >= 1;
  if (mayWrap && v.length) return { track: v[0], userQueue: false, rebuildShuffle: false };
  return null;
}

async function playNextTrack(options) {
  options = options || {};
  var skippedKeys = new Set();
  if (options.failedTrack) skippedKeys.add(getPlaybackTrackKey(options.failedTrack));
  var maxAttempts = Math.max(1, (state.userQueue || []).length + state.playQueueTracks.length);
  for (var attempt = 0; attempt < maxAttempts; attempt++) {
    var selection = getNextTrackSelection(skippedKeys);
    if (!selection || !selection.track) break;
    if (selection.rebuildShuffle) {
      rebuildShuffleQueueForMode();
      var currentKey = getPlaybackTrackKey(pendingPlaybackTrack || state.currentPlayingTrack);
      var cycleCandidates = state.shuffleQueue.filter(function (track) { return !track.isDisabled && !skippedKeys.has(getPlaybackTrackKey(track)); });
      var cycleTrack = cycleCandidates.find(function (track) { return getPlaybackTrackKey(track) !== currentKey; }) || cycleCandidates[0];
      if (!cycleTrack) break;
      selection = { track: cycleTrack, userQueue: false, rebuildShuffle: false };
    }
    if (options.automaticCrossfade && isRemotePlaybackTrack(selection.track) && !isPreparedRadioTrack(selection.track, 1 - activeAudioIdx)) {
      // Crossfade is never allowed to trigger resolver or yt-dlp work. Keep the
      // current track audible and let the normal ended path prepare/advance.
      crossfadeSuppressedTrack = state.currentPlayingTrack;
      state.crossfadingNext = false;
      radioUiState.preparation = 'Preparing next track…';
      if (state.currentView === 'radio') renderRadioView();
      prepareNextRadioTrack();
      return false;
    }
    var playPromise = playTrack(selection.track, {
      preserveRadioSession: !!selection.userQueue,
      preserveQueueCursors: !!selection.userQueue,
      automaticAdvance: !!options.automaticAdvance
    });
    var attemptGeneration = playbackGeneration;
    var started = await playPromise;
    if (started) {
      if (selection.userQueue) {
        var queuedIndex = state.userQueue[selection.userQueueIndex] === selection.track ? selection.userQueueIndex : state.userQueue.indexOf(selection.track);
        if (queuedIndex !== -1) state.userQueue.splice(selection.consumeQueuePrefix ? 0 : queuedIndex, selection.consumeQueuePrefix ? queuedIndex + 1 : 1);
        syncSavedQueuePaths();
        saveSettingsDebounced(300);
        if (isQueueOpen) renderQueue();
      }
      return true;
    }
    if (playbackGeneration !== attemptGeneration) return false;
    skippedKeys.add(getPlaybackTrackKey(selection.track));
    if (selection.userQueue) {
      var failedQueueIndex = state.userQueue.indexOf(selection.track);
      if (failedQueueIndex !== -1) {
        state.userQueue.splice(failedQueueIndex, 1);
        syncSavedQueuePaths();
        saveSettingsDebounced(300);
      }
    }
  }
  if (state.radioSession && !options.waitedForRadioRefill) maybeRefillRadioQueue({ force: true });
  var pendingRefill = state.radioSession && state.radioSession.refillPromise;
  if (pendingRefill && !options.waitedForRadioRefill) {
    state.radioSession.awaitingNextPlayable = { generation: playbackGeneration, reason: options.automaticAdvance ? 'ended' : 'manual-next' };
    radioUiState.preparation = 'Preparing next track…'; if (state.currentView === 'radio') renderRadioView();
    try { await pendingRefill; } catch (error) { }
    return false;
  }
  if (options.automaticCrossfade) crossfadeSuppressedTrack = state.currentPlayingTrack;
  var active = getActiveAudioEl();
  if (active && active.ended) stopPlaybackState({ resetPosition: true });
  state.crossfadingNext = false;
  if (isQueueOpen) renderQueue();
  return false;
}

function stopPlaybackState(options) {
  options = options || {};
  playbackGeneration++;
  playbackTransitionPending = false;
  pendingPlaybackTrack = null;
  crossfadeSuppressedTrack = null;
  cancelCrossfadeTransition(false);
  state.isPlaying = false;
  (window.audioEls || []).forEach(function (audioEl) { if (audioEl) { if (!audioEl.paused) audioEl.pause(); releaseRadioLeaseFromAudio(audioEl); } });
  clearPreparedRadioSlot(false);
  if (options.resetPosition) {
    var activeAudio = getActiveAudioEl();
    if (activeAudio) { try { activeAudio.currentTime = 0; } catch (e) { } }
  }
  pauseLastfmScrobbleCycle(true);
  state.crossfadingNext = false;
  checkpointPlaybackSession(getActiveAudioEl(), 200);
  syncPlaybackStateUi();
}

function resetPlaybackRuntime(options) {
  options = options || {};
  if (state.radioSession) disposeRadioSession();
  playbackGeneration++;
  playbackTransitionPending = false;
  pendingPlaybackTrack = null;
  crossfadeSuppressedTrack = null;
  playbackSeekActive = false;
  invalidateRestoredPlaybackPreparation();
  cancelCrossfadeTransition(false);
  state.isPlaying = false;
  state.crossfadingNext = false;
  pauseLastfmScrobbleCycle(true);
  if (window.api.discordClear) window.api.discordClear().catch(function (e) { console.error('Discord activity clear failed:', e); });
  clearInterval(_npSlideshowTimer);
  _npSlideshowTimer = null;
  state.npSlideImages = [];
  state._lastStatsTime = null;
  (window.audioEls || []).forEach(function (audioEl) {
    if (!audioEl) return;
    audioEl.pause();
    releaseRadioLeaseFromAudio(audioEl);
    audioEl.removeAttribute('src');
    audioEl.load();
  });
  clearPreparedRadioSlot(false);
  (window.audioGainNodes || []).forEach(function (gain) { if (gain) setPlaybackGain(gain, 0, 0); });
  if (options.clearCurrent) state.currentPlayingTrack = null;
  if (options.clearCurrent) state.sourcePlaylistId = null;
  if (options.clearCurrent) {
    state.currentPlaybackPreservesQueueCursors = false;
    state.currentRadioHistoryPlayback = false;
  }
  if (options.clearQueues) {
    state.playQueueTracks = [];
    state.shuffleQueue = [];
    state.userQueue = [];
    state.playQueueCursor = null;
    state.shuffleQueueCursor = null;
    state.currentTracks = [];
    state.isShuffle = false;
    state.shuffleMode = 0;
    state.loopMode = 0;
  }
  if (options.clearHistory) state.playHistory = [];
  if (!options.preserveSettings) {
    if (options.clearCurrent) {
      delete appSettings.lastTrack;
      delete appSettings.lastPlayed;
    }
    appSettings.playHistory = state.playHistory.map(toLightTrackRef).filter(Boolean);
    syncSavedQueuePaths();
  }
  lyricsCurrentTrackKey = null;
  lyricsData = [];
  plainLyricsText = '';
  lyricsActiveIdx = -2;
  npLyricsActiveIdx = -2;
  renderLyricsPanel();
  if (npOverlayOpen) mirrorLyricsToNP();
  ['progress-bar', 'np-progress-bar'].forEach(function (id) { var bar = $(id); if (bar) bar.style.width = '0%'; });
  ['time-current', 'time-total', 'np-time-cur', 'np-time-total'].forEach(function (id) { var time = $(id); if (time) time.textContent = '0:00'; });
  syncSeekSliders();
  syncPlaybackStateUi();
  if (isQueueOpen) renderQueue();
}

function reconcilePlaybackAfterLibraryRemoval(removeSet) {
  function removed(track) {
    var filePath = track && track.matchedFile && track.matchedFile.filePath;
    return !!filePath && removeSet.has(filePath);
  }
  var currentRemoved = removed(state.currentPlayingTrack);
  var pendingRemoved = removed(pendingPlaybackTrack);
  if (currentRemoved || pendingRemoved) resetPlaybackRuntime({ clearCurrent: currentRemoved });
  state.currentTracks = state.currentTracks.filter(function (track) { return !removed(track); });
  state.playQueueTracks = state.playQueueTracks.filter(function (track) { return !removed(track); });
  state.shuffleQueue = state.shuffleQueue.filter(function (track) { return !removed(track); });
  state.userQueue = state.userQueue.filter(function (track) { return !removed(track); });
  state.playHistory = state.playHistory.filter(function (track) { return !removed(track); });
  appSettings.playHistory = state.playHistory.map(toLightTrackRef).filter(Boolean);
  syncSavedQueuePaths();
  syncPlaybackStateUi();
  if (isQueueOpen) renderQueue();
}

function resolvePreviousRadioHistoryTrack(track, session) {
  if (!track || !session || !trackMatchesRadioContext(track, serializeRadioContext(session))) return track;
  var sequence = getActiveRadioSequence();
  if (sequence.indexOf(track) !== -1) return track;
  var currentIndex = sequence.indexOf(state.currentPlayingTrack);
  if (currentIndex === -1) currentIndex = findTrackIndexByIdentity(sequence, state.isShuffle ? state.shuffleQueueCursor : state.playQueueCursor);
  var matchesStation = function (candidate) { return candidate && candidate.radioSessionId === session.stationId; };
  var previous = window.RadioQueueHelpers && window.RadioQueueHelpers.findPreviousMatchingOccurrence
    ? window.RadioQueueHelpers.findPreviousMatchingOccurrence(sequence, currentIndex, track, getPlaybackTrackKey, matchesStation)
    : null;
  return previous || track;
}

function playPrevTrack() {
  if (state.radioSession) state.radioSession.awaitingNextPlayable = null;
  var audio = window.audioEls ? window.audioEls[activeAudioIdx] : $('audio-player-0');
  if (audio && audio.currentTime > 3) { setActiveAudioPosition(0, true); return; }
  // FIX 8: prev uses playHistory not queue
  if (state.playHistory.length > 1) {
    var historyBefore = state.playHistory.slice();
    var prev = historyBefore[historyBefore.length - 2];
    if (prev) {
      var previousOptions = { preserveRadioSession: !!state.radioSession };
      var previousRadioTrack = resolvePreviousRadioHistoryTrack(prev, state.radioSession);
      if (previousRadioTrack !== prev) prev = previousRadioTrack;
      else if (state.radioSession && trackMatchesRadioContext(prev, serializeRadioContext(state.radioSession))) {
        prev = Object.assign({}, prev, { radioSessionId: state.radioSession.stationId });
        previousOptions.preserveQueueCursors = true;
        previousOptions.radioHistoryPlayback = true;
      }
      playTrack(prev, previousOptions).then(function (started) {
        if (!started) return;
        state.playHistory = historyBefore.slice(0, -2);
        state.playHistory.push(prev);
        appSettings.playHistory = state.playHistory.map(toLightTrackRef).filter(Boolean);
        saveSettingsDebounced(500);
      });
      return;
    }
  }
  var v = state.playQueueTracks.filter(function (t) { return !t.isDisabled; });
  if (state.isShuffle) { var si = state.shuffleQueue.indexOf(state.currentPlayingTrack); if (si > 0) { playTrack(state.shuffleQueue[si - 1]); return; } }
  var i = v.indexOf(state.currentPlayingTrack);
  if (i > 0) { playTrack(v[i - 1]); return; }
  if (state.loopMode >= 1) playTrack(v[v.length - 1]);
}

function updatePlayerUI() {
  var cover = $('player-cover-art');
  var placeholder = $('player-cover-placeholder');
  var title = $('player-track-name');
  var artist = $('player-track-artist');
  var album = $('player-track-album');
  var likeButton = $('btn-like');
  var likeIcon = $('like-icon');
  var artworkTrigger = $('player-artwork-trigger');
  if (!cover || !title || !artist || !album || !likeButton || !likeIcon) return;
  if (!state.currentPlayingTrack) {
    cover.classList.add('placeholder');
    cover.style.backgroundImage = '';
    if (placeholder) placeholder.hidden = false;
    title.textContent = 'No track selected';
    artist.textContent = 'Choose something from your library';
    album.textContent = '';
    title.disabled = true; title.removeAttribute('title');
    artist.disabled = true; artist.removeAttribute('title');
    if (artworkTrigger) { artworkTrigger.disabled = true; artworkTrigger.removeAttribute('title'); }
    likeButton.disabled = true;
    likeButton.setAttribute('aria-label', 'Like current track');
    likeButton.setAttribute('aria-pressed', 'false');
    likeIcon.className = 'ph ph-heart';
    updateReplayGainStatus(null);
    syncTransportControls();
    syncMpris(false);
    return;
  }
  var t = state.currentPlayingTrack;
  var liked = isTrackLiked(t);
  var picture = getTrackArtworkUrl(t);
  cover.classList.toggle('placeholder', !picture);
  cover.style.backgroundImage = picture ? 'url("' + picture.replace(/"/g, '\\"') + '")' : '';
  if (placeholder) placeholder.hidden = !!picture;
  title.textContent = t.title || 'Unknown title';
  artist.textContent = t.artist || 'Unknown artist';
  album.textContent = t.album || '';
  var navigationAlbum = resolvePlaybackTrackAlbum(t);
  title.disabled = !navigationAlbum;
  title.title = navigationAlbum ? ('Open ' + navigationAlbum.name) : '';
  artist.disabled = !isSearchablePlaybackArtist(t.artist);
  artist.title = artist.disabled ? '' : ('Search for ' + t.artist);
  if (artworkTrigger) {
    artworkTrigger.disabled = !picture;
    artworkTrigger.title = picture ? 'Open artwork' : '';
  }
  likeButton.disabled = !likedIdentity(t);
  likeButton.setAttribute('aria-label', (liked ? 'Unlike' : 'Like') + ' current track');
  likeButton.setAttribute('aria-pressed', liked ? 'true' : 'false');
  likeIcon.className = liked ? 'ph-fill ph-heart' : 'ph ph-heart';
  updateReplayGainStatus(t);
  syncTransportControls();
  syncMpris(false);
}

function resolvePlaybackTrackAlbum(track) {
  if (!track) return null;
  if (track.matchedFile) return getFullAlbumByKey(getAlbumKey(track.matchedFile));
  var album = String(track.album || '').trim();
  var albumArtist = String(track.albumArtist || track.artist || '').trim();
  if (!album || !albumArtist) return null;
  return getFullAlbumByKey(getAlbumKey({ album: album, albumArtist: albumArtist, artist: track.artist || albumArtist }));
}

function isSearchablePlaybackArtist(value) {
  var artist = String(value || '').trim();
  return !!artist && !/^(unknown\s+artist|unknown|—|-|n\/a)$/i.test(artist);
}

function openPlaybackTrackAlbum() {
  var album = resolvePlaybackTrackAlbum(state.currentPlayingTrack);
  if (!album) return;
  if (npOverlayOpen) closeNowPlayingOverlay();
  pushNav('album:' + album.id);
  renderAlbumDetail(album, state.currentPlayingTrack && state.currentPlayingTrack.matchedFile && state.currentPlayingTrack.matchedFile.filePath);
}

function searchPlaybackArtist() {
  var artist = state.currentPlayingTrack && String(state.currentPlayingTrack.artist || '').trim();
  if (!isSearchablePlaybackArtist(artist)) return;
  if (npOverlayOpen) closeNowPlayingOverlay();
  var search = $('global-search');
  if (!search) return;
  search.value = artist;
  search.dispatchEvent(new Event('input', { bubbles: true }));
  setTimeout(function () { if (!modalStack.length) search.focus(); }, 0);
}

function openArtworkLightbox(source, label) {
  var src = String(source || '').trim();
  if (!src) return;
  var modal = $('artwork-lightbox-modal');
  var image = $('artwork-lightbox-image');
  if (!modal || !image) return;
  image.src = src;
  image.alt = label ? ('Artwork for ' + label) : 'Artwork preview';
  showModal(modal, { initialFocus: '.artwork-lightbox-dialog' });
}

function openCurrentPlaybackArtwork(source) {
  var track = state.currentPlayingTrack;
  openArtworkLightbox(source || getTrackArtworkUrl(track), track && (track.album || track.title));
}

var playerArtworkTrigger = $('player-artwork-trigger');
if (playerArtworkTrigger) playerArtworkTrigger.addEventListener('click', function () { openCurrentPlaybackArtwork(); });
var playerTrackName = $('player-track-name');
if (playerTrackName) playerTrackName.addEventListener('click', openPlaybackTrackAlbum);
var playerTrackArtist = $('player-track-artist');
if (playerTrackArtist) playerTrackArtist.addEventListener('click', searchPlaybackArtist);
var artworkLightbox = $('artwork-lightbox-modal');
if (artworkLightbox) artworkLightbox.addEventListener('click', function (event) { if (event.target === artworkLightbox) hideModal(artworkLightbox); });

function toggleCurrentTrackLike() {
  var track = state.currentPlayingTrack;
  if (!toggleTrackLikeByIdentity(track)) return;
  updatePlayerUI();
  if (state.currentView === 'liked_songs') renderPlaylist('liked_songs');
  else if (state.currentView && (state.currentView.startsWith('pl_') || state.currentView.startsWith('album:'))) renderTracksTable(state.currentView.startsWith('pl_'));
}

function updateReplayGainStatus(track) {
  var chip = $('replaygain-status-chip');
  if (!chip) return;
  var file = track && track.matchedFile;
  if (!file) {
    chip.textContent = 'RG idle';
    chip.className = 'replaygain-chip missing';
    return;
  }
  var db = typeof file.replayGainTrackDb === 'number' ? file.replayGainTrackDb : file.replayGainAlbumDb;
  if (typeof db !== 'number' || isNaN(db)) {
    chip.textContent = 'RG missing';
    chip.title = 'ReplayGain is missing. Use Tag Health or Ctrl+K to analyze loudness.';
    chip.className = 'replaygain-chip missing';
    return;
  }
  chip.textContent = 'RG ' + (db > 0 ? '+' : '') + db.toFixed(1) + ' dB';
  chip.title = appSettings.normalization ? 'ReplayGain normalization is active' : 'ReplayGain data is available; normalization is off';
  chip.className = 'replaygain-chip' + (appSettings.normalization ? ' active' : '');
}

function openPlaylistContextMenu(pl, x, y, opener) {
  currentContextMenuPlaylist = pl;
  var exportOnly = !!(pl && pl.isSpecial);
  var menu = $('playlist-context-menu');
  if (menu) menu.classList.toggle('export-only', exportOnly);
  ['pctx-add-songs', 'pctx-rename', 'pctx-cover', 'pctx-color', 'pctx-pin', 'pctx-sync-albums', 'pctx-match-folder', 'pctx-duplicate', 'pctx-delete'].forEach(function (id) {
    var action = $(id); if (action) action.hidden = exportOnly;
  });
  var pinBtn = $('pctx-pin'); if (pinBtn) pinBtn.textContent = pl.pinned ? 'Unpin Playlist' : 'Pin Playlist';
  var downloadBtn = $('pctx-download-missing');
  if (downloadBtn) {
    var missingCount = pl && !pl.isSpecial ? getDownloadableMissingPlaylistRows(pl).length : 0;
    downloadBtn.hidden = !missingCount;
    downloadBtn.textContent = 'Download Missing Tracks' + (missingCount ? ' (' + missingCount + ')' : '') + '…';
  }
  positionContextMenu($('playlist-context-menu'), x, y, opener);
}

function buildColorPickers() {
  [$('cp-color-picker'), $('color-picker-swatches')].forEach(function (container) {
    if (!container) return; container.innerHTML = '';
    PALETTE.forEach(function (color) {
      var sw = document.createElement('button'); sw.type = 'button'; sw.className = 'color-swatch' + (color === cpSelectedColor && container.id === 'cp-color-picker' ? ' selected' : ''); sw.setAttribute('aria-label', 'Use color ' + color);
      sw.style.background = color;
      sw.addEventListener('click', function () {
        container.querySelectorAll('.color-swatch').forEach(function (s) { s.classList.remove('selected'); }); sw.classList.add('selected');
        if (container.id === 'cp-color-picker') cpSelectedColor = color;
      });
      container.appendChild(sw);
    });
  });
}

// EVENT LISTENERS
document.addEventListener('click', function (e) {
  var item = e.target.closest && e.target.closest('.context-menu .menu-item');
  if (!item || item.matches('summary') || item.classList.contains('has-submenu')) return;
  var opener = contextMenuOpener;
  contextMenuActionOpener = opener;
  setTimeout(function () {
    if (modalStack.length || activeContextMenu) return;
    restoreFocusWithFallback(opener);
    if (contextMenuActionOpener === opener) contextMenuActionOpener = null;
  }, 0);
}, true);
document.addEventListener('click', function (e) {
  // Close if click is outside any context menu
  if (!e.target.closest('.context-menu')) hideAllContextMenus();
});
// Also close on any menu item click (items that don't open a sub-modal)
document.addEventListener('click', function (e) {
  var item = e.target.closest('.menu-item');
  if (!item || item.matches('summary') || item.classList.contains('has-submenu')) return;
  hideAllContextMenus();
});

function syncLibraryScanControls() {
  var disabled = startupErrorRendered || appStateCommitInProgress || libraryScanInProgress > 0;
  [importFolderBtn, homeImportFolderBtn, libraryImportFolderBtn, btnFastRescan].forEach(function (btn) { if (btn) btn.disabled = disabled; });
}
function beginLibraryScan() {
  if (startupErrorRendered || appStateCommitInProgress || libraryScanInProgress > 0) return 0;
  libraryScanInProgress++;
  var generation = ++libraryScanGeneration;
  syncLibraryScanControls();
  return generation;
}
function libraryScanIsCurrent(generation) {
  return !!generation && !appStateCommitInProgress && generation === libraryScanGeneration;
}
function finishLibraryScan() {
  libraryScanInProgress = Math.max(0, libraryScanInProgress - 1);
  syncLibraryScanControls();
}
function beginAppStateCommit() {
  appStateCommitInProgress = true;
  libraryScanGeneration++;
  syncLibraryScanControls();
}
function endAppStateCommit() {
  appStateCommitInProgress = false;
  syncLibraryScanControls();
}

function mergeScannedFiles(scannedFiles, scanContext) {
  var libraryByPath = {};
  state.musicFiles.forEach(function (file) { if (file.filePath) libraryByPath[file.filePath] = file; });
  var preserveCurrentEntries = libraryRevision !== scanContext.revision;
  (scannedFiles || []).forEach(function (file) {
    if (!file.filePath) return;
    if (metadataPathIsLocked(file.filePath)) return;
    if (preserveCurrentEntries && libraryByPath[file.filePath]) return;
    if (preserveCurrentEntries && scanContext.paths.has(file.filePath)) return;
    libraryByPath[file.filePath] = file;
  });
  return Object.values(libraryByPath);
}

var importFolderBtn = $('import-folder-btn');
var homeImportFolderBtn = $('home-import-folder-btn');
var libraryImportFolderBtn = $('library-import-folder-btn');
document.querySelectorAll('[data-collection-action]').forEach(function (button) {
  button.addEventListener('click', function () {
    var action = button.dataset.collectionAction;
    if (action === 'import') runFolderImport();
    else if (action === 'rescan') doRescanFolder();
    else if (action === 'health') switchView('metadata_health');
    else if (action === 'downloads') { var downloads = $('btn-download-queue'); if (downloads) downloads.click(); }
    else if (action === 'settings') { var settings = $('btn-settings'); if (settings) settings.click(); }
  });
});
function setFolderImportUi(label, busy, pct) {
  [importFolderBtn, homeImportFolderBtn, libraryImportFolderBtn].forEach(function (btn) {
    if (!btn) return;
    btn.disabled = !!busy || startupErrorRendered || appStateCommitInProgress || libraryScanInProgress > 0;
    btn.setAttribute('aria-busy', busy ? 'true' : 'false');
    btn.innerHTML = (busy ? '<i class="ph ph-spinner ph-spin" aria-hidden="true"></i> ' : '<i class="ph ph-folder-open" aria-hidden="true"></i> ') + label;
    btn.style.background = typeof pct === 'number' ? 'linear-gradient(90deg,rgba(var(--accent-rgb),.2) ' + pct + '%,transparent ' + pct + '%)' : '';
  });
  var status = $('home-import-status');
  if (status) status.textContent = label;
}
function resetFolderImportUi() {
  [[importFolderBtn, 'Import Folder'], [homeImportFolderBtn, 'Choose music folder'], [libraryImportFolderBtn, 'Choose music folder']].forEach(function (entry) {
    var btn = entry[0];
    if (!btn) return;
    btn.disabled = startupErrorRendered || appStateCommitInProgress || libraryScanInProgress > 0;
    btn.setAttribute('aria-busy', 'false');
    btn.innerHTML = '<i class="ph ph-folder-open" aria-hidden="true"></i> ' + entry[1];
    btn.style.background = '';
  });
  var status = $('home-import-status');
  if (status) status.textContent = '';
}
async function runFolderImport() {
  var scanGeneration = beginLibraryScan();
  if (!scanGeneration) return;
  try {
    var folderPath = await window.api.openFolder();
    if (!folderPath || !libraryScanIsCurrent(scanGeneration)) return;
    setFolderImportUi('Preparing library scan...', true);
    window.api.onScanProgress(function (d) {
      if (!libraryScanIsCurrent(scanGeneration) || !d || d.total <= 0) return;
      var pct = Math.round((d.current / d.total) * 100);
      setFolderImportUi('Scanning ' + pct + '%', true, pct);
    });
    var beforeMap = {};
    state.musicFiles.forEach(function (f) { if (f.filePath) beforeMap[f.filePath] = Object.assign({}, f); });
    var scanContext = { revision: libraryRevision, paths: new Set(state.musicFiles.map(function (file) { return file.filePath; }).filter(Boolean)) };
    var files = await window.api.scanFolder(folderPath, state.musicFiles);
    if (!libraryScanIsCurrent(scanGeneration)) return;
    var mergedFiles = mergeScannedFiles(files, scanContext);
    var libraryRoots = Array.isArray(appSettings.libraryRoots) ? appSettings.libraryRoots.slice() : [];
    var rootWillChange = !libraryRoots.includes(folderPath);
    var importSummary = buildImportReviewSummary(folderPath, files, beforeMap, mergedFiles);
    if (importSummary.added || importSummary.updated || rootWillChange) pushUndoSnapshot('Import folder', ['library', 'libraryRoots']);
    setMusicFiles(mergedFiles); await persistLibrary(state.musicFiles);
    if (!libraryScanIsCurrent(scanGeneration)) return;
    if (rootWillChange) {
      libraryRoots.push(folderPath);
      appSettings.libraryRoots = libraryRoots;
      await persistSettings(appSettings);
    }
    if (!libraryScanIsCurrent(scanGeneration)) return;
    setFolderImportUi(importSummary.added || importSummary.updated ? 'Library updated' : 'No supported audio found', false);
    if (state.currentView === 'home') renderHomeDashboard();
    else if (state.currentView === 'library') renderLibrary();
    showImportReview(importSummary);
  } catch (e) {
    if (!libraryScanIsCurrent(scanGeneration)) return;
    console.error(e);
    showToast('Folder import failed. Check that the folder is accessible and try again.');
    setFolderImportUi('Import failed', false);
  } finally {
    finishLibraryScan();
    setTimeout(resetFolderImportUi, 2600);
  }
}
[importFolderBtn, homeImportFolderBtn, libraryImportFolderBtn].forEach(function (btn) { if (btn) btn.addEventListener('click', runFolderImport); });

var btnFastRescan = $('btn-fast-rescan');
async function doRescanFolder() {
  if (state.musicFiles.length === 0) {
    alert('No folders in library to rescan. Import a folder first.');
    return;
  }
  var scanGeneration = beginLibraryScan();
  if (!scanGeneration) return;
  if (btnFastRescan) btnFastRescan.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Rescanning...';

  try {
    var savedRoots = Array.isArray(appSettings.libraryRoots) ? appSettings.libraryRoots.filter(Boolean) : [];
    var dirs = new Set(savedRoots);
    state.musicFiles.forEach(function(f) {
      if (!f.filePath) return;
      var sep = f.filePath.includes('\\') ? '\\' : '/';
      var parts = f.filePath.split(sep);
      parts.pop();
      var dir = parts.join(sep);
      if (dir) dirs.add(dir);
    });
    var rootDirs = Array.from(dirs).sort(function (a, b) { return a.length - b.length; }).reduce(function (roots, dir) {
      var nested = roots.some(function (root) { return dir === root || dir.startsWith(root + '\\') || dir.startsWith(root + '/'); });
      if (!nested) roots.push(dir);
      return roots;
    }, []);
    var mainPartialWarningSeen = false;
    var currentRootPartial = false;
    window.api.onScanProgress(function(d) {
      if (!libraryScanIsCurrent(scanGeneration) || !d) return;
      if (d.partial) { mainPartialWarningSeen = true; currentRootPartial = true; }
      if (d.total > 0 && btnFastRescan) {
        var pct = Math.round((d.current / d.total) * 100);
        btnFastRescan.innerHTML = '<i class="ph ph-spinner ph-spin"></i> ' + pct + '%';
      }
    });

    // Scan only NEW files - pass existing library so unchanged files are skipped.
    var scanContext = { revision: libraryRevision, paths: new Set(state.musicFiles.map(function (file) { return file.filePath; }).filter(Boolean)) };
    var newLibrary = [];
    var skippedFolders = [];
    var rootErrors = [];
    for (var i = 0; i < rootDirs.length; i++) {
      if (!libraryScanIsCurrent(scanGeneration)) return;
      currentRootPartial = false;
      try {
        var res = await window.api.scanFolder(rootDirs[i], getLibraryEntriesForScanRoot(rootDirs[i]));
        if (!libraryScanIsCurrent(scanGeneration)) return;
        if (res && res.partial) { mainPartialWarningSeen = true; currentRootPartial = true; }
        if (res && res.length) newLibrary = newLibrary.concat(res);
        else if (!currentRootPartial) skippedFolders.push(rootDirs[i]);
      } catch(e) {
        console.error('Rescan error for', rootDirs[i], e);
        rootErrors.push(rootDirs[i] + ': ' + ((e && e.message) || String(e || 'unknown error')));
      }
    }
    if (!libraryScanIsCurrent(scanGeneration)) return;
    setMusicFiles(mergeScannedFiles(newLibrary, scanContext));
    await persistLibrary(state.musicFiles);
    if (!libraryScanIsCurrent(scanGeneration)) return;
    renderLibrary();

    var warnings = [];
    if (rootErrors.length) warnings.push('Rescan failed for:\n- ' + rootErrors.join('\n- '));
    if (skippedFolders.length > 0 && !mainPartialWarningSeen) warnings.push('Rescan skipped ' + skippedFolders.length + ' folder(s) that had no supported audio files. Existing library entries were preserved.');
    if (warnings.length) alert(warnings.join('\n\n'));
  } catch (e) {
    if (libraryScanIsCurrent(scanGeneration)) {
      console.error('Rescan failed:', e);
      showToast('Rescan failed: ' + ((e && e.message) || String(e || 'unknown error')));
    }
  } finally {
    finishLibraryScan();
    if (btnFastRescan) {
      btnFastRescan.innerHTML = '<i class="ph ph-arrows-clockwise"></i> Rescan Folder';
      btnFastRescan.disabled = startupErrorRendered || appStateCommitInProgress || libraryScanInProgress > 0;
    }
  }
}
if (btnFastRescan) btnFastRescan.addEventListener('click', doRescanFolder);

async function writeCurrentFolderCovers(showAlert) {
  if (!window.api.saveFolderCovers || !state.musicFiles.length) return null;
  var res = await window.api.saveFolderCovers(state.musicFiles);
  if (showAlert && res) {
    var msg = 'folder.jpg written for ' + (res.saved || 0) + ' folder(s).';
    if (res.failed) {
      var failures = (res.failures || []).slice(0, 10).map(function (f) { return '- ' + (f.folder || f.filePath || 'Unknown') + ': ' + (f.reason || 'failed'); }).join('\n');
      msg += '\nFailed: ' + res.failed + (failures ? '\n' + failures : '');
      if (res.failures && res.failures.length > 10) msg += '\n...and ' + (res.failures.length - 10) + ' more.';
    }
    alert(msg);
  }
  return res;
}

var btnWriteFolderCovers = $('btn-write-folder-covers');
if (btnWriteFolderCovers) btnWriteFolderCovers.addEventListener('click', async function () {
  btnWriteFolderCovers.disabled = true;
  btnWriteFolderCovers.innerHTML = '<i class="ph ph-spinner ph-spin" style="margin-right:6px;"></i> Writing...';
  try { await writeCurrentFolderCovers(true); }
  finally {
    btnWriteFolderCovers.disabled = false;
    btnWriteFolderCovers.innerHTML = '<i class="ph ph-image-square" style="margin-right:6px;"></i> Write folder.jpg';
  }
});

var clearLibraryBtn = $('clear-library-btn');
if (clearLibraryBtn) clearLibraryBtn.addEventListener('click', async function () {
  var count = state.musicFiles.length;
  if (!count) { showToast('The library is already empty.'); return; }
  if (confirm('Clear ' + count + ' track' + (count === 1 ? '' : 's') + ' from Playerinyo\'s library?\n\nAudio files and playlists will not be deleted. Playlist entries may appear missing until those files are imported or rescanned. An Undo action will remain available until dismissed.')) {
    var removal = await removeLibraryFiles(state.musicFiles.slice(), 'Clear library');
    if (removal.failed) return;
    renderSidebarPlaylists();
    hideModal($('settings-modal'));
    switchView('home');
    showUndoToast('Library cleared. Audio files and playlists were not deleted.', removal.snapshot);
  }
});

function getImportTrackTitle(row) { return row ? (row.Song || row.title || row.Name || row.name || row.TITLE || '') : ''; }
function getImportTrackArtist(row) { return row ? (row.Artist || row.artist || row.ARTIST || '') : ''; }
function getImportTrackAlbum(row) { return row ? (row.Album || row.album || row.ALBUM || '') : ''; }
function isM3uImportRecord(row) { return !!(row && (row.SourceFormat === 'm3u' || row.SourceFormat === 'm3u8')); }
function findExactPlaylistPathMatch(row) {
  var filePath = getPlaylistTrackFilePath(row);
  if (!filePath) return null;
  var wanted = stripFileUrl(filePath);
  var exact = getLibraryIndex().byStrippedPath.get(wanted);
  if (exact && libraryMissingFilePaths.has(exact.filePath)) exact = null;
  if (exact || !/^[a-z]:[\\/]|^\\\\/i.test(wanted)) return exact || null;
  var windowsKey = wanted.replace(/\//g, '\\').toLowerCase();
  return state.musicFiles.find(function (file) { return !libraryMissingFilePaths.has(file.filePath) && stripFileUrl(file.filePath || '').replace(/\//g, '\\').toLowerCase() === windowsKey; }) || null;
}
function isLocalPlaylistImportCandidate(row) {
  return !!(isM3uImportRecord(row) && row.SourceStatus === 'local-existing' && !findExactPlaylistPathMatch(row));
}
function isPlaylistImportDownloadEligible(row) {
  return !!(row && !isM3uImportRecord(row) && isPlaylistRecordMissing(row));
}
function buildPlaylistImportGroups(sourcePath, data, sourceName) {
  if (!Array.isArray(data) || !data.length) return [];
  if (data[0].hasOwnProperty('Playlist') && data[0].Playlist) {
    var grouped = {};
    data.forEach(function (row) {
      var pName = row.Playlist || 'Imported Playlist';
      if (!grouped[pName]) grouped[pName] = [];
      grouped[pName].push(row);
    });
    return Object.keys(grouped).map(function (name) { return { name: name, tracks: grouped[name] }; });
  }
  var name = sourceName || String(sourcePath || '').split(/[\\\/]/).pop().replace(/\.(?:csv|m3u8?)$/i, '') || 'Imported Playlist';
  return [{ name: name, tracks: data }];
}
function getPlaylistImportRows() {
  if (!pendingPlaylistImport) return [];
  var rows = [];
  pendingPlaylistImport.groups.forEach(function (group, groupIndex) {
    group.tracks.forEach(function (row, trackIndex) { rows.push({ group: group, groupIndex: groupIndex, row: row, trackIndex: trackIndex }); });
  });
  return rows;
}
function findStrictAlbumMatch(row) {
  var title = normalizeMatchTitle(getImportTrackTitle(row));
  var artist = normalize(getImportTrackArtist(row));
  var album = normalize(getImportTrackAlbum(row));
  var filePath = getPlaylistTrackFilePath(row);
  var libIndex = getLibraryIndex();
  if (filePath) {
    var wantedPath = stripFileUrl(filePath);
    var byPath = libIndex.byStrippedPath.get(wantedPath);
    if (byPath) return byPath;
  }
  if (!title || !album) return null;
  return state.musicFiles.find(function (f) {
    var fileTitle = normalizeMatchTitle(f.title || f.filename || '');
    var fileArtist = normalize(f.artist || f.albumArtist || '');
    var fileAlbumArtist = normalize(f.albumArtist || f.artist || '');
    var fileAlbum = normalize(f.album || '');
    return fileTitle === title && fileAlbum === album && (!artist || fileArtist === artist || fileAlbumArtist === artist);
  }) || null;
}
function findPlaylistRecordMatch(row) {
  // A remote record must retain its row identity, but resolve to a downloaded
  // local file as soon as the musical identity is available locally.
  var identityMatch = findLocalMusicalIdentity(row);
  if (identityMatch) return identityMatch;
  if (isM3uImportRecord(row)) {
    if (!row.SourceLocal || !row.SourceSupported) return null;
    var exactMatch = findExactPlaylistPathMatch(row);
    if (exactMatch) return exactMatch;
    // Preserve local M3U playlist membership after a library rescan moves the
    // underlying file. The shared matcher returns null for ambiguous matches.
    return findMatchingFile(getImportTrackTitle(row), getImportTrackArtist(row), getImportTrackAlbum(row), getPlaylistTrackFilePath(row));
  }
  if (row && row.__strictAlbumMatch) return findStrictAlbumMatch(row);
  return findMatchingFile(getImportTrackTitle(row), getImportTrackArtist(row), getImportTrackAlbum(row), getPlaylistTrackFilePath(row));
}
function normalizeMusicalIdentityText(value) {
  return String(value || '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function getMusicalIdentity(track) {
  var mbid = String(track && (track.TrackMbid || track.trackMbid || track.recordingMbid) || '').trim().toLowerCase();
  if (mbid) return 'mbid:' + mbid;
  var artist = normalizeMusicalIdentityText(track && (track.Artist || track.artist));
  var title = normalizeMusicalIdentityText(track && (track.Song || track.title));
  return artist && title ? 'name:' + artist + '::' + title : '';
}
function findLocalMusicalIdentity(track) {
  var identity = getMusicalIdentity(track);
  if (!identity) return null;
  return state.musicFiles.find(function (file) { return getMusicalIdentity(file) === identity; }) || null;
}
function isPlaylistRecordMissing(row) {
  return !findPlaylistRecordMatch(row);
}
function getMissingPlaylistRows(pl) {
  if (!pl || !Array.isArray(pl.tracks)) return [];
  return pl.tracks.filter(isPlaylistRecordMissing);
}
function getDownloadableMissingPlaylistRows(pl) {
  var seen = new Set();
  return getMissingPlaylistRows(pl).filter(function (row) {
    var identity = getMusicalIdentity(row);
    if (!isPlaylistImportDownloadEligible(row) || !identity || seen.has(identity)) return false;
    seen.add(identity); return true;
  });
}
function getDownloadablePlaylistTracksFromContext() {
  var pl = getCurrentRegularPlaylist();
  if (!pl || !currentContextMenuTrack) return [];
  var key = getTrackSelectionKey(currentContextMenuTrack);
  var tracks = key && selectedTrackKeys.has(key) ? getSelectedCurrentTracks() : [currentContextMenuTrack];
  return tracks.filter(function (track) { return track && track.csvRecord && isPlaylistImportDownloadEligible(track.csvRecord); });
}
function updateTrackContextDownloadState(track) {
  var missingPlaylistTrack = !!(track && track.csvRecord && isPlaylistRecordMissing(track.csvRecord));
  var rmBtn = $('ctx-remove-match');
  if (rmBtn) rmBtn.hidden = !(state.currentView.startsWith('pl_') && track && track.matchedFile);
  var gotoBtn = $('ctx-go-to-album');
  if (gotoBtn) gotoBtn.hidden = !(track && track.matchedFile);
  var dlBtn = $('ctx-download-track');
  if (dlBtn) {
    var rows = getDownloadablePlaylistTracksFromContext();
    if (!rows.length && isRemotePlaybackTrack(track)) rows = [makePlaylistTrackRecord(track)];
    dlBtn.hidden = !rows.length;
    dlBtn.innerHTML = '<i class="ph ph-download-simple"></i> ' + (rows.length > 1 ? 'Download Selected Missing Tracks…' : 'Download Track');
  }
  var addDownloadBtn = $('ctx-add-playlist-download');
  if (addDownloadBtn) addDownloadBtn.hidden = !isRemotePlaybackTrack(track);
  var manualMatchBtn = $('ctx-manual-match');
  if (manualMatchBtn) {
    manualMatchBtn.innerHTML = '<i class="ph ph-link"></i> ' + (missingPlaylistTrack ? 'Locate Local File…' : 'Manual Match…');
    manualMatchBtn.setAttribute('aria-label', missingPlaylistTrack ? 'Locate a local file for this missing track' : 'Manually match this track to a local file');
  }
  var removePlaylistBtn = $('ctx-remove-playlist');
  if (removePlaylistBtn) removePlaylistBtn.hidden = !getCurrentRegularPlaylist() || !track || !track.csvRecord;
}
function makeDownloadTrackPayload(row) {
  var payload = Object.assign({}, row || {});
  payload.title = getImportTrackTitle(row);
  payload.artist = getImportTrackArtist(row);
  payload.album = getImportTrackAlbum(row);
  payload.albumDate = row && (row['Album Date'] || row.AlbumDate || row.Year || row.year || '');
  payload.genre = row && (row.Genres || row.Genre || row.genre || '');
  payload.isrc = row && (row.ISRC || row.isrc || '');
  payload.trackMbid = row && (row.TrackMbid || row.trackMbid || '');
  payload.downloadQuality = ['best-native', 'opus', 'm4a', 'mp3'].includes(appSettings.ytdlDownloadQuality) ? appSettings.ytdlDownloadQuality : 'best-native';
  if (row && /^[A-Za-z0-9_-]{11}$/.test(String(row.VideoId || ''))) payload.videoId = row.VideoId;
  if (row && row.__downloadCandidate) {
    payload.downloadUrl = row.__downloadCandidate.webpageUrl || row.__downloadCandidate.url || '';
    payload.thumbnailUrl = row.__downloadCandidate.thumbnail || '';
    if (!payload.coverUrl && !payload.CoverUrl && !payload.Cover && !payload.Image && !payload.Artwork) payload.coverUrl = payload.thumbnailUrl;
  }
  return payload;
}
function formatImportCandidateDuration(seconds) {
  seconds = Number(seconds || 0);
  if (!seconds || isNaN(seconds)) return '--:--';
  return fmt(seconds);
}
function getImportCandidateConfidence(candidate) {
  if (!candidate) return '';
  if (candidate.confidence) return candidate.confidence;
  var score = Number(candidate.score || 0);
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}
function formatImportCandidateConfidence(candidate) {
  var confidence = getImportCandidateConfidence(candidate);
  if (!confidence) return '';
  return confidence.charAt(0).toUpperCase() + confidence.slice(1);
}
function isAutoSelectableImportCandidate(candidate) { return getImportCandidateConfidence(candidate) === 'high'; }
function getImportCandidateUrl(candidate) { return candidate ? (candidate.webpageUrl || candidate.url || '') : ''; }
function isAgeRestrictedDownloadResult(res) {
  return !!(res && (res.ageRestricted || /sign-in\/age confirmation|requires sign-in|cookies/i.test(res.error || '')));
}
function getDownloadFallbackCandidates(row) {
  var candidates = [];
  var seen = new Set();
  function add(candidate) {
    var key = getImportCandidateUrl(candidate) || (candidate ? ((candidate.title || '') + '|' + (candidate.uploader || '')) : '');
    if (!candidate || !key || seen.has(key)) return;
    seen.add(key);
    candidates.push(candidate);
  }
  add(row && row.__downloadCandidate);
  (row && row.__downloadCandidates ? row.__downloadCandidates : []).forEach(function (candidate) {
    if (getImportCandidateConfidence(candidate) !== 'low') add(candidate);
  });
  return candidates;
}
function setImportRowCandidate(row, candidate, manual) {
  row.__downloadCandidate = candidate || null;
  row.__downloadCandidateManual = !!(candidate && manual);
  row.__candidateError = '';
  row.__candidateNotice = '';
  if (row.__downloadStatus === 'failed') {
    row.__downloadStatus = '';
    row.__downloadError = '';
  }
}
function clearImportRowTransient(row) {
  cancelCandidateSearchRequest(row);
  row.__candidateRequestSeq = (row.__candidateRequestSeq || 0) + 1;
  ['__downloadSelected', '__addLocalSelected', '__downloadStatus', '__downloadError', '__downloadCandidate', '__downloadCandidates', '__downloadCandidateManual', '__candidateLoading', '__candidateQueued', '__candidatePromise', '__candidateError', '__candidateNotice', '__candidateQueryCount'].forEach(function (key) { delete row[key]; });
}
function snapshotImportRowTransient(row) {
  var data = {};
  ['__downloadSelected', '__addLocalSelected', '__downloadStatus', '__downloadError', '__downloadCandidate', '__downloadCandidates', '__downloadCandidateManual', '__candidateError', '__candidateNotice', '__candidateQueryCount'].forEach(function (key) {
    if (row && Object.prototype.hasOwnProperty.call(row, key)) data[key] = row[key];
  });
  return data;
}
function restoreImportRowTransient(row, data) {
  if (!row || !data) return;
  clearImportRowTransient(row);
  Object.keys(data).forEach(function (key) { row[key] = data[key]; });
}
function copyImportRowTransient(source, target) {
  if (!source || !target || source === target) return;
  clearImportRowTransient(target);
  ['__downloadSelected', '__addLocalSelected', '__downloadCandidate', '__downloadCandidates', '__downloadCandidateManual', '__candidateError', '__candidateNotice', '__candidateQueryCount'].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
  });
}
function prepareDownloadQueueRow(row) {
  ['__downloadStatus', '__downloadError', '__candidateLoading', '__candidateQueued', '__candidatePromise'].forEach(function (key) { delete row[key]; });
  row.__downloadSelected = true;
}
function cloneDownloadCandidate(candidate) {
  if (!candidate) return null;
  return {
    title: candidate.title || '',
    uploader: candidate.uploader || '',
    duration: Number(candidate.duration || 0),
    score: Number(candidate.score || 0),
    confidence: candidate.confidence || '',
    webpageUrl: candidate.webpageUrl || '',
    url: candidate.url || '',
    thumbnail: candidate.thumbnail || ''
  };
}
function cloneDownloadQueueRow(row) {
  var copy = {};
  Object.keys(row || {}).forEach(function (key) {
    if (key === '__candidateLoading' || key === '__candidateQueued' || key === '__candidatePromise') return;
    if (key === '__downloadCandidate') { copy[key] = cloneDownloadCandidate(row[key]); return; }
    if (key === '__downloadCandidates') {
      copy[key] = (Array.isArray(row[key]) ? row[key] : []).slice(0, 5).map(cloneDownloadCandidate).filter(Boolean);
      return;
    }
    var value = row[key];
    if (value === undefined || typeof value === 'function') return;
    try { copy[key] = JSON.parse(JSON.stringify(value)); } catch (e) { }
  });
  return copy;
}
function serializeDownloadQueueItem(item) {
  return {
    row: cloneDownloadQueueRow(item && item.row),
    title: (item && item.title) || '',
    artist: (item && item.artist) || '',
    status: (item && item.status) || 'queued',
    error: (item && item.error) || '',
    filePath: (item && item.filePath) || '',
    recoveryKey: (item && item.recoveryKey) || '',
    container: (item && item.container) || '',
    codec: (item && item.codec) || '',
    downloadPercent: item && typeof item.downloadPercent === 'number' ? item.downloadPercent : 0
  };
}
function serializeDownloadQueueJob(job) {
  return {
    id: job.id || '',
    type: job.type || 'tracks',
    playlistId: job.playlistId || '',
    playlistIds: Array.isArray(job.playlistIds) ? job.playlistIds.slice() : [],
    savePlaylists: !!job.savePlaylists,
    title: job.title || 'Downloads',
    status: job.status || 'queued',
    statusLabel: job.statusLabel || '',
    current: Number(job.current || 0),
    total: Number(job.total || 0),
    downloaded: Number(job.downloaded || 0),
    failed: Number(job.failed || 0),
    quality: job.quality || 'best-native',
    items: (job.items || []).map(serializeDownloadQueueItem)
  };
}
function persistDownloadQueueStateNow() {
  if (!downloadQueuePersistenceReady) return;
  if (downloadQueueSaveTimer) { clearTimeout(downloadQueueSaveTimer); downloadQueueSaveTimer = null; }
  try {
    if (!downloadQueue.length) localStorage.removeItem(DOWNLOAD_QUEUE_STORAGE_KEY);
    else localStorage.setItem(DOWNLOAD_QUEUE_STORAGE_KEY, JSON.stringify(downloadQueue.map(serializeDownloadQueueJob)));
  } catch (e) {
    console.warn('Could not persist download queue:', e);
  }
}
function persistDownloadQueueStateSoon() {
  if (!downloadQueuePersistenceReady) return;
  clearTimeout(downloadQueueSaveTimer);
  downloadQueueSaveTimer = setTimeout(function () {
    downloadQueueSaveTimer = null;
    persistDownloadQueueStateNow();
  }, 250);
}
function remapDownloadQueuePaths(remap) {
  if (!remap || typeof remap !== 'object') return;
  function remapValue(value) {
    if (typeof value !== 'string' || !value) return value;
    if (Object.prototype.hasOwnProperty.call(remap, value)) return remap[value];
    var stripped = stripFileUrl(value);
    if (Object.prototype.hasOwnProperty.call(remap, stripped)) return /^file:/i.test(value) ? toFileUrl(remap[stripped]) : remap[stripped];
    return value;
  }
  downloadQueue.forEach(function (job) {
    (job.items || []).forEach(function (item) {
      item.filePath = remapValue(item.filePath);
      var row = item.row;
      if (!row || typeof row !== 'object') return;
      ['FilePath', 'filePath', 'Path', 'path'].forEach(function (field) {
        if (typeof row[field] === 'string') row[field] = remapValue(row[field]);
      });
    });
  });
  persistDownloadQueueStateNow();
}
function rowsMatchDownloadQueueRecord(a, b) {
  var ap = getPlaylistTrackFilePath(a);
  var bp = getPlaylistTrackFilePath(b);
  if (ap && bp) return stripFileUrl(ap) === stripFileUrl(bp);
  return normalize(getImportTrackTitle(a)) === normalize(getImportTrackTitle(b)) &&
    normalize(getImportTrackArtist(a)) === normalize(getImportTrackArtist(b)) &&
    normalize(getImportTrackAlbum(a)) === normalize(getImportTrackAlbum(b));
}
function copyDownloadQueueRowRuntimeFields(source, target) {
  if (!source || !target) return;
  ['__downloadSelected', '__downloadStatus', '__downloadError', '__downloadCandidate', '__downloadCandidates', '__downloadCandidateManual', '__candidateError', '__candidateNotice', '__candidateQueryCount', '__strictAlbumMatch'].forEach(function (key) {
    delete target[key];
    if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
  });
}
function findPlaylistDownloadRow(job, row) {
  var ids = (job.playlistIds && job.playlistIds.length) ? job.playlistIds : (job.playlistId ? [job.playlistId] : []);
  var playlists = ids.length
    ? ids.map(function (id) { return state.playlists.find(function (p) { return p.id === id; }); }).filter(Boolean)
    : state.playlists.filter(function (p) { return p && !p.isSpecial; });
  for (var i = 0; i < playlists.length; i++) {
    var tracks = playlists[i].tracks || [];
    for (var j = 0; j < tracks.length; j++) {
      if (rowsMatchDownloadQueueRecord(tracks[j], row)) {
        copyDownloadQueueRowRuntimeFields(row, tracks[j]);
        return tracks[j];
      }
    }
  }
  return row;
}
function hydrateDownloadQueueItem(data, job, interrupted) {
  data = data || {};
  var row = cloneDownloadQueueRow(data.row || {});
  var status = data.status || 'queued';
  var error = data.error || '';
  if (status === 'searching' || status === 'downloading' || status === 'checking' || status === 'running') status = interrupted ? 'failed' : 'queued';
  if (interrupted && (status === 'queued' || status === 'searching' || status === 'downloading')) {
    status = 'failed';
    error = error || 'Interrupted by app restart';
  }
  row = findPlaylistDownloadRow(job, row);
  return {
    row: row,
    title: data.title || getImportTrackTitle(row),
    artist: data.artist || getImportTrackArtist(row),
    status: status,
    error: error,
    filePath: data.filePath || getPlaylistTrackFilePath(row),
    recoveryKey: typeof data.recoveryKey === 'string' ? data.recoveryKey : '',
    container: typeof data.container === 'string' ? data.container : '',
    codec: typeof data.codec === 'string' ? data.codec : '',
    downloadPercent: status === 'done' ? 100 : 0
  };
}
function hydrateDownloadQueueJob(data) {
  data = data || {};
  var originalStatus = data.status || 'queued';
  var interrupted = originalStatus === 'running' || originalStatus === 'checking';
  var job = {
    id: data.id || ('download_job_restore_' + Date.now() + '_' + (++downloadJobSeq)),
    type: data.type || 'tracks',
    playlistId: data.playlistId || '',
    playlistIds: Array.isArray(data.playlistIds) ? data.playlistIds.slice() : (data.playlistId ? [data.playlistId] : []),
    savePlaylists: !!data.savePlaylists,
    title: data.title || 'Downloads',
    status: interrupted ? 'failed' : originalStatus,
    statusLabel: interrupted ? 'Interrupted by app restart' : (data.statusLabel || originalStatus || 'queued'),
    current: Number(data.current || 0),
    total: 0,
    downloaded: 0,
    failed: 0,
    quality: ['best-native', 'opus', 'm4a', 'mp3'].includes(data.quality) ? data.quality : 'best-native',
    cancelRequested: false,
    items: []
  };
  if (!['queued', 'failed', 'done', 'cancelled'].includes(job.status)) job.status = 'failed';
  job.items = (Array.isArray(data.items) ? data.items : []).map(function (item) { return hydrateDownloadQueueItem(item, job, interrupted); });
  if (!job.items.length) return null;
  job.total = job.items.length;
  job.downloaded = job.items.filter(function (item) { return item.status === 'done'; }).length;
  job.failed = job.items.filter(function (item) { return item.status === 'failed'; }).length;
  var terminal = job.items.filter(function (item) { return item.status === 'done' || item.status === 'failed' || item.status === 'skipped' || item.status === 'cancelled'; }).length;
  if (job.status === 'queued') { job.current = 0; job.statusLabel = 'Queued'; }
  else if (job.status === 'done') { job.current = job.total; job.statusLabel = job.statusLabel || 'Complete'; }
  else if (job.status === 'cancelled') { job.current = Math.max(terminal, Number(data.current || 0)); job.statusLabel = job.statusLabel || 'Cancelled'; }
  else { job.current = Math.max(terminal, Number(data.current || 0)); job.statusLabel = job.statusLabel || 'Failed'; }
  job.current = Math.max(0, Math.min(job.total, job.current));
  return job;
}
function restoreDownloadQueueState() {
  downloadQueuePersistenceReady = false;
  try {
    var saved = JSON.parse(localStorage.getItem(DOWNLOAD_QUEUE_STORAGE_KEY) || '[]');
    downloadQueue = (Array.isArray(saved) ? saved : []).map(hydrateDownloadQueueJob).filter(Boolean);
    var restoredTerminal = downloadQueue.filter(function (job) { return job.status === 'done' || job.status === 'cancelled' || job.status === 'failed'; });
    if (restoredTerminal.length > 100) {
      var keepTerminal = new Set(restoredTerminal.slice(-100));
      var allTerminal = new Set(restoredTerminal);
      downloadQueue = downloadQueue.filter(function (job) { return !allTerminal.has(job) || keepTerminal.has(job); });
    }
  } catch (e) {
    console.warn('Could not restore download queue:', e);
    downloadQueue = [];
  }
  downloadQueuePersistenceReady = true;
  if (!downloadQueue.some(function (job) { return job.id === downloadQueueReview.jobId; })) downloadQueueReview = { jobId: '', itemIndex: -1 };
  renderDownloadQueue();
  if (downloadQueue.some(function (job) { return job.status === 'queued'; })) setTimeout(processDownloadQueue, 0);
}
function getMissingImportRows(onlySelected) {
  return getPlaylistImportRows().filter(function (item) {
    if (onlySelected && item.row.__downloadSelected === false) return false;
    return isPlaylistImportDownloadEligible(item.row);
  });
}
function setPlaylistImportProgress(active, label, current, total) {
  playlistImportProgress = {
    active: !!active,
    label: label || '',
    current: Number(current || 0),
    total: Number(total || 0),
  };
  updatePlaylistImportProgress();
  updatePlaylistImportActions();
}
function updatePlaylistImportProgress() {
  var wrap = $('playlist-import-progress');
  var bar = $('playlist-import-progress-bar');
  var text = $('playlist-import-progress-text');
  if (!wrap || !bar || !text) return;
  var total = playlistImportProgress.total || 0;
  var pct = total ? Math.max(0, Math.min(100, Math.round((playlistImportProgress.current / total) * 100))) : 0;
  wrap.hidden = !playlistImportProgress.active;
  bar.style.width = pct + '%';
  text.textContent = playlistImportProgress.label ? (playlistImportProgress.label + ' ' + playlistImportProgress.current + '/' + total + ' (' + pct + '%)') : '';
  var btn = $('playlist-import-download');
  if (btn) {
    btn.classList.remove('import-download-progressing');
    btn.style.setProperty('--playlist-import-button-progress', pct + '%');
  }
}

function getDownloadQueueActiveItems() {
  return downloadQueue.reduce(function (count, job) {
    return count + (job.items || []).filter(function (item) { return item.status === 'queued' || item.status === 'searching' || item.status === 'downloading'; }).length;
  }, 0);
}
function getDownloadQueueRunningJob() {
  return downloadQueue.find(function (job) { return job.status === 'running' || job.status === 'checking'; }) || null;
}
function hasActiveDownloadQueueJobs() {
  return downloadQueue.some(function (job) { return job.status === 'queued' || job.status === 'running' || job.status === 'checking'; });
}
function updateDownloadQueueItemProgress(data) {
  if (!data || !data.requestId) return;
  var item = downloadQueueItemsByRequestId.get(data.requestId);
  if (!item) return;
  item.downloadPercent = Math.max(0, Math.min(100, Number(data.percent || 0)));
  if (downloadQueueProgressFrame) return;
  downloadQueueProgressFrame = requestAnimationFrame(function () {
    downloadQueueProgressFrame = null;
    renderDownloadQueue();
  });
}
function isDownloadQueueItemReviewOpen(job, itemIndex) {
  return !!(job && downloadQueueReview.jobId === job.id && downloadQueueReview.itemIndex === itemIndex);
}
function getDownloadQueueItem(jobId, itemIndex) {
  var job = downloadQueue.find(function (j) { return j.id === jobId; });
  if (!job) return null;
  var item = (job.items || [])[itemIndex];
  return item ? { job: job, item: item, itemIndex: itemIndex } : null;
}
async function searchDownloadQueueItemCandidates(jobId, itemIndex) {
  var ctx = getDownloadQueueItem(jobId, itemIndex);
  if (!ctx || !ctx.item.row || ctx.item.candidateSearchBusy) return;
  ctx.item.candidateSearchBusy = true;
  ctx.item.error = '';
  renderDownloadQueue();
  try {
    await searchImportCandidates(ctx.item.row, true, true);
  } finally {
    ctx.item.candidateSearchBusy = false;
    renderDownloadQueue();
  }
}
function retryDownloadQueueItem(jobId, itemIndex) {
  var ctx = getDownloadQueueItem(jobId, itemIndex);
  if (!ctx || !ctx.item.row) return;
  if (!isPlaylistRecordMissing(ctx.item.row)) {
    ctx.item.status = 'skipped';
    ctx.item.error = 'Already in library';
    renderDownloadQueue();
    return;
  }
  pushDownloadQueueJob(makeDownloadQueueJob(ctx.job.type || 'retry', 'Retry: ' + (ctx.item.title || 'Track'), [ctx.item.row], ctx.job.playlistId || '', { savePlaylists: !!ctx.job.savePlaylists, playlistIds: ctx.job.playlistIds || [] }), 'Retry queued for ' + (ctx.item.title || 'track') + '.');
}
function renderDownloadQueue() {
  var panel = $('download-queue-panel');
  var list = $('download-queue-list');
  var summary = $('download-queue-summary');
  var badge = $('download-queue-badge');
  if (panel) {
    panel.classList.toggle('open', downloadQueuePanelOpen);
    panel.setAttribute('aria-hidden', downloadQueuePanelOpen ? 'false' : 'true');
  }
  var activeItems = getDownloadQueueActiveItems();
  if (badge) {
    badge.textContent = activeItems ? String(activeItems) : '';
    badge.style.display = activeItems ? 'flex' : 'none';
  }
  var running = getDownloadQueueRunningJob();
  if (summary) {
    if (running) summary.textContent = running.status === 'checking' ? 'Checking download tools' : 'Running ' + running.current + '/' + running.total;
    else if (downloadQueue.some(function (job) { return job.status === 'queued'; })) summary.textContent = 'Waiting to start';
    else summary.textContent = downloadQueue.length ? 'Finished' : 'No active downloads';
  }
  persistDownloadQueueStateSoon();
  if (!downloadQueuePanelOpen) return;
  if (!list) return;
  list.innerHTML = '';
  if (!downloadQueue.length) {
    list.innerHTML = '<div class="download-queue-empty">No downloads queued.</div>';
    requestAnimationFrame(positionDownloadQueuePanel);
    return;
  }
  downloadQueue.slice().reverse().forEach(function (job) {
    var card = document.createElement('div');
    card.className = 'download-job ' + (job.status || 'queued');
    var pct = job.total ? Math.round((job.current / job.total) * 100) : 0;
    var actionsHtml = '';
    if (job.status === 'failed') actionsHtml = '<button type="button" class="download-job-mini-btn retry" data-job-id="' + esc(job.id) + '">Retry failed</button>';
    else if (job.status === 'queued' || job.status === 'running') actionsHtml = '<button type="button" class="download-job-mini-btn cancel" data-job-id="' + esc(job.id) + '">' + (job.status === 'running' ? 'Stop' : 'Cancel') + '</button>';
    var qualityLabel = { 'best-native': 'Best Native', opus: 'Opus', m4a: 'M4A / AAC', mp3: 'MP3' }[job.quality] || 'Best Native';
    card.innerHTML = '<div class="download-job-top"><div><strong>' + esc(job.title || 'Download job') + '</strong><span>' + esc(job.statusLabel || job.status || 'queued') + ' • ' + esc(qualityLabel) + ' • ' + job.current + '/' + job.total + '</span></div><div class="download-job-side"><em>' + pct + '%</em>' + actionsHtml + '</div></div>' +
      '<div class="download-job-bar"><span style="width:' + pct + '%"></span></div>';
    var retryBtn = card.querySelector('.download-job-mini-btn.retry');
    if (retryBtn) retryBtn.addEventListener('click', function (e) { e.stopPropagation(); retryDownloadQueueJob(job.id); });
    var cancelBtn = card.querySelector('.download-job-mini-btn.cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function (e) { e.stopPropagation(); cancelDownloadQueueJob(job.id); });
    var items = document.createElement('div');
    items.className = 'download-job-items';
    (job.items || []).forEach(function (item, itemIndex) {
      var row = document.createElement('div');
      row.className = 'download-job-item ' + (item.status || 'queued');
      var icon = item.status === 'done' ? 'ph-check-circle' : (item.status === 'failed' ? 'ph-warning-circle' : (item.status === 'downloading' ? 'ph-download-simple' : (item.status === 'searching' ? 'ph-magnifying-glass' : 'ph-clock')));
      var progressText = item.status === 'downloading' && typeof item.downloadPercent === 'number' ? ' • ' + Math.round(item.downloadPercent) + '%' : '';
      var outputInfo = item.status === 'done' && item.container
        ? ' • ' + esc(String(item.container).toUpperCase()) + (item.codec ? ' / ' + esc(String(item.codec)) : '')
        : '';
      var itemActions = '';
      if (item.status === 'done' && item.filePath) itemActions = '<button type="button" class="download-job-file-btn go-file">Go to file</button>';
      else if (item.status === 'failed' && item.row) itemActions = '<span class="download-job-item-actions"><button type="button" class="download-job-file-btn review-candidate">Review</button><button type="button" class="download-job-file-btn retry-item">Retry</button></span>';
      row.innerHTML = '<i class="ph ' + icon + '"></i><span><strong>' + esc(item.title || 'Unknown Track') + '</strong><small>' + esc(item.artist || '') + progressText + outputInfo + (item.error ? ' • ' + esc(item.error) : '') + '</small></span>' + itemActions;
      var fileBtn = row.querySelector('.go-file');
      if (fileBtn) fileBtn.addEventListener('click', function (e) { e.stopPropagation(); showFileLocation(item.filePath); });
      var reviewBtn = row.querySelector('.review-candidate');
      if (reviewBtn) reviewBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isDownloadQueueItemReviewOpen(job, itemIndex)) {
          if (item.candidateSearchBusy) cancelCandidateSearchRequest(item.row);
          downloadQueueReview = { jobId: '', itemIndex: -1 };
        } else downloadQueueReview = { jobId: job.id, itemIndex: itemIndex };
        renderDownloadQueue();
      });
      var retryItemBtn = row.querySelector('.retry-item');
      if (retryItemBtn) retryItemBtn.addEventListener('click', function (e) { e.stopPropagation(); retryDownloadQueueItem(job.id, itemIndex); });
      items.appendChild(row);
      if (item.status === 'failed' && item.row && isDownloadQueueItemReviewOpen(job, itemIndex)) {
        var panel = document.createElement('div');
        panel.className = 'download-job-candidate-panel';
        var selectedCandidate = item.row.__downloadCandidate;
        panel.innerHTML = '<div class="download-job-candidate-head"><span>' + (selectedCandidate ? ('Selected: ' + esc(formatImportCandidateConfidence(selectedCandidate)) + ' confidence') : 'No candidate selected') + '</span><button type="button" class="download-job-mini-btn search-candidates">' + (item.candidateSearchBusy ? 'Searching...' : 'Search again') + '</button></div>';
        var searchBtn = panel.querySelector('.search-candidates');
        if (searchBtn) {
          searchBtn.disabled = !!item.candidateSearchBusy;
          searchBtn.addEventListener('click', function (e) { e.stopPropagation(); searchDownloadQueueItemCandidates(job.id, itemIndex); });
        }
        if (item.row.__candidateNotice || item.row.__candidateError) {
          var note = document.createElement('div');
          note.className = item.row.__candidateError ? 'playlist-import-candidate-error' : 'playlist-import-candidate-note';
          note.textContent = item.row.__candidateError || item.row.__candidateNotice;
          panel.appendChild(note);
        }
        if (item.row.__downloadCandidates && item.row.__downloadCandidates.length) {
          var candidateBox = document.createElement('div');
          candidateBox.className = 'playlist-import-candidates download-job-candidates';
          item.row.__downloadCandidates.forEach(function (candidate) {
            var candidateBtn = document.createElement('button');
            candidateBtn.type = 'button';
            var confidence = getImportCandidateConfidence(candidate);
            candidateBtn.className = 'playlist-import-candidate confidence-' + confidence + (selectedCandidate && getImportCandidateUrl(selectedCandidate) === getImportCandidateUrl(candidate) ? ' selected' : '');
            var thumb = candidate.thumbnail ? '<img src="' + esc(candidate.thumbnail) + '" alt="" />' : '<span class="playlist-import-candidate-thumb"><i class="ph ph-play"></i></span>';
            candidateBtn.innerHTML = thumb + '<span><strong>' + esc(candidate.title || 'Unknown video') + '</strong><small>' + esc(candidate.uploader || '') + ' - ' + esc(formatImportCandidateDuration(candidate.duration)) + ' - ' + esc(formatImportCandidateConfidence(candidate)) + ' confidence - score ' + esc(candidate.score) + '</small></span>';
            candidateBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              if (selectedCandidate && getImportCandidateUrl(selectedCandidate) === getImportCandidateUrl(candidate)) setImportRowCandidate(item.row, null, false);
              else setImportRowCandidate(item.row, candidate, true);
              item.error = '';
              renderDownloadQueue();
            });
            candidateBox.appendChild(candidateBtn);
          });
          panel.appendChild(candidateBox);
        }
        var retrySelected = document.createElement('button');
        retrySelected.type = 'button';
        retrySelected.className = 'download-job-file-btn retry-selected';
        retrySelected.textContent = selectedCandidate ? 'Retry selected' : 'Retry with auto-search';
        retrySelected.addEventListener('click', function (e) { e.stopPropagation(); retryDownloadQueueItem(job.id, itemIndex); });
        panel.appendChild(retrySelected);
        items.appendChild(panel);
      }
    });
    card.appendChild(items);
    list.appendChild(card);
  });
  requestAnimationFrame(positionDownloadQueuePanel);
}
function setDownloadQueuePanel(open) {
  downloadQueuePanelOpen = !!open;
  var trigger = $('btn-download-queue');
  if (trigger) trigger.setAttribute('aria-expanded', downloadQueuePanelOpen ? 'true' : 'false');
  if (!downloadQueuePanelOpen) {
    cancelDirectDownloadSearch();
    downloadQueue.forEach(function (job) {
      (job.items || []).forEach(function (item) { if (item.candidateSearchBusy && item.row) cancelCandidateSearchRequest(item.row); });
    });
  }
  renderDownloadQueue();
  if (downloadQueuePanelOpen) requestAnimationFrame(function () {
    positionDownloadQueuePanel();
    var searchToggle = $('download-search-toggle');
    if (searchToggle) searchToggle.focus();
  });
  else if (trigger) requestAnimationFrame(function () { trigger.focus(); });
}

function positionDownloadQueuePanel() {
  var panel = $('download-queue-panel');
  var trigger = $('btn-download-queue');
  if (!downloadQueuePanelOpen || !panel || !trigger) return;
  var viewportPadding = 16;
  var gap = 10;
  var triggerRect = trigger.getBoundingClientRect();
  var panelWidth = panel.offsetWidth || Math.min(420, window.innerWidth - (viewportPadding * 2));
  var panelHeight = panel.offsetHeight || 0;
  var left = triggerRect.right + gap;
  if (left + panelWidth > window.innerWidth - viewportPadding) left = triggerRect.left - gap - panelWidth;
  left = Math.max(viewportPadding, Math.min(left, window.innerWidth - panelWidth - viewportPadding));
  var top = triggerRect.top;
  top = Math.max(viewportPadding, Math.min(top, window.innerHeight - panelHeight - viewportPadding));
  panel.style.left = Math.round(left) + 'px';
  panel.style.top = Math.round(top) + 'px';
  panel.style.right = 'auto';
}
function cancelDirectDownloadSearch() {
  if (!directDownloadSearchRequestId) return;
  var requestId = directDownloadSearchRequestId;
  directDownloadSearchRequestId = '';
  directDownloadSearchRequestSeq++;
  if (window.api.cancelDownload) Promise.resolve(window.api.cancelDownload(requestId)).catch(function (e) { console.error('Direct download search cancellation failed:', e); });
}
function setDirectDownloadSearchOpen(open) {
  var panel = $('download-search');
  var toggle = $('download-search-toggle');
  if (!panel) return;
  panel.hidden = !open;
  if (toggle) toggle.setAttribute('aria-pressed', open ? 'true' : 'false');
  if (open) {
    var input = $('download-search-query');
    if (input) input.focus({ preventScroll: true });
  } else cancelDirectDownloadSearch();
}
function renderDirectDownloadSearchResults(candidates) {
  var results = $('download-search-results');
  if (!results) return;
  results.replaceChildren();
  (candidates || []).forEach(function (candidate) {
    if (!candidate || !/^[A-Za-z0-9_-]{11}$/.test(String(candidate.id || ''))) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'download-search-result';
    var thumb = candidate.thumbnail ? '<img src="' + esc(candidate.thumbnail) + '" alt="">' : '<span class="download-search-result-thumb"><i class="ph ph-music-note" aria-hidden="true"></i></span>';
    button.innerHTML = thumb + '<span><strong>' + esc(candidate.title || 'Unknown video') + '</strong><small>' + esc(candidate.uploader || 'Unknown uploader') + ' • ' + esc(formatImportCandidateDuration(candidate.duration)) + '</small></span><i class="ph ph-download-simple" aria-hidden="true"></i>';
    button.addEventListener('click', function () { enqueueDirectSearchDownload(candidate); });
    results.appendChild(button);
  });
}
async function searchDirectDownload() {
  var input = $('download-search-query');
  var status = $('download-search-status');
  var submit = $('download-search-submit');
  var query = String(input && input.value || '').replace(/\s+/g, ' ').trim();
  if (query.length < 2) {
    if (status) status.textContent = 'Enter an artist and track to search.';
    renderDirectDownloadSearchResults([]);
    if (input) input.focus();
    return;
  }
  cancelDirectDownloadSearch();
  var requestSeq = ++directDownloadSearchRequestSeq;
  var requestId = 'direct_download_search_' + Date.now() + '_' + requestSeq;
  directDownloadSearchRequestId = requestId;
  if (submit) { submit.disabled = true; submit.innerHTML = '<i class="ph ph-spinner-gap ph-spin" aria-hidden="true"></i> Searching'; }
  if (status) status.textContent = 'Searching YouTube…';
  renderDirectDownloadSearchResults([]);
  try {
    var result = await window.api.searchDownloadCandidates({ searchQuery: query }, 10, requestId);
    if (requestSeq !== directDownloadSearchRequestSeq || directDownloadSearchRequestId !== requestId) return;
    if (!result || !result.ok) {
      if (status) status.textContent = (result && result.cancelled) ? '' : ((result && result.error) || 'Search failed.');
      return;
    }
    var candidates = (result.candidates || []).filter(function (candidate) { return /^[A-Za-z0-9_-]{11}$/.test(String(candidate && candidate.id || '')); });
    if (status) status.textContent = candidates.length ? (candidates.length + ' results. Choose one to queue it.') : 'No results found.';
    renderDirectDownloadSearchResults(candidates);
  } catch (e) {
    if (requestSeq === directDownloadSearchRequestSeq && status) status.textContent = 'Search failed: ' + ((e && e.message) || String(e || 'unknown error'));
  } finally {
    if (requestSeq === directDownloadSearchRequestSeq && directDownloadSearchRequestId === requestId) {
      directDownloadSearchRequestId = '';
      if (submit) { submit.disabled = false; submit.innerHTML = '<i class="ph ph-magnifying-glass" aria-hidden="true"></i> Search'; }
    }
  }
}
function enqueueDirectSearchDownload(candidate) {
  if (!candidate || !/^[A-Za-z0-9_-]{11}$/.test(String(candidate.id || ''))) return;
  var row = {
    Song: String(candidate.title || 'Unknown Track').slice(0, 1000),
    Artist: String(candidate.uploader || 'Unknown Artist').slice(0, 1000),
    Duration: Number(candidate.duration || 0),
    VideoId: candidate.id
  };
  var job = makeDownloadQueueJob('direct-search', 'Download: ' + row.Song, [row], '');
  if (!job) { showToast('Already in Library or already queued.'); return; }
  pushDownloadQueueJob(job, 'Queued "' + row.Song + '" for download.');
  setDirectDownloadSearchOpen(false);
}
function makeDownloadQueueJob(type, title, rows, playlistId, options) {
  options = options || {};
  var activeIdentities = new Set();
  downloadQueue.forEach(function (job) { (job.items || []).forEach(function (item) {
    if (['queued', 'searching', 'downloading'].includes(item.status)) activeIdentities.add(getMusicalIdentity(item.row));
  }); });
  var seen = new Set();
  rows = (rows || []).filter(function (row) {
    var identity = getMusicalIdentity(row);
    if (!isPlaylistImportDownloadEligible(row) || !identity || seen.has(identity) || activeIdentities.has(identity)) return false;
    seen.add(identity); return true;
  });
  if (!rows.length) return null;
  rows.forEach(prepareDownloadQueueRow);
  return {
    id: 'download_job_' + Date.now() + '_' + (++downloadJobSeq),
    type: type || 'tracks',
    playlistId: playlistId || '',
    playlistIds: options.playlistIds || (playlistId ? [playlistId] : []),
    savePlaylists: !!options.savePlaylists,
    title: title || 'Downloads',
    status: 'queued',
    statusLabel: 'Queued',
    current: 0,
    total: rows.length,
    downloaded: 0,
    failed: 0,
    cancelRequested: false,
    quality: appSettings.ytdlDownloadQuality || 'best-native',
    items: rows.map(function (row) { return { row: row, title: getImportTrackTitle(row), artist: getImportTrackArtist(row), identity: getMusicalIdentity(row), status: 'queued', error: '' }; })
  };
}
function pushDownloadQueueJob(job, toastMessage) {
  if (!job) return null;
  var terminalJobs = downloadQueue.filter(function (existing) { return existing.status === 'done' || existing.status === 'cancelled' || existing.status === 'failed'; });
  while (terminalJobs.length >= 100) {
    var oldest = terminalJobs.shift();
    var oldestIndex = downloadQueue.indexOf(oldest);
    if (oldestIndex !== -1) downloadQueue.splice(oldestIndex, 1);
  }
  downloadQueue.push(job);
  setDownloadQueuePanel(true);
  renderDownloadQueue();
  processDownloadQueue();
  if (toastMessage) showToast(toastMessage);
  return job;
}
function enqueueExistingPlaylistDownloadJob(importState) {
  if (!importState || !importState.existingPlaylistId) return null;
  var pl = state.playlists.find(function (p) { return p.id === importState.existingPlaylistId; });
  var rows = getPlaylistImportRows().filter(function (item) { return item.row.__downloadSelected !== false && isPlaylistImportDownloadEligible(item.row); }).map(function (item) { return item.row; });
  if (!pl || !rows.length) { showToast('No selected missing tracks to download.'); return null; }
  return pushDownloadQueueJob(makeDownloadQueueJob('existing-playlist', pl.name || 'Playlist Downloads', rows, pl.id, { savePlaylists: true }), 'Queued ' + rows.length + ' download' + (rows.length === 1 ? '' : 's') + ' for "' + (pl.name || 'playlist') + '".');
}
function enqueueImportedPlaylistDownloadJob(title, rows, firstPlaylistId, playlistIds) {
  rows = (rows || []).filter(function (row) { return row.__downloadSelected !== false && isPlaylistImportDownloadEligible(row); });
  if (!rows.length) return null;
  return pushDownloadQueueJob(makeDownloadQueueJob('imported-playlist', title || 'Imported Playlist Downloads', rows, firstPlaylistId || '', { savePlaylists: true, playlistIds: playlistIds || [] }), 'Queued ' + rows.length + ' imported playlist download' + (rows.length === 1 ? '' : 's') + '.');
}
function enqueueAlbumDownloadJob(title, rows) {
  rows = (rows || []).filter(isAlbumDownloadRowMissing);
  if (!rows.length) { showToast('No missing tracks found for this album.'); return null; }
  return pushDownloadQueueJob(makeDownloadQueueJob('album-release', title || 'Album Downloads', rows, ''), 'Queued ' + rows.length + ' album download' + (rows.length === 1 ? '' : 's') + '.');
}
function cancelDownloadQueueJob(jobId) {
  var job = downloadQueue.find(function (j) { return j.id === jobId; });
  if (!job) return;
  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.statusLabel = 'Cancelled';
    job.current = job.total;
    (job.items || []).forEach(function (item) { if (item.status === 'queued') item.status = 'cancelled'; });
  } else if (job.status === 'running') {
    job.cancelRequested = true;
    job.statusLabel = 'Stopping after current track';
    var searching = (job.items || []).find(function (item) { return item.status === 'searching' && item.row && item.row.__candidateIpcRequestId; });
    if (searching) cancelCandidateSearchRequest(searching.row);
    var active = (job.items || []).find(function (item) { return item.status === 'downloading' && item.requestId; });
    if (active && window.api.cancelDownload) window.api.cancelDownload(active.requestId);
    (job.items || []).forEach(function (item) { if (item.status === 'queued') item.status = 'cancelled'; });
  }
  renderDownloadQueue();
}
function retryDownloadQueueJob(jobId) {
  var job = downloadQueue.find(function (j) { return j.id === jobId; });
  if (!job) return;
  var rows = (job.items || []).filter(function (item) { return item.status === 'failed' && item.row && isPlaylistRecordMissing(item.row); }).map(function (item) { return item.row; });
  if (!rows.length) { showToast('No failed missing tracks to retry.'); return; }
  pushDownloadQueueJob(makeDownloadQueueJob(job.type || 'retry', 'Retry: ' + (job.title || 'Downloads'), rows, job.playlistId || '', { savePlaylists: !!job.savePlaylists, playlistIds: job.playlistIds || [] }), 'Retry queued for ' + rows.length + ' track' + (rows.length === 1 ? '' : 's') + '.');
}
async function processDownloadQueue() {
  if (downloadQueueProcessing) return;
  downloadQueueProcessing = true;
  try {
    var job;
    while ((job = downloadQueue.find(function (j) { return j.status === 'queued'; }))) {
      await runDownloadQueueJob(job);
    }
  } finally {
    downloadQueueProcessing = false;
    renderDownloadQueue();
  }
}
function failDownloadQueueJob(job, statusLabel, itemError) {
  job.status = 'failed';
  job.statusLabel = statusLabel || 'Failed';
  job.failed = 0;
  job.current = job.total;
  (job.items || []).forEach(function (item) {
    if (item.status === 'done' || item.status === 'skipped') return;
    item.status = 'failed';
    item.error = itemError || statusLabel || 'Download failed';
    job.failed++;
    if (item.row) {
      item.row.__downloadStatus = 'failed';
      item.row.__downloadError = item.error;
    }
  });
  renderDownloadQueue();
}
async function ensureDownloadToolsReadyForJob(job) {
  if (!window.api.checkYtdlpTools) return true;
  job.status = 'checking';
  job.statusLabel = 'Checking yt-dlp / ffmpeg';
  renderDownloadQueue();
  try {
    var res = await window.api.checkYtdlpTools();
    if (res && res.ok) return true;
    var error = (res && res.error) || 'yt-dlp / ffmpeg check unavailable.';
    failDownloadQueueJob(job, 'Tools missing', error);
    showToast(error);
    return false;
  } catch (e) {
    var message = (e && e.message) || String(e || 'yt-dlp / ffmpeg check failed.');
    failDownloadQueueJob(job, 'Tool check failed', message);
    showToast(message);
    return false;
  }
}

function syncDownloadedPlaylistRow(row, result) {
  if (!row || !result) return;
  if (result.filePath) row.FilePath = result.filePath;
  var canonical = result.canonicalMetadata || {};
  var libraryItem = result.libraryItem || {};
  var fields = [
    ['Song', canonical.title || libraryItem.title],
    ['Artist', canonical.artist || libraryItem.artist],
    ['Album', canonical.album || libraryItem.album],
    ['AlbumArtist', canonical.albumArtist || libraryItem.albumArtist]
  ];
  fields.forEach(function (field) {
    var value = typeof field[1] === 'string' ? field[1].trim() : '';
    if (value && !/^unknown (?:artist|album)$/i.test(value)) row[field[0]] = value;
  });
  var measuredDuration = Number(libraryItem.duration) || 0;
  var canonicalDuration = Number(canonical.duration) || 0;
  if (measuredDuration > 0) row.Duration = measuredDuration;
  else if (canonicalDuration > 0) {
    // Stream-copy containers do not always expose their duration immediately
    // after tagging. Preserve release metadata in both playlist and library.
    row.Duration = canonicalDuration;
    libraryItem.duration = canonicalDuration;
  }
}

async function commitDownloadedItem(job, item, row, result, fileMap) {
  syncDownloadedPlaylistRow(row, result);
  if (result.libraryItem && result.libraryItem.filePath) fileMap[stripFileUrl(result.libraryItem.filePath)] = result.libraryItem;
  setMusicFiles(Object.values(fileMap));
  reconcilePlaybackQueuesWithLibrary();
  await persistLibrary(state.musicFiles);
  if (job.playlistId || job.savePlaylists) await persistPlaylists(state.playlists);
  await persistSettings(appSettings);
  if (result.recoveryId && window.api.acknowledgeDownloadRecovery) await window.api.acknowledgeDownloadRecovery(result.recoveryId);
  item.status = 'done'; item.error = ''; item.filePath = result.filePath;
  item.container = String(result.container || '').slice(0, 32);
  item.codec = String(result.codec || '').slice(0, 120);
  item.downloadPercent = 100;
}

async function recoverPendingDownloads() {
  if (!window.api.listPendingDownloadRecoveries) return;
  var recoveries = await window.api.listPendingDownloadRecoveries();
  if (!Array.isArray(recoveries) || !recoveries.length) return;
  var fileMap = {};
  state.musicFiles.forEach(function (file) { if (file && file.filePath) fileMap[stripFileUrl(file.filePath)] = file; });
  var recovered = 0;
  for (var i = 0; i < recoveries.length; i++) {
    var recovery = recoveries[i];
    if (!recovery || !recovery.libraryItem || !recovery.libraryItem.filePath) continue;
    fileMap[stripFileUrl(recovery.libraryItem.filePath)] = recovery.libraryItem;
    downloadQueue.forEach(function (job) { (job.items || []).forEach(function (item) {
      if (item.recoveryKey !== recovery.id) return;
      syncDownloadedPlaylistRow(item.row, recovery);
      item.status = 'done'; item.error = ''; item.filePath = recovery.libraryItem.filePath;
      var extensionMatch = String(recovery.libraryItem.filePath || '').match(/\.([a-z0-9]{1,12})$/i);
      item.container = extensionMatch ? extensionMatch[1].toLowerCase() : item.container;
      item.codec = String(recovery.libraryItem.codec || item.codec || '').slice(0, 120);
      item.downloadPercent = 100;
    }); });
    recovered++;
  }
  if (!recovered) return;
  setMusicFiles(Object.values(fileMap));
  reconcilePlaybackQueuesWithLibrary();
  await persistLibrary(state.musicFiles);
  await persistPlaylists(state.playlists);
  await persistSettings(appSettings);
  for (var j = 0; j < recoveries.length; j++) if (recoveries[j] && recoveries[j].id && window.api.acknowledgeDownloadRecovery) await window.api.acknowledgeDownloadRecovery(recoveries[j].id);
  persistDownloadQueueStateNow();
  showToast('Recovered ' + recovered + ' completed download' + (recovered === 1 ? '' : 's') + '.');
}

async function runDownloadQueueJob(job) {
  var pl = job.playlistId ? state.playlists.find(function (p) { return p.id === job.playlistId; }) : null;
  if (job.playlistId && !pl) { job.status = 'failed'; job.statusLabel = 'Playlist missing'; renderDownloadQueue(); return; }
  if (!(await ensureDownloadToolsReadyForJob(job))) return;
  job.status = 'running'; job.statusLabel = 'Starting'; job.current = 0; renderDownloadQueue();
  var fileMap = {};
  state.musicFiles.forEach(function (f) { if (f.filePath) fileMap[stripFileUrl(f.filePath)] = f; });
  for (var i = 0; i < job.items.length; i++) {
    if (job.cancelRequested) break;
    var item = job.items[i];
    if (item.status === 'cancelled') continue;
    var row = item.row;
    if (!row || !isPlaylistRecordMissing(row)) {
      item.status = 'skipped'; item.error = 'Already in library'; job.current++; renderDownloadQueue(); continue;
    }
    item.status = 'searching'; item.error = ''; job.statusLabel = 'Searching'; renderDownloadQueue();
    var hasDirectVideoId = /^[A-Za-z0-9_-]{11}$/.test(String(row.VideoId || ''));
    if (!row.__downloadCandidate && !hasDirectVideoId) await searchImportCandidates(row, true);
    if (job.cancelRequested) { item.status = 'cancelled'; item.error = 'Cancelled'; break; }
    if (!row.__downloadCandidate && !hasDirectVideoId) {
      item.status = 'failed'; item.error = 'No high-confidence candidate selected'; row.__downloadStatus = 'failed'; row.__downloadError = item.error; job.failed++; job.current++; renderDownloadQueue(); continue;
    }
    if (getImportCandidateConfidence(row.__downloadCandidate) === 'low' && !row.__downloadCandidateManual) {
      item.status = 'failed'; item.error = 'Low-confidence candidate'; row.__downloadStatus = 'failed'; row.__downloadError = item.error; job.failed++; job.current++; renderDownloadQueue(); continue;
    }
    row.__downloadStatus = 'downloading'; row.__downloadError = '';
    item.status = 'downloading'; item.error = ''; item.downloadPercent = 0; item.requestId = job.id + '_' + i + '_' + Date.now(); item.recoveryKey = item.recoveryKey || ('download_' + String(job.id).replace(/[^A-Za-z0-9_-]/g, '') + '_' + i); row.__downloadRecoveryKey = item.recoveryKey; job.statusLabel = 'Downloading'; persistDownloadQueueStateNow(); renderDownloadQueue();
    downloadQueueItemsByRequestId.set(item.requestId, item);
    var res;
    try { res = await downloadImportRowWithFallback(row, appSettings.ytdlDownloadFolder || '', item.requestId); }
    finally { downloadQueueItemsByRequestId.delete(item.requestId); }
    if (res && res.ok && res.filePath) {
      try { await commitDownloadedItem(job, item, row, res, fileMap); job.downloaded++; }
      catch (commitError) { item.status = 'failed'; item.error = 'Downloaded but could not commit: ' + (commitError.message || commitError); row.__downloadStatus = 'failed'; row.__downloadError = item.error; job.failed++; }
    } else if (res && res.cancelled) {
      item.status = 'cancelled'; item.error = 'Cancelled'; row.__downloadStatus = 'failed'; row.__downloadError = item.error;
    } else {
      item.status = 'failed'; item.error = (res && res.error) || 'Download failed'; row.__downloadStatus = 'failed'; row.__downloadError = item.error; job.failed++;
    }
    job.current++;
    renderDownloadQueue();
  }
  job.items.forEach(function (item) { if (item.row) clearImportRowTransient(item.row); });
  if (job.cancelRequested) {
    job.status = 'cancelled';
    job.statusLabel = 'Cancelled';
    showToast('Cancelled downloads for "' + (job.title || 'job') + '".');
  } else {
    job.status = job.failed ? 'failed' : 'done';
    job.statusLabel = job.failed ? ('Finished with ' + job.failed + ' failed') : 'Complete';
    if (job.failed) showToast('Download job finished: ' + job.downloaded + ' done, ' + job.failed + ' failed.');
    else showToast('Downloaded ' + job.downloaded + ' track' + (job.downloaded === 1 ? '' : 's') + '.');
  }
  renderSidebarPlaylists();
  if (job.playlistId && state.currentView === job.playlistId) renderPlaylistPreservingScroll(job.playlistId);
  else if (job.savePlaylists && job.playlistIds && job.playlistIds.includes(state.currentView)) renderPlaylistPreservingScroll(state.currentView);
  else if (!job.playlistId && !refreshCurrentAlbumViewAfterDownload(job) && state.currentView === 'library') renderLibrary();
  renderDownloadQueue();
}

function getMetadataSourceOptions() {
  return {
    discogsToken: appSettings.discogsToken || ''
  };
}
function flattenMetadataReleaseTracks(release) {
  var sourceName = release && release.source ? release.source : 'Metadata';
  var albumArtist = readArtistCredit(release && release['artist-credit']);
  var albumTitle = release && release.title ? release.title : '';
  var year = release && release.date ? String(release.date).substring(0, 4) : '';
  var coverUrl = release && (release.coverUrl || (/^MusicBrainz$/i.test(sourceName) && release.id ? ('https://coverartarchive.org/release/' + release.id + '/front-500') : '')) || '';
  var genre = release && release.genres && release.genres[0] ? release.genres[0].name : '';
  var tracks = [];
  (release && release.media ? release.media : []).forEach(function (medium, mediumIndex) {
    var discNo = medium.position || (mediumIndex + 1);
    var discTotal = release.media.length;
    var discTracks = medium.tracks || [];
    discTracks.forEach(function (track, trackIndex) {
      tracks.push({
        title: track.title || '',
        artist: readArtistCredit(track['artist-credit']) || readArtistCredit(track.recording && track.recording['artist-credit']) || track.artist || albumArtist,
        album: albumTitle,
        albumArtist: albumArtist,
        year: year,
        genre: genre,
        coverUrl: coverUrl,
        trackNo: track.position || (trackIndex + 1),
        trackTotal: discTracks.length,
        discNo: discNo,
        discTotal: discTotal,
        duration: track.length || 0,
      });
    });
  });
  return { sourceName: sourceName, albumArtist: albumArtist, albumTitle: albumTitle, year: year, coverUrl: coverUrl, genre: genre, tracks: tracks };
}
function metadataTracksToDownloadRows(meta) {
  return (meta.tracks || []).map(function (track) {
    return {
      Song: track.title || '',
      Artist: track.artist || meta.albumArtist || '',
      Album: track.album || meta.albumTitle || '',
      AlbumArtist: track.albumArtist || meta.albumArtist || '',
      AlbumDate: track.year || meta.year || '',
      Genre: track.genre || meta.genre || '',
      TrackNo: track.trackNo || 0,
      TrackTotal: track.trackTotal || 0,
      DiscNo: track.discNo || 0,
      DiscTotal: track.discTotal || 0,
      Duration: track.duration || 0,
      CoverUrl: track.coverUrl || meta.coverUrl || '',
      __strictAlbumMatch: true,
    };
  });
}
function isAlbumDownloadRowMissing(row) {
  return !(row && row.__autoTagLocalFilePath) && isPlaylistRecordMissing(row);
}
function importPlaylistGroups(groups, conflictMode) {
  var firstPlaylistId = '';
  var playlistIds = [];
  var importedRows = [];
  var importAddedAtMs = Date.now();
  conflictMode = conflictMode === 'merge' || conflictMode === 'replace' ? conflictMode : 'create';
  groups.forEach(function (group, idx) {
    var existing = state.playlists.find(function (p) { return !p.isSpecial && (p.name || '').toLowerCase() === (group.name || '').toLowerCase(); });
    if (existing && conflictMode === 'merge') {
      if (!existing.tracks) existing.tracks = [];
      var existingByKey = new Map(existing.tracks.map(function (t) { return [getPlaylistTrackFilePath(t) || ((t.Song || t.title || '').toLowerCase() + '|' + (t.Artist || t.artist || '').toLowerCase() + '|' + (t.Album || t.album || '').toLowerCase()), t]; }));
      var appended = false;
      group.tracks.forEach(function (t) {
        var importKey = getPlaylistTrackFilePath(t) || ((t.Song || t.title || '').toLowerCase() + '|' + (t.Artist || t.artist || '').toLowerCase() + '|' + (t.Album || t.album || '').toLowerCase());
        var target = existingByKey.get(importKey);
        if (!target) {
          target = stampPlaylistTrackAddedAt(t, importAddedAtMs);
          existing.tracks.push(target);
          existingByKey.set(importKey, target);
          appended = true;
        } else {
          copyImportRowTransient(t, target);
        }
        importedRows.push(target);
      });
      if (appended) existing.lastAddedAt = new Date(importAddedAtMs).toISOString();
      if (!firstPlaylistId) firstPlaylistId = existing.id;
      if (!playlistIds.includes(existing.id)) playlistIds.push(existing.id);
    } else if (existing && conflictMode === 'replace') {
      group.tracks.forEach(function (track) { stampPlaylistTrackAddedAt(track, importAddedAtMs); });
      existing.tracks = group.tracks;
      existing.lastAddedAt = new Date(importAddedAtMs).toISOString();
      if (!firstPlaylistId) firstPlaylistId = existing.id;
      if (!playlistIds.includes(existing.id)) playlistIds.push(existing.id);
      importedRows.push.apply(importedRows, existing.tracks);
    } else {
      group.tracks.forEach(function (track) { stampPlaylistTrackAddedAt(track, importAddedAtMs); });
      var importedName = existing ? getUniquePlaylistName(group.name || 'Imported Playlist') : (group.name || 'Imported Playlist');
      var pl = { id: 'pl_' + Date.now() + '_' + idx, name: importedName, cover: null, color: PALETTE[idx % PALETTE.length], tracks: group.tracks, pinned: false, lastPlayed: null, lastAddedAt: new Date(importAddedAtMs).toISOString() };
      state.playlists.push(pl);
      if (!firstPlaylistId) firstPlaylistId = pl.id;
      playlistIds.push(pl.id);
      importedRows.push.apply(importedRows, pl.tracks);
    }
  });
  return { firstPlaylistId: firstPlaylistId, playlistIds: playlistIds, rows: importedRows };
}
function updatePlaylistImportActions() {
  var rows = getPlaylistImportRows();
  var downloadable = rows.filter(function (item) { return isPlaylistImportDownloadEligible(item.row); });
  var selected = downloadable.filter(function (item) { return item.row.__downloadSelected !== false; }).length;
  var localCandidates = rows.filter(function (item) { return isLocalPlaylistImportCandidate(item.row); });
  var selectedLocal = localCandidates.filter(function (item) { return item.row.__addLocalSelected === true; }).length;
  var busy = !!(pendingPlaylistImport && pendingPlaylistImport.finishing) || playlistImportSearching || rows.some(function (item) { return !!item.row.__candidateLoading; });
  var btn = $('playlist-import-download');
  if (btn) {
    btn.hidden = downloadable.length === 0;
    btn.disabled = busy || selected <= 0;
    btn.textContent = 'Import + Download Selected' + (selected ? ' (' + selected + ')' : '');
  }
  var addLocalBtn = $('playlist-import-add-local');
  if (addLocalBtn) {
    addLocalBtn.hidden = localCandidates.length === 0;
    addLocalBtn.disabled = busy || selectedLocal <= 0;
    addLocalBtn.textContent = 'Import + Add Selected Local Files' + (selectedLocal ? ' (' + selectedLocal + ')' : '');
  }
  var downloadTools = $('playlist-import-download-tools');
  if (downloadTools) downloadTools.hidden = downloadable.length === 0;
  ['playlist-import-select-missing', 'playlist-import-find-candidates', 'playlist-import-find-all-candidates', 'playlist-import-only', 'playlist-import-cancel', 'playlist-import-cancel-x'].forEach(function (id) {
    var el = $(id);
    if (el) el.disabled = busy;
  });
  var conflict = $('playlist-import-conflict'); if (conflict) conflict.disabled = busy;
  var stopButton = $('playlist-import-stop-search');
  if (stopButton) stopButton.hidden = !busy;
}
function cancelPlaylistCandidateSearch(announce) {
  var rows = getPlaylistImportRows();
  var hadActiveSearch = playlistImportSearching || rows.some(function (item) { return !!(item.row.__candidateLoading || item.row.__candidateQueued); });
  playlistImportSearchGeneration++;
  playlistImportSearching = false;
  rows.forEach(function (item) {
    var row = item.row;
    cancelCandidateSearchRequest(row);
    row.__candidateRequestSeq = (row.__candidateRequestSeq || 0) + 1;
    row.__candidateLoading = false;
    row.__candidateQueued = false;
    row.__candidatePromise = null;
  });
  setPlaylistImportProgress(false, '', 0, 0);
  var status = $('playlist-import-status');
  if (announce && hadActiveSearch && status) status.textContent = 'Candidate search stopped. Completed results were kept.';
  if (pendingPlaylistImport) renderPlaylistImportReview();
  return hadActiveSearch;
}
function cancelCandidateSearchRequest(row) {
  var requestId = row && row.__candidateIpcRequestId;
  if (!requestId) return;
  delete row.__candidateIpcRequestId;
  row.__candidateRequestSeq = (row.__candidateRequestSeq || 0) + 1;
  row.__candidateLoading = false;
  row.__candidateQueued = false;
  row.__candidatePromise = null;
  activeCandidateSearchRequestIds.delete(requestId);
  if (window.api.cancelDownload) Promise.resolve(window.api.cancelDownload(requestId)).catch(function (e) { console.error('Candidate search cancellation failed:', e); });
}
async function searchImportCandidates(row, silent, force, searchGeneration) {
  if (!row || !window.api.searchDownloadCandidates) return [];
  if (row.__candidateLoading && row.__candidatePromise) return row.__candidatePromise;
  if (!force && row.__downloadCandidates && row.__downloadCandidates.length) return row.__downloadCandidates;
  var rowRequestSeq = (row.__candidateRequestSeq || 0) + 1;
  var ipcRequestId = 'candidate_search_' + Date.now() + '_' + (++candidateSearchRequestSeq);
  row.__candidateRequestSeq = rowRequestSeq;
  row.__candidateIpcRequestId = ipcRequestId;
  activeCandidateSearchRequestIds.add(ipcRequestId);
  var previousUrl = row.__downloadCandidate ? (row.__downloadCandidate.webpageUrl || row.__downloadCandidate.url || '') : '';
  var previousManual = !!row.__downloadCandidateManual;
  row.__candidateLoading = true;
  row.__candidateError = '';
  row.__candidateNotice = '';
  if (!silent) renderPlaylistImportReview();
  function requestIsCurrent() {
    return row.__candidateRequestSeq === rowRequestSeq && row.__candidateIpcRequestId === ipcRequestId && (searchGeneration === undefined || searchGeneration === playlistImportSearchGeneration);
  }
  var requestPromise = (async function () {
    try {
      var res = await window.api.searchDownloadCandidates(makeDownloadTrackPayload(row), 5, ipcRequestId);
      if (!requestIsCurrent()) return row.__downloadCandidates || [];
      if (res && res.ok) {
        row.__downloadCandidates = res.candidates || [];
        row.__candidateQueryCount = res.queries ? res.queries.length : 0;
        setImportRowCandidate(row, null, false);
        var preserved = previousManual && previousUrl ? row.__downloadCandidates.find(function (candidate) { return (candidate.webpageUrl || candidate.url || '') === previousUrl; }) : null;
        if (preserved) setImportRowCandidate(row, preserved, true);
        else if (row.__downloadCandidates.length && isAutoSelectableImportCandidate(row.__downloadCandidates[0])) setImportRowCandidate(row, row.__downloadCandidates[0], false);
        else if (row.__downloadCandidates.length) row.__candidateNotice = 'Needs review: choose a candidate before downloading.';
        else row.__candidateError = 'No candidates found.';
      } else {
        row.__downloadCandidates = [];
        setImportRowCandidate(row, null, false);
        row.__candidateError = (res && res.error) || 'Search failed';
      }
    } catch (e) {
      if (!requestIsCurrent()) return row.__downloadCandidates || [];
      row.__downloadCandidates = [];
      setImportRowCandidate(row, null, false);
      row.__candidateError = 'Search failed: ' + ((e && e.message) || String(e || 'unknown error'));
    } finally {
      activeCandidateSearchRequestIds.delete(ipcRequestId);
      if (requestIsCurrent()) {
        delete row.__candidateIpcRequestId;
        row.__candidateLoading = false;
        row.__candidatePromise = null;
        if (!silent) renderPlaylistImportReview();
      }
    }
    return row.__downloadCandidates || [];
  })();
  row.__candidatePromise = requestPromise;
  return requestPromise;
}
async function searchImportCandidateRows(rows, label) {
  if (playlistImportSearching) return;
  var status = $('playlist-import-status');
  if (!rows.length) {
    if (status) status.textContent = 'No missing tracks to search.';
    return;
  }
  var searchGeneration = ++playlistImportSearchGeneration;
  playlistImportSearching = true;
  rows.forEach(function (item) { item.row.__candidateQueued = true; });
  var total = rows.length;
  var completed = 0;
  var next = 0;
  setPlaylistImportProgress(true, 'Searching', 0, total);
  renderPlaylistImportReview();
  async function worker() {
    while (next < total) {
      if (searchGeneration !== playlistImportSearchGeneration) return;
      var index = next++;
      var item = rows[index];
      item.row.__candidateQueued = false;
      if (status) status.textContent = 'Finding candidates ' + (completed + 1) + '/' + total + ': ' + getImportTrackArtist(item.row) + ' - ' + getImportTrackTitle(item.row);
      await searchImportCandidates(item.row, false, false, searchGeneration);
      if (searchGeneration !== playlistImportSearchGeneration) return;
      completed++;
      item.row.__candidateQueued = false;
      setPlaylistImportProgress(true, 'Searching', completed, total);
      renderPlaylistImportReview();
    }
  }
  try {
    var concurrency = Math.min(2, total);
    var workers = [];
    for (var i = 0; i < concurrency; i++) workers.push(worker());
    await Promise.all(workers);
    if (searchGeneration === playlistImportSearchGeneration && status) status.textContent = 'Candidate search complete for ' + label + '.';
  } finally {
    if (searchGeneration === playlistImportSearchGeneration) {
      rows.forEach(function (item) { item.row.__candidateQueued = false; });
      playlistImportSearching = false;
      setPlaylistImportProgress(false, '', 0, 0);
      renderPlaylistImportReview();
    }
  }
}
async function searchSelectedImportCandidates() {
  await searchImportCandidateRows(getMissingImportRows(true), 'selected tracks');
}
async function searchAllImportCandidates() {
  await searchImportCandidateRows(getMissingImportRows(false), 'all missing tracks');
}
function renderPlaylistImportReview() {
  var list = $('playlist-import-list');
  if (!list || !pendingPlaylistImport) return;
  var rows = getPlaylistImportRows();
  var missingCount = 0;
  var localCandidateCount = 0;
  var reviewCount = 0;
  list.innerHTML = '';
  rows.forEach(function (item, flatIndex) {
    var row = item.row;
    var title = getImportTrackTitle(row);
    var artist = getImportTrackArtist(row);
    var album = getImportTrackAlbum(row);
    var matched = findPlaylistRecordMatch(row);
    var isMissing = !matched;
    var localCandidate = isLocalPlaylistImportCandidate(row);
    var downloadable = isPlaylistImportDownloadEligible(row);
    var checkable = localCandidate || downloadable;
    if (isMissing) missingCount++;
    if (localCandidate) localCandidateCount++;
    var div = document.createElement('div');
    div.className = 'playlist-import-row' + (matched ? ' matched' : '') + (localCandidate ? ' local-reference' : '') + (row.__downloadStatus === 'downloading' ? ' downloading' : '') + (row.__downloadStatus === 'failed' ? ' failed' : '');
    div.dataset.flatIndex = String(flatIndex);
    var checked = localCandidate ? row.__addLocalSelected === true : (downloadable && row.__downloadSelected !== false);
    var busy = !!pendingPlaylistImport.finishing || playlistImportSearching || !!row.__candidateLoading;
    if (downloadable && row.__downloadCandidates && row.__downloadCandidates.length && !row.__downloadCandidate) reviewCount++;
    var sourceStatus = row.SourceStatus || '';
    var status = 'Missing';
    if (matched) status = 'In library';
    else if (localCandidate) status = 'Local file';
    else if (sourceStatus === 'local-missing') status = 'Missing local';
    else if (sourceStatus === 'local-unsupported') status = 'Unsupported';
    else if (sourceStatus === 'remote-unsupported') status = 'Remote blocked';
    else if (sourceStatus === 'hls-unsupported') status = 'HLS blocked';
    else if (sourceStatus === 'invalid') status = 'Invalid entry';
    else if (row.__candidateLoading) status = 'Searching';
    else if (row.__candidateQueued) status = 'Queued';
    else if (row.__downloadStatus === 'done') status = 'Downloaded';
    else if (row.__downloadStatus === 'failed') status = 'Failed';
    else if (row.__downloadCandidate) status = 'Ready';
    else if (row.__downloadCandidates && row.__downloadCandidates.length) status = 'Needs review';
    var statusDetail = row.__downloadError || row.SourceReason || '';
    var statusTitle = statusDetail ? ' title="' + esc(statusDetail) + '"' : '';
    var checkboxLabel = localCandidate ? 'Add local file to library' : 'Select missing track for download';
    div.innerHTML = '<input type="checkbox" class="playlist-import-row-check" aria-label="' + checkboxLabel + '" ' + (checkable && !busy ? '' : 'disabled ') + (checked ? 'checked ' : '') + '>' +
      '<div class="playlist-import-cover"><i class="ph ph-music-notes"></i></div>' +
      '<div class="playlist-import-title"><strong title="' + esc(title) + '">' + esc(title || 'Unknown Track') + '</strong><span title="' + esc(artist) + '">' + esc(artist || 'Unknown Artist') + '</span></div>' +
      '<div class="playlist-import-album" title="' + esc(album) + '">' + esc(album || '-') + '</div>' +
      '<div class="playlist-import-row-status"' + statusTitle + '><span>' + esc(status) + '</span>' + (downloadable ? '<button type="button" class="playlist-import-candidate-btn" ' + (busy || row.__candidateLoading ? 'disabled ' : '') + '>' + (row.__candidateLoading ? 'Searching...' : (row.__candidateQueued ? 'Queued' : (row.__downloadCandidate ? 'Change' : ((row.__downloadCandidates && row.__downloadCandidates.length) ? 'Review' : 'Search')))) + '</button>' : '') + '</div>';
    var cb = div.querySelector('.playlist-import-row-check');
    if (cb) cb.addEventListener('change', function () {
      if (localCandidate) row.__addLocalSelected = cb.checked;
      else row.__downloadSelected = cb.checked;
      updatePlaylistImportActions();
    });
    div.addEventListener('click', function (e) {
      if (!checkable || busy || !cb || e.target.closest('button,input,.playlist-import-candidates,.playlist-import-picked-candidate')) return;
      if (localCandidate) row.__addLocalSelected = !cb.checked;
      else row.__downloadSelected = !cb.checked;
      renderPlaylistImportReview();
    });
    var candidateBtn = div.querySelector('.playlist-import-candidate-btn');
    if (candidateBtn) candidateBtn.addEventListener('click', function () { searchImportCandidates(row, false); });
    if (downloadable && row.__downloadCandidate) {
      var picked = document.createElement('div');
      picked.className = 'playlist-import-picked-candidate';
      picked.innerHTML = '<span>Selected ' + esc(formatImportCandidateConfidence(row.__downloadCandidate)) + ':</span> ' + esc(row.__downloadCandidate.title || 'Unknown video') + ' <small>' + esc(row.__downloadCandidate.uploader || '') + ' - ' + esc(formatImportCandidateDuration(row.__downloadCandidate.duration)) + '</small>';
      div.appendChild(picked);
    }
    if (downloadable && row.__candidateNotice) {
      var note = document.createElement('div');
      note.className = 'playlist-import-candidate-note';
      note.textContent = row.__candidateNotice;
      div.appendChild(note);
    }
    if (downloadable && row.__candidateError) {
      var err = document.createElement('div');
      err.className = 'playlist-import-candidate-error';
      err.textContent = row.__candidateError;
      div.appendChild(err);
    }
    if (downloadable && row.__downloadCandidates && row.__downloadCandidates.length) {
      var box = document.createElement('div');
      box.className = 'playlist-import-candidates';
      row.__downloadCandidates.forEach(function (candidate, candidateIndex) {
        var itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        itemBtn.disabled = busy;
        var confidence = getImportCandidateConfidence(candidate);
        itemBtn.className = 'playlist-import-candidate confidence-' + confidence + (row.__downloadCandidate && row.__downloadCandidate.webpageUrl === candidate.webpageUrl ? ' selected' : '');
        var thumb = candidate.thumbnail ? '<img src="' + esc(candidate.thumbnail) + '" alt="" />' : '<span class="playlist-import-candidate-thumb"><i class="ph ph-play"></i></span>';
        itemBtn.innerHTML = thumb + '<span><strong>' + esc(candidate.title || 'Unknown video') + '</strong><small>' + esc(candidate.uploader || '') + ' - ' + esc(formatImportCandidateDuration(candidate.duration)) + ' - ' + esc(formatImportCandidateConfidence(candidate)) + ' confidence - score ' + esc(candidate.score) + '</small></span>';
        itemBtn.addEventListener('click', function () {
          var picked = row.__downloadCandidate;
          var next = row.__downloadCandidates[candidateIndex];
          if (picked && (picked.webpageUrl || picked.url || '') === (next.webpageUrl || next.url || '')) {
            setImportRowCandidate(row, null, false);
            row.__candidateNotice = 'Candidate deselected. Choose one before downloading.';
          } else {
            setImportRowCandidate(row, next, true);
          }
          renderPlaylistImportReview();
        });
        box.appendChild(itemBtn);
      });
      div.appendChild(box);
    }
    if (isM3uImportRecord(row) && row.SourceLocation) {
      var sourcePath = document.createElement('div');
      sourcePath.className = 'playlist-import-source-path';
      sourcePath.title = row.SourceLocation;
      sourcePath.textContent = row.SourceLocation;
      div.appendChild(sourcePath);
    }
    list.appendChild(div);
  });
  $('playlist-import-subtitle').textContent = pendingPlaylistImport.groups.length + ' playlist(s), ' + rows.length + ' track(s), ' + missingCount + ' unresolved' + (localCandidateCount ? ', ' + localCandidateCount + ' local file(s) available' : '') + (reviewCount ? ', ' + reviewCount + ' need review' : '') + '.';
  var hasDownloads = rows.some(function (item) { return isPlaylistImportDownloadEligible(item.row); });
  $('playlist-import-download-folder').textContent = hasDownloads
    ? 'Download folder: ' + (appSettings.ytdlDownloadFolder || 'Default Music/Playerinyo Downloads')
    : (localCandidateCount ? 'Select local files to add them to the library. Unselected references stay in the playlist only.' : 'Unavailable local, remote, and HLS entries remain reviewable and will not be downloaded automatically.');
  updatePlaylistImportActions();
}
async function showPlaylistImportReview(importResult) {
  var sourcePath = importResult && importResult.sourcePath || '';
  var groups = buildPlaylistImportGroups(sourcePath, importResult && importResult.records, importResult && importResult.name);
  if (!groups.length) return;
  groups.forEach(function (group) { group.tracks.forEach(function (row) {
    if (isM3uImportRecord(row)) row.__addLocalSelected = false;
    else row.__downloadSelected = true;
  }); });
  cancelPlaylistCandidateSearch(false);
  pendingPlaylistImport = { sourcePath: sourcePath, sourceFormat: importResult.format || '', groups: groups, conflictMode: 'create' };
  if (getPlaylistImportRows().some(function (item) { return isPlaylistImportDownloadEligible(item.row); }) && !appSettings.ytdlDownloadFolder && window.api.getDefaultDownloadFolder) appSettings.ytdlDownloadFolder = await window.api.getDefaultDownloadFolder();
  var titleEl = $('playlist-import-title'); if (titleEl) titleEl.textContent = 'Import Playlist';
  var importOnlyBtn = $('playlist-import-only'); if (importOnlyBtn) importOnlyBtn.textContent = 'Import Only';
  var options = $('playlist-import-options'); if (options) options.hidden = false;
  var conflict = $('playlist-import-conflict'); if (conflict) conflict.value = 'create';
  var status = $('playlist-import-status'); if (status) status.textContent = '';
  var toolStatus = $('playlist-import-tool-status'); if (toolStatus) toolStatus.textContent = '';
  setPlaylistImportProgress(false, '', 0, 0);
  renderPlaylistImportReview();
  showModal($('playlist-import-modal'));
  var missingRows = getMissingImportRows(false);
  if (missingRows.length > 0 && missingRows.length <= 5) {
    setTimeout(function () { if (pendingPlaylistImport && pendingPlaylistImport.sourcePath === sourcePath) searchImportCandidateRows(missingRows, 'missing tracks'); }, 0);
  }
}
async function showExistingPlaylistDownloadReview(pl, rows) {
  if (!pl) return;
  rows = (rows || getDownloadableMissingPlaylistRows(pl)).filter(isPlaylistImportDownloadEligible);
  if (!rows.length) { showToast('No missing tracks to download in "' + (pl.name || 'this playlist') + '".'); return; }
  rows.forEach(function (row) { clearImportRowTransient(row); row.__downloadSelected = true; });
  cancelPlaylistCandidateSearch(false);
  pendingPlaylistImport = { csvPath: '', groups: [{ name: pl.name || 'Playlist', tracks: rows }], existingPlaylistId: pl.id, mode: 'existing-playlist' };
  if (!appSettings.ytdlDownloadFolder && window.api.getDefaultDownloadFolder) appSettings.ytdlDownloadFolder = await window.api.getDefaultDownloadFolder();
  var titleEl = $('playlist-import-title'); if (titleEl) titleEl.textContent = 'Download Playlist Tracks';
  var importOnlyBtn = $('playlist-import-only'); if (importOnlyBtn) importOnlyBtn.textContent = 'Close';
  var options = $('playlist-import-options'); if (options) options.hidden = true;
  var status = $('playlist-import-status'); if (status) status.textContent = '';
  var toolStatus = $('playlist-import-tool-status'); if (toolStatus) toolStatus.textContent = '';
  setPlaylistImportProgress(false, '', 0, 0);
  renderPlaylistImportReview();
  showModal($('playlist-import-modal'));
  var missingRows = getMissingImportRows(false);
  if (missingRows.length > 0 && missingRows.length <= 5) {
    setTimeout(function () { if (pendingPlaylistImport && pendingPlaylistImport.existingPlaylistId === pl.id) searchImportCandidateRows(missingRows, 'missing tracks'); }, 0);
  }
}
function openAlbumDownloadModal(album) {
  if (!album) return;
  albumDownloadOrigin = '';
  albumDownloadContext = album;
  albumDownloadSelectedRelease = null;
  albumDownloadRequestSeq++;
  var query = ((album.artist || '') + ' ' + (album.name || '')).trim();
  var subtitle = $('album-download-subtitle'); if (subtitle) subtitle.textContent = (album.artist || 'Unknown Artist') + ' - ' + (album.name || 'Unknown Album');
  var queryInput = $('album-download-search-query'); if (queryInput) queryInput.value = query;
  var results = $('album-download-results'); if (results) results.innerHTML = '<div class="album-download-empty">Search metadata to choose a release.</div>';
  var preview = $('album-download-preview'); if (preview) preview.innerHTML = '<div class="album-download-empty">Select a metadata result.</div>';
  var status = $('album-download-status'); if (status) status.textContent = '';
  var queueBtn = $('album-download-queue'); if (queueBtn) { queueBtn.disabled = true; queueBtn.textContent = 'Queue Album Downloads'; }
  updateAlbumDownloadSelectionActions();
  showModal($('album-download-modal'));
  var openToken = albumDownloadRequestSeq;
  setTimeout(function () {
    if (queryInput) { queryInput.focus(); queryInput.select(); }
    if (query && albumDownloadContext === album && openToken === albumDownloadRequestSeq) searchAlbumDownloadMetadata();
  }, 0);
}
function openAutoTagMissingTracksDownload() {
  if (!metaProposedData || !metaProposedData.raw) return;
  var meta = flattenMetadataReleaseTracks(metaProposedData.raw);
  var sourceMatches = metaProposedData.sourceMatches || [];
  var rows = metadataTracksToDownloadRows(meta);
  rows.forEach(function (row, sourceIndex) {
    var match = sourceMatches[sourceIndex];
    if (match && match.localFilePath) row.__autoTagLocalFilePath = match.localFilePath;
    row.__downloadSelected = isAlbumDownloadRowMissing(row);
  });
  var missingCount = rows.filter(isAlbumDownloadRowMissing).length;
  if (!missingCount) { showToast('Every track in this release is already in your library.'); return; }

  albumDownloadOrigin = 'metadata';
  albumDownloadContext = null;
  albumDownloadSelectedRelease = { result: null, release: metaProposedData.raw, meta: meta, rows: rows };
  albumDownloadRequestSeq++;
  var subtitle = $('album-download-subtitle'); if (subtitle) subtitle.textContent = (meta.albumArtist || 'Unknown Artist') + ' - ' + (meta.albumTitle || 'Unknown Album') + ' • ' + missingCount + ' missing';
  var queryInput = $('album-download-search-query'); if (queryInput) queryInput.value = ((meta.albumArtist || '') + ' ' + (meta.albumTitle || '')).trim();
  var results = $('album-download-results'); if (results) results.innerHTML = '<div class="album-download-empty">Using the release selected in Metadata.</div>';
  hideModal($('metadata-modal'));
  showModal($('album-download-modal'));
  renderAlbumDownloadPreview();
}
async function searchAlbumDownloadMetadata() {
  var q = ($('album-download-search-query') && $('album-download-search-query').value || '').trim();
  if (!q) return;
  var requestToken = ++albumDownloadRequestSeq;
  var btn = $('album-download-search');
  var resultsEl = $('album-download-results');
  var status = $('album-download-status');
  albumDownloadSelectedRelease = null;
  var queueBtn = $('album-download-queue'); if (queueBtn) { queueBtn.disabled = true; queueBtn.textContent = 'Queue Album Downloads'; }
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Searching...'; }
  if (status) status.textContent = '';
  if (resultsEl) resultsEl.innerHTML = '<div class="album-download-empty">Searching...</div>';
  var results = [];
  try {
    results = window.api.searchMetadataSources ? await window.api.searchMetadataSources(q, getMetadataSourceOptions()) : [];
  } catch (e) {
    if (requestToken !== albumDownloadRequestSeq) return;
    if (resultsEl) resultsEl.innerHTML = '<div class="album-download-empty">Search failed.</div>';
    if (status) status.textContent = 'Metadata search failed: ' + ((e && e.message) || String(e || 'unknown error'));
    return;
  } finally {
    if (requestToken === albumDownloadRequestSeq && btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-magnifying-glass"></i> Search Metadata'; }
  }
  if (requestToken !== albumDownloadRequestSeq) return;
  if (!resultsEl) return;
  resultsEl.innerHTML = '';
  if (!results.length) {
    resultsEl.innerHTML = '<div class="album-download-empty">No metadata results found.</div>';
    return;
  }
  results.forEach(function (result) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'album-download-result';
    var year = result.date ? String(result.date).substring(0, 4) : '';
    var sourceLabel = result.label || result.source || 'Metadata';
    var cover = result.thumb ? '<img src="' + esc(result.thumb) + '" alt="" />' : '<span class="album-download-result-cover"></span>';
    row.innerHTML = cover + '<span><strong>' + esc(result.title || 'Unknown Album') + '</strong><small>' + esc(result.artist || 'Unknown Artist') + (year ? ' - ' + esc(year) : '') + '</small><small>' + esc(sourceLabel) + '</small></span>';
    row.addEventListener('click', function () { selectAlbumDownloadRelease(result, row); });
    resultsEl.appendChild(row);
  });
}
async function selectAlbumDownloadRelease(result, rowEl) {
  var requestToken = ++albumDownloadRequestSeq;
  var status = $('album-download-status');
  var preview = $('album-download-preview');
  var queueBtn = $('album-download-queue');
  document.querySelectorAll('.album-download-result').forEach(function (el) { el.classList.remove('selected'); });
  if (rowEl) rowEl.classList.add('selected');
  if (preview) preview.innerHTML = '<div class="album-download-empty">Loading release...</div>';
  if (status) status.textContent = 'Loading release details...';
  updateAlbumDownloadSelectionActions();
  var source = result.source || 'musicbrainz';
  var release = null;
  try {
    release = window.api.getMetadataRelease ? await window.api.getMetadataRelease(source, result.id, getMetadataSourceOptions()) : null;
  } catch (e) {
    if (requestToken !== albumDownloadRequestSeq) return;
    if (preview) preview.innerHTML = '<div class="album-download-empty">Could not load this release.</div>';
    if (status) status.textContent = 'Release load failed: ' + ((e && e.message) || String(e || 'unknown error'));
    if (queueBtn) queueBtn.disabled = true;
    return;
  }
  if (requestToken !== albumDownloadRequestSeq) return;
  if (!release) {
    if (preview) preview.innerHTML = '<div class="album-download-empty">Could not load this release.</div>';
    if (status) status.textContent = 'Release load failed.';
    if (queueBtn) queueBtn.disabled = true;
    return;
  }
  var meta = flattenMetadataReleaseTracks(release);
  var rows = metadataTracksToDownloadRows(meta);
  rows.forEach(function (row) { row.__downloadSelected = isAlbumDownloadRowMissing(row); });
  albumDownloadSelectedRelease = { result: result, release: release, meta: meta, rows: rows };
  renderAlbumDownloadPreview();
}
function updateAlbumDownloadSelectionActions() {
  var rows = albumDownloadSelectedRelease ? (albumDownloadSelectedRelease.rows || []) : [];
  var missing = rows.filter(isAlbumDownloadRowMissing);
  var selectedMissing = missing.filter(function (row) { return row.__downloadSelected !== false; });
  var selectBtn = $('album-download-select-missing');
  var deselectBtn = $('album-download-deselect-all');
  if (selectBtn) selectBtn.disabled = missing.length === 0 || selectedMissing.length === missing.length;
  if (deselectBtn) deselectBtn.disabled = selectedMissing.length === 0;
}
function renderAlbumDownloadPreview() {
  var preview = $('album-download-preview');
  var status = $('album-download-status');
  var queueBtn = $('album-download-queue');
  if (!preview || !albumDownloadSelectedRelease) return;
  var rows = albumDownloadSelectedRelease.rows || [];
  var missing = rows.filter(isAlbumDownloadRowMissing);
  var selectedMissing = rows.filter(function (row) { return isAlbumDownloadRowMissing(row) && row.__downloadSelected !== false; });
  preview.innerHTML = '';
  rows.forEach(function (row, index) {
    var track = document.createElement('div');
    var matched = !isAlbumDownloadRowMissing(row);
    var selected = !matched && row.__downloadSelected !== false;
    track.className = 'album-download-track' + (matched ? ' matched' : '') + (selected ? ' selected' : '');
    var no = row.DiscNo && row.DiscNo > 1 ? (row.DiscNo + '.' + row.TrackNo) : row.TrackNo;
    track.innerHTML = '<input type="checkbox" class="album-download-track-check" ' + (matched ? 'disabled ' : '') + (selected ? 'checked ' : '') + '>' +
      '<em>' + esc(no || (index + 1)) + '</em><span><strong>' + esc(row.Song || 'Unknown Track') + '</strong><small>' + esc(row.Artist || '') + '</small></span><small>' + (matched ? 'In library' : (selected ? 'Selected' : 'Skipped')) + '</small>';
    var cb = track.querySelector('.album-download-track-check');
    if (cb) cb.addEventListener('change', function () { row.__downloadSelected = cb.checked; renderAlbumDownloadPreview(); });
    track.addEventListener('click', function (e) {
      if (matched || e.target.closest('input')) return;
      row.__downloadSelected = row.__downloadSelected === false;
      renderAlbumDownloadPreview();
    });
    preview.appendChild(track);
  });
  if (status) status.textContent = rows.length + ' track(s), ' + missing.length + ' missing, ' + selectedMissing.length + ' selected will be queued.';
  if (queueBtn) { queueBtn.disabled = selectedMissing.length === 0; queueBtn.textContent = 'Queue Album Downloads' + (selectedMissing.length ? ' (' + selectedMissing.length + ')' : ''); }
  updateAlbumDownloadSelectionActions();
}
function setAlbumDownloadMissingSelection(selected) {
  if (!albumDownloadSelectedRelease) return;
  (albumDownloadSelectedRelease.rows || []).forEach(function (row) {
    if (isAlbumDownloadRowMissing(row)) row.__downloadSelected = !!selected;
  });
  renderAlbumDownloadPreview();
}
function queueAlbumDownloadSelectedRelease() {
  if (!albumDownloadSelectedRelease) return;
  var meta = albumDownloadSelectedRelease.meta || {};
  var rows = (albumDownloadSelectedRelease.rows || []).filter(function (row) { return isAlbumDownloadRowMissing(row) && row.__downloadSelected !== false; });
  if (!rows.length) { showToast('No selected missing tracks for this album.'); return; }
  enqueueAlbumDownloadJob((meta.albumArtist ? meta.albumArtist + ' - ' : '') + (meta.albumTitle || 'Album'), rows);
  hideModal($('album-download-modal'));
  albumDownloadContext = null;
  albumDownloadSelectedRelease = null;
  albumDownloadOrigin = '';
}
async function downloadImportRowWithFallback(row, downloadRoot, requestId) {
  var original = row.__downloadCandidate;
  var originalManual = !!row.__downloadCandidateManual;
  var attempts = getDownloadFallbackCandidates(row);
  if (!attempts.length) return window.api.downloadPlaylistTrack(makeDownloadTrackPayload(row), downloadRoot, requestId);
  var lastResult = null;
  for (var i = 0; i < attempts.length; i++) {
    var candidate = attempts[i];
    var sameAsOriginal = getImportCandidateUrl(candidate) === getImportCandidateUrl(original);
    setImportRowCandidate(row, candidate, sameAsOriginal && originalManual);
    if (i > 0) {
      row.__downloadStatus = 'downloading';
      row.__downloadError = 'Age-restricted candidate failed; trying another result...';
      renderPlaylistImportReview();
    }
    lastResult = await window.api.downloadPlaylistTrack(makeDownloadTrackPayload(row), downloadRoot, requestId || '');
    if (lastResult && lastResult.ok) return lastResult;
    if (!isAgeRestrictedDownloadResult(lastResult)) return lastResult;
  }
  if (lastResult && isAgeRestrictedDownloadResult(lastResult)) {
    lastResult.error = 'All tried candidates require YouTube sign-in/age confirmation. Enable YouTube cookies in Settings or choose another candidate.';
  }
  return lastResult;
}

function normalizeLibraryRootPath(filePath) {
  return String(stripFileUrl(filePath || '') || filePath || '').replace(/\\/g, '/').replace(/\/+$/, '');
}
function getParentPath(filePath) {
  var normalized = normalizeLibraryRootPath(filePath);
  var slash = normalized.lastIndexOf('/');
  if (slash <= 0) return slash === 0 ? '/' : '';
  return normalized.slice(0, slash);
}
function pathIsInsideRoot(filePath, rootPath) {
  var file = normalizeLibraryRootPath(filePath);
  var root = normalizeLibraryRootPath(rootPath);
  if (/^[a-z]:/i.test(file) || /^[a-z]:/i.test(root)) { file = file.toLowerCase(); root = root.toLowerCase(); }
  return !!root && (file === root || file.startsWith(root + '/'));
}
function getCommonImportRoot(filePaths) {
  var directories = filePaths.map(getParentPath).filter(Boolean);
  if (!directories.length) return '';
  var parts = directories[0].split('/');
  var caseInsensitive = /^[a-z]:/i.test(directories[0]);
  for (var i = 1; i < directories.length && parts.length; i++) {
    var next = directories[i].split('/');
    var count = 0;
    while (count < parts.length && count < next.length) {
      var left = caseInsensitive ? parts[count].toLowerCase() : parts[count];
      var right = caseInsensitive ? next[count].toLowerCase() : next[count];
      if (left !== right) break;
      count++;
    }
    parts.length = count;
  }
  var common = parts.join('/');
  if (directories[0].startsWith('/') && !common.startsWith('/')) common = '/' + common;
  if (common === '/' || /^[a-z]:$/i.test(common) || /^\/\/[^/]+$/i.test(common)) return '';
  return common;
}
function addPlaylistImportLibraryRoots(filePaths) {
  var saved = Array.isArray(appSettings.libraryRoots) ? appSettings.libraryRoots.slice() : [];
  var candidates = [];
  var common = getCommonImportRoot(filePaths);
  if (common) candidates.push(common);
  else filePaths.map(getParentPath).filter(Boolean).forEach(function (directory) {
    if (!candidates.some(function (root) { return pathIsInsideRoot(directory, root); })) candidates.push(directory);
  });
  var changed = false;
  candidates.forEach(function (candidate) {
    if (saved.some(function (root) { return pathIsInsideRoot(candidate, root); })) return;
    saved = saved.filter(function (root) { return !pathIsInsideRoot(root, candidate); });
    saved.push(candidate);
    changed = true;
  });
  if (changed) appSettings.libraryRoots = saved;
  return changed;
}
async function addSelectedPlaylistLocalFiles() {
  var selected = getPlaylistImportRows().filter(function (item) {
    return item.row.__addLocalSelected === true && isLocalPlaylistImportCandidate(item.row);
  });
  var uniquePaths = Array.from(new Set(selected.map(function (item) { return getPlaylistTrackFilePath(item.row); }).filter(Boolean)));
  if (!uniquePaths.length) return { added: 0, failed: 0, rootsChanged: false };
  var scanContext = { revision: libraryRevision, paths: new Set(state.musicFiles.map(function (file) { return file.filePath; }).filter(Boolean)) };
  var scanned = [];
  var failed = 0;
  var next = 0;
  async function worker() {
    while (true) {
      var index = next++;
      if (index >= uniquePaths.length) return;
      try {
        var file = await window.api.scanAudioFile(uniquePaths[index]);
        if (file) scanned.push(file); else failed++;
      } catch (_) { failed++; }
    }
  }
  var workers = [];
  for (var i = 0; i < Math.min(4, uniquePaths.length); i++) workers.push(worker());
  await Promise.all(workers);
  if (scanned.length) {
    scanned.forEach(function (file) { libraryMissingFilePaths.delete(file.filePath); });
    setMusicFiles(mergeScannedFiles(scanned, scanContext));
  }
  var rootsChanged = scanned.length ? addPlaylistImportLibraryRoots(scanned.map(function (file) { return file.filePath; })) : false;
  return { added: scanned.length, failed: failed, rootsChanged: rootsChanged };
}

async function finishPlaylistImport(action) {
  if (!pendingPlaylistImport) return;
  if (pendingPlaylistImport.finishing || playlistImportSearching || getPlaylistImportRows().some(function (item) { return !!item.row.__candidateLoading; })) return;
  var activeImport = pendingPlaylistImport;
  activeImport.finishing = true;
  updatePlaylistImportActions();
  try {
  var withDownload = action === 'download';
  var withLocalFiles = action === 'local';
  var existingPlaylistId = pendingPlaylistImport.existingPlaylistId || '';
  if (existingPlaylistId) {
    if (withDownload) enqueueExistingPlaylistDownloadJob(pendingPlaylistImport);
    else {
      pendingPlaylistImport.groups.forEach(function (group) { group.tracks.forEach(clearImportRowTransient); });
      await persistPlaylists(state.playlists);
    }
    renderSidebarPlaylists();
    hideModal($('playlist-import-modal'));
    pendingPlaylistImport = null;
    clearTrackSelection();
    return;
  }
  pushUndoSnapshot('Import playlist', ['library', 'playlists', 'mappings', 'libraryRoots']);
  var localResult = withLocalFiles ? await addSelectedPlaylistLocalFiles() : { added: 0, failed: 0, rootsChanged: false };
  var conflictMode = pendingPlaylistImport.conflictMode || 'create';
  var importResult = importPlaylistGroups(pendingPlaylistImport.groups, conflictMode);
  var seenQueueRows = new Set();
  var queueRows = withDownload ? importResult.rows.filter(function (row) {
    if (seenQueueRows.has(row) || row.__downloadSelected === false || !isPlaylistImportDownloadEligible(row)) return false;
    seenQueueRows.add(row);
    return true;
  }) : [];
  var queueSnapshots = queueRows.map(function (row) { return { row: row, data: snapshotImportRowTransient(row) }; });
  importResult.rows.forEach(clearImportRowTransient);
  await persistPlaylists(state.playlists);
  await persistLibrary(state.musicFiles);
  if (localResult.rootsChanged) await persistSettings(appSettings);
  queueSnapshots.forEach(function (item) { restoreImportRowTransient(item.row, item.data); });
  renderSidebarPlaylists();
  hideModal($('playlist-import-modal'));
  if (importResult.firstPlaylistId) switchView(importResult.firstPlaylistId);
  if (withDownload && queueRows.length) {
    var jobTitle = pendingPlaylistImport.groups.length === 1 ? (pendingPlaylistImport.groups[0].name || 'Imported Playlist') : 'Imported Playlists';
    enqueueImportedPlaylistDownloadJob(jobTitle, queueRows, importResult.firstPlaylistId, importResult.playlistIds);
  }
  if (withLocalFiles) showToast('Imported playlist and added ' + localResult.added + ' local file' + (localResult.added === 1 ? '' : 's') + ' to the library.' + (localResult.failed ? ' ' + localResult.failed + ' file(s) could not be scanned.' : ''));
  pendingPlaylistImport = null;
  } catch (error) {
    showToast('Playlist import failed: ' + ((error && error.message) || String(error || 'unknown error')));
  } finally {
    if (pendingPlaylistImport === activeImport) {
      activeImport.finishing = false;
      updatePlaylistImportActions();
    }
  }
}

var importPl = $('import-playlist-btn');
if (importPl) importPl.addEventListener('click', async function () {
  try {
    var result = await window.api.importPlaylist();
    if (!result || result.canceled) return;
    if (!result.ok || !result.records || result.records.length === 0) { showToast('No playlist entries were found in the selected file.'); return; }
    hideModal($('settings-modal'));
    await showPlaylistImportReview(result);
  } catch (error) {
    showToast('Playlist import failed: ' + ((error && error.message) || String(error || 'unknown error')));
  }
});

var playlistImportSelectMissing = $('playlist-import-select-missing');
if (playlistImportSelectMissing) playlistImportSelectMissing.addEventListener('click', function () {
  getPlaylistImportRows().forEach(function (item) {
    var row = item.row;
    if (isPlaylistImportDownloadEligible(row)) row.__downloadSelected = true;
  });
  renderPlaylistImportReview();
});
var playlistImportFindCandidates = $('playlist-import-find-candidates');
if (playlistImportFindCandidates) playlistImportFindCandidates.addEventListener('click', searchSelectedImportCandidates);
var playlistImportFindAllCandidates = $('playlist-import-find-all-candidates');
if (playlistImportFindAllCandidates) playlistImportFindAllCandidates.addEventListener('click', searchAllImportCandidates);
var playlistImportCheckTools = $('playlist-import-check-tools');
if (playlistImportCheckTools) playlistImportCheckTools.addEventListener('click', async function () {
  var out = $('playlist-import-tool-status');
  if (out) out.textContent = 'Checking...';
  var res = window.api.checkYtdlpTools ? await window.api.checkYtdlpTools() : null;
  if (out) out.textContent = res && res.ok ? ('yt-dlp ' + res.ytdlp + ', ffmpeg OK') : ((res && res.error) || 'Tool check unavailable');
});
function cancelPlaylistImport() {
  if (pendingPlaylistImport && pendingPlaylistImport.finishing) return;
  cancelPlaylistCandidateSearch(false);
  if (pendingPlaylistImport) pendingPlaylistImport.groups.forEach(function (group) { (group.tracks || []).forEach(clearImportRowTransient); });
  pendingPlaylistImport = null;
  hideModal($('playlist-import-modal'));
}
var playlistImportCancel = $('playlist-import-cancel'); if (playlistImportCancel) playlistImportCancel.addEventListener('click', cancelPlaylistImport);
var playlistImportCancelX = $('playlist-import-cancel-x'); if (playlistImportCancelX) playlistImportCancelX.addEventListener('click', cancelPlaylistImport);
var playlistImportStopSearch = $('playlist-import-stop-search'); if (playlistImportStopSearch) playlistImportStopSearch.addEventListener('click', function () { cancelPlaylistCandidateSearch(true); });
var playlistImportConflict = $('playlist-import-conflict'); if (playlistImportConflict) playlistImportConflict.addEventListener('change', function () { if (pendingPlaylistImport) pendingPlaylistImport.conflictMode = playlistImportConflict.value; });
var playlistImportOnly = $('playlist-import-only'); if (playlistImportOnly) playlistImportOnly.addEventListener('click', function () { finishPlaylistImport('import'); });
var playlistImportAddLocal = $('playlist-import-add-local'); if (playlistImportAddLocal) playlistImportAddLocal.addEventListener('click', function () { finishPlaylistImport('local'); });
var playlistImportDownload = $('playlist-import-download'); if (playlistImportDownload) playlistImportDownload.addEventListener('click', function () { finishPlaylistImport('download'); });
var playlistImportModal = $('playlist-import-modal'); if (playlistImportModal) playlistImportModal.addEventListener('click', function (e) { if (e.target === playlistImportModal) cancelPlaylistImport(); });

var createPlBtn = $('create-playlist-btn');
if (createPlBtn) createPlBtn.addEventListener('click', function () {
  cpSelectedCoverPath = null; cpSelectedColor = PALETTE[0];
  var ni = $('cp-name-input'); if (ni) ni.value = '';
  var cp = $('cp-cover-preview'); if (cp) cp.style.display = 'none';
  buildColorPickers(); showModal($('create-playlist-modal'));
  setTimeout(function () { var ni = $('cp-name-input'); if (ni) ni.focus(); }, 100);
});

var createSmartMixBtn = $('create-smart-mix-btn');
if (createSmartMixBtn) createSmartMixBtn.addEventListener('click', function () { openSmartPlaylistBuilder(); });

var cpDrop = $('cp-cover-drop');
if (cpDrop) {
  cpDrop.addEventListener('click', async function () { var img = await window.api.openImage(); if (img) { cpSelectedCoverPath = img; $('cp-cover-preview').src = img; $('cp-cover-preview').style.display = 'block'; } });
  cpDrop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cpDrop.click(); } });
  cpDrop.addEventListener('dragover', function (e) { e.preventDefault(); cpDrop.classList.add('drag-over'); });
  cpDrop.addEventListener('dragleave', function () { cpDrop.classList.remove('drag-over'); });
  cpDrop.addEventListener('drop', function (e) { e.preventDefault(); cpDrop.classList.remove('drag-over'); var f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/') && f.path) { var url = toFileUrl(f.path); cpSelectedCoverPath = url; $('cp-cover-preview').src = url; $('cp-cover-preview').style.display = 'block'; } });
}

var cpCancel = $('cp-cancel-btn'); if (cpCancel) cpCancel.addEventListener('click', function () { hideModal($('create-playlist-modal')); });
var cpCreate = $('cp-create-btn');
if (cpCreate) cpCreate.addEventListener('click', async function () {
  var name = ($('cp-name-input').value || '').trim() || 'New Playlist';
  var pl = { id: 'pl_' + Date.now(), name: name, cover: cpSelectedCoverPath, color: cpSelectedColor, tracks: [], pinned: false, lastPlayed: null };
  state.playlists.push(pl); await persistPlaylists(state.playlists);
  renderSidebarPlaylists(); hideModal($('create-playlist-modal')); switchView(pl.id);
});

var navLib = $('nav-library'); if (navLib) navLib.addEventListener('click', function () { switchView('library'); });
var navHome = $('nav-home'); if (navHome) navHome.addEventListener('click', function () { switchView('home'); });
var dockModeToggle = $('dock-mode-toggle');
if (dockModeToggle) dockModeToggle.addEventListener('click', function () {
  appSettings.dockMode = appSettings.dockMode === 'expanded' ? 'collapsed' : 'expanded';
  applyDockMode();
  persistInBackground(persistSettings(appSettings));
  renderSidebarPlaylists();
  if (appSettings.dockMode === 'expanded' && getEffectiveDockMode() !== 'expanded') showToast('Expanded dock saved. Widen the window to show it.');
});
var navPlaylists = $('nav-playlists'); if (navPlaylists) navPlaylists.addEventListener('click', function () { switchView('playlists'); });
var navRadio = $('nav-radio'); if (navRadio) navRadio.addEventListener('click', function () { switchView('radio'); });
if (navPlaylists) {
  navPlaylists.addEventListener('dragover', function (e) {
    if (!e.dataTransfer || !e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    navPlaylists.classList.add('drop-target');
  });
  navPlaylists.addEventListener('dragleave', function (e) {
    if (!navPlaylists.contains(e.relatedTarget)) navPlaylists.classList.remove('drop-target');
  });
  navPlaylists.addEventListener('drop', function (e) {
    e.preventDefault();
    navPlaylists.classList.remove('drop-target');
    var track = readDroppedTrack(e.dataTransfer);
    if (track) showAddToPlaylistModal([track]);
    else showToast('Could not read the dropped track. Drag it from a Playerinyo track list.');
  });
}
var navHealth = $('nav-health'); if (navHealth) navHealth.addEventListener('click', function () { switchView('metadata_health'); });
var navStats = $('nav-stats'); if (navStats) navStats.addEventListener('click', function () { switchView('stats'); });
var btnLike = $('btn-like'); if (btnLike) btnLike.addEventListener('click', toggleCurrentTrackLike);
var btnOpenTagHealth = $('btn-open-tag-health'); if (btnOpenTagHealth) btnOpenTagHealth.addEventListener('click', function () { hideModal($('settings-modal')); switchView('metadata_health'); });
var btnReviewMovedFiles = $('btn-review-moved-files');
if (btnReviewMovedFiles) btnReviewMovedFiles.addEventListener('click', async function () {
  if (movedFileOperation || appStateCommitInProgress) return;
  hideModal($('settings-modal'));
  switchView('metadata_health');
  var healthRoot = $('metadata-health-container');
  if (healthRoot) healthRoot.dataset.filter = 'missing_files';
  renderMetadataHealthView();
  var scanned = await scanMissingLibraryFiles();
  if (scanned && libraryMissingFilePaths.size) await relinkMissingFilesFromFolder();
});

var libSortSel = $('library-sort-select');
if (libSortSel) libSortSel.addEventListener('change', function () { if (state.currentView === 'library') renderLibrary(); });


var btnNavBack = $('btn-nav-back');
if (btnNavBack) btnNavBack.addEventListener('click', function () {
  if (state.navIndex > 0) {
    state.navIndex--;
    var viewId = state.navHistory[state.navIndex];
    // handle album: prefix
    if (viewId && viewId.startsWith('album:')) {
      var albumId = decodeURIComponent(viewId.replace('album:', ''));
      var album = getFullAlbumByKey(albumId);
      if (album) renderAlbumDetail(album);
    } else { switchView(viewId, false); }
    updateNavBtns();
  }
});
var btnNavFwd = $('btn-nav-forward');
if (btnNavFwd) btnNavFwd.addEventListener('click', function () {
  if (state.navIndex < state.navHistory.length - 1) {
    state.navIndex++;
    var viewId = state.navHistory[state.navIndex];
    if (viewId && viewId.startsWith('album:')) {
      var albumId = decodeURIComponent(viewId.replace('album:', ''));
      var album = getFullAlbumByKey(albumId);
      if (album) renderAlbumDetail(album);
    } else { switchView(viewId, false); }
    updateNavBtns();
  }
});


// Genre-group toggle removed — genre search is now handled via the search bar
// FIX 9: Playlist search fixed
var plSearch = $('playlist-search');
if (plSearch) plSearch.addEventListener('input', function (e) { filterPlaylists(e.target.value); });

var gSearch = $('global-search');
var gSearchTimeout = null;
var searchHintTimer = null;
var searchHintIndex = 0;
var searchHints = [
  'Search songs, albums, artists...',
  'Try artist:Radiohead',
  'Try missing:cover',
  'Try genre:jazz year:1999',
  'Try rg:missing',
  'Press Ctrl+K for commands'
];
function parseLibrarySearchQuery(raw) {
  var parsed = { terms: [], filters: [] };
  String(raw || '').trim().split(/\s+/).filter(Boolean).forEach(function (token) {
    var match = token.match(/^([a-z]+):(.+)$/i);
    if (match) parsed.filters.push({ key: match[1].toLowerCase(), value: match[2].toLowerCase() });
    else parsed.terms.push(token.toLowerCase());
  });
  return parsed;
}
function fileSearchText(f) {
  var libIndex = getLibraryIndex();
  return libIndex.searchTextByFile && libIndex.searchTextByFile.has(f) ? libIndex.searchTextByFile.get(f) : buildFileSearchText(f);
}
function fileExtText(f) {
  var libIndex = getLibraryIndex();
  return libIndex.extByFile && libIndex.extByFile.has(f) ? libIndex.extByFile.get(f) : buildFileExtText(f);
}
function fileHasMissingField(f, value) {
  if (value === 'cover' || value === 'art' || value === 'artwork') return !f.picture;
  if (value === 'year') return !f.year;
  if (value === 'genre') return !f.genre;
  if (value === 'track' || value === 'trackno' || value === 'number') return !f.trackNo;
  if (value === 'disc') return !f.discNo;
  if (value === 'file' || value === 'files' || value === 'path') return libraryMissingFilePaths.has(f.filePath);
  if (value === 'replaygain' || value === 'rg' || value === 'loudness') return f.replayGainTrackDb === null || f.replayGainTrackDb === undefined;
  if (value === 'metadata' || value === 'tags') return !f.picture || !f.year || !f.genre || !f.trackNo;
  return false;
}
function matchesLibrarySearchFilter(f, filter, parsed) {
  var value = filter.value;
  if (filter.key === 'artist') return String(f.artist || '').toLowerCase().indexOf(value) !== -1 || String(f.albumArtist || '').toLowerCase().indexOf(value) !== -1;
  if (filter.key === 'album') return String(f.album || '').toLowerCase().indexOf(value) !== -1;
  if (filter.key === 'title' || filter.key === 'song') return String(f.title || '').toLowerCase().indexOf(value) !== -1;
  if (filter.key === 'genre') return String(f.genre || '').toLowerCase().indexOf(value) !== -1;
  if (filter.key === 'year') return String(f.year || '').toLowerCase() === value;
  if (filter.key === 'missing') return fileHasMissingField(f, value);
  if (filter.key === 'rg' || filter.key === 'replaygain') {
    var hasRg = f.replayGainTrackDb !== null && f.replayGainTrackDb !== undefined;
    return value === 'missing' || value === 'none' ? !hasRg : hasRg;
  }
  if (filter.key === 'type' || filter.key === 'ext') return fileExtText(f) === value.replace(/^\./, '');
  if (filter.key === 'path') return String(f.filePath || '').toLowerCase().indexOf(value) !== -1;
  if (filter.key === 'liked') {
    var likedSet = parsed && parsed.likedSongsSet ? parsed.likedSongsSet : null;
    var liked = likedSet ? likedSet.has(f.filePath) : state.likedSongs.includes(f.filePath);
    return value === 'true' || value === 'yes' || value === '1' ? liked : !liked;
  }
  return fileSearchText(f).indexOf(value) !== -1;
}
function matchesLibrarySearch(f, parsed) {
  var hay = fileSearchText(f);
  if (!parsed.terms.every(function (term) { return hay.indexOf(term) !== -1; })) return false;
  return parsed.filters.every(function (filter) { return matchesLibrarySearchFilter(f, filter, parsed); });
}
if (gSearch) gSearch.addEventListener('input', function (e) {
  clearTimeout(gSearchTimeout);
  gSearchTimeout = setTimeout(function () {
    var q = e.target.value.toLowerCase().trim();
    window._libRenderToken = (window._libRenderToken || 0) + 1;
    if (window._libRenderFrame) {
      cancelAnimationFrame(window._libRenderFrame);
      window._libRenderFrame = null;
    }
    $('search-albums-container').style.display = 'none';
    if (!q) { switchView('library'); return; }
    
    if (state.currentView !== 'search') {
      pushNav('search');
      state.currentView = 'search';
    }

    hideAllViewRoots();
    setViewKind('search');
    $('tracks-table-container').style.display = 'block';

    var parsedSearch = parseLibrarySearchQuery(q);
    if (parsedSearch.filters.some(function (filter) { return filter.key === 'liked'; })) parsedSearch.likedSongsSet = new Set(state.likedSongs);
    var matchedFiles = state.musicFiles.filter(function (f) { return matchesLibrarySearch(f, parsedSearch); });

    // Build album map from already-filtered search results.
    var matchedAlbums = {};
    var genreOnlyMatches = {};
    matchedFiles.forEach(function (f) {
      var k = getAlbumKey(f);
      if (!matchedAlbums[k]) matchedAlbums[k] = { id: k, name: f.album || 'Unknown Album', artist: f.albumArtist || f.artist || 'Unknown Artist', cover: null, tracks: [], genre: f.genre || '' };
      if (!matchedAlbums[k].cover && f.picture) matchedAlbums[k].cover = f.picture;
      matchedAlbums[k].tracks.push(f);
      if (parsedSearch.filters.some(function (filter) { return filter.key === 'genre'; }) && parsedSearch.terms.length === 0) genreOnlyMatches[k] = true;
    });

    var aGrid = $('search-albums-grid'); aGrid.innerHTML = '';
    var albumKeys = Object.keys(matchedAlbums);
    if (window._searchAlbumQuery !== q) {
      window._searchAlbumQuery = q;
      window._searchAlbumRenderLimit = 200;
    }
    var albumContainer = $('search-albums-container');
    var albumHeader = albumContainer ? albumContainer.querySelector('h2') : null;

    if (albumKeys.length > 0) {
      // Determine label: if all results are genre-only matches, show genre label
      var allGenreOnly = albumKeys.every(function(k) { return genreOnlyMatches[k]; });
      var someGenre = albumKeys.some(function(k) { return genreOnlyMatches[k]; });
      var firstGenre = matchedAlbums[albumKeys[0]].genre;
      if (albumHeader) {
        if (allGenreOnly && firstGenre) {
          albumHeader.innerHTML = '<i class="ph ph-tag" style="margin-right:6px;"></i>Genre: ' + esc(firstGenre) + ' <span style="font-weight:400;font-size:12px;color:var(--text-subdued);background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:10px;margin-left:6px;">' + albumKeys.length + ' albums</span>';
        } else {
          albumHeader.innerHTML = '<i class="ph ph-vinyl-record" style="margin-right:6px;"></i>Albums <span style="font-weight:400;font-size:12px;color:var(--text-subdued);background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:10px;margin-left:6px;">' + albumKeys.length + '</span>';
        }
      }
      albumContainer.style.display = 'block';
      var albumFragment = document.createDocumentFragment();
      albumKeys.slice(0, window._searchAlbumRenderLimit || 200).forEach(function (k) {
        var album = matchedAlbums[k];
        var card = document.createElement('article'); card.className = 'album-card' + (isAlbumActive(album) ? ' playing' : ''); card.dataset.albumKey = album.id || '';
        var active = isAlbumActive(album);
        var playBtnIcon = active && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
        var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
        var cov = album.cover ? '<img src="' + esc(album.cover) + '" alt=""' + lazy + ' />' : '<i class="ph ph-music-notes" aria-hidden="true"></i>';
        // Show genre badge if this album matched via genre
        var genreBadge = genreOnlyMatches[k] && album.genre ? '<span style="font-size:10px;color:var(--accent);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(album.genre) + '</span>' : '';
        card.innerHTML = '<div class="album-card-img-wrapper" style="position:relative;">' + cov + '<button type="button" class="album-card-play-btn" aria-label="Play ' + esc(album.name) + '" data-album="' + encodeURIComponent(album.name) + '"><i class="' + playBtnIcon + '" aria-hidden="true"></i></button></div><button type="button" class="album-card-open" aria-label="Open ' + esc(album.name) + ' by ' + esc(album.artist || 'Unknown Artist') + '"><span class="album-card-info"><span class="album-card-title" title="' + esc(album.name) + '">' + esc(album.name) + '</span><span class="album-card-artist">' + esc(album.artist) + '</span>' + genreBadge + '</span></button>';
        card.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          window.currentContextMenuAlbum = album;
          positionContextMenu($('album-context-menu'), e.clientX, e.clientY, card);
        });
        card.querySelector('.album-card-play-btn').addEventListener('click', function (e) {
          e.stopPropagation(); initAudioCtx();
          if (isAlbumActive(album)) { togglePlay(); var icon = e.currentTarget.querySelector('i'); if (icon) icon.className = state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play'; return; }
          state.playQueueTracks = getSortedAlbumTracks(album).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
          state.shuffleQueue = []; if (state.isShuffle) rebuildShuffleQueueForMode();
          playTrack(state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks[0]);
        });
        card.addEventListener('click', function () {
          if (isMultiSelectMode) {
            if (selectedAlbumsForEdit.has(album.id)) selectedAlbumsForEdit.delete(album.id);
            else selectedAlbumsForEdit.add(album.id);
            var selected = selectedAlbumsForEdit.has(album.id);
            card.style.border = selected ? '2px solid var(--accent)' : '';
            card.style.transform = selected ? 'scale(0.95)' : '';
            card.style.opacity = selected ? '0.8' : '';
            updateMultiSelectControls();
            return;
          }
          var fullAlbum = getFullAlbumByKey(album.id) || album;
          var focusPath = album.tracks && album.tracks[0] ? album.tracks[0].filePath : '';
          pushNav('album:' + fullAlbum.id);
          renderAlbumDetail(fullAlbum, focusPath);
        });
        card.querySelector('.album-card-open').addEventListener('keydown', function (e) {
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); window.currentContextMenuAlbum = album; positionContextMenu($('album-context-menu'), 0, 0, card); }
        });
        if (isMultiSelectMode && selectedAlbumsForEdit.has(album.id)) {
          card.style.border = '2px solid var(--accent)';
          card.style.transform = 'scale(0.95)';
          card.style.opacity = '0.8';
        }
        albumFragment.appendChild(card);
      });
      aGrid.appendChild(albumFragment);
      if (albumKeys.length > (window._searchAlbumRenderLimit || 200)) {
        var showMoreAlbums = document.createElement('button');
        showMoreAlbums.type = 'button';
        showMoreAlbums.className = 'btn btn-outline';
        showMoreAlbums.style.cssText = 'grid-column:1/-1;margin:8px auto;';
        showMoreAlbums.textContent = 'Show ' + Math.min(200, albumKeys.length - window._searchAlbumRenderLimit) + ' more albums';
        showMoreAlbums.addEventListener('click', function () {
          window._searchAlbumRenderLimit += 200;
          gSearch.dispatchEvent(new Event('input'));
        });
        aGrid.appendChild(showMoreAlbums);
      }
    }

    state.currentTracks = matchedFiles.map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
    clearTrackTableFilter();

    $('view-title').textContent = 'Search Results';
    renderTracksTable(false);
  }, 250);
});
if (gSearch) gSearch.placeholder = searchHints[0];

var commandPaletteIndex = 0;
var commandPaletteItems = [];
function makeTrackCommandRecord(file) {
  return { matchedFile: file, title: file.title, artist: file.artist, album: file.album, duration: file.duration, isDisabled: false };
}
function buildAlbumListForCommands() {
  return getLibraryIndex().albums;
}
function commandMatches(item, query) {
  if (!query) return item.type === 'command';
  var hay = ((item.label || '') + ' ' + (item.sub || '') + ' ' + (item.keywords || '')).toLowerCase();
  return query.split(/\s+/).every(function (part) { return hay.indexOf(part) !== -1; });
}
function getCommandPaletteItems(query) {
  var q = (query || '').toLowerCase().trim();
  var items = [
    { type: 'command', icon: 'ph-house', label: 'Go Home', sub: 'Open the home dashboard', keywords: 'home dashboard', action: function () { switchView('home'); } },
    { type: 'command', icon: 'ph-books', label: 'Go Library', sub: 'Open album library', keywords: 'library albums', action: function () { switchView('library'); } },
    { type: 'command', icon: 'ph-playlist', label: 'Open Playlists', sub: 'Browse and manage playlists', keywords: 'playlists mixes liked songs', action: function () { switchView('playlists'); } },
    { type: 'command', icon: 'ph-chart-bar', label: 'Listening History', sub: 'Open local play statistics', keywords: 'history statistics plays listened', action: function () { switchView('stats'); } },
    { type: 'command', icon: 'ph-arrow-counter-clockwise', label: 'Undo Last Action', sub: undoStack.length ? undoStack[undoStack.length - 1].label : 'Nothing to undo', keywords: 'undo revert ctrl z', action: undoLastAction },
    { type: 'command', icon: 'ph-gear', label: 'Open Settings', sub: 'Theme, library, playback settings', keywords: 'settings options preferences', action: function () { openSettingsModal(); } },
    { type: 'command', icon: 'ph-download-simple', label: 'Export Backup', sub: 'Save library, playlists, settings and mappings to JSON', keywords: 'backup export json save', action: function () { var btn = $('btn-export-backup'); if (btn) btn.click(); } },
    { type: 'command', icon: 'ph-upload-simple', label: 'Import Backup', sub: 'Restore app data from a Playerinyo JSON backup', keywords: 'backup import restore json', action: function () { var btn = $('btn-import-backup'); if (btn) btn.click(); } },
    { type: 'command', icon: 'ph-stethoscope', label: 'Open Tag Health', sub: 'Find missing metadata and ReplayGain', keywords: 'metadata health missing replaygain cover genre', action: function () { switchView('metadata_health'); } },
    { type: 'command', icon: 'ph-folder-open', label: 'Import Folder', sub: 'Add music from a folder', keywords: 'import scan add folder', action: function () { var btn = $('import-folder-btn'); if (btn) btn.click(); } },
    { type: 'command', icon: 'ph-arrows-clockwise', label: 'Rescan Library', sub: 'Scan imported folders for new songs', keywords: 'rescan refresh folder library', action: function () { doRescanFolder(); } },
    { type: 'command', icon: 'ph-queue', label: 'Toggle Queue', sub: 'Show or hide the queue panel', keywords: 'queue next songs', action: function () { toggleQueue(); } },
    { type: 'command', icon: 'ph-microphone-stage', label: 'Toggle Lyrics', sub: 'Show or hide lyrics panel', keywords: 'lyrics lrc words', action: function () { toggleLyrics(); } },
    { type: 'command', icon: 'ph-waveform', label: 'Show Missing ReplayGain', sub: 'Open Tag Health filtered to missing loudness data', keywords: 'replaygain loudness normalize missing analyze', action: function () { switchView('metadata_health'); var root = $('metadata-health-container'); if (root) { root.dataset.filter = 'missing_replaygain'; renderMetadataHealthView(); } } },
    { type: 'command', icon: 'ph-image-square', label: 'Write folder.jpg', sub: 'Write album covers into music folders', keywords: 'cover folder jpg artwork', action: function () { writeCurrentFolderCovers(true); } },
    { type: 'command', icon: 'ph-keyboard', label: 'Keyboard Shortcuts', sub: 'Show all shortcuts (?)', keywords: 'keyboard shortcuts help keys hotkeys', action: function () { openShortcutsHelp(); } }
  ].filter(function (item) { return commandMatches(item, q); });
  if (q) {
    var terms = q.split(/\s+/);
    state.musicFiles.some(function (f) {
      var hay = ((f.title || '') + ' ' + (f.artist || '') + ' ' + (f.album || '') + ' ' + (f.genre || '')).toLowerCase();
      if (terms.every(function (t) { return hay.indexOf(t) !== -1; })) items.push({ type: 'track', icon: 'ph-music-note', label: f.title || f.filename || 'Unknown Track', sub: (f.artist || 'Unknown Artist') + ' • ' + (f.album || 'Unknown Album'), file: f });
      return items.filter(function (i) { return i.type === 'track'; }).length >= 25;
    });
    buildAlbumListForCommands().some(function (album) {
      var hay = ((album.name || '') + ' ' + (album.artist || '')).toLowerCase();
      if (terms.every(function (t) { return hay.indexOf(t) !== -1; })) items.push({ type: 'album', icon: 'ph-vinyl-record', label: album.name, sub: album.artist + ' • ' + album.tracks.length + ' tracks', album: album });
      return items.filter(function (i) { return i.type === 'album'; }).length >= 16;
    });
    state.playlists.some(function (pl) {
      var hay = (pl.name || '').toLowerCase();
      if (terms.every(function (t) { return hay.indexOf(t) !== -1; })) items.push({ type: 'playlist', icon: 'ph-playlist', label: pl.name, sub: (pl.tracks ? pl.tracks.length : 0) + ' tracks', playlist: pl });
      return items.filter(function (i) { return i.type === 'playlist'; }).length >= 12;
    });
  }
  return items.slice(0, 80);
}
function renderCommandPalette() {
  var input = $('command-palette-input');
  var list = $('command-palette-list');
  if (!input || !list) return;
  commandPaletteItems = getCommandPaletteItems(input.value);
  if (commandPaletteIndex >= commandPaletteItems.length) commandPaletteIndex = 0;
  if (!commandPaletteItems.length) { list.innerHTML = '<div class="command-palette-empty">No results</div>'; return; }
  list.innerHTML = commandPaletteItems.map(function (item, idx) {
    return '<button class="command-palette-item' + (idx === commandPaletteIndex ? ' selected' : '') + '" data-idx="' + idx + '"><span class="command-palette-icon"><i class="ph ' + item.icon + '"></i></span><span class="command-palette-text"><span>' + esc(item.label) + '</span><small>' + esc(item.sub || item.type) + '</small></span><span class="command-palette-kind">' + esc(item.type) + '</span></button>';
  }).join('');
  var selected = list.querySelector('.command-palette-item.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}
function closeCommandPalette() { hideModal($('command-palette-modal')); }
function openCommandPalette() {
  var modal = $('command-palette-modal');
  var input = $('command-palette-input');
  if (!modal || !input) return;
  commandPaletteIndex = 0;
  input.value = '';
  showModal(modal);
  renderCommandPalette();
  setTimeout(function () { input.focus(); input.select(); }, 30);
}
function runCommandPaletteItem(item) {
  if (!item) return;
  closeCommandPalette();
  if (item.type === 'command' && item.action) { item.action(); return; }
  if (item.type === 'track' && item.file) {
    initAudioCtx();
    state.playQueueTracks = state.musicFiles.map(makeTrackCommandRecord);
    state.shuffleQueue = [];
    if (state.isShuffle) rebuildShuffleQueueForMode();
    var record = state.playQueueTracks.find(function (t) { return t.matchedFile && t.matchedFile.filePath === item.file.filePath; }) || makeTrackCommandRecord(item.file);
    playTrack(record);
    return;
  }
  if (item.type === 'album' && item.album) { pushNav('album:' + item.album.id); renderAlbumDetail(item.album); return; }
  if (item.type === 'playlist' && item.playlist) { switchView(item.playlist.id); }
}
var commandPaletteModal = $('command-palette-modal');
if (commandPaletteModal) commandPaletteModal.addEventListener('click', function (e) { if (e.target === commandPaletteModal) closeCommandPalette(); });
var commandPaletteInput = $('command-palette-input');
if (commandPaletteInput) {
  var renderCommandPaletteDebounced = debounce(renderCommandPalette, 120);
  commandPaletteInput.addEventListener('input', function () { commandPaletteIndex = 0; renderCommandPaletteDebounced(); });
  commandPaletteInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); commandPaletteIndex = Math.min(commandPaletteItems.length - 1, commandPaletteIndex + 1); renderCommandPalette(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); commandPaletteIndex = Math.max(0, commandPaletteIndex - 1); renderCommandPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); runCommandPaletteItem(commandPaletteItems[commandPaletteIndex]); }
    else if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); }
  });
}
var commandPaletteList = $('command-palette-list');
if (commandPaletteList) commandPaletteList.addEventListener('click', function (e) {
  var row = e.target.closest('.command-palette-item');
  if (!row) return;
  runCommandPaletteItem(commandPaletteItems[parseInt(row.dataset.idx, 10)]);
});
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    if (shouldIgnoreAppShortcut(e)) return;
    e.preventDefault();
    if (e.repeat) return;
    if ($('command-palette-modal') && $('command-palette-modal').classList.contains('active')) closeCommandPalette();
    else openCommandPalette();
  }
});

/* ─── KEYBOARD SHORTCUTS HELP ─── */
var SHORTCUTS_HELP = [
  { section: 'Playback', items: [
    ['Space', 'Play / Pause'],
    ['Ctrl + →', 'Next track'],
    ['Ctrl + ←', 'Previous track'],
    ['Ctrl + ↑', 'Volume up'],
    ['Ctrl + ↓', 'Volume down'],
    ['Ctrl + S', 'Cycle shuffle: Off / Random / Smart'],
    ['Ctrl + L', 'Cycle repeat: Off / All / One']
  ]},
  { section: 'Panels & Views', items: [
    ['N', 'Now Playing overlay'],
    ['Ctrl + Q', 'Toggle queue panel'],
    ['Ctrl + K', 'Command palette'],
    ['?', 'This shortcut list']
  ]},
  { section: 'Library', items: [
    ['Ctrl + F', 'Focus search'],
    ['Ctrl + Z', 'Undo last action'],
    ['Insert', 'Rescan folders for new songs'],
    ['Ctrl + Mouse Wheel', 'Zoom album grid'],
    ['Mouse Back / Forward', 'Navigate view history'],
    ['Esc', 'Clear selection / close overlays']
  ]}
];
function openShortcutsHelp() {
  var list = $('shortcuts-help-list');
  if (list) {
    list.innerHTML = SHORTCUTS_HELP.map(function (sec) {
      return '<div class="shortcut-help-section">' + esc(sec.section) + '</div>' + sec.items.map(function (it) {
        var keys = it[0].split(' + ').map(function (k) { return '<kbd>' + esc(k) + '</kbd>'; }).join('<small style="opacity:.5;margin:0 3px;">+</small>');
        return '<div class="shortcut-help-row"><span>' + esc(it[1]) + '</span><span class="shortcut-keys">' + keys + '</span></div>';
      }).join('');
    }).join('');
  }
  showModal($('shortcuts-help-modal'));
}
var shortcutsHelpModal = $('shortcuts-help-modal');
if (shortcutsHelpModal) shortcutsHelpModal.addEventListener('click', function (e) { if (e.target === shortcutsHelpModal) hideModal(shortcutsHelpModal); });
var shortcutsHelpCloseBtn = $('shortcuts-help-close');
if (shortcutsHelpCloseBtn) shortcutsHelpCloseBtn.addEventListener('click', function () { hideModal($('shortcuts-help-modal')); });
var shortcutsHelpButton = $('btn-shortcuts-help');
if (shortcutsHelpButton) shortcutsHelpButton.addEventListener('click', openShortcutsHelp);

var zoomIn = $('btn-zoom-in'); if (zoomIn) zoomIn.addEventListener('click', function () { currentZoom = Math.min(currentZoom + 20, 300); applyZoom(); });
var zoomOut = $('btn-zoom-out'); if (zoomOut) zoomOut.addEventListener('click', function () { currentZoom = Math.max(currentZoom - 20, 100); applyZoom(); });
var caW = $('content-area');
if (caW) caW.addEventListener('wheel', function (e) { if (e.ctrlKey && state.currentView === 'library') { e.preventDefault(); if (e.deltaY < 0) $('btn-zoom-in').click(); else $('btn-zoom-out').click(); } }, { passive: false });
var _scrollThrottle;
if (caW) caW.addEventListener('scroll', function() {
  if (!appSettings.virtualScrolling) return;
  if (_scrollThrottle) return;
  _scrollThrottle = requestAnimationFrame(function() {
    _scrollThrottle = null;
    if (window._tracksVirtualized && window.renderVirtualTracksWindow) {
      window.renderVirtualTracksWindow();
      return;
    }
    if (caW.scrollTop + caW.clientHeight >= caW.scrollHeight - 1200) {
      if (state.currentView === 'library' && window.renderLibraryChunk) {
        window.renderLibraryChunk();
      } else if (window.renderTracksChunk) {
        window.renderTracksChunk();
      }
    }
  });
}, { passive: true });

var cbVirtualScrolling = $('setting-virtual-scrolling');
if (cbVirtualScrolling) {
  cbVirtualScrolling.checked = !!appSettings.virtualScrolling;
  if (appSettings.virtualScrolling) document.body.classList.add('perf-mode');
  cbVirtualScrolling.addEventListener('change', function () {
    appSettings.virtualScrolling = this.checked;
    if (this.checked) document.body.classList.add('perf-mode');
    else document.body.classList.remove('perf-mode');
    persistInBackground(persistSettings(appSettings));
    if (state.currentView === 'library') renderLibrary();
    else if ($('tracks-table-container') && $('tracks-table-container').style.display !== 'none') renderTracksTable(!!window._tracksAllowReorder);
  });
}

var togglePlBtn = $('toggle-playlist-view-btn');
if (togglePlBtn) togglePlBtn.style.display = 'none';

var btnFullscreenPl = $('btn-fullscreen-playlists');
if (btnFullscreenPl) btnFullscreenPl.addEventListener('click', function () { switchView('home'); });



var winMinimize = $('window-minimize');
if (winMinimize) winMinimize.addEventListener('click', function () { if (window.api.windowControl) window.api.windowControl('minimize'); });
var winMaximize = $('window-maximize');
if (winMaximize) winMaximize.addEventListener('click', function () { if (window.api.windowControl) window.api.windowControl('toggle-maximize'); });
var winClose = $('window-close');
if (winClose) winClose.addEventListener('click', function () {
  persistDownloadQueueStateNow();
  if (window.api.windowControl) window.api.windowControl('close');
});
var btnDownloadQueue = $('btn-download-queue');
if (btnDownloadQueue) {
  btnDownloadQueue.setAttribute('aria-expanded', 'false');
  btnDownloadQueue.setAttribute('aria-controls', 'download-queue-panel');
  btnDownloadQueue.addEventListener('click', function (e) { e.stopPropagation(); setDownloadQueuePanel(!downloadQueuePanelOpen); });
}
var downloadSearchToggle = $('download-search-toggle');
if (downloadSearchToggle) downloadSearchToggle.addEventListener('click', function () {
  var panel = $('download-search');
  setDirectDownloadSearchOpen(!panel || panel.hidden);
});
var downloadSearchForm = $('download-search-form');
if (downloadSearchForm) downloadSearchForm.addEventListener('submit', function (e) { e.preventDefault(); searchDirectDownload(); });
var btnDownloadQueueClose = $('download-queue-close');
if (btnDownloadQueueClose) btnDownloadQueueClose.addEventListener('click', function () { setDownloadQueuePanel(false); });
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape' || !downloadQueuePanelOpen || modalStack.length) return;
  e.preventDefault();
  setDownloadQueuePanel(false);
});
var btnDownloadQueueClear = $('download-queue-clear');
if (btnDownloadQueueClear) btnDownloadQueueClear.addEventListener('click', function () {
  downloadQueue = downloadQueue.filter(function (job) { return job.status === 'queued' || job.status === 'checking' || job.status === 'running'; });
  if (!downloadQueue.some(function (job) { return job.id === downloadQueueReview.jobId; })) downloadQueueReview = { jobId: '', itemIndex: -1 };
  persistDownloadQueueStateNow();
  renderDownloadQueue();
});
window.addEventListener('resize', function () {
  if (downloadQueuePanelOpen) requestAnimationFrame(positionDownloadQueuePanel);
  var sortListbox = $('playlist-sort-listbox');
  if (sortListbox && !sortListbox.hidden) requestAnimationFrame(positionPlaylistSortListbox);
});
if (window.api.onDownloadProgress) window.api.onDownloadProgress(updateDownloadQueueItemProgress);
var albumDownloadSearchBtn = $('album-download-search');
if (albumDownloadSearchBtn) albumDownloadSearchBtn.addEventListener('click', searchAlbumDownloadMetadata);
var albumDownloadSearchInput = $('album-download-search-query');
if (albumDownloadSearchInput) albumDownloadSearchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') searchAlbumDownloadMetadata(); });
var albumDownloadQueueBtn = $('album-download-queue');
if (albumDownloadQueueBtn) albumDownloadQueueBtn.addEventListener('click', queueAlbumDownloadSelectedRelease);
var albumDownloadSelectMissingBtn = $('album-download-select-missing');
if (albumDownloadSelectMissingBtn) albumDownloadSelectMissingBtn.addEventListener('click', function () { setAlbumDownloadMissingSelection(true); });
var albumDownloadDeselectAllBtn = $('album-download-deselect-all');
if (albumDownloadDeselectAllBtn) albumDownloadDeselectAllBtn.addEventListener('click', function () { setAlbumDownloadMissingSelection(false); });
function closeAlbumDownloadModal() {
  var returnToMetadata = albumDownloadOrigin === 'metadata' && !!metaProposedData;
  albumDownloadContext = null;
  albumDownloadSelectedRelease = null;
  albumDownloadOrigin = '';
  albumDownloadRequestSeq++;
  hideModal($('album-download-modal'));
  if (returnToMetadata) showModal($('metadata-modal'));
}
var albumDownloadCancel = $('album-download-cancel');
if (albumDownloadCancel) albumDownloadCancel.addEventListener('click', closeAlbumDownloadModal);
var albumDownloadCancelX = $('album-download-cancel-x');
if (albumDownloadCancelX) albumDownloadCancelX.addEventListener('click', closeAlbumDownloadModal);
var albumDownloadModal = $('album-download-modal');
if (albumDownloadModal) albumDownloadModal.addEventListener('click', function (e) { if (e.target === albumDownloadModal) closeAlbumDownloadModal(); });
var btnSettings = $('btn-settings'); if (btnSettings) btnSettings.addEventListener('click', openSettingsModal);
var btnCloseSettings = $('btn-close-settings'); if (btnCloseSettings) btnCloseSettings.addEventListener('click', function () { hideModal($('settings-modal')); });
var btnCloseSettingsTop = $('btn-close-settings-top'); if (btnCloseSettingsTop) btnCloseSettingsTop.addEventListener('click', function () { hideModal($('settings-modal')); });
function formatBackupStatusDate(value) {
  if (!value) return '';
  var date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function renderAutomaticBackupStatus(status) {
  automaticBackupUiStatus = status && typeof status === 'object' ? status : null;
  var toggle = $('setting-automatic-backups');
  var summary = $('automatic-backup-summary');
  var success = $('automatic-backup-last-success');
  var error = $('automatic-backup-last-error');
  var runButton = $('btn-backup-now');
  if (!automaticBackupUiStatus) {
    if (summary) summary.textContent = 'Automatic backup status is unavailable.';
    if (success) success.textContent = 'Unavailable';
    if (error) { error.textContent = 'Restart Playerinyo and try again.'; error.classList.add('is-error'); }
    if (runButton) runButton.disabled = true;
    return;
  }
  if (toggle) toggle.checked = automaticBackupUiStatus.enabled !== false;
  var successText = formatBackupStatusDate(automaticBackupUiStatus.lastSuccessAt);
  if (success) success.textContent = successText || 'None yet';
  var errorDate = formatBackupStatusDate(automaticBackupUiStatus.lastErrorAt);
  if (error) {
    error.textContent = automaticBackupUiStatus.lastError
      ? (errorDate ? errorDate + ': ' : '') + automaticBackupUiStatus.lastError
      : 'None';
    error.classList.toggle('is-error', !!automaticBackupUiStatus.lastError);
  }
  if (summary) {
    if (automaticBackupUiStatus.running || automaticBackupUiBusy) summary.textContent = 'Creating a validated local backup…';
    else if (!automaticBackupUiStatus.enabled) summary.textContent = 'Automatic backups are off. Back Up Now remains available.';
    else if (!automaticBackupUiStatus.libraryReady) summary.textContent = 'Automatic backups start after the library contains music.';
    else {
      var nextDue = formatBackupStatusDate(automaticBackupUiStatus.nextDueAt);
      summary.textContent = nextDue ? 'Next daily backup: ' + nextDue : 'Daily backup is ready to run.';
    }
  }
  if (runButton) runButton.disabled = automaticBackupUiBusy || !!automaticBackupUiStatus.running || !automaticBackupUiStatus.libraryReady;
}
async function refreshAutomaticBackupStatus() {
  if (!window.api.automaticBackupStatus) { renderAutomaticBackupStatus(null); return null; }
  try {
    var status = await window.api.automaticBackupStatus();
    renderAutomaticBackupStatus(status);
    return status;
  } catch (e) {
    console.error('Automatic backup status failed:', e);
    renderAutomaticBackupStatus(null);
    return null;
  }
}
var automaticBackupToggle = $('setting-automatic-backups');
if (automaticBackupToggle) automaticBackupToggle.addEventListener('change', async function (e) {
  var previous = appSettings.automaticBackupsEnabled !== false;
  appSettings.automaticBackupsEnabled = e.target.checked;
  e.target.disabled = true;
  try {
    await persistSettings(appSettings);
    await refreshAutomaticBackupStatus();
  } catch (error) {
    appSettings.automaticBackupsEnabled = previous;
    e.target.checked = previous;
    showToast('Automatic backup setting could not be saved. Check disk space and permissions.');
  } finally {
    e.target.disabled = false;
  }
});
var btnBackupNow = $('btn-backup-now');
if (btnBackupNow) btnBackupNow.addEventListener('click', async function () {
  if (automaticBackupUiBusy) return;
  if (hasActiveDownloadQueueJobs()) { showToast('Wait for queued or active downloads to finish before backing up.'); return; }
  if (appStateCommitInProgress) { showToast('Wait for the current app-state restore to finish.'); return; }
  automaticBackupUiBusy = true;
  btnBackupNow.disabled = true;
  btnBackupNow.setAttribute('aria-busy', 'true');
  var old = btnBackupNow.innerHTML;
  btnBackupNow.innerHTML = '<i class="ph ph-spinner ph-spin" aria-hidden="true"></i> Backing Up…';
  renderAutomaticBackupStatus(automaticBackupUiStatus);
  try {
    await flushSettingsSave();
    var result = await window.api.runAutomaticBackup();
    if (result && result.status) renderAutomaticBackupStatus(result.status);
    else await refreshAutomaticBackupStatus();
    if (result && result.ok) showToast(result.warning ? 'Backup created, but cleanup needs attention. See Backup & Restore status.' : 'Local backup created.');
    else if (result && result.deferred) showToast('Backup deferred: ' + (result.error || 'another operation is active') + '.');
    else showToast('Backup failed: ' + ((result && result.error) || 'unknown error'));
  } catch (e) {
    showToast('Backup failed: ' + backupIpcErrorMessage(e));
    await refreshAutomaticBackupStatus();
  } finally {
    automaticBackupUiBusy = false;
    btnBackupNow.removeAttribute('aria-busy');
    btnBackupNow.innerHTML = old;
    renderAutomaticBackupStatus(automaticBackupUiStatus);
  }
});
var btnOpenBackupFolder = $('btn-open-backup-folder');
if (btnOpenBackupFolder) btnOpenBackupFolder.addEventListener('click', async function () {
  btnOpenBackupFolder.disabled = true;
  try {
    var result = await window.api.openBackupFolder();
    if (!result || !result.ok) showToast('Could not open the backup folder: ' + ((result && result.error) || 'unknown error'));
  } catch (e) {
    showToast('Could not open the backup folder: ' + backupIpcErrorMessage(e));
  } finally {
    btnOpenBackupFolder.disabled = false;
  }
});
function backupIpcErrorMessage(e) {
  var msg = e && (e.message || String(e));
  if (/No handler registered for '?(export-backup|import-backup|restore-backup|automatic-backup-status|automatic-backup-ready|run-automatic-backup|open-backup-folder)'?/i.test(msg || '')) {
    return 'Backup feature needs a full app restart to load the new main-process handlers.\n\nClose Playerinyo completely, then start it again.';
  }
  return msg || 'unknown error';
}
var btnExportBackup = $('btn-export-backup');
if (btnExportBackup) btnExportBackup.addEventListener('click', async function () {
  btnExportBackup.disabled = true;
  var old = btnExportBackup.innerHTML;
  btnExportBackup.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Exporting...';
  try {
    await persistSettings(appSettings);
    var res = await window.api.exportBackup({ likedSongs: state.likedSongs });
    if (res && res.ok) alert('Backup exported.\n\nLibrary tracks: ' + ((res.summary && res.summary.library) || 0) + '\nPlaylists: ' + ((res.summary && res.summary.playlists) || 0) + '\n\nLast.fm API/session secrets are not included for safety.');
    else if (res && !res.canceled) alert('Backup export failed: ' + (res.error || 'unknown error'));
  } catch (e) {
    alert('Backup export failed: ' + backupIpcErrorMessage(e));
  } finally {
    btnExportBackup.disabled = false;
    btnExportBackup.innerHTML = old;
  }
});
var btnImportBackup = $('btn-import-backup');
var homeImportBackupBtn = $('home-import-backup-btn');
async function runBackupImport() {
  if (hasActiveDownloadQueueJobs()) { alert('Wait for queued or active downloads to finish before importing a backup.'); return; }
  if (appStateCommitInProgress) return;
  var backupButtons = [btnImportBackup, homeImportBackupBtn].filter(Boolean);
  if (backupButtons.some(function (btn) { return btn.disabled; })) return;
  backupButtons.forEach(function (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); });
  var old = btnImportBackup ? btnImportBackup.innerHTML : '';
  var snapshot = null;
  var restoreCommitted = false;
  var runtimeWasInitialized = appInitializationComplete;
  var persistenceWasSuspended = rendererPersistenceSuspended;
  if (btnImportBackup) btnImportBackup.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Importing...';
  if (homeImportBackupBtn) homeImportBackupBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Reading backup...';
  try {
    var res = await window.api.importBackup();
    if (!res || !res.ok) { if (res && !res.canceled) alert('Backup import failed: ' + (res.error || 'unknown error')); return; }
    var s = res.summary || {};
    var counts = ['Library tracks: ' + (s.library || 0), 'Playlists: ' + (s.playlists || 0), 'Liked songs: ' + (s.likedSongs || 0)].join('\n');
    if (!confirm('Import backup from:\n' + res.filePath + '\n\n' + counts + '\n\nThis will replace current app library/playlists/settings. Continue?')) return;
    if (hasActiveDownloadQueueJobs()) { alert('A download started while the backup was being reviewed. Wait for it to finish and try again.'); return; }
    beginAppStateCommit();
    if (runtimeWasInitialized) {
      appSettings.playHistory = state.playHistory.map(toLightTrackRef).filter(Boolean);
      syncSavedQueuePaths();
      await flushSettingsSave();
      snapshot = pushUndoSnapshot('Import backup', ['library', 'playlists', 'mappings', 'likedSongs', 'settings']);
      if (!snapshot) { alert('Backup restore stopped because the current app state could not be captured for Undo.'); return; }
      snapshot.atomicAppState = true;
    }
    rendererPersistenceSuspended = true;
    appInitializationComplete = false;
    var restored = await window.api.restoreBackup(res.token);
    if (!restored || !restored.ok) {
      appInitializationComplete = runtimeWasInitialized;
      rendererPersistenceSuspended = persistenceWasSuspended;
      discardUndoSnapshot(snapshot);
      snapshot = null;
      alert('Backup restore failed: ' + ((restored && restored.error) || 'unknown error'));
      return;
    }
    restoreCommitted = true;
    resetPlaybackRuntime({ clearCurrent: true, clearQueues: true, clearHistory: true, preserveSettings: true });
    await reloadRendererAppState(restored.likedSongs);
    state.navHistory = [];
    state.navIndex = -1;
    state.currentTracks = [];
    clearTrackSelection();
    selectedAlbumsForEdit.clear();
    libraryMissingFilePaths.clear();
    if (!appSettings.ytdlDownloadFolder && window.api.getDefaultDownloadFolder) {
      try { appSettings.ytdlDownloadFolder = await window.api.getDefaultDownloadFolder(); }
      catch (e) { console.error('Default download folder lookup failed:', e); }
    }
    await applyRuntimeSettings({ preserveTitleBarMode: true });
    restorePlaybackStateFromSettings();
    renderSidebarPlaylists();
    var emptyTitle = $('home-empty-library-title'); if (emptyTitle) emptyTitle.textContent = 'Bring your collection into focus.';
    var emptyCopy = $('home-empty-library') ? $('home-empty-library').querySelector('.empty-library-copy p') : null;
    if (emptyCopy) emptyCopy.textContent = 'Choose a music folder and Playerinyo will build a local index without moving or uploading your audio files.';
    var homeStatus = $('home-import-status'); if (homeStatus) homeStatus.replaceChildren();
    switchView(state.musicFiles.length ? 'library' : 'home');
    hideModal($('settings-modal'));
    rendererPersistenceSuspended = false;
    appInitializationComplete = true;
    startupErrorRendered = false;
    setStartupErrorMode(false);
    var restoreWarningText = Array.isArray(restored.warnings) && restored.warnings.length ? ' Warnings: ' + restored.warnings.join(' ') : '';
    showUndoToast('Backup restored. Playback and runtime settings were reconciled.' + restoreWarningText, snapshot);
  } catch (e) {
    if (!restoreCommitted) {
      appInitializationComplete = runtimeWasInitialized;
      rendererPersistenceSuspended = persistenceWasSuspended;
      discardUndoSnapshot(snapshot);
    } else {
      renderStartupError(e);
    }
    alert('Backup import failed: ' + backupIpcErrorMessage(e));
  } finally {
    if (appStateCommitInProgress) endAppStateCommit();
    backupButtons.forEach(function (btn) { btn.disabled = false; btn.setAttribute('aria-busy', 'false'); });
    if (btnImportBackup) btnImportBackup.innerHTML = old;
    if (homeImportBackupBtn) homeImportBackupBtn.innerHTML = '<i class="ph ph-upload-simple" aria-hidden="true"></i> Restore a backup';
  }
}
[btnImportBackup, homeImportBackupBtn].forEach(function (btn) { if (btn) btn.addEventListener('click', runBackupImport); });
var settMin = $('setting-minimize'); if (settMin) settMin.addEventListener('change', async function (e) { appSettings.minimizeToTray = e.target.checked; await persistSettings(appSettings); });
var settAudio = $('setting-audio-mode'); if (settAudio) settAudio.addEventListener('change', async function (e) { appSettings.audioMode = e.target.value; await persistSettings(appSettings); applyAudioMode(); });
async function persistSensitiveSetting(key, value) {
  appSettings[key] = value;
  if (!value && window.api.clearSensitiveSetting) await window.api.clearSensitiveSetting(key);
  await persistSettings(appSettings);
}
var settDiscogsToken = $('setting-discogs-token');
if (settDiscogsToken) settDiscogsToken.addEventListener('change', async function (e) {
  await persistSensitiveSetting('discogsToken', e.target.value.trim());
});
function refreshDownloadFolderUi() {
  var inp = $('setting-download-folder');
  if (inp) inp.value = appSettings.ytdlDownloadFolder || '';
  var quality = $('setting-download-quality');
  if (quality) quality.value = ['best-native', 'opus', 'm4a', 'mp3'].includes(appSettings.ytdlDownloadQuality) ? appSettings.ytdlDownloadQuality : 'best-native';
  var mode = $('setting-ytdl-cookies-mode');
  var browser = $('setting-ytdl-cookies-browser');
  var file = $('setting-ytdl-cookies-file');
  var browserRow = $('setting-ytdl-cookies-browser-row');
  var fileRow = $('setting-ytdl-cookies-file-row');
  var cookiesMode = appSettings.ytdlCookiesMode || 'none';
  if (mode) mode.value = cookiesMode;
  if (browser) browser.value = appSettings.ytdlCookiesBrowser || 'firefox';
  if (file) file.value = appSettings.ytdlCookiesFile || '';
  if (browserRow) browserRow.style.display = cookiesMode === 'browser' ? 'block' : 'none';
  if (fileRow) fileRow.style.display = cookiesMode === 'file' ? 'grid' : 'none';
}
var btnDownloadFolder = $('btn-download-folder');
if (btnDownloadFolder) btnDownloadFolder.addEventListener('click', async function () {
  var folder = await window.api.openFolder();
  if (!folder) return;
  appSettings.ytdlDownloadFolder = folder;
  await persistSettings(appSettings);
  refreshDownloadFolderUi();
});
var settingDownloadQuality = $('setting-download-quality');
if (settingDownloadQuality) settingDownloadQuality.addEventListener('change', async function (e) {
  appSettings.ytdlDownloadQuality = ['best-native', 'opus', 'm4a', 'mp3'].includes(e.target.value) ? e.target.value : 'best-native';
  await persistSettings(appSettings);
});
var settingYtdlCookiesMode = $('setting-ytdl-cookies-mode');
if (settingYtdlCookiesMode) settingYtdlCookiesMode.addEventListener('change', async function (e) {
  appSettings.ytdlCookiesMode = e.target.value || 'none';
  await persistSettings(appSettings);
  refreshDownloadFolderUi();
});
var settingYtdlCookiesBrowser = $('setting-ytdl-cookies-browser');
if (settingYtdlCookiesBrowser) settingYtdlCookiesBrowser.addEventListener('change', async function (e) {
  appSettings.ytdlCookiesBrowser = e.target.value || 'firefox';
  await persistSettings(appSettings);
  refreshDownloadFolderUi();
});
var btnYtdlCookiesFile = $('btn-ytdl-cookies-file');
if (btnYtdlCookiesFile) btnYtdlCookiesFile.addEventListener('click', async function () {
  var file = window.api.openCookiesFile ? await window.api.openCookiesFile() : null;
  if (!file) return;
  appSettings.ytdlCookiesFile = file;
  appSettings.ytdlCookiesMode = 'file';
  await persistSettings(appSettings);
  refreshDownloadFolderUi();
});
async function checkYtdlpTools(targetEl) {
  var el = targetEl || $('ytdlp-status-text');
  if (el) el.textContent = 'Checking...';
  var res = window.api.checkYtdlpTools ? await window.api.checkYtdlpTools() : null;
  if (el) el.textContent = res && res.ok ? ('yt-dlp ' + res.ytdlp + ', ffmpeg OK') : ((res && res.error) || 'Tool check unavailable');
  return res;
}
var btnCheckYtdlp = $('btn-check-ytdlp');
if (btnCheckYtdlp) btnCheckYtdlp.addEventListener('click', function () { checkYtdlpTools($('ytdlp-status-text')); });
async function checkForAppUpdate(manual) {
  var status = $('app-update-status');
  if (!window.api.checkForAppUpdate) return null;
  if (manual && status) status.textContent = 'Checking…';
  try {
    var result = await window.api.checkForAppUpdate();
    if (result && result.available) {
      var message = 'Version ' + result.latestVersion + ' is available on GitHub Releases.';
      if (status) status.textContent = message;
      showToast(message);
    } else if (manual && status) {
      status.textContent = result && result.error ? result.error : ('You are up to date (' + ((result && result.currentVersion) || 'current version') + ').');
    }
    return result;
  } catch (error) {
    if (manual && status) status.textContent = 'Could not check for updates.';
    return null;
  }
}
var btnCheckAppUpdate = $('btn-check-app-update');
if (btnCheckAppUpdate) btnCheckAppUpdate.addEventListener('click', function () { checkForAppUpdate(true); });
async function refreshSafeStorageStatus() {
  var el = $('safe-storage-status');
  if (!el || !window.api.safeStorageStatus) return;
  try {
    var res = await window.api.safeStorageStatus();
    if (res && res.encryptionAvailable) {
      el.style.color = 'var(--text-subdued)';
      el.textContent = 'Sensitive settings are encrypted by the OS' + (res.backend ? ' (' + res.backend + ')' : '') + '.';
    } else {
      el.style.color = 'var(--danger)';
      el.textContent = 'Warning: secure OS encryption is unavailable. API tokens are kept only for this session and are not saved. On Linux, install or enable a secret service/keyring.';
    }
  } catch (e) {
    el.style.color = 'var(--danger)';
    el.textContent = 'Could not check OS encryption status.';
  }
}
var settDiscord = $('setting-discord-rpc'); if (settDiscord) settDiscord.addEventListener('change', async function (e) {
  appSettings.discordRpc = e.target.checked;
  await persistSettings(appSettings);
  var statusEl = $('discord-status-text');
  if (e.target.checked) {
    if (statusEl) statusEl.textContent = 'Connecting...';
    setTimeout(async function () {
      var res = await window.api.discordStatus();
      if (statusEl) {
        if (res.enabled) statusEl.textContent = 'Connected';
        else statusEl.textContent = 'Could not connect: ' + (res.error || 'Discord not running');
      }
    }, 3000);
  } else {
    if (statusEl) statusEl.textContent = 'Disconnected';
  }
});
var settCrossfade = $('setting-crossfade');
if (settCrossfade) {
  settCrossfade.addEventListener('input', function (e) {
    appSettings.crossfade = e.target.value;
    var cv = $('crossfade-val'); if (cv) cv.textContent = e.target.value + 's';
    saveSettingsDebounced();
  });
}
var settMasterGain = $('setting-master-gain');
if (settMasterGain) {
  settMasterGain.addEventListener('input', function (e) {
    appSettings.masterGain = parseInt(e.target.value);
    var mgv = $('master-gain-val'); if (mgv) mgv.textContent = e.target.value + '%';
    if (typeof audioGainNode !== 'undefined' && audioGainNode) {
      audioGainNode.gain.value = appSettings.masterGain / 100.0;
    }
    saveSettingsDebounced();
  });
}

var queueToggle = $('btn-queue-toggle'); if (queueToggle) queueToggle.addEventListener('click', toggleQueue);
var closeQueue = $('btn-close-queue'); if (closeQueue) closeQueue.addEventListener('click', function () { setQueueOpen(false); });

var settNorm = $('setting-normalization');
if (settNorm) settNorm.addEventListener('change', async function (e) {
  appSettings.normalization = e.target.checked;
  await persistSettings(appSettings);
  if (audioCtx) {
    updateAudioChain();
    if (crossfadeActive) cancelCrossfadeTransition(true);
    var activeGain = window.audioGainNodes ? window.audioGainNodes[activeAudioIdx] : null;
    if (activeGain) setPlaybackGain(activeGain, getNormalizationGain(state.currentPlayingTrack), 0.08);
  }
  updateReplayGainStatus(state.currentPlayingTrack);
});

var settNotif = $('setting-notifications');
if (settNotif) settNotif.addEventListener('change', async function (e) {
  appSettings.notifications = e.target.checked;
  await persistSettings(appSettings);
});

var settNativeTitleBar = $('setting-native-titlebar');
if (settNativeTitleBar) settNativeTitleBar.addEventListener('change', async function (e) {
  var nextValue = e.target.checked;
  var changed = !!appSettings.useNativeTitleBar !== nextValue;
  appSettings.useNativeTitleBar = nextValue;
  await persistSettings(appSettings);
  if (changed) alert('Restart Playerinyo to apply the title bar change.');
});

// (virtual-scrolling checkbox is wired once above, incl. the perf-mode class toggle)

var settLL = $('setting-lazy-loading');
if (settLL) settLL.addEventListener('change', async function (e) {
  appSettings.lazyLoading = e.target.checked;
  await persistSettings(appSettings);
});

var settGlassEffects = $('setting-glass-effects');
if (settGlassEffects) settGlassEffects.addEventListener('change', async function () {
  appSettings.glassEffects = this.checked;
  applyThemeSettings();
  await persistSettings(appSettings);
});

function updateMultiSelectControls() {
  var count = selectedAlbumsForEdit ? selectedAlbumsForEdit.size : 0;
  var meBtn = $('btn-multi-edit');
  var mmBtn = $('btn-multi-merge');
  var mrBtn = $('btn-multi-remove');
  if (meBtn) {
    meBtn.style.display = count > 0 ? 'block' : 'none';
    meBtn.textContent = 'Edit (' + count + ')';
  }
  if (mmBtn) mmBtn.style.display = count > 1 ? 'block' : 'none';
  if (mrBtn) {
    mrBtn.style.display = count > 0 ? 'block' : 'none';
    mrBtn.textContent = 'Remove (' + count + ')';
  }
}

function setMultiSelectMode(enabled) {
  isMultiSelectMode = !!enabled;
  var multiSelectButton = $('btn-multi-select');
  var stateLabel = $('multi-select-state');
  if (multiSelectButton) {
    multiSelectButton.classList.toggle('active', isMultiSelectMode);
    multiSelectButton.setAttribute('aria-pressed', String(isMultiSelectMode));
    multiSelectButton.setAttribute('aria-label', isMultiSelectMode ? 'Disable album selection' : 'Enable album selection');
    multiSelectButton.title = isMultiSelectMode ? 'Disable album selection' : 'Enable album selection';
    multiSelectButton.style.color = '';
  }
  if (stateLabel) stateLabel.hidden = !isMultiSelectMode;
}

var btnMultiSelect = $('btn-multi-select');
if (btnMultiSelect) btnMultiSelect.addEventListener('click', function () {
  if (typeof isMultiSelectMode === 'undefined') window.isMultiSelectMode = false;
  if (typeof selectedAlbumsForEdit === 'undefined') window.selectedAlbumsForEdit = new Set();
  setMultiSelectMode(!isMultiSelectMode);
  if (!isMultiSelectMode) {
    selectedAlbumsForEdit.clear();
    updateMultiSelectControls();
  }
  renderLibrary();
});

var btnMultiEdit = $('btn-multi-edit');
if (btnMultiEdit) btnMultiEdit.addEventListener('click', function () {
  if (typeof selectedAlbumsForEdit === 'undefined' || selectedAlbumsForEdit.size === 0) return;
  var allTracks = getLibraryIndex().albums.filter(function (album) { return selectedAlbumsForEdit.has(album.id); }).flatMap(function (album) { return album.tracks; });
  if (allTracks.length > 0) openMetadataEditor(allTracks);
});

var btnMultiMerge = $('btn-multi-merge');
if (btnMultiMerge) btnMultiMerge.addEventListener('click', async function () {
  if (!selectedAlbumsForEdit || selectedAlbumsForEdit.size < 2) return;
  var allTracks = getLibraryIndex().albums.filter(function (album) { return selectedAlbumsForEdit.has(album.id); }).flatMap(function (album) { return album.tracks; });
  if (!allTracks.length) return;
  openMetadataEditor(allTracks);
  selectedAlbumsForEdit.clear();
  setMultiSelectMode(false);
  updateMultiSelectControls();
});

var btnMultiRemove = $('btn-multi-remove');
if (btnMultiRemove) btnMultiRemove.addEventListener('click', async function () {
  if (!selectedAlbumsForEdit || selectedAlbumsForEdit.size === 0) return;
  var albumCount = selectedAlbumsForEdit.size;
  var allTracks = getLibraryIndex().albums.filter(function (album) { return selectedAlbumsForEdit.has(album.id); }).flatMap(function (album) { return album.tracks; });
  if (!allTracks.length) return;
  if (!confirm('Remove ' + albumCount + ' album' + (albumCount === 1 ? '' : 's') + ' / ' + allTracks.length + ' track' + (allTracks.length === 1 ? '' : 's') + ' from the library?\n\nAudio files and playlist entries will not be deleted. Playlist entries may appear missing until the files are imported again. An Undo action will remain available until dismissed.')) return;
  var removal = await removeLibraryFiles(allTracks, 'Remove selected albums from library');
  if (removal.failed) return;
  selectedAlbumsForEdit.clear();
  setMultiSelectMode(false);
  updateMultiSelectControls();
  switchView(state.musicFiles.length ? 'library' : 'home', false);
  showUndoToast('Removed ' + removal.count + ' track' + (removal.count === 1 ? '' : 's') + ' from the library. Audio files and playlists were not deleted.', removal.snapshot);
});

var eqBands = [];
var analyserNode;
var visualizerFrame = null;
function initEq() {
  if (!audioCtx || eqBands.length) return;
  var eqFreqs = [60, 230, 910, 3600, 14000];
  eqFreqs.forEach((freq, i) => {
    var filter = audioCtx.createBiquadFilter();
    filter.type = (i === 0) ? 'lowshelf' : (i === eqFreqs.length - 1) ? 'highshelf' : 'peaking';
    filter.frequency.value = freq;
    filter.Q.value = 1;
    filter.gain.value = appSettings.eqGains ? (appSettings.eqGains[i] || 0) : 0;
    eqBands.push(filter);
    if (i > 0) eqBands[i - 1].connect(eqBands[i]);
  });

  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 256;
  if (eqBands.length) eqBands[eqBands.length - 1].connect(analyserNode);

  updateAudioChain();
  drawVisualizer();
}

function drawVisualizer() {
  if (visualizerFrame) cancelAnimationFrame(visualizerFrame);
  var canvas = $('visualizer');
  if (!canvas || !analyserNode) return;
  if (!state.isPlaying) {
    visualizerFrame = null;
    var idleCtx = canvas.getContext('2d');
    idleCtx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  visualizerFrame = requestAnimationFrame(drawVisualizer);
  var ctx = canvas.getContext('2d');
  // Only resize the canvas when its layout size actually changed (resizing clears it
  // and forces layout); reuse one data array instead of allocating per frame
  var width = canvas.offsetWidth;
  var height = canvas.offsetHeight;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  var bufferLength = analyserNode.frequencyBinCount;
  if (!window._vizDataArray || window._vizDataArray.length !== bufferLength) window._vizDataArray = new Uint8Array(bufferLength);
  var dataArray = window._vizDataArray;
  analyserNode.getByteFrequencyData(dataArray);

  ctx.clearRect(0, 0, width, height);

  var barWidth = (width / bufferLength) * 2.5;
  var barHeight;
  var x = 0;

  var accentRaw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#F5F5F5';
  for (var i = 0; i < bufferLength; i++) {
    barHeight = (dataArray[i] / 255) * height * 1.5;
    ctx.globalAlpha = 0.3 + (dataArray[i] / 255) * 0.7;
    ctx.fillStyle = accentRaw;
    ctx.fillRect(x, height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }
  ctx.globalAlpha = 1;
}

const EQ_PRESETS = {
  'Flat': [0, 0, 0, 0, 0],
  'Bass Boost': [8, 5, 0, -2, -3],
  'Treble Boost': [-2, 0, 2, 5, 7],
  'Rock': [4, 2, -1, 2, 4],
  'Pop': [-1, 3, 5, 2, -1],
  'Jazz': [3, 2, 0, 2, 4],
  'Classical': [4, 2, -1, 2, 4],
  'Electronic': [4, 3, 0, 3, 5],
  'Vocal': [-2, 0, 4, 3, 1],
  'Dance': [5, 3, 0, 2, 4],
};
var activeEqPreset = 'Flat';

function applyEqPreset(name) {
  var gains = EQ_PRESETS[name] || [0, 0, 0, 0, 0];
  if (!appSettings.eqGains) appSettings.eqGains = [0, 0, 0, 0, 0];
  gains.forEach(function (g, i) {
    appSettings.eqGains[i] = g;
    if (eqBands[i]) eqBands[i].gain.value = g;
  });
  activeEqPreset = name;
  saveSettingsDebounced();
  buildEqUi();
}

function buildEqUi() {
  var presetContainer = $('eq-presets');
  if (presetContainer) {
    presetContainer.innerHTML = '';
    Object.keys(EQ_PRESETS).forEach(function (name) {
      var btn = document.createElement('button');
      btn.className = 'eq-preset-btn' + (name === activeEqPreset ? ' active' : '');
      btn.textContent = name;
      btn.addEventListener('click', function () { applyEqPreset(name); });
      presetContainer.appendChild(btn);
    });
  }
  var c = $('eq-sliders'); if (!c) return;
  c.innerHTML = '';
  var eqFreqs = [60, 230, 910, 3600, 14000];
  var eqLabels = ['60', '230', '910', '3.6k', '14k'];
  eqFreqs.forEach((freq, i) => {
    var col = document.createElement('div');
    col.style.display = 'flex'; col.style.flexDirection = 'column'; col.style.alignItems = 'center';
    var valDiv = document.createElement('div');
    valDiv.style.fontSize = '10px'; valDiv.style.color = 'var(--text-subdued)';
    var currentVal = appSettings.eqGains ? (appSettings.eqGains[i] || 0) : 0;
    valDiv.textContent = (currentVal > 0 ? '+' : '') + currentVal + ' dB';
    var inp = document.createElement('input');
    inp.type = 'range'; inp.min = '-12'; inp.max = '12'; inp.value = currentVal;
    inp.style.writingMode = 'vertical-lr'; inp.style.direction = 'rtl'; inp.style.height = '100px'; inp.style.margin = '12px 0';
    inp.oninput = function () {
      var v = parseFloat(this.value);
      valDiv.textContent = (v > 0 ? '+' : '') + v + ' dB';
      if (eqBands[i]) eqBands[i].gain.value = v;
      if (!appSettings.eqGains) appSettings.eqGains = [0, 0, 0, 0, 0];
      appSettings.eqGains[i] = v;
      activeEqPreset = 'Custom';
      // Mark all presets as inactive
      document.querySelectorAll('.eq-preset-btn').forEach(function (b) { b.classList.remove('active'); });
      saveSettingsDebounced();
    };
    var lbl = document.createElement('div');
    lbl.style.fontSize = '10px'; lbl.style.fontWeight = 'bold';
    lbl.textContent = eqLabels[i];
    col.appendChild(valDiv); col.appendChild(inp); col.appendChild(lbl);
    c.appendChild(col);
  });
}

var btnEq = $('btn-eq'); if (btnEq) btnEq.addEventListener('click', function () { initAudioCtx(); buildEqUi(); showModal($('eq-modal')); });
var btnCloseEq = $('btn-close-eq'); if (btnCloseEq) btnCloseEq.addEventListener('click', function () { hideModal($('eq-modal')); });
var btnResetEq = $('btn-reset-eq'); if (btnResetEq) btnResetEq.addEventListener('click', function () { applyEqPreset('Flat'); });
[$('settings-modal'), $('create-playlist-modal'), $('eq-modal')].forEach(function (m) { if (m) m.addEventListener('click', function (e) { if (e.target === m) hideModal(m); }); });

/* ─── LYRICS ENGINE ─── */

function parseLrc(lrcText) {
  var lines = lrcText.split('\n');
  var result = [];
  lines.forEach(function (line) {
    var match = line.match(/^\[(\d+):(\d+\.?\d*)\](.*)$/);
    if (match) {
      var secs = parseInt(match[1]) * 60 + parseFloat(match[2]);
      var text = match[3].trim();
      if (text) result.push({ time: secs, text: text });
    }
  });
  result.sort(function (a, b) { return a.time - b.time; });
  return result;
}

function renderLyricsPanel() {
  var lc = $('lyrics-content'); if (!lc) return;
  lyricsActiveIdx = -2;
  if (!lyricsData || lyricsData.length === 0) {
    lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-microphone-stage" style="font-size:48px;color:var(--text-disabled);margin-bottom:12px;"></i><p style="color:var(--text-subdued);font-size:13px;">Lyrics Not Found</p></div>';
    return;
  }
  lc.innerHTML = '';
  lyricsData.forEach(function (line, i) {
    var div = document.createElement('div');
    div.className = 'lyric-line';
    div.dataset.idx = i;
    div.textContent = line.text;
    div.addEventListener('click', function () { setActiveAudioPosition(line.time, true); });
    lc.appendChild(div);
  });
}

function getLyricsOffsetKey(track) {
  if (!track) return '';
  return ((track.matchedFile && track.matchedFile.filePath) || '') || ((track.artist || '') + '::' + (track.title || ''));
}

function setLyricsOffset(nextValue) {
  lyricsOffsetSec = Math.max(-10, Math.min(10, Math.round(nextValue * 10) / 10));
  if (!appSettings.lyricsOffsets) appSettings.lyricsOffsets = {};
  var key = getLyricsOffsetKey(state.currentPlayingTrack);
  if (key) appSettings.lyricsOffsets[key] = lyricsOffsetSec;
  updateLyricsOffsetUi();
  saveSettingsDebounced();
}

function loadLyricsOffsetForTrack(track) {
  var key = getLyricsOffsetKey(track);
  lyricsOffsetSec = key && appSettings.lyricsOffsets && typeof appSettings.lyricsOffsets[key] === 'number' ? appSettings.lyricsOffsets[key] : 0;
  updateLyricsOffsetUi();
}

function updateLyricsOffsetUi() {
  var label = (lyricsOffsetSec > 0 ? '+' : '') + lyricsOffsetSec.toFixed(1) + 's';
  var a = $('lyrics-offset-val'); if (a) a.textContent = label;
  var b = $('np-lyrics-offset-val'); if (b) b.textContent = label;
}

function updateLyricsHighlight(currentTime) {
  if (!lyricsOpen) return;
  currentTime += lyricsOffsetSec;
  var plainBar = $('plain-lyrics-progress-bar');
  if (plainBar && window.audioEls) {
    var plainAudio = window.audioEls[activeAudioIdx];
    if (plainAudio && !isNaN(plainAudio.duration) && plainAudio.duration > 0) {
      plainBar.style.width = ((plainAudio.currentTime / plainAudio.duration) * 100) + '%';
      var plainContent = $('lyrics-content');
      if (plainContent && plainContent.scrollHeight > plainContent.clientHeight) {
        plainContent.scrollTop = (plainContent.scrollHeight - plainContent.clientHeight) * (plainAudio.currentTime / plainAudio.duration);
      }
    }
  }
  if (!lyricsData.length) return;
  var activeIdx = -1;
  for (var i = 0; i < lyricsData.length; i++) {
    if (lyricsData[i].time <= currentTime) activeIdx = i;
    else break;
  }
  if (activeIdx === lyricsActiveIdx) return;
  lyricsActiveIdx = activeIdx;
  var lc = $('lyrics-content'); if (!lc) return;
  var lines = lc.querySelectorAll('.lyric-line');
  lines.forEach(function (el, i) {
    el.classList.remove('active', 'passed');
    if (i < activeIdx) el.classList.add('passed');
    else if (i === activeIdx) el.classList.add('active');
  });
  var now = Date.now();
  if (activeIdx >= 0 && lines[activeIdx] && now - lyricsLastScrollAt > 700) {
    lyricsLastScrollAt = now;
    if (lc) {
      lc.scrollTo({ top: lines[activeIdx].offsetTop - (lc.clientHeight / 2) + (lines[activeIdx].clientHeight / 2), behavior: 'auto' });
    }
  }

}

function normalizeLyricsMatchText(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function isTrustedLyricsMatch(track, data) {
  if (!track || !data) return false;
  var artist = normalizeLyricsMatchText(track.artist), title = normalizeLyricsMatchText(track.title);
  var resultArtist = normalizeLyricsMatchText(data.artistName || data.artist_name), resultTitle = normalizeLyricsMatchText(data.trackName || data.track_name || data.name);
  if (!artist || !title || artist !== resultArtist || title !== resultTitle) return false;
  if (track.album && (data.albumName || data.album_name) && normalizeLyricsMatchText(track.album) !== normalizeLyricsMatchText(data.albumName || data.album_name)) return false;
  var expected = Number(track.duration) || 0, actual = Number(data.duration) || 0;
  return !(expected && actual && Math.abs(expected - actual) > Math.max(12, expected * .12));
}

function getLyricsRequestKey(track) {
  return [track && track.artist, track && track.title, track && track.album, Math.round(Number(track && track.duration) || 0)]
    .map(normalizeLyricsMatchText).join('::');
}
function getCachedLyrics(key) {
  return lyricsCache && typeof lyricsCache.get === 'function' ? lyricsCache.get(key) : null;
}
function cacheLyrics(key, data) {
  if (lyricsCache && typeof lyricsCache.set === 'function') lyricsCache.set(key, data);
}
function renderPlainLyrics(text) {
  lyricsData = [];
  plainLyricsText = text;
  var lc = $('lyrics-content');
  if (lc) {
    lc.innerHTML = '';
    var plainProgressContainer = document.createElement('div');
    plainProgressContainer.id = 'plain-lyrics-progress-container';
    plainProgressContainer.style.cssText = 'width:80%;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin:0 auto 16px;overflow:hidden;';
    plainProgressContainer.innerHTML = '<div id="plain-lyrics-progress-bar" style="width:0%;height:100%;background:var(--accent);"></div>';
    lc.appendChild(plainProgressContainer);
    text.split('\n').forEach(function (line) {
      var div = document.createElement('div');
      div.style.cssText = 'padding:6px 14px;font-size:14px;color:var(--text-subdued);text-align:center;line-height:1.6;';
      div.textContent = line || '\u00a0';
      lc.appendChild(div);
    });
    var note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:var(--text-disabled);text-align:center;padding:16px;';
    note.textContent = 'Plain lyrics (no sync available)';
    lc.appendChild(note);
  }
}
function applyTrustedLyricsResult(track, data) {
  if (!isTrustedLyricsMatch(track, data)) return false;
  if (data && data.syncedLyrics) {
    lyricsData = parseLrc(data.syncedLyrics);
    plainLyricsText = '';
    renderLyricsPanel();
    if (npOverlayOpen) mirrorLyricsToNP();
    return true;
  }
  if (data && data.plainLyrics) {
    renderPlainLyrics(data.plainLyrics);
    if (npOverlayOpen) mirrorLyricsToNP();
    return true;
  }
  return false;
}

async function fetchLyricsForTrack(track) {
  if (!track) return;
  loadLyricsOffsetForTrack(track);
  var key = getLyricsRequestKey(track);
  if (key === lyricsCurrentTrackKey) return;

  // Reset state and clear UI immediately
  lyricsCurrentTrackKey = key;
  lyricsData = [];
  plainLyricsText = '';
  lyricsActiveIdx = -2;
  npLyricsActiveIdx = -2;
  var lc = $('lyrics-content');
  if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-spinner ph-spin" style="font-size:36px;color:var(--text-subdued);"></i><p style="color:var(--text-subdued);font-size:12px;margin-top:12px;">Searching lyrics...</p></div>';
  if (npOverlayOpen) mirrorLyricsToNP(); // Clear NP overlay lyrics

  if (!(track.title || '').trim() || !(track.artist || '').trim()) {
    if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-warning" style="font-size:48px;color:var(--text-disabled);margin-bottom:12px;"></i><p style="color:var(--text-subdued);font-size:13px;">Track metadata is unavailable</p></div>';
    return;
  }

  var cached = getCachedLyrics(key);
  if (cached && applyTrustedLyricsResult(track, cached)) return;

  // Try LRCLIB API
  try {
    var duration = track.duration ? Math.round(track.duration) : 0;
    var apiUrl = 'https://lrclib.net/api/get?artist_name=' + encodeURIComponent(track.artist) + '&track_name=' + encodeURIComponent(track.title) + '&album_name=' + encodeURIComponent(track.album || '') + (duration ? '&duration=' + duration : '');
    var resp = await fetch(apiUrl);
    // Track may have changed while awaiting; never let a stale fetch overwrite newer lyrics
    if (lyricsCurrentTrackKey !== key) return;

    if (resp.ok) {
      var data = await resp.json();
      if (lyricsCurrentTrackKey !== key) return;
      if (applyTrustedLyricsResult(track, data)) {
        cacheLyrics(key, data);
        return;
      }
    }
  } catch (e) { console.log('LRCLIB fetch error:', e); }

  // Final fallback: No lyrics found
  if (lyricsCurrentTrackKey === key) {
    lyricsData = [];
    plainLyricsText = '';
    if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-microphone-stage" style="font-size:48px;color:var(--text-disabled);margin-bottom:12px;"></i><p style="color:var(--text-subdued);font-size:13px;">Lyrics Not Found</p><p style="color:var(--text-disabled);font-size:11px;margin-top:4px;">Right-click here to search manually</p></div>';
    if (npOverlayOpen) mirrorLyricsToNP();
  }
}

function setLyricsOpen(open) {
  lyricsOpen = !!open;
  if (lyricsOpen && isQueueOpen) setQueueOpen(false);
  var panel = $('lyrics-panel');
  var btn = $('btn-lyrics-toggle');
  setDisclosureState(panel, btn, lyricsOpen);
  if (btn) btn.style.color = lyricsOpen ? 'var(--accent)' : '';
  if (lyricsOpen && state.currentPlayingTrack) fetchLyricsForTrack(state.currentPlayingTrack);
}
function toggleLyrics() { setLyricsOpen(!lyricsOpen); }

function openManualLyricsSearch(e) {
  if (e) e.preventDefault();
  if (e) e.stopPropagation();
  if (!state.currentPlayingTrack) return;
  var currentArtist = state.currentPlayingTrack.artist || '';
  var currentTitle = state.currentPlayingTrack.title || '';
  var artistInput = $('manual-lyrics-artist');
  var titleInput = $('manual-lyrics-title');
  if (artistInput) artistInput.value = currentArtist;
  if (titleInput) titleInput.value = currentTitle;
  showModal($('manual-lyrics-modal'));
  setTimeout(function () { if (titleInput) titleInput.focus(); }, 50);
}
function runManualLyricsSearch() {
  if (!state.currentPlayingTrack) return;
  var manualArtist = (($('manual-lyrics-artist') && $('manual-lyrics-artist').value) || state.currentPlayingTrack.artist || '').trim();
  var manualTitle = (($('manual-lyrics-title') && $('manual-lyrics-title').value) || state.currentPlayingTrack.title || '').trim();
  if (!manualTitle) return;
  var tempTrack = Object.assign({}, state.currentPlayingTrack);
  tempTrack.artist = manualArtist;
  tempTrack.title = manualTitle;
  lyricsCurrentTrackKey = '';
  hideModal($('manual-lyrics-modal'));
  fetchLyricsForTrack(tempTrack).then(function () { if (npOverlayOpen) mirrorLyricsToNP(); });
}
var lcElement = $('lyrics-content');
if (lcElement) lcElement.addEventListener('contextmenu', openManualLyricsSearch);
var manualLyricsCancel = $('manual-lyrics-cancel');
if (manualLyricsCancel) manualLyricsCancel.addEventListener('click', function () { hideModal($('manual-lyrics-modal')); });
var manualLyricsSearch = $('manual-lyrics-search');
if (manualLyricsSearch) manualLyricsSearch.addEventListener('click', runManualLyricsSearch);
['manual-lyrics-artist', 'manual-lyrics-title'].forEach(function (id) {
  var input = $(id);
  if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') runManualLyricsSearch(); });
});
var manualLyricsModal = $('manual-lyrics-modal');
if (manualLyricsModal) manualLyricsModal.addEventListener('click', function (e) { if (e.target === manualLyricsModal) hideModal(manualLyricsModal); });

var btnLyricsToggle = $('btn-lyrics-toggle');
if (btnLyricsToggle) btnLyricsToggle.addEventListener('click', toggleLyrics);
var btnLyricsOffsetDown = $('btn-lyrics-offset-down');
if (btnLyricsOffsetDown) btnLyricsOffsetDown.addEventListener('click', function () { setLyricsOffset(lyricsOffsetSec - 0.5); });
var btnLyricsOffsetUp = $('btn-lyrics-offset-up');
if (btnLyricsOffsetUp) btnLyricsOffsetUp.addEventListener('click', function () { setLyricsOffset(lyricsOffsetSec + 0.5); });
var btnCloseLyrics = $('btn-close-lyrics');
if (btnCloseLyrics) btnCloseLyrics.addEventListener('click', function () { setLyricsOpen(false); });
var btnLyricsFile = $('btn-lyrics-load-file');
if (btnLyricsFile) btnLyricsFile.addEventListener('click', async function () {
  var content = await window.api.openLrc();
  if (!content) return;
  lyricsData = parseLrc(content);
  plainLyricsText = '';
  lyricsCurrentTrackKey = 'custom';
  renderLyricsPanel();
});

/* --- NOW PLAYING OVERLAY --- */
var npOverlayOpen = false;
var npSecondaryPanel = 'lyrics';
function isFullscreenQueueOpen() { return npOverlayOpen && npSecondaryPanel === 'queue'; }
function setNPSecondaryPanel(panel) {
  npSecondaryPanel = panel === 'queue' ? 'queue' : 'lyrics';
  var queue = $('np-queue-content'); var lyrics = $('np-lyrics-content'); var lyricsHeader = document.querySelector('.np-lyrics-header');
  if (queue) queue.hidden = npSecondaryPanel !== 'queue';
  if (lyrics) lyrics.hidden = npSecondaryPanel !== 'lyrics';
  if (lyricsHeader) lyricsHeader.hidden = npSecondaryPanel !== 'lyrics';
  [['np-queue-tab', 'queue'], ['np-lyrics-tab', 'lyrics']].forEach(function (entry) { var tab = $(entry[0]); if (tab) { var active = npSecondaryPanel === entry[1]; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', active ? 'true' : 'false'); } });
  var queueToggle = $('np-queue-toggle'); if (queueToggle) { var activeQueue = npSecondaryPanel === 'queue'; queueToggle.setAttribute('aria-label', activeQueue ? 'Show lyrics' : 'Show queue'); queueToggle.setAttribute('aria-expanded', activeQueue ? 'true' : 'false'); queueToggle.style.color = activeQueue ? 'var(--accent)' : 'rgba(255,255,255,0.6)'; }
  if (npSecondaryPanel === 'queue') renderFullscreenQueue();
}
function applyNPLyricsVisibility() {
  var btn = document.getElementById('np-lyrics-toggle');
  var region = document.getElementById('np-lyrics-col');
  if (region) { region.setAttribute('aria-hidden', 'false'); region.inert = false; }
  if (btn) {
    var activeLyrics = npSecondaryPanel === 'lyrics';
    btn.setAttribute('aria-label', activeLyrics ? 'Show queue' : 'Show lyrics');
    btn.setAttribute('aria-expanded', activeLyrics ? 'true' : 'false');
    btn.style.color = activeLyrics ? 'var(--accent)' : 'rgba(255,255,255,0.6)';
  }
}
function openNowPlayingOverlay() {
  npOverlayOpen = true;
  var ov = document.getElementById('now-playing-overlay');
  if (ov) { ov.classList.add('open'); ov.setAttribute('aria-hidden', 'false'); ov.inert = false; }
  applyNPLyricsVisibility();
  setNPSecondaryPanel(npSecondaryPanel);
  var btn = document.getElementById('btn-now-playing-overlay');
  if (btn) { btn.style.color = 'var(--accent)'; btn.setAttribute('aria-expanded', 'true'); }
  setModalBackgroundInert(true);
  updateNowPlayingOverlay();
  requestAnimationFrame(function () { var closeButton = $('np-close-btn'); if (closeButton) closeButton.focus(); });
  if (state.currentPlayingTrack) loadNPSlideshowImagesForTrack(state.currentPlayingTrack, playbackGeneration);
  if (lyricsData && lyricsData.length) mirrorLyricsToNP();
  else if (state.currentPlayingTrack) {
    fetchLyricsForTrack(state.currentPlayingTrack);
  }
}
function closeNowPlayingOverlay() {
  npOverlayOpen = false;
  clearInterval(_npSlideshowTimer);
  _npSlideshowTimer = null;
  var ov = document.getElementById('now-playing-overlay');
  if (ov) { ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); ov.inert = true; }
  var btn = document.getElementById('btn-now-playing-overlay');
  if (btn) { btn.style.color = ''; btn.setAttribute('aria-expanded', 'false'); }
  if (!modalStack.length) setModalBackgroundInert(false);
  if (btn) btn.focus();
}
function toggleNowPlayingOverlay() {
  if (npOverlayOpen) closeNowPlayingOverlay(); else openNowPlayingOverlay();
}
function updateNowPlayingOverlay() {
  var track = state.currentPlayingTrack;
  var artEl = document.getElementById('np-art');
  var placeholder = document.getElementById('np-art-placeholder');
  var bgBlur = document.getElementById('np-bg-blur');
  var titleEl = document.getElementById('np-track-title');
  var artistEl = document.getElementById('np-track-artist');
  var albumEl = document.getElementById('np-track-album');
  var playIcon = document.getElementById('np-play-icon');
  var artWrap = document.getElementById('np-art-wrap');
  if (track) {
    var pic = getTrackArtworkUrl(track);
    if (artEl) { if (pic) artEl.src = pic; else artEl.removeAttribute('src'); artEl.alt = pic ? ('Cover for ' + (track.album || track.title || 'current track')) : ''; artEl.style.display = pic ? 'block' : 'none'; }
    if (placeholder) placeholder.style.display = pic ? 'none' : 'flex';
    if (bgBlur) bgBlur.style.backgroundImage = pic ? 'url("' + pic.replace(/"/g, '\\"') + '")' : '';
    if (titleEl) titleEl.textContent = track.title || '';
    if (artistEl) artistEl.textContent = track.artist || '';
    if (albumEl) albumEl.textContent = track.album || '';
    if (titleEl) titleEl.disabled = !resolvePlaybackTrackAlbum(track);
    if (artistEl) artistEl.disabled = !isSearchablePlaybackArtist(track.artist);
    if (artWrap) artWrap.tabIndex = pic ? 0 : -1;
  } else {
    if (artEl) { artEl.removeAttribute('src'); artEl.alt = ''; artEl.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'flex';
    if (bgBlur) bgBlur.style.backgroundImage = '';
    if (titleEl) titleEl.textContent = 'No track';
    if (artistEl) artistEl.textContent = String.fromCharCode(8212);
    if (albumEl) albumEl.textContent = '';
    if (titleEl) titleEl.disabled = true;
    if (artistEl) artistEl.disabled = true;
    if (artWrap) artWrap.tabIndex = -1;
  }
  if (playIcon) playIcon.className = state.isPlaying ? 'ph ph-pause-circle' : 'ph ph-play-circle';
  syncPlaybackFeedback();
  syncTransportControls();
}
function mirrorLyricsToNP() {
  var npLc = document.getElementById('np-lyrics-content');
  if (!npLc) return;
  npLyricsActiveIdx = -2;
  npLc.innerHTML = '';
  if (!lyricsData || !lyricsData.length) {
    if (plainLyricsText) {
      plainLyricsText.split('\n').forEach(function (line) {
        var plainLine = document.createElement('div');
        plainLine.className = 'plain-lyric-line';
        plainLine.textContent = line || '\u00a0';
        npLc.appendChild(plainLine);
      });
      return;
    }
    npLc.innerHTML = '<div style="padding:40px 0;text-align:center;color:rgba(255,255,255,0.25);font-size:13px;">No synced lyrics found<br><span style="font-size:11px;color:rgba(255,255,255,0.18);">Right-click to search manually</span></div>';
    return;
  }
  lyricsData.forEach(function (line) {
    var div = document.createElement('div');
    div.className = 'lyric-line';
    div.textContent = line.text;
    div.addEventListener('click', function () { setActiveAudioPosition(line.time, true); });
    npLc.appendChild(div);
  });
}
function updateNPLyricsHighlight(currentTime) {
  if (!npOverlayOpen) return;
  if (!lyricsData.length) {
    var plainNp = $('np-lyrics-content');
    var plainNpAudio = window.audioEls ? window.audioEls[activeAudioIdx] : null;
    if (plainLyricsText && plainNp && plainNpAudio && !isNaN(plainNpAudio.duration) && plainNpAudio.duration > 0 && plainNp.scrollHeight > plainNp.clientHeight) {
      plainNp.scrollTop = (plainNp.scrollHeight - plainNp.clientHeight) * (plainNpAudio.currentTime / plainNpAudio.duration);
    }
    return;
  }
  currentTime += lyricsOffsetSec;
  var activeIdx = -1;
  for (var i = 0; i < lyricsData.length; i++) {
    if (lyricsData[i].time <= currentTime) activeIdx = i;
    else break;
  }
  if (activeIdx === npLyricsActiveIdx) return;
  npLyricsActiveIdx = activeIdx;
  var npLc = document.getElementById('np-lyrics-content');
  if (!npLc) return;
  var lines = npLc.querySelectorAll('.lyric-line');
  lines.forEach(function (el, i) {
    el.classList.remove('active', 'passed');
    if (i < activeIdx) el.classList.add('passed');
    else if (i === activeIdx) { 
      el.classList.add('active'); 
      var now = Date.now();
      if (npLc && now - npLyricsLastScrollAt > 700) {
        npLyricsLastScrollAt = now;
        npLc.scrollTo({ top: el.offsetTop - (npLc.clientHeight / 2) + (el.clientHeight / 2), behavior: 'auto' });
      }
    }
  });
}
var _npBtnPlay = document.getElementById('np-btn-play');
if (_npBtnPlay) _npBtnPlay.addEventListener('click', function () { initAudioCtx(); togglePlay(); updateNowPlayingOverlay(); });
var _npBtnPrev = document.getElementById('np-btn-prev');
if (_npBtnPrev) _npBtnPrev.addEventListener('click', function () { initAudioCtx(); playPrevTrack(); });
var _npBtnNext = document.getElementById('np-btn-next');
if (_npBtnNext) _npBtnNext.addEventListener('click', function () { initAudioCtx(); playNextTrack(); });
var _npBtnShuffle = document.getElementById('np-btn-shuffle');
if (_npBtnShuffle) _npBtnShuffle.addEventListener('click', toggleShuffle);
var _npBtnLoop = document.getElementById('np-btn-loop');
if (_npBtnLoop) _npBtnLoop.addEventListener('click', cycleLoop);
var _npBtnLike = document.getElementById('np-btn-like');
if (_npBtnLike) _npBtnLike.addEventListener('click', toggleCurrentTrackLike);
var _npLyricsToggle = document.getElementById('np-lyrics-toggle');
if (_npLyricsToggle) _npLyricsToggle.addEventListener('click', function () {
  setNPSecondaryPanel(npSecondaryPanel === 'lyrics' ? 'queue' : 'lyrics');
  applyNPLyricsVisibility();
  if (npSecondaryPanel === 'lyrics' && state.currentPlayingTrack && (!lyricsData || !lyricsData.length)) fetchLyricsForTrack(state.currentPlayingTrack);
});
var _npQueueToggle = document.getElementById('np-queue-toggle');
if (_npQueueToggle) _npQueueToggle.addEventListener('click', function () { setNPSecondaryPanel(npSecondaryPanel === 'queue' ? 'lyrics' : 'queue'); applyNPLyricsVisibility(); });
var _npQueueTab = $('np-queue-tab'); if (_npQueueTab) _npQueueTab.addEventListener('click', function () { setNPSecondaryPanel('queue'); applyNPLyricsVisibility(); });
var _npLyricsTab = $('np-lyrics-tab'); if (_npLyricsTab) _npLyricsTab.addEventListener('click', function () { setNPSecondaryPanel('lyrics'); applyNPLyricsVisibility(); });
var _npLyricsOffsetDown = document.getElementById('np-lyrics-offset-down');
if (_npLyricsOffsetDown) _npLyricsOffsetDown.addEventListener('click', function () { setLyricsOffset(lyricsOffsetSec - 0.5); });
var _npLyricsOffsetUp = document.getElementById('np-lyrics-offset-up');
if (_npLyricsOffsetUp) _npLyricsOffsetUp.addEventListener('click', function () { setLyricsOffset(lyricsOffsetSec + 0.5); });
var _npLyricsContent = document.getElementById('np-lyrics-content');
if (_npLyricsContent) _npLyricsContent.addEventListener('contextmenu', openManualLyricsSearch);
var _npOverlayEl = document.getElementById('now-playing-overlay');
if (_npOverlayEl) _npOverlayEl.addEventListener('contextmenu', function (e) {
  if (e.target.closest('#np-lyrics-content')) return;
  if (e.target.closest('button') || e.target.closest('#np-progress-container')) return;
  openManualLyricsSearch(e);
});
var _npArtWrap = document.getElementById('np-art-wrap');
if (_npArtWrap) {
  _npArtWrap.addEventListener('click', function () { var art = document.getElementById('np-art'); if (art && art.src) openCurrentPlaybackArtwork(art.currentSrc || art.src); });
  _npArtWrap.addEventListener('keydown', function (event) { if ((event.key === 'Enter' || event.key === ' ') && _npArtWrap.tabIndex >= 0) { event.preventDefault(); _npArtWrap.click(); } });
}
var _npTrackTitle = document.getElementById('np-track-title');
if (_npTrackTitle) _npTrackTitle.addEventListener('click', openPlaybackTrackAlbum);
var _npTrackArtist = document.getElementById('np-track-artist');
if (_npTrackArtist) _npTrackArtist.addEventListener('click', searchPlaybackArtist);
var _btnNPOverlay = document.getElementById('btn-now-playing-overlay');
if (_btnNPOverlay) _btnNPOverlay.addEventListener('click', toggleNowPlayingOverlay);
var _npCloseBtn = document.getElementById('np-close-btn');
if (_npCloseBtn) _npCloseBtn.addEventListener('click', closeNowPlayingOverlay);
var _npPc = document.getElementById('np-progress-container');
if (_npPc) {
  var _npDragging = false;
  var _npSeekAudio = null;
  _npPc.addEventListener('mousedown', function (e) {
    var a = window.audioEls ? window.audioEls[activeAudioIdx] : document.getElementById('audio-player-0');
    if (!state.currentPlayingTrack || isNaN(a.duration)) return;
    _npDragging = true; playbackSeekActive = true; _npSeekAudio = a; _npUpdateProg(e, a);
  });
  document.addEventListener('mousemove', function (e) { if (_npDragging && _npSeekAudio) _npUpdateProg(e, _npSeekAudio); });
  document.addEventListener('mouseup', function () {
    if (!_npDragging) return;
    _npDragging = false;
    playbackSeekActive = false;
    _npSeekAudio = null;
    checkpointPlaybackSession(getActiveAudioEl(), 200);
    syncMpris(true);
  });
  function _npUpdateProg(e, a) { var r = _npPc.getBoundingClientRect(); a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.duration; }
}
/* ─── LAST.FM INTEGRATION ─── */
var btnLfmLogin = $('btn-lastfm-login');
if (btnLfmLogin) {
  btnLfmLogin.addEventListener('click', function () {
    if (appSettings.lastfmConnected) {
      if (confirm('You are connected as ' + appSettings.lastfmUsername + '. Disconnect?')) {
        appSettings.lastfmUsername = null;
        appSettings.lastfmConnected = false;
        persistInBackground(window.api.lastfmDisconnect());
        if (state.currentView === 'home') renderHomeDashboard();
        updateLastfmIcon();
      }
    } else {
      var inpKey = $('lastfm-api-key'); if (inpKey) inpKey.value = '';
      var inpSec = $('lastfm-shared-secret'); if (inpSec) inpSec.value = '';
      showModal($('lastfm-modal'));
    }
  });
}

var btnLfmBrowser = $('btn-lastfm-open-browser');
var btnLfmConfirm = $('btn-lastfm-confirm');
var lastfmToken = null;

if (btnLfmBrowser) {
  btnLfmBrowser.addEventListener('click', async function () {
    var keyInput = $('lastfm-api-key');
    var secretInput = $('lastfm-shared-secret');
    var ak = (keyInput ? keyInput.value : '').trim();
    var ss = (secretInput ? secretInput.value : '').trim();
    if (!ak || !ss) { alert('Enter your Last.fm API key and shared secret first.'); return; }
    btnLfmBrowser.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Please wait...';
    var res = await window.api.lastfmGetAuthUrl({ apiKey: ak, sharedSecret: ss });
    btnLfmBrowser.innerHTML = '1. Open Browser to Authorize';
    if (res && res.ok === true) {
      // Credentials have crossed the IPC boundary; do not retain them in the
      // renderer DOM while the user authorizes in the browser.
      if (keyInput) keyInput.value = '';
      if (secretInput) secretInput.value = '';
      lastfmToken = true;
      btnLfmConfirm.disabled = false; btnLfmConfirm.classList.remove('btn-outline'); btnLfmConfirm.classList.add('btn-primary');
      btnLfmConfirm.style.background = 'var(--accent)'; btnLfmConfirm.style.color = 'black';
    } else {
      alert(res && res.error === 'secure-storage-unavailable'
        ? 'Last.fm credentials cannot be saved because secure OS storage is unavailable. Enable a Linux Secret Service/keyring, then restart Playerinyo. Credentials are not stored in plaintext.'
        : 'Failed to connect to Last.fm API. Check API keys or internet connection.');
    }
  });
}

if (btnLfmConfirm) {
  btnLfmConfirm.addEventListener('click', async function () {
    if (!lastfmToken) return;
    btnLfmConfirm.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Verifying...';
    var res = await window.api.lastfmGetSession();
    btnLfmConfirm.innerHTML = '2. I have authorized';
    if (res && res.name) {
      appSettings.lastfmUsername = res.name;
      appSettings.lastfmConnected = true;
      lastfmToken = null;
      var keyInput = $('lastfm-api-key'); if (keyInput) keyInput.value = '';
      var secretInput = $('lastfm-shared-secret'); if (secretInput) secretInput.value = '';
      hideModal($('lastfm-modal'));
      if (state.currentView === 'home') renderHomeDashboard();
      updateLastfmIcon();
    } else {
      alert('Failed to verify authorization. Did you click "Allow Access" in the browser?');
    }
  });
}
var btnLfmCancel = $('btn-lastfm-cancel'); if (btnLfmCancel) btnLfmCancel.addEventListener('click', function () { lastfmToken = null; var keyInput = $('lastfm-api-key'); if (keyInput) keyInput.value = ''; var secretInput = $('lastfm-shared-secret'); if (secretInput) secretInput.value = ''; hideModal($('lastfm-modal')); });
var lastfmApiLink = $('lastfm-api-link');
if (lastfmApiLink) lastfmApiLink.addEventListener('click', function () { window.api.openExternal('https://www.last.fm/api/account/create'); });

function updateLastfmIcon() {
  var icon = $('lastfm-icon'); if (!icon) return;
  icon.style.color = appSettings.lastfmConnected ? 'var(--text-base)' : 'var(--text-subdued)';
}

// Add these with other context menu listeners
var actxPlayNext = $('actx-play-next');
if (actxPlayNext) actxPlayNext.addEventListener('click', function () {
  if (window.currentContextMenuAlbum) {
    var mapped = getSortedAlbumTracks(window.currentContextMenuAlbum).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
    state.userQueue = mapped.concat(state.userQueue);
    syncSavedQueuePaths();
    saveSettingsDebounced(300);
    if (isQueueOpen) renderQueue();
  }
  hideAllContextMenus();
});

var actxAddQueue = $('actx-add-queue');
if (actxAddQueue) actxAddQueue.addEventListener('click', function () {
  if (window.currentContextMenuAlbum) {
    var mapped = getSortedAlbumTracks(window.currentContextMenuAlbum).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
    state.userQueue = state.userQueue.concat(mapped);
    syncSavedQueuePaths();
    saveSettingsDebounced(300);
    if (isQueueOpen) renderQueue();
  }
  hideAllContextMenus();
});

var actxDownloadAlbum = $('actx-download-album');
if (actxDownloadAlbum) actxDownloadAlbum.addEventListener('click', function () {
  var album = window.currentContextMenuAlbum;
  hideAllContextMenus();
  openAlbumDownloadModal(album);
});

var actxAnalyzeLoudness = $('actx-analyze-loudness');
if (actxAnalyzeLoudness) actxAnalyzeLoudness.addEventListener('click', function () {
  if (window.currentContextMenuAlbum) analyzeLoudnessForFiles(getSortedAlbumTracks(window.currentContextMenuAlbum));
});

var actxEditMetadata = $('actx-edit-metadata');
if (actxEditMetadata) actxEditMetadata.addEventListener('click', function () {
  if (window.currentContextMenuAlbum && window.currentContextMenuAlbum.tracks) openMetadataEditor(getSortedAlbumTracks(window.currentContextMenuAlbum), { scope: 'album' });
  hideAllContextMenus();
});

var actxSplitDisc = $('actx-split-disc');
if (actxSplitDisc) actxSplitDisc.addEventListener('click', async function () {
  var album = window.currentContextMenuAlbum;
  if (!album || !album.tracks || !album.tracks.length) return;
  if (!confirm('Split this album into separate app-library albums by disc? This changes the app library metadata, not the audio files.')) return;
  album.tracks.forEach(function (f) {
    var disc = getDiscNumber(f);
    if (disc > 1 || albumHasMultipleDiscs(album.tracks)) f.album = (album.name || f.album || 'Unknown Album').replace(/\s\(Disc \d+\)$/i, '') + ' (Disc ' + disc + ')';
  });
  markLibraryDirty();
  await persistLibrary(state.musicFiles);
  renderLibrary();
});

var ctxPlayNext = $('ctx-play-next');
if (ctxPlayNext) ctxPlayNext.addEventListener('click', function () {
  if (currentContextMenuTrack) {
    state.userQueue.unshift(makeManualQueueEntry(currentContextMenuTrack));
    syncSavedQueuePaths();
    saveSettingsDebounced(300);
    if (isQueueOpen) renderQueue();
  }
  hideAllContextMenus();
});

var ctxAddQueue = $('ctx-add-queue');
if (ctxAddQueue) ctxAddQueue.addEventListener('click', function () {
  if (currentContextMenuTrack) {
    state.userQueue.push(makeManualQueueEntry(currentContextMenuTrack));
    syncSavedQueuePaths();
    saveSettingsDebounced(300);
    if (isQueueOpen) renderQueue();
  }
  hideAllContextMenus();
});

var ctxAnalyzeLoudness = $('ctx-analyze-loudness');
if (ctxAnalyzeLoudness) ctxAnalyzeLoudness.addEventListener('click', function () {
  if (currentContextMenuTrack && currentContextMenuTrack.matchedFile) analyzeLoudnessForFiles([currentContextMenuTrack.matchedFile]);
});

var ctxGoToAlbum = $('ctx-go-to-album');
if (ctxGoToAlbum) ctxGoToAlbum.addEventListener('click', function () {
  if (currentContextMenuTrack && currentContextMenuTrack.matchedFile) {
    var f = currentContextMenuTrack.matchedFile;
    if (f.album) {
      var albumId = getAlbumKey(f);
      pushNav('album:' + albumId);
      var album = getFullAlbumByKey(albumId);
      if (album) renderAlbumDetail(album);
      hideAllContextMenus();
    }
  }
});

var ctxOpenFolder = $('ctx-open-folder');
if (ctxOpenFolder) ctxOpenFolder.addEventListener('click', function () {
  if (currentContextMenuTrack && currentContextMenuTrack.matchedFile) {
    showFileLocation(currentContextMenuTrack.matchedFile.filePath);
  }
  hideAllContextMenus();
});

var actxOpenFolder = $('actx-open-folder');
if (actxOpenFolder) actxOpenFolder.addEventListener('click', function () {
  if (currentContextMenuAlbum && currentContextMenuAlbum.tracks && currentContextMenuAlbum.tracks.length > 0) {
    showFileLocation(currentContextMenuAlbum.tracks[0].filePath);
  }
  hideAllContextMenus();
});

var actxRemoveLibrary = $('actx-remove-library');
if (actxRemoveLibrary) actxRemoveLibrary.addEventListener('click', async function () {
  var album = window.currentContextMenuAlbum;
  if (!album || !album.tracks || !album.tracks.length) return;
  var count = album.tracks.length;
  if (!confirm('Remove "' + (album.name || 'this album') + '" (' + count + ' track' + (count === 1 ? '' : 's') + ') from the library?\n\nAudio files and playlist entries will not be deleted. Playlist entries may appear missing until the album is imported again. An Undo action will remain available until dismissed.')) {
    hideAllContextMenus();
    return;
  }
  var removal = await removeLibraryFiles(album.tracks, 'Remove album from library');
  if (removal.failed) { hideAllContextMenus(); return; }
  window.currentContextMenuAlbum = null;
  selectedAlbumsForEdit.delete(album.id);
  hideAllContextMenus();
  if (!refreshSearchAfterLibraryMutation()) renderCurrentCollectionState();
  showUndoToast('Removed ' + count + ' track' + (count === 1 ? '' : 's') + ' from the library. Audio files and playlists were not deleted.', removal.snapshot);
});

var ctxRemoveMatch = $('ctx-remove-match');
if (ctxRemoveMatch) ctxRemoveMatch.addEventListener('click', async function () {
  if (currentContextMenuTrack) {
    var key = currentContextMenuTrack.title + '-' + currentContextMenuTrack.artist + '-' + (currentContextMenuTrack.album || '');
    state.mappings[key] = 'NO_MATCH';
    await persistMappings(state.mappings);
    if (currentContextMenuTrack.csvRecord) {
      delete currentContextMenuTrack.csvRecord.FilePath;
      delete currentContextMenuTrack.csvRecord.filePath;
      delete currentContextMenuTrack.csvRecord.Path;
      delete currentContextMenuTrack.csvRecord.path;
      await persistPlaylists(state.playlists);
    }
    showToast('Match removed for ' + (currentContextMenuTrack.title || 'track') + '.');
    if (state.currentView.startsWith('pl_')) renderPlaylistPreservingScroll(state.currentView);
  }
  hideAllContextMenus();
});

var ctxDownloadTrack = $('ctx-download-track');
if (ctxDownloadTrack) ctxDownloadTrack.addEventListener('click', function () {
  var pl = getCurrentRegularPlaylist();
  var rows = getDownloadablePlaylistTracksFromContext().map(function (track) { return track.csvRecord; });
  if (!rows.length && isRemotePlaybackTrack(currentContextMenuTrack)) rows = [makePlaylistTrackRecord(currentContextMenuTrack)];
  hideAllContextMenus();
  if (pl) showExistingPlaylistDownloadReview(pl, rows);
  else {
    var job = makeDownloadQueueJob('remote-track', 'Download: ' + (currentContextMenuTrack.title || 'Track'), rows, '');
    if (job) pushDownloadQueueJob(job, 'Queued remote track download.'); else showToast('Already in Library or already queued.');
  }
});

var ctxAddPlaylistDownload = $('ctx-add-playlist-download');
if (ctxAddPlaylistDownload) ctxAddPlaylistDownload.addEventListener('click', async function () {
  var track = currentContextMenuTrack;
  if (!isRemotePlaybackTrack(track)) return;
  var playlists = state.playlists.filter(function (pl) { return !pl.isSpecial; });
  if (!playlists.length) { showToast('Create a playlist first, then add and download this track.'); return; }
  var choices = playlists.map(function (pl, index) { return (index + 1) + '. ' + pl.name; }).join('\n');
  var answer = prompt('Add to which playlist?\n' + choices, '1');
  var index = Number(answer) - 1;
  if (!Number.isInteger(index) || !playlists[index]) return;
  var playlist = playlists[index];
  try { await addTracksToPlaylist(playlist, [track]); }
  catch (e) { showToast('Playlist could not be saved; download was not started.'); return; }
  var row = makePlaylistTrackRecord(track);
  var job = makeDownloadQueueJob('playlist-remote', 'Download: ' + (track.title || 'Track'), [row], playlist.id, { savePlaylists: true });
  hideAllContextMenus();
  if (job) pushDownloadQueueJob(job, 'Saved to "' + playlist.name + '" and queued download.');
  else showToast('Saved to "' + playlist.name + '". Already in Library or already queued.');
});

function getTracksFromTrackContextForPlaylistAdd() {
  var selected = currentContextMenuTrack && selectedTrackKeys.has(getTrackSelectionKey(currentContextMenuTrack)) ? getSelectedCurrentTracks() : [];
  if (selected.length) return selected;
  return currentContextMenuTrack ? [currentContextMenuTrack] : [];
}

function getTracksFromAlbumContextForPlaylistAdd() {
  if (!currentContextMenuAlbum || !currentContextMenuAlbum.tracks) return [];
  return getSortedAlbumTracks(currentContextMenuAlbum).map(function (f) {
    return { title: f.title, artist: f.artist, album: f.album, filePath: f.filePath, matchedFile: f };
  });
}

function getAddablePlaylistsForCurrentView() {
  return state.playlists.filter(function (pl) { return pl.id !== state.currentView && !pl.isSpecial; }).sort(function (a, b) {
    var at = a.lastAddedAt ? Date.parse(a.lastAddedAt) : 0;
    var bt = b.lastAddedAt ? Date.parse(b.lastAddedAt) : 0;
    return bt - at || (a.name || '').localeCompare(b.name || '');
  });
}

function getPlaylistFlyoutCover(pl) {
  if (!pl) return null;
  if (pl.cover) return pl.cover;
  for (var i = 0; i < (pl.tracks || []).length; i++) {
    var r = pl.tracks[i];
    var sn = r.Song || r.title || '', an = r.Artist || r.artist || '', al = r.Album || r.album || '';
    var m = findPlaylistRecordMatch(r);
    if (m && m.picture) return m.picture;
  }
  return null;
}

function makePlaylistFlyoutCoverHtml(pl) {
  var cover = getPlaylistFlyoutCover(pl);
  if (cover) return '<img class="playlist-flyout-cover" src="' + esc(cover) + '" alt="" />';
  var bg = getSafePlaylistColor(pl && pl.color, '#3a3a3a');
  return '<span class="playlist-flyout-cover placeholder" style="background:' + bg + ';"><i class="ph ph-music-notes"></i></span>';
}

function countPlaylistDuplicates(pl, tracksToAdd) {
  if (!pl || !pl.tracks || !tracksToAdd || !tracksToAdd.length) return 0;
  return tracksToAdd.filter(function (trackToAdd) {
    return pl.tracks.some(function (t) { return samePlaylistTrack(t, trackToAdd); });
  }).length;
}

function readDroppedTrack(dataTransfer) {
  if (!dataTransfer) return null;
  try {
    var raw = dataTransfer.getData('text/plain');
    if (!raw || raw.length > 20000) return null;
    var value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 2000) return null;
    for (var field of ['artist', 'album', 'filePath']) {
      if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].length > (field === 'filePath' ? 4096 : 2000))) return null;
    }
    return {
      title: value.title.trim(),
      artist: (value.artist || '').trim(),
      album: (value.album || '').trim(),
      filePath: value.filePath || '',
      sourcePlaylistId: getValidSourcePlaylistId(value.sourcePlaylistId)
    };
  } catch (error) {
    return null;
  }
}

function bindPlaylistTrackDropTarget(element, playlist) {
  if (!element || !playlist || playlist.isSpecial) return;
  element.addEventListener('dragover', function (event) {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('text/plain')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    element.classList.add('playlist-drop-target');
  });
  element.addEventListener('dragleave', function (event) {
    if (!element.contains(event.relatedTarget)) element.classList.remove('playlist-drop-target');
  });
  element.addEventListener('drop', async function (event) {
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove('playlist-drop-target');
    var track = readDroppedTrack(event.dataTransfer);
    if (!track) { showToast('Could not read the dropped track. Drag it from a Playerinyo track list.'); return; }
    try {
      var addedCount = await addTracksToPlaylist(playlist, [track]);
      if (addedCount) showToast('Added "' + track.title + '" to "' + playlist.name + '".');
      else showToast('"' + track.title + '" is already in "' + playlist.name + '".');
    } catch (error) {
      showToast('Could not add "' + track.title + '" to "' + playlist.name + '". The playlist was restored.');
    }
  });
}

async function addTracksToPlaylist(pl, tracksToAdd) {
  tracksToAdd = (tracksToAdd || []).filter(Boolean);
  if (!pl || pl.isSpecial || !state.playlists.includes(pl) || !tracksToAdd.length) return 0;
  if (!pl.tracks) pl.tracks = [];
  var addedCount = 0;
  var addedRecords = [];
  var previousLastAddedAt = pl.lastAddedAt;
  var addedAtMs = Date.now();
  tracksToAdd.forEach(function (trackToAdd) {
    var dup = pl.tracks.some(function (t) { return samePlaylistTrack(t, trackToAdd); });
    if (!dup) {
      var record = stampPlaylistTrackAddedAt(makePlaylistTrackRecord(trackToAdd), addedAtMs);
      pl.tracks.push(record);
      addedRecords.push(record);
      addedCount++;
    }
  });
  if (addedCount > 0) {
    var mutationLastAddedAt = new Date().toISOString();
    pl.lastAddedAt = mutationLastAddedAt;
    try { await persistPlaylists(state.playlists); }
    catch (error) {
      pl.tracks = pl.tracks.filter(function (record) { return !addedRecords.includes(record); });
      if (pl.lastAddedAt === mutationLastAddedAt) {
        if (previousLastAddedAt === undefined) delete pl.lastAddedAt;
        else pl.lastAddedAt = previousLastAddedAt;
      }
      renderSidebarPlaylists();
      if (state.currentView === pl.id) renderPlaylist(pl.id);
      throw error;
    }
    renderSidebarPlaylists();
    if (state.currentView === pl.id) renderPlaylist(pl.id);
  }
  return addedCount;
}

function getUniquePlaylistName(baseName) {
  var base = baseName || 'New Playlist';
  var existing = new Set(state.playlists.map(function (p) { return (p.name || '').toLowerCase(); }));
  if (!existing.has(base.toLowerCase())) return base;
  var idx = 2;
  while (existing.has((base + ' ' + idx).toLowerCase())) idx++;
  return base + ' ' + idx;
}

async function createPlaylistFromAddFlyout() {
  var tracksToAdd = (addToPlaylistTracks || []).filter(Boolean);
  if (!tracksToAdd.length) return;
  var name = getUniquePlaylistName('New Playlist');
  var pl = { id: 'pl_' + Date.now(), name: name, cover: null, color: PALETTE[state.playlists.length % PALETTE.length], tracks: [], pinned: false, lastPlayed: null };
  var opener = addToPlaylistReturnFocus;
  state.playlists.push(pl);
  var addedCount = 0;
  try {
    addedCount = await addTracksToPlaylist(pl, tracksToAdd);
    if (addedCount === 0) await persistPlaylists(state.playlists);
  } catch (error) {
    state.playlists = state.playlists.filter(function (playlist) { return playlist !== pl; });
    renderSidebarPlaylists();
    showToast('Could not create the playlist. No tracks were changed.');
    return;
  }
  hideAllContextMenus();
  restoreFocusWithFallback(opener);
  clearTrackSelection();
  showToast('Created "' + name + '" with ' + addedCount + ' track' + (addedCount === 1 ? '' : 's') + '.');
}

function renderAddToPlaylistFlyout(query) {
  var listEl = $('add-to-playlist-list');
  if (!listEl) return;
  var tracksToAdd = (addToPlaylistTracks || []).filter(Boolean);
  var q = (query || '').trim().toLowerCase();
  var playlists = getAddablePlaylistsForCurrentView().filter(function (pl) {
    return !q || (pl.name || '').toLowerCase().indexOf(q) !== -1;
  });
  listEl.innerHTML = '';
  if (!tracksToAdd.length) {
    listEl.innerHTML = '<div class="playlist-flyout-empty">No tracks selected.</div>';
    return;
  }
  if (!playlists.length) {
    listEl.innerHTML = '<div class="playlist-flyout-empty">' + (q ? 'No matching playlists.' : 'No playlists yet.') + '</div>';
    return;
  }
  playlists.forEach(function (pl) {
    var dupCount = countPlaylistDuplicates(pl, tracksToAdd);
    var allDup = dupCount === tracksToAdd.length;
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'playlist-flyout-row' + (allDup ? ' disabled' : '');
    row.disabled = allDup;
    var statusHtml = allDup ? '<i class="ph-fill ph-check-circle" title="Already added" style="margin-left:auto;color:var(--accent);"></i>' : (dupCount ? '<span class="playlist-flyout-meta">' + dupCount + ' added</span>' : '');
    row.innerHTML = makePlaylistFlyoutCoverHtml(pl) + '<span class="playlist-flyout-name" title="' + esc(pl.name) + '">' + esc(pl.name) + '</span>' + statusHtml;
    if (!allDup) {
      row.addEventListener('click', async function (e) {
        e.preventDefault();
        e.stopPropagation();
        var opener = addToPlaylistReturnFocus;
        var addedCount;
        try { addedCount = await addTracksToPlaylist(pl, addToPlaylistTracks); }
        catch (error) { showToast('Could not update "' + pl.name + '". The playlist was restored.'); return; }
        hideAllContextMenus();
        restoreFocusWithFallback(opener);
        clearTrackSelection();
        if (addedCount > 0) showToast('Added ' + addedCount + ' track' + (addedCount === 1 ? '' : 's') + ' to "' + pl.name + '".');
        else showToast('Already in "' + pl.name + '".');
      });
    }
    listEl.appendChild(row);
  });
}

function showAddToPlaylistFlyout(tracksToAdd, anchorEl, focusSearch) {
  var menu = $('add-to-playlist-menu');
  if (!menu) { showAddToPlaylistModal(tracksToAdd); return; }
  addToPlaylistTracks = (tracksToAdd || []).filter(Boolean);
  if (!addToPlaylistTracks.length) return;
  addToPlaylistFlyoutOpener = anchorEl || contextMenuOpener;
  addToPlaylistReturnFocus = isRestorableFocusTarget(contextMenuOpener) ? contextMenuOpener : addToPlaylistFlyoutOpener;
  if (addToPlaylistFlyoutOpener) addToPlaylistFlyoutOpener.setAttribute('aria-expanded', 'true');
  var search = $('add-to-playlist-search');
  if (search) search.value = '';
  renderAddToPlaylistFlyout('');
  positionSubmenu(menu, anchorEl);
  if (focusSearch && search) setTimeout(function () { search.focus(); }, 0);
}

function hideAddToPlaylistFlyout() {
  var menu = $('add-to-playlist-menu');
  if (menu) menu.classList.remove('visible');
  if (addToPlaylistFlyoutOpener) addToPlaylistFlyoutOpener.setAttribute('aria-expanded', 'false');
}

function bindAddToPlaylistFlyoutTrigger(el, getTracks) {
  if (!el) return;
  el.addEventListener('mouseenter', function () {
    var tracksToAdd = getTracks();
    if (tracksToAdd.length) showAddToPlaylistFlyout(tracksToAdd, el, false);
  });
  el.addEventListener('click', function (e) {
    e.preventDefault();
    e.stopPropagation();
    var tracksToAdd = getTracks();
    if (tracksToAdd.length) showAddToPlaylistFlyout(tracksToAdd, el, true);
  });
}

function bindAddToPlaylistFlyoutDismissers(menuId, triggerId) {
  var menu = $(menuId);
  if (!menu) return;
  menu.querySelectorAll('.menu-item').forEach(function (item) {
    if (item.id !== triggerId) item.addEventListener('mouseenter', hideAddToPlaylistFlyout);
  });
}

// FIX 10+11: Add to playlist - exclude current playlist, check duplicates
function showAddToPlaylistModal(tracksToAdd) {
  var listEl = $('playlist-selector-list'); listEl.innerHTML = '';
  if (listEl) listEl.scrollTop = 0;
  var subtitle = $('playlist-selector-subtitle');
  if (subtitle) subtitle.textContent = 'Add ' + tracksToAdd.length + ' track' + (tracksToAdd.length === 1 ? '' : 's') + ' to:';
  
  function getAutoCoverForPlaylist(pl) {
    if (pl.cover) return pl.cover;
    if (pl.isSpecial) return null;
    for (var i = 0; i < (pl.tracks || []).length; i++) {
      var r = pl.tracks[i];
      var sn = r.Song || r.title || '', an = r.Artist || r.artist || '', al = r.Album || r.album || '';
      var m = findPlaylistRecordMatch(r);
      if (m && m.picture) return m.picture;
    }
    return null;
  }

  var playlists = state.playlists.filter(function (pl) { return pl.id !== state.currentView && !pl.isSpecial; }).sort(function (a, b) {
    var at = a.lastAddedAt ? Date.parse(a.lastAddedAt) : 0;
    var bt = b.lastAddedAt ? Date.parse(b.lastAddedAt) : 0;
    return bt - at || (a.name || '').localeCompare(b.name || '');
  });
  if (playlists.length === 0) { listEl.innerHTML = '<p style="padding:8px;color:var(--text-subdued);font-size:13px;">No other playlists available.</p>'; showModal($('playlist-selector-modal')); return; }
  
  playlists.forEach(function (pl) {
    var isSingleTrack = tracksToAdd.length === 1;
    var isDup = false;
    if (isSingleTrack) {
      isDup = pl.tracks && pl.tracks.some(function (t) { return samePlaylistTrack(t, tracksToAdd[0]); });
    }
    
    var el = document.createElement('div'); el.style.cssText = 'padding:10px;cursor:pointer;border-radius:10px;font-size:13px;display:flex;align-items:center;gap:12px;';
    var autoCover = getAutoCoverForPlaylist(pl);
    var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
    var bgStyle = 'background:' + getSafePlaylistColor(pl.color, '#555555') + ';';
    var covHtml = autoCover ? '<img src="' + esc(autoCover) + '"' + lazy + ' style="width:34px;height:34px;border-radius:6px;object-fit:cover;flex-shrink:0;">' : '<div style="width:34px;height:34px;border-radius:6px;' + bgStyle + 'display:flex;align-items:center;justify-content:center;flex-shrink:0;"></div>';
    
    var dupCount = tracksToAdd.filter(function (trackToAdd) { return pl.tracks && pl.tracks.some(function (t) { return samePlaylistTrack(t, trackToAdd); }); }).length;
    var metaHtml = '<div style="font-size:11px;color:var(--text-subdued);margin-top:2px;">' + ((pl.tracks && pl.tracks.length) || 0) + ' tracks' + (dupCount ? ' • ' + dupCount + ' already added' : '') + '</div>';
    var checkHtml = isDup ? '<i class="ph-fill ph-check-circle" style="color:var(--accent);margin-left:auto;font-size:16px;"></i>' : (pl.lastAddedAt ? '<span style="margin-left:auto;font-size:10px;color:var(--accent);text-transform:uppercase;letter-spacing:.08em;">Recent</span>' : '');
    
    el.innerHTML = covHtml + '<span style="flex:1;min-width:0;"><span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:750;">' + esc(pl.name) + '</span>' + metaHtml + '</span>' + checkHtml;
    
    el.addEventListener('mouseenter', function () { el.style.background = 'rgba(255,255,255,.1)'; });
    el.addEventListener('mouseleave', function () { el.style.background = ''; });
    if (isSingleTrack && isDup) {
      el.style.opacity = '0.6';
      el.style.cursor = 'default';
    } else {
      el.addEventListener('click', async function () {
        var addedCount;
        try { addedCount = await addTracksToPlaylist(pl, tracksToAdd); }
        catch (error) { showToast('Could not update "' + pl.name + '". The playlist was restored.'); return; }
        if (!addedCount && !isSingleTrack) showToast('All selected tracks are already in "' + pl.name + '".');
        hideModal($('playlist-selector-modal'));
        clearTrackSelection();
      });
    }
    listEl.appendChild(el);
  });
  showModal($('playlist-selector-modal'));
  if (listEl) listEl.scrollTop = 0;
}

var ctxAdd = $('ctx-add-playlist');
bindAddToPlaylistFlyoutTrigger(ctxAdd, getTracksFromTrackContextForPlaylistAdd);

var actxAdd = $('actx-add-playlist');
bindAddToPlaylistFlyoutTrigger(actxAdd, getTracksFromAlbumContextForPlaylistAdd);

var addToPlaylistSearch = $('add-to-playlist-search');
if (addToPlaylistSearch) addToPlaylistSearch.addEventListener('input', function (e) { renderAddToPlaylistFlyout(e.target.value); });
var addToPlaylistMenu = $('add-to-playlist-menu');
if (addToPlaylistMenu) addToPlaylistMenu.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    hideAddToPlaylistFlyout();
    restoreFocusWithFallback(addToPlaylistReturnFocus);
  } else if (e.key === 'Tab') {
    var opener = addToPlaylistReturnFocus;
    setTimeout(function () {
      var focusStayedInFlyout = addToPlaylistMenu.contains(document.activeElement);
      hideAllContextMenus(false);
      if (focusStayedInFlyout) restoreFocusWithFallback(opener);
    }, 0);
  }
});
var addToPlaylistNew = $('add-to-playlist-new');
if (addToPlaylistNew) addToPlaylistNew.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); createPlaylistFromAddFlyout(); });
bindAddToPlaylistFlyoutDismissers('track-context-menu', 'ctx-add-playlist');
bindAddToPlaylistFlyoutDismissers('album-context-menu', 'actx-add-playlist');
var ctxRemove = $('ctx-remove-playlist');
if (ctxRemove) ctxRemove.addEventListener('click', async function () {
  if (!currentContextMenuTrack) return;
  var pl = state.playlists.find(function (p) { return p.id === state.currentView; });
  if (pl && currentContextMenuTrack.csvRecord && pl.tracks.includes(currentContextMenuTrack.csvRecord)) {
    var snapshot = pushUndoSnapshot('Remove track from playlist', ['playlists']);
    if (!snapshot) { showToast('Nothing was removed because an Undo snapshot could not be created.'); return; }
    var previousTracks = pl.tracks;
    var trackName = currentContextMenuTrack.title || 'Track';
    pl.tracks = pl.tracks.filter(function (t) { return t !== currentContextMenuTrack.csvRecord; });
    try {
      await persistPlaylists(state.playlists);
    } catch (e) {
      pl.tracks = previousTracks;
      discardUndoSnapshot(snapshot);
      renderPlaylist(state.currentView);
      showToast('Nothing was removed because the playlist could not be saved.');
      return;
    }
    renderPlaylist(state.currentView);
    showUndoToast('Removed "' + trackName + '" from "' + pl.name + '". The library entry and audio file were unchanged.', snapshot);
  }
  else alert('Open a playlist to remove tracks.');
});
var ctxMatch = $('ctx-manual-match');
if (ctxMatch) ctxMatch.addEventListener('click', async function () {
  var af = await window.api.openAudio();
  if (af && currentContextMenuTrack) {
    var selectedPath = stripFileUrl(af) || af;
    var libIndex = getLibraryIndex();
    var existingFile = libIndex.byPath.get(selectedPath) || libIndex.byStrippedPath.get(stripFileUrl(selectedPath));
    if (!existingFile && window.api.scanAudioFile) {
      var scanned = await window.api.scanAudioFile(selectedPath);
      if (scanned && scanned.filePath) {
        state.musicFiles.push(scanned);
        markLibraryDirty();
        await persistLibrary(state.musicFiles);
      } else {
        showToast('Could not add selected audio file to the library.');
        return;
      }
    }
    var key = currentContextMenuTrack.title + '-' + currentContextMenuTrack.artist + '-' + (currentContextMenuTrack.album || '');
    state.mappings[key] = selectedPath;
    if (currentContextMenuTrack.csvRecord) currentContextMenuTrack.csvRecord.FilePath = selectedPath;
    await persistMappings(state.mappings);
    if (currentContextMenuTrack.csvRecord) await persistPlaylists(state.playlists);
    showToast('Matched ' + (currentContextMenuTrack.title || 'track') + '.');
    renderPlaylistPreservingScroll(state.currentView);
  }
});
var closePls = $('btn-close-playlist-selector'); if (closePls) closePls.addEventListener('click', function () { hideModal($('playlist-selector-modal')); });
var plsModal = $('playlist-selector-modal'); if (plsModal) plsModal.addEventListener('click', function (e) { if (e.target === plsModal) hideModal(plsModal); });

var pctxAddSongs = $('pctx-add-songs');
if (pctxAddSongs) {
  pctxAddSongs.addEventListener('click', function () {
    var pl = currentContextMenuPlaylist; 
    if (!pl || pl.isSpecial) return; 
    $('add-songs-playlist-name').textContent = pl.name;
    var searchInput = $('add-songs-search');
    searchInput.value = '';
    
    function renderAddSongsResults(query) {
      var resultsContainer = $('add-songs-results');
      resultsContainer.innerHTML = '';
      if (!query) {
        resultsContainer.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-subdued);font-size:13px;">Type to search your library...</div>';
        return;
      }
      
      var searchTerms = query.toLowerCase().split(/\s+/);
      var matchedTracks = state.musicFiles.filter(function (f) {
        var trackStr = ((f.title || '') + ' ' + (f.artist || '') + ' ' + (f.album || '')).toLowerCase();
        return searchTerms.every(function(term) { return trackStr.includes(term); });
      }).slice(0, 50); // limit to 50 for performance
      
      if (matchedTracks.length === 0) {
        resultsContainer.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-subdued);font-size:13px;">No tracks found</div>';
        return;
      }
      
      matchedTracks.forEach(function(track) {
        var isAlreadyInPlaylist = pl.tracks && pl.tracks.some(function(t) {
           return samePlaylistTrack(t, track);
        });
        
        var div = document.createElement('div');
        div.style.cssText = 'display:flex;align-items:center;padding:8px 12px;background:rgba(255,255,255,0.02);border-radius:8px;gap:12px;';
        
        var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
        var cover = track.picture ? '<img src="' + esc(track.picture) + '"' + lazy + ' style="width:32px;height:32px;border-radius:4px;object-fit:cover;flex-shrink:0;">' : '<div style="width:32px;height:32px;border-radius:4px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ph ph-music-notes" style="font-size:12px;color:rgba(255,255,255,0.3);"></i></div>';
        
        var btnHtml = isAlreadyInPlaylist ? '<button class="icon-btn ghost" disabled title="Already in playlist" style="color:var(--accent);"><i class="ph ph-check"></i></button>' : '<button class="icon-btn add-track-btn" title="Add to playlist" style="background:var(--accent);color:var(--bg-base);width:28px;height:28px;"><i class="ph ph-plus"></i></button>';
        
        div.innerHTML = cover + 
          '<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(track.title) + '</div><div style="font-size:11px;color:var(--text-subdued);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(track.artist) + ' • ' + esc(track.album || 'Unknown Album') + '</div></div>' + 
          btnHtml;
        
        if (!isAlreadyInPlaylist) {
          div.querySelector('.add-track-btn').addEventListener('click', async function() {
            try { await addTracksToPlaylist(pl, [track]); }
            catch (error) { showToast('Could not update "' + pl.name + '". The playlist was restored.'); return; }
            renderAddSongsResults(searchInput.value);
          });
        }
        resultsContainer.appendChild(div);
      });
    }
    
    renderAddSongsResults('');
    
    var boundInputHandler = function(e) { renderAddSongsResults(e.target.value); };
    if (typeof debounce === 'function') {
      searchInput.oninput = debounce(boundInputHandler, 250);
    } else {
      searchInput.oninput = boundInputHandler;
    }
    
    showModal($('add-songs-modal'));
    setTimeout(function() { searchInput.focus(); }, 50);
  });
}

var pctxDownloadMissing = $('pctx-download-missing');
if (pctxDownloadMissing) pctxDownloadMissing.addEventListener('click', function () {
  var pl = currentContextMenuPlaylist;
  hideAllContextMenus();
  showExistingPlaylistDownloadReview(pl, getDownloadableMissingPlaylistRows(pl));
});

var btnCloseAddSongs = $('btn-close-add-songs');
if (btnCloseAddSongs) btnCloseAddSongs.addEventListener('click', function() { 
  hideModal($('add-songs-modal')); 
  if (currentContextMenuPlaylist && state.currentView === currentContextMenuPlaylist.id) {
    renderPlaylist(currentContextMenuPlaylist.id);
  }
});
var addSongsModal = $('add-songs-modal');
if (addSongsModal) addSongsModal.addEventListener('click', function (e) { 
  if (e.target === addSongsModal) {
    hideModal(addSongsModal);
    if (currentContextMenuPlaylist && state.currentView === currentContextMenuPlaylist.id) {
      renderPlaylist(currentContextMenuPlaylist.id);
    }
  }
});

var pctxRename = $('pctx-rename');
if (pctxRename) pctxRename.addEventListener('click', async function () {
  var pl = currentContextMenuPlaylist; if (!pl) return;
  var original = pl.name || 'Playlist';
  var nextName = prompt('Rename playlist', original);
  if (nextName === null) return;
  nextName = nextName.trim();
  if (!nextName || nextName === original) return;
  pl.name = nextName;
  try { await persistPlaylists(state.playlists); }
  catch (error) { pl.name = original; showToast('Could not rename the playlist. The original name was restored.'); }
  renderSidebarPlaylists();
  if (state.currentView === pl.id) renderPlaylist(pl.id);
  if (pl.name === nextName) showToast('Renamed playlist to "' + nextName + '".');
});
var pctxCover = $('pctx-cover');
if (pctxCover) pctxCover.addEventListener('click', async function () { var pl = currentContextMenuPlaylist; if (!pl) return; var img = await window.api.openImage(); if (img) { pl.cover = img; await persistPlaylists(state.playlists); renderSidebarPlaylists(); if (state.currentView === pl.id) renderPlaylist(pl.id); } });
var pctxColor = $('pctx-color');
if (pctxColor) pctxColor.addEventListener('click', function () {
  var pl = currentContextMenuPlaylist; if (!pl) return;
  var sw = $('color-picker-swatches'); sw.innerHTML = '';
  PALETTE.forEach(function (color) { var s = document.createElement('button'); s.type = 'button'; s.className = 'color-swatch' + (color === pl.color ? ' selected' : ''); s.setAttribute('aria-label', 'Use color ' + color); s.style.background = color; s.addEventListener('click', async function () { pl.color = color; await persistPlaylists(state.playlists); hideModal($('color-picker-modal')); renderSidebarPlaylists(); if (state.currentView === pl.id) renderPlaylist(pl.id); showToast('Updated playlist color.'); }); sw.appendChild(s); });
  showModal($('color-picker-modal'));
});
var closeColor = $('btn-close-color-picker'); if (closeColor) closeColor.addEventListener('click', function () { hideModal($('color-picker-modal')); });
var colorModal = $('color-picker-modal'); if (colorModal) colorModal.addEventListener('click', function (e) { if (e.target === colorModal) hideModal(colorModal); });
var pctxPin = $('pctx-pin');
if (pctxPin) pctxPin.addEventListener('click', async function () {
  var pl = currentContextMenuPlaylist; if (!pl) return;
  if (!pl.pinned && state.playlists.filter(function (p) { return p.pinned; }).length >= 6) { alert('Max 6 pinned playlists.'); return; }
  pl.pinned = !pl.pinned; await persistPlaylists(state.playlists); renderSidebarPlaylists(); showToast((pl.pinned ? 'Pinned ' : 'Unpinned ') + '"' + (pl.name || 'playlist') + '".');
});
var pctxDup = $('pctx-duplicate');
if (pctxDup) pctxDup.addEventListener('click', async function () {
  var pl = currentContextMenuPlaylist; if (!pl) return;
  var copyName = getUniquePlaylistName((pl.name || 'Playlist') + ' (Copy)');
  var copy = Object.assign({}, JSON.parse(JSON.stringify(pl)), { id: 'pl_' + Date.now(), name: copyName, pinned: false, lastPlayed: null });
  state.playlists.push(copy);
  await persistPlaylists(state.playlists);
  renderSidebarPlaylists();
  showToast('Duplicated playlist as "' + copyName + '".');
});
function getPlaylistExportSourceTracks(pl) {
  if (!pl) return [];
  if (state.currentView === pl.id) return (state.currentTracks || []).slice();
  var tracks = (pl.tracks || []).slice();
  if (pl.id === 'liked_songs') {
    var likedDirection = appSettings.likedSongsSortAscending === true ? 'asc' : 'desc';
    var likedMultiplier = likedDirection === 'asc' ? 1 : -1;
    var likedSort = appSettings.likedSongsSortBy || 'Recently Added';
    if (likedSort === 'Title') tracks.sort(function (a, b) { return (a.title || '').localeCompare(b.title || '') * likedMultiplier; });
    else if (likedSort === 'Artist') tracks.sort(function (a, b) { return (a.artist || '').localeCompare(b.artist || '') * likedMultiplier; });
    else if (likedSort === 'Album') tracks.sort(function (a, b) { return (a.album || '').localeCompare(b.album || '') * likedMultiplier; });
    else tracks = sortRecentlyAddedEntries(tracks, function (file) { return Number(file.addedAtMs) || 0; }, likedDirection);
    return tracks;
  }
  if (pl.isSpecial) return tracks;
  var direction = pl.sortDirection === 'desc' ? -1 : 1;
  if (pl.sortBy === 'Title') tracks.sort(function (a, b) { return (a.Song || a.title || '').localeCompare(b.Song || b.title || '') * direction; });
  else if (pl.sortBy === 'Artist') tracks.sort(function (a, b) { return (a.Artist || a.artist || '').localeCompare(b.Artist || b.artist || '') * direction; });
  else if (pl.sortBy === 'Album') tracks.sort(function (a, b) { return (a.Album || a.album || '').localeCompare(b.Album || b.album || '') * direction; });
  else if (pl.sortBy === 'Recently Added') tracks = sortRecentlyAddedEntries(tracks, getPlaylistTrackAddedAtMs, pl.sortDirection === 'asc' ? 'asc' : 'desc');
  return tracks;
}
function makePlaylistExportRecord(track) {
  var record = track && track.csvRecord ? track.csvRecord : (track || {});
  var matched = track && track.matchedFile ? track.matchedFile : (record.filePath && record.title ? record : findPlaylistRecordMatch(record));
  var genre = record.Genres || record.Genre || record.genre || (matched && matched.genre) || '';
  if (Array.isArray(genre)) genre = genre.join('; ');
  return {
    Song: getImportTrackTitle(record) || (matched && matched.title) || '',
    Artist: getImportTrackArtist(record) || (matched && matched.artist) || '',
    Album: getImportTrackAlbum(record) || (matched && matched.album) || '',
    Duration: record.Duration || record.duration || (matched && matched.duration) || 0,
    Genre: String(genre || ''),
    FilePath: getPlaylistTrackFilePath(record) || (matched && matched.filePath) || '',
  };
}
function buildPlaylistExportSnapshot(pl) {
  return { name: pl.name || 'Playlist', tracks: getPlaylistExportSourceTracks(pl).map(makePlaylistExportRecord) };
}
async function exportContextPlaylist(format) {
  var pl = currentContextMenuPlaylist; if (!pl) return;
  try {
    var result = await window.api.exportPlaylist(format, buildPlaylistExportSnapshot(pl));
    if (!result || result.canceled) return;
    if (!result.ok) throw new Error(result.error || 'Export failed');
    var skipped = result.skipped ? ' ' + result.skipped + ' row(s) without file paths were skipped.' : '';
    showToast('Exported "' + (pl.name || 'playlist') + '" as ' + format.toUpperCase() + '.' + skipped);
  } catch (e) {
    showToast(format.toUpperCase() + ' export failed: ' + ((e && e.message) || String(e || 'unknown error')));
  }
}
[['pctx-export-csv', 'csv'], ['pctx-export-m3u', 'm3u'], ['pctx-export-m3u8', 'm3u8']].forEach(function (entry) {
  var button = $(entry[0]); if (button) button.addEventListener('click', function () { exportContextPlaylist(entry[1]); });
});

var pctxSyncAlbums = $('pctx-sync-albums');
if (pctxSyncAlbums) pctxSyncAlbums.addEventListener('click', async function () { 
  var pl = currentContextMenuPlaylist; if (!pl || !pl.tracks) return; 
  var updated = 0;
  for (var i = 0; i < pl.tracks.length; i++) {
    var r = pl.tracks[i];
    var sn = r.Song || r.title || '', an = r.Artist || r.artist || '', al = r.Album || r.album || '';
    var m = findPlaylistRecordMatch(r);
    if (m && m.album && r.Album !== m.album) {
      r.Album = m.album;
      updated++;
    }
  }
  if (updated > 0) {
    await persistPlaylists(state.playlists);
    if (state.currentView === pl.id) renderPlaylist(pl.id);
    showToast('Updated album names for ' + updated + ' track' + (updated === 1 ? '' : 's') + '.');
  } else {
    showToast('Playlist albums are already in sync.');
  }
});

var pctxMatchFolder = $('pctx-match-folder');
if (pctxMatchFolder) pctxMatchFolder.addEventListener('click', async function () {
  var pl = currentContextMenuPlaylist; if (!pl || !pl.tracks) return;
  hideAllContextMenus();
  var scanGeneration = beginLibraryScan();
  if (!scanGeneration) return;
  document.body.style.cursor = 'wait';
  var updated = 0;
  var matchSnapshot = null;
  try {
    var folderPath = await window.api.openFolder();
    if (!folderPath || !libraryScanIsCurrent(scanGeneration)) return;
    var tempFiles = await window.api.scanFolder(folderPath, []);
    if (!libraryScanIsCurrent(scanGeneration)) return;
    var usedPaths = new Set();
    var existingPaths = new Set(state.musicFiles.map(function (file) { return file && file.filePath; }).filter(Boolean));
    var libraryChanged = false;
    matchSnapshot = pushUndoSnapshot('Match playlist from folder', ['library', 'playlists', 'mappings']);
    for (var i = 0; i < pl.tracks.length; i++) {
      var r = pl.tracks[i];
      var sn = r.Song || r.title || '', an = r.Artist || r.artist || '';
      for (var j = 0; j < tempFiles.length; j++) {
        var f = tempFiles[j];
        if (!f || !f.filePath || usedPaths.has(f.filePath)) continue;
        var fileName = f.filename ? f.filename.replace(/\.[^.]+$/, '') : '';
        if ((fuzzyMatch(f.title, sn) && (!an || fuzzyMatch(f.artist, an))) || fuzzyMatch(fileName, sn)) {
          var key = sn + '-' + an + '-' + (r.Album || r.album || f.album || '');
          state.mappings[key] = f.filePath;
          r.FilePath = f.filePath;
          if (f.album) r.Album = f.album;
          usedPaths.add(f.filePath);
          if (!existingPaths.has(f.filePath)) {
            state.musicFiles.push(f);
            existingPaths.add(f.filePath);
            libraryChanged = true;
          }
          updated++;
          break;
        }
      }
    }
    if (updated > 0) {
      if (libraryChanged) markLibraryDirty();
      await Promise.all([persistLibrary(state.musicFiles), persistPlaylists(state.playlists), persistMappings(state.mappings)]);
      renderSidebarPlaylists();
      if (state.currentView === pl.id) renderPlaylist(pl.id);
      showToast('Matched ' + updated + ' track' + (updated === 1 ? '' : 's') + ' from folder.');
    } else {
      discardUndoSnapshot(matchSnapshot);
      showToast('No matching tracks found in selected folder.');
    }
  } catch(e) {
    if (!updated) discardUndoSnapshot(matchSnapshot);
    if (libraryScanIsCurrent(scanGeneration)) { console.error(e); showToast('Folder match failed: ' + ((e && e.message) || String(e || 'unknown error'))); }
  } finally {
    finishLibraryScan();
    document.body.style.cursor = 'default';
  }
});
var pctxDelete = $('pctx-delete');
if (pctxDelete) pctxDelete.addEventListener('click', function () {
  smartPlaylistToDelete = null;
  playlistToDelete = currentContextMenuPlaylist;
  var title = $('delete-confirm-title'); if (title) title.textContent = 'Delete Playlist';
  var confirmButton = $('delete-confirm-btn'); if (confirmButton) { confirmButton.textContent = 'Delete Playlist'; confirmButton.disabled = false; }
  if (delCancel) delCancel.disabled = false;
  var copy = $('delete-confirm-copy');
  if (copy && playlistToDelete) copy.textContent = 'Delete "' + (playlistToDelete.name || 'Playlist') + '" and its ' + ((playlistToDelete.tracks && playlistToDelete.tracks.length) || 0) + ' playlist entr' + (((playlistToDelete.tracks && playlistToDelete.tracks.length) || 0) === 1 ? 'y' : 'ies') + '? Library tracks and audio files stay untouched, and you can undo this action during the current session.';
  showModal($('delete-confirm-modal'));
});
var delCancel = $('delete-cancel-btn'); if (delCancel) delCancel.addEventListener('click', function () { playlistToDelete = null; smartPlaylistToDelete = null; hideModal($('delete-confirm-modal')); });
var delConfirm = $('delete-confirm-btn');
if (delConfirm) delConfirm.addEventListener('click', async function () {
  if (smartPlaylistToDelete) {
    var deletedSmartPlaylist = smartPlaylistToDelete;
    delConfirm.disabled = true;
    if (delCancel) delCancel.disabled = true;
    var remainingSmartPlaylists = (appSettings.customSmartPlaylists || []).filter(function (playlist) { return playlist.id !== deletedSmartPlaylist.id; });
    try {
      await saveCustomSmartPlaylists(remainingSmartPlaylists);
    } catch (e) {
      delConfirm.disabled = false;
      if (delCancel) delCancel.disabled = false;
      showToast('Nothing was deleted because the Smart Mix could not be saved.');
      return;
    }
    if (state.sourcePlaylistId === deletedSmartPlaylist.id) {
      state.sourcePlaylistId = null;
      syncSavedQueuePaths();
      saveSettingsDebounced(200);
    }
    smartPlaylistToDelete = null;
    delConfirm.disabled = false;
    if (delCancel) delCancel.disabled = false;
    hideModal($('delete-confirm-modal'));
    switchView('playlists');
    showToast('Deleted Smart Mix "' + (deletedSmartPlaylist.name || 'Random Discovery') + '". Library tracks and audio files were not deleted.');
    return;
  }
  if (!playlistToDelete) return;
  var deletedPlaylist = playlistToDelete;
  var snapshot = pushUndoSnapshot('Delete playlist', ['playlists']);
  if (!snapshot) { showToast('Nothing was deleted because an Undo snapshot could not be created.'); return; }
  var previousPlaylists = state.playlists;
  state.playlists = state.playlists.filter(function (p) { return p.id !== playlistToDelete.id; });
  var previousSourcePlaylistId = state.sourcePlaylistId;
  if (state.sourcePlaylistId === playlistToDelete.id) state.sourcePlaylistId = null;
  try {
    await persistPlaylists(state.playlists);
  } catch (e) {
    state.playlists = previousPlaylists;
    state.sourcePlaylistId = previousSourcePlaylistId;
    discardUndoSnapshot(snapshot);
    renderSidebarPlaylists();
    showToast('Nothing was deleted because the playlist could not be saved.');
    return;
  }
  if (previousSourcePlaylistId && !state.sourcePlaylistId) { syncSavedQueuePaths(); saveSettingsDebounced(200); }
  hideModal($('delete-confirm-modal'));
  renderSidebarPlaylists(); if (state.currentView === playlistToDelete.id) switchView('library'); playlistToDelete = null;
  showUndoToast('Deleted playlist "' + (deletedPlaylist.name || 'Playlist') + '". Audio files and library tracks were not deleted.', snapshot);
});
var delModal = $('delete-confirm-modal'); if (delModal) delModal.addEventListener('click', function (e) { if (e.target === delModal && delCancel) delCancel.click(); });
var importReviewModal = $('import-review-modal');
if (importReviewModal) importReviewModal.addEventListener('click', function (e) { if (e.target === importReviewModal) hideModal(importReviewModal); });
var importReviewDone = $('import-review-done');
if (importReviewDone) importReviewDone.addEventListener('click', function () { hideModal($('import-review-modal')); });
var importReviewTagHealth = $('import-review-tag-health');
if (importReviewTagHealth) importReviewTagHealth.addEventListener('click', function () { hideModal($('import-review-modal')); switchView('metadata_health'); });
var importReviewAnalyzeRg = $('import-review-analyze-rg');
if (importReviewAnalyzeRg) importReviewAnalyzeRg.addEventListener('click', function () {
  hideModal($('import-review-modal'));
  switchView('metadata_health');
  var root = $('metadata-health-container');
  if (root) root.dataset.filter = 'missing_replaygain';
  renderMetadataHealthView();
});

var btnPlay = $('btn-play'); if (btnPlay) btnPlay.addEventListener('click', togglePlay);
var btnShuffle = $('btn-shuffle'); if (btnShuffle) btnShuffle.addEventListener('click', toggleShuffle);
var btnLoop = $('btn-loop'); if (btnLoop) btnLoop.addEventListener('click', cycleLoop);
var btnNext = $('btn-next'); if (btnNext) btnNext.addEventListener('click', function () { initAudioCtx(); playNextTrack(); });
var btnPrev = $('btn-prev'); if (btnPrev) btnPrev.addEventListener('click', function () { initAudioCtx(); playPrevTrack(); });

/* ─── METADATA EDITOR LOGIC ─── */
let metaTargetFiles = [];
let metaOriginalOrder = [];
let metaCoverPath = null;
let metaProposedData = null;
let metaOriginView = '';
let metaEditorScope = 'track';
let metaEditorSessionSeq = 0;
let metaSearchRequestSeq = 0;
let metaDetailRequestSeq = 0;
let metaManualInitialValues = {};
let metaSaveInProgress = false;

function setAutoTagStep(step, focus) {
  var steps = { release: $('at-step-release'), fields: $('at-step-fields'), review: $('at-step-review') };
  Object.keys(steps).forEach(function (key) { if (steps[key]) steps[key].open = key === step; });
  var continueButton = $('at-fields-continue');
  if (continueButton) continueButton.disabled = !metaProposedData;
  var autoTabActive = $('meta-tab-auto') && $('meta-tab-auto').classList.contains('active');
  var saveButton = $('meta-save-btn');
  if (saveButton && !metaSaveInProgress) saveButton.disabled = !!autoTabActive && step !== 'review';
  if (focus && steps[step]) {
    var summary = steps[step].querySelector('summary');
    requestAnimationFrame(function () { if (summary) summary.focus(); });
  }
}
['release', 'fields', 'review'].forEach(function (step) {
  var details = $('at-step-' + step);
  if (!details) return;
  details.addEventListener('toggle', function () {
    if (!details.open || !$('meta-tab-auto').classList.contains('active')) return;
    ['release', 'fields', 'review'].forEach(function (otherStep) { var other = $('at-step-' + otherStep); if (other && other !== details) other.open = false; });
    var saveButton = $('meta-save-btn');
    if (saveButton && !metaSaveInProgress) saveButton.disabled = step !== 'review' || !metaProposedData;
  });
});

function stripFileUrl(url) { return fromFileUrl(url); }

function unloadAudioForMetadataSave(filePaths) {
  var targets = new Set((filePaths || []).map(function (fp) { return stripFileUrl(fp || ''); }).filter(Boolean));
  if (!targets.size || !window.audioEls) return null;
  var snapshots = [];
  var wasPlaying = state.isPlaying;
  window.audioEls.forEach(function (audioEl, idx) {
    var srcPath = stripFileUrl(audioEl.currentSrc || audioEl.src || '');
    if (!srcPath || !targets.has(srcPath)) return;
    snapshots.push({ audioEl: audioEl, idx: idx, src: audioEl.src, currentTime: audioEl.currentTime || 0, paused: audioEl.paused });
  });
  if (!snapshots.length) return null;
  var activeAffected = snapshots.some(function (item) { return item.idx === activeAudioIdx; });
  playbackGeneration++;
  invalidateRestoredPlaybackPreparation();
  playbackTransitionPending = false;
  pendingPlaybackTrack = null;
  cancelCrossfadeTransition(true);
  var restoreGeneration = playbackGeneration;
  var restoreActiveIndex = activeAudioIdx;
  var activeSnapshot = snapshots.find(function (item) { return item.idx === activeAudioIdx; });
  if (activeAffected && activeSnapshot) checkpointPlaybackSession(activeSnapshot.audioEl, false);
  if (activeAffected) {
    // The pause event below is intentionally ignored while metadata playback
    // is being reconstructed. Record the elapsed listening time explicitly so
    // the edit itself cannot count toward a scrobble.
    pauseLastfmScrobbleCycle(false);
    state.isPlaying = false;
    syncPlaybackStateUi();
  }
  snapshots.forEach(function (item) {
    item.audioEl.pause();
    item.audioEl.removeAttribute('src');
    item.audioEl.load();
  });
  return function restoreMetadataPlayback() {
    if (playbackGeneration !== restoreGeneration || activeAudioIdx !== restoreActiveIndex) return;
    snapshots.forEach(function (item) {
      item.audioEl.src = item.src;
      try { item.audioEl.currentTime = item.currentTime; } catch (e) { }
    });
    if (wasPlaying && activeAffected && activeSnapshot) {
      var generation = ++playbackGeneration;
      playbackTransitionPending = true;
      activeSnapshot.audioEl.play().then(function () {
        if (generation !== playbackGeneration) return;
        playbackTransitionPending = false;
        state.isPlaying = true;
        checkpointPlaybackSession(activeSnapshot.audioEl, 200);
        syncPlaybackStateUi();
        if (state.currentPlayingTrack) triggerLastfmScrobbleCycle(state.currentPlayingTrack);
      }).catch(function (e) {
        if (generation !== playbackGeneration) return;
        console.error(e);
        playbackTransitionPending = false;
        state.isPlaying = false;
        activeSnapshot.audioEl.pause();
        checkpointPlaybackSession(activeSnapshot.audioEl, 200);
        syncPlaybackStateUi();
      });
    } else if (activeAffected) {
      state.isPlaying = false;
      syncPlaybackStateUi();
    }
  };
}

var ctxEditMeta = $('ctx-edit-metadata');
if (ctxEditMeta) ctxEditMeta.addEventListener('click', async function () {
  if (!currentContextMenuTrack || !currentContextMenuTrack.matchedFile) return;
  openMetadataEditor([currentContextMenuTrack.matchedFile]);
});

var albumEditMeta = $('album-edit-metadata-btn');
if (albumEditMeta) albumEditMeta.addEventListener('click', async function () {
  var aid = decodeURIComponent(state.currentView.replace('album:', ''));
  var aTracks = state.musicFiles.filter(function (f) {
    var k = getAlbumKey(f);
    return k === aid;
  });
  if (aTracks.length > 0) openMetadataEditor(aTracks, { scope: 'album' });
});

// Show the album edit button when rendering album detail
// Already done in index.html (display:none) and we can show it in renderAlbumDetail
// Let's hook the tab switches
$('meta-tab-manual').addEventListener('click', function () {
  $('meta-tab-manual').setAttribute('aria-selected', 'true'); $('meta-tab-auto').setAttribute('aria-selected', 'false');
  $('meta-tab-manual').classList.add('active'); $('meta-tab-manual').style.borderBottomColor = 'var(--accent)'; $('meta-tab-manual').style.color = 'var(--accent)';
  $('meta-tab-auto').classList.remove('active'); $('meta-tab-auto').style.borderBottomColor = 'transparent'; $('meta-tab-auto').style.color = 'var(--text-subdued)';
  $('meta-panel-manual').style.display = 'flex'; $('meta-panel-auto').style.display = 'none';
  if (!metaSaveInProgress) $('meta-save-btn').disabled = false;
});
$('meta-tab-auto').addEventListener('click', function () {
  $('meta-tab-auto').setAttribute('aria-selected', 'true'); $('meta-tab-manual').setAttribute('aria-selected', 'false');
  $('meta-tab-auto').classList.add('active'); $('meta-tab-auto').style.borderBottomColor = 'var(--accent)'; $('meta-tab-auto').style.color = 'var(--accent)';
  $('meta-tab-manual').classList.remove('active'); $('meta-tab-manual').style.borderBottomColor = 'transparent'; $('meta-tab-manual').style.color = 'var(--text-subdued)';
  $('meta-panel-auto').style.display = 'flex'; $('meta-panel-manual').style.display = 'none';
  var q = getMetaAutoTagQuery();
  $('meta-search-query').value = q;
  renderMetaTrackOrderList();
  setAutoTagStep(metaProposedData ? 'fields' : 'release');
});

var metaCoverDrop = $('meta-cover-drop');
if (metaCoverDrop) {
  metaCoverDrop.addEventListener('click', async function () {
    var sessionId = metaEditorSessionSeq;
    var img = await window.api.openImage();
    if (sessionId !== metaEditorSessionSeq) return;
    if (img) { metaCoverPath = img; $('meta-cover-preview').src = img; $('meta-cover-preview').style.display = 'block'; }
  });
  metaCoverDrop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); metaCoverDrop.click(); } });
  // Paste removed — was causing bugs when pasting non-image clipboard content
}

var metaSearchCoverBtn = $('meta-search-cover-btn');
if (metaSearchCoverBtn) metaSearchCoverBtn.addEventListener('click', function () {
  var artist = $('meta-artist').value || '';
  var album = $('meta-album').value || '';
  var q = encodeURIComponent(artist + ' ' + album);
  window.api.openExternal('https://covers.musichoarders.xyz/?q=' + q);
});

function getMetaAutoTagQuery() {
  var first = metaTargetFiles && metaTargetFiles[0];
  if (!first) return '';
  var artist = String(first.artist || first.albumArtist || '').trim();
  var subject = metaEditorScope === 'album' || metaTargetFiles.length > 1 ? first.album : first.title;
  return [artist, String(subject || '').trim()].filter(Boolean).join(' ');
}

async function openMetadataEditor(files, options) {
  if (!files.length) return;
  if (metaSaveInProgress) { showToast('Wait for the current metadata save to finish.'); return; }
  var sessionId = ++metaEditorSessionSeq;
  metaSearchRequestSeq++;
  metaDetailRequestSeq++;
  metaTargetFiles = getSortedAlbumTracks({ tracks: files });
  metaOriginalOrder = metaTargetFiles.slice();
  files = metaTargetFiles;
  metaEditorScope = options && options.scope === 'album' ? 'album' : 'track';
  metaCoverPath = null;
  metaProposedData = null;
  updateAutoTagMissingDownloadButton();
  atTrackOrderMenuOpen = false;
  metaOriginView = state.currentView || '';

  // Reset auto-tag panel
  var sr = $('meta-search-results'); if (sr) { sr.innerHTML = ''; }
  var tbl = $('at-track-table'); if (tbl) { tbl.innerHTML = '<div id="at-track-empty" style="padding:40px;text-align:center;color:rgba(255,255,255,0.2);font-size:13px;">Select a result to see track matching</div>'; }
  var cnt = $('at-track-count'); if (cnt) cnt.textContent = '';
  var searchBtn = $('meta-search-btn'); if (searchBtn) searchBtn.innerHTML = '<i class="ph ph-magnifying-glass"></i> Search Metadata';
  ['at-val-artist','at-val-album-artist','at-val-album','at-val-year','at-val-genre'].forEach(function(id) { var el = $(id); if (el) el.textContent = ''; });
  var atCoverPreview = $('at-cover-preview'); if (atCoverPreview) { atCoverPreview.style.display = 'none'; atCoverPreview.removeAttribute('src'); }
  var atCoverWrapIcon = $('at-cover-wrap') ? $('at-cover-wrap').querySelector('i') : null;
  if (atCoverWrapIcon) atCoverWrapIcon.style.display = '';
  setAutoTagStep('release');

  var meta = await window.api.getMetadata(files[0].filePath);
  if (sessionId !== metaEditorSessionSeq) return;
  function commonValue(field) {
    var values = files.map(function (file) { return String(file && file[field] != null && file[field] !== 0 ? file[field] : ''); });
    var first = values[0] || '';
    return { value: first, mixed: values.some(function (value) { return value !== first; }) };
  }
  function setManualField(id, field, singleValue) {
    var input = $(id);
    if (!input) return;
    var result = files.length === 1 ? { value: singleValue == null || singleValue === 0 ? '' : String(singleValue), mixed: false } : commonValue(field);
    input.value = result.mixed ? '' : result.value;
    input.placeholder = result.mixed ? 'Mixed' : '';
    input.dataset.mixed = result.mixed ? 'true' : 'false';
    metaManualInitialValues[id] = input.value;
  }
  metaManualInitialValues = {};
  setManualField('meta-title', 'title', files[0].title || '');
  setManualField('meta-artist', 'artist', files[0].artist || '');
  setManualField('meta-album-artist', 'albumArtist', (meta && meta.albumartist) || files[0].albumArtist || '');
  setManualField('meta-album', 'album', files[0].album || '');
  setManualField('meta-year', 'year', (meta && meta.year) || files[0].year || '');
  setManualField('meta-genre', 'genre', (meta && meta.genre) || files[0].genre || '');
  setManualField('meta-track-no', 'trackNo', (meta && meta.trackNo) || files[0].trackNo || '');
  setManualField('meta-track-total', 'trackTotal', (meta && meta.trackTotal) || files[0].trackTotal || '');
  setManualField('meta-disc-no', 'discNo', (meta && meta.discNo) || files[0].discNo || '');
  setManualField('meta-disc-total', 'discTotal', (meta && meta.discTotal) || files[0].discTotal || '');
  var saveTrackOrder = $('meta-save-track-order'); if (saveTrackOrder) saveTrackOrder.checked = false;
  var autoSaveTrackOrder = $('at-save-track-order'); if (autoSaveTrackOrder) autoSaveTrackOrder.checked = false;
  if (files[0].picture) $('meta-cover-preview').src = files[0].picture; else $('meta-cover-preview').removeAttribute('src');
  $('meta-cover-preview').style.display = files[0].picture ? 'block' : 'none';

  // Pre-fill search query for auto-tag tab
  var q = getMetaAutoTagQuery();
  var sq = $('meta-search-query'); if (sq) sq.value = q;
  renderMetaTrackOrderList();

  $('meta-tab-manual').click();
  $('meta-modal-title').textContent = metaEditorScope === 'album' || files.length > 1 ? 'Edit Album Metadata (' + files.length + ' tracks)' : 'Edit Track Metadata';
  showModal($('metadata-modal'));
}

function renderMetaTrackOrderList() {
  renderMetaTrackOrderListInto('meta-track-order-wrap', 'meta-track-order-list', false);
  renderMetaTrackOrderListInto('at-track-order-wrap', 'at-track-order-list', true);
  updateAtOrderToggle();
}

function updateAtOrderToggle() {
  var btn = $('at-order-toggle');
  if (!btn) return;
  var count = metaTargetFiles ? metaTargetFiles.length : 0;
  btn.style.display = count > 1 ? 'inline-flex' : 'none';
  btn.classList.toggle('active', atTrackOrderMenuOpen);
  btn.innerHTML = '<i class="ph ph-list-numbers"></i> Track Order' + (count > 1 ? ' (' + count + ')' : '');
}

function refreshMetaOrderUi() {
  renderMetaTrackOrderList();
  if ($('meta-tab-auto') && $('meta-tab-auto').classList.contains('active') && metaProposedData && metaProposedData.raw) showMetaCompare(metaProposedData.raw);
}

function sortMetaOrderByFilename() {
  metaTargetFiles.sort(function (a, b) { return (a.filename || a.filePath || a.title || '').localeCompare(b.filename || b.filePath || b.title || ''); });
  refreshMetaOrderUi();
}

function sortMetaOrderByTrackNo() {
  metaTargetFiles.sort(function (a, b) { return ((a.discNo || 0) - (b.discNo || 0)) || ((a.trackNo || 0) - (b.trackNo || 0)) || (a.title || '').localeCompare(b.title || ''); });
  refreshMetaOrderUi();
}

function resetMetaOrder() {
  metaTargetFiles = metaOriginalOrder.slice();
  refreshMetaOrderUi();
}

function autoMatchMetaOrderBySourceTitles() {
  if (!metaProposedData || !Array.isArray(metaProposedData.tracks) || !metaProposedData.tracks.length) {
    alert('Select a metadata result first.');
    return;
  }
  var remaining = metaTargetFiles.slice();
  var ordered = [];
  var weakMatches = 0;
  metaProposedData.tracks.forEach(function (sourceTrack) {
    var bestIdx = -1;
    var bestScore = 0;
    remaining.forEach(function (file, idx) {
      var score = titleMatchScore(file.title || file.filename, sourceTrack.title);
      if (score > bestScore) { bestScore = score; bestIdx = idx; }
    });
    if (bestIdx >= 0 && bestScore >= 0.45) {
      ordered.push(remaining.splice(bestIdx, 1)[0]);
      if (bestScore < 0.72) weakMatches++;
    }
  });
  metaTargetFiles = ordered.concat(remaining);
  refreshMetaOrderUi();
  if (weakMatches || remaining.length) {
    alert('Matched by title with ' + weakMatches + ' weak match(es) and ' + remaining.length + ' unmatched local track(s). Review warning rows before saving.');
  }
}

function renderMetaTrackOrderListInto(wrapId, listId, compact) {
  var wrap = $(wrapId);
  var list = $(listId);
  if (!wrap || !list) return;
  list.setAttribute('role', 'list');
  if (!metaTargetFiles || metaTargetFiles.length <= 1) {
    wrap.style.display = 'none';
    list.innerHTML = '';
    return;
  }
  wrap.style.display = compact ? (atTrackOrderMenuOpen ? 'block' : 'none') : 'block';
  list.innerHTML = '';
  metaTargetFiles.forEach(function (file, index) {
    var item = document.createElement('div');
    item.className = 'meta-track-order-item';
    item.draggable = true;
    item.tabIndex = 0;
    item.dataset.index = index;
    item.setAttribute('role', 'listitem');
    item.setAttribute('aria-label', (file.title || file.filename || 'Unknown Track') + ', position ' + (index + 1) + ' of ' + metaTargetFiles.length + '. Use Alt plus Up or Down to reorder.');
    item.style.cssText = 'display:grid;grid-template-columns:24px 1fr auto;gap:7px;align-items:center;padding:' + (compact ? '7px 9px' : '8px 10px') + ';margin:' + (compact ? '0' : '4px 0') + ';border-radius:10px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.055);cursor:grab;min-width:0;';
    item.innerHTML = '<i class="ph ph-dots-six-vertical" style="color:var(--text-subdued);"></i><div style="min-width:0;"><div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(file.title || file.filename || 'Unknown Track') + '</div><div style="font-size:11px;color:var(--text-subdued);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(file.artist || '') + '</div></div><span style="font-size:11px;color:var(--accent);font-weight:800;">#' + (index + 1) + '</span>';
    item.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', String(index));
      item.style.opacity = '.55';
    });
    item.addEventListener('dragend', function () { item.style.opacity = ''; });
    item.addEventListener('keydown', function (e) {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      var from = parseInt(item.dataset.index, 10);
      var to = from + (e.key === 'ArrowUp' ? -1 : 1);
      if (to < 0 || to >= metaTargetFiles.length) return;
      var moved = metaTargetFiles.splice(from, 1)[0];
      metaTargetFiles.splice(to, 0, moved);
      refreshMetaOrderUi();
      requestAnimationFrame(function () {
        var currentList = $(listId);
        var movedItem = currentList && currentList.querySelector('[data-index="' + to + '"]');
        if (movedItem) movedItem.focus();
      });
    });
    item.addEventListener('dragover', function (e) { e.preventDefault(); item.style.borderColor = 'rgba(var(--accent-rgb),.45)'; });
    item.addEventListener('dragleave', function () { item.style.borderColor = 'rgba(255,255,255,.055)'; });
    item.addEventListener('drop', function (e) {
      e.preventDefault();
      var from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      var to = parseInt(item.dataset.index, 10);
      if (isNaN(from) || isNaN(to) || from === to) return;
      var moved = metaTargetFiles.splice(from, 1)[0];
      metaTargetFiles.splice(to, 0, moved);
      refreshMetaOrderUi();
    });
    list.appendChild(item);
  });
}

var atOrderToggle = $('at-order-toggle');
if (atOrderToggle) atOrderToggle.addEventListener('click', function (e) {
  e.stopPropagation();
  atTrackOrderMenuOpen = !atTrackOrderMenuOpen;
  renderMetaTrackOrderList();
});

var atTrackOrderWrap = $('at-track-order-wrap');
if (atTrackOrderWrap) atTrackOrderWrap.addEventListener('click', function (e) { e.stopPropagation(); });

document.addEventListener('click', function () {
  if (!atTrackOrderMenuOpen) return;
  atTrackOrderMenuOpen = false;
  renderMetaTrackOrderList();
});

['at-order-filename', 'at-order-trackno', 'at-order-match-title', 'at-order-reset'].forEach(function (id) {
  var btn = $(id);
  if (!btn) return;
  btn.addEventListener('click', function () {
    if (id === 'at-order-filename') sortMetaOrderByFilename();
    else if (id === 'at-order-trackno') sortMetaOrderByTrackNo();
    else if (id === 'at-order-match-title') autoMatchMetaOrderBySourceTitles();
    else resetMetaOrder();
  });
});
var atFieldsContinue = $('at-fields-continue');
if (atFieldsContinue) atFieldsContinue.addEventListener('click', function () { if (metaProposedData) setAutoTagStep('review', true); });
var atDownloadMissingBtn = $('at-download-missing-btn');
if (atDownloadMissingBtn) atDownloadMissingBtn.addEventListener('click', openAutoTagMissingTracksDownload);

$('meta-cancel-btn').addEventListener('click', function () {
  if (metaSaveInProgress) return;
  metaEditorSessionSeq++;
  metaSearchRequestSeq++;
  metaDetailRequestSeq++;
  hideModal($('metadata-modal'));
});
$('meta-save-btn').addEventListener('click', async function () {
  if (metaSaveInProgress) return;
  var btn = $('meta-save-btn');
  var cancelBtn = $('meta-cancel-btn');
  var isManual = $('meta-tab-manual').classList.contains('active');
  var saveSessionId = metaEditorSessionSeq;
  var originalTargetCount = metaTargetFiles.length;
  var targetEntries = metaTargetFiles.map(function (file, sourceIndex) { return { file: file, sourceIndex: sourceIndex }; });
  var targetFiles = targetEntries.map(function (entry) { return entry.file; });
  var proposedData = metaProposedData;
  var originView = metaOriginView;
  var restorePlaybackAfterMetadataSave = null;
  var lockedMetadataPaths = [];
  var changedFileCount = 0;
  var metadataReadWarnings = [];
  var libraryChanged = false;
  var libraryPersistAttempted = false;
  var libraryPersisted = false;
  function setMetadataSaveBusy(busy) {
    metaSaveInProgress = busy;
    btn.disabled = busy;
    if (cancelBtn) cancelBtn.disabled = busy;
    if (!busy) btn.style.display = '';
  }
  function lockMetadataTargets(files) {
    lockedMetadataPaths = (files || []).map(function (file) { return stripFileUrl(file && file.filePath || ''); }).filter(Boolean);
    lockedMetadataPaths.forEach(function (filePath) { metadataWriteLockedPaths.add(filePath); });
  }
  function restoreMetadataPlaybackIfNeeded() {
    lockedMetadataPaths.forEach(function (filePath) { metadataWriteLockedPaths.delete(filePath); });
    lockedMetadataPaths = [];
    if (!restorePlaybackAfterMetadataSave) return;
    var restore = restorePlaybackAfterMetadataSave;
    restorePlaybackAfterMetadataSave = null;
    restore();
  }
  async function persistChangedMetadata() {
    if (!libraryChanged) return true;
    if (libraryPersistAttempted) return libraryPersisted;
    libraryPersistAttempted = true;
    markLibraryDirty();
    await persistLibrary(state.musicFiles);
    libraryPersisted = true;
    return libraryPersisted;
  }
  async function failMetadataSave(message) {
    var persisted = false;
    try { persisted = await persistChangedMetadata(); }
    catch (e) { console.error('Failed to persist metadata changes:', e); }
    var progress = $('meta-save-progress');
    if (progress) progress.remove();
    btn.textContent = 'Save';
    setMetadataSaveBusy(false);
    restoreMetadataPlaybackIfNeeded();
    if (changedFileCount > 0) renderCurrentCollectionState();
    if (changedFileCount > 0) message += '\n\nChanges written to ' + changedFileCount + ' file(s) were kept.';
    if (!persisted) message += '\n\nThe library index could not be saved. Rescan the affected files after resolving the disk error.';
    alert(message);
  }
  function metadataSaveError(result) {
    return result && typeof result === 'object' && result.ok === false ? result.error : '';
  }
  function metadataSaveSucceeded(result) {
    return result === true || !!(result && typeof result === 'object' && result.ok === true);
  }
  function showMetadataSaveWarnings(result) {
    if (result && Array.isArray(result.warnings) && result.warnings.length) showToast(result.warnings.join(' '));
  }
  function resolveCurrentLibraryFile(file) {
    if (!file || !file.filePath) return null;
    var index = getLibraryIndex();
    return index.byPath.get(file.filePath) || index.byStrippedPath.get(stripFileUrl(file.filePath)) || null;
  }
  async function readWrittenMetadata(filePath, label) {
    try {
      var metadata = await window.api.getMetadata(filePath);
      if (!metadata) metadataReadWarnings.push(label);
      return metadata || null;
    } catch (e) {
      console.error('Metadata reread failed for ' + label + ':', e);
      metadataReadWarnings.push(label);
      return null;
    }
  }
  function applyRereadMetadata(file, metadata) {
    if (!file || !metadata) return;
    if (metadata.title) file.title = metadata.title;
    if (metadata.artist) file.artist = metadata.artist;
    if (metadata.albumartist) file.albumArtist = metadata.albumartist;
    if (metadata.album) file.album = metadata.album;
    if (metadata.year) file.year = metadata.year;
    if (metadata.genre) file.genre = metadata.genre;
    file.trackNo = metadata.trackNo || 0;
    file.trackTotal = metadata.trackTotal || 0;
    file.discNo = metadata.discNo || 0;
    file.discTotal = metadata.discTotal || 0;
  }
  function metadataWriteMismatch(metadata, requestedTags) {
    if (!metadata || !requestedTags) return '';
    var fields = [
      ['title', 'Title'], ['artist', 'Artist'], ['album', 'Album'], ['performerInfo', 'Album Artist']
    ];
    for (var i = 0; i < fields.length; i++) {
      var requestedKey = fields[i][0];
      if (!requestedTags[requestedKey]) continue;
      var actualKey = requestedKey === 'performerInfo' ? 'albumartist' : requestedKey;
      var actual = String(metadata[actualKey] || '').trim();
      if (actual !== String(requestedTags[requestedKey]).trim()) {
        return fields[i][1] + ' was not written. The file still reports “' + (actual || 'empty') + '”.';
      }
    }
    return '';
  }
  var skippedUneditable = targetEntries.filter(function (entry) { return !isEditableMetadataFile(entry.file); });
  if (skippedUneditable.length) {
    targetEntries = targetEntries.filter(function (entry) { return isEditableMetadataFile(entry.file); });
    targetFiles = targetEntries.map(function (entry) { return entry.file; });
    if (!targetEntries.length) {
      alert('Metadata editing supports MP3, FLAC, Opus/Ogg and M4A. WebM is not safely editable in place. Nothing to save.');
      return;
    }
    showToast(skippedUneditable.length + ' unsupported file(s) skipped — WebM and WAV are not safely editable in place.');
  }
  if (!isManual && (!proposedData || !proposedData.tags)) return alert('Select a metadata result first.');
  btn.textContent = 'Saving...';
  setMetadataSaveBusy(true);
  metaSearchRequestSeq++;
  metaDetailRequestSeq++;
  var metadataSearchBtn = $('meta-search-btn'); if (metadataSearchBtn) metadataSearchBtn.innerHTML = '<i class="ph ph-magnifying-glass"></i> Search Metadata';

  try {
    if (isManual) {
    var tags = {};
    function manualFieldChanged(id) { return $(id).value !== String(metaManualInitialValues[id] == null ? '' : metaManualInitialValues[id]); }
    function changedText(id) { return manualFieldChanged(id) ? $(id).value.trim() : ''; }
    var nextTitle = changedText('meta-title'); if (nextTitle) tags.title = nextTitle;
    var nextArtist = changedText('meta-artist'); if (nextArtist) tags.artist = nextArtist;
    var nextAlbumArtist = changedText('meta-album-artist'); if (nextAlbumArtist) tags.performerInfo = nextAlbumArtist;
    var nextAlbum = changedText('meta-album'); if (nextAlbum) tags.album = nextAlbum;
    var nextYear = changedText('meta-year'); if (nextYear) tags.year = nextYear;
    var nextGenre = changedText('meta-genre'); if (nextGenre) tags.genre = nextGenre;
    var trackNoChanged = manualFieldChanged('meta-track-no');
    var trackTotalChanged = manualFieldChanged('meta-track-total');
    var discNoChanged = manualFieldChanged('meta-disc-no');
    var discTotalChanged = manualFieldChanged('meta-disc-total');
    var manualTrackNo = trackNoChanged ? (parseInt($('meta-track-no').value || '0', 10) || 0) : 0;
    var manualTrackTotal = trackTotalChanged ? (parseInt($('meta-track-total').value || '0', 10) || 0) : 0;
    var manualDiscNo = discNoChanged ? (parseInt($('meta-disc-no').value || '0', 10) || 0) : 0;
    var manualDiscTotal = discTotalChanged ? (parseInt($('meta-disc-total').value || '0', 10) || 0) : 0;
    var attemptedClear = ['meta-title', 'meta-artist', 'meta-album-artist', 'meta-album', 'meta-year', 'meta-genre'].some(function (id) { return manualFieldChanged(id) && !$(id).value.trim(); })
      || (trackNoChanged && !manualTrackNo) || (trackTotalChanged && !manualTrackTotal) || (discNoChanged && !manualDiscNo) || (discTotalChanged && !manualDiscTotal);
    if (attemptedClear) {
      btn.textContent = 'Save';
      setMetadataSaveBusy(false);
      return alert('Clearing metadata fields is not supported yet. Enter a value or leave the field unchanged.');
    }
    if (metaCoverPath) tags.image = stripFileUrl(metaCoverPath);

    var saveFolderJpg = $('meta-save-folder-jpg') ? $('meta-save-folder-jpg').checked : false;
    var applyOrderAsTrackNo = (($('meta-save-track-order') && $('meta-save-track-order').checked) || ($('at-save-track-order') && $('at-save-track-order').checked));
    var hasManualChanges = Object.keys(tags).length > 0 || trackNoChanged || trackTotalChanged || discNoChanged || discTotalChanged || applyOrderAsTrackNo;
    if (!hasManualChanges) {
      btn.textContent = 'Save';
      setMetadataSaveBusy(false);
      return alert('No metadata changes to save.');
    }
    if (trackTotalChanged && !trackNoChanged && !applyOrderAsTrackNo && targetEntries.some(function (entry) {
      var current = resolveCurrentLibraryFile(entry.file);
      return !current || !current.trackNo;
    })) {
      btn.textContent = 'Save';
      setMetadataSaveBusy(false);
      return alert('Track Total can only be changed when every target has a Track No. Set Track No too, or edit those files separately.');
    }
    if (discTotalChanged && !discNoChanged && targetEntries.some(function (entry) {
      var current = resolveCurrentLibraryFile(entry.file);
      return !current || !current.discNo;
    })) {
      btn.textContent = 'Save';
      setMetadataSaveBusy(false);
      return alert('Disc Total can only be changed when every target has a Disc No. Set Disc No too, or edit those files separately.');
    }
    lockMetadataTargets(targetFiles);
    restorePlaybackAfterMetadataSave = unloadAudioForMetadataSave(targetFiles.map(function (f) { return f.filePath; }));

    var progressContainer = document.createElement('div');
    progressContainer.id = 'meta-save-progress';
    progressContainer.innerHTML = '<div id="meta-save-text" style="font-size:12px;margin-bottom:4px;color:var(--text-subdued);">Saving 0/' + targetFiles.length + '...</div><div style="width:100%;height:4px;background:#333;border-radius:2px;overflow:hidden;"><div id="meta-save-bar" style="width:0%;height:100%;background:var(--accent);"></div></div>';
    btn.parentNode.insertBefore(progressContainer, btn);
    btn.style.display = 'none';

    for (var i = 0; i < targetFiles.length; i++) {
      var sourceIndex = targetEntries[i].sourceIndex;
      var f = resolveCurrentLibraryFile(targetEntries[i].file);
      if (!f) { await failMetadataSave('The library changed while metadata was being saved. Reopen the editor and try again.'); return; }
      targetFiles[i] = f;
      var fp = stripFileUrl(f.filePath);
      var tagsForThisFile = Object.assign({}, tags);
      var nextTrackNoForFile = applyOrderAsTrackNo ? (sourceIndex + 1) : (trackNoChanged ? manualTrackNo : (f.trackNo || 0));
      var nextTrackTotalForFile = applyOrderAsTrackNo ? originalTargetCount : (trackTotalChanged ? manualTrackTotal : (f.trackTotal || 0));
      if ((applyOrderAsTrackNo || trackNoChanged || trackTotalChanged) && nextTrackNoForFile) tagsForThisFile.trackNumber = nextTrackTotalForFile ? (nextTrackNoForFile + '/' + nextTrackTotalForFile) : String(nextTrackNoForFile);
      if ((applyOrderAsTrackNo || trackTotalChanged) && nextTrackTotalForFile) tagsForThisFile.trackTotal = String(nextTrackTotalForFile);
      var nextDiscNoForFile = discNoChanged ? manualDiscNo : (f.discNo || 0);
      var nextDiscTotalForFile = discTotalChanged ? manualDiscTotal : (f.discTotal || 0);
      if ((discNoChanged || discTotalChanged) && nextDiscNoForFile) tagsForThisFile.discNumber = String(nextDiscNoForFile);
      if ((discNoChanged || discTotalChanged) && nextDiscTotalForFile) tagsForThisFile.discTotal = String(nextDiscTotalForFile);
      if ((discNoChanged || discTotalChanged) && (nextDiscNoForFile || nextDiscTotalForFile)) {
        tagsForThisFile.partOfSet = nextDiscNoForFile ? (nextDiscNoForFile + (nextDiscTotalForFile ? '/' + nextDiscTotalForFile : '')) : ('0/' + nextDiscTotalForFile);
      }
      $('meta-save-text').textContent = 'Saving ' + (i + 1) + '/' + targetFiles.length + ': ' + (f.filename || f.title || fp) + '...';
      var saved = await window.api.saveMetadata([fp], tagsForThisFile, saveFolderJpg);
      if (!metadataSaveSucceeded(saved)) { await failMetadataSave('Failed to save metadata for: ' + (f.filename || f.title || fp) + (metadataSaveError(saved) ? '\n\n' + metadataSaveError(saved) : '')); return; }
      if (!changedFileCount) undoStack = [];
      showMetadataSaveWarnings(saved);
      var latestFile = resolveCurrentLibraryFile(f);
      changedFileCount++;
      if (!latestFile) {
        await failMetadataSave('The audio tag was written, but the track was removed from the library during the save. Rescan it if needed.');
        return;
      }
      f = latestFile;
      targetFiles[i] = f;
      if (tags.title) f.title = tags.title;
      if (tags.artist) f.artist = tags.artist;
      if (tags.performerInfo) f.albumArtist = tags.performerInfo;
      if (tags.album) f.album = tags.album;
      if (tags.year) f.year = tags.year;
      if (tags.genre) f.genre = tags.genre;
      if ((applyOrderAsTrackNo || trackNoChanged) && nextTrackNoForFile) f.trackNo = nextTrackNoForFile;
      if ((applyOrderAsTrackNo || trackTotalChanged) && nextTrackTotalForFile) f.trackTotal = nextTrackTotalForFile;
      if (discNoChanged && manualDiscNo) f.discNo = manualDiscNo;
      if (discTotalChanged && manualDiscTotal) f.discTotal = manualDiscTotal;
      if (tags.image) f.picture = toFileUrl(tags.image);
      libraryChanged = true;
      var appliedMetadata = await readWrittenMetadata(fp, f.filename || f.title || fp);
      if (appliedMetadata) {
        applyRereadMetadata(f, appliedMetadata);
        var manualMismatch = metadataWriteMismatch(appliedMetadata, tagsForThisFile);
        if (manualMismatch) { libraryChanged = true; await failMetadataSave('Metadata verification failed for ' + (f.filename || fp) + '. ' + manualMismatch); return; }
      }

      var pct = Math.round(((i + 1) / targetFiles.length) * 100);
      $('meta-save-bar').style.width = pct + '%';
      $('meta-save-text').textContent = 'Saved ' + (i + 1) + '/' + targetFiles.length + ': ' + (f.filename || f.title || fp);
    }
    if (!(await persistChangedMetadata())) { await failMetadataSave('Audio tags were saved, but the library index could not be updated.'); return; }

    } else {
    // Read checkboxes
    var chkArtist = $('at-chk-artist') ? $('at-chk-artist').checked : true;
    var chkAlbArtist = $('at-chk-album-artist') ? $('at-chk-album-artist').checked : true;
    var chkAlbum = $('at-chk-album') ? $('at-chk-album').checked : true;
    var chkYear = $('at-chk-year') ? $('at-chk-year').checked : true;
    var chkGenre = $('at-chk-genre') ? $('at-chk-genre').checked : false;
    var chkCover = $('at-chk-cover') ? $('at-chk-cover').checked : true;
    var chkTitles = $('at-chk-track-titles') ? $('at-chk-track-titles').checked : true;
    var chkNums = $('at-chk-track-numbers') ? $('at-chk-track-numbers').checked : true;
    var saveFolderJpgAuto = chkCover && ($('meta-save-folder-jpg') ? $('meta-save-folder-jpg').checked : false);
    var applyAutoOrderAsTrackNo = $('at-save-track-order') && $('at-save-track-order').checked;
    if (!chkArtist && !chkAlbArtist && !chkAlbum && !chkYear && !chkGenre && !chkCover && !chkTitles && !chkNums && !applyAutoOrderAsTrackNo) {
      if ($('meta-save-progress')) $('meta-save-progress').remove();
      btn.textContent = 'Save';
      setMetadataSaveBusy(false);
      return alert('Select at least one metadata field to write.');
    }
    var warningRows = Array.from(document.querySelectorAll('.at-row-apply[data-warn="1"]')).filter(function (el) { return el.checked; }).length;
    if ((chkTitles || chkNums) && warningRows > 0 && !confirm(warningRows + ' selected track match(es) look suspicious. If your local order differs from MusicBrainz, wrong titles or numbers can be written. Continue anyway?')) {
      if ($('meta-save-progress')) $('meta-save-progress').remove();
      btn.textContent = 'Save';
      setMetadataSaveBusy(false);
      return;
    }
    if ((chkTitles || chkNums) && proposedData.tracks.length !== originalTargetCount && !confirm('MusicBrainz has ' + proposedData.tracks.length + ' track(s), local album has ' + originalTargetCount + '. Continue with only matched rows?')) {
      if ($('meta-save-progress')) $('meta-save-progress').remove();
      btn.textContent = 'Save';
      setMetadataSaveBusy(false);
      return;
    }
    var autoRows = targetEntries.map(function (entry) {
      var sourceIndex = entry.sourceIndex;
      var rowApply = document.querySelector('.at-row-apply[data-index="' + sourceIndex + '"]');
      var rowTitleInput = document.querySelector('.at-title-input[data-index="' + sourceIndex + '"]');
      var rowArtistInput = document.querySelector('.at-artist-input[data-index="' + sourceIndex + '"]');
      var rowTrackInput = document.querySelector('.at-track-input[data-index="' + sourceIndex + '"]');
      var rowDiscInput = document.querySelector('.at-disc-input[data-index="' + sourceIndex + '"]');
      var matchedSourceIndex = rowApply ? parseInt(rowApply.dataset.sourceIndex || '-1', 10) : -1;
      return {
        entry: entry,
        sourceIndex: sourceIndex,
        matchedSourceIndex: matchedSourceIndex,
        selected: !!(rowApply && !rowApply.disabled && rowApply.checked && proposedData.tracks[matchedSourceIndex]),
        title: rowTitleInput ? rowTitleInput.value.trim() : '',
        artist: rowArtistInput ? rowArtistInput.value.trim() : '',
        trackNo: rowTrackInput ? rowTrackInput.value : '',
        discNo: rowDiscInput ? rowDiscInput.value : ''
      };
    }).filter(function (row) { return row.selected; });
    if (!autoRows.length) {
      btn.textContent = 'Save';
      setMetadataSaveBusy(false);
      return alert('Select at least one matched Use row to write metadata.');
    }
    targetEntries = autoRows.map(function (row) { return row.entry; });
    targetFiles = targetEntries.map(function (entry) { return entry.file; });
    var progressContainer = document.createElement('div');
    progressContainer.id = 'meta-save-progress';
    progressContainer.innerHTML = '<div id="meta-save-text" style="font-size:12px;margin-bottom:4px;color:var(--text-subdued);">Saving 0/' + targetFiles.length + '...</div><div style="width:100%;height:4px;background:#333;border-radius:2px;overflow:hidden;"><div id="meta-save-bar" style="width:0%;height:100%;background:var(--accent);"></div></div>';
    btn.parentNode.insertBefore(progressContainer, btn);
    btn.style.display = 'none';
    lockMetadataTargets(targetFiles);
    restorePlaybackAfterMetadataSave = unloadAudioForMetadataSave(targetFiles.map(function (f) { return f.filePath; }));

    for (var i = 0; i < targetFiles.length; i++) {
      var rowData = autoRows[i];
      var sourceIndex = rowData.sourceIndex;
      var f = resolveCurrentLibraryFile(rowData.entry.file);
      if (!f) { await failMetadataSave('The library changed while metadata was being saved. Reopen the editor and try again.'); return; }
      targetFiles[i] = f;
      var fp = stripFileUrl(f.filePath);
      var t = {};
      var proposedTrack = proposedData.tracks[rowData.matchedSourceIndex];
      if (chkArtist) {
        var nextArtist = rowData.artist || (proposedTrack && proposedTrack.artist) || proposedData.tags.artist;
        if (nextArtist) t.artist = nextArtist;
      }
      if (chkAlbArtist && proposedData.tags.performerInfo) t.performerInfo = proposedData.tags.performerInfo;
      if (chkAlbum && proposedData.tags.album) t.album = proposedData.tags.album;
      if (chkYear && proposedData.tags.year) t.year = proposedData.tags.year;
      if (chkGenre && proposedData.tags.genre) t.genre = proposedData.tags.genre;
      if (chkTitles && proposedTrack) t.title = rowData.title || proposedTrack.title;
      if (chkNums && proposedTrack) {
        var rowTrackNo = applyAutoOrderAsTrackNo ? (sourceIndex + 1) : (parseInt(rowData.trackNo || proposedTrack.trackNum || '0', 10) || 0);
        var rowDiscNo = parseInt(rowData.discNo || proposedTrack.discNum || '0', 10) || 0;
        var rowTrackTotal = applyAutoOrderAsTrackNo ? originalTargetCount : proposedTrack.trackTotal;
        if (rowTrackNo) t.trackNumber = rowTrackTotal ? (rowTrackNo + '/' + rowTrackTotal) : String(rowTrackNo);
        if (rowTrackTotal) t.trackTotal = String(rowTrackTotal);
        if (rowDiscNo) t.discNumber = String(rowDiscNo);
        if (proposedTrack.discTotal) t.discTotal = String(proposedTrack.discTotal);
        if (rowDiscNo || proposedTrack.discTotal) t.partOfSet = rowDiscNo ? (rowDiscNo + (proposedTrack.discTotal ? '/' + proposedTrack.discTotal : '')) : ('0/' + proposedTrack.discTotal);
      }
      if (chkCover && proposedData.coverUrl) t.image = proposedData.coverUrl;

      $('meta-save-text').textContent = 'Saving ' + (i + 1) + '/' + targetFiles.length + ': ' + (f.filename || f.title || fp) + '...';
      var savedAuto = await window.api.saveMetadata([fp], t, saveFolderJpgAuto);
      if (!metadataSaveSucceeded(savedAuto)) { await failMetadataSave('Failed to save metadata for: ' + (f.filename || f.title || fp) + (metadataSaveError(savedAuto) ? '\n\n' + metadataSaveError(savedAuto) : '')); return; }
      if (!changedFileCount) undoStack = [];
      showMetadataSaveWarnings(savedAuto);
      var latestFile = resolveCurrentLibraryFile(f);
      changedFileCount++;
      if (!latestFile) {
        await failMetadataSave('The audio tag was written, but the track was removed from the library during the save. Rescan it if needed.');
        return;
      }
      f = latestFile;
      targetFiles[i] = f;

      if (t.title) f.title = t.title;
      if (t.artist) f.artist = t.artist;
      if (t.performerInfo) f.albumArtist = t.performerInfo;
      if (t.album) f.album = t.album;
      if (t.year) f.year = t.year;
      if (t.genre) f.genre = t.genre;
      if (t.trackNumber) f.trackNo = parseInt(t.trackNumber, 10) || f.trackNo;
      if (t.trackTotal) f.trackTotal = parseInt(t.trackTotal, 10) || f.trackTotal;
      if (t.discNumber) f.discNo = parseInt(t.discNumber, 10) || f.discNo;
      if (t.discTotal) f.discTotal = parseInt(t.discTotal, 10) || f.discTotal;
      if (t.partOfSet && String(t.partOfSet).indexOf('/') !== -1) f.discTotal = parseInt(String(t.partOfSet).split('/')[1], 10) || f.discTotal;
      if (t.image) f.picture = /^https:\/\//i.test(t.image) ? t.image : toFileUrl(t.image);
      libraryChanged = true;
      var appliedMetadata = await readWrittenMetadata(fp, f.filename || f.title || fp);
      if (appliedMetadata) {
        applyRereadMetadata(f, appliedMetadata);
        var autoMismatch = metadataWriteMismatch(appliedMetadata, t);
        if (autoMismatch) { libraryChanged = true; await failMetadataSave('Metadata verification failed for ' + (f.filename || fp) + '. ' + autoMismatch); return; }
      }

      var pct = Math.round(((i + 1) / targetFiles.length) * 100);
      $('meta-save-bar').style.width = pct + '%';
      $('meta-save-text').textContent = 'Saved ' + (i + 1) + '/' + targetFiles.length + ': ' + (f.filename || f.title || fp);
    }
    if (!(await persistChangedMetadata())) { await failMetadataSave('Audio tags were saved, but the library index could not be updated.'); return; }
    }

    if ($('meta-save-progress')) $('meta-save-progress').remove();
    btn.style.display = '';
    btn.textContent = 'Saved!';
    restoreMetadataPlaybackIfNeeded();
    showToast('Metadata written to ' + changedFileCount + ' file' + (changedFileCount === 1 ? '' : 's') + '.' + (metadataReadWarnings.length ? ' Could not reread ' + metadataReadWarnings.length + '; the library index kept the values that were written.' : ''), { duration: metadataReadWarnings.length ? 8000 : 3600 });
    setTimeout(function () {
      btn.textContent = 'Save';
      setMetadataSaveBusy(false);
      if (saveSessionId === metaEditorSessionSeq) metaEditorSessionSeq++;
      hideModal($('metadata-modal'));
      var refreshedAlbum = null;
      if (originView && originView.indexOf('album:') === 0 && targetFiles.length) {
        refreshedAlbum = getFullAlbumByKey(getAlbumKey(targetFiles[0]));
      }
      if (state.currentView === 'metadata_health') renderMetadataHealthView();
      else if (refreshedAlbum) renderAlbumDetail(refreshedAlbum);
      else if (state.currentView === 'library') renderLibrary();
      else switchView('library', false);

      if (isMultiSelectMode) {
        selectedAlbumsForEdit.clear();
        setMultiSelectMode(false);
        updateMultiSelectControls();
        renderLibrary();
      }
    }, 450);
  } catch (e) {
    console.error('Metadata save failed:', e);
    await failMetadataSave('Metadata save failed: ' + (e && e.message ? e.message : String(e)));
  }
});

$('meta-search-btn').addEventListener('click', async function () {
  if (metaSaveInProgress) return;
  var q = $('meta-search-query').value.trim(); if (!q) return;
  var sessionId = metaEditorSessionSeq;
  var requestId = ++metaSearchRequestSeq;
  metaDetailRequestSeq++;
  metaProposedData = null;
  updateAutoTagMissingDownloadButton();
  setAutoTagStep('release');
  var compareTable = $('at-track-table'); if (compareTable) compareTable.innerHTML = '<div id="at-track-empty" style="padding:40px;text-align:center;color:rgba(255,255,255,0.2);font-size:13px;">Select a result to see track matching</div>';
  $('meta-search-btn').innerHTML = '<i class="ph ph-spinner ph-spin"></i> Searching...';
  var metadataSourceOptions = {
    discogsToken: appSettings.discogsToken || ''
  };
  var results;
  try {
    results = window.api.searchMetadataSources ? await window.api.searchMetadataSources(q, metadataSourceOptions) : await window.api.searchMusicBrainz(q);
  } catch (e) {
    if (sessionId !== metaEditorSessionSeq || requestId !== metaSearchRequestSeq) return;
    $('meta-search-btn').innerHTML = '<i class="ph ph-magnifying-glass"></i> Search Metadata';
    showToast('Metadata search failed.');
    return;
  }
  if (sessionId !== metaEditorSessionSeq || requestId !== metaSearchRequestSeq) return;
  $('meta-search-btn').innerHTML = '<i class="ph ph-magnifying-glass"></i> Search Metadata';
  var resDiv = $('meta-search-results'); resDiv.innerHTML = '';
  if (!results.length) { resDiv.style.display = 'block'; resDiv.innerHTML = '<div style="padding:12px;color:var(--text-subdued);">No results found. Try a shorter query or add a Discogs token in Settings.</div>'; return; }

  results.forEach(function (r) {
    var el = document.createElement('button');
    el.type = 'button';
    el.className = 'metadata-result-button';
    var yearStr = r.date ? String(r.date).substring(0, 4) : '';
    var source = r.source || 'musicbrainz';
    var sourceLabel = r.label || (source === 'musicbrainz' ? 'MusicBrainz' : source);
    var artistStr = r.artist || (r['artist-credit'] ? r['artist-credit'].map(function(a){return a.name||(a.artist&&a.artist.name)||'';}).join(', ') : 'Unknown');
    el.style.cssText = 'padding:10px 12px;font-size:12px;';
    var thumb = r.thumb ? '<img class="metadata-result-thumb" src="' + esc(r.thumb) + '" alt="Artwork for ' + esc(r.title || 'release') + '" style="width:34px;height:34px;border-radius:5px;object-fit:cover;flex-shrink:0;">' : '<div style="width:34px;height:34px;border-radius:5px;background:rgba(255,255,255,.06);flex-shrink:0;"></div>';
    el.innerHTML = '<div style="display:flex;gap:9px;align-items:center;min-width:0;">' + thumb + '<div style="min-width:0;flex:1;"><div style="font-weight:600;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(r.title) + '</div>' +
      '<div style="color:rgba(255,255,255,0.5);margin-top:2px;display:flex;justify-content:space-between;">' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;">' + esc(artistStr) + '</span>' +
        '<span style="flex-shrink:0;color:rgba(255,255,255,0.3);">' + esc(yearStr) + '</span>' +
      '</div><div style="font-size:10px;color:var(--accent);margin-top:3px;text-transform:uppercase;letter-spacing:.08em;">' + esc(sourceLabel) + '</div></div></div>';
    var thumbImg = el.querySelector('.metadata-result-thumb');
    if (thumbImg) thumbImg.addEventListener('error', function () {
      var fallback = document.createElement('div');
      fallback.style.cssText = 'width:34px;height:34px;border-radius:5px;background:rgba(255,255,255,.06);flex-shrink:0;';
      thumbImg.replaceWith(fallback);
    });
    el.onclick = async function () {
      if (metaSaveInProgress || el._detailLoading) return;
      var detailRequestId = ++metaDetailRequestSeq;
      el._detailRequestId = detailRequestId;
      el._detailLoading = true;
      // Deselect all
      $('meta-search-results').querySelectorAll('.metadata-result-button').forEach(function(d) { d._selected = false; d.classList.remove('selected'); d.setAttribute('aria-pressed', 'false'); });
      el._selected = true; el.classList.add('selected'); el.setAttribute('aria-pressed', 'true');
      var oldHtml = el._normalHtml || el.innerHTML;
      el._normalHtml = oldHtml;
      el.innerHTML = '<div style="display:flex;align-items:center;gap:6px;"><i class="ph ph-spinner ph-spin" style="font-size:14px;color:var(--accent);"></i><span>Loading...</span></div>';
      var details = null;
      var detailError = null;
      try { details = window.api.getMetadataRelease ? await window.api.getMetadataRelease(source, r.id, metadataSourceOptions) : await window.api.getMusicBrainzRelease(r.id); }
      catch (e) { detailError = e; console.error('Metadata detail request failed:', e); }
      if (el._detailRequestId === detailRequestId) {
        el._detailLoading = false;
        if (el.isConnected) el.innerHTML = oldHtml;
      }
      if (sessionId !== metaEditorSessionSeq || requestId !== metaSearchRequestSeq || detailRequestId !== metaDetailRequestSeq || metaSaveInProgress) return;
      if (!details) {
        var detailMessage = 'Could not load release details' + (detailError && detailError.message ? ': ' + detailError.message : '. Try another result or retry.');
        var detailPanel = $('at-track-table');
        if (detailPanel) { detailPanel.innerHTML = ''; var detailAlert = document.createElement('div'); detailAlert.className = 'playlist-import-candidate-error'; detailAlert.setAttribute('role', 'alert'); detailAlert.textContent = detailMessage; detailPanel.appendChild(detailAlert); }
        showToast(detailMessage, { duration: 7000 });
        setAutoTagStep('release');
        return;
      }
      showMetaCompare(details);
    };
    resDiv.appendChild(el);
  });
  resDiv.style.display = 'block';
});

function normalizeMatchTitle(value) {
  return String(value || '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function titleMatchScore(a, b) {
  var aa = normalizeMatchTitle(a);
  var bb = normalizeMatchTitle(b);
  if (!aa || !bb) return 0;
  if (aa === bb) return 1;
  if (aa.includes(bb) || bb.includes(aa)) return 0.85;
  var aWords = new Set(aa.split(/\s+/).filter(Boolean));
  var bWords = new Set(bb.split(/\s+/).filter(Boolean));
  var shared = 0;
  aWords.forEach(function (w) { if (bWords.has(w)) shared++; });
  var total = new Set([].concat(Array.from(aWords), Array.from(bWords))).size;
  return total ? shared / total : 0;
}

function readArtistCredit(value) {
  if (!value) return '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map(function (a) { return a && (a.name || (a.artist && a.artist.name) || a.artist || ''); }).filter(Boolean).join(', ');
  }
  return value.name || (value.artist && value.artist.name) || '';
}

function sameTagText(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

function buildMetadataTrackMatches(localTracks, sourceTracks) {
  var usedSourceIndexes = new Set();
  var matches = (localTracks || []).map(function () { return { sourceIndex: -1, kind: 'unmatched', score: 0 }; });

  function claim(localIndex, sourceIndex, kind, score) {
    if (sourceIndex < 0 || usedSourceIndexes.has(sourceIndex)) return false;
    matches[localIndex] = { sourceIndex: sourceIndex, kind: kind, score: score || 0 };
    usedSourceIndexes.add(sourceIndex);
    return true;
  }

  (localTracks || []).forEach(function (localTrack, localIndex) {
    var trackNo = parseInt(localTrack && localTrack.trackNo || 0, 10);
    var discNo = parseInt(localTrack && localTrack.discNo || 0, 10);
    if (!trackNo) return;
    var candidates = (sourceTracks || []).map(function (sourceTrack, sourceIndex) { return { sourceTrack: sourceTrack, sourceIndex: sourceIndex }; }).filter(function (candidate) {
      return !usedSourceIndexes.has(candidate.sourceIndex) && parseInt(candidate.sourceTrack.trackNum || 0, 10) === trackNo;
    });
    if (discNo) candidates = candidates.filter(function (candidate) { return parseInt(candidate.sourceTrack.discNum || 0, 10) === discNo; });
    if (candidates.length === 1) claim(localIndex, candidates[0].sourceIndex, 'number', titleMatchScore(localTrack.title || localTrack.filename, candidates[0].sourceTrack.title));
  });

  (localTracks || []).forEach(function (localTrack, localIndex) {
    if (matches[localIndex].sourceIndex >= 0) return;
    var bestIndex = -1;
    var bestScore = 0;
    (sourceTracks || []).forEach(function (sourceTrack, sourceIndex) {
      if (usedSourceIndexes.has(sourceIndex)) return;
      var score = titleMatchScore(localTrack.title || localTrack.filename, sourceTrack.title);
      if (score > bestScore) { bestScore = score; bestIndex = sourceIndex; }
    });
    if (bestIndex >= 0 && bestScore >= 0.45) claim(localIndex, bestIndex, 'title', bestScore);
  });

  (localTracks || []).forEach(function (localTrack, localIndex) {
    if (matches[localIndex].sourceIndex >= 0) return;
    var sourceIndex = (sourceTracks || []).findIndex(function (sourceTrack, index) { return !usedSourceIndexes.has(index); });
    if (sourceIndex >= 0) claim(localIndex, sourceIndex, 'position', titleMatchScore(localTrack.title || localTrack.filename, sourceTracks[sourceIndex].title));
  });

  return matches;
}

function getAutoTagMissingDownloadCount() {
  if (!metaProposedData || !metaProposedData.raw) return 0;
  var rows = metadataTracksToDownloadRows(flattenMetadataReleaseTracks(metaProposedData.raw));
  var sourceMatches = metaProposedData.sourceMatches || [];
  return rows.filter(function (row, sourceIndex) {
    var match = sourceMatches[sourceIndex];
    if (match && match.localFilePath) return false;
    return isAlbumDownloadRowMissing(row);
  }).length;
}

function updateAutoTagMissingDownloadButton() {
  var button = $('at-download-missing-btn');
  if (!button) return;
  var missingCount = getAutoTagMissingDownloadCount();
  button.disabled = missingCount === 0;
  var label = missingCount ? ('Review ' + missingCount + ' missing track' + (missingCount === 1 ? '' : 's')) : 'Review missing tracks';
  button.innerHTML = '<i class="ph ph-download-simple" aria-hidden="true"></i> ' + label;
}

function showMetaCompare(mbData) {
  var sourceName = mbData.source || 'MusicBrainz';
  var artist = readArtistCredit(mbData['artist-credit']);
  var year = mbData.date ? mbData.date.substring(0, 4) : '';
  var title = mbData.title || '';
  var tracks = [];
  if (mbData.media) {
    mbData.media.forEach(function(m, mediaIdx) {
      var discNum = m.position || (mediaIdx + 1);
      var discTotal = mbData.media.length;
      var trackTotal = m.tracks ? m.tracks.length : 0;
      if (m.tracks) m.tracks.forEach(function(t, i) {
        tracks.push({
          title: t.title,
          artist: readArtistCredit(t['artist-credit']) || readArtistCredit(t.recording && t.recording['artist-credit']) || t.artist || artist,
          trackNum: t.position || (i+1),
          trackTotal: trackTotal,
          discNum: discNum,
          discTotal: discTotal,
          length: t.length
        });
      });
    });
  }

  // Update field preview values
  var setVal = function(id, val) { var el = $(id); if (el) el.textContent = val || ''; };
  var trackArtists = Array.from(new Set(tracks.map(function (t) { return t.artist || artist; }).filter(Boolean)));
  setVal('at-val-artist', trackArtists.length > 1 ? 'per-track' : (trackArtists[0] || artist));
  setVal('at-val-album-artist', artist);
  setVal('at-val-album', title);
  setVal('at-val-year', year);
  setVal('at-val-genre', mbData.genres && mbData.genres[0] ? mbData.genres[0].name : '');

  var coverUrl = mbData.coverUrl || (/^MusicBrainz$/i.test(sourceName) && mbData.id ? ('https://coverartarchive.org/release/' + mbData.id + '/front-500') : '');
  var trackMatches = buildMetadataTrackMatches(metaTargetFiles, tracks);
  var sourceMatches = tracks.map(function () { return null; });
  trackMatches.forEach(function (match, localIndex) {
    if (match.sourceIndex >= 0) sourceMatches[match.sourceIndex] = { localIndex: localIndex, localFilePath: metaTargetFiles[localIndex] && metaTargetFiles[localIndex].filePath || '', kind: match.kind, score: match.score };
  });
  var atCoverPreview = $('at-cover-preview');
  var atCoverWrap = $('at-cover-wrap');
  if (atCoverPreview) {
    atCoverPreview.style.display = 'none';
    atCoverPreview.onload = function() { atCoverPreview.style.display = 'block'; if (atCoverWrap) { var icon = atCoverWrap.querySelector('i'); if (icon) icon.style.display = 'none'; } };
    atCoverPreview.onerror = function() { atCoverPreview.style.display = 'none'; };
    atCoverPreview.src = coverUrl;
  }

  // Track matching table
  var tbl = $('at-track-table');
  var cnt = $('at-track-count');
  if (tbl) {
    tbl.innerHTML = '';
    // Header
    var hdr = document.createElement('div');
    hdr.className = 'at-track-review-header';
    hdr.innerHTML = '<div class="at-review-head-cell">Use</div>' +
      '<div class="at-review-head-cell">Current Library</div>' +
      '<div class="at-review-head-cell" style="color:var(--accent);">Will Write from ' + esc(sourceName) + ' (Title / Artist / # / Disc)</div>';
    tbl.appendChild(hdr);

    var reviewRows = tracks.map(function (track, sourceIndex) {
      var sourceMatch = sourceMatches[sourceIndex];
      return { localIndex: sourceMatch ? sourceMatch.localIndex : -1, sourceIndex: sourceIndex, match: sourceMatch || { kind: 'unmatched', score: 0 } };
    });
    trackMatches.forEach(function (match, localIndex) {
      if (match.sourceIndex < 0) reviewRows.push({ localIndex: localIndex, sourceIndex: -1, match: match });
    });
    var titleChanges = 0;
    var artistChanges = 0;
    var warningRows = 0;
    reviewRows.forEach(function (reviewRow) {
      var localIndex = reviewRow.localIndex;
      var sourceIndex = reviewRow.sourceIndex;
      var localF = localIndex >= 0 ? metaTargetFiles[localIndex] : null;
      var mbTrack = sourceIndex >= 0 ? tracks[sourceIndex] : null;
      var matched = localF && mbTrack;
      var score = matched ? reviewRow.match.score : 0;
      var titleMatch = score >= 0.72;
      var row = document.createElement('div');
      row.className = 'at-track-review-row';
      var numStr = mbTrack && mbTrack.discNum && mbData.media && mbData.media.length > 1 ? (mbTrack.discNum + '.' + mbTrack.trackNum) : (mbTrack && mbTrack.trackNum ? mbTrack.trackNum : '—');
      var localTitle = localF ? esc(localF.title || localF.filename || '?') : '<span style="color:rgba(255,255,255,0.2);">—</span>';
      var localNumber = localF && localF.trackNo ? ' • #' + esc(localF.discNo && localF.discNo > 1 ? (localF.discNo + '.' + localF.trackNo) : localF.trackNo) : '';
      var localArtist = localF ? esc(localF.artist || 'Unknown Artist') + localNumber : '<span style="color:rgba(255,255,255,0.2);">—</span>';
      var proposedArtist = mbTrack ? (mbTrack.artist || artist || '') : '';
      var titleWillChange = matched && !sameTagText(localF.title || localF.filename, mbTrack.title);
      var artistWillChange = localF && proposedArtist && !sameTagText(localF.artist, proposedArtist);
      if (titleWillChange) titleChanges++;
      if (artistWillChange) artistChanges++;
      var matchIcon = matched ? (titleMatch ? '<i class="ph ph-check" style="color:var(--text-base);font-size:11px;margin-left:4px;"></i>' : '<i class="ph ph-warning" style="color:var(--text-subdued);font-size:11px;margin-left:4px;"></i>') : '';
      var disabled = !matched ? ' disabled' : '';
      var checked = matched ? ' checked' : '';
      var warn = matched && !titleMatch ? '1' : '0';
      if (warn === '1') warningRows++;
      var changeNotes = [];
      if (titleWillChange) changeNotes.push('title changes');
      if (artistWillChange) changeNotes.push('artist changes');
      if (matched && reviewRow.match.kind === 'number') changeNotes.push('matched by saved #');
      if (mbTrack && !localF) changeNotes.push('missing from library');
      if (localF && !mbTrack) changeNotes.push('no source match');
      if (warn === '1') changeNotes.push('check match');
      var editHtml = mbTrack ? '<div class="at-review-new-grid">'
        + '<input class="meta-inp at-title-input' + (titleWillChange ? ' at-review-change' : '') + '" data-index="' + localIndex + '" value="' + esc(mbTrack.title) + '" title="Title after save">'
        + '<input class="meta-inp at-artist-input' + (artistWillChange ? ' at-review-change' : '') + '" data-index="' + localIndex + '" value="' + esc(proposedArtist) + '" title="Artist after save">'
        + '<input class="meta-inp at-track-input" data-index="' + localIndex + '" type="number" min="0" value="' + esc(mbTrack.trackNum || '') + '" title="Track number" style="text-align:center;">'
        + '<input class="meta-inp at-disc-input" data-index="' + localIndex + '" type="number" min="0" value="' + esc(mbTrack.discNum || '') + '" title="Disc number" style="text-align:center;">'
        + '</div>' : '<span style="color:rgba(255,255,255,0.2);">—</span>';
      row.innerHTML = '<div class="at-review-use-cell"><input type="checkbox" class="at-row-apply" data-index="' + localIndex + '" data-source-index="' + sourceIndex + '" data-warn="' + warn + '"' + checked + disabled + ' style="accent-color:var(--accent);"></div>' +
        '<div class="at-review-local-cell"><div class="at-review-title">' + localTitle + matchIcon + '</div><div class="at-review-artist">Artist: ' + localArtist + '</div></div>' +
        '<div class="at-review-new-cell">' + editHtml + '<div class="at-review-note' + (warn === '1' ? ' at-review-warning' : '') + '">#' + esc(numStr) + (changeNotes.length ? ' - ' + esc(changeNotes.join(' - ')) : '') + '</div></div>';
      tbl.appendChild(row);
    });
    if (cnt) {
      cnt.textContent = '(' + tracks.length + ' ' + sourceName + ' / ' + metaTargetFiles.length + ' local' + (titleChanges || artistChanges ? ' - ' + titleChanges + ' title, ' + artistChanges + ' artist changes' : '') + (warningRows ? ' - ' + warningRows + ' warnings' : '') + ')';
    }
  }

  metaProposedData = {
    tags: { artist: artist, album: title, year: year, performerInfo: artist, genre: mbData.genres && mbData.genres[0] ? mbData.genres[0].name : '' },
    tracks: tracks,
    coverUrl: coverUrl,
    raw: mbData,
    sourceMatches: sourceMatches
  };
  updateAutoTagMissingDownloadButton();
  setAutoTagStep('fields', true);
}

var audioEls = [$('audio-player-0'), $('audio-player-1')];
var activeAudioIdx = 0;
var audioGainNodes = null;

function syncSeekSlider(slider, current, duration) {
  if (!slider) return;
  var enabled = Number.isFinite(duration) && duration > 0 && !!state.currentPlayingTrack;
  var safeDuration = enabled ? duration : 0;
  var safeCurrent = enabled ? Math.max(0, Math.min(safeDuration, Number(current) || 0)) : 0;
  slider.setAttribute('aria-valuemax', String(Math.round(safeDuration)));
  slider.setAttribute('aria-valuenow', String(Math.round(safeCurrent)));
  slider.setAttribute('aria-valuetext', fmt(safeCurrent) + ' of ' + fmt(safeDuration));
  slider.setAttribute('aria-disabled', enabled ? 'false' : 'true');
}
function syncSeekSliders(audio) {
  audio = audio || getActiveAudioEl();
  var current = audio && Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
  var duration = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
  syncSeekSlider($('progress-container'), current, duration);
  syncSeekSlider($('np-progress-container'), current, duration);
}
function handleSeekSliderKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  if (!['ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) return;
  var audio = getActiveAudioEl();
  if (!state.currentPlayingTrack || !audio || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
  e.preventDefault();
  var next = audio.currentTime || 0;
  if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = audio.duration;
  else if (e.key === 'ArrowLeft') next -= 5;
  else if (e.key === 'ArrowRight') next += 5;
  else if (e.key === 'PageDown') next -= audio.duration * .1;
  else if (e.key === 'PageUp') next += audio.duration * .1;
  setActiveAudioPosition(next, true);
  syncSeekSliders(audio);
}
function setVolumeLevel(value, persist) {
  var volume = Math.max(0, Math.min(1, Number(value) || 0));
  audioEls.forEach(function (audio) { audio.volume = volume; });
  var bar = $('volume-bar'); if (bar) bar.style.width = (volume * 100) + '%';
  var slider = document.querySelector('.volume-bar-container');
  if (slider) { slider.setAttribute('aria-valuenow', String(Math.round(volume * 100))); slider.setAttribute('aria-valuetext', Math.round(volume * 100) + ' percent'); }
  var valueOutput = $('volume-value');
  if (valueOutput) valueOutput.textContent = Math.round(volume * 100) + '%';
  var volumeToggle = $('btn-volume-toggle');
  if (volumeToggle) {
    var icon = volumeToggle.querySelector('i');
    if (icon) icon.className = volume === 0 ? 'ph ph-speaker-x' : (volume < 0.5 ? 'ph ph-speaker-low' : 'ph ph-speaker-high');
    volumeToggle.setAttribute('aria-label', volume === 0 ? 'Unmute' : 'Mute');
    volumeToggle.setAttribute('aria-pressed', volume === 0 ? 'true' : 'false');
  }
  if (volume > 0) volumeBeforeMute = volume;
  appSettings.volume = volume;
  syncMpris(false);
  if (persist !== false) saveSettingsDebounced(150);
}
function handleVolumeSliderKey(e) {
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
  if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(e.key)) return;
  e.preventDefault();
  var current = appSettings.volume === undefined ? 1 : Number(appSettings.volume);
  if (e.key === 'Home') current = 0;
  else if (e.key === 'End') current = 1;
  else if (e.key === 'PageDown') current -= .1;
  else if (e.key === 'PageUp') current += .1;
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') current -= .05;
  else current += .05;
  setVolumeLevel(current);
}
[$('progress-container'), $('np-progress-container')].forEach(function (slider) { if (slider) slider.addEventListener('keydown', handleSeekSliderKey); });
var volumeSlider = document.querySelector('.volume-bar-container');
if (volumeSlider) volumeSlider.addEventListener('keydown', handleVolumeSliderKey);
var volumeToggle = $('btn-volume-toggle');
if (volumeToggle) volumeToggle.addEventListener('click', function () {
  var current = appSettings.volume === undefined ? 1 : Number(appSettings.volume);
  setVolumeLevel(current > 0 ? 0 : (volumeBeforeMute || 0.7));
});
audioEls.forEach(function (audioEl) {
  audioEl.addEventListener('ended', async function () {
    if (audioEl !== audioEls[activeAudioIdx]) return;
    if (playbackTransitionPending) return;
    if (state.loopMode === 2) {
      var generation = ++playbackGeneration;
      playbackTransitionPending = true;
      cancelCrossfadeTransition(true);
      audioEl.currentTime = 0;
      try {
        await audioEl.play();
        if (generation !== playbackGeneration || audioEl !== audioEls[activeAudioIdx]) return;
        playbackTransitionPending = false;
        state.isPlaying = true;
        checkpointPlaybackSession(audioEl, 200);
        syncPlaybackStateUi();
        if (state.currentPlayingTrack) triggerLastfmScrobbleCycle(state.currentPlayingTrack);
      } catch (e) {
        if (generation !== playbackGeneration) return;
        console.error(e);
        playbackTransitionPending = false;
        state.isPlaying = false;
        checkpointPlaybackSession(audioEl, 200);
        syncPlaybackStateUi();
        showToast('Could not restart the current track.');
      }
      return;
    }
    playNextTrack({ automaticAdvance: true });
  });
  audioEl.addEventListener('playing', function () {
    if (audioEl !== audioEls[activeAudioIdx] || playbackTransitionPending || state.isPlaying) return;
    state.isPlaying = true;
    checkpointPlaybackSession(audioEl, 200);
    syncPlaybackStateUi();
  });
  audioEl.addEventListener('pause', function () {
    if (audioEl !== audioEls[activeAudioIdx] || playbackTransitionPending || audioEl.ended || !state.isPlaying) return;
    cancelCrossfadeTransition(false);
    audioEls.forEach(function (otherAudio) { if (otherAudio !== audioEl && !otherAudio.paused) otherAudio.pause(); });
    state.isPlaying = false;
    pauseLastfmScrobbleCycle(false);
    checkpointPlaybackSession(audioEl, 200);
    syncPlaybackStateUi();
  });
  audioEl.addEventListener('error', function () {
    if (audioEl !== audioEls[activeAudioIdx]) return;
    if (audioEl._restoringSession) return;
    var shouldAdvance = state.isPlaying || playbackTransitionPending;
    var failedTrack = state.currentPlayingTrack;
    stopPlaybackState();
    showToast('Playback stopped because the audio file could not be read.');
    if (failedTrack && shouldAdvance) playNextTrack({ failedTrack: failedTrack, automaticAdvance: true });
  });
  audioEl.addEventListener('timeupdate', function () {
    if (audioEl !== audioEls[activeAudioIdx]) return;
    syncSeekSliders(audioEl);
    recordListeningProgress(audioEl);
    checkpointPlaybackSessionProgress(audioEl);
    syncMprisPositionThrottled();
    $('time-current').textContent = fmt(audioEl.currentTime);
    if (lyricsOpen) updateLyricsHighlight(audioEl.currentTime);
    if (npOverlayOpen) {
      updateNPLyricsHighlight(audioEl.currentTime);
      var npPb = document.getElementById('np-progress-bar');
      if (npPb && !isNaN(audioEl.duration)) {
        npPb.style.width = ((audioEl.currentTime / audioEl.duration) * 100) + '%';
        var npCur = document.getElementById('np-time-cur');
        var npTot = document.getElementById('np-time-total');
        if (npCur) npCur.textContent = fmt(audioEl.currentTime);
        if (npTot) npTot.textContent = fmt(audioEl.duration);
      }
    }
    if (!isNaN(audioEl.duration)) {
      $('time-total').textContent = fmt(audioEl.duration);
      $('progress-bar').style.width = ((audioEl.currentTime / audioEl.duration) * 100) + '%';

      var cfDuration = appSettings.crossfade ? parseInt(appSettings.crossfade) : 0;
      var remaining = audioEl.duration - audioEl.currentTime;
      // Skip early-advance on repeat-one; the ended handler restarts the track instead
      if (cfDuration > 0 && remaining <= cfDuration && state.isPlaying && !audioEl.paused && crossfadeSuppressedTrack !== state.currentPlayingTrack && !state.crossfadingNext && !playbackTransitionPending && !crossfadeActive && !playbackSeekActive && state.loopMode !== 2) {
        var nextSelection = getNextTrackSelection();
        if (nextSelection && nextSelection.track) {
          state.crossfadingNext = true;
          playNextTrack({ automaticCrossfade: true, automaticAdvance: true });
        }
      }
    }
  });
  ['loadedmetadata', 'durationchange', 'emptied'].forEach(function (eventName) {
    audioEl.addEventListener(eventName, function () { if (audioEl === audioEls[activeAudioIdx]) syncSeekSliders(audioEl); });
  });
});

var pc = $('progress-container');
if (pc) {
  let isDraggingProg = false;
  let seekAudio = null;
  pc.addEventListener('mousedown', function (e) { var a = audioEls[activeAudioIdx]; if (!state.currentPlayingTrack || isNaN(a.duration)) return; isDraggingProg = true; playbackSeekActive = true; seekAudio = a; updateProg(e, a); });
  document.addEventListener('mousemove', function (e) { if (isDraggingProg && seekAudio) updateProg(e, seekAudio); });
  document.addEventListener('mouseup', function () {
    if (!isDraggingProg) return;
    isDraggingProg = false;
    playbackSeekActive = false;
    seekAudio = null;
    checkpointPlaybackSession(getActiveAudioEl(), 200);
    syncMpris(true);
  });
  function updateProg(e, a) {
    var r = pc.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.duration;
  }
}
var vc = document.querySelector('.volume-bar-container');
if (vc) {
  let isDraggingVol = false;
  let volumeSaveTimer = null;
  vc.addEventListener('mousedown', function (e) { isDraggingVol = true; updateVol(e); });
  document.addEventListener('mousemove', function (e) { if (isDraggingVol) updateVol(e); });
  document.addEventListener('mouseup', function () {
    if (!isDraggingVol) return;
    isDraggingVol = false;
    clearTimeout(volumeSaveTimer);
    flushSettingsSave();
  });
  function updateVol(e) {
    var r = vc.getBoundingClientRect();
    var v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    setVolumeLevel(v, false);
    clearTimeout(volumeSaveTimer);
    volumeSaveTimer = setTimeout(function () { saveSettingsDebounced(150); }, 150);
  }
}

window.addEventListener('mouseup', function (e) {
  if (e.button === 3) { var b = $('btn-nav-back'); if (b && !b.disabled) b.click(); }
  else if (e.button === 4) { var f = $('btn-nav-forward'); if (f && !f.disabled) f.click(); }
});

document.addEventListener('keydown', function (e) {
  if (!e || e.defaultPrevented || modalStack.length || startupErrorRendered) return;
  var primaryModifier = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
  if (primaryModifier && !isTextEditingShortcutTarget(e.target)) {
    if (e.repeat && ['ArrowRight', 'ArrowLeft', 'ArrowUp', 'ArrowDown', 'KeyS', 'KeyL', 'KeyQ', 'KeyZ'].includes(e.code)) { e.preventDefault(); return; }
    if (e.code === 'ArrowRight') {
      e.preventDefault();
      playNextTrack();
      return;
    }
    if (e.code === 'ArrowLeft') {
      e.preventDefault();
      playPrevTrack();
      return;
    }
    if (e.code === 'ArrowUp') {
      e.preventDefault();
      setVolumeLevel((appSettings.volume === undefined ? 1 : Number(appSettings.volume)) + 0.05);
      return;
    }
    if (e.code === 'ArrowDown') {
      e.preventDefault();
      setVolumeLevel((appSettings.volume === undefined ? 1 : Number(appSettings.volume)) - 0.05);
      return;
    }
    if (e.code === 'KeyS') { e.preventDefault(); toggleShuffle(); return; }
    if (e.code === 'KeyL') { e.preventDefault(); cycleLoop(); return; }
    if (e.code === 'KeyQ') { e.preventDefault(); toggleQueue(); return; }
    if (e.code === 'KeyZ') { e.preventDefault(); undoLastAction(); return; }
  }
  if (shouldIgnoreAppShortcut(e)) return;
  if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) { e.preventDefault(); if (!e.repeat) togglePlay(); }
  if (e.code === 'Escape' && selectedTrackKeys.size) { e.preventDefault(); clearTrackSelection(); }
  // Insert key → Rescan Folder (add only NEW songs from imported folders)
  if (e.code === 'Insert') { e.preventDefault(); if (!e.repeat) doRescanFolder(); }
});



function settingsWithDefaults(settings) {
  settings = settings && typeof settings === 'object' ? settings : {};
  var merged = Object.assign({}, DEFAULT_APP_SETTINGS, settings);
  delete merged.accentColor;
  delete merged.themeColors;
  return merged;
}

async function applyRuntimeSettings(options) {
  options = options || {};
  if (!options.preserveTitleBarMode) nativeTitleBarActive = !!appSettings.useNativeTitleBar;
  isPlaylistGridView = appSettings.isPlaylistGridView !== false;
  if (appSettings.dockMode !== 'expanded') appSettings.dockMode = 'collapsed';
  if (appSettings.virtualScrolling === undefined && state.musicFiles.length > 800) appSettings.virtualScrolling = true;
  if (appSettings.lazyLoading === undefined && state.musicFiles.length > 800) appSettings.lazyLoading = true;
  var sidebar = $('sidebar'); if (sidebar) sidebar.style.removeProperty('width');
  applyDockMode();
  var controlValues = [
    ['setting-minimize', 'checked', !!appSettings.minimizeToTray],
    ['setting-audio-mode', 'value', appSettings.audioMode || 'stereo'],
    ['setting-discord-rpc', 'checked', !!appSettings.discordRpc],
    ['setting-discogs-token', 'value', appSettings.discogsToken || ''],
    ['setting-normalization', 'checked', !!appSettings.normalization],
    ['setting-notifications', 'checked', appSettings.notifications !== false],
    ['setting-native-titlebar', 'checked', !!appSettings.useNativeTitleBar],
    ['setting-glass-effects', 'checked', appSettings.glassEffects !== false],
    ['setting-virtual-scrolling', 'checked', !!appSettings.virtualScrolling],
    ['setting-lazy-loading', 'checked', !!appSettings.lazyLoading],
    ['setting-automatic-backups', 'checked', appSettings.automaticBackupsEnabled !== false]
  ];
  controlValues.forEach(function (entry) { var el = $(entry[0]); if (el) el[entry[1]] = entry[2]; });
  var crossfade = $('setting-crossfade'); if (crossfade) crossfade.value = appSettings.crossfade || 0;
  var crossfadeValue = $('crossfade-val'); if (crossfadeValue) crossfadeValue.textContent = (appSettings.crossfade || 0) + 's';
  var masterGain = appSettings.masterGain !== undefined ? appSettings.masterGain : 100;
  var masterGainInput = $('setting-master-gain'); if (masterGainInput) masterGainInput.value = masterGain;
  var masterGainValue = $('master-gain-val'); if (masterGainValue) masterGainValue.textContent = masterGain + '%';
  document.body.classList.toggle('perf-mode', !!appSettings.virtualScrolling);
  applyThemeSettings();
  refreshDownloadFolderUi();
  updateLastfmIcon();
  refreshSafeStorageStatus();
  if (audioCtx) {
    eqBands.forEach(function (band, index) { band.gain.value = appSettings.eqGains ? (appSettings.eqGains[index] || 0) : 0; });
    updateAudioChain();
    applyAudioMode();
  }
  if (audioGainNode) audioGainNode.gain.value = masterGain / 100;
  setVolumeLevel(appSettings.volume === undefined ? 1 : appSettings.volume, false);
  if (appSettings.discordRpc && window.api.discordStatus) {
    window.api.discordStatus().then(function (result) {
      var status = $('discord-status-text');
      if (status) status.textContent = result && result.enabled ? 'Connected' : 'Could not connect: ' + ((result && result.error) || 'Discord not running');
    }).catch(function (e) { console.error('Discord status failed:', e); });
  } else {
    var discordStatus = $('discord-status-text'); if (discordStatus) discordStatus.textContent = 'Disconnected';
  }
}

function hydrateSessionTrackList(value) {
  return Array.isArray(value) ? value.map(hydrateTrackRef).filter(Boolean) : [];
}

function findSessionTrack(tracks, ref) {
  var hydrated = hydrateTrackRef(ref);
  if (!hydrated) return null;
  var index = findTrackIndexByIdentity(tracks, hydrated);
  return index === -1 ? null : tracks[index];
}

function restoreSessionCursor(tracks, ref, rawIndex) {
  var hydrated = hydrateTrackRef(ref);
  var identityRef = hydrated || ref;
  var restoredIndex = window.RadioQueueHelpers && window.RadioQueueHelpers.resolveRestoredCursorIndex
    ? window.RadioQueueHelpers.resolveRestoredCursorIndex(tracks, identityRef, rawIndex, getPlaybackTrackKey)
    : findTrackIndexByIdentity(tracks, identityRef);
  return restoredIndex >= 0 ? tracks[restoredIndex] : null;
}

function invalidateRestoredPlaybackPreparation() {
  playbackRestoreToken++;
  (window.audioEls || []).forEach(function (audio) { if (audio) audio._restoringSession = false; });
}

function prepareRestoredPlaybackPosition(positionSeconds) {
  var track = state.currentPlayingTrack;
  var audio = getActiveAudioEl();
  if (!track || !track.matchedFile || !track.matchedFile.filePath || !audio) return;
  var expectedKey = getPlaybackTrackKey(track);
  var position = Math.max(0, Number(positionSeconds) || 0);
  var expectedSrc = toFileUrl(track.matchedFile.filePath);
  var restoreToken = ++playbackRestoreToken;
  audio._playbackRestoreToken = restoreToken;
  audio._restoringSession = true;
  audio.src = expectedSrc;
  var clearPreparingState = function () {
    if (audio._playbackRestoreToken === restoreToken) audio._restoringSession = false;
  };
  var applyPosition = function () {
    if (restoreToken !== playbackRestoreToken || audio._playbackRestoreToken !== restoreToken || audio !== getActiveAudioEl() || audio.src !== expectedSrc || getPlaybackTrackKey(state.currentPlayingTrack) !== expectedKey) return;
    clearPreparingState();
    var maxPosition = Number.isFinite(audio.duration) && audio.duration > 0 ? Math.max(0, audio.duration - 0.25) : position;
    try { audio.currentTime = Math.min(position, maxPosition); } catch (e) { }
    syncSeekSliders(audio);
    var current = $('time-current'); if (current) current.textContent = fmt(audio.currentTime);
    var total = $('time-total'); if (total) total.textContent = fmt(audio.duration);
    var bar = $('progress-bar'); if (bar && audio.duration > 0) bar.style.width = ((audio.currentTime / audio.duration) * 100) + '%';
    syncSavedQueuePaths();
    setTimeout(function () { if (appInitializationComplete) saveSettingsDebounced(500); }, 0);
    syncMpris(false);
  };
  audio.addEventListener('loadedmetadata', applyPosition, { once: true });
  audio.addEventListener('error', clearPreparingState, { once: true });
  setTimeout(clearPreparingState, 5000);
  audio.load();
}

function restorePlaybackStateFromSettings() {
  resetPlaybackRuntime({ clearCurrent: true, clearQueues: true, clearHistory: true, preserveSettings: true });
  state.playHistory = Array.isArray(appSettings.playHistory) ? appSettings.playHistory.map(hydrateTrackRef).filter(Boolean) : [];
  var session = appSettings.playbackSession && appSettings.playbackSession.version === 1 ? appSettings.playbackSession : null;
  var restoredPosition = 0;
  var restoredFromSession = false;
  if (session) {
    state.playQueueTracks = hydrateSessionTrackList(session.queue);
    state.userQueue = hydrateSessionTrackList(session.userQueue);
    state.shuffleQueue = hydrateSessionTrackList(session.shuffleQueue);
    state.shuffleMode = Math.max(0, Math.min(2, Number(session.shuffleMode) || 0));
    state.isShuffle = state.shuffleMode > 0;
    state.loopMode = Math.max(0, Math.min(2, Number(session.loopMode) || 0));
    state.currentPlaybackPreservesQueueCursors = session.manualQueuePlayback === true;
    state.currentRadioHistoryPlayback = false;
    state.sourcePlaylistId = getValidSourcePlaylistId(session.sourcePlaylistId);
    if (state.isShuffle && !state.shuffleQueue.length) {
      rebuildShuffleQueueForMode();
    }
    state.playQueueCursor = restoreSessionCursor(state.playQueueTracks, session.playQueueCursor, session.playQueueIndex);
    state.shuffleQueueCursor = restoreSessionCursor(state.shuffleQueue, session.shuffleQueueCursor, session.shuffleQueueIndex);
    var currentTrack = hydrateTrackRef(session.currentTrack);
    var preferredTracks = state.isShuffle
      ? state.shuffleQueue.concat(state.userQueue, state.playQueueTracks)
      : state.playQueueTracks.concat(state.userQueue, state.shuffleQueue);
    state.currentPlayingTrack = findSessionTrack(preferredTracks, session.currentTrack) || currentTrack;
    if (!state.currentPlayingTrack) state.currentPlayingTrack = (state.isShuffle ? state.shuffleQueueCursor : state.playQueueCursor) || state.playQueueTracks[0] || state.userQueue[0] || null;
    if (!state.sourcePlaylistId) state.sourcePlaylistId = getValidSourcePlaylistId(state.currentPlayingTrack && state.currentPlayingTrack.sourcePlaylistId);
    restoredPosition = currentTrack && state.currentPlayingTrack && getPlaybackTrackKey(currentTrack) === getPlaybackTrackKey(state.currentPlayingTrack)
      ? Math.max(0, Number(session.positionSeconds) || 0)
      : 0;
    restoredFromSession = !!state.currentPlayingTrack;
  }
  if (!restoredFromSession) {
    var restoredLastTrack = appSettings.lastTrack ? hydrateTrackRef(appSettings.lastTrack) : null;
    var restoredQueueEntries = Array.isArray(appSettings.savedQueue) ? appSettings.savedQueue.map(function (filePath, originalIndex) {
      var index = getLibraryIndex();
      var file = index.byPath.get(filePath) || index.byStrippedPath.get(stripFileUrl(filePath));
      return file ? { originalIndex: originalIndex, track: makeTrackCommandRecord(file) } : null;
    }).filter(Boolean) : [];
    if (restoredQueueEntries.length) {
      state.playQueueTracks = restoredQueueEntries.map(function (entry) { return entry.track; });
      var savedIndex = Number(appSettings.savedQueueIndex || 0);
      var indexedTrack = restoredQueueEntries.find(function (entry) { return entry.originalIndex === savedIndex; });
      var lastTrackPath = restoredLastTrack && restoredLastTrack.matchedFile && restoredLastTrack.matchedFile.filePath;
      var queuedLastTrack = state.playQueueTracks.find(function (track) { return lastTrackPath && track.matchedFile.filePath === lastTrackPath; });
      state.currentPlayingTrack = (indexedTrack && indexedTrack.track) || queuedLastTrack || state.playQueueTracks[0];
    } else if (restoredLastTrack) {
      state.currentPlayingTrack = restoredLastTrack;
      state.playQueueTracks = [restoredLastTrack];
    } else if (appSettings.lastPlayed && appSettings.lastPlayed.path) {
      var legacyFile = getLibraryIndex().byPath.get(appSettings.lastPlayed.path) || getLibraryIndex().byStrippedPath.get(stripFileUrl(appSettings.lastPlayed.path));
      if (legacyFile) {
        state.playQueueTracks = state.musicFiles.map(makeTrackCommandRecord);
        state.currentPlayingTrack = state.playQueueTracks.find(function (track) { return track.matchedFile === legacyFile; }) || makeTrackCommandRecord(legacyFile);
      }
    }
    updatePlaybackQueueCursors(state.currentPlayingTrack);
    syncSavedQueuePaths();
  }
  state.currentTracks = state.playQueueTracks.slice();
  if (session) {
    var restoredRadioSession = restoreRadioSessionFromContext(session.radioContext);
    var restoredRadioCursor = state.isShuffle ? state.shuffleQueueCursor : state.playQueueCursor;
    if (!state.currentPlaybackPreservesQueueCursors && restoredRadioSession && restoredRadioCursor && trackMatchesRadioContext(state.currentPlayingTrack, serializeRadioContext(restoredRadioSession))) {
      state.currentPlayingTrack = restoredRadioCursor;
    }
  }
  state.isPlaying = false;
  if (isRemotePlaybackTrack(state.currentPlayingTrack) && restoredPosition > 0) state.currentPlayingTrack._restoredPosition = restoredPosition;
  appSettings.playHistory = state.playHistory.map(toLightTrackRef).filter(Boolean);
  if (state.currentPlayingTrack) prepareRestoredPlaybackPosition(restoredPosition);
  else syncSavedQueuePaths();
  maybeRefillRadioQueue();
  syncPlaybackStateUi();
  renderQueue();
}

var thumbarActionsBound = false;
function bindThumbarActions() {
  if (thumbarActionsBound || !window.api.onThumbarAction) return;
  thumbarActionsBound = true;
  window.api.onThumbarAction(function (action, detail) {
    if (action === 'playpause') { initAudioCtx(); togglePlay(); }
    else if (action === 'play') { initAudioCtx(); if (!state.isPlaying && !playbackTransitionPending) togglePlay(); }
    else if (action === 'pause') { if (state.isPlaying || playbackTransitionPending) togglePlay(); }
    else if (action === 'prev') { initAudioCtx(); playPrevTrack(); }
    else if (action === 'next') { initAudioCtx(); playNextTrack(); }
    else if (action === 'seek') { var audio = getActiveAudioEl(); if (audio && !isNaN(audio.duration)) setActiveAudioPosition((audio.currentTime || 0) + (Number(detail || 0) / 1000000), true); }
    else if (action === 'set-position') setActiveAudioPosition(Number(detail || 0) / 1000000, true);
    else if (action === 'volume') { var rawVolume = Number(detail); if (!isNaN(rawVolume)) setVolumeLevel(rawVolume); }
    else if (action === 'set-shuffle') setShuffleEnabled(detail === true);
    else if (action === 'set-loop-status') setLoopStatus(String(detail || ''));
    else if (action === 'shuffle') toggleShuffle();
    else if (action === 'loop') cycleLoop();
    else if (action === 'queue') toggleQueue();
  });
}

async function initApp() {
  appInitializationComplete = false;
  var results = await Promise.all([window.api.loadLibrary(), window.api.loadPlaylists(), window.api.loadMappings(), window.api.loadSettings(), window.api.loadLikedSongs(), window.api.loadListeningStats ? window.api.loadListeningStats() : Promise.resolve({})]);
  setMusicFiles(Array.isArray(results[0]) ? results[0] : []);
  state.playlists = Array.isArray(results[1]) ? results[1] : [];
  state.mappings = results[2] && typeof results[2] === 'object' ? results[2] : {};
  appSettings = settingsWithDefaults(results[3]);
  listeningStats = results[5] && typeof results[5] === 'object' ? results[5] : {};
  if (migrateLegacyPathStats()) persistInBackground(Promise.all([persistListeningStats(listeningStats), persistSettings(appSettings)]));
  if (Array.isArray(results[4])) {
    state.likedSongs = results[4];
    localStorage.removeItem('likedSongs');
  } else if (state.likedSongs.length) {
    persistLikedSongs(state.likedSongs).then(function () { localStorage.removeItem('likedSongs'); }).catch(function (e) { console.error(e); });
  }
  if (!appSettings.ytdlDownloadFolder && window.api.getDefaultDownloadFolder) {
    try { appSettings.ytdlDownloadFolder = await window.api.getDefaultDownloadFolder(); }
    catch (e) { console.error('Default download folder lookup failed:', e); }
  }
  await applyRuntimeSettings();
  restorePlaybackStateFromSettings();
  restoreDownloadQueueState();
  await recoverPendingDownloads();
  updateLastfmIcon();
  buildColorPickers();
  setQueueOpen(false);
  setLyricsOpen(false);
  bindThumbarActions();
  if (window.api.updateThumbar) window.api.updateThumbar(false);
  renderSidebarPlaylists();
  state.navHistory = ['home'];
  state.navIndex = 0;
  switchView('home', false);
  updateNavBtns();
  appInitializationComplete = true;
  rendererPersistenceSuspended = false;
  startupInProgress = false;
  startupErrorRendered = false;
  setStartupErrorMode(false);
  if (window.api.automaticBackupReady) {
    try { await window.api.automaticBackupReady(state.musicFiles.length > 0); }
    catch (e) { console.error('Automatic backup initialization failed:', e); }
  }
  refreshAutomaticBackupStatus();
  checkForAppUpdate(false);
  // Metadata-only backfill is read-only for audio files and remains separate from explicit folder.jpg writes.
  if (state.musicFiles.length > 0 && window.api.backfillMetadata) {
    var pendingBackfill = getPendingMetadataBackfillFiles(state.musicFiles);
    if (pendingBackfill.length) window.api.backfillMetadata(pendingBackfill).then(mergeBackfilledMetadata).catch(function (e) { console.error('Metadata backfill failed:', e); });
  }
}

function setStartupErrorMode(active) {
  document.body.classList.toggle('startup-error-mode', !!active);
  var isolated = ['.sidebar', '.main-header', '.listening-studio', '#home-library-content', '#download-queue-panel'];
  isolated.forEach(function (selector) { var el = document.querySelector(selector); if (el) el.inert = !!active; });
  var content = $('content-area');
  if (content) Array.from(content.children).forEach(function (el) { if (el.id !== 'home-dashboard-container') el.inert = !!active; });
  var folderImport = $('home-import-folder-btn');
  if (folderImport) folderImport.disabled = !!active || appStateCommitInProgress || libraryScanInProgress > 0;
  var restoreBackup = $('home-import-backup-btn');
  if (restoreBackup) restoreBackup.disabled = false;
  if (!active) syncLibraryScanControls();
}

function renderStartupError(error) {
  if (startupErrorRendered) return;
  startupErrorRendered = true;
  startupInProgress = false;
  appInitializationComplete = false;
  rendererPersistenceSuspended = true;
  setStartupErrorMode(true);
  console.error('Playerinyo startup failed:', error);
  try { resetPlaybackRuntime({ clearCurrent: true, clearQueues: true, clearHistory: true, preserveSettings: true }); } catch (resetError) { console.error(resetError); }
  if (typeof npOverlayOpen !== 'undefined' && npOverlayOpen) closeNowPlayingOverlay();
  modalStack = [];
  document.querySelectorAll('.modal-overlay.active').forEach(function (modal) { modal.classList.remove('active'); });
  syncModalIsolation();
  hideAllContextMenus(false);
  state.currentView = 'home';
  document.querySelectorAll('.nav-item').forEach(function (item) { item.classList.toggle('active', item.id === 'nav-home'); });
  var homeNav = $('nav-home'); if (homeNav) homeNav.setAttribute('aria-current', 'page');
  var libraryNav = $('nav-library'); if (libraryNav) libraryNav.removeAttribute('aria-current');
  [$('albums-grid-container'), $('tracks-table-container'), $('search-albums-container'), $('playlists-grid-container'), $('stats-container'), $('metadata-health-container')].forEach(function (el) { if (el) el.style.display = 'none'; });
  var home = $('home-dashboard-container'); if (home) home.style.display = 'block';
  var viewTitle = $('view-title'); if (viewTitle) viewTitle.style.display = 'none';
  var empty = $('home-empty-library'); if (empty) empty.hidden = false;
  var libraryContent = $('home-library-content'); if (libraryContent) libraryContent.hidden = true;
  var title = $('home-empty-library-title'); if (title) title.textContent = 'Playerinyo could not load your library.';
  var copy = empty ? empty.querySelector('.empty-library-copy p') : null;
  if (copy) copy.textContent = 'Your files were not changed. Retry loading local app data, or restore a known-good backup.';
  var status = $('home-import-status');
  if (status) {
    status.replaceChildren();
    var message = document.createElement('span');
    message.textContent = (error && error.message) ? error.message : 'Startup failed unexpectedly.';
    var retry = document.createElement('button');
    retry.type = 'button';
    retry.id = 'startup-retry-btn';
    retry.className = 'btn btn-primary';
    retry.textContent = 'Retry startup';
    retry.addEventListener('click', function () { window.location.reload(); });
    status.append(message, retry);
  }
}

initApp().catch(renderStartupError);





// Global keyboard: N = Now Playing overlay
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape' && npOverlayOpen) { e.preventDefault(); closeNowPlayingOverlay(); return; }
  if (e.key === 'Tab' && npOverlayOpen && !modalStack.length) {
    var overlayFocusable = getModalFocusable($('now-playing-overlay'));
    if (overlayFocusable.length) {
      var first = overlayFocusable[0], last = overlayFocusable[overlayFocusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    return;
  }
  var target = e.target;
  var typingTarget = target && target.closest && (target.isContentEditable || target.closest('input, textarea, select, [contenteditable="true"]'));
  var playerViewControl = target && target.closest && target.closest('#now-playing-overlay');
  if (typingTarget || modalStack.length || startupErrorRendered || (!playerViewControl && shouldIgnoreAppShortcut(e))) return;
  if (e.key === 'n' || e.key === 'N') { e.preventDefault(); if (!e.repeat) toggleNowPlayingOverlay(); }
  if (e.key === '?') { e.preventDefault(); if (!e.repeat) openShortcutsHelp(); }
});
/* ─── ALBUM COVER SLIDESHOW (Now Playing) ─── */
var _npSlideshowTimer = null;
var _npFolderImageCache = new Map();
var _npFolderImageCacheTimes = new Map();
function loadNPSlideshowImagesForTrack(track, generation) {
  if (!npOverlayOpen || !track || !track.matchedFile || !track.matchedFile.filePath || !window.api.scanFolderImages) return;
  var filePath = track.matchedFile.filePath;
  var separatorIndex = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  var trackFolder = separatorIndex === -1 ? '' : filePath.slice(0, separatorIndex + 1);
  if (!trackFolder) return;
  var request = _npFolderImageCache.get(trackFolder);
  if (request && Date.now() - (_npFolderImageCacheTimes.get(trackFolder) || 0) > 5 * 60 * 1000) {
    _npFolderImageCache.delete(trackFolder);
    _npFolderImageCacheTimes.delete(trackFolder);
    request = null;
  }
  if (!request) {
    request = window.api.scanFolderImages(trackFolder).catch(function () { return []; });
    if (_npFolderImageCache.size >= 100) {
      var oldestFolder = _npFolderImageCache.keys().next().value;
      _npFolderImageCache.delete(oldestFolder);
      _npFolderImageCacheTimes.delete(oldestFolder);
    }
    _npFolderImageCache.set(trackFolder, request);
    _npFolderImageCacheTimes.set(trackFolder, Date.now());
  }
  Promise.resolve(request).then(function (images) {
    if (!npOverlayOpen || generation !== playbackGeneration || state.currentPlayingTrack !== track) return;
    images = Array.isArray(images) ? images : [];
    _npFolderImageCache.set(trackFolder, images);
    _npFolderImageCacheTimes.set(trackFolder, Date.now());
    state.npSlideImages = images;
    state.npSlideIdx = 0;
    startNPSlideshow();
  });
}
function startNPSlideshow() {
  clearInterval(_npSlideshowTimer);
  if (!npOverlayOpen || !state.npSlideImages || state.npSlideImages.length < 2) return; // only if multiple images
  var slideshowGeneration = playbackGeneration;
  _npSlideshowTimer = setInterval(function () {
    if (!npOverlayOpen || slideshowGeneration !== playbackGeneration) { clearInterval(_npSlideshowTimer); _npSlideshowTimer = null; return; }
    state.npSlideIdx = (state.npSlideIdx + 1) % state.npSlideImages.length;
    var img = state.npSlideImages[state.npSlideIdx];
    var artEl = document.getElementById('np-art');
    var bgEl = document.getElementById('np-bg-blur');
    if (artEl) {
      artEl.style.opacity = '0';
      setTimeout(function () {
        if (!npOverlayOpen || slideshowGeneration !== playbackGeneration) return;
        artEl.src = img;
        artEl.style.opacity = '1';
      }, 350);
    }
    if (bgEl) bgEl.style.backgroundImage = 'url(' + img + ')';
  }, 8000); // switch every 8 seconds
}

/* ─── LIBRARY GENRE GROUPING ─── */
function renderLibraryByGenre() {
  var container = document.getElementById('albums-grid-container');
  var grid = document.getElementById('albums-grid');
  if (!grid) return;

  // Show grid container, hide others
  if (container) container.style.display = 'block';
  var hdc = $('home-dashboard-container'); if (hdc) hdc.style.display = 'none';
  var ttc = $('tracks-table-container'); if (ttc) ttc.style.display = 'none';

  grid.innerHTML = '';
  // do NOT override grid.style.display — CSS class handles the grid layout
  var renderToken = (window._genreRenderToken = (window._genreRenderToken || 0) + 1);
  var cardWork = [];

  // Group musicFiles by genre
  var genreMap = {};
  state.musicFiles.forEach(function (f) {
    var genre = (f.genre && f.genre.trim()) ? f.genre.trim() : 'Unknown Genre';
    if (!genreMap[genre]) genreMap[genre] = {};
    var albumKey = getAlbumKey(f);
    if (!genreMap[genre][albumKey]) genreMap[genre][albumKey] = { id: albumKey, name: f.album || 'Unknown Album', artist: f.albumArtist || f.artist || 'Unknown', cover: null, tracks: [], genre: genre };
    if (!genreMap[genre][albumKey].cover && f.picture) genreMap[genre][albumKey].cover = f.picture;
    genreMap[genre][albumKey].tracks.push(f);
  });

  var genres = Object.keys(genreMap).sort(function (a, b) {
    if (a === 'Unknown Genre') return 1;
    if (b === 'Unknown Genre') return -1;
    return a.localeCompare(b);
  });

  // Genre color palette for section accents
  var GENRE_COLORS = ['#F5F5F5','#D4D4D4','#A3A3A3','#737373','#525252','#404040','#2B2B2B','#1B1B1B'];

  genres.forEach(function (genre, gi) {
    var accentColor = GENRE_COLORS[gi % GENRE_COLORS.length];
    var albums = Object.values(genreMap[genre]);

    // Wrapper
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'margin-bottom: 40px;';

    // Section header
    var header = document.createElement('div');
    header.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'padding:14px 20px',
      'margin-bottom:16px',
      'border-radius:12px',
      'cursor:pointer',
      'user-select:none',
      'background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)',
      'border:1px solid rgba(255,255,255,0.07)',
      'box-shadow:inset 0 0 0 1px ' + accentColor + '55',
      'transition:background 0.2s, transform 0.15s',
      'position:relative',
      'overflow:hidden'
    ].join(';');

    header.innerHTML = [
      '<div style="display:flex;align-items:center;gap:14px;">',
        '<div style="width:36px;height:36px;border-radius:8px;background:' + accentColor + '20;display:flex;align-items:center;justify-content:center;flex-shrink:0;">',
          '<i class="ph ph-music-notes" style="color:' + accentColor + ';font-size:18px;"></i>',
        '</div>',
        '<div>',
          '<div style="font-size:15px;font-weight:700;color:white;letter-spacing:0.3px;">' + esc(genre) + '</div>',
          '<div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:2px;">' + albums.length + ' album' + (albums.length !== 1 ? 's' : '') + '</div>',
        '</div>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:10px;">',
        (genre === 'Unknown Genre' ? '<button class="btn btn-outline genre-mb-btn" style="padding:5px 12px;font-size:11px;border-radius:6px;"><i class="ph ph-tag" style="margin-right:5px;"></i>Auto-Tag</button>' : ''),
        '<i class="ph ph-caret-down genre-caret" style="color:rgba(255,255,255,0.4);font-size:18px;transition:transform 0.2s;"></i>',
      '</div>'
    ].join('');

    header.addEventListener('mouseenter', function () {
      header.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.04) 100%)';
    });
    header.addEventListener('mouseleave', function () {
      header.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)';
    });

    var mbBtn = header.querySelector('.genre-mb-btn');
    if (mbBtn) {
      mbBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        alert('Right-click any album or track and choose "Edit Metadata", then use the "Auto-Tag" tab to search MusicBrainz.');
      });
    }

    // Album grid for this genre
    var albumGrid = document.createElement('div');
    albumGrid.className = 'albums-grid';
    albumGrid.style.cssText = 'padding:0 4px;';

    var collapsed = false;
    header.addEventListener('click', function (e) {
      if (e.target.closest('.genre-mb-btn')) return;
      collapsed = !collapsed;
      albumGrid.style.display = collapsed ? 'none' : '';
      var caret = header.querySelector('.genre-caret');
      if (caret) caret.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    });

    albums.forEach(function (album) {
      cardWork.push({ grid: albumGrid, album: album });
    });

    wrapper.appendChild(header);
    wrapper.appendChild(albumGrid);
    grid.appendChild(wrapper);
  });

  function buildGenreAlbumCard(album) {
    var card = document.createElement('article');
    card.className = 'album-card' + (isAlbumActive(album) ? ' playing' : '');
    card.dataset.albumKey = album.id || '';
    var active = isAlbumActive(album);
    var playBtnIcon = active && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
    var cov = album.cover ? '<img src="' + esc(album.cover) + '" alt="" loading="lazy" />' : '<i class="ph ph-music-notes" aria-hidden="true"></i>';
    card.innerHTML = '<div class="album-card-img-wrapper" style="position:relative;">' + cov + '<button type="button" class="album-card-play-btn" aria-label="Play ' + esc(album.name) + '" data-album="' + encodeURIComponent(album.name) + '"><i class="' + playBtnIcon + '" aria-hidden="true"></i></button></div><button type="button" class="album-card-open" aria-label="Open ' + esc(album.name) + ' by ' + esc(album.artist || 'Unknown Artist') + '"><span class="album-card-info"><span class="album-card-title" title="' + esc(album.name) + '">' + esc(album.name) + '</span><span class="album-card-artist">' + esc(album.artist) + '</span></span></button>';

    card.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      window.currentContextMenuAlbum = album;
      positionContextMenu($('album-context-menu'), e.clientX, e.clientY, card);
    });

    card.querySelector('.album-card-play-btn').addEventListener('click', function (e) {
      e.stopPropagation(); initAudioCtx();
      if (isAlbumActive(album)) { togglePlay(); } else {
        state.playQueueTracks = getSortedAlbumTracks(album).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
        state.shuffleQueue = [];
        if (state.isShuffle) rebuildShuffleQueueForMode();
        playTrack(state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks[0]);
      }
    });

    card.addEventListener('click', function (e) {
      if (e.target.closest('.album-card-play-btn')) return;
      pushNav('album:' + album.id);
      renderAlbumDetail(album);
    });
    card.querySelector('.album-card-open').addEventListener('keydown', function (e) {
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); window.currentContextMenuAlbum = album; positionContextMenu($('album-context-menu'), 0, 0, card); }
    });

    return card;
  }

  // Build cards in rAF chunks so huge libraries don't freeze the UI in one pass;
  // the token cancels a stale render if the view re-renders meanwhile.
  function processCardChunk(start) {
    if (renderToken !== window._genreRenderToken) return;
    var end = Math.min(start + 80, cardWork.length);
    for (var i = start; i < end; i++) cardWork[i].grid.appendChild(buildGenreAlbumCard(cardWork[i].album));
    if (end < cardWork.length) requestAnimationFrame(function () { processCardChunk(end); });
  }
  processCardChunk(0);
}


/* ─── SMART PLAYLISTS ─── */
var RANDOM_DISCOVERY_FIELD = 'randomDiscovery';
var RANDOM_DISCOVERY_ALBUM_LIMIT = 5;
var DEFAULT_SMART_PLAYLISTS = [
  { id: 'sp_recently_played', name: 'Recently Played', icon: 'ph-clock-counter-clockwise', color: 'linear-gradient(135deg,#171717,#4A4A4A)', type: 'smart', rule: { field: 'playHistory', limit: 30 }, desc: 'Your recent listens' },
  { id: 'sp_liked_songs', name: 'Liked Songs', icon: 'ph-heart', color: 'linear-gradient(135deg,#222222,#666666)', type: 'smart', rule: { field: 'liked' }, desc: 'Everything you loved' },
  { id: 'sp_90s', name: '90s', icon: 'ph-radio', color: 'linear-gradient(135deg,#111111,#555555)', type: 'smart', rule: { field: 'decade', value: '1990' }, desc: '1990–1999 tracks' },
  { id: 'sp_2000s', name: '2000s', icon: 'ph-cassette-tape', color: 'linear-gradient(135deg,#202020,#727272)', type: 'smart', rule: { field: 'decade', value: '2000' }, desc: '2000–2009 tracks' },
  { id: 'sp_2010s', name: '2010s', icon: 'ph-vinyl-record', color: 'linear-gradient(135deg,#2B2B2B,#8A8A8A)', type: 'smart', rule: { field: 'decade', value: '2010' }, desc: '2010–2019 tracks' },
  { id: 'sp_2020s', name: '2020s', icon: 'ph-sparkle', color: 'linear-gradient(135deg,#3A3A3A,#A3A3A3)', type: 'smart', rule: { field: 'decade', value: '2020' }, desc: '2020 and beyond' },
  { id: 'sp_no_genre', name: 'Unknown Genre', icon: 'ph-question', color: 'linear-gradient(135deg,#181818,#4B4B4B)', type: 'smart', rule: { field: 'no_genre' }, desc: 'Missing genre tags' },
];

function getSmartPlaylists() {
  var custom = Array.isArray(appSettings.customSmartPlaylists) ? appSettings.customSmartPlaylists : [];
  return custom.concat(DEFAULT_SMART_PLAYLISTS);
}

function getSmartPlaylistById(id) {
  return getSmartPlaylists().find(function (playlist) { return playlist.id === id; }) || null;
}

function isRandomDiscoverySmartPlaylist(playlist) {
  return !!(playlist && playlist.rule && playlist.rule.field === RANDOM_DISCOVERY_FIELD);
}

function isCustomSmartPlaylist(playlist) {
  return !!(playlist && Array.isArray(appSettings.customSmartPlaylists) && appSettings.customSmartPlaylists.some(function (candidate) { return candidate.id === playlist.id; }));
}

function saveCustomSmartPlaylists(customs) {
  var previous = appSettings.customSmartPlaylists;
  appSettings.customSmartPlaylists = customs.slice();
  return persistSettings(appSettings).catch(function (error) {
    appSettings.customSmartPlaylists = previous;
    throw error;
  });
}

function smartPlaylistTrackFromFile(file) {
  return { title: file.title, artist: file.artist, album: file.album, duration: file.duration, matchedFile: file, isDisabled: false };
}

function getDiscoveryGenreLabels(file) {
  var raw = file && file.genre;
  if (!raw) return [];
  if (Array.isArray(raw)) raw = raw.join(';');
  return String(raw).split(/[;,]/).map(function (genre) { return genre.trim(); }).filter(Boolean);
}

function getRandomDiscoveryCandidates(genres) {
  var selectedGenres = new Set((genres || []).map(function (genre) { return String(genre).trim().toLowerCase(); }).filter(Boolean));
  var seenPaths = new Set();
  return state.musicFiles.filter(function (file) {
    if (!file || !file.filePath || libraryMissingFilePaths.has(file.filePath)) return false;
    var pathKey = stripFileUrl(file.filePath);
    if (!pathKey || seenPaths.has(pathKey)) return false;
    if (selectedGenres.size) {
      var matchesGenre = getDiscoveryGenreLabels(file).some(function (genre) { return selectedGenres.has(genre.toLowerCase()); });
      if (!matchesGenre) return false;
    }
    seenPaths.add(pathKey);
    return true;
  });
}

function getRandomDiscoveryCapacity(candidates) {
  var albumCounts = new Map();
  candidates.forEach(function (file) {
    var albumKey = getAlbumKey(file);
    albumCounts.set(albumKey, (albumCounts.get(albumKey) || 0) + 1);
  });
  var total = 0;
  albumCounts.forEach(function (count) { total += Math.min(RANDOM_DISCOVERY_ALBUM_LIMIT, count); });
  return total;
}

function shuffleDiscoveryItems(items) {
  for (var i = items.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var current = items[i]; items[i] = items[j]; items[j] = current;
  }
  return items;
}

function generateRandomDiscoveryPaths(rule) {
  rule = rule || {};
  var target = Number(rule.limit) === 100 ? 100 : 50;
  var albumGroups = new Map();
  getRandomDiscoveryCandidates(rule.genres).forEach(function (file) {
    var albumKey = getAlbumKey(file);
    if (!albumGroups.has(albumKey)) albumGroups.set(albumKey, []);
    albumGroups.get(albumKey).push(file);
  });
  var groups = Array.from(albumGroups.values()).map(function (files) {
    return { files: shuffleDiscoveryItems(files.slice()), selected: 0 };
  });
  var selectedPaths = [];
  while (groups.length && selectedPaths.length < target) {
    shuffleDiscoveryItems(groups);
    for (var i = 0; i < groups.length && selectedPaths.length < target; i++) {
      var group = groups[i];
      if (group.selected >= RANDOM_DISCOVERY_ALBUM_LIMIT || !group.files.length) continue;
      selectedPaths.push(group.files.pop().filePath);
      group.selected++;
    }
    groups = groups.filter(function (group) { return group.files.length && group.selected < RANDOM_DISCOVERY_ALBUM_LIMIT; });
  }
  return selectedPaths;
}

function evaluateSmartPlaylist(sp) {
  var tracks = [];
  var rule = sp.rule || {};

  if (rule.field === RANDOM_DISCOVERY_FIELD) {
    var libraryIndex = getLibraryIndex();
    var seenPaths = new Set();
    (Array.isArray(sp.trackPaths) ? sp.trackPaths : []).forEach(function (filePath) {
      var normalizedPath = stripFileUrl(filePath || '');
      if (!normalizedPath || seenPaths.has(normalizedPath)) return;
      var file = libraryIndex.byPath.get(filePath) || libraryIndex.byStrippedPath.get(normalizedPath);
      if (!file || libraryMissingFilePaths.has(file.filePath)) return;
      seenPaths.add(normalizedPath);
      tracks.push(smartPlaylistTrackFromFile(file));
    });
  } else if (rule.field === 'playHistory') {
    var seen = new Set();
    var hist = (state.playHistory || []).slice().reverse();
    for (var i = 0; i < hist.length && tracks.length < (rule.limit || 30); i++) {
      var h = hist[i];
      // Ensure matchedFile is resolved from musicFiles if missing
      if (!h.matchedFile) {
        h.matchedFile = findMatchingFile(h.title, h.artist, h.album, h.filePath || '') || null;
      }
      var key = (h.title || '') + '::' + (h.artist || '');
      if (!seen.has(key)) { seen.add(key); tracks.push({ title: h.title, artist: h.artist, album: h.album, duration: h.duration, matchedFile: h.matchedFile }); }
    }
  } else if (rule.field === 'liked') {
    var likedSongsSet = new Set(state.likedSongs);
    state.musicFiles.filter(function (f) { return likedSongsSet.has(f.filePath); })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'unplayed') {
    var playedKeys = new Set((state.playHistory || []).map(function (h) { return (h.title || '') + '::' + (h.artist || ''); }));
    state.musicFiles.filter(function (f) { return !playedKeys.has((f.title || '') + '::' + (f.artist || '')); })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'decade') {
    var dec = parseInt(rule.value);
    state.musicFiles.filter(function (f) {
      var yr = parseInt(f.year || f.date || 0);
      return yr >= dec && yr < dec + 10;
    }).forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'year') {
    var yr = parseInt(rule.value);
    state.musicFiles.filter(function (f) { return parseInt(f.year || f.date || 0) === yr; })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'genre') {
    state.musicFiles.filter(function (f) { return (f.genre || '').toLowerCase().includes((rule.value || '').toLowerCase()); })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'artist') {
    state.musicFiles.filter(function (f) { return (f.artist || '').toLowerCase().includes((rule.value || '').toLowerCase()); })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'album') {
    state.musicFiles.filter(function (f) { return (f.album || '').toLowerCase().includes((rule.value || '').toLowerCase()); })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'duration_max') {
    state.musicFiles.filter(function (f) { return (f.duration || 0) <= rule.value; })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'duration_min') {
    state.musicFiles.filter(function (f) { return (f.duration || 0) >= rule.value; })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'no_genre') {
    state.musicFiles.filter(function (f) { return !f.genre || !f.genre.trim(); })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  }
  return tracks;
}

function getSmartPlaylistGenreSummary(playlist) {
  var genres = playlist && playlist.rule && Array.isArray(playlist.rule.genres) ? playlist.rule.genres.filter(Boolean) : [];
  if (!genres.length) return 'All genres';
  if (genres.length <= 2) return genres.join(' + ');
  return genres.slice(0, 2).join(' + ') + ' +' + (genres.length - 2);
}

function appendSmartPlaylistArtwork(art, playlist, tracks) {
  var firstTrackWithArtwork = tracks.find(function (track) { return track.matchedFile && track.matchedFile.picture; });
  if (!firstTrackWithArtwork) {
    art.classList.add('placeholder');
    var icon = document.createElement('i');
    icon.className = 'ph ' + (playlist.icon || 'ph-sparkle');
    icon.setAttribute('aria-hidden', 'true');
    art.appendChild(icon);
    return;
  }
  art.classList.add('covers-1');
  var image = document.createElement('img');
  image.src = firstTrackWithArtwork.matchedFile.picture;
  image.alt = '';
  if (appSettings.lazyLoading) image.loading = 'lazy';
  art.appendChild(image);
}

function renderSmartPlaylistsGrid() {
  var list = $('smart-mixes-list');
  if (!list) return;
  list.replaceChildren();
  var customPlaylists = Array.isArray(appSettings.customSmartPlaylists) ? appSettings.customSmartPlaylists : [];
  var section = $('smart-mixes-section');
  if (section) section.hidden = customPlaylists.length === 0;
  customPlaylists.forEach(function (playlist) {
    var tracks = evaluateSmartPlaylist(playlist);
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'smart-mix-card' + (state.currentView === playlist.id ? ' active' : '') + (state.sourcePlaylistId === playlist.id ? ' playing-source' : '');
    card.dataset.searchText = [playlist.name, playlist.desc, getSmartPlaylistGenreSummary(playlist)].filter(Boolean).join(' ');
    card.setAttribute('aria-label', 'Open Smart Mix ' + playlist.name + ', ' + tracks.length + ' tracks');

    var art = document.createElement('span');
    art.className = 'smart-mix-card-art';
    art.setAttribute('aria-hidden', 'true');
    appendSmartPlaylistArtwork(art, playlist, tracks);
    var kind = document.createElement('span');
    kind.className = 'smart-mix-card-kind';
    var needsReview = playlist.rule && playlist.rule.field === 'unplayed';
    kind.textContent = needsReview ? 'Needs review' : (isRandomDiscoverySmartPlaylist(playlist) ? 'Discovery' : 'Live rule');
    art.appendChild(kind);

    var title = document.createElement('span');
    title.className = 'smart-mix-card-title';
    title.textContent = playlist.name;
    title.title = playlist.name;
    var meta = document.createElement('span');
    meta.className = 'smart-mix-card-meta';
    if (needsReview) meta.textContent = 'Local history cannot represent listening in other apps';
    else if (isRandomDiscoverySmartPlaylist(playlist)) meta.textContent = tracks.length + ' tracks / ' + getSmartPlaylistGenreSummary(playlist);
    else meta.textContent = tracks.length + ' tracks / ' + (playlist.desc || 'Library rule');
    card.append(art, title, meta);
    card.addEventListener('click', function () { switchView(playlist.id); });
    card.addEventListener('contextmenu', function (event) {
      event.preventDefault();
      openPlaylistContextMenu({ id: playlist.id, name: playlist.name, tracks: tracks, isSpecial: true }, event.clientX, event.clientY, card);
    });
    list.appendChild(card);
  });
}

// Kept for older callers that rendered this feature outside the playlist workspace.
function renderSmartPlaylistsSection() { renderSmartPlaylistsGrid(); }

function openSmartPlaylist(sp) {
  var tracks = evaluateSmartPlaylist(sp);
  tracks.forEach(function (track) { track.sourcePlaylistId = sp.id; });
  var ca = $('content-area');
  if (ca) ca.scrollTop = 0;
  hideAllViewRoots();
  setViewKind('playlist');
  state.currentTracks = tracks;
  state.currentView = sp.id;
  clearTrackTableFilter();
  var ttc = $('tracks-table-container');
  if (ttc) ttc.style.display = 'block';
  var hdr = $('album-detail-header');
  if (hdr) {
    hdr.style.display = 'flex';
    hdr.removeAttribute('data-album-key');
    $('album-detail-title').textContent = sp.name;
    $('album-detail-type').textContent = 'Smart Mix';
    var storedTrackCount = Array.isArray(sp.trackPaths) ? sp.trackPaths.length : tracks.length;
    var missingTrackCount = Math.max(0, storedTrackCount - tracks.length);
    $('album-detail-artist').textContent = tracks.length + ' tracks' + (missingTrackCount ? ' / ' + missingTrackCount + ' unavailable' : '');
    $('album-detail-meta').textContent = isRandomDiscoverySmartPlaylist(sp)
      ? getSmartPlaylistGenreSummary(sp) + ' / Target ' + (Number(sp.rule.limit) === 100 ? 100 : 50) + ' / Maximum 5 per album'
      : (sp.desc || 'Updates from your library');
    var cover = $('album-detail-cover');
    var wrap = $('album-detail-cover-wrap');
    var firstCover = tracks.find(function (track) { return track.matchedFile && track.matchedFile.picture; });
    if (cover && firstCover) {
      cover.src = firstCover.matchedFile.picture;
      cover.alt = 'Artwork from ' + sp.name;
      cover.style.display = 'block';
    } else if (cover) {
      cover.removeAttribute('src');
      cover.alt = '';
      cover.style.display = 'none';
    }
    if (cover) { cover.style.cursor = 'default'; cover.onclick = null; }
    if (wrap) { wrap.style.display = ''; wrap.style.background = sp.color || 'linear-gradient(135deg,#171717,#555555)'; }
    var ppb = $('album-cover-play-btn');
    if (ppb) {
      ppb.setAttribute('aria-label', 'Play ' + sp.name);
      var playIcon = ppb.querySelector('i'); if (playIcon) playIcon.className = 'ph-fill ph-play';
      ppb.onclick = function () {
        if (!tracks.length) return; initAudioCtx();
        state.playQueueTracks = tracks.slice();
        state.shuffleQueue = []; if (state.isShuffle) rebuildShuffleQueueForMode();
        var first = state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks.find(function (t) { return !t.isDisabled; });
        if (first) playTrack(first);
      };
    }
  }
  var playlistControls = $('playlist-controls-container'); if (playlistControls) playlistControls.style.display = 'none';
  var playlistActions = $('playlist-detail-actions'); if (playlistActions) playlistActions.hidden = true;
  var editMetadata = $('album-edit-metadata-btn'); if (editMetadata) editMetadata.style.display = 'none';
  var detailActions = $('smart-mix-detail-actions');
  var isCustom = isCustomSmartPlaylist(sp);
  var canRefreshOrEdit = isRandomDiscoverySmartPlaylist(sp) && isCustom;
  var canManage = isCustom;
  if (detailActions) detailActions.hidden = !canManage;
  if (canManage) {
    var refreshButton = $('smart-mix-refresh-btn');
    var editButton = $('smart-mix-edit-btn');
    var deleteButton = $('smart-mix-delete-btn');
    if (refreshButton) refreshButton.hidden = !canRefreshOrEdit;
    if (editButton) editButton.hidden = !canRefreshOrEdit;
    if (deleteButton) deleteButton.hidden = false;
    if (refreshButton && canRefreshOrEdit) {
      refreshButton.disabled = false;
      refreshButton.onclick = async function () {
      if (refreshButton.disabled) return;
      refreshButton.disabled = true;
      var nextPaths = generateRandomDiscoveryPaths(sp.rule);
      if (!nextPaths.length) { showToast('No playable tracks match this Smart Mix. Edit its genres or rescan the library.'); refreshButton.disabled = false; return; }
      var updated = Object.assign({}, sp, { trackPaths: nextPaths });
      var customs = (appSettings.customSmartPlaylists || []).map(function (playlist) { return playlist.id === sp.id ? updated : playlist; });
      try {
        await saveCustomSmartPlaylists(customs);
        openSmartPlaylist(updated);
        showToast('Refreshed "' + updated.name + '" with ' + nextPaths.length + ' tracks.');
      } catch (error) {
        showToast('The Smart Mix could not be refreshed. Check disk space and permissions.');
        refreshButton.disabled = false;
      }
      };
    }
    if (editButton && canRefreshOrEdit) editButton.onclick = function () { openSmartPlaylistBuilder(sp); };
    if (deleteButton) deleteButton.onclick = function () {
      playlistToDelete = null;
      smartPlaylistToDelete = sp;
      var title = $('delete-confirm-title'); if (title) title.textContent = 'Delete Smart Mix';
      var confirmButton = $('delete-confirm-btn'); if (confirmButton) { confirmButton.textContent = 'Delete Smart Mix'; confirmButton.disabled = false; }
      if (delCancel) delCancel.disabled = false;
      var copy = $('delete-confirm-copy');
      if (copy) copy.textContent = 'Delete Smart Mix "' + sp.name + '"? Library tracks and audio files stay untouched.';
      showModal($('delete-confirm-modal'));
    };
  }
  $('view-title').textContent = sp.name;
  $('view-title').style.display = 'none';
  renderTracksTable(false);
}

function openSmartPlaylistBuilder(playlist) {
  var modal = $('smart-playlist-modal');
  if (!modal) return;
  var editing = isRandomDiscoverySmartPlaylist(playlist) && isCustomSmartPlaylist(playlist) ? playlist : null;
  smartPlaylistBeingEditedId = editing ? editing.id : null;
  var nameInput = $('sp-name-input');
  var allGenresInput = $('sp-all-genres');
  var genresList = $('sp-genres-list');
  var noGenres = $('sp-no-genres');
  var summary = $('sp-genre-summary');
  var previewNum = $('sp-preview-num');
  var previewCopy = $('sp-preview-copy');
  var errorEl = $('sp-builder-error');
  var createButton = $('sp-create-btn');
  var title = $('sp-builder-title');
  var selectedGenres = new Set(editing && Array.isArray(editing.rule.genres) ? editing.rule.genres : []);
  var genreCatalog = new Map();
  getRandomDiscoveryCandidates([]).forEach(function (file) {
    getDiscoveryGenreLabels(file).forEach(function (genre) {
      var key = genre.toLowerCase();
      if (!genreCatalog.has(key)) genreCatalog.set(key, genre);
    });
  });
  selectedGenres.forEach(function (genre) {
    var key = String(genre).toLowerCase();
    if (!genreCatalog.has(key)) genreCatalog.set(key, String(genre));
  });

  nameInput.value = editing ? editing.name : 'Random Discovery';
  title.textContent = editing ? 'Edit Smart Mix' : 'New Smart Mix';
  createButton.innerHTML = '<i class="ph ' + (editing ? 'ph-check' : 'ph-plus') + '" aria-hidden="true"></i> ' + (editing ? 'Save Mix' : 'Create Mix');
  createButton.disabled = false;
  errorEl.hidden = true;
  genresList.replaceChildren();
  Array.from(genreCatalog.values()).sort(function (a, b) { return a.localeCompare(b); }).forEach(function (genre, index) {
    var label = document.createElement('label');
    var input = document.createElement('input');
    var copy = document.createElement('span');
    input.type = 'checkbox';
    input.value = genre;
    input.id = 'sp-genre-' + index;
    input.checked = Array.from(selectedGenres).some(function (selected) { return String(selected).toLowerCase() === genre.toLowerCase(); });
    copy.textContent = genre;
    label.append(input, copy);
    genresList.appendChild(label);
  });
  noGenres.hidden = genreCatalog.size > 0;
  allGenresInput.checked = selectedGenres.size === 0;
  var requestedLimit = editing && Number(editing.rule.limit) === 100 ? '100' : '50';
  var selectedLimitInput = modal.querySelector('input[name="sp-limit"][value="' + requestedLimit + '"]');
  if (selectedLimitInput) selectedLimitInput.checked = true;

  function checkedGenres() {
    if (allGenresInput.checked) return [];
    return Array.from(genresList.querySelectorAll('input:checked')).map(function (input) { return input.value; });
  }

  function updatePreview() {
    var genres = checkedGenres();
    var targetInput = modal.querySelector('input[name="sp-limit"]:checked');
    var target = targetInput && targetInput.value === '100' ? 100 : 50;
    var candidates = getRandomDiscoveryCandidates(genres);
    var capacity = getRandomDiscoveryCapacity(candidates);
    var selectionSize = Math.min(target, capacity);
    summary.textContent = genres.length ? genres.length + ' genre' + (genres.length === 1 ? '' : 's') + ' selected' : 'Uses every playable track';
    previewNum.textContent = selectionSize;
    previewCopy.textContent = selectionSize
      ? 'tracks will be selected from ' + candidates.length + ' matching tracks'
      : 'tracks available for this mix';
    createButton.disabled = selectionSize === 0;
    errorEl.hidden = selectionSize > 0;
    if (!selectionSize) errorEl.textContent = state.musicFiles.length
      ? 'No playable tracks match these genres. Choose All genres or another selection.'
      : 'Import music before creating a Smart Mix.';
  }

  allGenresInput.onchange = function () {
    if (!allGenresInput.checked) { allGenresInput.checked = true; return; }
    genresList.querySelectorAll('input').forEach(function (input) { input.checked = false; });
    updatePreview();
  };
  genresList.querySelectorAll('input').forEach(function (input) {
    input.onchange = function () {
      var anySelected = !!genresList.querySelector('input:checked');
      allGenresInput.checked = !anySelected;
      updatePreview();
    };
  });
  modal.querySelectorAll('input[name="sp-limit"]').forEach(function (input) { input.onchange = updatePreview; });
  updatePreview();
  showModal(modal, { initialFocus: '#sp-name-input' });

  $('sp-cancel-btn').onclick = function () { smartPlaylistBeingEditedId = null; hideModal(modal); };
  modal.onclick = function (e) { if (e.target === modal) hideModal(modal); };

  createButton.onclick = async function () {
    if (createButton.disabled) return;
    var name = nameInput.value.trim() || 'Random Discovery';
    var targetInput = modal.querySelector('input[name="sp-limit"]:checked');
    var rule = { field: RANDOM_DISCOVERY_FIELD, genres: checkedGenres(), limit: targetInput && targetInput.value === '100' ? 100 : 50, albumLimit: RANDOM_DISCOVERY_ALBUM_LIMIT };
    var trackPaths = generateRandomDiscoveryPaths(rule);
    if (!trackPaths.length) { updatePreview(); return; }
    var colors = ['linear-gradient(135deg,#171717,#4A4A4A)', 'linear-gradient(135deg,#202020,#666666)', 'linear-gradient(135deg,#292929,#7A7A7A)', 'linear-gradient(135deg,#111111,#555555)'];
    var customs = Array.isArray(appSettings.customSmartPlaylists) ? appSettings.customSmartPlaylists.slice() : [];
    var existing = smartPlaylistBeingEditedId ? customs.find(function (candidate) { return candidate.id === smartPlaylistBeingEditedId; }) : null;
    if (!existing && customs.length >= 100) {
      errorEl.textContent = 'Playerinyo supports up to 100 custom Smart Mixes. Delete one before creating another.';
      errorEl.hidden = false;
      return;
    }
    var savedPlaylist = Object.assign({}, existing || {}, {
      id: existing ? existing.id : 'sp_custom_' + Date.now(),
      name: name,
      icon: 'ph-sparkle',
      color: existing && existing.color ? existing.color : colors[customs.length % colors.length],
      type: 'smart',
      rule: rule,
      trackPaths: trackPaths,
      desc: 'Stable random discovery mix'
    });
    if (existing) customs = customs.map(function (candidate) { return candidate.id === existing.id ? savedPlaylist : candidate; });
    else customs.push(savedPlaylist);
    createButton.disabled = true;
    try {
      await saveCustomSmartPlaylists(customs);
      smartPlaylistBeingEditedId = null;
      hideModal(modal);
      renderSidebarPlaylists();
      if (existing && state.currentView === existing.id) openSmartPlaylist(savedPlaylist);
      else switchView(savedPlaylist.id);
    } catch (error) {
      createButton.disabled = false;
      errorEl.textContent = 'The Smart Mix could not be saved. Check disk space and permissions, then try again.';
      errorEl.hidden = false;
    }
  };
}

/* ─── LISTENING STATS ─── */
var statsSourceFilter = 'all';
function getListeningStatSource(track) { return isRemotePlaybackTrack(track) ? 'remote' : 'local'; }
function normalizeListeningStatSources(value) {
  if (window.ListeningStatsSources) return window.ListeningStatsSources.normalize(value);
  var result = { local: { count: 0, time: 0 }, remote: { count: 0, time: 0 } };
  ['local', 'remote'].forEach(function(source) {
    var row = value && value[source];
    if (!row || typeof row !== 'object') return;
    result[source].count = Math.max(0, Number(row.count) || 0);
    result[source].time = Math.max(0, Number(row.time) || 0);
  });
  return result;
}
function addListeningStatSource(row, source, count, time) {
  if (window.ListeningStatsSources) return window.ListeningStatsSources.add(row, source, count, time);
  var sources = normalizeListeningStatSources(row.sources);
  sources[source].count += Math.max(0, Number(count) || 0);
  sources[source].time += Math.max(0, Number(time) || 0);
  row.sources = sources;
}
function mergeListeningStatSources(target, source) {
  if (window.ListeningStatsSources) return window.ListeningStatsSources.merge(target, source);
  var sources = normalizeListeningStatSources(source && source.sources);
  addListeningStatSource(target, 'local', sources.local.count, sources.local.time);
  addListeningStatSource(target, 'remote', sources.remote.count, sources.remote.time);
}
function listeningStatValuesForSource(entry, source) {
  if (window.ListeningStatsSources) return window.ListeningStatsSources.values(entry, source);
  if (source === 'all') return { count: Number(entry.count) || 0, time: Number(entry.time) || 0 };
  var values = normalizeListeningStatSources(entry.sources)[source];
  return { count: values.count, time: values.time };
}
function getListeningStatIdentity(track) {
  var source = track && track.matchedFile ? Object.assign({}, track.matchedFile, track) : track;
  if (window.RadioPreferences && window.RadioPreferences.radioTrackKey) return window.RadioPreferences.radioTrackKey(source);
  var artist = String(source && source.artist || '').trim().toLocaleLowerCase(); var title = String(source && source.title || '').trim().toLocaleLowerCase();
  return artist && title ? 'name:' + artist + '::' + title : '';
}
function getListeningStatNameKey(track) {
  var source = track && track.matchedFile ? Object.assign({}, track.matchedFile, track) : track;
  if (window.RadioPreferences && window.RadioPreferences.radioTrackKey) return window.RadioPreferences.radioTrackKey({ artist: source && source.artist, title: source && source.title });
  return getListeningStatIdentity({ artist: source && source.artist, title: source && source.title });
}
function getListeningStats() {
  return listeningStats && typeof listeningStats === 'object' ? listeningStats : {};
}
function migrateLegacyPathStats() {
  var counts = appSettings.playCounts && typeof appSettings.playCounts === 'object' ? appSettings.playCounts : null;
  var times = appSettings.playTimes && typeof appSettings.playTimes === 'object' ? appSettings.playTimes : null;
  if (!counts && !times) return false;
  var byPath = getLibraryIndex().byPath;
  var stats = getListeningStats();
  var remainingCounts = {};
  var remainingTimes = {};
  var paths = new Set(Object.keys(counts || {}).concat(Object.keys(times || {})));
  var migrated = false;
  paths.forEach(function (filePath) {
    var file = byPath.get(filePath);
    if (!file) {
      if (counts && Object.prototype.hasOwnProperty.call(counts, filePath)) remainingCounts[filePath] = counts[filePath];
      if (times && Object.prototype.hasOwnProperty.call(times, filePath)) remainingTimes[filePath] = times[filePath];
      return;
    }
    var key = getListeningStatIdentity(file);
    if (!key) return;
    var row = stats[key] && typeof stats[key] === 'object' ? stats[key] : { count: 0, time: 0 };
    row.count = (Number(row.count) || 0) + (Number(counts && counts[filePath]) || 0);
    row.time = (Number(row.time) || 0) + (Number(times && times[filePath]) || 0);
    row.title = row.title || file.title || 'Unknown Track';
    row.artist = row.artist || file.artist || 'Unknown Artist';
    row.album = row.album || file.album || '';
    row.albumArtist = row.albumArtist || file.albumArtist || file.artist || '';
    row.picture = row.picture || file.picture || '';
    row.trackMbid = row.trackMbid || file.trackMbid || '';
    row.nameKey = row.nameKey || getListeningStatNameKey(file);
    row.filePath = file.filePath;
    stats[key] = row;
    migrated = true;
  });
  if (!migrated) return false;
  listeningStats = stats;
  if (Object.keys(remainingCounts).length) appSettings.playCounts = remainingCounts;
  else delete appSettings.playCounts;
  if (Object.keys(remainingTimes).length) appSettings.playTimes = remainingTimes;
  else delete appSettings.playTimes;
  return true;
}
function getListeningStatEntries() {
  var entries = {}; var byPath = getLibraryIndex().byPath;
  Object.keys(appSettings.playCounts || {}).forEach(function (path) { var file = byPath.get(path); var key = file && getListeningStatIdentity(file); if (!key) return; var row = entries[key] || (entries[key] = { key:key, count:0, time:0, file:file, title:file.title, artist:file.artist, album:file.album, albumArtist:file.albumArtist || file.artist, picture:file.picture || '' }); row.count += Number(appSettings.playCounts[path]) || 0; row.time += Number((appSettings.playTimes || {})[path]) || 0; });
  Object.keys(getListeningStats()).forEach(function (key) { var saved = getListeningStats()[key]; if (!saved || typeof saved !== 'object') return; var local = saved.filePath && byPath.get(saved.filePath); if (!entries[key] && saved.trackMbid && saved.nameKey && entries[saved.nameKey]) { entries[key] = entries[saved.nameKey]; entries[key].key = key; delete entries[saved.nameKey]; } var row = entries[key] || (entries[key] = { key:key, count:0, time:0 }); row.count += Number(saved.count) || 0; row.time += Number(saved.time) || 0; mergeListeningStatSources(row, saved); row.file = local || row.file; row.title = saved.title || (local && local.title) || row.title; row.artist = saved.artist || (local && local.artist) || row.artist; row.album = saved.album || (local && local.album) || row.album; row.albumArtist = saved.albumArtist || (local && local.albumArtist) || row.albumArtist || row.artist; row.picture = saved.picture || (local && local.picture) || row.picture || ''; });
  return Object.values(entries);
}
function recordPlayStat(track) {
  var key = getListeningStatIdentity(track); if (!key) return;
  var stats = getListeningStats(); var file = track.matchedFile; var nameKey = getListeningStatNameKey(track); var trackMbid = track.trackMbid || (file && file.trackMbid) || '';
  if (trackMbid) {
    Object.keys(stats).some(function (existingKey) { var existing = stats[existingKey]; if (existingKey === key || !existing || existing.nameKey !== nameKey || existing.trackMbid) return false; var target = stats[key] || { count: 0, time: 0 }; target.count = (Number(target.count) || 0) + (Number(existing.count) || 0); target.time = (Number(target.time) || 0) + (Number(existing.time) || 0); mergeListeningStatSources(target, existing); stats[key] = Object.assign({}, existing, target); delete stats[existingKey]; return true; });
  } else {
    Object.keys(stats).some(function (existingKey) { var existing = stats[existingKey]; if (existing && existing.nameKey === nameKey && existing.trackMbid) { key = existingKey; return true; } return false; });
  }
  var row = stats[key] && typeof stats[key] === 'object' ? stats[key] : { count: 0, time: 0 };
  row.count = (Number(row.count) || 0) + 1;
  addListeningStatSource(row, getListeningStatSource(track), 1, 0);
  row.title = track.title || (file && file.title) || row.title || 'Unknown Track'; row.artist = track.artist || (file && file.artist) || row.artist || 'Unknown Artist'; row.album = track.album || (file && file.album) || row.album || ''; row.albumArtist = track.albumArtist || (file && file.albumArtist) || row.albumArtist || row.artist; row.picture = getTrackArtworkUrl(track) || row.picture || ''; row.trackMbid = trackMbid || row.trackMbid || ''; row.nameKey = nameKey; if (file && file.filePath) row.filePath = file.filePath;
  stats[key] = row; listeningStats = stats; saveListeningStatsDebounced(1000);
}

function recordListeningProgress(audioEl) {
  if (!state.currentPlayingTrack || !audioEl || audioEl.paused) return;
  var current = audioEl.currentTime || 0;
  var last = state._lastStatsTime;
  state._lastStatsTime = current;
  if (last === null || last === undefined) return;
  var delta = current - last;
  if (delta <= 0 || delta > 5) return;
  var key = getListeningStatIdentity(state.currentPlayingTrack); if (!key) return;
  var stats = getListeningStats(); var row = stats[key] && typeof stats[key] === 'object' ? stats[key] : { count: 0, time: 0 };
  row.time = (Number(row.time) || 0) + delta; addListeningStatSource(row, getListeningStatSource(state.currentPlayingTrack), 0, delta); stats[key] = row; listeningStats = stats;
  state._unsavedStatsSeconds = (state._unsavedStatsSeconds || 0) + delta;
  if (state._unsavedStatsSeconds >= 30) {
    state._unsavedStatsSeconds = 0;
    saveListeningStatsDebounced(1000);
  }
}

function renderStatsView() {
  var container = $('stats-container');
  if (!container) return;
  setViewKind('stats');
  container.style.display = 'block';
  var trackEntries = getListeningStatEntries().map(function(entry) {
    var values = listeningStatValuesForSource(entry, statsSourceFilter);
    return Object.assign({}, entry, values);
  }).filter(function(entry) { return entry.count > 0 || entry.time > 0; }).sort(function(a,b){return b.count-a.count;});
  var totalSecs = trackEntries.reduce(function(sum, entry) { return sum + entry.time; }, 0);
  var totalHrs = Math.floor(totalSecs/3600), totalMins = Math.floor((totalSecs%3600)/60);
  var artistCounts = {};
  trackEntries.forEach(function(e){var a=e.artist||'Unknown';artistCounts[a]=(artistCounts[a]||0)+e.count;});
  var topArtists = Object.keys(artistCounts).map(function(a){return{name:a,count:artistCounts[a]};}).sort(function(a,b){return b.count-a.count;}).slice(0,6);
  var albumCounts = {};
  trackEntries.forEach(function(e){var k=getAlbumKey({ album:e.album || 'Unknown Album', albumArtist:e.albumArtist || e.artist || 'Unknown Artist', artist:e.artist || 'Unknown Artist' });albumCounts[k]=(albumCounts[k]||0)+e.count;});
  var topAlbums = Object.keys(albumCounts).map(function(k){return{name:k.split('::')[0],artist:k.split('::')[1],count:albumCounts[k]};}).sort(function(a,b){return b.count-a.count;}).slice(0,6);
  var maxCount = trackEntries.length>0?trackEntries[0].count:1;
  var maxArtist = topArtists.length>0?topArtists[0].count:1;
  var totalPlays = trackEntries.reduce(function(a,e){return a+e.count;},0);
  var html = '<div class="stats-view"><header class="stats-header"><h1>Listening history</h1><p>Your most played music across Playerinyo playback.</p><div class="stats-source-filter" role="group" aria-label="Listening source"><button type="button" class="btn btn-outline' + (statsSourceFilter === 'all' ? ' active' : '') + '" data-stats-source="all" aria-pressed="' + (statsSourceFilter === 'all') + '">All</button><button type="button" class="btn btn-outline' + (statsSourceFilter === 'local' ? ' active' : '') + '" data-stats-source="local" aria-pressed="' + (statsSourceFilter === 'local') + '">Local</button><button type="button" class="btn btn-outline' + (statsSourceFilter === 'remote' ? ' active' : '') + '" data-stats-source="remote" aria-pressed="' + (statsSourceFilter === 'remote') + '">Streamed</button></div></header>';
  html += '<div class="stats-totals">';
  [{label:'Total plays',val:totalPlays,icon:'ph-play'},{label:'Listening time',val:totalHrs+'h '+totalMins+'m',icon:'ph-clock'},{label:'Tracks played',val:trackEntries.length,icon:'ph-music-notes'},{label:'Artists',val:Object.keys(artistCounts).length,icon:'ph-microphone'}].forEach(function(c){
    html+='<div class="stats-total"><i class="ph '+c.icon+'" aria-hidden="true"></i><strong>'+c.val+'</strong><span>'+c.label+'</span></div>';
  });
  html += '</div>';
  if (trackEntries.length===0) { html+='<div class="stats-empty"><i class="ph ph-chart-bar" aria-hidden="true"></i><strong>No listening history yet</strong><span>' + (statsSourceFilter === 'all' ? 'Play a track and this view will begin to fill in.' : 'No source-labelled listening history yet. New plays are labelled automatically.') + '</span></div></div>'; container.innerHTML=html; bindStatsSourceFilter(container); return; }
  html += '<div class="stats-columns">';
  html += '<section class="stats-section stats-tracks"><h2>Top tracks</h2><div class="stats-list">';
  trackEntries.slice(0,10).forEach(function(e,i){
    var pct=Math.round((e.count/maxCount)*100);
    var cover=e.picture?'<img class="stats-cover" src="'+esc(e.picture)+'" alt="">':'<span class="stats-cover placeholder"><i class="ph ph-music-notes" aria-hidden="true"></i></span>';
    html+='<div class="stats-track"><span class="stats-rank">'+String(i+1).padStart(2,'0')+'</span>'+cover+'<span class="stats-track-copy"><strong>'+esc(e.title||'Unknown')+'</strong><small>'+esc(e.artist||'Unknown')+'</small><span class="stats-meter"><i style="width:'+pct+'%"></i></span></span><span class="stats-count">'+e.count+' plays</span></div>';
  });
  html += '</div></section><div class="stats-secondary">';
  html += '<section class="stats-section"><h2>Top artists</h2><div class="stats-list">';
  topArtists.forEach(function(a){
    var pct=Math.round((a.count/maxArtist)*100);
    html+='<div class="stats-artist"><span><strong>'+esc(a.name)+'</strong><small>'+a.count+' plays</small></span><span class="stats-meter"><i style="width:'+pct+'%"></i></span></div>';
  });
  html += '</div></section><section class="stats-section"><h2>Top albums</h2><div class="stats-list">';
  topAlbums.forEach(function(a){
    html+='<div class="stats-album"><span><strong>'+esc(a.name)+'</strong><small>'+esc(a.artist)+'</small></span><span class="stats-count">'+a.count+' plays</span></div>';
  });
  html += '</div></section></div></div></div>';
  container.innerHTML = html;
  bindStatsSourceFilter(container);
}

function bindStatsSourceFilter(container) {
  container.querySelectorAll('[data-stats-source]').forEach(function(button) {
    button.addEventListener('click', function() {
      var source = button.dataset.statsSource;
      if (source === statsSourceFilter || ['all', 'local', 'remote'].indexOf(source) === -1) return;
      statsSourceFilter = source;
      renderStatsView();
    });
  });
}

// Simple debounce function
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function filterPlaylistTrackRows(value) {
  window._tracksFilterValue = String(value || '');
  window._tracksFilterView = state.currentView;
  renderTracksTable(!!window._tracksAllowReorder);
}

// Playlist track search logic
var trackSearchInput = $('playlist-track-search');
if (trackSearchInput) {
  trackSearchInput.addEventListener('input', debounce(function (e) {
    filterPlaylistTrackRows(e.target.value);
  }, 300));
}

// Global Ctrl+F listener
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    if (shouldIgnoreAppShortcut(e)) return;
    e.preventDefault();
    if (e.repeat) return;
    // Check which search to focus
    var trackSearch = $('playlist-track-search');
    var globalSearch = $('global-search');
    var playlistControls = $('playlist-controls-container');
    
    if (playlistControls && playlistControls.style.display !== 'none' && trackSearch) {
      trackSearch.focus();
    } else if (globalSearch) {
      globalSearch.focus();
    }
  }
});
