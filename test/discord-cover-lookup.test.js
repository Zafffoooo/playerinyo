const assert = require('node:assert/strict');
const test = require('node:test');
const { lookupDiscordCover } = require('../app/discord-cover-lookup');

test('Discord cover lookup accepts a matching release and reuses it without another request', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, method: options.method || 'GET' });
    if (String(url).startsWith('https://musicbrainz.org/')) return {
      ok: true, status: 200, headers: new Headers(),
      text: async () => JSON.stringify({ recordings: [{ title: 'Test Signal', 'artist-credit': [{ name: 'Signal Artist' }], releases: [{ id: 'f84c6a04-432c-418c-b035-753a84850364', title: 'Test Album' }] }] }),
    };
    return { ok: true, status: 200, url: 'https://archive.org/download/example.jpg', headers: new Headers({ 'content-type': 'image/jpeg' }) };
  };
  try {
    const track = { title: 'Test Signal', artist: 'Signal Artist', album: 'Test Album' };
    const first = await lookupDiscordCover(track);
    const second = await lookupDiscordCover(track);
    assert.equal(first.status, 'matched');
    assert.match(first.url, /^https:\/\/coverartarchive\.org\/release\//);
    assert.equal(second.cached, true);
    assert.equal(requests.length, 2);
  } finally { global.fetch = originalFetch; }
});

test('Discord cover lookup rejects the wrong album instead of displaying its artwork', async () => {
  const originalFetch = global.fetch;
  let headRequests = 0;
  global.fetch = async (_url, options) => {
    if (options.method === 'HEAD') headRequests++;
    return { ok: true, status: 200, headers: new Headers(), text: async () => JSON.stringify({ recordings: [{ title: 'Different Test Signal', 'artist-credit': [{ name: 'Signal Artist' }], releases: [{ id: 'f84c6a04-432c-418c-b035-753a84850364', title: 'Wrong Album' }] }] }) };
  };
  try {
    const result = await lookupDiscordCover({ title: 'Different Test Signal', artist: 'Signal Artist', album: 'Right Album' });
    assert.equal(result.status, 'not-found');
    assert.equal(result.url, '');
    assert.equal(headRequests, 0);
  } finally { global.fetch = originalFetch; }
});
