'use strict';

// local-track-matcher.js already declares a global `matchLocalTrack` when the
// renderer loads classic scripts.  Avoid redeclaring that global lexical name.
const playbackLocalTrackMatcher = typeof require === 'function' ? require('./local-track-matcher') : window.LocalTrackMatcher;
const matchLocalCandidate = playbackLocalTrackMatcher.matchLocalTrack;

function stableCandidate(candidate) {
  return {
    candidateId: String(candidate && (candidate.candidateId || candidate.id) || ''),
    trackMbid: String(candidate && (candidate.trackMbid || candidate.recordingMbid || candidate.mbid) || ''),
    title: String(candidate && candidate.title || ''), artist: String(candidate && candidate.artist || ''),
    album: String(candidate && candidate.album || ''), duration: Number(candidate && candidate.duration) || 0
  };
}
function validateResolvedTrack(track) {
  if (!track || !track.title || !track.artist || !track.playback) return false;
  if (track.playback.kind === 'local-file') return !!(track.matchedFile && track.playback.filePath);
  return track.playback.kind === 'youtube' && /^[A-Za-z0-9_-]{11}$/.test(track.playback.videoId || '');
}
function createPlaybackResolver(deps) {
  deps = deps || {};
  return {
    async resolve(candidate, context) {
      var identity = stableCandidate(candidate); if (!identity.candidateId || !identity.title || !identity.artist) return null;
      var local = (deps.matchLocal || matchLocalCandidate)(candidate, context && context.musicFiles || [], {
        unplayableFilePaths: context && context.unplayableFilePaths
      });
      if (local) return Object.assign(identity, { matchedFile: local, playback: { kind: 'local-file', filePath: local.filePath }, resolvedSource: 'local', playbackSource: 'local' });
      if (!deps.resolveYouTube) return null;
      var remote = await deps.resolveYouTube(candidate, context);
      if (context && typeof context.onRemoteResolved === 'function') context.onRemoteResolved(remote);
      if (!remote || !/^[A-Za-z0-9_-]{11}$/.test(remote.videoId || '')) return null;
      var result = Object.assign(identity, { playback: { kind: 'youtube', videoId: remote.videoId }, resolvedSource: 'youtube', playbackSource: 'youtube' });
      return validateResolvedTrack(result) ? result : null;
    },
    async preparePlayback(track, context) {
      if (!validateResolvedTrack(track)) throw new Error('Invalid resolved playback descriptor.');
      if (track.playback.kind === 'local-file') return { src: deps.toFileUrl ? deps.toFileUrl(track.playback.filePath) : track.playback.filePath };
      if (!deps.prepareYouTube) throw new Error('YouTube playback preparation is unavailable.');
      return deps.prepareYouTube(track.playback.videoId, context);
    }
  };
}
var playbackResolverApi = { stableCandidate, validateResolvedTrack, createPlaybackResolver };
if (typeof module !== 'undefined' && module.exports) module.exports = playbackResolverApi;
if (typeof window !== 'undefined') window.PlaybackResolver = playbackResolverApi;
