'use strict';

// Pure Last.fm discovery helpers.  Keeping selection here makes the provider
// independently testable and prevents raw API shapes from leaking into Radio.
const TIER_TARGETS = { core: 10, discovery: 9, deep: 5 };
const TIER_ORDER = ['core', 'discovery', 'deep'];
const RECENT_ITEM_LIMIT = 5;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('en-US');
}

function normalizeGenreKey(value) {
  return normalizeText(value);
}

function hasGenreTag(genre, tags) {
  const genreKey = normalizeGenreKey(genre).replace(/[\s-]+/g, '');
  return !!genreKey && asArray(tags).some((tag) => normalizeGenreKey(tag && tag.name || tag).replace(/[\s-]+/g, '') === genreKey);
}

function normalizeMbid(value) {
  const mbid = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(mbid) ? mbid : '';
}

function getArtistTitleKey(artist, title) {
  const normalizedArtist = normalizeText(artist);
  const normalizedTitle = normalizeText(title);
  return normalizedArtist && normalizedTitle ? `${normalizedArtist}::${normalizedTitle}` : '';
}

function getCandidateIdentity(track) {
  if (!track) return '';
  const mbid = normalizeMbid(track.trackMbid || track.mbid);
  if (mbid) return `mbid:${mbid}`;
  const fallback = getArtistTitleKey(track.artist, track.title || track.name);
  return fallback ? `name:${fallback}` : '';
}

function getCandidateAliasIdentity(track) {
  if (!track) return '';
  const fallback = getArtistTitleKey(track.artist, track.title || track.name);
  return fallback ? `name:${fallback}` : '';
}

function tierWeight(tier) {
  return tier === 'core' ? 3 : tier === 'discovery' ? 2 : 1;
}

function sourcePriority(source) {
  return {
    'tag-top-tracks': 5,
    'artist-top-tracks': 4,
    'similar-artist-top-tracks': 3,
    'similar-tag-top-tracks': 2,
  }[source] || 0;
}

function tierForTagRank(rank) {
  if (rank <= 80) return 'core';
  if (rank <= 170) return 'discovery';
  return 'deep';
}

function candidateFromTrack(track, options) {
  options = options || {};
  const artist = track && (track.artist && (track.artist.name || track.artist['#text']) || track.artistName) || options.artist || '';
  const title = track && (track.name || track.title) || '';
  if (!String(artist).trim() || !String(title).trim()) return null;
  const rank = Math.max(1, Number(options.rank || (track && track['@attr'] && track['@attr'].rank) || 9999) || 9999);
  const candidate = {
    providerId: 'lastfm',
    itemKind: 'candidate',
    artist: String(artist).trim(),
    title: String(title).trim(),
    album: String(track && track.album && (track.album.title || track.album['#text']) || track && track.album || '').trim(),
    duration: Math.max(0, Number(track && track.duration) || 0),
    trackMbid: normalizeMbid(track && track.mbid),
    artistMbid: normalizeMbid(track && track.artist && track.artist.mbid || options.artistMbid),
    lastfmUrl: String(track && track.url || '').trim(),
    discovery: {
      genreId: normalizeGenreKey(options.genreId),
      tier: options.tier || tierForTagRank(rank),
      source: options.source || 'tag-top-tracks',
      rank,
    },
  };
  candidate.id = `lastfm:track:${getCandidateIdentity(candidate)}`;
  return getCandidateIdentity(candidate) ? candidate : null;
}

function mergeCandidate(map, aliases, candidate) {
  if (!candidate) return;
  const identity = getCandidateIdentity(candidate);
  const alias = getCandidateAliasIdentity(candidate);
  const previousIdentity = map.has(identity) ? identity : aliases.get(alias);
  const previous = previousIdentity && map.get(previousIdentity);
  if (!previous) {
    map.set(identity, candidate);
    if (alias) aliases.set(alias, identity);
    return;
  }
  const previousTier = tierWeight(previous.discovery.tier);
  const currentTier = tierWeight(candidate.discovery.tier);
  const candidateHasMbid = !!normalizeMbid(candidate.trackMbid || candidate.mbid);
  const previousHasMbid = !!normalizeMbid(previous.trackMbid || previous.mbid);
  const shouldReplace = candidateHasMbid !== previousHasMbid ? candidateHasMbid : currentTier > previousTier
    || (currentTier === previousTier && candidate.discovery.rank < previous.discovery.rank)
    || (currentTier === previousTier && candidate.discovery.rank === previous.discovery.rank
      && sourcePriority(candidate.discovery.source) > sourcePriority(previous.discovery.source));
  const winner = shouldReplace ? candidate : previous;
  // Prefer the MBID identity when either endpoint supplied it, while retaining
  // the artist/title alias so MBID-less duplicates collapse into the same row.
  const winnerIdentity = getCandidateIdentity(winner);
  if (previousIdentity !== winnerIdentity) map.delete(previousIdentity);
  map.set(winnerIdentity, winner);
  if (alias) aliases.set(alias, winnerIdentity);
  const previousAlias = getCandidateAliasIdentity(previous);
  if (previousAlias) aliases.set(previousAlias, winnerIdentity);
}

function asArray(value) { return Array.isArray(value) ? value : []; }

function buildCandidatePools(input) {
  input = input || {};
  const genreId = normalizeGenreKey(input.genreId);
  const candidates = new Map();
  const aliases = new Map();
  asArray(input.topTracks).forEach((track, index) => {
    const rank = Number(track && track['@attr'] && track['@attr'].rank) || index + 1;
    mergeCandidate(candidates, aliases, candidateFromTrack(track, { genreId, rank, tier: tierForTagRank(rank), source: 'tag-top-tracks' }));
  });

  const artistTopTracks = input.artistTopTracks || {};
  asArray(input.topArtists).forEach((artist, index) => {
    const artistName = artist && artist.name;
    if (!artistName) return;
    const artistRank = Number(artist && artist['@attr'] && artist['@attr'].rank) || index + 1;
    const tier = artistRank <= 24 ? 'discovery' : 'deep';
    asArray(artistTopTracks[normalizeText(artistName)] || artistTopTracks[artistName]).slice(0, 5).forEach((track, trackIndex) => {
      mergeCandidate(candidates, aliases, candidateFromTrack(track, {
        genreId,
        artist: artistName,
        artistMbid: artist.mbid,
        rank: 1000 + artistRank * 10 + trackIndex,
        tier,
        source: 'artist-top-tracks',
      }));
    });
  });

  asArray(input.similarArtistTracks).slice(0, 20).forEach((track, index) => {
    mergeCandidate(candidates, aliases, candidateFromTrack(track, {
      genreId, rank: 3000 + index, tier: 'deep', source: 'similar-artist-top-tracks',
    }));
  });
  asArray(input.similarTagTracks).slice(0, 30).forEach((track, index) => {
    mergeCandidate(candidates, aliases, candidateFromTrack(track, {
      genreId, rank: 4000 + index, tier: 'deep', source: 'similar-tag-top-tracks',
    }));
  });

  const pools = { core: [], discovery: [], deep: [] };
  candidates.forEach((candidate) => pools[candidate.discovery.tier].push(candidate));
  TIER_ORDER.forEach((tier) => pools[tier].sort((a, b) => a.discovery.rank - b.discovery.rank || a.id.localeCompare(b.id)));
  return pools;
}

function isKnown(candidate, knownTrackIndex) {
  return !!(knownTrackIndex && typeof knownTrackIndex.has === 'function' && knownTrackIndex.has(candidate));
}

function getArtistKey(candidate) { return normalizeText(candidate && candidate.artist); }

function weightedPick(items, random, similarity) {
  if (!items.length) return null;
  // Lower rank is more likely, while the square-root curve deliberately keeps
  // the core pool from becoming a permanent top-24 loop.
  const weights = items.map((item) => {
    const base = 1 / Math.sqrt(Math.max(1, Number(item.discovery && item.discovery.rank) || 1));
    return base * (similarity && similarity.keys && similarity.keys.has(getCandidateIdentity(item)) ? (1 + Math.max(0, Math.min(1, Number(similarity.strength) || 0))) : 1);
  });
  const total = weights.reduce((sum, value) => sum + value, 0);
  let point = (random || Math.random)() * total;
  for (let index = 0; index < items.length; index++) {
    point -= weights[index];
    if (point <= 0) return items[index];
  }
  return items[items.length - 1];
}

function chooseCandidate(pool, usedIds, recentItemIds, previousArtist, knownTrackIndex, excludeKnownTracks, random, similarity) {
  const available = pool.filter((candidate) => {
    const id = getCandidateIdentity(candidate);
    const alias = getCandidateAliasIdentity(candidate);
    return id && !usedIds.has(id) && !usedIds.has(alias) && !recentItemIds.includes(id) && !recentItemIds.includes(alias) && !(excludeKnownTracks && isKnown(candidate, knownTrackIndex));
  });
  if (!available.length) return null;
  const differentArtist = available.filter((candidate) => getArtistKey(candidate) !== previousArtist);
  return weightedPick(differentArtist.length ? differentArtist : available, random, similarity);
}

function makeTierSchedule(requestedCount, tierWeights) {
  const schedule = [];
  // Preserve the incumbent balanced cadence exactly. Depth modes only replace
  // the tier target pattern, never the candidate filters or rank weighting.
  const cycle = !tierWeights ? ['core', 'discovery', 'core', 'deep', 'core', 'discovery'] : [];
  if (tierWeights) TIER_ORDER.forEach((tier) => { for (let i = 0; i < Math.max(1, Math.round(Number(tierWeights[tier]) || 0)); i++) cycle.push(tier); });
  if (!cycle.length) cycle.push('core', 'discovery', 'deep');
  while (schedule.length < requestedCount) schedule.push(cycle[schedule.length % cycle.length]);
  return schedule;
}

function selectDiscoveryBatch(pools, options) {
  options = options || {};
  const requestedCount = Math.max(0, Number(options.requestedCount) || 24);
  const all = TIER_ORDER.flatMap((tier) => asArray(pools && pools[tier]));
  const usedIds = new Set();
  const recentItemIds = asArray(options.recentItemIds).slice(-RECENT_ITEM_LIMIT);
  const selected = [];
  let previousArtist = normalizeText(options.previousArtist);
  const similarity = options.similarity && options.similarity.keys instanceof Set ? options.similarity : null;
  makeTierSchedule(requestedCount, options.tierWeights).forEach((preferredTier) => {
    const similarityWindow = similarity && similarity.remainingSelections === undefined ? requestedCount : Math.max(0, Number(similarity && similarity.remainingSelections) || 0);
    const activeSimilarity = similarity && selected.length < similarityWindow ? similarity : null;
    let next = chooseCandidate(asArray(pools && pools[preferredTier]), usedIds, recentItemIds, previousArtist, options.knownTrackIndex, options.excludeKnownTracks, options.random, activeSimilarity);
    if (!next) next = chooseCandidate(all, usedIds, recentItemIds, previousArtist, options.knownTrackIndex, options.excludeKnownTracks, options.random, activeSimilarity);
    if (!next) return;
    const identity = getCandidateIdentity(next);
    const alias = getCandidateAliasIdentity(next);
    usedIds.add(identity);
    if (alias) usedIds.add(alias);
    recentItemIds.push(identity);
    while (recentItemIds.length > RECENT_ITEM_LIMIT) recentItemIds.shift();
    previousArtist = getArtistKey(next);
    selected.push(next);
  });
  return { selected, recentItemIds, previousArtist };
}

function flattenPools(pools) {
  return TIER_ORDER.flatMap((tier) => asArray(pools && pools[tier]));
}

module.exports = {
  TIER_TARGETS,
  RECENT_ITEM_LIMIT,
  normalizeText,
  normalizeGenreKey,
  hasGenreTag,
  normalizeMbid,
  getArtistTitleKey,
  getCandidateIdentity,
  getCandidateAliasIdentity,
  candidateFromTrack,
  buildCandidatePools,
  selectDiscoveryBatch,
  flattenPools,
};
