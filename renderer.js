const PALETTE = ['#1DB954', '#E91E63', '#2196F3', '#FF9800', '#9C27B0', '#00BCD4', '#FF5722', '#607D8B'];
let state = {
  musicFiles: [], playlists: [], mappings: {}, currentView: 'library', currentTracks: [],
  currentPlayingTrack: null, isPlaying: false, isShuffle: false, loopMode: 0,
  likedSongs: parseStoredArray('likedSongs'),
  shuffleQueue: [], playHistory: [], navHistory: [], navIndex: -1,
  activeAlbumName: null, userQueue: [], playQueueTracks: []
};
let appSettings = { minimizeToTray: false, audioMode: 'stereo', sidebarWidth: 240 };
let audioCtx, audioGainNode, audioCompressor;
let isPlaylistGridView = false;
let currentContextMenuTrack = null;
let currentContextMenuPlaylist = null;
let currentZoom = 180;
let isQueueOpen = false;
let lyricsOpen = false;
let lyricsCurrentTrackKey = null;
let lyricsData = [];
let lyricsOffsetSec = 0;
let cpSelectedColor = PALETTE[0];
let cpSelectedCoverPath = null;
let playlistToDelete = null;
let isMultiSelectMode = false;
let selectedAlbumsForEdit = new Set();

function $(id) { return document.getElementById(id); }
function parseStoredArray(key) { try { var value = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(value) ? value : []; } catch (e) { return []; } }
function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (ch) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]; }); }
function toFileUrl(filePath) { if (!filePath) return ''; if (filePath.startsWith('file://')) return filePath; var normalized = filePath.replace(/\\/g, '/'); var pathname = (normalized.startsWith('/') ? normalized : '/' + normalized).split('/').map(function (segment, index) { if (index === 0) return ''; if (index === 1 && /^[A-Za-z]:$/.test(segment)) return segment; return encodeURIComponent(segment); }).join('/'); return 'file://' + pathname; }
function fromFileUrl(url) { if (!url) return null; if (!url.startsWith('file://')) return url; var pathname = decodeURI(new URL(url).pathname); return /^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1).replace(/\//g, '\\') : pathname; }
function fmt(s) { if (!s || isNaN(s)) return '0:00'; return Math.floor(s / 60) + ':' + (Math.floor(s % 60) + '').padStart(2, '0'); }
function showModal(el) { if (el) el.classList.add('active'); }
function hideModal(el) { if (el) el.classList.remove('active'); }
function hideAllContextMenus() { document.querySelectorAll('.context-menu').forEach(function (m) { m.classList.remove('visible'); }); }
function positionContextMenu(menu, x, y) {
  if (!menu) return;
  menu.classList.add('visible');
  // force layout so offsetWidth/Height are correct
  menu.style.left = '0px'; menu.style.top = '0px';
  var mw = menu.offsetWidth, mh = menu.offsetHeight;
  menu.style.left = (x + mw > window.innerWidth ? x - mw : x) + 'px';
  menu.style.top = (y + mh > window.innerHeight ? y - mh : y) + 'px';
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
function darkenHex(hex, amount) {
  var rgb = hexToRgb(hex);
  return rgbToHex({ r: rgb.r * (1 - amount), g: rgb.g * (1 - amount), b: rgb.b * (1 - amount) });
}
function applyAccentColor(color) {
  var accent = color || '#1DB954';
  var rgb = hexToRgb(accent);
  document.documentElement.style.setProperty('--accent', accent);
  document.documentElement.style.setProperty('--accent-hover', darkenHex(accent, 0.18));
  document.documentElement.style.setProperty('--accent-rgb', rgb.r + ',' + rgb.g + ',' + rgb.b);
}
function normalize(s) { return s ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\([^)]*\)/g, '').replace(/feat\.?[^,]*/gi, '').replace(/[^a-z0-9]/g, '') : '' }
function getAlbumKey(file) { return (file.album || 'Unknown Album') + '::' + (file.albumArtist || file.artist || 'Unknown Artist'); }
function isEditableMetadataFile(file) { return !!(file && file.filePath && /\.(mp3|flac)$/i.test(stripFileUrl(file.filePath) || file.filePath)); }
function getPlaylistTrackFilePath(record) { return record ? (record.FilePath || record.filePath || record.Path || record.path || '') : ''; }
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
  if (albumHasMultipleDiscs(tracks)) return tracks.sort(compareAlbumTrackOrder);
  return inferDiscsFromDuplicateTrackNumbers(tracks) || tracks.sort(compareAlbumTrackOrder);
}
function fuzzyMatch(a, b) { var na = normalize(a), nb = normalize(b); return na === nb || na.includes(nb) || nb.includes(na); }
function findMatchingFile(songName, artistName, albumName, filePath) {
  if (filePath) {
    var wantedPath = stripFileUrl(filePath);
    var byPath = state.musicFiles.find(function(f) { return stripFileUrl(f.filePath) === wantedPath; });
    if (byPath) return byPath;
  }
  var keyWithAlbum = songName + '-' + artistName + '-' + (albumName || '');
  var key = songName + '-' + artistName; // fallback for backwards compatibility
  
  if (state.mappings[keyWithAlbum] === 'NO_MATCH' || state.mappings[key] === 'NO_MATCH') return null;
  
  if (state.mappings[keyWithAlbum]) {
    var m = state.musicFiles.find(function(f) { return f.filePath === state.mappings[keyWithAlbum]; });
    if (m) return m;
  }
  if (state.mappings[key]) {
    var m = state.musicFiles.find(function(f) { return f.filePath === state.mappings[key]; });
    if (m) return m;
  }
  
  // First pass: try to match all three (Song + Artist + Album)
  if (albumName) {
    for (var i = 0; i < state.musicFiles.length; i++) {
      var f = state.musicFiles[i];
      if (fuzzyMatch(f.title, songName) && (!artistName || fuzzyMatch(f.artist, artistName)) && fuzzyMatch(f.album, albumName)) return f;
    }
  }

  // Second pass: Song + Artist (ignore album)
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

  // Collect Albums
  var albumsMap = {};
  var albumList = [];
  state.musicFiles.forEach(function(f) {
    var k = getAlbumKey(f);
    if (!albumsMap[k]) {
      var alb = { id: k, name: f.album || 'Unknown Album', artist: f.albumArtist || f.artist || 'Unknown Artist', cover: null, tracks: [] };
      albumsMap[k] = alb;
      albumList.push(alb);
    }
    if (!albumsMap[k].cover && f.picture) albumsMap[k].cover = f.picture;
    albumsMap[k].tracks.push(f);
  });

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
      { icon: 'ph-clock', val: totalPlays2 ? (totalHrs2 + 'h ' + totalMins2 + 'm') : '—', label: 'Listened', color: '#2196F3' },
      { icon: 'ph-music-notes', val: uniqueTracks2 || '—', label: 'Tracks Played', color: '#E91E63' },
      { icon: 'ph-vinyl-record', val: albumList.length, label: 'Albums', color: '#FF9800' },
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
        recGrid.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:#ff5252;font-size:13px;">Failed to load recommendations.</div>';
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
  var titleArtistMap = new Map();
  var filenameMap = new Map();
  state.musicFiles.forEach(function (file) {
    var titleKey = normalize(file.title) + '::' + normalize(file.artist);
    var filenameKey = normalize(file.filename ? file.filename.replace(/\.[^.]+$/, '') : '');
    if (titleKey && !titleArtistMap.has(titleKey)) titleArtistMap.set(titleKey, file);
    if (filenameKey && !filenameMap.has(filenameKey)) filenameMap.set(filenameKey, file);
  });

  var pseudoLiked = {
    id: 'liked_songs',
    name: 'Liked Songs',
    pinned: false,
    color: 'linear-gradient(135deg, #450af5, #c4a1ff)',
    isSpecial: true,
    tracks: state.musicFiles.filter(function (f) { return state.likedSongs.includes(f.filePath); }),
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

  if (isPlaylistGridView) {
    list.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(100px,1fr));gap:12px;padding:12px;max-width:100%;box-sizing:border-box;overflow-x:hidden;';
    if($('playlist-search')) $('playlist-search').style.display = 'block';
  } else {
    list.style.cssText = 'display:flex;flex-direction:column;';
  }

  sorted.forEach(function (pl) {
    var autoCover = pl.cover || null;
    if (!autoCover && !pl.isSpecial) {
      for (var i = 0; i < (pl.tracks || []).length; i++) {
        var r = pl.tracks[i];
        var sn = r.Song || r.title || '', an = r.Artist || r.artist || '', al = r.Album || r.album || '';
        var trackPath = getPlaylistTrackFilePath(r);
        var m = (trackPath ? state.musicFiles.find(function (f) { return stripFileUrl(f.filePath) === stripFileUrl(trackPath); }) : null) || titleArtistMap.get(normalize(sn) + '::' + normalize(an) + '::' + normalize(al)) || titleArtistMap.get(normalize(sn) + '::' + normalize(an)) || filenameMap.get(normalize(sn)) || findMatchingFile(sn, an, al, trackPath);
        if (m && m.picture) { autoCover = m.picture; break; }
      }
    }

    var el = document.createElement('div');
    var isActive = state.currentView === pl.id;
    el.className = 'playlist-item' + (pl.pinned ? ' pinned' : '') + (isActive ? ' active' : '');
    el.id = pl.id;

    var pinHtml = pl.pinned ? '<i class="ph-fill ph-push-pin" style="color:var(--accent);margin-right:4px;"></i>' : '';
    // Download icon for visual match with user's picture
    var dlHtml = pl.id !== 'liked_songs' ? '<i class="ph-fill ph-arrow-circle-down" style="color:var(--accent);margin-right:4px;"></i>' : '<i class="ph-fill ph-arrow-circle-down" style="color:var(--accent);margin-right:4px;"></i>';
    var trackCount = pl.tracks ? pl.tracks.length : 0;
    var subText = (pl.pinned ? pinHtml : '') + dlHtml + trackCount + ' tracks';

    if (isPlaylistGridView) {
      el.style.cssText = 'display:flex;flex-direction:column;cursor:pointer;text-align:left;min-width:0;overflow:hidden;border-radius:6px;padding:8px;background:transparent;transition:background 0.2s;white-space:normal;box-sizing:border-box;';
      el.onmouseenter = function () { el.style.background = 'rgba(255,255,255,0.05)'; };
      el.onmouseleave = function () { el.style.background = 'transparent'; };

      var innerIcon = pl.isSpecial ? '<i class="ph-fill ph-heart" style="font-size:36px;color:white;"></i>' : '<i class="ph ph-music-notes" style="font-size:24px;color:rgba(255,255,255,.6);"></i>';
      var bgStyle = pl.isSpecial ? 'background: ' + pl.color + ';' : 'background:' + (pl.color || '#333') + ';';

      var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
      var ch = autoCover ? '<img src="' + esc(autoCover) + '"' + lazy + ' style="width:100%;aspect-ratio:1;border-radius:6px;object-fit:cover;margin-bottom:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);display:block;" />'
        : '<div style="width:100%;aspect-ratio:1;border-radius:6px;' + bgStyle + 'display:flex;align-items:center;justify-content:center;margin-bottom:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);">' + innerIcon + '</div>';

      el.innerHTML = ch + '<span style="font-size:13px;font-weight:600;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-bottom:4px;">' + esc(pl.name) + '</span><span style="font-size:11px;color:var(--text-subdued);display:flex;align-items:center;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + subText + '</span>';
    } else {
      el.style.cssText = 'display:flex;align-items:center;padding:6px 8px;border-radius:4px;cursor:pointer;';
      var innerIcon = pl.isSpecial ? '<i class="ph-fill ph-heart" style="font-size:14px;color:white;"></i>' : '';
      var bgStyle = pl.isSpecial ? 'background: ' + pl.color + ';' : 'background:' + (pl.color || '#555') + ';';

      var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
      var dotOrThumb = autoCover ? '<img src="' + esc(autoCover) + '"' + lazy + ' style="width:28px;height:28px;border-radius:3px;object-fit:cover;flex-shrink:0;margin-right:8px;display:block;" />'
        : '<div style="width:28px;height:28px;border-radius:3px;' + bgStyle + 'display:flex;align-items:center;justify-content:center;margin-right:8px;flex-shrink:0;">' + innerIcon + '</div>';
      var pin = pl.pinned ? '<i class="ph ph-push-pin" style="font-size:10px;color:var(--accent);margin-left:4px;flex-shrink:0;"></i>' : '';
      el.innerHTML = dotOrThumb + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;">' + esc(pl.name) + '</span>' + pin;
    }

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
  state.musicFiles.forEach(function (f) {
    var k = getAlbumKey(f);
    if (!albumDiscCounts[k]) albumDiscCounts[k] = new Set();
    albumDiscCounts[k].add(getDiscNumber(f));
  });
  function isMissingTrackOrDisc(f) {
    return !f.trackNo || (albumDiscCounts[getAlbumKey(f)] && albumDiscCounts[getAlbumKey(f)].size > 1 && !f.discNo && !f.__displayDiscNo);
  }
  var checks = [
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
  root.innerHTML = '<div class="tag-health-toolbar"><div><div class="tag-health-title">Library Tag Health</div><div class="tag-health-subtitle">Find tracks that need metadata cleanup or loudness analysis.</div></div><div class="tag-health-actions"><button class="tag-health-action" id="tag-health-rescan">Refresh</button><button class="tag-health-action accent" id="tag-health-analyze-visible">Analyze Visible</button></div></div><div class="tag-health-cards" id="metadata-health-cards"></div><div id="metadata-health-list"></div>';
  var refreshBtn = $('tag-health-rescan');
  if (refreshBtn) refreshBtn.onclick = renderMetadataHealthView;
  var analyzeVisibleBtn = $('tag-health-analyze-visible');
  if (analyzeVisibleBtn) analyzeVisibleBtn.onclick = function () { analyzeLoudnessForFiles(filtered); };
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
    if (!f.year) details.push('no year');
    if (!f.genre) details.push('no genre');
    if (!f.trackNo) details.push('no track #');
    if (f.replayGainTrackDb === null || f.replayGainTrackDb === undefined) details.push('no ReplayGain');
    row.innerHTML = cover + '<div class="tag-health-track"><div class="tag-health-track-title">' + esc(f.title || f.filename || 'Unknown Track') + '</div><div class="tag-health-track-meta">' + esc(f.artist || 'Unknown Artist') + ' • ' + esc(f.album || 'Unknown Album') + '</div><div class="tag-health-badges">' + details.slice(0, 4).map(function (d) { return '<span>' + esc(d) + '</span>'; }).join('') + '</div></div><div class="tag-health-row-actions"><button class="tag-health-action edit">Edit</button><button class="tag-health-action analyze">Analyze</button></div>';
    row.querySelector('.edit').onclick = function () { openMetadataEditor([f]); };
    row.querySelector('.analyze').onclick = function () { analyzeLoudnessForFiles([f]); };
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

  var albumsMap = {};
  state.musicFiles.forEach(function (f) {
    var k = getAlbumKey(f);
    if (!albumsMap[k]) albumsMap[k] = { id: k, name: f.album || 'Unknown Album', artist: f.albumArtist || f.artist || 'Unknown Artist', cover: null, tracks: [], year: f.year || 0, addedIdx: 0 };
    if (!albumsMap[k].cover && f.picture) albumsMap[k].cover = f.picture;
    if (f.year && !albumsMap[k].year) albumsMap[k].year = f.year;
    albumsMap[k].tracks.push(f);
  });

  // Sort based on dropdown
  var sortSel = $('library-sort-select');
  var sortMode = sortSel ? sortSel.value : 'artist';
  var albums = Object.values(albumsMap);
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
  window._libRenderChunk = appSettings.virtualScrolling ? 60 : albums.length;
  
  if (!window.renderLibraryChunk) {
    window.renderLibraryChunk = function() {
      if (!window._libAlbumsToRender || window._libRenderIndex >= window._libAlbumsToRender.length) return;
      var chunk = window._libAlbumsToRender.slice(window._libRenderIndex, window._libRenderIndex + window._libRenderChunk);
      var grid = $('albums-grid');
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
            var meBtn = $('btn-multi-edit');
            if (meBtn) {
              meBtn.style.display = selectedAlbumsForEdit.size > 0 ? 'block' : 'none';
              meBtn.textContent = 'Edit (' + selectedAlbumsForEdit.size + ')';
            }
            var mmBtn = $('btn-multi-merge');
            if (mmBtn) mmBtn.style.display = selectedAlbumsForEdit.size > 1 ? 'block' : 'none';
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
        grid.appendChild(card);
      });
      window._libRenderIndex += window._libRenderChunk;
    };
  }
  window.renderLibraryChunk();
}


// FIX 5+6: renderAlbumDetail resets scroll, correct play button
async function renderAlbumDetail(album) {
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
      var str = arr.join(' • ');
      if (meta.year) str = meta.year + ' • ' + str;
      metaEl.textContent = str;
    }
  } else { $('album-detail-artist').textContent = album.artist; }

  $('album-edit-metadata-btn').style.display = 'flex';

  var cov = $('album-detail-cover'); cov.src = album.cover || ''; cov.style.display = album.cover ? 'block' : 'none'; cov.style.cursor = 'default'; cov.onclick = null;
  state.currentTracks = getSortedAlbumTracks(album).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
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
}

function renderPlaylist(playlistId) {
  // FIX 5: scroll reset
  var ca = $('content-area'); if (ca) ca.scrollTop = 0;
  $('playlist-controls-container').style.display = 'none';
  $('album-detail-meta').textContent = '';
  $('album-edit-metadata-btn').style.display = 'none';

  if (playlistId === 'liked_songs') {
    $('view-title').textContent = 'Liked Songs';
    state.currentTracks = state.musicFiles.filter(function (f) { return state.likedSongs.includes(f.filePath); }).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });
    $('album-detail-header').style.display = 'none'; renderTracksTable(false); return;
  }
  var pl = state.playlists.find(function (p) { return p.id === playlistId; }); if (!pl) return;
  $('album-detail-header').style.display = 'flex'; $('album-detail-type').textContent = 'Playlist';
  $('playlist-controls-container').style.display = 'flex';
  $('playlist-track-search').value = ''; // clear search when opening a new playlist
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

function renderTracksTable(allowReorder) {
  var tbody = $('tracks-body'); tbody.innerHTML = '';
  if (!state.currentTracks.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:40px;color:var(--text-subdued);">No tracks</td></tr>'; return; }
  window._tracksToRender = state.currentTracks;
  window._tracksRenderIndex = 0;
  window._tracksRenderChunk = appSettings.virtualScrolling ? 60 : state.currentTracks.length;
  window._tracksAllowReorder = allowReorder;
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
  window._playlistMembership = playlistMembership;
  
  if (!window.renderTracksChunk) {
    window.renderTracksChunk = function() {
      if (!window._tracksToRender || window._tracksRenderIndex >= window._tracksToRender.length) return;
      var chunk = window._tracksToRender.slice(window._tracksRenderIndex, window._tracksRenderIndex + window._tracksRenderChunk);
      var tbody = $('tracks-body');
      chunk.forEach(function (track, i) {
        var index = window._tracksRenderIndex + i;
        var tr = document.createElement('tr');
        if (track.isDisabled) tr.classList.add('disabled');
        if (state.currentPlayingTrack && state.currentPlayingTrack.matchedFile && track.matchedFile && state.currentPlayingTrack.matchedFile.filePath === track.matchedFile.filePath) tr.classList.add('playing');
        var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
        var pic = track.matchedFile && track.matchedFile.picture ? '<img src="' + esc(track.matchedFile.picture) + '"' + lazy + ' class="track-img" />' : '<div class="track-img" style="display:flex;align-items:center;justify-content:center;"><i class="ph ph-music-notes" style="color:var(--text-subdued);"></i></div>';
        var liked = track.matchedFile ? state.likedSongs.includes(track.matchedFile.filePath) : false;
        var fp = track.matchedFile ? track.matchedFile.filePath : '';
        var membershipKey = fp ? 'path::' + stripFileUrl(fp) : (track.title && track.artist ? 'meta::' + track.title.toLowerCase() + '::' + track.artist.toLowerCase() + '::' + (track.album || '').toLowerCase() : '');
        var inPlaylists = membershipKey && window._playlistMembership ? (window._playlistMembership.get(membershipKey) || []) : [];
        var discNo = track.matchedFile ? getDiscNumber(track.matchedFile) : 1;
        var hasMultipleDiscs = state.currentView && state.currentView.startsWith('album:') && albumHasMultipleDiscs(state.currentTracks);
        var prevTrack = state.currentTracks[index - 1];
        var prevDiscNo = prevTrack && prevTrack.matchedFile ? getDiscNumber(prevTrack.matchedFile) : 1;
        if (hasMultipleDiscs && discNo && (!prevTrack || prevDiscNo !== discNo)) {
          var discRow = document.createElement('tr');
          discRow.className = 'disc-separator-row';
          discRow.innerHTML = '<td colspan="6"><span class="disc-separator-label"><i class="ph ph-vinyl-record"></i> Disc ' + esc(discNo) + '</span></td>';
          tbody.appendChild(discRow);
        }
        var displayNo = state.currentView && state.currentView.startsWith('album:') && track.matchedFile && track.matchedFile.trackNo ? track.matchedFile.trackNo : (index + 1);
        
        tr.innerHTML = '<td style="width:20px;padding-left:8px;">' + (window._tracksAllowReorder ? '<i class="ph ph-dots-six-vertical drag-handle"></i>' : '') + '</td>'
          + '<td class="col-num">' + displayNo + '</td>'
          + '<td class="col-title"><div class="track-info">' + pic + '<div class="track-text"><div class="title">' + esc(track.title) + '<i class="' + (liked ? 'ph-fill ph-heart' : 'ph ph-heart') + ' track-like-btn" data-fp="' + esc(fp) + '" style="color:var(--accent);margin-left:8px;cursor:pointer;"></i>' + (inPlaylists.length > 0 ? '<i class="ph-fill ph-check-circle track-in-pl-btn" style="color:#1DB954;margin-left:8px;cursor:pointer;" title="In Playlists"></i>' : '') + '</div><div class="artist">' + esc(track.artist) + '</div></div></div></td>'
          + '<td class="col-album">' + esc(track.album) + '</td>'
          + '<td class="col-duration">' + fmt(track.duration) + '</td>'
          + '<td style="width:40px;text-align:center;"><button class="icon-btn ghost track-options-btn"><i class="ph ph-dots-three"></i></button></td>';
        tr.querySelector('.track-like-btn').addEventListener('click', function (e) {
          e.stopPropagation(); var filePath = e.currentTarget.dataset.fp; if (!filePath) return;
          e.currentTarget.style.transform = 'scale(1.3)'; setTimeout(function () { e.currentTarget.style.transform = ''; }, 200);
          if (state.likedSongs.includes(filePath)) state.likedSongs = state.likedSongs.filter(function (p) { return p !== filePath; }); else state.likedSongs.push(filePath);
          localStorage.setItem('likedSongs', JSON.stringify(state.likedSongs));
          e.currentTarget.className = state.likedSongs.includes(filePath) ? 'ph-fill ph-heart track-like-btn' : 'ph ph-heart track-like-btn';
          if (state.currentPlayingTrack && state.currentPlayingTrack.matchedFile && state.currentPlayingTrack.matchedFile.filePath === filePath) updatePlayerUI();
          if (state.currentView === 'liked_songs') renderPlaylist('liked_songs');
        });
        var plBtn = tr.querySelector('.track-in-pl-btn');
        if (plBtn) {
          plBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            var menu = $('track-playlists-menu');
            var list = $('track-playlists-list');
            list.innerHTML = '';
            inPlaylists.forEach(function(p) {
              var item = document.createElement('div');
              item.className = 'menu-item';
              item.innerHTML = '<i class="ph ph-music-notes" style="margin-right:8px;color:var(--text-subdued);"></i>' + esc(p.name);
              item.onclick = function() { hideAllContextMenus(); pushNav(p.id); renderPlaylist(p.id); };
              list.appendChild(item);
            });
            hideAllContextMenus();
            positionContextMenu(menu, e.clientX, e.clientY);
          });
        }
        tr.querySelector('.track-options-btn').addEventListener('click', function (e) {
          e.stopPropagation(); currentContextMenuTrack = track; hideAllContextMenus(); 
          var rmBtn = $('ctx-remove-match');
          if (rmBtn) {
             if (state.currentView.startsWith('pl_') && track.matchedFile) rmBtn.style.display = 'block';
             else rmBtn.style.display = 'none';
          }
          var gotoBtn = $('ctx-go-to-album');
          if (gotoBtn) gotoBtn.style.display = track.matchedFile ? 'block' : 'none';
          positionContextMenu($('track-context-menu'), e.clientX, e.clientY);
        });
        tr.addEventListener('contextmenu', function (e) {
          e.preventDefault(); currentContextMenuTrack = track; hideAllContextMenus(); 
          var rmBtn = $('ctx-remove-match');
          if (rmBtn) {
             if (state.currentView.startsWith('pl_') && track.matchedFile) rmBtn.style.display = 'block';
             else rmBtn.style.display = 'none';
          }
          var gotoBtn = $('ctx-go-to-album');
          if (gotoBtn) gotoBtn.style.display = track.matchedFile ? 'block' : 'none';
          positionContextMenu($('track-context-menu'), e.clientX, e.clientY);
        });
        if (!track.isDisabled) {
          tr.style.cursor = 'pointer';
          tr.addEventListener('dblclick', function () { initAudioCtx(); state.playQueueTracks = state.currentTracks.slice(); playTrack(track); });
          tr.draggable = true;
          tr.addEventListener('dragstart', function (e) { e.dataTransfer.setData('text/plain', JSON.stringify({ title: track.title, artist: track.artist, album: track.album })); tr.style.opacity = '0.5'; });
          tr.addEventListener('dragend', function () { tr.style.opacity = ''; });
        }
        if (window._tracksAllowReorder) {
          var handle = tr.querySelector('.drag-handle');
          if (handle) {
            handle.addEventListener('mousedown', function () { tr.draggable = true; });
            tr.addEventListener('dragstart', function (e) { e.dataTransfer.setData('reorder-index', String(index)); tr.style.opacity = '0.5'; });
            tr.addEventListener('dragend', function () { tr.style.opacity = ''; tr.draggable = false; });
          }
          tr.addEventListener('dragover', function (e) { e.preventDefault(); tr.classList.add('drag-over'); });
          tr.addEventListener('dragleave', function () { tr.classList.remove('drag-over'); });
          tr.addEventListener('drop', async function (e) {
            e.preventDefault(); tr.classList.remove('drag-over');
            var fi = parseInt(e.dataTransfer.getData('reorder-index')); if (isNaN(fi) || fi === index) return;
            var pl = state.playlists.find(function (p) { return p.id === state.currentView; }); if (!pl) return;
            var moved = pl.tracks.splice(fi, 1)[0]; pl.tracks.splice(index, 0, moved);
            pl.sortBy = 'Custom Order';
            await window.api.savePlaylists(state.playlists); renderPlaylist(state.currentView);
          });
        }
        tbody.appendChild(tr);
      });
      window._tracksRenderIndex += window._tracksRenderChunk;
    };
  }
  window.renderTracksChunk();
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
  window.api.saveSettings(appSettings);

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
}
function cycleLoop() { state.loopMode = (state.loopMode + 1) % 3; $('loop-icon').className = state.loopMode === 2 ? 'ph ph-repeat-once' : 'ph ph-repeat'; $('loop-icon').style.color = state.loopMode > 0 ? 'var(--accent)' : ''; }

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
  updateMiniPlayer();
  if (!state.currentPlayingTrack) return;
  var t = state.currentPlayingTrack;
  var liked = t.matchedFile ? state.likedSongs.includes(t.matchedFile.filePath) : false;
  $('now-playing-info').innerHTML = '<div class="cover-art' + (t.matchedFile && t.matchedFile.picture ? '' : ' placeholder') + '">' + (t.matchedFile && t.matchedFile.picture ? '' : '<i class="ph ph-music-notes"></i>') + '</div><div class="track-details"><div class="track-name">' + esc(t.title) + '</div><div class="track-artist">' + esc(t.artist) + '</div></div><button class="icon-btn ghost" id="btn-like"><i class="' + (liked ? 'ph-fill ph-heart' : 'ph ph-heart') + '" style="' + (liked ? 'color:var(--accent);' : '') + '"></i></button>';
  if (t.matchedFile && t.matchedFile.picture) { $('now-playing-info').querySelector('.cover-art').style.backgroundImage = 'url("' + t.matchedFile.picture.replace(/"/g, '\\"') + '")'; }
  $('btn-like').addEventListener('click', function () {
    if (!t.matchedFile) return; var fp = t.matchedFile.filePath;
    if (state.likedSongs.includes(fp)) state.likedSongs = state.likedSongs.filter(function (p) { return p !== fp; }); else state.likedSongs.push(fp);
    localStorage.setItem('likedSongs', JSON.stringify(state.likedSongs));
    updatePlayerUI(); renderTracksTable(state.currentView.startsWith('pl_'));
  });
  updateMiniPlayer();
}

function updateMiniPlayer() {
  var mini = $('mini-player'); if (!mini) return;
  var t = state.currentPlayingTrack;
  var cover = $('mini-cover'), placeholder = $('mini-cover-placeholder'), title = $('mini-title'), artist = $('mini-artist'), icon = $('mini-play-icon');
  if (icon) icon.className = state.isPlaying ? 'ph ph-pause' : 'ph ph-play';
  if (!t) { if (title) title.textContent = 'No track'; if (artist) artist.textContent = '-'; if (cover) cover.style.display = 'none'; if (placeholder) placeholder.style.display = 'flex'; updateMiniProgress(); return; }
  if (title) title.textContent = t.title || 'Unknown Track';
  if (artist) artist.textContent = t.artist || 'Unknown Artist';
  var pic = t.matchedFile && t.matchedFile.picture ? t.matchedFile.picture : '';
  if (cover) { cover.src = pic; cover.style.display = pic ? 'block' : 'none'; }
  if (placeholder) placeholder.style.display = pic ? 'none' : 'flex';
  updateMiniProgress();
}

function updateMiniProgress() {
  var audio = window.audioEls ? window.audioEls[activeAudioIdx] : null;
  var cur = $('mini-time-current'), total = $('mini-time-total'), bar = $('mini-progress-bar');
  var duration = audio && !isNaN(audio.duration) ? audio.duration : 0;
  var current = audio && !isNaN(audio.currentTime) ? audio.currentTime : 0;
  if (cur) cur.textContent = fmt(current);
  if (total) total.textContent = fmt(duration);
  if (bar) bar.style.width = duration ? ((current / duration) * 100) + '%' : '0%';
}

function openPlaylistContextMenu(pl, x, y) {
  currentContextMenuPlaylist = pl;
  var pinBtn = $('pctx-pin'); if (pinBtn) pinBtn.textContent = pl.pinned ? 'Unpin Playlist' : 'Pin Playlist';
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
  window.api.onScanProgress(function (d) { if (d.total > 0) { var pct = Math.round((d.current / d.total) * 100); importFolderBtn.innerHTML = '<i class="ph ph-spinner ph-spin"></i> Scanning ' + pct + '%'; importFolderBtn.style.background = 'linear-gradient(90deg,rgba(29,185,84,.2) ' + pct + '%,transparent ' + pct + '%)'; } });
  try {
    var files = await window.api.scanFolder(folderPath, state.musicFiles);
    var libraryByPath = {};
    state.musicFiles.forEach(function (f) { if (f.filePath) libraryByPath[f.filePath] = f; });
    files.forEach(function (f) { if (f.filePath) libraryByPath[f.filePath] = f; });
    state.musicFiles = Object.values(libraryByPath); await window.api.saveLibrary(state.musicFiles);
    importFolderBtn.innerHTML = '<i class="ph ph-check-circle"></i> Imported!'; importFolderBtn.style.background = 'transparent'; importFolderBtn.disabled = false;
    setTimeout(function () { importFolderBtn.innerHTML = '<i class="ph ph-folder-open"></i> Import Music Folder'; }, 3000);
    if (state.currentView === 'library') renderLibrary();
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
  state.musicFiles = Object.values(map);

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
    state.musicFiles = [];
    // NOTE: playlists are intentionally NOT wiped — tracks remain so they can re-link after re-import
    await window.api.saveLibrary(state.musicFiles);
    // Playlists are already saved in their own file and are NOT touched here
    renderLibrary();
    renderSidebarPlaylists();
  }
});

var importPl = $('import-playlist-btn');
if (importPl) importPl.addEventListener('click', async function () {
  var fp = await window.api.openFile(); if (!fp) return;
  var data = await window.api.parseCsv(fp);
  if (!data || data.length === 0) return;
  
  if (data[0].hasOwnProperty('Playlist') && data[0].Playlist) {
    // This is an app-exported multi-playlist CSV
    var groups = {};
    data.forEach(function(row) {
      var pName = row.Playlist || 'Imported Playlist';
      if (!groups[pName]) groups[pName] = [];
      groups[pName].push(row);
    });
    var count = 0;
    Object.keys(groups).forEach(function(pName) {
      // Check if playlist with same name already exists to avoid duplicates
      var existing = state.playlists.find(function(p) { return p.name === pName && !p.isSpecial; });
      if (existing) {
        // Merge tracks
        var existingKeys = new Set(existing.tracks.map(function(t) { return getPlaylistTrackFilePath(t) || ((t.Song||t.title||'').toLowerCase() + '|' + (t.Artist||t.artist||'').toLowerCase() + '|' + (t.Album||t.album||'').toLowerCase()); }));
        groups[pName].forEach(function(t) {
          var importKey = getPlaylistTrackFilePath(t) || ((t.Song||t.title||'').toLowerCase() + '|' + (t.Artist||t.artist||'').toLowerCase() + '|' + (t.Album||t.album||'').toLowerCase());
          if (!existingKeys.has(importKey)) {
            existing.tracks.push(t);
            existingKeys.add(importKey);
          }
        });
      } else {
        var pl = { id: 'pl_' + Date.now() + '_' + count, name: pName, cover: null, color: PALETTE[count % PALETTE.length], tracks: groups[pName], pinned: false, lastPlayed: null };
        state.playlists.push(pl);
      }
      count++;
    });
    await window.api.savePlaylists(state.playlists);
    renderSidebarPlaylists();
    alert('Imported ' + count + ' playlists successfully!');
  } else {
    // Standard single playlist CSV
    var name = fp.split(/[\\\/]/).pop().replace('.csv', '');
    var pl = { id: 'pl_' + Date.now(), name: name, cover: null, color: PALETTE[0], tracks: data, pinned: false, lastPlayed: null };
    state.playlists.push(pl); await window.api.savePlaylists(state.playlists);
    renderSidebarPlaylists(); switchView(pl.id);
  }
});

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
      var albumsMap = {};
      state.musicFiles.forEach(function (f) {
        var k = getAlbumKey(f);
        if (!albumsMap[k]) albumsMap[k] = { id: k, name: f.album || 'Unknown Album', artist: f.albumArtist || f.artist || 'Unknown Artist', cover: null, tracks: [] };
        if (!albumsMap[k].cover && f.picture) albumsMap[k].cover = f.picture;
        albumsMap[k].tracks.push(f);
      });
      if (albumsMap[albumId]) renderAlbumDetail(albumsMap[albumId]);
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
      var albumsMap = {};
      state.musicFiles.forEach(function (f) {
        var k = getAlbumKey(f);
        if (!albumsMap[k]) albumsMap[k] = { id: k, name: f.album || 'Unknown Album', artist: f.albumArtist || f.artist || 'Unknown Artist', cover: null, tracks: [] };
        if (!albumsMap[k].cover && f.picture) albumsMap[k].cover = f.picture;
        albumsMap[k].tracks.push(f);
      });
      if (albumsMap[albumId]) renderAlbumDetail(albumsMap[albumId]);
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
if (gSearch) gSearch.addEventListener('input', function (e) {
  clearTimeout(gSearchTimeout);
  gSearchTimeout = setTimeout(function () {
    var q = e.target.value.toLowerCase().trim();
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

    var searchTerms = q.split(/\s+/);

    // Build album map: match on album name, artist, albumArtist AND genre
    var matchedAlbums = {};
    var genreOnlyMatches = {}; // albums that match ONLY via genre
    state.musicFiles.forEach(function (f) {
      var albumStr = ((f.artist || '') + ' ' + (f.album || '') + ' ' + (f.albumArtist || '')).toLowerCase();
      var genreStr = (f.genre || '').toLowerCase();
      var matchesAlbum = searchTerms.every(function(term) { return albumStr.includes(term); });
      var matchesGenre = searchTerms.every(function(term) { return genreStr.includes(term); });
      var k = getAlbumKey(f);
      if (matchesAlbum || matchesGenre) {
        if (!matchedAlbums[k]) matchedAlbums[k] = { id: k, name: f.album || 'Unknown Album', artist: f.albumArtist || f.artist || 'Unknown Artist', cover: null, tracks: [], genre: f.genre || '' };
        if (!matchedAlbums[k].cover && f.picture) matchedAlbums[k].cover = f.picture;
        matchedAlbums[k].tracks.push(f);
        if (matchesGenre && !matchesAlbum) genreOnlyMatches[k] = true;
      }
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
        card.addEventListener('click', function () { pushNav('album:' + album.id); renderAlbumDetail(album); });
        aGrid.appendChild(card);
      });
    }

    // Track-level results: also match genre
    state.currentTracks = state.musicFiles.filter(function (f) { 
      var trackStr = ((f.title || '') + ' ' + (f.artist || '') + ' ' + (f.album || '') + ' ' + (f.genre || '')).toLowerCase();
      return searchTerms.every(function(term) { return trackStr.includes(term); });
    }).map(function (f) { return { matchedFile: f, title: f.title, artist: f.artist, album: f.album, duration: f.duration, isDisabled: false }; });

    // Only show tracks table if search is NOT genre-only (genre search = show albums, not a flat track list)
    var genreSearchOnly = albumKeys.length > 0 && albumKeys.every(function(k) { return genreOnlyMatches[k]; });
    $('view-title').textContent = genreSearchOnly ? 'Genre Search' : 'Search Results';
    if (genreSearchOnly) {
      $('tracks-table-container').style.display = 'none';
    } else {
      renderTracksTable(false);
    }
  }, 250);
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
if (togglePlBtn) togglePlBtn.addEventListener('click', function () {
  isPlaylistGridView = !isPlaylistGridView;
  appSettings.isPlaylistGridView = isPlaylistGridView;
  window.api.saveSettings(appSettings);
  renderSidebarPlaylists();
});

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



var btnSettings = $('btn-settings'); if (btnSettings) btnSettings.addEventListener('click', function () { showModal($('settings-modal')); });
var btnCloseSettings = $('btn-close-settings'); if (btnCloseSettings) btnCloseSettings.addEventListener('click', function () { hideModal($('settings-modal')); });
var btnExport = $('btn-export-data'); if (btnExport) btnExport.addEventListener('click', async function () { var ok = await window.api.exportCsv(state.playlists); if (ok) alert('Exported!'); });
var settMin = $('setting-minimize'); if (settMin) settMin.addEventListener('change', async function (e) { appSettings.minimizeToTray = e.target.checked; await window.api.saveSettings(appSettings); });
var settAudio = $('setting-audio-mode'); if (settAudio) settAudio.addEventListener('change', async function (e) { appSettings.audioMode = e.target.value; await window.api.saveSettings(appSettings); applyAudioMode(); });
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
  settCrossfade.addEventListener('input', async function (e) {
    appSettings.crossfade = e.target.value;
    var cv = $('crossfade-val'); if (cv) cv.textContent = e.target.value + 's';
    await window.api.saveSettings(appSettings);
  });
}
var settMasterGain = $('setting-master-gain');
if (settMasterGain) {
  settMasterGain.addEventListener('input', async function (e) {
    appSettings.masterGain = parseInt(e.target.value);
    var mgv = $('master-gain-val'); if (mgv) mgv.textContent = e.target.value + '%';
    if (typeof audioGainNode !== 'undefined' && audioGainNode) {
      audioGainNode.gain.value = appSettings.masterGain / 100.0;
    }
    await window.api.saveSettings(appSettings);
  });
}

var queueToggle = $('btn-queue-toggle'); if (queueToggle) queueToggle.addEventListener('click', toggleQueue);
var closeQueue = $('btn-close-queue'); if (closeQueue) closeQueue.addEventListener('click', function () { isQueueOpen = false; $('queue-panel').classList.remove('open'); });

var settNorm = $('setting-normalization');
if (settNorm) settNorm.addEventListener('change', async function (e) {
  appSettings.normalization = e.target.checked;
  await window.api.saveSettings(appSettings);
  if (audioCtx) updateAudioChain();
});

var settNotif = $('setting-notifications');
if (settNotif) settNotif.addEventListener('change', async function (e) {
  appSettings.notifications = e.target.checked;
  await window.api.saveSettings(appSettings);
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
  container.innerHTML = '';
  PALETTE.forEach(function(color) {
    var btn = document.createElement('div');
    btn.style.cssText = 'width:32px;height:32px;border-radius:50%;cursor:pointer;border:2px solid transparent;transition:transform 0.2s;background:' + color + ';';
    if (appSettings.accentColor === color || (!appSettings.accentColor && color === '#1DB954')) {
      btn.style.border = '2px solid white';
      btn.style.transform = 'scale(1.1)';
    }
    btn.onclick = async function() {
      appSettings.accentColor = color;
      applyAccentColor(color);
      await window.api.saveSettings(appSettings);
      initThemePicker(); // Refresh borders
    };
    container.appendChild(btn);
  });
}
initThemePicker();

var btnMultiSelect = $('btn-multi-select');
if (btnMultiSelect) btnMultiSelect.addEventListener('click', function () {
  if (typeof isMultiSelectMode === 'undefined') window.isMultiSelectMode = false;
  if (typeof selectedAlbumsForEdit === 'undefined') window.selectedAlbumsForEdit = new Set();
  isMultiSelectMode = !isMultiSelectMode;
  this.classList.toggle('active', isMultiSelectMode);
  this.style.color = isMultiSelectMode ? 'var(--accent)' : '';
  if (!isMultiSelectMode) {
    selectedAlbumsForEdit.clear();
    var meBtn = $('btn-multi-edit'); if (meBtn) meBtn.style.display = 'none';
    var mmBtn = $('btn-multi-merge'); if (mmBtn) mmBtn.style.display = 'none';
  }
  renderLibrary();
});

var btnMultiEdit = $('btn-multi-edit');
if (btnMultiEdit) btnMultiEdit.addEventListener('click', function () {
  if (typeof selectedAlbumsForEdit === 'undefined' || selectedAlbumsForEdit.size === 0) return;
  var allTracks = [];
  state.musicFiles.forEach(function (f) {
    var k = getAlbumKey(f);
    if (selectedAlbumsForEdit.has(k)) allTracks.push(f);
  });
  if (allTracks.length > 0) openMetadataEditor(allTracks);
});

var btnMultiMerge = $('btn-multi-merge');
if (btnMultiMerge) btnMultiMerge.addEventListener('click', async function () {
  if (!selectedAlbumsForEdit || selectedAlbumsForEdit.size < 2) return;
  var allTracks = [];
  state.musicFiles.forEach(function (f) { if (selectedAlbumsForEdit.has(getAlbumKey(f))) allTracks.push(f); });
  if (!allTracks.length) return;
  openMetadataEditor(allTracks);
  selectedAlbumsForEdit.clear();
  isMultiSelectMode = false;
  $('btn-multi-select').classList.remove('active');
  var meBtn = $('btn-multi-edit'); if (meBtn) meBtn.style.display = 'none';
  btnMultiMerge.style.display = 'none';
  renderLibrary();
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
  window.api.saveSettings(appSettings);
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
      window.api.saveSettings(appSettings);
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
  window.api.saveSettings(appSettings);
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
  var lc = $('lyrics-content'); if (!lc) return;
  var lines = lc.querySelectorAll('.lyric-line');
  lines.forEach(function (el, i) {
    el.classList.remove('active', 'passed');
    if (i < activeIdx) el.classList.add('passed');
    else if (i === activeIdx) el.classList.add('active');
  });
  // Auto-scroll to active line
  if (activeIdx >= 0 && lines[activeIdx]) {
    if (lc) {
      lc.scrollTo({ top: lines[activeIdx].offsetTop - (lc.clientHeight / 2) + (lines[activeIdx].clientHeight / 2), behavior: 'smooth' });
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
  var lc = $('lyrics-content');
  if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-spinner ph-spin" style="font-size:36px;color:var(--text-subdued);"></i><p style="color:var(--text-subdued);font-size:12px;margin-top:12px;">Searching lyrics...</p></div>';
  if (npOverlayOpen) mirrorLyricsToNP(); // Clear NP overlay lyrics

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
        if (npOverlayOpen) mirrorLyricsToNP();
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
        if (npOverlayOpen) mirrorLyricsToNP();
        return;
      }
    }
  } catch (e) { console.log('LRCLIB fetch error:', e); }

  // Final fallback: No lyrics found
  if (lyricsCurrentTrackKey === key) {
    lyricsData = [];
    if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-microphone-stage" style="font-size:48px;color:var(--text-disabled);margin-bottom:12px;"></i><p style="color:var(--text-subdued);font-size:13px;">Lyrics Not Found</p><p style="color:var(--text-disabled);font-size:11px;margin-top:4px;">Right-click here to search manually</p></div>';
    if (npOverlayOpen) mirrorLyricsToNP();
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
  await window.api.registerShortcuts(shortcuts);
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
    keyBtn.className = 'shortcut-key' + (sc.enabled ? '' : ' disabled-key');
    keyBtn.textContent = sc.accelerator || 'None';
    keyBtn.title = 'Click to rebind';
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
      keyBtn.className = 'shortcut-key' + (sc.enabled ? '' : ' disabled-key');
      await saveAndApplyShortcuts(shortcuts);
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
    window.api.registerShortcuts(getShortcuts());
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

// Wire Settings open to render shortcuts
var _origBtnSettings = $('btn-settings');
if (_origBtnSettings) {
  _origBtnSettings.addEventListener('click', function () {
    renderShortcutsList();
  });
}


/* --- NOW PLAYING OVERLAY --- */
var npOverlayOpen = false;
function applyNPLyricsVisibility() {
  var ov = document.getElementById('now-playing-overlay');
  var btn = document.getElementById('np-lyrics-toggle');
  var visible = appSettings.npLyricsVisible !== false;
  if (ov) ov.classList.toggle('np-lyrics-hidden', !visible);
  if (btn) {
    btn.title = visible ? 'Hide lyrics' : 'Show lyrics';
    btn.style.color = visible ? 'rgba(255,255,255,0.6)' : 'var(--accent)';
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
  if (!npOverlayOpen || !lyricsData.length) return;
  currentTime += lyricsOffsetSec;
  var activeIdx = -1;
  for (var i = 0; i < lyricsData.length; i++) {
    if (lyricsData[i].time <= currentTime) activeIdx = i;
    else break;
  }
  var npLc = document.getElementById('np-lyrics-content');
  if (!npLc) return;
  var lines = npLc.querySelectorAll('.lyric-line');
  lines.forEach(function (el, i) {
    el.classList.remove('active', 'passed');
    if (i < activeIdx) el.classList.add('passed');
    else if (i === activeIdx) { 
      el.classList.add('active'); 
      if (npLc) {
        npLc.scrollTo({ top: el.offsetTop - (npLc.clientHeight / 2) + (el.clientHeight / 2), behavior: 'smooth' });
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
      btnLfmConfirm.style.background = '#1DB954'; btnLfmConfirm.style.color = 'black';
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

var actxAnalyzeLoudness = $('actx-analyze-loudness');
if (actxAnalyzeLoudness) actxAnalyzeLoudness.addEventListener('click', function () {
  if (window.currentContextMenuAlbum) analyzeLoudnessForFiles(getSortedAlbumTracks(window.currentContextMenuAlbum));
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
      var albumsMap = {};
      state.musicFiles.forEach(function (m) {
        var k = getAlbumKey(m);
        if (!albumsMap[k]) albumsMap[k] = { id: k, name: m.album || 'Unknown Album', artist: m.albumArtist || m.artist || 'Unknown Artist', cover: null, tracks: [] };
        if (!albumsMap[k].cover && m.picture) albumsMap[k].cover = m.picture;
        albumsMap[k].tracks.push(m);
      });
      if (albumsMap[albumId]) renderAlbumDetail(albumsMap[albumId]);
      hideAllContextMenus();
    }
  }
});

var ctxOpenFolder = $('ctx-open-folder');
if (ctxOpenFolder) ctxOpenFolder.addEventListener('click', function () {
  if (currentContextMenuTrack && currentContextMenuTrack.matchedFile) {
    var fp = currentContextMenuTrack.matchedFile.filePath;
    if (fp && fp.startsWith('file:///')) fp = fp.replace('file:///', '').replace(/\//g, '\\');
    else if (fp && fp.startsWith('file://')) fp = fp.replace('file://', '');
    if (fp) {
      fp = decodeURIComponent(fp);
      if (window.api.showItemInFolder) window.api.showItemInFolder(fp);
    }
  }
  hideAllContextMenus();
});

var actxOpenFolder = $('actx-open-folder');
if (actxOpenFolder) actxOpenFolder.addEventListener('click', function () {
  if (currentContextMenuAlbum && currentContextMenuAlbum.tracks && currentContextMenuAlbum.tracks.length > 0) {
    var fp = currentContextMenuAlbum.tracks[0].filePath;
    if (fp && fp.startsWith('file:///')) fp = fp.replace('file:///', '').replace(/\//g, '\\');
    else if (fp && fp.startsWith('file://')) fp = fp.replace('file://', '');
    if (fp) {
      fp = decodeURIComponent(fp);
      if (window.api.showItemInFolder) window.api.showItemInFolder(fp);
    }
  }
  hideAllContextMenus();
});

var ctxRemoveMatch = $('ctx-remove-match');
if (ctxRemoveMatch) ctxRemoveMatch.addEventListener('click', async function () {
  if (currentContextMenuTrack) {
    var key = currentContextMenuTrack.title + '-' + currentContextMenuTrack.artist + '-' + (currentContextMenuTrack.album || '');
    state.mappings[key] = 'NO_MATCH';
    await window.api.saveMappings(state.mappings);
    if (state.currentView.startsWith('pl_')) renderPlaylist(state.currentView);
  }
  hideAllContextMenus();
});

// FIX 10+11: Add to playlist - exclude current playlist, check duplicates
function showAddToPlaylistModal(tracksToAdd) {
  var listEl = $('playlist-selector-list'); listEl.innerHTML = '';
  
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

  var playlists = state.playlists.filter(function (pl) { return pl.id !== state.currentView && !pl.isSpecial; });
  if (playlists.length === 0) { listEl.innerHTML = '<p style="padding:8px;color:var(--text-subdued);font-size:13px;">No other playlists available.</p>'; showModal($('playlist-selector-modal')); return; }
  
  playlists.forEach(function (pl) {
    var isSingleTrack = tracksToAdd.length === 1;
    var isDup = false;
    if (isSingleTrack) {
      isDup = pl.tracks && pl.tracks.some(function (t) { return samePlaylistTrack(t, tracksToAdd[0]); });
    }
    
    var el = document.createElement('div'); el.style.cssText = 'padding:8px;cursor:pointer;border-radius:4px;font-size:13px;display:flex;align-items:center;gap:10px;';
    var autoCover = getAutoCoverForPlaylist(pl);
    var lazy = appSettings.lazyLoading ? ' loading="lazy"' : '';
    var bgStyle = pl.color ? 'background:' + pl.color + ';' : 'background:#555;';
    var covHtml = autoCover ? '<img src="' + esc(autoCover) + '"' + lazy + ' style="width:24px;height:24px;border-radius:4px;object-fit:cover;flex-shrink:0;">' : '<div style="width:24px;height:24px;border-radius:4px;' + bgStyle + 'display:flex;align-items:center;justify-content:center;flex-shrink:0;"></div>';
    
    var checkHtml = isDup ? '<i class="ph-fill ph-check-circle" style="color:var(--accent);margin-left:auto;font-size:16px;"></i>' : '';
    
    el.innerHTML = covHtml + '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + esc(pl.name) + '</span>' + checkHtml;
    
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
          await window.api.savePlaylists(state.playlists);
          renderSidebarPlaylists();
        } else if (!isSingleTrack) {
          alert('All tracks are already in "' + pl.name + '".');
        }
        hideModal($('playlist-selector-modal'));
      });
    }
    listEl.appendChild(el);
  });
  showModal($('playlist-selector-modal'));
}

var ctxAdd = $('ctx-add-playlist');
if (ctxAdd) ctxAdd.addEventListener('click', function () {
  if (currentContextMenuTrack) showAddToPlaylistModal([currentContextMenuTrack]);
});

var actxAdd = $('actx-add-playlist');
if (actxAdd) actxAdd.addEventListener('click', function () {
  if (currentContextMenuAlbum && currentContextMenuAlbum.tracks) {
    var tracks = getSortedAlbumTracks(currentContextMenuAlbum).map(function (f) { return { title: f.title, artist: f.artist, album: f.album, filePath: f.filePath, matchedFile: f }; });
    showAddToPlaylistModal(tracks);
  }
});
var ctxRemove = $('ctx-remove-playlist');
if (ctxRemove) ctxRemove.addEventListener('click', async function () {
  if (!currentContextMenuTrack) return;
  var pl = state.playlists.find(function (p) { return p.id === state.currentView; });
  if (pl && currentContextMenuTrack.csvRecord) { pl.tracks = pl.tracks.filter(function (t) { return t !== currentContextMenuTrack.csvRecord; }); await window.api.savePlaylists(state.playlists); renderPlaylist(state.currentView); }
  else alert('Open a playlist to remove tracks.');
});
var ctxMatch = $('ctx-manual-match');
if (ctxMatch) ctxMatch.addEventListener('click', async function () {
  var af = await window.api.openAudio();
  if (af && currentContextMenuTrack) {
    var key = currentContextMenuTrack.title + '-' + currentContextMenuTrack.artist + '-' + (currentContextMenuTrack.album || '');
    state.mappings[key] = af;
    if (currentContextMenuTrack.csvRecord) currentContextMenuTrack.csvRecord.FilePath = af;
    await window.api.saveMappings(state.mappings);
    if (currentContextMenuTrack.csvRecord) await window.api.savePlaylists(state.playlists);
    renderPlaylist(state.currentView);
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
  var finish = async function () { span.contentEditable = 'false'; span.style.outline = ''; var n = span.textContent.trim(); if (n && n !== original) { pl.name = n; await window.api.savePlaylists(state.playlists); renderSidebarPlaylists(); } else span.textContent = original; };
  span.addEventListener('blur', finish, { once: true });
  span.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); span.blur(); } if (e.key === 'Escape') { span.textContent = original; span.blur(); } });
});
var pctxCover = $('pctx-cover');
if (pctxCover) pctxCover.addEventListener('click', async function () { var pl = currentContextMenuPlaylist; if (!pl) return; var img = await window.api.openImage(); if (img) { pl.cover = img; await window.api.savePlaylists(state.playlists); renderSidebarPlaylists(); if (state.currentView === pl.id) renderPlaylist(pl.id); } });
var pctxColor = $('pctx-color');
if (pctxColor) pctxColor.addEventListener('click', function () {
  var pl = currentContextMenuPlaylist; if (!pl) return;
  var sw = $('color-picker-swatches'); sw.innerHTML = '';
  PALETTE.forEach(function (color) { var s = document.createElement('div'); s.className = 'color-swatch' + (color === pl.color ? ' selected' : ''); s.style.background = color; s.addEventListener('click', async function () { pl.color = color; await window.api.savePlaylists(state.playlists); hideModal($('color-picker-modal')); renderSidebarPlaylists(); }); sw.appendChild(s); });
  showModal($('color-picker-modal'));
});
var closeColor = $('btn-close-color-picker'); if (closeColor) closeColor.addEventListener('click', function () { hideModal($('color-picker-modal')); });
var colorModal = $('color-picker-modal'); if (colorModal) colorModal.addEventListener('click', function (e) { if (e.target === colorModal) hideModal(colorModal); });
var pctxPin = $('pctx-pin');
if (pctxPin) pctxPin.addEventListener('click', async function () {
  var pl = currentContextMenuPlaylist; if (!pl) return;
  if (!pl.pinned && state.playlists.filter(function (p) { return p.pinned; }).length >= 4) { alert('Max 4 pinned playlists.'); return; }
  pl.pinned = !pl.pinned; await window.api.savePlaylists(state.playlists); renderSidebarPlaylists();
});
var pctxDup = $('pctx-duplicate');
if (pctxDup) pctxDup.addEventListener('click', async function () { var pl = currentContextMenuPlaylist; if (!pl) return; var copy = Object.assign({}, JSON.parse(JSON.stringify(pl)), { id: 'pl_' + Date.now(), name: pl.name + ' (Copy)', pinned: false, lastPlayed: null }); state.playlists.push(copy); await window.api.savePlaylists(state.playlists); renderSidebarPlaylists(); });
var pctxExport = $('pctx-export');
if (pctxExport) pctxExport.addEventListener('click', async function () { var pl = currentContextMenuPlaylist; if (!pl) return; await window.api.exportCsv([pl]); });

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
  }
});

var pctxMatchFolder = $('pctx-match-folder');
if (pctxMatchFolder) pctxMatchFolder.addEventListener('click', async function () {
  var pl = currentContextMenuPlaylist; if (!pl || !pl.tracks) return;
  var folderPath = await window.api.openFolder(); if (!folderPath) return;
  document.body.style.cursor = 'wait';
  try {
    var tempFiles = await window.api.scanFolder(folderPath, []);
    var updated = 0;
    for (var i = 0; i < pl.tracks.length; i++) {
      var r = pl.tracks[i];
      var sn = r.Song || r.title || '', an = r.Artist || r.artist || '';
      for (var j = 0; j < tempFiles.length; j++) {
        var f = tempFiles[j];
        if ((fuzzyMatch(f.title, sn) && (!an || fuzzyMatch(f.artist, an))) || fuzzyMatch(f.filename.replace(/\.[^.]+$/, ''), sn)) {
          var key = sn + '-' + an + '-' + (r.Album || r.album || f.album || '');
          state.mappings[key] = f.filePath;
          r.FilePath = f.filePath;
          if (f.album) r.Album = f.album;
          if (!state.musicFiles.find(function(x){ return x.filePath === f.filePath; })) {
            state.musicFiles.push(f);
          }
          updated++;
          break;
        }
      }
    }
    if (updated > 0) {
      await window.api.saveLibrary(state.musicFiles);
      await window.api.saveMappings(state.mappings);
      if (state.currentView === pl.id) renderPlaylist(pl.id);
    }
  } catch(e) { console.error(e); }
  document.body.style.cursor = 'default';
});
var pctxDelete = $('pctx-delete');
if (pctxDelete) pctxDelete.addEventListener('click', function () { playlistToDelete = currentContextMenuPlaylist; showModal($('delete-confirm-modal')); });
var delCancel = $('delete-cancel-btn'); if (delCancel) delCancel.addEventListener('click', function () { playlistToDelete = null; hideModal($('delete-confirm-modal')); });
var delConfirm = $('delete-confirm-btn');
if (delConfirm) delConfirm.addEventListener('click', async function () {
  if (!playlistToDelete) return;
  state.playlists = state.playlists.filter(function (p) { return p.id !== playlistToDelete.id; });
  await window.api.savePlaylists(state.playlists); hideModal($('delete-confirm-modal'));
  renderSidebarPlaylists(); if (state.currentView === playlistToDelete.id) switchView('library'); playlistToDelete = null;
});
var delModal = $('delete-confirm-modal'); if (delModal) delModal.addEventListener('click', function (e) { if (e.target === delModal) hideModal(delModal); });

var btnPlay = $('btn-play'); if (btnPlay) btnPlay.addEventListener('click', togglePlay);
var btnShuffle = $('btn-shuffle'); if (btnShuffle) btnShuffle.addEventListener('click', toggleShuffle);
var btnLoop = $('btn-loop'); if (btnLoop) btnLoop.addEventListener('click', cycleLoop);
var btnNext = $('btn-next'); if (btnNext) btnNext.addEventListener('click', function () { initAudioCtx(); playNextTrack(); });
var btnPrev = $('btn-prev'); if (btnPrev) btnPrev.addEventListener('click', function () { initAudioCtx(); playPrevTrack(); });
var btnMiniPlayer = $('btn-mini-player');
if (btnMiniPlayer) btnMiniPlayer.addEventListener('click', function () { var mini = $('mini-player'); if (!mini) return; mini.classList.toggle('open'); updateMiniPlayer(); });
var miniPlay = $('mini-play'); if (miniPlay) miniPlay.addEventListener('click', function () { initAudioCtx(); togglePlay(); updateMiniPlayer(); });
var miniPrev = $('mini-prev'); if (miniPrev) miniPrev.addEventListener('click', function () { initAudioCtx(); playPrevTrack(); });
var miniNext = $('mini-next'); if (miniNext) miniNext.addEventListener('click', function () { initAudioCtx(); playNextTrack(); });
var miniClose = $('mini-close'); if (miniClose) miniClose.addEventListener('click', function () { var mini = $('mini-player'); if (mini) mini.classList.remove('open'); });
var miniMinimize = $('mini-minimize'); if (miniMinimize) miniMinimize.addEventListener('click', function () { var mini = $('mini-player'); if (mini) mini.classList.remove('open'); });
var miniQueue = $('mini-queue'); if (miniQueue) miniQueue.addEventListener('click', toggleQueue);
var miniSearch = $('mini-search'); if (miniSearch) miniSearch.addEventListener('click', function () { var gs = $('global-search'); if (gs) gs.focus(); });
var miniProgress = $('mini-progress-container');
if (miniProgress) miniProgress.addEventListener('mousedown', function (e) {
  var a = audioEls[activeAudioIdx];
  if (!state.currentPlayingTrack || !a || isNaN(a.duration)) return;
  var r = miniProgress.getBoundingClientRect();
  a.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.duration;
  updateMiniProgress();
});

/* ─── METADATA EDITOR LOGIC ─── */
let metaTargetFiles = [];
let metaCoverPath = null;
let metaProposedData = null;

function stripFileUrl(url) { return fromFileUrl(url); }

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
  files = metaTargetFiles;
  metaCoverPath = null;
  metaProposedData = null;

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
  $('meta-cover-preview').src = files[0].picture || '';
  $('meta-cover-preview').style.display = files[0].picture ? 'block' : 'none';

  // Pre-fill search query for auto-tag tab
  var q = files.length === 1 ? (files[0].artist + ' ' + files[0].title) : (files[0].artist + ' ' + files[0].album);
  var sq = $('meta-search-query'); if (sq) sq.value = q;

  $('meta-tab-manual').click();
  $('meta-modal-title').textContent = files.length === 1 ? 'Edit Track Metadata' : 'Edit Album Metadata (' + files.length + ' tracks)';
  showModal($('metadata-modal'));
}

$('meta-cancel-btn').addEventListener('click', function () { hideModal($('metadata-modal')); });
$('meta-save-btn').addEventListener('click', async function () {
  var btn = $('meta-save-btn');
  var isManual = $('meta-tab-manual').classList.contains('active');
  function failMetadataSave(message) {
    var progress = $('meta-save-progress');
    if (progress) progress.remove();
    btn.style.display = '';
    btn.textContent = 'Save';
    btn.disabled = false;
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

  if (isManual) {
    var tags = {};
    if ($('meta-title').value && $('meta-title').value !== '<Multiple Tracks>') tags.title = $('meta-title').value;
    if ($('meta-artist').value) tags.artist = $('meta-artist').value;
    if ($('meta-album-artist').value) tags.performerInfo = $('meta-album-artist').value;
    if ($('meta-album').value) tags.album = $('meta-album').value;
    if ($('meta-year').value) tags.year = $('meta-year').value;
    if ($('meta-genre').value) tags.genre = $('meta-genre').value;
    if (metaCoverPath) tags.image = stripFileUrl(metaCoverPath);

    var tagsForThisFile = Object.assign({}, tags);
    var saveFolderJpg = $('meta-save-folder-jpg') ? $('meta-save-folder-jpg').checked : false;

    var progressContainer = document.createElement('div');
    progressContainer.id = 'meta-save-progress';
    progressContainer.innerHTML = '<div id="meta-save-text" style="font-size:12px;margin-bottom:4px;color:var(--text-subdued);">Saving 0/' + metaTargetFiles.length + '...</div><div style="width:100%;height:4px;background:#333;border-radius:2px;overflow:hidden;"><div id="meta-save-bar" style="width:0%;height:100%;background:var(--accent);transition:width 0.1s;"></div></div>';
    btn.parentNode.insertBefore(progressContainer, btn);
    btn.style.display = 'none';

    for (var i = 0; i < metaTargetFiles.length; i++) {
      var f = metaTargetFiles[i];
      var fp = stripFileUrl(f.filePath);
      $('meta-save-text').textContent = 'Saving ' + (i + 1) + '/' + metaTargetFiles.length + ': ' + (f.filename || f.title || fp) + '...';
      var saved = await window.api.saveMetadata([fp], tagsForThisFile, saveFolderJpg);
      if (saved !== true) { failMetadataSave('Failed to save metadata for: ' + (f.filename || f.title || fp) + (metadataSaveError(saved) ? '\n\n' + metadataSaveError(saved) : '')); return; }
      if (tags.title && metaTargetFiles.length === 1) f.title = tags.title;
      if (tags.artist) f.artist = tags.artist;
      if (tags.performerInfo) f.albumArtist = tags.performerInfo;
      if (tags.album) f.album = tags.album;
      if (tags.year) f.year = tags.year;
      if (tags.genre) f.genre = tags.genre;
      if (tags.image) f.picture = toFileUrl(tags.image);

      var pct = Math.round(((i + 1) / metaTargetFiles.length) * 100);
      $('meta-save-bar').style.width = pct + '%';
      $('meta-save-text').textContent = 'Saved ' + (i + 1) + '/' + metaTargetFiles.length + ': ' + (f.filename || f.title || fp);
    }
    await window.api.saveLibrary(state.musicFiles);

  } else {
    if (!metaProposedData || !metaProposedData.tags) { btn.textContent = 'Save'; btn.disabled = false; return alert("Select a MusicBrainz result first."); }

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
    var chkTitles = $('at-chk-track-titles') ? $('at-chk-track-titles').checked : true;
    var chkNums = $('at-chk-track-numbers') ? $('at-chk-track-numbers').checked : true;
    var saveFolderJpgAuto = $('meta-save-folder-jpg') ? $('meta-save-folder-jpg').checked : false;

    for (var i = 0; i < metaTargetFiles.length; i++) {
      var fp = stripFileUrl(metaTargetFiles[i].filePath);
      var f = metaTargetFiles[i];
      var t = {};
      if (chkArtist && metaProposedData.tags.artist) t.artist = metaProposedData.tags.artist;
      if (chkAlbArtist && metaProposedData.tags.performerInfo) t.performerInfo = metaProposedData.tags.performerInfo;
      if (chkAlbum && metaProposedData.tags.album) t.album = metaProposedData.tags.album;
      if (chkYear && metaProposedData.tags.year) t.year = metaProposedData.tags.year;
      if (chkGenre && metaProposedData.tags.genre) t.genre = metaProposedData.tags.genre;
      if (chkTitles && metaTargetFiles.length > 1 && metaProposedData.tracks[i]) t.title = metaProposedData.tracks[i].title;
      if (chkNums && metaProposedData.tracks[i]) t.trackNumber = metaProposedData.tracks[i].trackNum;
      if (chkNums && metaProposedData.tracks[i] && metaProposedData.tracks[i].discNum) {
        t.discNumber = metaProposedData.tracks[i].discNum;
        t.partOfSet = metaProposedData.tracks[i].discTotal && metaProposedData.tracks[i].discTotal > 1 ? (metaProposedData.tracks[i].discNum + '/' + metaProposedData.tracks[i].discTotal) : metaProposedData.tracks[i].discNum;
      }
      if (metaProposedData.coverUrl) t.image = metaProposedData.coverUrl;

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
      if (t.discNumber) f.discNo = parseInt(t.discNumber, 10) || f.discNo;
      if (t.partOfSet && String(t.partOfSet).indexOf('/') !== -1) f.discTotal = parseInt(String(t.partOfSet).split('/')[1], 10) || f.discTotal;
      if (t.image) f.picture = /^https:\/\//i.test(t.image) ? t.image : toFileUrl(t.image);

      var pct = Math.round(((i + 1) / metaTargetFiles.length) * 100);
      $('meta-save-bar').style.width = pct + '%';
      $('meta-save-text').textContent = 'Saved ' + (i + 1) + '/' + metaTargetFiles.length + ': ' + (f.filename || f.title || fp);
    }
    await window.api.saveLibrary(state.musicFiles);
    if (saveFolderJpgAuto && metaProposedData.coverUrl && window.api.saveFolderCovers) {
      $('meta-save-text').textContent = 'Writing folder.jpg files...';
      await window.api.saveFolderCovers(metaTargetFiles);
    }
  }

  if ($('meta-save-progress')) $('meta-save-progress').remove();
  btn.style.display = '';
  btn.textContent = 'Saved!';
  setTimeout(function () {
    btn.textContent = 'Save'; btn.disabled = false; hideModal($('metadata-modal'));
    if (state.currentView === 'library') renderLibrary();
    else switchView('library', false);

    if (isMultiSelectMode) {
      isMultiSelectMode = false;
      selectedAlbumsForEdit.clear();
      $('btn-multi-select').classList.remove('active');
      $('btn-multi-select').style.color = '';
      var meBtn = $('btn-multi-edit'); if (meBtn) meBtn.style.display = 'none';
      renderLibrary();
    }
  }, 1000);
});

$('meta-search-btn').addEventListener('click', async function () {
  var q = $('meta-search-query').value.trim(); if (!q) return;
  $('meta-search-btn').innerHTML = '<i class="ph ph-spinner ph-spin"></i> Searching...';
  var results = await window.api.searchMusicBrainz(q);
  $('meta-search-btn').innerHTML = '<i class="ph ph-magnifying-glass"></i> Search MusicBrainz';
  var resDiv = $('meta-search-results'); resDiv.innerHTML = '';
  if (!results.length) { resDiv.style.display = 'block'; resDiv.innerHTML = '<div style="padding:12px;color:var(--text-subdued);">No results found.</div>'; return; }

  results.forEach(function (r) {
    var el = document.createElement('div');
    var yearStr = r.date ? r.date.substring(0, 4) : '';
    var artistStr = r['artist-credit'] ? r['artist-credit'].map(function(a){return a.name||(a.artist&&a.artist.name)||'';}).join(', ') : 'Unknown';
    el.style.cssText = 'padding:10px 12px;border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer;font-size:12px;';
    el.innerHTML = '<div style="font-weight:600;color:white;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(r.title) + '</div>' +
      '<div style="color:rgba(255,255,255,0.5);margin-top:2px;display:flex;justify-content:space-between;">' +
        '<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:150px;">' + esc(artistStr) + '</span>' +
        '<span style="flex-shrink:0;color:rgba(255,255,255,0.3);">' + esc(yearStr) + '</span>' +
      '</div>';
    el.onmouseenter = function () { el.style.background = 'rgba(255,255,255,0.08)'; };
    el.onmouseleave = function () { el.style.background = el._selected ? 'rgba(var(--accent-rgb,29,185,84),0.12)' : ''; };
    el.onclick = async function () {
      // Deselect all
      $('meta-search-results').querySelectorAll('div').forEach(function(d) { d._selected = false; d.style.background = ''; });
      el._selected = true; el.style.background = 'rgba(29,185,84,0.12)';
      el.innerHTML = '<div style="display:flex;align-items:center;gap:6px;"><i class="ph ph-spinner ph-spin" style="font-size:14px;color:var(--accent);"></i>' + el.innerHTML + '</div>';
      var details = await window.api.getMusicBrainzRelease(r.id);
      el.innerHTML = el.innerHTML.replace(/<div style="display:flex.*?<\/i>/, '').replace('</div>', '');
      if (!details) return;
      showMetaCompare(details);
    };
    resDiv.appendChild(el);
  });
  resDiv.style.display = 'block';
});

function showMetaCompare(mbData) {
  var artist = mbData['artist-credit'] ? mbData['artist-credit'].map(function(a){return a.name||(a.artist&&a.artist.name)||'';}).join(', ') : '';
  var year = mbData.date ? mbData.date.substring(0, 4) : '';
  var title = mbData.title || '';
  var tracks = [];
  if (mbData.media) {
    mbData.media.forEach(function(m, mediaIdx) {
      var discNum = m.position || (mediaIdx + 1);
      var discTotal = mbData.media.length;
      if (m.tracks) m.tracks.forEach(function(t, i) { tracks.push({ title: t.title, trackNum: t.position || (i+1), discNum: discNum, discTotal: discTotal, length: t.length }); });
    });
  }

  // Update field preview values
  var setVal = function(id, val) { var el = $(id); if (el) el.textContent = val || ''; };
  setVal('at-val-artist', artist);
  setVal('at-val-album-artist', artist);
  setVal('at-val-album', title);
  setVal('at-val-year', year);
  setVal('at-val-genre', mbData.genres && mbData.genres[0] ? mbData.genres[0].name : '');

  // Cover from CAA
  var coverUrl = 'https://coverartarchive.org/release/' + mbData.id + '/front-500';
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
  if (cnt) cnt.textContent = '(' + tracks.length + ' MusicBrainz / ' + metaTargetFiles.length + ' local)';
  if (tbl) {
    tbl.innerHTML = '';
    // Header
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:grid;grid-template-columns:28px 1fr 1fr;gap:0;position:sticky;top:0;background:#1e1e1e;border-bottom:1px solid rgba(255,255,255,0.1);';
    hdr.innerHTML = '<div style="padding:6px 4px;font-size:10px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;">#</div>' +
      '<div style="padding:6px 8px;font-size:10px;font-weight:700;color:rgba(255,255,255,0.3);text-transform:uppercase;border-left:1px solid rgba(255,255,255,0.05);">Local File</div>' +
      '<div style="padding:6px 8px;font-size:10px;font-weight:700;color:var(--accent);text-transform:uppercase;border-left:1px solid rgba(255,255,255,0.05);">MusicBrainz</div>';
    tbl.appendChild(hdr);

    var maxRows = Math.max(tracks.length, metaTargetFiles.length);
    for (var i = 0; i < maxRows; i++) {
      var localF = metaTargetFiles[i];
      var mbTrack = tracks[i];
      var matched = localF && mbTrack;
      var titleMatch = matched && localF.title && mbTrack.title && localF.title.toLowerCase().trim() === mbTrack.title.toLowerCase().trim();
      var row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:28px 1fr 1fr;border-bottom:1px solid rgba(255,255,255,0.04);';
      var numStr = mbTrack && mbTrack.discNum && mbData.media && mbData.media.length > 1 ? (mbTrack.discNum + '.' + mbTrack.trackNum) : ((i + 1) + '');
      var localTitle = localF ? esc(localF.title || localF.filename || '?') : '<span style="color:rgba(255,255,255,0.2);">—</span>';
      var mbTitle = mbTrack ? esc(mbTrack.title) : '<span style="color:rgba(255,255,255,0.2);">—</span>';
      var matchIcon = matched ? (titleMatch ? '<i class="ph ph-check" style="color:#1DB954;font-size:11px;margin-left:4px;"></i>' : '<i class="ph ph-warning" style="color:#FF9800;font-size:11px;margin-left:4px;"></i>') : '';
      row.innerHTML = '<div style="padding:6px 4px;font-size:11px;color:rgba(255,255,255,0.3);text-align:center;">' + numStr + '</div>' +
        '<div style="padding:6px 8px;font-size:11px;color:rgba(255,255,255,0.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-left:1px solid rgba(255,255,255,0.04);">' + localTitle + matchIcon + '</div>' +
        '<div style="padding:6px 8px;font-size:11px;color:' + (titleMatch ? '#1DB954' : 'rgba(255,255,255,0.9)') + ';white-space:nowrap;overflow:hidden;text-overflow:ellipsis;border-left:1px solid rgba(255,255,255,0.04);">' + mbTitle + '</div>';
      tbl.appendChild(row);
    }
  }

  metaProposedData = {
    tags: { artist: artist, album: title, year: year, performerInfo: artist, genre: mbData.genres && mbData.genres[0] ? mbData.genres[0].name : '' },
    tracks: tracks,
    coverUrl: coverUrl
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
    $('time-current').textContent = fmt(audioEl.currentTime);
    updateMiniProgress();
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
    window.api.saveSettings(appSettings);
  });
  function updateVol(e) {
    var r = vc.getBoundingClientRect();
    var v = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    audioEls.forEach(a => a.volume = v);
    $('volume-bar').style.width = (v * 100) + '%';
    appSettings.volume = v;
    clearTimeout(volumeSaveTimer);
    volumeSaveTimer = setTimeout(function () { window.api.saveSettings(appSettings); }, 150);
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
  // Insert key → Rescan Folder (add only NEW songs from imported folders)
  if (e.code === 'Insert') { e.preventDefault(); doRescanFolder(); }
});



async function initApp() {
  var results = await Promise.all([window.api.loadLibrary(), window.api.loadPlaylists(), window.api.loadMappings(), window.api.loadSettings()]);
  if (results[0]) state.musicFiles = results[0];
  if (results[1]) state.playlists = results[1];
  if (results[2]) state.mappings = results[2];
  // Back-fill year/genre for existing library files (runs in background)
  if (state.musicFiles.length > 0 && window.api.backfillMetadata) {
    window.api.backfillMetadata(state.musicFiles).then(function (updated) {
      state.musicFiles = updated;
    });
  }
  if (results[3]) {
    appSettings = Object.assign({}, appSettings, results[3]);
    if (appSettings.lastPlayed) { playQueueTracks = state.musicFiles; var t = state.musicFiles.find(function (f) { return f.filePath === appSettings.lastPlayed.path; }); if (t) { state.currentPlayingTrack = t; renderQueue(); } }
    try {
      if (appSettings.sidebarWidth) $('sidebar').style.width = appSettings.sidebarWidth + 'px';
      if (appSettings.isPlaylistGridView !== undefined) isPlaylistGridView = appSettings.isPlaylistGridView;
    } catch (e) { }
    if (appSettings.sortAscending === undefined) appSettings.sortAscending = true;
    var sortDirBtn = $('playlist-sort-dir-btn'); if (sortDirBtn) sortDirBtn.innerHTML = appSettings.sortAscending ? '<i class="ph ph-sort-ascending"></i>' : '<i class="ph ph-sort-descending"></i>';
    var sm = $('setting-minimize'); if (sm) sm.checked = appSettings.minimizeToTray;
    var sa = $('setting-audio-mode'); if (sa) sa.value = appSettings.audioMode;
    var sd = $('setting-discord-rpc'); if (sd) sd.checked = !!appSettings.discordRpc;
    var sn = $('setting-normalization'); if (sn) sn.checked = !!appSettings.normalization;
    var snot = $('setting-notifications'); if (snot) snot.checked = appSettings.notifications !== false;
    var svs = $('setting-virtual-scrolling'); if (svs) svs.checked = !!appSettings.virtualScrolling;
    var sll = $('setting-lazy-loading'); if (sll) sll.checked = !!appSettings.lazyLoading;
    
    applyAccentColor(appSettings.accentColor || '#1DB954');
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
        var fileMap = {};
        state.musicFiles.forEach(function(f) { fileMap[f.filePath] = f; });
        state.playQueueTracks = appSettings.savedQueue
          .map(function(fp) {
            var f = fileMap[fp];
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
  if (state.musicFiles.length > 0 && window.api.saveFolderCovers && appSettings.folderCoversBackfilledVersion !== 2) {
    writeCurrentFolderCovers(false).then(function () {
      appSettings.folderCoversBackfilledVersion = 2;
      window.api.saveSettings(appSettings);
    }).catch(function (e) { console.error('folder.jpg backfill failed:', e); });
  }
  updateLastfmIcon();
  buildColorPickers();
  if (window.api.onThumbarAction) {
    window.api.onThumbarAction(function (action) {
      if (action === 'playpause') { initAudioCtx(); togglePlay(); }
      else if (action === 'prev') { initAudioCtx(); playPrevTrack(); }
      else if (action === 'next') { initAudioCtx(); playNextTrack(); }
      else if (action === 'shuffle') toggleShuffle();
      else if (action === 'loop') cycleLoop();
      else if (action === 'queue') toggleQueue();
    });
  }
  if (window.api.updateThumbar) window.api.updateThumbar(false);
  // Apply saved shortcuts
  var _initShortcuts = getShortcuts();
  window.api.registerShortcuts(_initShortcuts);
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
        h.matchedFile = state.musicFiles.find(function (f) { return f.title === h.title && f.artist === h.artist; }) || null;
      }
      var key = (h.title || '') + '::' + (h.artist || '');
      if (!seen.has(key)) { seen.add(key); tracks.push({ title: h.title, artist: h.artist, album: h.album, duration: h.duration, matchedFile: h.matchedFile }); }
    }
  } else if (rule.field === 'liked') {
    state.musicFiles.filter(function (f) { return state.likedSongs.includes(f.filePath); })
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
    window.api.saveSettings(appSettings);
  }
}

function renderStatsView() {
  var container = $('stats-container');
  if (!container) return;
  [$('home-dashboard-container'),$('albums-grid-container'),$('tracks-table-container'),$('search-albums-container')].forEach(function(el){if(el)el.style.display='none';});
  container.style.display = 'block';
  var counts = appSettings.playCounts || {};
  var times = appSettings.playTimes || {};
  var trackEntries = Object.keys(counts).map(function(fp) {
    var f = state.musicFiles.find(function(m){return m.filePath===fp;});
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
  [{label:'Total Plays',val:totalPlays,color:'#1DB954',icon:'ph-play'},{label:'Listening Time',val:totalHrs+'h '+totalMins+'m',color:'#2196F3',icon:'ph-clock'},{label:'Unique Tracks',val:trackEntries.length,color:'#E91E63',icon:'ph-music-notes'},{label:'Artists',val:Object.keys(artistCounts).length,color:'#9C27B0',icon:'ph-microphone'}].forEach(function(c){
    html+='<div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.07);border-top:3px solid '+c.color+';border-radius:12px;padding:16px;"><i class="ph '+c.icon+'" style="font-size:22px;color:'+c.color+';margin-bottom:8px;display:block;"></i><div style="font-size:22px;font-weight:800;color:white;margin-bottom:4px;">'+c.val+'</div><div style="font-size:11px;color:rgba(255,255,255,0.4);text-transform:uppercase;letter-spacing:0.5px;">'+c.label+'</div></div>';
  });
  html += '</div>';
  if (trackEntries.length===0) { html+='<div style="text-align:center;padding:80px;color:rgba(255,255,255,0.2);"><i class="ph ph-chart-bar" style="font-size:56px;display:block;margin-bottom:16px;"></i><div>No stats yet — start listening!</div></div>'; container.innerHTML=html; return; }
  html += '<div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;">';
  // Top Tracks
  html += '<div><h2 style="font-size:16px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px;"><i class="ph ph-fire" style="color:#FF9800;"></i> Top Tracks</h2>';
  trackEntries.slice(0,10).forEach(function(e,i){
    var pct=Math.round((e.count/maxCount)*100);
    var cover=e.file.picture?'<img src="'+esc(e.file.picture)+'" style="width:34px;height:34px;border-radius:5px;object-fit:cover;flex-shrink:0;">':'<div style="width:34px;height:34px;border-radius:5px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;flex-shrink:0;"><i class="ph ph-music-notes" style="font-size:12px;color:rgba(255,255,255,0.3);"></i></div>';
    html+='<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><div style="font-size:11px;color:rgba(255,255,255,0.25);width:14px;text-align:right;flex-shrink:0;">'+(i+1)+'</div>'+cover+'<div style="flex:1;min-width:0;"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(e.file.title||'Unknown')+'</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">'+esc(e.file.artist||'Unknown')+'</div><div style="margin-top:3px;height:2px;background:rgba(255,255,255,0.07);border-radius:1px;"><div style="height:100%;width:'+pct+'%;background:var(--accent);border-radius:1px;"></div></div></div><div style="font-size:12px;font-weight:700;color:var(--accent);">x'+e.count+'</div></div>';
  });
  html += '</div>';
  // Artists + Albums
  html += '<div>';
  html += '<h2 style="font-size:16px;font-weight:700;margin-bottom:14px;display:flex;align-items:center;gap:8px;"><i class="ph ph-microphone" style="color:#E91E63;"></i> Top Artists</h2>';
  topArtists.forEach(function(a){
    var pct=Math.round((a.count/maxArtist)*100);
    html+='<div style="padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:5px;"><div style="font-size:13px;font-weight:600;">'+esc(a.name)+'</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">'+a.count+' plays</div></div><div style="height:3px;background:rgba(255,255,255,0.07);border-radius:2px;"><div style="height:100%;width:'+pct+'%;background:linear-gradient(90deg,#E91E63,#FF4081);border-radius:2px;"></div></div></div>';
  });
  html += '<h2 style="font-size:16px;font-weight:700;margin-top:24px;margin-bottom:14px;display:flex;align-items:center;gap:8px;"><i class="ph ph-vinyl-record" style="color:#2196F3;"></i> Top Albums</h2>';
  topAlbums.forEach(function(a){
    html+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);"><div style="min-width:0;"><div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">'+esc(a.name)+'</div><div style="font-size:11px;color:rgba(255,255,255,0.4);">'+esc(a.artist)+'</div></div><div style="font-size:12px;font-weight:700;color:#2196F3;margin-left:8px;">x'+a.count+'</div></div>';
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

// Playlist track search logic
var trackSearchInput = $('playlist-track-search');
if (trackSearchInput) {
  trackSearchInput.addEventListener('input', debounce(function (e) {
    var query = e.target.value.toLowerCase();
    var rows = document.querySelectorAll('#tracks-body > tr');
    rows.forEach(function (row) {
      if (row.classList.contains('disabled') && query !== '') {
        // optionally skip
      }
      var titleEl = row.querySelector('.title');
      var artistEl = row.querySelector('.artist');
      var albumEl = row.querySelector('.col-album');
      
      var title = titleEl ? titleEl.textContent.toLowerCase() : '';
      var artist = artistEl ? artistEl.textContent.toLowerCase() : '';
      var album = albumEl ? albumEl.textContent.toLowerCase() : '';
      
      if (title.includes(query) || artist.includes(query) || album.includes(query)) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });
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
