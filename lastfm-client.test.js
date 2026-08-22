'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLastfmApiClient, restoreCacheEntries } = require('./lastfm-client');

const tagTopTracksFixture = {
  tracks: {
    track: [{
      name: 'Chop Suey!',
      duration: '208',
      mbid: 'd758947d-d667-430b-900d-2abb110f63aa',
      artist: { name: 'System of a Down' },
      '@attr': { rank: '1' },
    }],
    '@attr': { tag: 'metal', page: '1', perPage: '50', totalPages: '3316', total: '165756' },
  },
};

function response(body, status) {
  return { ok: (status || 200) < 300, status: status || 200, headers: { get() { return null; } }, text: async () => JSON.stringify(body) };
}

test('client deduplicates in-flight calls and caches valid responses', async () => {
  let calls = 0;
  const client = createLastfmApiClient({ getApiKey: () => 'key', fetch: async () => { calls++; return response(tagTopTracksFixture); } });
  const [first, second] = await Promise.all([
    client.request('tag.gettoptracks', { tag: 'rock', limit: 10 }),
    client.request('tag.gettoptracks', { tag: 'rock', limit: 10 }),
  ]);
  assert.deepEqual(first, second);
  await client.request('tag.gettoptracks', { tag: 'rock', limit: 10 });
  assert.equal(calls, 1);
});

test('tag.gettoptracks accepts the real Last.fm tracks response fixture', async () => {
  const client = createLastfmApiClient({ getApiKey: () => 'key', fetch: async () => response(tagTopTracksFixture) });
  const data = await client.request('tag.gettoptracks', { tag: 'metal', limit: 50, page: 1 });
  assert.equal(data.tracks.track[0].name, 'Chop Suey!');
});

test('valid raw API cache and normalized discovery cache remain separate', async () => {
  const key = 'tag.gettoptracks|limit=50&page=1&tag=metal';
  const cache = new Map([[key, { expiresAt: Date.now() + 10000, value: tagTopTracksFixture }]]);
  const client = createLastfmApiClient({ getApiKey: () => 'key', cache, fetch: async () => { throw new Error('network should not be called'); } });
  const data = await client.request('tag.gettoptracks', { tag: 'metal', limit: 50, page: 1 });
  assert.deepEqual(data, tagTopTracksFixture);
});

test('client rejects malformed and rate-limited responses after bounded retries', async () => {
  const malformed = createLastfmApiClient({ getApiKey: () => 'key', fetch: async () => ({ ok: true, status: 200, headers: { get() { return null; } }, text: async () => '{' }) });
  await assert.rejects(() => malformed.request('tag.gettoptracks', { tag: 'rock' }), /malformed JSON/);
  let calls = 0;
  const limited = createLastfmApiClient({ getApiKey: () => 'key', fetch: async () => { calls++; return response({ error: 29, message: 'Rate limit' }, 429); } });
  await assert.rejects(() => limited.request('tag.gettoptracks', { tag: 'rock' }), /Rate limit/);
  assert.equal(calls, 3);
});

test('Last.fm API error payloads preserve their API code and message', async () => {
  const client = createLastfmApiClient({
    getApiKey: () => 'invalid-key',
    maxAttempts: 1,
    fetch: async () => response({ error: 10, message: 'Invalid API key - You must be granted a valid key by last.fm' }),
  });
  await assert.rejects(
    () => client.request('tag.gettoptracks', { tag: 'metal' }),
    (error) => error.code === 10 && /Invalid API key/.test(error.message) && !/missing tracks/.test(error.message),
  );
});

test('HTTP 200 without the method-specific response shape is rejected', async () => {
  const client = createLastfmApiClient({ getApiKey: () => 'key', fetch: async () => response({}) });
  await assert.rejects(() => client.request('user.getrecenttracks', { user: 'zafer', page: 1 }), /missing recenttracks/);
  const wrongTagRoot = createLastfmApiClient({ getApiKey: () => 'key', fetch: async () => response({ toptracks: { track: [] } }) });
  await assert.rejects(() => wrongTagRoot.request('tag.gettoptracks', { tag: 'metal' }), /missing tracks/);
});

test('track.getInfo accepts the Last.fm track response shape and uses the bounded API cache', async () => {
  let calls = 0;
  const fixture = { track: { name: 'Dirge', artist: { name: 'Death in Vegas' }, album: { title: 'The Contino Sessions' } } };
  const client = createLastfmApiClient({ getApiKey: () => 'key', fetch: async () => { calls++; return response(fixture); } });
  const first = await client.request('track.getinfo', { artist: 'Death in Vegas', track: 'Dirge', autocorrect: 0 });
  const second = await client.request('track.getinfo', { artist: 'Death in Vegas', track: 'Dirge', autocorrect: 0 });
  assert.equal(first.track.album.title, 'The Contino Sessions');
  assert.equal(second.track.name, 'Dirge');
  assert.equal(calls, 1);
});

test('corrupt or expired cache entries are ignored without preventing valid cache restore', () => {
  const entries = restoreCacheEntries({ entries: [['bad', { expiresAt: 'nope' }], ['valid', { expiresAt: Date.now() + 10000, value: { toptracks: {} } }], 'bad-row'] }, Date.now());
  assert.deepEqual(entries.map(([key]) => key), ['valid']);
});

test('timeout is surfaced from an abortable request', async () => {
  const client = createLastfmApiClient({
    getApiKey: () => 'key', timeoutMs: 5, maxAttempts: 1,
    fetch: (url, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))),
  });
  await assert.rejects(() => client.request('tag.gettoptracks', { tag: 'rock' }), /timed out/);
});
