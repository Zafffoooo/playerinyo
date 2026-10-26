'use strict';

// Provider core only: it has no renderer, IPC, or playback dependencies so
// future local and remote providers can share the same small contract.
const RADIO_BATCH_SIZE = 24;
const RECENT_ITEM_LIMIT = 5;

// Last.fm's tag directory is intentionally represented as a small, versioned
// catalog rather than an unbounded live sync.  These are stable tag spellings
// that can be sent straight to the discovery endpoint; aliases only affect
// finding a tag in the Radio UI.
const LASTFM_GENRE_CATALOG = [
  ['rock', 'Rock', true], ['pop', 'Pop', true], ['electronic', 'Electronic', true], ['hip-hop', 'Hip-Hop', true],
  ['indie', 'Indie', true], ['ambient', 'Ambient', true], ['jazz', 'Jazz', true], ['metal', 'Metal', true],
  ['trip-hop', 'Trip-Hop', true], ['alternative', 'Alternative', true], ['post-punk', 'Post-Punk', true], ['dream-pop', 'Dream Pop', true],
  ['shoegaze', 'Shoegaze', true], ['industrial', 'Industrial', true], ['synthpop', 'Synthpop', true], ['darkwave', 'Darkwave', true],
  ['acoustic', 'Acoustic'], ['afrobeat', 'Afrobeat'], ['americana', 'Americana'], ['art-pop', 'Art Pop'], ['art-rock', 'Art Rock'],
  ['black-metal', 'Black Metal'], ['bluegrass', 'Bluegrass'], ['blues', 'Blues'], ['bossa-nova', 'Bossa Nova'], ['breakbeat', 'Breakbeat'],
  ['britpop', 'Britpop'], ['chamber-pop', 'Chamber Pop'], ['chillout', 'Chillout'], ['classical', 'Classical'], ['country', 'Country'],
  ['dance', 'Dance'], ['dance-punk', 'Dance Punk'], ['death-metal', 'Death Metal'], ['disco', 'Disco'], ['downtempo', 'Downtempo'],
  ['drum-and-bass', 'Drum and Bass'], ['dub', 'Dub'], ['dubstep', 'Dubstep'], ['emo', 'Emo'], ['ethereal', 'Ethereal'],
  ['experimental', 'Experimental'], ['folk', 'Folk'], ['funk', 'Funk'], ['gothic-rock', 'Gothic Rock'], ['grime', 'Grime'],
  ['grunge', 'Grunge'], ['hardcore', 'Hardcore'], ['hard-rock', 'Hard Rock'], ['house', 'House'], ['idm', 'IDM'],
  ['indie-pop', 'Indie Pop'], ['indie-rock', 'Indie Rock'], ['j-pop', 'J-Pop'], ['k-pop', 'K-Pop'], ['lo-fi', 'Lo-Fi'],
  ['minimal', 'Minimal'], ['new-wave', 'New Wave'], ['noise', 'Noise'], ['post-rock', 'Post-Rock'], ['power-pop', 'Power Pop'],
  ['progressive-rock', 'Progressive Rock'], ['psychedelic', 'Psychedelic'], ['punk', 'Punk'], ['r-and-b', 'R&B'], ['rap', 'Rap'],
  ['reggae', 'Reggae'], ['rock-and-roll', 'Rock and Roll'], ['soul', 'Soul'], ['soundtrack', 'Soundtrack'], ['techno', 'Techno'],
  ['trance', 'Trance'], ['trap', 'Trap'], ['vaporwave', 'Vaporwave'], ['world', 'World Music'],
  ['a-cappella', 'A Cappella'], ['alternative-country', 'Alternative Country'], ['anime', 'Anime'], ['arabic', 'Arabic'],
  ['avant-garde', 'Avant-Garde'], ['baroque', 'Baroque'], ['bebop', 'Bebop'], ['bollywood', 'Bollywood'], ['celtic', 'Celtic'],
  ['chiptune', 'Chiptune'], ['comedy', 'Comedy'], ['contemporary-classical', 'Contemporary Classical'], ['cool-jazz', 'Cool Jazz'],
  ['dancehall', 'Dancehall'], ['deep-house', 'Deep House'], ['disco-house', 'Disco House'], ['drone', 'Drone'], ['electro', 'Electro'],
  ['electropop', 'Electropop'], ['emo-rap', 'Emo Rap'], ['folk-rock', 'Folk Rock'], ['french-pop', 'French Pop'], ['fusion', 'Fusion'],
  ['garage', 'Garage'], ['garage-rock', 'Garage Rock'], ['glitch', 'Glitch'], ['gospel', 'Gospel'], ['happy-hardcore', 'Happy Hardcore'],
  ['heavy-metal', 'Heavy Metal'], ['indie-folk', 'Indie Folk'], ['instrumental', 'Instrumental'], ['latin', 'Latin'], ['math-rock', 'Math Rock'],
  ['melodic-death-metal', 'Melodic Death Metal'], ['minimal-techno', 'Minimal Techno'], ['neoclassical', 'Neoclassical'], ['nu-metal', 'Nu Metal'],
  ['opera', 'Opera'], ['orchestral', 'Orchestral'], ['piano', 'Piano'], ['pop-punk', 'Pop Punk'], ['progressive-metal', 'Progressive Metal'],
  ['psychedelic-rock', 'Psychedelic Rock'], ['reggae-rock', 'Reggae Rock'], ['singer-songwriter', 'Singer-Songwriter'], ['ska', 'Ska'],
  ['sludge-metal', 'Sludge Metal'], ['smooth-jazz', 'Smooth Jazz'], ['space-rock', 'Space Rock'], ['spoken-word', 'Spoken Word'],
  ['surf-rock', 'Surf Rock'], ['swing', 'Swing'], ['symphonic-metal', 'Symphonic Metal'], ['traditional', 'Traditional'],
  ['uk-garage', 'UK Garage'], ['worship', 'Worship']
].map(([id, label, pinned]) => ({ id, label, pinned: pinned === true }));

const LASTFM_GENRE_ALIASES = {
  'hip hop': 'hip-hop', hiphop: 'hip-hop',
  'trip hop': 'trip-hop', triphop: 'trip-hop',
  'dream pop': 'dream-pop', dreampop: 'dream-pop',
  'post punk': 'post-punk', postpunk: 'post-punk',
  'art pop': 'art-pop', 'art rock': 'art-rock', 'black metal': 'black-metal', 'bossa nova': 'bossa-nova',
  'drum and bass': 'drum-and-bass', dnb: 'drum-and-bass', 'hard rock': 'hard-rock',
  'indie pop': 'indie-pop', 'indie rock': 'indie-rock', 'new wave': 'new-wave', 'post rock': 'post-rock',
  'r&b': 'r-and-b', 'r and b': 'r-and-b', 'rock n roll': 'rock-and-roll', 'rock and roll': 'rock-and-roll',
  acapella: 'a-cappella', 'a cappella': 'a-cappella', 'alternative country': 'alternative-country',
  'deep house': 'deep-house', 'disco house': 'disco-house', 'emo rap': 'emo-rap', 'folk rock': 'folk-rock',
  electropop: 'electropop', 'garage rock': 'garage-rock', 'happy hardcore': 'happy-hardcore', 'heavy metal': 'heavy-metal',
  'indie folk': 'indie-folk', 'math rock': 'math-rock', 'melodic death metal': 'melodic-death-metal',
  'minimal techno': 'minimal-techno', 'nu metal': 'nu-metal', 'pop punk': 'pop-punk', 'progressive metal': 'progressive-metal',
  'psychedelic rock': 'psychedelic-rock', 'singer songwriter': 'singer-songwriter', 'smooth jazz': 'smooth-jazz',
  'space rock': 'space-rock', 'spoken word': 'spoken-word', 'surf rock': 'surf-rock', 'symphonic metal': 'symphonic-metal',
  'uk garage': 'uk-garage'
};

function normalizeGenreKey(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeLastfmGenreKey(value) {
  var normalized = normalizeGenreKey(value).replace(/[‐‑‒–—]/g, '-').replace(/\s+/g, ' ');
  return LASTFM_GENRE_ALIASES[normalized] || normalized;
}

function getLastfmGenreCatalog() {
  return LASTFM_GENRE_CATALOG.map((genre) => Object.assign({}, genre));
}

function searchLastfmGenreCatalog(query) {
  var normalized = normalizeLastfmGenreKey(query);
  if (!normalized) return getLastfmGenreCatalog();
  var compact = normalized.replace(/[-\s]/g, '');
  return getLastfmGenreCatalog().filter((genre) => {
    var id = genre.id.toLowerCase();
    var label = genre.label.toLowerCase();
    return id.includes(normalized) || label.includes(normalized) || id.replace(/-/g, '').includes(compact) || label.replace(/[\s-]/g, '').includes(compact);
  });
}

function getGenreLabels(file) {
  return String(file && file.genre || '')
    .split(/[;,]/)
    .map((genre) => genre.trim())
    .filter(Boolean);
}

function getTrackId(file) {
  return file && file.filePath ? `local:${file.filePath}` : '';
}

function isPlayableFile(file, missingFilePaths) {
  return !!(file && file.filePath && !(missingFilePaths && missingFilePaths.has(file.filePath)));
}

function makeRadioItem(file) {
  return {
    id: getTrackId(file),
    providerId: 'local-library',
    title: file.title || file.filename || 'Unknown Track',
    artist: file.artist || file.albumArtist || 'Unknown Artist',
    album: file.album || 'Unknown Album',
    genres: getGenreLabels(file),
    duration: Number(file.duration) || 0,
    artwork: file.picture || '',
    playback: { kind: 'local-file', filePath: file.filePath },
  };
}

function randomIndex(length, random) {
  return Math.floor((random || Math.random)() * length);
}

function removeCandidate(candidates, item) {
  var index = candidates.indexOf(item);
  if (index !== -1) candidates.splice(index, 1);
}

function chooseNextCandidate(candidates, recentItemIds, previousArtist, random) {
  var withoutRecent = candidates.filter((file) => !recentItemIds.includes(getTrackId(file)));
  var recentSafe = withoutRecent.length ? withoutRecent : candidates;
  var differentArtist = recentSafe.filter((file) => String(file.artist || file.albumArtist || '').toLowerCase() !== previousArtist);
  var pool = differentArtist.length ? differentArtist : recentSafe;
  return pool[randomIndex(pool.length, random)];
}

function selectBatch(cycleCandidates, allCandidates, recentItemIds, random, requestedCount) {
  var remaining = cycleCandidates.slice();
  var recent = recentItemIds.slice(-RECENT_ITEM_LIMIT);
  var selected = [];
  var previousArtist = '';
  while (selected.length < requestedCount && allCandidates.length) {
    if (!remaining.length) remaining = allCandidates.slice();
    var next = chooseNextCandidate(remaining, recent, previousArtist, random);
    if (!next) break;
    removeCandidate(remaining, next);
    selected.push(next);
    recent.push(getTrackId(next));
    recent = recent.slice(-RECENT_ITEM_LIMIT);
    previousArtist = String(next.artist || next.albumArtist || '').toLocaleLowerCase();
  }
  return { selected, remaining, recentItemIds: recent };
}

function createLocalLibraryProvider() {
  return {
    id: 'local-library',
    label: 'Local Library',
    capabilities: { genres: true, continuous: true, playbackKinds: ['local-file'] },

    async listGenres(context) {
      var catalog = new Map();
      var missing = context && context.missingFilePaths;
      (context && context.musicFiles || []).forEach((file) => {
        if (!isPlayableFile(file, missing)) return;
        var fileGenreKeys = new Set();
        getGenreLabels(file).forEach((label) => {
          var key = normalizeGenreKey(label);
          if (!key || fileGenreKeys.has(key)) return;
          fileGenreKeys.add(key);
          var existing = catalog.get(key);
          if (existing) existing.trackCount++;
          else catalog.set(key, { id: key, label, trackCount: 1 });
        });
      });
      return Array.from(catalog.values()).sort((a, b) => a.label.localeCompare(b.label));
    },

    async startStation(request, context) {
      var genreIds = Array.from(new Set((request && request.genreIds || []).map(normalizeGenreKey).filter(Boolean)));
      var missing = context && context.missingFilePaths;
      var candidates = (context && context.musicFiles || []).filter((file) => {
        if (!isPlayableFile(file, missing)) return false;
        var keys = getGenreLabels(file).map(normalizeGenreKey);
        return genreIds.some((genreId) => keys.includes(genreId));
      });
      var selection = selectBatch(candidates, candidates, [], context && context.random, RADIO_BATCH_SIZE);
      return {
        items: selection.selected.map(makeRadioItem),
        providerSession: {
          genreIds,
          remainingItemIds: selection.remaining.map(getTrackId),
          recentItemIds: selection.recentItemIds,
        },
        exhausted: candidates.length === 0,
      };
    },

    async nextBatch(providerSession, request, context) {
      var session = providerSession || {};
      var genreIds = Array.from(new Set((session.genreIds || request && request.genreIds || []).map(normalizeGenreKey).filter(Boolean)));
      var missing = context && context.missingFilePaths;
      var candidates = (context && context.musicFiles || []).filter((file) => {
        if (!isPlayableFile(file, missing)) return false;
        var keys = getGenreLabels(file).map(normalizeGenreKey);
        return genreIds.some((genreId) => keys.includes(genreId));
      });
      var byId = new Map(candidates.map((file) => [getTrackId(file), file]));
      var cycleCandidates = (session.remainingItemIds || []).map((id) => byId.get(id)).filter(Boolean);
      var selection = selectBatch(cycleCandidates, candidates, session.recentItemIds || [], context && context.random, RADIO_BATCH_SIZE);
      return {
        items: selection.selected.map(makeRadioItem),
        providerSession: {
          genreIds,
          remainingItemIds: selection.remaining.map(getTrackId),
          recentItemIds: selection.recentItemIds,
        },
        exhausted: candidates.length === 0,
      };
    },

    async dispose() {},
  };
}

// This adapter deliberately returns discovery candidates, not playable tracks.
// It is registered only when a caller explicitly opts in; Phase 4A keeps the
// Local Library as the sole UI-startable provider.
function createLastfmProvider(client) {
  function normalizeSession(value, fallbackRequest) {
    var source = value && typeof value === 'object' ? value : {};
    if (source.version !== 1) return null;
    var genreIds = Array.from(new Set((source.genreIds || fallbackRequest && fallbackRequest.genreIds || []).map(normalizeGenreKey).filter(Boolean)));
    var poolKey = typeof source.poolKey === 'string' ? source.poolKey.slice(0, 240) : '';
    if (!genreIds.length || !poolKey) return null;
    return {
      version: 1,
      genreIds: genreIds,
      mode: 'balanced',
      excludeKnownTracks: fallbackRequest && typeof fallbackRequest.excludeKnownTracks === 'boolean' ? fallbackRequest.excludeKnownTracks : source.excludeKnownTracks === true,
      poolKey: poolKey,
      remainingItemIds: Array.isArray(source.remainingItemIds) ? source.remainingItemIds.map(String).filter(Boolean).slice(0, 2000) : [],
      recentItemIds: Array.isArray(source.recentItemIds) ? source.recentItemIds.map(String).filter(Boolean).slice(-RECENT_ITEM_LIMIT) : [],
      lastArtistKey: typeof source.lastArtistKey === 'string' ? source.lastArtistKey.slice(0, 500) : '',
    };
  }
  return {
    id: 'lastfm',
    label: 'Last.fm Discovery',
    capabilities: { genres: true, continuous: true, playbackKinds: [], producesCandidates: true },
    normalizeSession: normalizeSession,
    async listGenres() { return getLastfmGenreCatalog(); },
    async startStation(request, context) {
      if (!client || !client.start) throw new Error('Last.fm discovery client is unavailable.');
      var result = await client.start({ genreIds: request && request.genreIds || [], mode: 'balanced', excludeKnownTracks: !!(request && request.excludeKnownTracks), discoveryDepth: request && request.discoveryDepth, stationId: request && request.stationId || '' }, context);
      return { ...result, providerSession: normalizeSession(result && result.providerSession, request) };
    },
    async nextBatch(providerSession, request, context) {
      if (!client || !client.next) throw new Error('Last.fm discovery client is unavailable.');
      var session = normalizeSession(providerSession, request);
      if (!session) return { items: [], providerSession: null, exhausted: true };
      var result = await client.next(session, request && { discoveryDepth: request.discoveryDepth, excludeKnownTracks: request.excludeKnownTracks === true, similarityBias: request.similarityBias });
      return { ...result, providerSession: normalizeSession(result && result.providerSession, request) };
    },
    async dispose() {},
  };
}

function createSongRadioProvider(client) {
  function encode(item) {
    return JSON.stringify([String(item.artist || '').slice(0, 200), String(item.title || '').slice(0, 300), String(item.trackMbid || '').slice(0, 80), String(item.album || '').slice(0, 300), Math.max(0, Number(item.duration) || 0)]);
  }
  function decode(value) {
    try {
      var row = JSON.parse(value);
      if (!Array.isArray(row) || !row[0] || !row[1]) return null;
      var artist = String(row[0]), title = String(row[1]);
      return { id: 'song-radio:' + artist.toLocaleLowerCase() + '::' + title.toLocaleLowerCase(), providerId: 'lastfm', itemKind: 'candidate', artist: artist, title: title, trackMbid: String(row[2] || ''), album: String(row[3] || ''), duration: Number(row[4]) || 0 };
    } catch (_) { return null; }
  }
  function takeBatch(session) {
    var pending = Array.isArray(session.remainingItemIds) ? session.remainingItemIds : [];
    var items = pending.slice(0, RADIO_BATCH_SIZE).map(decode).filter(Boolean);
    var next = { genreIds: session.genreIds, remainingItemIds: pending.slice(RADIO_BATCH_SIZE), recentItemIds: [] };
    return { items: items, providerSession: next, exhausted: next.remainingItemIds.length === 0 };
  }
  return {
    id: 'song-radio', label: 'Song Radio',
    capabilities: { genres: false, continuous: true, playbackKinds: [], producesCandidates: true },
    async listGenres() { return []; },
    async startStation(request) {
      var result = await client.similar(request.seed);
      if (result.error) throw new Error(result.error);
      var session = { genreIds: request.genreIds, remainingItemIds: (result.items || []).slice(0, 100).map(encode), recentItemIds: [] };
      return takeBatch(session);
    },
    async nextBatch(session) { return takeBatch(session || { genreIds: [], remainingItemIds: [] }); },
    async dispose() {},
  };
}

function createRadioProviderRegistry(providers) {
  var byId = new Map();
  (providers || []).forEach((provider) => {
    if (!provider || !provider.id || byId.has(provider.id)) throw new Error('Radio provider IDs must be unique.');
    byId.set(provider.id, provider);
  });
  return {
    list: () => Array.from(byId.values()),
    get: (id) => byId.get(id) || null,
  };
}

var radioProviderApi = {
  RADIO_BATCH_SIZE,
  RECENT_ITEM_LIMIT,
  createLocalLibraryProvider,
  createLastfmProvider,
  createSongRadioProvider,
  createRadioProviderRegistry,
  getGenreLabels,
  normalizeGenreKey,
  normalizeLastfmGenreKey,
  getLastfmGenreCatalog,
  searchLastfmGenreCatalog,
};

if (typeof module !== 'undefined' && module.exports) module.exports = radioProviderApi;
if (typeof window !== 'undefined') window.RadioProviders = radioProviderApi;
