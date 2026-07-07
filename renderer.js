const PALETTE = ['#E50914', '#FF003D', '#1DB954', '#2196F3', '#A855F7', '#00BCD4', '#FF9800', '#FFFFFF'];
const DEFAULT_THEME_COLORS = {
  accent: '#E50914',
  bg: '#030305',
  panel: '#101116',
  glass: '#161821',
  border: '#2A2D38',
  text: '#F8F8FA',
  muted: '#A5A7B4',
  danger: '#FF3B5F'
};
let state = {
  musicFiles: [], playlists: [], mappings: {}, currentView: 'library', currentTracks: [],
  currentPlayingTrack: null, isPlaying: false, isShuffle: false, loopMode: 0,
  likedSongs: parseStoredArray('likedSongs'),
  shuffleQueue: [], playHistory: [], navHistory: [], navIndex: -1,
  activeAlbumName: null, userQueue: [], playQueueTracks: []
};
let appSettings = { minimizeToTray: false, audioMode: 'stereo', sidebarWidth: 560, accentColor: DEFAULT_THEME_COLORS.accent, themeColors: Object.assign({}, DEFAULT_THEME_COLORS), glassEffects: true, isPlaylistGridView: true, ytdlDownloadFolder: '', ytdlCookiesMode: 'none', ytdlCookiesBrowser: 'firefox', ytdlCookiesFile: '' };
let audioCtx, audioGainNode, audioCompressor;
let isPlaylistGridView = true;
let currentContextMenuTrack = null;
let currentContextMenuPlaylist = null;
let addToPlaylistTracks = [];
let currentZoom = 180;
let isQueueOpen = false;
let lyricsOpen = false;
let lyricsCurrentTrackKey = null;
let lyricsData = [];
let lyricsOffsetSec = 0;
let lyricsActiveIdx = -2;
let npLyricsActiveIdx = -2;
let lyricsLastScrollAt = 0;
let npLyricsLastScrollAt = 0;
let cpSelectedColor = PALETTE[0];
let cpSelectedCoverPath = null;
let playlistToDelete = null;
let pendingPlaylistImport = null;
let playlistImportSearching = false;
let playlistImportProgress = { active: false, label: '', current: 0, total: 0 };
let downloadQueue = [];
let downloadQueueProcessing = false;
let downloadQueuePanelOpen = false;
let downloadQueueReview = { jobId: '', itemIndex: -1 };
let downloadJobSeq = 0;
let albumDownloadContext = null;
let albumDownloadSelectedRelease = null;
let albumDownloadRequestSeq = 0;
let isMultiSelectMode = false;
let selectedAlbumsForEdit = new Set();
let libraryMissingFilePaths = new Set();
let undoStack = [];
let selectedTrackKeys = new Set();
let shortcutRegistrationFailures = [];
let nativeTitleBarActive = false;
let atTrackOrderMenuOpen = false;
let settingsSaveTimer = null;
let libraryRevision = 0;
let libraryIndexCache = null;

function $(id) { return document.getElementById(id); }
function parseStoredArray(key) { try { var value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch (e) { return []; } }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]; }); }
function showToast(message) {
  var old = $('app-toast');
  if (old) old.remove();
  var toast = document.createElement('div');
  toast.id = 'app-toast';
  toast.textContent = message;
  toast.style.cssText = 'position:fixed;right:24px;bottom:104px;z-index:10000;max-width:min(420px,calc(100vw - 48px));padding:11px 14px;border-radius:14px;background:rgba(18,18,22,.96);border:1px solid rgba(var(--accent-rgb),.35);box-shadow:0 18px 50px rgba(0,0,0,.45);color:var(--text-base);font-size:13px;line-height:1.35;opacity:0;transform:translateY(8px);transition:opacity .16s ease,transform .16s ease;';
  document.body.appendChild(toast);
  requestAnimationFrame(function () { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; });
  setTimeout(function () {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(8px)';
    setTimeout(function () { if (toast.parentNode) toast.remove(); }, 180);
  }, 3200);
}
function saveSettingsDebounced(delay) {
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = setTimeout(function () {
    settingsSaveTimer = null;
    window.api.saveSettings(appSettings);
  }, delay || 300);
}
function flushSettingsSave() {
  if (!settingsSaveTimer) return Promise.resolve(true);
  clearTimeout(settingsSaveTimer);
  settingsSaveTimer = null;
  return window.api.saveSettings(appSettings);
}
window.addEventListener('beforeunload', function () { flushSettingsSave(); });
function toFileUrl(filePath) {
  if (!filePath) return '';
  if (/^file:\/\//i.test(filePath)) return filePath;
  var normalized = String(filePath).replace(/\\/g, '/');
  if (normalized.startsWith('//')) {
    var uncParts = normalized.replace(/^\/\/+/, '').split('/');
    var host = uncParts.shift() || '';
    return 'file://' + host + '/' + uncParts.map(encodeURIComponent).join('/');
  }
  if (/^[A-Za-z]:\//.test(normalized)) normalized = '/' + normalized;
  if (!normalized.startsWith('/')) normalized = '/' + normalized;
  return 'file://' + normalized.split('/').map(function (segment, index) {
    if (index === 0) return '';
    if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment;
    return encodeURIComponent(segment);
  }).join('/');
}
function fromFileUrl(url) {
  if (!url) return null;
  if (!/^file:\/\//i.test(url)) return url;
  var parsed = new URL(url);
  var pathname = decodeURIComponent(parsed.pathname || '');
  if (parsed.hostname) return '\\\\' + parsed.hostname + pathname.replace(/\//g, '\\');
  return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1).replace(/\//g, '\\') : pathname;
}
function showFileLocation(filePath) {
  var fp = stripFileUrl(filePath || '');
  if (fp && window.api.showItemInFolder) window.api.showItemInFolder(fp);
}
var lastMprisPositionSyncAt = 0;
function getActiveAudioEl() {
  var list = window.audioEls || (typeof audioEls !== 'undefined' ? audioEls : null);
  return list && list.length ? list[activeAudioIdx || 0] : $('audio-player-0');
}
function getMprisLoopStatus() {
  if (state.loopMode === 2) return 'Track';
  if (state.loopMode === 1) return 'Playlist';
  return 'None';
}
function syncMpris(seeked) {
  if (!window.api.updateMpris) return;
  var track = state.currentPlayingTrack;
  if (!track) {
    window.api.updateMpris({ isPlaying: false, loopStatus: getMprisLoopStatus(), shuffle: !!state.isShuffle });
    return;
  }
  var audio = getActiveAudioEl();
  var matched = track.matchedFile || {};
  var duration = audio && !isNaN(audio.duration) && audio.duration > 0 ? audio.duration : (track.duration || matched.duration || 0);
  var position = audio && !isNaN(audio.currentTime) ? audio.currentTime : 0;
  var filePath = matched.filePath || track.filePath || '';
  window.api.updateMpris({
    title: track.title || matched.title || 'Unknown Track',
    artist: track.artist || matched.artist || 'Unknown Artist',
    album: track.album || matched.album || '',
    filePath: filePath,
    fileUrl: filePath ? toFileUrl(filePath) : '',
    artUrl: matched.picture || '',
    durationSeconds: duration,
    positionSeconds: position,
    isPlaying: !!state.isPlaying,
    shuffle: !!state.isShuffle,
    loopStatus: getMprisLoopStatus(),
    volume: audio && typeof audio.volume === 'number' ? audio.volume : (appSettings.volume || 1),
    seeked: !!seeked
  });
}
function syncMprisPositionThrottled() {
  var now = Date.now();
  if (now - lastMprisPositionSyncAt < 2000) return;
  lastMprisPositionSyncAt = now;
  syncMpris(false);
}
function setActiveAudioPosition(seconds, seeked) {
  var audio = getActiveAudioEl();
  if (!audio || isNaN(audio.duration)) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration, seconds));
  syncMpris(!!seeked);
}
function applyTitleBarMode() {
  document.body.classList.toggle('native-titlebar', nativeTitleBarActive);
}
function fmt(s) { if (!s || isNaN(s)) return '0:00'; return Math.floor(s / 60) + ':' + (Math.floor(s % 60) + '').padStart(2, '0'); }
function showModal(el) { if (el) el.classList.add('active'); }
function hideModal(el) { if (el) el.classList.remove('active'); }
function hideAllContextMenus() { document.querySelectorAll('.context-menu').forEach(function (m) { m.classList.remove('visible'); }); }
function openSettingsModal() {
  var modal = $('settings-modal');
  showModal(modal);
  var content = modal ? modal.querySelector('.modal-content') : null;
  if (content) content.scrollTop = 0;
  if (typeof renderShortcutsList === 'function') renderShortcutsList();
  if (typeof refreshSafeStorageStatus === 'function') refreshSafeStorageStatus();
  if (typeof refreshDownloadFolderUi === 'function') refreshDownloadFolderUi();
}
function pushUndoSnapshot(label) {
  try {
    undoStack.push({
      label: label || 'Last action',
      library: JSON.parse(JSON.stringify(state.musicFiles || [])),
      playlists: JSON.parse(JSON.stringify(state.playlists || [])),
      mappings: JSON.parse(JSON.stringify(state.mappings || {})),
      likedSongs: JSON.parse(JSON.stringify(state.likedSongs || [])),
      settings: JSON.parse(JSON.stringify(appSettings || {}))
    });
    if (undoStack.length > 10) undoStack.shift();
  } catch (e) { console.error('Failed to create undo snapshot:', e); }
}
async function undoLastAction() {
  var snap = undoStack.pop();
  if (!snap) { alert('Nothing to undo.'); return; }
  setMusicFiles(snap.library || []);
  state.playlists = snap.playlists || [];
  state.mappings = snap.mappings || {};
  state.likedSongs = snap.likedSongs || [];
  appSettings = Object.assign({}, appSettings, snap.settings || {});
  localStorage.setItem('likedSongs', JSON.stringify(state.likedSongs));
  await Promise.all([window.api.saveLibrary(state.musicFiles), window.api.savePlaylists(state.playlists), window.api.saveMappings(state.mappings), window.api.saveSettings(appSettings)]);
  applyThemeSettings();
  renderSidebarPlaylists();
  if (state.currentView === 'metadata_health') renderMetadataHealthView();
  else if (state.currentView === 'library') renderLibrary();
  else switchView('library', false);
  alert('Undone: ' + snap.label);
}
function positionContextMenu(menu, x, y) {
  if (!menu) return;
  menu.classList.add('visible');
  // force layout so offsetWidth/Height are correct
  menu.style.left = '0px'; menu.style.top = '0px';
  var mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = (x + mw > window.innerWidth ? x - mw : x) + 'px';
  menu.style.top = (y + mh > window.innerHeight ? y - mh : y) + 'px';
}
function positionSubmenu(menu, anchorEl) {
  if (!menu || !anchorEl) return;
  menu.classList.add('visible');
  menu.style.left = '0px'; menu.style.top = '0px';
  var r = anchorEl.getBoundingClientRect();
  var mw = menu.offsetWidth, mh = menu.offsetHeight;
  var gap = 6;
  var left = r.right + gap;
  if (left + mw > window.innerWidth - 8) left = r.left - mw - gap;
  var top = r.top - 6;
  if (top + mh > window.innerHeight - 8) top = window.innerHeight - mh - 8;
  menu.style.left = Math.max(8, left) + 'px';
  menu.style.top = Math.max(8, top) + 'px';
}
function initAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    var src0 = audioCtx.createMediaElementSource($('audio-player-0'));
    var src1 = audioCtx.createMediaElementSource($('audio-player-1'));
    audioGainNodes = [audioCtx.createGain(), audioCtx.createGain()];
    src0.connect(audioGainNodes[0]);
    src1.connect(audioGainNodes[1]);

    var merger = audioCtx.createGain();
    audioGainNodes[0].connect(merger);
    audioGainNodes[1].connect(merger);
    state.mediaElementSource = merger;

    // Normalization / Compressor
    audioCompressor = audioCtx.createDynamicsCompressor();
    // Default Spotify-like normalization settings
    audioCompressor.threshold.value = -24;
    audioCompressor.knee.value = 30;
    audioCompressor.ratio.value = 12;
    audioCompressor.attack.value = 0.003;
    audioCompressor.release.value = 0.25;

    audioGainNode = audioCtx.createGain();

    // Wire: source -> Compressor (if enabled) -> Equalizer -> gain -> destination
    if (typeof initEq === 'function') initEq();
    else {
      updateAudioChain();
    }
    applyAudioMode();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function updateAudioChain() {
  if (!audioCtx || !state.mediaElementSource) return;
  state.mediaElementSource.disconnect();
  if (audioCompressor) audioCompressor.disconnect();
  if (eqBands && eqBands.length) eqBands[eqBands.length - 1].disconnect();
  if (typeof analyserNode !== 'undefined' && analyserNode) analyserNode.disconnect();
  if (audioGainNode) audioGainNode.disconnect();

  let lastNode = state.mediaElementSource;

  if (appSettings.normalization && audioCompressor) {
    lastNode.connect(audioCompressor);
    lastNode = audioCompressor;
  }

  if (eqBands && eqBands.length) {
    lastNode.connect(eqBands[0]);
    // The EQ chain is already connected internally in initEq
    lastNode = eqBands[eqBands.length - 1];
    if (typeof analyserNode !== 'undefined' && analyserNode) {
      lastNode.connect(analyserNode);
      lastNode = analyserNode;
    }
  }

  lastNode.connect(audioGainNode);
  audioGainNode.gain.value = appSettings.masterGain !== undefined ? (appSettings.masterGain / 100.0) : 1.0;
  audioGainNode.connect(audioCtx.destination);
}
function applyAudioMode() {
  if (!audioGainNode) return;
  if (appSettings.audioMode === 'mono') { audioGainNode.channelCount = 1; audioGainNode.channelCountMode = 'explicit'; }
  else { audioGainNode.channelCount = 2; audioGainNode.channelCountMode = 'max'; }
}

// FIX 7: pushNav now works for all view types including library sub-views
function pushNav(viewId) {
  if (state.navHistory[state.navIndex] === viewId) return;
  state.navHistory = state.navHistory.slice(0, state.navIndex + 1);
  state.navHistory.push(viewId);
  if (state.navHistory.length > 20) state.navHistory.shift(); else state.navIndex++;
  updateNavBtns();
}
function updateNavBtns() {
  var back = $('btn-nav-back'), fwd = $('btn-nav-forward');
  if (back) back.disabled = state.navIndex <= 0;
  if (fwd) fwd.disabled = state.navIndex >= state.navHistory.length - 1;
}

function hexToRgb(hex) {
  var raw = String(hex || '').replace('#', '').trim();
  if (raw.length === 3) raw = raw.split('').map(function (ch) { return ch + ch; }).join('');
  var num = parseInt(raw, 16);
  if (isNaN(num)) return { r: 29, g: 185, b: 84 };
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
function rgbToHex(rgb) {
  return '#' + [rgb.r, rgb.g, rgb.b].map(function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); }).join('');
}
function colorToRgbString(hex) {
  var rgb = hexToRgb(hex);
  return rgb.r + ',' + rgb.g + ',' + rgb.b;
}
function darkenHex(hex, amount) {
  var rgb = hexToRgb(hex);
  return rgbToHex({ r: rgb.r * (1 - amount), g: rgb.g * (1 - amount), b: rgb.b * (1 - amount) });
}
function applyAccentColor(color) {
  var accent = color || DEFAULT_THEME_COLORS.accent;
  var rgb = hexToRgb(accent);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-hover', darkenHex(accent, 0.18));
  document.documentElement.style.setProperty('--accent-rgb', rgb.r + ',' + rgb.g + ',' + rgb.b);
}
function getThemeColors() {
  return Object.assign({}, DEFAULT_THEME_COLORS, appSettings.themeColors || {}, { accent: appSettings.accentColor || (appSettings.themeColors && appSettings.themeColors.accent) || DEFAULT_THEME_COLORS.accent });
}
function applyThemeSettings() {
  var colors = getThemeColors();
  appSettings.themeColors = Object.assign({}, colors);
  appSettings.accentColor = colors.accent;
  applyAccentColor(colors.accent);
  document.documentElement.style.setProperty('--bg-base', colors.bg);
  document.documentElement.style.setProperty('--bg-highlight', colors.panel);
  document.documentElement.style.setProperty('--bg-elevated', colors.glass);
  document.documentElement.style.setProperty('--text-base', colors.text);
  document.documentElement.style.setProperty('--text-subdued', colors.muted);
  document.documentElement.style.setProperty('--border', colors.border);
  document.documentElement.style.setProperty('--danger', colors.danger);
  document.documentElement.style.setProperty('--theme-bg-rgb', colorToRgbString(colors.bg));
  document.documentElement.style.setProperty('--theme-panel-rgb', colorToRgbString(colors.panel));
  document.documentElement.style.setProperty('--theme-glass-rgb', colorToRgbString(colors.glass));
  document.documentElement.style.setProperty('--theme-border-rgb', colorToRgbString(colors.border));
  document.documentElement.style.setProperty('--theme-text-rgb', colorToRgbString(colors.text));
  document.body.classList.toggle('no-glass', appSettings.glassEffects === false);
  applyTitleBarMode();
}
function normalize(s) { return s ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\([^)]*\)/g, '').replace(/feat\.?[^,]*/gi, '').replace(/[^a-z0-9]/g, '') : '' }
function getAlbumKey(file) { return (file.album || 'Unknown Album') + '::' + (file.albumArtist || file.artist || 'Unknown Artist'); }
function buildFileSearchText(file) { return [file.title, file.artist, file.album, file.albumArtist, file.genre, file.year, file.filename].map(function (v) { return v == null ? '' : String(v); }).join(' ').toLowerCase(); }
function buildFileExtText(file) {
  var fp = stripFileUrl(file.filePath || '') || file.filePath || '';
  var m = String(fp).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}
function markLibraryDirty() { libraryRevision++; libraryIndexCache = null; }
function setMusicFiles(files) { state.musicFiles = Array.isArray(files) ? files : []; markLibraryDirty(); }
function getLibraryIndex() {
  if (libraryIndexCache && libraryIndexCache.revision === libraryRevision) return libraryIndexCache;
  var byPath = new Map();
  var byStrippedPath = new Map();
  var searchTextByFile = new WeakMap();
  var extByFile = new WeakMap();
  var byNormalizedTitleArtistAlbum = new Map();
  var byNormalizedTitleAlbum = new Map();
  var byNormalizedTitleArtist = new Map();
  var byNormalizedTitle = new Map();
  var byNormalizedFilename = new Map();
  var albumsByKey = new Map();
  var albums = [];
  function rememberFirst(map, key, file) { if (key && !map.has(key)) map.set(key, file); }
  state.musicFiles.forEach(function (f) {
    if (!f) return;
    searchTextByFile.set(f, buildFileSearchText(f));
    extByFile.set(f, buildFileExtText(f));
    if (f.filePath) {
      byPath.set(f.filePath, f);
      byStrippedPath.set(stripFileUrl(f.filePath), f);
    }
    var normTitle = normalize(f.title);
    var normArtist = normalize(f.artist);
    var normAlbum = normalize(f.album);
    if (normTitle) {
      if (normArtist && normAlbum) rememberFirst(byNormalizedTitleArtistAlbum, normTitle + '::' + normArtist + '::' + normAlbum, f);
      if (normAlbum) rememberFirst(byNormalizedTitleAlbum, normTitle + '::' + normAlbum, f);
      if (normArtist) rememberFirst(byNormalizedTitleArtist, normTitle + '::' + normArtist, f);
      rememberFirst(byNormalizedTitle, normTitle, f);
    }
    if (f.filename) rememberFirst(byNormalizedFilename, normalize(f.filename.replace(/\.[^.]+$/, '')), f);
    var key = getAlbumKey(f);
    var album = albumsByKey.get(key);
    if (!album) {
      album = { id: key, name: f.album || 'Unknown Album', artist: f.albumArtist || f.artist || 'Unknown Artist', cover: null, tracks: [], year: f.year || 0, addedIdx: albums.length };
      albumsByKey.set(key, album);
      albums.push(album);
    }
    if (!album.cover && f.picture) album.cover = f.picture;
    if (f.year && !album.year) album.year = f.year;
    album.tracks.push(f);
  });
  libraryIndexCache = {
    revision: libraryRevision,
    byPath: byPath,
    byStrippedPath: byStrippedPath,
    searchTextByFile: searchTextByFile,
    extByFile: extByFile,
    byNormalizedTitleArtistAlbum: byNormalizedTitleArtistAlbum,
    byNormalizedTitleAlbum: byNormalizedTitleAlbum,
    byNormalizedTitleArtist: byNormalizedTitleArtist,
    byNormalizedTitle: byNormalizedTitle,
    byNormalizedFilename: byNormalizedFilename,
    albumsByKey: albumsByKey,
    albums: albums
  };
  return libraryIndexCache;
}
function isEditableMetadataFile(file) { return !!(file && file.filePath && /\.(mp3|flac)$/i.test(stripFileUrl(file.filePath) || file.filePath)); }
function getPlaylistTrackFilePath(record) { return record ? (record.FilePath || record.filePath || record.Path || record.path || '') : ''; }
function getTrackSelectionKey(track) {
  if (!track) return '';
  var fp = (track.matchedFile && track.matchedFile.filePath) || track.filePath || getPlaylistTrackFilePath(track.csvRecord);
  if (fp) return 'path::' + stripFileUrl(fp);
  return 'meta::' + (track.title || '') + '::' + (track.artist || '') + '::' + (track.album || '');
}
function getSelectedCurrentTracks() {
  if (!selectedTrackKeys.size) return [];
  return (state.currentTracks || []).filter(function (track) { return selectedTrackKeys.has(getTrackSelectionKey(track)); });
}
function getCurrentRegularPlaylist() {
  return state.playlists.find(function (p) { return p.id === state.currentView && !p.isSpecial; }) || null;
}
function clearTrackSelection() {
  selectedTrackKeys.clear();
  document.querySelectorAll('#tracks-body tr.track-selected').forEach(function (row) { row.classList.remove('track-selected'); });
}
function makePlaylistTrackRecord(track) {
  var filePath = track.filePath || (track.matchedFile && track.matchedFile.filePath) || '';
  return { Song: track.title || '', Artist: track.artist || '', Album: track.album || '', FilePath: filePath };
}
function samePlaylistTrack(record, track) {
  var recordPath = getPlaylistTrackFilePath(record);
  var trackPath = track && (track.filePath || (track.matchedFile && track.matchedFile.filePath));
  if (recordPath && trackPath) return stripFileUrl(recordPath) === stripFileUrl(trackPath);
  var rt = (record.Song || record.title || '').toLowerCase();
  var ra = (record.Artist || record.artist || '').toLowerCase();
  var rb = (record.Album || record.album || '').toLowerCase();
  var tt = (track.title || '').toLowerCase();
  var ta = (track.artist || '').toLowerCase();
  var tb = (track.album || '').toLowerCase();
  return rt === tt && ra === ta && rb === tb;
}
function getDiscNumber(file) {
  if (!file) return 1;
  if (file.__displayDiscNo && file.__displayDiscNo > 0) return file.__displayDiscNo;
  if (file.discNo && file.discNo > 0) return file.discNo;
  var fullPath = file.filePath || '';
  var folderMatch = fullPath.match(/(?:^|[\\/])(?:cd|disc|disk)\s*0*(\d{1,2})(?:[\\/]|$)/i);
  if (folderMatch) return parseInt(folderMatch[1], 10) || 1;
  var name = file.filename || fullPath.split(/[\\/]/).pop() || '';
  var prefixMatch = name.match(/^\s*(\d{1,2})\s*[-_. ]\s*\d{1,3}\b/);
  if (prefixMatch) return parseInt(prefixMatch[1], 10) || 1;
  return 1;
}
function albumHasMultipleDiscs(tracks) {
  var seen = new Set();
  (tracks || []).forEach(function (track) {
    if (track && track.matchedFile) seen.add(getDiscNumber(track.matchedFile));
    else if (track) seen.add(getDiscNumber(track));
  });
  return seen.size > 1;
}
function compareAlbumTrackOrder(a, b) {
  return (getDiscNumber(a) - getDiscNumber(b)) || ((a.trackNo || 0) - (b.trackNo || 0)) || (a.title || '').localeCompare(b.title || '');
}
function suppressSpuriousDiscOutliers(tracks) {
  var counts = {};
  var hasDeclaredMultiDisc = false;
  (tracks || []).forEach(function (f) {
    var disc = parseInt(f && f.discNo || 0, 10);
    var total = parseInt(f && f.discTotal || 0, 10);
    if (total > 1) hasDeclaredMultiDisc = true;
    if (disc > 0) counts[disc] = (counts[disc] || 0) + 1;
  });
  var discKeys = Object.keys(counts).map(function (d) { return parseInt(d, 10); }).filter(Boolean);
  if (hasDeclaredMultiDisc || discKeys.length <= 1) return;
  var baseCount = (counts[1] || 0) + (tracks.length - discKeys.reduce(function (sum, d) { return sum + counts[d]; }, 0));
  if (baseCount < Math.max(3, tracks.length - 1)) return;
  tracks.forEach(function (f) {
    var disc = parseInt(f && f.discNo || 0, 10);
    if (f && disc > 1 && counts[disc] === 1) f.__displayDiscNo = 1;
  });
}
function inferDiscsFromDuplicateTrackNumbers(tracks) {
  var groups = {};
  tracks.forEach(function (f) {
    var no = parseInt(f.trackNo || 0, 10);
    if (!no) return;
    if (!groups[no]) groups[no] = [];
    groups[no].push(f);
  });
  var duplicateGroups = Object.values(groups).filter(function (g) { return g.length > 1; });
  if (duplicateGroups.length < 2) return null;
  tracks.forEach(function (f) { delete f.__displayDiscNo; });
  var occurrenceByTrackNo = {};
  tracks.slice().sort(function (a, b) {
    return ((a.trackNo || 0) - (b.trackNo || 0)) || (a.title || '').localeCompare(b.title || '');
  }).forEach(function (f) {
    var no = parseInt(f.trackNo || 0, 10);
    if (!no) return;
    occurrenceByTrackNo[no] = (occurrenceByTrackNo[no] || 0) + 1;
    f.__displayDiscNo = occurrenceByTrackNo[no];
  });
  return tracks.slice().sort(compareAlbumTrackOrder);
}
function getSortedAlbumTracks(album) {
  var tracks = album && album.tracks ? album.tracks.slice() : [];
  tracks.forEach(function (f) { delete f.__displayDiscNo; });
  suppressSpuriousDiscOutliers(tracks);
  if (albumHasMultipleDiscs(tracks)) return tracks.sort(compareAlbumTrackOrder);
  return inferDiscsFromDuplicateTrackNumbers(tracks) || tracks.sort(compareAlbumTrackOrder);
}
function fuzzyMatch(a, b) { var na = normalize(a), nb = normalize(b); return na === nb || na.includes(nb) || nb.includes(na); }
function findMatchingFile(songName, artistName, albumName, filePath) {
  var libIndex = getLibraryIndex();
  if (filePath) {
    var wantedPath = stripFileUrl(filePath);
    var byPath = libIndex.byStrippedPath.get(wantedPath);
    if (byPath) return byPath;
  }
  var keyWithAlbum = songName + '-' + artistName + '-' + (albumName || '');
  var key = songName + '-' + artistName; // fallback for backwards compatibility
  
  if (state.mappings[keyWithAlbum] === 'NO_MATCH' || state.mappings[key] === 'NO_MATCH') return null;
  
  if (state.mappings[keyWithAlbum]) {
    var m = libIndex.byPath.get(state.mappings[keyWithAlbum]) || libIndex.byStrippedPath.get(stripFileUrl(state.mappings[keyWithAlbum]));
    if (m) return m;
  }
  if (state.mappings[key]) {
    var m = libIndex.byPath.get(state.mappings[key]) || libIndex.byStrippedPath.get(stripFileUrl(state.mappings[key]));
    if (m) return m;
  }
  var normTitle = normalize(songName);
  var normArtist = normalize(artistName);
  var normAlbum = normalize(albumName);
  if (normTitle && normAlbum) {
    var exactAlbumMatch = normArtist ? libIndex.byNormalizedTitleArtistAlbum.get(normTitle + '::' + normArtist + '::' + normAlbum) : libIndex.byNormalizedTitleAlbum.get(normTitle + '::' + normAlbum);
    if (exactAlbumMatch) return exactAlbumMatch;
  }
  
  // First pass: try to match all three (Song + Artist + Album)
  if (albumName) {
    for (var i = 0; i < state.musicFiles.length; i++) {
      var f = state.musicFiles[i];
      if (fuzzyMatch(f.title, songName) && (!artistName || fuzzyMatch(f.artist, artistName)) && fuzzyMatch(f.album, albumName)) return f;
    }
  }

  // Second pass: Song + Artist (ignore album)
  if (normTitle) {
    var exactTrackMatch = normArtist ? libIndex.byNormalizedTitleArtist.get(normTitle + '::' + normArtist) : libIndex.byNormalizedTitle.get(normTitle);
    if (exactTrackMatch) return exactTrackMatch;
    var exactFilenameMatch = libIndex.byNormalizedFilename.get(normTitle);
    if (exactFilenameMatch) return exactFilenameMatch;
  }
  for (var i = 0; i < state.musicFiles.length; i++) {
    var f = state.musicFiles[i];
    if (fuzzyMatch(f.title, songName) && (!artistName || fuzzyMatch(f.artist, artistName))) return f;
    var fn = f.filename ? f.filename.replace(/\.[^.]+$/, '') : '';
    if (fuzzyMatch(fn, songName)) return f;
  }
  return null;
}
// FIX 4: buildShuffleQueue resets existing queue entirely
function buildShuffleQueue() {
  var v = state.playQueueTracks.filter(function (t) { return !t.isDisabled; });
  state.shuffleQueue = v.slice().sort(function () { return Math.random() - .5; });
}

function moveTrackToShuffleQueueStart(track) {
  if (!state.isShuffle || !track || track.isDisabled) return;
  if (!state.shuffleQueue.length || state.shuffleQueue.indexOf(track) === -1) buildShuffleQueue();
  var idx = state.shuffleQueue.indexOf(track);
  if (idx > 0) {
    state.shuffleQueue.splice(idx, 1);
    state.shuffleQueue.unshift(track);
  }
}
function applyZoom() { $('albums-grid').style.gridTemplateColumns = 'repeat(auto-fill,minmax(' + currentZoom + 'px,1fr))'; }
function toggleQueue() { isQueueOpen = !isQueueOpen; $('queue-panel').classList.toggle('open', isQueueOpen); renderQueue(); }

// Queue: Now Playing + Next Up sections
function renderQueue() {
  var ql = $('queue-list'); if (!ql) return; ql.innerHTML = '';
  var allTracks = state.isShuffle ? state.shuffleQueue : state.playQueueTracks.filter(function (t) { return !t.isDisabled; });
  var curIdx = allTracks.indexOf(state.currentPlayingTrack);
  var cur = state.currentPlayingTrack;
  var dragIndex = -1;
  var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
  function makePic(track) { return track.matchedFile && track.matchedFile.picture ? '<img src="' + esc(track.matchedFile.picture) + '"' + lazy + ' style="width:36px;height:36px;border-radius:3px;object-fit:cover;flex-shrink:0;" />' : '<div style="width:36px;height:36px;background:#333;border-radius:3px;flex-shrink:0;"></div>'; }
  if (cur && cur.matchedFile) {
    var h1 = document.createElement('div');
    h1.style.cssText = 'padding:8px 8px 4px;font-size:10px;font-weight:700;color:var(--text-subdued);letter-spacing:0.1em;';
    h1.textContent = 'NOW PLAYING'; ql.appendChild(h1);
    var npDiv = document.createElement('div'); npDiv.className = 'queue-item playing';
    npDiv.innerHTML = makePic(cur) + '<div class="queue-item-info"><div class="queue-item-title">' + esc(cur.title) + '</div><div class="queue-item-artist">' + esc(cur.artist) + '</div></div>';
    ql.appendChild(npDiv);
  }
  var nextTracks = curIdx >= 0 ? allTracks.slice(curIdx + 1) : allTracks;
  var combinedQueue = (state.userQueue || []).concat(nextTracks);
  if (combinedQueue.length > 0) {
    var h2 = document.createElement('div');
    h2.style.cssText = 'padding:12px 8px 4px;font-size:10px;font-weight:700;color:var(--text-subdued);letter-spacing:0.1em;';
    h2.textContent = 'NEXT UP'; ql.appendChild(h2);

    var nextUpContainer = document.createElement('div');
    nextUpContainer.id = 'queue-next-up-list';

    combinedQueue.forEach(function (track, i) {
      var isUserQueue = i < (state.userQueue || []).length;
      var div = document.createElement('div'); div.className = 'queue-item';
      div.draggable = true;
      div.dataset.queueIndex = String(i);
      div.innerHTML = '<i class="ph ph-list drag-handle" style="cursor:grab;color:var(--text-subdued);margin-right:8px;font-size:16px;"></i>' + makePic(track) + '<div class="queue-item-info"><div class="queue-item-title">' + esc(track.title) + '</div><div class="queue-item-artist">' + esc(track.artist) + '</div></div>' +
        (isUserQueue ? '<i class="ph ph-x btn-remove-queue" style="cursor:pointer;color:var(--text-subdued);padding:4px;" data-idx="' + i + '"></i>' : '');
      div.addEventListener('dragstart', function (e) { dragIndex = i; div.style.opacity = '0.5'; if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'; });
      div.addEventListener('dragend', function () { dragIndex = -1; div.style.opacity = ''; div.classList.remove('drag-over'); });
      div.addEventListener('dragover', function (e) { e.preventDefault(); if (dragIndex !== -1 && dragIndex !== i) div.classList.add('drag-over'); });
      div.addEventListener('dragleave', function () { div.classList.remove('drag-over'); });
      div.addEventListener('drop', function (e) {
        e.preventDefault();
        div.classList.remove('drag-over');
        if (dragIndex === -1 || dragIndex === i) return;
        var userQueueLength = (state.userQueue || []).length;
        var movedItem = combinedQueue.splice(dragIndex, 1)[0];
        combinedQueue.splice(i, 0, movedItem);
        state.userQueue = combinedQueue.slice(0, userQueueLength);
        var nextUpQueue = combinedQueue.slice(userQueueLength);
        if (state.isShuffle) {
          var prevTracks = curIdx >= 0 ? state.shuffleQueue.slice(0, curIdx + 1) : [];
          var allNonDisabled = state.playQueueTracks.filter(function (t) { return !t.isDisabled; });
          var baseCurIdx = allNonDisabled.indexOf(state.currentPlayingTrack);
          var basePrevTracks = baseCurIdx >= 0 ? allNonDisabled.slice(0, baseCurIdx + 1) : [];
          state.shuffleQueue = prevTracks.concat(nextUpQueue);
          state.playQueueTracks = basePrevTracks.concat(nextUpQueue);
        } else {
          var allNonDisabled = state.playQueueTracks.filter(function (t) { return !t.isDisabled; });
          var prevTracks = curIdx >= 0 ? allNonDisabled.slice(0, curIdx + 1) : [];
          state.playQueueTracks = prevTracks.concat(nextUpQueue);
        }
        renderQueue();
      });
      div.addEventListener('click', function (e) {
        if (e.target.classList.contains('btn-remove-queue')) {
          e.stopPropagation();
          state.userQueue.splice(i, 1);
          renderQueue();
        } else if (!e.target.classList.contains('drag-handle')) {
          initAudioCtx(); playTrack(track);
        }
      });
      nextUpContainer.appendChild(div);
    });
    ql.appendChild(nextUpContainer);
  }
  if (!cur && combinedQueue.length === 0) { ql.innerHTML = '<div style="padding:24px;text-align:center;color:var(--text-subdued);font-size:13px;">Queue is empty</div>'; }
}

// FIX 7: switchView always pushes to nav history, including album detail
function switchView(viewId, addToHistory) {
  if (addToHistory === undefined) addToHistory = true;
  if (viewId !== state.currentView) clearTrackSelection();

  var ca = $('content-area');
  if (state.currentView === 'library' && viewId !== 'library') {
    state.libraryScrollPos = ca ? ca.scrollTop : 0;
  }

  state.currentView = viewId;
  var gs = $('global-search'); if (gs && viewId !== 'search') gs.value = '';
  // FIX 5: scroll reset on every view change
  if (ca) ca.scrollTop = 0;
  document.querySelectorAll('.nav-item').forEach(function (el) { el.classList.remove('active'); });
  document.querySelectorAll('.playlist-item').forEach(function (el) { el.classList.remove('active'); });
  $('albums-grid-container').style.display = 'none';
  $('tracks-table-container').style.display = 'block';
  $('album-detail-header').style.display = 'none';
  $('zoom-controls').style.display = 'none';
  var hdc = $('home-dashboard-container'); if (hdc) hdc.style.display = 'none';
  var sac = $('search-albums-container'); if (sac) sac.style.display = 'none';
  var pcontainer = $('playlists-grid-container'); if (pcontainer) pcontainer.style.display = 'none';
  var sc = $('stats-container'); if (sc) sc.style.display = 'none';
  var mhc = $('metadata-health-container'); if (mhc) mhc.style.display = 'none';
  var lsc = $('library-sort-controls'); if (lsc) lsc.style.display = 'none'; // hide sort controls unless in library
  if (addToHistory) pushNav(viewId);
  $('view-title').style.display = 'block';
  if (viewId === 'library') {
    $('view-title').textContent = 'Library';
    $('nav-library').classList.add('active');
    $('zoom-controls').style.display = 'flex';
    renderLibrary();
    if (state.libraryScrollPos && ca) {
      setTimeout(function () { ca.scrollTop = state.libraryScrollPos; }, 50);
    }
  } else if (viewId === 'playlists_fullscreen') {
    $('view-title').textContent = 'Your Playlists';
    if (pcontainer) pcontainer.style.display = 'block';
    renderPlaylistsFullscreenGrid();
  } else if (viewId === 'home') {
    $('view-title').textContent = 'Home';
    $('nav-home').classList.add('active');
    $('view-title').style.display = 'none'; // hide generic title
    $('albums-grid-container').style.display = 'none';
    $('tracks-table-container').style.display = 'none';

    var hdc = $('home-dashboard-container');
    if (hdc) {
      hdc.style.display = 'block';
      renderHomeDashboard();
    }
  } else if (viewId === 'metadata_health') {
    $('view-title').textContent = 'Tag Health';
    $('tracks-table-container').style.display = 'none';
    if (mhc) { mhc.style.display = 'block'; renderMetadataHealthView(); }
  } else if (viewId === 'search') {
    $('view-title').textContent = 'Search Results';
    $('view-title').style.display = 'none';
    if (gs && gs.value) {
      // Re-trigger the input event so that search renders results
      gs.dispatchEvent(new Event('input'));
    }
  } else {
    var el = document.getElementById(viewId); if (el) el.classList.add('active');
    renderPlaylist(viewId);
  }
}

function renderHomeDashboard() {
  var recGrid = $('home-recommendations');
  var recEmpty = $('home-recommendations-empty');
  var lfTxt = $('lastfm-status-text');

  // Helper to create album card
  function addAlbumCard(album, gridEl) {
    var card = document.createElement('div'); card.className = 'album-card' + (isAlbumActive(album) ? ' playing' : '');
    var active = isAlbumActive(album);
    var wave = active && state.isPlaying ? '<div class="now-playing-bars" style="position:absolute;bottom:6px;left:6px;"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>' : '';
    var playBtnIcon = active && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
    var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
    var cov = album.cover ? '<img src="' + esc(album.cover) + '" alt="cover"' + lazy + ' />' : '<i class="ph ph-music-notes"></i>';
    card.innerHTML = '<div class="album-card-img-wrapper" style="position:relative;">' + cov + wave + '<div class="album-card-play-btn" data-album="' + encodeURIComponent(album.name) + '"><i class="' + playBtnIcon + '"></i></div></div><div class="album-card-info"><div class="album-card-title" title="' + esc(album.name) + '">' + esc(album.name) + '</div><div class="album-card-artist">' + esc(album.artist) + '</div></div>';
    // Set blurred bg for non-square covers
    if (album.cover) {
      var wrapper = card.querySelector('.album-card-img-wrapper');
      if (wrapper) wrapper.style.setProperty('--cover-bg', 'url("' + album.cover.replace(/"/g, '\\"') + '")');
    }
    
    card.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      window.currentContextMenuAlbum = album;
      hideAllContextMenus();
      positionContextMenu($('album-context-menu'), e.clientX, e.clientY);
    });
    card.querySelector('.album-card-play-btn').addEventListener('click', function (e) {
      e.stopPropagation(); initAudioCtx();
      if (isAlbumActive(album)) { togglePlay(); var icon = e.currentTarget.querySelector('i'); if (icon) icon.className = state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play'; return; }
      state.playQueueTracks = getSortedAlbumTracks(album).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
      state.shuffleQueue = []; if (state.isShuffle) buildShuffleQueue();
      playTrack(state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks[0]);
    });
    card.addEventListener('click', function () { pushNav('album:' + album.id); renderAlbumDetail(album); });
    gridEl.appendChild(card);
  }

  var albumList = getLibraryIndex().albums;

  // ── Compact Stats Bar ──
  var statsBar = $('home-stats-bar');
  if (statsBar) {
    var playCounts2 = appSettings.playCounts || {};
    var playTimes2 = appSettings.playTimes || {};
    var totalPlays2 = Object.values(playCounts2).reduce(function(a,b){return a+b;}, 0);
    var totalSecs2 = Object.values(playTimes2).reduce(function(a,b){return a+b;}, 0);
    var totalHrs2 = Math.floor(totalSecs2/3600);
    var totalMins2 = Math.floor((totalSecs2%3600)/60);
    var uniqueTracks2 = Object.keys(playCounts2).length;
    var statItems = [
      { icon: 'ph-play', val: totalPlays2 || '—', label: 'Total Plays', color: 'var(--accent)' },
      { icon: 'ph-clock', val: totalPlays2 ? (totalHrs2 + 'h ' + totalMins2 + 'm') : '—', label: 'Listened', color: 'var(--accent)' },
      { icon: 'ph-music-notes', val: uniqueTracks2 || '—', label: 'Tracks Played', color: 'var(--accent)' },
      { icon: 'ph-vinyl-record', val: albumList.length, label: 'Albums', color: 'var(--accent)' },
    ];
    statsBar.innerHTML = statItems.map(function(s) {
      return '<div style="display:flex;align-items:center;gap:10px;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-radius:10px;padding:10px 16px;flex:1;min-width:120px;cursor:pointer;" onclick="renderStatsView();document.querySelectorAll(\'.nav-item\').forEach(function(e){e.classList.remove(\'active\')});">' +
        '<i class="ph ' + s.icon + '" style="font-size:20px;color:' + s.color + ';flex-shrink:0;"></i>' +
        '<div><div style="font-size:18px;font-weight:800;color:white;line-height:1.1;">' + s.val + '</div><div style="font-size:11px;color:rgba(255,255,255,0.4);margin-top:1px;">' + s.label + '</div></div>' +
        '</div>';
    }).join('');
  }

  // Recently Added (Last 6 albums)
  var gridRecent = $('home-recently-added');
  if (gridRecent) {
    gridRecent.innerHTML = '';
    var recent = albumList.slice(-6).reverse();
    recent.forEach(function(a) { addAlbumCard(a, gridRecent); });
  }

  // Most Played (For now, sort by track count as proxy)
  var gridMost = $('home-most-played');
  if (gridMost) {
    gridMost.innerHTML = '';
    var playCounts = appSettings.playCounts || {};
    var mostPlayed = albumList.slice().sort(function(a, b) {
      var aCnt = a.tracks.reduce(function(s,t){return s+(playCounts[t.filePath]||0);},0);
      var bCnt = b.tracks.reduce(function(s,t){return s+(playCounts[t.filePath]||0);},0);
      if (bCnt !== aCnt) return bCnt - aCnt;
      return b.tracks.length - a.tracks.length;
    }).slice(0, 6);
    mostPlayed.forEach(function(a) { addAlbumCard(a, gridMost); });
  }

  // Discover / Random Albums
  var gridRandom = $('home-random-albums');
  if (gridRandom) {
    gridRandom.innerHTML = '';
    var randoms = albumList.slice().sort(function() { return 0.5 - Math.random(); }).slice(0, 6);
    randoms.forEach(function(a) { addAlbumCard(a, gridRandom); });
  }

  var btnRefRandom = $('btn-refresh-random-albums');
  if (btnRefRandom) btnRefRandom.onclick = function() { renderHomeDashboard(); };

  // Last.fm Recommendations
  var btnRefLfm = $('btn-refresh-lastfm');
  if (appSettings.lastfmSessionKey) {
    lfTxt.textContent = 'Connected as ' + appSettings.lastfmUsername;
    recEmpty.style.display = 'none';
    if (btnRefLfm) {
      btnRefLfm.style.display = 'block';
      btnRefLfm.onclick = function() { state.lastfmRecsCache = null; renderHomeDashboard(); };
    }

    function renderRecs(recs) {
      recGrid.innerHTML = '';
      if (!recs || recs.length === 0) {
        recGrid.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text-subdued);font-size:13px;background:rgba(255,255,255,0.02);border-radius:12px;">No recommendations found yet. Listen to more tracks to help Last.fm learn your taste!</div>';
      } else {
        recs.forEach(function (r) {
          var card = document.createElement('div'); card.className = 'album-card';
          var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
          var cov = r.image ? '<img src="' + esc(r.image) + '"' + lazy + '/>' : '<i class="ph ph-music-notes"></i>';
          card.innerHTML = '<div class="album-card-img-wrapper">' + cov + '</div><div class="album-card-info"><div class="album-card-title" title="' + esc(r.name) + '">' + esc(r.name) + '</div><div class="album-card-artist">' + esc(r.artist) + '</div></div>';
          card.addEventListener('click', function () {
            window.api.openExternal('https://www.youtube.com/results?search_query=' + encodeURIComponent(r.artist + ' ' + r.name));
          });
          recGrid.appendChild(card);
        });
      }
    }

    if (state.lastfmRecsCache && state.lastfmRecsCacheTime && (Date.now() - state.lastfmRecsCacheTime < 3600000)) {
      renderRecs(state.lastfmRecsCache);
    } else {
      recGrid.innerHTML = '<div style="grid-column:1/-1;padding:60px;text-align:center;"><i class="ph ph-spinner ph-spin" style="font-size:32px;color:var(--accent);margin-bottom:12px;"></i><p style="color:var(--text-subdued);font-size:13px;">Fetching personalized recommendations...</p></div>';
      window.api.getLastfmRecommendations(appSettings.lastfmSessionKey, appSettings.lastfmApiKey, appSettings.lastfmUsername).then(function (recs) {
        state.lastfmRecsCache = recs;
        state.lastfmRecsCacheTime = Date.now();
        renderRecs(recs);
      }).catch(function (err) {
        recGrid.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--danger);font-size:13px;">Failed to load recommendations.</div>';
      });
    }
  } else {
    lfTxt.textContent = 'Not Connected';
    recEmpty.style.display = 'block';
    recGrid.innerHTML = '';
    if (btnRefLfm) btnRefLfm.style.display = 'none';
  }
}

// FIX 1+2+3: Sidebar playlist render - grid fix, pin/lastPlayed separate, auto cover

function renderSidebarPlaylists() {
  var list = $('playlists-list'); list.innerHTML = '';
  var libIndex = getLibraryIndex();
  var titleArtistMap = new Map();
  var filenameMap = new Map();
  state.musicFiles.forEach(function (file) {
    var titleKey = normalize(file.title) + '::' + normalize(file.artist);
    var filenameKey = normalize(file.filename ? file.filename.replace(/\.[^.]+$/, '') : '');
    if (titleKey && !titleArtistMap.has(titleKey)) titleArtistMap.set(titleKey, file);
    if (filenameKey && !filenameMap.has(filenameKey)) filenameMap.set(filenameKey, file);
  });

  var likedSet = new Set(state.likedSongs);
  var pseudoLiked = {
    id: 'liked_songs',
    name: 'Liked Songs',
    pinned: false,
    color: 'linear-gradient(135deg, #450af5, #c4a1ff)',
    isSpecial: true,
    tracks: state.musicFiles.filter(function (f) { return likedSet.has(f.filePath); }),
    lastPlayed: localStorage.getItem('likedSongsLastPlayed') || null
  };

  var pinned = state.playlists.filter(function (p) { return p.pinned; });
  var unpinned = state.playlists.filter(function (p) { return !p.pinned; });
  unpinned.push(pseudoLiked);

  unpinned.sort(function (a, b) {
    if (!a.lastPlayed && !b.lastPlayed) return 0;
    if (!a.lastPlayed) return 1; if (!b.lastPlayed) return -1;
    return new Date(b.lastPlayed) - new Date(a.lastPlayed);
  });
  var sorted = pinned.concat(unpinned);

  list.className = 'playlists-container playlists-grid';
  list.removeAttribute('style');
  if($('playlist-search')) $('playlist-search').style.display = 'block';

  sorted.forEach(function (pl) {
    var autoCover = pl.cover || null;
    if (!autoCover && !pl.isSpecial) {
      for (var i = 0; i < (pl.tracks || []).length; i++) {
        var r = pl.tracks[i];
        var sn = r.Song || r.title || '', an = r.Artist || r.artist || '', al = r.Album || r.album || '';
        var trackPath = getPlaylistTrackFilePath(r);
        var m = (trackPath ? libIndex.byStrippedPath.get(stripFileUrl(trackPath)) : null) || titleArtistMap.get(normalize(sn) + '::' + normalize(an) + '::' + normalize(al)) || titleArtistMap.get(normalize(sn) + '::' + normalize(an)) || filenameMap.get(normalize(sn)) || findMatchingFile(sn, an, al, trackPath);
        if (m && m.picture) { autoCover = m.picture; break; }
      }
    }

    var el = document.createElement('div');
    var isActive = state.currentView === pl.id;
    el.className = 'playlist-item playlist-card' + (pl.pinned ? ' pinned' : '') + (isActive ? ' active' : '');
    el.id = pl.id;

    var pinHtml = pl.pinned ? '<i class="ph-fill ph-push-pin" style="color:var(--accent);margin-right:4px;"></i>' : '';
    // Download icon for visual match with user's picture
    var dlHtml = pl.id !== 'liked_songs' ? '<i class="ph-fill ph-arrow-circle-down" style="color:var(--accent);margin-right:4px;"></i>' : '<i class="ph-fill ph-arrow-circle-down" style="color:var(--accent);margin-right:4px;"></i>';
    var trackCount = pl.tracks ? pl.tracks.length : 0;
    var subText = (pl.pinned ? pinHtml : '') + dlHtml + trackCount + ' tracks';

    var innerIcon = pl.isSpecial ? '<i class="ph-fill ph-heart"></i>' : '<i class="ph ph-music-notes"></i>';
    var bgStyle = pl.isSpecial ? 'background: ' + pl.color + ';' : 'background:' + (pl.color || '#333') + ';';
    var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
    var coverHtml = autoCover ? '<img class="playlist-card-cover" src="' + esc(autoCover) + '"' + lazy + ' alt="" />'
      : '<div class="playlist-card-cover playlist-card-cover-placeholder" style="' + bgStyle + '">' + innerIcon + '</div>';

    el.innerHTML = coverHtml + '<span class="playlist-card-title" title="' + esc(pl.name) + '">' + esc(pl.name) + '</span><span class="playlist-card-meta">' + subText + '</span>';

    el.addEventListener('click', function () { switchView(pl.id); });
    if (!pl.isSpecial) {
      el.addEventListener('contextmenu', function (e) { e.preventDefault(); openPlaylistContextMenu(pl, e.clientX, e.clientY); });
      el.addEventListener('dragover', function (e) { e.preventDefault(); el.style.outline = '1px solid var(--accent)'; });
      el.addEventListener('dragleave', function () { el.style.outline = ''; });
      el.addEventListener('drop', async function (e) {
        e.preventDefault(); el.style.outline = '';
        try {
          var t = JSON.parse(e.dataTransfer.getData('text/plain'));
          if (!pl.tracks) pl.tracks = [];
          var dup = pl.tracks.some(function (r) { return (r.Song || r.title || '').toLowerCase() === t.title.toLowerCase() && (r.Artist || r.artist || '').toLowerCase() === t.artist.toLowerCase(); });
          if (dup) { alert('"' + t.title + '" is already in "' + pl.name + '".'); return; }
          pl.tracks.push({ Song: t.title, Artist: t.artist, Album: t.album });
          await window.api.savePlaylists(state.playlists);
        } catch (err) { }
      });
    }
    list.appendChild(el);
  });
}

// FIX 9: playlist search - filters on name, case-insensitive, works for both list/grid
function filterPlaylists(q) {
  document.querySelectorAll('#playlists-list .playlist-item').forEach(function (el) {
    if (el.id === 'liked_songs') { el.style.display = ''; return; }
    var nameEl = el.querySelector('span');
    var txt = nameEl ? nameEl.textContent.toLowerCase() : el.textContent.toLowerCase();
    el.style.display = txt.includes(q.toLowerCase()) ? '' : 'none';
  });
}

// FIX 6: album play button state - track which album is active
function isAlbumActive(album) {
  return state.currentPlayingTrack && state.currentPlayingTrack.matchedFile &&
    album.tracks.some(function (t) { return t.filePath === state.currentPlayingTrack.matchedFile.filePath; });
}

function renderMetadataHealthView() {
  var root = $('metadata-health-container'); if (!root) return;
  var albumDiscCounts = {};
  getLibraryIndex().albums.forEach(function (album) {
    albumDiscCounts[album.id] = new Set();
    album.tracks.forEach(function (f) { albumDiscCounts[album.id].add(getDiscNumber(f)); });
  });
  function isMissingTrackOrDisc(f) {
    return !f.trackNo || (albumDiscCounts[getAlbumKey(f)] && albumDiscCounts[getAlbumKey(f)].size > 1 && !f.discNo && !f.__displayDiscNo);
  }
  var checks = [
    { id: 'missing_files', label: 'Missing Files', icon: 'ph-file-x', test: function (f) { return libraryMissingFilePaths.has(f.filePath); } },
    { id: 'missing_cover', label: 'Missing Cover', icon: 'ph-image-broken', test: function (f) { return !f.picture; } },
    { id: 'missing_year', label: 'Missing Year', icon: 'ph-calendar-x', test: function (f) { return !f.year; } },
    { id: 'missing_genre', label: 'Missing Genre', icon: 'ph-tag', test: function (f) { return !f.genre; } },
    { id: 'missing_track', label: 'Missing Track/Disc', icon: 'ph-list-numbers', test: isMissingTrackOrDisc },
    { id: 'missing_replaygain', label: 'Missing ReplayGain', icon: 'ph-waveform', test: function (f) { return f.replayGainTrackDb === null || f.replayGainTrackDb === undefined; } }
  ];
  var activeId = root.dataset.filter || checks[0].id;
  var active = checks.find(function (c) { return c.id === activeId; }) || checks[0];
  var allFiltered = state.musicFiles.filter(active.test);
  var filtered = allFiltered.slice(0, 250);
  var rgAllButton = active.id === 'missing_replaygain' ? '<button class="tag-health-action accent" id="tag-health-analyze-all-rg">Analyze All Missing RG</button>' : '';
  var relinkButton = active.id === 'missing_files' ? '<button class="tag-health-action accent" id="tag-health-relink-folder">Relink Folder</button>' : '';
  root.innerHTML = '<div class="tag-health-toolbar"><div><div class="tag-health-title">Library Tag Health</div><div class="tag-health-subtitle">Find tracks that need metadata cleanup or loudness analysis.</div></div><div class="tag-health-actions"><button class="tag-health-action" id="tag-health-album-cleanup">Album Cleanup</button><button class="tag-health-action" id="tag-health-scan-missing">Scan Missing Files</button>' + relinkButton + '<button class="tag-health-action" id="tag-health-rescan">Refresh</button><button class="tag-health-action accent" id="tag-health-quick-visible">Fix Listed Items</button><button class="tag-health-action" id="tag-health-analyze-visible">Analyze Next Batch</button>' + rgAllButton + '</div></div><div class="tag-health-cards" id="metadata-health-cards"></div><div id="metadata-health-list"></div>';
  var albumCleanupBtn = $('tag-health-album-cleanup');
  if (albumCleanupBtn) albumCleanupBtn.onclick = renderAlbumCleanupHelper;
  var scanMissingBtn = $('tag-health-scan-missing');
  if (scanMissingBtn) scanMissingBtn.onclick = scanMissingLibraryFiles;
  var relinkFolderBtn = $('tag-health-relink-folder');
  if (relinkFolderBtn) relinkFolderBtn.onclick = relinkMissingFilesFromFolder;
  var refreshBtn = $('tag-health-rescan');
  if (refreshBtn) refreshBtn.onclick = renderMetadataHealthView;
  var analyzeVisibleBtn = $('tag-health-analyze-visible');
  if (analyzeVisibleBtn) analyzeVisibleBtn.onclick = function () { active.id === 'missing_replaygain' ? analyzeReplayGainBatch(filtered) : analyzeLoudnessForFiles(filtered); };
  var analyzeAllRgBtn = $('tag-health-analyze-all-rg');
  if (analyzeAllRgBtn) analyzeAllRgBtn.onclick = function () { analyzeAllMissingReplayGain(); };
  var quickVisibleBtn = $('tag-health-quick-visible');
  if (quickVisibleBtn) quickVisibleBtn.onclick = function () { quickFixMetadataFiles(active.id, filtered); };
  var cards = $('metadata-health-cards');
  checks.forEach(function (check) {
    var count = state.musicFiles.filter(check.test).length;
    var card = document.createElement('button');
    card.className = 'tag-health-card' + (check.id === active.id ? ' active' : '');
    card.innerHTML = '<span class="tag-health-card-icon"><i class="ph ' + check.icon + '"></i></span><span class="tag-health-card-body"><span class="tag-health-card-label">' + esc(check.label) + '</span><span class="tag-health-card-count">' + count + '</span></span>';
    card.onclick = function () { root.dataset.filter = check.id; renderMetadataHealthView(); };
    cards.appendChild(card);
  });
  var list = $('metadata-health-list');
  if (!filtered.length) { list.innerHTML = '<div class="tag-health-empty"><i class="ph ph-check-circle"></i><div>No issues in this category.</div></div>'; return; }
  list.innerHTML = '<div class="tag-health-list-head"><h2>' + esc(active.label) + '</h2><span>Showing ' + filtered.length + ' of ' + allFiltered.length + '</span></div><div class="tag-health-rows" id="tag-health-rows"></div>';
  var rows = $('tag-health-rows');
  filtered.forEach(function (f) {
    var row = document.createElement('div');
    row.className = 'tag-health-row';
    var cover = f.picture ? '<img class="tag-health-cover" src="' + esc(f.picture) + '">' : '<div class="tag-health-cover placeholder"><i class="ph ph-music-notes"></i></div>';
    var details = [];
    if (libraryMissingFilePaths.has(f.filePath)) details.push('missing file');
    if (!f.year) details.push('no year');
    if (!f.genre) details.push('no genre');
    if (!f.trackNo) details.push('no track #');
    if (f.replayGainTrackDb === null || f.replayGainTrackDb === undefined) details.push('no ReplayGain');
    var quickLabel = active.id === 'missing_files' ? 'Remove' : (active.id === 'missing_replaygain' ? 'Batch Analyze' : (active.id === 'missing_track' ? 'Infer #' : (active.id === 'missing_cover' ? 'Use Image' : 'Auto Tag')));
    var editAlbumBtn = active.id === 'missing_track' ? '<button class="tag-health-action edit-album">Edit Album</button>' : '';
    row.innerHTML = cover + '<div class="tag-health-track"><div class="tag-health-track-title">' + esc(f.title || f.filename || 'Unknown Track') + '</div><div class="tag-health-track-meta">' + esc(f.artist || 'Unknown Artist') + ' • ' + esc(f.album || 'Unknown Album') + '</div><div class="tag-health-badges">' + details.slice(0, 4).map(function (d) { return '<span>' + esc(d) + '</span>'; }).join('') + '</div></div><div class="tag-health-row-actions"><button class="tag-health-action edit">Edit</button>' + editAlbumBtn + '<button class="tag-health-action quick">' + esc(quickLabel) + '</button></div>';
    row.querySelector('.edit').onclick = function () { openMetadataEditor([f]); };
    var editAlbum = row.querySelector('.edit-album');
    if (editAlbum) editAlbum.onclick = function () { openMetadataEditor(getAlbumFilesForTrack(f)); };
    row.querySelector('.quick').onclick = function () { quickFixMetadataFiles(active.id, [f]); };
    rows.appendChild(row);
  });
}

function getFileFolderPath(file) {
  var fp = stripFileUrl((file && file.filePath) || '') || (file && file.filePath) || '';
  return fp.replace(/[^\/\\]+$/, '');
}
function getAlbumFilesForTrack(file) {
  var key = getAlbumKey(file);
  var album = getLibraryIndex().albumsByKey.get(key);
  var files = album ? album.tracks : [];
  return files.length ? files : [file];
}
function pickBestFolderImage(images) {
  if (!images || !images.length) return '';
  var preferred = ['folder', 'cover', 'front', 'artwork', 'album'];
  var sorted = images.slice().sort(function (a, b) {
    var la = a.toLowerCase(), lb = b.toLowerCase();
    var ia = preferred.findIndex(function (p) { return la.indexOf(p) !== -1; });
    var ib = preferred.findIndex(function (p) { return lb.indexOf(p) !== -1; });
    ia = ia === -1 ? 99 : ia;
    ib = ib === -1 ? 99 : ib;
    return ia - ib;
  });
  return sorted[0] || '';
}
async function scanMissingLibraryFiles() {
  if (!window.api.checkLibraryFiles) return;
  var btn = $('tag-health-scan-missing');
  var oldText = btn ? btn.textContent : '';
  if (btn) { btn.textContent = 'Scanning...'; btn.disabled = true; }
  try {
    var res = await window.api.checkLibraryFiles(state.musicFiles);
    libraryMissingFilePaths = new Set((res && res.missing) || []);
    var root = $('metadata-health-container');
    if (root) root.dataset.filter = 'missing_files';
    renderMetadataHealthView();
  } catch (e) {
    console.error(e);
    alert('Missing file scan failed: ' + (e.message || e));
  } finally {
    if (btn) { btn.textContent = oldText || 'Scan Missing Files'; btn.disabled = false; }
  }
}
function fileNameFromPath(filePath) {
  return String(filePath || '').replace(/\\/g, '/').split('/').pop().toLowerCase();
}
function relinkIdentity(file) {
  return normalize((file && file.title) || '') + '::' + normalize((file && file.artist) || '') + '::' + normalize((file && file.album) || '');
}
function getRelinkCandidate(missingFile, candidates, usedPaths) {
  var missingName = fileNameFromPath(missingFile.filePath || missingFile.filename || '');
  var missingIdentity = relinkIdentity(missingFile);
  var best = null;
  var bestScore = 0;
  candidates.forEach(function (candidate) {
    if (!candidate || !candidate.filePath || usedPaths.has(candidate.filePath)) return;
    var score = 0;
    if (missingName && fileNameFromPath(candidate.filePath) === missingName) score += 80;
    if (missingIdentity && relinkIdentity(candidate) === missingIdentity) score += 70;
    if (normalize(candidate.title) && normalize(candidate.title) === normalize(missingFile.title)) score += 20;
    if (normalize(candidate.artist) && normalize(candidate.artist) === normalize(missingFile.artist)) score += 15;
    if (normalize(candidate.album) && normalize(candidate.album) === normalize(missingFile.album)) score += 10;
    if (missingFile.duration && candidate.duration) {
      var delta = Math.abs(missingFile.duration - candidate.duration);
      if (delta <= 2) score += 18;
      else if (delta <= 6) score += 8;
      else if (score < 90) score -= 25;
    }
    if (score > bestScore) { best = candidate; bestScore = score; }
  });
  return bestScore >= 70 ? best : null;
}
function updatePlaylistReferencesForRelink(pathMap, fileMap) {
  state.playlists.forEach(function (playlist) {
    (playlist.tracks || []).forEach(function (track) {
      var oldPath = getPlaylistTrackFilePath(track);
      var nextPath = oldPath && pathMap[oldPath];
      if (!nextPath) return;
      track.FilePath = nextPath;
      if (track.filePath) track.filePath = nextPath;
      if (track.Path) track.Path = nextPath;
      if (track.path) track.path = nextPath;
      if (track.matchedFile) track.matchedFile = fileMap[nextPath] || Object.assign({}, track.matchedFile, { filePath: nextPath });
    });
  });
}
async function relinkMissingFilesFromFolder() {
  var missingFiles = state.musicFiles.filter(function (f) { return libraryMissingFilePaths.has(f.filePath); });
  if (!missingFiles.length) { alert('No missing files to relink. Run Scan Missing Files first.'); return; }
  var folderPath = await window.api.openFolder();
  if (!folderPath) return;
  var btn = $('tag-health-relink-folder');
  var oldText = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }
  try {
    window.api.onScanProgress(function (d) {
      if (btn && d.total > 0) btn.textContent = 'Scanning ' + Math.round((d.current / d.total) * 100) + '%';
    });
    var candidates = await window.api.scanFolder(folderPath, []);
    var used = new Set();
    var matches = [];
    missingFiles.forEach(function (missing) {
      var candidate = getRelinkCandidate(missing, candidates, used);
      if (!candidate) return;
      used.add(candidate.filePath);
      matches.push({ oldFile: missing, newFile: candidate });
    });
    if (!matches.length) { alert('No reliable matches found in selected folder.'); return; }
    var preview = matches.slice(0, 10).map(function (m) { return '- ' + (m.oldFile.title || m.oldFile.filename || fileNameFromPath(m.oldFile.filePath)) + '\n  -> ' + m.newFile.filePath; }).join('\n');
    if (!confirm('Relink ' + matches.length + ' of ' + missingFiles.length + ' missing file(s)?\n\n' + preview + (matches.length > 10 ? '\n...and ' + (matches.length - 10) + ' more.' : ''))) return;
    pushUndoSnapshot('Relink missing files');
    var pathMap = {};
    var fileMap = {};
    matches.forEach(function (m) {
      var oldPath = m.oldFile.filePath;
      Object.assign(m.oldFile, m.newFile);
      pathMap[oldPath] = m.oldFile.filePath;
      fileMap[m.oldFile.filePath] = m.oldFile;
      libraryMissingFilePaths.delete(oldPath);
    });
    var byPath = {};
    state.musicFiles.forEach(function (f) { if (f && f.filePath && !byPath[f.filePath]) byPath[f.filePath] = f; });
    setMusicFiles(Object.values(byPath));
    updatePlaylistReferencesForRelink(pathMap, fileMap);
    Object.keys(state.mappings || {}).forEach(function (key) { if (pathMap[state.mappings[key]]) state.mappings[key] = pathMap[state.mappings[key]]; });
    await Promise.all([window.api.saveLibrary(state.musicFiles), window.api.savePlaylists(state.playlists), window.api.saveMappings(state.mappings)]);
    renderSidebarPlaylists();
    renderMetadataHealthView();
    alert('Relinked ' + matches.length + ' file(s).');
  } catch (e) {
    console.error(e);
    alert('Relink failed: ' + (e.message || e));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = oldText || 'Relink Folder'; }
  }
}
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
  if (fixed) { markLibraryDirty(); await window.api.saveLibrary(state.musicFiles); }
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
  if (changed) { markLibraryDirty(); await window.api.saveLibrary(state.musicFiles); }
  return changed;
}
async function removeLibraryFiles(files, undoLabel) {
  files = (files || []).filter(function (f) { return f && f.filePath; });
  if (!files.length) return 0;
  pushUndoSnapshot(undoLabel || 'Remove from library');
  var removeSet = new Set(files.map(function (f) { return f.filePath; }));
  setMusicFiles(state.musicFiles.filter(function (f) { return !removeSet.has(f.filePath); }));
  state.currentTracks = state.currentTracks.filter(function (t) { return !t.matchedFile || !removeSet.has(t.matchedFile.filePath); });
  state.playQueueTracks = state.playQueueTracks.filter(function (t) { return !t.matchedFile || !removeSet.has(t.matchedFile.filePath); });
  state.shuffleQueue = state.shuffleQueue.filter(function (t) { return !t.matchedFile || !removeSet.has(t.matchedFile.filePath); });
  state.userQueue = state.userQueue.filter(function (t) { return !t.matchedFile || !removeSet.has(t.matchedFile.filePath); });
  removeSet.forEach(function (fp) { libraryMissingFilePaths.delete(fp); });
  await window.api.saveLibrary(state.musicFiles);
  return removeSet.size;
}
async function removeMissingLibraryEntries(files) {
  if (!files.length) return 0;
  if (!confirm('Remove ' + files.length + ' missing entr' + (files.length === 1 ? 'y' : 'ies') + ' from the library?\n\nThis does not delete any audio files.')) return 0;
  return await removeLibraryFiles(files, 'Remove missing library entries');
}
async function quickFixMetadataFiles(filterId, files) {
  files = (files || []).filter(Boolean);
  if (!files.length) return;
  try {
    var changed = 0;
    if (filterId === 'missing_files') changed = await removeMissingLibraryEntries(files);
    else if (filterId === 'missing_cover') { pushUndoSnapshot('Fix missing covers'); changed = await quickFixMissingCover(files); }
    else if (filterId === 'missing_track') { pushUndoSnapshot('Infer track/disc numbers'); changed = await quickFixTrackNumbers(files); }
    else if (filterId === 'missing_replaygain') { await analyzeReplayGainBatch(files); return; }
    else {
      var albumKey = getAlbumKey(files[0]);
      var album = getLibraryIndex().albumsByKey.get(albumKey);
      var albumFiles = album ? album.tracks : [];
      openMetadataEditor(albumFiles.length > 1 ? albumFiles : files);
      return;
    }
    renderMetadataHealthView();
    if (state.currentView === 'library') renderLibrary();
    if (isQueueOpen) renderQueue();
    alert('Quick fix updated ' + changed + ' track(s).');
  } catch (e) {
    console.error(e);
    alert('Quick fix failed: ' + (e.message || e));
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
    var coverHtml = cover ? '<img class="tag-health-cover" src="' + esc(cover.picture) + '">' : '<div class="tag-health-cover placeholder"><i class="ph ph-vinyl-record"></i></div>';
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
  if (sortCtrl) sortCtrl.style.display = 'flex';

  // Sort based on dropdown
  var sortSel = $('library-sort-select');
  var sortMode = sortSel ? sortSel.value : 'artist';
  var albums = getLibraryIndex().albums.slice();
  if (sortMode === 'artist') {
    albums.sort(function(a,b) { return (a.artist||'').localeCompare(b.artist||''); });
  } else if (sortMode === 'album') {
    albums.sort(function(a,b) { return (a.name||'').localeCompare(b.name||''); });
  } else if (sortMode === 'year') {
    albums.sort(function(a,b) { return (b.year||0) - (a.year||0); });
  } else if (sortMode === 'recent') {
    // keep insertion order reversed (last added first)
    albums.reverse();
  }

  var grid = $('albums-grid');
  grid.innerHTML = '';
  grid.style.display = '';
  window._libAlbumsToRender = albums;
  window._libRenderIndex = 0;
  window._libRenderChunk = appSettings.virtualScrolling ? 60 : 80;
  window._libRenderAll = !appSettings.virtualScrolling;
  window._libRenderToken = (window._libRenderToken || 0) + 1;
  if (window._libRenderFrame) {
    cancelAnimationFrame(window._libRenderFrame);
    window._libRenderFrame = null;
  }
  
  if (!window.renderLibraryChunk) {
    window.renderLibraryChunk = function() {
      if (state.currentView !== 'library') return;
      if (!window._libAlbumsToRender || window._libRenderIndex >= window._libAlbumsToRender.length) return;
      var renderToken = window._libRenderToken;
      var chunk = window._libAlbumsToRender.slice(window._libRenderIndex, window._libRenderIndex + window._libRenderChunk);
      var grid = $('albums-grid');
      var fragment = document.createDocumentFragment();
      chunk.forEach(function (album) {
        var card = document.createElement('div'); card.className = 'album-card' + (isAlbumActive(album) ? ' playing' : '');
        var active = isAlbumActive(album);
        var wave = active && state.isPlaying ? '<div class="now-playing-bars" style="position:absolute;bottom:6px;left:6px;"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>' : '';
        var playBtnIcon = active && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
        var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
        var cov = album.cover ? '<img src="' + esc(album.cover) + '" alt="cover"' + lazy + ' />' : '<i class="ph ph-music-notes"></i>';
        card.innerHTML = '<div class="album-card-img-wrapper" style="position:relative;">' + cov + wave + '<div class="album-card-play-btn" data-album="' + encodeURIComponent(album.name) + '"><i class="' + playBtnIcon + '"></i></div></div><div class="album-card-info"><div class="album-card-title" title="' + esc(album.name) + '">' + esc(album.name) + '</div><div class="album-card-artist">' + esc(album.artist) + '</div></div>';
        if (album.cover) {
          var wrapper = card.querySelector('.album-card-img-wrapper');
          if (wrapper) wrapper.style.setProperty('--cover-bg', 'url("' + album.cover.replace(/"/g, '\\"') + '")');
        }
        card.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          window.currentContextMenuAlbum = album;
          hideAllContextMenus();
          positionContextMenu($('album-context-menu'), e.clientX, e.clientY);
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
          if (state.isShuffle) buildShuffleQueue();
          playTrack(state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks[0]);
        });
        card.addEventListener('click', function () {
          if (isMultiSelectMode) {
            if (selectedAlbumsForEdit.has(album.id)) selectedAlbumsForEdit.delete(album.id);
            else selectedAlbumsForEdit.add(album.id);
            renderLibrary();
            updateMultiSelectControls();
            return;
          }
          pushNav('album:' + album.id);
          renderAlbumDetail(album);
        });
        if (typeof isMultiSelectMode !== 'undefined' && isMultiSelectMode && selectedAlbumsForEdit.has(album.id)) {
          card.style.border = '2px solid var(--accent)';
          card.style.transform = 'scale(0.95)';
          card.style.opacity = '0.8';
        }
        fragment.appendChild(card);
      });
      grid.appendChild(fragment);
      window._libRenderIndex += window._libRenderChunk;
      if (window._libRenderAll && window._libRenderIndex < window._libAlbumsToRender.length) {
        window._libRenderFrame = requestAnimationFrame(function () {
          if (window._libRenderToken === renderToken) window.renderLibraryChunk();
        });
      }
    };
  }
  window.renderLibraryChunk();
}


// FIX 5+6: renderAlbumDetail resets scroll, correct play button
async function renderAlbumDetail(album, focusFilePath) {
  var ca = $('content-area');
  if (state.currentView === 'library') {
    state.libraryScrollPos = ca ? ca.scrollTop : 0;
  }

  state.currentView = 'album:' + (album.id || album.name);
  // FIX 5: scroll reset
  if (ca) ca.scrollTop = 0;
  var c1 = $('albums-grid-container'); if(c1) c1.style.display = 'none';
  var c2 = $('home-dashboard-container'); if(c2) c2.style.display = 'none';
  var c3 = $('search-albums-container'); if(c3) c3.style.display = 'none';
  var c4 = $('playlists-grid-container'); if(c4) c4.style.display = 'none';
  var c5 = $('tracks-table-container'); if(c5) c5.style.display = 'block'; 
  var c6 = $('album-detail-header'); if(c6) c6.style.display = 'flex';
  var detailWrap = $('album-detail-cover-wrap'); if (detailWrap) detailWrap.style.display = '';
  var c7 = $('playlist-controls-container'); if(c7) c7.style.display = 'none';
  $('album-detail-type').textContent = 'Album'; $('album-detail-title').textContent = album.name;
  var metaEl = $('album-detail-meta'); metaEl.textContent = '';
  if (album.tracks && album.tracks.length > 0) {
    $('album-detail-artist').textContent = album.artist;
    var meta = await window.api.getMetadata(album.tracks[0].filePath);

    // Prevent race conditions if user navigates away while awaiting
    if (state.currentView !== ('album:' + (album.id || album.name))) return;

    if (meta) {
      var arr = [];
      if (meta.genre) {
        if (Array.isArray(meta.genre)) arr.push(meta.genre.join(', '));
        else arr.push(meta.genre);
      }
      if (meta.codec) arr.push(String(meta.codec).toUpperCase()); else arr.push('MP3');
      if (meta.sampleRate) arr.push((meta.sampleRate / 1000) + ' kHz');
      if (meta.bitrate) arr.push(Math.round(meta.bitrate / 1000) + 'k');
      var rgReady = album.tracks.filter(function (f) { return f.replayGainTrackDb !== null && f.replayGainTrackDb !== undefined; }).length;
      arr.push('ReplayGain ' + rgReady + '/' + album.tracks.length);
      var str = arr.join(' • ');
      if (meta.year) str = meta.year + ' • ' + str;
      metaEl.textContent = str;
    }
  } else { $('album-detail-artist').textContent = album.artist; }

  $('album-edit-metadata-btn').style.display = 'flex';

  var cov = $('album-detail-cover'); cov.src = album.cover || ''; cov.style.display = album.cover ? 'block' : 'none'; cov.style.cursor = 'default'; cov.onclick = null;
  state.currentTracks = getSortedAlbumTracks(album).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
  clearTrackTableFilter();
  // FIX 6: play btn state
  var ppb = $('album-cover-play-btn');
  if (ppb) {
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
      if (state.isShuffle) buildShuffleQueue();
      playTrack(state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks[0]);
    };
  }
  renderTracksTable(false);
  if (focusFilePath) focusTrackInTable(focusFilePath);
}

function focusTrackInTable(filePath) {
  var target = stripFileUrl(filePath || '') || filePath;
  if (!target) return;
  var attempts = 0;
  function findAndFocus() {
    attempts++;
    var row = document.querySelector('#tracks-body tr[data-file-path="' + CSS.escape(target) + '"]');
    if (!row && window.renderTracksChunk && window._tracksToRender && window._tracksRenderIndex < window._tracksToRender.length && attempts < 80) {
      window.renderTracksChunk();
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
  // FIX 5: scroll reset
  var ca = $('content-area'); if (ca) ca.scrollTop = 0;
  $('view-title').style.display = 'none';
  $('playlist-controls-container').style.display = 'none';
  $('album-detail-meta').textContent = '';
  $('album-edit-metadata-btn').style.display = 'none';

  if (playlistId === 'liked_songs') {
    $('view-title').textContent = 'Liked Songs';
    $('album-detail-header').style.display = 'flex';
    $('album-detail-type').textContent = 'Playlist';
    $('album-detail-title').textContent = 'Liked Songs';
    $('album-detail-artist').textContent = state.likedSongs.length + ' tracks';
    $('album-detail-meta').textContent = 'Sorted like your playlists';
    $('album-edit-metadata-btn').style.display = 'none';
    var likedWrap = $('album-detail-cover-wrap'); if (likedWrap) likedWrap.style.display = 'none';
    $('playlist-controls-container').style.display = 'flex';
    $('playlist-track-search').value = '';
    clearTrackTableFilter();
    var likedSel = $('playlist-sort-select');
    if (likedSel) {
      likedSel.value = appSettings.likedSongsSortBy || 'Recently Added';
      likedSel.onchange = async function () { appSettings.likedSongsSortBy = likedSel.value; await window.api.saveSettings(appSettings); renderPlaylist('liked_songs'); };
    }
    var likedSortDirBtn = $('playlist-sort-dir-btn');
    if (likedSortDirBtn) {
      var likedAsc = appSettings.likedSongsSortAscending !== false;
      likedSortDirBtn.innerHTML = likedAsc ? '<i class="ph ph-sort-ascending"></i>' : '<i class="ph ph-sort-descending"></i>';
      likedSortDirBtn.onclick = async function () {
        appSettings.likedSongsSortAscending = !(appSettings.likedSongsSortAscending !== false);
        await window.api.saveSettings(appSettings);
        renderPlaylist('liked_songs');
      };
    }
    var byPath = getLibraryIndex().byStrippedPath;
    var likedFiles = state.likedSongs.map(function (fp) { return byPath.get(stripFileUrl(fp)); }).filter(Boolean);
    var sortBy = appSettings.likedSongsSortBy || 'Recently Added';
    var dir = appSettings.likedSongsSortAscending !== false ? 1 : -1;
    if (sortBy === 'Title') likedFiles.sort(function (a, b) { return (a.title || '').localeCompare(b.title || '') * dir; });
    else if (sortBy === 'Artist') likedFiles.sort(function (a, b) { return (a.artist || '').localeCompare(b.artist || '') * dir; });
    else if (sortBy === 'Album') likedFiles.sort(function (a, b) { return (a.album || '').localeCompare(b.album || '') * dir; });
    else if (sortBy === 'Recently Added') { if (dir === 1) likedFiles.reverse(); }
    state.currentTracks = likedFiles.map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
    renderTracksTable(false); return;
  }
  var pl = state.playlists.find(function (p) { return p.id === playlistId; }); if (!pl) return;
  $('album-detail-header').style.display = 'flex'; $('album-detail-type').textContent = 'Playlist';
  var plWrap = $('album-detail-cover-wrap'); if (plWrap) plWrap.style.display = '';
  $('playlist-controls-container').style.display = 'flex';
  $('playlist-track-search').value = ''; // clear search when opening a new playlist
  clearTrackTableFilter();
  var sel = $('playlist-sort-select'); if (sel) { sel.value = pl.sortBy || 'Custom Order'; sel.onchange = async function () { pl.sortBy = sel.value; await window.api.savePlaylists(state.playlists); renderPlaylist(pl.id); }; }
  var sortDirBtn = $('playlist-sort-dir-btn');
  if (sortDirBtn) {
    sortDirBtn.innerHTML = appSettings.sortAscending !== false ? '<i class="ph ph-sort-ascending"></i>' : '<i class="ph ph-sort-descending"></i>';
    sortDirBtn.onclick = async function () {
      appSettings.sortAscending = !(appSettings.sortAscending !== false);
      sortDirBtn.innerHTML = appSettings.sortAscending ? '<i class="ph ph-sort-ascending"></i>' : '<i class="ph ph-sort-descending"></i>';
      await window.api.saveSettings(appSettings);
      renderPlaylist(pl.id);
    };
  }

  $('album-detail-title').textContent = pl.name; $('album-detail-artist').textContent = pl.tracks.length + ' tracks';

  var sortedTracks = pl.tracks.slice();
  var dir = appSettings.sortAscending !== false ? 1 : -1;
  if (pl.sortBy === 'Title') { sortedTracks.sort((a, b) => (a.Song || a.title || '').localeCompare(b.Song || b.title || '') * dir); }
  else if (pl.sortBy === 'Artist') { sortedTracks.sort((a, b) => (a.Artist || a.artist || '').localeCompare(b.Artist || b.artist || '') * dir); }
  else if (pl.sortBy === 'Album') { sortedTracks.sort((a, b) => (a.Album || '').localeCompare(b.Album || '') * dir); }
  else if (pl.sortBy === 'Recently Added') { if (dir === 1) sortedTracks.reverse(); } // Custom/Recent usually reverse means oldest first


  state.currentTracks = sortedTracks.map(function (r) {
    var sn = r.Song || r.title || '', an = r.Artist || r.artist || '', al = r.Album || r.album || '', m = findMatchingFile(sn, an, al, getPlaylistTrackFilePath(r));
    return { csvRecord: r, matchedFile: m, title: sn, artist: an, album: r.Album || (m ? m.album : '-'), duration: m ? m.duration : 0, isDisabled: !m };
  });
  // FIX 3: auto cover from first matched track
  var firstCover = null;
  for (var i = 0; i < state.currentTracks.length; i++) { if (state.currentTracks[i].matchedFile && state.currentTracks[i].matchedFile.picture) { firstCover = state.currentTracks[i].matchedFile.picture; break; } }
  var cover = pl.cover || firstCover;
  var covEl = $('album-detail-cover'), wrap = $('album-detail-cover-wrap');
  if (cover) { covEl.src = cover; covEl.style.display = 'block'; } else { covEl.style.display = 'none'; if (wrap) wrap.style.background = pl.color || '#333'; }
  covEl.style.cursor = 'pointer';
  covEl.onclick = async function () { var img = await window.api.openImage(); if (img) { pl.cover = img; await window.api.savePlaylists(state.playlists); renderSidebarPlaylists(); renderPlaylist(pl.id); } };
  var ppb = $('album-cover-play-btn');
  if (ppb) ppb.onclick = function () { initAudioCtx(); state.playQueueTracks = state.currentTracks.slice(); state.shuffleQueue = []; if (state.isShuffle) buildShuffleQueue(); var first = state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks.find(function (t) { return !t.isDisabled; }); if (first) playTrack(first); };
  // lastPlayed is NOT updated here, only when a track actually plays
  renderSidebarPlaylists();
  renderTracksTable(playlistId.startsWith('pl_'));
}

function clearTrackTableFilter() {
  window._tracksFilterValue = '';
  window._tracksFilterView = '';
}

function trackTableFilterValue() {
  if (window._tracksFilterView !== state.currentView) return '';
  return String(window._tracksFilterValue || '').toLowerCase().trim();
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
  return key && window._playlistMembership ? (window._playlistMembership.get(key) || []) : [];
}

function getTrackRowFromEventTarget(target) {
  var row = target && target.closest ? target.closest('tr[data-track-index]') : null;
  var tbody = $('tracks-body');
  return row && tbody && row.parentNode === tbody ? row : null;
}

function getTrackFromTableRow(row) {
  var index = row ? parseInt(row.dataset.trackIndex, 10) : NaN;
  return !isNaN(index) && window._tracksSource ? window._tracksSource[index] : null;
}

function openTrackContextMenu(track, x, y) {
  if (!track) return;
  currentContextMenuTrack = track;
  hideAllContextMenus();
  updateTrackContextDownloadState(track);
  positionContextMenu($('track-context-menu'), x, y);
}

function toggleTrackLike(filePath, iconEl) {
  if (!filePath) return;
  var likedSet = new Set(state.likedSongs);
  if (likedSet.has(filePath)) state.likedSongs = state.likedSongs.filter(function (p) { return p !== filePath; });
  else state.likedSongs.push(filePath);
  window._likedSongsSet = new Set(state.likedSongs);
  localStorage.setItem('likedSongs', JSON.stringify(state.likedSongs));
  var liked = window._likedSongsSet.has(filePath);
  if (iconEl) iconEl.className = liked ? 'ph-fill ph-heart track-like-btn' : 'ph ph-heart track-like-btn';
  if (state.currentPlayingTrack && state.currentPlayingTrack.matchedFile && state.currentPlayingTrack.matchedFile.filePath === filePath) updatePlayerUI();
  if (state.currentView === 'liked_songs') renderPlaylist('liked_songs');
}

function showTrackPlaylistsMenu(track, x, y) {
  var menu = $('track-playlists-menu');
  var list = $('track-playlists-list');
  if (!menu || !list) return;
  var inPlaylists = getTrackPlaylistMembership(track);
  list.innerHTML = '';
  var fragment = document.createDocumentFragment();
  inPlaylists.forEach(function (p) {
    var item = document.createElement('div');
    item.className = 'menu-item';
    item.innerHTML = '<i class="ph ph-music-notes" style="margin-right:8px;color:var(--text-subdued);"></i>' + esc(p.name);
    item.onclick = function () { hideAllContextMenus(); pushNav(p.id); renderPlaylist(p.id); };
    fragment.appendChild(item);
  });
  list.appendChild(fragment);
  hideAllContextMenus();
  positionContextMenu(menu, x, y);
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
    showTrackPlaylistsMenu(playlistTrack, e.clientX, e.clientY);
    return;
  }

  var optionsBtn = e.target.closest ? e.target.closest('.track-options-btn') : null;
  if (optionsBtn) {
    var optionsRow = getTrackRowFromEventTarget(optionsBtn);
    e.stopPropagation();
    openTrackContextMenu(getTrackFromTableRow(optionsRow), e.clientX, e.clientY);
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
  state.playQueueTracks = (window._tracksSource || state.currentTracks).slice();
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
  openTrackContextMenu(track, e.clientX, e.clientY);
}

function handleTrackTableDragStart(e) {
  var row = getTrackRowFromEventTarget(e.target);
  var track = getTrackFromTableRow(row);
  if (!track || track.isDisabled || !e.dataTransfer) { e.preventDefault(); return; }
  e.dataTransfer.setData('text/plain', JSON.stringify({ title: track.title, artist: track.artist, album: track.album }));
  if (window._tracksAllowReorder) e.dataTransfer.setData('reorder-index', row.dataset.trackIndex);
  row.style.opacity = '0.5';
}

function handleTrackTableDragEnd(e) {
  var row = getTrackRowFromEventTarget(e.target);
  if (row) row.style.opacity = '';
}

function handleTrackTableDragOver(e) {
  if (!window._tracksAllowReorder) return;
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
  if (!window._tracksAllowReorder) return;
  var row = getTrackRowFromEventTarget(e.target);
  if (!row || !e.dataTransfer) return;
  e.preventDefault();
  row.classList.remove('drag-over');
  var fromIndex = parseInt(e.dataTransfer.getData('reorder-index'), 10);
  var toIndex = parseInt(row.dataset.trackIndex, 10);
  if (isNaN(fromIndex) || isNaN(toIndex) || fromIndex === toIndex) return;
  var pl = state.playlists.find(function (p) { return p.id === state.currentView; });
  if (!pl) return;
  var moved = pl.tracks.splice(fromIndex, 1)[0];
  pl.tracks.splice(toIndex, 0, moved);
  pl.sortBy = 'Custom Order';
  await window.api.savePlaylists(state.playlists);
  renderPlaylist(state.currentView);
}

function ensureTrackTableDelegation(tbody) {
  if (!tbody || tbody._trackTableDelegated) return;
  tbody._trackTableDelegated = true;
  tbody.addEventListener('click', handleTrackTableClick);
  tbody.addEventListener('dblclick', handleTrackTableDblClick);
  tbody.addEventListener('contextmenu', handleTrackTableContextMenu);
  tbody.addEventListener('dragstart', handleTrackTableDragStart);
  tbody.addEventListener('dragend', handleTrackTableDragEnd);
  tbody.addEventListener('dragover', handleTrackTableDragOver);
  tbody.addEventListener('dragleave', handleTrackTableDragLeave);
  tbody.addEventListener('drop', handleTrackTableDrop);
}

function renderTracksTable(allowReorder) {
  var tbody = $('tracks-body');
  if (!tbody) return;
  ensureTrackTableDelegation(tbody);
  tbody.innerHTML = '';
  var source = state.currentTracks || [];
  window._tracksSource = source;
  window._tracksRenderToken = (window._tracksRenderToken || 0) + 1;
  if (!source.length) {
    window._tracksToRender = [];
    window._trackRowsToRender = [];
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-subdued);">No tracks</td></tr>';
    return;
  }
  var filterValue = trackTableFilterValue();
  var tableRows = buildTrackRowsForTable(source, filterValue);
  window._tracksToRender = tableRows.map(function (entry) { return entry.track; });
  window._trackRowsToRender = tableRows;
  window._tracksRenderIndex = 0;
  window._tracksRenderChunk = appSettings.virtualScrolling ? 60 : tableRows.length;
  window._tracksAllowReorder = allowReorder;
  window._likedSongsSet = new Set(state.likedSongs);
  window._playlistMembership = buildPlaylistMembershipMap();
  if (!tableRows.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-subdued);">No matching tracks</td></tr>';
    return;
  }

  if (!window.renderTracksChunk) {
    window.renderTracksChunk = function(renderToken) {
      if (renderToken !== undefined && renderToken !== window._tracksRenderToken) return;
      if (!window._trackRowsToRender || window._tracksRenderIndex >= window._trackRowsToRender.length) return;
      var activeToken = window._tracksRenderToken;
      var rows = window._trackRowsToRender;
      var chunk = rows.slice(window._tracksRenderIndex, window._tracksRenderIndex + window._tracksRenderChunk);
      var tbody = $('tracks-body');
      if (!tbody) return;
      var fragment = document.createDocumentFragment();
      chunk.forEach(function (entry, i) {
        var renderIndex = window._tracksRenderIndex + i;
        var track = entry.track;
        var sourceIndex = entry.sourceIndex;
        var tr = document.createElement('tr');
        tr.dataset.trackIndex = String(sourceIndex);
        if (track.matchedFile && track.matchedFile.filePath) tr.dataset.filePath = stripFileUrl(track.matchedFile.filePath) || track.matchedFile.filePath;
        var selectionKey = getTrackSelectionKey(track);
        if (selectionKey && selectedTrackKeys.has(selectionKey)) tr.classList.add('track-selected');
        if (track.isDisabled) tr.classList.add('disabled');
        else { tr.style.cursor = 'pointer'; tr.draggable = true; }
        if (state.currentPlayingTrack && state.currentPlayingTrack.matchedFile && track.matchedFile && state.currentPlayingTrack.matchedFile.filePath === track.matchedFile.filePath) tr.classList.add('playing');
        var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
        var pic = track.matchedFile && track.matchedFile.picture ? '<img src="' + esc(track.matchedFile.picture) + '"' + lazy + ' class="track-img" />' : '<div class="track-img" style="display:flex;align-items:center;justify-content:center;"><i class="ph ph-music-notes" style="color:var(--text-subdued);"></i></div>';
        var fp = track.matchedFile ? track.matchedFile.filePath : '';
        var liked = fp ? window._likedSongsSet.has(fp) : false;
        var inPlaylists = getTrackPlaylistMembership(track);
        var discNo = track.matchedFile ? getDiscNumber(track.matchedFile) : 1;
        var hasMultipleDiscs = state.currentView && state.currentView.startsWith('album:') && albumHasMultipleDiscs(state.currentTracks);
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
        tr.innerHTML = '<td style="width:20px;padding-left:8px;">' + (window._tracksAllowReorder ? '<i class="ph ph-dots-six-vertical drag-handle"></i>' : '') + '</td>'
          + '<td class="col-num">' + displayNo + '</td>'
          + '<td class="col-title"><div class="track-info">' + pic + '<div class="track-text"><div class="title">' + esc(track.title) + '<i class="' + (liked ? 'ph-fill ph-heart' : 'ph ph-heart') + ' track-like-btn" data-fp="' + esc(fp) + '" style="color:var(--accent);margin-left:8px;cursor:pointer;"></i>' + (inPlaylists.length > 0 ? '<i class="ph-fill ph-check-circle track-in-pl-btn" style="color:var(--accent);margin-left:8px;cursor:pointer;" title="In Playlists"></i>' : '') + '</div><div class="artist">' + esc(track.artist) + '</div></div></div></td>'
          + '<td class="col-album">' + esc(track.album) + '</td>'
          + '<td class="col-duration">' + fmt(track.duration) + '</td>'
          + '<td style="width:40px;text-align:center;"><button class="icon-btn ghost track-options-btn"><i class="ph ph-dots-three"></i></button></td>';
        fragment.appendChild(tr);
      });
      if (activeToken !== window._tracksRenderToken) return;
      tbody.appendChild(fragment);
      window._tracksRenderIndex += window._tracksRenderChunk;
    };
  }
  window.renderTracksChunk(window._tracksRenderToken);
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
  return { gainDb: gainDb, peak: peak };
}

async function analyzeLoudnessForFiles(files) {
  files = (files || []).filter(function (f) { return f && f.filePath; });
  if (!files.length) return;
  document.body.style.cursor = 'wait';
  var oldTitle = $('view-title') ? $('view-title').textContent : '';
  try {
    for (var i = 0; i < files.length; i++) {
      if (files.length > 1) $('view-title').textContent = 'Analyzing loudness ' + (i + 1) + '/' + files.length;
      await analyzeTrackLoudness(files[i]);
    }
    markLibraryDirty();
    await window.api.saveLibrary(state.musicFiles);
    if (state.currentView === 'metadata_health') renderMetadataHealthView();
    alert('Loudness analysis complete for ' + files.length + ' track(s).');
  } catch (e) {
    console.error(e);
    alert('Loudness analysis failed: ' + (e.message || e));
  } finally {
    document.body.style.cursor = '';
    if ($('view-title') && oldTitle) $('view-title').textContent = oldTitle;
  }
}

async function analyzeReplayGainBatch(files, batchSize) {
  batchSize = batchSize || 25;
  files = (files || []).filter(function (f) { return f && f.filePath && (f.replayGainTrackDb === null || f.replayGainTrackDb === undefined); }).slice(0, batchSize);
  if (!files.length) { alert('No missing ReplayGain tracks in this batch.'); return; }
  document.body.style.cursor = 'wait';
  var oldTitle = $('view-title') ? $('view-title').textContent : '';
  try {
    for (var i = 0; i < files.length; i++) {
      if ($('view-title')) $('view-title').textContent = 'Analyzing ReplayGain batch ' + (i + 1) + '/' + files.length;
      await analyzeTrackLoudness(files[i]);
      await new Promise(function (resolve) { setTimeout(resolve, 20); });
    }
    markLibraryDirty();
    await window.api.saveLibrary(state.musicFiles);
    if (state.currentView === 'metadata_health') renderMetadataHealthView();
    alert('Analyzed ' + files.length + ' track(s). Click Batch Analyze again for the next batch.');
  } catch (e) {
    console.error(e);
    alert('ReplayGain batch failed: ' + (e.message || e));
  } finally {
    document.body.style.cursor = '';
    if ($('view-title') && oldTitle && state.currentView !== 'metadata_health') $('view-title').textContent = oldTitle;
  }
}

async function analyzeAllMissingReplayGain() {
  var allMissing = state.musicFiles.filter(function (f) { return f && f.filePath && (f.replayGainTrackDb === null || f.replayGainTrackDb === undefined); });
  if (!allMissing.length) { alert('No missing ReplayGain tracks found.'); return; }
  if (!confirm('Analyze ReplayGain for ' + allMissing.length + ' missing track(s)?\n\nThis runs in batches and may take a while for large libraries.')) return;
  var batchSize = 25;
  var done = 0;
  document.body.style.cursor = 'wait';
  try {
    while (true) {
      var batch = state.musicFiles.filter(function (f) { return f && f.filePath && (f.replayGainTrackDb === null || f.replayGainTrackDb === undefined); }).slice(0, batchSize);
      if (!batch.length) break;
      for (var i = 0; i < batch.length; i++) {
        done++;
        if ($('view-title')) $('view-title').textContent = 'Analyzing ReplayGain ' + done + '/' + allMissing.length;
        await analyzeTrackLoudness(batch[i]);
        await new Promise(function (resolve) { setTimeout(resolve, 20); });
      }
      markLibraryDirty();
      await window.api.saveLibrary(state.musicFiles);
      if (state.currentView === 'metadata_health') renderMetadataHealthView();
      await new Promise(function (resolve) { setTimeout(resolve, 60); });
    }
    if (state.currentView === 'metadata_health') renderMetadataHealthView();
    alert('ReplayGain analysis complete for ' + done + ' track(s).');
  } catch (e) {
    console.error(e);
    alert('ReplayGain analysis failed: ' + (e.message || e));
  } finally {
    document.body.style.cursor = '';
    if ($('view-title') && state.currentView === 'metadata_health') $('view-title').textContent = 'Tag Health';
  }
}

async function playTrack(track) {
  if (!track || !track.matchedFile) return;
  state.currentPlayingTrack = track;
  state._lastStatsTime = null;
  state.playHistory.push(track); if (state.playHistory.length > 50) state.playHistory.shift();
  appSettings.lastTrack = track;
  appSettings.playHistory = state.playHistory;
  // Save queue as array of filePaths for restoration on next launch
  appSettings.savedQueue = state.playQueueTracks.map(function(t) { return t.matchedFile ? t.matchedFile.filePath : null; }).filter(Boolean);
  var curIdx = state.playQueueTracks.indexOf(track);
  appSettings.savedQueueIndex = curIdx >= 0 ? curIdx : 0;
  saveSettingsDebounced(500);

  if (state.isShuffle && (!state.shuffleQueue.length || !state.shuffleQueue.includes(track))) {
    buildShuffleQueue();
    var idx = state.shuffleQueue.indexOf(track);
    if (idx > -1) {
      state.shuffleQueue.splice(idx, 1);
      state.shuffleQueue.unshift(track);
    }
  }

  // Update lastPlayed for the active playlist when a track plays
  if (state.currentView && state.currentView.startsWith('pl_')) {
    var activePl = state.playlists.find(function (p) { return p.id === state.currentView; });
    if (activePl) { activePl.lastPlayed = new Date().toISOString(); window.api.savePlaylists(state.playlists); renderSidebarPlaylists(); }
  } else if (state.currentView === 'liked_songs') {
    localStorage.setItem('likedSongsLastPlayed', new Date().toISOString());
    renderSidebarPlaylists();
  }
  var cfDuration = appSettings.crossfade ? parseInt(appSettings.crossfade) : 0;
  var prevAudio = window.audioEls ? window.audioEls[activeAudioIdx] : $('audio-player-0');
  var prevGain = window.audioGainNodes ? window.audioGainNodes[activeAudioIdx] : null;

  if (typeof activeAudioIdx === 'undefined') window.activeAudioIdx = 0;
  activeAudioIdx = 1 - activeAudioIdx;

  if (!window.audioEls) window.audioEls = [$('audio-player-0'), $('audio-player-1')];
  var nextAudio = window.audioEls[activeAudioIdx];
  var nextGain = window.audioGainNodes ? window.audioGainNodes[activeAudioIdx] : null;
  var targetGain = getNormalizationGain(track);

  nextAudio.src = toFileUrl(track.matchedFile.filePath);

  var didStartPlayback = false;
  try {
    state.isPlaying = true;
    state.crossfadingNext = false;
    if (cfDuration > 0 && prevAudio && !prevAudio.paused && audioCtx && nextGain && prevGain) {
      nextGain.gain.cancelScheduledValues(audioCtx.currentTime);
      nextGain.gain.setValueAtTime(0, audioCtx.currentTime);
      await nextAudio.play();
      didStartPlayback = true;
      nextGain.gain.linearRampToValueAtTime(targetGain, audioCtx.currentTime + cfDuration);

      prevGain.gain.cancelScheduledValues(audioCtx.currentTime);
      prevGain.gain.setValueAtTime(prevGain.gain.value, audioCtx.currentTime);
      prevGain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + cfDuration);

      setTimeout(function () { if (prevAudio && prevAudio !== window.audioEls[activeAudioIdx]) prevAudio.pause(); }, cfDuration * 1000);
    } else {
      if (nextGain) nextGain.gain.value = targetGain;
      if (prevAudio && prevAudio !== nextAudio) prevAudio.pause();
      await nextAudio.play();
      didStartPlayback = true;
    }
  } catch (e) { console.error(e); state.isPlaying = false; }

  if (didStartPlayback) recordPlayStat(track);
  updatePlayerUI();
  if (window.api.updateThumbar) window.api.updateThumbar(state.isPlaying);
  if (state.isPlaying && analyserNode && !visualizerFrame) drawVisualizer();
  renderTracksTable(state.currentView && state.currentView.startsWith('pl_'));
  // FIX 6: refresh library card icons if library is visible
  if (state.currentView === 'library') renderLibrary();
  else if (state.currentView && state.currentView.startsWith('album:')) {
    var ppb = $('album-cover-play-btn');
    if (ppb) {
      var icon = ppb.querySelector('i');
      if (icon) icon.className = 'ph-fill ph-pause';
    }
  }
  if (isQueueOpen) renderQueue();
  if (lyricsOpen) fetchLyricsForTrack(track);
  if (npOverlayOpen) { updateNowPlayingOverlay(); fetchLyricsForTrack(track).then(function () { mirrorLyricsToNP(); }); }
  // Discord Rich Presence
  if (appSettings.discordRpc && window.api.discordUpdate) {
    window.api.discordUpdate(track.title, track.artist, track.album, Date.now());
  }
  // Album cover slideshow: scan folder for extra images
  if (track.matchedFile && track.matchedFile.filePath) {
    var trackFolder = track.matchedFile.filePath.replace(/[^\\/\\\\]+$/, '');
    window.api.scanFolderImages(trackFolder).then(function (imgs) {
      state.npSlideImages = imgs;
      state.npSlideIdx = 0;
      startNPSlideshow();
    });
  }
  if (appSettings.notifications !== false) {
    if (Notification.permission === 'granted') new Notification(track.title, { body: track.artist, silent: true });
    else if (Notification.permission !== 'denied') Notification.requestPermission().then(function (p) { if (p === 'granted') new Notification(track.title, { body: track.artist, silent: true }); });
  }

  triggerLastfmScrobbleCycle(track);

}

function triggerLastfmScrobbleCycle(track) {
  if (appSettings.lastfmSessionKey) {
    window.api.lastfmUpdateNowPlaying(appSettings.lastfmSessionKey, track.artist, track.title, appSettings.lastfmApiKey, appSettings.lastfmSharedSecret);
    clearTimeout(state.scrobbleTimer);
    var scrobbleStartTime = Math.floor(Date.now() / 1000);
    var msToScrobble = Math.min((track.duration || 120) * 1000 / 2, 240000); // 50% or 4 minutes
    state.scrobbleTimer = setTimeout(function () {
      if (state.currentPlayingTrack === track) {
        window.api.lastfmScrobble(appSettings.lastfmSessionKey, track.artist, track.title, scrobbleStartTime, appSettings.lastfmApiKey, appSettings.lastfmSharedSecret);
      }
    }, Math.max(msToScrobble, 10000)); // at least 10s
  }
}

async function togglePlay() {
  var audio = window.audioEls ? window.audioEls[activeAudioIdx] : $('audio-player-0');
  if (!state.currentPlayingTrack) return;
  initAudioCtx();
  if (!audio.src || audio.src.endsWith(window.location.pathname) || audio.src === '') {
    if (state.currentPlayingTrack.matchedFile && state.currentPlayingTrack.matchedFile.filePath) {
      audio.src = toFileUrl(state.currentPlayingTrack.matchedFile.filePath);
    }
  }
  if (state.isPlaying) {
    audio.pause();
    state.isPlaying = false;
  } else {
    try {
      await audio.play();
      state.isPlaying = true;
    } catch (e) {
      console.error(e);
      state.isPlaying = false;
    }
  }
  updatePlayerUI();
  if (window.api.updateThumbar) window.api.updateThumbar(state.isPlaying);
  if (state.isPlaying && analyserNode && !visualizerFrame) drawVisualizer();
  if (state.currentView === 'library') renderLibrary();
  if (npOverlayOpen) updateNowPlayingOverlay();
}
// shuffleMode: 0=off, 1=random shuffle, 2=smart shuffle (no same-artist back-to-back, avoid recent)
function buildSmartShuffleQueue() {
  var tracks = state.playQueueTracks.filter(function(t) { return !t.isDisabled; });
  if (!tracks.length) { state.shuffleQueue = []; return; }
  // Group by artist
  var byArtist = {};
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
  var maxIter = tracks.length * 3;
  while (result.length < tracks.length && maxIter-- > 0) {
    for (var i = 0; i < artistQueues.length && result.length < tracks.length; i++) {
      if (artistQueues[i].length > 0) {
        var candidate = artistQueues[i][0];
        var lastArtist = result.length > 0 ? (result[result.length-1].artist||'').toLowerCase() : '';
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
  // Cycle: 0=off → 1=shuffle → 2=smart shuffle → 0=off
  state.shuffleMode = ((state.shuffleMode || 0) + 1) % 3;
  state.isShuffle = state.shuffleMode > 0;
  state.shuffleQueue = [];
  var icon = $('shuffle-icon');
  if (state.shuffleMode === 0) {
    // Off — remove smart badge
    if (icon) {
      icon.className = 'ph ph-shuffle';
      icon.style.color = '';
      icon.title = 'Shuffle';
      var btn0 = icon.closest('button');
      if (btn0) { var b0 = btn0.querySelector('.smart-shuffle-badge'); if (b0) b0.remove(); btn0.style.position = ''; }
    }
  } else if (state.shuffleMode === 1) {
    // Normal shuffle — remove smart badge if present
    buildShuffleQueue();
    if (icon) {
      icon.className = 'ph ph-shuffle';
      icon.style.color = 'var(--accent)';
      icon.title = 'Shuffle';
      var btn2 = icon.closest('button');
      if (btn2) { var b2 = btn2.querySelector('.smart-shuffle-badge'); if (b2) b2.remove(); btn2.style.position = ''; }
    }
  } else {
    // Smart shuffle — distinctive icon with star indicator
    buildSmartShuffleQueue();
    if (icon) {
      icon.className = 'ph ph-shuffle';
      icon.style.color = 'var(--accent)';
      icon.title = 'Smart Shuffle';
      // Add a small star badge to visually distinguish from normal shuffle
      var btn = icon.closest('button');
      if (btn) {
        btn.style.position = 'relative';
        var oldBadge = btn.querySelector('.smart-shuffle-badge');
        if (!oldBadge) {
          var badge = document.createElement('span');
          badge.className = 'smart-shuffle-badge';
          badge.textContent = '★';
          badge.style.cssText = 'position:absolute;top:0;right:0;font-size:9px;color:var(--accent);line-height:1;pointer-events:none;text-shadow:0 0 4px currentColor;';
          btn.appendChild(badge);
        }
      }
    }
  }
  if (isQueueOpen) renderQueue();
  syncMpris(false);
}
function cycleLoop() { state.loopMode = (state.loopMode + 1) % 3; $('loop-icon').className = state.loopMode === 2 ? 'ph ph-repeat-once' : 'ph ph-repeat'; $('loop-icon').style.color = state.loopMode > 0 ? 'var(--accent)' : ''; syncMpris(false); }

function playNextTrack() {
  if (state.userQueue && state.userQueue.length > 0) {
    playTrack(state.userQueue.shift());
    return;
  }
  var v = state.playQueueTracks.filter(function (t) { return !t.isDisabled; });
  if (state.isShuffle) {
    if (!state.shuffleQueue.length) buildShuffleQueue();
    var si = state.shuffleQueue.indexOf(state.currentPlayingTrack);
    if (si < state.shuffleQueue.length - 1) { playTrack(state.shuffleQueue[si + 1]); return; }
    if (state.loopMode >= 1) { buildShuffleQueue(); playTrack(state.shuffleQueue[0]); return; }
    state.isPlaying = false; updatePlayerUI(); return;
  }
  var i = v.indexOf(state.currentPlayingTrack);
  if (i < v.length - 1) { playTrack(v[i + 1]); return; }
  if (state.loopMode >= 1) { playTrack(v[0]); return; }
  state.isPlaying = false; updatePlayerUI();
}

function playPrevTrack() {
  var audio = window.audioEls ? window.audioEls[activeAudioIdx] : $('audio-player-0');
  if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
  // FIX 8: prev uses playHistory not queue
  if (state.playHistory.length > 1) {
    state.playHistory.pop();// remove current
    var prev = state.playHistory[state.playHistory.length - 1];
    if (prev) { state.playHistory.pop(); playTrack(prev); return; }
  }
  var v = state.playQueueTracks.filter(function (t) { return !t.isDisabled; });
  if (state.isShuffle) { var si = state.shuffleQueue.indexOf(state.currentPlayingTrack); if (si > 0) { playTrack(state.shuffleQueue[si - 1]); return; } }
  var i = v.indexOf(state.currentPlayingTrack);
  if (i > 0) { playTrack(v[i - 1]); return; }
  if (state.loopMode >= 1) playTrack(v[v.length - 1]);
}

function updatePlayerUI() {
  $('play-icon').className = state.isPlaying ? 'ph ph-pause-circle' : 'ph ph-play-circle';
  if (!state.currentPlayingTrack) { syncMpris(false); return; }
  var t = state.currentPlayingTrack;
  var liked = t.matchedFile ? state.likedSongs.includes(t.matchedFile.filePath) : false;
  $('now-playing-info').innerHTML = '<div class="cover-art' + (t.matchedFile && t.matchedFile.picture ? '' : ' placeholder') + '">' + (t.matchedFile && t.matchedFile.picture ? '' : '<i class="ph ph-music-notes"></i>') + '</div><div class="track-details"><div class="track-name">' + esc(t.title) + '</div><div class="track-artist">' + esc(t.artist) + '</div><div class="replaygain-chip" id="replaygain-status-chip">RG</div></div><button class="icon-btn ghost" id="btn-like"><i class="' + (liked ? 'ph-fill ph-heart' : 'ph ph-heart') + '" style="' + (liked ? 'color:var(--accent);' : '') + '"></i></button>';
  if (t.matchedFile && t.matchedFile.picture) { $('now-playing-info').querySelector('.cover-art').style.backgroundImage = 'url("' + t.matchedFile.picture.replace(/"/g, '\\"') + '")'; }
  updateReplayGainStatus(t);
  syncMpris(false);
  $('btn-like').addEventListener('click', function () {
    if (!t.matchedFile) return; var fp = t.matchedFile.filePath;
    if (state.likedSongs.includes(fp)) state.likedSongs = state.likedSongs.filter(function (p) { return p !== fp; }); else state.likedSongs.push(fp);
    localStorage.setItem('likedSongs', JSON.stringify(state.likedSongs));
    updatePlayerUI(); renderTracksTable(state.currentView.startsWith('pl_'));
  });
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

function openPlaylistContextMenu(pl, x, y) {
  currentContextMenuPlaylist = pl;
  var pinBtn = $('pctx-pin'); if (pinBtn) pinBtn.textContent = pl.pinned ? 'Unpin Playlist' : 'Pin Playlist';
  var downloadBtn = $('pctx-download-missing');
  if (downloadBtn) {
    var missingCount = pl && !pl.isSpecial ? getMissingPlaylistRows(pl).length : 0;
    downloadBtn.style.display = missingCount ? 'block' : 'none';
    downloadBtn.textContent = 'Download Missing Tracks' + (missingCount ? ' (' + missingCount + ')' : '') + '…';
  }
  hideAllContextMenus(); positionContextMenu($('playlist-context-menu'), x, y);
}

function buildColorPickers() {
  [$('cp-color-picker'), $('color-picker-swatches')].forEach(function (container) {
    if (!container) return; container.innerHTML = '';
    PALETTE.forEach(function (color) {
      var sw = document.createElement('div'); sw.className = 'color-swatch' + (color === cpSelectedColor && container.id === 'cp-color-picker' ? ' selected' : '');
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
document.addEventListener('click', function (e) {
  // Close if click is outside any context menu
  if (!e.target.closest('.context-menu')) hideAllContextMenus();
});
// Also close on any menu item click (items that don't open a sub-modal)
document.addEventListener('click', function (e) {
  var item = e.target.closest('.menu-item');
  if (!item) return;
  hideAllContextMenus();
});

var importFolderBtn = $('import-folder-btn');
if (importFolderBtn) importFolderBtn.addEventListener('click', async function () {
  var folderPath = await window.api.openFolder(); if (!folderPath) return;
  importFolderBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Preparing...'; importFolderBtn.disabled = true;
  window.api.onScanProgress(function (d) { if (d.total > 0) { var pct = Math.round((d.current / d.total) * 100); importFolderBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Scanning ' + pct + '%'; importFolderBtn.style.background = 'linear-gradient(90deg,rgba(var(--accent-rgb),.2) ' + pct + '%,transparent ' + pct + '%)'; } });
  try {
    var beforeMap = {};
    state.musicFiles.forEach(function (f) { if (f.filePath) beforeMap[f.filePath] = Object.assign({}, f); });
    var files = await window.api.scanFolder(folderPath, state.musicFiles);
    pushUndoSnapshot('Import folder');
    var libraryByPath = {};
    state.musicFiles.forEach(function (f) { if (f.filePath) libraryByPath[f.filePath] = f; });
    files.forEach(function (f) { if (f.filePath) libraryByPath[f.filePath] = f; });
    setMusicFiles(Object.values(libraryByPath)); await window.api.saveLibrary(state.musicFiles);
    var importSummary = buildImportReviewSummary(folderPath, files, beforeMap, state.musicFiles);
    importFolderBtn.innerHTML = '<i class="ph ph-check-circle"></i> Imported!'; importFolderBtn.style.background = 'transparent'; importFolderBtn.disabled = false;
    setTimeout(function () { importFolderBtn.innerHTML = '<i class="ph ph-folder-open"></i> Import Music Folder'; }, 3000);
    if (state.currentView === 'library') renderLibrary();
    showImportReview(importSummary);
  } catch (e) { console.error(e); importFolderBtn.disabled = false; }
});

var btnFastRescan = $('btn-fast-rescan');
async function doRescanFolder() {
  if (btnFastRescan) { btnFastRescan.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Rescanning...'; btnFastRescan.disabled = true; }

  if (state.musicFiles.length === 0) {
    alert('No folders in library to rescan. Import a folder first.');
    if (btnFastRescan) { btnFastRescan.innerHTML = '<i class="ph ph-arrows-clockwise"></i> Rescan Folder'; btnFastRescan.disabled = false; }
    return;
  }

  // Collect unique parent directories of all library files
  var dirs = new Set();
  state.musicFiles.forEach(function(f) {
    if (f.filePath) {
      // Use proper path separator-aware dirname
      var sep = f.filePath.includes('\\') ? '\\' : '/';
      var parts = f.filePath.split(sep);
      parts.pop(); // remove filename
      var dir = parts.join(sep);
      if (dir) dirs.add(dir);
    }
  });

  // Only scan top-level directories to avoid duplicate scans
  var dirArr = Array.from(dirs);
  var rootDirs = dirArr.filter(function(dir) {
    return !dirArr.some(function(other) {
      return dir !== other && (dir.startsWith(other + '\\') || dir.startsWith(other + '/'));
    });
  });

  window.api.onScanProgress(function(d) {
    if (d.total > 0 && btnFastRescan) {
      var pct = Math.round((d.current / d.total) * 100);
      btnFastRescan.innerHTML = '<i class="ph ph-spinner ph-spin"></i> ' + pct + '%';
    }
  });

  // Scan only NEW files — pass existing library so unchanged files are skipped
  var newLibrary = [];
  var skippedFolders = [];
  for (var i = 0; i < rootDirs.length; i++) {
    try {
      var res = await window.api.scanFolder(rootDirs[i], state.musicFiles);
      if (res && res.length) newLibrary = newLibrary.concat(res);
      else skippedFolders.push(rootDirs[i]);
    } catch(e){ console.error('Rescan error for', rootDirs[i], e); }
  }

  // Merge: deduplicate by filePath
  var map = {};
  state.musicFiles.forEach(function(f) { if (f.filePath) map[f.filePath] = f; });
  newLibrary.forEach(function(f) { map[f.filePath] = f; });
  setMusicFiles(Object.values(map));

  await window.api.saveLibrary(state.musicFiles);
  renderLibrary();

  if (skippedFolders.length > 0) {
    alert('Rescan skipped ' + skippedFolders.length + ' folder(s) that were missing, inaccessible, or had no audio files. Existing library entries were preserved.');
  }

  if (btnFastRescan) { btnFastRescan.innerHTML = '<i class="ph ph-arrows-clockwise"></i> Rescan Folder'; btnFastRescan.disabled = false; }
}
if (btnFastRescan) btnFastRescan.addEventListener('click', doRescanFolder);

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
    alert(msg);
  }
  return res;
}

var btnWriteFolderCovers = $('btn-write-folder-covers');
if (btnWriteFolderCovers) btnWriteFolderCovers.addEventListener('click', async function () {
  btnWriteFolderCovers.disabled = true;
  btnWriteFolderCovers.innerHTML = '<i class="ph ph-spinner ph-spin" style="margin-right:6px;"></i> Writing...';
  try { await writeCurrentFolderCovers(true); }
  finally {
    btnWriteFolderCovers.disabled = false;
    btnWriteFolderCovers.innerHTML = '<i class="ph ph-image-square" style="margin-right:6px;"></i> Write folder.jpg';
  }
});

var clearLibraryBtn = $('clear-library-btn');
if (clearLibraryBtn) clearLibraryBtn.addEventListener('click', async function () {
  if (confirm("Are you sure you want to clear your entire library? Your playlists will be preserved — only the music files list will be cleared.")) {
    pushUndoSnapshot('Clear library');
    setMusicFiles([]);
    // NOTE: playlists are intentionally NOT wiped — tracks remain so they can re-link after re-import
    await window.api.saveLibrary(state.musicFiles);
    // Playlists are already saved in their own file and are NOT touched here
    renderLibrary();
    renderSidebarPlaylists();
  }
});

function getImportTrackTitle(row) { return row ? (row.Song || row.title || row.Name || row.name || row.TITLE || '') : ''; }
function getImportTrackArtist(row) { return row ? (row.Artist || row.artist || row.ARTIST || '') : ''; }
function getImportTrackAlbum(row) { return row ? (row.Album || row.album || row.ALBUM || '') : ''; }
function buildPlaylistImportGroups(csvPath, data) {
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
  var name = String(csvPath || '').split(/[\\\/]/).pop().replace(/\.csv$/i, '') || 'Imported Playlist';
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
  if (row && row.__strictAlbumMatch) return findStrictAlbumMatch(row);
  return findMatchingFile(getImportTrackTitle(row), getImportTrackArtist(row), getImportTrackAlbum(row), getPlaylistTrackFilePath(row));
}
function isPlaylistRecordMissing(row) {
  return !findPlaylistRecordMatch(row);
}
function getMissingPlaylistRows(pl) {
  if (!pl || !Array.isArray(pl.tracks)) return [];
  return pl.tracks.filter(isPlaylistRecordMissing);
}
function getDownloadablePlaylistTracksFromContext() {
  var pl = getCurrentRegularPlaylist();
  if (!pl || !currentContextMenuTrack) return [];
  var key = getTrackSelectionKey(currentContextMenuTrack);
  var tracks = key && selectedTrackKeys.has(key) ? getSelectedCurrentTracks() : [currentContextMenuTrack];
  return tracks.filter(function (track) { return track && track.csvRecord && isPlaylistRecordMissing(track.csvRecord); });
}
function updateTrackContextDownloadState(track) {
  var rmBtn = $('ctx-remove-match');
  if (rmBtn) rmBtn.style.display = state.currentView.startsWith('pl_') && track && track.matchedFile ? 'block' : 'none';
  var gotoBtn = $('ctx-go-to-album');
  if (gotoBtn) gotoBtn.style.display = track && track.matchedFile ? 'block' : 'none';
  var dlBtn = $('ctx-download-track');
  if (dlBtn) {
    var rows = getDownloadablePlaylistTracksFromContext();
    dlBtn.style.display = rows.length ? 'block' : 'none';
    dlBtn.innerHTML = '<i class="ph ph-download-simple"></i> ' + (rows.length > 1 ? 'Download Selected Missing Tracks…' : 'Download Track…');
  }
}
function makeDownloadTrackPayload(row) {
  var payload = Object.assign({}, row || {});
  payload.title = getImportTrackTitle(row);
  payload.artist = getImportTrackArtist(row);
  payload.album = getImportTrackAlbum(row);
  payload.albumDate = row && (row['Album Date'] || row.AlbumDate || row.Year || row.year || '');
  payload.genre = row && (row.Genres || row.Genre || row.genre || '');
  payload.spotifyTrackId = row && (row['Spotify Track Id'] || row.SpotifyTrackId || '');
  payload.isrc = row && (row.ISRC || row.isrc || '');
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
  ['__downloadSelected', '__downloadStatus', '__downloadError', '__downloadCandidate', '__downloadCandidates', '__downloadCandidateManual', '__candidateLoading', '__candidateQueued', '__candidatePromise', '__candidateError', '__candidateNotice', '__candidateQueryCount'].forEach(function (key) { delete row[key]; });
}
function snapshotImportRowTransient(row) {
  var data = {};
  ['__downloadSelected', '__downloadStatus', '__downloadError', '__downloadCandidate', '__downloadCandidates', '__downloadCandidateManual', '__candidateError', '__candidateNotice', '__candidateQueryCount'].forEach(function (key) {
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
  ['__downloadSelected', '__downloadCandidate', '__downloadCandidates', '__downloadCandidateManual', '__candidateError', '__candidateNotice', '__candidateQueryCount'].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
  });
}
function prepareDownloadQueueRow(row) {
  ['__downloadStatus', '__downloadError', '__candidateLoading', '__candidateQueued', '__candidatePromise'].forEach(function (key) { delete row[key]; });
  row.__downloadSelected = true;
}
function getMissingImportRows(onlySelected) {
  return getPlaylistImportRows().filter(function (item) {
    if (onlySelected && item.row.__downloadSelected === false) return false;
    return isPlaylistRecordMissing(item.row);
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
function updateDownloadQueueItemProgress(data) {
  if (!data || !data.requestId) return;
  var changed = false;
  downloadQueue.forEach(function (job) {
    (job.items || []).forEach(function (item) {
      if (item.requestId === data.requestId) {
        item.downloadPercent = Math.max(0, Math.min(100, Number(data.percent || 0)));
        changed = true;
      }
    });
  });
  if (changed) renderDownloadQueue();
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
function renderDownloadQueue() {
  var panel = $('download-queue-panel');
  var list = $('download-queue-list');
  var summary = $('download-queue-summary');
  var badge = $('download-queue-badge');
  if (panel) panel.classList.toggle('open', downloadQueuePanelOpen);
  var activeItems = getDownloadQueueActiveItems();
  if (badge) {
    badge.textContent = activeItems ? String(activeItems) : '';
    badge.style.display = activeItems ? 'flex' : 'none';
  }
  var running = getDownloadQueueRunningJob();
  if (summary) {
    if (running) summary.textContent = running.status === 'checking' ? 'Checking download tools' : 'Running ' + running.current + '/' + running.total;
    else if (downloadQueue.some(function (job) { return job.status === 'queued'; })) summary.textContent = 'Waiting to start';
    else summary.textContent = downloadQueue.length ? 'Finished' : 'No active downloads';
  }
  if (!list) return;
  list.innerHTML = '';
  if (!downloadQueue.length) {
    list.innerHTML = '<div class="download-queue-empty">No downloads queued.</div>';
    return;
  }
  downloadQueue.slice().reverse().forEach(function (job) {
    var card = document.createElement('div');
    card.className = 'download-job ' + (job.status || 'queued');
    var pct = job.total ? Math.round((job.current / job.total) * 100) : 0;
    var actionsHtml = '';
    if (job.status === 'failed') actionsHtml = '<button type="button" class="download-job-mini-btn retry" data-job-id="' + esc(job.id) + '">Retry failed</button>';
    else if (job.status === 'queued' || job.status === 'running') actionsHtml = '<button type="button" class="download-job-mini-btn cancel" data-job-id="' + esc(job.id) + '">' + (job.status === 'running' ? 'Stop' : 'Cancel') + '</button>';
    card.innerHTML = '<div class="download-job-top"><div><strong>' + esc(job.title || 'Download job') + '</strong><span>' + esc(job.statusLabel || job.status || 'queued') + ' • ' + job.current + '/' + job.total + '</span></div><div class="download-job-side"><em>' + pct + '%</em>' + actionsHtml + '</div></div>' +
      '<div class="download-job-bar"><span style="width:' + pct + '%"></span></div>';
    var retryBtn = card.querySelector('.download-job-mini-btn.retry');
    if (retryBtn) retryBtn.addEventListener('click', function (e) { e.stopPropagation(); retryDownloadQueueJob(job.id); });
    var cancelBtn = card.querySelector('.download-job-mini-btn.cancel');
    if (cancelBtn) cancelBtn.addEventListener('click', function (e) { e.stopPropagation(); cancelDownloadQueueJob(job.id); });
    var items = document.createElement('div');
    items.className = 'download-job-items';
    (job.items || []).forEach(function (item, itemIndex) {
      var row = document.createElement('div');
      row.className = 'download-job-item ' + (item.status || 'queued');
      var icon = item.status === 'done' ? 'ph-check-circle' : (item.status === 'failed' ? 'ph-warning-circle' : (item.status === 'downloading' ? 'ph-download-simple' : (item.status === 'searching' ? 'ph-magnifying-glass' : 'ph-clock')));
      var progressText = item.status === 'downloading' && typeof item.downloadPercent === 'number' ? ' • ' + Math.round(item.downloadPercent) + '%' : '';
      var itemActions = '';
      if (item.status === 'done' && item.filePath) itemActions = '<button type="button" class="download-job-file-btn go-file">Go to file</button>';
      else if (item.status === 'failed' && item.row) itemActions = '<span class="download-job-item-actions"><button type="button" class="download-job-file-btn review-candidate">Review</button><button type="button" class="download-job-file-btn retry-item">Retry</button></span>';
      row.innerHTML = '<i class="ph ' + icon + '"></i><span><strong>' + esc(item.title || 'Unknown Track') + '</strong><small>' + esc(item.artist || '') + progressText + (item.error ? ' • ' + esc(item.error) : '') + '</small></span>' + itemActions;
      var fileBtn = row.querySelector('.go-file');
      if (fileBtn) fileBtn.addEventListener('click', function (e) { e.stopPropagation(); showFileLocation(item.filePath); });
      var reviewBtn = row.querySelector('.review-candidate');
      if (reviewBtn) reviewBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        downloadQueueReview = isDownloadQueueItemReviewOpen(job, itemIndex) ? { jobId: '', itemIndex: -1 } : { jobId: job.id, itemIndex: itemIndex };
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
  downloadQueuePanelOpen = !!open;
  renderDownloadQueue();
}
function makeDownloadQueueJob(type, title, rows, playlistId, options) {
  options = options || {};
  rows = (rows || []).filter(isPlaylistRecordMissing);
  if (!rows.length) return null;
  rows.forEach(prepareDownloadQueueRow);
  return {
    id: 'download_job_' + Date.now() + '_' + (++downloadJobSeq),
    type: type || 'tracks',
    playlistId: playlistId || '',
    playlistIds: options.playlistIds || (playlistId ? [playlistId] : []),
    savePlaylists: !!options.savePlaylists,
    title: title || 'Downloads',
    status: 'queued',
    statusLabel: 'Queued',
    current: 0,
    total: rows.length,
    downloaded: 0,
    failed: 0,
    cancelRequested: false,
    items: rows.map(function (row) { return { row: row, title: getImportTrackTitle(row), artist: getImportTrackArtist(row), status: 'queued', error: '' }; })
  };
}
function pushDownloadQueueJob(job, toastMessage) {
  if (!job) return null;
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
  var rows = getPlaylistImportRows().filter(function (item) { return item.row.__downloadSelected !== false && isPlaylistRecordMissing(item.row); }).map(function (item) { return item.row; });
  if (!pl || !rows.length) { showToast('No selected missing tracks to download.'); return null; }
  return pushDownloadQueueJob(makeDownloadQueueJob('existing-playlist', pl.name || 'Playlist Downloads', rows, pl.id, { savePlaylists: true }), 'Queued ' + rows.length + ' download' + (rows.length === 1 ? '' : 's') + ' for "' + (pl.name || 'playlist') + '".');
}
function enqueueImportedPlaylistDownloadJob(title, rows, firstPlaylistId, playlistIds) {
  rows = (rows || []).filter(function (row) { return row.__downloadSelected !== false && isPlaylistRecordMissing(row); });
  if (!rows.length) return null;
  return pushDownloadQueueJob(makeDownloadQueueJob('imported-playlist', title || 'Imported Playlist Downloads', rows, firstPlaylistId || '', { savePlaylists: true, playlistIds: playlistIds || [] }), 'Queued ' + rows.length + ' imported playlist download' + (rows.length === 1 ? '' : 's') + '.');
}
function enqueueAlbumDownloadJob(title, rows) {
  rows = (rows || []).filter(isPlaylistRecordMissing);
  if (!rows.length) { showToast('No missing tracks found for this album.'); return null; }
  return pushDownloadQueueJob(makeDownloadQueueJob('album-release', title || 'Album Downloads', rows, ''), 'Queued ' + rows.length + ' album download' + (rows.length === 1 ? '' : 's') + '.');
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
    if (!row.__downloadCandidate) await searchImportCandidates(row, true);
    if (!row.__downloadCandidate) {
      item.status = 'failed'; item.error = 'No high-confidence candidate selected'; row.__downloadStatus = 'failed'; row.__downloadError = item.error; job.failed++; job.current++; renderDownloadQueue(); continue;
    }
    if (getImportCandidateConfidence(row.__downloadCandidate) === 'low' && !row.__downloadCandidateManual) {
      item.status = 'failed'; item.error = 'Low-confidence candidate'; row.__downloadStatus = 'failed'; row.__downloadError = item.error; job.failed++; job.current++; renderDownloadQueue(); continue;
    }
    row.__downloadStatus = 'downloading'; row.__downloadError = '';
    item.status = 'downloading'; item.error = ''; item.downloadPercent = 0; item.requestId = job.id + '_' + i + '_' + Date.now(); job.statusLabel = 'Downloading'; renderDownloadQueue();
    var res = await downloadImportRowWithFallback(row, appSettings.ytdlDownloadFolder || '', item.requestId);
    if (res && res.ok && res.filePath) {
      row.FilePath = res.filePath;
      item.status = 'done'; item.error = ''; item.filePath = res.filePath; item.downloadPercent = 100; job.downloaded++;
      if (res.libraryItem && res.libraryItem.filePath) fileMap[stripFileUrl(res.libraryItem.filePath)] = res.libraryItem;
    } else if (res && res.cancelled) {
      item.status = 'cancelled'; item.error = 'Cancelled'; row.__downloadStatus = 'failed'; row.__downloadError = item.error;
    } else {
      item.status = 'failed'; item.error = (res && res.error) || 'Download failed'; row.__downloadStatus = 'failed'; row.__downloadError = item.error; job.failed++;
    }
    job.current++;
    renderDownloadQueue();
  }
  setMusicFiles(Object.values(fileMap));
  job.items.forEach(function (item) { if (item.row) clearImportRowTransient(item.row); });
  await window.api.saveLibrary(state.musicFiles);
  if (job.playlistId || job.savePlaylists) await window.api.savePlaylists(state.playlists);
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
    discogsToken: appSettings.discogsToken || '',
    spotifyClientId: appSettings.spotifyClientId || '',
    spotifyClientSecret: appSettings.spotifyClientSecret || ''
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
function importPlaylistGroups(groups) {
  var firstPlaylistId = '';
  var playlistIds = [];
  var importedRows = [];
  groups.forEach(function (group, idx) {
    var existing = state.playlists.find(function (p) { return p.name === group.name && !p.isSpecial; });
    if (existing) {
      if (!existing.tracks) existing.tracks = [];
      var existingByKey = new Map(existing.tracks.map(function (t) { return [getPlaylistTrackFilePath(t) || ((t.Song || t.title || '').toLowerCase() + '|' + (t.Artist || t.artist || '').toLowerCase() + '|' + (t.Album || t.album || '').toLowerCase()), t]; }));
      group.tracks.forEach(function (t) {
        var importKey = getPlaylistTrackFilePath(t) || ((t.Song || t.title || '').toLowerCase() + '|' + (t.Artist || t.artist || '').toLowerCase() + '|' + (t.Album || t.album || '').toLowerCase());
        var target = existingByKey.get(importKey);
        if (!target) {
          target = t;
          existing.tracks.push(target);
          existingByKey.set(importKey, target);
        } else {
          copyImportRowTransient(t, target);
        }
        importedRows.push(target);
      });
      if (!firstPlaylistId) firstPlaylistId = existing.id;
      if (!playlistIds.includes(existing.id)) playlistIds.push(existing.id);
    } else {
      var pl = { id: 'pl_' + Date.now() + '_' + idx, name: group.name, cover: null, color: PALETTE[idx % PALETTE.length], tracks: group.tracks, pinned: false, lastPlayed: null };
      state.playlists.push(pl);
      if (!firstPlaylistId) firstPlaylistId = pl.id;
      playlistIds.push(pl.id);
      importedRows.push.apply(importedRows, pl.tracks);
    }
  });
  return { firstPlaylistId: firstPlaylistId, playlistIds: playlistIds, rows: importedRows };
}
function updatePlaylistImportActions() {
  var rows = getPlaylistImportRows();
  var selected = rows.filter(function (item) { return isPlaylistRecordMissing(item.row) && item.row.__downloadSelected !== false; }).length;
  var busy = playlistImportSearching;
  var btn = $('playlist-import-download');
  if (btn) btn.disabled = busy || selected <= 0;
  if (btn) {
    btn.textContent = 'Import + Download Selected' + (selected ? ' (' + selected + ')' : '');
  }
  ['playlist-import-select-missing', 'playlist-import-find-candidates', 'playlist-import-find-all-candidates', 'playlist-import-check-tools', 'playlist-import-only', 'playlist-import-cancel', 'playlist-import-cancel-x'].forEach(function (id) {
    var el = $(id);
    if (el) el.disabled = busy;
  });
}
async function searchImportCandidates(row, silent, force) {
  if (!row || !window.api.searchDownloadCandidates) return [];
  if (row.__candidateLoading && row.__candidatePromise) return row.__candidatePromise;
  if (!force && row.__downloadCandidates && row.__downloadCandidates.length) return row.__downloadCandidates;
  var previousUrl = row.__downloadCandidate ? (row.__downloadCandidate.webpageUrl || row.__downloadCandidate.url || '') : '';
  var previousManual = !!row.__downloadCandidateManual;
  row.__candidateLoading = true;
  row.__candidateError = '';
  row.__candidateNotice = '';
  if (!silent) renderPlaylistImportReview();
  row.__candidatePromise = (async function () {
    try {
      var res = await window.api.searchDownloadCandidates(makeDownloadTrackPayload(row), 5);
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
      row.__downloadCandidates = [];
      setImportRowCandidate(row, null, false);
      row.__candidateError = 'Search failed: ' + ((e && e.message) || String(e || 'unknown error'));
    } finally {
      row.__candidateLoading = false;
      row.__candidatePromise = null;
      if (!silent) renderPlaylistImportReview();
    }
    return row.__downloadCandidates || [];
  })();
  return row.__candidatePromise;
}
async function searchImportCandidateRows(rows, label) {
  if (playlistImportSearching) return;
  var status = $('playlist-import-status');
  if (!rows.length) {
    if (status) status.textContent = 'No missing tracks to search.';
    return;
  }
  playlistImportSearching = true;
  rows.forEach(function (item) { item.row.__candidateQueued = true; });
  var total = rows.length;
  var completed = 0;
  var next = 0;
  setPlaylistImportProgress(true, 'Searching', 0, total);
  renderPlaylistImportReview();
  async function worker() {
    while (next < total) {
      var index = next++;
      var item = rows[index];
      item.row.__candidateQueued = false;
      if (status) status.textContent = 'Finding candidates ' + (completed + 1) + '/' + total + ': ' + getImportTrackArtist(item.row) + ' - ' + getImportTrackTitle(item.row);
      await searchImportCandidates(item.row, false);
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
    if (status) status.textContent = 'Candidate search complete for ' + label + '.';
  } finally {
    rows.forEach(function (item) { item.row.__candidateQueued = false; });
    playlistImportSearching = false;
    setPlaylistImportProgress(false, '', 0, 0);
    renderPlaylistImportReview();
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
  var reviewCount = 0;
  list.innerHTML = '';
  rows.forEach(function (item, flatIndex) {
    var row = item.row;
    var title = getImportTrackTitle(row);
    var artist = getImportTrackArtist(row);
    var album = getImportTrackAlbum(row);
    var matched = findPlaylistRecordMatch(row);
    var isMissing = !matched;
    if (isMissing) missingCount++;
    var div = document.createElement('div');
    div.className = 'playlist-import-row' + (matched ? ' matched' : '') + (row.__downloadStatus === 'downloading' ? ' downloading' : '') + (row.__downloadStatus === 'failed' ? ' failed' : '');
    div.dataset.flatIndex = String(flatIndex);
    var checked = isMissing && row.__downloadSelected !== false;
    var busy = playlistImportSearching;
    if (isMissing && row.__downloadCandidates && row.__downloadCandidates.length && !row.__downloadCandidate) reviewCount++;
    var status = matched ? 'In library' : (row.__candidateLoading ? 'Searching' : (row.__candidateQueued ? 'Queued' : (row.__downloadStatus === 'done' ? 'Downloaded' : (row.__downloadStatus === 'failed' ? 'Failed' : (row.__downloadCandidate ? 'Ready' : ((row.__downloadCandidates && row.__downloadCandidates.length) ? 'Needs review' : 'Missing'))))));
    var statusTitle = row.__downloadError ? ' title="' + esc(row.__downloadError) + '"' : '';
    div.innerHTML = '<input type="checkbox" class="playlist-import-row-check" ' + (isMissing && !busy ? '' : 'disabled ') + (checked ? 'checked ' : '') + '>' +
      '<div class="playlist-import-cover"><i class="ph ph-music-notes"></i></div>' +
      '<div class="playlist-import-title"><strong title="' + esc(title) + '">' + esc(title || 'Unknown Track') + '</strong><span title="' + esc(artist) + '">' + esc(artist || 'Unknown Artist') + '</span></div>' +
      '<div class="playlist-import-album" title="' + esc(album) + '">' + esc(album || '-') + '</div>' +
      '<div class="playlist-import-row-status"' + statusTitle + '><span>' + esc(status) + '</span>' + (isMissing ? '<button type="button" class="playlist-import-candidate-btn" ' + (busy || row.__candidateLoading ? 'disabled ' : '') + '>' + (row.__candidateLoading ? 'Searching...' : (row.__candidateQueued ? 'Queued' : (row.__downloadCandidate ? 'Change' : ((row.__downloadCandidates && row.__downloadCandidates.length) ? 'Review' : 'Search')))) + '</button>' : '') + '</div>';
    var cb = div.querySelector('.playlist-import-row-check');
    if (cb) cb.addEventListener('change', function () { row.__downloadSelected = cb.checked; updatePlaylistImportActions(); });
    div.addEventListener('click', function (e) {
      if (!isMissing || busy || !cb || e.target.closest('button,input,.playlist-import-candidates,.playlist-import-picked-candidate')) return;
      row.__downloadSelected = !cb.checked;
      renderPlaylistImportReview();
    });
    var candidateBtn = div.querySelector('.playlist-import-candidate-btn');
    if (candidateBtn) candidateBtn.addEventListener('click', function () { searchImportCandidates(row, false); });
    if (isMissing && row.__downloadCandidate) {
      var picked = document.createElement('div');
      picked.className = 'playlist-import-picked-candidate';
      picked.innerHTML = '<span>Selected ' + esc(formatImportCandidateConfidence(row.__downloadCandidate)) + ':</span> ' + esc(row.__downloadCandidate.title || 'Unknown video') + ' <small>' + esc(row.__downloadCandidate.uploader || '') + ' - ' + esc(formatImportCandidateDuration(row.__downloadCandidate.duration)) + '</small>';
      div.appendChild(picked);
    }
    if (isMissing && row.__candidateNotice) {
      var note = document.createElement('div');
      note.className = 'playlist-import-candidate-note';
      note.textContent = row.__candidateNotice;
      div.appendChild(note);
    }
    if (isMissing && row.__candidateError) {
      var err = document.createElement('div');
      err.className = 'playlist-import-candidate-error';
      err.textContent = row.__candidateError;
      div.appendChild(err);
    }
    if (isMissing && row.__downloadCandidates && row.__downloadCandidates.length) {
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
    list.appendChild(div);
  });
  $('playlist-import-subtitle').textContent = pendingPlaylistImport.groups.length + ' playlist(s), ' + rows.length + ' track(s), ' + missingCount + ' missing' + (reviewCount ? ', ' + reviewCount + ' need review' : '') + '.';
  $('playlist-import-download-folder').textContent = 'Download folder: ' + (appSettings.ytdlDownloadFolder || 'Default Music/Playerinyo Downloads');
  updatePlaylistImportActions();
}
async function showPlaylistImportReview(csvPath, data) {
  var groups = buildPlaylistImportGroups(csvPath, data);
  if (!groups.length) return;
  groups.forEach(function (group) { group.tracks.forEach(function (row) { row.__downloadSelected = true; }); });
  pendingPlaylistImport = { csvPath: csvPath, groups: groups };
  if (!appSettings.ytdlDownloadFolder && window.api.getDefaultDownloadFolder) appSettings.ytdlDownloadFolder = await window.api.getDefaultDownloadFolder();
  var titleEl = $('playlist-import-title'); if (titleEl) titleEl.textContent = 'Import Playlist';
  var importOnlyBtn = $('playlist-import-only'); if (importOnlyBtn) importOnlyBtn.textContent = 'Import Only';
  var status = $('playlist-import-status'); if (status) status.textContent = '';
  var toolStatus = $('playlist-import-tool-status'); if (toolStatus) toolStatus.textContent = '';
  setPlaylistImportProgress(false, '', 0, 0);
  renderPlaylistImportReview();
  showModal($('playlist-import-modal'));
  var missingRows = getMissingImportRows(false);
  if (missingRows.length > 0 && missingRows.length <= 5) {
    setTimeout(function () { if (pendingPlaylistImport && pendingPlaylistImport.csvPath === csvPath) searchImportCandidateRows(missingRows, 'missing tracks'); }, 0);
  }
}
async function showExistingPlaylistDownloadReview(pl, rows) {
  if (!pl) return;
  rows = (rows || getMissingPlaylistRows(pl)).filter(isPlaylistRecordMissing);
  if (!rows.length) { showToast('No missing tracks to download in "' + (pl.name || 'this playlist') + '".'); return; }
  rows.forEach(function (row) { clearImportRowTransient(row); row.__downloadSelected = true; });
  pendingPlaylistImport = { csvPath: '', groups: [{ name: pl.name || 'Playlist', tracks: rows }], existingPlaylistId: pl.id, mode: 'existing-playlist' };
  if (!appSettings.ytdlDownloadFolder && window.api.getDefaultDownloadFolder) appSettings.ytdlDownloadFolder = await window.api.getDefaultDownloadFolder();
  var titleEl = $('playlist-import-title'); if (titleEl) titleEl.textContent = 'Download Playlist Tracks';
  var importOnlyBtn = $('playlist-import-only'); if (importOnlyBtn) importOnlyBtn.textContent = 'Close';
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
  setTimeout(function () { if (queryInput) queryInput.focus(); }, 0);
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
  rows.forEach(function (row) { row.__downloadSelected = isPlaylistRecordMissing(row); });
  albumDownloadSelectedRelease = { result: result, release: release, meta: meta, rows: rows };
  renderAlbumDownloadPreview();
}
function updateAlbumDownloadSelectionActions() {
  var rows = albumDownloadSelectedRelease ? (albumDownloadSelectedRelease.rows || []) : [];
  var missing = rows.filter(isPlaylistRecordMissing);
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
  var missing = rows.filter(isPlaylistRecordMissing);
  var selectedMissing = rows.filter(function (row) { return isPlaylistRecordMissing(row) && row.__downloadSelected !== false; });
  preview.innerHTML = '';
  rows.forEach(function (row, index) {
    var track = document.createElement('div');
    var matched = !isPlaylistRecordMissing(row);
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
    if (isPlaylistRecordMissing(row)) row.__downloadSelected = !!selected;
  });
  renderAlbumDownloadPreview();
}
function queueAlbumDownloadSelectedRelease() {
  if (!albumDownloadSelectedRelease) return;
  var meta = albumDownloadSelectedRelease.meta || {};
  var rows = (albumDownloadSelectedRelease.rows || []).filter(function (row) { return isPlaylistRecordMissing(row) && row.__downloadSelected !== false; });
  if (!rows.length) { showToast('No selected missing tracks for this album.'); return; }
  enqueueAlbumDownloadJob((meta.albumArtist ? meta.albumArtist + ' - ' : '') + (meta.albumTitle || 'Album'), rows);
  hideModal($('album-download-modal'));
  albumDownloadContext = null;
  albumDownloadSelectedRelease = null;
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
async function finishPlaylistImport(withDownload) {
  if (!pendingPlaylistImport) return;
  if (playlistImportSearching) return;
  var existingPlaylistId = pendingPlaylistImport.existingPlaylistId || '';
  pushUndoSnapshot(existingPlaylistId ? 'Download missing playlist tracks' : 'Import playlist CSV');
  if (existingPlaylistId) {
    if (withDownload) enqueueExistingPlaylistDownloadJob(pendingPlaylistImport);
    else {
      pendingPlaylistImport.groups.forEach(function (group) { group.tracks.forEach(clearImportRowTransient); });
      await window.api.savePlaylists(state.playlists);
    }
    renderSidebarPlaylists();
    hideModal($('playlist-import-modal'));
    pendingPlaylistImport = null;
    clearTrackSelection();
    return;
  }
  var importResult = importPlaylistGroups(pendingPlaylistImport.groups);
  var seenQueueRows = new Set();
  var queueRows = withDownload ? importResult.rows.filter(function (row) {
    if (seenQueueRows.has(row) || row.__downloadSelected === false || !isPlaylistRecordMissing(row)) return false;
    seenQueueRows.add(row);
    return true;
  }) : [];
  var queueSnapshots = queueRows.map(function (row) { return { row: row, data: snapshotImportRowTransient(row) }; });
  importResult.rows.forEach(clearImportRowTransient);
  await window.api.savePlaylists(state.playlists);
  await window.api.saveLibrary(state.musicFiles);
  queueSnapshots.forEach(function (item) { restoreImportRowTransient(item.row, item.data); });
  renderSidebarPlaylists();
  hideModal($('playlist-import-modal'));
  if (importResult.firstPlaylistId) switchView(importResult.firstPlaylistId);
  if (withDownload && queueRows.length) {
    var jobTitle = pendingPlaylistImport.groups.length === 1 ? (pendingPlaylistImport.groups[0].name || 'Imported Playlist') : 'Imported Playlists';
    enqueueImportedPlaylistDownloadJob(jobTitle, queueRows, importResult.firstPlaylistId, importResult.playlistIds);
  }
  pendingPlaylistImport = null;
}

var importPl = $('import-playlist-btn');
if (importPl) importPl.addEventListener('click', async function () {
  var fp = await window.api.openFile(); if (!fp) return;
  var data = await window.api.parseCsv(fp);
  if (!data || data.length === 0) return;
  hideModal($('settings-modal'));
  showPlaylistImportReview(fp, data);
});

var playlistImportSelectMissing = $('playlist-import-select-missing');
if (playlistImportSelectMissing) playlistImportSelectMissing.addEventListener('click', function () {
  getPlaylistImportRows().forEach(function (item) {
    var row = item.row;
    row.__downloadSelected = isPlaylistRecordMissing(row);
  });
  renderPlaylistImportReview();
});
var playlistImportFindCandidates = $('playlist-import-find-candidates');
if (playlistImportFindCandidates) playlistImportFindCandidates.addEventListener('click', searchSelectedImportCandidates);
var playlistImportFindAllCandidates = $('playlist-import-find-all-candidates');
if (playlistImportFindAllCandidates) playlistImportFindAllCandidates.addEventListener('click', searchAllImportCandidates);
var playlistImportCheckTools = $('playlist-import-check-tools');
if (playlistImportCheckTools) playlistImportCheckTools.addEventListener('click', async function () {
  var out = $('playlist-import-tool-status');
  if (out) out.textContent = 'Checking...';
  var res = window.api.checkYtdlpTools ? await window.api.checkYtdlpTools() : null;
  if (out) out.textContent = res && res.ok ? ('yt-dlp ' + res.ytdlp + ', ffmpeg OK') : ((res && res.error) || 'Tool check unavailable');
});
function cancelPlaylistImport() {
  if (playlistImportSearching) return;
  pendingPlaylistImport = null;
  hideModal($('playlist-import-modal'));
}
var playlistImportCancel = $('playlist-import-cancel'); if (playlistImportCancel) playlistImportCancel.addEventListener('click', cancelPlaylistImport);
var playlistImportCancelX = $('playlist-import-cancel-x'); if (playlistImportCancelX) playlistImportCancelX.addEventListener('click', cancelPlaylistImport);
var playlistImportOnly = $('playlist-import-only'); if (playlistImportOnly) playlistImportOnly.addEventListener('click', function () { finishPlaylistImport(false); });
var playlistImportDownload = $('playlist-import-download'); if (playlistImportDownload) playlistImportDownload.addEventListener('click', function () { finishPlaylistImport(true); });
var playlistImportModal = $('playlist-import-modal'); if (playlistImportModal) playlistImportModal.addEventListener('click', function (e) { if (e.target === playlistImportModal) cancelPlaylistImport(); });

var createPlBtn = $('create-playlist-btn');
if (createPlBtn) createPlBtn.addEventListener('click', function () {
  cpSelectedCoverPath = null; cpSelectedColor = PALETTE[0];
  var ni = $('cp-name-input'); if (ni) ni.value = '';
  var cp = $('cp-cover-preview'); if (cp) cp.style.display = 'none';
  buildColorPickers(); showModal($('create-playlist-modal'));
  setTimeout(function () { var ni = $('cp-name-input'); if (ni) ni.focus(); }, 100);
});

var cpDrop = $('cp-cover-drop');
if (cpDrop) {
  cpDrop.addEventListener('click', async function () { var img = await window.api.openImage(); if (img) { cpSelectedCoverPath = img; $('cp-cover-preview').src = img; $('cp-cover-preview').style.display = 'block'; } });
  cpDrop.addEventListener('dragover', function (e) { e.preventDefault(); cpDrop.classList.add('drag-over'); });
  cpDrop.addEventListener('dragleave', function () { cpDrop.classList.remove('drag-over'); });
  cpDrop.addEventListener('drop', function (e) { e.preventDefault(); cpDrop.classList.remove('drag-over'); var f = e.dataTransfer.files[0]; if (f && f.type.startsWith('image/') && f.path) { var url = toFileUrl(f.path); cpSelectedCoverPath = url; $('cp-cover-preview').src = url; $('cp-cover-preview').style.display = 'block'; } });
}

var cpCancel = $('cp-cancel-btn'); if (cpCancel) cpCancel.addEventListener('click', function () { hideModal($('create-playlist-modal')); });
var cpCreate = $('cp-create-btn');
if (cpCreate) cpCreate.addEventListener('click', async function () {
  var name = ($('cp-name-input').value || '').trim() || 'New Playlist';
  var pl = { id: 'pl_' + Date.now(), name: name, cover: cpSelectedCoverPath, color: cpSelectedColor, tracks: [], pinned: false, lastPlayed: null };
  state.playlists.push(pl); await window.api.savePlaylists(state.playlists);
  renderSidebarPlaylists(); hideModal($('create-playlist-modal')); switchView(pl.id);
});

var navLib = $('nav-library'); if (navLib) navLib.addEventListener('click', function () { switchView('library'); });
var navHome = $('nav-home'); if (navHome) navHome.addEventListener('click', function () { switchView('home'); });
var btnOpenTagHealth = $('btn-open-tag-health'); if (btnOpenTagHealth) btnOpenTagHealth.addEventListener('click', function () { hideModal($('settings-modal')); switchView('metadata_health'); });

var libSortSel = $('library-sort-select');
if (libSortSel) libSortSel.addEventListener('change', function () { if (state.currentView === 'library') renderLibrary(); });


var btnNavBack = $('btn-nav-back');
if (btnNavBack) btnNavBack.addEventListener('click', function () {
  if (state.navIndex > 0) {
    state.navIndex--;
    var viewId = state.navHistory[state.navIndex];
    // handle album: prefix
    if (viewId && viewId.startsWith('album:')) {
      var albumId = decodeURIComponent(viewId.replace('album:', ''));
      var album = getFullAlbumByKey(albumId);
      if (album) renderAlbumDetail(album);
    } else { switchView(viewId, false); }
    updateNavBtns();
  }
});
var btnNavFwd = $('btn-nav-forward');
if (btnNavFwd) btnNavFwd.addEventListener('click', function () {
  if (state.navIndex < state.navHistory.length - 1) {
    state.navIndex++;
    var viewId = state.navHistory[state.navIndex];
    if (viewId && viewId.startsWith('album:')) {
      var albumId = decodeURIComponent(viewId.replace('album:', ''));
      var album = getFullAlbumByKey(albumId);
      if (album) renderAlbumDetail(album);
    } else { switchView(viewId, false); }
    updateNavBtns();
  }
});


// Genre-group toggle removed — genre search is now handled via the search bar
// FIX 9: Playlist search fixed
var plSearch = $('playlist-search');
if (plSearch) plSearch.addEventListener('input', function (e) { filterPlaylists(e.target.value); });

var gSearch = $('global-search');
var gSearchTimeout = null;
var searchHintTimer = null;
var searchHintIndex = 0;
var searchHints = [
  'Search songs, albums, artists...',
  'Try artist:Radiohead',
  'Try missing:cover',
  'Try genre:jazz year:1999',
  'Try rg:missing',
  'Press Ctrl+K for commands'
];
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
if (gSearch) gSearch.addEventListener('input', function (e) {
  clearTimeout(gSearchTimeout);
  gSearchTimeout = setTimeout(function () {
    var q = e.target.value.toLowerCase().trim();
    window._libRenderToken = (window._libRenderToken || 0) + 1;
    if (window._libRenderFrame) {
      cancelAnimationFrame(window._libRenderFrame);
      window._libRenderFrame = null;
    }
    $('search-albums-container').style.display = 'none';
    if (!q) { switchView('library'); return; }
    
    if (state.currentView !== 'search') {
      pushNav('search');
      state.currentView = 'search';
    }

    var hdc = $('home-dashboard-container'); if (hdc) hdc.style.display = 'none';
    $('albums-grid-container').style.display = 'none';
    $('tracks-table-container').style.display = 'block';
    $('album-detail-header').style.display = 'none';

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
    var albumContainer = $('search-albums-container');
    var albumHeader = albumContainer ? albumContainer.querySelector('h2') : null;

    if (albumKeys.length > 0) {
      // Determine label: if all results are genre-only matches, show genre label
      var allGenreOnly = albumKeys.every(function(k) { return genreOnlyMatches[k]; });
      var someGenre = albumKeys.some(function(k) { return genreOnlyMatches[k]; });
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
      albumKeys.forEach(function (k) {
        var album = matchedAlbums[k];
        var card = document.createElement('div'); card.className = 'album-card' + (isAlbumActive(album) ? ' playing' : '');
        var active = isAlbumActive(album);
        var wave = active && state.isPlaying ? '<div class="now-playing-bars" style="position:absolute;bottom:6px;left:6px;"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>' : '';
        var playBtnIcon = active && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
        var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
        var cov = album.cover ? '<img src="' + esc(album.cover) + '" alt="cover"' + lazy + ' />' : '<i class="ph ph-music-notes"></i>';
        // Show genre badge if this album matched via genre
        var genreBadge = genreOnlyMatches[k] && album.genre ? '<div style="font-size:10px;color:var(--accent);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(album.genre) + '</div>' : '';
        card.innerHTML = '<div class="album-card-img-wrapper" style="position:relative;">' + cov + wave + '<div class="album-card-play-btn" data-album="' + encodeURIComponent(album.name) + '"><i class="' + playBtnIcon + '"></i></div></div><div class="album-card-info"><div class="album-card-title" title="' + esc(album.name) + '">' + esc(album.name) + '</div><div class="album-card-artist">' + esc(album.artist) + '</div>' + genreBadge + '</div>';
        card.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          window.currentContextMenuAlbum = album;
          hideAllContextMenus();
          positionContextMenu($('album-context-menu'), e.clientX, e.clientY);
        });
        card.querySelector('.album-card-play-btn').addEventListener('click', function (e) {
          e.stopPropagation(); initAudioCtx();
          if (isAlbumActive(album)) { togglePlay(); var icon = e.currentTarget.querySelector('i'); if (icon) icon.className = state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play'; return; }
          state.playQueueTracks = getSortedAlbumTracks(album).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
          state.shuffleQueue = []; if (state.isShuffle) buildShuffleQueue();
          playTrack(state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks[0]);
        });
        card.addEventListener('click', function () {
          if (isMultiSelectMode) {
            if (selectedAlbumsForEdit.has(album.id)) selectedAlbumsForEdit.delete(album.id);
            else selectedAlbumsForEdit.add(album.id);
            updateMultiSelectControls();
            gs.dispatchEvent(new Event('input'));
            return;
          }
          var fullAlbum = getFullAlbumByKey(album.id) || album;
          var focusPath = album.tracks && album.tracks[0] ? album.tracks[0].filePath : '';
          pushNav('album:' + fullAlbum.id);
          renderAlbumDetail(fullAlbum, focusPath);
        });
        if (isMultiSelectMode && selectedAlbumsForEdit.has(album.id)) {
          card.style.border = '2px solid var(--accent)';
          card.style.transform = 'scale(0.95)';
          card.style.opacity = '0.8';
        }
        albumFragment.appendChild(card);
      });
      aGrid.appendChild(albumFragment);
    }

    state.currentTracks = matchedFiles.map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
    clearTrackTableFilter();

    $('view-title').textContent = 'Search Results';
    renderTracksTable(false);
  }, 250);
});
if (gSearch) {
  searchHintTimer = setInterval(function () {
    if (document.activeElement === gSearch || gSearch.value) return;
    searchHintIndex = (searchHintIndex + 1) % searchHints.length;
    gSearch.placeholder = searchHints[searchHintIndex];
  }, 3500);
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
    { type: 'command', icon: 'ph-image-square', label: 'Write folder.jpg', sub: 'Write album covers into music folders', keywords: 'cover folder jpg artwork', action: function () { writeCurrentFolderCovers(true); } }
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
    if (state.isShuffle) buildShuffleQueue();
    var record = state.playQueueTracks.find(function (t) { return t.matchedFile && t.matchedFile.filePath === item.file.filePath; }) || makeTrackCommandRecord(item.file);
    playTrack(record);
    return;
  }
  if (item.type === 'album' && item.album) { pushNav('album:' + item.album.id); renderAlbumDetail(item.album); return; }
  if (item.type === 'playlist' && item.playlist) { switchView(item.playlist.id); }
}
var commandPaletteModal = $('command-palette-modal');
if (commandPaletteModal) commandPaletteModal.addEventListener('click', function (e) { if (e.target === commandPaletteModal) closeCommandPalette(); });
var commandPaletteInput = $('command-palette-input');
if (commandPaletteInput) {
  commandPaletteInput.addEventListener('input', function () { commandPaletteIndex = 0; renderCommandPalette(); });
  commandPaletteInput.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); commandPaletteIndex = Math.min(commandPaletteItems.length - 1, commandPaletteIndex + 1); renderCommandPalette(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); commandPaletteIndex = Math.max(0, commandPaletteIndex - 1); renderCommandPalette(); }
    else if (e.key === 'Enter') { e.preventDefault(); runCommandPaletteItem(commandPaletteItems[commandPaletteIndex]); }
    else if (e.key === 'Escape') { e.preventDefault(); closeCommandPalette(); }
  });
}
var commandPaletteList = $('command-palette-list');
if (commandPaletteList) commandPaletteList.addEventListener('click', function (e) {
  var row = e.target.closest('.command-palette-item');
  if (!row) return;
  runCommandPaletteItem(commandPaletteItems[parseInt(row.dataset.idx, 10)]);
});
document.addEventListener('keydown', function (e) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if ($('command-palette-modal') && $('command-palette-modal').classList.contains('active')) closeCommandPalette();
    else openCommandPalette();
  }
});

var zoomIn = $('btn-zoom-in'); if (zoomIn) zoomIn.addEventListener('click', function () { currentZoom = Math.min(currentZoom + 20, 300); applyZoom(); });
var zoomOut = $('btn-zoom-out'); if (zoomOut) zoomOut.addEventListener('click', function () { currentZoom = Math.max(currentZoom - 20, 100); applyZoom(); });
var caW = $('content-area');
if (caW) caW.addEventListener('wheel', function (e) { if (e.ctrlKey && state.currentView === 'library') { e.preventDefault(); if (e.deltaY < 0) $('btn-zoom-in').click(); else $('btn-zoom-out').click(); } }, { passive: false });
var _scrollThrottle;
if (caW) caW.addEventListener('scroll', function() {
  if (!appSettings.virtualScrolling) return;
  if (_scrollThrottle) return;
  _scrollThrottle = setTimeout(function() {
    _scrollThrottle = null;
    if (caW.scrollTop + caW.clientHeight >= caW.scrollHeight - 1200) {
      if (state.currentView === 'library' && window.renderLibraryChunk) {
        window.renderLibraryChunk();
      } else if (window.renderTracksChunk) {
        window.renderTracksChunk();
      }
    }
  }, 100);
}, { passive: true });

var cbVirtualScrolling = $('setting-virtual-scrolling');
if (cbVirtualScrolling) {
  cbVirtualScrolling.checked = !!appSettings.virtualScrolling;
  if (appSettings.virtualScrolling) document.body.classList.add('perf-mode');
  cbVirtualScrolling.addEventListener('change', function () {
    appSettings.virtualScrolling = this.checked;
    if (this.checked) document.body.classList.add('perf-mode');
    else document.body.classList.remove('perf-mode');
    window.api.saveSettings(appSettings);
  });
}

var togglePlBtn = $('toggle-playlist-view-btn');
if (togglePlBtn) togglePlBtn.style.display = 'none';

var btnFullscreenPl = $('btn-fullscreen-playlists');
if (btnFullscreenPl) btnFullscreenPl.addEventListener('click', function () {
  var sb = $('sidebar');
  if (sb.classList.contains('expanded')) {
    sb.classList.remove('expanded');
    sb.style.width = (appSettings.sidebarWidth || 240) + 'px';
    btnFullscreenPl.innerHTML = '<i class="ph ph-arrow-right"></i>';
  } else {
    sb.classList.add('expanded');
    sb.style.width = 'calc(100vw - 120px)';
    btnFullscreenPl.innerHTML = '<i class="ph ph-arrow-left"></i>';
  }
});



var winMinimize = $('window-minimize');
if (winMinimize) winMinimize.addEventListener('click', function () { if (window.api.windowControl) window.api.windowControl('minimize'); });
var winMaximize = $('window-maximize');
if (winMaximize) winMaximize.addEventListener('click', function () { if (window.api.windowControl) window.api.windowControl('toggle-maximize'); });
var winClose = $('window-close');
if (winClose) winClose.addEventListener('click', function () { if (window.api.windowControl) window.api.windowControl('close'); });
var btnDownloadQueue = $('btn-download-queue');
if (btnDownloadQueue) btnDownloadQueue.addEventListener('click', function (e) { e.stopPropagation(); setDownloadQueuePanel(!downloadQueuePanelOpen); });
var btnDownloadQueueClose = $('download-queue-close');
if (btnDownloadQueueClose) btnDownloadQueueClose.addEventListener('click', function () { setDownloadQueuePanel(false); });
var btnDownloadQueueClear = $('download-queue-clear');
if (btnDownloadQueueClear) btnDownloadQueueClear.addEventListener('click', function () {
  downloadQueue = downloadQueue.filter(function (job) { return job.status === 'queued' || job.status === 'running' || job.status === 'failed'; });
  if (!downloadQueue.some(function (job) { return job.id === downloadQueueReview.jobId; })) downloadQueueReview = { jobId: '', itemIndex: -1 };
  renderDownloadQueue();
});
if (window.api.onDownloadProgress) window.api.onDownloadProgress(updateDownloadQueueItemProgress);
var albumDownloadSearchBtn = $('album-download-search');
if (albumDownloadSearchBtn) albumDownloadSearchBtn.addEventListener('click', searchAlbumDownloadMetadata);
var albumDownloadSearchInput = $('album-download-search-query');
if (albumDownloadSearchInput) albumDownloadSearchInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') searchAlbumDownloadMetadata(); });
var albumDownloadQueueBtn = $('album-download-queue');
if (albumDownloadQueueBtn) albumDownloadQueueBtn.addEventListener('click', queueAlbumDownloadSelectedRelease);
var albumDownloadSelectMissingBtn = $('album-download-select-missing');
if (albumDownloadSelectMissingBtn) albumDownloadSelectMissingBtn.addEventListener('click', function () { setAlbumDownloadMissingSelection(true); });
var albumDownloadDeselectAllBtn = $('album-download-deselect-all');
if (albumDownloadDeselectAllBtn) albumDownloadDeselectAllBtn.addEventListener('click', function () { setAlbumDownloadMissingSelection(false); });
function closeAlbumDownloadModal() {
  albumDownloadContext = null;
  albumDownloadSelectedRelease = null;
  albumDownloadRequestSeq++;
  hideModal($('album-download-modal'));
}
var albumDownloadCancel = $('album-download-cancel');
if (albumDownloadCancel) albumDownloadCancel.addEventListener('click', closeAlbumDownloadModal);
var albumDownloadCancelX = $('album-download-cancel-x');
if (albumDownloadCancelX) albumDownloadCancelX.addEventListener('click', closeAlbumDownloadModal);
var albumDownloadModal = $('album-download-modal');
if (albumDownloadModal) albumDownloadModal.addEventListener('click', function (e) { if (e.target === albumDownloadModal) closeAlbumDownloadModal(); });
var btnSettings = $('btn-settings'); if (btnSettings) btnSettings.addEventListener('click', openSettingsModal);
var btnCloseSettings = $('btn-close-settings'); if (btnCloseSettings) btnCloseSettings.addEventListener('click', function () { hideModal($('settings-modal')); });
function backupIpcErrorMessage(e) {
  var msg = e && (e.message || String(e));
  if (/No handler registered for '?(export-backup|import-backup|restore-backup)'?/i.test(msg || '')) {
    return 'Backup feature needs a full app restart to load the new main-process handlers.\n\nClose Playerinyo completely, then start it again.';
  }
  return msg || 'unknown error';
}
var btnExportBackup = $('btn-export-backup');
if (btnExportBackup) btnExportBackup.addEventListener('click', async function () {
  btnExportBackup.disabled = true;
  var old = btnExportBackup.innerHTML;
  btnExportBackup.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Exporting...';
  try {
    await window.api.saveSettings(appSettings);
    var res = await window.api.exportBackup({ likedSongs: state.likedSongs });
    if (res && res.ok) alert('Backup exported.\n\nLibrary tracks: ' + ((res.summary && res.summary.library) || 0) + '\nPlaylists: ' + ((res.summary && res.summary.playlists) || 0) + '\n\nLast.fm API/session secrets are not included for safety.');
    else if (res && !res.canceled) alert('Backup export failed: ' + (res.error || 'unknown error'));
  } catch (e) {
    alert('Backup export failed: ' + backupIpcErrorMessage(e));
  } finally {
    btnExportBackup.disabled = false;
    btnExportBackup.innerHTML = old;
  }
});
var btnImportBackup = $('btn-import-backup');
if (btnImportBackup) btnImportBackup.addEventListener('click', async function () {
  btnImportBackup.disabled = true;
  var old = btnImportBackup.innerHTML;
  btnImportBackup.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Importing...';
  try {
    var res = await window.api.importBackup();
    if (!res || !res.ok) { if (res && !res.canceled) alert('Backup import failed: ' + (res.error || 'unknown error')); return; }
    var s = res.summary || {};
    var counts = ['Library tracks: ' + (s.library || 0), 'Playlists: ' + (s.playlists || 0), 'Liked songs: ' + (s.likedSongs || 0)].join('\n');
    if (!confirm('Import backup from:\n' + res.filePath + '\n\n' + counts + '\n\nThis will replace current app library/playlists/settings. Continue?')) return;
    pushUndoSnapshot('Import backup');
    var restored = await window.api.restoreBackup(res.filePath);
    if (!restored || !restored.ok) { alert('Backup restore failed: ' + ((restored && restored.error) || 'unknown error')); return; }
    var loaded = await Promise.all([window.api.loadLibrary(), window.api.loadPlaylists(), window.api.loadMappings(), window.api.loadSettings()]);
    setMusicFiles(loaded[0] || []);
    state.playlists = loaded[1] || [];
    state.mappings = loaded[2] || {};
    appSettings = Object.assign({}, appSettings, loaded[3] || {});
    state.likedSongs = Array.isArray(restored.likedSongs) ? restored.likedSongs : state.likedSongs;
    localStorage.setItem('likedSongs', JSON.stringify(state.likedSongs));
    applyThemeSettings();
    if (typeof initThemePicker === 'function') initThemePicker();
    if (typeof refreshDownloadFolderUi === 'function') refreshDownloadFolderUi();
    if (typeof updateLastfmIcon === 'function') updateLastfmIcon();
    if (typeof refreshSafeStorageStatus === 'function') refreshSafeStorageStatus();
    renderSidebarPlaylists();
    switchView('library');
    hideModal($('settings-modal'));
    alert('Backup imported successfully.');
  } catch (e) {
    alert('Backup import failed: ' + backupIpcErrorMessage(e));
  } finally {
    btnImportBackup.disabled = false;
    btnImportBackup.innerHTML = old;
  }
});
var settMin = $('setting-minimize'); if (settMin) settMin.addEventListener('change', async function (e) { appSettings.minimizeToTray = e.target.checked; await window.api.saveSettings(appSettings); });
var settAudio = $('setting-audio-mode'); if (settAudio) settAudio.addEventListener('change', async function (e) { appSettings.audioMode = e.target.value; await window.api.saveSettings(appSettings); applyAudioMode(); });
var settDiscogsToken = $('setting-discogs-token');
if (settDiscogsToken) settDiscogsToken.addEventListener('change', async function (e) {
  appSettings.discogsToken = e.target.value.trim();
  await window.api.saveSettings(appSettings);
});
var settSpotifyClientId = $('setting-spotify-client-id');
if (settSpotifyClientId) settSpotifyClientId.addEventListener('change', async function (e) {
  appSettings.spotifyClientId = e.target.value.trim();
  await window.api.saveSettings(appSettings);
});
var settSpotifyClientSecret = $('setting-spotify-client-secret');
if (settSpotifyClientSecret) settSpotifyClientSecret.addEventListener('change', async function (e) {
  appSettings.spotifyClientSecret = e.target.value.trim();
  await window.api.saveSettings(appSettings);
});
function refreshDownloadFolderUi() {
  var inp = $('setting-download-folder');
  if (inp) inp.value = appSettings.ytdlDownloadFolder || '';
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
var btnDownloadFolder = $('btn-download-folder');
if (btnDownloadFolder) btnDownloadFolder.addEventListener('click', async function () {
  var folder = await window.api.openFolder();
  if (!folder) return;
  appSettings.ytdlDownloadFolder = folder;
  await window.api.saveSettings(appSettings);
  refreshDownloadFolderUi();
});
var settingYtdlCookiesMode = $('setting-ytdl-cookies-mode');
if (settingYtdlCookiesMode) settingYtdlCookiesMode.addEventListener('change', async function (e) {
  appSettings.ytdlCookiesMode = e.target.value || 'none';
  await window.api.saveSettings(appSettings);
  refreshDownloadFolderUi();
});
var settingYtdlCookiesBrowser = $('setting-ytdl-cookies-browser');
if (settingYtdlCookiesBrowser) settingYtdlCookiesBrowser.addEventListener('change', async function (e) {
  appSettings.ytdlCookiesBrowser = e.target.value || 'firefox';
  await window.api.saveSettings(appSettings);
  refreshDownloadFolderUi();
});
var btnYtdlCookiesFile = $('btn-ytdl-cookies-file');
if (btnYtdlCookiesFile) btnYtdlCookiesFile.addEventListener('click', async function () {
  var file = window.api.openCookiesFile ? await window.api.openCookiesFile() : null;
  if (!file) return;
  appSettings.ytdlCookiesFile = file;
  appSettings.ytdlCookiesMode = 'file';
  await window.api.saveSettings(appSettings);
  refreshDownloadFolderUi();
});
async function checkYtdlpTools(targetEl) {
  var el = targetEl || $('ytdlp-status-text');
  if (el) el.textContent = 'Checking...';
  var res = window.api.checkYtdlpTools ? await window.api.checkYtdlpTools() : null;
  if (el) el.textContent = res && res.ok ? ('yt-dlp ' + res.ytdlp + ', ffmpeg OK') : ((res && res.error) || 'Tool check unavailable');
  return res;
}
var btnCheckYtdlp = $('btn-check-ytdlp');
if (btnCheckYtdlp) btnCheckYtdlp.addEventListener('click', function () { checkYtdlpTools($('ytdlp-status-text')); });
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
      el.textContent = 'Warning: OS encryption is unavailable. API tokens may be stored in plain text. On Linux, install/enable a secret service or keyring.';
    }
  } catch (e) {
    el.style.color = 'var(--danger)';
    el.textContent = 'Could not check OS encryption status.';
  }
}
var settDiscord = $('setting-discord-rpc'); if (settDiscord) settDiscord.addEventListener('change', async function (e) {
  appSettings.discordRpc = e.target.checked;
  await window.api.saveSettings(appSettings);
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
var settCrossfade = $('setting-crossfade');
if (settCrossfade) {
  settCrossfade.addEventListener('input', function (e) {
    appSettings.crossfade = e.target.value;
    var cv = $('crossfade-val'); if (cv) cv.textContent = e.target.value + 's';
    saveSettingsDebounced();
  });
}
var settMasterGain = $('setting-master-gain');
if (settMasterGain) {
  settMasterGain.addEventListener('input', function (e) {
    appSettings.masterGain = parseInt(e.target.value);
    var mgv = $('master-gain-val'); if (mgv) mgv.textContent = e.target.value + '%';
    if (typeof audioGainNode !== 'undefined' && audioGainNode) {
      audioGainNode.gain.value = appSettings.masterGain / 100.0;
    }
    saveSettingsDebounced();
  });
}

var queueToggle = $('btn-queue-toggle'); if (queueToggle) queueToggle.addEventListener('click', toggleQueue);
var closeQueue = $('btn-close-queue'); if (closeQueue) closeQueue.addEventListener('click', function () { isQueueOpen = false; $('queue-panel').classList.remove('open'); });

var settNorm = $('setting-normalization');
if (settNorm) settNorm.addEventListener('change', async function (e) {
  appSettings.normalization = e.target.checked;
  await window.api.saveSettings(appSettings);
  if (audioCtx) updateAudioChain();
  updateReplayGainStatus(state.currentPlayingTrack);
});

var settNotif = $('setting-notifications');
if (settNotif) settNotif.addEventListener('change', async function (e) {
  appSettings.notifications = e.target.checked;
  await window.api.saveSettings(appSettings);
});

var settNativeTitleBar = $('setting-native-titlebar');
if (settNativeTitleBar) settNativeTitleBar.addEventListener('change', async function (e) {
  var nextValue = e.target.checked;
  var changed = !!appSettings.useNativeTitleBar !== nextValue;
  appSettings.useNativeTitleBar = nextValue;
  await window.api.saveSettings(appSettings);
  if (changed) alert('Restart Playerinyo to apply the title bar change.');
});

var settVS = $('setting-virtual-scrolling');
if (settVS) settVS.addEventListener('change', async function (e) {
  appSettings.virtualScrolling = e.target.checked;
  await window.api.saveSettings(appSettings);
});

var settLL = $('setting-lazy-loading');
if (settLL) settLL.addEventListener('change', async function (e) {
  appSettings.lazyLoading = e.target.checked;
  await window.api.saveSettings(appSettings);
});

function initThemePicker() {
  var container = $('theme-color-picker');
  if (!container) return;
  applyThemeSettings();
  container.innerHTML = '';
  PALETTE.forEach(function(color) {
    var btn = document.createElement('div');
    btn.className = 'color-swatch theme-preset-swatch';
    btn.style.background = color;
    if (appSettings.accentColor === color || (!appSettings.accentColor && color === DEFAULT_THEME_COLORS.accent)) {
      btn.style.border = '2px solid white';
      btn.style.transform = 'scale(1.1)';
    }
    btn.onclick = async function() {
      appSettings.accentColor = color;
      appSettings.themeColors = Object.assign({}, getThemeColors(), { accent: color });
      applyThemeSettings();
      await window.api.saveSettings(appSettings);
      initThemePicker(); // Refresh borders
    };
    container.appendChild(btn);
  });
  initAdvancedThemeControls();
}
initThemePicker();

function initAdvancedThemeControls() {
  var colors = getThemeColors();
  var map = {
    'theme-accent': 'accent',
    'theme-bg': 'bg',
    'theme-panel': 'panel',
    'theme-glass': 'glass',
    'theme-border': 'border',
    'theme-text': 'text',
    'theme-muted': 'muted',
    'theme-danger': 'danger'
  };
  Object.keys(map).forEach(function (id) {
    var input = $(id);
    if (!input) return;
    input.value = colors[map[id]] || DEFAULT_THEME_COLORS[map[id]];
    if (input._themeBound) return;
    input._themeBound = true;
    input.addEventListener('input', function () {
      appSettings.themeColors = Object.assign({}, getThemeColors());
      appSettings.themeColors[map[id]] = input.value;
      if (map[id] === 'accent') appSettings.accentColor = input.value;
      applyThemeSettings();
    });
    input.addEventListener('change', async function () {
      await window.api.saveSettings(appSettings);
      initThemePicker();
    });
  });
  var glassToggle = $('setting-glass-effects');
  if (glassToggle) {
    glassToggle.checked = appSettings.glassEffects !== false;
    if (!glassToggle._themeBound) {
      glassToggle._themeBound = true;
      glassToggle.addEventListener('change', async function () {
        appSettings.glassEffects = this.checked;
        applyThemeSettings();
        await window.api.saveSettings(appSettings);
      });
    }
  }
  var resetBtn = $('theme-reset-btn');
  if (resetBtn && !resetBtn._themeBound) {
    resetBtn._themeBound = true;
    resetBtn.addEventListener('click', async function () {
      appSettings.themeColors = Object.assign({}, DEFAULT_THEME_COLORS);
      appSettings.accentColor = DEFAULT_THEME_COLORS.accent;
      appSettings.glassEffects = true;
      applyThemeSettings();
      await window.api.saveSettings(appSettings);
      initThemePicker();
    });
  }
}

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

var btnMultiSelect = $('btn-multi-select');
if (btnMultiSelect) btnMultiSelect.addEventListener('click', function () {
  if (typeof isMultiSelectMode === 'undefined') window.isMultiSelectMode = false;
  if (typeof selectedAlbumsForEdit === 'undefined') window.selectedAlbumsForEdit = new Set();
  isMultiSelectMode = !isMultiSelectMode;
  this.classList.toggle('active', isMultiSelectMode);
  this.style.color = isMultiSelectMode ? 'var(--accent)' : '';
  if (!isMultiSelectMode) {
    selectedAlbumsForEdit.clear();
    updateMultiSelectControls();
  }
  renderLibrary();
});

var btnMultiEdit = $('btn-multi-edit');
if (btnMultiEdit) btnMultiEdit.addEventListener('click', function () {
  if (typeof selectedAlbumsForEdit === 'undefined' || selectedAlbumsForEdit.size === 0) return;
  var allTracks = getLibraryIndex().albums.filter(function (album) { return selectedAlbumsForEdit.has(album.id); }).flatMap(function (album) { return album.tracks; });
  if (allTracks.length > 0) openMetadataEditor(allTracks);
});

var btnMultiMerge = $('btn-multi-merge');
if (btnMultiMerge) btnMultiMerge.addEventListener('click', async function () {
  if (!selectedAlbumsForEdit || selectedAlbumsForEdit.size < 2) return;
  var allTracks = getLibraryIndex().albums.filter(function (album) { return selectedAlbumsForEdit.has(album.id); }).flatMap(function (album) { return album.tracks; });
  if (!allTracks.length) return;
  openMetadataEditor(allTracks);
  selectedAlbumsForEdit.clear();
  isMultiSelectMode = false;
  if ($('btn-multi-select')) {
    $('btn-multi-select').classList.remove('active');
    $('btn-multi-select').style.color = '';
  }
  updateMultiSelectControls();
});

var btnMultiRemove = $('btn-multi-remove');
if (btnMultiRemove) btnMultiRemove.addEventListener('click', async function () {
  if (!selectedAlbumsForEdit || selectedAlbumsForEdit.size === 0) return;
  var albumCount = selectedAlbumsForEdit.size;
  var allTracks = getLibraryIndex().albums.filter(function (album) { return selectedAlbumsForEdit.has(album.id); }).flatMap(function (album) { return album.tracks; });
  if (!allTracks.length) return;
  if (!confirm('Remove ' + albumCount + ' album' + (albumCount === 1 ? '' : 's') + ' / ' + allTracks.length + ' track' + (allTracks.length === 1 ? '' : 's') + ' from the library?\n\nThis does not delete files from disk. Playlist entries are left untouched.')) return;
  var removed = await removeLibraryFiles(allTracks, 'Remove selected albums from library');
  selectedAlbumsForEdit.clear();
  isMultiSelectMode = false;
  if ($('btn-multi-select')) {
    $('btn-multi-select').classList.remove('active');
    $('btn-multi-select').style.color = '';
  }
  updateMultiSelectControls();
  switchView('library', false);
  showToast('Removed ' + removed + ' track' + (removed === 1 ? '' : 's') + ' from the library.');
});

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
  var width = canvas.width = canvas.offsetWidth;
  var height = canvas.height = canvas.offsetHeight;

  var bufferLength = analyserNode.frequencyBinCount;
  var dataArray = new Uint8Array(bufferLength);
  analyserNode.getByteFrequencyData(dataArray);

  ctx.clearRect(0, 0, width, height);

  var barWidth = (width / bufferLength) * 2.5;
  var barHeight;
  var x = 0;

  var accentRaw = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#1DB954';
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

var btnEq = $('btn-eq'); if (btnEq) btnEq.addEventListener('click', function () { initAudioCtx(); buildEqUi(); showModal($('eq-modal')); });
var btnCloseEq = $('btn-close-eq'); if (btnCloseEq) btnCloseEq.addEventListener('click', function () { hideModal($('eq-modal')); });
var btnResetEq = $('btn-reset-eq'); if (btnResetEq) btnResetEq.addEventListener('click', function () { applyEqPreset('Flat'); });
[$('settings-modal'), $('create-playlist-modal'), $('eq-modal')].forEach(function (m) { if (m) m.addEventListener('click', function (e) { if (e.target === m) hideModal(m); }); });

/* ─── LYRICS ENGINE ─── */

function parseLrc(lrcText) {
  var lines = lrcText.split('\n');
  var result = [];
  lines.forEach(function (line) {
    var match = line.match(/^\[(\d+):(\d+\.?\d*)\](.*)$/);
    if (match) {
      var secs = parseInt(match[1]) * 60 + parseFloat(match[2]);
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
    div.addEventListener('click', function () {
      var audio = window.audioEls ? window.audioEls[activeAudioIdx] : $('audio-player-0');
      if (audio) audio.currentTime = line.time;
    });
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
  if (!lyricsData.length || !lyricsOpen) return;
  currentTime += lyricsOffsetSec;
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

  // Update plain lyrics progress bar if exists
  var plainBar = $('plain-lyrics-progress-bar');
  if (plainBar && window.audioEls) {
    var audio = window.audioEls[activeAudioIdx];
    if (audio && !isNaN(audio.duration) && audio.duration > 0) {
      plainBar.style.width = ((audio.currentTime / audio.duration) * 100) + '%';
      
      // Auto-scroll plain lyrics proportionally
      var lc2 = $('lyrics-content');
      if (lc2 && lc2.scrollHeight > lc2.clientHeight) {
        var scrollRatio = audio.currentTime / audio.duration;
        var maxScroll = lc2.scrollHeight - lc2.clientHeight;
        // Don't use smooth here as it updates constantly
        lc2.scrollTop = maxScroll * scrollRatio;
      }
    }
  }
}

async function fetchLyricsForTrack(track) {
  if (!track) return;
  loadLyricsOffsetForTrack(track);
  var key = (track.title || '') + '::' + (track.artist || '');
  if (key === lyricsCurrentTrackKey) return;

  // Reset state and clear UI immediately
  lyricsCurrentTrackKey = key;
  lyricsData = [];
  lyricsActiveIdx = -2;
  npLyricsActiveIdx = -2;
  var lc = $('lyrics-content');
  if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-spinner ph-spin" style="font-size:36px;color:var(--text-subdued);"></i><p style="color:var(--text-subdued);font-size:12px;margin-top:12px;">Searching lyrics...</p></div>';
  if (npOverlayOpen && appSettings.npLyricsVisible !== false) mirrorLyricsToNP(); // Clear NP overlay lyrics

  if (!track.matchedFile) {
    if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-warning" style="font-size:48px;color:var(--text-disabled);margin-bottom:12px;"></i><p style="color:var(--text-subdued);font-size:13px;">No local file matched</p></div>';
    return;
  }

  // Try LRCLIB API
  try {
    var duration = track.duration ? Math.round(track.duration) : 0;
    var apiUrl = 'https://lrclib.net/api/get?artist_name=' + encodeURIComponent(track.artist) + '&track_name=' + encodeURIComponent(track.title) + '&album_name=' + encodeURIComponent(track.album || '') + (duration ? '&duration=' + duration : '');
    var resp = await fetch(apiUrl);

    if (resp.ok) {
      var data = await resp.json();
      if (data && data.syncedLyrics) {
        lyricsData = parseLrc(data.syncedLyrics);
        renderLyricsPanel();
        if (npOverlayOpen && appSettings.npLyricsVisible !== false) mirrorLyricsToNP();
        return;
      } else if (data && data.plainLyrics) {
        // Clear synced data as we only have plain
        lyricsData = [];
        var lc2 = $('lyrics-content');
        if (lc2) {
          lc2.innerHTML = '';
          var plainProgressContainer = document.createElement('div');
          plainProgressContainer.id = 'plain-lyrics-progress-container';
          plainProgressContainer.style.cssText = 'width:80%;height:4px;background:rgba(255,255,255,0.1);border-radius:2px;margin:0 auto 16px;overflow:hidden;';
          plainProgressContainer.innerHTML = '<div id="plain-lyrics-progress-bar" style="width:0%;height:100%;background:var(--accent);transition:width 0.1s;"></div>';
          lc2.appendChild(plainProgressContainer);

          data.plainLyrics.split('\n').forEach(function (line) {
            var div = document.createElement('div');
            div.style.cssText = 'padding:6px 14px;font-size:14px;color:var(--text-subdued);text-align:center;line-height:1.6;';
            div.textContent = line || '\u00a0';
            lc2.appendChild(div);
          });
          var note = document.createElement('div');
          note.style.cssText = 'font-size:11px;color:var(--text-disabled);text-align:center;padding:16px;';
          note.textContent = 'Plain lyrics (no sync available)';
          lc2.appendChild(note);
        }
        if (npOverlayOpen && appSettings.npLyricsVisible !== false) mirrorLyricsToNP();
        return;
      }
    }
  } catch (e) { console.log('LRCLIB fetch error:', e); }

  // Final fallback: No lyrics found
  if (lyricsCurrentTrackKey === key) {
    lyricsData = [];
    if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-microphone-stage" style="font-size:48px;color:var(--text-disabled);margin-bottom:12px;"></i><p style="color:var(--text-subdued);font-size:13px;">Lyrics Not Found</p><p style="color:var(--text-disabled);font-size:11px;margin-top:4px;">Right-click here to search manually</p></div>';
    if (npOverlayOpen && appSettings.npLyricsVisible !== false) mirrorLyricsToNP();
  }
}

function toggleLyrics() {
  lyricsOpen = !lyricsOpen;
  var panel = $('lyrics-panel');
  if (panel) panel.classList.toggle('open', lyricsOpen);
  var btn = $('btn-lyrics-toggle');
  if (btn) btn.style.color = lyricsOpen ? 'var(--accent)' : '';
  if (lyricsOpen && state.currentPlayingTrack) fetchLyricsForTrack(state.currentPlayingTrack);
}

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
var lcElement = $('lyrics-content');
if (lcElement) lcElement.addEventListener('contextmenu', openManualLyricsSearch);
var manualLyricsCancel = $('manual-lyrics-cancel');
if (manualLyricsCancel) manualLyricsCancel.addEventListener('click', function () { hideModal($('manual-lyrics-modal')); });
var manualLyricsSearch = $('manual-lyrics-search');
if (manualLyricsSearch) manualLyricsSearch.addEventListener('click', runManualLyricsSearch);
['manual-lyrics-artist', 'manual-lyrics-title'].forEach(function (id) {
  var input = $(id);
  if (input) input.addEventListener('keydown', function (e) { if (e.key === 'Enter') runManualLyricsSearch(); });
});
var manualLyricsModal = $('manual-lyrics-modal');
if (manualLyricsModal) manualLyricsModal.addEventListener('click', function (e) { if (e.target === manualLyricsModal) hideModal(manualLyricsModal); });

var btnLyricsToggle = $('btn-lyrics-toggle');
if (btnLyricsToggle) btnLyricsToggle.addEventListener('click', toggleLyrics);
var btnLyricsOffsetDown = $('btn-lyrics-offset-down');
if (btnLyricsOffsetDown) btnLyricsOffsetDown.addEventListener('click', function () { setLyricsOffset(lyricsOffsetSec - 0.5); });
var btnLyricsOffsetUp = $('btn-lyrics-offset-up');
if (btnLyricsOffsetUp) btnLyricsOffsetUp.addEventListener('click', function () { setLyricsOffset(lyricsOffsetSec + 0.5); });
var btnCloseLyrics = $('btn-close-lyrics');
if (btnCloseLyrics) btnCloseLyrics.addEventListener('click', function () { lyricsOpen = false; $('lyrics-panel').classList.remove('open'); var btn = $('btn-lyrics-toggle'); if (btn) btn.style.color = ''; });
var btnLyricsFile = $('btn-lyrics-load-file');
if (btnLyricsFile) btnLyricsFile.addEventListener('click', async function () {
  var content = await window.api.openLrc();
  if (!content) return;
  lyricsData = parseLrc(content);
  lyricsCurrentTrackKey = 'custom';
  renderLyricsPanel();
});

/* ─── GLOBAL SHORTCUTS MANAGER ─── */
var DEFAULT_SHORTCUTS = [
  { id: 'playpause', label: 'Play / Pause', action: 'playpause', accelerator: 'MediaPlayPause', enabled: true },
  { id: 'next', label: 'Next Track', action: 'next', accelerator: 'MediaNextTrack', enabled: true },
  { id: 'prev', label: 'Previous Track', action: 'prev', accelerator: 'MediaPreviousTrack', enabled: true },
  { id: 'shuffle', label: 'Toggle Shuffle', action: 'shuffle', accelerator: 'Ctrl+Shift+S', enabled: false },
  { id: 'loop', label: 'Cycle Loop Mode', action: 'loop', accelerator: 'Ctrl+Shift+L', enabled: false },
  { id: 'queue', label: 'Toggle Queue', action: 'queue', accelerator: 'Ctrl+Shift+Q', enabled: false },
];

function getShortcuts() {
  return appSettings.shortcuts || DEFAULT_SHORTCUTS.map(function (s) { return Object.assign({}, s); });
}

async function saveAndApplyShortcuts(shortcuts) {
  appSettings.shortcuts = shortcuts;
  await window.api.saveSettings(appSettings);
  return rememberShortcutRegistrationResult(await window.api.registerShortcuts(shortcuts));
}

function rememberShortcutRegistrationResult(result) {
  shortcutRegistrationFailures = result && Array.isArray(result.failed) ? result.failed : [];
  if (shortcutRegistrationFailures.length) console.warn('Shortcuts unavailable:', shortcutRegistrationFailures);
  return result;
}

function renderShortcutsList() {
  var container = $('shortcuts-list'); if (!container) return;
  container.innerHTML = '';
  var shortcuts = getShortcuts();
  shortcuts.forEach(function (sc) {
    var row = document.createElement('div');
    row.className = 'shortcut-row';

    var lbl = document.createElement('span');
    lbl.className = 'shortcut-label';
    lbl.textContent = sc.label;

    var keyBtn = document.createElement('span');
    var failure = shortcutRegistrationFailures.find(function (item) { return item.accelerator === sc.accelerator; });
    keyBtn.className = 'shortcut-key' + (sc.enabled && !failure ? '' : ' disabled-key');
    keyBtn.textContent = (sc.accelerator || 'None') + (failure ? ' (unavailable)' : '');
    keyBtn.title = failure ? ('Unavailable on this OS/session: ' + (failure.error || 'registration failed')) : 'Click to rebind';
    keyBtn.addEventListener('click', function () {
      if (!sc.enabled) return;
      openRebindModal(sc, shortcuts);
    });

    var toggle = document.createElement('button');
    toggle.className = 'shortcut-toggle' + (sc.enabled ? ' on' : '');
    toggle.title = sc.enabled ? 'Disable' : 'Enable';
    toggle.addEventListener('click', async function () {
      sc.enabled = !sc.enabled;
      toggle.classList.toggle('on', sc.enabled);
      toggle.title = sc.enabled ? 'Disable' : 'Enable';
      await saveAndApplyShortcuts(shortcuts);
      renderShortcutsList();
    });

    row.appendChild(lbl);
    row.appendChild(keyBtn);
    row.appendChild(toggle);
    container.appendChild(row);
  });
}

var rebindTarget = null;
var rebindPressedAccelerator = null;

function openRebindModal(sc, allShortcuts) {
  rebindTarget = { sc: sc, all: allShortcuts };
  rebindPressedAccelerator = null;
  var display = $('rebind-key-display');
  if (display) display.textContent = 'Waiting...';
  var confirmBtn = $('rebind-confirm-btn');
  if (confirmBtn) { confirmBtn.disabled = true; }
  var title = $('rebind-modal-title');
  if (title) title.textContent = 'Rebind: ' + sc.label;
  // Unregister ALL global shortcuts so keys are fully free to capture
  window.api.registerShortcuts([]);
  showModal($('shortcut-rebind-modal'));
}

function closeRebindModal(reRegister) {
  hideModal($('shortcut-rebind-modal'));
  rebindTarget = null;
  if (reRegister !== false) {
    // Re-register saved shortcuts after modal closes
    window.api.registerShortcuts(getShortcuts()).then(rememberShortcutRegistrationResult);
  }
}

function electronAcceleratorFromEvent(e) {
  var parts = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.shiftKey) parts.push('Shift');
  if (e.altKey) parts.push('Alt');
  var key = e.key;
  if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null;
  if (key === ' ') key = 'Space';
  else if (key === 'ArrowUp') key = 'Up';
  else if (key === 'ArrowDown') key = 'Down';
  else if (key === 'ArrowLeft') key = 'Left';
  else if (key === 'ArrowRight') key = 'Right';
  else if (key.length === 1) key = key.toUpperCase();
  parts.push(key);
  if (parts.length === 1 && ['MediaPlayPause', 'MediaNextTrack', 'MediaPreviousTrack', 'MediaStop'].includes(key)) return key;
  return parts.join('+');
}

var isRebinding = false;
document.addEventListener('keydown', function (e) {
  if (!$('shortcut-rebind-modal').classList.contains('active')) return;
  e.preventDefault(); e.stopPropagation();
  if (e.key === 'Escape') { closeRebindModal(); return; }
  var acc = electronAcceleratorFromEvent(e);
  if (!acc) return;
  rebindPressedAccelerator = acc;
  var display = $('rebind-key-display');
  if (display) display.textContent = acc;
  var confirmBtn = $('rebind-confirm-btn');
  if (confirmBtn) confirmBtn.disabled = false;
}, true);

var rebindConfirmBtn = $('rebind-confirm-btn');
if (rebindConfirmBtn) rebindConfirmBtn.addEventListener('click', async function () {
  if (!rebindTarget || !rebindPressedAccelerator) return;
  rebindTarget.sc.accelerator = rebindPressedAccelerator;
  await saveAndApplyShortcuts(rebindTarget.all);
  closeRebindModal(false); // already re-registered in saveAndApplyShortcuts
  renderShortcutsList();
  rebindTarget = null;
});
var rebindCancelBtn = $('rebind-cancel-btn');
if (rebindCancelBtn) rebindCancelBtn.addEventListener('click', function () { closeRebindModal(); });

/* --- NOW PLAYING OVERLAY --- */
var npOverlayOpen = false;
function applyNPLyricsVisibility() {
  var ov = document.getElementById('now-playing-overlay');
  var btn = document.getElementById('np-lyrics-toggle');
  var visible = appSettings.npLyricsVisible !== false;
  if (ov) ov.classList.toggle('np-lyrics-hidden', !visible);
  if (btn) {
    btn.title = visible ? 'Hide lyrics' : 'Show lyrics';
    btn.style.color = visible ? 'var(--accent)' : 'rgba(255,255,255,0.6)';
  }
}
function openNowPlayingOverlay() {
  npOverlayOpen = true;
  var ov = document.getElementById('now-playing-overlay');
  if (ov) ov.classList.add('open');
  applyNPLyricsVisibility();
  var btn = document.getElementById('btn-now-playing-overlay');
  if (btn) btn.style.color = 'var(--accent)';
  updateNowPlayingOverlay();
  if (appSettings.npLyricsVisible === false) return;
  if (lyricsData && lyricsData.length) mirrorLyricsToNP();
  else if (state.currentPlayingTrack) {
    fetchLyricsForTrack(state.currentPlayingTrack);
  }
}
function closeNowPlayingOverlay() {
  npOverlayOpen = false;
  var ov = document.getElementById('now-playing-overlay');
  if (ov) ov.classList.remove('open');
  var btn = document.getElementById('btn-now-playing-overlay');
  if (btn) btn.style.color = '';
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
  if (track && track.matchedFile) {
    var pic = track.matchedFile.picture || '';
    if (artEl) { artEl.src = pic; artEl.style.display = pic ? 'block' : 'none'; }
    if (placeholder) placeholder.style.display = pic ? 'none' : 'flex';
    if (bgBlur && pic) bgBlur.style.backgroundImage = 'url(' + pic + ')';
    if (titleEl) titleEl.textContent = track.title || '';
    if (artistEl) artistEl.textContent = track.artist || '';
    if (albumEl) albumEl.textContent = track.album || '';
  } else {
    if (artEl) { artEl.src = ''; artEl.style.display = 'none'; }
    if (placeholder) placeholder.style.display = 'flex';
    if (bgBlur) bgBlur.style.backgroundImage = '';
    if (titleEl) titleEl.textContent = 'No track';
    if (artistEl) artistEl.textContent = String.fromCharCode(8212);
    if (albumEl) albumEl.textContent = '';
  }
  if (playIcon) playIcon.className = state.isPlaying ? 'ph ph-pause-circle' : 'ph ph-play-circle';
}
function mirrorLyricsToNP() {
  var npLc = document.getElementById('np-lyrics-content');
  if (!npLc) return;
  npLyricsActiveIdx = -2;
  npLc.innerHTML = '';
  if (!lyricsData || !lyricsData.length) {
    npLc.innerHTML = '<div style="padding:40px 0;text-align:center;color:rgba(255,255,255,0.25);font-size:13px;">No synced lyrics found<br><span style="font-size:11px;color:rgba(255,255,255,0.18);">Right-click to search manually</span></div>';
    return;
  }
  lyricsData.forEach(function (line) {
    var div = document.createElement('div');
    div.className = 'lyric-line';
    div.textContent = line.text;
    div.addEventListener('click', function () {
      var audio = window.audioEls ? window.audioEls[activeAudioIdx] : document.getElementById('audio-player-0');
      if (audio) audio.currentTime = line.time;
    });
    npLc.appendChild(div);
  });
}
function updateNPLyricsHighlight(currentTime) {
  if (!npOverlayOpen || appSettings.npLyricsVisible === false || !lyricsData.length) return;
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
var _npBtnPlay = document.getElementById('np-btn-play');
if (_npBtnPlay) _npBtnPlay.addEventListener('click', function () { initAudioCtx(); togglePlay(); updateNowPlayingOverlay(); });
var _npBtnPrev = document.getElementById('np-btn-prev');
if (_npBtnPrev) _npBtnPrev.addEventListener('click', function () { initAudioCtx(); playPrevTrack(); });
var _npBtnNext = document.getElementById('np-btn-next');
if (_npBtnNext) _npBtnNext.addEventListener('click', function () { initAudioCtx(); playNextTrack(); });
var _npBtnShuffle = document.getElementById('np-btn-shuffle');
if (_npBtnShuffle) _npBtnShuffle.addEventListener('click', function () { toggleShuffle(); _npBtnShuffle.style.color = state.isShuffle ? 'var(--accent)' : ''; });
var _npBtnLoop = document.getElementById('np-btn-loop');
if (_npBtnLoop) _npBtnLoop.addEventListener('click', function () { cycleLoop(); var li = document.getElementById('np-loop-icon'); if (li) { li.className = state.loopMode === 2 ? 'ph ph-repeat-once' : 'ph ph-repeat'; li.style.color = state.loopMode > 0 ? 'var(--accent)' : ''; } });
var _npLyricsToggle = document.getElementById('np-lyrics-toggle');
if (_npLyricsToggle) _npLyricsToggle.addEventListener('click', async function () {
  appSettings.npLyricsVisible = appSettings.npLyricsVisible === false;
  applyNPLyricsVisibility();
  if (appSettings.npLyricsVisible !== false && state.currentPlayingTrack && (!lyricsData || !lyricsData.length)) fetchLyricsForTrack(state.currentPlayingTrack);
  await window.api.saveSettings(appSettings);
});
var _npLyricsOffsetDown = document.getElementById('np-lyrics-offset-down');
if (_npLyricsOffsetDown) _npLyricsOffsetDown.addEventListener('click', function () { setLyricsOffset(lyricsOffsetSec - 0.5); });
var _npLyricsOffsetUp = document.getElementById('np-lyrics-offset-up');
if (_npLyricsOffsetUp) _npLyricsOffsetUp.addEventListener('click', function () { setLyricsOffset(lyricsOffsetSec + 0.5); });
var _npLyricsContent = document.getElementById('np-lyrics-content');
if (_npLyricsContent) _npLyricsContent.addEventListener('contextmenu', openManualLyricsSearch);
var _npOverlayEl = document.getElementById('now-playing-overlay');
if (_npOverlayEl) _npOverlayEl.addEventListener('contextmenu', function (e) {
  if (e.target.closest('#np-lyrics-content')) return;
  if (e.target.closest('button') || e.target.closest('#np-progress-container')) return;
  openManualLyricsSearch(e);
});
var _btnNPOverlay = document.getElementById('btn-now-playing-overlay');
if (_btnNPOverlay) _btnNPOverlay.addEventListener('click', toggleNowPlayingOverlay);
var _npCloseBtn = document.getElementById('np-close-btn');
if (_npCloseBtn) _npCloseBtn.addEventListener('click', closeNowPlayingOverlay);
var _npPc = document.getElementById('np-progress-container');
if (_npPc) {
  var _npDragging = false;
  _npPc.addEventListener('mousedown', function (e) {
    var a = window.audioEls ? window.audioEls[activeAudioIdx] : document.getElementById('audio-player-0');
    if (!state.currentPlayingTrack || isNaN(a.duration)) return;
    _npDragging = true; _npUpdateProg(e, a);
  });
  document.addEventListener('mousemove', function (e) { if (_npDragging) _npUpdateProg(e, window.audioEls ? window.audioEls[activeAudioIdx] : document.getElementById('audio-player-0')); });
  document.addEventListener('mouseup', function () { _npDragging = false; });
  function _npUpdateProg(e, a) { var r = _npPc.getBoundingClientRect(); a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.duration; }
}
/* ─── LAST.FM INTEGRATION ─── */
var btnLfmLogin = $('btn-lastfm-login');
if (btnLfmLogin) {
  btnLfmLogin.addEventListener('click', function () {
    if (appSettings.lastfmSessionKey) {
      if (confirm('You are connected as ' + appSettings.lastfmUsername + '. Disconnect?')) {
        appSettings.lastfmSessionKey = null; appSettings.lastfmUsername = null; window.api.saveSettings(appSettings);
        if (state.currentView === 'home') renderHomeDashboard();
        updateLastfmIcon();
      }
    } else {
      var inpKey = $('lastfm-api-key'); if (inpKey) inpKey.value = appSettings.lastfmApiKey || '';
      var inpSec = $('lastfm-shared-secret'); if (inpSec) inpSec.value = appSettings.lastfmSharedSecret || '';
      showModal($('lastfm-modal'));
    }
  });
}

var btnLfmBrowser = $('btn-lastfm-open-browser');
var btnLfmConfirm = $('btn-lastfm-confirm');
var lastfmToken = null;

if (btnLfmBrowser) {
  btnLfmBrowser.addEventListener('click', async function () {
    var ak = ($('lastfm-api-key') ? $('lastfm-api-key').value : '').trim();
    var ss = ($('lastfm-shared-secret') ? $('lastfm-shared-secret').value : '').trim();
    if (!ak || !ss) { alert('Enter your Last.fm API key and shared secret first.'); return; }
    if (ak) appSettings.lastfmApiKey = ak;
    if (ss) appSettings.lastfmSharedSecret = ss;
    await window.api.saveSettings(appSettings);

    btnLfmBrowser.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Please wait...';
    var res = await window.api.lastfmGetAuthUrl(appSettings.lastfmApiKey);
    btnLfmBrowser.innerHTML = '1. Open Browser to Authorize';
    if (res && res.url && res.token) {
      lastfmToken = res.token;
      btnLfmConfirm.disabled = false; btnLfmConfirm.classList.remove('btn-outline'); btnLfmConfirm.classList.add('btn-primary');
      btnLfmConfirm.style.background = 'var(--accent)'; btnLfmConfirm.style.color = 'black';
    } else {
      alert('Failed to connect to Last.fm API. Check API keys or internet connection.');
    }
  });
}

if (btnLfmConfirm) {
  btnLfmConfirm.addEventListener('click', async function () {
    if (!lastfmToken) return;
    var ak = appSettings.lastfmApiKey;
    var ss = appSettings.lastfmSharedSecret;
    btnLfmConfirm.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Verifying...';
    var res = await window.api.lastfmGetSession(lastfmToken, ak, ss);
    btnLfmConfirm.innerHTML = '2. I have authorized';
    if (res && res.sessionKey) {
      appSettings.lastfmSessionKey = res.sessionKey;
      appSettings.lastfmUsername = res.name;
      await window.api.saveSettings(appSettings);
      hideModal($('lastfm-modal'));
      if (state.currentView === 'home') renderHomeDashboard();
      updateLastfmIcon();
    } else {
      alert('Failed to verify authorization. Did you click "Allow Access" in the browser?');
    }
  });
}
var btnLfmCancel = $('btn-lastfm-cancel'); if (btnLfmCancel) btnLfmCancel.addEventListener('click', function () { hideModal($('lastfm-modal')); });

function updateLastfmIcon() {
  var icon = $('lastfm-icon'); if (!icon) return;
  icon.style.color = appSettings.lastfmSessionKey ? '#d51007' : 'var(--text-subdued)';
}

// Add these with other context menu listeners
var actxPlayNext = $('actx-play-next');
if (actxPlayNext) actxPlayNext.addEventListener('click', function () {
  if (window.currentContextMenuAlbum) {
    var mapped = getSortedAlbumTracks(window.currentContextMenuAlbum).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
    state.userQueue = mapped.concat(state.userQueue);
    if (isQueueOpen) renderQueue();
  }
  hideAllContextMenus();
});

var actxAddQueue = $('actx-add-queue');
if (actxAddQueue) actxAddQueue.addEventListener('click', function () {
  if (window.currentContextMenuAlbum) {
    var mapped = getSortedAlbumTracks(window.currentContextMenuAlbum).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
    state.userQueue = state.userQueue.concat(mapped);
    if (isQueueOpen) renderQueue();
  }
  hideAllContextMenus();
});

var actxDownloadAlbum = $('actx-download-album');
if (actxDownloadAlbum) actxDownloadAlbum.addEventListener('click', function () {
  var album = window.currentContextMenuAlbum;
  hideAllContextMenus();
  openAlbumDownloadModal(album);
});

var actxAnalyzeLoudness = $('actx-analyze-loudness');
if (actxAnalyzeLoudness) actxAnalyzeLoudness.addEventListener('click', function () {
  if (window.currentContextMenuAlbum) analyzeLoudnessForFiles(getSortedAlbumTracks(window.currentContextMenuAlbum));
});

var actxEditMetadata = $('actx-edit-metadata');
if (actxEditMetadata) actxEditMetadata.addEventListener('click', function () {
  if (window.currentContextMenuAlbum && window.currentContextMenuAlbum.tracks) openMetadataEditor(getSortedAlbumTracks(window.currentContextMenuAlbum));
  hideAllContextMenus();
});

var actxSplitDisc = $('actx-split-disc');
if (actxSplitDisc) actxSplitDisc.addEventListener('click', async function () {
  var album = window.currentContextMenuAlbum;
  if (!album || !album.tracks || !album.tracks.length) return;
  if (!confirm('Split this album into separate app-library albums by disc? This changes the app library metadata, not the audio files.')) return;
  album.tracks.forEach(function (f) {
    var disc = getDiscNumber(f);
    if (disc > 1 || albumHasMultipleDiscs(album.tracks)) f.album = (album.name || f.album || 'Unknown Album').replace(/\s\(Disc \d+\)$/i, '') + ' (Disc ' + disc + ')';
  });
  markLibraryDirty();
  await window.api.saveLibrary(state.musicFiles);
  renderLibrary();
});

var ctxPlayNext = $('ctx-play-next');
if (ctxPlayNext) ctxPlayNext.addEventListener('click', function () {
  if (currentContextMenuTrack) {
    state.userQueue.unshift(currentContextMenuTrack);
    if (isQueueOpen) renderQueue();
  }
  hideAllContextMenus();
});

var ctxAddQueue = $('ctx-add-queue');
if (ctxAddQueue) ctxAddQueue.addEventListener('click', function () {
  if (currentContextMenuTrack) {
    state.userQueue.push(currentContextMenuTrack);
    if (isQueueOpen) renderQueue();
  }
  hideAllContextMenus();
});

var ctxAnalyzeLoudness = $('ctx-analyze-loudness');
if (ctxAnalyzeLoudness) ctxAnalyzeLoudness.addEventListener('click', function () {
  if (currentContextMenuTrack && currentContextMenuTrack.matchedFile) analyzeLoudnessForFiles([currentContextMenuTrack.matchedFile]);
});

var ctxGoToAlbum = $('ctx-go-to-album');
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

var ctxOpenFolder = $('ctx-open-folder');
if (ctxOpenFolder) ctxOpenFolder.addEventListener('click', function () {
  if (currentContextMenuTrack && currentContextMenuTrack.matchedFile) {
    showFileLocation(currentContextMenuTrack.matchedFile.filePath);
  }
  hideAllContextMenus();
});

var actxOpenFolder = $('actx-open-folder');
if (actxOpenFolder) actxOpenFolder.addEventListener('click', function () {
  if (currentContextMenuAlbum && currentContextMenuAlbum.tracks && currentContextMenuAlbum.tracks.length > 0) {
    showFileLocation(currentContextMenuAlbum.tracks[0].filePath);
  }
  hideAllContextMenus();
});

var actxRemoveLibrary = $('actx-remove-library');
if (actxRemoveLibrary) actxRemoveLibrary.addEventListener('click', async function () {
  var album = window.currentContextMenuAlbum;
  if (!album || !album.tracks || !album.tracks.length) return;
  var count = album.tracks.length;
  if (!confirm('Remove "' + (album.name || 'this album') + '" from the library?\n\nThis does not delete files from disk and does not remove playlist entries. Playlist songs will stay as missing/unmatched until you import the album again.')) {
    hideAllContextMenus();
    return;
  }
  await removeLibraryFiles(album.tracks, 'Remove album from library');
  hideAllContextMenus();
  switchView('library', false);
  showToast('Removed ' + count + ' track' + (count === 1 ? '' : 's') + ' from the library. Playlists were left untouched.');
});

var ctxRemoveMatch = $('ctx-remove-match');
if (ctxRemoveMatch) ctxRemoveMatch.addEventListener('click', async function () {
  if (currentContextMenuTrack) {
    var key = currentContextMenuTrack.title + '-' + currentContextMenuTrack.artist + '-' + (currentContextMenuTrack.album || '');
    state.mappings[key] = 'NO_MATCH';
    await window.api.saveMappings(state.mappings);
    if (currentContextMenuTrack.csvRecord) {
      delete currentContextMenuTrack.csvRecord.FilePath;
      delete currentContextMenuTrack.csvRecord.filePath;
      delete currentContextMenuTrack.csvRecord.Path;
      delete currentContextMenuTrack.csvRecord.path;
      await window.api.savePlaylists(state.playlists);
    }
    showToast('Match removed for ' + (currentContextMenuTrack.title || 'track') + '.');
    if (state.currentView.startsWith('pl_')) renderPlaylistPreservingScroll(state.currentView);
  }
  hideAllContextMenus();
});

var ctxDownloadTrack = $('ctx-download-track');
if (ctxDownloadTrack) ctxDownloadTrack.addEventListener('click', function () {
  var pl = getCurrentRegularPlaylist();
  var rows = getDownloadablePlaylistTracksFromContext().map(function (track) { return track.csvRecord; });
  hideAllContextMenus();
  showExistingPlaylistDownloadReview(pl, rows);
});

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
    var sn = r.Song || r.title || '', an = r.Artist || r.artist || '', al = r.Album || r.album || '';
    var m = findMatchingFile(sn, an, al, getPlaylistTrackFilePath(r));
    if (m && m.picture) return m.picture;
  }
  return null;
}

function makePlaylistFlyoutCoverHtml(pl) {
  var cover = getPlaylistFlyoutCover(pl);
  if (cover) return '<img class="playlist-flyout-cover" src="' + esc(cover) + '" alt="" />';
  var bg = pl && pl.color ? pl.color : '#3a3a3a';
  return '<span class="playlist-flyout-cover placeholder" style="background:' + bg + ';"><i class="ph ph-music-notes"></i></span>';
}

function countPlaylistDuplicates(pl, tracksToAdd) {
  if (!pl || !pl.tracks || !tracksToAdd || !tracksToAdd.length) return 0;
  return tracksToAdd.filter(function (trackToAdd) {
    return pl.tracks.some(function (t) { return samePlaylistTrack(t, trackToAdd); });
  }).length;
}

async function addTracksToPlaylist(pl, tracksToAdd) {
  tracksToAdd = (tracksToAdd || []).filter(Boolean);
  if (!pl || !tracksToAdd.length) return 0;
  if (!pl.tracks) pl.tracks = [];
  var addedCount = 0;
  tracksToAdd.forEach(function (trackToAdd) {
    var dup = pl.tracks.some(function (t) { return samePlaylistTrack(t, trackToAdd); });
    if (!dup) {
      pl.tracks.push(makePlaylistTrackRecord(trackToAdd));
      addedCount++;
    }
  });
  if (addedCount > 0) {
    pl.lastAddedAt = new Date().toISOString();
    await window.api.savePlaylists(state.playlists);
    renderSidebarPlaylists();
    if (state.currentView === pl.id) renderPlaylist(pl.id);
  }
  return addedCount;
}

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
  state.playlists.push(pl);
  var addedCount = await addTracksToPlaylist(pl, tracksToAdd);
  if (addedCount === 0) await window.api.savePlaylists(state.playlists);
  hideAllContextMenus();
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
        var addedCount = await addTracksToPlaylist(pl, addToPlaylistTracks);
        hideAllContextMenus();
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
  var search = $('add-to-playlist-search');
  if (search) search.value = '';
  renderAddToPlaylistFlyout('');
  positionSubmenu(menu, anchorEl);
  if (focusSearch && search) setTimeout(function () { search.focus(); }, 0);
}

function hideAddToPlaylistFlyout() {
  var menu = $('add-to-playlist-menu');
  if (menu) menu.classList.remove('visible');
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
      var sn = r.Song || r.title || '', an = r.Artist || r.artist || '', al = r.Album || r.album || '';
      var m = findMatchingFile(sn, an, al, getPlaylistTrackFilePath(r));
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
    var bgStyle = pl.color ? 'background:' + pl.color + ';' : 'background:#555;';
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
        if (!pl.tracks) pl.tracks = [];
        var addedCount = 0;
        tracksToAdd.forEach(function(trackToAdd) {
          var dup = pl.tracks.some(function (t) { return samePlaylistTrack(t, trackToAdd); });
          if (!dup) {
            pl.tracks.push(makePlaylistTrackRecord(trackToAdd));
            addedCount++;
          }
        });
        if (addedCount > 0) {
          pl.lastAddedAt = new Date().toISOString();
          await window.api.savePlaylists(state.playlists);
          renderSidebarPlaylists();
        } else if (!isSingleTrack) {
          alert('All tracks are already in "' + pl.name + '".');
        }
        hideModal($('playlist-selector-modal'));
        clearTrackSelection();
      });
    }
    listEl.appendChild(el);
  });
  showModal($('playlist-selector-modal'));
  if (listEl) listEl.scrollTop = 0;
}

var ctxAdd = $('ctx-add-playlist');
bindAddToPlaylistFlyoutTrigger(ctxAdd, getTracksFromTrackContextForPlaylistAdd);

var actxAdd = $('actx-add-playlist');
bindAddToPlaylistFlyoutTrigger(actxAdd, getTracksFromAlbumContextForPlaylistAdd);

var addToPlaylistSearch = $('add-to-playlist-search');
if (addToPlaylistSearch) addToPlaylistSearch.addEventListener('input', function (e) { renderAddToPlaylistFlyout(e.target.value); });
var addToPlaylistNew = $('add-to-playlist-new');
if (addToPlaylistNew) addToPlaylistNew.addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); createPlaylistFromAddFlyout(); });
bindAddToPlaylistFlyoutDismissers('track-context-menu', 'ctx-add-playlist');
bindAddToPlaylistFlyoutDismissers('album-context-menu', 'actx-add-playlist');
var ctxRemove = $('ctx-remove-playlist');
if (ctxRemove) ctxRemove.addEventListener('click', async function () {
  if (!currentContextMenuTrack) return;
  var pl = state.playlists.find(function (p) { return p.id === state.currentView; });
  if (pl && currentContextMenuTrack.csvRecord) { pushUndoSnapshot('Remove track from playlist'); pl.tracks = pl.tracks.filter(function (t) { return t !== currentContextMenuTrack.csvRecord; }); await window.api.savePlaylists(state.playlists); renderPlaylist(state.currentView); }
  else alert('Open a playlist to remove tracks.');
});
var ctxMatch = $('ctx-manual-match');
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
        await window.api.saveLibrary(state.musicFiles);
      } else {
        showToast('Could not add selected audio file to the library.');
        return;
      }
    }
    var key = currentContextMenuTrack.title + '-' + currentContextMenuTrack.artist + '-' + (currentContextMenuTrack.album || '');
    state.mappings[key] = selectedPath;
    if (currentContextMenuTrack.csvRecord) currentContextMenuTrack.csvRecord.FilePath = selectedPath;
    await window.api.saveMappings(state.mappings);
    if (currentContextMenuTrack.csvRecord) await window.api.savePlaylists(state.playlists);
    showToast('Matched ' + (currentContextMenuTrack.title || 'track') + '.');
    renderPlaylistPreservingScroll(state.currentView);
  }
});
var closePls = $('btn-close-playlist-selector'); if (closePls) closePls.addEventListener('click', function () { hideModal($('playlist-selector-modal')); });
var plsModal = $('playlist-selector-modal'); if (plsModal) plsModal.addEventListener('click', function (e) { if (e.target === plsModal) hideModal(plsModal); });

var pctxAddSongs = $('pctx-add-songs');
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
            if (!pl.tracks) pl.tracks = [];
            pl.tracks.push(makePlaylistTrackRecord(track));
            await window.api.savePlaylists(state.playlists);
            renderAddSongsResults(searchInput.value);
            if (state.currentView === pl.id) renderPlaylist(pl.id);
            renderSidebarPlaylists();
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

var pctxDownloadMissing = $('pctx-download-missing');
if (pctxDownloadMissing) pctxDownloadMissing.addEventListener('click', function () {
  var pl = currentContextMenuPlaylist;
  hideAllContextMenus();
  showExistingPlaylistDownloadReview(pl, getMissingPlaylistRows(pl));
});

var btnCloseAddSongs = $('btn-close-add-songs');
if (btnCloseAddSongs) btnCloseAddSongs.addEventListener('click', function() { 
  hideModal($('add-songs-modal')); 
  if (currentContextMenuPlaylist && state.currentView === currentContextMenuPlaylist.id) {
    renderPlaylist(currentContextMenuPlaylist.id);
  }
});
var addSongsModal = $('add-songs-modal');
if (addSongsModal) addSongsModal.addEventListener('click', function (e) { 
  if (e.target === addSongsModal) {
    hideModal(addSongsModal);
    if (currentContextMenuPlaylist && state.currentView === currentContextMenuPlaylist.id) {
      renderPlaylist(currentContextMenuPlaylist.id);
    }
  }
});

var pctxRename = $('pctx-rename');
if (pctxRename) pctxRename.addEventListener('click', function () {
  var pl = currentContextMenuPlaylist; if (!pl) return;
  var el = document.getElementById(pl.id); if (!el) return;
  var span = el.querySelector('span') || el; var original = pl.name;
  span.contentEditable = 'true'; span.focus(); document.execCommand('selectAll', false, null);
  span.style.outline = '1px solid var(--accent)'; span.style.borderRadius = '2px';
  var finish = async function () { span.contentEditable = 'false'; span.style.outline = ''; var n = span.textContent.trim(); if (n && n !== original) { pl.name = n; await window.api.savePlaylists(state.playlists); renderSidebarPlaylists(); if (state.currentView === pl.id) renderPlaylist(pl.id); showToast('Renamed playlist to "' + n + '".'); } else span.textContent = original; };
  span.addEventListener('blur', finish, { once: true });
  span.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); span.blur(); } if (e.key === 'Escape') { span.textContent = original; span.blur(); } });
});
var pctxCover = $('pctx-cover');
if (pctxCover) pctxCover.addEventListener('click', async function () { var pl = currentContextMenuPlaylist; if (!pl) return; var img = await window.api.openImage(); if (img) { pl.cover = img; await window.api.savePlaylists(state.playlists); renderSidebarPlaylists(); if (state.currentView === pl.id) renderPlaylist(pl.id); } });
var pctxColor = $('pctx-color');
if (pctxColor) pctxColor.addEventListener('click', function () {
  var pl = currentContextMenuPlaylist; if (!pl) return;
  var sw = $('color-picker-swatches'); sw.innerHTML = '';
  PALETTE.forEach(function (color) { var s = document.createElement('div'); s.className = 'color-swatch' + (color === pl.color ? ' selected' : ''); s.style.background = color; s.addEventListener('click', async function () { pl.color = color; await window.api.savePlaylists(state.playlists); hideModal($('color-picker-modal')); renderSidebarPlaylists(); if (state.currentView === pl.id) renderPlaylist(pl.id); showToast('Updated playlist color.'); }); sw.appendChild(s); });
  showModal($('color-picker-modal'));
});
var closeColor = $('btn-close-color-picker'); if (closeColor) closeColor.addEventListener('click', function () { hideModal($('color-picker-modal')); });
var colorModal = $('color-picker-modal'); if (colorModal) colorModal.addEventListener('click', function (e) { if (e.target === colorModal) hideModal(colorModal); });
var pctxPin = $('pctx-pin');
if (pctxPin) pctxPin.addEventListener('click', async function () {
  var pl = currentContextMenuPlaylist; if (!pl) return;
  if (!pl.pinned && state.playlists.filter(function (p) { return p.pinned; }).length >= 4) { alert('Max 4 pinned playlists.'); return; }
  pl.pinned = !pl.pinned; await window.api.savePlaylists(state.playlists); renderSidebarPlaylists(); showToast((pl.pinned ? 'Pinned ' : 'Unpinned ') + '"' + (pl.name || 'playlist') + '".');
});
var pctxDup = $('pctx-duplicate');
if (pctxDup) pctxDup.addEventListener('click', async function () {
  var pl = currentContextMenuPlaylist; if (!pl) return;
  var copyName = getUniquePlaylistName((pl.name || 'Playlist') + ' (Copy)');
  var copy = Object.assign({}, JSON.parse(JSON.stringify(pl)), { id: 'pl_' + Date.now(), name: copyName, pinned: false, lastPlayed: null });
  state.playlists.push(copy);
  await window.api.savePlaylists(state.playlists);
  renderSidebarPlaylists();
  showToast('Duplicated playlist as "' + copyName + '".');
});
var pctxExport = $('pctx-export');
if (pctxExport) pctxExport.addEventListener('click', async function () {
  var pl = currentContextMenuPlaylist; if (!pl) return;
  try {
    var ok = await window.api.exportCsv([pl]);
    if (ok) showToast('Exported "' + (pl.name || 'playlist') + '" as CSV.');
  } catch (e) {
    showToast('CSV export failed: ' + ((e && e.message) || String(e || 'unknown error')));
  }
});

var pctxSyncAlbums = $('pctx-sync-albums');
if (pctxSyncAlbums) pctxSyncAlbums.addEventListener('click', async function () { 
  var pl = currentContextMenuPlaylist; if (!pl || !pl.tracks) return; 
  var updated = 0;
  for (var i = 0; i < pl.tracks.length; i++) {
    var r = pl.tracks[i];
    var sn = r.Song || r.title || '', an = r.Artist || r.artist || '', al = r.Album || r.album || '';
    var m = findMatchingFile(sn, an, al, getPlaylistTrackFilePath(r));
    if (m && m.album && r.Album !== m.album) {
      r.Album = m.album;
      updated++;
    }
  }
  if (updated > 0) {
    await window.api.savePlaylists(state.playlists);
    if (state.currentView === pl.id) renderPlaylist(pl.id);
    showToast('Updated album names for ' + updated + ' track' + (updated === 1 ? '' : 's') + '.');
  } else {
    showToast('Playlist albums are already in sync.');
  }
});

var pctxMatchFolder = $('pctx-match-folder');
if (pctxMatchFolder) pctxMatchFolder.addEventListener('click', async function () {
  var pl = currentContextMenuPlaylist; if (!pl || !pl.tracks) return;
  hideAllContextMenus();
  var folderPath = await window.api.openFolder(); if (!folderPath) return;
  document.body.style.cursor = 'wait';
  try {
    var tempFiles = await window.api.scanFolder(folderPath, []);
    var updated = 0;
    var usedPaths = new Set();
    pushUndoSnapshot('Match playlist from folder');
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
          if (!getLibraryIndex().byPath.has(f.filePath)) {
            state.musicFiles.push(f);
            markLibraryDirty();
          }
          updated++;
          break;
        }
      }
    }
    if (updated > 0) {
      await Promise.all([window.api.saveLibrary(state.musicFiles), window.api.savePlaylists(state.playlists), window.api.saveMappings(state.mappings)]);
      renderSidebarPlaylists();
      if (state.currentView === pl.id) renderPlaylist(pl.id);
      showToast('Matched ' + updated + ' track' + (updated === 1 ? '' : 's') + ' from folder.');
    } else {
      showToast('No matching tracks found in selected folder.');
    }
  } catch(e) { console.error(e); showToast('Folder match failed: ' + ((e && e.message) || String(e || 'unknown error'))); }
  finally { document.body.style.cursor = 'default'; }
});
var pctxDelete = $('pctx-delete');
if (pctxDelete) pctxDelete.addEventListener('click', function () { playlistToDelete = currentContextMenuPlaylist; showModal($('delete-confirm-modal')); });
var delCancel = $('delete-cancel-btn'); if (delCancel) delCancel.addEventListener('click', function () { playlistToDelete = null; hideModal($('delete-confirm-modal')); });
var delConfirm = $('delete-confirm-btn');
if (delConfirm) delConfirm.addEventListener('click', async function () {
  if (!playlistToDelete) return;
  pushUndoSnapshot('Delete playlist');
  state.playlists = state.playlists.filter(function (p) { return p.id !== playlistToDelete.id; });
  await window.api.savePlaylists(state.playlists); hideModal($('delete-confirm-modal'));
  renderSidebarPlaylists(); if (state.currentView === playlistToDelete.id) switchView('library'); playlistToDelete = null;
});
var delModal = $('delete-confirm-modal'); if (delModal) delModal.addEventListener('click', function (e) { if (e.target === delModal) hideModal(delModal); });
var importReviewModal = $('import-review-modal');
if (importReviewModal) importReviewModal.addEventListener('click', function (e) { if (e.target === importReviewModal) hideModal(importReviewModal); });
var importReviewDone = $('import-review-done');
if (importReviewDone) importReviewDone.addEventListener('click', function () { hideModal($('import-review-modal')); });
var importReviewTagHealth = $('import-review-tag-health');
if (importReviewTagHealth) importReviewTagHealth.addEventListener('click', function () { hideModal($('import-review-modal')); switchView('metadata_health'); });
var importReviewAnalyzeRg = $('import-review-analyze-rg');
if (importReviewAnalyzeRg) importReviewAnalyzeRg.addEventListener('click', function () {
  hideModal($('import-review-modal'));
  switchView('metadata_health');
  var root = $('metadata-health-container');
  if (root) root.dataset.filter = 'missing_replaygain';
  renderMetadataHealthView();
});

var btnPlay = $('btn-play'); if (btnPlay) btnPlay.addEventListener('click', togglePlay);
var btnShuffle = $('btn-shuffle'); if (btnShuffle) btnShuffle.addEventListener('click', toggleShuffle);
var btnLoop = $('btn-loop'); if (btnLoop) btnLoop.addEventListener('click', cycleLoop);
var btnNext = $('btn-next'); if (btnNext) btnNext.addEventListener('click', function () { initAudioCtx(); playNextTrack(); });
var btnPrev = $('btn-prev'); if (btnPrev) btnPrev.addEventListener('click', function () { initAudioCtx(); playPrevTrack(); });

/* ─── METADATA EDITOR LOGIC ─── */
let metaTargetFiles = [];
let metaOriginalOrder = [];
let metaCoverPath = null;
let metaProposedData = null;
let metaOriginView = '';

function stripFileUrl(url) { return fromFileUrl(url); }

function unloadAudioForMetadataSave(filePaths) {
  var targets = new Set((filePaths || []).map(function (fp) { return stripFileUrl(fp || ''); }).filter(Boolean));
  if (!targets.size || !window.audioEls) return null;
  var snapshots = [];
  window.audioEls.forEach(function (audioEl, idx) {
    var srcPath = stripFileUrl(audioEl.currentSrc || audioEl.src || '');
    if (!srcPath || !targets.has(srcPath)) return;
    snapshots.push({ audioEl: audioEl, idx: idx, src: audioEl.src, currentTime: audioEl.currentTime || 0, paused: audioEl.paused });
    audioEl.pause();
    audioEl.removeAttribute('src');
    audioEl.load();
  });
  if (!snapshots.length) return null;
  var wasPlaying = state.isPlaying;
  var activeAffected = snapshots.some(function (item) { return item.idx === activeAudioIdx; });
  if (activeAffected) {
    state.isPlaying = false;
    updatePlayerUI();
    if (window.api.updateThumbar) window.api.updateThumbar(false);
  }
  return function restoreMetadataPlayback() {
    snapshots.forEach(function (item) {
      item.audioEl.src = item.src;
      try { item.audioEl.currentTime = item.currentTime; } catch (e) { }
    });
    var activeSnapshot = snapshots.find(function (item) { return item.idx === activeAudioIdx; });
    if (wasPlaying && activeAffected && activeSnapshot) {
      activeSnapshot.audioEl.play().then(function () {
        state.isPlaying = true;
        updatePlayerUI();
        if (window.api.updateThumbar) window.api.updateThumbar(true);
      }).catch(function (e) { console.error(e); });
    } else if (activeAffected) {
      state.isPlaying = false;
      updatePlayerUI();
    }
  };
}

var ctxEditMeta = $('ctx-edit-metadata');
if (ctxEditMeta) ctxEditMeta.addEventListener('click', async function () {
  if (!currentContextMenuTrack || !currentContextMenuTrack.matchedFile) return;
  openMetadataEditor([currentContextMenuTrack.matchedFile]);
});

var albumEditMeta = $('album-edit-metadata-btn');
if (albumEditMeta) albumEditMeta.addEventListener('click', async function () {
  var aid = decodeURIComponent(state.currentView.replace('album:', ''));
  var aTracks = state.musicFiles.filter(function (f) {
    var k = getAlbumKey(f);
    return k === aid;
  });
  if (aTracks.length > 0) openMetadataEditor(aTracks);
});

// Show the album edit button when rendering album detail
// Already done in index.html (display:none) and we can show it in renderAlbumDetail
// Let's hook the tab switches
$('meta-tab-manual').addEventListener('click', function () {
  $('meta-tab-manual').classList.add('active'); $('meta-tab-manual').style.borderBottomColor = 'var(--accent)'; $('meta-tab-manual').style.color = 'var(--accent)';
  $('meta-tab-auto').classList.remove('active'); $('meta-tab-auto').style.borderBottomColor = 'transparent'; $('meta-tab-auto').style.color = 'var(--text-subdued)';
  $('meta-panel-manual').style.display = 'flex'; $('meta-panel-auto').style.display = 'none';
});
$('meta-tab-auto').addEventListener('click', function () {
  $('meta-tab-auto').classList.add('active'); $('meta-tab-auto').style.borderBottomColor = 'var(--accent)'; $('meta-tab-auto').style.color = 'var(--accent)';
  $('meta-tab-manual').classList.remove('active'); $('meta-tab-manual').style.borderBottomColor = 'transparent'; $('meta-tab-manual').style.color = 'var(--text-subdued)';
  $('meta-panel-auto').style.display = 'flex'; $('meta-panel-manual').style.display = 'none';
  var q = metaTargetFiles.length === 1 ? (metaTargetFiles[0].artist + ' ' + metaTargetFiles[0].title) : (metaTargetFiles[0].artist + ' ' + metaTargetFiles[0].album);
  $('meta-search-query').value = q;
  renderMetaTrackOrderList();
});

var metaCoverDrop = $('meta-cover-drop');
if (metaCoverDrop) {
  metaCoverDrop.addEventListener('click', async function () { var img = await window.api.openImage(); if (img) { metaCoverPath = img; $('meta-cover-preview').src = img; $('meta-cover-preview').style.display = 'block'; } });
  // Paste removed — was causing bugs when pasting non-image clipboard content
}

var metaSearchCoverBtn = $('meta-search-cover-btn');
if (metaSearchCoverBtn) metaSearchCoverBtn.addEventListener('click', function () {
  var artist = $('meta-artist').value || '';
  var album = $('meta-album').value || '';
  var q = encodeURIComponent(artist + ' ' + album);
  window.api.openExternal('https://covers.musichoarders.xyz/?q=' + q);
});

async function openMetadataEditor(files) {
  if (!files.length) return;
  metaTargetFiles = getSortedAlbumTracks({ tracks: files });
  metaOriginalOrder = metaTargetFiles.slice();
  files = metaTargetFiles;
  metaCoverPath = null;
  metaProposedData = null;
  atTrackOrderMenuOpen = false;
  metaOriginView = state.currentView || '';

  // Reset auto-tag panel
  var sr = $('meta-search-results'); if (sr) { sr.innerHTML = ''; }
  var tbl = $('at-track-table'); if (tbl) { tbl.innerHTML = '<div id="at-track-empty" style="padding:40px;text-align:center;color:rgba(255,255,255,0.2);font-size:13px;">Select a result to see track matching</div>'; }
  var cnt = $('at-track-count'); if (cnt) cnt.textContent = '';
  ['at-val-artist','at-val-album-artist','at-val-album','at-val-year','at-val-genre'].forEach(function(id) { var el = $(id); if (el) el.textContent = ''; });
  var atCoverPreview = $('at-cover-preview'); if (atCoverPreview) { atCoverPreview.style.display = 'none'; atCoverPreview.src = ''; }
  var atCoverWrapIcon = $('at-cover-wrap') ? $('at-cover-wrap').querySelector('i') : null;
  if (atCoverWrapIcon) atCoverWrapIcon.style.display = '';

  var meta = await window.api.getMetadata(files[0].filePath);
  $('meta-title').value = files.length === 1 ? files[0].title : '<Multiple Tracks>';
  $('meta-artist').value = files[0].artist || '';
  $('meta-album-artist').value = meta ? (meta.albumartist || '') : '';
  $('meta-album').value = files[0].album || '';
  $('meta-year').value = meta ? (meta.year || '') : '';
  $('meta-genre').value = meta ? (meta.genre || '') : '';
  $('meta-track-no').value = files.length === 1 ? ((meta && meta.trackNo) || files[0].trackNo || '') : '';
  $('meta-track-total').value = files.length === 1 ? ((meta && meta.trackTotal) || files[0].trackTotal || '') : '';
  $('meta-disc-no').value = (meta && meta.discNo) || files[0].discNo || '';
  $('meta-disc-total').value = (meta && meta.discTotal) || files[0].discTotal || '';
  $('meta-cover-preview').src = files[0].picture || '';
  $('meta-cover-preview').style.display = files[0].picture ? 'block' : 'none';

  // Pre-fill search query for auto-tag tab
  var q = files.length === 1 ? (files[0].artist + ' ' + files[0].title) : (files[0].artist + ' ' + files[0].album);
  var sq = $('meta-search-query'); if (sq) sq.value = q;
  renderMetaTrackOrderList();

  $('meta-tab-manual').click();
  $('meta-modal-title').textContent = files.length === 1 ? 'Edit Track Metadata' : 'Edit Album Metadata (' + files.length + ' tracks)';
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
    alert('Select a metadata result first.');
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
    alert('Matched by title with ' + weakMatches + ' weak match(es) and ' + remaining.length + ' unmatched local track(s). Review warning rows before saving.');
  }
}

function renderMetaTrackOrderListInto(wrapId, listId, compact) {
  var wrap = $(wrapId);
  var list = $(listId);
  if (!wrap || !list) return;
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
    item.dataset.index = index;
    item.style.cssText = 'display:grid;grid-template-columns:24px 1fr auto;gap:7px;align-items:center;padding:' + (compact ? '7px 9px' : '8px 10px') + ';margin:' + (compact ? '0' : '4px 0') + ';border-radius:10px;background:rgba(255,255,255,.045);border:1px solid rgba(255,255,255,.055);cursor:grab;min-width:0;';
    item.innerHTML = '<i class="ph ph-dots-six-vertical" style="color:var(--text-subdued);"></i><div style="min-width:0;"><div style="font-size:12px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(file.title || file.filename || 'Unknown Track') + '</div><div style="font-size:11px;color:var(--text-subdued);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(file.artist || '') + '</div></div><span style="font-size:11px;color:var(--accent);font-weight:800;">#' + (index + 1) + '</span>';
    item.addEventListener('dragstart', function (e) {
      e.dataTransfer.setData('text/plain', String(index));
      item.style.opacity = '.55';
    });
    item.addEventListener('dragend', function () { item.style.opacity = ''; });
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

var atOrderToggle = $('at-order-toggle');
if (atOrderToggle) atOrderToggle.addEventListener('click', function (e) {
  e.stopPropagation();
  atTrackOrderMenuOpen = !atTrackOrderMenuOpen;
  renderMetaTrackOrderList();
});

var atTrackOrderWrap = $('at-track-order-wrap');
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

$('meta-cancel-btn').addEventListener('click', function () { hideModal($('metadata-modal')); });
$('meta-save-btn').addEventListener('click', async function () {
  var btn = $('meta-save-btn');
  var isManual = $('meta-tab-manual').classList.contains('active');
  var restorePlaybackAfterMetadataSave = null;
  function restoreMetadataPlaybackIfNeeded() {
    if (!restorePlaybackAfterMetadataSave) return;
    var restore = restorePlaybackAfterMetadataSave;
    restorePlaybackAfterMetadataSave = null;
    restore();
  }
  function failMetadataSave(message) {
    var progress = $('meta-save-progress');
    if (progress) progress.remove();
    btn.style.display = '';
    btn.textContent = 'Save';
    btn.disabled = false;
    restoreMetadataPlaybackIfNeeded();
    alert(message);
  }
  function metadataSaveError(result) {
    return result && typeof result === 'object' && result.ok === false ? result.error : '';
  }
  if (metaTargetFiles.some(function (f) { return !isEditableMetadataFile(f); })) {
    alert('Metadata editing currently supports MP3 and FLAC files only. M4A and WAV files were not changed.');
    return;
  }
  btn.textContent = 'Saving...'; btn.disabled = true;
  pushUndoSnapshot('Metadata edit');

  if (isManual) {
    var tags = {};
    if ($('meta-title').value && $('meta-title').value !== '<Multiple Tracks>') tags.title = $('meta-title').value;
    if ($('meta-artist').value) tags.artist = $('meta-artist').value;
    if ($('meta-album-artist').value) tags.performerInfo = $('meta-album-artist').value;
    if ($('meta-album').value) tags.album = $('meta-album').value;
    if ($('meta-year').value) tags.year = $('meta-year').value;
    if ($('meta-genre').value) tags.genre = $('meta-genre').value;
    var manualTrackNo = parseInt($('meta-track-no').value || '0', 10) || 0;
    var manualTrackTotal = parseInt($('meta-track-total').value || '0', 10) || 0;
    var manualDiscNo = parseInt($('meta-disc-no').value || '0', 10) || 0;
    var manualDiscTotal = parseInt($('meta-disc-total').value || '0', 10) || 0;
    if (manualTrackNo) tags.trackNumber = manualTrackTotal ? (manualTrackNo + '/' + manualTrackTotal) : String(manualTrackNo);
    if (manualTrackTotal) tags.trackTotal = String(manualTrackTotal);
    if (manualDiscNo) tags.discNumber = String(manualDiscNo);
    if (manualDiscTotal) tags.discTotal = String(manualDiscTotal);
    if (manualDiscNo || manualDiscTotal) tags.partOfSet = manualDiscNo ? (manualDiscNo + (manualDiscTotal ? '/' + manualDiscTotal : '')) : ('0/' + manualDiscTotal);
    if (metaCoverPath) tags.image = stripFileUrl(metaCoverPath);

    var saveFolderJpg = $('meta-save-folder-jpg') ? $('meta-save-folder-jpg').checked : false;
    var applyOrderAsTrackNo = (($('meta-save-track-order') && $('meta-save-track-order').checked) || ($('at-save-track-order') && $('at-save-track-order').checked));
    restorePlaybackAfterMetadataSave = unloadAudioForMetadataSave(metaTargetFiles.map(function (f) { return f.filePath; }));

    var progressContainer = document.createElement('div');
    progressContainer.id = 'meta-save-progress';
    progressContainer.innerHTML = '<div id="meta-save-text" style="font-size:12px;margin-bottom:4px;color:var(--text-subdued);">Saving 0/' + metaTargetFiles.length + '...</div><div style="width:100%;height:4px;background:#333;border-radius:2px;overflow:hidden;"><div id="meta-save-bar" style="width:0%;height:100%;background:var(--accent);transition:width 0.1s;"></div></div>';
    btn.parentNode.insertBefore(progressContainer, btn);
    btn.style.display = 'none';

    for (var i = 0; i < metaTargetFiles.length; i++) {
      var f = metaTargetFiles[i];
      var fp = stripFileUrl(f.filePath);
      var tagsForThisFile = Object.assign({}, tags);
      if (applyOrderAsTrackNo && metaTargetFiles.length > 1) {
        tagsForThisFile.trackNumber = (i + 1) + '/' + metaTargetFiles.length;
        tagsForThisFile.trackTotal = String(metaTargetFiles.length);
      }
      $('meta-save-text').textContent = 'Saving ' + (i + 1) + '/' + metaTargetFiles.length + ': ' + (f.filename || f.title || fp) + '...';
      var saved = await window.api.saveMetadata([fp], tagsForThisFile, saveFolderJpg);
      if (saved !== true) { failMetadataSave('Failed to save metadata for: ' + (f.filename || f.title || fp) + (metadataSaveError(saved) ? '\n\n' + metadataSaveError(saved) : '')); return; }
      if (tags.title && metaTargetFiles.length === 1) f.title = tags.title;
      if (tags.artist) f.artist = tags.artist;
      if (tags.performerInfo) f.albumArtist = tags.performerInfo;
      if (tags.album) f.album = tags.album;
      if (tags.year) f.year = tags.year;
      if (tags.genre) f.genre = tags.genre;
      if (manualTrackNo) f.trackNo = manualTrackNo;
      if (manualTrackTotal) f.trackTotal = manualTrackTotal;
      if (applyOrderAsTrackNo && metaTargetFiles.length > 1) { f.trackNo = i + 1; f.trackTotal = metaTargetFiles.length; }
      if (manualDiscNo) f.discNo = manualDiscNo;
      if (manualDiscTotal) f.discTotal = manualDiscTotal;
      if (tags.image) f.picture = toFileUrl(tags.image);

      var pct = Math.round(((i + 1) / metaTargetFiles.length) * 100);
      $('meta-save-bar').style.width = pct + '%';
      $('meta-save-text').textContent = 'Saved ' + (i + 1) + '/' + metaTargetFiles.length + ': ' + (f.filename || f.title || fp);
    }
    markLibraryDirty();
    await window.api.saveLibrary(state.musicFiles);

  } else {
    if (!metaProposedData || !metaProposedData.tags) { btn.textContent = 'Save'; btn.disabled = false; return alert("Select a metadata result first."); }

    var progressContainer = document.createElement('div');
    progressContainer.id = 'meta-save-progress';
    progressContainer.innerHTML = '<div id="meta-save-text" style="font-size:12px;margin-bottom:4px;color:var(--text-subdued);">Saving 0/' + metaTargetFiles.length + '...</div><div style="width:100%;height:4px;background:#333;border-radius:2px;overflow:hidden;"><div id="meta-save-bar" style="width:0%;height:100%;background:var(--accent);transition:width 0.1s;"></div></div>';
    btn.parentNode.insertBefore(progressContainer, btn);
    btn.style.display = 'none';

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
    var warningRows = Array.from(document.querySelectorAll('.at-row-apply[data-warn="1"]')).filter(function (el) { return el.checked; }).length;
    if ((chkTitles || chkNums) && warningRows > 0 && !confirm(warningRows + ' selected track match(es) look suspicious. If your local order differs from MusicBrainz, wrong titles or numbers can be written. Continue anyway?')) {
      if ($('meta-save-progress')) $('meta-save-progress').remove();
      btn.style.display = '';
      btn.textContent = 'Save';
      btn.disabled = false;
      return;
    }
    if ((chkTitles || chkNums) && metaProposedData.tracks.length !== metaTargetFiles.length && !confirm('MusicBrainz has ' + metaProposedData.tracks.length + ' track(s), local album has ' + metaTargetFiles.length + '. Continue with only matched rows?')) {
      if ($('meta-save-progress')) $('meta-save-progress').remove();
      btn.style.display = '';
      btn.textContent = 'Save';
      btn.disabled = false;
      return;
    }
    restorePlaybackAfterMetadataSave = unloadAudioForMetadataSave(metaTargetFiles.map(function (f) { return f.filePath; }));

    for (var i = 0; i < metaTargetFiles.length; i++) {
      var fp = stripFileUrl(metaTargetFiles[i].filePath);
      var f = metaTargetFiles[i];
      var t = {};
      var rowApply = document.querySelector('.at-row-apply[data-index="' + i + '"]');
      var applyTrackFields = !rowApply || rowApply.checked;
      var rowTitleInput = document.querySelector('.at-title-input[data-index="' + i + '"]');
      var rowArtistInput = document.querySelector('.at-artist-input[data-index="' + i + '"]');
      var rowTrackInput = document.querySelector('.at-track-input[data-index="' + i + '"]');
      var rowDiscInput = document.querySelector('.at-disc-input[data-index="' + i + '"]');
      var proposedTrack = metaProposedData.tracks[i];
      if (chkArtist && applyTrackFields) {
        var nextArtist = (rowArtistInput && rowArtistInput.value.trim()) || (proposedTrack && proposedTrack.artist) || metaProposedData.tags.artist;
        if (nextArtist) t.artist = nextArtist;
      }
      if (chkAlbArtist && metaProposedData.tags.performerInfo) t.performerInfo = metaProposedData.tags.performerInfo;
      if (chkAlbum && metaProposedData.tags.album) t.album = metaProposedData.tags.album;
      if (chkYear && metaProposedData.tags.year) t.year = metaProposedData.tags.year;
      if (chkGenre && metaProposedData.tags.genre) t.genre = metaProposedData.tags.genre;
      if (applyTrackFields && chkTitles && proposedTrack) t.title = (rowTitleInput && rowTitleInput.value.trim()) || proposedTrack.title;
      if (applyTrackFields && chkNums && proposedTrack) {
        var rowTrackNo = applyAutoOrderAsTrackNo ? (i + 1) : (parseInt((rowTrackInput && rowTrackInput.value) || proposedTrack.trackNum || '0', 10) || 0);
        var rowDiscNo = parseInt((rowDiscInput && rowDiscInput.value) || proposedTrack.discNum || '0', 10) || 0;
        var rowTrackTotal = applyAutoOrderAsTrackNo ? metaTargetFiles.length : proposedTrack.trackTotal;
        if (rowTrackNo) t.trackNumber = rowTrackTotal ? (rowTrackNo + '/' + rowTrackTotal) : String(rowTrackNo);
        if (rowTrackTotal) t.trackTotal = String(rowTrackTotal);
        if (rowDiscNo) t.discNumber = String(rowDiscNo);
        if (proposedTrack.discTotal) t.discTotal = String(proposedTrack.discTotal);
        if (rowDiscNo || proposedTrack.discTotal) t.partOfSet = rowDiscNo ? (rowDiscNo + (proposedTrack.discTotal ? '/' + proposedTrack.discTotal : '')) : ('0/' + proposedTrack.discTotal);
      }
      if (chkCover && metaProposedData.coverUrl) t.image = metaProposedData.coverUrl;

      $('meta-save-text').textContent = 'Saving ' + (i + 1) + '/' + metaTargetFiles.length + ': ' + (f.filename || f.title || fp) + '...';
      var savedAuto = await window.api.saveMetadata([fp], t, saveFolderJpgAuto);
      if (savedAuto !== true) { failMetadataSave('Failed to save metadata for: ' + (f.filename || f.title || fp) + (metadataSaveError(savedAuto) ? '\n\n' + metadataSaveError(savedAuto) : '')); return; }

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

      var pct = Math.round(((i + 1) / metaTargetFiles.length) * 100);
      $('meta-save-bar').style.width = pct + '%';
      $('meta-save-text').textContent = 'Saved ' + (i + 1) + '/' + metaTargetFiles.length + ': ' + (f.filename || f.title || fp);
    }
    markLibraryDirty();
    await window.api.saveLibrary(state.musicFiles);
    if (saveFolderJpgAuto && metaProposedData.coverUrl && window.api.saveFolderCovers) {
      $('meta-save-text').textContent = 'Writing folder.jpg files...';
      await window.api.saveFolderCovers(metaTargetFiles);
    }
  }

  if ($('meta-save-progress')) $('meta-save-progress').remove();
  btn.style.display = '';
  btn.textContent = 'Saved!';
  restoreMetadataPlaybackIfNeeded();
  setTimeout(function () {
    btn.textContent = 'Save'; btn.disabled = false; hideModal($('metadata-modal'));
    var refreshedAlbum = null;
    if (metaOriginView && metaOriginView.indexOf('album:') === 0 && metaTargetFiles.length) {
      refreshedAlbum = getFullAlbumByKey(getAlbumKey(metaTargetFiles[0]));
    }
    if (state.currentView === 'metadata_health') renderMetadataHealthView();
    else if (refreshedAlbum) renderAlbumDetail(refreshedAlbum);
    else if (state.currentView === 'library') renderLibrary();
    else switchView('library', false);

    if (isMultiSelectMode) {
      isMultiSelectMode = false;
      selectedAlbumsForEdit.clear();
      if ($('btn-multi-select')) {
        $('btn-multi-select').classList.remove('active');
        $('btn-multi-select').style.color = '';
      }
      updateMultiSelectControls();
      renderLibrary();
    }
  }, 450);
});

$('meta-search-btn').addEventListener('click', async function () {
  var q = $('meta-search-query').value.trim(); if (!q) return;
  $('meta-search-btn').innerHTML = '<i class="ph ph-spinner ph-spin"></i> Searching...';
  var metadataSourceOptions = {
    discogsToken: appSettings.discogsToken || '',
    spotifyClientId: appSettings.spotifyClientId || '',
    spotifyClientSecret: appSettings.spotifyClientSecret || ''
  };
  var results = window.api.searchMetadataSources ? await window.api.searchMetadataSources(q, metadataSourceOptions) : await window.api.searchMusicBrainz(q);
  $('meta-search-btn').innerHTML = '<i class="ph ph-magnifying-glass"></i> Search Metadata';
  var resDiv = $('meta-search-results'); resDiv.innerHTML = '';
  if (!results.length) { resDiv.style.display = 'block'; resDiv.innerHTML = '<div style="padding:12px;color:var(--text-subdued);">No results found. Try a shorter query or add Discogs/Spotify credentials in Settings.</div>'; return; }

  results.forEach(function (r) {
    var el = document.createElement('div');
    var yearStr = r.date ? String(r.date).substring(0, 4) : '';
    var source = r.source || 'musicbrainz';
    var sourceLabel = r.label || (source === 'musicbrainz' ? 'MusicBrainz' : source);
    var artistStr = r.artist || (r['artist-credit'] ? r['artist-credit'].map(function(a){return a.name||(a.artist&&a.artist.name)||'';}).join(', ') : 'Unknown');
    el.style.cssText = 'padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;font-size:12px;';
    var thumb = r.thumb ? '<img class="metadata-result-thumb" src="' + esc(r.thumb) + '" style="width:34px;height:34px;border-radius:5px;object-fit:cover;flex-shrink:0;">' : '<div style="width:34px;height:34px;border-radius:5px;background:rgba(255,255,255,.06);flex-shrink:0;"></div>';
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
    el.onmouseenter = function () { el.style.background = 'rgba(255,255,255,0.08)'; };
    el.onmouseleave = function () { el.style.background = el._selected ? 'rgba(var(--accent-rgb,29,185,84),0.12)' : ''; };
    el.onclick = async function () {
      // Deselect all
      $('meta-search-results').querySelectorAll('div').forEach(function(d) { d._selected = false; d.style.background = ''; });
      el._selected = true; el.style.background = 'rgba(29,185,84,0.12)';
      var oldHtml = el.innerHTML;
      el.innerHTML = '<div style="display:flex;align-items:center;gap:6px;"><i class="ph ph-spinner ph-spin" style="font-size:14px;color:var(--accent);"></i><span>Loading...</span></div>';
      var details = window.api.getMetadataRelease ? await window.api.getMetadataRelease(source, r.id, metadataSourceOptions) : await window.api.getMusicBrainzRelease(r.id);
      el.innerHTML = oldHtml;
      if (!details) return;
      showMetaCompare(details);
    };
    resDiv.appendChild(el);
  });
  resDiv.style.display = 'block';
});

function normalizeMatchTitle(value) {
  return String(value || '').toLowerCase().replace(/\([^)]*\)|\[[^\]]*\]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
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

    var maxRows = Math.max(tracks.length, metaTargetFiles.length);
    var titleChanges = 0;
    var artistChanges = 0;
    var warningRows = 0;
    for (var i = 0; i < maxRows; i++) {
      var localF = metaTargetFiles[i];
      var mbTrack = tracks[i];
      var matched = localF && mbTrack;
      var score = matched ? titleMatchScore(localF.title || localF.filename, mbTrack.title) : 0;
      var titleMatch = score >= 0.72;
      var row = document.createElement('div');
      row.className = 'at-track-review-row';
      var numStr = mbTrack && mbTrack.discNum && mbData.media && mbData.media.length > 1 ? (mbTrack.discNum + '.' + mbTrack.trackNum) : ((i + 1) + '');
      var localTitle = localF ? esc(localF.title || localF.filename || '?') : '<span style="color:rgba(255,255,255,0.2);">—</span>';
      var localArtist = localF ? esc(localF.artist || 'Unknown Artist') : '<span style="color:rgba(255,255,255,0.2);">—</span>';
      var proposedArtist = mbTrack ? (mbTrack.artist || artist || '') : '';
      var titleWillChange = matched && !sameTagText(localF.title || localF.filename, mbTrack.title);
      var artistWillChange = localF && proposedArtist && !sameTagText(localF.artist, proposedArtist);
      if (titleWillChange) titleChanges++;
      if (artistWillChange) artistChanges++;
      var matchIcon = matched ? (titleMatch ? '<i class="ph ph-check" style="color:#1DB954;font-size:11px;margin-left:4px;"></i>' : '<i class="ph ph-warning" style="color:#FF9800;font-size:11px;margin-left:4px;"></i>') : '';
      var disabled = !matched ? ' disabled' : '';
      var checked = matched ? ' checked' : '';
      var warn = matched && !titleMatch ? '1' : '0';
      if (warn === '1') warningRows++;
      var changeNotes = [];
      if (titleWillChange) changeNotes.push('title changes');
      if (artistWillChange) changeNotes.push('artist changes');
      if (warn === '1') changeNotes.push('check match');
      var editHtml = mbTrack ? '<div class="at-review-new-grid">'
        + '<input class="meta-inp at-title-input' + (titleWillChange ? ' at-review-change' : '') + '" data-index="' + i + '" value="' + esc(mbTrack.title) + '" title="Title after save">'
        + '<input class="meta-inp at-artist-input' + (artistWillChange ? ' at-review-change' : '') + '" data-index="' + i + '" value="' + esc(proposedArtist) + '" title="Artist after save">'
        + '<input class="meta-inp at-track-input" data-index="' + i + '" type="number" min="0" value="' + esc(mbTrack.trackNum || '') + '" title="Track number" style="text-align:center;">'
        + '<input class="meta-inp at-disc-input" data-index="' + i + '" type="number" min="0" value="' + esc(mbTrack.discNum || '') + '" title="Disc number" style="text-align:center;">'
        + '</div>' : '<span style="color:rgba(255,255,255,0.2);">—</span>';
      row.innerHTML = '<div class="at-review-use-cell"><input type="checkbox" class="at-row-apply" data-index="' + i + '" data-warn="' + warn + '"' + checked + disabled + ' style="accent-color:var(--accent);"></div>' +
        '<div class="at-review-local-cell"><div class="at-review-title">' + localTitle + matchIcon + '</div><div class="at-review-artist">Artist: ' + localArtist + '</div></div>' +
        '<div class="at-review-new-cell">' + editHtml + '<div class="at-review-note' + (warn === '1' ? ' at-review-warning' : '') + '">#' + esc(numStr) + (changeNotes.length ? ' - ' + esc(changeNotes.join(' - ')) : '') + '</div></div>';
      tbl.appendChild(row);
    }
    if (cnt) {
      cnt.textContent = '(' + tracks.length + ' ' + sourceName + ' / ' + metaTargetFiles.length + ' local' + (titleChanges || artistChanges ? ' - ' + titleChanges + ' title, ' + artistChanges + ' artist changes' : '') + (warningRows ? ' - ' + warningRows + ' warnings' : '') + ')';
    }
  }

  metaProposedData = {
    tags: { artist: artist, album: title, year: year, performerInfo: artist, genre: mbData.genres && mbData.genres[0] ? mbData.genres[0].name : '' },
    tracks: tracks,
    coverUrl: coverUrl,
    raw: mbData
  };
}

var audioEls = [$('audio-player-0'), $('audio-player-1')];
var activeAudioIdx = 0;
var audioGainNodes = null;

audioEls.forEach(function (audioEl) {
  audioEl.addEventListener('ended', function () {
    if (audioEl !== audioEls[activeAudioIdx]) return;
    if (state.loopMode === 2) { 
      audioEl.currentTime = 0; 
      audioEl.play(); 
      if (state.currentPlayingTrack) triggerLastfmScrobbleCycle(state.currentPlayingTrack);
      return; 
    }
    playNextTrack();
  });
  audioEl.addEventListener('timeupdate', function () {
    if (audioEl !== audioEls[activeAudioIdx]) return;
    recordListeningProgress(audioEl);
    syncMprisPositionThrottled();
    $('time-current').textContent = fmt(audioEl.currentTime);
    if (lyricsOpen) updateLyricsHighlight(audioEl.currentTime);
    if (npOverlayOpen) {
      updateNPLyricsHighlight(audioEl.currentTime);
      var npPb = document.getElementById('np-progress-bar');
      if (npPb && !isNaN(audioEl.duration)) {
        npPb.style.width = ((audioEl.currentTime / audioEl.duration) * 100) + '%';
        var npCur = document.getElementById('np-time-cur');
        var npTot = document.getElementById('np-time-total');
        if (npCur) npCur.textContent = fmt(audioEl.currentTime);
        if (npTot) npTot.textContent = fmt(audioEl.duration);
      }
    }
    if (!isNaN(audioEl.duration)) {
      $('time-total').textContent = fmt(audioEl.duration);
      $('progress-bar').style.width = ((audioEl.currentTime / audioEl.duration) * 100) + '%';

      var cfDuration = appSettings.crossfade ? parseInt(appSettings.crossfade) : 0;
      var remaining = audioEl.duration - audioEl.currentTime;
      if (cfDuration > 0 && remaining <= cfDuration && !state.crossfadingNext) {
        state.crossfadingNext = true;
        playNextTrack();
      }
    }
  });
});

var pc = $('progress-container');
if (pc) {
  let isDraggingProg = false;
  pc.addEventListener('mousedown', function (e) { var a = audioEls[activeAudioIdx]; if (!state.currentPlayingTrack || isNaN(a.duration)) return; isDraggingProg = true; updateProg(e, a); });
  document.addEventListener('mousemove', function (e) { if (isDraggingProg) updateProg(e, audioEls[activeAudioIdx]); });
  document.addEventListener('mouseup', function () { isDraggingProg = false; });
  function updateProg(e, a) {
    var r = pc.getBoundingClientRect();
    a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.duration;
    syncMpris(true);
  }
}
var vc = document.querySelector('.volume-bar-container');
if (vc) {
  let isDraggingVol = false;
  let volumeSaveTimer = null;
  vc.addEventListener('mousedown', function (e) { isDraggingVol = true; updateVol(e); });
  document.addEventListener('mousemove', function (e) { if (isDraggingVol) updateVol(e); });
  document.addEventListener('mouseup', function () {
    if (!isDraggingVol) return;
    isDraggingVol = false;
    clearTimeout(volumeSaveTimer);
    flushSettingsSave();
  });
  function updateVol(e) {
    var r = vc.getBoundingClientRect();
    var v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    audioEls.forEach(a => a.volume = v);
    $('volume-bar').style.width = (v * 100) + '%';
    appSettings.volume = v;
    syncMpris(false);
    clearTimeout(volumeSaveTimer);
    volumeSaveTimer = setTimeout(function () { saveSettingsDebounced(150); }, 150);
  }
}

window.addEventListener('mouseup', function (e) {
  if (e.button === 3) { var b = $('btn-nav-back'); if (b && !b.disabled) b.click(); }
  else if (e.button === 4) { var f = $('btn-nav-forward'); if (f && !f.disabled) f.click(); }
});

document.addEventListener('keydown', function (e) {
  var tag = document.activeElement.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.ctrlKey && e.code === 'ArrowRight') { e.preventDefault(); playNextTrack(); }
  if (e.ctrlKey && e.code === 'ArrowLeft') { e.preventDefault(); playPrevTrack(); }
  if (e.ctrlKey && e.code === 'KeyS') { e.preventDefault(); toggleShuffle(); }
  if (e.ctrlKey && e.code === 'KeyL') { e.preventDefault(); cycleLoop(); }
  if (e.ctrlKey && e.code === 'KeyQ') { e.preventDefault(); toggleQueue(); }
  if (e.ctrlKey && e.code === 'KeyZ') { e.preventDefault(); undoLastAction(); }
  if (e.code === 'Escape' && selectedTrackKeys.size) { e.preventDefault(); clearTrackSelection(); }
  // Insert key → Rescan Folder (add only NEW songs from imported folders)
  if (e.code === 'Insert') { e.preventDefault(); doRescanFolder(); }
});



async function initApp() {
  var results = await Promise.all([window.api.loadLibrary(), window.api.loadPlaylists(), window.api.loadMappings(), window.api.loadSettings()]);
  if (results[0]) setMusicFiles(results[0]);
  if (results[1]) state.playlists = results[1];
  if (results[2]) state.mappings = results[2];
  // Back-fill year/genre for existing library files (runs in background)
  if (state.musicFiles.length > 0 && window.api.backfillMetadata) {
    window.api.backfillMetadata(state.musicFiles).then(function (updated) {
      setMusicFiles(updated);
    });
  }
  if (results[3]) {
    appSettings = Object.assign({}, appSettings, results[3]);
    nativeTitleBarActive = !!appSettings.useNativeTitleBar;
    if (appSettings.lastPlayed) { playQueueTracks = state.musicFiles; var t = getLibraryIndex().byPath.get(appSettings.lastPlayed.path); if (t) { state.currentPlayingTrack = t; renderQueue(); } }
    try {
      if (appSettings.sidebarWidth) $('sidebar').style.width = appSettings.sidebarWidth + 'px';
      isPlaylistGridView = true;
    } catch (e) { }
    if (appSettings.sortAscending === undefined) appSettings.sortAscending = true;
    var sortDirBtn = $('playlist-sort-dir-btn'); if (sortDirBtn) sortDirBtn.innerHTML = appSettings.sortAscending ? '<i class="ph ph-sort-ascending"></i>' : '<i class="ph ph-sort-descending"></i>';
    var sm = $('setting-minimize'); if (sm) sm.checked = appSettings.minimizeToTray;
    var sa = $('setting-audio-mode'); if (sa) sa.value = appSettings.audioMode;
    var sd = $('setting-discord-rpc'); if (sd) sd.checked = !!appSettings.discordRpc;
    var sdt = $('setting-discogs-token'); if (sdt) sdt.value = appSettings.discogsToken || '';
    var sspid = $('setting-spotify-client-id'); if (sspid) sspid.value = appSettings.spotifyClientId || '';
    var sspsec = $('setting-spotify-client-secret'); if (sspsec) sspsec.value = appSettings.spotifyClientSecret || '';
    if (!appSettings.ytdlDownloadFolder && window.api.getDefaultDownloadFolder) appSettings.ytdlDownloadFolder = await window.api.getDefaultDownloadFolder();
    refreshDownloadFolderUi();
    var sn = $('setting-normalization'); if (sn) sn.checked = !!appSettings.normalization;
    var snot = $('setting-notifications'); if (snot) snot.checked = appSettings.notifications !== false;
    var snt = $('setting-native-titlebar'); if (snt) snt.checked = !!appSettings.useNativeTitleBar;
    var svs = $('setting-virtual-scrolling'); if (svs) svs.checked = !!appSettings.virtualScrolling;
    var sll = $('setting-lazy-loading'); if (sll) sll.checked = !!appSettings.lazyLoading;
    
    applyThemeSettings();
    if (typeof initThemePicker === 'function') initThemePicker();
    
    // Refresh Discord status text
    if (appSettings.discordRpc && window.api.discordStatus) {
      window.api.discordStatus().then(function (ok) {
        var st = $('discord-status-text'); if (st) st.textContent = ok && ok.enabled ? 'Connected' : 'Could not connect: ' + ((ok && ok.error) || 'Discord not running');
      });
    }
    var sc = $('setting-crossfade');
    if (sc) {
      sc.value = appSettings.crossfade || 0;
      var cv = $('crossfade-val'); if (cv) cv.textContent = (appSettings.crossfade || 0) + 's';
    }
    var smg = $('setting-master-gain');
    if (smg) {
      smg.value = appSettings.masterGain !== undefined ? appSettings.masterGain : 100;
      var mgv = $('master-gain-val'); if (mgv) mgv.textContent = (appSettings.masterGain !== undefined ? appSettings.masterGain : 100) + '%';
    }
    if (typeof audioGainNode !== 'undefined' && audioGainNode) {
      audioGainNode.gain.value = appSettings.masterGain !== undefined ? (appSettings.masterGain / 100.0) : 1.0;
    }

    if (appSettings.sidebarWidth) $('sidebar').style.width = appSettings.sidebarWidth + 'px';

    if (appSettings.volume !== undefined) {
      audioEls.forEach(a => a.volume = appSettings.volume);
      if ($('volume-bar')) $('volume-bar').style.width = (appSettings.volume * 100) + '%';
    } else {
      audioEls.forEach(a => a.volume = 1);
    }
    if (appSettings.playHistory) state.playHistory = appSettings.playHistory;
    if (appSettings.lastTrack) {
      state.currentPlayingTrack = appSettings.lastTrack;
      // Restore the queue from saved file paths
      if (appSettings.savedQueue && appSettings.savedQueue.length > 0) {
        var fileMap = getLibraryIndex().byPath;
        state.playQueueTracks = appSettings.savedQueue
          .map(function(fp) {
            var f = fileMap.get(fp) || getLibraryIndex().byStrippedPath.get(stripFileUrl(fp));
            if (!f) return null;
            return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false };
          })
          .filter(Boolean);
        // Find the saved current track inside the restored queue
        var savedIdx = appSettings.savedQueueIndex || 0;
        if (state.playQueueTracks[savedIdx]) {
          state.currentPlayingTrack = state.playQueueTracks[savedIdx];
        } else if (state.playQueueTracks.length > 0) {
          state.currentPlayingTrack = state.playQueueTracks[0];
        }
      } else {
        // Fallback: single-track queue
        state.playQueueTracks = [appSettings.lastTrack];
      }
      state.currentTracks = state.playQueueTracks.slice();
      updatePlayerUI();
      renderQueue();
    }
  }
  if (!appSettings.ytdlDownloadFolder && window.api.getDefaultDownloadFolder) appSettings.ytdlDownloadFolder = await window.api.getDefaultDownloadFolder();
  refreshDownloadFolderUi();
  if (state.musicFiles.length > 0 && window.api.saveFolderCovers && appSettings.folderCoversBackfilledVersion !== 2) {
    writeCurrentFolderCovers(false).then(function () {
      appSettings.folderCoversBackfilledVersion = 2;
      window.api.saveSettings(appSettings);
    }).catch(function (e) { console.error('folder.jpg backfill failed:', e); });
  }
  updateLastfmIcon();
  buildColorPickers();
  if (window.api.onThumbarAction) {
    window.api.onThumbarAction(function (action, detail) {
      if (action === 'playpause') { initAudioCtx(); togglePlay(); }
      else if (action === 'play') { initAudioCtx(); if (!state.isPlaying) togglePlay(); }
      else if (action === 'pause') { if (state.isPlaying) togglePlay(); }
      else if (action === 'prev') { initAudioCtx(); playPrevTrack(); }
      else if (action === 'next') { initAudioCtx(); playNextTrack(); }
      else if (action === 'seek') { var a = getActiveAudioEl(); if (a && !isNaN(a.duration)) setActiveAudioPosition((a.currentTime || 0) + (Number(detail || 0) / 1000000), true); }
      else if (action === 'set-position') { setActiveAudioPosition(Number(detail || 0) / 1000000, true); }
      else if (action === 'volume') { var rawVol = Number(detail); if (!isNaN(rawVol)) { var v = Math.max(0, Math.min(1, rawVol)); audioEls.forEach(function (a) { a.volume = v; }); appSettings.volume = v; if ($('volume-bar')) $('volume-bar').style.width = (v * 100) + '%'; syncMpris(false); } }
      else if (action === 'shuffle') toggleShuffle();
      else if (action === 'loop') cycleLoop();
      else if (action === 'queue') toggleQueue();
    });
  }
  if (window.api.updateThumbar) window.api.updateThumbar(false);
  // Apply saved shortcuts
  var _initShortcuts = getShortcuts();
  rememberShortcutRegistrationResult(await window.api.registerShortcuts(_initShortcuts));
  renderSidebarPlaylists();
  switchView('home', false);
}
initApp();





// Global keyboard: N = Now Playing overlay
document.addEventListener('keydown', function (e) {
  if (document.getElementById('shortcut-rebind-modal').classList.contains('active')) return;
  var tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.key === 'n' || e.key === 'N') { toggleNowPlayingOverlay(); }
});
/* ─── ALBUM COVER SLIDESHOW (Now Playing) ─── */
var _npSlideshowTimer = null;
function startNPSlideshow() {
  clearInterval(_npSlideshowTimer);
  if (!state.npSlideImages || state.npSlideImages.length < 2) return; // only if multiple images
  _npSlideshowTimer = setInterval(function () {
    if (!npOverlayOpen) { clearInterval(_npSlideshowTimer); return; }
    state.npSlideIdx = (state.npSlideIdx + 1) % state.npSlideImages.length;
    var img = state.npSlideImages[state.npSlideIdx];
    var artEl = document.getElementById('np-art');
    var bgEl = document.getElementById('np-bg-blur');
    if (artEl) {
      artEl.style.opacity = '0';
      setTimeout(function () {
        artEl.src = img;
        artEl.style.opacity = '1';
      }, 350);
    }
    if (bgEl) bgEl.style.backgroundImage = 'url(' + img + ')';
  }, 8000); // switch every 8 seconds
}

/* ─── LIBRARY GENRE GROUPING ─── */
function renderLibraryByGenre() {
  var container = document.getElementById('albums-grid-container');
  var grid = document.getElementById('albums-grid');
  if (!grid) return;

  // Show grid container, hide others
  if (container) container.style.display = 'block';
  var hdc = $('home-dashboard-container'); if (hdc) hdc.style.display = 'none';
  var ttc = $('tracks-table-container'); if (ttc) ttc.style.display = 'none';

  grid.innerHTML = '';
  // do NOT override grid.style.display — CSS class handles the grid layout

  // Group musicFiles by genre
  var genreMap = {};
  state.musicFiles.forEach(function (f) {
    var genre = (f.genre && f.genre.trim()) ? f.genre.trim() : 'Unknown Genre';
    if (!genreMap[genre]) genreMap[genre] = {};
    var albumKey = getAlbumKey(f);
    if (!genreMap[genre][albumKey]) genreMap[genre][albumKey] = { id: albumKey, name: f.album || 'Unknown Album', artist: f.albumArtist || f.artist || 'Unknown', cover: null, tracks: [], genre: genre };
    if (!genreMap[genre][albumKey].cover && f.picture) genreMap[genre][albumKey].cover = f.picture;
    genreMap[genre][albumKey].tracks.push(f);
  });

  var genres = Object.keys(genreMap).sort(function (a, b) {
    if (a === 'Unknown Genre') return 1;
    if (b === 'Unknown Genre') return -1;
    return a.localeCompare(b);
  });

  // Genre color palette for section accents
  var GENRE_COLORS = ['#1DB954','#2196F3','#E91E63','#FF9800','#9C27B0','#00BCD4','#FF5722','#607D8B','#4CAF50','#FF4081'];

  genres.forEach(function (genre, gi) {
    var accentColor = GENRE_COLORS[gi % GENRE_COLORS.length];
    var albums = Object.values(genreMap[genre]);

    // Wrapper
    var wrapper = document.createElement('div');
    wrapper.style.cssText = 'margin-bottom: 40px;';

    // Section header
    var header = document.createElement('div');
    header.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'padding:14px 20px',
      'margin-bottom:16px',
      'border-radius:12px',
      'cursor:pointer',
      'user-select:none',
      'background: linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)',
      'border:1px solid rgba(255,255,255,0.07)',
      'border-left:3px solid ' + accentColor,
      'transition:background 0.2s, transform 0.15s',
      'position:relative',
      'overflow:hidden'
    ].join(';');

    header.innerHTML = [
      '<div style="display:flex;align-items:center;gap:14px;">',
        '<div style="width:36px;height:36px;border-radius:8px;background:' + accentColor + '20;display:flex;align-items:center;justify-content:center;flex-shrink:0;">',
          '<i class="ph ph-music-notes" style="color:' + accentColor + ';font-size:18px;"></i>',
        '</div>',
        '<div>',
          '<div style="font-size:15px;font-weight:700;color:white;letter-spacing:0.3px;">' + esc(genre) + '</div>',
          '<div style="font-size:12px;color:rgba(255,255,255,0.45);margin-top:2px;">' + albums.length + ' album' + (albums.length !== 1 ? 's' : '') + '</div>',
        '</div>',
      '</div>',
      '<div style="display:flex;align-items:center;gap:10px;">',
        (genre === 'Unknown Genre' ? '<button class="btn btn-outline genre-mb-btn" style="padding:5px 12px;font-size:11px;border-radius:6px;"><i class="ph ph-tag" style="margin-right:5px;"></i>Auto-Tag</button>' : ''),
        '<i class="ph ph-caret-down genre-caret" style="color:rgba(255,255,255,0.4);font-size:18px;transition:transform 0.2s;"></i>',
      '</div>'
    ].join('');

    header.addEventListener('mouseenter', function () {
      header.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.04) 100%)';
    });
    header.addEventListener('mouseleave', function () {
      header.style.background = 'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.02) 100%)';
    });

    var mbBtn = header.querySelector('.genre-mb-btn');
    if (mbBtn) {
      mbBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        alert('Right-click any album or track and choose "Edit Metadata", then use the "Auto-Tag" tab to search MusicBrainz.');
      });
    }

    // Album grid for this genre
    var albumGrid = document.createElement('div');
    albumGrid.className = 'albums-grid';
    albumGrid.style.cssText = 'padding:0 4px;';

    var collapsed = false;
    header.addEventListener('click', function (e) {
      if (e.target.closest('.genre-mb-btn')) return;
      collapsed = !collapsed;
      albumGrid.style.display = collapsed ? 'none' : '';
      var caret = header.querySelector('.genre-caret');
      if (caret) caret.style.transform = collapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
    });

    albums.forEach(function (album) {
      var card = document.createElement('div');
      card.className = 'album-card' + (isAlbumActive(album) ? ' playing' : '');
      var active = isAlbumActive(album);
      var wave = active && state.isPlaying ? '<div class="now-playing-bars" style="position:absolute;bottom:6px;left:6px;"><div class="bar"></div><div class="bar"></div><div class="bar"></div></div>' : '';
      var playBtnIcon = active && state.isPlaying ? 'ph-fill ph-pause' : 'ph-fill ph-play';
      var cov = album.cover ? '<img src="' + esc(album.cover) + '" alt="cover" />' : '<i class="ph ph-music-notes"></i>';
      card.innerHTML = '<div class="album-card-img-wrapper" style="position:relative;">' + cov + wave + '<div class="album-card-play-btn" data-album="' + encodeURIComponent(album.name) + '"><i class="' + playBtnIcon + '"></i></div></div><div class="album-card-info"><div class="album-card-title" title="' + esc(album.name) + '">' + esc(album.name) + '</div><div class="album-card-artist">' + esc(album.artist) + '</div></div>';

      card.addEventListener('contextmenu', function (e) {
        e.preventDefault();
        window.currentContextMenuAlbum = album;
        hideAllContextMenus();
        positionContextMenu($('album-context-menu'), e.clientX, e.clientY);
      });

      card.querySelector('.album-card-play-btn').addEventListener('click', function (e) {
        e.stopPropagation(); initAudioCtx();
        if (isAlbumActive(album)) { togglePlay(); } else {
          state.playQueueTracks = getSortedAlbumTracks(album).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
          state.shuffleQueue = [];
          if (state.isShuffle) buildShuffleQueue();
          playTrack(state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks[0]);
        }
      });

      card.addEventListener('click', function (e) {
        if (e.target.closest('.album-card-play-btn')) return;
        pushNav('album:' + album.id);
        renderAlbumDetail(album);
      });

      albumGrid.appendChild(card);
    });

    wrapper.appendChild(header);
    wrapper.appendChild(albumGrid);
    grid.appendChild(wrapper);
  });
}


/* ─── SMART PLAYLISTS ─── */
var DEFAULT_SMART_PLAYLISTS = [
  { id: 'sp_recently_played', name: 'Recently Played', icon: 'ph-clock-counter-clockwise', color: 'linear-gradient(135deg,#FF9800,#FF5722)', type: 'smart', rule: { field: 'playHistory', limit: 30 }, desc: 'Your recent listens' },
  { id: 'sp_liked_songs', name: 'Liked Songs', icon: 'ph-heart', color: 'linear-gradient(135deg,#9C27B0,#E91E63)', type: 'smart', rule: { field: 'liked' }, desc: 'Everything you loved' },
  { id: 'sp_90s', name: '90s', icon: 'ph-radio', color: 'linear-gradient(135deg,#FF6F00,#FFAB00)', type: 'smart', rule: { field: 'decade', value: '1990' }, desc: '1990–1999 tracks' },
  { id: 'sp_2000s', name: '2000s', icon: 'ph-cassette-tape', color: 'linear-gradient(135deg,#2196F3,#00BCD4)', type: 'smart', rule: { field: 'decade', value: '2000' }, desc: '2000–2009 tracks' },
  { id: 'sp_2010s', name: '2010s', icon: 'ph-vinyl-record', color: 'linear-gradient(135deg,#1DB954,#0F9D58)', type: 'smart', rule: { field: 'decade', value: '2010' }, desc: '2010–2019 tracks' },
  { id: 'sp_2020s', name: '2020s', icon: 'ph-sparkle', color: 'linear-gradient(135deg,#FF4081,#F50057)', type: 'smart', rule: { field: 'decade', value: '2020' }, desc: '2020 and beyond' },
  { id: 'sp_no_genre', name: 'Unknown Genre', icon: 'ph-question', color: 'linear-gradient(135deg,#455A64,#78909C)', type: 'smart', rule: { field: 'no_genre' }, desc: 'Missing genre tags' },
];


function getSmartPlaylists() {
  var defaults = DEFAULT_SMART_PLAYLISTS;
  var custom = appSettings.customSmartPlaylists || [];
  return defaults.concat(custom);
}

function saveCustomSmartPlaylists(customs) {
  appSettings.customSmartPlaylists = customs;
  window.api.saveSettings(appSettings);
}

function evaluateSmartPlaylist(sp) {
  var tracks = [];
  var rule = sp.rule || {};

  if (rule.field === 'playHistory') {
    var seen = new Set();
    var hist = (state.playHistory || []).slice().reverse();
    for (var i = 0; i < hist.length && tracks.length < (rule.limit || 30); i++) {
      var h = hist[i];
      // Ensure matchedFile is resolved from musicFiles if missing
      if (!h.matchedFile) {
        h.matchedFile = findMatchingFile(h.title, h.artist, h.album, h.filePath || '') || null;
      }
      var key = (h.title || '') + '::' + (h.artist || '');
      if (!seen.has(key)) { seen.add(key); tracks.push({ title: h.title, artist: h.artist, album: h.album, duration: h.duration, matchedFile: h.matchedFile }); }
    }
  } else if (rule.field === 'liked') {
    var likedSongsSet = new Set(state.likedSongs);
    state.musicFiles.filter(function (f) { return likedSongsSet.has(f.filePath); })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'unplayed') {
    var playedKeys = new Set((state.playHistory || []).map(function (h) { return (h.title || '') + '::' + (h.artist || ''); }));
    state.musicFiles.filter(function (f) { return !playedKeys.has((f.title || '') + '::' + (f.artist || '')); })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'decade') {
    var dec = parseInt(rule.value);
    state.musicFiles.filter(function (f) {
      var yr = parseInt(f.year || f.date || 0);
      return yr >= dec && yr < dec + 10;
    }).forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'year') {
    var yr = parseInt(rule.value);
    state.musicFiles.filter(function (f) { return parseInt(f.year || f.date || 0) === yr; })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'genre') {
    state.musicFiles.filter(function (f) { return (f.genre || '').toLowerCase().includes((rule.value || '').toLowerCase()); })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'artist') {
    state.musicFiles.filter(function (f) { return (f.artist || '').toLowerCase().includes((rule.value || '').toLowerCase()); })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'album') {
    state.musicFiles.filter(function (f) { return (f.album || '').toLowerCase().includes((rule.value || '').toLowerCase()); })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'duration_max') {
    state.musicFiles.filter(function (f) { return (f.duration || 0) <= rule.value; })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'duration_min') {
    state.musicFiles.filter(function (f) { return (f.duration || 0) >= rule.value; })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  } else if (rule.field === 'no_genre') {
    state.musicFiles.filter(function (f) { return !f.genre || !f.genre.trim(); })
      .forEach(function (f) { tracks.push({ title: f.title, artist: f.artist, album: f.album, duration: f.duration, matchedFile: f }); });
  }
  return tracks;
}

// Smart playlist sidebar section - now a NO-OP (shown on Home instead)
function renderSmartPlaylistsSection() { /* moved to Home */ }

function openSmartPlaylist(sp) {
  var tracks = evaluateSmartPlaylist(sp);
  state.currentTracks = tracks;
  state.currentView = sp.id;
  clearTrackTableFilter();
  // Show track table view
  document.getElementById('home-dashboard-container').style.display = 'none';
  document.getElementById('albums-grid-container').style.display = 'none';
  var ttc = document.getElementById('tracks-table-container');
  if (ttc) ttc.style.display = 'block';
  var hdr = document.getElementById('album-detail-header');
  if (hdr) {
    hdr.style.display = 'flex';
    document.getElementById('album-detail-title').textContent = sp.name;
    document.getElementById('album-detail-type').textContent = 'Smart Playlist';
    document.getElementById('album-detail-artist').textContent = tracks.length + ' tracks' + (sp.desc ? ' • ' + sp.desc : '');
    document.getElementById('album-detail-meta').textContent = '';
    var cover = document.getElementById('album-detail-cover');
    var wrap = document.getElementById('album-detail-cover-wrap');
    if (cover) { cover.src = ''; cover.style.display = 'none'; }
    if (wrap) wrap.style.background = sp.color || 'linear-gradient(135deg,#333,#555)';
    // Play button
    var ppb = document.getElementById('album-cover-play-btn');
    if (ppb) ppb.onclick = function () {
      if (!tracks.length) return; initAudioCtx();
      state.playQueueTracks = tracks.slice();
      state.shuffleQueue = []; if (state.isShuffle) buildShuffleQueue();
      var first = state.isShuffle ? state.shuffleQueue[0] : state.playQueueTracks.find(function (t) { return !t.isDisabled; });
      if (first) playTrack(first);
    };
  }
  document.getElementById('view-title').textContent = sp.name;
  renderTracksTable(false);
  pushNav(sp.id);
}

function openSmartPlaylistBuilder() {
  var modal = document.getElementById('smart-playlist-modal');
  if (!modal) return;

  // Reset form
  var nameInput = document.getElementById('sp-name-input');
  var ruleType = document.getElementById('sp-rule-type');
  var valueInput = document.getElementById('sp-value-input');
  var valueRow = document.getElementById('sp-value-row');
  var decadeHelper = document.getElementById('sp-decade-helper');
  var valueLabel = document.getElementById('sp-value-label');
  var previewDiv = document.getElementById('sp-preview-count');
  var previewNum = document.getElementById('sp-preview-num');

  nameInput.value = '';
  ruleType.value = 'genre';
  valueInput.value = '';

  function updateValueRow() {
    var type = ruleType.value;
    var noValue = ['playHistory', 'liked'];
    if (noValue.includes(type)) {
      valueRow.style.display = 'none';
    } else {
      valueRow.style.display = 'block';
      if (type === 'decade') {
        valueLabel.textContent = 'Decade';
        valueInput.placeholder = 'e.g. 2010';
        decadeHelper.style.display = 'flex';
      } else if (type === 'year') {
        valueLabel.textContent = 'Year';
        valueInput.placeholder = 'e.g. 2019';
        decadeHelper.style.display = 'none';
      } else if (type === 'genre') {
        valueLabel.textContent = 'Genre (contains)';
        valueInput.placeholder = 'e.g. Rock, Pop, Hip-Hop…';
        decadeHelper.style.display = 'none';
      } else if (type === 'artist') {
        valueLabel.textContent = 'Artist (contains)';
        valueInput.placeholder = 'e.g. The Beatles';
        decadeHelper.style.display = 'none';
      } else if (type === 'album') {
        valueLabel.textContent = 'Album (contains)';
        valueInput.placeholder = 'e.g. Abbey Road';
        decadeHelper.style.display = 'none';
      }
    }
    updatePreview();
  }

  function updatePreview() {
    var type = ruleType.value;
    var val = valueInput.value.trim();
    var sp = { rule: { field: type, value: type === 'decade' || type === 'year' ? val : val, limit: 50 } };
    var needsValue = !['playHistory', 'liked'].includes(type);
    if (needsValue && !val) { previewDiv.style.display = 'none'; return; }
    var tracks = evaluateSmartPlaylist(sp);
    previewNum.textContent = tracks.length;
    previewDiv.style.display = 'block';
  }

  ruleType.onchange = updateValueRow;
  valueInput.oninput = updatePreview;

  // Decade quick buttons
  document.querySelectorAll('.sp-decade-btn').forEach(function (btn) {
    btn.onclick = function () {
      valueInput.value = btn.dataset.decade;
      document.querySelectorAll('.sp-decade-btn').forEach(function (b) { b.style.background = 'transparent'; b.style.color = 'white'; });
      btn.style.background = 'var(--accent)';
      btn.style.color = 'white';
      updatePreview();
    };
  });

  updateValueRow();
  modal.classList.add('active');

  document.getElementById('sp-cancel-btn').onclick = function () {
    modal.classList.remove('active');
  };
  modal.onclick = function (e) { if (e.target === modal) modal.classList.remove('active'); };

  document.getElementById('sp-create-btn').onclick = function () {
    var name = nameInput.value.trim();
    if (!name) { nameInput.focus(); nameInput.style.outline = '2px solid var(--accent)'; setTimeout(function () { nameInput.style.outline = ''; }, 1500); return; }
    var type = ruleType.value;
    var val = valueInput.value.trim();
    var needsValue = !['playHistory', 'liked'].includes(type);
    if (needsValue && !val) { valueInput.focus(); return; }

    var rule = { field: type };
    if (needsValue) rule.value = val;
    if (type === 'playHistory') rule.limit = 50;

    var colors = ['linear-gradient(135deg,#1DB954,#0F9D58)', 'linear-gradient(135deg,#2196F3,#00BCD4)', 'linear-gradient(135deg,#FF5722,#FF9800)', 'linear-gradient(135deg,#9C27B0,#673AB7)', 'linear-gradient(135deg,#E91E63,#FF4081)', 'linear-gradient(135deg,#FF6F00,#FFAB00)'];
    var icons = { artist: 'ph-user', album: 'ph-vinyl-record', genre: 'ph-tag', year: 'ph-calendar', decade: 'ph-hourglass', playHistory: 'ph-clock-counter-clockwise', liked: 'ph-heart' };
    var customs = appSettings.customSmartPlaylists || [];

    customs.push({
      id: 'sp_custom_' + Date.now(),
      name: name,
      icon: icons[type] || 'ph-magic-wand',
      color: colors[customs.length % colors.length],
      type: 'smart',
      rule: rule,
      desc: 'Custom smart playlist'
    });
    saveCustomSmartPlaylists(customs);
    modal.classList.remove('active');
    if (state.currentView === 'home') renderHomeDashboard();
  };
}

/* ─── LISTENING STATS ─── */
function recordPlayStat(track) {
  if (!track || !track.matchedFile) return;
  var fp = track.matchedFile.filePath;
  if (!appSettings.playCounts) appSettings.playCounts = {};
  appSettings.playCounts[fp] = (appSettings.playCounts[fp] || 0) + 1;
}

function recordListeningProgress(audioEl) {
  if (!state.currentPlayingTrack || !state.currentPlayingTrack.matchedFile || !audioEl || audioEl.paused) return;
  if (!appSettings.playTimes) appSettings.playTimes = {};
  var current = audioEl.currentTime || 0;
  var last = state._lastStatsTime;
  state._lastStatsTime = current;
  if (last === null || last === undefined) return;
  var delta = current - last;
  if (delta <= 0 || delta > 5) return;
  var fp = state.currentPlayingTrack.matchedFile.filePath;
  appSettings.playTimes[fp] = (appSettings.playTimes[fp] || 0) + delta;
  state._unsavedStatsSeconds = (state._unsavedStatsSeconds || 0) + delta;
  if (state._unsavedStatsSeconds >= 30) {
    state._unsavedStatsSeconds = 0;
    saveSettingsDebounced(1000);
  }
}

function renderStatsView() {
  var container = $('stats-container');
  if (!container) return;
  [$('home-dashboard-container'),$('albums-grid-container'),$('tracks-table-container'),$('search-albums-container')].forEach(function(el){if(el)el.style.display='none';});
  container.style.display = 'block';
  var counts = appSettings.playCounts || {};
  var times = appSettings.playTimes || {};
  var byPath = getLibraryIndex().byPath;
  var trackEntries = Object.keys(counts).map(function(fp) {
    var f = byPath.get(fp);
    return {fp:fp,count:counts[fp],time:times[fp]||0,file:f};
  }).filter(function(e){return e.file;}).sort(function(a,b){return b.count-a.count;});
  var totalSecs = Object.values(times).reduce(function(a,b){return a+b;},0);
  var totalHrs = Math.floor(totalSecs/3600), totalMins = Math.floor((totalSecs%3600)/60);
  var artistCounts = {};
  trackEntries.forEach(function(e){var a=e.file.artist||'Unknown';artistCounts[a]=(artistCounts[a]||0)+e.count;});
  var topArtists = Object.keys(artistCounts).map(function(a){return{name:a,count:artistCounts[a]};}).sort(function(a,b){return b.count-a.count;}).slice(0,6);
  var albumCounts = {};
  trackEntries.forEach(function(e){var k=getAlbumKey(e.file);albumCounts[k]=(albumCounts[k]||0)+e.count;});
  var topAlbums = Object.keys(albumCounts).map(function(k){return{name:k.split('::')[0],artist:k.split('::')[1],count:albumCounts[k]};}).sort(function(a,b){return b.count-a.count;}).slice(0,6);
  var maxCount = trackEntries.length>0?trackEntries[0].count:1;
  var maxArtist = topArtists.length>0?topArtists[0].count:1;
  var totalPlays = trackEntries.reduce(function(a,e){return a+e.count;},0);
  var html = '<h1 style="margin-top:0;margin-bottom:24px;font-size:28px;">Your Stats</h1>';
  // Summary cards
  html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;margin-bottom:32px;">';
  [{label:'Total Plays',val:totalPlays,color:'var(--accent)',icon:'ph-play'},{label:'Listening Time',val:totalHrs+'h '+totalMins+'m',color:'var(--accent)',icon:'ph-clock'},{label:'Unique Tracks',val:trackEntries.length,color:'var(--accent)',icon:'ph-music-notes'},{label:'Artists',val:Object.keys(artistCounts).length,color:'var(--accent)',icon:'ph-microphone'}].forEach(function(c){
    html+='<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-top:3px solid '+c.color+';border-radius:12px;padding:16px;"><i class="ph '+c.icon+'" style="font-size:22px;color:'+c.color+';margin-bottom:8px;display:block;"></i><div style="font-size:22px;font-weight:800;color:white;margin-bottom:4px;">'+c.val+'</div><div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.5px;">'+c.label+'</div></div>';
  });
  html += '</div>';
  if (trackEntries.length===0) { html+='<div style="text-align:center;padding:80px;color:rgba(255,255,255,0.2);"><i class="ph ph-chart-bar" style="font-size:56px;display:block;margin-bottom:16px;"></i><div>No stats yet — start listening!</div></div>'; container.innerHTML=html; return; }
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;">';
  // Top Tracks
  html += '<div><h2 style="font-size:16px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px;"><i class="ph ph-fire" style="color:var(--accent);"></i> Top Tracks</h2>';
  trackEntries.slice(0,10).forEach(function(e,i){
    var pct=Math.round((e.count/maxCount)*100);
    var cover=e.file.picture?'<img src="'+esc(e.file.picture)+'" style="width:34px;height:34px;border-radius:5px;object-fit:cover;flex-shrink:0;">':'<div style="width:34px;height:34px;border-radius:5px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ph ph-music-notes" style="font-size:12px;color:rgba(255,255,255,0.3);"></i></div>';
    html+='<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><div style="font-size:11px;color:rgba(255,255,255,0.25);width:14px;text-align:right;flex-shrink:0;">'+(i+1)+'</div>'+cover+'<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(e.file.title||'Unknown')+'</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">'+esc(e.file.artist||'Unknown')+'</div><div style="margin-top:3px;height:2px;background:rgba(255,255,255,0.07);border-radius:1px;"><div style="height:100%;width:'+pct+'%;background:var(--accent);border-radius:1px;"></div></div></div><div style="font-size:12px;font-weight:700;color:var(--accent);">x'+e.count+'</div></div>';
  });
  html += '</div>';
  // Artists + Albums
  html += '<div>';
  html += '<h2 style="font-size:16px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px;"><i class="ph ph-microphone" style="color:var(--accent);"></i> Top Artists</h2>';
  topArtists.forEach(function(a){
    var pct=Math.round((a.count/maxArtist)*100);
    html+='<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;"><div style="font-size:13px;font-weight:600;">'+esc(a.name)+'</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">'+a.count+' plays</div></div><div style="height:3px;background:rgba(255,255,255,0.07);border-radius:2px;"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,var(--accent),var(--accent-hover));border-radius:2px;"></div></div></div>';
  });
  html += '<h2 style="font-size:16px;font-weight:700;margin-top:24px;margin-bottom:14px;display:flex;align-items:center;gap:8px;"><i class="ph ph-vinyl-record" style="color:var(--accent);"></i> Top Albums</h2>';
  topAlbums.forEach(function(a){
    html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><div style="min-width:0;"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(a.name)+'</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">'+esc(a.artist)+'</div></div><div style="font-size:12px;font-weight:700;color:var(--accent);margin-left:8px;">x'+a.count+'</div></div>';
  });
  html += '</div></div>';
  container.innerHTML = html;
}

// Nav: Stats
var navStats = $('nav-stats');
if (navStats) {
  navStats.addEventListener('click', function () {
    pushNav('stats');
    document.querySelectorAll('.nav-item').forEach(function(el){el.classList.remove('active');});
    navStats.classList.add('active');
    state.currentView = 'stats';
    renderStatsView();
  });
}

// Simple debounce function
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(this, args), wait);
  };
}

function filterPlaylistTrackRows(value) {
  window._tracksFilterValue = String(value || '');
  window._tracksFilterView = state.currentView;
  renderTracksTable(!!window._tracksAllowReorder);
}

// Playlist track search logic
var trackSearchInput = $('playlist-track-search');
if (trackSearchInput) {
  trackSearchInput.addEventListener('input', debounce(function (e) {
    filterPlaylistTrackRows(e.target.value);
  }, 300));
}

// Global Ctrl+F listener
document.addEventListener('keydown', function(e) {
  if (e.ctrlKey && e.key.toLowerCase() === 'f') {
    // Check which search to focus
    var trackSearch = $('playlist-track-search');
    var globalSearch = $('global-search');
    var playlistControls = $('playlist-controls-container');
    
    if (playlistControls && playlistControls.style.display !== 'none' && trackSearch) {
      e.preventDefault();
      trackSearch.focus();
    } else if (globalSearch) {
      e.preventDefault();
      globalSearch.focus();
    }
  }
});
