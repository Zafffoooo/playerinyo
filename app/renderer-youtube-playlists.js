var youtubeHubTab = 'followed';
var youtubeHubLinkRequest = '';
var youtubeHubGeneration = 0;
var youtubeHubVersions = [];

function youtubeHubButton(text, action, primary) {
  var button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn ' + (primary ? 'btn-primary' : 'btn-outline');
  button.textContent = text;
  button.addEventListener('click', action);
  return button;
}

function renderYouTubePreview(name, rows, removed, generation, archive, followed = false) {
  var panel = $('youtube-hub-preview');
  panel.hidden = false;
  panel.replaceChildren();
  var heading = document.createElement('h3');
  heading.textContent = name;
  var summary = document.createElement('p');
  summary.className = 'connection-status';
  var unavailable = rows.filter(row => row.unavailable).length;
  summary.textContent = (rows.length - unavailable) + ' available · ' + removed.length + ' removed' +
    (unavailable ? ' · ' + unavailable + ' unavailable' : '') +
    (followed?.added.length ? ' · ' + followed.added.length + ' new' : '');
  panel.append(heading, summary);
  var trackList = document.createElement('ul');
  var selected = new Set();
  var canImport = archive && rows.concat(removed).some(row => row.name);
  var importButton;
  var actions = document.createElement('div');
  actions.className = 'connection-actions youtube-followed-actions';
  var addedCounts = new Map();
  if (followed) followed.added.forEach(row => addedCounts.set(row.videoId, (addedCounts.get(row.videoId) || 0) + 1));
  var items = [];
  rows.concat(removed.map(row => ({ ...row, removed: true }))).forEach(function (row) {
    var item = document.createElement('li');
    var label = document.createElement('label');
    if (canImport && row.name) {
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !followed;
      if (input.checked) selected.add(row);
      input.addEventListener('change', function () {
        if (input.checked) selected.add(row); else selected.delete(row);
        importButton.disabled = !selected.size;
      });
      label.appendChild(input);
    }
    label.append(document.createTextNode([row.name || row.videoId || 'Unknown track', row.artist].filter(Boolean).join(' — ')));
    if (row.source) label.append(document.createTextNode(' · ' + row.source));
    item.appendChild(label);
    var added = !row.removed && !row.unavailable && addedCounts.get(row.videoId) > 0;
    if (added) addedCounts.set(row.videoId, addedCounts.get(row.videoId) - 1);
    if (row.removed || row.unavailable || added) {
      var state = document.createElement('small');
      state.textContent = row.removed ? (row.recentlyRemoved ? 'Just removed' : 'Removed') : row.unavailable ? 'Unavailable' : 'New';
      item.appendChild(state);
    }
    items.push({ item, input: label.querySelector("input"), status: row.removed ? "removed" : row.unavailable ? "unavailable" : added ? "new" : "available" });
    trackList.appendChild(item);
  });
  if (canImport) {
    importButton = youtubeHubButton('Import selected', function () {
      if (!selected.size || generation !== youtubeHubGeneration) return;
      var records = Array.from(selected, row => ({ Song: row.name, Artist: row.artist, Album: row.album || '',
        VideoId: row.videoId || '', SourceUrl: row.videoId ? 'https://music.youtube.com/watch?v=' + row.videoId : '' }));
      showPlaylistImportReview({ name, records, format: 'youtube-archive' }).catch(() => showToast('Could not open import review.'));
    }, true);
    importButton.disabled = !selected.size;
    actions.appendChild(importButton);
  }
  if (followed) {
    var filter = document.createElement('select');
    filter.className = 'meta-inp';
    filter.setAttribute('aria-label', 'Filter archived tracks');
    [['All tracks', 'all'], ['New', 'new'], ['Removed', 'removed'], ['Unavailable', 'unavailable']].forEach(([name, value]) => filter.add(new Option(name, value)));
    filter.addEventListener('change', () => items.forEach(({ item, status }) => {
      item.hidden = filter.value !== 'all' && filter.value !== status;
    }));
    actions.prepend(filter);
    if (followed.added.length && canImport) actions.append(youtubeHubButton('Select new tracks', () => {
      items.forEach(({ input, status }) => {
        if (input && input.checked !== (status === 'new')) input.click();
      });
    }));
  }
  panel.append(actions, trackList);
  return actions;
}

async function renderYouTubeArchiveRows(generation) {
  var list = $('youtube-hub-list');
  var query = $('youtube-archive-search').value.trim().toLowerCase();
  var versions = youtubeHubVersions.slice().reverse();
  list.replaceChildren();
  for (const version of versions) {
    if (query && !version.name.toLowerCase().includes(query)) {
      const item = await window.api.youtubeArchiveRead(version.id);
      if (generation !== youtubeHubGeneration) return;
      if (!item?.tracks.some(row => [row.name, row.artist, row.videoId].some(value => String(value || '').toLowerCase().includes(query)))) continue;
    }
    if (generation !== youtubeHubGeneration) return;
    list.appendChild(youtubeHubButton(version.name + ' · ' + version.count + ' tracks · ' +
      new Date(version.savedAt).toLocaleDateString(), async function () {
      var previewGeneration = ++youtubeHubGeneration;
      try {
        var current = await window.api.youtubeArchiveRead(version.id);
        var position = youtubeHubVersions.findIndex(row => row.id === version.id);
        var before = youtubeHubVersions.slice(0, position).filter(row => row.name === version.name).at(-1);
        var earlier = before ? await window.api.youtubeArchiveRead(before.id) : null;
        if (previewGeneration !== youtubeHubGeneration || !current) return;
        var counts = new Map();
        var keyOf = row => row.videoId || JSON.stringify([row.name, row.artist]);
        current.tracks.forEach(row => counts.set(keyOf(row), (counts.get(keyOf(row)) || 0) + 1));
        var removed = (earlier?.tracks || []).filter(row => {
          var key = keyOf(row);
          var count = counts.get(key);
          if (!count) return true;
          counts.set(key, count - 1);
          return false;
        });
        renderYouTubePreview(version.name, current.tracks, removed, previewGeneration, true);
      } catch { $('youtube-hub-status').textContent = 'Could not open this archive version.'; }
    }));
  }
}

async function renderYouTubeHub(tab) {
  youtubeHubTab = tab;
  var generation = ++youtubeHubGeneration;
  $('youtube-hub-followed').setAttribute('aria-pressed', String(tab === 'followed'));
  $('youtube-hub-archive').setAttribute('aria-pressed', String(tab === 'archive'));
  $('youtube-archive-tools').hidden = tab !== 'archive';
  $('youtube-hub-preview').hidden = true;
  var list = $('youtube-hub-list');
  list.replaceChildren();
  var status = $('youtube-hub-status');
  status.textContent = 'Loading playlists…';
  try {
    if (tab === 'archive') {
      var versions = await window.api.youtubeArchiveList();
      if (generation !== youtubeHubGeneration) return;
      youtubeHubVersions = versions;
      status.textContent = versions.length ? '' : 'Add a playlist file or paste track names to start your archive.';
      await renderYouTubeArchiveRows(generation);
      return;
    }
    var rows = await window.api.youtubeLinkList();
    if (generation !== youtubeHubGeneration) return;
    status.textContent = rows.length ? '' : 'Read a playlist to follow its link here.';
    rows.forEach(function (row) {
      var group = document.createElement('div');
      group.className = 'youtube-followed-row';
      var details = youtubeHubButton(row.name + ' · ' + row.count + (row.count === 1 ? ' track' : ' tracks'), () => openYouTubeFollowed(row.id));
      var detail = document.createElement('p');
      detail.className = 'connection-status';
      detail.textContent = (row.following ? 'Following' : 'Following stopped') + ' · Last successful check ' +
        new Date(row.lastSuccess).toLocaleString();
      group.append(details, detail);
      if (row.error) {
        var error = document.createElement('p');
        error.className = 'connection-status';
        error.textContent = row.error;
        group.append(error);
      }
      list.appendChild(group);
    });
  } catch {
    if (generation === youtubeHubGeneration) status.textContent = 'Could not load playlists. Select the tab to retry.';
  }
}

async function openYouTubeFollowed(id, action) {
  var generation = ++youtubeHubGeneration;
  var status = $('youtube-hub-status');
  var preview = $('youtube-hub-preview');
  var enabled = action ? [...preview.querySelectorAll('button:not(:disabled)')] : [];
  enabled.forEach(button => { button.disabled = true; });
  status.textContent = action === 'check' ? 'Checking playlist…' : 'Loading archive…';
  try {
    if (action === 'check') await window.api.youtubeLinkCheck(id);
    if (action === 'stop') await window.api.youtubeLinkStop(id);
    if (generation !== youtubeHubGeneration) return;
    if (action) {
      var refresh = renderYouTubeHub('followed');
      var refreshedGeneration = youtubeHubGeneration;
      await refresh;
      if (refreshedGeneration === youtubeHubGeneration) await openYouTubeFollowed(id);
      return;
    }
    var snapshot = await window.api.youtubeLinkRead(id);
    if (generation !== youtubeHubGeneration) return;
    if (!snapshot) throw Error();
    status.textContent = snapshot.error;
    var actions = renderYouTubePreview(snapshot.name, snapshot.tracks, snapshot.removed, generation, true, snapshot);
    if (snapshot.following) {
      actions.append(youtubeHubButton('Check now', () => openYouTubeFollowed(id, 'check')),
        youtubeHubButton('Stop following', () => openYouTubeFollowed(id, 'stop')));
    }
  } catch {
    if (generation !== youtubeHubGeneration) return;
    status.textContent = 'Could not open or update this archive. Try again.';
    enabled.forEach(button => { button.disabled = false; });
  }
}

async function followYouTubeLink(id, button, status, message = '') {
  button.disabled = true;
  status.textContent = 'Saving followed link…';
  try {
    if (!await window.api.youtubeLinkFollow(id)) throw Error();
    if (button.dataset.playlistId !== id) return;
    button.hidden = true;
    status.textContent = ['Following link. The archive updates every four hours while Playerinyo is open.', message].filter(Boolean).join(' ');
    if ($('youtube-playlist-modal').classList.contains('active')) renderYouTubeHub('followed');
  } catch {
    if (button.dataset.playlistId !== id) return;
    button.disabled = false;
    status.textContent = 'Could not follow this link. Read the playlist and try again.';
  }
}

function showUnavailableYouTubeLink(result, status) {
  status.textContent = 'All tracks in this playlist are unavailable.';
  if (!result.canFollowYouTube) return;
  var follow = youtubeHubButton('Follow link', () => followYouTubeLink(result.youtubePlaylistId, follow, status));
  follow.dataset.playlistId = result.youtubePlaylistId;
  follow.classList.add('youtube-unavailable-follow');
  status.after(follow);
}

function initYouTubePlaylists() {
  $('youtube-playlist-open').addEventListener('click', function () {
    $('playlist-import-source-cancel').click();
    showModal($('youtube-playlist-modal'), { initialFocus: '#youtube-hub-url' });
    renderYouTubeHub(youtubeHubTab);
  });
  $('youtube-hub-close').addEventListener('click', function () {
    ++youtubeHubGeneration;
    if (youtubeHubLinkRequest) {
      window.api.cancelPlaylistUrlImport(youtubeHubLinkRequest).catch(() => {});
      youtubeHubLinkRequest = '';
      $('youtube-hub-link').disabled = false;
      $('youtube-hub-link-status').textContent = '';
    }
    hideModal($('youtube-playlist-modal'));
  });
  $('youtube-hub-followed').addEventListener('click', () => renderYouTubeHub('followed'));
  $('youtube-hub-archive').addEventListener('click', () => renderYouTubeHub('archive'));
  $('youtube-hub-link-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    if (youtubeHubLinkRequest) return;
    $('youtube-hub-link-form').querySelector('.youtube-unavailable-follow')?.remove();
    var request = 'youtube_link_' + Date.now();
    youtubeHubLinkRequest = request;
    var button = $('youtube-hub-link');
    var status = $('youtube-hub-link-status');
    button.disabled = true;
    status.textContent = 'Reading playlist…';
    try {
      var result = await window.api.importPlaylistUrl($('youtube-hub-url').value.trim(), request, 'youtube');
      if (request !== youtubeHubLinkRequest) return;
      if (!result?.ok) {
        status.textContent = result?.error || 'Could not read this playlist.';
        return;
      }
      if (!result.records.length) {
        showUnavailableYouTubeLink(result, status);
        return;
      }
      status.textContent = '';
      await showPlaylistImportReview(result);
    } catch {
      if (request === youtubeHubLinkRequest) status.textContent = 'Could not open this playlist. Try again.';
    } finally {
      if (request === youtubeHubLinkRequest) {
        youtubeHubLinkRequest = '';
        button.disabled = false;
      }
    }
  });
  window.api.onPlaylistUrlImportProgress(progress => {
    if (progress.requestId !== youtubeHubLinkRequest) return;
    $('youtube-hub-link-status').textContent = progress.total ?
      progress.message + ' ' + progress.done + ' / ' + progress.total : progress.message;
  });
  $('youtube-hub-link-form').addEventListener('input', () => {
    $('youtube-hub-link-form').querySelector('.youtube-unavailable-follow')?.remove();
  });
  $('playlist-import-follow-youtube').addEventListener('click', function () {
    followYouTubeLink(this.dataset.playlistId, this, $('playlist-import-youtube-status'), this.dataset.message);
  });
  $('youtube-archive-search').addEventListener('input', function () {
    $('youtube-hub-preview').hidden = true;
    renderYouTubeArchiveRows(++youtubeHubGeneration).catch(() => showToast('Could not search the archive.'));
  });
  $('youtube-archive-paste').addEventListener('click', function () {
    var form = $('youtube-archive-form');
    form.hidden = !form.hidden;
    $('youtube-archive-paste').setAttribute('aria-expanded', String(!form.hidden));
    if (!form.hidden) $('youtube-archive-name').focus();
  });
  $('youtube-archive-file').addEventListener('click', async function () {
    try { if (await window.api.youtubeArchiveFile()) renderYouTubeHub('archive'); }
    catch { showToast('Could not read this Takeout or CSV file.'); }
  });
  $('youtube-recovery-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    var request = ++youtubeHubGeneration;
    var status = $('youtube-hub-status');
    status.textContent = 'Searching listening history…';
    try {
      var rows = await window.api.youtubeArchiveRecovery($('youtube-recovery-artist').value);
      if (request !== youtubeHubGeneration) return;
      status.textContent = rows.length ? 'Possible matches from your archive and listening history.' : 'No matches in the available archive or listening history.';
      renderYouTubePreview('Recovery candidates', rows, [], request, true);
    } catch { if (request === youtubeHubGeneration) status.textContent = 'Could not search listening history.'; }
  });
  $('youtube-archive-form').addEventListener('submit', async function (event) {
    event.preventDefault();
    try {
      await window.api.youtubeArchiveText($('youtube-archive-name').value, $('youtube-archive-text').value);
      event.target.reset();
      renderYouTubeHub('archive');
    } catch { showToast('Could not save this CSV. Check the column names.'); }
  });
}
