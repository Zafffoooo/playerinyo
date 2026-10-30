var downloadQueueFilter = 'all';
var downloadQueueExpandedJobs = new Set();
function downloadJobCoverUrl(job) {
  if (job.coverUrl) return job.coverUrl;
  for (var item of job.items || []) {
    if (item.row && item.row.CoverUrl) return item.row.CoverUrl;
    var file = state.musicFiles.find(function (entry) { return entry.filePath && item.filePath && stripFileUrl(entry.filePath) === stripFileUrl(item.filePath); });
    if (file && file.picture) return file.picture;
  }
  return '';
}
function renderDownloadQueue() {
  var panel = $('download-queue-panel');
  var list = $('download-queue-list');
  var summary = $('download-queue-summary');
  var badge = $('download-queue-badge');
  if (panel) {
    panel.classList.toggle('open', downloadQueuePanelOpen);
    panel.setAttribute('aria-hidden', downloadQueuePanelOpen ? 'false' : 'true');
  }
  var activeItems = getDownloadQueueActiveItems();
  if (badge) {
    badge.textContent = activeItems ? String(activeItems) : '';
    badge.style.display = activeItems ? 'flex' : 'none';
  }
  var running = getDownloadQueueRunningJob();
  var currentItem = running && (running.items || []).find(function (item) { return item.status === 'downloading' || item.status === 'searching'; });
  var dockProgress = $('download-dock-progress');
  var dockLabel = $('download-dock-label');
  var dockCount = $('download-dock-count');
  var dockBar = $('download-dock-bar');
  var dockJob = running || downloadQueue.find(function (job) { return job.status === 'queued'; });
  if (dockProgress) dockProgress.hidden = !dockJob;
  if (dockJob && dockLabel) {
    var currentIndex = currentItem ? (dockJob.items || []).indexOf(currentItem) : -1;
    var count = (dockJob.items || []).filter(function (item) { return item.status === 'done'; }).length;
    var shownIndex = currentIndex >= 0 ? currentIndex + 1 : (dockJob.status === 'queued' ? 0 : Math.min(dockJob.total, count + 1));
    var row = currentItem && currentItem.row || (dockJob.items || [])[shownIndex - 1]?.row || {};
    dockLabel.textContent = [getImportTrackArtist(row) || currentItem?.artist || '', getImportTrackAlbum(row) || dockJob.title || ''].filter(Boolean).join(' · ') || 'Preparing download';
    if (dockCount) dockCount.textContent = shownIndex + '/' + dockJob.total;
    var dockButton = $('btn-download-queue');
    dockButton.title = dockLabel.textContent + ' · ' + shownIndex + '/' + dockJob.total;
    dockButton.setAttribute('aria-label', 'Open downloads, ' + dockButton.title);
  }
  if (dockBar) {
    dockBar.style.width = currentItem && Number.isFinite(currentItem.downloadPercent) ? Math.max(0, Math.min(100, currentItem.downloadPercent)) + '%' : '0%';
  }
  if (!dockJob && dockCount) { dockCount.textContent = ''; $('btn-download-queue').title = 'Downloads'; $('btn-download-queue').setAttribute('aria-label', 'Open downloads'); }
  if (summary) {
    if (running) summary.textContent = running.status === 'checking' ? 'Checking download tools' : 'Running ' + running.current + '/' + running.total;
    else if (downloadQueue.some(function (job) { return job.status === 'queued'; })) summary.textContent = 'Waiting to start';
    else summary.textContent = downloadQueue.length ? 'Finished' : 'No active downloads';
  }
  persistDownloadQueueStateSoon();
  if (!downloadQueuePanelOpen) return;
  if (!list) return;
  list.innerHTML = '';
  var visibleJobs = downloadQueue.filter(function (job) {
    if (downloadQueueFilter === 'active') return ['queued', 'checking', 'running'].includes(job.status);
    if (downloadQueueFilter === 'done') return job.status === 'done';
    if (downloadQueueFilter === 'failed') return job.status === 'failed' || job.failed > 0;
    return true;
  });
  if (!visibleJobs.length) {
    list.innerHTML = '<div class="download-queue-empty">' + (downloadQueue.length ? 'No downloads in this view.' : 'No downloads yet. Search for a track or choose an album to begin.') + '</div>';
    return;
  }
  visibleJobs.slice().reverse().forEach(function (job) {
    var card = document.createElement('div');
    card.className = 'download-job ' + (job.status || 'queued');
    var pct = job.total ? Math.round((job.current / job.total) * 100) : 0;
    var actionsHtml = '';
    if (job.status === 'failed') actionsHtml = '<button type="button" class="download-job-mini-btn retry" data-job-id="' + esc(job.id) + '">Retry failed</button>';
    else if (job.status === 'queued' || job.status === 'running') actionsHtml = '<button type="button" class="download-job-mini-btn cancel" data-job-id="' + esc(job.id) + '">' + (job.status === 'running' ? 'Stop' : 'Cancel') + '</button>';
    var qualityLabel = { 'best-native': 'Best Native', opus: 'Opus', m4a: 'M4A / AAC', mp3: 'MP3' }[job.quality] || 'Best Native';
    var coverUrl = job.type === 'album-release' ? downloadJobCoverUrl(job) : '';
    var coverHtml = /^(?:https:\/\/|file:\/\/|data:image\/(?:png|jpeg|webp);base64,)/i.test(coverUrl) ? '<img class="download-job-cover" src="' + esc(coverUrl) + '" alt="" />' : '';
    var collapsed = job.status === 'done' && !downloadQueueExpandedJobs.has(job.id);
    card.innerHTML = '<div class="download-job-top">' + coverHtml + '<div class="download-job-heading"><strong>' + esc(job.title || 'Download job') + '</strong><span>' + esc(job.statusLabel || job.status || 'queued') + ' • ' + esc(qualityLabel) + ' • ' + job.current + '/' + job.total + '</span></div><div class="download-job-side"><em>' + pct + '%</em>' + actionsHtml + '</div></div>' +
      '<div class="download-job-bar"><span style="width:' + pct + '%"></span></div>';
    if (job.status === 'done') {
      var expand = document.createElement('button'); expand.type = 'button'; expand.className = 'download-job-expand';
      expand.textContent = (collapsed ? 'Show ' : 'Hide ') + (job.items || []).length + ' tracks';
      expand.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      expand.addEventListener('click', function () { if (collapsed) downloadQueueExpandedJobs.add(job.id); else downloadQueueExpandedJobs.delete(job.id); renderDownloadQueue(); });
      card.appendChild(expand);
    }
    var retryBtn = card.querySelector('.download-job-mini-btn.retry');
    if (retryBtn) retryBtn.addEventListener('click', function (e) { e.stopPropagation(); retryDownloadQueueJob(job.id); });
    var cancelBtn = card.querySelector('.download-job-mini-btn.cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function (e) { e.stopPropagation(); cancelDownloadQueueJob(job.id); });
    var items = document.createElement('div');
    items.className = 'download-job-items';
    items.hidden = collapsed;
    (job.items || []).forEach(function (item, itemIndex) {
      var row = document.createElement('div');
      row.className = 'download-job-item ' + (item.status || 'queued');
      var icon = item.status === 'done' ? 'ph-check-circle' : (item.status === 'failed' ? 'ph-warning-circle' : (item.status === 'downloading' ? 'ph-download-simple' : (item.status === 'searching' ? 'ph-magnifying-glass' : 'ph-clock')));
      var progressText = item.status === 'downloading' && typeof item.downloadPercent === 'number' ? ' • ' + Math.round(item.downloadPercent) + '%' : '';
      var outputInfo = item.status === 'done' && item.container
        ? ' • ' + esc(String(item.container).toUpperCase()) + (item.codec ? ' / ' + esc(String(item.codec)) : '')
        : '';
      var itemActions = '';
      if (item.status === 'done' && item.filePath) itemActions = '<button type="button" class="download-job-file-btn go-file">Go to file</button>';
      else if (item.status === 'failed' && item.row) itemActions = '<span class="download-job-item-actions"><button type="button" class="download-job-file-btn review-candidate">Review</button><button type="button" class="download-job-file-btn retry-item">Retry</button></span>';
      row.innerHTML = '<i class="ph ' + icon + '"></i><span><strong>' + esc(item.title || 'Unknown Track') + '</strong><small>' + esc(item.artist || '') + progressText + outputInfo + (item.error ? ' • ' + esc(item.error) : '') + '</small></span>' + itemActions;
      var fileBtn = row.querySelector('.go-file');
      if (fileBtn) fileBtn.addEventListener('click', function (e) { e.stopPropagation(); showFileLocation(item.filePath); });
      var reviewBtn = row.querySelector('.review-candidate');
      if (reviewBtn) reviewBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        if (isDownloadQueueItemReviewOpen(job, itemIndex)) {
          if (item.candidateSearchBusy) cancelCandidateSearchRequest(item.row);
          downloadQueueReview = { jobId: '', itemIndex: -1 };
        } else downloadQueueReview = { jobId: job.id, itemIndex: itemIndex };
        renderDownloadQueue();
      });
      var retryItemBtn = row.querySelector('.retry-item');
      if (retryItemBtn) retryItemBtn.addEventListener('click', function (e) { e.stopPropagation(); retryDownloadQueueItem(job.id, itemIndex); });
      items.appendChild(row);
      if (item.status === 'failed' && item.row && isDownloadQueueItemReviewOpen(job, itemIndex)) {
        var panel = document.createElement('div');
        panel.className = 'download-job-candidate-panel';
        var selectedCandidate = item.row.__downloadCandidate;
        panel.innerHTML = '<div class="download-job-candidate-head"><span>' + (selectedCandidate ? ('Selected: ' + esc(formatImportCandidateConfidence(selectedCandidate)) + ' confidence') : 'No candidate selected') + '</span><button type="button" class="download-job-mini-btn search-candidates">' + (item.candidateSearchBusy ? 'Searching...' : 'Search again') + '</button></div>';
        var searchBtn = panel.querySelector('.search-candidates');
        if (searchBtn) {
          searchBtn.disabled = !!item.candidateSearchBusy;
          searchBtn.addEventListener('click', function (e) { e.stopPropagation(); searchDownloadQueueItemCandidates(job.id, itemIndex); });
        }
        if (item.row.__candidateNotice || item.row.__candidateError) {
          var note = document.createElement('div');
          note.className = item.row.__candidateError ? 'playlist-import-candidate-error' : 'playlist-import-candidate-note';
          note.textContent = item.row.__candidateError || item.row.__candidateNotice;
          panel.appendChild(note);
        }
        if (item.row.__downloadCandidates && item.row.__downloadCandidates.length) {
          var candidateBox = document.createElement('div');
          candidateBox.className = 'playlist-import-candidates download-job-candidates';
          item.row.__downloadCandidates.forEach(function (candidate) {
            var candidateBtn = document.createElement('button');
            candidateBtn.type = 'button';
            var confidence = getImportCandidateConfidence(candidate);
            candidateBtn.className = 'playlist-import-candidate confidence-' + confidence + (selectedCandidate && getImportCandidateUrl(selectedCandidate) === getImportCandidateUrl(candidate) ? ' selected' : '');
            var thumb = candidate.thumbnail ? '<img src="' + esc(candidate.thumbnail) + '" alt="" />' : '<span class="playlist-import-candidate-thumb"><i class="ph ph-play"></i></span>';
            candidateBtn.innerHTML = thumb + '<span><strong>' + esc(candidate.title || 'Unknown video') + '</strong><small>' + esc(candidate.uploader || '') + ' - ' + esc(formatImportCandidateDuration(candidate.duration)) + ' - ' + esc(formatImportCandidateConfidence(candidate)) + ' confidence - score ' + esc(candidate.score) + '</small></span>';
            candidateBtn.addEventListener('click', function (e) {
              e.stopPropagation();
              if (selectedCandidate && getImportCandidateUrl(selectedCandidate) === getImportCandidateUrl(candidate)) setImportRowCandidate(item.row, null, false);
              else setImportRowCandidate(item.row, candidate, true);
              item.error = '';
              renderDownloadQueue();
            });
            candidateBox.appendChild(candidateBtn);
          });
          panel.appendChild(candidateBox);
        }
        var retrySelected = document.createElement('button');
        retrySelected.type = 'button';
        retrySelected.className = 'download-job-file-btn retry-selected';
        retrySelected.textContent = selectedCandidate ? 'Retry selected' : 'Retry with auto-search';
        retrySelected.addEventListener('click', function (e) { e.stopPropagation(); retryDownloadQueueItem(job.id, itemIndex); });
        panel.appendChild(retrySelected);
        items.appendChild(panel);
      }
    });
    card.appendChild(items);
    list.appendChild(card);
  });
}
function setDownloadQueuePanel(open) {
  if (open) switchView('downloads');
  else if (state.currentView === 'downloads') switchView('home');
}

function cancelDirectDownloadSearch() {
  if (!directDownloadSearchRequestId) return;
  var requestId = directDownloadSearchRequestId;
  directDownloadSearchRequestId = '';
  directDownloadSearchRequestSeq++;
  if (window.api.cancelDownload) Promise.resolve(window.api.cancelDownload(requestId)).catch(function (e) { console.error('Direct download search cancellation failed:', e); });
}
function setDirectDownloadSearchOpen(open) {
  var panel = $('download-search');
  var toggle = $('download-search-toggle');
  if (!panel) return;
  panel.hidden = !open;
  if (toggle) toggle.setAttribute('aria-pressed', open ? 'true' : 'false');
  if (open) {
    var input = $('download-search-query');
    if (input) input.focus({ preventScroll: true });
  } else cancelDirectDownloadSearch();
}
function renderDirectDownloadSearchResults(candidates) {
  var results = $('download-search-results');
  if (!results) return;
  results.replaceChildren();
  (candidates || []).forEach(function (candidate) {
    if (!candidate || !/^[A-Za-z0-9_-]{11}$/.test(String(candidate.id || ''))) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'download-search-result';
    var thumb = candidate.thumbnail ? '<img src="' + esc(candidate.thumbnail) + '" alt="">' : '<span class="download-search-result-thumb"><i class="ph ph-music-note" aria-hidden="true"></i></span>';
    button.innerHTML = thumb + '<span><strong>' + esc(candidate.title || 'Unknown video') + '</strong><small>' + esc(candidate.uploader || 'Unknown uploader') + ' • ' + esc(formatImportCandidateDuration(candidate.duration)) + '</small></span><i class="ph ph-download-simple" aria-hidden="true"></i>';
    button.addEventListener('click', function () { enqueueDirectSearchDownload(candidate); });
    results.appendChild(button);
  });
}
async function searchDirectDownload() {
  var input = $('download-search-query');
  var status = $('download-search-status');
  var submit = $('download-search-submit');
  var query = String(input && input.value || '').replace(/\s+/g, ' ').trim();
  if (query.length < 2) {
    if (status) status.textContent = 'Enter an artist and track to search.';
    renderDirectDownloadSearchResults([]);
    if (input) input.focus();
    return;
  }
  cancelDirectDownloadSearch();
  var requestSeq = ++directDownloadSearchRequestSeq;
  var requestId = 'direct_download_search_' + Date.now() + '_' + requestSeq;
  directDownloadSearchRequestId = requestId;
  if (submit) { submit.disabled = true; submit.innerHTML = '<i class="ph ph-spinner-gap ph-spin" aria-hidden="true"></i> Searching'; }
  if (status) status.textContent = 'Searching YouTube…';
  renderDirectDownloadSearchResults([]);
  try {
    var result = await window.api.searchDownloadCandidates({ searchQuery: query }, 10, requestId);
    if (requestSeq !== directDownloadSearchRequestSeq || directDownloadSearchRequestId !== requestId) return;
    if (!result || !result.ok) {
      if (status) status.textContent = (result && result.cancelled) ? '' : ((result && result.error) || 'Search failed.');
      return;
    }
    var candidates = (result.candidates || []).filter(function (candidate) { return /^[A-Za-z0-9_-]{11}$/.test(String(candidate && candidate.id || '')); });
    if (status) status.textContent = candidates.length ? (candidates.length + ' results. Choose one to queue it.') : 'No results found.';
    renderDirectDownloadSearchResults(candidates);
  } catch (e) {
    if (requestSeq === directDownloadSearchRequestSeq && status) status.textContent = 'Search failed: ' + ((e && e.message) || String(e || 'unknown error'));
  } finally {
    if (requestSeq === directDownloadSearchRequestSeq && directDownloadSearchRequestId === requestId) {
      directDownloadSearchRequestId = '';
      if (submit) { submit.disabled = false; submit.innerHTML = '<i class="ph ph-magnifying-glass" aria-hidden="true"></i> Search'; }
    }
  }
}
function enqueueDirectSearchDownload(candidate) {
  if (!candidate || !/^[A-Za-z0-9_-]{11}$/.test(String(candidate.id || ''))) return;
  var row = {
    Song: String(candidate.title || 'Unknown Track').slice(0, 1000),
    Artist: String(candidate.uploader || 'Unknown Artist').slice(0, 1000),
    Duration: Number(candidate.duration || 0),
    VideoId: candidate.id
  };
  var job = makeDownloadQueueJob('direct-search', 'Download: ' + row.Song, [row], '');
  if (!job) { showToast('Already in Library or already queued.'); return; }
  pushDownloadQueueJob(job, 'Queued "' + row.Song + '" for download.');
  setDirectDownloadSearchOpen(false);
}
function makeDownloadQueueJob(type, title, rows, playlistId, options) {
  options = options || {};
  var activeIdentities = new Set();
  downloadQueue.forEach(function (job) { (job.items || []).forEach(function (item) {
    if (['queued', 'searching', 'downloading'].includes(item.status)) activeIdentities.add(getMusicalIdentity(item.row));
  }); });
  var seen = new Set();
  rows = (rows || []).filter(function (row) {
    var identity = getMusicalIdentity(row);
    if (!isPlaylistImportDownloadEligible(row) || !identity || seen.has(identity) || activeIdentities.has(identity)) return false;
    seen.add(identity); return true;
  });
  if (!rows.length) return null;
  rows.forEach(prepareDownloadQueueRow);
  return {
    id: 'download_job_' + Date.now() + '_' + (++downloadJobSeq),
    type: type || 'tracks',
    playlistId: playlistId || '',
    playlistIds: options.playlistIds || (playlistId ? [playlistId] : []),
    savePlaylists: !!options.savePlaylists,
    title: title || 'Downloads',
    coverUrl: options.coverUrl || '',
    status: 'queued',
    statusLabel: 'Queued',
    current: 0,
    total: rows.length,
    downloaded: 0,
    failed: 0,
    cancelRequested: false,
    quality: appSettings.ytdlDownloadQuality || 'best-native',
    items: rows.map(function (row) { return { row: row, title: getImportTrackTitle(row), artist: getImportTrackArtist(row), identity: getMusicalIdentity(row), status: 'queued', error: '' }; })
  };
}
function pushDownloadQueueJob(job, toastMessage) {
  if (!job) return null;
  var terminalJobs = downloadQueue.filter(function (existing) { return existing.status === 'done' || existing.status === 'cancelled' || existing.status === 'failed'; });
  while (terminalJobs.length >= 100) {
    var oldest = terminalJobs.shift();
    var oldestIndex = downloadQueue.indexOf(oldest);
    if (oldestIndex !== -1) downloadQueue.splice(oldestIndex, 1);
  }
  downloadQueue.push(job);
  setDownloadQueuePanel(true);
  renderDownloadQueue();
  processDownloadQueue();
  if (toastMessage) showToast(toastMessage);
  return job;
}
function enqueueExistingPlaylistDownloadJob(importState) {
  if (!importState || !importState.existingPlaylistId) return null;
  var pl = state.playlists.find(function (p) { return p.id === importState.existingPlaylistId; });
  var rows = getPlaylistImportRows().filter(function (item) { return item.row.__downloadSelected !== false && isPlaylistImportDownloadEligible(item.row); }).map(function (item) { return item.row; });
  if (!pl || !rows.length) { showToast('No selected missing tracks to download.'); return null; }
  return pushDownloadQueueJob(makeDownloadQueueJob('existing-playlist', pl.name || 'Playlist Downloads', rows, pl.id, { savePlaylists: true }), 'Queued ' + rows.length + ' download' + (rows.length === 1 ? '' : 's') + ' for "' + (pl.name || 'playlist') + '".');
}
function enqueueImportedPlaylistDownloadJob(title, rows, firstPlaylistId, playlistIds) {
  rows = (rows || []).filter(function (row) { return row.__downloadSelected !== false && isPlaylistImportDownloadEligible(row); });
  if (!rows.length) return null;
  return pushDownloadQueueJob(makeDownloadQueueJob('imported-playlist', title || 'Imported Playlist Downloads', rows, firstPlaylistId || '', { savePlaylists: true, playlistIds: playlistIds || [] }), 'Queued ' + rows.length + ' imported playlist download' + (rows.length === 1 ? '' : 's') + '.');
}
function enqueueAlbumDownloadJob(title, rows) {
  rows = (rows || []).filter(isAlbumDownloadRowMissing);
  if (!rows.length) { showToast('No missing tracks found for this album.'); return null; }
  return pushDownloadQueueJob(makeDownloadQueueJob('album-release', title || 'Album Downloads', rows, '', { coverUrl: rows[0].CoverUrl || '' }), 'Queued ' + rows.length + ' album download' + (rows.length === 1 ? '' : 's') + '.');
}
function cancelDownloadQueueJob(jobId) {
  var job = downloadQueue.find(function (j) { return j.id === jobId; });
  if (!job) return;
  if (job.status === 'queued') {
    job.status = 'cancelled';
    job.statusLabel = 'Cancelled';
    job.current = job.total;
    (job.items || []).forEach(function (item) { if (item.status === 'queued') item.status = 'cancelled'; });
  } else if (job.status === 'running') {
    job.cancelRequested = true;
    job.statusLabel = 'Stopping after current track';
    var searching = (job.items || []).find(function (item) { return item.status === 'searching' && item.row && item.row.__candidateIpcRequestId; });
    if (searching) cancelCandidateSearchRequest(searching.row);
    var active = (job.items || []).find(function (item) { return item.status === 'downloading' && item.requestId; });
    if (active && window.api.cancelDownload) window.api.cancelDownload(active.requestId);
    (job.items || []).forEach(function (item) { if (item.status === 'queued') item.status = 'cancelled'; });
  }
  renderDownloadQueue();
}
function retryDownloadQueueJob(jobId) {
  var job = downloadQueue.find(function (j) { return j.id === jobId; });
  if (!job) return;
  var rows = (job.items || []).filter(function (item) { return item.status === 'failed' && item.row && isPlaylistRecordMissing(item.row); }).map(function (item) { return item.row; });
  if (!rows.length) { showToast('No failed missing tracks to retry.'); return; }
  pushDownloadQueueJob(makeDownloadQueueJob(job.type || 'retry', 'Retry: ' + (job.title || 'Downloads'), rows, job.playlistId || '', { savePlaylists: !!job.savePlaylists, playlistIds: job.playlistIds || [] }), 'Retry queued for ' + rows.length + ' track' + (rows.length === 1 ? '' : 's') + '.');
}
async function processDownloadQueue() {
  if (downloadQueueProcessing) return;
  downloadQueueProcessing = true;
  try {
    var job;
    while ((job = downloadQueue.find(function (j) { return j.status === 'queued'; }))) {
      await runDownloadQueueJob(job);
    }
  } finally {
    downloadQueueProcessing = false;
    renderDownloadQueue();
  }
}
function failDownloadQueueJob(job, statusLabel, itemError) {
  job.status = 'failed';
  job.statusLabel = statusLabel || 'Failed';
  job.failed = 0;
  job.current = job.total;
  (job.items || []).forEach(function (item) {
    if (item.status === 'done' || item.status === 'skipped') return;
    item.status = 'failed';
    item.error = itemError || statusLabel || 'Download failed';
    job.failed++;
    if (item.row) {
      item.row.__downloadStatus = 'failed';
      item.row.__downloadError = item.error;
    }
  });
  renderDownloadQueue();
}
async function ensureDownloadToolsReadyForJob(job) {
  if (!window.api.checkYtdlpTools) return true;
  job.status = 'checking';
  job.statusLabel = 'Checking yt-dlp / ffmpeg';
  renderDownloadQueue();
  try {
    var res = await window.api.checkYtdlpTools();
    if (res && res.ok) return true;
    var error = (res && res.error) || 'yt-dlp / ffmpeg check unavailable.';
    failDownloadQueueJob(job, 'Tools missing', error);
    showToast(error);
    return false;
  } catch (e) {
    var message = (e && e.message) || String(e || 'yt-dlp / ffmpeg check failed.');
    failDownloadQueueJob(job, 'Tool check failed', message);
    showToast(message);
    return false;
  }
}

function syncDownloadedPlaylistRow(row, result) {
  if (!row || !result) return;
  if (result.filePath) row.FilePath = result.filePath;
  var canonical = result.canonicalMetadata || {};
  var libraryItem = result.libraryItem || {};
  var fields = [
    ['Song', canonical.title || libraryItem.title],
    ['Artist', canonical.artist || libraryItem.artist],
    ['Album', canonical.album || libraryItem.album],
    ['AlbumArtist', canonical.albumArtist || libraryItem.albumArtist]
  ];
  fields.forEach(function (field) {
    var value = typeof field[1] === 'string' ? field[1].trim() : '';
    if (value && !/^unknown (?:artist|album)$/i.test(value)) row[field[0]] = value;
  });
  var measuredDuration = Number(libraryItem.duration) || 0;
  var canonicalDuration = Number(canonical.duration) || 0;
  if (measuredDuration > 0) row.Duration = measuredDuration;
  else if (canonicalDuration > 0) {
    // Stream-copy containers do not always expose their duration immediately
    // after tagging. Preserve release metadata in both playlist and library.
    row.Duration = canonicalDuration;
    libraryItem.duration = canonicalDuration;
  }
}

async function commitDownloadedItem(job, item, row, result, fileMap) {
  syncDownloadedPlaylistRow(row, result);
  if (result.libraryItem && result.libraryItem.filePath) fileMap[stripFileUrl(result.libraryItem.filePath)] = result.libraryItem;
  setMusicFiles(Object.values(fileMap));
  reconcilePlaybackQueuesWithLibrary();
  await persistLibrary(state.musicFiles);
  if (job.playlistId || job.savePlaylists) await persistPlaylists(state.playlists);
  await persistSettings(appSettings);
  if (result.recoveryId && window.api.acknowledgeDownloadRecovery) await window.api.acknowledgeDownloadRecovery(result.recoveryId);
  item.status = 'done'; item.error = ''; item.filePath = result.filePath;
  item.container = String(result.container || '').slice(0, 32);
  item.codec = String(result.codec || '').slice(0, 120);
  item.downloadPercent = 100;
}

async function recoverPendingDownloads() {
  if (!window.api.listPendingDownloadRecoveries) return;
  var recoveries = await window.api.listPendingDownloadRecoveries();
  if (!Array.isArray(recoveries) || !recoveries.length) return;
  var fileMap = {};
  state.musicFiles.forEach(function (file) { if (file && file.filePath) fileMap[stripFileUrl(file.filePath)] = file; });
  var recovered = 0;
  for (var i = 0; i < recoveries.length; i++) {
    var recovery = recoveries[i];
    if (!recovery || !recovery.libraryItem || !recovery.libraryItem.filePath) continue;
    fileMap[stripFileUrl(recovery.libraryItem.filePath)] = recovery.libraryItem;
    downloadQueue.forEach(function (job) { (job.items || []).forEach(function (item) {
      if (item.recoveryKey !== recovery.id) return;
      syncDownloadedPlaylistRow(item.row, recovery);
      item.status = 'done'; item.error = ''; item.filePath = recovery.libraryItem.filePath;
      var extensionMatch = String(recovery.libraryItem.filePath || '').match(/\.([a-z0-9]{1,12})$/i);
      item.container = extensionMatch ? extensionMatch[1].toLowerCase() : item.container;
      item.codec = String(recovery.libraryItem.codec || item.codec || '').slice(0, 120);
      item.downloadPercent = 100;
    }); });
    recovered++;
  }
  if (!recovered) return;
  setMusicFiles(Object.values(fileMap));
  reconcilePlaybackQueuesWithLibrary();
  await persistLibrary(state.musicFiles);
  await persistPlaylists(state.playlists);
  await persistSettings(appSettings);
  for (var j = 0; j < recoveries.length; j++) if (recoveries[j] && recoveries[j].id && window.api.acknowledgeDownloadRecovery) await window.api.acknowledgeDownloadRecovery(recoveries[j].id);
  persistDownloadQueueStateNow();
  showToast('Recovered ' + recovered + ' completed download' + (recovered === 1 ? '' : 's') + '.');
}

async function runDownloadQueueJob(job) {
  var pl = job.playlistId ? state.playlists.find(function (p) { return p.id === job.playlistId; }) : null;
  if (job.playlistId && !pl) { job.status = 'failed'; job.statusLabel = 'Playlist missing'; renderDownloadQueue(); return; }
  if (!(await ensureDownloadToolsReadyForJob(job))) return;
  job.status = 'running'; job.statusLabel = 'Starting'; job.current = 0; renderDownloadQueue();
  var fileMap = {};
  state.musicFiles.forEach(function (f) { if (f.filePath) fileMap[stripFileUrl(f.filePath)] = f; });
  for (var i = 0; i < job.items.length; i++) {
    if (job.cancelRequested) break;
    var item = job.items[i];
    if (item.status === 'cancelled') continue;
    var row = item.row;
    if (!row || !isPlaylistRecordMissing(row)) {
      item.status = 'skipped'; item.error = 'Already in library'; job.current++; renderDownloadQueue(); continue;
    }
    item.status = 'searching'; item.error = ''; job.statusLabel = 'Searching'; renderDownloadQueue();
    var hasDirectVideoId = /^[A-Za-z0-9_-]{11}$/.test(String(row.VideoId || ''));
    if (!row.__downloadCandidate && !hasDirectVideoId) await searchImportCandidates(row, true);
    if (job.cancelRequested) { item.status = 'cancelled'; item.error = 'Cancelled'; break; }
    if (!row.__downloadCandidate && !hasDirectVideoId) {
      item.status = 'failed'; item.error = 'No high-confidence candidate selected'; row.__downloadStatus = 'failed'; row.__downloadError = item.error; job.failed++; job.current++; renderDownloadQueue(); continue;
    }
    if (getImportCandidateConfidence(row.__downloadCandidate) === 'low' && !row.__downloadCandidateManual) {
      item.status = 'failed'; item.error = 'Low-confidence candidate'; row.__downloadStatus = 'failed'; row.__downloadError = item.error; job.failed++; job.current++; renderDownloadQueue(); continue;
    }
    row.__downloadStatus = 'downloading'; row.__downloadError = '';
    item.status = 'downloading'; item.error = ''; item.downloadPercent = 0; item.requestId = job.id + '_' + i + '_' + Date.now(); item.recoveryKey = item.recoveryKey || ('download_' + String(job.id).replace(/[^A-Za-z0-9_-]/g, '') + '_' + i); row.__downloadRecoveryKey = item.recoveryKey; job.statusLabel = 'Downloading'; persistDownloadQueueStateNow(); renderDownloadQueue();
    downloadQueueItemsByRequestId.set(item.requestId, item);
    var res;
    try { res = await downloadImportRowWithFallback(row, appSettings.ytdlDownloadFolder || '', item.requestId); }
    finally { downloadQueueItemsByRequestId.delete(item.requestId); }
    if (res && res.ok && res.filePath) {
      try { await commitDownloadedItem(job, item, row, res, fileMap); job.downloaded++; }
      catch (commitError) { item.status = 'failed'; item.error = 'Downloaded but could not commit: ' + (commitError.message || commitError); row.__downloadStatus = 'failed'; row.__downloadError = item.error; job.failed++; }
    } else if (res && res.cancelled) {
      item.status = 'cancelled'; item.error = 'Cancelled'; row.__downloadStatus = 'failed'; row.__downloadError = item.error;
    } else {
      item.status = 'failed'; item.error = (res && res.error) || 'Download failed'; row.__downloadStatus = 'failed'; row.__downloadError = item.error; job.failed++;
    }
    job.current++;
    renderDownloadQueue();
  }
  job.items.forEach(function (item) { if (item.row) clearImportRowTransient(item.row); });
  if (job.cancelRequested) {
    job.status = 'cancelled';
    job.statusLabel = 'Cancelled';
    showToast('Cancelled downloads for "' + (job.title || 'job') + '".');
  } else {
    job.status = job.failed ? 'failed' : 'done';
    job.statusLabel = job.failed ? ('Finished with ' + job.failed + ' failed') : 'Complete';
    if (job.failed) showToast('Download job finished: ' + job.downloaded + ' done, ' + job.failed + ' failed.');
    else showToast('Downloaded ' + job.downloaded + ' track' + (job.downloaded === 1 ? '' : 's') + '.');
  }
  renderSidebarPlaylists();
  if (job.playlistId && state.currentView === job.playlistId) renderPlaylistPreservingScroll(job.playlistId);
  else if (job.savePlaylists && job.playlistIds && job.playlistIds.includes(state.currentView)) renderPlaylistPreservingScroll(state.currentView);
  else if (!job.playlistId && !refreshCurrentAlbumViewAfterDownload(job) && state.currentView === 'library') renderLibrary();
  renderDownloadQueue();
}

function getMetadataSourceOptions() {
  return {
    discogsToken: appSettings.discogsToken || ''
  };
}
function flattenMetadataReleaseTracks(release) {
  var sourceName = release && release.source ? release.source : 'Metadata';
  var albumArtist = readArtistCredit(release && release['artist-credit']);
  var albumTitle = release && release.title ? release.title : '';
  var year = release && release.date ? String(release.date).substring(0, 4) : '';
  var coverUrl = release && (release.coverUrl || (/^MusicBrainz$/i.test(sourceName) && release.id ? ('https://coverartarchive.org/release/' + release.id + '/front-500') : '')) || '';
  var genre = release && release.genres && release.genres[0] ? release.genres[0].name : '';
  var tracks = [];
  (release && release.media ? release.media : []).forEach(function (medium, mediumIndex) {
    var discNo = medium.position || (mediumIndex + 1);
    var discTotal = release.media.length;
    var discTracks = medium.tracks || [];
    discTracks.forEach(function (track, trackIndex) {
      tracks.push({
        title: track.title || '',
        artist: readArtistCredit(track['artist-credit']) || readArtistCredit(track.recording && track.recording['artist-credit']) || track.artist || albumArtist,
        album: albumTitle,
        albumArtist: albumArtist,
        year: year,
        genre: genre,
        coverUrl: coverUrl,
        trackNo: track.position || (trackIndex + 1),
        trackTotal: discTracks.length,
        discNo: discNo,
        discTotal: discTotal,
        duration: track.length || 0,
      });
    });
  });
  return { sourceName: sourceName, albumArtist: albumArtist, albumTitle: albumTitle, year: year, coverUrl: coverUrl, genre: genre, tracks: tracks };
}
function metadataTracksToDownloadRows(meta) {
  return (meta.tracks || []).map(function (track) {
    return {
      Song: track.title || '',
      Artist: track.artist || meta.albumArtist || '',
      Album: track.album || meta.albumTitle || '',
      AlbumArtist: track.albumArtist || meta.albumArtist || '',
      AlbumDate: track.year || meta.year || '',
      Genre: track.genre || meta.genre || '',
      TrackNo: track.trackNo || 0,
      TrackTotal: track.trackTotal || 0,
      DiscNo: track.discNo || 0,
      DiscTotal: track.discTotal || 0,
      Duration: track.duration || 0,
      CoverUrl: track.coverUrl || meta.coverUrl || '',
      __strictAlbumMatch: true,
    };
  });
}
function isAlbumDownloadRowMissing(row) {
  return !(row && row.__autoTagLocalFilePath) && isPlaylistRecordMissing(row);
}
function importPlaylistGroups(groups, conflictMode, source) {
  var firstPlaylistId = '';
  var playlistIds = [];
  var importedRows = [];
  var importAddedAtMs = Date.now();
  conflictMode = conflictMode === 'merge' || conflictMode === 'replace' ? conflictMode : 'create';
  groups.forEach(function (group, idx) {
    var existing = state.playlists.find(function (p) { return !p.isSpecial && (p.name || '').toLowerCase() === (group.name || '').toLowerCase(); });
    if (existing && conflictMode === 'merge') {
      if (!existing.tracks) existing.tracks = [];
      var existingByKey = new Map(existing.tracks.map(function (t) { return [getPlaylistTrackFilePath(t) || ((t.Song || t.title || '').toLowerCase() + '|' + (t.Artist || t.artist || '').toLowerCase() + '|' + (t.Album || t.album || '').toLowerCase()), t]; }));
      var appended = false;
      group.tracks.forEach(function (t) {
        var importKey = getPlaylistTrackFilePath(t) || ((t.Song || t.title || '').toLowerCase() + '|' + (t.Artist || t.artist || '').toLowerCase() + '|' + (t.Album || t.album || '').toLowerCase());
        var target = existingByKey.get(importKey);
        if (!target) {
          target = stampPlaylistTrackAddedAt(t, importAddedAtMs);
          existing.tracks.push(target);
          existingByKey.set(importKey, target);
          appended = true;
        } else {
          copyImportRowTransient(t, target);
        }
        importedRows.push(target);
      });
      if (appended) existing.lastAddedAt = new Date(importAddedAtMs).toISOString();
      if (source) existing.importSource = { path: source.path, format: source.format, group: group.name };
      if (!firstPlaylistId) firstPlaylistId = existing.id;
      if (!playlistIds.includes(existing.id)) playlistIds.push(existing.id);
    } else if (existing && conflictMode === 'replace') {
      group.tracks.forEach(function (track) { stampPlaylistTrackAddedAt(track, importAddedAtMs); });
      existing.tracks = group.tracks;
      if (source) existing.importSource = { path: source.path, format: source.format, group: group.name };
      existing.lastAddedAt = new Date(importAddedAtMs).toISOString();
      if (!firstPlaylistId) firstPlaylistId = existing.id;
      if (!playlistIds.includes(existing.id)) playlistIds.push(existing.id);
      importedRows.push.apply(importedRows, existing.tracks);
    } else {
      group.tracks.forEach(function (track) { stampPlaylistTrackAddedAt(track, importAddedAtMs); });
      var importedName = existing ? getUniquePlaylistName(group.name || 'Imported Playlist') : (group.name || 'Imported Playlist');
      var pl = { id: 'pl_' + Date.now() + '_' + idx, name: importedName, cover: group.cover || null, color: PALETTE[idx % PALETTE.length], tracks: group.tracks, pinned: false, lastPlayed: null, lastAddedAt: new Date(importAddedAtMs).toISOString() };
      if (source) pl.importSource = { path: source.path, format: source.format, group: group.name };
      state.playlists.push(pl);
      if (!firstPlaylistId) firstPlaylistId = pl.id;
      playlistIds.push(pl.id);
      importedRows.push.apply(importedRows, pl.tracks);
    }
  });
  return { firstPlaylistId: firstPlaylistId, playlistIds: playlistIds, rows: importedRows };
}
function updatePlaylistImportActions() {
  if (!pendingPlaylistImport) return;
  var rows = getPlaylistImportRows();
  var downloadable = rows.filter(function (item) { return isPlaylistImportDownloadEligible(item.row); });
  var selected = downloadable.filter(function (item) { return item.row.__downloadSelected !== false; }).length;
  var localCandidates = rows.filter(function (item) { return isLocalPlaylistImportCandidate(item.row); });
  var selectedLocal = localCandidates.filter(function (item) { return item.row.__addLocalSelected === true; }).length;
  var busy = !!(pendingPlaylistImport && pendingPlaylistImport.finishing) || playlistImportSearching || rows.some(function (item) { return !!item.row.__candidateLoading; });
  var btn = $('playlist-import-download');
  if (btn) {
    btn.hidden = !!pendingPlaylistImport.reimportTarget || downloadable.length === 0;
    btn.disabled = busy || selected <= 0;
    btn.textContent = 'Import + Download Selected' + (selected ? ' (' + selected + ')' : '');
  }
  var addLocalBtn = $('playlist-import-add-local');
  if (addLocalBtn) {
    addLocalBtn.hidden = !!pendingPlaylistImport.reimportTarget || localCandidates.length === 0;
    addLocalBtn.disabled = busy || selectedLocal <= 0;
    addLocalBtn.textContent = 'Import + Add Selected Local Files' + (selectedLocal ? ' (' + selectedLocal + ')' : '');
  }
  var downloadTools = $('playlist-import-download-tools');
  if (downloadTools) downloadTools.hidden = !!pendingPlaylistImport.reimportTarget || downloadable.length === 0;
  ['playlist-import-select-missing', 'playlist-import-find-candidates', 'playlist-import-find-all-candidates', 'playlist-import-only', 'playlist-import-cancel', 'playlist-import-cancel-x'].forEach(function (id) {
    var el = $(id);
    if (el) el.disabled = busy;
  });
  var conflict = $('playlist-import-conflict'); if (conflict) conflict.disabled = busy;
  var stopButton = $('playlist-import-stop-search');
  if (stopButton) stopButton.hidden = !busy;
}
function cancelPlaylistCandidateSearch(announce) {
  var rows = getPlaylistImportRows();
  var hadActiveSearch = playlistImportSearching || rows.some(function (item) { return !!(item.row.__candidateLoading || item.row.__candidateQueued); });
  playlistImportSearchGeneration++;
  playlistImportSearching = false;
  rows.forEach(function (item) {
    var row = item.row;
    cancelCandidateSearchRequest(row);
    row.__candidateRequestSeq = (row.__candidateRequestSeq || 0) + 1;
    row.__candidateLoading = false;
    row.__candidateQueued = false;
    row.__candidatePromise = null;
  });
  setPlaylistImportProgress(false, '', 0, 0);
  var status = $('playlist-import-status');
  if (announce && hadActiveSearch && status) status.textContent = 'Candidate search stopped. Completed results were kept.';
  if (pendingPlaylistImport) renderPlaylistImportReview();
  return hadActiveSearch;
}
function cancelCandidateSearchRequest(row) {
  var requestId = row && row.__candidateIpcRequestId;
  if (!requestId) return;
  delete row.__candidateIpcRequestId;
  row.__candidateRequestSeq = (row.__candidateRequestSeq || 0) + 1;
  row.__candidateLoading = false;
  row.__candidateQueued = false;
  row.__candidatePromise = null;
  activeCandidateSearchRequestIds.delete(requestId);
  if (window.api.cancelDownload) Promise.resolve(window.api.cancelDownload(requestId)).catch(function (e) { console.error('Candidate search cancellation failed:', e); });
}
async function searchImportCandidates(row, silent, force, searchGeneration) {
  if (!row || !window.api.searchDownloadCandidates) return [];
  if (row.__candidateLoading && row.__candidatePromise) return row.__candidatePromise;
  if (!force && row.__downloadCandidates && row.__downloadCandidates.length) return row.__downloadCandidates;
  var rowRequestSeq = (row.__candidateRequestSeq || 0) + 1;
  var ipcRequestId = 'candidate_search_' + Date.now() + '_' + (++candidateSearchRequestSeq);
  row.__candidateRequestSeq = rowRequestSeq;
  row.__candidateIpcRequestId = ipcRequestId;
  activeCandidateSearchRequestIds.add(ipcRequestId);
  var previousUrl = row.__downloadCandidate ? (row.__downloadCandidate.webpageUrl || row.__downloadCandidate.url || '') : '';
  var previousManual = !!row.__downloadCandidateManual;
  row.__candidateLoading = true;
  row.__candidateError = '';
  row.__candidateNotice = '';
  if (!silent) renderPlaylistImportReview();
  function requestIsCurrent() {
    return row.__candidateRequestSeq === rowRequestSeq && row.__candidateIpcRequestId === ipcRequestId && (searchGeneration === undefined || searchGeneration === playlistImportSearchGeneration);
  }
  var requestPromise = (async function () {
    try {
      var res = await window.api.searchDownloadCandidates(makeDownloadTrackPayload(row), 5, ipcRequestId);
      if (!requestIsCurrent()) return row.__downloadCandidates || [];
      if (res && res.ok) {
        row.__downloadCandidates = res.candidates || [];
        row.__candidateQueryCount = res.queries ? res.queries.length : 0;
        setImportRowCandidate(row, null, false);
        var preserved = previousManual && previousUrl ? row.__downloadCandidates.find(function (candidate) { return (candidate.webpageUrl || candidate.url || '') === previousUrl; }) : null;
        if (preserved) setImportRowCandidate(row, preserved, true);
        else if (row.__downloadCandidates.length && isAutoSelectableImportCandidate(row.__downloadCandidates[0])) setImportRowCandidate(row, row.__downloadCandidates[0], false);
        else if (row.__downloadCandidates.length) row.__candidateNotice = 'Needs review: choose a candidate before downloading.';
        else row.__candidateError = 'No candidates found.';
      } else {
        row.__downloadCandidates = [];
        setImportRowCandidate(row, null, false);
        row.__candidateError = (res && res.error) || 'Search failed';
      }
    } catch (e) {
      if (!requestIsCurrent()) return row.__downloadCandidates || [];
      row.__downloadCandidates = [];
      setImportRowCandidate(row, null, false);
      row.__candidateError = 'Search failed: ' + ((e && e.message) || String(e || 'unknown error'));
    } finally {
      activeCandidateSearchRequestIds.delete(ipcRequestId);
      if (requestIsCurrent()) {
        delete row.__candidateIpcRequestId;
        row.__candidateLoading = false;
        row.__candidatePromise = null;
        if (!silent) renderPlaylistImportReview();
      }
    }
    return row.__downloadCandidates || [];
  })();
  row.__candidatePromise = requestPromise;
  return requestPromise;
}
async function searchImportCandidateRows(rows, label) {
  if (playlistImportSearching) return;
  var status = $('playlist-import-status');
  if (!rows.length) {
    if (status) status.textContent = 'No missing tracks to search.';
    return;
  }
  var searchGeneration = ++playlistImportSearchGeneration;
  playlistImportSearching = true;
  rows.forEach(function (item) { item.row.__candidateQueued = true; });
  var total = rows.length;
  var completed = 0;
  var next = 0;
  setPlaylistImportProgress(true, 'Searching', 0, total);
  renderPlaylistImportReview();
  async function worker() {
    while (next < total) {
      if (searchGeneration !== playlistImportSearchGeneration) return;
      var index = next++;
      var item = rows[index];
      item.row.__candidateQueued = false;
      if (status) status.textContent = 'Finding candidates ' + (completed + 1) + '/' + total + ': ' + getImportTrackArtist(item.row) + ' - ' + getImportTrackTitle(item.row);
      await searchImportCandidates(item.row, false, false, searchGeneration);
      if (searchGeneration !== playlistImportSearchGeneration) return;
      completed++;
      item.row.__candidateQueued = false;
      setPlaylistImportProgress(true, 'Searching', completed, total);
      renderPlaylistImportReview();
    }
  }
  try {
    var concurrency = Math.min(2, total);
    var workers = [];
    for (var i = 0; i < concurrency; i++) workers.push(worker());
    await Promise.all(workers);
    if (searchGeneration === playlistImportSearchGeneration && status) status.textContent = 'Candidate search complete for ' + label + '.';
  } finally {
    if (searchGeneration === playlistImportSearchGeneration) {
      rows.forEach(function (item) { item.row.__candidateQueued = false; });
      playlistImportSearching = false;
      setPlaylistImportProgress(false, '', 0, 0);
      renderPlaylistImportReview();
    }
  }
}
async function searchSelectedImportCandidates() {
  await searchImportCandidateRows(getMissingImportRows(true), 'selected tracks');
}
async function searchAllImportCandidates() {
  await searchImportCandidateRows(getMissingImportRows(false), 'all missing tracks');
}
function renderPlaylistImportReview() {
  var list = $('playlist-import-list');
  if (!list || !pendingPlaylistImport) return;
  var rows = getPlaylistImportRows();
  var missingCount = 0;
  var matchedCount = 0;
  var unusableCount = 0;
  var localCandidateCount = 0;
  var reviewCount = 0;
  list.innerHTML = '';
  rows.forEach(function (item, flatIndex) {
    var row = item.row;
    var title = getImportTrackTitle(row);
    var artist = getImportTrackArtist(row);
    var album = getImportTrackAlbum(row);
    var matched = findPlaylistRecordMatch(row);
    var isMissing = !matched;
    if (matched) matchedCount++;
    if (['invalid', 'unavailable', 'local-unsupported', 'remote-unsupported', 'hls-unsupported'].includes(row.SourceStatus)) unusableCount++;
    var localCandidate = isLocalPlaylistImportCandidate(row);
    var downloadable = isPlaylistImportDownloadEligible(row);
    var checkable = localCandidate || downloadable;
    if (isMissing) missingCount++;
    if (localCandidate) localCandidateCount++;
    var div = document.createElement('div');
    div.className = 'playlist-import-row' + (matched ? ' matched' : '') + (localCandidate ? ' local-reference' : '') + (row.__downloadStatus === 'downloading' ? ' downloading' : '') + (row.__downloadStatus === 'failed' ? ' failed' : '');
    div.dataset.flatIndex = String(flatIndex);
    var checked = localCandidate ? row.__addLocalSelected === true : (downloadable && row.__downloadSelected !== false);
    var busy = !!pendingPlaylistImport.finishing || playlistImportSearching || !!row.__candidateLoading;
    if (downloadable && row.__downloadCandidates && row.__downloadCandidates.length && !row.__downloadCandidate) reviewCount++;
    var sourceStatus = row.SourceStatus || '';
    var status = 'Missing';
    if (matched) status = 'In library';
    else if (localCandidate) status = 'Local file';
    else if (sourceStatus === 'local-missing') status = 'Missing local';
    else if (sourceStatus === 'local-unsupported') status = 'Unsupported';
    else if (sourceStatus === 'remote-unsupported') status = 'Remote blocked';
    else if (sourceStatus === 'hls-unsupported') status = 'HLS blocked';
    else if (sourceStatus === 'invalid') status = 'Invalid entry';
    else if (sourceStatus === 'unavailable') status = 'Unavailable on Spotify';
    else if (row.__candidateLoading) status = 'Searching';
    else if (row.__candidateQueued) status = 'Queued';
    else if (row.__downloadStatus === 'done') status = 'Downloaded';
    else if (row.__downloadStatus === 'failed') status = 'Failed';
    else if (row.__downloadCandidate) status = 'Ready';
    else if (row.__downloadCandidates && row.__downloadCandidates.length) status = 'Needs review';
    if (row.__importDiff) status = (row.__importDiff === 'new' ? 'New' : row.__importDiff === 'existing' ? 'Existing' : 'Removed from source') + ' · ' + status;
    var statusDetail = row.__downloadError || row.SourceReason || '';
    var statusTitle = statusDetail ? ' title="' + esc(statusDetail) + '"' : '';
    var checkboxLabel = localCandidate ? 'Add local file to library' : 'Select missing track for download';
    div.innerHTML = '<input type="checkbox" class="playlist-import-row-check" aria-label="' + checkboxLabel + '" ' + (checkable && !busy ? '' : 'disabled ') + (checked ? 'checked ' : '') + '>' +
      '<div class="playlist-import-cover"><i class="ph ph-music-notes"></i></div>' +
      '<div class="playlist-import-title"><strong title="' + esc(title) + '">' + esc(title || 'Unknown Track') + '</strong><span title="' + esc(artist) + '">' + esc(artist || 'Unknown Artist') + '</span></div>' +
      '<div class="playlist-import-album" title="' + esc(album) + '">' + esc(album || '-') + '</div>' +
      '<div class="playlist-import-row-status"' + statusTitle + '><span>' + esc(status) + '</span>' + (downloadable ? '<button type="button" class="playlist-import-candidate-btn" ' + (busy || row.__candidateLoading ? 'disabled ' : '') + '>' + (row.__candidateLoading ? 'Searching...' : (row.__candidateQueued ? 'Queued' : (row.__downloadCandidate ? 'Change' : ((row.__downloadCandidates && row.__downloadCandidates.length) ? 'Review' : 'Search')))) + '</button>' : '') + '</div>';
    var cb = div.querySelector('.playlist-import-row-check');
    if (cb) cb.addEventListener('change', function () {
      if (localCandidate) row.__addLocalSelected = cb.checked;
      else row.__downloadSelected = cb.checked;
      updatePlaylistImportActions();
    });
    div.addEventListener('click', function (e) {
      if (!checkable || busy || !cb || e.target.closest('button,input,.playlist-import-candidates,.playlist-import-picked-candidate')) return;
      if (localCandidate) row.__addLocalSelected = !cb.checked;
      else row.__downloadSelected = !cb.checked;
      renderPlaylistImportReview();
    });
    var candidateBtn = div.querySelector('.playlist-import-candidate-btn');
    if (candidateBtn) candidateBtn.addEventListener('click', function () { searchImportCandidates(row, false); });
    if (downloadable && row.__downloadCandidate) {
      var picked = document.createElement('div');
      picked.className = 'playlist-import-picked-candidate';
      picked.innerHTML = '<span>Selected ' + esc(formatImportCandidateConfidence(row.__downloadCandidate)) + ':</span> ' + esc(row.__downloadCandidate.title || 'Unknown video') + ' <small>' + esc(row.__downloadCandidate.uploader || '') + ' - ' + esc(formatImportCandidateDuration(row.__downloadCandidate.duration)) + '</small>';
      div.appendChild(picked);
    }
    if (downloadable && row.__candidateNotice) {
      var note = document.createElement('div');
      note.className = 'playlist-import-candidate-note';
      note.textContent = row.__candidateNotice;
      div.appendChild(note);
    }
    if (downloadable && row.__candidateError) {
      var err = document.createElement('div');
      err.className = 'playlist-import-candidate-error';
      err.textContent = row.__candidateError;
      div.appendChild(err);
    }
    if (downloadable && row.__downloadCandidates && row.__downloadCandidates.length) {
      var box = document.createElement('div');
      box.className = 'playlist-import-candidates';
      row.__downloadCandidates.forEach(function (candidate, candidateIndex) {
        var itemBtn = document.createElement('button');
        itemBtn.type = 'button';
        itemBtn.disabled = busy;
        var confidence = getImportCandidateConfidence(candidate);
        itemBtn.className = 'playlist-import-candidate confidence-' + confidence + (row.__downloadCandidate && row.__downloadCandidate.webpageUrl === candidate.webpageUrl ? ' selected' : '');
        var thumb = candidate.thumbnail ? '<img src="' + esc(candidate.thumbnail) + '" alt="" />' : '<span class="playlist-import-candidate-thumb"><i class="ph ph-play"></i></span>';
        itemBtn.innerHTML = thumb + '<span><strong>' + esc(candidate.title || 'Unknown video') + '</strong><small>' + esc(candidate.uploader || '') + ' - ' + esc(formatImportCandidateDuration(candidate.duration)) + ' - ' + esc(formatImportCandidateConfidence(candidate)) + ' confidence - score ' + esc(candidate.score) + '</small></span>';
        itemBtn.addEventListener('click', function () {
          var picked = row.__downloadCandidate;
          var next = row.__downloadCandidates[candidateIndex];
          if (picked && (picked.webpageUrl || picked.url || '') === (next.webpageUrl || next.url || '')) {
            setImportRowCandidate(row, null, false);
            row.__candidateNotice = 'Candidate deselected. Choose one before downloading.';
          } else {
            setImportRowCandidate(row, next, true);
          }
          renderPlaylistImportReview();
        });
        box.appendChild(itemBtn);
      });
      div.appendChild(box);
    }
    if (isM3uImportRecord(row) && row.SourceLocation) {
      var sourcePath = document.createElement('div');
      sourcePath.className = 'playlist-import-source-path';
      sourcePath.title = row.SourceLocation;
      sourcePath.textContent = row.SourceLocation;
      div.appendChild(sourcePath);
    }
    list.appendChild(div);
  });
  var diff = pendingPlaylistImport.diff;
  $('playlist-import-subtitle').textContent = (diff ? diff.added + ' new · ' + diff.existing + ' existing · ' + diff.removed + ' removed from source; removed tracks stay in your playlist. ' : '') + 'Read ' + rows.length + ' · Matched local ' + matchedCount + ' · Missing ' + Math.max(0, missingCount - unusableCount) + ' · Unusable ' + unusableCount + '.' + (localCandidateCount ? ' ' + localCandidateCount + ' local file(s) available.' : '') + (reviewCount ? ' ' + reviewCount + ' need review.' : '');
  var hasDownloads = rows.some(function (item) { return isPlaylistImportDownloadEligible(item.row); });
  $('playlist-import-download-folder').textContent = hasDownloads
    ? 'Download folder: ' + (appSettings.ytdlDownloadFolder || 'Default Music/Playerinyo Downloads')
    : (localCandidateCount ? 'Select local files to add them to the library. Unselected references stay in the playlist only.' : 'Unavailable local, remote, and HLS entries remain reviewable and will not be downloaded automatically.');
  updatePlaylistImportActions();
}
async function showExistingPlaylistDownloadReview(pl, rows) {
  if (!pl) return;
  rows = (rows || getDownloadableMissingPlaylistRows(pl)).filter(isPlaylistImportDownloadEligible);
  if (!rows.length) { showToast('No missing tracks to download in "' + (pl.name || 'this playlist') + '".'); return; }
  rows.forEach(function (row) { clearImportRowTransient(row); row.__downloadSelected = true; });
  cancelPlaylistCandidateSearch(false);
  pendingPlaylistImport = { csvPath: '', groups: [{ name: pl.name || 'Playlist', tracks: rows }], existingPlaylistId: pl.id, mode: 'existing-playlist' };
  if (!appSettings.ytdlDownloadFolder && window.api.getDefaultDownloadFolder) appSettings.ytdlDownloadFolder = await window.api.getDefaultDownloadFolder();
  var titleEl = $('playlist-import-title'); if (titleEl) titleEl.textContent = 'Download Playlist Tracks';
  var importOnlyBtn = $('playlist-import-only'); if (importOnlyBtn) importOnlyBtn.textContent = 'Close';
  var options = $('playlist-import-options'); if (options) options.hidden = true;
  var status = $('playlist-import-status'); if (status) status.textContent = '';
  var toolStatus = $('playlist-import-tool-status'); if (toolStatus) toolStatus.textContent = '';
  setPlaylistImportProgress(false, '', 0, 0);
  renderPlaylistImportReview();
  showModal($('playlist-import-modal'));
  var missingRows = getMissingImportRows(false);
  if (missingRows.length > 0 && missingRows.length <= 5) {
    setTimeout(function () { if (pendingPlaylistImport && pendingPlaylistImport.existingPlaylistId === pl.id) searchImportCandidateRows(missingRows, 'missing tracks'); }, 0);
  }
}
function openAlbumDownloadModal(album) {
  if (!album) return;
  albumDownloadOrigin = '';
  albumDownloadContext = album;
  albumDownloadSelectedRelease = null;
  albumDownloadRequestSeq++;
  var query = ((album.artist || '') + ' ' + (album.name || '')).trim();
  var subtitle = $('album-download-subtitle'); if (subtitle) subtitle.textContent = (album.artist || 'Unknown Artist') + ' - ' + (album.name || 'Unknown Album');
  var queryInput = $('album-download-search-query'); if (queryInput) queryInput.value = query;
  var results = $('album-download-results'); if (results) results.innerHTML = '<div class="album-download-empty">Search metadata to choose a release.</div>';
  var preview = $('album-download-preview'); if (preview) preview.innerHTML = '<div class="album-download-empty">Select a metadata result.</div>';
  var status = $('album-download-status'); if (status) status.textContent = '';
  var queueBtn = $('album-download-queue'); if (queueBtn) { queueBtn.disabled = true; queueBtn.textContent = 'Queue Album Downloads'; }
  updateAlbumDownloadSelectionActions();
  showModal($('album-download-modal'));
  var openToken = albumDownloadRequestSeq;
  setTimeout(function () {
    if (queryInput) { queryInput.focus(); queryInput.select(); }
    if (query && albumDownloadContext === album && openToken === albumDownloadRequestSeq) searchAlbumDownloadMetadata();
  }, 0);
}
function openAlbumDownloadSearch() {
  albumDownloadOrigin = '';
  albumDownloadContext = null;
  albumDownloadSelectedRelease = null;
  albumDownloadRequestSeq++;
  var subtitle = $('album-download-subtitle'); if (subtitle) subtitle.textContent = 'Search for a release, then download its missing tracks into one album folder.';
  var queryInput = $('album-download-search-query'); if (queryInput) queryInput.value = '';
  var results = $('album-download-results'); if (results) results.innerHTML = '<div class="album-download-empty">Search by artist and album to choose a release.</div>';
  var preview = $('album-download-preview'); if (preview) preview.innerHTML = '<div class="album-download-empty">Choose a release to compare its tracklist with your library.</div>';
  var status = $('album-download-status'); if (status) status.textContent = '';
  var queueBtn = $('album-download-queue'); if (queueBtn) { queueBtn.disabled = true; queueBtn.textContent = 'Queue Album Downloads'; }
  updateAlbumDownloadSelectionActions();
  showModal($('album-download-modal'));
  setTimeout(function () { if (queryInput) queryInput.focus(); }, 0);
}
function openAutoTagMissingTracksDownload() {
  if (!metaProposedData || !metaProposedData.raw) return;
  var meta = flattenMetadataReleaseTracks(metaProposedData.raw);
  var sourceMatches = metaProposedData.sourceMatches || [];
  var rows = metadataTracksToDownloadRows(meta);
  rows.forEach(function (row, sourceIndex) {
    var match = sourceMatches[sourceIndex];
    if (match && match.localFilePath) row.__autoTagLocalFilePath = match.localFilePath;
    row.__downloadSelected = isAlbumDownloadRowMissing(row);
  });
  var missingCount = rows.filter(isAlbumDownloadRowMissing).length;
  if (!missingCount) { showToast('Every track in this release is already in your library.'); return; }

  albumDownloadOrigin = 'metadata';
  albumDownloadContext = null;
  albumDownloadSelectedRelease = { result: null, release: metaProposedData.raw, meta: meta, rows: rows };
  albumDownloadRequestSeq++;
  var subtitle = $('album-download-subtitle'); if (subtitle) subtitle.textContent = (meta.albumArtist || 'Unknown Artist') + ' - ' + (meta.albumTitle || 'Unknown Album') + ' • ' + missingCount + ' missing';
  var queryInput = $('album-download-search-query'); if (queryInput) queryInput.value = ((meta.albumArtist || '') + ' ' + (meta.albumTitle || '')).trim();
  var results = $('album-download-results'); if (results) results.innerHTML = '<div class="album-download-empty">Using the release selected in Metadata.</div>';
  hideModal($('metadata-modal'));
  showModal($('album-download-modal'));
  renderAlbumDownloadPreview();
}
async function searchAlbumDownloadMetadata() {
  var q = ($('album-download-search-query') && $('album-download-search-query').value || '').trim();
  if (!q) return;
  var requestToken = ++albumDownloadRequestSeq;
  var btn = $('album-download-search');
  var resultsEl = $('album-download-results');
  var status = $('album-download-status');
  albumDownloadSelectedRelease = null;
  var queueBtn = $('album-download-queue'); if (queueBtn) { queueBtn.disabled = true; queueBtn.textContent = 'Queue Album Downloads'; }
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Searching...'; }
  if (status) status.textContent = '';
  if (resultsEl) resultsEl.innerHTML = '<div class="album-download-empty">Searching...</div>';
  var results = [];
  try {
    results = window.api.searchMetadataSources ? await window.api.searchMetadataSources(q, getMetadataSourceOptions()) : [];
  } catch (e) {
    if (requestToken !== albumDownloadRequestSeq) return;
    if (resultsEl) resultsEl.innerHTML = '<div class="album-download-empty">Search failed.</div>';
    if (status) status.textContent = 'Metadata search failed: ' + ((e && e.message) || String(e || 'unknown error'));
    return;
  } finally {
    if (requestToken === albumDownloadRequestSeq && btn) { btn.disabled = false; btn.innerHTML = '<i class="ph ph-magnifying-glass"></i> Search Metadata'; }
  }
  if (requestToken !== albumDownloadRequestSeq) return;
  if (!resultsEl) return;
  resultsEl.innerHTML = '';
  if (!results.length) {
    resultsEl.innerHTML = '<div class="album-download-empty">No metadata results found.</div>';
    return;
  }
  results.forEach(function (result) {
    var row = document.createElement('button');
    row.type = 'button';
    row.className = 'album-download-result';
    var year = result.date ? String(result.date).substring(0, 4) : '';
    var sourceLabel = result.label || result.source || 'Metadata';
    var cover = result.thumb ? '<img src="' + esc(result.thumb) + '" alt="" />' : '<span class="album-download-result-cover"></span>';
    row.innerHTML = cover + '<span><strong>' + esc(result.title || 'Unknown Album') + '</strong><small>' + esc(result.artist || 'Unknown Artist') + (year ? ' - ' + esc(year) : '') + '</small><small>' + esc(sourceLabel) + '</small></span>';
    row.addEventListener('click', function () { selectAlbumDownloadRelease(result, row); });
    resultsEl.appendChild(row);
  });
}
async function selectAlbumDownloadRelease(result, rowEl) {
  var requestToken = ++albumDownloadRequestSeq;
  var status = $('album-download-status');
  var preview = $('album-download-preview');
  var queueBtn = $('album-download-queue');
  document.querySelectorAll('.album-download-result').forEach(function (el) { el.classList.remove('selected'); });
  if (rowEl) rowEl.classList.add('selected');
  if (preview) preview.innerHTML = '<div class="album-download-empty">Loading release...</div>';
  if (status) status.textContent = 'Loading release details...';
  updateAlbumDownloadSelectionActions();
  var source = result.source || 'musicbrainz';
  var release = null;
  try {
    release = window.api.getMetadataRelease ? await window.api.getMetadataRelease(source, result.id, getMetadataSourceOptions()) : null;
  } catch (e) {
    if (requestToken !== albumDownloadRequestSeq) return;
    if (preview) preview.innerHTML = '<div class="album-download-empty">Could not load this release.</div>';
    if (status) status.textContent = 'Release load failed: ' + ((e && e.message) || String(e || 'unknown error'));
    if (queueBtn) queueBtn.disabled = true;
    return;
  }
  if (requestToken !== albumDownloadRequestSeq) return;
  if (!release) {
    if (preview) preview.innerHTML = '<div class="album-download-empty">Could not load this release.</div>';
    if (status) status.textContent = 'Release load failed.';
    if (queueBtn) queueBtn.disabled = true;
    return;
  }
  var meta = flattenMetadataReleaseTracks(release);
  var rows = metadataTracksToDownloadRows(meta);
  rows.forEach(function (row) { row.__downloadSelected = isAlbumDownloadRowMissing(row); });
  albumDownloadSelectedRelease = { result: result, release: release, meta: meta, rows: rows };
  renderAlbumDownloadPreview();
}
function updateAlbumDownloadSelectionActions() {
  var rows = albumDownloadSelectedRelease ? (albumDownloadSelectedRelease.rows || []) : [];
  var missing = rows.filter(isAlbumDownloadRowMissing);
  var selectedMissing = missing.filter(function (row) { return row.__downloadSelected !== false; });
  var selectBtn = $('album-download-select-missing');
  var deselectBtn = $('album-download-deselect-all');
  if (selectBtn) selectBtn.disabled = missing.length === 0 || selectedMissing.length === missing.length;
  if (deselectBtn) deselectBtn.disabled = selectedMissing.length === 0;
}
function renderAlbumDownloadPreview() {
  var preview = $('album-download-preview');
  var status = $('album-download-status');
  var queueBtn = $('album-download-queue');
  if (!preview || !albumDownloadSelectedRelease) return;
  var rows = albumDownloadSelectedRelease.rows || [];
  var missing = rows.filter(isAlbumDownloadRowMissing);
  var selectedMissing = rows.filter(function (row) { return isAlbumDownloadRowMissing(row) && row.__downloadSelected !== false; });
  preview.innerHTML = '';
  rows.forEach(function (row, index) {
    var track = document.createElement('div');
    var matched = !isAlbumDownloadRowMissing(row);
    var selected = !matched && row.__downloadSelected !== false;
    track.className = 'album-download-track' + (matched ? ' matched' : '') + (selected ? ' selected' : '');
    var no = row.DiscNo && row.DiscNo > 1 ? (row.DiscNo + '.' + row.TrackNo) : row.TrackNo;
    track.innerHTML = '<input type="checkbox" class="album-download-track-check" ' + (matched ? 'disabled ' : '') + (selected ? 'checked ' : '') + '>' +
      '<em>' + esc(no || (index + 1)) + '</em><span><strong>' + esc(row.Song || 'Unknown Track') + '</strong><small>' + esc(row.Artist || '') + '</small></span><small>' + (matched ? 'In library' : (selected ? 'Selected' : 'Skipped')) + '</small>';
    var cb = track.querySelector('.album-download-track-check');
    if (cb) cb.addEventListener('change', function () { row.__downloadSelected = cb.checked; renderAlbumDownloadPreview(); });
    track.addEventListener('click', function (e) {
      if (matched || e.target.closest('input')) return;
      row.__downloadSelected = row.__downloadSelected === false;
      renderAlbumDownloadPreview();
    });
    preview.appendChild(track);
  });
  if (status) status.textContent = rows.length + ' track(s), ' + missing.length + ' missing, ' + selectedMissing.length + ' selected will be queued.';
  if (queueBtn) { queueBtn.disabled = selectedMissing.length === 0; queueBtn.textContent = 'Queue Album Downloads' + (selectedMissing.length ? ' (' + selectedMissing.length + ')' : ''); }
  updateAlbumDownloadSelectionActions();
}
function setAlbumDownloadMissingSelection(selected) {
  if (!albumDownloadSelectedRelease) return;
  (albumDownloadSelectedRelease.rows || []).forEach(function (row) {
    if (isAlbumDownloadRowMissing(row)) row.__downloadSelected = !!selected;
  });
  renderAlbumDownloadPreview();
}
function queueAlbumDownloadSelectedRelease() {
  if (!albumDownloadSelectedRelease) return;
  var meta = albumDownloadSelectedRelease.meta || {};
  var rows = (albumDownloadSelectedRelease.rows || []).filter(function (row) { return isAlbumDownloadRowMissing(row) && row.__downloadSelected !== false; });
  if (!rows.length) { showToast('No selected missing tracks for this album.'); return; }
  enqueueAlbumDownloadJob((meta.albumArtist ? meta.albumArtist + ' - ' : '') + (meta.albumTitle || 'Album'), rows);
  hideModal($('album-download-modal'));
  albumDownloadContext = null;
  albumDownloadSelectedRelease = null;
  albumDownloadOrigin = '';
}
async function downloadImportRowWithFallback(row, downloadRoot, requestId) {
  var original = row.__downloadCandidate;
  var originalManual = !!row.__downloadCandidateManual;
  var attempts = getDownloadFallbackCandidates(row);
  if (!attempts.length) return window.api.downloadPlaylistTrack(makeDownloadTrackPayload(row), downloadRoot, requestId);
  var lastResult = null;
  for (var i = 0; i < attempts.length; i++) {
    var candidate = attempts[i];
    var sameAsOriginal = getImportCandidateUrl(candidate) === getImportCandidateUrl(original);
    setImportRowCandidate(row, candidate, sameAsOriginal && originalManual);
    if (i > 0) {
      row.__downloadStatus = 'downloading';
      row.__downloadError = 'Age-restricted candidate failed; trying another result...';
      renderPlaylistImportReview();
    }
    lastResult = await window.api.downloadPlaylistTrack(makeDownloadTrackPayload(row), downloadRoot, requestId || '');
    if (lastResult && lastResult.ok) return lastResult;
    if (!isAgeRestrictedDownloadResult(lastResult)) return lastResult;
  }
  if (lastResult && isAgeRestrictedDownloadResult(lastResult)) {
    lastResult.error = 'All tried candidates require YouTube sign-in/age confirmation. Enable YouTube cookies in Settings or choose another candidate.';
  }
  return lastResult;
}

function normalizeLibraryRootPath(filePath) {
  return String(stripFileUrl(filePath || '') || filePath || '').replace(/\\/g, '/').replace(/\/+$/, '');
}
function getParentPath(filePath) {
  var normalized = normalizeLibraryRootPath(filePath);
  var slash = normalized.lastIndexOf('/');
  if (slash <= 0) return slash === 0 ? '/' : '';
  return normalized.slice(0, slash);
}
function pathIsInsideRoot(filePath, rootPath) {
  var file = normalizeLibraryRootPath(filePath);
  var root = normalizeLibraryRootPath(rootPath);
  if (/^[a-z]:/i.test(file) || /^[a-z]:/i.test(root)) { file = file.toLowerCase(); root = root.toLowerCase(); }
  return !!root && (file === root || file.startsWith(root + '/'));
}
function getCommonImportRoot(filePaths) {
  var directories = filePaths.map(getParentPath).filter(Boolean);
  if (!directories.length) return '';
  var parts = directories[0].split('/');
  var caseInsensitive = /^[a-z]:/i.test(directories[0]);
  for (var i = 1; i < directories.length && parts.length; i++) {
    var next = directories[i].split('/');
    var count = 0;
    while (count < parts.length && count < next.length) {
      var left = caseInsensitive ? parts[count].toLowerCase() : parts[count];
      var right = caseInsensitive ? next[count].toLowerCase() : next[count];
      if (left !== right) break;
      count++;
    }
    parts.length = count;
  }
  var common = parts.join('/');
  if (directories[0].startsWith('/') && !common.startsWith('/')) common = '/' + common;
  if (common === '/' || /^[a-z]:$/i.test(common) || /^\/\/[^/]+$/i.test(common)) return '';
  return common;
}
function addPlaylistImportLibraryRoots(filePaths) {
  var saved = Array.isArray(appSettings.libraryRoots) ? appSettings.libraryRoots.slice() : [];
  var candidates = [];
  var common = getCommonImportRoot(filePaths);
  if (common) candidates.push(common);
  else filePaths.map(getParentPath).filter(Boolean).forEach(function (directory) {
    if (!candidates.some(function (root) { return pathIsInsideRoot(directory, root); })) candidates.push(directory);
  });
  var changed = false;
  candidates.forEach(function (candidate) {
    if (saved.some(function (root) { return pathIsInsideRoot(candidate, root); })) return;
    saved = saved.filter(function (root) { return !pathIsInsideRoot(root, candidate); });
    saved.push(candidate);
    changed = true;
  });
  if (changed) appSettings.libraryRoots = saved;
  return changed;
}
async function addSelectedPlaylistLocalFiles() {
  var selected = getPlaylistImportRows().filter(function (item) {
    return item.row.__addLocalSelected === true && isLocalPlaylistImportCandidate(item.row);
  });
  var uniquePaths = Array.from(new Set(selected.map(function (item) { return getPlaylistTrackFilePath(item.row); }).filter(Boolean)));
  if (!uniquePaths.length) return { added: 0, failed: 0, rootsChanged: false };
  var scanContext = { revision: libraryRevision, paths: new Set(state.musicFiles.map(function (file) { return file.filePath; }).filter(Boolean)) };
  var scanned = [];
  var failed = 0;
  var next = 0;
  async function worker() {
    while (true) {
      var index = next++;
      if (index >= uniquePaths.length) return;
      try {
        var file = await window.api.scanAudioFile(uniquePaths[index]);
        if (file) scanned.push(file); else failed++;
      } catch (_) { failed++; }
    }
  }
  var workers = [];
  for (var i = 0; i < Math.min(4, uniquePaths.length); i++) workers.push(worker());
  await Promise.all(workers);
  if (scanned.length) {
    scanned.forEach(function (file) { libraryMissingFilePaths.delete(file.filePath); });
    setMusicFiles(mergeScannedFiles(scanned, scanContext));
  }
  var rootsChanged = scanned.length ? addPlaylistImportLibraryRoots(scanned.map(function (file) { return file.filePath; })) : false;
  return { added: scanned.length, failed: failed, rootsChanged: rootsChanged };
}

async function finishPlaylistImport(action) {
  if (!pendingPlaylistImport) return;
  if (!pendingPlaylistImport.groups.length) { showToast('Select at least one playlist.'); return; }
  if (pendingPlaylistImport.finishing || playlistImportSearching || getPlaylistImportRows().some(function (item) { return !!item.row.__candidateLoading; })) return;
  var activeImport = pendingPlaylistImport;
  activeImport.finishing = true;
  updatePlaylistImportActions();
  try {
  var withDownload = action === 'download';
  var withLocalFiles = action === 'local';
  var reimportTarget = pendingPlaylistImport.reimportTarget;
  if (reimportTarget) {
    pushUndoSnapshot('Reimport playlist', ['playlists']);
    var newRows = pendingPlaylistImport.groups[0].tracks.filter(function (row) { return row.__importDiff === 'new' && row.SourceStatus !== 'unavailable'; });
    newRows.forEach(function (row) { clearImportRowTransient(row); stampPlaylistTrackAddedAt(row, Date.now()); reimportTarget.tracks.push(row); });
    pendingPlaylistImport.groups[0].tracks.forEach(function (row) { if (row.__importDiff) clearImportRowTransient(row); });
    reimportTarget.importSource = { path: pendingPlaylistImport.sourcePath, format: pendingPlaylistImport.sourceFormat, group: reimportTarget.importSource.group };
    reimportTarget.lastAddedAt = new Date().toISOString();
    await persistPlaylists(state.playlists);
    renderSidebarPlaylists();
    if (state.currentView === reimportTarget.id) renderPlaylist(reimportTarget.id);
    hideModal($('playlist-import-modal'));
    showToast('Added ' + newRows.length + ' new track(s); existing and removed tracks were kept.');
    pendingPlaylistImport = null;
    return;
  }
  var existingPlaylistId = pendingPlaylistImport.existingPlaylistId || '';
  if (existingPlaylistId) {
    if (withDownload) enqueueExistingPlaylistDownloadJob(pendingPlaylistImport);
    else {
      pendingPlaylistImport.groups.forEach(function (group) { group.tracks.forEach(clearImportRowTransient); });
      await persistPlaylists(state.playlists);
    }
    renderSidebarPlaylists();
    hideModal($('playlist-import-modal'));
    pendingPlaylistImport = null;
    clearTrackSelection();
    return;
  }
  pushUndoSnapshot('Import playlist', ['library', 'playlists', 'mappings', 'libraryRoots']);
  var localResult = withLocalFiles ? await addSelectedPlaylistLocalFiles() : { added: 0, failed: 0, rootsChanged: false };
  var conflictMode = pendingPlaylistImport.conflictMode || 'create';
  if (pendingPlaylistImport.sourceFormat === 'spotify-login') pendingPlaylistImport.groups.forEach(function (group) {
    group.tracks = group.tracks.filter(function (row) { return row.SourceStatus !== 'unavailable'; });
  });
  if (pendingPlaylistImport.sourceFormat === 'spotify-login' && pendingPlaylistImport.groups.some(function (group) { return !group.tracks.length; })) {
    $('playlist-import-status').textContent = 'This playlist has no usable tracks to import.';
    return;
  }
  var importResult = importPlaylistGroups(pendingPlaylistImport.groups, conflictMode, { path: pendingPlaylistImport.sourcePath, format: pendingPlaylistImport.sourceFormat });
  var seenQueueRows = new Set();
  var queueRows = withDownload ? importResult.rows.filter(function (row) {
    if (seenQueueRows.has(row) || row.__downloadSelected === false || !isPlaylistImportDownloadEligible(row)) return false;
    seenQueueRows.add(row);
    return true;
  }) : [];
  var queueSnapshots = queueRows.map(function (row) { return { row: row, data: snapshotImportRowTransient(row) }; });
  importResult.rows.forEach(clearImportRowTransient);
  await persistPlaylists(state.playlists);
  await persistLibrary(state.musicFiles);
  if (localResult.rootsChanged) await persistSettings(appSettings);
  queueSnapshots.forEach(function (item) { restoreImportRowTransient(item.row, item.data); });
  renderSidebarPlaylists();
  hideModal($('playlist-import-modal'));
  if (importResult.firstPlaylistId) switchView(importResult.firstPlaylistId);
  if (withDownload && queueRows.length) {
    var jobTitle = pendingPlaylistImport.groups.length === 1 ? (pendingPlaylistImport.groups[0].name || 'Imported Playlist') : 'Imported Playlists';
    enqueueImportedPlaylistDownloadJob(jobTitle, queueRows, importResult.firstPlaylistId, importResult.playlistIds);
  }
  if (withLocalFiles) showToast('Imported playlist and added ' + localResult.added + ' local file' + (localResult.added === 1 ? '' : 's') + ' to the library.' + (localResult.failed ? ' ' + localResult.failed + ' file(s) could not be scanned.' : ''));
  pendingPlaylistImport = null;
  } catch (error) {
    showToast('Playlist import failed: ' + ((error && error.message) || String(error || 'unknown error')));
  } finally {
    if (pendingPlaylistImport === activeImport) {
      activeImport.finishing = false;
      updatePlaylistImportActions();
    }
  }
}

var importPl = null;

var playlistImportSelectMissing = null;

var playlistImportFindCandidates = null;

var playlistImportFindAllCandidates = null;

var playlistImportCheckTools = null;

function cancelPlaylistImport() {
  if (pendingPlaylistImport && pendingPlaylistImport.finishing) return;
  cancelPlaylistCandidateSearch(false);
  if (pendingPlaylistImport) pendingPlaylistImport.groups.forEach(function (group) { (group.tracks || []).forEach(clearImportRowTransient); });
  pendingPlaylistImport = null;
  hideModal($('playlist-import-modal'));
}
var playlistImportCancel = null; 
var playlistImportCancelX = null; 
var playlistImportStopSearch = null; 
var playlistImportConflict = null; 
var playlistImportOnly = null; 
var playlistImportAddLocal = null; 
var playlistImportDownload = null; 
var playlistImportModal = null; 

var createPlBtn = null;

var createSmartMixBtn = null;

var cpDrop = null;

var cpCancel = null; 
var cpCreate = null;

var navLib = null; 
var navHome = null; 
var dockModeToggle = null;

var navPlaylists = null; 
var navRadio = null; 

var navHealth = null; 
var navStats = null; 
var btnLike = null; 
var btnOpenTagHealth = null; 
var btnReviewMovedFiles = null;

var btnNavBack = null;

var btnNavFwd = null;


// Genre-group toggle removed — genre search is now handled via the search bar
// FIX 9: Playlist search fixed
var plSearch = null;

var gSearch = null;
var gSearchTimeout = null;
function parseLibrarySearchQuery(raw) {
  var parsed = { terms: [], filters: [] };
  String(raw || '').trim().split(/\s+/).filter(Boolean).forEach(function (token) {
    var match = token.match(/^([a-z]+):(.+)$/i);
    if (match) parsed.filters.push({ key: match[1].toLowerCase(), value: match[2].toLowerCase() });
    else parsed.terms.push(token.toLowerCase());
  });
  return parsed;
}
function fileSearchText(f) {
  var libIndex = getLibraryIndex();
  return libIndex.searchTextByFile && libIndex.searchTextByFile.has(f) ? libIndex.searchTextByFile.get(f) : buildFileSearchText(f);
}
function fileExtText(f) {
  var libIndex = getLibraryIndex();
  return libIndex.extByFile && libIndex.extByFile.has(f) ? libIndex.extByFile.get(f) : buildFileExtText(f);
}
function fileHasMissingField(f, value) {
  if (value === 'cover' || value === 'art' || value === 'artwork') return !f.picture;
  if (value === 'year') return !f.year;
  if (value === 'genre') return !f.genre;
  if (value === 'track' || value === 'trackno' || value === 'number') return !f.trackNo;
  if (value === 'disc') return !f.discNo;
  if (value === 'file' || value === 'files' || value === 'path') return libraryMissingFilePaths.has(f.filePath);
  if (value === 'replaygain' || value === 'rg' || value === 'loudness') return f.replayGainTrackDb === null || f.replayGainTrackDb === undefined;
  if (value === 'metadata' || value === 'tags') return !f.picture || !f.year || !f.genre || !f.trackNo;
  return false;
}
function matchesLibrarySearchFilter(f, filter, parsed) {
  var value = filter.value;
  var albumKey = getAlbumKey(f);
  if (filter.key === 'albumrating') {
    var rating = Number((appSettings.albumRatings || {})[albumKey] || 0);
    var requested = Number(value);
    return Number.isFinite(requested) && rating * 2 >= requested;
  }
  if (filter.key === 'albums' && value === 'liked') return !!(appSettings.likedAlbums || {})[albumKey];
  if (filter.key === 'artist') return String(f.artist || '').toLowerCase().indexOf(value) !== -1 || String(f.albumArtist || '').toLowerCase().indexOf(value) !== -1;
  if (filter.key === 'album') return String(f.album || '').toLowerCase().indexOf(value) !== -1;
  if (filter.key === 'title' || filter.key === 'song') return String(f.title || '').toLowerCase().indexOf(value) !== -1;
  if (filter.key === 'genre') return String(f.genre || '').toLowerCase().indexOf(value) !== -1;
  if (filter.key === 'year') return String(f.year || '').toLowerCase() === value;
  if (filter.key === 'missing') return fileHasMissingField(f, value);
  if (filter.key === 'rg' || filter.key === 'replaygain') {
    var hasRg = f.replayGainTrackDb !== null && f.replayGainTrackDb !== undefined;
    return value === 'missing' || value === 'none' ? !hasRg : hasRg;
  }
  if (filter.key === 'type' || filter.key === 'ext') return fileExtText(f) === value.replace(/^\./, '');
  if (filter.key === 'path') return String(f.filePath || '').toLowerCase().indexOf(value) !== -1;
  if (filter.key === 'liked') {
    var likedSet = parsed && parsed.likedSongsSet ? parsed.likedSongsSet : null;
    var liked = likedSet ? likedSet.has(f.filePath) : state.likedSongs.includes(f.filePath);
    return value === 'true' || value === 'yes' || value === '1' ? liked : !liked;
  }
  return fileSearchText(f).indexOf(value) !== -1;
}
function matchesLibrarySearch(f, parsed) {
  var hay = fileSearchText(f);
  if (!parsed.terms.every(function (term) { return hay.indexOf(term) !== -1; })) return false;
  return parsed.filters.every(function (filter) { return matchesLibrarySearchFilter(f, filter, parsed); });
}


var commandPaletteIndex = 0;
var commandPaletteItems = [];
function makeTrackCommandRecord(file) {
  return { matchedFile: file, title: file.title, artist: file.artist, album: file.album, duration: file.duration, isDisabled: false };
}
function buildAlbumListForCommands() {
  return getLibraryIndex().albums;
}
function commandMatches(item, query) {
  if (!query) return item.type === 'command';
  var hay = ((item.label || '') + ' ' + (item.sub || '') + ' ' + (item.keywords || '')).toLowerCase();
  return query.split(/\s+/).every(function (part) { return hay.indexOf(part) !== -1; });
}
function getCommandPaletteItems(query) {
  var q = (query || '').toLowerCase().trim();
  var items = [
    { type: 'command', icon: 'ph-house', label: 'Go Home', sub: 'Open the home dashboard', keywords: 'home dashboard', action: function () { switchView('home'); } },
    { type: 'command', icon: 'ph-books', label: 'Go Library', sub: 'Open album library', keywords: 'library albums', action: function () { switchView('library'); } },
    { type: 'command', icon: 'ph-playlist', label: 'Open Playlists', sub: 'Browse and manage playlists', keywords: 'playlists mixes liked songs', action: function () { switchView('playlists'); } },
    { type: 'command', icon: 'ph-chart-bar', label: 'Listening History', sub: 'Open local play statistics', keywords: 'history statistics plays listened', action: function () { switchView('stats'); } },
    { type: 'command', icon: 'ph-arrow-counter-clockwise', label: 'Undo Last Action', sub: undoStack.length ? undoStack[undoStack.length - 1].label : 'Nothing to undo', keywords: 'undo revert ctrl z', action: undoLastAction },
    { type: 'command', icon: 'ph-gear', label: 'Open Settings', sub: 'Theme, library, playback settings', keywords: 'settings options preferences', action: function () { openSettingsModal(); } },
    { type: 'command', icon: 'ph-download-simple', label: 'Export Backup', sub: 'Save library, playlists, settings and mappings to JSON', keywords: 'backup export json save', action: function () { var btn = $('btn-export-backup'); if (btn) btn.click(); } },
    { type: 'command', icon: 'ph-upload-simple', label: 'Import Backup', sub: 'Restore app data from a Playerinyo JSON backup', keywords: 'backup import restore json', action: function () { var btn = $('btn-import-backup'); if (btn) btn.click(); } },
    { type: 'command', icon: 'ph-stethoscope', label: 'Open Tag Health', sub: 'Find missing metadata and ReplayGain', keywords: 'metadata health missing replaygain cover genre', action: function () { switchView('metadata_health'); } },
    { type: 'command', icon: 'ph-folder-open', label: 'Import Folder', sub: 'Add music from a folder', keywords: 'import scan add folder', action: function () { var btn = $('import-folder-btn'); if (btn) btn.click(); } },
    { type: 'command', icon: 'ph-arrows-clockwise', label: 'Rescan Library', sub: 'Scan imported folders for new songs', keywords: 'rescan refresh folder library', action: function () { doRescanFolder(); } },
    { type: 'command', icon: 'ph-queue', label: 'Toggle Queue', sub: 'Show or hide the queue panel', keywords: 'queue next songs', action: function () { toggleQueue(); } },
    { type: 'command', icon: 'ph-microphone-stage', label: 'Toggle Lyrics', sub: 'Show or hide lyrics panel', keywords: 'lyrics lrc words', action: function () { toggleLyrics(); } },
    { type: 'command', icon: 'ph-waveform', label: 'Show Missing ReplayGain', sub: 'Open Tag Health filtered to missing loudness data', keywords: 'replaygain loudness normalize missing analyze', action: function () { switchView('metadata_health'); var root = $('metadata-health-container'); if (root) { root.dataset.filter = 'missing_replaygain'; renderMetadataHealthView(); } } },
    { type: 'command', icon: 'ph-image-square', label: 'Write folder.jpg', sub: 'Write album covers into music folders', keywords: 'cover folder jpg artwork', action: function () { writeCurrentFolderCovers(true); } },
    { type: 'command', icon: 'ph-keyboard', label: 'Keyboard Shortcuts', sub: 'Show all shortcuts (?)', keywords: 'keyboard shortcuts help keys hotkeys', action: function () { openShortcutsHelp(); } }
  ].filter(function (item) { return commandMatches(item, q); });
  if (q) {
    var terms = q.split(/\s+/);
    state.musicFiles.some(function (f) {
      var hay = ((f.title || '') + ' ' + (f.artist || '') + ' ' + (f.album || '') + ' ' + (f.genre || '')).toLowerCase();
      if (terms.every(function (t) { return hay.indexOf(t) !== -1; })) items.push({ type: 'track', icon: 'ph-music-note', label: f.title || f.filename || 'Unknown Track', sub: (f.artist || 'Unknown Artist') + ' • ' + (f.album || 'Unknown Album'), file: f });
      return items.filter(function (i) { return i.type === 'track'; }).length >= 25;
    });
    buildAlbumListForCommands().some(function (album) {
      var hay = ((album.name || '') + ' ' + (album.artist || '')).toLowerCase();
      if (terms.every(function (t) { return hay.indexOf(t) !== -1; })) items.push({ type: 'album', icon: 'ph-vinyl-record', label: album.name, sub: album.artist + ' • ' + album.tracks.length + ' tracks', album: album });
      return items.filter(function (i) { return i.type === 'album'; }).length >= 16;
    });
    state.playlists.some(function (pl) {
      var hay = (pl.name || '').toLowerCase();
      if (terms.every(function (t) { return hay.indexOf(t) !== -1; })) items.push({ type: 'playlist', icon: 'ph-playlist', label: pl.name, sub: (pl.tracks ? pl.tracks.length : 0) + ' tracks', playlist: pl });
      return items.filter(function (i) { return i.type === 'playlist'; }).length >= 12;
    });
  }
  return items.slice(0, 80);
}
function initDownloadControls() {
  importPl = $('import-playlist-btn');
  var sourceModal = $('playlist-import-source-modal');
  var linkFields = $('playlist-import-link-fields');
  var linkStatus = $('playlist-import-url-status');
  var linkInput = $('playlist-import-url');
  var linkSubmit = $('playlist-import-url-submit');
  var activeLinkRequest = '';
  var linkGeneration = 0;
  function cancelLinkImport() {
    linkGeneration++;
    if (activeLinkRequest && window.api.cancelPlaylistUrlImport) window.api.cancelPlaylistUrlImport(activeLinkRequest);
    activeLinkRequest = '';
    if (linkSubmit) linkSubmit.disabled = false;
    if (sourceModal) hideModal(sourceModal);
  }
  if (window.api.onPlaylistUrlImportProgress) window.api.onPlaylistUrlImportProgress(function (progress) {
    if (!progress || progress.requestId !== activeLinkRequest || !linkStatus) return;
    linkStatus.textContent = progress.message + (progress.total ? ' ' + progress.done + ' / ' + progress.total : '');
  });
  if (importPl) importPl.addEventListener('click', function () { if (linkFields) linkFields.hidden = true; if (linkStatus) linkStatus.textContent = ''; showModal(sourceModal); });
  var fileChoice = $('playlist-import-file-choice');
  var reimportAction = $('pctx-reimport');
  if (reimportAction) reimportAction.addEventListener('click', async function () {
    var pl = currentContextMenuPlaylist;
    if (!pl || !pl.importSource || !pl.importSource.path) return;
    try {
      var result = pl.importSource.format === 'url'
        ? await window.api.importPlaylistUrl(pl.importSource.path, 'reimport_' + Date.now())
        : pl.importSource.format === 'spotify-login'
          ? await window.api.importSpotifyAccountPlaylist(pl.importSource.path.replace(/^spotify:playlist:/, ''), 'reimport_' + Date.now())
          : await window.api.importPlaylist();
      if (!result || result.canceled) return;
      if (!result.ok || !Array.isArray(result.records) || !result.records.length) { showToast((result && result.error) || 'Source playlist could not be read completely.'); return; }
      if (result.sourcePath !== pl.importSource.path) { showToast('Select the same source file used for this playlist.'); return; }
      await showPlaylistImportReview(result, pl);
    } catch (error) { showToast('Reimport failed: ' + ((error && error.message) || String(error))); }
  });
  if (fileChoice) fileChoice.addEventListener('click', async function () {
    hideModal(sourceModal);
    try {
      var result = await window.api.importPlaylist();
      if (!result || result.canceled) return;
      if (!result.ok || !result.records || result.records.length === 0) { showToast('No playlist entries were found in the selected file.'); return; }
      hideModal($('settings-modal'));
      await showPlaylistImportReview(result);
    } catch (error) {
      showToast('Playlist import failed: ' + ((error && error.message) || String(error || 'unknown error')));
    }
  });
  var linkChoice = $('playlist-import-link-choice');
  if (linkChoice) linkChoice.addEventListener('click', function () { linkFields.hidden = false; if (linkInput) linkInput.focus(); });
  var sourceCancel = $('playlist-import-source-cancel');
  if (sourceCancel) sourceCancel.addEventListener('click', cancelLinkImport);
  if (sourceModal) sourceModal.addEventListener('click', function (event) { if (event.target === sourceModal) cancelLinkImport(); });
  if (linkInput) linkInput.addEventListener('keydown', function (event) { if (event.key === 'Enter') { event.preventDefault(); linkSubmit.click(); } });
  if (linkSubmit) linkSubmit.addEventListener('click', async function () {
    if (activeLinkRequest) return;
    var generation = ++linkGeneration;
    var requestId = 'playlist_url_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
    activeLinkRequest = requestId;
    linkSubmit.disabled = true;
    linkStatus.textContent = 'Reading playlist…';
    try {
      var result = await window.api.importPlaylistUrl(linkInput.value.trim(), requestId);
      if (generation !== linkGeneration) return;
      if (!result || !result.ok) { linkStatus.textContent = result && result.cancelled ? 'Import cancelled.' : ((result && result.error) || 'Playlist could not be read.'); return; }
      if (!result.records || !result.records.length) { linkStatus.textContent = 'No tracks found in this playlist.'; return; }
      hideModal(sourceModal);
      await showPlaylistImportReview(result);
    } catch (error) { if (generation === linkGeneration) linkStatus.textContent = 'Playlist request failed. Check the connection and try again.'; }
    finally { if (generation === linkGeneration) { activeLinkRequest = ''; linkSubmit.disabled = false; } }
  });
  playlistImportSelectMissing = $('playlist-import-select-missing');
  if (playlistImportSelectMissing) playlistImportSelectMissing.addEventListener('click', function () {
    getPlaylistImportRows().forEach(function (item) {
      var row = item.row;
      if (isPlaylistImportDownloadEligible(row)) row.__downloadSelected = true;
    });
    renderPlaylistImportReview();
  });
  playlistImportFindCandidates = $('playlist-import-find-candidates');
  if (playlistImportFindCandidates) playlistImportFindCandidates.addEventListener('click', searchSelectedImportCandidates);
  playlistImportFindAllCandidates = $('playlist-import-find-all-candidates');
  if (playlistImportFindAllCandidates) playlistImportFindAllCandidates.addEventListener('click', searchAllImportCandidates);
  playlistImportCheckTools = $('playlist-import-check-tools');
  if (playlistImportCheckTools) playlistImportCheckTools.addEventListener('click', async function () {
    var out = $('playlist-import-tool-status');
    if (out) out.textContent = 'Checking...';
    var res = window.api.checkYtdlpTools ? await window.api.checkYtdlpTools() : null;
    if (out) out.textContent = res && res.ok ? ('yt-dlp ' + res.ytdlp + ', ffmpeg OK') : ((res && res.error) || 'Tool check unavailable');
  });
  playlistImportCancel = $('playlist-import-cancel');
  if (playlistImportCancel) playlistImportCancel.addEventListener('click', cancelPlaylistImport);
  playlistImportCancelX = $('playlist-import-cancel-x');
  if (playlistImportCancelX) playlistImportCancelX.addEventListener('click', cancelPlaylistImport);
  playlistImportStopSearch = $('playlist-import-stop-search');
  if (playlistImportStopSearch) playlistImportStopSearch.addEventListener('click', function () { cancelPlaylistCandidateSearch(true); });
  playlistImportConflict = $('playlist-import-conflict');
  if (playlistImportConflict) playlistImportConflict.addEventListener('change', function () { if (pendingPlaylistImport) pendingPlaylistImport.conflictMode = playlistImportConflict.value; });
  playlistImportOnly = $('playlist-import-only');
  if (playlistImportOnly) playlistImportOnly.addEventListener('click', function () { finishPlaylistImport('import'); });
  playlistImportAddLocal = $('playlist-import-add-local');
  if (playlistImportAddLocal) playlistImportAddLocal.addEventListener('click', function () { finishPlaylistImport('local'); });
  playlistImportDownload = $('playlist-import-download');
  if (playlistImportDownload) playlistImportDownload.addEventListener('click', function () { finishPlaylistImport('download'); });
  playlistImportModal = $('playlist-import-modal');
  if (playlistImportModal) playlistImportModal.addEventListener('click', function (e) { if (e.target === playlistImportModal) cancelPlaylistImport(); });
  createPlBtn = $('create-playlist-btn');
  if (createPlBtn) createPlBtn.addEventListener('click', function () {
    cpSelectedCoverPath = null; cpSelectedColor = PALETTE[0];
    var ni = $('cp-name-input'); if (ni) ni.value = '';
    var cp = $('cp-cover-preview'); if (cp) cp.style.display = 'none';
    buildColorPickers(); showModal($('create-playlist-modal'));
    setTimeout(function () { var ni = $('cp-name-input'); if (ni) ni.focus(); }, 100);
  });
  createSmartMixBtn = $('create-smart-mix-btn');
  if (createSmartMixBtn) createSmartMixBtn.addEventListener('click', function () { openRulePlaylistBuilder(); });
  cpDrop = $('cp-cover-drop');
  if (cpDrop) {
    cpDrop.addEventListener('click', async function () { var cover = await choosePlaylistCover(); if (cover) { cpSelectedCoverPath = cover; $('cp-cover-preview').src = cover; $('cp-cover-preview').style.display = 'block'; } });
    cpDrop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); cpDrop.click(); } });
    cpDrop.addEventListener('dragover', function (e) { e.preventDefault(); cpDrop.classList.add('drag-over'); });
    cpDrop.addEventListener('dragleave', function () { cpDrop.classList.remove('drag-over'); });
    cpDrop.addEventListener('drop', async function (e) { e.preventDefault(); cpDrop.classList.remove('drag-over'); var f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/')) { var cover = await cropPlaylistCoverFile(f); if (cover) { cpSelectedCoverPath = cover; $('cp-cover-preview').src = cover; $('cp-cover-preview').style.display = 'block'; } } });
  }
  cpCancel = $('cp-cancel-btn');
  if (cpCancel) cpCancel.addEventListener('click', function () { hideModal($('create-playlist-modal')); });
  cpCreate = $('cp-create-btn');
  if (cpCreate) cpCreate.addEventListener('click', async function () {
    var name = ($('cp-name-input').value || '').trim() || 'New Playlist';
    var pl = { id: 'pl_' + Date.now(), name: name, cover: cpSelectedCoverPath, color: cpSelectedColor, tracks: [], pinned: false, lastPlayed: null };
    state.playlists.push(pl); await persistPlaylists(state.playlists);
    renderSidebarPlaylists(); hideModal($('create-playlist-modal')); switchView(pl.id);
  });
  navLib = $('nav-library');
  if (navLib) navLib.addEventListener('click', function () { switchView('library'); });
  navHome = $('nav-home');
  if (navHome) navHome.addEventListener('click', function () { switchView('home'); });
  dockModeToggle = $('dock-mode-toggle');
  if (dockModeToggle) dockModeToggle.addEventListener('click', function () {
    appSettings.dockMode = appSettings.dockMode === 'expanded' ? 'collapsed' : 'expanded';
    applyDockMode();
    persistInBackground(persistSettings(appSettings));
    renderSidebarPlaylists();
    if (appSettings.dockMode === 'expanded' && getEffectiveDockMode() !== 'expanded') showToast('Expanded dock saved. Widen the window to show it.');
  });
  navPlaylists = $('nav-playlists');
  if (navPlaylists) navPlaylists.addEventListener('click', function () { switchView('playlists'); });
  navRadio = $('nav-radio');
  if (navRadio) navRadio.addEventListener('click', function () { switchView('radio'); });
  if (navPlaylists) {
    navPlaylists.addEventListener('dragover', function (e) {
      if (!e.dataTransfer || !e.dataTransfer.types.includes('text/plain')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      navPlaylists.classList.add('drop-target');
    });
    navPlaylists.addEventListener('dragleave', function (e) {
      if (!navPlaylists.contains(e.relatedTarget)) navPlaylists.classList.remove('drop-target');
    });
    navPlaylists.addEventListener('drop', function (e) {
      e.preventDefault();
      navPlaylists.classList.remove('drop-target');
      var track = readDroppedTrack(e.dataTransfer);
      if (track) showAddToPlaylistModal([track]);
      else showToast('Could not read the dropped track. Drag it from a Playerinyo track list.');
    });
  }
  navHealth = $('nav-health');
  if (navHealth) navHealth.addEventListener('click', function () { switchView('metadata_health'); });
  navStats = $('nav-stats');
  if (navStats) navStats.addEventListener('click', function () { switchView('stats'); });
  btnLike = $('btn-like');
  if (btnLike) btnLike.addEventListener('click', toggleCurrentTrackLike);
  btnOpenTagHealth = $('btn-open-tag-health');
  if (btnOpenTagHealth) btnOpenTagHealth.addEventListener('click', function () { hideModal($('settings-modal')); switchView('metadata_health'); });
  btnReviewMovedFiles = $('btn-review-moved-files');
  if (btnReviewMovedFiles) btnReviewMovedFiles.addEventListener('click', async function () {
    if (movedFileOperation || appStateCommitInProgress) return;
    hideModal($('settings-modal'));
    switchView('metadata_health');
    var healthRoot = $('metadata-health-container');
    if (healthRoot) healthRoot.dataset.filter = 'missing_files';
    renderMetadataHealthView();
    var scanned = await scanMissingLibraryFiles();
    if (scanned && libraryMissingFilePaths.size) await relinkMissingFilesFromFolder();
  });
  function renderNavHistoryView(viewId) {
    if (viewId && viewId.startsWith('album:')) {
      var album = getFullAlbumByKey(decodeURIComponent(viewId.slice(6))); if (album) renderAlbumDetail(album);
    } else if (viewId && viewId.startsWith('youtube-search:')) restoreMusicSearch(viewId);
    else switchView(viewId, false);
  }
  btnNavBack = $('btn-nav-back');
  if (btnNavBack) btnNavBack.addEventListener('click', function () {
    if (state.navIndex > 0) {
      state.navIndex--; renderNavHistoryView(state.navHistory[state.navIndex]);
      updateNavBtns();
    }
  });
  btnNavFwd = $('btn-nav-forward');
  if (btnNavFwd) btnNavFwd.addEventListener('click', function () {
    if (state.navIndex < state.navHistory.length - 1) {
      state.navIndex++; renderNavHistoryView(state.navHistory[state.navIndex]);
      updateNavBtns();
    }
  });
  plSearch = $('playlist-search');
  if (plSearch) plSearch.addEventListener('input', function (e) { filterPlaylists(e.target.value); });
  gSearch = $('global-search');
  var searchSource = $('global-search-source');
  var searchSubmit = $('global-search-submit');
  var musicResults = $('youtube-music-results');
  var musicSearchSequence = 0;
  var musicPlaySequence = 0;
  function showMusicSearchView() {
    hideAllViewRoots();
    if (musicResults) { musicResults.hidden = false; musicResults.style.display = 'block'; }
    state.currentView = 'search';
    setViewKind('search');
  }
  function restoreMusicSearch(viewId) {
    if (!gSearch || !searchSource) return;
    searchSource.value = 'youtube-music';
    searchSource.dispatchEvent(new Event('change'));
    gSearch.value = decodeURIComponent(viewId.slice('youtube-search:'.length));
    var clear = $('global-search-clear'); if (clear) clear.hidden = !gSearch.value;
    submitMusicSearch(false);
  }
  async function submitMusicSearch(recordHistory = true) {
    if (!gSearch || !musicResults || !window.api.searchYouTubeMusic) return;
    var query = gSearch.value.trim();
    var searchStartedAt = performance.now();
    var sequence = ++musicSearchSequence;
    if (recordHistory && query.length >= 2) pushNav('youtube-search:' + encodeURIComponent(query));
    showMusicSearchView();
    musicResults.replaceChildren();
    var artistMatches = document.createElement('section');
    artistMatches.className = 'youtube-artist-results';
    artistMatches.setAttribute('aria-label', 'Artists');
    musicResults.appendChild(artistMatches);
    var songArtists = [], queryArtists = [];
    function renderArtistMatches() {
      if (sequence !== musicSearchSequence || !artistMatches.isConnected) return;
      var seen = new Set();
      var artists = songArtists.concat(queryArtists).filter(function (artist) {
        if (!artist || !artist.id || seen.has(artist.id)) return false;
        seen.add(artist.id); return true;
      });
      renderSearchArtistCards(artistMatches, artists);
    }
    var heading = document.createElement('h2'); heading.textContent = 'YouTube Music · Songs'; musicResults.appendChild(heading);
    var status = document.createElement('p'); status.textContent = query.length < 2 ? 'Enter at least two characters.' : 'Searching YouTube Music…'; musicResults.appendChild(status);
    if (query.length < 2) return;
    if (window.api.searchArtistCatalog) {
      window.api.searchArtistCatalog(query).then(function (artistResult) {
        if (sequence !== musicSearchSequence || searchSource.value !== 'youtube-music' || !artistMatches.isConnected) return;
        if (!artistResult || !artistResult.ok) return;
        queryArtists = artistResult.artists || [];
        renderArtistMatches();
      }).catch(function () { /* Songs remain usable when catalog search is unavailable. */ });
    }
    try {
      var result = await window.api.searchYouTubeMusic(query);
      var searchMs = Math.round(performance.now() - searchStartedAt);
      if (sequence !== musicSearchSequence || searchSource.value !== 'youtube-music') return;
      if (!result || !result.ok) { status.textContent = (result && result.error) || 'Search failed. Try again shortly.'; return; }
      if (window.api.searchArtistCatalog) {
        var seenNames = new Set();
        var firstArtistNames = result.songs.map(function (song) { return song.artist; }).filter(function (name) {
          var key = artistCatalogKey(name);
          if (!key || seenNames.has(key)) return false;
          seenNames.add(key); return true;
        }).slice(0, 2);
        Promise.all(firstArtistNames.map(function (name) {
          return window.api.searchArtistCatalog(name).then(function (response) {
            return response && response.ok && (response.artists || []).find(function (artist) { return artistCatalogKey(artist.name) === artistCatalogKey(name); });
          }).catch(function () { return null; });
        })).then(function (artists) { songArtists = artists.filter(Boolean); renderArtistMatches(); });
      }
      status.textContent = result.songs.length ? result.songs.length + ' songs · Choose a version to play.' : 'No matching songs found.';
      result.songs.forEach(function (song) {
        var track = { candidateId: 'youtube-music:' + song.videoId, queueEntryId: createQueueEntryId(), title: song.title, artist: song.artist, album: song.album || '', duration: song.duration, artwork: song.artwork || '', playback: { kind: 'youtube', videoId: song.videoId } };
        var row = document.createElement('div'); row.className = 'youtube-music-row'; row.dataset.videoId = song.videoId;
        var cover = document.createElement('img'); cover.className = 'youtube-music-row-cover'; cover.alt = ''; cover.loading = 'lazy'; cover.src = song.artwork || ('https://i.ytimg.com/vi/' + song.videoId + '/hqdefault.jpg'); row.appendChild(cover);
        var details = document.createElement('div'); details.className = 'youtube-music-row-details';
        var title = document.createElement('button'); title.type = 'button'; title.className = 'youtube-music-metadata-link'; title.textContent = song.title; title.title = 'Find album';
        title.addEventListener('click', function () { openAlbumForTrack(track); });
        var meta = document.createElement('span');
        var artistLink = document.createElement('button'); artistLink.type = 'button'; artistLink.className = 'youtube-music-metadata-link'; artistLink.textContent = song.artist || 'Unknown Artist'; artistLink.title = 'Open artist profile';
        artistLink.addEventListener('click', function () { openArtistProfileByName(song.artist); });
        meta.append(artistLink, document.createTextNode(' · ' + (song.duration ? (Math.floor(song.duration / 60) + ':' + String(Math.floor(song.duration % 60)).padStart(2, '0')) : '—') + ' · YouTube Music'));
        var rowStatus = document.createElement('span'); rowStatus.className = 'youtube-music-row-status'; rowStatus.setAttribute('role', 'status'); rowStatus.setAttribute('aria-live', 'polite');
        details.append(title, meta, rowStatus); row.appendChild(details);
        var playButton;
        [['Play', async function () {
          var playSequence = ++musicPlaySequence;
          var previousQueue = captureQueueBeforeSongRadio();
          playButton.disabled = true;
          playButton.textContent = 'Preparing…';
          rowStatus.textContent = 'Preparing audio stream…';
          track._playbackError = '';
          var playStartedAt = performance.now();
          if (!audioEls) audioEls = [$('audio-player-0'), $('audio-player-1')];
          var candidateAudio = audioEls[1 - activeAudioIdx];
          function onMediaLoad() { if (pendingPlaybackTrack === track) rowStatus.textContent = 'Loading audio…'; }
          function onMediaPlaying() { if (pendingPlaybackTrack === track || state.currentPlayingTrack === track) rowStatus.textContent = 'Playing now'; }
          if (candidateAudio) { candidateAudio.addEventListener('loadstart', onMediaLoad); candidateAudio.addEventListener('playing', onMediaPlaying); }
          try {
            var played = await playTrack(track, { preserveQueueCursors: true });
            if (playSequence !== musicPlaySequence) { playButton.textContent = 'Play'; rowStatus.textContent = ''; return; }
            if (played) { startSongRadioFromSearch(track, previousQueue); playButton.textContent = 'Playing'; rowStatus.textContent = 'Playing now'; row.dataset.playbackStatus = 'playing'; console.info('YouTube Music play', { videoId: song.videoId, ms: Math.round(performance.now() - playStartedAt), searchMs: searchMs, cachedSearch: !!result.cached }); }
            else { playButton.textContent = 'Retry Play'; rowStatus.textContent = track._playbackError || 'Could not start this song. Try another version.'; row.dataset.playbackStatus = 'error'; }
          } catch (error) { if (playSequence === musicPlaySequence) { playButton.textContent = 'Retry Play'; rowStatus.textContent = (error && error.message) || 'Could not start this song.'; row.dataset.playbackStatus = 'error'; } }
          finally { if (candidateAudio) { candidateAudio.removeEventListener('loadstart', onMediaLoad); candidateAudio.removeEventListener('playing', onMediaPlaying); } playButton.disabled = false; }
        }], ['Queue', function () { state.userQueue.push(makeManualQueueEntry(track)); renderQueue(); checkpointPlaybackSession(getActiveAudioEl(), 200); showToast('Added to queue.'); }], ['Playlist', function () { showAddToPlaylistModal([track]); }]].forEach(function (action) {
          var button = document.createElement('button'); button.type = 'button'; button.className = 'btn btn-outline'; button.textContent = action[0]; button.setAttribute('aria-label', action[0] + ' ' + song.title); button.addEventListener('click', action[1]); row.appendChild(button);
          if (action[0] === 'Play') { playButton = button; button.classList.add('youtube-music-play'); }
        });
        musicResults.appendChild(row);
      });
      console.info('YouTube Music search', { ms: searchMs, cached: !!result.cached, results: result.songs.length, renderMs: Math.round(performance.now() - searchStartedAt - searchMs) });
      syncYouTubeMusicResultsPlaybackState();
    } catch (error) { if (sequence === musicSearchSequence) status.textContent = 'Network search failed. Check the connection and try again.'; }
  }
  if (searchSource) searchSource.addEventListener('change', function () {
    musicSearchSequence++;
    if (musicResults) { musicResults.hidden = true; musicResults.style.display = 'none'; }
    gSearch.placeholder = searchSource.value === 'youtube-music' ? 'Search YouTube Music songs' : 'Search your collection';
    if (searchSource.value === 'youtube-music') showMusicSearchView();
  });
  if (searchSubmit) searchSubmit.addEventListener('click', function () { if (searchSource.value === 'youtube-music') submitMusicSearch(); else gSearch.dispatchEvent(new Event('input')); });
  if (gSearch) gSearch.addEventListener('keydown', function (event) { if (event.key === 'Enter' && searchSource.value === 'youtube-music') { event.preventDefault(); submitMusicSearch(); } });
  var clearGlobalSearch = $('global-search-clear');
  function syncGlobalSearchClear() {
    if (clearGlobalSearch) clearGlobalSearch.hidden = !gSearch || !gSearch.value;
  }
  if (clearGlobalSearch) clearGlobalSearch.addEventListener('click', function () {
    if (!gSearch) return;
    gSearch.value = '';
    syncGlobalSearchClear();
    gSearch.dispatchEvent(new Event('input'));
    gSearch.focus();
  });
  if (gSearch) gSearch.addEventListener('input', function (e) {
    syncGlobalSearchClear();
    if (searchSource && searchSource.value === 'youtube-music') {
      musicSearchSequence++;
      showMusicSearchView();
      if (musicResults) musicResults.textContent = gSearch.value.trim() ? 'Press Search or Enter to search YouTube Music songs.' : 'Enter a song or artist, then press Search.';
      return;
    }
    if (musicResults) { musicResults.hidden = true; musicResults.style.display = 'none'; }
    clearTimeout(gSearchTimeout);
    gSearchTimeout = setTimeout(function () {
      var q = e.target.value.toLowerCase().trim();
      libraryRenderState.token = (libraryRenderState.token || 0) + 1;
      if (libraryRenderState.frame) {
        cancelAnimationFrame(libraryRenderState.frame);
        libraryRenderState.frame = null;
      }
      $('search-albums-container').style.display = 'none';
      if (!q) { switchView('library'); return; }
      
      if (state.currentView !== 'search') {
        pushNav('search');
        state.currentView = 'search';
      }

      hideAllViewRoots();
      setViewKind('search');
      $('tracks-table-container').style.display = 'block';

      var parsedSearch = parseLibrarySearchQuery(q);
      if (parsedSearch.filters.some(function (filter) { return filter.key === 'liked'; })) parsedSearch.likedSongsSet = new Set(state.likedSongs);
      var matchedFiles = state.musicFiles.filter(function (f) { return matchesLibrarySearch(f, parsedSearch); });

      // Build album map from already-filtered search results.
      var matchedAlbums = {};
      var genreOnlyMatches = {};
      matchedFiles.forEach(function (f) {
        var k = getAlbumKey(f);
        if (!matchedAlbums[k]) matchedAlbums[k] = { id: k, name: f.album || 'Unknown Album', artist: f.albumArtist || f.artist || 'Unknown Artist', cover: null, tracks: [], genre: f.genre || '' };
        if (!matchedAlbums[k].cover && f.picture) matchedAlbums[k].cover = f.picture;
        matchedAlbums[k].tracks.push(f);
        if (parsedSearch.filters.some(function (filter) { return filter.key === 'genre'; }) && parsedSearch.terms.length === 0) genreOnlyMatches[k] = true;
      });

      var aGrid = $('search-albums-grid'); aGrid.innerHTML = '';
      var albumKeys = Object.keys(matchedAlbums);
      if (searchRenderState.albumQuery !== q) {
        searchRenderState.albumQuery = q;
        searchRenderState.albumRenderLimit = 200;
      }
      var albumContainer = $('search-albums-container');
      var albumHeader = albumContainer ? albumContainer.querySelector('h2') : null;

      if (albumKeys.length > 0) {
        // Determine label: if all results are genre-only matches, show genre label
        var allGenreOnly = albumKeys.every(function(k) { return genreOnlyMatches[k]; });
        var firstGenre = matchedAlbums[albumKeys[0]].genre;
        if (albumHeader) {
          if (allGenreOnly && firstGenre) {
            albumHeader.innerHTML = '<i class="ph ph-tag" style="margin-right:6px;"></i>Genre: ' + esc(firstGenre) + ' <span style="font-weight:400;font-size:12px;color:var(--text-subdued);background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:10px;margin-left:6px;">' + albumKeys.length + ' albums</span>';
          } else {
            albumHeader.innerHTML = '<i class="ph ph-vinyl-record" style="margin-right:6px;"></i>Albums <span style="font-weight:400;font-size:12px;color:var(--text-subdued);background:rgba(255,255,255,0.08);padding:2px 8px;border-radius:10px;margin-left:6px;">' + albumKeys.length + '</span>';
          }
        }
        albumContainer.style.display = 'block';
        var albumFragment = document.createDocumentFragment();
        albumKeys.slice(0, searchRenderState.albumRenderLimit || 200).forEach(function (k) {
          var album = matchedAlbums[k];
          var card = document.createElement('article'); card.className = 'album-card' + (isAlbumActive(album) ? ' playing' : ''); card.dataset.albumKey = album.id || '';
          var active = isAlbumActive(album);
          var playBtnIcon = active && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
          var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
          var cov = album.cover ? '<img src="' + esc(album.cover) + '" alt=""' + lazy + ' />' : '<i class="ph ph-music-notes" aria-hidden="true"></i>';
          // Show genre badge if this album matched via genre
          var genreBadge = genreOnlyMatches[k] && album.genre ? '<span style="font-size:10px;color:var(--accent);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(album.genre) + '</span>' : '';
          card.innerHTML = '<div class="album-card-img-wrapper" style="position:relative;">' + cov + '<button type="button" class="album-card-play-btn" aria-label="Play ' + esc(album.name) + '" data-album="' + encodeURIComponent(album.name) + '"><i class="' + playBtnIcon + '" aria-hidden="true"></i></button></div><button type="button" class="album-card-open" aria-label="Open ' + esc(album.name) + ' by ' + esc(album.artist || 'Unknown Artist') + '"><span class="album-card-info"><span class="album-card-title" title="' + esc(album.name) + '">' + esc(album.name) + '</span><span class="album-card-artist">' + esc(album.artist) + '</span>' + genreBadge + '</span></button>';
          card.addEventListener('contextmenu', function (e) {
            e.preventDefault();
            currentContextMenuAlbum = album;
            positionContextMenu($('album-context-menu'), e.clientX, e.clientY, card);
          });
          card.querySelector('.album-card-play-btn').addEventListener('click', function (e) {
            e.stopPropagation(); initAudioCtx();
            if (isAlbumActive(album)) { togglePlay(); var icon = e.currentTarget.querySelector('i'); if (icon) icon.className = state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play'; return; }
            state.playQueueTracks = getSortedAlbumTracks(album).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
            state.shuffleQueue = []; if (state.isShuffle) rebuildShuffleQueueForMode();
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
            var fullAlbum = getFullAlbumByKey(album.id) || album;
            var focusPath = album.tracks && album.tracks[0] ? album.tracks[0].filePath : '';
            pushNav('album:' + fullAlbum.id);
            renderAlbumDetail(fullAlbum, focusPath);
          });
          card.querySelector('.album-card-open').addEventListener('keydown', function (e) {
            if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) { e.preventDefault(); currentContextMenuAlbum = album; positionContextMenu($('album-context-menu'), 0, 0, card); }
          });
          if (isMultiSelectMode && selectedAlbumsForEdit.has(album.id)) {
            card.style.border = '2px solid var(--accent)';
            card.style.transform = 'scale(0.95)';
            card.style.opacity = '0.8';
          }
          albumFragment.appendChild(card);
        });
        aGrid.appendChild(albumFragment);
        if (albumKeys.length > (searchRenderState.albumRenderLimit || 200)) {
          var showMoreAlbums = document.createElement('button');
          showMoreAlbums.type = 'button';
          showMoreAlbums.className = 'btn btn-outline';
          showMoreAlbums.style.cssText = 'grid-column:1/-1;margin:8px auto;';
          showMoreAlbums.textContent = 'Show ' + Math.min(200, albumKeys.length - searchRenderState.albumRenderLimit) + ' more albums';
          showMoreAlbums.addEventListener('click', function () {
            searchRenderState.albumRenderLimit += 200;
            gSearch.dispatchEvent(new Event('input'));
          });
          aGrid.appendChild(showMoreAlbums);
        }
      }

      state.currentTracks = matchedFiles.map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
      clearTrackTableFilter();

      $('view-title').textContent = 'Search Results';
      renderTracksTable(false);
    }, 250);
  });
  if (gSearch) gSearch.placeholder = 'Search songs, albums, artists...';
}
