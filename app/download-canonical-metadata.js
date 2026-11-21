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

const { normalizeMbid } = require('./lastfm-discovery');

function creditedArtist(credits) {
  return Array.isArray(credits) ? credits.map(credit => (credit.name || credit.artist?.name || '') + (credit.joinphrase || '')).join('') : '';
}

function recordingMatches(meta, recording) {
  if (!recording || recording.video || !sameIdentity(meta.title, recording.title) ||
      !sameIdentity(meta.artist, creditedArtist(recording['artist-credit']))) return false;
  const comment = text(recording.disambiguation);
  return !hasVersionMarker(comment) || normalizeIdentityText(meta.title).includes(normalizeIdentityText(comment));
}

function plausibleYear(value) {
  const match = /^(19\d{2}|20\d{2})(?:-\d{2}(?:-\d{2})?)?$/.exec(String(value || ''));
  return match && Number(match[1]) <= new Date().getUTCFullYear() ? match[1] : '';
}

function selectMusicBrainzAlbum(recording, meta) {
  const groups = new Map();
  for (const release of Array.isArray(recording.releases) ? recording.releases : []) {
    const group = release['release-group'];
    const id = normalizeMbid(group?.id);
    const albumArtist = creditedArtist(release['artist-credit']);
    const types = Array.isArray(group?.['secondary-types']) ? group['secondary-types'] : [];
    if (!id || !text(group.title) || release.status !== 'Official' ||
        !['Album', 'EP', 'Single'].includes(group['primary-type']) || types.length ||
        !sameIdentity(meta.artist, albumArtist) || (meta.album && !sameIdentity(meta.album, group.title))) continue;
    const year = plausibleYear(group['first-release-date']) || plausibleYear(release.date);
    const prior = groups.get(id);
    if (!prior || (year && (!prior.year || year < prior.year))) groups.set(id, { album: group.title, albumArtist, year, type: group['primary-type'] });
  }
  const rows = [...groups.values()];
  for (const type of ['Album', 'EP', 'Single']) {
    const candidates = rows.filter(row => row.type === type);
    if (candidates.length) return candidates.length === 1 ? candidates[0] : null;
  }
  return null;
}

async function lookupCanonicalDownloadMetadata(meta, { musicbrainz, listenbrainz }) {
  if (!text(meta.artist) || !text(meta.title)) return meta;
  let id = normalizeMbid(meta.trackMbid);
  const quoted = value => '"' + text(value, 300).replace(/["\\]/g, '\\$&') + '"';
  if (!id) {
    const query = 'recording:' + quoted(meta.title) + ' AND artist:' + quoted(meta.artist);
    const search = await musicbrainz('recording?' + new URLSearchParams({ query, fmt: 'json', limit: '25' })).catch(() => null);
    const matches = new Set((Array.isArray(search?.recordings) ? search.recordings : [])
      .filter(row => recordingMatches(meta, row)).map(row => normalizeMbid(row.id)).filter(Boolean));
    if (matches.size !== 1) return meta;
    [id] = matches;
  }
  const recording = await musicbrainz('recording/' + id + '?' + new URLSearchParams({
    inc: 'artist-credits+releases+release-groups', fmt: 'json',
  })).catch(() => null);
  if (recording) {
    if (normalizeMbid(recording.id) !== id || !recordingMatches(meta, recording)) return meta;
    const release = selectMusicBrainzAlbum(recording, meta);
    return { ...meta, trackMbid: meta.trackMbid || id,
      album: meta.album || release?.album || '', albumArtist: meta.albumArtist || release?.albumArtist || '',
      albumDate: meta.albumDate || release?.year || '' };
  }
  // A preexisting recording MBID anchors the fallback if the primary service fails.
  if (normalizeMbid(meta.trackMbid) !== id) return meta;
  const data = await listenbrainz('metadata/recording/?' + new URLSearchParams({ recording_mbids: id, inc: 'artist release' })).catch(() => null);
  const row = data?.[id];
  const release = row?.release;
  const album = text(release?.name);
  if (!sameIdentity(meta.artist, row?.artist?.name) || !sameIdentity(meta.title, row?.recording?.name) ||
      !sameIdentity(meta.artist, release?.album_artist_name) || !album ||
      (meta.album && !sameIdentity(meta.album, album)) ||
      /\b(compilation|greatest hits|best of|soundtrack)\b/i.test(album) ||
      (hasVersionMarker(album) && !hasVersionMarker(meta.title))) return meta;
  return { ...meta, album: meta.album || album, albumArtist: meta.albumArtist || release.album_artist_name,
    albumDate: meta.albumDate || plausibleYear(release.year) };
}

module.exports = { lookupCanonicalDownloadMetadata, text, stripYoutubeTopicSuffix, normalizeIdentityText, sameIdentity, getLastfmTrackInfoParams, enrichCanonicalDownloadMetadata };
