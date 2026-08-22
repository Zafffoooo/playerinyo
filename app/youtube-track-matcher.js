'use strict';

// This file is loaded as a classic browser script after local-track-matcher.
// Use a distinct binding: redeclaring its global `normalizeText` makes the
// browser reject this script before it can export its API.
const youtubeLocalTrackMatcher = typeof require === 'function' ? require('./local-track-matcher') : window.LocalTrackMatcher;
const normalizeMatcherText = youtubeLocalTrackMatcher.normalizeText;
const MATCHER_VERSION = 3;
const STRONG_MODIFIERS = ['live', 'remix', 'acoustic', 'instrumental', 'radio edit', 'clean', 'censored', 'cover', 'karaoke', 'slowed', 'sped up', 'nightcore', 'reaction', 'tutorial', 'fan edit'];
const BENIGN_MODIFIERS = ['remaster', 'remastered'];

function tokens(value) { return new Set(normalizeMatcherText(value).split(' ').filter(Boolean)); }
function hasPhrase(text, phrase) { return (' ' + normalizeMatcherText(text) + ' ').includes(' ' + phrase + ' '); }
function modifiers(value) {
  var text = normalizeMatcherText(value);
  var result = new Set();
  STRONG_MODIFIERS.concat(BENIGN_MODIFIERS).forEach(function (m) { if (hasPhrase(text, m)) result.add(m); });
  return result;
}
function overlap(a, b) {
  var aa = tokens(a); var bb = tokens(b); if (!aa.size || !bb.size) return 0;
  var hit = 0; aa.forEach(function (x) { if (bb.has(x)) hit++; });
  return hit / Math.max(aa.size, bb.size);
}
function normalizeDuration(value) {
  var number = Number(value); if (!Number.isFinite(number) || number <= 0) return 0;
  return number > 10000 ? number / 1000 : number;
}
function fieldText(value) {
  if (value && typeof value === 'object') return String(value.name || value['#text'] || '');
  return String(value || '');
}
function stripPresentationQualifiers(value) {
  return normalizeMatcherText(value)
    .replace(/\b(official(?: music)? video|official audio|audio only|provided to youtube|auto generated|hd|hq|\d{4} remaster(?:ed)?)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function getVideoId(result) {
  var id = String(result && (result.videoId || result.id) || '');
  if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
  try { var parsed = new URL(String(result && (result.url || result.webpage_url) || '')); var v = parsed.searchParams.get('v'); return /^[A-Za-z0-9_-]{11}$/.test(v || '') ? v : ''; } catch (_) { return ''; }
}
function scoreYouTubeResult(candidate, result, preferences) {
  var videoId = getVideoId(result); if (!videoId) return { accepted: false, confidence: 0, videoId: '' };
  var cTitle = normalizeMatcherText(candidate.title); var cArtist = normalizeMatcherText(candidate.artist);
  var rawTitle = fieldText(result.track) || fieldText(result.title);
  var rTitle = normalizeMatcherText(rawTitle); var displayTitle = normalizeMatcherText(result.title);
  var comparableTitle = stripPresentationQualifiers(rawTitle); var comparableDisplayTitle = stripPresentationQualifiers(result.title);
  var artistSources = [result.uploader, result.channel, result.channel_name, result.artist, result.creator].map(fieldText).join(' ');
  var artistText = normalizeMatcherText(artistSources);
  var canonicalCandidateTitle = stripPresentationQualifiers(candidate.title);
  var titleExact = comparableTitle === cTitle || comparableDisplayTitle === cTitle || comparableTitle === canonicalCandidateTitle || comparableDisplayTitle === canonicalCandidateTitle
    || comparableTitle === normalizeMatcherText(cArtist + ' ' + cTitle) || comparableDisplayTitle === normalizeMatcherText(cArtist + ' ' + cTitle)
    || comparableTitle === normalizeMatcherText(cTitle + ' ' + cArtist) || comparableDisplayTitle === normalizeMatcherText(cTitle + ' ' + cArtist);
  var titleOverlap = Math.max(overlap(cTitle, comparableTitle), overlap(cTitle, comparableDisplayTitle));
  var titleContainsCandidate = hasPhrase(comparableTitle, cTitle) || hasPhrase(comparableDisplayTitle, cTitle);
  var artistEvidence = artistText === cArtist || hasPhrase(artistText, cArtist) || hasPhrase(displayTitle, cArtist) || hasPhrase(rTitle, cArtist);
  if ((!titleExact && !titleContainsCandidate && titleOverlap < 0.72) || !artistEvidence) {
    return { accepted: false, confidence: 0, videoId: videoId, reason: !artistEvidence ? 'artist-hard-gate' : 'title-hard-gate' };
  }
  var candidateMods = modifiers([candidate.title, candidate.version].filter(Boolean).join(' '));
  var resultMods = modifiers([result.title, result.track, result.description].filter(Boolean).join(' '));
  var mismatch = false;
  STRONG_MODIFIERS.forEach(function (m) { if (resultMods.has(m) !== candidateMods.has(m)) mismatch = true; });
  if (mismatch) return { accepted: false, confidence: 0, videoId: videoId, reason: 'modifier' };
  var prefs = preferences || {};
  // Preferences only narrow an already safe semantic match. Turning one off
  // never makes a mismatched live/remix/cover result an ideal recording.
  var avoid = {
    live: prefs.avoidLive === true,
    cover: prefs.avoidCovers === true,
    remix: prefs.avoidRemixes === true,
    slowed: prefs.avoidSlowedSped === true,
    'sped up': prefs.avoidSlowedSped === true,
    nightcore: prefs.avoidSlowedSped === true,
    clean: prefs.avoidClean === true,
    censored: prefs.avoidClean === true,
    'radio edit': prefs.avoidClean === true,
  };
  var rejectedByPreference = Object.keys(avoid).some(function (modifier) { return avoid[modifier] && resultMods.has(modifier) && !candidateMods.has(modifier); });
  if (rejectedByPreference) return { accepted: false, confidence: 0, videoId: videoId, reason: 'preference-version' };
  var official = /topic$/.test(artistText) || /official|vevo/.test(artistText) || result.is_verified === true || /provided to youtube|official audio/.test(normalizeMatcherText([result.title, result.track, result.description].filter(Boolean).join(' ')));
  var score = 0.35 + (titleExact ? 0.28 : 0.22 * titleOverlap) + (artistEvidence ? 0.22 : 0) + (official ? 0.08 : 0);
  if (candidate.album && normalizeMatcherText(candidate.album) && hasPhrase((result.title || '') + ' ' + (result.description || ''), normalizeMatcherText(candidate.album))) score += 0.03;
  var cd = normalizeDuration(candidate.duration); var rd = normalizeDuration(result.duration);
  var closeDuration = false;
  if (cd && rd) {
    var diff = Math.abs(cd - rd); closeDuration = diff <= 8;
    if (diff <= 3) score += 0.08; else if (diff <= 8) score += 0.05; else if (diff <= Math.max(20, cd * 0.08)) score += 0.01; else score -= 0.12;
  }
  BENIGN_MODIFIERS.forEach(function (m) { if (resultMods.has(m) && !candidateMods.has(m)) score -= 0.02; });
  score = Math.max(0, Math.min(1, score));
  var accepted = score >= 0.82 || (score >= 0.76 && official && closeDuration);
  return { accepted: accepted, confidence: score, videoId: videoId, official: official, closeDuration: closeDuration, titleExact: titleExact, resultModifiers: Array.from(resultMods).sort(), reason: accepted ? '' : 'confidence-threshold', result: result };
}
function equivalentRecording(first, second) {
  if (!first || !second) return false;
  if ((first.resultModifiers || []).join('|') !== (second.resultModifiers || []).join('|')) return false;
  var firstDuration = normalizeDuration(first.result && first.result.duration);
  var secondDuration = normalizeDuration(second.result && second.result.duration);
  return !(firstDuration && secondDuration) || Math.abs(firstDuration - secondDuration) <= Math.max(8, Math.min(firstDuration, secondDuration) * 0.08);
}
function chooseYouTubeMatch(candidate, results, preferences) {
  var byId = new Map();
  (results || []).forEach(function (result) { var scored = scoreYouTubeResult(candidate, result, preferences); if (scored.videoId && (!byId.has(scored.videoId) || byId.get(scored.videoId).confidence < scored.confidence)) byId.set(scored.videoId, scored); });
  var ranked = Array.from(byId.values()).sort(function (a, b) { return b.confidence - a.confidence; });
  var best = ranked[0];
  if (!best || !best.accepted) return null;
  // Official/Topic duplicates frequently describe the same recording.  The
  // confidence margin protects against a *different* recording/version only.
  var competing = ranked.find(function (candidateResult) { return candidateResult.videoId !== best.videoId && !equivalentRecording(best, candidateResult); });
  if (competing && best.confidence - competing.confidence < 0.08) return null;
  return best;
}
function buildSearchQueries(candidate) {
  var title = String(candidate.title || '').trim(); var artist = String(candidate.artist || '').trim();
  return ['"' + title + '" "' + artist + '"', artist + ' ' + title, artist + ' ' + title + ' Topic', artist + ' ' + title + ' Official Audio', artist + ' ' + title + ' ' + String(candidate.album || 'Album')].filter(Boolean);
}
var youtubeTrackMatcherApi = { MATCHER_VERSION, STRONG_MODIFIERS, modifiers, normalizeDuration, stripPresentationQualifiers, getVideoId, scoreYouTubeResult, equivalentRecording, chooseYouTubeMatch, buildSearchQueries };
if (typeof module !== 'undefined' && module.exports) module.exports = youtubeTrackMatcherApi;
if (typeof window !== 'undefined') window.YouTubeTrackMatcher = youtubeTrackMatcherApi;
