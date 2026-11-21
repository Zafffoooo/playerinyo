var listenbrainzHistoryImportActive = false;

var listenbrainzOutboxTimer;
var listenbrainzOutboxRefreshId = 0;

async function refreshListenbrainzOutbox() {
  clearTimeout(listenbrainzOutboxTimer);
  var requestId = ++listenbrainzOutboxRefreshId;
  var panel = $('listenbrainz-outbox');
  if (!appSettings.listenbrainzConnected || activeSettingsPage !== 'connections' ||
      !$('settings-modal').classList.contains('active') || !window.api?.listenbrainzOutboxStatus) {
    panel.hidden = true;
    return;
  }
  var username = appSettings.listenbrainzUsername;
  var status = await window.api.listenbrainzOutboxStatus().catch(() => null);
  if (requestId !== listenbrainzOutboxRefreshId || username !== appSettings.listenbrainzUsername) return;
  panel.hidden = false;
  var parts = status ? [status.pending + ' pending'] : ['Queue status unavailable'];
  if (status?.lastSentAt) parts.push('Last sent ' + new Date(status.lastSentAt).toLocaleString());
  if (status?.rejected) parts.push(status.rejected + ' rejected');
  if (status?.reconnect) parts.push('Reconnect ListenBrainz to resume');
  $('listenbrainz-outbox-status').textContent = parts.join(' · ');
  $('listenbrainz-outbox-retry').hidden = !status?.pending || status.reconnect;
  listenbrainzOutboxTimer = setTimeout(refreshListenbrainzOutbox, 3000);
}

function refreshScrobblingSettings() {
  $('listenbrainz-username').textContent = appSettings.listenbrainzConnected ? appSettings.listenbrainzUsername || 'Connected' : 'Not connected';
  $('listenbrainz-connect-form').hidden = !!appSettings.listenbrainzConnected;
  $('listenbrainz-connected-actions').hidden = !appSettings.listenbrainzConnected;
  refreshListenbrainzOutbox();
  $('lastfm-connection-account').textContent = appSettings.lastfmConnected ? appSettings.lastfmUsername || 'Connected' : '';
  $('lastfm-connection-options').hidden = appSettings.lastfmProEnabled !== true;
  $('btn-lastfm-login').textContent = appSettings.lastfmConnected ? 'Disconnect Last.fm' : 'Connect Last.fm';
  $('listenbrainz-import-history').disabled = listenbrainzHistoryImportActive || !appSettings.listenbrainzConnected;
  $('listenbrainz-disconnect').disabled = !appSettings.listenbrainzConnected;
  $('setting-listenbrainz-genre-radio').checked = appSettings.listenbrainzGenreRadioEnabled !== false;
  $('setting-lastfm-pro').checked = appSettings.lastfmProEnabled === true;
  $('setting-lastfm-scrobble').checked = appSettings.lastfmScrobbleEnabled === true;
  $('setting-lastfm-scrobble').disabled = appSettings.lastfmProEnabled !== true;
}

function initListenbrainzSettings() {
  $('listenbrainz-outbox-retry').addEventListener('click', async function (event) {
    var button = event.currentTarget;
    button.disabled = true;
    try { await window.api.listenbrainzOutboxRetry(); }
    catch { showToast('Could not retry the ListenBrainz queue.'); }
    finally {
      button.disabled = false;
      refreshListenbrainzOutbox();
    }
  });
  var token = $('listenbrainz-token');
  var status = $('listenbrainz-status');
  var connect = $('listenbrainz-connect');
  $('listenbrainz-connect-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var value = token.value;
    token.value = '';
    connect.disabled = true;
    status.textContent = 'Checking token…';
    try {
      var result = await window.api.listenbrainzConnect(value);
      if (!result.ok) throw new Error(result.error || 'Could not connect.');
      appSettings.listenbrainzConnected = true;
      appSettings.listenbrainzUsername = result.username;
      status.textContent = '';
      updateConnectionsIcon();
      if (state.currentView === 'home') renderHomeDashboard();
      if (state.currentView === 'playlists') renderListenbrainzPlaylists();
      refreshScrobblingSettings();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      connect.disabled = false;
    }
  });
  $('listenbrainz-disconnect').addEventListener('click', async function () {
    try {
      if (!await window.api.listenbrainzDisconnect()) throw new Error('Could not disconnect.');
      appSettings.listenbrainzConnected = false;
      appSettings.listenbrainzUsername = '';
      status.textContent = '';
      $('listenbrainz-history-status').textContent = '';
      updateConnectionsIcon();
      if (state.currentView === 'home') renderHomeDashboard();
      if (state.currentView === 'playlists') renderListenbrainzPlaylists();
      refreshScrobblingSettings();
    } catch {
      status.textContent = 'Could not disconnect.';
    }
  });
  var importHistory = $('listenbrainz-import-history');
  var historyStatus = $('listenbrainz-history-status');
  importHistory.addEventListener('click', async function () {
    var username = appSettings.listenbrainzUsername;
    listenbrainzHistoryImportActive = true;
    importHistory.disabled = true;
    historyStatus.textContent = 'Preparing history import…';
    try {
      while (appSettings.listenbrainzConnected && appSettings.listenbrainzUsername === username) {
        var result = await window.api.listenbrainzImportHistory();
        if (result.status !== 'waiting') {
          historyStatus.textContent = result.status === 'completed' ? 'Listening history imported.' : result.error || 'History import stopped.';
          return;
        }
        historyStatus.textContent = 'Waiting for ListenBrainz to prepare the export…';
        await new Promise(function (resolve) { setTimeout(resolve, 30000); });
      }
      historyStatus.textContent = 'History import stopped.';
    } catch {
      historyStatus.textContent = 'Could not import listening history.';
    } finally {
      listenbrainzHistoryImportActive = false;
      refreshScrobblingSettings();
    }
  });
  $('setting-listenbrainz-genre-radio').addEventListener('change', function (event) {
    appSettings.listenbrainzGenreRadioEnabled = event.target.checked;
    if (!event.target.checked && state.radioSession?.providerId === 'listenbrainz') stopRadioStation();
    persistInBackground(persistSettings(appSettings));
    if (state.currentView === 'radio') renderRadioView();
  });
  $('setting-lastfm-pro').addEventListener('change', async function (event) {
    appSettings.lastfmProEnabled = event.target.checked;
    if (!event.target.checked) $('btn-lastfm-cancel').click();
    await persistSettings(appSettings);
    var saved = await window.api.loadSettings();
    appSettings.lastfmConnected = saved.lastfmConnected;
    if (state.currentView === 'home') renderHomeDashboard();
    updateConnectionsIcon();
    refreshScrobblingSettings();
  });
  $('setting-lastfm-scrobble').addEventListener('change', function (event) {
    appSettings.lastfmScrobbleEnabled = event.target.checked;
    persistInBackground(persistSettings(appSettings));
  });
}
