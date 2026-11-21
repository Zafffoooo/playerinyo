'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createListenbrainzOutbox } = require('../app/listenbrainz-outbox');

const track = { artist: 'Artist', title: 'Track', startedAtSeconds: 1700000000 };

test('offline listens persist through restart and stay with their original account', async () => {
  let disk = { pending: [], sent: [] };
  let user = { username: 'first', token: 'first-token' };
  let offline = true;
  const sent = [];
  const options = {
    load: () => structuredClone(disk),
    save: async value => { disk = structuredClone(value); },
    account: () => user,
    submit: async (token, entry) => {
      if (offline) throw new Error('offline');
      sent.push({ token, entry });
      return true;
    },
  };
  const original = createListenbrainzOutbox(options);
  await original.enqueue(track);
  await original.enqueue(track);
  await original.flush();
  assert.equal(disk.pending.length, 1);
  assert.doesNotMatch(JSON.stringify(disk), /first-token/);

  const restarted = createListenbrainzOutbox(options);
  offline = false;
  user = { username: 'second', token: 'second-token' };
  await restarted.flush();
  assert.equal((await restarted.status()).pending, 0);
  assert.deepEqual(sent, []);
  user = { username: 'first', token: 'new-token' };
  await restarted.flush();
  await restarted.flush();
  assert.equal(sent.length, 1);
  assert.equal(sent[0].entry.startedAtSeconds, track.startedAtSeconds);
  assert.equal((await restarted.status()).pending, 0);
  assert.ok((await restarted.status()).lastSentAt);
});

test('manual retry respects rate limits and an authentication failure pauses the queue', async () => {
  let disk = { pending: [], sent: [] };
  let now = 1700000010000;
  let attempts = 0;
  const queue = createListenbrainzOutbox({
    load: () => disk,
    save: async value => { disk = value; },
    account: () => ({ username: 'user', token: 'token' }),
    now: () => now,
    submit: async () => {
      attempts++;
      throw Object.assign(new Error('failed'), attempts === 1 ? { status: 429, retryAfterMs: 60000 } : { status: 401 });
    },
  });
  await queue.enqueue(track);
  await queue.flush();
  await queue.retry();
  assert.equal(attempts, 1);
  now += 60000;
  await queue.retry();
  assert.equal(attempts, 2);
  assert.equal((await queue.status()).reconnect, true);
});
