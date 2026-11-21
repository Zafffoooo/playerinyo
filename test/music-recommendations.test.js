'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createMusicRecommendations } = require('../app/music-recommendations');
const { createDeezerClient } = require('../app/deezer-client');

const seedId = '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11';
const similarId = '10adbe5e-a2c0-4bf3-8249-2b4cbf6e6ca8';
const fallbackId = '7adbe5e0-a2c0-4bf3-8249-2b4cbf6e6ca8';
const albumId = '12adbe5e-a2c0-4bf3-8249-2b4cbf6e6ca8';

function album(artistId, extra = {}) {
  return {
    id: albumId, title: 'Verified album', 'primary-type': 'Album', 'secondary-types': [],
    'artist-credit': [{ artist: { id: artistId } }], ...extra,
  };
}

test('recent recommendations verify mapped artists, credit and release type before using a ListenBrainz album', async () => {
  const service = createMusicRecommendations({
    listenbrainz: async endpoint => {
      if (endpoint.startsWith('stats/')) return null;
      if (endpoint.startsWith('user/')) return { payload: { listens: [{ track_metadata: { artist_name: 'Portishead', mbid_mapping: { artist_mbids: [seedId] } } }] } };
      assert.equal(endpoint, 'popularity/top-release-groups-for-artist/' + similarId);
      return [seedId, fallbackId, albumId].map(id => ({ release_group_mbid: id, release_group: { name: 'Album', type: 'Album' } }));
    },
    labs: async endpoint => {
      assert.match(endpoint, new RegExp(seedId));
      return [{ artist_mbid: similarId, name: 'Massive Attack' }];
    },
    deezer: { findArtist: async () => null },
    musicbrainz: async endpoint => {
      if (endpoint.startsWith('artist/' + seedId)) return { id: seedId, name: 'Portishead' };
      if (endpoint.startsWith('artist/' + similarId)) return { id: similarId, name: 'Massive Attack' };
      if (endpoint.startsWith('release-group/' + seedId)) return album(seedId, { id: seedId, title: 'Wrong credit' });
      if (endpoint.startsWith('release-group/' + fallbackId)) return album(similarId, { id: fallbackId, 'secondary-types': ['Compilation'] });
      return { 'release-groups': [album(similarId)] };
    },
  });
  const { seed, items } = await service.recommendations('user', { mode: 'recent' });
  assert.equal(seed, 'Portishead');
  assert.deepEqual(items.map(row => [row.name, row.artist, row.provider, row.albumProvider]), [
    ['Verified album', 'Massive Attack', 'ListenBrainz', 'MusicBrainz'],
  ]);
});

test('ambiguous MusicBrainz identities never reach the related-artist providers', async () => {
  const service = createMusicRecommendations({
    listenbrainz: async () => null,
    musicbrainz: async () => ({ artists: [{ id: seedId, name: 'Eths' }, { id: similarId, name: 'ETHS' }] }),
    labs: async () => assert.fail('ambiguous identity reached ListenBrainz'),
    deezer: { findArtist: async () => assert.fail('ambiguous identity reached Deezer') },
  });
  assert.deepEqual(await service.resolveArtist({ name: 'Eths' }), { name: 'Eths' });
  assert.deepEqual(await service.recommendations('user', { mode: 'artist', artist: 'Eths' }), { seed: 'Eths', items: [] });
  const deezer = createDeezerClient({
    fetchJson: async () => ({ data: [{ id: 1, name: 'Eths Amics' }, { id: 1028, name: 'Eths' }] }),
  });
  assert.deepEqual(await deezer.findArtist('eths'), { name: 'Eths', deezerId: 1028 });
});

test('broad tag matches appear only for an explicit genre selection', async () => {
  const tagQueries = [];
  const service = createMusicRecommendations({
    listenbrainz: async () => null,
    labs: async () => [],
    deezer: { findArtist: async () => null },
    musicbrainz: async endpoint => {
      if (endpoint.startsWith('release-group?')) return { 'release-groups': [album(seedId)] };
      if (endpoint.startsWith('artist/')) return { id: seedId, name: 'Portishead', tags: [{ name: 'trip hop', count: 20 }] };
      const query = new URLSearchParams(endpoint.split('?')[1]).get('query');
      if (query.startsWith('tag:')) tagQueries.push(query);
      return { artists: [{ id: seedId, name: 'Portishead' }] };
    },
  });
  assert.deepEqual((await service.recommendations('user', { mode: 'artist', artist: 'Portishead' })).items, []);
  assert.deepEqual(tagQueries, []);
  const { items } = await service.recommendations('user', { mode: 'genres', genres: ['trip hop'] });
  assert.deepEqual(tagQueries, ['tag:"trip hop"']);
  assert.equal(items[0].artist, 'Portishead');
  assert.equal(items[0].provider, 'MusicBrainz tags');
});

test('Deezer related artists fill gaps and wrong Deezer album credits are skipped', async () => {
  const order = [];
  const service = createMusicRecommendations({
    listenbrainz: async () => null,
    labs: async () => { order.push('ListenBrainz'); return []; },
    musicbrainz: async endpoint => {
      if (endpoint.startsWith('release-group?')) return { 'release-groups': [album(similarId)] };
      const name = endpoint.includes('Seed') ? 'Seed' : 'Related';
      return { artists: [{ id: name === 'Seed' ? seedId : similarId, name }] };
    },
    deezer: {
      findArtist: async () => ({ deezerId: 1 }),
      related: async () => { order.push('Deezer'); return [{ deezerId: 2, name: 'Related' }]; },
      albums: async () => [
        { id: 3, title: 'Wrong', record_type: 'album' },
        { id: 4, title: 'Verified album', record_type: 'album' },
      ],
      album: async id => id === 3 ? { title: 'Wrong', record_type: 'album', artist: { id: 9, name: 'Other' } }
        : { title: 'Verified album', record_type: 'album', artist: { id: 2, name: 'Related' } },
    },
  });
  const { items } = await service.recommendations('user', { mode: 'artist', artist: 'Seed' });
  assert.deepEqual(order, ['ListenBrainz', 'Deezer']);
  assert.deepEqual(items.map(row => [row.name, row.artist, row.provider, row.albumProvider]), [
    ['Verified album', 'Related', 'Deezer', 'Deezer'],
  ]);
});
