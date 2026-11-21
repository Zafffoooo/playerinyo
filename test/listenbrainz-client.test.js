'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createListenBrainzClient } = require('../app/listenbrainz-client');
const { sanitizeSettingsForBackup } = require('../app/backup-validation');

test('ListenBrainz validates tokens using the authorization header', async () => {
  const client = createListenBrainzClient({
    fetchJson: async (url, options) => {
      assert.equal(url, 'https://api.listenbrainz.org/1/validate-token');
      assert.equal(options.headers.Authorization, 'Token test-token');
      return { valid: true, user_name: 'listener' };
    },
  });
  assert.equal(await client.validateToken('test-token'), 'listener');
  const rejectingClient = createListenBrainzClient({ fetchJson: async () => ({ valid: false, user_name: 'ignored' }) });
  assert.equal(await rejectingClient.validateToken('invalid'), '');
});

for (const playingNow of [true, false]) {
  test('ListenBrainz submits ' + (playingNow ? 'playing_now' : 'single'), async () => {
    const client = createListenBrainzClient({
      fetchJson: async (url, options) => {
        assert.equal(url, 'https://api.listenbrainz.org/1/submit-listens');
        assert.equal(options.method, 'POST');
        const listen = { track_metadata: { artist_name: 'Artist', track_name: 'Song', release_name: 'Album' } };
        if (!playingNow) listen.listened_at = 1700000000;
        assert.deepEqual(JSON.parse(options.body), { listen_type: playingNow ? 'playing_now' : 'single', payload: [listen] });
        return { status: 'ok' };
      },
    });
    assert.equal(await client.submit('test-token', { artist: 'Artist', title: 'Song', album: 'Album', startedAtSeconds: 1700000000 }, playingNow), true);
  });
}

test('ListenBrainz token is excluded from settings backups', () => {
  assert.equal(Object.hasOwn(sanitizeSettingsForBackup({ listenbrainzToken: 'secret' }), 'listenbrainzToken'), false);
});

test('ListenBrainz history uses an exclusive timestamp cursor and validates the payload boundary', async () => {
  const client = createListenBrainzClient({
    fetchJson: async (url) => {
      assert.equal(url, 'https://api.listenbrainz.org/1/user/test%20user/listens?max_ts=1700000010&count=1000');
      return { payload: { listens: [] } };
    },
  });
  assert.deepEqual(await client.recentListens('test user', 'test-token', 1700000010, 1000), []);
});
