'use strict';

const { candidateFromTrack, getCandidateIdentity, getCandidateAliasIdentity, normalizeMbid } = require('./lastfm-discovery');
const { musicBrainzTagForGenre } = require('./radio-providers');

function createListenbrainzRadio({ request, resolveArtist, similarArtists, deezer }) {
  async function recordingRows(rows) {
    const ids = [...new Set(rows.map(row => normalizeMbid(row?.recording_mbid)).filter(Boolean))].slice(0, 100);
    if (!ids.length) return [];
    const batches = [];
    for (let i = 0; i < ids.length; i += 40) {
      batches.push(request('metadata/recording/?' + new URLSearchParams({
        recording_mbids: ids.slice(i, i + 40).join(','), inc: 'artist release',
      })));
    }
    const metadata = Object.assign({}, ...await Promise.all(batches));
    return ids.map(id => {
      const row = metadata[id];
      return {
        mbid: id, name: row?.recording?.name, artistName: row?.artist?.name,
        album: row?.release?.name, duration: Number(row?.recording?.length) / 1000,
      };
    });
  }

  async function genrePools(genre) {
    const tag = musicBrainzTagForGenre(genre);
    if (!tag) throw new Error('Choose a supported genre.');
    const pools = { core: [], discovery: [], deep: [] };
    const ranges = [['core', 70, 100], ['discovery', 30, 70], ['deep', 0, 30]];
    const responses = await Promise.all(ranges.map(([, begin, end]) => request('lb-radio/tags?' + new URLSearchParams({
      tag, pop_begin: begin, pop_end: end, count: 32,
    }))));
    if (responses.some(rows => !Array.isArray(rows))) throw new Error('Invalid ListenBrainz genre response.');
    const groups = new Map();
    responses.forEach((rows, i) => rows.forEach(row => groups.set(row.recording_mbid, ranges[i][0])));
    const rows = await recordingRows([...groups.keys()].map(recording_mbid => ({ recording_mbid })));
    const seen = new Set();
    rows.forEach((row, index) => {
      const tier = groups.get(row.mbid);
      const item = candidateFromTrack(row, { providerId: 'listenbrainz', genreId: genre, rank: index + 1, tier, source: 'tag-top-tracks' });
      const key = item && getCandidateAliasIdentity(item);
      if (!item || seen.has(key)) return;
      seen.add(key);
      pools[tier].push(item);
    });
    return pools;
  }

  async function songCandidates(seed) {
    const artist = await resolveArtist({ name: seed.artist, mbid: seed.artistMbid }).catch(() => ({ name: seed.artist }));
    const results = [];
    const seedIdentity = getCandidateIdentity(seed);
    const seedAlias = getCandidateAliasIdentity(seed);
    const seen = new Set([seedIdentity, seedAlias]);
    function add(rows) {
      for (const row of rows) {
        const item = candidateFromTrack(row, { providerId: 'listenbrainz', rank: results.length + 1, source: 'similar-track', tier: 'discovery' });
        if (!item) continue;
        const keys = [getCandidateIdentity(item), getCandidateAliasIdentity(item)];
        if (keys.some(key => key && seen.has(key))) continue;
        keys.filter(Boolean).forEach(key => seen.add(key));
        results.push(item);
      }
    }
    if (artist.mbid) {
      const radioRows = await request(`lb-radio/artist/${artist.mbid}?mode=easy&max_similar_artists=10&max_recordings_per_artist=5&pop_begin=40&pop_end=100`).catch(() => null);
      const related = Object.entries(radioRows || {}).filter(([id, rows]) => id !== artist.mbid && Array.isArray(rows));
      add(await recordingRows(related.flatMap(([, rows]) => rows)).catch(() => []));
    }
    if (results.length < 12) {
      const similar = await similarArtists(artist).catch(() => []);
      await Promise.all(similar.slice(0, 5).map(async related => {
        const popular = related.mbid ? await request('popularity/top-recordings-for-artist/' + related.mbid).catch(() => []) : [];
        if (Array.isArray(popular) && popular.length) {
          add(popular.slice(0, 5).map(row => ({ name: row.recording_name, artistName: row.artist_name || related.name, mbid: row.recording_mbid, album: row.release_name, duration: Number(row.length) / 1000 })));
          return;
        }
        const match = related.deezerId ? related : await deezer.findArtist(related.name).catch(() => null);
        if (!match) return;
        const tracks = await deezer.top(match.deezerId).catch(() => []);
        add(tracks.slice(0, 5).filter(row => row?.readable !== false).map(row => ({
          name: row?.title, artistName: row?.artist?.name || related.name, duration: row?.duration, album: row?.album?.title,
        })));
      }));
    }
    return results;
  }
  return { genrePools, songCandidates };
}

module.exports = { createListenbrainzRadio };
