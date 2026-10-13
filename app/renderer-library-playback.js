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



var movedFilesSelectHigh = null;

var movedFilesApply = null;

var movedFilesCancel = null;

var movedFilesClose = null;

var movedFilesModal = null;

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
    notifyUser('Quick fix failed: ' + (e.message || e));
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

  // Sort based on the library sort picker.
  var sortMode = getLibrarySortValue();
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
    libraryRenderState.albums = [];
    libraryRenderState.index = 0;
    return;
  }
  libraryRenderState.albums = albums;
  libraryRenderState.index = 0;
  libraryRenderState.chunk = appSettings.virtualScrolling ? 60 : 80;
  libraryRenderState.renderAll = !appSettings.virtualScrolling;
  libraryRenderState.token = (libraryRenderState.token || 0) + 1;
  if (libraryRenderState.frame) {
    cancelAnimationFrame(libraryRenderState.frame);
    libraryRenderState.frame = null;
  }
  
  if (!renderLibraryChunk) {
    renderLibraryChunk = function() {
      if (state.currentView !== 'library') return;
      if (!libraryRenderState.albums || libraryRenderState.index >= libraryRenderState.albums.length) return;
      var renderToken = libraryRenderState.token;
      var chunk = libraryRenderState.albums.slice(libraryRenderState.index, libraryRenderState.index + libraryRenderState.chunk);
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
          currentContextMenuAlbum = album;
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
          if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); currentContextMenuAlbum = album; positionContextMenu($('album-context-menu'), 0, 0, card); }
        });
        if (typeof isMultiSelectMode !== 'undefined' && isMultiSelectMode && selectedAlbumsForEdit.has(album.id)) {
          card.style.border = '2px solid var(--accent)';
          card.style.transform = 'scale(0.95)';
          card.style.opacity = '0.8';
        }
        fragment.appendChild(card);
      });
      grid.appendChild(fragment);
      libraryRenderState.index += libraryRenderState.chunk;
      if (libraryRenderState.index < libraryRenderState.albums.length) {
        libraryRenderState.frame = requestAnimationFrame(function () {
          if (libraryRenderState.token !== renderToken) return;
          var contentArea = $('content-area');
          if (libraryRenderState.renderAll || (contentArea && contentArea.scrollHeight <= contentArea.clientHeight + 1)) renderLibraryChunk();
        });
      }
    };
  }
  renderLibraryChunk();
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



var librarySortValue = 'artist';
var librarySortActiveIndex = 0;

function getLibrarySortOptions() {
  var listbox = $('library-sort-listbox');
  return listbox ? Array.from(listbox.querySelectorAll('[role="option"]')) : [];
}

function getLibrarySortValue() {
  return librarySortValue;
}

function closeLibrarySortListbox(restoreFocus) {
  var button = $('library-sort-button');
  var listbox = $('library-sort-listbox');
  if (!button || !listbox) return;
  listbox.hidden = true;
  button.setAttribute('aria-expanded', 'false');
  if (restoreFocus) button.focus();
}

function focusLibrarySortOption(index) {
  var listbox = $('library-sort-listbox');
  var options = getLibrarySortOptions();
  if (!listbox || !options.length) return;
  librarySortActiveIndex = Math.max(0, Math.min(options.length - 1, index));
  options.forEach(function (option, optionIndex) { option.classList.toggle('keyboard-active', optionIndex === librarySortActiveIndex); });
  listbox.setAttribute('aria-activedescendant', options[librarySortActiveIndex].id);
}

function positionLibrarySortListbox() {
  var button = $('library-sort-button');
  var listbox = $('library-sort-listbox');
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

function openLibrarySortListbox(preferredIndex) {
  var button = $('library-sort-button');
  var listbox = $('library-sort-listbox');
  var options = getLibrarySortOptions();
  if (!button || !listbox || !options.length) return;
  var selectedIndex = options.findIndex(function (option) { return option.dataset.value === librarySortValue; });
  // Use a body-level overlay so the scrolling library stage cannot clip it.
  if (listbox.parentElement !== document.body) document.body.appendChild(listbox);
  listbox.style.minWidth = Math.round(button.getBoundingClientRect().width) + 'px';
  listbox.hidden = false;
  positionLibrarySortListbox();
  button.setAttribute('aria-expanded', 'true');
  listbox.focus();
  focusLibrarySortOption(preferredIndex === undefined ? Math.max(0, selectedIndex) : preferredIndex);
}

function chooseLibrarySortOption(option) {
  if (!option) return;
  var nextValue = option.dataset.value;
  closeLibrarySortListbox(true);
  if (!nextValue || nextValue === librarySortValue) return;
  librarySortValue = nextValue;
  var valueEl = $('library-sort-value');
  if (valueEl) valueEl.textContent = option.textContent;
  getLibrarySortOptions().forEach(function (sortOption) { sortOption.setAttribute('aria-selected', sortOption.dataset.value === librarySortValue ? 'true' : 'false'); });
  if (state.currentView === 'library') renderLibrary();
}

function bindLibrarySortControl() {
  var button = $('library-sort-button');
  var listbox = $('library-sort-listbox');
  if (!button || !listbox || button.dataset.bound === 'true') return;
  button.dataset.bound = 'true';
  button.addEventListener('click', function (event) {
    event.stopPropagation();
    if (listbox.hidden) openLibrarySortListbox();
    else closeLibrarySortListbox(true);
  });
  button.addEventListener('keydown', function (event) {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
    if (event.key === 'Escape') { if (!listbox.hidden) { event.preventDefault(); closeLibrarySortListbox(true); } return; }
    event.preventDefault();
    var options = getLibrarySortOptions();
    var selectedIndex = options.findIndex(function (option) { return option.dataset.value === librarySortValue; });
    if (event.key === 'Home') openLibrarySortListbox(0);
    else if (event.key === 'End') openLibrarySortListbox(options.length - 1);
    else if (event.key === 'ArrowUp') openLibrarySortListbox(Math.max(0, selectedIndex - 1));
    else if (event.key === 'ArrowDown') openLibrarySortListbox(Math.min(options.length - 1, selectedIndex + 1));
    else openLibrarySortListbox();
  });
  listbox.addEventListener('keydown', function (event) {
    var options = getLibrarySortOptions();
    if (event.key === 'Escape') { event.preventDefault(); closeLibrarySortListbox(true); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      if (event.key === 'Home') focusLibrarySortOption(0);
      else if (event.key === 'End') focusLibrarySortOption(options.length - 1);
      else focusLibrarySortOption(librarySortActiveIndex + (event.key === 'ArrowDown' ? 1 : -1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      chooseLibrarySortOption(options[librarySortActiveIndex]);
    } else if (event.key === 'Tab') closeLibrarySortListbox(false);
  });
  listbox.addEventListener('click', function (event) {
    var option = event.target.closest('[role="option"]');
    if (option) chooseLibrarySortOption(option);
  });
  document.addEventListener('click', function (event) {
    if (!event.target.closest('#library-sort-controls') && !event.target.closest('#library-sort-listbox')) closeLibrarySortListbox(false);
  });
}



function focusTrackInTable(filePath) {
  var target = stripFileUrl(filePath || '') || filePath;
  if (!target) return;
  var attempts = 0;
  function findAndFocus() {
    attempts++;
    var row = document.querySelector('#tracks-body tr[data-file-path="' + CSS.escape(target) + '"]');
    if (!row && trackRenderState.virtualized && renderVirtualTracksWindow && trackRenderState.rows && attempts < 4) {
      var rowIndex = trackRenderState.rows.findIndex(function (entry) {
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
        renderVirtualTracksWindow(true);
        requestAnimationFrame(findAndFocus);
        return;
      }
    }
    if (!row && renderTracksChunk && trackRenderState.tracks && trackRenderState.index < trackRenderState.tracks.length && attempts < 80) {
      renderTracksChunk();
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
  if (!trackRenderState.virtualized || !renderVirtualTracksWindow || !trackRenderState.rows) return;
  var virtualIndex = trackRenderState.rows.findIndex(function(entry) { return entry && entry.sourceIndex === sourceIndex; });
  var contentArea = $('content-area');
  var table = document.querySelector('.tracks-table');
  if (virtualIndex < 0 || !contentArea || !table) return;
  var contentRect = contentArea.getBoundingClientRect();
  var tableTop = contentArea.scrollTop + table.getBoundingClientRect().top - contentRect.top;
  var headerHeight = table.tHead ? table.tHead.getBoundingClientRect().height : 0;
  contentArea.scrollTop = Math.max(0, tableTop + headerHeight + (virtualIndex * TRACK_TABLE_VIRTUAL_ROW_HEIGHT) - (contentArea.clientHeight / 2));
  renderVirtualTracksWindow(true);
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
    // Let the playlist-specific projection-room CSS choose the compact grid
    // layout instead of overriding it with an inline flex display.
    $('album-detail-header').style.display = '';
    $('album-detail-header').style.minHeight = '0';
    $('album-detail-header').style.height = 'auto';
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
  // Let the playlist-specific projection-room CSS choose the compact grid
  // layout instead of overriding it with an inline flex display.
  $('album-detail-header').style.display = ''; $('album-detail-type').textContent = 'Playlist';
  $('album-detail-header').style.minHeight = '0';
  $('album-detail-header').style.height = 'auto';
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
  trackRenderState.filterValue = '';
  trackRenderState.filterView = '';
}

function trackTableFilterValue() {
  if (trackRenderState.filterView !== state.currentView) return '';
  return String(trackRenderState.filterValue || '').toLowerCase().trim();
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
  if (trackRenderState.playlistMembership && trackRenderState.playlistMembershipRevision === playlistMembershipRevision) {
    return trackRenderState.playlistMembership;
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
  trackRenderState.playlistMembership = playlistMembership;
  trackRenderState.playlistMembershipRevision = playlistMembershipRevision;
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
  return key && trackRenderState.playlistMembership ? (trackRenderState.playlistMembership.get(key) || []) : [];
}

function getTrackRowFromEventTarget(target) {
  var row = target && target.closest ? target.closest('tr[data-track-index]') : null;
  var tbody = $('tracks-body');
  return row && tbody && row.parentNode === tbody ? row : null;
}

function getTrackFromTableRow(row) {
  var index = row ? parseInt(row.dataset.trackIndex, 10) : NaN;
  return !isNaN(index) && trackRenderState.source ? trackRenderState.source[index] : null;
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
  state.playQueueTracks = (trackRenderState.source || state.currentTracks).slice();
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
  if (e.altKey && trackRenderState.allowReorder && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
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
    state.playQueueTracks = (trackRenderState.source || state.currentTracks).slice();
    moveTrackToShuffleQueueStart(track);
    playTrack(track);
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    var currentSourceIndex = parseInt(row.dataset.trackIndex, 10);
    var entries = trackRenderState.rows || [];
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
  if (trackRenderState.allowReorder) e.dataTransfer.setData('reorder-index', row.dataset.trackIndex);
  row.style.opacity = '0.5';
}

function handleTrackTableDragEnd(e) {
  var row = getTrackRowFromEventTarget(e.target);
  if (row) row.style.opacity = '';
}

function handleTrackTableDragOver(e) {
  if (!trackRenderState.allowReorder) return;
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
  if (!trackRenderState.allowReorder) return;
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
  trackRenderState.source = source;
  trackRenderState.token = (trackRenderState.token || 0) + 1;
  // A previous large-list view may have installed a virtual window renderer.
  // Clear it before every render so empty/non-virtual states cannot reuse it.
  trackRenderState.virtualized = false;
  renderVirtualTracksWindow = null;
  if (!source.length) {
    trackRenderState.tracks = [];
    trackRenderState.rows = [];
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-subdued);">No tracks</td></tr>';
    return;
  }
  var filterValue = trackTableFilterValue();
  var tableRows = buildTrackRowsForTable(source, filterValue);
  trackRenderState.tracks = tableRows.map(function (entry) { return entry.track; });
  trackRenderState.rows = tableRows;
  trackRenderState.index = 0;
  trackRenderState.chunk = appSettings.virtualScrolling ? 60 : 80;
  trackRenderState.renderAll = !appSettings.virtualScrolling;
  trackRenderState.allowReorder = allowReorder;
  trackRenderState.likedSongsSet = new Set(state.likedSongs);
  trackRenderState.playlistMembership = buildPlaylistMembershipMap();
  trackRenderState.hasMultipleDiscs = !!(state.currentView && state.currentView.startsWith('album:') && albumHasMultipleDiscs(state.currentTracks));
  trackRenderState.virtualized = !!(appSettings.virtualScrolling && !allowReorder && !trackRenderState.hasMultipleDiscs && tableRows.length > 300);
  if (trackRenderState.frame) {
    cancelAnimationFrame(trackRenderState.frame);
    trackRenderState.frame = null;
  }
  if (!tableRows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-subdued);">No matching tracks</td></tr>';
    return;
  }

  if (trackRenderState.virtualized) {
    trackRenderState.virtualStart = -1;
    trackRenderState.virtualEnd = -1;
    renderVirtualTracksWindow = function(force) {
      var rows = trackRenderState.rows;
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
      if (!force && start === trackRenderState.virtualStart && end === trackRenderState.virtualEnd) return;
      trackRenderState.virtualStart = start;
      trackRenderState.virtualEnd = end;
      var fragment = document.createDocumentFragment();
      appendVirtualTrackSpacer(fragment, start * TRACK_TABLE_VIRTUAL_ROW_HEIGHT);
      rows.slice(start, end).forEach(function(entry) { appendVirtualTrackTableRow(fragment, entry); });
      appendVirtualTrackSpacer(fragment, (rows.length - end) * TRACK_TABLE_VIRTUAL_ROW_HEIGHT);
      tableBody.replaceChildren(fragment);
    };
    renderVirtualTracksWindow(true);
    return;
  }
  renderVirtualTracksWindow = null;

  // Recreate the incremental renderer for every view. Keeping a renderer from
  // a previous view can leave the new table empty when its scheduled frame was
  // cancelled during navigation.
  renderTracksChunk = function(renderToken) {
      if (renderToken !== undefined && renderToken !== trackRenderState.token) return;
      if (!trackRenderState.rows || trackRenderState.index >= trackRenderState.rows.length) return;
      var activeToken = trackRenderState.token;
      var rows = trackRenderState.rows;
      var chunk = rows.slice(trackRenderState.index, trackRenderState.index + trackRenderState.chunk);
      var tbody = $('tracks-body');
      if (!tbody) return;
      var fragment = document.createDocumentFragment();
      chunk.forEach(function (entry, i) {
        var renderIndex = trackRenderState.index + i;
        var track = entry.track;
        var sourceIndex = entry.sourceIndex;
        var tr = document.createElement('tr');
        tr.dataset.trackIndex = String(sourceIndex);
        tr.setAttribute('aria-label', (track.title || 'Track') + ' by ' + (track.artist || 'Unknown Artist') + (trackRenderState.allowReorder ? '. Use Alt plus Up or Down to reorder.' : ''));
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
        var hasMultipleDiscs = trackRenderState.hasMultipleDiscs;
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
        tr.innerHTML = '<td style="width:20px;padding-left:8px;">' + (trackRenderState.allowReorder ? '<i class="ph ph-dots-six-vertical drag-handle"></i>' : '') + '</td>'
          + '<td class="col-num">' + displayNo + '</td>'
          + '<td class="col-title"><div class="track-info">' + pic + '<div class="track-text"><div class="title">' + esc(track.title) + streamIndicator + '<button type="button" class="track-inline-action track-like-btn" data-fp="' + esc(fp) + '" aria-label="' + (liked ? 'Unlike' : 'Like') + ' track" aria-pressed="' + (liked ? 'true' : 'false') + '"><i class="' + (liked ? 'ph-fill ph-heart' : 'ph ph-heart') + '" aria-hidden="true"></i></button>' + (inPlaylists.length > 0 ? '<button type="button" class="track-inline-action track-in-pl-btn" aria-label="Show playlists containing this track"><i class="ph-fill ph-check-circle" aria-hidden="true"></i></button>' : '') + '</div><div class="artist">' + esc(track.artist) + '</div></div></div></td>'
          + '<td class="col-album">' + esc(track.album) + '</td>'
          + '<td class="col-duration">' + fmt(track.duration) + '</td>'
          + '<td style="width:40px;text-align:center;"><button class="icon-btn ghost track-options-btn" aria-label="More actions for ' + esc(track.title || 'track') + '"><i class="ph ph-dots-three" aria-hidden="true"></i></button></td>';
        fragment.appendChild(tr);
      });
      if (activeToken !== trackRenderState.token) return;
      tbody.appendChild(fragment);
      trackRenderState.index += trackRenderState.chunk;
      if (trackRenderState.index < rows.length) {
        trackRenderState.frame = requestAnimationFrame(function () {
          if (activeToken !== trackRenderState.token) return;
          var contentArea = $('content-area');
          if (trackRenderState.renderAll || (contentArea && contentArea.scrollHeight <= contentArea.clientHeight + 1)) renderTracksChunk(activeToken);
        });
      }
  };
  renderTracksChunk(trackRenderState.token);
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
  file.replayGainMethod = 'approx-rms';
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
    notifyUser('Loudness analysis failed: ' + (e.message || e));
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
    notifyUser('ReplayGain batch failed: ' + (e.message || e));
  } finally {
    document.body.style.cursor = '';
    if ($('view-title') && oldTitle && state.currentView !== 'metadata_health') $('view-title').textContent = oldTitle;
  }
}

async function analyzeAllMissingReplayGain() {
  var allMissing = state.musicFiles.filter(function (f) { return f && f.filePath && (f.replayGainTrackDb === null || f.replayGainTrackDb === undefined); });
  if (!allMissing.length) { setTagHealthProgress(false, '', 0, 0, 'No missing ReplayGain tracks found.'); showToast('No missing ReplayGain tracks found.'); return; }
  if (!await requestConfirmation('Analyze ReplayGain for ' + allMissing.length + ' missing track(s)?\n\nThis runs in batches and may take a while for large libraries.')) return;
  var batchSize = 25;
  var done = 0;
  document.body.style.cursor = 'wait';
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
    notifyUser('ReplayGain analysis failed: ' + (e.message || e));
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
  } catch (e) { /* Audio automation falls back to the current gain value. */ }
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
  var list = audioEls || [];
  var gains = audioGainNodes || [];
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
function initLibraryControls() {
  if (window.api.onMovedFilesProgress) window.api.onMovedFilesProgress(function (data) {
    if (movedFileOperation === 'preview') {
      setTagHealthProgress(true, data && data.label || 'Scanning moved files', data && data.current || 0, data && data.total || 0, '');
    } else if (movedFileOperation === 'commit') {
      updateMovedFilesProgress(data);
    }
  });
  movedFilesSelectHigh = $('moved-files-select-high');
  if (movedFilesSelectHigh) movedFilesSelectHigh.addEventListener('click', function () {
    document.querySelectorAll('#moved-files-rows .moved-file-check').forEach(function (checkbox) { checkbox.checked = !checkbox.disabled && checkbox.dataset.highConfidence === 'true'; });
    updateMovedFileSelection();
  });
  movedFilesApply = $('moved-files-apply');
  if (movedFilesApply) movedFilesApply.addEventListener('click', applyMovedFileReview);
  movedFilesCancel = $('moved-files-cancel');
  if (movedFilesCancel) movedFilesCancel.addEventListener('click', cancelMovedFileReview);
  movedFilesClose = $('moved-files-close');
  if (movedFilesClose) movedFilesClose.addEventListener('click', cancelMovedFileReview);
  movedFilesModal = $('moved-files-modal');
  if (movedFilesModal) movedFilesModal.addEventListener('click', function (event) { if (event.target === movedFilesModal) cancelMovedFileReview(); });
  bindPlaylistSortControl();
  bindLibrarySortControl();
}
