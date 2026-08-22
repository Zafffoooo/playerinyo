'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findTrackIndexByIdentity,
  findPreviousMatchingOccurrence,
  resolveRestoredCursorIndex,
  appendRadioTracksToQueues,
  shouldUpdateQueueCursors,
  shouldWrapQueueAtTail,
  shouldCancelPendingRadioStart,
  isCurrentPendingRadioStart,
  canStopRadioSession,
  resolvePlaybackSequenceCursorIndex,
  shouldCheckpointEmptyRadioRefill,
  shouldDisposeUnplayableRadioStart,
  shouldAppendProviderRadioTrack,
  appendPlayedRadioTrack,
} = require('./radio-queue-helpers');

function key(track) { return track.filePath; }

test('queue entry IDs keep duplicate file occurrences distinct after hydration', () => {
  const first = { filePath: '/music/repeated.flac', queueEntryId: 'queue-a' };
  const second = { filePath: '/music/repeated.flac', queueEntryId: 'queue-b' };
  const restoredSecond = { filePath: '/music/repeated.flac', queueEntryId: 'queue-b' };

  assert.equal(findTrackIndexByIdentity([first, second], restoredSecond, key), 1);
});

test('manual Up Next explicitly preserves radio queue cursors', () => {
  assert.equal(shouldUpdateQueueCursors(true), false);
  assert.equal(shouldUpdateQueueCursors(false), true);
});
test('active radio never wraps a short queue at its tail while background refill is pending', () => {
  assert.equal(shouldWrapQueueAtTail(true, { radioSessionId: 'station-a' }, 'station-a', 1), false);
  assert.equal(shouldWrapQueueAtTail(false, { radioSessionId: 'station-a' }, 'station-a', 1), true);
  assert.equal(shouldWrapQueueAtTail(true, { radioSessionId: 'other' }, 'station-a', 1), true);
});

test('provider-generated radio appends stop at the 24-track target and never count manual Up Next', () => {
  assert.equal(shouldAppendProviderRadioTrack(7, 24, 32), true);
  assert.equal(shouldAppendProviderRadioTrack(23, 24, 32), true);
  assert.equal(shouldAppendProviderRadioTrack(24, 24, 32), false);
  assert.equal(shouldAppendProviderRadioTrack(32, 24, 32), false);
});

test('played radio history is bounded and preserves queue-entry identity outside the future queue', () => {
  let history = [];
  for (let index = 0; index < 102; index++) history = appendPlayedRadioTrack(history, { queueEntryId: `radio-${index}`, title: `Track ${index}` }, 100);
  assert.equal(history.length, 100);
  assert.equal(history[0].queueEntryId, 'radio-2');
  assert.equal(appendPlayedRadioTrack(history, { queueEntryId: 'radio-101', title: 'Duplicate' }, 100).length, 100);
});

test('manual Up Next UI resolves from the preserved radio cursor, not its matching file path', () => {
  const firstRadio = { filePath: '/music/shared.flac', queueEntryId: 'radio-first' };
  const cursorRadio = { filePath: '/music/after.flac', queueEntryId: 'radio-cursor' };
  const manualTrack = { filePath: '/music/shared.flac', queueEntryId: 'manual-up-next' };

  assert.equal(resolvePlaybackSequenceCursorIndex([firstRadio, cursorRadio], manualTrack, cursorRadio, true, key), 1);
});

test('pending start survives automatic crossfade but is invalidated by Stop or explicit playback', () => {
  assert.equal(shouldCancelPendingRadioStart({ automaticAdvance: true }), false);
  assert.equal(shouldCancelPendingRadioStart({}), true);
  assert.equal(isCurrentPendingRadioStart(true, 'station-a', 'station-a'), true);
  assert.equal(isCurrentPendingRadioStart(false, '', 'station-a'), false);
  assert.equal(canStopRadioSession(null, true), true);
  assert.equal(canStopRadioSession(null, false), false);
});

test('radio refill only extends playback queues and leaves the active view list alone', () => {
  const base = [{ filePath: '/music/old.flac' }];
  const shuffle = [{ filePath: '/music/shuffled.flac' }];
  const currentTracks = [{ filePath: '/music/album-view.flac' }];
  const refill = [{ filePath: '/music/new.flac' }];

  assert.equal(appendRadioTracksToQueues(base, shuffle, refill, true), 1);
  assert.deepEqual(base.map(key), ['/music/old.flac', '/music/new.flac']);
  assert.deepEqual(shuffle.map(key), ['/music/shuffled.flac', '/music/new.flac']);
  assert.deepEqual(currentTracks.map(key), ['/music/album-view.flac']);
});

test('previous radio history resolution chooses the nearest prior duplicate occurrence', () => {
  const first = { filePath: '/music/repeated.flac', queueEntryId: 'first', station: 'radio-a' };
  const middle = { filePath: '/music/other.flac', queueEntryId: 'middle', station: 'radio-a' };
  const second = { filePath: '/music/repeated.flac', queueEntryId: 'second', station: 'radio-a' };
  const current = { filePath: '/music/current.flac', queueEntryId: 'current', station: 'radio-a' };
  const historicalReference = { filePath: '/music/repeated.flac', queueEntryId: 'first' };

  assert.equal(
    findPreviousMatchingOccurrence([first, middle, second, current], 3, historicalReference, key, (track) => track.station === 'radio-a'),
    first,
  );
});

test('restored cursor prefers queueEntryId over a shifted duplicate file-path index', () => {
  const first = { filePath: '/music/repeated.flac', queueEntryId: 'first' };
  const second = { filePath: '/music/repeated.flac', queueEntryId: 'second' };
  const restoredSecond = { filePath: '/music/repeated.flac', queueEntryId: 'second' };

  assert.equal(resolveRestoredCursorIndex([first, second], restoredSecond, 0, key), 1);
});

test('restored cursor does not accept a shifted duplicate when its saved queue entry is missing', () => {
  const survivingDuplicate = { filePath: '/music/repeated.flac', queueEntryId: 'surviving' };
  const missingReference = { filePath: '/music/repeated.flac', queueEntryId: 'missing' };

  assert.equal(resolveRestoredCursorIndex([survivingDuplicate], missingReference, 0, key), -1);
});

test('legacy ID-less cursor still uses the saved index when it matches the file path', () => {
  const first = { filePath: '/music/repeated.flac' };
  const second = { filePath: '/music/repeated.flac' };

  assert.equal(resolveRestoredCursorIndex([first, second], { filePath: '/music/repeated.flac' }, 1, key), 1);
});

test('empty refill state is checkpointed and unplayable provider starts are disposed', () => {
  assert.equal(shouldCheckpointEmptyRadioRefill({ remainingItemIds: [] }, 0), true);
  assert.equal(shouldCheckpointEmptyRadioRefill(null, 0), false);
  assert.equal(shouldDisposeUnplayableRadioStart({ remainingItemIds: [] }, 0), true);
  assert.equal(shouldDisposeUnplayableRadioStart({ remainingItemIds: [] }, 1), false);
});
