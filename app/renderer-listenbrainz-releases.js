var freshReleasesAccount = '';
var freshReleasesRequestId = 0;
var freshReleasesLoadedAt = 0;
var freshReleasesLoading = false;

function findLocalFreshRelease(release) {
  function exact(value) { return String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase(); }
  var albums = getLibraryIndex().albums;
  var name = exact(release.name);
  var artist = exact(release.artist);
  var matches = Object.values(albums).filter(function (album) {
    return exact(album.name) === name && exact(album.artist) === artist;
  });
  return matches.length === 1 ? matches[0] : null;
}

function appendFreshReleaseCard(grid, release, today) {
  var card = document.createElement('button');
  card.type = 'button';
  card.className = 'album-card recommendation-card fresh-release-card';
  var artwork = document.createElement('span');
  artwork.className = 'album-card-img-wrapper';
  function placeholder() {
    var icon = document.createElement('i');
    icon.className = 'ph ph-music-notes';
    icon.setAttribute('aria-hidden', 'true');
    artwork.replaceChildren(icon);
  }
  if (release.image) {
    var image = document.createElement('img');
    image.alt = '';
    if (appSettings.lazyLoading) image.loading = 'lazy';
    image.addEventListener('error', placeholder, { once: true });
    image.src = release.image;
    artwork.appendChild(image);
  } else placeholder();
  var info = document.createElement('span');
  info.className = 'album-card-info';
  var name = document.createElement('span');
  name.className = 'album-card-title';
  name.textContent = name.title = release.name;
  var artist = document.createElement('span');
  artist.className = 'album-card-artist';
  artist.textContent = release.artist;
  var date = document.createElement('time');
  date.className = 'fresh-release-date';
  date.dateTime = release.date;
  date.textContent = (release.date > today ? 'Upcoming · ' : '') +
    new Date(release.date + 'T12:00:00').toLocaleDateString(undefined, { dateStyle: 'medium' });
  info.append(name, artist, date);
  card.append(artwork, info);
  card.addEventListener('click', function () {
    var local = findLocalFreshRelease(release);
    if (local) {
      pushNav('album:' + local.id);
      renderAlbumDetail(local);
    } else artistSearchTrack(release.artist, release.name);
  });
  grid.appendChild(card);
}

async function renderListenbrainzFreshReleases(force) {
  var account = appSettings.listenbrainzConnected ? appSettings.listenbrainzUsername || '' : '';
  var section = $('home-fresh-releases');
  section.hidden = !account;
  var changed = account !== freshReleasesAccount;
  if (!changed && (freshReleasesLoading || (force !== true && Date.now() - freshReleasesLoadedAt < 300000))) return;
  freshReleasesAccount = account;
  var id = ++freshReleasesRequestId;
  var grid = $('home-fresh-releases-grid');
  var status = $('home-fresh-releases-status');
  var retry = $('home-fresh-releases-retry');
  retry.disabled = !!account;
  if (changed) grid.replaceChildren();
  freshReleasesLoading = !!account;
  if (!account) {
    status.textContent = '';
    retry.disabled = false;
    freshReleasesLoadedAt = 0;
    return;
  }
  status.textContent = 'Loading new releases…';
  function current() {
    return id === freshReleasesRequestId && appSettings.listenbrainzConnected && appSettings.listenbrainzUsername === account;
  }
  try {
    var result = await window.api.listenbrainzFreshReleases(force === true);
    if (!current() || !result) return;
    var range = result.days + ' days back and ahead.';
    var releases = result.items;
    var now = new Date();
    var today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    var recent = releases.filter(function (row) { return row.date <= today; }).sort(function (a, b) { return b.date.localeCompare(a.date); });
    var upcoming = releases.filter(function (row) { return row.date > today; }).sort(function (a, b) { return a.date.localeCompare(b.date); });
    var rows = recent.slice(0, Math.max(6, 12 - upcoming.length)).concat(upcoming.slice(0, Math.max(6, 12 - recent.length)));
    grid.replaceChildren();
    rows.forEach(function (release) { appendFreshReleaseCard(grid, release, today); });
    var messages = {
      ready: 'Past and upcoming releases within ' + range,
      empty: 'ListenBrainz returned no releases within ' + range,
      filtered: 'ListenBrainz returned releases, but none had an eligible album or EP with a complete date and credit. Checked ' + range,
      error: 'ListenBrainz could not load the requested window of ' + range
    };
    status.textContent = messages[result.status];
    freshReleasesLoadedAt = Date.now();
  } catch {
    if (!current()) return;
    status.textContent = 'Could not refresh ListenBrainz releases.';
    grid.replaceChildren();
    freshReleasesLoadedAt = Date.now();
  } finally {
    if (id === freshReleasesRequestId) {
      freshReleasesLoading = false;
      retry.disabled = false;
    }
  }
}

function initListenbrainzReleases() {
  $('home-fresh-releases-retry').addEventListener('click', function () { renderListenbrainzFreshReleases(true); });
}
