'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLastfmProvider } = require('../app/radio-providers');
const { RadioResolutionController } = require('../app/radio-resolution-controller');

function loadRendererResolverScripts() {
  const browser = { window: null };
  browser.window = browser;
  const context = vm.createContext(browser);
  ['local-track-matcher.js', 'youtube-track-matcher.js', 'playback-resolver.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', file), 'utf8'), context, { filename: file });
  });
  return browser;
}

test('renderer classic-script wiring exports PlaybackResolver and resolves a Last.fm candidate through the narrow YouTube IPC dependency', async () => {
  const browser = loadRendererResolverScripts();
  assert.equal(typeof (browser.PlaybackResolver && browser.PlaybackResolver.createPlaybackResolver), 'function');
  let ipcCalls = 0;
  const resolver = browser.PlaybackResolver.createPlaybackResolver({
    matchLocal: (candidate, files) => browser.LocalTrackMatcher.matchLocalTrack(candidate, files),
    resolveYouTube: async (candidate, context) => {
      ipcCalls++;
      assert.equal(context.requestId, 'renderer-wiring-test');
      assert.equal(candidate.artist, 'Portishead');
      return { videoId: 'abcdefghijk' };
    },
  });
  const provider = createLastfmProvider({
    start: async () => ({
      items: [{ id: 'lastfm:track:name:portishead::roads', itemKind: 'candidate', providerId: 'lastfm', artist: 'Portishead', title: 'Roads', album: 'Dummy', duration: 0 }],
      providerSession: { version: 1, genreIds: ['trip-hop'], poolKey: 'test-pool' }, exhausted: true,
    }),
  });
  const started = await provider.startStation({ genreIds: ['trip-hop'] });
  const controller = new RadioResolutionController({
    resolve: (item) => resolver.resolve({ candidateId: item.id, artist: item.artist, title: item.title, album: item.album, duration: item.duration }, { musicFiles: [], requestId: 'renderer-wiring-test' }),
  });
  const playable = await controller.fill({}, started.items);
  assert.equal(ipcCalls, 1);
  assert.equal(playable.length, 1);
  assert.equal(playable[0].playback.kind, 'youtube');
  assert.equal(playable[0].playback.videoId, 'abcdefghijk');
});
