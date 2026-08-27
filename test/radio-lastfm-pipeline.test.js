'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createLastfmProvider } = require('../app/radio-providers');
const { RadioResolutionController } = require('../app/radio-resolution-controller');
const { createPlaybackResolver } = require('../app/playback-resolver');
const { createRadioStreamResolver } = require('../app/radio-stream-resolver');

test('Last.fm discovery candidate reaches an accepted YouTube playable batch', async () => {
  const candidate = {
    id: 'lastfm:track:name:portishead::roads', providerId: 'lastfm', itemKind: 'candidate',
    artist: 'Portishead', title: 'Roads', album: 'Dummy', duration: 0,
  };
  const provider = createLastfmProvider({
    start: async () => ({ items: [candidate], providerSession: { version: 1, genreIds: ['trip-hop'], poolKey: 'test-pool' }, exhausted: true }),
    next: async () => ({ items: [], exhausted: true }),
  });
  const streamResolver = createRadioStreamResolver({
    runYtdlp: async (args) => {
      assert.match(args[0], /^ytsearch10:/);
      return { entries: [{ id: 'abcdefghijk', title: 'Portishead - Roads', uploader: 'Portishead - Topic', duration: 307 }] };
    },
  });
  const playbackResolver = createPlaybackResolver({
    matchLocal: () => null,
    resolveYouTube: (value, context) => streamResolver.resolveCandidate(value, context.requestId),
  });
  const started = await provider.startStation({ genreIds: ['trip-hop'] });
  const controller = new RadioResolutionController({
    resolve: (value) => playbackResolver.resolve({ candidateId: value.id, artist: value.artist, title: value.title, album: value.album, duration: value.duration }, { musicFiles: [], requestId: 'pipeline-test' }),
    nextBatch: () => provider.nextBatch(started.providerSession),
  });
  const playable = await controller.fill({}, started.items);
  assert.equal(playable.length, 1);
  assert.deepEqual(playable[0].playback, { kind: 'youtube', videoId: 'abcdefghijk' });
});
