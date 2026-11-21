#!/usr/bin/env node
'use strict';

const { createDeezerClient } = require('../app/deezer-client');
const { createLastfmApiClient } = require('../app/lastfm-client');
const { createMusicRecommendations } = require('../app/music-recommendations');
const { createProviderJsonCache } = require('../app/provider-json-cache');
const { version } = require('../package.json');

const ARTISTS = ['Eths', 'Kells', 'Queen Adreena', 'Sol Seppy'];
const USER_AGENT = `Playerinyo/${version} ( https://github.com/Zafffoooo/playerinyo )`;

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return response.json();
}

function createComparisonSources(apiKey) {
  const musicbrainz = createProviderJsonCache(endpoint => fetchJson('https://musicbrainz.org/ws/2/' + endpoint));
  const labs = createProviderJsonCache(endpoint => fetchJson('https://labs.api.listenbrainz.org/' + endpoint));
  const recommendations = createMusicRecommendations({
    musicbrainz: endpoint => musicbrainz(endpoint, value => {
      if (!Array.isArray(value?.artists)) throw new Error('Invalid MusicBrainz response');
      return value;
    }),
    labs: endpoint => labs(endpoint, value => {
      if (!Array.isArray(value)) throw new Error('Invalid ListenBrainz response');
      return value;
    }),
  });
  const deezer = createDeezerClient({ fetchJson });
  const lastfm = createLastfmApiClient({ getApiKey: () => apiKey });
  return {
    ListenBrainz: async name => {
      const artist = await recommendations.resolveArtist({ name });
      if (!artist.mbid) return null;
      return (await recommendations.labsSimilar(artist.mbid)).map(row => row.name);
    },
    Deezer: async name => {
      const artist = await deezer.findArtist(name);
      if (!artist) return null;
      return (await deezer.related(artist.deezerId)).map(row => row.name);
    },
    ...(apiKey ? { 'Last.fm': async name => {
      const data = await lastfm.request('artist.getsimilar', { artist: name, autocorrect: 0, limit: 10 });
      return (Array.isArray(data.similarartists.artist) ? data.similarartists.artist : [data.similarartists.artist])
        .map(row => row?.name).filter(Boolean);
    } } : {}),
  };
}

async function compareSimilar(sources, write = console.log) {
  let failures = 0;
  for (const artist of ARTISTS) {
    const columns = await Promise.all(Object.entries(sources).map(async ([label, load]) => {
      try {
        const names = await load(artist);
        return [label, names === null ? ['(no exact artist match)'] : names.length ? names.slice(0, 10) : ['(no results)']];
      } catch {
        failures++;
        return [label, ['(request failed)']];
      }
    }));
    const widths = columns.map(([label, rows]) => Math.max(label.length, ...rows.map(name => name.length)));
    write('\n' + artist);
    write(columns.map(([label], i) => label.padEnd(widths[i])).join(' | ').trimEnd());
    for (let rank = 0; rank < Math.max(...columns.map(([, rows]) => rows.length)); rank++) {
      write(columns.map(([, rows], i) => (rows[rank] || '').padEnd(widths[i])).join(' | ').trimEnd());
    }
  }
  return failures;
}

if (require.main === module) {
  const apiKey = String(process.env.LASTFM_API_KEY || '').trim();
  if (!apiKey) console.log('Set LASTFM_API_KEY to include Last.fm.');
  compareSimilar(createComparisonSources(apiKey)).then(failures => {
    if (failures) process.exitCode = 1;
  });
}

module.exports = { compareSimilar };
