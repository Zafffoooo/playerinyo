var audioEls = null;
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
  var percent = Math.round(volume * 100);
  document.querySelectorAll('.volume-bar').forEach(function (bar) { bar.style.width = (volume * 100) + '%'; });
  document.querySelectorAll('.volume-bar-container').forEach(function (slider) {
    slider.setAttribute('aria-valuenow', String(percent));
    slider.setAttribute('aria-valuetext', percent + ' percent');
  });
  document.querySelectorAll('.volume-value').forEach(function (valueOutput) { valueOutput.textContent = percent + '%'; });
  document.querySelectorAll('.player-volume-icon').forEach(function (volumeToggle) {
    var icon = volumeToggle.querySelector('i');
    if (icon) icon.className = volume === 0 ? 'ph ph-speaker-x' : (volume < 0.5 ? 'ph ph-speaker-low' : 'ph ph-speaker-high');
    volumeToggle.setAttribute('aria-label', volume === 0 ? 'Unmute' : 'Mute');
    volumeToggle.setAttribute('aria-pressed', volume === 0 ? 'true' : 'false');
  });
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
function handleVolumeWheel(e) {
  if (!e.deltaY) return;
  e.preventDefault();
  var current = appSettings.volume === undefined ? 1 : Number(appSettings.volume);
  setVolumeLevel(current + (e.deltaY < 0 ? .05 : -.05));
}

var pc = null;








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
  (audioEls || []).forEach(function (audio) { if (audio) audio._restoringSession = false; });
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
    try { audio.currentTime = Math.min(position, maxPosition); } catch (e) { /* A stream may reject restoring its seek position. */ }
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







// Global keyboard: N = Now Playing overlay

/* ─── ALBUM COVER SLIDESHOW (Now Playing) ─── */
let _npSlideshowTimer = null;
let _npFolderImageCache = new Map();
let _npFolderImageCacheTimes = new Map();
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
  var renderToken = (genreRenderToken = (genreRenderToken || 0) + 1);
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
        notifyUser('Right-click any album or track and choose "Edit Metadata", then use the "Auto-Tag" tab to search MusicBrainz.');
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
      currentContextMenuAlbum = album;
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
      if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); currentContextMenuAlbum = album; positionContextMenu($('album-context-menu'), 0, 0, card); }
    });

    return card;
  }

  // Build cards in rAF chunks so huge libraries don't freeze the UI in one pass;
  // the token cancels a stale render if the view re-renders meanwhile.
  function processCardChunk(start) {
    if (renderToken !== genreRenderToken) return;
    var end = Math.min(start + 80, cardWork.length);
    for (var i = start; i < end; i++) cardWork[i].grid.appendChild(buildGenreAlbumCard(cardWork[i].album));
    if (end < cardWork.length) requestAnimationFrame(function () { processCardChunk(end); });
  }
  processCardChunk(0);
}



/* ─── SMART PLAYLISTS ─── */
var RANDOM_DISCOVERY_FIELD = 'randomDiscovery';
var RANDOM_DISCOVERY_ALBUM_LIMIT = 5;
var DAILY_SMART_PLAYLIST_LIMIT = 50;
var DAILY_SMART_PLAYLIST_ALBUM_LIMIT = 2;
var DAILY_SMART_PLAYLISTS = [
  { id: 'sp_daily_discovery', name: 'Günün Keşfi', icon: 'ph-sparkle', color: 'linear-gradient(135deg,#171717,#4A4A4A)', type: 'smart', rule: { field: 'daily', mode: 'discovery' }, desc: 'Fresh local discoveries, renewed daily' },
  { id: 'sp_daily_rediscover', name: 'Yeniden Dinle', icon: 'ph-arrow-counter-clockwise', color: 'linear-gradient(135deg,#202020,#666666)', type: 'smart', rule: { field: 'daily', mode: 'rediscover' }, desc: 'A daily pull from records you know' },
  { id: 'sp_daily_unplayed', name: 'Hiç Çalmadıkların', icon: 'ph-play-circle', color: 'linear-gradient(135deg,#111111,#555555)', type: 'smart', rule: { field: 'daily', mode: 'unplayed' }, desc: 'A daily path into unheard tracks' },
];
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
  return custom.concat(DAILY_SMART_PLAYLISTS, DEFAULT_SMART_PLAYLISTS);
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

function getDailySmartPlaylistFiles(mode) {
  var playedPaths = new Set((state.playHistory || []).map(function (entry) {
    return entry && entry.matchedFile && entry.matchedFile.filePath || entry && entry.filePath || '';
  }).filter(Boolean));
  var files = state.musicFiles.filter(function (file) { return file && file.filePath && !libraryMissingFilePaths.has(file.filePath); });
  var dayKey = new Date().toLocaleDateString('en-CA');
  if (!window.DailySmartPlaylists || typeof window.DailySmartPlaylists.selectTracks !== 'function') return [];
  return window.DailySmartPlaylists.selectTracks({
    files: files,
    mode: mode,
    dayKey: dayKey,
    playedPaths: playedPaths,
    limit: DAILY_SMART_PLAYLIST_LIMIT,
    albumLimit: DAILY_SMART_PLAYLIST_ALBUM_LIMIT,
    albumKey: getAlbumKey,
  });
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

  if (rule.field === 'daily') {
    tracks = getDailySmartPlaylistFiles(rule.mode).map(smartPlaylistTrackFromFile);
  } else if (Array.isArray(sp.rules)) {
    var likedPaths = new Set(state.likedSongs || []);
    var playedPaths = new Set((state.playHistory || []).map(function (entry) { return entry && entry.matchedFile && entry.matchedFile.filePath || entry && entry.filePath || ''; }));
    tracks = state.musicFiles.filter(function (file) {
      return sp.rules.every(function (smartRule) {
        var value = String(smartRule.value || '');
        var searchable = String(file[smartRule.field] || '').toLowerCase();
        if (smartRule.field === 'artist' || smartRule.field === 'album' || smartRule.field === 'genre') return searchable.includes(value.toLowerCase());
        if (smartRule.field === 'year') return Number(file.year || file.date || 0) === Number(value);
        if (smartRule.field === 'duration_min') return Number(file.duration || 0) >= Number(value);
        if (smartRule.field === 'duration_max') return Number(file.duration || 0) <= Number(value);
        if (smartRule.field === 'liked') return likedPaths.has(file.filePath) === (value === 'true');
        if (smartRule.field === 'played') return playedPaths.has(file.filePath) === (value === 'true');
        return false;
      });
    }).map(function (file) { return smartPlaylistTrackFromFile(file); });
  } else if (rule.field === RANDOM_DISCOVERY_FIELD) {
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
    var dec = parseInt(rule.value, 10);
    state.musicFiles.filter(function (f) {
      var yr = parseInt(f.year || f.date || 0, 10);
      return yr >= dec && yr < dec + 10;
    }).forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'year') {
    var yr = parseInt(rule.value, 10);
    state.musicFiles.filter(function (f) { return parseInt(f.year || f.date || 0, 10) === yr; })
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

function appendSmartPlaylistCard(list, playlist, tracks, options) {
    options = options || {};
    var card = document.createElement('button');
    card.type = 'button';
    card.className = 'smart-mix-card' + (state.currentView === playlist.id ? ' active' : '') + (state.sourcePlaylistId === playlist.id ? ' playing-source' : '');
    card.dataset.searchText = [playlist.name, playlist.desc, getSmartPlaylistGenreSummary(playlist)].filter(Boolean).join(' ');
    card.setAttribute('aria-label', 'Open Smart Playlist ' + playlist.name + ', ' + tracks.length + ' tracks');

    var art = document.createElement('span');
    art.className = 'smart-mix-card-art';
    art.setAttribute('aria-hidden', 'true');
    appendSmartPlaylistArtwork(art, playlist, tracks);
    var kind = document.createElement('span');
    kind.className = 'smart-mix-card-kind';
    var needsReview = playlist.rule && playlist.rule.field === 'unplayed';
    kind.textContent = options.kind || (needsReview ? 'Needs review' : (playlist.rule && playlist.rule.field === 'daily' ? 'Daily' : (isRandomDiscoverySmartPlaylist(playlist) ? 'Discovery' : 'Live rule')));
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
}

function renderSmartPlaylistsGrid() {
  var list = $('smart-mixes-list');
  if (!list) return;
  list.replaceChildren();
  var customPlaylists = Array.isArray(appSettings.customSmartPlaylists) ? appSettings.customSmartPlaylists : [];
  var section = $('smart-mixes-section');
  if (section) section.hidden = customPlaylists.length === 0;
  customPlaylists.forEach(function (playlist) {
    appendSmartPlaylistCard(list, playlist, evaluateSmartPlaylist(playlist));
  });
}

function renderDailySmartPlaylists() {
  var list = $('home-daily-smart-playlists');
  var empty = $('home-daily-smart-playlists-empty');
  var section = $('home-daily-smart-playlists-section');
  if (!list || !empty || !section) return;
  list.replaceChildren();
  var available = 0;
  DAILY_SMART_PLAYLISTS.forEach(function (playlist) {
    var tracks = evaluateSmartPlaylist(playlist);
    if (!tracks.length) return;
    appendSmartPlaylistCard(list, playlist, tracks, { kind: 'Daily' });
    available++;
  });
  section.hidden = state.musicFiles.length === 0;
  empty.hidden = available > 0;
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
    $('album-detail-type').textContent = 'Smart Playlist';
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
    if (editButton) editButton.hidden = !(canRefreshOrEdit || Array.isArray(sp.rules));
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
    if (editButton && (canRefreshOrEdit || Array.isArray(sp.rules))) editButton.onclick = function () { Array.isArray(sp.rules) ? openRulePlaylistBuilder(sp) : openSmartPlaylistBuilder(sp); };
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

function openRulePlaylistBuilder(playlist) {
  var modal = $('smart-rule-playlist-modal');
  if (!modal) return;
  var editing = playlist && Array.isArray(playlist.rules) && isCustomSmartPlaylist(playlist) ? playlist : null;
  var nameInput = $('srp-name');
  var rulesRoot = $('srp-rules');
  var error = $('srp-error');
  var preview = $('srp-preview-num');
  var save = $('srp-save');
  var ruleOptions = [
    ['artist', 'Artist contains'], ['album', 'Album contains'], ['genre', 'Genre contains'], ['year', 'Year is'],
    ['duration_min', 'Duration is at least (seconds)'], ['duration_max', 'Duration is at most (seconds)'],
    ['liked', 'Liked'], ['played', 'Played']
  ];
  var rules = editing ? editing.rules.map(function (rule) { return Object.assign({}, rule); }) : [{ field: 'liked', value: 'true' }];
  nameInput.value = editing ? editing.name : '';
  $('srp-title').textContent = editing ? 'Edit Smart Playlist' : 'New Smart Playlist';
  save.textContent = editing ? 'Save Playlist' : 'Create Playlist';
  error.hidden = true;

  function renderRules() {
    rulesRoot.replaceChildren();
    rules.forEach(function (rule, index) {
      var row = document.createElement('div'); row.className = 'smart-rule-row';
      var field = document.createElement('select'); field.setAttribute('aria-label', 'Rule field');
      ruleOptions.forEach(function (option) { var item = document.createElement('option'); item.value = option[0]; item.textContent = option[1]; item.selected = rule.field === option[0]; field.appendChild(item); });
      var value = document.createElement(rule.field === 'liked' || rule.field === 'played' ? 'select' : 'input');
      value.className = 'smart-rule-value'; value.setAttribute('aria-label', 'Rule value');
      if (value.tagName === 'SELECT') { [['true', 'Yes'], ['false', 'No']].forEach(function (option) { var item = document.createElement('option'); item.value = option[0]; item.textContent = option[1]; item.selected = String(rule.value) === option[0]; value.appendChild(item); }); }
      else { value.type = rule.field === 'year' || rule.field.indexOf('duration_') === 0 ? 'number' : 'text'; value.min = '0'; value.value = rule.value || ''; value.placeholder = rule.field.indexOf('duration_') === 0 ? 'Seconds' : (rule.field === 'year' ? 'Year' : 'Text'); }
      var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'icon-btn ghost'; remove.setAttribute('aria-label', 'Remove rule'); remove.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
      remove.disabled = rules.length === 1;
      field.addEventListener('change', function () { rule.field = field.value; rule.value = (rule.field === 'liked' || rule.field === 'played') ? 'true' : ''; renderRules(); updatePreview(); });
      value.addEventListener('input', function () { rule.value = value.value; updatePreview(); });
      remove.addEventListener('click', function () { rules.splice(index, 1); renderRules(); updatePreview(); });
      row.append(field, value, remove); rulesRoot.appendChild(row);
    });
  }
  function validRules() { return rules.length && rules.every(function (rule) { return String(rule.value || '').trim(); }); }
  function updatePreview() {
    var candidate = { rules: rules };
    var count = validRules() ? evaluateSmartPlaylist(candidate).length : 0;
    preview.textContent = count;
    save.disabled = !validRules();
    error.hidden = validRules();
    if (!validRules()) error.textContent = 'Complete every rule before saving this playlist.';
  }
  $('srp-add-rule').onclick = function () { if (rules.length < 12) { rules.push({ field: 'genre', value: '' }); renderRules(); updatePreview(); } };
  $('srp-cancel').onclick = function () { hideModal(modal); };
  modal.onclick = function (event) { if (event.target === modal) hideModal(modal); };
  save.onclick = async function () {
    var name = nameInput.value.trim();
    if (!name) { error.textContent = 'Give this Smart Playlist a name.'; error.hidden = false; nameInput.focus(); return; }
    if (!validRules()) { updatePreview(); return; }
    var customs = Array.isArray(appSettings.customSmartPlaylists) ? appSettings.customSmartPlaylists.slice() : [];
    if (!editing && customs.length >= 100) { error.textContent = 'Playerinyo supports up to 100 custom Smart Playlists.'; error.hidden = false; return; }
    var colors = ['linear-gradient(135deg,#171717,#4A4A4A)', 'linear-gradient(135deg,#202020,#666666)', 'linear-gradient(135deg,#292929,#7A7A7A)', 'linear-gradient(135deg,#111111,#555555)'];
    var saved = { id: editing ? editing.id : 'sp_custom_' + Date.now(), name: name, icon: 'ph-faders', color: editing && editing.color || colors[customs.length % colors.length], type: 'smart', rules: rules.map(function (rule) { return { field: rule.field, value: String(rule.value).trim() }; }), desc: rules.length + ' rule' + (rules.length === 1 ? '' : 's') + ', all must match' };
    if (editing) customs = customs.map(function (item) { return item.id === editing.id ? saved : item; }); else customs.push(saved);
    save.disabled = true;
    try { await saveCustomSmartPlaylists(customs); hideModal(modal); renderSidebarPlaylists(); if (editing && state.currentView === editing.id) openSmartPlaylist(saved); else switchView(saved.id); }
    catch (saveError) { save.disabled = false; error.textContent = 'The Smart Playlist could not be saved. Check disk space and permissions, then try again.'; error.hidden = false; }
  };
  renderRules(); updatePreview(); showModal(modal, { initialFocus: '#srp-name' });
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
  trackRenderState.filterValue = String(value || '');
  trackRenderState.filterView = state.currentView;
  renderTracksTable(!!trackRenderState.allowReorder);
}

// Playlist track search logic
var trackSearchInput = null;


// Global Ctrl+F listener


function initPlaybackControls() {
  audioEls = [$('audio-player-0'), $('audio-player-1')];
  var studioSourcePlaylist = $('studio-source-playlist');
  if (studioSourcePlaylist) studioSourcePlaylist.addEventListener('click', openStudioSourcePlaylist);
  [$('progress-container'), $('np-progress-container')].forEach(function (slider) { if (slider) slider.addEventListener('keydown', handleSeekSliderKey); });
  document.querySelectorAll('.volume-bar-container').forEach(function (slider) {
    slider.addEventListener('keydown', handleVolumeSliderKey);
  });
  document.querySelectorAll('.studio-volume-control, .np-volume-control').forEach(function (control) {
    control.addEventListener('wheel', handleVolumeWheel, { passive: false });
  });
  document.querySelectorAll('.player-volume-icon').forEach(function (toggle) {
    toggle.addEventListener('click', function () {
      var current = appSettings.volume === undefined ? 1 : Number(appSettings.volume);
      setVolumeLevel(current > 0 ? 0 : (volumeBeforeMute || 0.7));
    });
  });
  audioEls.forEach(function (audioEl) {
    audioEl.addEventListener('ended', async function () {
      if (audioEl !== audioEls[activeAudioIdx]) return;
      if (playbackTransitionPending) return;
      if (state.loopMode === 2) {
        // Repeat-one restarts the same track object without going through
        // playTrack(), so begin a fresh Last.fm listening session for this pass.
        // (A partial listen from the completed pass must not carry over.)
        pauseLastfmScrobbleCycle(true);
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

        var cfDuration = appSettings.crossfade ? parseInt(appSettings.crossfade, 10) : 0;
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
  pc = $('progress-container');
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
  document.querySelectorAll('.volume-bar-container').forEach(function (volumeControl) {
    let isDraggingVol = false;
    let volumeSaveTimer = null;
    volumeControl.addEventListener('mousedown', function (e) { isDraggingVol = true; updateVol(e); });
    document.addEventListener('mousemove', function (e) { if (isDraggingVol) updateVol(e); });
    document.addEventListener('mouseup', function () {
      if (!isDraggingVol) return;
      isDraggingVol = false;
      clearTimeout(volumeSaveTimer);
      flushSettingsSave();
    });
    function updateVol(e) {
      var r = volumeControl.getBoundingClientRect();
      var v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      setVolumeLevel(v, false);
      clearTimeout(volumeSaveTimer);
      volumeSaveTimer = setTimeout(function () { saveSettingsDebounced(150); }, 150);
    }
  });
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
  void renderLibraryByGenre;
  void renderSmartPlaylistsSection;
  trackSearchInput = $('playlist-track-search');
  if (trackSearchInput) {
    trackSearchInput.addEventListener('input', debounce(function (e) {
      filterPlaylistTrackRows(e.target.value);
    }, 300));
  }
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
}

function bootstrap() {
  initCoreControls();
  initRadioLibraryControls();
  initLibraryControls();
  initPlaybackDownloadControls();
  initDownloadControls();
  initSettingsControls();
  initMetadataControls();
  initPlaybackControls();
  initApp().catch(renderStartupError);
}

bootstrap();
