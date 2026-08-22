'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveInitialPlayable } = require('./radio-startup-flow');

test('first local playable commits without waiting for the rest of the candidate batch', async () => {
  let releaseSlow;
  const slow = new Promise((resolve) => { releaseSlow = resolve; });
  const items = [{ id: 'local' }, { id: 'slow' }];
  const initial = await resolveInitialPlayable({
    nextItem: async () => items.shift() || null,
    resolve: async (item) => item.id === 'local' ? { playback: { kind: 'local-file' } } : slow,
  });
  assert.equal(initial.track.playback.kind, 'local-file');
  assert.equal(initial.consumed, 1);
  releaseSlow(null);
});
test('startup consumes only through the first playable result and leaves remaining work for background fill', async () => {
  const items = [{ id: 'miss' }, { id: 'playable' }, { id: 'background' }];
  const consumed = [];
  const initial = await resolveInitialPlayable({
    nextItem: async () => items.shift() || null,
    onConsumed: (item) => consumed.push(item.id),
    resolve: async (item) => item.id === 'playable' ? { playback: { kind: 'youtube', videoId: 'abcdefghijk' } } : null,
  });
  assert.deepEqual(consumed, ['miss', 'playable']);
  assert.equal(items[0].id, 'background');
  assert.equal(initial.track.playback.kind, 'youtube');
});
test('background resolution can remain pending after initial playback is ready', async () => {
  let releaseBackground;
  const items = [{ id: 'initial' }, { id: 'background' }];
  const initial = await resolveInitialPlayable({
    nextItem: async () => items.shift() || null,
    resolve: async () => ({ playback: { kind: 'local-file' } }),
  });
  let playbackStarted = false;
  playbackStarted = !!initial.track;
  const background = new Promise((resolve) => { releaseBackground = resolve; });
  assert.equal(playbackStarted, true);
  assert.equal(items[0].id, 'background');
  releaseBackground();
  await background;
});
