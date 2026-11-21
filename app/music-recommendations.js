'use strict';

const { artistNameKey } = require('./deezer-client');

const ALGORITHM = 'session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30';
const validMbid = value => typeof value === 'string' && /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value);
const clean = value => typeof value === 'string' ? value.trim().slice(0, 300) : '';
const list = value => Array.isArray(value) ? value : [];
const quoted = value => '"' + value.replace(/["\\]/g, '\\$&') + '"';

function uniqueArtists(rows) {
  const result = new Map();
  for (const row of rows) {
    const key = artistNameKey(row.name);
    if (!key) continue;
    const prior = result.get(key);
    if (!prior || (!prior.mbid && row.mbid)) result.set(key, row);
  }
  return [...result.values()];
}

function createMusicRecommendations({ listenbrainz, labs, musicbrainz, deezer }) {
  const mbSearch = (entity, query) => musicbrainz(entity + '?' + new URLSearchParams({ query, fmt: 'json', limit: '12' }));

  async function resolveArtist(seed) {
    if (validMbid(seed.mbid)) {
      const row = await musicbrainz(`artist/${seed.mbid}?fmt=json`);
      return row?.id === seed.mbid && artistNameKey(row.name) === artistNameKey(seed.name) ? seed : { name: seed.name };
    }
    const matches = list((await mbSearch('artist', 'artist:' + quoted(seed.name)))?.artists)
      .filter(row => validMbid(row.id) && artistNameKey(row.name) === artistNameKey(seed.name));
    return matches.length === 1 ? { ...seed, mbid: matches[0].id } : seed;
  }

  async function tagArtists(tag) {
    const data = await mbSearch('artist', 'tag:' + quoted(tag));
    return uniqueArtists(list(data?.artists).filter(row => validMbid(row.id))
      .map(row => ({ name: clean(row.name), mbid: row.id })));
  }

  async function labsSimilar(mbid) {
    if (!validMbid(mbid)) return [];
    const rows = await labs('similar-artists/json?' + new URLSearchParams({ artist_mbids: mbid, algorithm: ALGORITHM }));
    return uniqueArtists(list(rows).filter(row => validMbid(row.artist_mbid) && row.artist_mbid !== mbid)
      .map(row => ({ name: clean(row.name), mbid: row.artist_mbid })));
  }

  async function relatedArtists(artist, provider) {
    if (!validMbid(artist.mbid)) return [];
    let rows;
    if (provider === 'ListenBrainz') {
      rows = await labsSimilar(artist.mbid).catch(() => []);
    } else {
      const dz = await deezer.findArtist(artist.name).catch(() => null);
      rows = dz ? await deezer.related(dz.deezerId).catch(() => []) : [];
    }
    return rows.filter(row => artistNameKey(row.name) !== artistNameKey(artist.name))
      .map(row => ({ ...row, provider }));
  }

  async function similarArtists(seed) {
    const artist = await resolveArtist(seed).catch(() => ({}));
    const related = await relatedArtists(artist, 'ListenBrainz');
    return related.length ? related : relatedArtists(artist, 'Deezer');
  }

  async function seeds(username) {
    const user = encodeURIComponent(username);
    const [recent, top] = await Promise.allSettled([
      listenbrainz(`user/${user}/listens?count=40`),
      listenbrainz(`stats/user/${user}/artists?range=month&count=20`),
    ]);
    if (recent.status === 'rejected' && top.status === 'rejected') throw recent.reason;
    const fromRecent = list(recent.value?.payload?.listens).map(row => {
      const metadata = row.track_metadata;
      const ids = metadata?.mbid_mapping?.artist_mbids || metadata?.additional_info?.artist_mbids;
      return { name: clean(metadata?.artist_name), mbid: Array.isArray(ids) && ids.length === 1 && validMbid(ids[0]) ? ids[0] : '' };
    });
    const fromTop = list(top.value?.payload?.artists).map(row => ({ name: clean(row.artist_name), mbid: validMbid(row.artist_mbid) ? row.artist_mbid : '' }));
    return uniqueArtists([...fromRecent.slice(0, 10), ...fromTop, ...fromRecent]).slice(0, 30);
  }

  function verifiedGroup(group, artist) {
    const credit = group?.['artist-credit'];
    return validMbid(group?.id) && clean(group.title) && group['primary-type'] === 'Album' &&
      Array.isArray(group['secondary-types']) && !group['secondary-types'].includes('Compilation') &&
      credit?.length === 1 && credit[0]?.artist?.id === artist.mbid;
  }

  async function albumFor(artist) {
    const mb = await resolveArtist(artist).catch(() => ({}));
    if (!validMbid(mb.mbid)) return null;
    const asItem = (name, image, albumProvider) => ({
      name: clean(name), artist: mb.name, image, provider: artist.provider || 'MusicBrainz tags',
      albumProvider, artistMbid: mb.mbid,
    });
    if (artist.provider === 'Deezer' && artist.deezerId) {
      const albums = await deezer.albums(artist.deezerId).catch(() => []);
      for (const row of albums.filter(row => clean(row?.title) && row.record_type === 'album').slice(0, 3)) {
        const album = await deezer.album(row.id).catch(() => null);
        if (!album || album.record_type !== 'album' || album.artist?.id !== artist.deezerId ||
            artistNameKey(album.artist.name) !== artistNameKey(mb.name) || !clean(album.title)) continue;
        return asItem(album.title, /^https:\/\/[^/]+\.dzcdn\.net\//i.test(album.cover_medium) ? album.cover_medium : '', 'Deezer');
      }
    }
    if (artist.provider === 'ListenBrainz') {
      const popular = await listenbrainz('popularity/top-release-groups-for-artist/' + mb.mbid).catch(() => []);
      for (const row of list(popular).filter(row => validMbid(row?.release_group_mbid) && row.release_group?.type === 'Album').slice(0, 2)) {
        const id = row.release_group_mbid;
        const group = await musicbrainz(`release-group/${id}?inc=artist-credits&fmt=json`).catch(() => null);
        if (group?.id !== id || !verifiedGroup(group, mb)) continue;
        const cover = row.release_group.caa_release_mbid;
        return asItem(group.title, validMbid(cover) ? `https://coverartarchive.org/release/${cover}/front-250` :
          `https://coverartarchive.org/release-group/${id}/front-250`, 'ListenBrainz');
      }
    }
    const result = await musicbrainz(`release-group?artist=${mb.mbid}&type=album&inc=artist-credits&fmt=json&limit=12`).catch(() => null);
    const group = list(result?.['release-groups']).find(row => verifiedGroup(row, mb));
    return group ? asItem(group.title, `https://coverartarchive.org/release-group/${group.id}/front-250`, 'MusicBrainz') : null;
  }

  async function recommendations(username, request) {
    let seed;
    let artists;
    if (request?.mode === 'genres') {
      const tags = Array.isArray(request.genres) ? request.genres.slice(0, 5).map(clean).filter(Boolean) : [];
      artists = uniqueArtists((await Promise.all(tags.map(tagArtists))).flat());
    } else {
      const candidates = await seeds(username).catch(error => {
        if (request?.mode === 'artist') return [];
        throw error;
      });
      if (request?.mode === 'artist') {
        const name = clean(request.artist);
        if (!name) return { items: [] };
        seed = candidates.find(row => artistNameKey(row.name) === artistNameKey(name)) || { name };
      } else {
        seed = candidates[request?.refresh ? Math.floor(Math.random() * candidates.length) : 0];
      }
      if (!seed) return { items: [] };
      const artist = await resolveArtist(seed).catch(() => ({}));
      if (!validMbid(artist.mbid)) return { seed: seed.name, items: [] };
      const direct = await relatedArtists(artist, 'ListenBrainz');
      const items = (await Promise.all(direct.slice(0, 6).map(albumFor))).filter(Boolean);
      if (items.length < 6) {
        const included = new Set(items.map(item => artistNameKey(item.artist)));
        const fallback = (await relatedArtists(artist, 'Deezer')).filter(row => !included.has(artistNameKey(row.name)));
        items.push(...(await Promise.all(fallback.slice(0, 6 - items.length).map(albumFor))).filter(Boolean));
      }
      return { items, seed: seed.name };
    }
    const items = (await Promise.all(artists.slice(0, 6).map(albumFor))).filter(Boolean);
    return { items };
  }
  return { seeds, resolveArtist, labsSimilar, similarArtists, recommendations };
}

module.exports = { createMusicRecommendations };
