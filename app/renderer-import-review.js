function initSearchSourcePicker() {
  var searchSource = $('global-search-source');
  var sourceButton = $('global-search-source-button');
  var sourceList = $('global-search-source-list');
  if (sourceButton && sourceList && searchSource) {
    var sourceOptions = Array.from(sourceList.querySelectorAll('[role="option"]'));
    var sourcePicker = sourceButton.closest('.search-source-picker');
    function closeSourceList() {
      sourceList.hidden = true;
      sourceButton.setAttribute('aria-expanded', 'false');
    }
    function positionSourceList() {
      var bounds = sourceButton.getBoundingClientRect();
      sourceList.style.minWidth = bounds.width + 'px';
      sourceList.style.left = Math.max(8, Math.min(bounds.left, window.innerWidth - sourceList.offsetWidth - 8)) + 'px';
      sourceList.style.top = (bounds.bottom + 5) + 'px';
    }
    function syncSourceButton() {
      var selected = sourceOptions.find(function (option) { return option.dataset.source === searchSource.value; });
      if (!selected) return;
      sourceButton.firstChild.textContent = selected.textContent + ' ';
      sourceOptions.forEach(function (item) { item.setAttribute('aria-selected', item === selected ? 'true' : 'false'); });
    }
    function chooseSource(option, focusSearch) {
      searchSource.value = option.dataset.source;
      syncSourceButton();
      searchSource.dispatchEvent(new Event('change'));
      closeSourceList();
      var input = $('global-search');
      if (focusSearch && input) input.focus(); else sourceButton.focus();
    }
    sourceButton.addEventListener('click', function () {
      if (!sourceList.hidden) { closeSourceList(); return; }
      if (sourceList.parentNode !== document.body) document.body.appendChild(sourceList);
      sourceList.hidden = false;
      sourceButton.setAttribute('aria-expanded', 'true');
      positionSourceList();
      var selectedOption = sourceOptions.find(function (option) { return option.dataset.source === searchSource.value; });
      if (selectedOption) selectedOption.focus();
    });
    sourceButton.addEventListener('keydown', function (event) { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); sourceButton.click(); } });
    sourceList.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') { event.preventDefault(); closeSourceList(); sourceButton.focus(); return; }
      var current = sourceOptions.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); sourceOptions[(current + (event.key === 'ArrowDown' ? 1 : sourceOptions.length - 1)) % sourceOptions.length].focus(); }
    });
    sourceOptions.forEach(function (option) { option.addEventListener('click', function () { chooseSource(option, false); }); });
    searchSource.addEventListener('change', syncSourceButton);
    document.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' || !event.shiftKey || event.ctrlKey || event.metaKey || event.altKey || modalStack.length) return;
      var editable = event.target && event.target.closest && event.target.closest('input,textarea,select,[contenteditable="true"]');
      if (editable && editable.id !== 'global-search') return;
      var next = sourceOptions.find(function (option) { return option.dataset.source !== searchSource.value; });
      if (!next) return;
      event.preventDefault(); event.stopPropagation();
      chooseSource(next, true);
    }, true);
    document.addEventListener('pointerdown', function (event) { if (!sourcePicker.contains(event.target) && !sourceList.contains(event.target)) closeSourceList(); });
    document.addEventListener('focusin', function (event) { if (!sourcePicker.contains(event.target) && !sourceList.contains(event.target)) closeSourceList(); });
    window.addEventListener('resize', function () { if (!sourceList.hidden) positionSourceList(); });
    window.addEventListener('scroll', function () { if (!sourceList.hidden) closeSourceList(); }, true);
  }
}

function syncYouTubeMusicResultsPlaybackState() {
  document.querySelectorAll('.youtube-music-row[data-video-id]').forEach(function (row) {
    var button = row.querySelector('.youtube-music-play');
    var status = row.querySelector('.youtube-music-row-status');
    if (!button || button.disabled || !status) return;
    var current = state.currentPlayingTrack && state.currentPlayingTrack.playback && state.currentPlayingTrack.playback.videoId === row.dataset.videoId;
    if (current) {
      button.textContent = state.isPlaying ? 'Playing' : 'Play';
      status.textContent = state.isPlaying ? 'Playing now' : 'Paused';
      row.dataset.playbackStatus = state.isPlaying ? 'playing' : 'paused';
    } else if (row.dataset.playbackStatus === 'playing' || row.dataset.playbackStatus === 'paused') {
      button.textContent = 'Play'; status.textContent = ''; row.dataset.playbackStatus = '';
    }
  });
}

function playlistImportIdentity(row) {
  var uri = String(row && (row.TrackUri || row.SourceUrl) || '').trim();
  if (uri) return 'uri:' + uri;
  return 'name:' + [getImportTrackTitle(row), getImportTrackArtist(row), getImportTrackAlbum(row)].map(function (value) { return String(value || '').trim().toLocaleLowerCase(); }).join('::');
}
async function showPlaylistImportReview(importResult, reimportTarget) {
  var sourcePath = importResult && importResult.sourcePath || '';
  var groups = buildPlaylistImportGroups(sourcePath, importResult && importResult.records, importResult && importResult.name);
  if (reimportTarget) {
    groups = groups.filter(function (group) { return group.name === reimportTarget.importSource.group; });
    if (!groups.length) { showToast('This source no longer contains the selected playlist.'); return; }
    var oldByKey = new Map();
    (reimportTarget.tracks || []).forEach(function (row) {
      var key = playlistImportIdentity(row);
      if (!oldByKey.has(key)) oldByKey.set(key, []);
      oldByKey.get(key).push(row);
    });
    var diff = { added: 0, existing: 0, removed: 0 };
    groups[0].tracks = groups[0].tracks.map(function (row) {
      var bucket = oldByKey.get(playlistImportIdentity(row));
      var prior = bucket && bucket.shift();
      if (prior) { prior.__importDiff = 'existing'; diff.existing++; return prior; }
      row.__importDiff = 'new'; diff.added++; return row;
    });
    oldByKey.forEach(function (bucket) { bucket.forEach(function (row) { row.__importDiff = 'removed'; groups[0].tracks.push(row); diff.removed++; }); });
    groups[0].name = reimportTarget.name;
  }
  if (!groups.length) return;
  if (importResult && importResult.coverUrl && groups.length === 1) groups[0].cover = importResult.coverUrl;
  var coverPreview = $('playlist-import-cover-preview');
  if (coverPreview) {
    var coverUrl = groups.length === 1 && typeof groups[0].cover === 'string' && /^https:\/\//i.test(groups[0].cover) ? groups[0].cover : '';
    coverPreview.hidden = !coverUrl;
    if (coverUrl) coverPreview.src = coverUrl;
    else coverPreview.removeAttribute('src');
  }
  groups.forEach(function (group) { group.tracks.forEach(function (row) {
    if (isM3uImportRecord(row)) row.__addLocalSelected = false;
    else row.__downloadSelected = !reimportTarget || row.__importDiff === 'new';
  }); });
  cancelPlaylistCandidateSearch(false);
  pendingPlaylistImport = { sourcePath: sourcePath, sourceFormat: importResult.format || '', groups: groups, conflictMode: 'create', reimportTarget: reimportTarget || null, diff: reimportTarget ? diff : null };
  var groupChoice = $('playlist-import-group-choice');
  var groupList = $('playlist-import-group-list');
  if (groupChoice && groupList) {
    groupChoice.hidden = groups.length < 2;
    groupList.replaceChildren();
    if (groups.length > 1) groups.forEach(function (group, index) {
      var label = document.createElement('label');
      var checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true;
      checkbox.addEventListener('change', function () {
        if (!pendingPlaylistImport) return;
        pendingPlaylistImport.groups = Array.from(groupList.querySelectorAll('input:checked')).map(function (input) { return groups[Number(input.dataset.groupIndex)]; });
        renderPlaylistImportReview();
      });
      checkbox.dataset.groupIndex = String(index);
      label.append(checkbox, document.createTextNode(group.name + ' (' + group.tracks.length + ')'));
      groupList.appendChild(label);
    });
  }
  if (getPlaylistImportRows().some(function (item) { return isPlaylistImportDownloadEligible(item.row); }) && !appSettings.ytdlDownloadFolder && window.api.getDefaultDownloadFolder) appSettings.ytdlDownloadFolder = await window.api.getDefaultDownloadFolder();
  var titleEl = $('playlist-import-title'); if (titleEl) titleEl.textContent = reimportTarget ? 'Reimport Playlist' : 'Import Playlist';
  var importOnlyBtn = $('playlist-import-only'); if (importOnlyBtn) importOnlyBtn.textContent = reimportTarget ? 'Add new tracks' : 'Import Only';
  var options = $('playlist-import-options'); if (options) options.hidden = !!reimportTarget;
  var conflict = $('playlist-import-conflict'); if (conflict) conflict.value = 'create';
  var status = $('playlist-import-status'); if (status) status.textContent = '';
  var toolStatus = $('playlist-import-tool-status'); if (toolStatus) toolStatus.textContent = '';
  setPlaylistImportProgress(false, '', 0, 0);
  renderPlaylistImportReview();
  showModal($('playlist-import-modal'));
  var missingRows = getMissingImportRows(false);
  if (!reimportTarget && importResult.format !== 'url' && missingRows.length > 0 && missingRows.length <= 5) {
    setTimeout(function () { if (pendingPlaylistImport && pendingPlaylistImport.sourcePath === sourcePath) searchImportCandidateRows(missingRows, 'missing tracks'); }, 0);
  }
}

var versionPickerRequest = 0;
async function openVersionPicker(track) {
  if (!track || !(isRemotePlaybackTrack(track) || (track.csvRecord && !track.matchedFile)) || !window.api.searchYouTubeMusic) return;
  var modal = $('version-picker-modal');
  var results = $('version-picker-results');
  var description = $('version-picker-track');
  if (!modal || !results) return;
  var request = ++versionPickerRequest;
  description.textContent = (track.title || '') + ' · ' + (track.artist || '');
  results.textContent = 'Searching YouTube Music…';
  showModal(modal);
  try {
    var response = await window.api.searchYouTubeMusic((track.title || '') + ' ' + (track.artist || ''));
    if (request !== versionPickerRequest || !modal.classList.contains('active')) return;
    results.replaceChildren();
    if (!response || !response.ok || !response.songs || !response.songs.length) { results.textContent = (response && response.error) || 'No versions found.'; return; }
    response.songs.forEach(function (song) {
      if (!/^[A-Za-z0-9_-]{11}$/.test(song.videoId)) return;
      var button = document.createElement('button'); button.type = 'button'; button.className = 'version-picker-result';
      var art = document.createElement('img'); art.alt = ''; art.src = song.artwork || 'https://i.ytimg.com/vi/' + song.videoId + '/hqdefault.jpg';
      var label = document.createElement('span'); var title = document.createElement('strong'); title.textContent = song.title;
      var detail = document.createElement('small'); detail.textContent = song.artist + (song.duration ? ' · ' + fmt(song.duration) : '');
      label.append(title, detail); button.append(art, label);
      if (track.playback && song.videoId === track.playback.videoId) { button.disabled = true; detail.textContent += ' · Current version'; }
      button.addEventListener('click', async function () {
        var previousPlayback = track.playback;
        var previousArt = track.artwork;
        var previousDisabled = track.isDisabled;
        track.playback = { kind: 'youtube', videoId: song.videoId };
        track.isDisabled = false;
        track.artwork = song.artwork || 'https://i.ytimg.com/vi/' + song.videoId + '/hqdefault.jpg';
        if (track.csvRecord) {
          var previousRecord = { VideoId: track.csvRecord.VideoId, PlaybackSource: track.csvRecord.PlaybackSource, Artwork: track.csvRecord.Artwork };
          track.csvRecord.VideoId = song.videoId;
          track.csvRecord.PlaybackSource = 'youtube';
          track.csvRecord.Artwork = track.artwork;
          try { await persistPlaylists(state.playlists); }
          catch (error) { track.playback = previousPlayback; track.artwork = previousArt; track.isDisabled = previousDisabled; Object.assign(track.csvRecord, previousRecord); showToast('Could not save this version.'); return; }
        }
        syncSavedQueuePaths(); saveSettingsDebounced(200);
        if (preparedRadioSlot && preparedRadioSlot.queueEntryId === track.queueEntryId) clearPreparedRadioSlot(true);
        hideModal(modal); versionPickerRequest++;
        renderQueue(); if (isFullscreenQueueOpen()) renderFullscreenQueue();
        if (track.csvRecord && state.currentView === track.sourcePlaylistId) renderPlaylist(track.sourcePlaylistId);
        if (state.currentPlayingTrack === track) playTrack(track, { preserveQueueCursors: true });
        else showToast('Selected version saved.');
      });
      results.appendChild(button);
    });
    var first = results.querySelector('button:not(:disabled)'); if (first) first.focus();
  } catch (_) { if (request === versionPickerRequest) results.textContent = 'Could not search versions. Try again.'; }
}

function initImportReviewControls() {
  initSearchSourcePicker();
  var versionAction = $('ctx-select-version');
  if (versionAction) versionAction.addEventListener('click', function () { if (currentContextMenuTrack) openVersionPicker(currentContextMenuTrack); });
  var versionClose = $('version-picker-close');
  if (versionClose) versionClose.addEventListener('click', function () { versionPickerRequest++; hideModal($('version-picker-modal')); });
}
