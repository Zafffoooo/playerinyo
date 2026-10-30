var artistProfileIdentities = new Map();
var artistAlbumFamilies = new Map();
var artistAlbumEditionSelection = new Map();
var artistProfileGeneration = 0;
var artistAlbumObserver = null;
var artistProfileLayoutObserver = null;
function placeArtistRowPanel(grid, card, panel, itemClass) {
  if (!card || !grid || !panel) return;
  panel.remove();
  var top = card.getBoundingClientRect().top;
  var row = Array.from(grid.children).filter(function (item) { return item.classList.contains(itemClass) && Math.abs(item.getBoundingClientRect().top - top) < 2; });
  (row[row.length - 1] || card).after(panel);
}
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
function artistLibraryFiles(artistName) {
  var key = artistCatalogKey(artistName);
  return state.musicFiles.filter(function (file) {
    return file && (artistCatalogKey(file.albumArtist || file.artist) === key || artistCatalogKey(file.artist) === key);
  });
}
function artistSongLocalAlbums(song, artistName) {
  var title = artistCatalogKey(song && song.title);
  var artist = artistCatalogKey(artistName);
  var found = new Map();
  if (!title) return [];
  state.musicFiles.forEach(function (file) {
    if (!file || !file.filePath || artistCatalogKey(file.artist || file.albumArtist) !== artist) return;
    if (!(song.recordingMbid && (file.trackMbid === song.recordingMbid || file.recordingMbid === song.recordingMbid)) && artistCatalogKey(file.title) !== title) return;
    var albumKey = getAlbumKey(file);
    if (found.has(albumKey)) return;
    var album = getFullAlbumByKey(albumKey);
    if (album) found.set(albumKey, { album: album, file: file });
  });
  return Array.from(found.values());
}
function playArtistLibraryFile(file) {
  var track = { matchedFile: file, title: file.title, artist: file.artist, album: file.album, duration: file.duration, isDisabled: false };
  initAudioCtx();
  state.playQueueTracks = [track]; state.shuffleQueue = [];
  playTrack(track);
}
function openArtistProfile(artist) {
  if (!artist || !artist.id) return;
  artistProfileIdentities.set(artist.id, artist);
  switchView('artist:' + artist.id);
}
function openLibraryArtistProfile(name) {
  var artist = String(name || '').trim();
  if (artistCatalogKey(artist)) switchView('library-artist:' + encodeURIComponent(artist));
}
function renderLibraryArtistProfile(encodedName) {
  var name;
  try { name = decodeURIComponent(encodedName); }
  catch (_) { switchView('library', false); return; }
  renderArtistProfileById('', name);
}
function chooseCatalogItem(title, items, label, artwork) {
  if (items.length === 1) return Promise.resolve(items[0]);
  return new Promise(function (resolve) {
    var modal = document.createElement('div'); modal.className = 'modal-overlay catalog-choice-modal'; modal.id = 'catalog-choice-modal';
    var content = document.createElement('div'); content.className = 'modal-content catalog-choice-content';
    var heading = document.createElement('h2'); heading.textContent = title;
    var list = document.createElement('div'); list.className = 'catalog-choice-list';
    var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'btn btn-outline'; cancel.textContent = 'Cancel';
    function finish(value) { hideModal(modal, { restoreFocus: false }); modal.remove(); resolve(value); }
    items.forEach(function (item) {
      var button = document.createElement('button'); button.type = 'button'; button.className = 'catalog-choice-item';
      button.textContent = label(item);
      if (artwork) { var source=artwork(item); if(source) { var cover=document.createElement('img');cover.src=source;cover.alt='';cover.className='catalog-choice-cover';cover.addEventListener('error',function(){cover.remove();});button.prepend(cover); } }
      button.addEventListener('click', function () { finish(item); }); list.appendChild(button);
    });
    cancel.addEventListener('click', function () { finish(null); });
    modal.addEventListener('click', function (event) { if (event.target === modal) finish(null); });
    modal.addEventListener('keydown', function (event) { if (event.key === 'Escape') { event.stopPropagation(); finish(null); } });
    content.append(heading, list, cancel); modal.appendChild(content); document.body.appendChild(modal);
    showModal(modal, { initialFocus: '.catalog-choice-item' });
  });
}
async function openArtistProfileByName(name) {
  if (!window.api.searchArtistCatalog || !artistCatalogKey(name)) return;
  var result;
  try { result = await window.api.searchArtistCatalog(name); }
  catch (_) { showToast('Artist profile is unavailable.'); return; }
  if (!result || !result.ok) { showToast('Artist profile is unavailable.'); return; }
  var exact = (result.artists || []).filter(function (artist) { return artistCatalogKey(artist.name) === artistCatalogKey(name); });
  var matches = exact.length ? exact : result.artists || [];
  if (!matches.length) { showToast('Artist profile was not found.'); return; }
  var chosen = await chooseCatalogItem('Choose artist', matches, function (artist) { return artist.name + (artist.disambiguation ? ' · ' + artist.disambiguation : ''); });
  if (chosen) openArtistProfile(chosen);
}
async function openCatalogAlbumForTrack(track) {
  if (!window.api.findArtistCatalogSongAlbums || !track || !track.title || !track.artist) return;
  var result;
  try { result = await window.api.findArtistCatalogSongAlbums(track.title, track.artist, track.album || ''); }
  catch (_) { showToast('Could not find the album catalog.'); return; }
  if (!result || !result.ok) { showToast('Could not find the album catalog.'); return; }
  var albums = result.albums || [];
  if (!albums.length) { showToast('No matching album was found.'); return; }
  var chosen = await chooseCatalogItem('Choose album', albums, function (album) { return album.title + ' · ' + (album.date || '').slice(0, 4) + ' · ' + album.primaryType; }, function(album) { return 'https://coverartarchive.org/release-group/'+album.id+'/front-250'; });
  if (!chosen) return;
  artistProfileIdentities.set(chosen.artist.id, chosen.artist);
  openArtistAlbumPage(chosen.artist, { title: chosen.title, date: chosen.date, groups: [{ id: chosen.id, title: chosen.title, date: chosen.date }] });
}
function openAlbumForTrack(track) {
  var localAlbum = resolvePlaybackTrackAlbum(track);
  if (!localAlbum) return openCatalogAlbumForTrack(track);
  pushNav('album:' + localAlbum.id);
  return renderAlbumDetail(localAlbum, track && track.matchedFile && track.matchedFile.filePath);
}
function openArtistAlbumPage(artist, family) {
  var key = artist.id + ':' + artistAlbumFamily(family.title);
  artistAlbumFamilies.set(key, { artist: artist, family: family });
  switchView('artist-album:' + encodeURIComponent(key));
}
function renderArtistAlbumPage(encodedKey) {
  var root = $('artist-profile-container');
  if (!root) return;
  if (artistProfileLayoutObserver) { artistProfileLayoutObserver.disconnect(); artistProfileLayoutObserver = null; }
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
async function playArtistPopularSong(artist, song, button) {
  var oldLabel = button.innerHTML;
  button.disabled = true;
  button.textContent = 'Preparing…';
  try {
    var local = artistLocalMatches([song], artist.name)[0]?.file;
    var track;
    if (local) track = { matchedFile: local, title: local.title, artist: local.artist, album: local.album, duration: local.duration, isDisabled: false };
    else {
      var result = await window.api.searchYouTubeMusic(artist.name + ' ' + song.title);
      if (!result || !result.ok) throw new Error('Song search failed.');
      var matches = (result.songs || []).filter(function (item) { return artistCatalogKey(item.title) === artistCatalogKey(song.title) && artistCatalogKey(item.artist) === artistCatalogKey(artist.name); });
      if (!matches.length) { artistSearchTrack(artist.name, song.title); return; }
      var chosen = matches.length > 1 ? await chooseCatalogItem('Choose version', matches, function (item) { return item.title + ' · ' + item.artist + ' · ' + Math.floor(item.duration / 60) + ':' + String(item.duration % 60).padStart(2, '0'); }) : matches[0];
      if (!chosen) return;
      track = { candidateId: 'youtube-music:' + chosen.videoId, queueEntryId: createQueueEntryId(), title: chosen.title, artist: chosen.artist, album: chosen.album || '', artwork: chosen.artwork || '', duration: chosen.duration, playback: { kind: 'youtube', videoId: chosen.videoId }, isDisabled: false };
    }
    initAudioCtx();
    state.playQueueTracks = [track]; state.shuffleQueue = [];
    var started = await playTrack(track);
    if (!started) showToast('Could not play this version.');
  } catch (_) { showToast('Could not start this song.'); }
  finally { button.disabled = false; button.innerHTML = oldLabel; }
}
function renderArtistProfileById(artistId, localName) {
  var root = $('artist-profile-container');
  if (!root) return;
  root.style.display = 'block';
  if (artistAlbumObserver) { artistAlbumObserver.disconnect(); artistAlbumObserver = null; }
  if (artistProfileLayoutObserver) { artistProfileLayoutObserver.disconnect(); artistProfileLayoutObserver = null; }
  var generation = ++artistProfileGeneration;
  var localOnly = typeof localName === 'string';
  var artist = localOnly ? { name: localName } : artistProfileIdentities.get(artistId) || { id: artistId, name: 'Artist' };
  var viewId = localOnly ? 'library-artist:' + encodeURIComponent(localName) : 'artist:' + artistId;
  function current() { return generation === artistProfileGeneration && state.currentView === viewId && root.isConnected; }
  root.replaceChildren();
  var header = document.createElement('header'); header.className = 'artist-profile-head';
  if (localOnly) header.classList.add('library-artist-head');
  header.innerHTML = '<div class="artist-profile-visual" aria-hidden="true"></div><div class="artist-profile-head-copy"><small>' + (localOnly ? 'IN LIBRARY' : 'ARTIST') + '</small><h1>' + esc(artist.name) + '</h1><p>' + (localOnly ? 'Your albums and songs' : 'Music, albums and editions') + '</p></div><button type="button" class="artist-photo-credit" hidden></button>';
  root.appendChild(header);
  if (localOnly) {
    var explore = document.createElement('button'); explore.type = 'button'; explore.className = 'artist-library-explore';
    explore.innerHTML = 'Explore online <i class="ph ph-arrow-up-right" aria-hidden="true"></i>';
    explore.addEventListener('click', function () { openArtistProfileByName(artist.name); });
    header.querySelector('.artist-profile-head-copy').appendChild(explore);
  }
  var visual = header.querySelector('.artist-profile-visual');
  var credit = header.querySelector('.artist-photo-credit');
  if (!localOnly && window.api.getArtistCatalogImage) window.api.getArtistCatalogImage(artistId).then(function (response) {
    if (!current() || !response?.image?.url) return;
    var image = new Image();
    image.onload = function () { if (current()) { visual.replaceChildren(image); header.classList.add('has-photo'); } };
    image.src = response.image.url;
    var info = response.image;
    credit.textContent = [info.author, info.license].filter(Boolean).join(' · ') || 'Photo details';
    if (info.sourceUrl && /^https:\/\//.test(info.sourceUrl)) {
      credit.hidden = false;
      credit.addEventListener('click', function () { window.api.openExternal(info.sourceUrl); });
    }
  }).catch(function () { /* Keep the artist heading when the photo is unavailable. */ });

  var localFiles = artistLibraryFiles(artist.name);
  var localAlbums = new Map();
  localFiles.forEach(function (file) {
    var key = getAlbumKey(file);
    if (!localAlbums.has(key)) localAlbums.set(key, []);
    localAlbums.get(key).push(file);
  });
  var library = document.createElement('section'); library.className = 'artist-library';
  var libraryToggle = document.createElement('button'); libraryToggle.type = 'button'; libraryToggle.className = 'artist-library-toggle';
  libraryToggle.setAttribute('aria-expanded', 'false'); libraryToggle.setAttribute('aria-controls', 'artist-library-content');
  libraryToggle.innerHTML = '<strong>In Library</strong><span>' + localFiles.length + ' ' + (localFiles.length === 1 ? 'song' : 'songs') + ' · ' + localAlbums.size + ' ' + (localAlbums.size === 1 ? 'album' : 'albums') + '</span><i class="ph ph-caret-down" aria-hidden="true"></i>';
  var libraryContent = document.createElement('div'); libraryContent.id = 'artist-library-content'; libraryContent.className = 'artist-library-content'; libraryContent.hidden = true;
  if (localFiles.length) {
    var libraryGrid = document.createElement('div'); libraryGrid.className = 'artist-library-albums';
    var libraryDetail = document.createElement('div'); libraryDetail.id = 'artist-library-tracks'; libraryDetail.className = 'artist-library-tracks'; libraryDetail.hidden = true;
    var selectedAlbum = null;
    var selectedLibraryCard = null;
    var albumButtons = new Map();
    localAlbums.forEach(function (files, key) {
      var album = getFullAlbumByKey(key);
      var name = album ? album.name : files[0].album || 'Unknown Album';
      var card = document.createElement('article'); card.className = 'artist-library-album';
      var art = document.createElement('div'); art.className = 'artist-library-art';
      if (album && album.cover) {
        var image = document.createElement('img'); image.src = album.cover; image.alt = ''; image.loading = 'lazy';
        image.addEventListener('error', function () { image.remove(); });
        art.appendChild(image);
      }
      var fallback = document.createElement('i'); fallback.className = 'ph ph-music-notes'; fallback.setAttribute('aria-hidden', 'true'); art.appendChild(fallback);
      var label = document.createElement('strong'); label.textContent = name; label.title = name;
      var openAlbum = document.createElement('button'); openAlbum.type = 'button'; openAlbum.className = 'artist-library-open';
      openAlbum.setAttribute('aria-label', 'Open ' + name + ' in your library');
      openAlbum.append(art, label);
      openAlbum.addEventListener('click', function () {
        if (!album) return;
        pushNav('album:' + album.id);
        renderAlbumDetail(album);
      });
      var expand = document.createElement('button'); expand.type = 'button'; expand.className = 'artist-library-expand';
      expand.setAttribute('aria-expanded', 'false'); expand.setAttribute('aria-controls', 'artist-library-tracks');
      expand.setAttribute('aria-label', 'Show songs from ' + name);
      expand.innerHTML = '<span>Show ' + files.length + ' ' + (files.length === 1 ? 'song' : 'songs') + '</span><i class="ph ph-caret-down" aria-hidden="true"></i>';
      albumButtons.set(key, expand);
      expand.addEventListener('click', function () {
        selectedAlbum = selectedAlbum === key ? null : key;
        selectedLibraryCard = selectedAlbum ? card : null;
        albumButtons.forEach(function (button, buttonKey) {
          var isOpen = buttonKey === selectedAlbum;
          button.setAttribute('aria-expanded', String(isOpen));
          button.setAttribute('aria-label', (isOpen ? 'Hide' : 'Show') + ' songs from ' + (getFullAlbumByKey(buttonKey)?.name || localAlbums.get(buttonKey)[0].album || 'Unknown Album'));
          button.querySelector('span').textContent = isOpen ? 'Hide songs' : 'Show ' + localAlbums.get(buttonKey).length + ' ' + (localAlbums.get(buttonKey).length === 1 ? 'song' : 'songs');
        });
        libraryDetail.replaceChildren(); libraryDetail.hidden = !selectedAlbum;
        if (!selectedAlbum) return;
        var heading = document.createElement('h3'); heading.textContent = name; libraryDetail.appendChild(heading);
        files.slice().sort(compareAlbumTrackOrder).forEach(function (file, index) {
          var row = document.createElement('button'); row.type = 'button';
          row.innerHTML = '<span>' + (file.trackNo || index + 1) + '</span><strong>' + esc(file.title || 'Unknown Title') + '</strong><small>Play <i class="ph ph-play" aria-hidden="true"></i></small>';
          row.addEventListener('click', function () { playArtistLibraryFile(file); });
          libraryDetail.appendChild(row);
        });
        placeArtistRowPanel(libraryGrid, selectedLibraryCard, libraryDetail, 'artist-library-album');
      });
      card.append(openAlbum, expand); libraryGrid.appendChild(card);
    });
    libraryGrid.appendChild(libraryDetail);
    libraryContent.appendChild(libraryGrid);
    library.__repositionPanel = function () { if (selectedLibraryCard && !libraryDetail.hidden) placeArtistRowPanel(libraryGrid, selectedLibraryCard, libraryDetail, 'artist-library-album'); };
  } else { var empty = document.createElement('p'); empty.className = 'artist-profile-inline-status'; empty.textContent = 'No songs by this artist in your library.'; libraryContent.appendChild(empty); }
  libraryToggle.addEventListener('click', function () {
    libraryContent.hidden = !libraryContent.hidden;
    libraryToggle.setAttribute('aria-expanded', String(!libraryContent.hidden));
  });
  library.append(libraryToggle, libraryContent);
  if (localOnly) {
    libraryContent.hidden = false;
    libraryToggle.setAttribute('aria-expanded', 'true');
    root.appendChild(library);
    var observedLocalWidth = 0;
    artistProfileLayoutObserver = new ResizeObserver(function (entries) {
      var width = entries[0]?.contentRect.width || 0;
      if (!current() || Math.abs(width - observedLocalWidth) < 1) return;
      observedLocalWidth = width;
      library.__repositionPanel?.();
    });
    artistProfileLayoutObserver.observe(root);
    return;
  }

  var popular = document.createElement('section'); popular.className = 'artist-popular';
  popular.innerHTML = '<h2>Popular</h2><p class="artist-profile-inline-status">Loading songs…</p>';
  root.append(popular, library);
  function renderSongs(rows, heading) {
    if (!current()) return;
    popular.replaceChildren();
    var title = document.createElement('h2'); title.textContent = heading; popular.appendChild(title);
    if (!rows.length) { var empty = document.createElement('p'); empty.className = 'artist-profile-inline-status'; empty.textContent = 'No online songs found.'; popular.appendChild(empty); return; }
    var matches = artistLocalMatches(rows, artist.name);
    var songs = document.createElement('div'); songs.className = 'artist-popular-list';
    var choices = document.createElement('div'); choices.className = 'artist-song-album-choices'; choices.hidden = true;
    var selectedItem = null;
    var lookupSequence = 0;
    function closeChoices() {
      lookupSequence++;
      if (selectedItem) selectedItem.querySelector('.artist-popular-title').setAttribute('aria-expanded', 'false');
      selectedItem = null; choices.hidden = true; choices.remove();
    }
    function showChoices(item, label) {
      selectedItem = item; choices.hidden = false; choices.replaceChildren();
      item.querySelector('.artist-popular-title').setAttribute('aria-expanded', 'true');
      var heading = document.createElement('div'); heading.className = 'artist-song-album-choices-head';
      var text = document.createElement('strong'); text.textContent = label;
      var close = document.createElement('button'); close.type = 'button'; close.setAttribute('aria-label', 'Close album choices'); close.innerHTML = '<i class="ph ph-x" aria-hidden="true"></i>';
      close.addEventListener('click', closeChoices);
      heading.append(text, close); choices.appendChild(heading);
      placeArtistRowPanel(songs, item, choices, 'artist-popular-item');
    }
    function addAlbumChoices(items, local) {
      var list = document.createElement('div'); list.className = 'artist-song-album-choice-list';
      items.forEach(function (entry) {
        var album = local ? entry.album : entry;
        var button = document.createElement('button'); button.type = 'button'; button.className = 'artist-song-album-choice';
        button.setAttribute('aria-label', 'Open ' + (local ? album.name : album.title));
        var art = document.createElement('span'); art.className = 'artist-song-album-choice-art';
        var cover = local ? album.cover : 'https://coverartarchive.org/release-group/' + album.id + '/front-250';
        if (cover) { var image = document.createElement('img'); image.src = cover; image.alt = ''; image.loading = 'lazy'; image.addEventListener('error', function () { image.remove(); }); art.appendChild(image); }
        var fallback = document.createElement('i'); fallback.className = 'ph ph-vinyl-record'; fallback.setAttribute('aria-hidden', 'true'); art.appendChild(fallback);
        var name = document.createElement('strong'); name.textContent = local ? album.name : album.title;
        var detail = document.createElement('small'); detail.textContent = local ? 'In Library' : [(album.date || '').slice(0, 4), album.primaryType].filter(Boolean).join(' · ');
        button.append(art, name, detail);
        button.addEventListener('click', function () {
          if (local) { pushNav('album:' + album.id); renderAlbumDetail(album, entry.file.filePath); }
          else { artistProfileIdentities.set(album.artist.id, album.artist); openArtistAlbumPage(album.artist, { title: album.title, date: album.date, groups: [{ id: album.id, title: album.title, date: album.date }] }); }
        });
        list.appendChild(button);
      });
      choices.appendChild(list);
    }
    matches.forEach(function (entry, index) {
      var item = document.createElement('div'); item.className = 'artist-popular-item';
      var row = document.createElement('div'); row.className = 'artist-popular-row';
      var number = document.createElement('span'); number.textContent = index + 1;
      var songTitle = document.createElement('button'); songTitle.type = 'button'; songTitle.className = 'artist-popular-title'; songTitle.textContent = entry.track.title;
      songTitle.setAttribute('aria-expanded', 'false'); songTitle.setAttribute('aria-label', 'Find albums containing ' + entry.track.title);
      songTitle.addEventListener('click', async function () {
        if (selectedItem === item) { closeChoices(); return; }
        closeChoices();
        var local = artistSongLocalAlbums(entry.track, artist.name);
        if (local.length === 1) { pushNav('album:' + local[0].album.id); renderAlbumDetail(local[0].album, local[0].file.filePath); return; }
        showChoices(item, local.length ? 'Choose an album in your library' : 'Finding albums…');
        if (local.length) { addAlbumChoices(local, true); return; }
        var request = ++lookupSequence;
        try {
          var result = await window.api.findArtistCatalogSongAlbums(entry.track.title, artist.name, entry.track.album || '');
          if (!current() || request !== lookupSequence || !choices.isConnected) return;
          if (!result || !result.ok) throw new Error((result && result.error) || 'Album search failed.');
          var albums = result.albums || [];
          if (albums.length === 1) { closeChoices(); artistProfileIdentities.set(albums[0].artist.id, albums[0].artist); openArtistAlbumPage(albums[0].artist, { title: albums[0].title, date: albums[0].date, groups: [{ id: albums[0].id, title: albums[0].title, date: albums[0].date }] }); return; }
          showChoices(item, albums.length ? 'Choose an album' : 'No matching album found');
          if (albums.length) addAlbumChoices(albums, false);
          else {
            var search = document.createElement('button'); search.type = 'button'; search.className = 'artist-song-album-retry'; search.textContent = 'Search versions';
            search.addEventListener('click', function () { artistSearchTrack(artist.name, entry.track.title); }); choices.appendChild(search);
          }
        } catch (error) {
          if (!current() || request !== lookupSequence || !choices.isConnected) return;
          showChoices(item, error.message || 'Album search failed.');
          var retry = document.createElement('button'); retry.type = 'button'; retry.className = 'artist-song-album-retry'; retry.textContent = 'Retry';
          retry.addEventListener('click', function () { closeChoices(); songTitle.click(); }); choices.appendChild(retry);
        }
      });
      row.append(number, songTitle);
      if (entry.file) { var owned = document.createElement('em'); owned.textContent = 'In Library'; row.appendChild(owned); }
      var play = document.createElement('button'); play.type = 'button'; play.className = 'artist-popular-play'; play.innerHTML = 'Play <i class="ph ph-play" aria-hidden="true"></i>';
      play.setAttribute('aria-label', 'Play ' + entry.track.title);
      play.addEventListener('click', function () { playArtistPopularSong(artist, entry.track, play); });
      row.appendChild(play); item.appendChild(row); songs.appendChild(item);
    });
    popular.appendChild(songs);
    popular.__repositionPanel = function () { if (selectedItem && !choices.hidden) placeArtistRowPanel(songs, selectedItem, choices, 'artist-popular-item'); };
  }
  function loadYouTubeSongs() {
    if (!window.api.searchYouTubeMusic) { renderSongs([], 'YouTube Music'); return; }
    window.api.searchYouTubeMusic(artist.name).then(function (response) {
      if (!current()) return;
      var rows = response && response.ok ? (response.songs || []).filter(function (song) { return artistCatalogKey(song.artist) === artistCatalogKey(artist.name); }).slice(0, 10) : [];
      renderSongs(rows, 'YouTube Music');
    }).catch(function () { renderSongs([], 'YouTube Music'); });
  }
  window.api.getArtistCatalogPopular(artistId).then(function (result) {
    if (!current()) return;
    if (result && result.ok && result.songs && result.songs.length) renderSongs(result.songs, 'Popular on ListenBrainz');
    else loadYouTubeSongs();
  }).catch(function () { if (current()) loadYouTubeSongs(); });

  var albums = document.createElement('section'); albums.className = 'artist-albums';
  albums.innerHTML = '<div class="artist-albums-heading"><h2>Albums</h2><span>Open an album to compare editions and tracks</span></div>';
  var albumHeading = albums.querySelector('.artist-albums-heading');
  var showAll = document.createElement('button'); showAll.type = 'button'; showAll.className = 'artist-show-all'; showAll.hidden = true;
  showAll.innerHTML = '<span>Show All</span><i class="ph ph-arrow-right" aria-hidden="true"></i>'; albumHeading.appendChild(showAll);
  function setShowAllLabel(label) { showAll.querySelector('span').textContent = label; }
  var grid = document.createElement('div'); grid.className = 'artist-album-grid'; albums.appendChild(grid);
  var albumStatus = document.createElement('p'); albumStatus.className = 'artist-profile-inline-status'; albumStatus.textContent = 'Loading albums…'; albums.appendChild(albumStatus);
  root.appendChild(albums);
  var familyMap = new Map();
  var offset = 0;
  var total = 0;
  var expanded = false;
  var loading = false;
  function albumCountText() { return familyMap.size + ' ' + (familyMap.size === 1 ? 'album' : 'albums'); }
  function appendFamily(family) {
    var card = document.createElement('article'); card.className = 'artist-album-card';
    var group = family.groups[0];
    card.innerHTML = '<button type="button" class="artist-album-open"><span class="artist-album-art"><img src="https://coverartarchive.org/release-group/' + esc(group.id) + '/front-500" alt="" loading="lazy"><i class="ph ph-vinyl-record" aria-hidden="true"></i></span><span class="artist-album-copy"><strong>' + esc(family.title) + '</strong><small>' + esc((family.date || '').slice(0, 4) || 'Album') + '</small><span class="artist-album-coverage">Open album</span></span></button>';
    card.querySelector('img').addEventListener('error', function () { card.querySelector('img').hidden = true; });
    card.querySelector('.artist-album-open').addEventListener('click', function () { openArtistAlbumPage(artist, family); });
    grid.appendChild(card);
  }
  function addGroups(groups) {
    artistAlbumGroups(groups).forEach(function (incoming) {
      var key = artistAlbumFamily(incoming.title) || incoming.groups[0].id;
      var family = familyMap.get(key);
      if (family) family.groups.push.apply(family.groups, incoming.groups);
      else {
        familyMap.set(key, incoming);
        if (expanded || familyMap.size <= 5) appendFamily(incoming);
      }
    });
  }
  async function loadPages() {
    if (loading || !current()) return;
    if (offset > 0 && offset >= total) {
      albumStatus.textContent = albumCountText() + ' loaded.';
      showAll.hidden = true;
      return;
    }
    loading = true; showAll.disabled = true;
    do {
      var requestedOffset = offset;
      var limit = requestedOffset === 0 ? 12 : 100;
      albumStatus.textContent = requestedOffset ? 'Loading albums… ' + requestedOffset + ' of ' + total + ' catalog groups' : 'Loading albums…';
      try {
        var result = await window.api.getArtistCatalogAlbums(artistId, requestedOffset, limit);
        if (!current()) return;
        if (!result || !result.ok) throw new Error((result && result.error) || 'Album catalog is unavailable.');
        total = result.total;
        var groups = result.groups || [];
        addGroups(groups);
        offset = requestedOffset + limit;
        if (!groups.length || offset >= total) break;
      } catch (error) {
        if (!current()) return;
        albumStatus.textContent = (error.message || 'Album catalog is unavailable.') + ' Retry to continue.';
        setShowAllLabel('Retry'); showAll.hidden = false; showAll.disabled = false;
        loading = false;
        return;
      }
    } while (expanded || familyMap.size < 5 && offset < total);
    if (!current()) return;
    loading = false; showAll.disabled = false;
    if (!familyMap.size) { albumStatus.textContent = 'No albums found in the catalog.'; showAll.hidden = true; }
    else if (offset >= total) {
      albumStatus.textContent = expanded || familyMap.size <= 5 ? albumCountText() + ' loaded.' : 'Showing 5 of ' + albumCountText() + '.';
      showAll.hidden = expanded || familyMap.size <= 5;
      setShowAllLabel('Show All');
    }
    else { albumStatus.textContent = 'Showing ' + Math.min(5, familyMap.size) + ' of ' + familyMap.size + ' albums from the first ' + Math.min(offset, total) + ' catalog groups.'; setShowAllLabel('Show All'); showAll.hidden = false; }
  }
  showAll.addEventListener('click', function () {
    if (!expanded && offset > 0) {
      expanded = true;
      Array.from(familyMap.values()).slice(5).forEach(appendFamily);
    }
    loadPages();
  });
  loadPages();
  var observedWidth = 0;
  artistProfileLayoutObserver = new ResizeObserver(function (entries) {
    var width = entries[0]?.contentRect.width || 0;
    if (!current() || Math.abs(width - observedWidth) < 1) return;
    observedWidth = width;
    library.__repositionPanel?.();
    popular.__repositionPanel?.();
  });
  artistProfileLayoutObserver.observe(root);
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
  selected.tracks = result.tracks.length;
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
  trigger.innerHTML = '<span>' + esc([selected.title, selected.date && selected.date.slice(0, 4), selected.country, selected.tracks !== null && selected.tracks !== undefined ? selected.tracks + ' tracks' : 'Count unavailable'].filter(Boolean).join(' · ')) + '</span><i class="ph ph-caret-down" aria-hidden="true"></i>';
  var options = document.createElement('div'); options.className = 'artist-edition-options'; options.setAttribute('role', 'listbox'); options.setAttribute('aria-label', 'Album editions'); options.hidden = true;
  function closePicker(restoreFocus) { picker.classList.remove('open'); options.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (restoreFocus) trigger.focus(); }
  function openPicker() { picker.classList.add('open'); options.hidden = false; trigger.setAttribute('aria-expanded', 'true'); (options.querySelector('[aria-selected="true"]') || options.firstElementChild)?.focus(); }
  trigger.addEventListener('click', function () { if (options.hidden) openPicker(); else closePicker(false); });
  trigger.addEventListener('keydown', function (event) { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openPicker(); } });
  var sort = document.createElement('select'); sort.setAttribute('aria-label', 'Sort editions'); sort.innerHTML = '<option value=default>Default</option><option value=asc>Track count ↑</option><option value=desc>Track count ↓</option>'; detail.appendChild(sort);
  sort.onchange = function () { Array.from(options.children).sort(function(a,b) { var ai = editions.findIndex(function(e) { return e.id === a.dataset.editionId; }); var bi = editions.findIndex(function(e) { return e.id === b.dataset.editionId; }); if (sort.value === 'default') return ai-bi; var ac=editions[ai].tracks, bc=editions[bi].tracks; return ac === null || ac === undefined ? 1 : bc === null || bc === undefined ? -1 : (ac-bc)*(sort.value === 'asc' ? 1 : -1); }).forEach(function(el) { options.appendChild(el); }); };
  editions.forEach(function (edition) {
    var option = document.createElement('button'); option.type = 'button'; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', edition.id === selected.id ? 'true' : 'false');
    option.dataset.editionId = edition.id;
    option.textContent = [edition.title, edition.date && edition.date.slice(0, 4), edition.country, edition.tracks !== null && edition.tracks !== undefined ? edition.tracks + ' tracks' : 'Count unavailable'].filter(Boolean).join(' · ');
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

function openPlaylistCoverCrop(sourceUrl) {
  var modal = $('playlist-cover-crop-modal');
  if (!modal || modal.classList.contains('active') || !sourceUrl) return Promise.resolve(null);
  var canvas = $('playlist-cover-crop-canvas');
  var context = canvas.getContext('2d');
  var image = new Image();
  var zoom = 1, offsetX = 0, offsetY = 0, pointer = null;
  var zoomLevel = $('playlist-cover-crop-level');
  var save = $('playlist-cover-crop-save');
  var cancel = $('playlist-cover-crop-cancel');
  var zoomIn = $('playlist-cover-crop-in');
  var zoomOut = $('playlist-cover-crop-out');
  function draw() {
    var side = canvas.width;
    var scale = Math.max(side / image.naturalWidth, side / image.naturalHeight) * zoom;
    var width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    offsetX = Math.max((side - width) / 2, Math.min((width - side) / 2, offsetX));
    offsetY = Math.max((side - height) / 2, Math.min((height - side) / 2, offsetY));
    context.clearRect(0, 0, side, side);
    context.drawImage(image, (side - width) / 2 + offsetX, (side - height) / 2 + offsetY, width, height);
    zoomLevel.textContent = Math.round(zoom * 100) + '%';
    zoomOut.disabled = zoom <= 1;
    zoomIn.disabled = zoom >= 4;
  }
  return new Promise(function (resolve) {
    function finish(value) {
      hideModal(modal);
      canvas.onpointerdown = canvas.onpointermove = canvas.onpointerup = canvas.onpointercancel = null;
      zoomIn.onclick = zoomOut.onclick = save.onclick = cancel.onclick = null;
      resolve(value);
    }
    image.onload = function () {
      if (!image.naturalWidth || !image.naturalHeight) { showToast('Could not read this image.'); resolve(null); return; }
      draw();
      canvas.onpointerdown = function (event) {
        event.preventDefault();
        canvas.setPointerCapture(event.pointerId);
        pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
      };
      canvas.onpointermove = function (event) {
        if (!pointer || pointer.id !== event.pointerId) return;
        var scale = canvas.width / canvas.getBoundingClientRect().width;
        offsetX += (event.clientX - pointer.x) * scale;
        offsetY += (event.clientY - pointer.y) * scale;
        pointer.x = event.clientX; pointer.y = event.clientY;
        draw();
      };
      canvas.onpointerup = canvas.onpointercancel = function () { pointer = null; };
      zoomIn.onclick = function () { zoom = Math.min(4, Math.round((zoom + 0.25) * 100) / 100); draw(); };
      zoomOut.onclick = function () { zoom = Math.max(1, Math.round((zoom - 0.25) * 100) / 100); draw(); };
      cancel.onclick = function () { finish(null); };
      save.onclick = function () {
        try { finish(canvas.toDataURL('image/jpeg', 0.88)); }
        catch (_) { showToast('Could not save this cover.'); }
      };
      showModal(modal, { initialFocus: '#playlist-cover-crop-canvas' });
    };
    image.onerror = function () { showToast('Could not read this image.'); resolve(null); };
    image.src = sourceUrl;
  });
}
async function choosePlaylistCover() {
  var source = await window.api.openImage();
  return source ? openPlaylistCoverCrop(source) : null;
}
async function cropPlaylistCoverFile(file) {
  var source = URL.createObjectURL(file);
  try { return await openPlaylistCoverCrop(source); }
  finally { URL.revokeObjectURL(source); }
}

function reviewPlaylistDuplicates(pl) {
  var groups=new Map();
  pl.tracks.forEach(function(record,index) { var track=playlistRecordToPlaybackTrack(record,pl.id); var exact=track.matchedFile ? 'path:'+stripFileUrl(track.matchedFile.filePath) : record.VideoId ? 'video:'+record.VideoId : ''; var key=exact || getMusicalIdentity(record); if(!key) return; if(!groups.has(key)) groups.set(key,[]); groups.get(key).push({record:record,index:index,exact:!!exact,track:track}); });
  var duplicates=Array.from(groups.values()).filter(function(g) { return g.length>1; });
  if(!duplicates.length) { showToast('No duplicates found.'); return; }
  var modal=document.createElement('div'); modal.className='modal-overlay'; modal.id='playlist-duplicates-modal'; var content=document.createElement('div'); content.className='modal-content'; content.innerHTML='<h2>Review duplicates</h2><p>Choose playlist copies to remove.</p>'; var checks=[];
  duplicates.forEach(function(group) { var h=document.createElement('h3'); h.textContent=(group[0].exact?'Duplicates: ':'Possible duplicates: ')+group[0].track.title; content.appendChild(h); group.forEach(function(entry,i) { var label=document.createElement('label'); label.style.display='block'; var cb=document.createElement('input'); cb.type='checkbox'; cb.checked=entry.exact && i>0; checks.push({cb:cb,index:entry.index}); label.append(cb,document.createTextNode(' '+entry.track.artist+' · '+entry.track.album+' · '+fmt(entry.track.duration)+' · '+(entry.track.matchedFile?'Local':'Reference'))); content.appendChild(label); }); });
  function close() { hideModal(modal); modal.remove(); }
  var cancel=document.createElement('button'); cancel.className='btn btn-outline'; cancel.textContent='Cancel'; cancel.onclick=close; var remove=document.createElement('button'); remove.className='btn btn-primary'; remove.textContent='Remove selected copies'; remove.onclick=async function() { var indexes=new Set(checks.filter(function(c) { return c.cb.checked; }).map(function(c) { return c.index; })); if(!indexes.size) return; pushUndoSnapshot('Remove playlist duplicates',['playlists']); var before=pl.tracks; pl.tracks=pl.tracks.filter(function(_,i) { return !indexes.has(i); }); try { await persistPlaylists(state.playlists); close(); renderSidebarPlaylists(); if(state.currentView===pl.id) renderPlaylist(pl.id); } catch(_) { pl.tracks=before; showToast('Could not save playlist.'); } }; content.append(cancel,remove); modal.appendChild(content); document.body.appendChild(modal); showModal(modal);
}

function playlistTrackGenres(track) {
  var source=track.matchedFile || {};
  var record=track.csvRecord || {};
  return getDiscoveryGenreLabels({genre:source.genre || record.Genre || record.genre});
}
function renderPlaylistStatusFilters() {
  var root=$('playlist-status-filters'); if(!root) return;
  root.hidden=false; root.replaceChildren();
  var strip=document.createElement('div');strip.className='playlist-filter-strip';strip.setAttribute('role','group');strip.setAttribute('aria-label','Filter playlist');root.appendChild(strip);
  var status=trackRenderState.statusView===state.currentView ? trackRenderState.statusFilter || 'all' : 'all';
  var genre=trackRenderState.statusView===state.currentView ? trackRenderState.genreFilter || '' : '';
  function apply(nextStatus,nextGenre) {trackRenderState.statusView=state.currentView;trackRenderState.statusFilter=nextStatus;trackRenderState.genreFilter=nextGenre;clearTrackSelection();renderPlaylistStatusFilters();var pl=getCurrentRegularPlaylist();renderTracksTable(!!pl && (!pl.sortBy || pl.sortBy==='Custom Order'));}
  function chip(label,active,callback,disabled) {var button=document.createElement('button');button.type='button';button.textContent=label;button.className='playlist-filter-chip';button.disabled=!!disabled;button.setAttribute('aria-pressed',String(active));button.onclick=callback;strip.appendChild(button);}
  [['all','All',function(){return true;}],['local','Local',function(t){return !!t.matchedFile;}],['online','Online',function(t){return !t.matchedFile && isRemotePlaybackTrack(t);}],['missing','Missing',function(t){return t.isDisabled;}]].forEach(function(item){var count=state.currentTracks.filter(item[2]).length;chip(item[1]+(item[0]==='all'?'':' '+count),status===item[0] && (item[0]!=='all' || !genre),function(){apply(item[0]==='all' || status===item[0]?'all':item[0],item[0]==='all'?'':genre);},!count);});
  var genres=new Map();state.currentTracks.forEach(function(track){new Set(playlistTrackGenres(track).map(function(g){return g.toLowerCase();})).forEach(function(key){var name=playlistTrackGenres(track).find(function(g){return g.toLowerCase()===key;});var entry=genres.get(key)||{name:name,count:0};entry.count++;genres.set(key,entry);});});
  Array.from(genres.entries()).sort(function(a,b){return b[1].count-a[1].count || a[1].name.localeCompare(b[1].name);}).forEach(function(entry){chip(entry[1].name,genre===entry[0],function(){apply(status,genre===entry[0]?'':entry[0]);});});
  var arrow=document.createElement('button');arrow.type='button';arrow.className='playlist-filter-next';arrow.textContent='›';arrow.setAttribute('aria-label','More playlist filters');arrow.onclick=function(){strip.scrollBy({left:220,behavior:'smooth'});};root.appendChild(arrow);
  function updateArrow(){arrow.hidden=strip.scrollWidth-strip.clientWidth-strip.scrollLeft<2;}strip.onscroll=updateArrow;root.__filterResize?.disconnect();root.__filterResize=new ResizeObserver(updateArrow);root.__filterResize.observe(strip);requestAnimationFrame(updateArrow);
  var seconds=state.currentTracks.reduce(function(n,t){return n+(Number(t.duration)||0);},0);var unknown=state.currentTracks.filter(function(t){return !t.duration;}).length;
  var meta=$('album-detail-artist');meta.textContent=state.currentTracks.length+' tracks · '+(seconds>=3600?Math.floor(seconds/3600)+' hr ':'')+Math.floor(seconds%3600/60)+' min'+(unknown?' · partial':'');meta.title=unknown?unknown+' tracks have unknown duration':'';
}

var missingPlaylistSearchGeneration = 0;
async function findMissingPlaylistTrack(track, playAfter, inBatch) {
  if (!track || !track.csvRecord) return 'skipped';
  if (activeMissingPlaylistRequest || missingPlaylistBatchRunning && !inBatch) {
    showToast('Wait for the current search or cancel it.');
    return 'skipped';
  }
  var record = track.csvRecord;
  var playlist = state.playlists.find(function (p) { return p.id === track.sourcePlaylistId; });
  if (!playlist || !playlist.tracks.includes(record)) return 'skipped';
  var generation = ++missingPlaylistSearchGeneration;
  var playbackAtStart = playbackGeneration;
  var requestId = 'playlist-find-' + generation;
  activeMissingPlaylistRequest = requestId;
  missingPlaylistSearchView = playlist.id;
  playlistSearchStates.set(record, 'Finding…');
  renderMissingPlaylistRowStates();
  showMissingPlaylistStatus(missingBatchProgress + 'Finding ' + track.title + '…', true);
  var previous = Object.assign({}, record);
  try {
    var resolved = await playbackResolver.resolve(Object.assign({}, track, {
      candidateId: record.EntryId || createQueueEntryId(), album: track.album === '-' ? '' : track.album
    }), { musicFiles: state.musicFiles, unplayableFilePaths: libraryMissingFilePaths, requestId: requestId });
    if (generation !== missingPlaylistSearchGeneration || !state.playlists.includes(playlist) || !playlist.tracks.includes(record)) return 'cancelled';
    if (!resolved) {
      playlistSearchStates.set(record, 'No match'); renderMissingPlaylistRowStates();
      if (playAfter && playbackAtStart === playbackGeneration) openVersionPicker(track, true);
      return 'unmatched';
    }
    if (resolved.playback.kind === 'youtube') {
      record.VideoId = resolved.playback.videoId; record.PlaybackSource = 'youtube';
    } else if (resolved.matchedFile) record.FilePath = resolved.matchedFile.filePath;
    try { await persistPlaylists(state.playlists); }
    catch (error) {
      Object.keys(record).forEach(function (key) { delete record[key]; });
      Object.assign(record, previous); throw error;
    }
    playlistSearchStates.delete(record);
    var updated = playlistRecordToPlaybackTrack(record, playlist.id);
    if (state.currentView === playlist.id) renderPlaylistPreservingScroll(playlist.id);
    if (playAfter && generation === missingPlaylistSearchGeneration && playbackAtStart === playbackGeneration) {
      initAudioCtx();
      state.playQueueTracks = playlist.tracks.map(function (r) { return playlistRecordToPlaybackTrack(r, playlist.id); });
      await playTrack(updated);
    }
    return 'matched';
  } catch (error) {
    if (generation === missingPlaylistSearchGeneration) {
      playlistSearchStates.set(record, 'Retry'); renderMissingPlaylistRowStates();
      showToast('Search failed: ' + error.message);
    }
    return 'failed';
  } finally {
    if (activeMissingPlaylistRequest === requestId) {
      activeMissingPlaylistRequest = '';
      if (!inBatch && generation === missingPlaylistSearchGeneration) showMissingPlaylistStatus('Search finished', false);
    }
  }
}

async function saveCurrentQueueAsPlaylist() {
  var sequence = state.isShuffle ? state.shuffleQueue : state.playQueueTracks.filter(function (t) { return !t.isDisabled; });
  var cursor = getPlaybackSequenceCursorIndex(sequence);
  var current = state.currentPlayingTrack;
  var remaining = state.userQueue.concat(cursor >= 0 ? sequence.slice(cursor + 1) : sequence).slice();
  var result = await requestPlaylistText('Save queue as playlist', 'Saved queue', { includeCurrent: !!current });
  if (!result) return;
  var tracks = (result.includeCurrent && current ? [current] : []).concat(remaining);
  if (!tracks.length) { showToast('The remaining queue is empty.'); return; }
  var pl = { id: 'pl_' + createQueueEntryId(), name: getUniquePlaylistName(result.value), tracks: tracks.map(makePlaylistTrackRecord), cover: null, color: PALETTE[0] };
  state.playlists.push(pl);
  try {
    await persistPlaylists(state.playlists); renderSidebarPlaylists();
    showToast('Saved ' + pl.tracks.length + ' tracks to ' + pl.name, { actionLabel: 'Open playlist', onAction: function () { switchView(pl.id); } });
  } catch (_) {
    state.playlists = state.playlists.filter(function (p) { return p !== pl; }); showToast('Could not save queue.');
  }
}

function renderPlaylistFolderGroups(list) {
  var folders=Array.isArray(appSettings.playlistFolders) ? appSettings.playlistFolders : [];
  var create=document.createElement('button'); create.className='btn btn-outline'; create.textContent='New folder'; create.onclick=async function() { var name=await requestPlaylistText('Folder name',''); if(!name || !name.trim()) return; await commitPlaylistFolderChange(function() { appSettings.playlistFolders=folders.concat([{id:createQueueEntryId(),name:name.trim().slice(0,120),collapsed:false}]); }); }; var oldCreate=$('playlist-new-folder');if(oldCreate)oldCreate.remove();create.id='playlist-new-folder';document.querySelector('#regular-playlists-section .playlist-workspace-section-head').appendChild(create);
  if(folders.length) { var ungrouped=document.createElement('h3');ungrouped.className='playlist-ungrouped-heading';ungrouped.textContent='No folder';list.prepend(ungrouped); }
  folders.forEach(function(folder) {
    var section=document.createElement('section'); section.className='playlist-folder';section.dataset.folderId=folder.id;
    var header=document.createElement('div'); header.className='playlist-folder-header';
    var toggle=document.createElement('button'); toggle.className='btn btn-outline'; toggle.textContent=folder.name; toggle.setAttribute('aria-expanded',String(!folder.collapsed));
    var body=document.createElement('div'); body.className='playlists-container playlists-grid'; body.hidden=folder.collapsed;
    toggle.onclick=function() { commitPlaylistFolderChange(function() { folder.collapsed=!folder.collapsed; }); };
    var rename=document.createElement('button');rename.className='btn btn-outline';rename.textContent='Rename';rename.onclick=async function() { var name=await requestPlaylistText('Folder name',folder.name);if(name && name.trim()) { await commitPlaylistFolderChange(function() { folder.name=name.trim().slice(0,120); }); } };
    var remove=document.createElement('button');remove.className='btn btn-outline';remove.textContent='Delete folder';remove.onclick=async function() { await commitPlaylistFolderChange(function() { appSettings.playlistFolders=folders.filter(function(f) { return f!==folder; }); state.playlists.forEach(function(p) { if(p.folderId===folder.id) delete p.folderId; }); },true); };
    section.ondragover=function(e) { if(e.dataTransfer.types.includes('application/x-playerinyo-playlist')) e.preventDefault(); };
    section.ondrop=async function(e) { var id=e.dataTransfer.getData('application/x-playerinyo-playlist');var pl=state.playlists.find(function(p) { return p.id===id; });if(pl) { e.preventDefault();e.stopPropagation();await commitPlaylistFolderChange(function() { pl.folderId=folder.id; },true); } };
    header.append(toggle,rename,remove);section.append(header,body);list.appendChild(section);
    state.playlists.filter(function(p) { return p.folderId===folder.id; }).forEach(function(p) { var card=$(p.id);if(card) body.appendChild(card); });
  });
  state.playlists.forEach(function(pl) { var card=$(pl.id);if(!card) return;card.draggable=true;card.addEventListener('dragstart',function(e) { e.dataTransfer.setData('application/x-playerinyo-playlist',pl.id); }); });
}
function addPlaylistFolderMenu(pl,menu) {
  var old=$('playlist-folder-move');if(old) old.remove();if(pl.isSpecial) return;
  var select=document.createElement('select');select.id='playlist-folder-move';select.setAttribute('aria-label','Move to folder');
  var none=document.createElement('option');none.value='';none.textContent='No folder';select.appendChild(none);
  (appSettings.playlistFolders || []).forEach(function(f) { var option=document.createElement('option');option.value=f.id;option.textContent=f.name;select.appendChild(option); });select.value=pl.folderId || '';
  select.onchange=async function() { var value=select.value;hideAllContextMenus();await commitPlaylistFolderChange(function() { pl.folderId=value; },true); };menu.appendChild(select);
}
var activeMissingPlaylistRequest = '';
var missingPlaylistSearchView = '';
var missingPlaylistBatchCancelled = false;
var missingPlaylistBatchRunning = false;
function showMissingPlaylistStatus(text,busy) {
  var root=$('missing-playlist-search-status');if(!root) { root=document.createElement('div');root.id='missing-playlist-search-status';root.setAttribute('role','status');$('tracks-table-container').prepend(root); }root.dataset.sourcePlaylist=missingPlaylistSearchView;root.hidden=state.currentView!==missingPlaylistSearchView;root.replaceChildren(document.createTextNode(text));
  if(busy) { var cancel=document.createElement('button');cancel.className='btn btn-outline';cancel.textContent='Cancel';cancel.onclick=cancelMissingPlaylistSearch;root.appendChild(cancel); }
}
async function findSelectedMissingTracks(tracks) {
  if (activeMissingPlaylistRequest || missingPlaylistBatchRunning) { showToast('Wait for the current search or cancel it.'); return; }
  var missing = tracks.filter(function (t) { return t.isDisabled && t.csvRecord; });
  if (!missing.length) { showToast('No unmatched tracks selected.'); return; }
  missingPlaylistBatchCancelled = false; missingPlaylistBatchRunning = true;
  var matched = 0, reviewed = 0;
  try {
    for (var i = 0; i < missing.length && !missingPlaylistBatchCancelled; i++) {
      missingBatchProgress = (i + 1) + ' / ' + missing.length + ' · ';
      var result = await findMissingPlaylistTrack(missing[i], false, true);
      if (result === 'matched') matched++;
      if (result !== 'cancelled') reviewed++;
    }
  } finally {
    missingBatchProgress = ''; missingPlaylistBatchRunning = false;
    showMissingPlaylistStatus((missingPlaylistBatchCancelled ? 'Cancelled · ' : '') + reviewed + ' checked · ' + matched + ' matched · ' + (reviewed - matched) + ' need review', false);
  }
}
function cancelMissingPlaylistSearch() {
  missingPlaylistBatchCancelled = true;
  missingPlaylistSearchGeneration++;
  if (activeMissingPlaylistRequest) window.api.cancelRadioResolverRequest(activeMissingPlaylistRequest).catch(function () {});
  playlistSearchStates = new WeakMap(); renderMissingPlaylistRowStates();
  showMissingPlaylistStatus('Search cancelled', false);
}

function addMissingPlaylistActions(track) {
  var menu=$('track-context-menu');if(!menu) return;
  menu.querySelectorAll('.playlist-resolution-action').forEach(function(el) { el.remove(); });
  if(!track || !track.csvRecord) return;
  function action(label,fn) { var b=document.createElement('button');b.className='menu-item playlist-resolution-action';b.textContent=label;b.onclick=function() { hideAllContextMenus();fn(); };menu.appendChild(b); }
  var missing=getTracksFromTrackContextForPlaylistAdd().filter(function(t) { return t.isDisabled && t.csvRecord; });
  if(missing.length) action('Find missing tracks ('+missing.length+')',function() { findSelectedMissingTracks(missing); });
  if(track.isDisabled) action('Find & play',function() { findMissingPlaylistTrack(track,true); });
  if (!$('ctx-select-version') && !track.matchedFile) action('Choose another version',function() { openVersionPicker(track); });
  action('Find album',function() { openPlaylistTrackAlbum(track); });
  if(track.csvRecord.VideoId) action('Clear online match',async function() { var previousId=track.csvRecord.VideoId;var previousSource=track.csvRecord.PlaybackSource;delete track.csvRecord.VideoId;delete track.csvRecord.PlaybackSource;try { await persistPlaylists(state.playlists);if(state.currentView===track.sourcePlaylistId) renderPlaylistPreservingScroll(track.sourcePlaylistId); } catch(_) { track.csvRecord.VideoId=previousId;track.csvRecord.PlaybackSource=previousSource;showToast('Could not clear this match.'); } });
}
function requestPlaylistText(title, initial, options) {
  return new Promise(function (resolve) {
    var modal = document.createElement('div'); modal.id = 'playlist-text-dialog'; modal.className = 'modal-overlay';
    var box = document.createElement('div'); box.className = 'modal-content playlist-text-dialog';
    var heading = document.createElement('h2'); heading.textContent = title;
    var label = document.createElement('label'); label.textContent = 'Name';
    var input = document.createElement('input'); input.value = initial; input.maxLength = 120; label.appendChild(input);
    var include = document.createElement('input'); include.type = 'checkbox';
    var includeLabel = document.createElement('label'); includeLabel.className = 'playlist-queue-include'; includeLabel.append(include, document.createTextNode('Include current track'));
    var cancel = document.createElement('button'); cancel.dataset.cancel = 'true'; cancel.className = 'btn btn-outline'; cancel.textContent = 'Cancel';
    var save = document.createElement('button'); save.className = 'btn btn-primary'; save.textContent = 'Save';
    var actions = document.createElement('div'); actions.className = 'playlist-dialog-actions'; actions.append(cancel, save);
    function finish(value) { hideModal(modal); modal.remove(); resolve(value); }
    cancel.onclick = function () { finish(null); };
    save.onclick = function () { if (input.value.trim()) finish(options ? { value: input.value.trim(), includeCurrent: include.checked } : input.value.trim()); };
    input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); save.click(); } };
    box.append(heading, label); if (options && options.includeCurrent) box.appendChild(includeLabel); box.appendChild(actions);
    modal.appendChild(box); document.body.appendChild(modal); showModal(modal);
    requestAnimationFrame(function () { input.focus(); input.select(); });
  });
}

var playlistSearchStates = new WeakMap();
var missingBatchProgress = '';
function renderMissingPlaylistRowStates() {
  document.querySelectorAll('#tracks-body tr[data-track-index]').forEach(function(row) {
    var track=trackRenderState.source[Number(row.dataset.trackIndex)];var old=row.querySelector('.playlist-search-row-state');if(old)old.remove();if(!track || !track.csvRecord) return;var text=playlistSearchStates.get(track.csvRecord);if(!text) return;var button=document.createElement('button');button.className='playlist-search-row-state';button.textContent=text;button.onclick=function(e) {e.stopPropagation();if(text==='Retry' || text==='No match') findMissingPlaylistTrack(track,true);else cancelMissingPlaylistSearch(); };button.title=text==='Finding…' ? 'Cancel search' : 'Search again';row.querySelector('.track-text')?.appendChild(button);
  });
}
var playlistFolderWritePending = false;
async function commitPlaylistFolderChange(change, updatePlaylists) {
  if (playlistFolderWritePending) { showToast('Wait for the current folder change.'); return false; }
  playlistFolderWritePending = true;
  var folders = JSON.parse(JSON.stringify(appSettings.playlistFolders || []));
  var memberships = state.playlists.map(function (p) { return { playlist: p, folderId: p.folderId }; });
  try {
    change();
    if (updatePlaylists) await persistPlaylists(state.playlists);
    await persistSettings(appSettings);
    renderSidebarPlaylists();
    return true;
  } catch (error) {
    appSettings.playlistFolders = folders;
    memberships.forEach(function (entry) {
      if (entry.folderId === undefined) delete entry.playlist.folderId;
      else entry.playlist.folderId = entry.folderId;
    });
    try { if (updatePlaylists) await persistPlaylists(state.playlists); await persistSettings(appSettings); }
    catch (rollbackError) { console.error('Folder rollback could not be saved:', rollbackError); }
    renderSidebarPlaylists(); showToast('Could not save folder changes.');
    return false;
  } finally { playlistFolderWritePending = false; }
}
function normalizePlaylistEntryIds() {
  var changed = false;
  state.playlists.forEach(function (playlist) {
    var used = new Set();
    (playlist.tracks || []).forEach(function (record) {
      if (typeof record.EntryId !== 'string' || !record.EntryId || record.EntryId.length > 100 || used.has(record.EntryId)) {
        record.EntryId = createQueueEntryId(); changed = true;
      }
      used.add(record.EntryId);
    });
  });
  return changed;
}
async function openPlaylistTrackAlbum(track) {
  var matches = artistSongLocalAlbums(track, track.artist);
  if (!matches.length) return openCatalogAlbumForTrack(track);
  var chosen = await chooseCatalogItem('Choose an album in your library', matches, function (entry) {
    return entry.album.name + (entry.album.year ? ' · ' + entry.album.year : '');
  }, function (entry) { return entry.album.cover; });
  if (chosen) { pushNav('album:' + chosen.album.id); renderAlbumDetail(chosen.album, chosen.file.filePath); }
}
