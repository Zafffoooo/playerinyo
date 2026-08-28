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
  var audio = audioEls && audioEls[preparedRadioSlot.audioIndex];
  if (release) releaseRadioLeaseFromAudio(audio);
  preparedRadioSlot = null;
}
function isPreparedRadioTrack(track, audioIndex) {
  var audio = audioEls && audioEls[audioIndex];
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
  if (!isRemotePlaybackTrack(track) || !playbackResolver || !audioEls || !audioEls[audioIndex]) return false;
  if (isPreparedRadioTrack(track, audioIndex)) return true;
  var key = getRemotePreparationKey(track, audioIndex, generation);
  if (!remotePreparationInFlight) return prepareRemoteTrackInSlotOwned(track, audioIndex, generation, key);
  return remotePreparationInFlight.run(audioIndex, key, function () { return prepareRemoteTrackInSlotOwned(track, audioIndex, generation, key); });
}
async function prepareRemoteTrackInSlotOwned(track, audioIndex, generation, key) {
  var session = state.radioSession;
  var requestId = nextRadioResolverRequestId(session);
  if (session) window.RadioResolverOwnership.registerRequest(session, requestId, 'transition');
  var audio = audioEls[audioIndex];
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

  if (!audioEls) audioEls = [$('audio-player-0'), $('audio-player-1')];
  invalidateRestoredPlaybackPreparation();
  cancelCrossfadeTransition(true);
  var previousIndex = activeAudioIdx;
  var nextIndex = 1 - previousIndex;
  var prevAudio = audioEls[previousIndex];
  var nextAudio = audioEls[nextIndex];
  var prevGain = audioGainNodes ? audioGainNodes[previousIndex] : null;
  var nextGain = audioGainNodes ? audioGainNodes[nextIndex] : null;
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
    try { nextAudio.currentTime = Math.min(Math.max(0, Number(track._restoredPosition)), Math.max(0, nextAudio.duration - .25)); } catch (_) { /* A stream may reject an early seek. */ }
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
      if (prevAudio && prevAudio !== audioEls[activeAudioIdx]) { prevAudio.pause(); releaseRadioLeaseFromAudio(prevAudio); }
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
  var audio = audioEls ? audioEls[activeAudioIdx] : $('audio-player-0');
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
    (audioEls || [audio]).forEach(function (audioEl) { if (audioEl && !audioEl.paused) audioEl.pause(); });
    pauseLastfmScrobbleCycle(false);
  } else {
    var generation = ++playbackGeneration;
    playbackTransitionPending = true;
    cancelCrossfadeTransition(true);
    var activeGain = audioGainNodes ? audioGainNodes[activeAudioIdx] : null;
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
  trackRenderState.likedSongsSet = new Set(state.likedSongs.filter(function (item) { return typeof item === 'string'; }));
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
    try { await pendingRefill; } catch (error) { /* The normal no-playable-track path supplies feedback. */ }
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
  (audioEls || []).forEach(function (audioEl) { if (audioEl) { if (!audioEl.paused) audioEl.pause(); releaseRadioLeaseFromAudio(audioEl); } });
  clearPreparedRadioSlot(false);
  if (options.resetPosition) {
    var activeAudio = getActiveAudioEl();
    if (activeAudio) { try { activeAudio.currentTime = 0; } catch (e) { /* Some streams reject a reset seek. */ } }
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
  (audioEls || []).forEach(function (audioEl) {
    if (!audioEl) return;
    audioEl.pause();
    releaseRadioLeaseFromAudio(audioEl);
    audioEl.removeAttribute('src');
    audioEl.load();
  });
  clearPreparedRadioSlot(false);
  (audioGainNodes || []).forEach(function (gain) { if (gain) setPlaybackGain(gain, 0, 0); });
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
  var audio = audioEls ? audioEls[activeAudioIdx] : $('audio-player-0');
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
  syncStudioSourcePlaylist();
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

function getStudioSourcePlaylist() {
  var sourceId = getValidSourcePlaylistId(state.sourcePlaylistId);
  if (!sourceId) return null;
  if (sourceId === 'liked_songs') return { id: sourceId, name: 'Liked Songs' };
  var playlist = state.playlists.find(function (item) { return item.id === sourceId; });
  return playlist || getSmartPlaylistById(sourceId) || null;
}

function syncStudioSourcePlaylist() {
  var button = $('studio-source-playlist');
  if (!button) return;
  var source = getStudioSourcePlaylist();
  button.textContent = source ? source.name : 'Listening studio';
  button.disabled = !source;
  button.title = source ? 'Open ' + source.name : '';
}

function openStudioSourcePlaylist() {
  var source = getStudioSourcePlaylist();
  if (source) switchView(source.id);
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

var playerArtworkTrigger = null;

var playerTrackName = null;

var playerTrackArtist = null;

var artworkLightbox = null;


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


// Also close on any menu item click (items that don't open a sub-modal)


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

var importFolderBtn = null;
var homeImportFolderBtn = null;
var libraryImportFolderBtn = null;

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


var btnFastRescan = null;
async function doRescanFolder() {
  if (state.musicFiles.length === 0) {
    notifyUser('No folders in library to rescan. Import a folder first.');
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
    if (warnings.length) notifyUser(warnings.join('\n\n'));
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
    notifyUser(msg);
  }
  return res;
}

var btnWriteFolderCovers = null;


var clearLibraryBtn = null;


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
    try { copy[key] = JSON.parse(JSON.stringify(value)); } catch (e) { /* Non-serializable transient values are omitted. */ }
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
function initPlaybackDownloadControls() {
  playerArtworkTrigger = $('player-artwork-trigger');
  if (playerArtworkTrigger) playerArtworkTrigger.addEventListener('click', function () { openCurrentPlaybackArtwork(); });
  playerTrackName = $('player-track-name');
  if (playerTrackName) playerTrackName.addEventListener('click', openPlaybackTrackAlbum);
  playerTrackArtist = $('player-track-artist');
  if (playerTrackArtist) playerTrackArtist.addEventListener('click', searchPlaybackArtist);
  artworkLightbox = $('artwork-lightbox-modal');
  if (artworkLightbox) artworkLightbox.addEventListener('click', function (event) { if (event.target === artworkLightbox) hideModal(artworkLightbox); });
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
  document.addEventListener('click', function (e) {
    var item = e.target.closest('.menu-item');
    if (!item || item.matches('summary') || item.classList.contains('has-submenu')) return;
    hideAllContextMenus();
  });
  importFolderBtn = $('import-folder-btn');
  homeImportFolderBtn = $('home-import-folder-btn');
  libraryImportFolderBtn = $('library-import-folder-btn');
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
  [importFolderBtn, homeImportFolderBtn, libraryImportFolderBtn].forEach(function (btn) { if (btn) btn.addEventListener('click', runFolderImport); });
  btnFastRescan = $('btn-fast-rescan');
  if (btnFastRescan) btnFastRescan.addEventListener('click', doRescanFolder);
  btnWriteFolderCovers = $('btn-write-folder-covers');
  if (btnWriteFolderCovers) btnWriteFolderCovers.addEventListener('click', async function () {
    btnWriteFolderCovers.disabled = true;
    btnWriteFolderCovers.innerHTML = '<i class="ph ph-spinner ph-spin" style="margin-right:6px;"></i> Writing...';
    try { await writeCurrentFolderCovers(true); }
    finally {
      btnWriteFolderCovers.disabled = false;
      btnWriteFolderCovers.innerHTML = '<i class="ph ph-image-square" style="margin-right:6px;"></i> Write folder.jpg';
    }
  });
  clearLibraryBtn = $('clear-library-btn');
  if (clearLibraryBtn) clearLibraryBtn.addEventListener('click', async function () {
    var count = state.musicFiles.length;
    if (!count) { showToast('The library is already empty.'); return; }
    if (await requestConfirmation('Clear ' + count + ' track' + (count === 1 ? '' : 's') + ' from Playerinyo\'s library?\n\nAudio files and playlists will not be deleted. Playlist entries may appear missing until those files are imported or rescanned. An Undo action will remain available until dismissed.')) {
      var removal = await removeLibraryFiles(state.musicFiles.slice(), 'Clear library');
      if (removal.failed) return;
      renderSidebarPlaylists();
      hideModal($('settings-modal'));
      switchView('home');
      showUndoToast('Library cleared. Audio files and playlists were not deleted.', removal.snapshot);
    }
  });
}
