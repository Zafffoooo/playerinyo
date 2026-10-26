var artistProfileIdentities = new Map();
var artistAlbumFamilies = new Map();
var artistAlbumEditionSelection = new Map();
var artistProfileGeneration = 0;
var artistAlbumObserver = null;
function initArtistProfileControls() {
  artistProfileGeneration = 0;
  document.addEventListener('pointerdown', function (event) {
    document.querySelectorAll('.artist-edition-picker.open, .artist-album-menu[open]').forEach(function (popup) {
      if (popup.contains(event.target)) return;
      if (popup.matches('details')) popup.open = false;
      else { popup.classList.remove('open'); popup.querySelector('[role="listbox"]').hidden = true; popup.querySelector('[aria-haspopup="listbox"]').setAttribute('aria-expanded', 'false'); }
    });
  });
}

function artistCatalogKey(value) {
  return String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}
function renderSearchArtistCards(root, artists) {
  root.replaceChildren();
  if (!artists.length) return;
  var title = document.createElement('h2'); title.textContent = 'Artists'; root.appendChild(title);
  var list = document.createElement('div'); list.className = 'youtube-artist-list'; root.appendChild(list);
  artists.forEach(function (artist) {
    var button = document.createElement('button'); button.type = 'button'; button.className = 'youtube-artist-result';
    button.innerHTML = '<i class="ph ph-user-circle" aria-hidden="true"></i><span><strong>' + esc(artist.name) + '</strong><small>' + esc(artist.disambiguation || artist.type || 'Artist') + '</small></span><i class="ph ph-arrow-up-right" aria-hidden="true"></i>';
    button.addEventListener('click', function () { openArtistProfile(artist); });
    list.appendChild(button);
  });
}
function artistAlbumFamily(title) {
  return artistCatalogKey(String(title || '').replace(/\s*[([{]\s*(?:deluxe|expanded|remaster(?:ed)?|anniversary|special|collector['’]?s|bonus|reissue|taylor['’]?s version|re-recorded)[^\])}]*[\])}]/ig, '').replace(/\s*[-–—:]\s*(?:deluxe|expanded|remaster(?:ed)?|anniversary|special|bonus|reissue|taylor['’]?s version|re-recorded).*$/i, ''));
}
function artistAlbumGroups(groups) {
  var grouped = new Map();
  (groups || []).forEach(function (group) {
    var key = artistAlbumFamily(group.title) || group.id;
    if (!grouped.has(key)) grouped.set(key, { title: group.title, groups: [], date: group.date || '' });
    grouped.get(key).groups.push(group);
  });
  return Array.from(grouped.values()).sort(function (a, b) { return (b.date || '').localeCompare(a.date || '') || a.title.localeCompare(b.title); });
}
function artistLocalMatches(tracks, artistName) {
  var used = new Set();
  var artistKey = artistCatalogKey(artistName);
  return (tracks || []).map(function (track) {
    var match = state.musicFiles.find(function (file) {
      if (!file || !file.filePath || used.has(file.filePath)) return false;
      var fileArtist = artistCatalogKey(file.albumArtist || file.artist);
      if (fileArtist !== artistKey && artistCatalogKey(file.artist) !== artistKey) return false;
      if (track.recordingMbid && (file.trackMbid === track.recordingMbid || file.recordingMbid === track.recordingMbid)) return true;
      if (artistCatalogKey(file.title) !== artistCatalogKey(track.title)) return false;
      return !track.duration || !file.duration || Math.abs(track.duration - file.duration) <= 8;
    });
    if (match) used.add(match.filePath);
    return { track: track, file: match || null };
  });
}
function openArtistProfile(artist) {
  if (!artist || !artist.id) return;
  artistProfileIdentities.set(artist.id, artist);
  switchView('artist:' + artist.id);
}
function openArtistAlbumPage(artist, family) {
  var key = artist.id + ':' + artistAlbumFamily(family.title);
  artistAlbumFamilies.set(key, { artist: artist, family: family });
  switchView('artist-album:' + encodeURIComponent(key));
}
function renderArtistAlbumPage(encodedKey) {
  var root = $('artist-profile-container');
  if (!root) return;
  root.style.display = 'block';
  var key = decodeURIComponent(encodedKey);
  var selected = artistAlbumFamilies.get(key);
  root.replaceChildren();
  if (!selected) { root.textContent = 'Album details are unavailable. Open the artist profile again.'; return; }
  var generation = ++artistProfileGeneration;
  var artist = selected.artist, family = selected.family;
  var rememberedEdition = artistAlbumEditionSelection.get(key) || '';
  var back = document.createElement('button'); back.type = 'button'; back.className = 'artist-album-back'; back.textContent = '← ' + artist.name;
  back.addEventListener('click', function () { switchView('artist:' + artist.id); });
  root.appendChild(back);
  var page = document.createElement('article'); page.className = 'artist-album-page';
  var group = family.groups[0];
  page.innerHTML = '<div class="artist-album-page-head"><span class="artist-album-art"><img src="https://coverartarchive.org/release-group/' + esc(group.id) + '/front-500" alt="" /><i class="ph ph-vinyl-record" aria-hidden="true"></i></span><div><small>ALBUM · ' + esc((family.date || '').slice(0, 4)) + '</small><h1>' + esc(family.title) + '</h1><p>' + esc(artist.name) + '</p><span class="artist-album-coverage">Checking library…</span></div><details class="artist-album-menu"><summary aria-label="Album actions" title="Album actions"><i class="ph ph-dots-three" aria-hidden="true"></i></summary><div role="menu"><button type="button" role="menuitem" class="artist-album-browser">Show in browser</button><button type="button" role="menuitem" class="artist-album-download">Download album</button></div></details></div><div class="artist-album-detail"></div>';
  page.__editionId = rememberedEdition;
  var image = page.querySelector('img'); image.addEventListener('error', function () { image.hidden = true; });
  var menu = page.querySelector('.artist-album-menu');
  menu.addEventListener('keydown', function (event) { if (event.key === 'Escape') { event.preventDefault(); menu.open = false; menu.querySelector('summary').focus(); } });
  menu.querySelector('.artist-album-browser').addEventListener('click', function () {
    menu.open = false;
    if (!page.__editionId) { showToast('Wait for the album edition to load.'); return; }
    window.api.openExternal('https://musicbrainz.org/release/' + page.__editionId).then(function (opened) { if (!opened) showToast('Could not open MusicBrainz.'); });
  });
  menu.querySelector('.artist-album-download').addEventListener('click', function () { menu.open = false; openAlbumDownloadModal({ artist: artist.name, name: family.title }); });
  root.appendChild(page);
  loadArtistAlbumFamily(page, family, artist, generation);
}
function artistSearchTrack(artistName, trackTitle) {
  var source = $('global-search-source');
  var input = $('global-search');
  if (!source || !input) return;
  source.value = 'youtube-music';
  source.dispatchEvent(new Event('change'));
  input.value = artistName + ' ' + trackTitle;
  var submit = $('global-search-submit');
  if (submit) submit.click();
}
function renderArtistProfileById(artistId) {
  var root = $('artist-profile-container');
  if (!root) return;
  root.style.display = 'block';
  if (artistAlbumObserver) { artistAlbumObserver.disconnect(); artistAlbumObserver = null; }
  var generation = ++artistProfileGeneration;
  var artist = artistProfileIdentities.get(artistId) || { id: artistId, name: 'Artist' };
  root.replaceChildren();
  var header = document.createElement('header'); header.className = 'artist-profile-head';
  header.innerHTML = '<h1>' + esc(artist.name) + '</h1><p>Albums and editions from MusicBrainz. Your collection stays on this computer.</p>';
  root.appendChild(header);
  var status = document.createElement('p'); status.className = 'artist-profile-status'; status.textContent = 'Loading artist catalog…'; root.appendChild(status);
  window.api.getArtistCatalogProfile(artistId).then(function (result) {
    if (generation !== artistProfileGeneration || state.currentView !== 'artist:' + artistId) return;
    if (!result || !result.ok) { status.textContent = (result && result.error) || 'Artist catalog is unavailable. Try again later.'; return; }
    status.remove();
    var popularRows = result.popular && result.popular.length ? result.popular : state.musicFiles.filter(function (file) {
      return artistCatalogKey(file.albumArtist || file.artist) === artistCatalogKey(artist.name) || artistCatalogKey(file.artist) === artistCatalogKey(artist.name);
    }).map(function (file) { return { title: file.title, listens: Number((appSettings.playCounts || {})[file.filePath]) || 0 }; }).filter(function (file) { return file.listens > 0; }).sort(function (a, b) { return b.listens - a.listens; }).slice(0, 10);
    if (popularRows.length) {
      var popular = document.createElement('section'); popular.className = 'artist-popular';
      popular.innerHTML = '<h2>' + (result.popular && result.popular.length ? 'Popular on ListenBrainz' : 'Most played in your library') + '</h2>';
      var songs = document.createElement('div'); songs.className = 'artist-popular-list';
      popularRows.forEach(function (song, index) {
        var button = document.createElement('button'); button.type = 'button';
        button.innerHTML = '<span>' + (index + 1) + '</span><strong>' + esc(song.title) + '</strong><small>Search versions <i class="ph ph-arrow-up-right" aria-hidden="true"></i></small>';
        button.addEventListener('click', function () { artistSearchTrack(artist.name, song.title); });
        songs.appendChild(button);
      });
      popular.appendChild(songs); root.appendChild(popular);
    }
    var albums = document.createElement('section'); albums.className = 'artist-albums';
    albums.innerHTML = '<div class="artist-albums-heading"><h2>Albums</h2><span>Open an album to compare editions and tracks</span></div>';
    var grid = document.createElement('div'); grid.className = 'artist-album-grid'; albums.appendChild(grid); root.appendChild(albums);
    var families = artistAlbumGroups(result.groups);
    if (!families.length) { grid.innerHTML = '<p class="artist-profile-status">No albums found in the catalog.</p>'; return; }
    families.forEach(function (family) {
      var card = document.createElement('article'); card.className = 'artist-album-card';
      var group = family.groups[0];
      card.innerHTML = '<button type="button" class="artist-album-open"><span class="artist-album-art"><img src="https://coverartarchive.org/release-group/' + esc(group.id) + '/front-500" alt="" loading="lazy"><i class="ph ph-vinyl-record" aria-hidden="true"></i></span><span class="artist-album-copy"><strong>' + esc(family.title) + '</strong><small>' + esc((family.date || '').slice(0, 4) || 'Album') + '</small><span class="artist-album-coverage">Open album</span></span></button>';
      var image = card.querySelector('img'); image.addEventListener('error', function () { image.hidden = true; });
      var open = card.querySelector('.artist-album-open');
      open.addEventListener('click', function () { openArtistAlbumPage(artist, family); });
      grid.appendChild(card);
    });
  }).catch(function (error) { if (generation === artistProfileGeneration) status.textContent = error.message || 'Artist catalog is unavailable.'; });
}
async function loadArtistAlbumFamily(card, family, artist, generation, previewOnly) {
  card.querySelector('.artist-album-detail').textContent = 'Checking album editions and library tracks…';
  if (!card.__editions) {
    var editionResults = await Promise.all(family.groups.map(function (group) { return window.api.getArtistCatalogEditions(group.id); }));
    if (generation !== artistProfileGeneration) return;
    card.__editions = editionResults.flatMap(function (result) { return result && result.ok ? result.editions : []; })
      .filter(function (edition) { return edition.status === 'Official' || !edition.status; })
      .sort(function (a, b) { return (a.tracks || 999) - (b.tracks || 999) || (a.date || '').localeCompare(b.date || ''); });
    if (!card.__editions.length) card.__editions = editionResults.flatMap(function (result) { return result && result.ok ? result.editions : []; });
  }
  var editions = card.__editions;
  if (!editions.length) { card.querySelector('.artist-album-coverage').textContent = 'No track list available'; card.querySelector('.artist-album-detail').textContent = 'MusicBrainz has no usable edition for this album.'; return; }
  var selected = editions.find(function (edition) { return edition.id === card.__editionId; }) || editions[0];
  card.__editionId = selected.id;
  artistAlbumEditionSelection.set(artist.id + ':' + artistAlbumFamily(family.title), selected.id);
  var requestSeq = (card.__trackRequestSeq || 0) + 1; card.__trackRequestSeq = requestSeq;
  var result = await window.api.getArtistCatalogTracks(selected.id);
  if (generation !== artistProfileGeneration || !card.isConnected || requestSeq !== card.__trackRequestSeq) return;
  if (!result || !result.ok) { card.querySelector('.artist-album-coverage').textContent = 'Track list unavailable'; card.querySelector('.artist-album-detail').textContent = (result && result.error) || 'Could not load this edition.'; return; }
  card.__loaded = true;
  var matches = artistLocalMatches(result.tracks, artist.name);
  var found = matches.filter(function (entry) { return entry.file; }).length;
  card.querySelector('.artist-album-coverage').textContent = found + '/' + matches.length + ' in library' + (selected.date ? ' · ' + selected.date.slice(0, 4) + ' edition' : '');
  if (previewOnly && card.querySelector('.artist-album-detail').hidden) return;
  var detail = card.querySelector('.artist-album-detail'); detail.replaceChildren();
  var editionHeading = document.createElement('h3'); editionHeading.textContent = editions.length > 1 ? 'Other editions' : 'Track list'; detail.appendChild(editionHeading);
  var label = document.createElement('span'); label.className = 'artist-edition-label'; label.textContent = 'Edition'; detail.appendChild(label);
  var picker = document.createElement('div'); picker.className = 'artist-edition-picker';
  var trigger = document.createElement('button'); trigger.type = 'button'; trigger.className = 'artist-edition-trigger'; trigger.setAttribute('aria-haspopup', 'listbox'); trigger.setAttribute('aria-expanded', 'false'); trigger.setAttribute('aria-label', 'Album edition');
  trigger.innerHTML = '<span>' + esc([selected.title, selected.date && selected.date.slice(0, 4), selected.country].filter(Boolean).join(' · ')) + '</span><i class="ph ph-caret-down" aria-hidden="true"></i>';
  var options = document.createElement('div'); options.className = 'artist-edition-options'; options.setAttribute('role', 'listbox'); options.setAttribute('aria-label', 'Album editions'); options.hidden = true;
  function closePicker(restoreFocus) { picker.classList.remove('open'); options.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (restoreFocus) trigger.focus(); }
  function openPicker() { picker.classList.add('open'); options.hidden = false; trigger.setAttribute('aria-expanded', 'true'); (options.querySelector('[aria-selected="true"]') || options.firstElementChild)?.focus(); }
  trigger.addEventListener('click', function () { if (options.hidden) openPicker(); else closePicker(false); });
  trigger.addEventListener('keydown', function (event) { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openPicker(); } });
  editions.forEach(function (edition) {
    var option = document.createElement('button'); option.type = 'button'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', edition.id === selected.id ? 'true' : 'false');
    option.textContent = [edition.title, edition.date && edition.date.slice(0, 4), edition.country, edition.tracks ? edition.tracks + ' tracks' : ''].filter(Boolean).join(' · ');
    option.addEventListener('click', function () {
      closePicker(false);
      card.__editionId = edition.id;
      artistAlbumEditionSelection.set(artist.id + ':' + artistAlbumFamily(family.title), edition.id);
      loadArtistAlbumFamily(card, family, artist, generation).then(function () {
        if (card.isConnected) card.querySelector('.artist-edition-trigger')?.focus();
      });
    });
    options.appendChild(option);
  });
  options.addEventListener('keydown', function (event) {
    var entries = Array.from(options.querySelectorAll('[role="option"]')); var index = entries.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); closePicker(true); }
    else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) { event.preventDefault(); entries[event.key === 'Home' ? 0 : event.key === 'End' ? entries.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : entries.length - 1)) % entries.length].focus(); }
  });
  picker.append(trigger, options); detail.appendChild(picker);
  var list = document.createElement('ol'); list.className = 'artist-edition-tracks';
  matches.forEach(function (entry) {
    var row = document.createElement('li');
    var status = entry.file ? 'In library' : 'Missing';
    row.innerHTML = '<span class="artist-track-status ' + (entry.file ? 'owned' : 'missing') + '">' + status + '</span><strong>' + esc(entry.track.title) + '</strong>';
    if (entry.file) {
      var play = document.createElement('button'); play.type = 'button'; play.textContent = 'Play';
      play.addEventListener('click', function () {
        initAudioCtx();
        var playable = matches.filter(function (item) { return item.file; }).map(function (item) { return { matchedFile: item.file, title: item.file.title, artist: item.file.artist, album: item.file.album, duration: item.file.duration, isDisabled: false }; });
        state.playQueueTracks = playable;
        state.shuffleQueue = [];
        playTrack(playable.find(function (item) { return item.matchedFile.filePath === entry.file.filePath; }));
      });
      row.appendChild(play);
    } else {
      var search = document.createElement('button'); search.type = 'button'; search.textContent = 'Find version';
      search.addEventListener('click', function () { artistSearchTrack(artist.name, entry.track.title); });
      row.appendChild(search);
    }
    list.appendChild(row);
  });
  detail.appendChild(list);
}
