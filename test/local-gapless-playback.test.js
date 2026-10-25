'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function audioElement() {
  const listeners = new Map();
  return {
    paused: true, readyState: 0, duration: 10, currentTime: 0, src: '', preload: '',
    addEventListener(name, listener) { listeners.set(name, listener); },
    removeEventListener(name, listener) { if (listeners.get(name) === listener) listeners.delete(name); },
    removeAttribute(name) { if (name === 'crossorigin') this.crossOrigin = null; },
    pause() { this.paused = true; },
    load() { this.readyState = 3; listeners.get('canplay')?.(); },
  };
}

function contextFor(nextTrack) {
  const audioEls = [audioElement(), audioElement()];
  const advances = [];
  const frames = [];
  const context = vm.createContext({
    window: {}, audioEls, activeAudioIdx: 0, preparedLocalSlot: null, preparedRadioSlot: null,
    localGaplessFrame: null, playbackTransitionPending: false, playbackSeekActive: false,
    state: { currentPlayingTrack: { matchedFile: { filePath: '/music/first.opus' } }, loopMode: 0, isPlaying: true, crossfadingNext: false },
    appSettings: { crossfade: 0 }, HTMLMediaElement: { HAVE_FUTURE_DATA: 3 },
    toFileUrl: filePath => `file://${filePath}`,
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    cancelAnimationFrame: () => {},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', 'renderer-playback-downloads.js'), 'utf8'), context);
  const originalPlayNextTrack = context.playNextTrack;
  context.metadataPathIsLocked = () => false;
  context.getNextTrackSelection = () => nextTrack.current ? { track: nextTrack.current } : null;
  context.playNextTrack = options => { advances.push(options); };
  return { context, audioEls, advances, frames, originalPlayNextTrack };
}

test('local successor is prepared before the current track ends and reused only while selected', () => {
  const first = { matchedFile: { filePath: '/music/second.opus' } };
  const second = { matchedFile: { filePath: '/music/third.opus' } };
  const next = { current: first };
  const { context, audioEls } = contextFor(next);
  vm.runInContext('prepareNextLocalTrack()', context);
  assert.equal(audioEls[1].src, 'file:///music/second.opus');
  assert.equal(vm.runInContext('isPreparedLocalTrack(getNextTrackSelection().track, 1)', context), true);
  next.current = second;
  vm.runInContext('prepareNextLocalTrack()', context);
  assert.equal(audioEls[1].src, 'file:///music/third.opus');
  assert.equal(vm.runInContext('isPreparedLocalTrack(getNextTrackSelection().track, 1)', context), true);
  next.current = null;
  vm.runInContext('prepareNextLocalTrack()', context);
  assert.equal(vm.runInContext('preparedLocalSlot', context), null);
});

test('near-end local transition is requested once and disabled for repeat-one', () => {
  const next = { current: { matchedFile: { filePath: '/music/second.opus' } } };
  const { context, audioEls, advances, frames } = contextFor(next);
  const current = audioEls[0];
  current.paused = false;
  current.currentTime = 9.5;
  vm.runInContext('prepareNextLocalTrack(); checkLocalGaplessBoundary(audioEls[0])', context);
  assert.equal(advances.length, 0);
  assert.equal(frames.length, 1);
  current.currentTime = 9.98;
  frames.shift()();
  assert.equal(advances.length, 1);
  assert.equal(advances[0].gaplessAdvance, true);
  context.state.loopMode = 2;
  vm.runInContext('checkLocalGaplessBoundary(audioEls[0])', context);
  assert.equal(advances.length, 1);
});

test('automatic gapless selection passes its transition mode to playback', async () => {
  const next = { current: { matchedFile: { filePath: '/music/second.opus' } } };
  const { context, originalPlayNextTrack } = contextFor(next);
  const calls = [];
  context.state.userQueue = [];
  context.state.playQueueTracks = [next.current];
  context.playbackGeneration = 1;
  context.playNextTrack = originalPlayNextTrack;
  context.playTrack = async (_track, options) => { calls.push(options); return true; };
  assert.equal(await vm.runInContext('playNextTrack({ automaticAdvance: true, gaplessAdvance: true })', context), true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].gaplessAdvance, true);
});
