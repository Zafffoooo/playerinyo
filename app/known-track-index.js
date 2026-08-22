'use strict';

const { getArtistTitleKey, normalizeMbid } = require('./lastfm-discovery');

const VERSION = 1;
const SOURCE_LOCAL = 1;
const SOURCE_LASTFM = 2;
const MAX_TRACKS = 250000;
const MAX_SERIALIZED_BYTES = 16 * 1024 * 1024;

function emptySync() {
  return { username: '', initialComplete: false, lastSeenUts: 0, snapshotFromUts: 0, snapshotToUts: 0, resumePage: 1, lastSuccessfulSyncAt: 0 };
}

function createKnownTrackIndex(value) {
  const index = { version: VERSION, normalizationVersion: 1, tracksByMbid: {}, tracksByName: {}, lastfmSync: emptySync() };
  if (value && typeof value === 'object' && value.version === VERSION) {
    ['tracksByMbid', 'tracksByName'].forEach((field) => {
      const input = value[field];
      if (!input || typeof input !== 'object' || Array.isArray(input)) return;
      Object.keys(input).slice(0, MAX_TRACKS).forEach((key) => {
        const row = input[key];
        if (!Array.isArray(row) || row.length < 2) return;
        const timestamp = Math.max(0, Number(row[0]) || 0);
        const sources = Math.max(0, Number(row[1]) || 0) | 0;
        if (timestamp || sources) index[field][key] = [timestamp, sources];
      });
    });
    const sync = value.lastfmSync;
    if (sync && typeof sync === 'object') {
      index.lastfmSync = {
        username: String(sync.username || '').trim().slice(0, 500),
        initialComplete: sync.initialComplete === true,
        lastSeenUts: Math.max(0, Math.floor(Number(sync.lastSeenUts) || 0)),
        snapshotFromUts: Math.max(0, Math.floor(Number(sync.snapshotFromUts) || 0)),
        snapshotToUts: Math.max(0, Math.floor(Number(sync.snapshotToUts) || 0)),
        resumePage: Math.max(1, Math.floor(Number(sync.resumePage) || 1)),
        lastSuccessfulSyncAt: Math.max(0, Math.floor(Number(sync.lastSuccessfulSyncAt) || 0)),
      };
    }
  }
  Object.defineProperty(index, '_counts', { value: { tracksByMbid: Object.keys(index.tracksByMbid).length, tracksByName: Object.keys(index.tracksByName).length }, writable: true, enumerable: false });
  return index;
}

function sourceMask(source) { return source === 'lastfm' ? SOURCE_LASTFM : SOURCE_LOCAL; }

function upsert(map, key, timestamp, source, index, field) {
  if (!key || (!map[key] && index._counts[field] >= MAX_TRACKS)) return false;
  if (!map[key]) index._counts[field]++;
  const previous = map[key] || [0, 0];
  map[key] = [Math.max(previous[0], timestamp), previous[1] | source];
  return true;
}

function indexTrack(index, track, source, heardAt) {
  if (!index || !track) return false;
  const suppliedTimestamp = Number(heardAt);
  const timestamp = Number.isFinite(suppliedTimestamp) ? Math.max(0, Math.floor(suppliedTimestamp)) : Math.floor(Date.now() / 1000);
  const mask = sourceMask(source);
  const mbid = normalizeMbid(track.trackMbid || track.mbid);
  const nameKey = getArtistTitleKey(track.artist, track.title || track.name);
  if (!mbid && !nameKey) return false;
  const mbidIndexed = mbid ? upsert(index.tracksByMbid, mbid, timestamp, mask, index, 'tracksByMbid') : false;
  const nameIndexed = nameKey ? upsert(index.tracksByName, nameKey, timestamp, mask, index, 'tracksByName') : false;
  return mbidIndexed || nameIndexed;
}

function hasKnownTrack(index, track) {
  if (!index || !track) return false;
  const mbid = normalizeMbid(track.trackMbid || track.mbid);
  if (mbid && index.tracksByMbid[mbid]) return true;
  const nameKey = getArtistTitleKey(track.artist, track.title || track.name);
  return !!(nameKey && index.tracksByName[nameKey]);
}

function seedFromHistory(index, tracks) {
  (Array.isArray(tracks) ? tracks : []).forEach((track) => indexTrack(index, track, 'local', 0));
  return index;
}

function beginLastfmSync(index, username, nowUts, overlapSeconds) {
  username = String(username || '').trim();
  if (!username) return false;
  const now = Math.max(0, Math.floor(nowUts || Date.now() / 1000));
  if (index.lastfmSync.username !== username) {
    // A Last.fm profile is user-specific. Keep app-local history, but remove
    // the previous profile's contribution before a new profile is synced.
    ['tracksByMbid', 'tracksByName'].forEach((field) => {
      Object.keys(index[field]).forEach((key) => {
        const row = index[field][key];
        const retained = row[1] & SOURCE_LOCAL;
        if (retained) index[field][key] = [row[0], retained];
        else { delete index[field][key]; index._counts[field]--; }
      });
    });
    index.lastfmSync = { ...emptySync(), username, snapshotToUts: now };
    return true;
  }
  // A page cursor must always continue within the same temporal window.  In
  // particular, do not advance `from` after page one has updated lastSeenUts.
  if (!index.lastfmSync.snapshotToUts) {
    index.lastfmSync.snapshotToUts = now;
    index.lastfmSync.snapshotFromUts = index.lastfmSync.initialComplete
      ? Math.max(0, index.lastfmSync.lastSeenUts - Math.max(0, Number(overlapSeconds) || 300))
      : 0;
  }
  return false;
}

function getLastfmRecentTracksRequest(index, username) {
  const sync = index && index.lastfmSync;
  if (!sync || !String(username || '').trim() || !sync.snapshotToUts) return null;
  const params = { user: String(username).trim(), limit: 200, page: Math.max(1, Math.floor(Number(sync.resumePage) || 1)), to: sync.snapshotToUts };
  if (sync.initialComplete) params.from = sync.snapshotFromUts;
  return params;
}

function validateLastfmRecentTracksResponse(response) {
  const recent = response && typeof response === 'object' && !Array.isArray(response) ? response.recenttracks : null;
  const attr = recent && typeof recent === 'object' && !Array.isArray(recent) ? recent['@attr'] : null;
  if (!recent || !attr || typeof attr !== 'object' || Array.isArray(attr)
    || !Number.isFinite(Number(attr.page)) || !Number.isFinite(Number(attr.totalPages))) {
    const error = new Error('Last.fm recent tracks response has an invalid shape.');
    error.code = 'malformed-response';
    throw error;
  }
  if (recent.track !== undefined && !Array.isArray(recent.track) && (typeof recent.track !== 'object' || recent.track === null)) {
    const error = new Error('Last.fm recent tracks response has an invalid track list.');
    error.code = 'malformed-response';
    throw error;
  }
  return recent;
}

function ingestLastfmRecentPage(index, response, username, nowUts) {
  beginLastfmSync(index, username, nowUts);
  const recent = validateLastfmRecentTracksResponse(response);
  const tracks = recent && Array.isArray(recent.track) ? recent.track : recent && recent.track ? [recent.track] : [];
  let maxUts = index.lastfmSync.lastSeenUts;
  tracks.forEach((track) => {
    if (!track || (track['@attr'] && String(track['@attr'].nowplaying) === 'true')) return;
    const uts = Math.max(0, Math.floor(Number(track.date && track.date.uts) || 0));
    if (!uts) return;
    const artist = track.artist && (track.artist['#text'] || track.artist.name) || '';
    indexTrack(index, { artist, title: track.name, mbid: track.mbid }, 'lastfm', uts);
    maxUts = Math.max(maxUts, uts);
  });
  const attr = recent && recent['@attr'] || {};
  const page = Math.max(1, Math.floor(Number(attr.page) || index.lastfmSync.resumePage || 1));
  const totalPages = Math.max(page, Math.floor(Number(attr.totalPages) || page));
  index.lastfmSync.lastSeenUts = maxUts;
  index.lastfmSync.resumePage = page < totalPages ? page + 1 : 1;
  if (page >= totalPages) {
    index.lastfmSync.initialComplete = true;
    index.lastfmSync.snapshotFromUts = 0;
    index.lastfmSync.snapshotToUts = 0;
    index.lastfmSync.lastSuccessfulSyncAt = Math.max(0, Math.floor(nowUts || Date.now() / 1000));
  }
  return { nextPage: index.lastfmSync.resumePage, complete: page >= totalPages, lastSeenUts: maxUts };
}

function serializeKnownTrackIndex(index, maxBytes) {
  const limit = Math.max(1024, Number(maxBytes) || MAX_SERIALIZED_BYTES);
  const value = createKnownTrackIndex(index);
  const output = { version: VERSION, normalizationVersion: 1, tracksByMbid: {}, tracksByName: {}, lastfmSync: value.lastfmSync };
  // Preserve newest rows first and stop before a bounded on-disk index can
  // grow without limit. The final byte check is exact, not an estimate.
  let usedBytes = Buffer.byteLength(JSON.stringify(output), 'utf8');
  ['tracksByMbid', 'tracksByName'].forEach((field) => {
    Object.entries(value[field])
      .sort((a, b) => b[1][0] - a[1][0])
      .forEach(([key, row]) => {
        if (Buffer.byteLength(key, 'utf8') > 1024) return;
        const rowBytes = Buffer.byteLength(JSON.stringify(key), 'utf8') + Buffer.byteLength(JSON.stringify(row), 'utf8') + 2;
        if (usedBytes + rowBytes > limit) return;
        output[field][key] = row;
        usedBytes += rowBytes;
      });
  });
  return JSON.stringify(output);
}

function getIncrementalFrom(index, overlapSeconds) {
  return Math.max(0, Number(index && index.lastfmSync && index.lastfmSync.lastSeenUts || 0) - Math.max(0, Number(overlapSeconds) || 300));
}

module.exports = {
  VERSION,
  SOURCE_LOCAL,
  SOURCE_LASTFM,
  MAX_TRACKS,
  createKnownTrackIndex,
  indexTrack,
  hasKnownTrack,
  seedFromHistory,
  beginLastfmSync,
  getLastfmRecentTracksRequest,
  validateLastfmRecentTracksResponse,
  ingestLastfmRecentPage,
  getIncrementalFrom,
  MAX_SERIALIZED_BYTES,
  serializeKnownTrackIndex,
};
