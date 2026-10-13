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

var ctxAdd = null;


var actxAdd = null;


var addToPlaylistSearch = null;

var addToPlaylistMenu = null;

var addToPlaylistNew = null;



var ctxRemove = null;

var ctxMatch = null;

var closePls = null; 
var plsModal = null; 

var pctxAddSongs = null;


var pctxDownloadMissing = null;


var btnCloseAddSongs = null;

var addSongsModal = null;


var pctxRename = null;

var pctxCover = null;

var pctxColor = null;

var closeColor = null; 
var colorModal = null; 
var pctxPin = null;

var pctxDup = null;

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


var pctxSyncAlbums = null;


var pctxMatchFolder = null;

var pctxDelete = null;

var delCancel = null; 
var delConfirm = null;

var delModal = null; 
var importReviewModal = null;

var importReviewDone = null;

var importReviewTagHealth = null;

var importReviewAnalyzeRg = null;


var btnPlay = null; 
var btnShuffle = null; 
var btnLoop = null; 
var btnNext = null; 
var btnPrev = null; 

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


function stripFileUrl(url) { return fromFileUrl(url); }

function unloadAudioForMetadataSave(filePaths) {
  var targets = new Set((filePaths || []).map(function (fp) { return stripFileUrl(fp || ''); }).filter(Boolean));
  if (!targets.size || !audioEls) return null;
  var snapshots = [];
  var wasPlaying = state.isPlaying;
  audioEls.forEach(function (audioEl, idx) {
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
      try { item.audioEl.currentTime = item.currentTime; } catch (e) { /* Streams may reject restoring a stale position. */ }
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

var ctxEditMeta = null;

function migrateAlbumPreferences(oldAlbumKey, file) {
  var newAlbumKey = file && getAlbumKey(file);
  if (!oldAlbumKey || !newAlbumKey || oldAlbumKey === newAlbumKey) return false;
  var moved = false;
  ['albumNotes', 'albumRatings', 'likedAlbums'].forEach(function (field) {
    var values = appSettings[field];
    if (!values || !Object.prototype.hasOwnProperty.call(values, oldAlbumKey)) return;
    if (!Object.prototype.hasOwnProperty.call(values, newAlbumKey)) {
      values[newAlbumKey] = values[oldAlbumKey];
      delete values[oldAlbumKey];
      moved = true;
    }
  });
  return moved;
}

function initializeAlbumRatingStars(container, initialValue) {
  if (!container) return;
  var valueLabel = $('library-album-rating-value');
  var clearButton = $('library-album-rating-clear');
  var rating = Number(initialValue) || 0;
  container.replaceChildren();
  function paint(preview) {
    var shown = preview === undefined ? rating : preview;
    container.querySelectorAll('.library-rating-star').forEach(function (button, index) {
      var amount = Math.max(0, Math.min(1, shown - index));
      button.querySelector('.library-rating-fill').style.width = Math.round(amount * 100) + '%';
      button.setAttribute('aria-pressed', rating >= index + 1 ? 'true' : 'false');
    });
    if (preview === undefined) {
      container.dataset.value = rating ? String(rating) : '';
      container.setAttribute('aria-label', rating ? 'Album rating: ' + rating + ' of 5 stars' : 'Album rating: none');
      if (valueLabel) valueLabel.textContent = rating ? rating + ' / 5' : 'No rating';
      if (clearButton) clearButton.disabled = !rating;
    }
  }
  function setRating(next) { rating = Math.max(0, Math.min(5, Math.round(next * 2) / 2)); paint(); }
  for (var star = 1; star <= 5; star++) {
    var button = document.createElement('button'); button.type = 'button'; button.className = 'library-rating-star'; button.dataset.star = String(star);
    button.setAttribute('aria-label', 'Rate ' + star + ' stars; use the left half for ' + (star - 0.5));
    button.innerHTML = '<i class="ph ph-star" aria-hidden="true"></i><span class="library-rating-fill"><i class="ph-fill ph-star" aria-hidden="true"></i></span>';
    button.addEventListener('click', function (event) {
      var rect = event.currentTarget.getBoundingClientRect();
      var half = event.detail === 0 ? false : event.clientX < rect.left + rect.width / 2;
      setRating(Number(event.currentTarget.dataset.star) - (half ? 0.5 : 0));
    });
    button.addEventListener('mousemove', function (event) {
      var rect = event.currentTarget.getBoundingClientRect();
      paint(Number(event.currentTarget.dataset.star) - (event.clientX < rect.left + rect.width / 2 ? 0.5 : 0));
    });
    button.addEventListener('mouseleave', function () { paint(); });
    button.addEventListener('keydown', function (event) {
      if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); setRating(rating + 0.5); }
      else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); setRating(rating - 0.5); }
      else if (event.key === 'Home' || event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); setRating(0); }
      else if (event.key === 'End') { event.preventDefault(); setRating(5); }
    });
    container.appendChild(button);
  }
  if (clearButton) clearButton.onclick = function () { setRating(0); };
  paint();
}

function openLibraryNoteEditor(scope, target) {
  var modal = $('library-note-modal'); var input = $('library-note-input');
  if (!modal || !input || !target) return;
  var isAlbum = scope === 'album'; var key = isAlbum ? (target.id || getAlbumKey(target)) : target.filePath;
  if (!key) return;
  var notesKey = isAlbum ? 'albumNotes' : 'trackNotes';
  var notes = appSettings[notesKey] && typeof appSettings[notesKey] === 'object' ? appSettings[notesKey] : {};
  var ratingField = $('library-album-rating-field'); var ratingInput = $('library-album-rating');
  var ratings = appSettings.albumRatings && typeof appSettings.albumRatings === 'object' ? appSettings.albumRatings : {};
  if (ratingField) ratingField.hidden = !isAlbum;
  if (isAlbum) initializeAlbumRatingStars(ratingInput, ratings[key]);
  $('library-note-title').textContent = isAlbum ? 'Album review' : 'Edit track note';
  $('library-note-subtitle').textContent = isAlbum ? ((target.name || target.album || 'Unknown album') + ' — ' + (target.artist || target.albumArtist || 'Unknown artist')) : ((target.title || 'Unknown title') + ' — ' + (target.artist || 'Unknown artist'));
  input.value = String(notes[key] || '');
  $('library-note-cancel').onclick = function () { hideModal(modal); };
  modal.onclick = function (event) { if (event.target === modal) hideModal(modal); };
  $('library-note-save').onclick = async function () {
    var previous = appSettings[notesKey]; var previousRatings = appSettings.albumRatings;
    var next = Object.assign({}, notes); var value = input.value.trim();
    if (value) next[key] = value; else delete next[key];
    if (isAlbum) {
      var updatedRatings = Object.assign({}, ratings);
      if (ratingInput && ratingInput.dataset.value) updatedRatings[key] = Number(ratingInput.dataset.value);
      else delete updatedRatings[key];
      appSettings.albumRatings = updatedRatings;
    }
    appSettings[notesKey] = next; markLibraryDirty();
    try {
      await persistSettings(appSettings); hideModal(modal);
      if (state.currentView === 'search') { var search = $('global-search'); if (search) search.dispatchEvent(new Event('input')); }
      showToast(isAlbum ? 'Album review saved.' : (value ? 'Note saved.' : 'Note removed.'));
    } catch (error) {
      appSettings[notesKey] = previous; appSettings.albumRatings = previousRatings; markLibraryDirty();
      showToast('The note could not be saved. Check disk space and permissions.');
    }
  };
  showModal(modal, { initialFocus: '#library-note-input' });
}


var albumEditMeta = null;


// Show the album edit button when rendering album detail
// Already done in index.html (display:none) and we can show it in renderAlbumDetail
// Let's hook the tab switches



var metaCoverDrop = null;


var metaSearchCoverBtn = null;


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
    var values = files.map(function (file) { return String(file && file[field] !== null && file[field] !== undefined && file[field] !== 0 ? file[field] : ''); });
    var first = values[0] || '';
    return { value: first, mixed: values.some(function (value) { return value !== first; }) };
  }
  function setManualField(id, field, singleValue) {
    var input = $(id);
    if (!input) return;
    var result = files.length === 1 ? { value: singleValue === null || singleValue === undefined || singleValue === 0 ? '' : String(singleValue), mixed: false } : commonValue(field);
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
    notifyUser('Select a metadata result first.');
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
    notifyUser('Matched by title with ' + weakMatches + ' weak match(es) and ' + remaining.length + ' unmatched local track(s). Review warning rows before saving.');
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

var atOrderToggle = null;


var atTrackOrderWrap = null;





var atFieldsContinue = null;

var atDownloadMissingBtn = null;







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
function initMetadataControls() {
  ctxAdd = $('ctx-add-playlist');
  bindAddToPlaylistFlyoutTrigger(ctxAdd, getTracksFromTrackContextForPlaylistAdd);
  actxAdd = $('actx-add-playlist');
  bindAddToPlaylistFlyoutTrigger(actxAdd, getTracksFromAlbumContextForPlaylistAdd);
  addToPlaylistSearch = $('add-to-playlist-search');
  if (addToPlaylistSearch) addToPlaylistSearch.addEventListener('input', function (e) { renderAddToPlaylistFlyout(e.target.value); });
  addToPlaylistMenu = $('add-to-playlist-menu');
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
  addToPlaylistNew = $('add-to-playlist-new');
  if (addToPlaylistNew) addToPlaylistNew.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); createPlaylistFromAddFlyout(); });
  bindAddToPlaylistFlyoutDismissers('track-context-menu', 'ctx-add-playlist');
  bindAddToPlaylistFlyoutDismissers('album-context-menu', 'actx-add-playlist');
  ctxRemove = $('ctx-remove-playlist');
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
    else notifyUser('Open a playlist to remove tracks.');
  });
  ctxMatch = $('ctx-manual-match');
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
  closePls = $('btn-close-playlist-selector');
  if (closePls) closePls.addEventListener('click', function () { hideModal($('playlist-selector-modal')); });
  plsModal = $('playlist-selector-modal');
  if (plsModal) plsModal.addEventListener('click', function (e) { if (e.target === plsModal) hideModal(plsModal); });
  pctxAddSongs = $('pctx-add-songs');
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
  pctxDownloadMissing = $('pctx-download-missing');
  if (pctxDownloadMissing) pctxDownloadMissing.addEventListener('click', function () {
    var pl = currentContextMenuPlaylist;
    hideAllContextMenus();
    showExistingPlaylistDownloadReview(pl, getDownloadableMissingPlaylistRows(pl));
  });
  btnCloseAddSongs = $('btn-close-add-songs');
  if (btnCloseAddSongs) btnCloseAddSongs.addEventListener('click', function() { 
    hideModal($('add-songs-modal')); 
    if (currentContextMenuPlaylist && state.currentView === currentContextMenuPlaylist.id) {
      renderPlaylist(currentContextMenuPlaylist.id);
    }
  });
  addSongsModal = $('add-songs-modal');
  if (addSongsModal) addSongsModal.addEventListener('click', function (e) { 
    if (e.target === addSongsModal) {
      hideModal(addSongsModal);
      if (currentContextMenuPlaylist && state.currentView === currentContextMenuPlaylist.id) {
        renderPlaylist(currentContextMenuPlaylist.id);
      }
    }
  });
  pctxRename = $('pctx-rename');
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
  pctxCover = $('pctx-cover');
  if (pctxCover) pctxCover.addEventListener('click', async function () { var pl = currentContextMenuPlaylist; if (!pl) return; var img = await window.api.openImage(); if (img) { pl.cover = img; await persistPlaylists(state.playlists); renderSidebarPlaylists(); if (state.currentView === pl.id) renderPlaylist(pl.id); } });
  pctxColor = $('pctx-color');
  if (pctxColor) pctxColor.addEventListener('click', function () {
    var pl = currentContextMenuPlaylist; if (!pl) return;
    var sw = $('color-picker-swatches'); sw.innerHTML = '';
    PALETTE.forEach(function (color) { var s = document.createElement('button'); s.type = 'button'; s.className = 'color-swatch' + (color === pl.color ? ' selected' : ''); s.setAttribute('aria-label', 'Use color ' + color); s.style.background = color; s.addEventListener('click', async function () { pl.color = color; await persistPlaylists(state.playlists); hideModal($('color-picker-modal')); renderSidebarPlaylists(); if (state.currentView === pl.id) renderPlaylist(pl.id); showToast('Updated playlist color.'); }); sw.appendChild(s); });
    showModal($('color-picker-modal'));
  });
  closeColor = $('btn-close-color-picker');
  if (closeColor) closeColor.addEventListener('click', function () { hideModal($('color-picker-modal')); });
  colorModal = $('color-picker-modal');
  if (colorModal) colorModal.addEventListener('click', function (e) { if (e.target === colorModal) hideModal(colorModal); });
  pctxPin = $('pctx-pin');
  if (pctxPin) pctxPin.addEventListener('click', async function () {
    var pl = currentContextMenuPlaylist; if (!pl) return;
    if (!pl.pinned && state.playlists.filter(function (p) { return p.pinned; }).length >= 6) { notifyUser('Max 6 pinned playlists.'); return; }
    pl.pinned = !pl.pinned; await persistPlaylists(state.playlists); renderSidebarPlaylists(); showToast((pl.pinned ? 'Pinned ' : 'Unpinned ') + '"' + (pl.name || 'playlist') + '".');
  });
  pctxDup = $('pctx-duplicate');
  if (pctxDup) pctxDup.addEventListener('click', async function () {
    var pl = currentContextMenuPlaylist; if (!pl) return;
    var copyName = getUniquePlaylistName((pl.name || 'Playlist') + ' (Copy)');
    var copy = Object.assign({}, JSON.parse(JSON.stringify(pl)), { id: 'pl_' + Date.now(), name: copyName, pinned: false, lastPlayed: null });
    state.playlists.push(copy);
    await persistPlaylists(state.playlists);
    renderSidebarPlaylists();
    showToast('Duplicated playlist as "' + copyName + '".');
  });
  [['pctx-export-csv', 'csv'], ['pctx-export-m3u', 'm3u'], ['pctx-export-m3u8', 'm3u8']].forEach(function (entry) {
    var button = $(entry[0]); if (button) button.addEventListener('click', function () { exportContextPlaylist(entry[1]); });
  });
  pctxSyncAlbums = $('pctx-sync-albums');
  if (pctxSyncAlbums) pctxSyncAlbums.addEventListener('click', async function () { 
    var pl = currentContextMenuPlaylist; if (!pl || !pl.tracks) return; 
    var updated = 0;
    for (var i = 0; i < pl.tracks.length; i++) {
      var r = pl.tracks[i];
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
  pctxMatchFolder = $('pctx-match-folder');
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
  pctxDelete = $('pctx-delete');
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
  delCancel = $('delete-cancel-btn');
  if (delCancel) delCancel.addEventListener('click', function () { playlistToDelete = null; smartPlaylistToDelete = null; hideModal($('delete-confirm-modal')); });
  delConfirm = $('delete-confirm-btn');
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
  delModal = $('delete-confirm-modal');
  if (delModal) delModal.addEventListener('click', function (e) { if (e.target === delModal && delCancel) delCancel.click(); });
  importReviewModal = $('import-review-modal');
  if (importReviewModal) importReviewModal.addEventListener('click', function (e) { if (e.target === importReviewModal) hideModal(importReviewModal); });
  importReviewDone = $('import-review-done');
  if (importReviewDone) importReviewDone.addEventListener('click', function () { hideModal($('import-review-modal')); });
  importReviewTagHealth = $('import-review-tag-health');
  if (importReviewTagHealth) importReviewTagHealth.addEventListener('click', function () { hideModal($('import-review-modal')); switchView('metadata_health'); });
  importReviewAnalyzeRg = $('import-review-analyze-rg');
  if (importReviewAnalyzeRg) importReviewAnalyzeRg.addEventListener('click', function () {
    hideModal($('import-review-modal'));
    switchView('metadata_health');
    var root = $('metadata-health-container');
    if (root) root.dataset.filter = 'missing_replaygain';
    renderMetadataHealthView();
  });
  btnPlay = $('btn-play');
  if (btnPlay) btnPlay.addEventListener('click', togglePlay);
  btnShuffle = $('btn-shuffle');
  if (btnShuffle) btnShuffle.addEventListener('click', toggleShuffle);
  btnLoop = $('btn-loop');
  if (btnLoop) btnLoop.addEventListener('click', cycleLoop);
  btnNext = $('btn-next');
  if (btnNext) btnNext.addEventListener('click', function () { initAudioCtx(); playNextTrack(); });
  btnPrev = $('btn-prev');
  if (btnPrev) btnPrev.addEventListener('click', function () { initAudioCtx(); playPrevTrack(); });
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
  ctxEditMeta = $('ctx-edit-metadata');
  if (ctxEditMeta) ctxEditMeta.addEventListener('click', async function () {
    if (!currentContextMenuTrack || !currentContextMenuTrack.matchedFile) return;
    openMetadataEditor([currentContextMenuTrack.matchedFile]);
  });
  var ctxEditNote = $('ctx-edit-note');
  if (ctxEditNote) ctxEditNote.addEventListener('click', function () {
    var file = currentContextMenuTrack && (currentContextMenuTrack.matchedFile || currentContextMenuTrack);
    if (file && file.filePath) openLibraryNoteEditor('track', file);
    hideAllContextMenus();
  });
  albumEditMeta = $('album-edit-metadata-btn');
  if (albumEditMeta) albumEditMeta.addEventListener('click', async function () {
    var aid = decodeURIComponent(state.currentView.replace('album:', ''));
    var aTracks = state.musicFiles.filter(function (f) {
      var k = getAlbumKey(f);
      return k === aid;
    });
    if (aTracks.length > 0) openMetadataEditor(aTracks, { scope: 'album' });
  });
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
  metaCoverDrop = $('meta-cover-drop');
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
  metaSearchCoverBtn = $('meta-search-cover-btn');
  if (metaSearchCoverBtn) metaSearchCoverBtn.addEventListener('click', function () {
    var artist = $('meta-artist').value || '';
    var album = $('meta-album').value || '';
    var q = encodeURIComponent(artist + ' ' + album);
    window.api.openExternal('https://covers.musichoarders.xyz/?q=' + q);
  });
  atOrderToggle = $('at-order-toggle');
  if (atOrderToggle) atOrderToggle.addEventListener('click', function (e) {
    e.stopPropagation();
    atTrackOrderMenuOpen = !atTrackOrderMenuOpen;
    renderMetaTrackOrderList();
  });
  atTrackOrderWrap = $('at-track-order-wrap');
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
  atFieldsContinue = $('at-fields-continue');
  if (atFieldsContinue) atFieldsContinue.addEventListener('click', function () { if (metaProposedData) setAutoTagStep('review', true); });
  atDownloadMissingBtn = $('at-download-missing-btn');
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
    var playlistSyncUpdated = 0;
    var playlistSyncWarning = '';
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
    var albumPreferencesChanged = false;
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
      notifyUser(message);
      // A failed write used to leave the modal bound to stale targets/progress
      // state. Re-open it from the current library values so it is usable again.
      if (saveSessionId === metaEditorSessionSeq) {
        var refreshedTargets = targetFiles.map(resolveCurrentLibraryFile).filter(Boolean);
        if (refreshedTargets.length) await openMetadataEditor(refreshedTargets, { scope: metaEditorScope });
      }
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
      if (Object.prototype.hasOwnProperty.call(metadata, 'title')) file.title = metadata.title || file.filename || '';
      if (Object.prototype.hasOwnProperty.call(metadata, 'artist')) file.artist = metadata.artist || '';
      if (Object.prototype.hasOwnProperty.call(metadata, 'albumartist')) file.albumArtist = metadata.albumartist || '';
      if (Object.prototype.hasOwnProperty.call(metadata, 'album')) file.album = metadata.album || '';
      if (Object.prototype.hasOwnProperty.call(metadata, 'year')) file.year = metadata.year || null;
      if (Object.prototype.hasOwnProperty.call(metadata, 'genre')) file.genre = metadata.genre || null;
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
        notifyUser('Metadata editing supports MP3, FLAC, Opus/Ogg and M4A. WebM is not safely editable in place. Nothing to save.');
        return;
      }
      showToast(skippedUneditable.length + ' unsupported file(s) skipped — WebM and WAV are not safely editable in place.');
    }
    if (!isManual && (!proposedData || !proposedData.tags)) return notifyUser('Select a metadata result first.');
    btn.textContent = 'Saving...';
    setMetadataSaveBusy(true);
    metaSearchRequestSeq++;
    metaDetailRequestSeq++;
    var metadataSearchBtn = $('meta-search-btn'); if (metadataSearchBtn) metadataSearchBtn.innerHTML = '<i class="ph ph-magnifying-glass"></i> Search Metadata';

    try {
      if (isManual) {
      var tags = {};
      function manualFieldChanged(id) { return $(id).value !== String(metaManualInitialValues[id] === null || metaManualInitialValues[id] === undefined ? '' : metaManualInitialValues[id]); }
      function changedText(id) { return manualFieldChanged(id) ? $(id).value.trim() : undefined; }
      var nextTitle = changedText('meta-title'); if (nextTitle !== undefined) tags.title = nextTitle;
      var nextArtist = changedText('meta-artist'); if (nextArtist !== undefined) tags.artist = nextArtist;
      var nextAlbumArtist = changedText('meta-album-artist'); if (nextAlbumArtist !== undefined) tags.performerInfo = nextAlbumArtist;
      var nextAlbum = changedText('meta-album'); if (nextAlbum !== undefined) tags.album = nextAlbum;
      var nextYear = changedText('meta-year'); if (nextYear !== undefined) tags.year = nextYear;
      var nextGenre = changedText('meta-genre'); if (nextGenre !== undefined) tags.genre = nextGenre;
      var trackNoChanged = manualFieldChanged('meta-track-no');
      var trackTotalChanged = manualFieldChanged('meta-track-total');
      var discNoChanged = manualFieldChanged('meta-disc-no');
      var discTotalChanged = manualFieldChanged('meta-disc-total');
      var manualTrackNo = trackNoChanged ? (parseInt($('meta-track-no').value || '0', 10) || 0) : 0;
      var manualTrackTotal = trackTotalChanged ? (parseInt($('meta-track-total').value || '0', 10) || 0) : 0;
      var manualDiscNo = discNoChanged ? (parseInt($('meta-disc-no').value || '0', 10) || 0) : 0;
      var manualDiscTotal = discTotalChanged ? (parseInt($('meta-disc-total').value || '0', 10) || 0) : 0;
      if (metaCoverPath) tags.image = stripFileUrl(metaCoverPath);

      var saveFolderJpg = $('meta-save-folder-jpg') ? $('meta-save-folder-jpg').checked : false;
      var applyOrderAsTrackNo = (($('meta-save-track-order') && $('meta-save-track-order').checked) || ($('at-save-track-order') && $('at-save-track-order').checked));
      var hasManualChanges = Object.keys(tags).length > 0 || trackNoChanged || trackTotalChanged || discNoChanged || discTotalChanged || applyOrderAsTrackNo;
      if (!hasManualChanges) {
        btn.textContent = 'Save';
        setMetadataSaveBusy(false);
        return notifyUser('No metadata changes to save.');
      }
      if (trackTotalChanged && !trackNoChanged && !applyOrderAsTrackNo && targetEntries.some(function (entry) {
        var current = resolveCurrentLibraryFile(entry.file);
        return !current || !current.trackNo;
      })) {
        btn.textContent = 'Save';
        setMetadataSaveBusy(false);
        return notifyUser('Track Total can only be changed when every target has a Track No. Set Track No too, or edit those files separately.');
      }
      if (discTotalChanged && !discNoChanged && targetEntries.some(function (entry) {
        var current = resolveCurrentLibraryFile(entry.file);
        return !current || !current.discNo;
      })) {
        btn.textContent = 'Save';
        setMetadataSaveBusy(false);
        return notifyUser('Disc Total can only be changed when every target has a Disc No. Set Disc No too, or edit those files separately.');
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
        if (trackNoChanged && !nextTrackNoForFile) tagsForThisFile.trackNumber = '';
        if (trackTotalChanged && !nextTrackTotalForFile) tagsForThisFile.trackTotal = '';
        if (discNoChanged && !nextDiscNoForFile) tagsForThisFile.discNumber = '';
        if (discTotalChanged && !nextDiscTotalForFile) tagsForThisFile.discTotal = '';
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
        var previousAlbumKey = getAlbumKey(f);
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
        if (migrateAlbumPreferences(previousAlbumKey, f)) albumPreferencesChanged = true;

        var pct = Math.round(((i + 1) / targetFiles.length) * 100);
        $('meta-save-bar').style.width = pct + '%';
        $('meta-save-text').textContent = 'Saved ' + (i + 1) + '/' + targetFiles.length + ': ' + (f.filename || f.title || fp);
      }
      if (!(await persistChangedMetadata())) { await failMetadataSave('Audio tags were saved, but the library index could not be updated.'); return; }
      if (albumPreferencesChanged) await persistSettings(appSettings);

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
        return notifyUser('Select at least one metadata field to write.');
      }
      var warningRows = Array.from(document.querySelectorAll('.at-row-apply[data-warn="1"]')).filter(function (el) { return el.checked; }).length;
      if ((chkTitles || chkNums) && warningRows > 0 && !await requestConfirmation(warningRows + ' selected track match(es) look suspicious. If your local order differs from MusicBrainz, wrong titles or numbers can be written. Continue anyway?')) {
        if ($('meta-save-progress')) $('meta-save-progress').remove();
        btn.textContent = 'Save';
        setMetadataSaveBusy(false);
        return;
      }
      if ((chkTitles || chkNums) && proposedData.tracks.length !== originalTargetCount && !await requestConfirmation('MusicBrainz has ' + proposedData.tracks.length + ' track(s), local album has ' + originalTargetCount + '. Continue with only matched rows?')) {
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
        return notifyUser('Select at least one matched Use row to write metadata.');
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
        var previousAlbumKeyAuto = getAlbumKey(f);

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
        if (migrateAlbumPreferences(previousAlbumKeyAuto, f)) albumPreferencesChanged = true;

        var pct = Math.round(((i + 1) / targetFiles.length) * 100);
        $('meta-save-bar').style.width = pct + '%';
        $('meta-save-text').textContent = 'Saved ' + (i + 1) + '/' + targetFiles.length + ': ' + (f.filename || f.title || fp);
      }
      if (!(await persistChangedMetadata())) { await failMetadataSave('Audio tags were saved, but the library index could not be updated.'); return; }
      if (albumPreferencesChanged) await persistSettings(appSettings);
      }

      var playlistSync = syncPlaylistTrackDetailsFromLibrary(targetFiles);
      playlistSyncUpdated = playlistSync.updated;
      if (playlistSyncUpdated) {
        try {
          await persistPlaylists(state.playlists);
        } catch (e) {
          console.error('Failed to save playlist metadata updates:', e);
          revertPlaylistTrackDetailsSync(playlistSync);
          playlistSyncUpdated = 0;
          playlistSyncWarning = ' Playlist details could not be saved; check disk space and permissions.';
        }
      }

      if ($('meta-save-progress')) $('meta-save-progress').remove();
      btn.style.display = '';
      btn.textContent = 'Saved!';
      restoreMetadataPlaybackIfNeeded();
      showToast('Metadata written to ' + changedFileCount + ' file' + (changedFileCount === 1 ? '' : 's') + '.' + (playlistSyncUpdated ? ' Updated ' + playlistSyncUpdated + ' playlist entr' + (playlistSyncUpdated === 1 ? 'y' : 'ies') + '.' : '') + (metadataReadWarnings.length ? ' Could not reread ' + metadataReadWarnings.length + '; the library index kept the values that were written.' : '') + playlistSyncWarning, { duration: (metadataReadWarnings.length || playlistSyncWarning) ? 8000 : 3600 });
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
}
