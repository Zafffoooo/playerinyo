'use strict';

// Queue entries can share a file path (small radio genres intentionally cycle).
// Prefer the per-entry ID when it is available, then retain the legacy path
// fallback for queues saved before entry IDs existed.
function getQueueEntryId(track) {
  return track && typeof track.queueEntryId === 'string' && track.queueEntryId ? track.queueEntryId : '';
}

function findTrackIndexByIdentity(tracks, track, getTrackKey) {
  if (!track || !Array.isArray(tracks)) return -1;
  var exactIndex = tracks.indexOf(track);
  if (exactIndex !== -1) return exactIndex;
  var entryId = getQueueEntryId(track);
  if (entryId) {
    return tracks.findIndex(function (candidate) { return getQueueEntryId(candidate) === entryId; });
  }
  var key = typeof getTrackKey === 'function' ? getTrackKey(track) : '';
  return key ? tracks.findIndex(function (candidate) { return getTrackKey(candidate) === key; }) : -1;
}

function findPreviousMatchingOccurrence(tracks, currentIndex, track, getTrackKey, matches) {
  if (!Array.isArray(tracks) || !track || currentIndex <= 0) return null;
  var entryId = getQueueEntryId(track);
  if (entryId) {
    return tracks.find(function (candidate) {
      return (!matches || matches(candidate)) && getQueueEntryId(candidate) === entryId;
    }) || null;
  }
  var key = typeof getTrackKey === 'function' ? getTrackKey(track) : '';
  if (!key) return null;
  for (var index = Math.min(currentIndex - 1, tracks.length - 1); index >= 0; index--) {
    var candidate = tracks[index];
    if ((!matches || matches(candidate)) && getTrackKey(candidate) === key) return candidate;
  }
  return null;
}

function resolveRestoredCursorIndex(tracks, track, rawIndex, getTrackKey) {
  if (!Array.isArray(tracks)) return -1;
  var index = Number(rawIndex);
  var indexedTrack = Number.isInteger(index) && index >= 0 && index < tracks.length ? tracks[index] : null;
  if (!track) return indexedTrack ? index : -1;
  var entryId = getQueueEntryId(track);
  if (entryId) return tracks.findIndex(function (candidate) { return getQueueEntryId(candidate) === entryId; });
  var key = typeof getTrackKey === 'function' ? getTrackKey(track) : '';
  if (indexedTrack && key && getTrackKey(indexedTrack) === key) return index;
  return findTrackIndexByIdentity(tracks, track, getTrackKey);
}

function shouldCancelPendingRadioStart(options) {
  return !(options && options.automaticAdvance);
}

function isCurrentPendingRadioStart(starting, startingStationId, stationId) {
  return !!starting && !!startingStationId && startingStationId === stationId;
}

function canStopRadioSession(hasRadioSession, isStarting) {
  return !!hasRadioSession || !!isStarting;
}

function resolvePlaybackSequenceCursorIndex(tracks, currentTrack, cursorTrack, preserveQueueCursors, getTrackKey) {
  if (!preserveQueueCursors) {
    var currentIndex = findTrackIndexByIdentity(tracks, currentTrack, getTrackKey);
    if (currentIndex !== -1) return currentIndex;
  }
  return findTrackIndexByIdentity(tracks, cursorTrack, getTrackKey);
}

function shouldCheckpointEmptyRadioRefill(providerSession, appendedCount) {
  return Number(appendedCount) === 0 && !!providerSession;
}

function shouldDisposeUnplayableRadioStart(providerSession, playableCount) {
  return Number(playableCount) === 0 && !!providerSession;
}

// The target keeps a station feeling ready; the cap is a safety boundary for
// provider-generated playable tracks only. Manual Up Next is never counted.
function shouldAppendProviderRadioTrack(playableAhead, target, hardCap) {
  var ahead = Math.max(0, Number(playableAhead) || 0);
  var desired = Math.max(0, Number(target) || 24);
  var maximum = Math.max(desired, Number(hardCap) || 32);
  return ahead < desired && ahead < maximum;
}

function appendPlayedRadioTrack(history, track, limit) {
  var next = Array.isArray(history) ? history.slice() : [];
  if (!track || typeof track !== 'object') return next;
  var entryId = getQueueEntryId(track);
  if (entryId && next.some(function (item) { return getQueueEntryId(item) === entryId; })) return next;
  next.push(track);
  var maximum = Math.max(1, Number(limit) || 100);
  return next.slice(-maximum);
}

function appendRadioTracksToQueues(playQueue, shuffleQueue, tracks, isShuffle) {
  if (!Array.isArray(tracks) || !tracks.length) return 0;
  playQueue.push.apply(playQueue, tracks);
  if (isShuffle) shuffleQueue.push.apply(shuffleQueue, tracks);
  return tracks.length;
}

function shouldUpdateQueueCursors(preserveQueueCursors) {
  return !preserveQueueCursors;
}
function shouldWrapQueueAtTail(hasRadioSession, currentTrack, stationId, loopMode) {
  var activeRadioTrack = !!(hasRadioSession && currentTrack && currentTrack.radioSessionId === stationId);
  return !activeRadioTrack && Number(loopMode) >= 1;
}

var radioQueueHelpersApi = { getQueueEntryId, findTrackIndexByIdentity, findPreviousMatchingOccurrence, resolveRestoredCursorIndex, appendRadioTracksToQueues, shouldUpdateQueueCursors, shouldWrapQueueAtTail, shouldCancelPendingRadioStart, isCurrentPendingRadioStart, canStopRadioSession, resolvePlaybackSequenceCursorIndex, shouldCheckpointEmptyRadioRefill, shouldDisposeUnplayableRadioStart, shouldAppendProviderRadioTrack, appendPlayedRadioTrack };
if (typeof module !== 'undefined' && module.exports) module.exports = radioQueueHelpersApi;
if (typeof window !== 'undefined') window.RadioQueueHelpers = radioQueueHelpersApi;
