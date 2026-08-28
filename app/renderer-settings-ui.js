function renderCommandPalette() {
  var input = $('command-palette-input');
  var list = $('command-palette-list');
  if (!input || !list) return;
  commandPaletteItems = getCommandPaletteItems(input.value);
  if (commandPaletteIndex >= commandPaletteItems.length) commandPaletteIndex = 0;
  if (!commandPaletteItems.length) { list.innerHTML = '<div class="command-palette-empty">No results</div>'; return; }
  list.innerHTML = commandPaletteItems.map(function (item, idx) {
    return '<button class="command-palette-item' + (idx === commandPaletteIndex ? ' selected' : '') + '" data-idx="' + idx + '"><span class="command-palette-icon"><i class="ph ' + item.icon + '"></i></span><span class="command-palette-text"><span>' + esc(item.label) + '</span><small>' + esc(item.sub || item.type) + '</small></span><span class="command-palette-kind">' + esc(item.type) + '</span></button>';
  }).join('');
  var selected = list.querySelector('.command-palette-item.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}
function closeCommandPalette() { hideModal($('command-palette-modal')); }
function openCommandPalette() {
  var modal = $('command-palette-modal');
  var input = $('command-palette-input');
  if (!modal || !input) return;
  commandPaletteIndex = 0;
  input.value = '';
  showModal(modal);
  renderCommandPalette();
  setTimeout(function () { input.focus(); input.select(); }, 30);
}
function runCommandPaletteItem(item) {
  if (!item) return;
  closeCommandPalette();
  if (item.type === 'command' && item.action) { item.action(); return; }
  if (item.type === 'track' && item.file) {
    initAudioCtx();
    state.playQueueTracks = state.musicFiles.map(makeTrackCommandRecord);
    state.shuffleQueue = [];
    if (state.isShuffle) rebuildShuffleQueueForMode();
    var record = state.playQueueTracks.find(function (t) { return t.matchedFile && t.matchedFile.filePath === item.file.filePath; }) || makeTrackCommandRecord(item.file);
    playTrack(record);
    return;
  }
  if (item.type === 'album' && item.album) { pushNav('album:' + item.album.id); renderAlbumDetail(item.album); return; }
  if (item.type === 'playlist' && item.playlist) { switchView(item.playlist.id); }
}
var commandPaletteModal = null;

var commandPaletteInput = null;

var commandPaletteList = null;



/* ─── KEYBOARD SHORTCUTS HELP ─── */
var SHORTCUTS_HELP = [
  { section: 'Playback', items: [
    ['Space', 'Play / Pause'],
    ['Ctrl + →', 'Next track'],
    ['Ctrl + ←', 'Previous track'],
    ['Ctrl + ↑', 'Volume up'],
    ['Ctrl + ↓', 'Volume down'],
    ['Ctrl + S', 'Cycle shuffle: Off / Random / Smart'],
    ['Ctrl + L', 'Cycle repeat: Off / All / One']
  ]},
  { section: 'Panels & Views', items: [
    ['N', 'Now Playing overlay'],
    ['Ctrl + Q', 'Toggle queue panel'],
    ['Ctrl + K', 'Command palette'],
    ['?', 'This shortcut list']
  ]},
  { section: 'Library', items: [
    ['Ctrl + F', 'Focus search'],
    ['Ctrl + Z', 'Undo last action'],
    ['Insert', 'Rescan folders for new songs'],
    ['Ctrl + Mouse Wheel', 'Zoom album grid'],
    ['Mouse Back / Forward', 'Navigate view history'],
    ['Esc', 'Clear selection / close overlays']
  ]}
];
function openShortcutsHelp() {
  var list = $('shortcuts-help-list');
  if (list) {
    list.innerHTML = SHORTCUTS_HELP.map(function (sec) {
      return '<div class="shortcut-help-section">' + esc(sec.section) + '</div>' + sec.items.map(function (it) {
        var keys = it[0].split(' + ').map(function (k) { return '<kbd>' + esc(k) + '</kbd>'; }).join('<small style="opacity:.5;margin:0 3px;">+</small>');
        return '<div class="shortcut-help-row"><span>' + esc(it[1]) + '</span><span class="shortcut-keys">' + keys + '</span></div>';
      }).join('');
    }).join('');
  }
  showModal($('shortcuts-help-modal'));
}
var shortcutsHelpModal = null;

var shortcutsHelpCloseBtn = null;

var shortcutsHelpButton = null;


var zoomIn = null; 
var zoomOut = null; 
var caW = null;

let _scrollThrottle;


var cbVirtualScrolling = null;


var togglePlBtn = null;


var btnFullscreenPl = null;




var winMinimize = null;

var winMaximize = null;

var winClose = null;

var btnDownloadQueue = null;

var downloadSearchToggle = null;

var downloadAlbumStart = null;

var downloadSearchForm = null;

var btnDownloadQueueClose = null;


var btnDownloadQueueClear = null;



var albumDownloadSearchBtn = null;

var albumDownloadSearchInput = null;

var albumDownloadQueueBtn = null;

var albumDownloadSelectMissingBtn = null;

var albumDownloadDeselectAllBtn = null;

function closeAlbumDownloadModal() {
  var returnToMetadata = albumDownloadOrigin === 'metadata' && !!metaProposedData;
  albumDownloadContext = null;
  albumDownloadSelectedRelease = null;
  albumDownloadOrigin = '';
  albumDownloadRequestSeq++;
  hideModal($('album-download-modal'));
  if (returnToMetadata) showModal($('metadata-modal'));
}
var albumDownloadCancel = null;

var albumDownloadCancelX = null;

var albumDownloadModal = null;

var btnSettings = null; 
var btnCloseSettings = null; 
var btnCloseSettingsTop = null; 
function formatBackupStatusDate(value) {
  if (!value) return '';
  var date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function renderAutomaticBackupStatus(status) {
  automaticBackupUiStatus = status && typeof status === 'object' ? status : null;
  var toggle = $('setting-automatic-backups');
  var summary = $('automatic-backup-summary');
  var success = $('automatic-backup-last-success');
  var error = $('automatic-backup-last-error');
  var runButton = $('btn-backup-now');
  if (!automaticBackupUiStatus) {
    if (summary) summary.textContent = 'Automatic backup status is unavailable.';
    if (success) success.textContent = 'Unavailable';
    if (error) { error.textContent = 'Restart Playerinyo and try again.'; error.classList.add('is-error'); }
    if (runButton) runButton.disabled = true;
    return;
  }
  if (toggle) toggle.checked = automaticBackupUiStatus.enabled !== false;
  var successText = formatBackupStatusDate(automaticBackupUiStatus.lastSuccessAt);
  if (success) success.textContent = successText || 'None yet';
  var errorDate = formatBackupStatusDate(automaticBackupUiStatus.lastErrorAt);
  if (error) {
    error.textContent = automaticBackupUiStatus.lastError
      ? (errorDate ? errorDate + ': ' : '') + automaticBackupUiStatus.lastError
      : 'None';
    error.classList.toggle('is-error', !!automaticBackupUiStatus.lastError);
  }
  if (summary) {
    if (automaticBackupUiStatus.running || automaticBackupUiBusy) summary.textContent = 'Creating a validated local backup…';
    else if (!automaticBackupUiStatus.enabled) summary.textContent = 'Automatic backups are off. Back Up Now remains available.';
    else if (!automaticBackupUiStatus.libraryReady) summary.textContent = 'Automatic backups start after the library contains music.';
    else {
      var nextDue = formatBackupStatusDate(automaticBackupUiStatus.nextDueAt);
      summary.textContent = nextDue ? 'Next daily backup: ' + nextDue : 'Daily backup is ready to run.';
    }
  }
  if (runButton) runButton.disabled = automaticBackupUiBusy || !!automaticBackupUiStatus.running || !automaticBackupUiStatus.libraryReady;
}
async function refreshAutomaticBackupStatus() {
  if (!window.api.automaticBackupStatus) { renderAutomaticBackupStatus(null); return null; }
  try {
    var status = await window.api.automaticBackupStatus();
    renderAutomaticBackupStatus(status);
    return status;
  } catch (e) {
    console.error('Automatic backup status failed:', e);
    renderAutomaticBackupStatus(null);
    return null;
  }
}
var automaticBackupToggle = null;

var btnBackupNow = null;

var btnOpenBackupFolder = null;

function backupIpcErrorMessage(e) {
  var msg = e && (e.message || String(e));
  if (/No handler registered for '?(export-backup|import-backup|restore-backup|automatic-backup-status|automatic-backup-ready|run-automatic-backup|open-backup-folder)'?/i.test(msg || '')) {
    return 'Backup feature needs a full app restart to load the new main-process handlers.\n\nClose Playerinyo completely, then start it again.';
  }
  return msg || 'unknown error';
}
var btnExportBackup = null;

var btnImportBackup = null;
var homeImportBackupBtn = null;
async function runBackupImport() {
  if (hasActiveDownloadQueueJobs()) { notifyUser('Wait for queued or active downloads to finish before importing a backup.'); return; }
  if (appStateCommitInProgress) return;
  var backupButtons = [btnImportBackup, homeImportBackupBtn].filter(Boolean);
  if (backupButtons.some(function (btn) { return btn.disabled; })) return;
  backupButtons.forEach(function (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); });
  var old = btnImportBackup ? btnImportBackup.innerHTML : '';
  var snapshot = null;
  var restoreCommitted = false;
  var runtimeWasInitialized = appInitializationComplete;
  var persistenceWasSuspended = rendererPersistenceSuspended;
  if (btnImportBackup) btnImportBackup.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Importing...';
  if (homeImportBackupBtn) homeImportBackupBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Reading backup...';
  try {
    var res = await window.api.importBackup();
    if (!res || !res.ok) { if (res && !res.canceled) notifyUser('Backup import failed: ' + (res.error || 'unknown error')); return; }
    var s = res.summary || {};
    var counts = ['Library tracks: ' + (s.library || 0), 'Playlists: ' + (s.playlists || 0), 'Liked songs: ' + (s.likedSongs || 0)].join('\n');
    if (!await requestConfirmation('Import backup from:\n' + res.filePath + '\n\n' + counts + '\n\nThis will replace current app library/playlists/settings. Continue?')) return;
    if (hasActiveDownloadQueueJobs()) { notifyUser('A download started while the backup was being reviewed. Wait for it to finish and try again.'); return; }
    beginAppStateCommit();
    if (runtimeWasInitialized) {
      appSettings.playHistory = state.playHistory.map(toLightTrackRef).filter(Boolean);
      syncSavedQueuePaths();
      await flushSettingsSave();
      snapshot = pushUndoSnapshot('Import backup', ['library', 'playlists', 'mappings', 'likedSongs', 'settings']);
      if (!snapshot) { notifyUser('Backup restore stopped because the current app state could not be captured for Undo.'); return; }
      snapshot.atomicAppState = true;
    }
    rendererPersistenceSuspended = true;
    appInitializationComplete = false;
    var restored = await window.api.restoreBackup(res.token);
    if (!restored || !restored.ok) {
      appInitializationComplete = runtimeWasInitialized;
      rendererPersistenceSuspended = persistenceWasSuspended;
      discardUndoSnapshot(snapshot);
      snapshot = null;
      notifyUser('Backup restore failed: ' + ((restored && restored.error) || 'unknown error'));
      return;
    }
    restoreCommitted = true;
    resetPlaybackRuntime({ clearCurrent: true, clearQueues: true, clearHistory: true, preserveSettings: true });
    await reloadRendererAppState(restored.likedSongs);
    state.navHistory = [];
    state.navIndex = -1;
    state.currentTracks = [];
    clearTrackSelection();
    selectedAlbumsForEdit.clear();
    libraryMissingFilePaths.clear();
    if (!appSettings.ytdlDownloadFolder && window.api.getDefaultDownloadFolder) {
      try { appSettings.ytdlDownloadFolder = await window.api.getDefaultDownloadFolder(); }
      catch (e) { console.error('Default download folder lookup failed:', e); }
    }
    await applyRuntimeSettings({ preserveTitleBarMode: true });
    restorePlaybackStateFromSettings();
    renderSidebarPlaylists();
    var emptyTitle = $('home-empty-library-title'); if (emptyTitle) emptyTitle.textContent = 'Bring your collection into focus.';
    var emptyCopy = $('home-empty-library') ? $('home-empty-library').querySelector('.empty-library-copy p') : null;
    if (emptyCopy) emptyCopy.textContent = 'Choose a music folder and Playerinyo will build a local index without moving or uploading your audio files.';
    var homeStatus = $('home-import-status'); if (homeStatus) homeStatus.replaceChildren();
    switchView(state.musicFiles.length ? 'library' : 'home');
    hideModal($('settings-modal'));
    rendererPersistenceSuspended = false;
    appInitializationComplete = true;
    startupErrorRendered = false;
    setStartupErrorMode(false);
    var restoreWarningText = Array.isArray(restored.warnings) && restored.warnings.length ? ' Warnings: ' + restored.warnings.join(' ') : '';
    showUndoToast('Backup restored. Playback and runtime settings were reconciled.' + restoreWarningText, snapshot);
  } catch (e) {
    if (!restoreCommitted) {
      appInitializationComplete = runtimeWasInitialized;
      rendererPersistenceSuspended = persistenceWasSuspended;
      discardUndoSnapshot(snapshot);
    } else {
      renderStartupError(e);
    }
    notifyUser('Backup import failed: ' + backupIpcErrorMessage(e));
  } finally {
    if (appStateCommitInProgress) endAppStateCommit();
    backupButtons.forEach(function (btn) { btn.disabled = false; btn.setAttribute('aria-busy', 'false'); });
    if (btnImportBackup) btnImportBackup.innerHTML = old;
    if (homeImportBackupBtn) homeImportBackupBtn.innerHTML = '<i class="ph ph-upload-simple" aria-hidden="true"></i> Restore a backup';
  }
}

var settMin = null; 
var settAudio = null; 
async function persistSensitiveSetting(key, value) {
  appSettings[key] = value;
  if (!value && window.api.clearSensitiveSetting) await window.api.clearSensitiveSetting(key);
  await persistSettings(appSettings);
}
var settDiscogsToken = null;

function refreshDownloadFolderUi() {
  var inp = $('setting-download-folder');
  if (inp) inp.value = appSettings.ytdlDownloadFolder || '';
  var quality = $('setting-download-quality');
  if (quality) quality.value = ['best-native', 'opus', 'm4a', 'mp3'].includes(appSettings.ytdlDownloadQuality) ? appSettings.ytdlDownloadQuality : 'best-native';
  var mode = $('setting-ytdl-cookies-mode');
  var browser = $('setting-ytdl-cookies-browser');
  var file = $('setting-ytdl-cookies-file');
  var browserRow = $('setting-ytdl-cookies-browser-row');
  var fileRow = $('setting-ytdl-cookies-file-row');
  var cookiesMode = appSettings.ytdlCookiesMode || 'none';
  if (mode) mode.value = cookiesMode;
  if (browser) browser.value = appSettings.ytdlCookiesBrowser || 'firefox';
  if (file) file.value = appSettings.ytdlCookiesFile || '';
  if (browserRow) browserRow.style.display = cookiesMode === 'browser' ? 'block' : 'none';
  if (fileRow) fileRow.style.display = cookiesMode === 'file' ? 'grid' : 'none';
}
var btnDownloadFolder = null;

var settingDownloadQuality = null;

var settingYtdlCookiesMode = null;

var settingYtdlCookiesBrowser = null;

var btnYtdlCookiesFile = null;

async function checkYtdlpTools(targetEl) {
  var el = targetEl || $('ytdlp-status-text');
  if (el) el.textContent = 'Checking...';
  var res = window.api.checkYtdlpTools ? await window.api.checkYtdlpTools() : null;
  if (el) el.textContent = res && res.ok ? ('yt-dlp ' + res.ytdlp + ', ffmpeg OK') : ((res && res.error) || 'Tool check unavailable');
  return res;
}
var btnCheckYtdlp = null;

async function checkForAppUpdate(manual) {
  var status = $('app-update-status');
  if (!window.api.checkForAppUpdate) return null;
  if (manual && status) status.textContent = 'Checking…';
  try {
    var result = await window.api.checkForAppUpdate();
    if (result && result.available) {
      var message = 'Version ' + result.latestVersion + ' is available on GitHub Releases.';
      if (status) status.textContent = message;
      showToast(message);
    } else if (manual && status) {
      status.textContent = result && result.error ? result.error : ('You are up to date (' + ((result && result.currentVersion) || 'current version') + ').');
    }
    return result;
  } catch (error) {
    if (manual && status) status.textContent = 'Could not check for updates.';
    return null;
  }
}
var btnCheckAppUpdate = null;

async function refreshSafeStorageStatus() {
  var el = $('safe-storage-status');
  if (!el || !window.api.safeStorageStatus) return;
  try {
    var res = await window.api.safeStorageStatus();
    if (res && res.encryptionAvailable) {
      el.style.color = 'var(--text-subdued)';
      el.textContent = 'Sensitive settings are encrypted by the OS' + (res.backend ? ' (' + res.backend + ')' : '') + '.';
    } else {
      el.style.color = 'var(--danger)';
      el.textContent = 'Warning: secure OS encryption is unavailable. API tokens are kept only for this session and are not saved. On Linux, install or enable a secret service/keyring.';
    }
  } catch (e) {
    el.style.color = 'var(--danger)';
    el.textContent = 'Could not check OS encryption status.';
  }
}
var settDiscord = null; 
var settCrossfade = null;

var settMasterGain = null;


var queueToggle = null; 
var closeQueue = null; 

var settNorm = null;


var settNotif = null;


var settNativeTitleBar = null;


// (virtual-scrolling checkbox is wired once above, incl. the perf-mode class toggle)

var settLL = null;


var settGlassEffects = null;


function updateMultiSelectControls() {
  var count = selectedAlbumsForEdit ? selectedAlbumsForEdit.size : 0;
  var meBtn = $('btn-multi-edit');
  var mmBtn = $('btn-multi-merge');
  var mrBtn = $('btn-multi-remove');
  if (meBtn) {
    meBtn.style.display = count > 0 ? 'block' : 'none';
    meBtn.textContent = 'Edit (' + count + ')';
  }
  if (mmBtn) mmBtn.style.display = count > 1 ? 'block' : 'none';
  if (mrBtn) {
    mrBtn.style.display = count > 0 ? 'block' : 'none';
    mrBtn.textContent = 'Remove (' + count + ')';
  }
}

function setMultiSelectMode(enabled) {
  isMultiSelectMode = !!enabled;
  var multiSelectButton = $('btn-multi-select');
  var stateLabel = $('multi-select-state');
  if (multiSelectButton) {
    multiSelectButton.classList.toggle('active', isMultiSelectMode);
    multiSelectButton.setAttribute('aria-pressed', String(isMultiSelectMode));
    multiSelectButton.setAttribute('aria-label', isMultiSelectMode ? 'Disable album selection' : 'Enable album selection');
    multiSelectButton.title = isMultiSelectMode ? 'Disable album selection' : 'Enable album selection';
    multiSelectButton.style.color = '';
  }
  if (stateLabel) stateLabel.hidden = !isMultiSelectMode;
}

var btnMultiSelect = null;


var btnMultiEdit = null;


var btnMultiMerge = null;


var btnMultiRemove = null;


var eqBands = [];
var analyserNode;
var visualizerFrame = null;
function initEq() {
  if (!audioCtx || eqBands.length) return;
  var eqFreqs = [60, 230, 910, 3600, 14000];
  eqFreqs.forEach((freq, i) => {
    var filter = audioCtx.createBiquadFilter();
    filter.type = (i === 0) ? 'lowshelf' : (i === eqFreqs.length - 1) ? 'highshelf' : 'peaking';
    filter.frequency.value = freq;
    filter.Q.value = 1;
    filter.gain.value = appSettings.eqGains ? (appSettings.eqGains[i] || 0) : 0;
    eqBands.push(filter);
    if (i > 0) eqBands[i - 1].connect(eqBands[i]);
  });

  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 256;
  if (eqBands.length) eqBands[eqBands.length - 1].connect(analyserNode);

  updateAudioChain();
  drawVisualizer();
}

function drawVisualizer() {
  if (visualizerFrame) cancelAnimationFrame(visualizerFrame);
  var canvas = $('visualizer');
  if (!canvas || !analyserNode) return;
  if (!state.isPlaying) {
    visualizerFrame = null;
    var idleCtx = canvas.getContext('2d');
    idleCtx.clearRect(0, 0, canvas.width, canvas.height);
    return;
  }
  visualizerFrame = requestAnimationFrame(drawVisualizer);
  var ctx = canvas.getContext('2d');
  // Only resize the canvas when its layout size actually changed (resizing clears it
  // and forces layout); reuse one data array instead of allocating per frame
  var width = canvas.offsetWidth;
  var height = canvas.offsetHeight;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;

  var bufferLength = analyserNode.frequencyBinCount;
  if (!visualizerDataArray || visualizerDataArray.length !== bufferLength) visualizerDataArray = new Uint8Array(bufferLength);
  var dataArray = visualizerDataArray;
  analyserNode.getByteFrequencyData(dataArray);

  ctx.clearRect(0, 0, width, height);

  var barWidth = (width / bufferLength) * 2.5;
  var barHeight;
  var x = 0;

  var accentRaw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#F5F5F5';
  for (var i = 0; i < bufferLength; i++) {
    barHeight = (dataArray[i] / 255) * height * 1.5;
    ctx.globalAlpha = 0.3 + (dataArray[i] / 255) * 0.7;
    ctx.fillStyle = accentRaw;
    ctx.fillRect(x, height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }
  ctx.globalAlpha = 1;
}

const EQ_PRESETS = {
  'Flat': [0, 0, 0, 0, 0],
  'Bass Boost': [8, 5, 0, -2, -3],
  'Treble Boost': [-2, 0, 2, 5, 7],
  'Rock': [4, 2, -1, 2, 4],
  'Pop': [-1, 3, 5, 2, -1],
  'Jazz': [3, 2, 0, 2, 4],
  'Classical': [4, 2, -1, 2, 4],
  'Electronic': [4, 3, 0, 3, 5],
  'Vocal': [-2, 0, 4, 3, 1],
  'Dance': [5, 3, 0, 2, 4],
};
var activeEqPreset = 'Flat';

function applyEqPreset(name) {
  var gains = EQ_PRESETS[name] || [0, 0, 0, 0, 0];
  if (!appSettings.eqGains) appSettings.eqGains = [0, 0, 0, 0, 0];
  gains.forEach(function (g, i) {
    appSettings.eqGains[i] = g;
    if (eqBands[i]) eqBands[i].gain.value = g;
  });
  activeEqPreset = name;
  saveSettingsDebounced();
  buildEqUi();
}

function buildEqUi() {
  var presetContainer = $('eq-presets');
  if (presetContainer) {
    presetContainer.innerHTML = '';
    Object.keys(EQ_PRESETS).forEach(function (name) {
      var btn = document.createElement('button');
      btn.className = 'eq-preset-btn' + (name === activeEqPreset ? ' active' : '');
      btn.textContent = name;
      btn.addEventListener('click', function () { applyEqPreset(name); });
      presetContainer.appendChild(btn);
    });
  }
  var c = $('eq-sliders'); if (!c) return;
  c.innerHTML = '';
  var eqFreqs = [60, 230, 910, 3600, 14000];
  var eqLabels = ['60', '230', '910', '3.6k', '14k'];
  eqFreqs.forEach((freq, i) => {
    var col = document.createElement('div');
    col.style.display = 'flex'; col.style.flexDirection = 'column'; col.style.alignItems = 'center';
    var valDiv = document.createElement('div');
    valDiv.style.fontSize = '10px'; valDiv.style.color = 'var(--text-subdued)';
    var currentVal = appSettings.eqGains ? (appSettings.eqGains[i] || 0) : 0;
    valDiv.textContent = (currentVal > 0 ? '+' : '') + currentVal + ' dB';
    var inp = document.createElement('input');
    inp.type = 'range'; inp.min = '-12'; inp.max = '12'; inp.value = currentVal;
    inp.style.writingMode = 'vertical-lr'; inp.style.direction = 'rtl'; inp.style.height = '100px'; inp.style.margin = '12px 0';
    inp.oninput = function () {
      var v = parseFloat(this.value);
      valDiv.textContent = (v > 0 ? '+' : '') + v + ' dB';
      if (eqBands[i]) eqBands[i].gain.value = v;
      if (!appSettings.eqGains) appSettings.eqGains = [0, 0, 0, 0, 0];
      appSettings.eqGains[i] = v;
      activeEqPreset = 'Custom';
      // Mark all presets as inactive
      document.querySelectorAll('.eq-preset-btn').forEach(function (b) { b.classList.remove('active'); });
      saveSettingsDebounced();
    };
    var lbl = document.createElement('div');
    lbl.style.fontSize = '10px'; lbl.style.fontWeight = 'bold';
    lbl.textContent = eqLabels[i];
    col.appendChild(valDiv); col.appendChild(inp); col.appendChild(lbl);
    c.appendChild(col);
  });
}

var btnEq = null; 
var btnCloseEq = null; 
var btnResetEq = null; 


/* ─── LYRICS ENGINE ─── */

function parseLrc(lrcText) {
  var lines = lrcText.split('\n');
  var result = [];
  lines.forEach(function (line) {
    var match = line.match(/^\[(\d+):(\d+\.?\d*)\](.*)$/);
    if (match) {
      var secs = parseInt(match[1], 10) * 60 + parseFloat(match[2]);
      var text = match[3].trim();
      if (text) result.push({ time: secs, text: text });
    }
  });
  result.sort(function (a, b) { return a.time - b.time; });
  return result;
}

function renderLyricsPanel() {
  var lc = $('lyrics-content'); if (!lc) return;
  lyricsActiveIdx = -2;
  if (!lyricsData || lyricsData.length === 0) {
    lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-microphone-stage" style="font-size:48px;color:var(--text-disabled);margin-bottom:12px;"></i><p style="color:var(--text-subdued);font-size:13px;">Lyrics Not Found</p></div>';
    return;
  }
  lc.innerHTML = '';
  lyricsData.forEach(function (line, i) {
    var div = document.createElement('div');
    div.className = 'lyric-line';
    div.dataset.idx = i;
    div.textContent = line.text;
    div.addEventListener('click', function () { setActiveAudioPosition(line.time, true); });
    lc.appendChild(div);
  });
}

function getLyricsOffsetKey(track) {
  if (!track) return '';
  return ((track.matchedFile && track.matchedFile.filePath) || '') || ((track.artist || '') + '::' + (track.title || ''));
}

function setLyricsOffset(nextValue) {
  lyricsOffsetSec = Math.max(-10, Math.min(10, Math.round(nextValue * 10) / 10));
  if (!appSettings.lyricsOffsets) appSettings.lyricsOffsets = {};
  var key = getLyricsOffsetKey(state.currentPlayingTrack);
  if (key) appSettings.lyricsOffsets[key] = lyricsOffsetSec;
  updateLyricsOffsetUi();
  saveSettingsDebounced();
}

function loadLyricsOffsetForTrack(track) {
  var key = getLyricsOffsetKey(track);
  lyricsOffsetSec = key && appSettings.lyricsOffsets && typeof appSettings.lyricsOffsets[key] === 'number' ? appSettings.lyricsOffsets[key] : 0;
  updateLyricsOffsetUi();
}

function updateLyricsOffsetUi() {
  var label = (lyricsOffsetSec > 0 ? '+' : '') + lyricsOffsetSec.toFixed(1) + 's';
  var a = $('lyrics-offset-val'); if (a) a.textContent = label;
  var b = $('np-lyrics-offset-val'); if (b) b.textContent = label;
}

function updateLyricsHighlight(currentTime) {
  if (!lyricsOpen) return;
  currentTime += lyricsOffsetSec;
  var plainBar = $('plain-lyrics-progress-bar');
  if (plainBar && audioEls) {
    var plainAudio = audioEls[activeAudioIdx];
    if (plainAudio && !isNaN(plainAudio.duration) && plainAudio.duration > 0) {
      plainBar.style.width = ((plainAudio.currentTime / plainAudio.duration) * 100) + '%';
      var plainContent = $('lyrics-content');
      if (plainContent && plainContent.scrollHeight > plainContent.clientHeight) {
        plainContent.scrollTop = (plainContent.scrollHeight - plainContent.clientHeight) * (plainAudio.currentTime / plainAudio.duration);
      }
    }
  }
  if (!lyricsData.length) return;
  var activeIdx = -1;
  for (var i = 0; i < lyricsData.length; i++) {
    if (lyricsData[i].time <= currentTime) activeIdx = i;
    else break;
  }
  if (activeIdx === lyricsActiveIdx) return;
  lyricsActiveIdx = activeIdx;
  var lc = $('lyrics-content'); if (!lc) return;
  var lines = lc.querySelectorAll('.lyric-line');
  lines.forEach(function (el, i) {
    el.classList.remove('active', 'passed');
    if (i < activeIdx) el.classList.add('passed');
    else if (i === activeIdx) el.classList.add('active');
  });
  var now = Date.now();
  if (activeIdx >= 0 && lines[activeIdx] && now - lyricsLastScrollAt > 700) {
    lyricsLastScrollAt = now;
    if (lc) {
      lc.scrollTo({ top: lines[activeIdx].offsetTop - (lc.clientHeight / 2) + (lines[activeIdx].clientHeight / 2), behavior: 'auto' });
    }
  }

}

function normalizeLyricsMatchText(value) { return String(value || '').normalize('NFKC').toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }
function isTrustedLyricsMatch(track, data) {
  if (!track || !data) return false;
  var artist = normalizeLyricsMatchText(track.artist), title = normalizeLyricsMatchText(track.title);
  var resultArtist = normalizeLyricsMatchText(data.artistName || data.artist_name), resultTitle = normalizeLyricsMatchText(data.trackName || data.track_name || data.name);
  if (!artist || !title || artist !== resultArtist || title !== resultTitle) return false;
  if (track.album && (data.albumName || data.album_name) && normalizeLyricsMatchText(track.album) !== normalizeLyricsMatchText(data.albumName || data.album_name)) return false;
  var expected = Number(track.duration) || 0, actual = Number(data.duration) || 0;
  return !(expected && actual && Math.abs(expected - actual) > Math.max(12, expected * .12));
}

function getLyricsRequestKey(track) {
  return [track && track.artist, track && track.title, track && track.album, Math.round(Number(track && track.duration) || 0)]
    .map(normalizeLyricsMatchText).join('::');
}
function getCachedLyrics(key) {
  return lyricsCache && typeof lyricsCache.get === 'function' ? lyricsCache.get(key) : null;
}
function cacheLyrics(key, data) {
  if (lyricsCache && typeof lyricsCache.set === 'function') lyricsCache.set(key, data);
}
function renderPlainLyrics(text) {
  lyricsData = [];
  plainLyricsText = text;
  var lc = $('lyrics-content');
  if (lc) {
    lc.innerHTML = '';
    var plainProgressContainer = document.createElement('div');
    plainProgressContainer.id = 'plain-lyrics-progress-container';
    plainProgressContainer.style.cssText = 'width:80%;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin:0 auto 16px;overflow:hidden;';
    plainProgressContainer.innerHTML = '<div id="plain-lyrics-progress-bar" style="width:0%;height:100%;background:var(--accent);"></div>';
    lc.appendChild(plainProgressContainer);
    text.split('\n').forEach(function (line) {
      var div = document.createElement('div');
      div.style.cssText = 'padding:6px 14px;font-size:14px;color:var(--text-subdued);text-align:center;line-height:1.6;';
      div.textContent = line || '\u00a0';
      lc.appendChild(div);
    });
    var note = document.createElement('div');
    note.style.cssText = 'font-size:11px;color:var(--text-disabled);text-align:center;padding:16px;';
    note.textContent = 'Plain lyrics (no sync available)';
    lc.appendChild(note);
  }
}
function applyTrustedLyricsResult(track, data) {
  if (!isTrustedLyricsMatch(track, data)) return false;
  if (data && data.syncedLyrics) {
    lyricsData = parseLrc(data.syncedLyrics);
    plainLyricsText = '';
    renderLyricsPanel();
    if (npOverlayOpen) mirrorLyricsToNP();
    return true;
  }
  if (data && data.plainLyrics) {
    renderPlainLyrics(data.plainLyrics);
    if (npOverlayOpen) mirrorLyricsToNP();
    return true;
  }
  return false;
}

async function fetchLyricsForTrack(track) {
  if (!track) return;
  loadLyricsOffsetForTrack(track);
  var key = getLyricsRequestKey(track);
  if (key === lyricsCurrentTrackKey) return;

  // Reset state and clear UI immediately
  lyricsCurrentTrackKey = key;
  lyricsData = [];
  plainLyricsText = '';
  lyricsActiveIdx = -2;
  npLyricsActiveIdx = -2;
  var lc = $('lyrics-content');
  if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-spinner ph-spin" style="font-size:36px;color:var(--text-subdued);"></i><p style="color:var(--text-subdued);font-size:12px;margin-top:12px;">Searching lyrics...</p></div>';
  if (npOverlayOpen) mirrorLyricsToNP(); // Clear NP overlay lyrics

  if (!(track.title || '').trim() || !(track.artist || '').trim()) {
    if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-warning" style="font-size:48px;color:var(--text-disabled);margin-bottom:12px;"></i><p style="color:var(--text-subdued);font-size:13px;">Track metadata is unavailable</p></div>';
    return;
  }

  var cached = getCachedLyrics(key);
  if (cached && applyTrustedLyricsResult(track, cached)) return;

  // Try LRCLIB API
  try {
    var duration = track.duration ? Math.round(track.duration) : 0;
    var apiUrl = 'https://lrclib.net/api/get?artist_name=' + encodeURIComponent(track.artist) + '&track_name=' + encodeURIComponent(track.title) + '&album_name=' + encodeURIComponent(track.album || '') + (duration ? '&duration=' + duration : '');
    var resp = await fetch(apiUrl);
    // Track may have changed while awaiting; never let a stale fetch overwrite newer lyrics
    if (lyricsCurrentTrackKey !== key) return;

    if (resp.ok) {
      var data = await resp.json();
      if (lyricsCurrentTrackKey !== key) return;
      if (applyTrustedLyricsResult(track, data)) {
        cacheLyrics(key, data);
        return;
      }
    }
  } catch (e) { console.log('LRCLIB fetch error:', e); }

  // Final fallback: No lyrics found
  if (lyricsCurrentTrackKey === key) {
    lyricsData = [];
    plainLyricsText = '';
    if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-microphone-stage" style="font-size:48px;color:var(--text-disabled);margin-bottom:12px;"></i><p style="color:var(--text-subdued);font-size:13px;">Lyrics Not Found</p><p style="color:var(--text-disabled);font-size:11px;margin-top:4px;">Right-click here to search manually</p></div>';
    if (npOverlayOpen) mirrorLyricsToNP();
  }
}

function setLyricsOpen(open) {
  lyricsOpen = !!open;
  if (lyricsOpen && isQueueOpen) setQueueOpen(false);
  var panel = $('lyrics-panel');
  var btn = $('btn-lyrics-toggle');
  setDisclosureState(panel, btn, lyricsOpen);
  if (btn) btn.style.color = lyricsOpen ? 'var(--accent)' : '';
  if (lyricsOpen && state.currentPlayingTrack) fetchLyricsForTrack(state.currentPlayingTrack);
}
function toggleLyrics() { setLyricsOpen(!lyricsOpen); }

function openManualLyricsSearch(e) {
  if (e) e.preventDefault();
  if (e) e.stopPropagation();
  if (!state.currentPlayingTrack) return;
  var currentArtist = state.currentPlayingTrack.artist || '';
  var currentTitle = state.currentPlayingTrack.title || '';
  var artistInput = $('manual-lyrics-artist');
  var titleInput = $('manual-lyrics-title');
  if (artistInput) artistInput.value = currentArtist;
  if (titleInput) titleInput.value = currentTitle;
  showModal($('manual-lyrics-modal'));
  setTimeout(function () { if (titleInput) titleInput.focus(); }, 50);
}
function runManualLyricsSearch() {
  if (!state.currentPlayingTrack) return;
  var manualArtist = (($('manual-lyrics-artist') && $('manual-lyrics-artist').value) || state.currentPlayingTrack.artist || '').trim();
  var manualTitle = (($('manual-lyrics-title') && $('manual-lyrics-title').value) || state.currentPlayingTrack.title || '').trim();
  if (!manualTitle) return;
  var tempTrack = Object.assign({}, state.currentPlayingTrack);
  tempTrack.artist = manualArtist;
  tempTrack.title = manualTitle;
  lyricsCurrentTrackKey = '';
  hideModal($('manual-lyrics-modal'));
  fetchLyricsForTrack(tempTrack).then(function () { if (npOverlayOpen) mirrorLyricsToNP(); });
}
var lcElement = null;

var manualLyricsCancel = null;

var manualLyricsSearch = null;


var manualLyricsModal = null;


var btnLyricsToggle = null;

var btnLyricsOffsetDown = null;

var btnLyricsOffsetUp = null;

var btnCloseLyrics = null;

var btnLyricsFile = null;


/* --- NOW PLAYING OVERLAY --- */
var npOverlayOpen = false;
var npSecondaryPanel = 'lyrics';
function isFullscreenQueueOpen() { return npOverlayOpen && npSecondaryPanel === 'queue'; }
function setNPSecondaryPanel(panel) {
  npSecondaryPanel = panel === 'queue' ? 'queue' : 'lyrics';
  var queue = $('np-queue-content'); var lyrics = $('np-lyrics-content'); var lyricsHeader = document.querySelector('.np-lyrics-header');
  if (queue) queue.hidden = npSecondaryPanel !== 'queue';
  if (lyrics) lyrics.hidden = npSecondaryPanel !== 'lyrics';
  if (lyricsHeader) lyricsHeader.hidden = npSecondaryPanel !== 'lyrics';
  [['np-queue-tab', 'queue'], ['np-lyrics-tab', 'lyrics']].forEach(function (entry) { var tab = $(entry[0]); if (tab) { var active = npSecondaryPanel === entry[1]; tab.classList.toggle('active', active); tab.setAttribute('aria-selected', active ? 'true' : 'false'); } });
  var queueToggle = $('np-queue-toggle'); if (queueToggle) { var activeQueue = npSecondaryPanel === 'queue'; queueToggle.setAttribute('aria-label', activeQueue ? 'Show lyrics' : 'Show queue'); queueToggle.setAttribute('aria-expanded', activeQueue ? 'true' : 'false'); queueToggle.style.color = activeQueue ? 'var(--accent)' : 'rgba(255,255,255,0.6)'; }
  if (npSecondaryPanel === 'queue') renderFullscreenQueue();
}
function applyNPLyricsVisibility() {
  var btn = document.getElementById('np-lyrics-toggle');
  var region = document.getElementById('np-lyrics-col');
  if (region) { region.setAttribute('aria-hidden', 'false'); region.inert = false; }
  if (btn) {
    var activeLyrics = npSecondaryPanel === 'lyrics';
    btn.setAttribute('aria-label', activeLyrics ? 'Show queue' : 'Show lyrics');
    btn.setAttribute('aria-expanded', activeLyrics ? 'true' : 'false');
    btn.style.color = activeLyrics ? 'var(--accent)' : 'rgba(255,255,255,0.6)';
  }
}
function openNowPlayingOverlay() {
  npOverlayOpen = true;
  var ov = document.getElementById('now-playing-overlay');
  if (ov) { ov.classList.add('open'); ov.setAttribute('aria-hidden', 'false'); ov.inert = false; }
  applyNPLyricsVisibility();
  setNPSecondaryPanel(npSecondaryPanel);
  var btn = document.getElementById('btn-now-playing-overlay');
  if (btn) { btn.style.color = 'var(--accent)'; btn.setAttribute('aria-expanded', 'true'); }
  setModalBackgroundInert(true);
  updateNowPlayingOverlay();
  requestAnimationFrame(function () { var closeButton = $('np-close-btn'); if (closeButton) closeButton.focus(); });
  if (state.currentPlayingTrack) loadNPSlideshowImagesForTrack(state.currentPlayingTrack, playbackGeneration);
  if (lyricsData && lyricsData.length) mirrorLyricsToNP();
  else if (state.currentPlayingTrack) {
    fetchLyricsForTrack(state.currentPlayingTrack);
  }
}
function closeNowPlayingOverlay() {
  npOverlayOpen = false;
  clearInterval(_npSlideshowTimer);
  _npSlideshowTimer = null;
  var ov = document.getElementById('now-playing-overlay');
  if (ov) { ov.classList.remove('open'); ov.setAttribute('aria-hidden', 'true'); ov.inert = true; }
  var btn = document.getElementById('btn-now-playing-overlay');
  if (btn) { btn.style.color = ''; btn.setAttribute('aria-expanded', 'false'); }
  if (!modalStack.length) setModalBackgroundInert(false);
  if (btn) btn.focus();
}
function toggleNowPlayingOverlay() {
  if (npOverlayOpen) closeNowPlayingOverlay(); else openNowPlayingOverlay();
}
function updateNowPlayingOverlay() {
  var track = state.currentPlayingTrack;
  var artEl = document.getElementById('np-art');
  var placeholder = document.getElementById('np-art-placeholder');
  var bgBlur = document.getElementById('np-bg-blur');
  var titleEl = document.getElementById('np-track-title');
  var artistEl = document.getElementById('np-track-artist');
  var albumEl = document.getElementById('np-track-album');
  var playIcon = document.getElementById('np-play-icon');
  var artWrap = document.getElementById('np-art-wrap');
  if (track) {
    var pic = getTrackArtworkUrl(track);
    if (artEl) { if (pic) artEl.src = pic; else artEl.removeAttribute('src'); artEl.alt = pic ? ('Cover for ' + (track.album || track.title || 'current track')) : ''; artEl.style.display = pic ? 'block' : 'none'; }
    if (placeholder) placeholder.style.display = pic ? 'none' : 'flex';
    if (bgBlur) bgBlur.style.backgroundImage = pic ? 'url("' + pic.replace(/"/g, '\\"') + '")' : '';
    if (titleEl) titleEl.textContent = track.title || '';
    if (artistEl) artistEl.textContent = track.artist || '';
    if (albumEl) albumEl.textContent = track.album || '';
    if (titleEl) titleEl.disabled = !resolvePlaybackTrackAlbum(track);
    if (artistEl) artistEl.disabled = !isSearchablePlaybackArtist(track.artist);
    if (artWrap) artWrap.tabIndex = pic ? 0 : -1;
  } else {
    if (artEl) { artEl.removeAttribute('src'); artEl.alt = ''; artEl.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'flex';
    if (bgBlur) bgBlur.style.backgroundImage = '';
    if (titleEl) titleEl.textContent = 'No track';
    if (artistEl) artistEl.textContent = String.fromCharCode(8212);
    if (albumEl) albumEl.textContent = '';
    if (titleEl) titleEl.disabled = true;
    if (artistEl) artistEl.disabled = true;
    if (artWrap) artWrap.tabIndex = -1;
  }
  if (playIcon) playIcon.className = state.isPlaying ? 'ph ph-pause-circle' : 'ph ph-play-circle';
  syncPlaybackFeedback();
  syncTransportControls();
}
function mirrorLyricsToNP() {
  var npLc = document.getElementById('np-lyrics-content');
  if (!npLc) return;
  npLyricsActiveIdx = -2;
  npLc.innerHTML = '';
  if (!lyricsData || !lyricsData.length) {
    if (plainLyricsText) {
      plainLyricsText.split('\n').forEach(function (line) {
        var plainLine = document.createElement('div');
        plainLine.className = 'plain-lyric-line';
        plainLine.textContent = line || '\u00a0';
        npLc.appendChild(plainLine);
      });
      return;
    }
    npLc.innerHTML = '<div style="padding:40px 0;text-align:center;color:rgba(255,255,255,0.25);font-size:13px;">No synced lyrics found<br><span style="font-size:11px;color:rgba(255,255,255,0.18);">Right-click to search manually</span></div>';
    return;
  }
  lyricsData.forEach(function (line) {
    var div = document.createElement('div');
    div.className = 'lyric-line';
    div.textContent = line.text;
    div.addEventListener('click', function () { setActiveAudioPosition(line.time, true); });
    npLc.appendChild(div);
  });
}
function updateNPLyricsHighlight(currentTime) {
  if (!npOverlayOpen) return;
  if (!lyricsData.length) {
    var plainNp = $('np-lyrics-content');
    var plainNpAudio = audioEls ? audioEls[activeAudioIdx] : null;
    if (plainLyricsText && plainNp && plainNpAudio && !isNaN(plainNpAudio.duration) && plainNpAudio.duration > 0 && plainNp.scrollHeight > plainNp.clientHeight) {
      plainNp.scrollTop = (plainNp.scrollHeight - plainNp.clientHeight) * (plainNpAudio.currentTime / plainNpAudio.duration);
    }
    return;
  }
  currentTime += lyricsOffsetSec;
  var activeIdx = -1;
  for (var i = 0; i < lyricsData.length; i++) {
    if (lyricsData[i].time <= currentTime) activeIdx = i;
    else break;
  }
  if (activeIdx === npLyricsActiveIdx) return;
  npLyricsActiveIdx = activeIdx;
  var npLc = document.getElementById('np-lyrics-content');
  if (!npLc) return;
  var lines = npLc.querySelectorAll('.lyric-line');
  lines.forEach(function (el, i) {
    el.classList.remove('active', 'passed');
    if (i < activeIdx) el.classList.add('passed');
    else if (i === activeIdx) { 
      el.classList.add('active'); 
      var now = Date.now();
      if (npLc && now - npLyricsLastScrollAt > 700) {
        npLyricsLastScrollAt = now;
        npLc.scrollTo({ top: el.offsetTop - (npLc.clientHeight / 2) + (el.clientHeight / 2), behavior: 'auto' });
      }
    }
  });
}
let _npBtnPlay = null;

let _npBtnPrev = null;

let _npBtnNext = null;

let _npBtnShuffle = null;

let _npBtnLoop = null;

let _npBtnLike = null;

let _npLyricsToggle = null;

let _npQueueToggle = null;

let _npQueueTab = null; 
let _npLyricsTab = null; 
let _npLyricsOffsetDown = null;

let _npLyricsOffsetUp = null;

let _npLyricsContent = null;

let _npOverlayEl = null;

let _npArtWrap = null;

let _npTrackTitle = null;

let _npTrackArtist = null;

let _btnNPOverlay = null;

let _npCloseBtn = null;

let _npPc = null;

/* ─── LAST.FM INTEGRATION ─── */
var btnLfmLogin = null;


var btnLfmBrowser = null;
var btnLfmConfirm = null;
var lastfmToken = null;




var btnLfmCancel = null; 
var lastfmApiLink = null;


function updateLastfmIcon() {
  var icon = $('lastfm-icon'); if (!icon) return;
  icon.style.color = appSettings.lastfmConnected ? 'var(--text-base)' : 'var(--text-subdued)';
}

// Add these with other context menu listeners
var actxPlayNext = null;


var actxAddQueue = null;


var actxDownloadAlbum = null;


var actxAnalyzeLoudness = null;


var actxEditMetadata = null;


var actxSplitDisc = null;


var ctxPlayNext = null;


var ctxAddQueue = null;


var ctxAnalyzeLoudness = null;


var ctxGoToAlbum = null;


var ctxOpenFolder = null;


var actxOpenFolder = null;


var actxRemoveLibrary = null;


var ctxRemoveMatch = null;


var ctxDownloadTrack = null;


var ctxAddPlaylistDownload = null;


function getTracksFromTrackContextForPlaylistAdd() {
  var selected = currentContextMenuTrack && selectedTrackKeys.has(getTrackSelectionKey(currentContextMenuTrack)) ? getSelectedCurrentTracks() : [];
  if (selected.length) return selected;
  return currentContextMenuTrack ? [currentContextMenuTrack] : [];
}

function getTracksFromAlbumContextForPlaylistAdd() {
  if (!currentContextMenuAlbum || !currentContextMenuAlbum.tracks) return [];
  return getSortedAlbumTracks(currentContextMenuAlbum).map(function (f) {
    return { title: f.title, artist: f.artist, album: f.album, filePath: f.filePath, matchedFile: f };
  });
}

function getAddablePlaylistsForCurrentView() {
  return state.playlists.filter(function (pl) { return pl.id !== state.currentView && !pl.isSpecial; }).sort(function (a, b) {
    var at = a.lastAddedAt ? Date.parse(a.lastAddedAt) : 0;
    var bt = b.lastAddedAt ? Date.parse(b.lastAddedAt) : 0;
    return bt - at || (a.name || '').localeCompare(b.name || '');
  });
}

function getPlaylistFlyoutCover(pl) {
  if (!pl) return null;
  if (pl.cover) return pl.cover;
  for (var i = 0; i < (pl.tracks || []).length; i++) {
    var r = pl.tracks[i];
    var m = findPlaylistRecordMatch(r);
    if (m && m.picture) return m.picture;
  }
  return null;
}

function makePlaylistFlyoutCoverHtml(pl) {
  var cover = getPlaylistFlyoutCover(pl);
  if (cover) return '<img class="playlist-flyout-cover" src="' + esc(cover) + '" alt="" />';
  var bg = getSafePlaylistColor(pl && pl.color, '#3a3a3a');
  return '<span class="playlist-flyout-cover placeholder" style="background:' + bg + ';"><i class="ph ph-music-notes"></i></span>';
}

function countPlaylistDuplicates(pl, tracksToAdd) {
  if (!pl || !pl.tracks || !tracksToAdd || !tracksToAdd.length) return 0;
  return tracksToAdd.filter(function (trackToAdd) {
    return pl.tracks.some(function (t) { return samePlaylistTrack(t, trackToAdd); });
  }).length;
}

function readDroppedTrack(dataTransfer) {
  if (!dataTransfer) return null;
  try {
    var raw = dataTransfer.getData('text/plain');
    if (!raw || raw.length > 20000) return null;
    var value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 2000) return null;
    for (var field of ['artist', 'album', 'filePath']) {
      if (value[field] !== undefined && (typeof value[field] !== 'string' || value[field].length > (field === 'filePath' ? 4096 : 2000))) return null;
    }
    return {
      title: value.title.trim(),
      artist: (value.artist || '').trim(),
      album: (value.album || '').trim(),
      filePath: value.filePath || '',
      sourcePlaylistId: getValidSourcePlaylistId(value.sourcePlaylistId)
    };
  } catch (error) {
    return null;
  }
}

function bindPlaylistTrackDropTarget(element, playlist) {
  if (!element || !playlist || playlist.isSpecial) return;
  element.addEventListener('dragover', function (event) {
    if (!event.dataTransfer || !Array.from(event.dataTransfer.types || []).includes('text/plain')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    element.classList.add('playlist-drop-target');
  });
  element.addEventListener('dragleave', function (event) {
    if (!element.contains(event.relatedTarget)) element.classList.remove('playlist-drop-target');
  });
  element.addEventListener('drop', async function (event) {
    event.preventDefault();
    event.stopPropagation();
    element.classList.remove('playlist-drop-target');
    var track = readDroppedTrack(event.dataTransfer);
    if (!track) { showToast('Could not read the dropped track. Drag it from a Playerinyo track list.'); return; }
    try {
      var addedCount = await addTracksToPlaylist(playlist, [track]);
      if (addedCount) showToast('Added "' + track.title + '" to "' + playlist.name + '".');
      else showToast('"' + track.title + '" is already in "' + playlist.name + '".');
    } catch (error) {
      showToast('Could not add "' + track.title + '" to "' + playlist.name + '". The playlist was restored.');
    }
  });
}

async function addTracksToPlaylist(pl, tracksToAdd) {
  tracksToAdd = (tracksToAdd || []).filter(Boolean);
  if (!pl || pl.isSpecial || !state.playlists.includes(pl) || !tracksToAdd.length) return 0;
  if (!pl.tracks) pl.tracks = [];
  var addedCount = 0;
  var addedRecords = [];
  var previousLastAddedAt = pl.lastAddedAt;
  var addedAtMs = Date.now();
  tracksToAdd.forEach(function (trackToAdd) {
    var dup = pl.tracks.some(function (t) { return samePlaylistTrack(t, trackToAdd); });
    if (!dup) {
      var record = stampPlaylistTrackAddedAt(makePlaylistTrackRecord(trackToAdd), addedAtMs);
      pl.tracks.push(record);
      addedRecords.push(record);
      addedCount++;
    }
  });
  if (addedCount > 0) {
    var mutationLastAddedAt = new Date().toISOString();
    pl.lastAddedAt = mutationLastAddedAt;
    try { await persistPlaylists(state.playlists); }
    catch (error) {
      pl.tracks = pl.tracks.filter(function (record) { return !addedRecords.includes(record); });
      if (pl.lastAddedAt === mutationLastAddedAt) {
        if (previousLastAddedAt === undefined) delete pl.lastAddedAt;
        else pl.lastAddedAt = previousLastAddedAt;
      }
      renderSidebarPlaylists();
      if (state.currentView === pl.id) renderPlaylist(pl.id);
      throw error;
    }
    renderSidebarPlaylists();
    if (state.currentView === pl.id) renderPlaylist(pl.id);
  }
  return addedCount;
}
function initSettingsControls() {
  commandPaletteModal = $('command-palette-modal');
  if (commandPaletteModal) commandPaletteModal.addEventListener('click', function (e) { if (e.target === commandPaletteModal) closeCommandPalette(); });
  commandPaletteInput = $('command-palette-input');
  if (commandPaletteInput) {
    var renderCommandPaletteDebounced = debounce(renderCommandPalette, 120);
    commandPaletteInput.addEventListener('input', function () { commandPaletteIndex = 0; renderCommandPaletteDebounced(); });
    commandPaletteInput.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); commandPaletteIndex = Math.min(commandPaletteItems.length - 1, commandPaletteIndex + 1); renderCommandPalette(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); commandPaletteIndex = Math.max(0, commandPaletteIndex - 1); renderCommandPalette(); }
      else if (e.key === 'Enter') { e.preventDefault(); runCommandPaletteItem(commandPaletteItems[commandPaletteIndex]); }
      else if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); }
    });
  }
  commandPaletteList = $('command-palette-list');
  if (commandPaletteList) commandPaletteList.addEventListener('click', function (e) {
    var row = e.target.closest('.command-palette-item');
    if (!row) return;
    runCommandPaletteItem(commandPaletteItems[parseInt(row.dataset.idx, 10)]);
  });
  document.addEventListener('keydown', function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      var palette = $('command-palette-modal');
      var paletteOpen = palette && palette.classList.contains('active');
      if (startupErrorRendered || (modalStack.length && !paletteOpen)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      if (paletteOpen) closeCommandPalette();
      else openCommandPalette();
    }
  });
  shortcutsHelpModal = $('shortcuts-help-modal');
  if (shortcutsHelpModal) shortcutsHelpModal.addEventListener('click', function (e) { if (e.target === shortcutsHelpModal) hideModal(shortcutsHelpModal); });
  shortcutsHelpCloseBtn = $('shortcuts-help-close');
  if (shortcutsHelpCloseBtn) shortcutsHelpCloseBtn.addEventListener('click', function () { hideModal($('shortcuts-help-modal')); });
  shortcutsHelpButton = $('btn-shortcuts-help');
  if (shortcutsHelpButton) shortcutsHelpButton.addEventListener('click', openShortcutsHelp);
  zoomIn = $('btn-zoom-in');
  if (zoomIn) zoomIn.addEventListener('click', function () { currentZoom = Math.min(currentZoom + 20, 300); applyZoom(); });
  zoomOut = $('btn-zoom-out');
  if (zoomOut) zoomOut.addEventListener('click', function () { currentZoom = Math.max(currentZoom - 20, 100); applyZoom(); });
  caW = $('content-area');
  if (caW) caW.addEventListener('wheel', function (e) { if (e.ctrlKey && state.currentView === 'library') { e.preventDefault(); if (e.deltaY < 0) $('btn-zoom-in').click(); else $('btn-zoom-out').click(); } }, { passive: false });
  if (caW) caW.addEventListener('scroll', function() {
    if (!appSettings.virtualScrolling) return;
    if (_scrollThrottle) return;
    _scrollThrottle = requestAnimationFrame(function() {
      _scrollThrottle = null;
      if (trackRenderState.virtualized && renderVirtualTracksWindow) {
        renderVirtualTracksWindow();
        return;
      }
      if (caW.scrollTop + caW.clientHeight >= caW.scrollHeight - 1200) {
        if (state.currentView === 'library' && renderLibraryChunk) {
          renderLibraryChunk();
        } else if (renderTracksChunk) {
          renderTracksChunk();
        }
      }
    });
  }, { passive: true });
  cbVirtualScrolling = $('setting-virtual-scrolling');
  if (cbVirtualScrolling) {
    cbVirtualScrolling.checked = !!appSettings.virtualScrolling;
    if (appSettings.virtualScrolling) document.body.classList.add('perf-mode');
    cbVirtualScrolling.addEventListener('change', function () {
      appSettings.virtualScrolling = this.checked;
      if (this.checked) document.body.classList.add('perf-mode');
      else document.body.classList.remove('perf-mode');
      persistInBackground(persistSettings(appSettings));
      if (state.currentView === 'library') renderLibrary();
      else if ($('tracks-table-container') && $('tracks-table-container').style.display !== 'none') renderTracksTable(!!trackRenderState.allowReorder);
    });
  }
  togglePlBtn = $('toggle-playlist-view-btn');
  if (togglePlBtn) togglePlBtn.style.display = 'none';
  btnFullscreenPl = $('btn-fullscreen-playlists');
  if (btnFullscreenPl) btnFullscreenPl.addEventListener('click', function () { switchView('home'); });
  winMinimize = $('window-minimize');
  if (winMinimize) winMinimize.addEventListener('click', function () { if (window.api.windowControl) window.api.windowControl('minimize'); });
  winMaximize = $('window-maximize');
  if (winMaximize) winMaximize.addEventListener('click', function () { if (window.api.windowControl) window.api.windowControl('toggle-maximize'); });
  winClose = $('window-close');
  if (winClose) winClose.addEventListener('click', function () {
    persistDownloadQueueStateNow();
    if (window.api.windowControl) window.api.windowControl('close');
  });
  btnDownloadQueue = $('btn-download-queue');
  if (btnDownloadQueue) {
    btnDownloadQueue.setAttribute('aria-expanded', 'false');
    btnDownloadQueue.setAttribute('aria-controls', 'download-queue-panel');
    btnDownloadQueue.addEventListener('click', function (e) { e.stopPropagation(); setDownloadQueuePanel(!downloadQueuePanelOpen); });
  }
  downloadSearchToggle = $('download-search-toggle');
  if (downloadSearchToggle) downloadSearchToggle.addEventListener('click', function () {
    var panel = $('download-search');
    setDirectDownloadSearchOpen(!panel || panel.hidden);
  });
  downloadAlbumStart = $('download-album-start');
  if (downloadAlbumStart) downloadAlbumStart.addEventListener('click', function () { openAlbumDownloadSearch(); });
  downloadSearchForm = $('download-search-form');
  if (downloadSearchForm) downloadSearchForm.addEventListener('submit', function (e) { e.preventDefault(); searchDirectDownload(); });
  btnDownloadQueueClose = $('download-queue-close');
  if (btnDownloadQueueClose) btnDownloadQueueClose.addEventListener('click', function () { setDownloadQueuePanel(false); });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !downloadQueuePanelOpen || modalStack.length) return;
    e.preventDefault();
    setDownloadQueuePanel(false);
  });
  btnDownloadQueueClear = $('download-queue-clear');
  if (btnDownloadQueueClear) btnDownloadQueueClear.addEventListener('click', function () {
    downloadQueue = downloadQueue.filter(function (job) { return job.status === 'queued' || job.status === 'checking' || job.status === 'running'; });
    if (!downloadQueue.some(function (job) { return job.id === downloadQueueReview.jobId; })) downloadQueueReview = { jobId: '', itemIndex: -1 };
    persistDownloadQueueStateNow();
    renderDownloadQueue();
  });
  window.addEventListener('resize', function () {
    if (downloadQueuePanelOpen) requestAnimationFrame(positionDownloadQueuePanel);
    var sortListbox = $('playlist-sort-listbox');
    if (sortListbox && !sortListbox.hidden) requestAnimationFrame(positionPlaylistSortListbox);
    var librarySortListbox = $('library-sort-listbox');
    if (librarySortListbox && !librarySortListbox.hidden) requestAnimationFrame(positionLibrarySortListbox);
  });
  if (window.api.onDownloadProgress) window.api.onDownloadProgress(updateDownloadQueueItemProgress);
  albumDownloadSearchBtn = $('album-download-search');
  if (albumDownloadSearchBtn) albumDownloadSearchBtn.addEventListener('click', searchAlbumDownloadMetadata);
  albumDownloadSearchInput = $('album-download-search-query');
  if (albumDownloadSearchInput) albumDownloadSearchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') searchAlbumDownloadMetadata(); });
  albumDownloadQueueBtn = $('album-download-queue');
  if (albumDownloadQueueBtn) albumDownloadQueueBtn.addEventListener('click', queueAlbumDownloadSelectedRelease);
  albumDownloadSelectMissingBtn = $('album-download-select-missing');
  if (albumDownloadSelectMissingBtn) albumDownloadSelectMissingBtn.addEventListener('click', function () { setAlbumDownloadMissingSelection(true); });
  albumDownloadDeselectAllBtn = $('album-download-deselect-all');
  if (albumDownloadDeselectAllBtn) albumDownloadDeselectAllBtn.addEventListener('click', function () { setAlbumDownloadMissingSelection(false); });
  albumDownloadCancel = $('album-download-cancel');
  if (albumDownloadCancel) albumDownloadCancel.addEventListener('click', closeAlbumDownloadModal);
  albumDownloadCancelX = $('album-download-cancel-x');
  if (albumDownloadCancelX) albumDownloadCancelX.addEventListener('click', closeAlbumDownloadModal);
  albumDownloadModal = $('album-download-modal');
  if (albumDownloadModal) albumDownloadModal.addEventListener('click', function (e) { if (e.target === albumDownloadModal) closeAlbumDownloadModal(); });
  btnSettings = $('btn-settings');
  if (btnSettings) btnSettings.addEventListener('click', openSettingsModal);
  btnCloseSettings = $('btn-close-settings');
  if (btnCloseSettings) btnCloseSettings.addEventListener('click', function () { hideModal($('settings-modal')); });
  btnCloseSettingsTop = $('btn-close-settings-top');
  if (btnCloseSettingsTop) btnCloseSettingsTop.addEventListener('click', function () { hideModal($('settings-modal')); });
  automaticBackupToggle = $('setting-automatic-backups');
  if (automaticBackupToggle) automaticBackupToggle.addEventListener('change', async function (e) {
    var previous = appSettings.automaticBackupsEnabled !== false;
    appSettings.automaticBackupsEnabled = e.target.checked;
    e.target.disabled = true;
    try {
      await persistSettings(appSettings);
      await refreshAutomaticBackupStatus();
    } catch (error) {
      appSettings.automaticBackupsEnabled = previous;
      e.target.checked = previous;
      showToast('Automatic backup setting could not be saved. Check disk space and permissions.');
    } finally {
      e.target.disabled = false;
    }
  });
  btnBackupNow = $('btn-backup-now');
  if (btnBackupNow) btnBackupNow.addEventListener('click', async function () {
    if (automaticBackupUiBusy) return;
    if (hasActiveDownloadQueueJobs()) { showToast('Wait for queued or active downloads to finish before backing up.'); return; }
    if (appStateCommitInProgress) { showToast('Wait for the current app-state restore to finish.'); return; }
    automaticBackupUiBusy = true;
    btnBackupNow.disabled = true;
    btnBackupNow.setAttribute('aria-busy', 'true');
    var old = btnBackupNow.innerHTML;
    btnBackupNow.innerHTML = '<i class="ph ph-spinner ph-spin" aria-hidden="true"></i> Backing Up…';
    renderAutomaticBackupStatus(automaticBackupUiStatus);
    try {
      await flushSettingsSave();
      var result = await window.api.runAutomaticBackup();
      if (result && result.status) renderAutomaticBackupStatus(result.status);
      else await refreshAutomaticBackupStatus();
      if (result && result.ok) showToast(result.warning ? 'Backup created, but cleanup needs attention. See Backup & Restore status.' : 'Local backup created.');
      else if (result && result.deferred) showToast('Backup deferred: ' + (result.error || 'another operation is active') + '.');
      else showToast('Backup failed: ' + ((result && result.error) || 'unknown error'));
    } catch (e) {
      showToast('Backup failed: ' + backupIpcErrorMessage(e));
      await refreshAutomaticBackupStatus();
    } finally {
      automaticBackupUiBusy = false;
      btnBackupNow.removeAttribute('aria-busy');
      btnBackupNow.innerHTML = old;
      renderAutomaticBackupStatus(automaticBackupUiStatus);
    }
  });
  btnOpenBackupFolder = $('btn-open-backup-folder');
  if (btnOpenBackupFolder) btnOpenBackupFolder.addEventListener('click', async function () {
    btnOpenBackupFolder.disabled = true;
    try {
      var result = await window.api.openBackupFolder();
      if (!result || !result.ok) showToast('Could not open the backup folder: ' + ((result && result.error) || 'unknown error'));
    } catch (e) {
      showToast('Could not open the backup folder: ' + backupIpcErrorMessage(e));
    } finally {
      btnOpenBackupFolder.disabled = false;
    }
  });
  btnExportBackup = $('btn-export-backup');
  if (btnExportBackup) btnExportBackup.addEventListener('click', async function () {
    btnExportBackup.disabled = true;
    var old = btnExportBackup.innerHTML;
    btnExportBackup.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Exporting...';
    try {
      await persistSettings(appSettings);
      var res = await window.api.exportBackup({ likedSongs: state.likedSongs });
      if (res && res.ok) notifyUser('Backup exported.\n\nLibrary tracks: ' + ((res.summary && res.summary.library) || 0) + '\nPlaylists: ' + ((res.summary && res.summary.playlists) || 0) + '\n\nLast.fm API/session secrets are not included for safety.');
      else if (res && !res.canceled) notifyUser('Backup export failed: ' + (res.error || 'unknown error'));
    } catch (e) {
      notifyUser('Backup export failed: ' + backupIpcErrorMessage(e));
    } finally {
      btnExportBackup.disabled = false;
      btnExportBackup.innerHTML = old;
    }
  });
  btnImportBackup = $('btn-import-backup');
  homeImportBackupBtn = $('home-import-backup-btn');
  [btnImportBackup, homeImportBackupBtn].forEach(function (btn) { if (btn) btn.addEventListener('click', runBackupImport); });
  settMin = $('setting-minimize');
  if (settMin) settMin.addEventListener('change', async function (e) { appSettings.minimizeToTray = e.target.checked; await persistSettings(appSettings); });
  settAudio = $('setting-audio-mode');
  if (settAudio) settAudio.addEventListener('change', async function (e) { appSettings.audioMode = e.target.value; await persistSettings(appSettings); applyAudioMode(); });
  settDiscogsToken = $('setting-discogs-token');
  if (settDiscogsToken) settDiscogsToken.addEventListener('change', async function (e) {
    await persistSensitiveSetting('discogsToken', e.target.value.trim());
  });
  btnDownloadFolder = $('btn-download-folder');
  if (btnDownloadFolder) btnDownloadFolder.addEventListener('click', async function () {
    var folder = await window.api.openFolder();
    if (!folder) return;
    appSettings.ytdlDownloadFolder = folder;
    await persistSettings(appSettings);
    refreshDownloadFolderUi();
  });
  settingDownloadQuality = $('setting-download-quality');
  if (settingDownloadQuality) settingDownloadQuality.addEventListener('change', async function (e) {
    appSettings.ytdlDownloadQuality = ['best-native', 'opus', 'm4a', 'mp3'].includes(e.target.value) ? e.target.value : 'best-native';
    await persistSettings(appSettings);
  });
  settingYtdlCookiesMode = $('setting-ytdl-cookies-mode');
  if (settingYtdlCookiesMode) settingYtdlCookiesMode.addEventListener('change', async function (e) {
    appSettings.ytdlCookiesMode = e.target.value || 'none';
    await persistSettings(appSettings);
    refreshDownloadFolderUi();
  });
  settingYtdlCookiesBrowser = $('setting-ytdl-cookies-browser');
  if (settingYtdlCookiesBrowser) settingYtdlCookiesBrowser.addEventListener('change', async function (e) {
    appSettings.ytdlCookiesBrowser = e.target.value || 'firefox';
    await persistSettings(appSettings);
    refreshDownloadFolderUi();
  });
  btnYtdlCookiesFile = $('btn-ytdl-cookies-file');
  if (btnYtdlCookiesFile) btnYtdlCookiesFile.addEventListener('click', async function () {
    var file = window.api.openCookiesFile ? await window.api.openCookiesFile() : null;
    if (!file) return;
    appSettings.ytdlCookiesFile = file;
    appSettings.ytdlCookiesMode = 'file';
    await persistSettings(appSettings);
    refreshDownloadFolderUi();
  });
  btnCheckYtdlp = $('btn-check-ytdlp');
  if (btnCheckYtdlp) btnCheckYtdlp.addEventListener('click', function () { checkYtdlpTools($('ytdlp-status-text')); });
  btnCheckAppUpdate = $('btn-check-app-update');
  if (btnCheckAppUpdate) btnCheckAppUpdate.addEventListener('click', function () { checkForAppUpdate(true); });
  settDiscord = $('setting-discord-rpc');
  if (settDiscord) settDiscord.addEventListener('change', async function (e) {
    appSettings.discordRpc = e.target.checked;
    await persistSettings(appSettings);
    var statusEl = $('discord-status-text');
    if (e.target.checked) {
      if (statusEl) statusEl.textContent = 'Connecting...';
      setTimeout(async function () {
        var res = await window.api.discordStatus();
        if (statusEl) {
          if (res.enabled) statusEl.textContent = 'Connected';
          else statusEl.textContent = 'Could not connect: ' + (res.error || 'Discord not running');
        }
      }, 3000);
    } else {
      if (statusEl) statusEl.textContent = 'Disconnected';
    }
  });
  settCrossfade = $('setting-crossfade');
  if (settCrossfade) {
    settCrossfade.addEventListener('input', function (e) {
      appSettings.crossfade = e.target.value;
      var cv = $('crossfade-val'); if (cv) cv.textContent = e.target.value + 's';
      saveSettingsDebounced();
    });
  }
  settMasterGain = $('setting-master-gain');
  if (settMasterGain) {
    settMasterGain.addEventListener('input', function (e) {
      appSettings.masterGain = parseInt(e.target.value, 10);
      var mgv = $('master-gain-val'); if (mgv) mgv.textContent = e.target.value + '%';
      if (typeof audioGainNode !== 'undefined' && audioGainNode) {
        audioGainNode.gain.value = appSettings.masterGain / 100.0;
      }
      saveSettingsDebounced();
    });
  }
  queueToggle = $('btn-queue-toggle');
  if (queueToggle) queueToggle.addEventListener('click', toggleQueue);
  closeQueue = $('btn-close-queue');
  if (closeQueue) closeQueue.addEventListener('click', function () { setQueueOpen(false); });
  settNorm = $('setting-normalization');
  if (settNorm) settNorm.addEventListener('change', async function (e) {
    appSettings.normalization = e.target.checked;
    await persistSettings(appSettings);
    if (audioCtx) {
      updateAudioChain();
      if (crossfadeActive) cancelCrossfadeTransition(true);
      var activeGain = audioGainNodes ? audioGainNodes[activeAudioIdx] : null;
      if (activeGain) setPlaybackGain(activeGain, getNormalizationGain(state.currentPlayingTrack), 0.08);
    }
    updateReplayGainStatus(state.currentPlayingTrack);
  });
  settNotif = $('setting-notifications');
  if (settNotif) settNotif.addEventListener('change', async function (e) {
    appSettings.notifications = e.target.checked;
    await persistSettings(appSettings);
  });
  settNativeTitleBar = $('setting-native-titlebar');
  if (settNativeTitleBar) settNativeTitleBar.addEventListener('change', async function (e) {
    var nextValue = e.target.checked;
    var changed = !!appSettings.useNativeTitleBar !== nextValue;
    appSettings.useNativeTitleBar = nextValue;
    await persistSettings(appSettings);
    if (changed) notifyUser('Restart Playerinyo to apply the title bar change.');
  });
  settLL = $('setting-lazy-loading');
  if (settLL) settLL.addEventListener('change', async function (e) {
    appSettings.lazyLoading = e.target.checked;
    await persistSettings(appSettings);
  });
  settGlassEffects = $('setting-glass-effects');
  if (settGlassEffects) settGlassEffects.addEventListener('change', async function () {
    appSettings.glassEffects = this.checked;
    applyThemeSettings();
    await persistSettings(appSettings);
  });
  btnMultiSelect = $('btn-multi-select');
  if (btnMultiSelect) btnMultiSelect.addEventListener('click', function () {
    setMultiSelectMode(!isMultiSelectMode);
    if (!isMultiSelectMode) {
      selectedAlbumsForEdit.clear();
      updateMultiSelectControls();
    }
    renderLibrary();
  });
  btnMultiEdit = $('btn-multi-edit');
  if (btnMultiEdit) btnMultiEdit.addEventListener('click', function () {
    if (typeof selectedAlbumsForEdit === 'undefined' || selectedAlbumsForEdit.size === 0) return;
    var allTracks = getLibraryIndex().albums.filter(function (album) { return selectedAlbumsForEdit.has(album.id); }).flatMap(function (album) { return album.tracks; });
    if (allTracks.length > 0) openMetadataEditor(allTracks);
  });
  btnMultiMerge = $('btn-multi-merge');
  if (btnMultiMerge) btnMultiMerge.addEventListener('click', async function () {
    if (!selectedAlbumsForEdit || selectedAlbumsForEdit.size < 2) return;
    var allTracks = getLibraryIndex().albums.filter(function (album) { return selectedAlbumsForEdit.has(album.id); }).flatMap(function (album) { return album.tracks; });
    if (!allTracks.length) return;
    openMetadataEditor(allTracks);
    selectedAlbumsForEdit.clear();
    setMultiSelectMode(false);
    updateMultiSelectControls();
  });
  btnMultiRemove = $('btn-multi-remove');
  if (btnMultiRemove) btnMultiRemove.addEventListener('click', async function () {
    if (!selectedAlbumsForEdit || selectedAlbumsForEdit.size === 0) return;
    var albumCount = selectedAlbumsForEdit.size;
    var allTracks = getLibraryIndex().albums.filter(function (album) { return selectedAlbumsForEdit.has(album.id); }).flatMap(function (album) { return album.tracks; });
    if (!allTracks.length) return;
    if (!await requestConfirmation('Remove ' + albumCount + ' album' + (albumCount === 1 ? '' : 's') + ' / ' + allTracks.length + ' track' + (allTracks.length === 1 ? '' : 's') + ' from the library?\n\nAudio files and playlist entries will not be deleted. Playlist entries may appear missing until the files are imported again. An Undo action will remain available until dismissed.')) return;
    var removal = await removeLibraryFiles(allTracks, 'Remove selected albums from library');
    if (removal.failed) return;
    selectedAlbumsForEdit.clear();
    setMultiSelectMode(false);
    updateMultiSelectControls();
    switchView(state.musicFiles.length ? 'library' : 'home', false);
    showUndoToast('Removed ' + removal.count + ' track' + (removal.count === 1 ? '' : 's') + ' from the library. Audio files and playlists were not deleted.', removal.snapshot);
  });
  btnEq = $('btn-eq');
  if (btnEq) btnEq.addEventListener('click', function () { initAudioCtx(); buildEqUi(); showModal($('eq-modal')); });
  btnCloseEq = $('btn-close-eq');
  if (btnCloseEq) btnCloseEq.addEventListener('click', function () { hideModal($('eq-modal')); });
  btnResetEq = $('btn-reset-eq');
  if (btnResetEq) btnResetEq.addEventListener('click', function () { applyEqPreset('Flat'); });
  [$('settings-modal'), $('create-playlist-modal'), $('eq-modal')].forEach(function (m) { if (m) m.addEventListener('click', function (e) { if (e.target === m) hideModal(m); }); });
  lcElement = $('lyrics-content');
  if (lcElement) lcElement.addEventListener('contextmenu', openManualLyricsSearch);
  manualLyricsCancel = $('manual-lyrics-cancel');
  if (manualLyricsCancel) manualLyricsCancel.addEventListener('click', function () { hideModal($('manual-lyrics-modal')); });
  manualLyricsSearch = $('manual-lyrics-search');
  if (manualLyricsSearch) manualLyricsSearch.addEventListener('click', runManualLyricsSearch);
  ['manual-lyrics-artist', 'manual-lyrics-title'].forEach(function (id) {
    var input = $(id);
    if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') runManualLyricsSearch(); });
  });
  manualLyricsModal = $('manual-lyrics-modal');
  if (manualLyricsModal) manualLyricsModal.addEventListener('click', function (e) { if (e.target === manualLyricsModal) hideModal(manualLyricsModal); });
  btnLyricsToggle = $('btn-lyrics-toggle');
  if (btnLyricsToggle) btnLyricsToggle.addEventListener('click', toggleLyrics);
  btnLyricsOffsetDown = $('btn-lyrics-offset-down');
  if (btnLyricsOffsetDown) btnLyricsOffsetDown.addEventListener('click', function () { setLyricsOffset(lyricsOffsetSec - 0.5); });
  btnLyricsOffsetUp = $('btn-lyrics-offset-up');
  if (btnLyricsOffsetUp) btnLyricsOffsetUp.addEventListener('click', function () { setLyricsOffset(lyricsOffsetSec + 0.5); });
  btnCloseLyrics = $('btn-close-lyrics');
  if (btnCloseLyrics) btnCloseLyrics.addEventListener('click', function () { setLyricsOpen(false); });
  btnLyricsFile = $('btn-lyrics-load-file');
  if (btnLyricsFile) btnLyricsFile.addEventListener('click', async function () {
    var content = await window.api.openLrc();
    if (!content) return;
    lyricsData = parseLrc(content);
    plainLyricsText = '';
    lyricsCurrentTrackKey = 'custom';
    renderLyricsPanel();
  });
  _npBtnPlay = document.getElementById('np-btn-play');
  if (_npBtnPlay) _npBtnPlay.addEventListener('click', function () { initAudioCtx(); togglePlay(); updateNowPlayingOverlay(); });
  _npBtnPrev = document.getElementById('np-btn-prev');
  if (_npBtnPrev) _npBtnPrev.addEventListener('click', function () { initAudioCtx(); playPrevTrack(); });
  _npBtnNext = document.getElementById('np-btn-next');
  if (_npBtnNext) _npBtnNext.addEventListener('click', function () { initAudioCtx(); playNextTrack(); });
  _npBtnShuffle = document.getElementById('np-btn-shuffle');
  if (_npBtnShuffle) _npBtnShuffle.addEventListener('click', toggleShuffle);
  _npBtnLoop = document.getElementById('np-btn-loop');
  if (_npBtnLoop) _npBtnLoop.addEventListener('click', cycleLoop);
  _npBtnLike = document.getElementById('np-btn-like');
  if (_npBtnLike) _npBtnLike.addEventListener('click', toggleCurrentTrackLike);
  _npLyricsToggle = document.getElementById('np-lyrics-toggle');
  if (_npLyricsToggle) _npLyricsToggle.addEventListener('click', function () {
    setNPSecondaryPanel(npSecondaryPanel === 'lyrics' ? 'queue' : 'lyrics');
    applyNPLyricsVisibility();
    if (npSecondaryPanel === 'lyrics' && state.currentPlayingTrack && (!lyricsData || !lyricsData.length)) fetchLyricsForTrack(state.currentPlayingTrack);
  });
  _npQueueToggle = document.getElementById('np-queue-toggle');
  if (_npQueueToggle) _npQueueToggle.addEventListener('click', function () { setNPSecondaryPanel(npSecondaryPanel === 'queue' ? 'lyrics' : 'queue'); applyNPLyricsVisibility(); });
  _npQueueTab = $('np-queue-tab');
  if (_npQueueTab) _npQueueTab.addEventListener('click', function () { setNPSecondaryPanel('queue'); applyNPLyricsVisibility(); });
  _npLyricsTab = $('np-lyrics-tab');
  if (_npLyricsTab) _npLyricsTab.addEventListener('click', function () { setNPSecondaryPanel('lyrics'); applyNPLyricsVisibility(); });
  _npLyricsOffsetDown = document.getElementById('np-lyrics-offset-down');
  if (_npLyricsOffsetDown) _npLyricsOffsetDown.addEventListener('click', function () { setLyricsOffset(lyricsOffsetSec - 0.5); });
  _npLyricsOffsetUp = document.getElementById('np-lyrics-offset-up');
  if (_npLyricsOffsetUp) _npLyricsOffsetUp.addEventListener('click', function () { setLyricsOffset(lyricsOffsetSec + 0.5); });
  _npLyricsContent = document.getElementById('np-lyrics-content');
  if (_npLyricsContent) _npLyricsContent.addEventListener('contextmenu', openManualLyricsSearch);
  _npOverlayEl = document.getElementById('now-playing-overlay');
  if (_npOverlayEl) _npOverlayEl.addEventListener('contextmenu', function (e) {
    if (e.target.closest('#np-lyrics-content')) return;
    if (e.target.closest('button') || e.target.closest('#np-progress-container')) return;
    openManualLyricsSearch(e);
  });
  _npArtWrap = document.getElementById('np-art-wrap');
  if (_npArtWrap) {
    _npArtWrap.addEventListener('click', function () { var art = document.getElementById('np-art'); if (art && art.src) openCurrentPlaybackArtwork(art.currentSrc || art.src); });
    _npArtWrap.addEventListener('keydown', function (event) { if ((event.key === 'Enter' || event.key === ' ') && _npArtWrap.tabIndex >= 0) { event.preventDefault(); _npArtWrap.click(); } });
  }
  _npTrackTitle = document.getElementById('np-track-title');
  if (_npTrackTitle) _npTrackTitle.addEventListener('click', openPlaybackTrackAlbum);
  _npTrackArtist = document.getElementById('np-track-artist');
  if (_npTrackArtist) _npTrackArtist.addEventListener('click', searchPlaybackArtist);
  _btnNPOverlay = document.getElementById('btn-now-playing-overlay');
  if (_btnNPOverlay) _btnNPOverlay.addEventListener('click', toggleNowPlayingOverlay);
  _npCloseBtn = document.getElementById('np-close-btn');
  if (_npCloseBtn) _npCloseBtn.addEventListener('click', closeNowPlayingOverlay);
  _npPc = document.getElementById('np-progress-container');
  if (_npPc) {
    var _npDragging = false;
    var _npSeekAudio = null;
    _npPc.addEventListener('mousedown', function (e) {
      var a = audioEls ? audioEls[activeAudioIdx] : document.getElementById('audio-player-0');
      if (!state.currentPlayingTrack || isNaN(a.duration)) return;
      _npDragging = true; playbackSeekActive = true; _npSeekAudio = a; _npUpdateProg(e, a);
    });
    document.addEventListener('mousemove', function (e) { if (_npDragging && _npSeekAudio) _npUpdateProg(e, _npSeekAudio); });
    document.addEventListener('mouseup', function () {
      if (!_npDragging) return;
      _npDragging = false;
      playbackSeekActive = false;
      _npSeekAudio = null;
      checkpointPlaybackSession(getActiveAudioEl(), 200);
      syncMpris(true);
    });
    function _npUpdateProg(e, a) { var r = _npPc.getBoundingClientRect(); a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.duration; }
  }
  btnLfmLogin = $('btn-lastfm-login');
  if (btnLfmLogin) {
    btnLfmLogin.addEventListener('click', async function () {
      if (appSettings.lastfmConnected) {
        if (await requestConfirmation('You are connected as ' + appSettings.lastfmUsername + '. Disconnect?')) {
          appSettings.lastfmUsername = null;
          appSettings.lastfmConnected = false;
          persistInBackground(window.api.lastfmDisconnect());
          if (state.currentView === 'home') renderHomeDashboard();
          updateLastfmIcon();
        }
      } else {
        var inpKey = $('lastfm-api-key'); if (inpKey) inpKey.value = '';
        var inpSec = $('lastfm-shared-secret'); if (inpSec) inpSec.value = '';
        showModal($('lastfm-modal'));
      }
    });
  }
  btnLfmBrowser = $('btn-lastfm-open-browser');
  btnLfmConfirm = $('btn-lastfm-confirm');
  if (btnLfmBrowser) {
    btnLfmBrowser.addEventListener('click', async function () {
      var keyInput = $('lastfm-api-key');
      var secretInput = $('lastfm-shared-secret');
      var ak = (keyInput ? keyInput.value : '').trim();
      var ss = (secretInput ? secretInput.value : '').trim();
      if (!ak || !ss) { notifyUser('Enter your Last.fm API key and shared secret first.'); return; }
      btnLfmBrowser.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Please wait...';
      var res = await window.api.lastfmGetAuthUrl({ apiKey: ak, sharedSecret: ss });
      btnLfmBrowser.innerHTML = '1. Open Browser to Authorize';
      if (res && res.ok === true) {
        // Credentials have crossed the IPC boundary; do not retain them in the
        // renderer DOM while the user authorizes in the browser.
        if (keyInput) keyInput.value = '';
        if (secretInput) secretInput.value = '';
        lastfmToken = true;
        btnLfmConfirm.disabled = false; btnLfmConfirm.classList.remove('btn-outline'); btnLfmConfirm.classList.add('btn-primary');
        btnLfmConfirm.style.background = 'var(--accent)'; btnLfmConfirm.style.color = 'black';
      } else {
        notifyUser(res && res.error === 'secure-storage-unavailable'
          ? 'Last.fm credentials cannot be saved because secure OS storage is unavailable. Enable a Linux Secret Service/keyring, then restart Playerinyo. Credentials are not stored in plaintext.'
          : 'Failed to connect to Last.fm API. Check API keys or internet connection.');
      }
    });
  }
  if (btnLfmConfirm) {
    btnLfmConfirm.addEventListener('click', async function () {
      if (!lastfmToken) return;
      btnLfmConfirm.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Verifying...';
      var res = await window.api.lastfmGetSession();
      btnLfmConfirm.innerHTML = '2. I have authorized';
      if (res && res.name) {
        appSettings.lastfmUsername = res.name;
        appSettings.lastfmConnected = true;
        lastfmToken = null;
        var keyInput = $('lastfm-api-key'); if (keyInput) keyInput.value = '';
        var secretInput = $('lastfm-shared-secret'); if (secretInput) secretInput.value = '';
        hideModal($('lastfm-modal'));
        if (state.currentView === 'home') renderHomeDashboard();
        updateLastfmIcon();
      } else {
        notifyUser('Failed to verify authorization. Did you click "Allow Access" in the browser?');
      }
    });
  }
  btnLfmCancel = $('btn-lastfm-cancel');
  if (btnLfmCancel) btnLfmCancel.addEventListener('click', function () { lastfmToken = null; var keyInput = $('lastfm-api-key'); if (keyInput) keyInput.value = ''; var secretInput = $('lastfm-shared-secret'); if (secretInput) secretInput.value = ''; hideModal($('lastfm-modal')); });
  lastfmApiLink = $('lastfm-api-link');
  if (lastfmApiLink) lastfmApiLink.addEventListener('click', function () { window.api.openExternal('https://www.last.fm/api/account/create'); });
  actxPlayNext = $('actx-play-next');
  if (actxPlayNext) actxPlayNext.addEventListener('click', function () {
    if (currentContextMenuAlbum) {
      var mapped = getSortedAlbumTracks(currentContextMenuAlbum).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
      state.userQueue = mapped.concat(state.userQueue);
      syncSavedQueuePaths();
      saveSettingsDebounced(300);
      if (isQueueOpen) renderQueue();
    }
    hideAllContextMenus();
  });
  actxAddQueue = $('actx-add-queue');
  if (actxAddQueue) actxAddQueue.addEventListener('click', function () {
    if (currentContextMenuAlbum) {
      var mapped = getSortedAlbumTracks(currentContextMenuAlbum).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
      state.userQueue = state.userQueue.concat(mapped);
      syncSavedQueuePaths();
      saveSettingsDebounced(300);
      if (isQueueOpen) renderQueue();
    }
    hideAllContextMenus();
  });
  actxDownloadAlbum = $('actx-download-album');
  if (actxDownloadAlbum) actxDownloadAlbum.addEventListener('click', function () {
    var album = currentContextMenuAlbum;
    hideAllContextMenus();
    openAlbumDownloadModal(album);
  });
  actxAnalyzeLoudness = $('actx-analyze-loudness');
  if (actxAnalyzeLoudness) actxAnalyzeLoudness.addEventListener('click', function () {
    if (currentContextMenuAlbum) analyzeLoudnessForFiles(getSortedAlbumTracks(currentContextMenuAlbum));
  });
  actxEditMetadata = $('actx-edit-metadata');
  if (actxEditMetadata) actxEditMetadata.addEventListener('click', function () {
    if (currentContextMenuAlbum && currentContextMenuAlbum.tracks) openMetadataEditor(getSortedAlbumTracks(currentContextMenuAlbum), { scope: 'album' });
    hideAllContextMenus();
  });
  var actxEditNote = $('actx-edit-note');
  if (actxEditNote) actxEditNote.addEventListener('click', function () {
    if (currentContextMenuAlbum) openLibraryNoteEditor('album', currentContextMenuAlbum);
    hideAllContextMenus();
  });
  actxSplitDisc = $('actx-split-disc');
  if (actxSplitDisc) actxSplitDisc.addEventListener('click', async function () {
    var album = currentContextMenuAlbum;
    if (!album || !album.tracks || !album.tracks.length) return;
    if (!await requestConfirmation('Split this album into separate app-library albums by disc? This changes the app library metadata, not the audio files.')) return;
    album.tracks.forEach(function (f) {
      var disc = getDiscNumber(f);
      if (disc > 1 || albumHasMultipleDiscs(album.tracks)) f.album = (album.name || f.album || 'Unknown Album').replace(/\s\(Disc \d+\)$/i, '') + ' (Disc ' + disc + ')';
    });
    markLibraryDirty();
    await persistLibrary(state.musicFiles);
    renderLibrary();
  });
  ctxPlayNext = $('ctx-play-next');
  if (ctxPlayNext) ctxPlayNext.addEventListener('click', function () {
    if (currentContextMenuTrack) {
      state.userQueue.unshift(makeManualQueueEntry(currentContextMenuTrack));
      syncSavedQueuePaths();
      saveSettingsDebounced(300);
      if (isQueueOpen) renderQueue();
    }
    hideAllContextMenus();
  });
  ctxAddQueue = $('ctx-add-queue');
  if (ctxAddQueue) ctxAddQueue.addEventListener('click', function () {
    if (currentContextMenuTrack) {
      state.userQueue.push(makeManualQueueEntry(currentContextMenuTrack));
      syncSavedQueuePaths();
      saveSettingsDebounced(300);
      if (isQueueOpen) renderQueue();
    }
    hideAllContextMenus();
  });
  ctxAnalyzeLoudness = $('ctx-analyze-loudness');
  if (ctxAnalyzeLoudness) ctxAnalyzeLoudness.addEventListener('click', function () {
    if (currentContextMenuTrack && currentContextMenuTrack.matchedFile) analyzeLoudnessForFiles([currentContextMenuTrack.matchedFile]);
  });
  ctxGoToAlbum = $('ctx-go-to-album');
  if (ctxGoToAlbum) ctxGoToAlbum.addEventListener('click', function () {
    if (currentContextMenuTrack && currentContextMenuTrack.matchedFile) {
      var f = currentContextMenuTrack.matchedFile;
      if (f.album) {
        var albumId = getAlbumKey(f);
        pushNav('album:' + albumId);
        var album = getFullAlbumByKey(albumId);
        if (album) renderAlbumDetail(album);
        hideAllContextMenus();
      }
    }
  });
  ctxOpenFolder = $('ctx-open-folder');
  if (ctxOpenFolder) ctxOpenFolder.addEventListener('click', function () {
    if (currentContextMenuTrack && currentContextMenuTrack.matchedFile) {
      showFileLocation(currentContextMenuTrack.matchedFile.filePath);
    }
    hideAllContextMenus();
  });
  actxOpenFolder = $('actx-open-folder');
  if (actxOpenFolder) actxOpenFolder.addEventListener('click', function () {
    if (currentContextMenuAlbum && currentContextMenuAlbum.tracks && currentContextMenuAlbum.tracks.length > 0) {
      showFileLocation(currentContextMenuAlbum.tracks[0].filePath);
    }
    hideAllContextMenus();
  });
  actxRemoveLibrary = $('actx-remove-library');
  if (actxRemoveLibrary) actxRemoveLibrary.addEventListener('click', async function () {
    var album = currentContextMenuAlbum;
    if (!album || !album.tracks || !album.tracks.length) return;
    var count = album.tracks.length;
    if (!await requestConfirmation('Remove "' + (album.name || 'this album') + '" (' + count + ' track' + (count === 1 ? '' : 's') + ') from the library?\n\nAudio files and playlist entries will not be deleted. Playlist entries may appear missing until the album is imported again. An Undo action will remain available until dismissed.')) {
      hideAllContextMenus();
      return;
    }
    var removal = await removeLibraryFiles(album.tracks, 'Remove album from library');
    if (removal.failed) { hideAllContextMenus(); return; }
    currentContextMenuAlbum = null;
    selectedAlbumsForEdit.delete(album.id);
    hideAllContextMenus();
    if (!refreshSearchAfterLibraryMutation()) renderCurrentCollectionState();
    showUndoToast('Removed ' + count + ' track' + (count === 1 ? '' : 's') + ' from the library. Audio files and playlists were not deleted.', removal.snapshot);
  });
  ctxRemoveMatch = $('ctx-remove-match');
  if (ctxRemoveMatch) ctxRemoveMatch.addEventListener('click', async function () {
    if (currentContextMenuTrack) {
      var key = currentContextMenuTrack.title + '-' + currentContextMenuTrack.artist + '-' + (currentContextMenuTrack.album || '');
      state.mappings[key] = 'NO_MATCH';
      await persistMappings(state.mappings);
      if (currentContextMenuTrack.csvRecord) {
        delete currentContextMenuTrack.csvRecord.FilePath;
        delete currentContextMenuTrack.csvRecord.filePath;
        delete currentContextMenuTrack.csvRecord.Path;
        delete currentContextMenuTrack.csvRecord.path;
        await persistPlaylists(state.playlists);
      }
      showToast('Match removed for ' + (currentContextMenuTrack.title || 'track') + '.');
      if (state.currentView.startsWith('pl_')) renderPlaylistPreservingScroll(state.currentView);
    }
    hideAllContextMenus();
  });
  ctxDownloadTrack = $('ctx-download-track');
  if (ctxDownloadTrack) ctxDownloadTrack.addEventListener('click', function () {
    var pl = getCurrentRegularPlaylist();
    var rows = getDownloadablePlaylistTracksFromContext().map(function (track) { return track.csvRecord; });
    if (!rows.length && isRemotePlaybackTrack(currentContextMenuTrack)) rows = [makePlaylistTrackRecord(currentContextMenuTrack)];
    hideAllContextMenus();
    if (pl) showExistingPlaylistDownloadReview(pl, rows);
    else {
      var job = makeDownloadQueueJob('remote-track', 'Download: ' + (currentContextMenuTrack.title || 'Track'), rows, '');
      if (job) pushDownloadQueueJob(job, 'Queued remote track download.'); else showToast('Already in Library or already queued.');
    }
  });
  ctxAddPlaylistDownload = $('ctx-add-playlist-download');
  if (ctxAddPlaylistDownload) ctxAddPlaylistDownload.addEventListener('click', async function () {
    var track = currentContextMenuTrack;
    if (!isRemotePlaybackTrack(track)) return;
    var playlists = state.playlists.filter(function (pl) { return !pl.isSpecial; });
    if (!playlists.length) { showToast('Create a playlist first, then add and download this track.'); return; }
    var choices = playlists.map(function (pl, index) { return (index + 1) + '. ' + pl.name; }).join('\n');
    var answer = prompt('Add to which playlist?\n' + choices, '1');
    var index = Number(answer) - 1;
    if (!Number.isInteger(index) || !playlists[index]) return;
    var playlist = playlists[index];
    try { await addTracksToPlaylist(playlist, [track]); }
    catch (e) { showToast('Playlist could not be saved; download was not started.'); return; }
    var row = makePlaylistTrackRecord(track);
    var job = makeDownloadQueueJob('playlist-remote', 'Download: ' + (track.title || 'Track'), [row], playlist.id, { savePlaylists: true });
    hideAllContextMenus();
    if (job) pushDownloadQueueJob(job, 'Saved to "' + playlist.name + '" and queued download.');
    else showToast('Saved to "' + playlist.name + '". Already in Library or already queued.');
  });
}
