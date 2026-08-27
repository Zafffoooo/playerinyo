'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLastfmSyncGuard } = require('../app/lastfm-sync-guard');

test('username change and disconnect invalidate an active Last.fm sync token', async () => {
  const guard = createLastfmSyncGuard();
  const oldToken = guard.capture('old-user', 'key');
  const inFlight = Promise.resolve().then(() => {
    guard.invalidate(); // username change/disconnect happens while HTTP is pending
    return guard.isCurrent(oldToken, 'old-user', 'key');
  });
  assert.equal(await inFlight, false);
  const newToken = guard.capture('new-user', 'key');
  assert.equal(guard.isCurrent(newToken, 'new-user', 'key'), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(newToken, 'new-user', 'key'), false);
});
