var listenbrainzPlaylistAccount = '';
var listenbrainzPlaylistRequest = 0;
var listenbrainzPreviewRequest = 0;
var listenbrainzPreviewOpener = null;

function matchListenbrainzPlaylistTrack(row) {
  var explicit = getPlaylistTrackFilePath(row);
  var index = getLibraryIndex();
  if (explicit) {
    var file = index.byStrippedPath.get(stripFileUrl(explicit));
    if (file) return file;
  }
  if (row.TrackMbid) {
    var byId = findLocalMusicalIdentity(row);
    if (byId) return byId;
  }
  function exact(value) { return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }
  if (!index.listenbrainzExactNames) {
    index.listenbrainzExactNames = new Map();
    state.musicFiles.forEach(function (file) {
      var key = JSON.stringify([exact(file.artist), exact(file.title)]);
      var matches = index.listenbrainzExactNames.get(key) || [];
      matches.push(file);
      index.listenbrainzExactNames.set(key, matches);
    });
  }
  var matches = index.listenbrainzExactNames.get(JSON.stringify([exact(row.Artist), exact(row.Song)])) || [];
  return matches.length === 1 && (!row.TrackMbid || (!matches[0].trackMbid && !matches[0].recordingMbid) ||
    exact(row.TrackMbid) === exact(matches[0].trackMbid || matches[0].recordingMbid)) ? matches[0] : null;
}

function closeListenbrainzPlaylistPreview(restoreFocus) {
  ++listenbrainzPreviewRequest;
  $('listenbrainz-playlist-preview').hidden = true;
  $('listenbrainz-preview-tracks').replaceChildren();
  if (restoreFocus) listenbrainzPreviewOpener?.focus();
  listenbrainzPreviewOpener = null;
}

function connectedListenbrainzPlaylistAccount() {
  return appSettings.listenbrainzConnected ? appSettings.listenbrainzUsername || '' : '';
}

async function renderListenbrainzPlaylists(force) {
  var account = connectedListenbrainzPlaylistAccount();
  if (force !== true && account === listenbrainzPlaylistAccount) return;
  listenbrainzPlaylistAccount = account;
  var requestId = ++listenbrainzPlaylistRequest;
  closeListenbrainzPlaylistPreview(false);
  var list = $('listenbrainz-playlist-list');
  var status = $('listenbrainz-playlists-status');
  var retry = $('listenbrainz-playlists-retry');
  retry.hidden = true;
  list.replaceChildren();
  if (!account) { status.textContent = 'Connect ListenBrainz in Settings to browse your discovery playlists.'; return; }
  status.textContent = 'Loading ListenBrainz playlists…';
  function current() {
    return requestId === listenbrainzPlaylistRequest && connectedListenbrainzPlaylistAccount() === account;
  }
  try {
    var playlists = await window.api.listenbrainzCreatedPlaylists();
    if (!current()) return;
    status.textContent = playlists.length ? '' : 'ListenBrainz has not created any playlists for this account yet.';
    playlists.forEach(function (playlist) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn btn-outline';
      button.textContent = playlist.name;
      button.addEventListener('click', function () { openListenbrainzPlaylist(playlist, account, button); });
      list.appendChild(button);
    });
  } catch {
    if (!current()) return;
    status.textContent = 'Could not load ListenBrainz playlists.';
    retry.hidden = false;
    listenbrainzPlaylistAccount = '';
  }
}

async function openListenbrainzPlaylist(playlist, account, button) {
  closeListenbrainzPlaylistPreview(false);
  listenbrainzPreviewOpener = button;
  var requestId = ++listenbrainzPreviewRequest;
  var preview = $('listenbrainz-playlist-preview');
  var title = $('listenbrainz-preview-title');
  var status = $('listenbrainz-preview-status');
  var list = $('listenbrainz-preview-tracks');
  var play = $('listenbrainz-preview-play');
  var review = $('listenbrainz-preview-import');
  preview.hidden = false;
  title.textContent = playlist.name;
  title.focus();
  status.textContent = 'Loading tracks…';
  play.disabled = review.disabled = true;
  function current() {
    return requestId === listenbrainzPreviewRequest && connectedListenbrainzPlaylistAccount() === account;
  }
  try {
    var result = await window.api.listenbrainzCreatedPlaylist(playlist.id);
    if (!current()) return;
    if (!result) throw new Error('Playlist unavailable.');
    var matched = [];
    var rows = document.createDocumentFragment();
    result.records.forEach(function (row) {
      var file = matchListenbrainzPlaylistTrack(row);
      var playable = file && !libraryMissingFilePaths.has(file.filePath);
      if (playable) matched.push(file);
      var li = document.createElement('li');
      var text = document.createElement('span');
      text.textContent = row.Song + ' — ' + row.Artist;
      var badge = document.createElement('small');
      badge.textContent = playable ? 'In library' : 'Missing';
      li.append(text, badge);
      rows.appendChild(li);
    });
    list.replaceChildren(rows);
    status.textContent = result.records.length ? matched.length + ' matched · ' + (result.records.length - matched.length) + ' missing' : 'This playlist is empty.';
    play.disabled = !matched.length;
    review.disabled = !result.records.length;
    play.onclick = function () {
      if (!current() || state.currentView !== 'playlists') return;
      initAudioCtx();
      state.playQueueTracks = matched.map(makeTrackCommandRecord);
      state.shuffleQueue = [];
      if (state.isShuffle) rebuildShuffleQueueForMode();
      playTrack(state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks[0]);
    };
    review.onclick = function () {
      if (!current() || state.currentView !== 'playlists') return;
      hideModal($('listenbrainz-playlists-modal'));
      showPlaylistImportReview({ format: 'listenbrainz', name: result.name, records: result.records.map(row => ({ ...row })) })
        .catch(function () { showToast('Could not open the playlist import review.'); });
    };
  } catch {
    if (current()) status.textContent = 'Could not load tracks. Select the playlist again to retry.';
  }
}

function initListenbrainzPlaylists() {
  var modal = $('listenbrainz-playlists-modal');
  $('listenbrainz-playlists-open').addEventListener('click', function () {
    $('playlist-import-source-cancel').click();
    showModal(modal, { initialFocus: '#listenbrainz-playlists-close' });
    renderListenbrainzPlaylists(true);
  });
  $('listenbrainz-playlists-close').addEventListener('click', function () { hideModal(modal); });
  modal.addEventListener('click', function (event) { if (event.target === modal) hideModal(modal); });
  $('listenbrainz-playlists-retry').addEventListener('click', function () { renderListenbrainzPlaylists(true); });
  $('listenbrainz-preview-close').addEventListener('click', function () { closeListenbrainzPlaylistPreview(true); });
}
