function initSpotifyAccountControls() {
  var sourceModal = $('playlist-import-source-modal');
  var fields = $('playlist-import-account-fields');
  var linkFields = $('playlist-import-link-fields');
  var status = $('spotify-account-status');
  var list = $('spotify-account-playlists');
  var connect = $('spotify-account-connect');
  var disconnect = $('spotify-account-disconnect');
  var refresh = $('spotify-account-refresh');
  var progress = $('spotify-account-import-progress');
  var cancel = $('spotify-account-cancel-import');
  var activeRequest = '';
  var generation = 0;
  var busy = false;

  function setBusy(value) {
    busy = value;
    connect.disabled = value;
    disconnect.disabled = value;
    refresh.disabled = value;
    list.querySelectorAll('button').forEach(function (button) { button.disabled = value; });
  }
  async function showStatus() {
    var account = await window.api.spotifyAccountStatus();
    connect.hidden = !!account.connected;
    disconnect.hidden = !account.connected;
    refresh.hidden = !account.connected;
    status.textContent = account.connected ? 'Connected as ' + (account.account && account.account.name || 'Spotify account') :
      account.secureStorageAvailable ? 'Connect to see your Spotify playlists.' : 'Secure credential storage is unavailable on this computer.';
    connect.disabled = busy || !account.secureStorageAvailable;
    return account;
  }
  async function loadPlaylists() {
    if (busy) return;
    setBusy(true);
    list.textContent = 'Loading playlists…';
    try {
      var data = await window.api.listSpotifyAccountPlaylists();
      list.replaceChildren();
      if (!data.playlists.length) { list.textContent = 'No own or collaborative playlists found.'; return; }
      data.playlists.forEach(function (playlist) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'spotify-account-playlist';
        var artwork = document.createElement('span'); artwork.className = 'spotify-account-playlist-cover';
        if (playlist.coverUrl) { var image = document.createElement('img'); image.src = playlist.coverUrl; image.alt = ''; artwork.appendChild(image); }
        else artwork.innerHTML = '<i class="ph ph-playlist" aria-hidden="true"></i>';
        var title = document.createElement('strong'); title.textContent = playlist.name;
        var count = document.createElement('span'); count.textContent = playlist.count + ' tracks';
        var copy = document.createElement('span'); copy.className = 'spotify-account-playlist-copy'; copy.append(title, count);
        button.append(artwork, copy);
        button.addEventListener('click', function () { readPlaylist(playlist); });
        list.appendChild(button);
      });
    } catch (error) { list.textContent = (error && error.message) || 'Could not load Spotify playlists.'; }
    finally { setBusy(false); }
  }
  async function readPlaylist(playlist) {
    if (busy || activeRequest) return;
    var requestId = 'spotify_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    var requestGeneration = ++generation;
    activeRequest = requestId;
    cancel.hidden = false;
    progress.textContent = 'Reading ' + playlist.name + '…';
    setBusy(true);
    try {
      var result = await window.api.importSpotifyAccountPlaylist(playlist.id, requestId);
      if (requestGeneration !== generation) return;
      if (!result || !result.ok || !Array.isArray(result.records) || !result.records.length) throw new Error('Spotify playlist was incomplete.');
      await showPlaylistImportReview(result);
      if (!$('playlist-import-modal').classList.contains('active') && !$('playlist-import-modal').classList.contains('show')) throw new Error('Playlist review could not be opened.');
      hideModal(sourceModal);
      hideModal($('settings-modal'));
    } catch (error) {
      if (requestGeneration === generation) {
        progress.textContent = (error && error.message) || 'Could not read Spotify playlist.';
        showToast(progress.textContent);
      }
    } finally {
      if (requestGeneration === generation) { activeRequest = ''; cancel.hidden = true; setBusy(false); }
    }
  }
  if (window.api.onSpotifyAccountImportProgress) window.api.onSpotifyAccountImportProgress(function (update) {
    if (update && update.requestId === activeRequest) progress.textContent = 'Reading ' + update.done + ' / ' + update.total + ' tracks…';
  });
  $('playlist-import-account-choice').addEventListener('click', async function () {
    linkFields.hidden = true;
    fields.hidden = false;
    try { if ((await showStatus()).connected) await loadPlaylists(); }
    catch (error) { status.textContent = (error && error.message) || 'Spotify account status unavailable.'; }
  });
  $('playlist-import-file-choice').addEventListener('click', function () { fields.hidden = true; });
  $('playlist-import-link-choice').addEventListener('click', function () { fields.hidden = true; });
  $('import-playlist-btn').addEventListener('click', function () { fields.hidden = true; progress.textContent = ''; });
  connect.addEventListener('click', async function () {
    if (busy) return;
    setBusy(true);
    status.textContent = 'Complete Spotify sign-in in your browser…';
    try { await window.api.connectSpotifyAccount(); await showStatus(); setBusy(false); await loadPlaylists(); }
    catch (error) { status.textContent = (error && error.message) || 'Spotify sign-in failed.'; setBusy(false); }
  });
  disconnect.addEventListener('click', async function () {
    if (busy) return;
    try { await window.api.disconnectSpotifyAccount(); list.replaceChildren(); await showStatus(); }
    catch (error) { status.textContent = (error && error.message) || 'Could not disconnect Spotify.'; }
  });
  refresh.addEventListener('click', loadPlaylists);
  cancel.addEventListener('click', function () {
    if (!activeRequest) return;
    window.api.cancelSpotifyAccountImport(activeRequest);
    generation++;
    activeRequest = '';
    cancel.hidden = true;
    progress.textContent = 'Reading cancelled.';
    setBusy(false);
  });
  $('playlist-import-source-cancel').addEventListener('click', function () {
    if (activeRequest) cancel.click();
    else window.api.cancelSpotifyAccountLogin();
  });
  sourceModal.addEventListener('click', function (event) {
    if (event.target !== sourceModal) return;
    if (activeRequest) cancel.click();
    else window.api.cancelSpotifyAccountLogin();
  });
}
