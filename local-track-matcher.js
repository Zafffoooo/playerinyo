'use strict';

function normalizeText(value) {
  return String(value || '').normalize('NFKC')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u2010-\u2015]/g, '-')
    .toLocaleLowerCase()
    .replace(/[-]+/g, ' ')
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ').trim();
}

function normalizeMbid(value) {
  var text = String(value || '').trim().toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(text) ? text : '';
}

function durationClose(a, b) {
  a = Number(a); b = Number(b);
  return a > 0 && b > 0 && Math.abs(a - b) <= Math.max(8, Math.min(a, b) * 0.04);
}

function matchLocalTrack(candidate, library, options) {
  if (!candidate || !Array.isArray(library)) return null;
  var unavailable = options && options.unplayableFilePaths;
  var playable = library.filter(function (file) {
    return file && file.filePath && !(unavailable && unavailable.has && unavailable.has(file.filePath));
  });
  var mbid = normalizeMbid(candidate.trackMbid || candidate.recordingMbid || candidate.mbid);
  if (mbid) {
    var byMbid = playable.filter(function (file) { return normalizeMbid(file.trackMbid || file.recordingMbid) === mbid; });
    if (byMbid.length === 1) return byMbid[0];
    if (byMbid.length > 1) return disambiguate(candidate, byMbid);
  }
  var title = normalizeText(candidate.title);
  var artist = normalizeText(candidate.artist);
  if (!title || !artist) return null;
  var exact = playable.filter(function (file) {
    return normalizeText(file.title || file.filename && file.filename.replace(/\.[^.]+$/, '')) === title
      && normalizeText(file.artist || file.albumArtist) === artist;
  });
  if (exact.length === 1) {
    var only = exact[0];
    var candidateAlbum = normalizeText(candidate.album);
    var localAlbum = normalizeText(only.album);
    if (candidateAlbum && localAlbum && candidateAlbum !== localAlbum) return null;
    if (candidate.duration && only.duration && !durationClose(candidate.duration, only.duration)) return null;
    // A title/artist pair alone is not enough to distinguish a studio cut
    // from an untagged live/remaster/alternate recording. Keep local-first
    // only when album or duration provides at least one corroborating signal;
    // otherwise let the remote resolver make a version-aware decision.
    var hasAlbumEvidence = !!(candidateAlbum && localAlbum && candidateAlbum === localAlbum);
    var hasDurationEvidence = !!(candidate.duration && only.duration && durationClose(candidate.duration, only.duration));
    if (!hasAlbumEvidence && !hasDurationEvidence) return null;
    return only;
  }
  return exact.length > 1 ? disambiguate(candidate, exact) : null;
}

function disambiguate(candidate, matches) {
  var album = normalizeText(candidate.album);
  var narrowed = album ? matches.filter(function (file) { return normalizeText(file.album) === album; }) : matches.slice();
  if (!narrowed.length) return null;
  if (narrowed.length === 1 && (!candidate.duration || durationClose(candidate.duration, narrowed[0].duration))) return narrowed[0];
  var byDuration = narrowed.filter(function (file) { return durationClose(candidate.duration, file.duration); });
  return byDuration.length === 1 ? byDuration[0] : null;
}

var localTrackMatcherApi = { normalizeText, normalizeMbid, durationClose, matchLocalTrack };
if (typeof module !== 'undefined' && module.exports) module.exports = localTrackMatcherApi;
if (typeof window !== 'undefined') window.LocalTrackMatcher = localTrackMatcherApi;
