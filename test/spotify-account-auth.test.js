'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createSpotifyAccountClient } = require('../app/spotify-account-auth');

function makeClient(fetchImpl) {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'playerinyo-spotify-auth-'));
  fs.writeFileSync(path.join(userDataPath, 'spotify-account-auth.json'), JSON.stringify({ version: 1, refreshToken: Buffer.from('refresh').toString('base64'), account: { id: 'owner', name: 'Owner' } }));
  const safeStorage = { decryptString: value => value.toString(), encryptString: value => Buffer.from(value) };
  return { client: createSpotifyAccountClient({ userDataPath, safeStorage, isSecureStorageAvailable: () => true, fetchImpl }), cleanup: () => fs.rmSync(userDataPath, { recursive: true, force: true }) };
}
function response(data) {
  return { ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify(data), json: async () => data };
}

test('Spotify account import reads every page before returning a complete playlist', async () => {
  const id = 'A'.repeat(22);
  const calls = [];
  const { client, cleanup } = makeClient(async url => {
    const address = String(url);
    calls.push(address);
    if (address.includes('/api/token')) return response({ access_token: 'access', expires_in: 3600 });
    if (address.endsWith('/playlists/' + id)) return response({ name: 'Long playlist', owner: { id: 'owner' }, images: [{ url: 'https://i.scdn.co/image/custom-cover' }] });
    if (address.includes('/items?limit=50')) return response({ total: 2, items: [{ item: { type: 'track', name: 'First', artists: [{ name: 'Artist' }], album: { name: 'Album' }, uri: 'spotify:track:one' } }], next: 'https://api.spotify.com/v1/playlists/' + id + '/items?offset=1' });
    return response({ total: 2, items: [{ item: { type: 'track', name: 'Second', artists: [{ name: 'Artist' }], album: { name: 'Album' }, uri: 'spotify:track:two' } }], next: null });
  });
  try {
    const updates = [];
    const result = await client.importPlaylist(id, 'test_request', update => updates.push(update));
    assert.equal(result.records.length, 2);
    assert.equal(result.sourcePath, 'spotify:playlist:' + id);
    assert.equal(result.coverUrl, 'https://i.scdn.co/image/custom-cover');
    assert.deepEqual(updates.map(update => update.done), [1, 2]);
    assert.equal(calls.filter(url => url.includes('/items?')).length, 2);
  } finally { cleanup(); }
});

test('Spotify account import rejects incomplete pagination without returning partial records', async () => {
  const id = 'B'.repeat(22);
  const { client, cleanup } = makeClient(async url => {
    const address = String(url);
    if (address.includes('/api/token')) return response({ access_token: 'access', expires_in: 3600 });
    if (address.endsWith('/playlists/' + id)) return response({ name: 'Changed playlist', owner: { id: 'owner' } });
    return response({ total: 2, items: [{ item: { type: 'track', name: 'Only one', artists: [], album: {} } }], next: null });
  });
  try { await assert.rejects(client.importPlaylist(id, 'test_incomplete', () => {}), /changed while reading/); }
  finally { cleanup(); }
});
