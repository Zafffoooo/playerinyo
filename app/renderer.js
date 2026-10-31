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
const DEFAULT_APP_SETTINGS = { minimizeToTray: false, audioMode: 'stereo', audioOutputDeviceId: '', discordApplicationId: '1563774809563988080', discordArtworkSource: 'lookup', discordShowProgress: true, discordShowPaused: false, discordTextFormat: 'title-artist', sidebarWidth: 560, glassEffects: true, isPlaylistGridView: true, dockMode: 'collapsed', ytdlDownloadFolder: '', ytdlDownloadQuality: 'best-native', ytdlCookiesMode: 'none', ytdlCookiesBrowser: 'firefox', ytdlCookiesFile: '', automaticBackupsEnabled: true, radioPreferences: window.RadioPreferences ? window.RadioPreferences.sanitizeRadioPreferences() : {}, radioBlocklist: window.RadioPreferences ? window.RadioPreferences.sanitizeRadioBlocklist() : { version: 1, tracks: [], artists: [] } };
let appSettings = Object.assign({}, DEFAULT_APP_SETTINGS);
let audioCtx, audioGainNode, audioCompressor;
let currentContextMenuTrack = null;
let currentContextMenuPlaylist = null;
let currentContextMenuAlbum = null;
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
let lyricsRawText = '';
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
let trackSelectionAnchorKey = '';
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
let confirmationResolver = null;
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
let preparedLocalSlot = null;
let localGaplessFrame = null;
let lastPlaybackSessionCheckpointAt = 0;
let metadataWriteLockedPaths = new Set();
let libraryScanGeneration = 0;
let libraryScanInProgress = 0;
let appStateCommitInProgress = false;
let automaticBackupUiBusy = false;
let automaticBackupUiStatus = null;
const libraryRenderState = { albums: [], index: 0, chunk: 80, renderAll: true, token: 0, frame: null };
const trackRenderState = { source: [], tracks: [], rows: [], index: 0, chunk: 80, renderAll: true, token: 0, frame: null, allowReorder: false, virtualized: false, virtualStart: -1, virtualEnd: -1, hasMultipleDiscs: false, filterValue: '', filterView: '', likedSongsSet: new Set(), playlistMembership: null, playlistMembershipRevision: -1 };
const searchRenderState = { albumQuery: '', albumRenderLimit: 200 };
let genreRenderToken = 0;
let visualizerDataArray = null;
let renderLibraryChunk = null;
let renderTracksChunk = null;
let renderVirtualTracksWindow = null;
const BACKFILL_METADATA_FIELDS = ['addedAtMs', 'duration', 'trackMbid', 'year', 'genre', 'discNo', 'discTotal', 'trackTotal', 'replayGainTrackDb', 'replayGainAlbumDb', 'replayGainTrackPeak', 'replayGainAlbumPeak'];




function $(id) { return document.getElementById(id); }
function parseStoredArray(key) { try { var value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch (e) { return []; } }
function esc(v) { return String(v === null || v === undefined ? '' : v).replace(/[&<>"']/g, function (ch) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]; }); }
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
    if (options.pauseOnHover === false) {
      toast.onmouseenter = toast.onmouseleave = toast.onfocusin = toast.onfocusout = null;
    } else {
      toast.onmouseenter = function () { clearTimeout(toastHideTimer); };
      toast.onmouseleave = function () { toastHideTimer = setTimeout(dismiss, 1200); };
      toast.onfocusin = function () { clearTimeout(toastHideTimer); };
      toast.onfocusout = function () { toastHideTimer = setTimeout(dismiss, 1200); };
    }
  } else {
    toast.onmouseenter = toast.onmouseleave = toast.onfocusin = toast.onfocusout = null;
  }
}
function notifyUser(message) {
  showToast(String(message || ''), { persistent: true });
}
function settleConfirmation(value) {
  var resolve = confirmationResolver;
  confirmationResolver = null;
  hideModal($('app-confirm-modal'));
  if (resolve) resolve(value === true);
}
function requestConfirmation(message) {
  if (confirmationResolver) settleConfirmation(false);
  var copy = $('app-confirm-message');
  if (copy) copy.textContent = String(message || '');
  showModal($('app-confirm-modal'), { initialFocus: '#app-confirm-cancel' });
  return new Promise(function (resolve) { confirmationResolver = resolve; });
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
const songRadioDiscoveryClient = window.api ? { similar: function (seed) { return window.api.getSongRadioSimilar(seed); } } : null;
const radioProviderRegistry = window.RadioProviders ? window.RadioProviders.createRadioProviderRegistry([
  window.RadioProviders.createLocalLibraryProvider(),
  window.RadioProviders.createLastfmProvider(lastfmRadioDiscoveryClient),
  window.RadioProviders.createSongRadioProvider(songRadioDiscoveryClient)
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
let songRadioPreviousQueue = null;
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
  trackRenderState.playlistMembership = null;
  trackRenderState.playlistMembershipRevision = -1;
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


async function mergeBackfilledMetadata(result) {
  if (!result || result.ok !== true || !Array.isArray(result.updates)) return;
  var index = getLibraryIndex();
  var changed = false;
  result.updates.forEach(function (patch) {
    if (!patch || !patch.filePath) return;
    var current = index.byPath.get(patch.filePath) || index.byStrippedPath.get(stripFileUrl(patch.filePath));
    if (!current) return;
    if (typeof patch.metadataBackfillSig === 'string' && current.metadataBackfillSig !== patch.metadataBackfillSig) {
      current.metadataBackfillSig = patch.metadataBackfillSig;
      changed = true;
    }
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
    // Stamp format "1:<fileSize>:<modifiedAtMs>" is defined in metadata-backfill.js (renderer cannot require it).
    if (file.metadataBackfillSig === '1:' + String(file.fileSize) + ':' + String(file.modifiedAtMs)) return false;
    // A stale or missing stamp only warrants a re-parse while something is still missing.
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
  var list = audioEls || (typeof audioEls !== 'undefined' ? audioEls : null);
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
  if (el.id === 'playlist-text-dialog') { el.querySelector('[data-cancel]').click(); return; }
  if (el.id === 'playlist-import-modal') { var pic = $('playlist-import-cancel-x') || $('playlist-import-cancel'); if (pic) pic.click(); return; }
  if (el.id === 'playlist-cover-crop-modal') { $('playlist-cover-crop-cancel').click(); return; }
  if (el.id === 'playlist-import-source-modal') { var pis = $('playlist-import-source-cancel'); if (pis) pis.click(); return; }
  if (el.id === 'album-download-modal') { closeAlbumDownloadModal(); return; }
  if (el.id === 'add-songs-modal') { var asc = $('btn-close-add-songs'); if (asc) asc.click(); return; }
  if (el.id === 'delete-confirm-modal') { var dc = $('delete-cancel-btn'); if (dc) dc.click(); return; }
  if (el.id === 'app-confirm-modal') { settleConfirmation(false); return; }
  if (el.id === 'metadata-modal') { var mc = $('meta-cancel-btn'); if (mc && !mc.disabled) mc.click(); return; }
  if (el.id === 'moved-files-modal') { var movedCancel = $('moved-files-cancel'); if (movedCancel && !movedCancel.disabled) movedCancel.click(); return; }
  if (el.id === 'command-palette-modal') { closeCommandPalette(); return; }
  if (el.id === 'lyrics-editor-modal') { closeLyricsEditor(); return; }
  hideModal(el);
}


var appConfirmCancel = null;

var appConfirmContinue = null;

var appConfirmModal = null;

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
  if (typeof showSettingsPage === 'function') showSettingsPage(typeof activeSettingsPage === 'string' ? activeSettingsPage : 'library');
  var content = modal ? modal.querySelector('.modal-content') : null;
  if (content) content.scrollTop = 0;
  if (typeof refreshSafeStorageStatus === 'function') refreshSafeStorageStatus();
  if (typeof refreshDownloadFolderUi === 'function') refreshDownloadFolderUi();
  if (typeof refreshAutomaticBackupStatus === 'function') refreshAutomaticBackupStatus();
  if (typeof refreshAudioOutputDevices === 'function') refreshAudioOutputDevices();
}
function deepCloneForUndo(value) {
  if (value === undefined) return undefined;
  if (typeof structuredClone === 'function') {
    try { return structuredClone(value); } catch (e) { /* JSON fallback handles non-cloneable undo data. */ }
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
  if (normalizePlaylistEntryIds()) await persistPlaylists(state.playlists);
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
  showToast(message, { actionLabel: 'Undo', duration: 5000, pauseOnHover: false, onAction: function () { return undoLastAction(snapshot.id); } });
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
    audioOutputReady = applyAudioOutputPreference();
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
function getTrackNote(file) { return file && file.filePath && appSettings.trackNotes ? String(appSettings.trackNotes[file.filePath] || '') : ''; }
function getAlbumNote(file) { return file && appSettings.albumNotes ? String(appSettings.albumNotes[getAlbumKey(file)] || '') : ''; }
function buildFileSearchText(file) { return [file.title, file.artist, file.album, file.albumArtist, file.genre, file.year, file.filename, getTrackNote(file), getAlbumNote(file)].map(function (v) { return v === null || v === undefined ? '' : String(v); }).join(' ').toLowerCase(); }
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
function syncPlaylistTrackDetailsFromLibrary(files) {
  var filesByPath = new Map();
  (files || []).forEach(function (file) {
    var filePath = stripFileUrl(file && file.filePath);
    if (filePath) filesByPath.set(filePath, file);
  });
  if (!filesByPath.size) return { updated: 0, playlistIds: [], changes: [] };

  var updated = 0;
  var playlistIds = new Set();
  var changes = [];
  state.playlists.forEach(function (playlist) {
    if (!playlist || playlist.isSpecial || !Array.isArray(playlist.tracks)) return;
    playlist.tracks.forEach(function (record) {
      var file = filesByPath.get(stripFileUrl(getPlaylistTrackFilePath(record)));
      if (!file) return;
      var changed = false;
      [['Song', file.title], ['Artist', file.artist], ['Album', file.album]].forEach(function (entry) {
        var value = String(entry[1] || '');
        if (String(record[entry[0]] || '') !== value) {
          changes.push({ record: record, key: entry[0], hadKey: Object.prototype.hasOwnProperty.call(record, entry[0]), value: record[entry[0]] });
          record[entry[0]] = value;
          changed = true;
        }
      });
      if (changed) {
        updated++;
        playlistIds.add(playlist.id);
      }
    });
  });
  return { updated: updated, playlistIds: Array.from(playlistIds), changes: changes };
}
function revertPlaylistTrackDetailsSync(sync) {
  if (!sync || !Array.isArray(sync.changes)) return;
  for (var i = sync.changes.length - 1; i >= 0; i--) {
    var change = sync.changes[i];
    if (change.hadKey) change.record[change.key] = change.value;
    else delete change.record[change.key];
  }
}
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
  if (track.csvRecord && track.csvRecord.EntryId) return 'entry::' + track.csvRecord.EntryId;
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
  trackSelectionAnchorKey = '';
  document.querySelectorAll('#tracks-body tr.track-selected').forEach(function (row) { row.classList.remove('track-selected'); row.setAttribute('aria-selected', 'false'); });
}
function makePlaylistTrackRecord(track) {
  var filePath = track.filePath || (track.matchedFile && track.matchedFile.filePath) || '';
  var record = { EntryId: createQueueEntryId(), Song: track.title || '', Artist: track.artist || '', Album: track.album || '', FilePath: filePath, AddedAtMs: Date.now() };
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
  if (!record.EntryId) record.EntryId = createQueueEntryId();
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
  var playlistFilters=$('playlist-status-filters');if(playlistFilters)playlistFilters.hidden=true;
  ['home-dashboard-container', 'albums-grid-container', 'tracks-table-container', 'search-albums-container', 'playlists-grid-container', 'stats-container', 'metadata-health-container', 'radio-container', 'youtube-music-results', 'artist-profile-container', 'download-queue-panel'].forEach(function (id) {
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
function initCoreControls() {
  window.addEventListener('error', function (event) {
    if (startupInProgress) renderStartupError(event.error || new Error(event.message || 'Renderer startup failed.'));
  });
  window.addEventListener('unhandledrejection', function (event) {
    if (startupInProgress) renderStartupError(event.reason instanceof Error ? event.reason : new Error(String(event.reason || 'Renderer startup failed.')));
  });
  window.addEventListener('beforeunload', function () { flushSettingsSave().catch(function (e) { console.error(e); }); persistDownloadQueueStateNow(); });
  if (window.api.onPrepareAppClose && window.api.appCloseReady) {
    window.api.onPrepareAppClose(async function () {
      persistDownloadQueueStateNow();
      try { await flushSettingsSave(); }
      catch (e) { console.error(e); }
      window.api.appCloseReady();
    });
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
  appConfirmCancel = $('app-confirm-cancel');
  if (appConfirmCancel) appConfirmCancel.addEventListener('click', function () { settleConfirmation(false); });
  appConfirmContinue = $('app-confirm-continue');
  if (appConfirmContinue) appConfirmContinue.addEventListener('click', function () { settleConfirmation(true); });
  appConfirmModal = $('app-confirm-modal');
  if (appConfirmModal) appConfirmModal.addEventListener('click', function (event) { if (event.target === appConfirmModal) settleConfirmation(false); });
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
}
