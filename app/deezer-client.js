'use strict';

const { createProviderJsonCache } = require('./provider-json-cache');

function artistNameKey(name) {
  return typeof name === 'string' ? name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase() : '';
}

function createDeezerClient({ fetchJson }) {
  const request = createProviderJsonCache(path => fetchJson('https://api.deezer.com/' + path));
  function rows(value) {
    if (value?.error || !Array.isArray(value?.data)) throw new Error('Invalid Deezer response.');
    return value.data;
  }
  function validArtist(row) {
    return Number.isSafeInteger(row?.id) && row.id > 0 && artistNameKey(row.name);
  }
  async function findArtist(name) {
    const key = artistNameKey(name);
    if (!key) return null;
    const results = await request('search/artist?' + new URLSearchParams({ q: name, limit: '10' }), rows);
    const matches = results.filter(row => validArtist(row) && artistNameKey(row.name) === key);
    return matches.length === 1 ? { name: matches[0].name, deezerId: matches[0].id } : null;
  }
  function artistRows(id, endpoint) {
    if (!Number.isSafeInteger(id) || id <= 0) return Promise.resolve([]);
    return request(`artist/${id}/${endpoint}?limit=12`, rows);
  }
  return {
    findArtist,
    async related(id) {
      return (await artistRows(id, 'related')).filter(validArtist).map(row => ({ name: row.name, deezerId: row.id }));
    },
    album: id => Number.isSafeInteger(id) && id > 0
      ? request('album/' + id, value => {
        if (value?.error || value?.id !== id) throw new Error('Invalid Deezer album.');
        return value;
      })
      : Promise.resolve(null),
    albums: id => artistRows(id, 'albums'),
    top: id => artistRows(id, 'top'),
  };
}

module.exports = { createDeezerClient, artistNameKey };
