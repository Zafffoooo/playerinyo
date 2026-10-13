/* ─── LYRICS ENGINE ─── */

function parseLrc(lrcText) {
  var lines = String(lrcText || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  var result = [];
  lines.forEach(function (line) {
    var timestamps = [];
    var match;
    var timestampPattern = /\[(\d{1,3}):(\d{1,2}(?:\.\d{1,3})?)\]/g;
    while ((match = timestampPattern.exec(line)) !== null) {
      timestamps.push(parseInt(match[1], 10) * 60 + parseFloat(match[2]));
    }
    if (!timestamps.length) return;
    var text = line.replace(/^(?:\[\d{1,3}:\d{1,2}(?:\.\d{1,3})?\])+/, '').trim();
    if (!text) return;
    timestamps.forEach(function (time) { result.push({ time: time, text: text }); });
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

function saveCustomLyricsForTrack(track, synced, plain) {
  var trackKey = track && track._lyricsSaveKey || ((track && track.matchedFile && track.matchedFile.filePath) ? 'path:' + track.matchedFile.filePath : getLyricsRequestKey(track));
  if (!trackKey) return;
  if (!appSettings.customLyrics || typeof appSettings.customLyrics !== 'object') appSettings.customLyrics = {};
  appSettings.customLyrics[trackKey] = JSON.stringify({ syncedLyrics: synced || '', plainLyrics: plain || '' });
  saveSettingsDebounced();
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

  var personalKey = track.matchedFile && track.matchedFile.filePath ? 'path:' + track.matchedFile.filePath : key;
  var personalLyrics = appSettings.customLyrics && appSettings.customLyrics[personalKey];
  if (personalLyrics) {
    try {
      var personalData = JSON.parse(personalLyrics);
      if (personalData.syncedLyrics) { lyricsData = parseLrc(personalData.syncedLyrics); plainLyricsText = ''; renderLyricsPanel(); }
      else if (personalData.plainLyrics) renderPlainLyrics(personalData.plainLyrics);
      if (lyricsData.length || plainLyricsText) { if (npOverlayOpen) mirrorLyricsToNP(); return; }
    } catch (_) { /* Ignore malformed personal cache entries and try online sources. */ }
  }

  if (!(track.title || '').trim() || !(track.artist || '').trim()) {
    if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ph-warning" style="font-size:48px;color:var(--text-disabled);margin-bottom:12px;"></i><p style="color:var(--text-subdued);font-size:13px;">Track metadata is unavailable</p></div>';
    return;
  }

  var cached = getCachedLyrics(key);
  if (cached && applyTrustedLyricsResult(track, cached)) return;

  // Try exact LRCLIB lookup, then a wider search with strict metadata matching.
  var requestFailed = false;
  var exactMatched = false;
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
        exactMatched = true;
        return;
      }
    } else if (resp.status >= 500) {
      requestFailed = true;
    }
    if (!exactMatched) {
      var searchUrl = 'https://lrclib.net/api/search?artist_name=' + encodeURIComponent(track.artist) + '&track_name=' + encodeURIComponent(track.title);
      var searchResponse = await fetch(searchUrl);
      if (lyricsCurrentTrackKey !== key) return;
      if (searchResponse.ok) {
        var candidates = await searchResponse.json();
        if (lyricsCurrentTrackKey !== key) return;
        var matching = (Array.isArray(candidates) ? candidates : []).find(function (candidate) { return isTrustedLyricsMatch(track, candidate); });
        if (matching && applyTrustedLyricsResult(track, matching)) { cacheLyrics(key, matching); return; }
      } else if (searchResponse.status >= 500) requestFailed = true;
    }
  } catch (e) { requestFailed = true; console.log('LRCLIB fetch error:', e); }

  // lyrics.ovh provides plain text only and is used as a fallback.
  try {
    var fallbackResponse = await fetch('https://api.lyrics.ovh/v1/' + encodeURIComponent(track.artist) + '/' + encodeURIComponent(track.title));
    if (lyricsCurrentTrackKey !== key) return;
    if (fallbackResponse.ok) {
      var fallbackData = await fallbackResponse.json();
      if (lyricsCurrentTrackKey !== key) return;
      if (fallbackData && fallbackData.lyrics) {
        renderPlainLyrics(fallbackData.lyrics);
        saveCustomLyricsForTrack(track, '', fallbackData.lyrics);
        if (npOverlayOpen) mirrorLyricsToNP();
        return;
      }
    } else if (fallbackResponse.status >= 500) requestFailed = true;
  } catch (_) { requestFailed = true; }

  // Final fallback: No lyrics found
  if (lyricsCurrentTrackKey === key) {
    lyricsData = [];
    plainLyricsText = '';
    if (lc) lc.innerHTML = '<div class="lyrics-empty"><i class="ph ' + (requestFailed ? 'ph-wifi-slash' : 'ph-microphone-stage') + '" style="font-size:48px;color:var(--text-disabled);margin-bottom:12px;"></i><p style="color:var(--text-subdued);font-size:13px;">' + (requestFailed ? 'Could not connect to lyrics services' : 'Lyrics not found') + '</p><p style="color:var(--text-disabled);font-size:11px;margin-top:4px;">Use retry, paste your own lyrics, or search the web.</p></div>';
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
  tempTrack._lyricsSaveKey = state.currentPlayingTrack.matchedFile && state.currentPlayingTrack.matchedFile.filePath ? 'path:' + state.currentPlayingTrack.matchedFile.filePath : getLyricsRequestKey(state.currentPlayingTrack);
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


function initLyricsControls() {
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
    var track = state.currentPlayingTrack;
    if (!track) { showToast('Play a track before loading its lyrics.'); return; }
    lyricsData = parseLrc(content);
    plainLyricsText = '';
    lyricsCurrentTrackKey = getLyricsRequestKey(track);
    saveCustomLyricsForTrack(track, content, '');
    renderLyricsPanel();
    if (npOverlayOpen) mirrorLyricsToNP();
  });
  var pasteLyricsButton = $('btn-lyrics-paste');
  if (pasteLyricsButton) pasteLyricsButton.addEventListener('click', function () {
    var track = state.currentPlayingTrack;
    if (!track) { showToast('Play a track before adding lyrics.'); return; }
    var pasted = window.prompt('Paste plain text or timed LRC lyrics for the current track:');
    if (pasted === null || !pasted.trim()) return;
    lyricsCurrentTrackKey = getLyricsRequestKey(track);
    var parsed = parseLrc(pasted);
    if (parsed.length) { lyricsData = parsed; plainLyricsText = ''; saveCustomLyricsForTrack(track, pasted, ''); renderLyricsPanel(); }
    else { renderPlainLyrics(pasted); saveCustomLyricsForTrack(track, '', pasted); }
    if (npOverlayOpen) mirrorLyricsToNP();
  });
  var retryLyricsButton = $('btn-lyrics-retry');
  if (retryLyricsButton) retryLyricsButton.addEventListener('click', function () { lyricsCurrentTrackKey = ''; if (state.currentPlayingTrack) fetchLyricsForTrack(state.currentPlayingTrack); });
  var webLyricsButton = $('btn-lyrics-web-search');
  if (webLyricsButton) webLyricsButton.addEventListener('click', function () {
    var track = state.currentPlayingTrack;
    if (track) window.api.openExternal('https://www.google.com/search?q=' + encodeURIComponent((track.artist || '') + ' ' + (track.title || '') + ' lyrics')).then(function (opened) { if (!opened) showToast('Could not open the lyrics search.'); }).catch(function () { showToast('Could not open the lyrics search.'); });
  });
}
