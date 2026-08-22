'use strict';

function reconcilePlaybackCollections(collections, replaceTrack) {
  const replacements = new Map();
  function reconcile(track) {
    if (!track) return track;
    if (replacements.has(track)) return replacements.get(track);
    const next = (typeof replaceTrack === 'function' && replaceTrack(track)) || track;
    replacements.set(track, next);
    return next;
  }
  return {
    playQueueTracks: (collections.playQueueTracks || []).map(reconcile),
    shuffleQueue: (collections.shuffleQueue || []).map(reconcile),
    userQueue: (collections.userQueue || []).map(reconcile),
    playQueueCursor: reconcile(collections.playQueueCursor),
    shuffleQueueCursor: reconcile(collections.shuffleQueueCursor),
    currentPlayingTrack: reconcile(collections.currentPlayingTrack),
  };
}

const playbackLocalUpgradeApi = { reconcilePlaybackCollections };
if (typeof module !== 'undefined' && module.exports) module.exports = playbackLocalUpgradeApi;
if (typeof window !== 'undefined') window.PlaybackLocalUpgrade = playbackLocalUpgradeApi;
