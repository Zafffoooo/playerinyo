'use strict';

const { chooseYouTubeMatch, scoreYouTubeResult, buildSearchQueries, MATCHER_VERSION } = require('./youtube-track-matcher');
const { DurableMatchCache, RuntimeLeaseCache } = require('./radio-stream-cache');

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const NEGATIVE_CACHE_TTL_MS = 10 * 60 * 1000;
const RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000;
function candidateKey(candidate) { return [candidate.trackMbid || '', candidate.artist || '', candidate.title || '', candidate.album || '', Math.round(Number(candidate.duration) || 0)].join('::').toLocaleLowerCase(); }
function parseExpiry(url, now) { try { const value = new URL(url).searchParams.get('expire'); const seconds = Number(value); return Number.isFinite(seconds) && seconds * 1000 > now() ? seconds * 1000 : now() + 5 * 60 * 1000; } catch (_) { return now() + 5 * 60 * 1000; } }
function validateMediaSource(format) {
  if (!format || typeof format.url !== 'string') return null;
  let parsed; try { parsed = new URL(format.url); } catch (_) { return null; }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  const acodec = String(format.acodec || '').toLowerCase(); const vcodec = String(format.vcodec || 'none').toLowerCase(); const ext = String(format.ext || '').toLowerCase();
  if (!acodec || acodec === 'none' || vcodec !== 'none') return null;
  if (!['m4a', 'webm', 'opus', 'mp3', 'aac'].includes(ext)) return null;
  return { url: parsed.href, headers: format.http_headers && typeof format.http_headers === 'object' ? format.http_headers : {}, preference: ext === 'm4a' ? 3 : (ext === 'webm' || ext === 'opus' ? 2 : 1) };
}
function chooseAudioFormat(info) { return (info && info.formats || []).map(validateMediaSource).filter(Boolean).sort((a, b) => b.preference - a.preference)[0] || null; }
function parseSearchPayload(text) {
  const value = String(text || '').trim(); if (!value) throw new Error('yt-dlp returned invalid resolver data.');
  try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object') return parsed; } catch (_) { /* Fall back to line-delimited JSON. */ }
  let entries; try { entries = value.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)); } catch (_) { throw new Error('yt-dlp returned malformed resolver data.'); }
  if (!entries.length || !entries.every((entry) => entry && typeof entry === 'object')) throw new Error('yt-dlp returned malformed resolver data.');
  return { entries };
}
function isRateLimitError(error) {
  var text = String(error && (error.stderr || error.message || error) || '').toLocaleLowerCase();
  return /rate[- ]limited by youtube|rate limit|try again later/.test(text) && /youtube|rate/.test(text);
}
function flatSearchArgs(query) { return ['ytsearch10:' + query, '--flat-playlist', '--dump-single-json', '--no-playlist']; }
function detailArgs(videoId) { return ['https://www.youtube.com/watch?v=' + videoId, '--dump-single-json', '--no-playlist']; }
function createRadioStreamResolver(deps) {
  deps = deps || {}; const now = deps.now || Date.now; const cache = deps.matchCache || new DurableMatchCache(); const leases = deps.leaseCache || new RuntimeLeaseCache({ now }); const negative = new Map(); const pending = new Set(); let cooldownUntil = 0; let rateLimitTrips = 0;
  if (typeof deps.runYtdlp !== 'function') throw new Error('runYtdlp is required');
  async function resolveCandidate(candidate, requestId, preferences) {
    const preferenceKey = JSON.stringify(preferences || {}); const startedAt = now(); const key = candidateKey(candidate) + '::prefs:' + preferenceKey; const hit = cache.get(key, MATCHER_VERSION);
    const baseMetrics = { totalMs: 0, searches: 0, flatSearchMs: 0, flatSearchCount: 0, detailedExtractionCount: 0, shortlistSize: 0, matcherMs: 0, cacheHit: false, rateLimitTrips };
    if (hit) return { videoId: hit.videoId, confidence: hit.confidence, cached: true, metrics: Object.assign(baseMetrics, { totalMs: now() - startedAt, cacheHit: true }) };
    if (cooldownUntil > now()) return { rateLimited: true, metrics: Object.assign(baseMetrics, { totalMs: now() - startedAt, rateLimitTrips }) };
    if ((negative.get(key) || 0) > now()) return null;
    const query = buildSearchQueries(candidate)[0]; let data;
    pending.add(requestId);
    try {
      const searchStartedAt = now(); data = await deps.runYtdlp(flatSearchArgs(query), requestId); baseMetrics.flatSearchMs = now() - searchStartedAt; baseMetrics.flatSearchCount = 1; baseMetrics.searches = 1;
    } catch (error) {
      if (isRateLimitError(error)) {
        cooldownUntil = now() + RATE_LIMIT_COOLDOWN_MS; rateLimitTrips++; baseMetrics.rateLimitTrips = rateLimitTrips;
        pending.forEach((id) => { if (id !== requestId && typeof deps.cancel === 'function') deps.cancel(id); });
        if (typeof deps.onRateLimit === 'function') deps.onRateLimit({ until: cooldownUntil, requestId });
        return { rateLimited: true, metrics: Object.assign(baseMetrics, { totalMs: now() - startedAt }) };
      }
      throw error;
    } finally { pending.delete(requestId); }
    const entries = Array.isArray(data && data.entries) ? data.entries.filter((entry) => VIDEO_ID.test(String(entry && (entry.id || entry.videoId) || ''))) : [];
    const matcherStartedAt = now(); let match = chooseYouTubeMatch(candidate, entries, preferences); baseMetrics.matcherMs += now() - matcherStartedAt;
    // Flat metadata is often sufficient. Only uncertainty receives bounded
    // per-video detail work; never extract the complete search result set.
    if (!match) {
      const shortlist = entries.slice(0, 2); baseMetrics.shortlistSize = shortlist.length;
      const detailed = [];
      for (const entry of shortlist) {
        try { pending.add(requestId); const info = await deps.runYtdlp(detailArgs(entry.id || entry.videoId), requestId); baseMetrics.detailedExtractionCount++; detailed.push(Object.assign({}, entry, info || {})); }
        catch (error) {
          if (isRateLimitError(error)) { cooldownUntil = now() + RATE_LIMIT_COOLDOWN_MS; rateLimitTrips++; baseMetrics.rateLimitTrips = rateLimitTrips; pending.forEach((id) => { if (id !== requestId && typeof deps.cancel === 'function') deps.cancel(id); }); if (typeof deps.onRateLimit === 'function') deps.onRateLimit({ until: cooldownUntil, requestId }); return { rateLimited: true, metrics: Object.assign(baseMetrics, { totalMs: now() - startedAt }) }; }
        } finally { pending.delete(requestId); }
      }
      const detailStartedAt = now(); match = chooseYouTubeMatch(candidate, detailed, preferences); baseMetrics.matcherMs += now() - detailStartedAt;
    }
    if (!match) {
      negative.set(key, now() + NEGATIVE_CACHE_TTL_MS);
      const top = entries.map((result) => ({ scored: scoreYouTubeResult(candidate, result, preferences), result }))
        .sort((a, b) => b.scored.confidence - a.scored.confidence)[0];
      if (typeof deps.onDiagnostic === 'function') deps.onDiagnostic({
        candidate: { artist: candidate.artist, title: candidate.title, duration: candidate.duration || 0 },
        topResult: top ? { title: top.result.title || '', channel: top.result.channel || top.result.uploader || '', artist: top.result.artist || '', track: top.result.track || '', duration: top.result.duration || 0 } : null,
        score: top ? top.scored.confidence : 0,
        reason: top ? (top.scored.reason || 'ambiguous-margin') : 'no-video-results',
      });
      if (typeof deps.onMetrics === 'function') deps.onMetrics({ candidate, ...Object.assign(baseMetrics, { totalMs: now() - startedAt }), accepted: false });
      return null;
    }
    cache.set({ candidateKey: key, aliasKey: '', videoId: match.videoId, confidence: match.confidence, matcherVersion: MATCHER_VERSION, verifiedAt: now() });
    const resolved = { videoId: match.videoId, confidence: match.confidence, cached: false, metrics: Object.assign(baseMetrics, { totalMs: now() - startedAt }) };
    if (typeof deps.onMetrics === 'function') deps.onMetrics({ candidate, ...resolved.metrics, accepted: true });
    return resolved;
  }
  async function prepare(videoId, ownership, requestId) {
    if (!VIDEO_ID.test(videoId || '')) throw new Error('Invalid YouTube video ID');
    let info;
    try { info = await deps.runYtdlp(detailArgs(videoId), requestId); }
    catch (error) { if (cache.invalidateVideoId) cache.invalidateVideoId(videoId); throw error; }
    const source = chooseAudioFormat(info); if (!source) { if (cache.invalidateVideoId) cache.invalidateVideoId(videoId); throw new Error('No supported HTTPS audio format is available.'); }
    source.expiresAt = parseExpiry(source.url, now); const lease = leases.create(videoId, source, ownership);
    return { src: 'playerinyo-stream://lease/' + lease.leaseId, leaseId: lease.leaseId, expiresAt: lease.expiresAt };
  }
  function clearCooldown() { cooldownUntil = 0; negative.clear(); }
  return { resolveCandidate, prepare, cancel: deps.cancel || (() => false), getLease: (id, ownership) => leases.get(id, ownership), release: (id) => leases.release(id), releaseByOwnership: (owner) => leases.releaseByOwnership(owner), clear: () => { clearCooldown(); leases.clear(); }, clearCooldown, getCooldown: () => Math.max(0, cooldownUntil - now()), matchCache: cache, leaseCache: leases };
}
module.exports = { VIDEO_ID, candidateKey, parseExpiry, validateMediaSource, chooseAudioFormat, parseSearchPayload, isRateLimitError, flatSearchArgs, detailArgs, createRadioStreamResolver };
