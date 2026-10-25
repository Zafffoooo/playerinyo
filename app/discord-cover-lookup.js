'use strict';

const fs = require('node:fs');
const MUSICBRAINZ_ORIGIN = 'https://musicbrainz.org';
const COVER_ORIGIN = 'https://coverartarchive.org';
const USER_AGENT = `Playerinyo/${require('../package.json').version} (https://github.com/Zafffoooo/playerinyo)`;
const MAX_CACHE_ITEMS = 600;
const POSITIVE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();
let cacheFile = '';
let saveTimer = null;
let nextMusicBrainzRequestAt = 0;
let requestQueue = Promise.resolve();

function configureDiscordCoverCache(file) {
  cacheFile = typeof file === 'string' ? file : '';
  if (!cacheFile) return;
  try {
    if (fs.statSync(cacheFile).size > 1024 * 1024) return;
    const data = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (!Array.isArray(data)) return;
    for (const item of data.slice(-MAX_CACHE_ITEMS)) {
      if (Array.isArray(item) && typeof item[0] === 'string' && item[0].length < 650 && item[1] && item[1].until > Date.now() && item[1].result && typeof item[1].result.url === 'string') cache.set(item[0], item[1]);
    }
  } catch (_) { /* A missing or damaged cache must not affect playback. */ }
}

function scheduleCacheSave() {
  if (!cacheFile || saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const temp = cacheFile + '.tmp';
    fs.promises.writeFile(temp, JSON.stringify(Array.from(cache.entries())), { mode: 0o600 })
      .then(() => fs.promises.rename(temp, cacheFile)).catch(() => {});
  }, 1000);
  if (saveTimer.unref) saveTimer.unref();
}

function normalized(value) {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '')
    .replace(/\b(feat|featuring|ft)\.?\b.*$/i, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function sameTitle(expected, actual) {
  return !!expected && normalized(expected) === normalized(actual);
}

function matchingRelease(track, recording, release) {
  if (!sameTitle(track.title, recording.title)) return false;
  const creditedArtist = (recording['artist-credit'] || []).map((part) => part && (part.name || part.artist && part.artist.name) || '').join('');
  if (!normalized(track.artist) || !normalized(creditedArtist).includes(normalized(track.artist))) return false;
  if (track.album && !sameTitle(track.album, release.title)) return false;
  return /^[a-f0-9-]{36}$/i.test(String(release.id || ''));
}

async function waitForSlot(signal) {
  if (signal && signal.aborted) throw new Error('cancelled');
  const wait = Math.max(0, nextMusicBrainzRequestAt - Date.now());
  if (wait) await new Promise((resolve, reject) => {
    const done = () => { if (signal) signal.removeEventListener('abort', cancelled); resolve(); };
    const cancelled = () => { clearTimeout(timer); reject(new Error('cancelled')); };
    const timer = setTimeout(done, wait);
    if (signal) signal.addEventListener('abort', cancelled, { once: true });
  });
  if (signal && signal.aborted) throw new Error('cancelled');
  nextMusicBrainzRequestAt = Date.now() + 1100;
}

async function musicBrainzJson(path, signal) {
  const task = requestQueue.then(async () => {
    await waitForSlot(signal);
    const response = await fetch(MUSICBRAINZ_ORIGIN + path, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' } });
    if (response.status === 503 || response.status === 429) {
      const retry = Number(response.headers.get('retry-after'));
      nextMusicBrainzRequestAt = Math.max(nextMusicBrainzRequestAt, Date.now() + (Number.isFinite(retry) && retry > 0 ? Math.min(retry * 1000, 60000) : 15000));
      throw new Error('MusicBrainz is busy; retry later');
    }
    if (!response.ok) throw new Error(`MusicBrainz HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length')) || 0;
    if (length > 1024 * 1024) throw new Error('MusicBrainz response too large');
    const body = await response.text();
    if (Buffer.byteLength(body) > 1024 * 1024) throw new Error('MusicBrainz response too large');
    return JSON.parse(body);
  });
  requestQueue = task.catch(() => {});
  return task;
}

async function findRelease(track, signal) {
  const mbid = String(track.trackMbid || '').trim();
  if (/^[a-f0-9-]{36}$/i.test(mbid)) {
    try {
      const recording = await musicBrainzJson(`/ws/2/recording/${encodeURIComponent(mbid)}?inc=releases+artists&fmt=json`, signal);
      const release = (recording.releases || []).find((item) => matchingRelease(track, recording, item));
      if (release) return release;
    } catch (error) { if (signal && signal.aborted) throw error; }
  }
  const query = `recording:"${String(track.title || '').replace(/["\\]/g, ' ').slice(0, 120)}" AND artist:"${String(track.artist || '').replace(/["\\]/g, ' ').slice(0, 120)}"`;
  const data = await musicBrainzJson(`/ws/2/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=8`, signal);
  for (const recording of data.recordings || []) {
    const release = (recording.releases || []).find((item) => matchingRelease(track, recording, item));
    if (release) return release;
  }
  return null;
}

async function lookupDiscordCover(track, signal, refresh) {
  const safeTrack = {
    title: String(track && track.title || '').trim().slice(0, 160),
    artist: String(track && track.artist || '').trim().slice(0, 160),
    album: String(track && track.album || '').trim().slice(0, 160),
    trackMbid: String(track && track.trackMbid || '').trim().slice(0, 80),
  };
  if (!safeTrack.title || !safeTrack.artist) return { status: 'not-found', url: '' };
  const key = [safeTrack.title, safeTrack.artist, safeTrack.album, safeTrack.trackMbid].map(normalized).join('|');
  const saved = cache.get(key);
  if (!refresh && saved && saved.until > Date.now()) return { ...saved.result, cached: true };
  try {
    const release = await findRelease(safeTrack, signal);
    let result = { status: 'not-found', url: '' };
    if (release) {
      const imageUrl = `${COVER_ORIGIN}/release/${release.id}/front-500`;
      const response = await fetch(imageUrl, { method: 'HEAD', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000), headers: { 'User-Agent': USER_AGENT } });
      if (response.status === 429 || response.status >= 500) throw new Error(`Cover Art Archive HTTP ${response.status}`);
      if (response.ok && response.url.startsWith('https:') && String(response.headers.get('content-type') || '').startsWith('image/')) {
        result = { status: 'matched', url: imageUrl, source: 'Cover Art Archive', release: release.title };
      }
    }
    if (!signal || !signal.aborted) {
      cache.set(key, { result, until: Date.now() + (result.url ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS) });
      if (cache.size > MAX_CACHE_ITEMS) cache.delete(cache.keys().next().value);
      scheduleCacheSave();
    }
    return result;
  } catch (error) {
    if (signal && signal.aborted) return { status: 'cancelled', url: '' };
    return { status: 'error', url: '', error: String(error && error.message || error).slice(0, 160) };
  }
}

module.exports = { lookupDiscordCover, configureDiscordCoverCache };
