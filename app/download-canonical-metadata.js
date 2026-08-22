'use strict';

function text(value, max = 1000) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

// YouTube auto-generated music channels identify themselves as "Artist - Topic".
// Treat only that terminal channel suffix as transport metadata; a standalone
// "Topic" in an artist name remains untouched.
function stripYoutubeTopicSuffix(value) {
  return text(value).replace(/\s+[-\u2013\u2014]\s+topic\s*$/i, '').trim();
}

function normalizeIdentityText(value) {
  return text(value)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function hasVersionMarker(value) {
  return /\b(live|remix|radio edit|edit|alternate|alternative|version|mix|acoustic|demo|remaster(?:ed)?|mono|stereo)\b/i.test(text(value));
}

function sameIdentity(expected, received) {
  const left = normalizeIdentityText(expected);
  const right = normalizeIdentityText(received);
  if (!left || !right || left !== right) return false;
  // Exact normalized names alone are too permissive for a plain track versus
  // a versioned Last.fm result (for example, a live or remix release).
  return hasVersionMarker(expected) === hasVersionMarker(received);
}

function lastfmArtistName(track) {
  const artist = track && track.artist;
  return text(artist && (artist.name || artist['#text']) || artist);
}

function lastfmAlbumTitle(track) {
  const album = track && track.album;
  return text(album && (album.title || album['#text']) || album);
}

function getReliableYear(track) {
  const published = text(track && track.wiki && track.wiki.published, 120);
  const match = published.match(/\b((?:19|20)\d{2})\b/);
  return match ? match[1] : '';
}

function getLastfmTrackInfoParams(meta) {
  const source = meta && typeof meta === 'object' ? meta : {};
  const mbid = text(source.trackMbid || source.recordingMbid || source.mbid, 80);
  if (mbid) return { mbid };
  return { artist: text(source.artist), track: text(source.title), autocorrect: 0 };
}

function enrichCanonicalDownloadMetadata(meta, response) {
  const source = meta && typeof meta === 'object' ? meta : {};
  // An explicit album is canonical context (not a hint from YouTube), so bulk
  // album jobs and already-complete single jobs never need this lookup.
  if (text(source.album)) return { meta: { ...source }, enriched: false, reason: 'album-present' };
  const track = response && response.track;
  const responseArtist = lastfmArtistName(track);
  const responseTitle = text(track && track.name);
  const album = lastfmAlbumTitle(track);
  if (!album || !sameIdentity(source.artist, responseArtist) || !sameIdentity(source.title, responseTitle)) {
    return { meta: { ...source }, enriched: false, reason: 'identity-or-album-mismatch' };
  }
  const result = { ...source, album, albumArtist: responseArtist || source.albumArtist || source.artist };
  const year = getReliableYear(track);
  if (!text(result.albumDate) && year) result.albumDate = year;
  const mbid = text(track && track.mbid, 80);
  if (!text(result.trackMbid) && mbid) result.trackMbid = mbid;
  return { meta: result, enriched: true, reason: 'lastfm-track-info' };
}

module.exports = { text, stripYoutubeTopicSuffix, normalizeIdentityText, sameIdentity, getLastfmTrackInfoParams, enrichCanonicalDownloadMetadata };
