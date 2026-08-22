'use strict';

const RADIO_PREFERENCES_VERSION = 1;
const RADIO_BLOCKLIST_LIMIT = 500;
const RADIO_PREFERENCE_DEFAULTS = {
  version: RADIO_PREFERENCES_VERSION,
  excludeKnownTracks: true,
  avoidClean: true,
  avoidLive: true,
  avoidCovers: true,
  avoidRemixes: true,
  avoidSlowedSped: true,
  discoveryDepth: 0.5,
};

function radioNormalizeText(value) {
  return String(value || '').normalize('NFKC').replace(/[\u2010-\u2015]/g, '-').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US');
}
function radioNormalizeMbid(value) {
  var mbid = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(mbid) ? mbid : '';
}
function radioTrackKey(track) {
  var mbid = radioNormalizeMbid(track && (track.trackMbid || track.recordingMbid || track.mbid));
  if (mbid) return 'mbid:' + mbid;
  var artist = radioNormalizeText(track && track.artist); var title = radioNormalizeText(track && (track.title || track.name));
  return artist && title ? 'name:' + artist + '::' + title : '';
}
function radioArtistKey(track) {
  var mbid = radioNormalizeMbid(track && (track.artistMbid || track.artist && track.artist.mbid));
  if (mbid) return 'mbid:' + mbid;
  var artist = radioNormalizeText(track && (track.artist || track.name));
  return artist ? 'name:' + artist : '';
}
function radioDisplayTrack(track) { return { key: radioTrackKey(track), artist: String(track && track.artist || '').trim().slice(0, 500), title: String(track && (track.title || track.name) || '').trim().slice(0, 500) }; }
function radioDisplayArtist(track) { return { key: radioArtistKey(track), artist: String(track && (track.artist || track.name) || '').trim().slice(0, 500) }; }
function sanitizeRadioPreferences(value) {
  var source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  var result = Object.assign({}, RADIO_PREFERENCE_DEFAULTS);
  ['excludeKnownTracks', 'avoidClean', 'avoidLive', 'avoidCovers', 'avoidRemixes', 'avoidSlowedSped'].forEach(function (key) { if (typeof source[key] === 'boolean') result[key] = source[key]; });
  if (typeof source.discoveryDepth === 'number' && Number.isFinite(source.discoveryDepth) && source.discoveryDepth >= 0 && source.discoveryDepth <= 1) result.discoveryDepth = source.discoveryDepth;
  return result;
}
function sanitizeBlocked(entries, type) {
  var seen = new Set();
  return (Array.isArray(entries) ? entries : []).slice(0, RADIO_BLOCKLIST_LIMIT).map(function (entry) {
    var item = type === 'track' ? radioDisplayTrack(entry) : radioDisplayArtist(entry);
    return item.key ? item : null;
  }).filter(function (item) { if (!item || seen.has(item.key)) return false; seen.add(item.key); return true; });
}
function sanitizeRadioBlocklist(value) {
  var source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  return { version: RADIO_PREFERENCES_VERSION, tracks: sanitizeBlocked(source.tracks, 'track'), artists: sanitizeBlocked(source.artists, 'artist') };
}
function isBlocked(candidate, blocklist) {
  var list = sanitizeRadioBlocklist(blocklist);
  var trackKey = radioTrackKey(candidate); var artistKey = radioArtistKey(candidate);
  return { track: !!trackKey && list.tracks.some(function (entry) { return entry.key === trackKey; }), artist: !!artistKey && list.artists.some(function (entry) { return entry.key === artistKey; }) };
}
var radioPreferencesApi = { RADIO_PREFERENCES_VERSION, RADIO_BLOCKLIST_LIMIT, RADIO_PREFERENCE_DEFAULTS, radioNormalizeText, radioTrackKey, radioArtistKey, radioDisplayTrack, radioDisplayArtist, sanitizeRadioPreferences, sanitizeRadioBlocklist, isBlocked };
if (typeof module !== 'undefined' && module.exports) module.exports = radioPreferencesApi;
if (typeof window !== 'undefined') window.RadioPreferences = radioPreferencesApi;
