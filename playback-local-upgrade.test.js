'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcilePlaybackCollections } = require('./playback-local-upgrade');

test('remote-to-local replacement updates every queue, cursor, and current-track reference consistently', () => {
  const remote = { title: 'Roads', artist: 'Portishead', playback: { kind: 'youtube', videoId: 'abcdefghijk' }, queueEntryId: 'radio-1' };
  const replacement = { ...remote, matchedFile: { filePath: '/music/Roads.opus' }, playback: { kind: 'local-file', filePath: '/music/Roads.opus' }, resolvedSource: 'local' };
  const result = reconcilePlaybackCollections({
    playQueueTracks: [remote], shuffleQueue: [remote], userQueue: [remote],
    playQueueCursor: remote, shuffleQueueCursor: remote, currentPlayingTrack: remote,
  }, (track) => track === remote ? replacement : track);
  assert.equal(result.playQueueTracks[0], replacement);
  assert.equal(result.shuffleQueue[0], replacement);
  assert.equal(result.userQueue[0], replacement);
  assert.equal(result.playQueueCursor, replacement);
  assert.equal(result.shuffleQueueCursor, replacement);
  assert.equal(result.currentPlayingTrack, replacement);
});

test('unmatched references retain their original object identity', () => {
  const local = { matchedFile: { filePath: '/music/a.flac' } };
  const result = reconcilePlaybackCollections({ playQueueTracks: [local] }, () => null);
  assert.equal(result.playQueueTracks[0], local);
});
