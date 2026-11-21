'use strict';

const { normalizeMbid } = require('./lastfm-discovery');

function identifier(value, host, entity) {
  for (const entry of Array.isArray(value) ? value : [value]) {
    if (typeof entry !== 'string') continue;
    const prefix = 'https://' + host + '/' + entity + '/';
    if (entry.startsWith(prefix)) {
      const id = normalizeMbid(entry.slice(prefix.length));
      if (id) return id;
    }
  }
  return '';
}
const clean = value => typeof value === 'string' ? value.trim().slice(0, 500) : '';

function normalizeCreatedPlaylists(value) {
  if (!Array.isArray(value?.playlists)) throw new Error('Invalid ListenBrainz playlist list.');
  const seen = new Set();
  return value.playlists.flatMap(row => {
    const playlist = row?.playlist;
    const id = identifier(playlist?.identifier, 'listenbrainz.org', 'playlist');
    const name = clean(playlist?.title);
    if (!id || !name || seen.has(id)) return [];
    seen.add(id);
    return [{ id, name, date: clean(playlist.date) }];
  }).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12);
}

function normalizeCreatedPlaylist(value, expectedId) {
  const playlist = value?.playlist;
  const id = identifier(playlist?.identifier, 'listenbrainz.org', 'playlist');
  if (id !== expectedId || !clean(playlist?.title) || !Array.isArray(playlist?.track)) {
    throw new Error('Invalid ListenBrainz playlist.');
  }
  const records = playlist.track.flatMap(row => {
    const Song = clean(row?.title);
    const Artist = clean(row?.creator);
    if (!Song || !Artist) return [];
    const TrackMbid = identifier(row.identifier, 'musicbrainz.org', 'recording');
    return [{ Song, Artist, Album: clean(row.album), TrackMbid, SourceStatus: 'listenbrainz' }];
  });
  return { id, name: clean(playlist.title), records };
}

module.exports = { normalizeCreatedPlaylists, normalizeCreatedPlaylist };
