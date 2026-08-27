'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getLfmSignature, hasLastfmScrobbleCredentials, redactLastfmCredentials } = require('../app/lastfm-auth');

test('renderer settings redact credentials while auth/scrobble signing remains valid', () => {
  const settings = { theme: 'dark', lastfmApiKey: 'api', lastfmSharedSecret: 'secret', lastfmSessionKey: 'session' };
  assert.deepEqual(redactLastfmCredentials(settings), { theme: 'dark' });
  assert.equal(hasLastfmScrobbleCredentials(settings), true);
  assert.equal(hasLastfmScrobbleCredentials({ ...settings, lastfmSessionKey: '' }), false);
  assert.equal(getLfmSignature({ method: 'track.scrobble', api_key: 'api', format: 'json' }, 'secret'), getLfmSignature({ format: 'xml', api_key: 'api', method: 'track.scrobble' }, 'secret'));
});
