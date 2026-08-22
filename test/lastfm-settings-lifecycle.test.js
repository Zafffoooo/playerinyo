'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { mergeRendererSettings, clearLastfmCredentials, canPersistLastfmCredentials } = require('../app/lastfm-settings-lifecycle');
test('redacted renderer save preserves main-only Last.fm credentials across restart-style writes', () => {
  const current = { theme: 'dark', lastfmApiKey: 'key', lastfmSharedSecret: 'secret', lastfmSessionKey: 'session', lastfmUsername: 'user' };
  const next = mergeRendererSettings(current, { theme: 'light', lastfmConnected: true, lastfmUsername: 'user' });
  assert.equal(next.lastfmApiKey, 'key'); assert.equal(next.lastfmSharedSecret, 'secret'); assert.equal(next.lastfmSessionKey, 'session'); assert.equal(next.theme, 'light');
});
test('disconnect intentionally clears all Last.fm account credentials', () => {
  const cleared = clearLastfmCredentials({ lastfmApiKey: 'key', lastfmSharedSecret: 'secret', lastfmSessionKey: 'session', lastfmUsername: 'user' });
  assert.deepEqual(cleared, { lastfmUsername: null });
});
test('credential connect is blocked instead of silently using memory-only storage when secure storage is unavailable', () => {
  assert.equal(canPersistLastfmCredentials(true), true);
  assert.equal(canPersistLastfmCredentials(false), false);
});
