'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');

test('manual track selection rebuilds a full shuffle and anchors the selected track', () => {
  const renderer = fs.readFileSync(require.resolve('../app/renderer'), 'utf8');
  const playback = fs.readFileSync(require.resolve('../app/renderer-playback-downloads'), 'utf8');
  const source = renderer.slice(renderer.indexOf('function buildShuffleQueue()'), renderer.indexOf('function applyZoom()')) +
    playback.slice(playback.indexOf('function buildSmartShuffleQueue('), playback.indexOf('function toggleShuffle()'));
  const tracks = ['A', 'B', 'C', 'D'].map((name, i) => ({ title: name, artist: i % 2 ? 'Two' : 'One' }));
  const pinned = [{ title: 'Up Next' }];
  const state = { isShuffle: true, shuffleMode: 1, playQueueTracks: [...tracks, { isDisabled: true }],
    shuffleQueue: [], userQueue: pinned };
  const context = vm.createContext({ state, findTrackIndexByIdentity: (queue, track) => queue.indexOf(track) });
  vm.runInContext(source, context);
  for (const mode of [1, 2]) {
    state.shuffleMode = mode;
    for (const selected of [tracks[2], tracks[1]]) {
      const previous = [tracks[0], selected];
      state.shuffleQueue = previous;
      context.restartShuffleForTrack(selected);
      assert.notEqual(state.shuffleQueue, previous);
      assert.equal(state.shuffleQueue[0], selected);
      assert.equal(state.shuffleQueue.length, tracks.length);
      assert.equal(new Set(state.shuffleQueue).size, tracks.length);
      assert.equal(state.userQueue, pinned);
    }
  }
  const previous = state.shuffleQueue;
  state.isShuffle = false;
  context.restartShuffleForTrack(tracks[0]);
  assert.equal(state.shuffleQueue, previous);
});
