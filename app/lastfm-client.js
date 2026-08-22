'use strict';

const API_ORIGIN = 'https://ws.audioscrobbler.com/2.0/';
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_CACHE_ENTRIES = 120;

function restoreCacheEntries(value, now) {
  const restored = [];
  const entries = value && Array.isArray(value.entries) ? value.entries : [];
  entries.slice(-MAX_CACHE_ENTRIES).forEach((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'string' || !entry[1] || typeof entry[1] !== 'object') return;
    if (!Number.isFinite(entry[1].expiresAt) || entry[1].expiresAt <= now) return;
    try {
      if (Buffer.byteLength(JSON.stringify(entry[1].value), 'utf8') <= 512 * 1024) restored.push([entry[0].slice(0, 1000), { value: entry[1].value, expiresAt: entry[1].expiresAt }]);
    } catch (_) { }
  });
  return restored;
}

function createLastfmError(code, message, retryable) {
  const error = new Error(message);
  error.code = code;
  error.retryable = !!retryable;
  return error;
}

function validateResponseShape(method, data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw createLastfmError('malformed-response', 'Last.fm returned an invalid response shape.');
  const rootByMethod = {
    // Last.fm uses "tracks" for tag charts, unlike artist.gettoptracks
    // and user.gettoptracks which use "toptracks".
    'tag.gettoptracks': 'tracks',
    'tag.gettopartists': 'topartists',
    'artist.gettoptracks': 'toptracks',
    'artist.getsimilar': 'similarartists',
    'artist.gettoptags': 'toptags',
    'track.getinfo': 'track',
    'track.getsimilar': 'similartracks',
    'tag.getsimilar': 'similartags',
    'user.getrecenttracks': 'recenttracks',
  };
  const root = data[rootByMethod[method]];
  if (!root || typeof root !== 'object' || Array.isArray(root)) throw createLastfmError('malformed-response', `Last.fm ${method} response is missing ${rootByMethod[method]}.`);
  if (method === 'user.getrecenttracks') {
    const attr = root['@attr'];
    if (!attr || typeof attr !== 'object' || Array.isArray(attr) || !Number.isFinite(Number(attr.page)) || !Number.isFinite(Number(attr.totalPages))) {
      throw createLastfmError('malformed-response', 'Last.fm recent tracks response is missing pagination metadata.');
    }
  }
  return data;
}

function createLastfmApiClient(options) {
  options = options || {};
  const fetchImpl = options.fetch || global.fetch;
  const getApiKey = options.getApiKey || (() => '');
  const cache = options.cache || new Map();
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 10000);
  const maxAttempts = Math.max(1, Math.min(3, Number(options.maxAttempts) || 3));
  const inFlight = new Map();
  const ttlByMethod = { 'tag.gettoptracks': 24 * 60 * 60 * 1000, 'tag.gettopartists': 24 * 60 * 60 * 1000, 'artist.gettoptracks': 3 * 24 * 60 * 60 * 1000, 'artist.getsimilar': 7 * 24 * 60 * 60 * 1000, 'artist.gettoptags': 7 * 24 * 60 * 60 * 1000, 'track.getinfo': 24 * 60 * 60 * 1000, 'track.getsimilar': 7 * 24 * 60 * 60 * 1000, 'tag.getsimilar': 7 * 24 * 60 * 60 * 1000 };
  let active = 0;
  let nextRequestAt = 0;
  const waiting = [];

  function runLimited(task) {
    return new Promise((resolve, reject) => {
      waiting.push({ task, resolve, reject });
      pump();
    });
  }
  function pump() {
    while (active < 2 && waiting.length) {
      const entry = waiting.shift(); active++;
      const delay = Math.max(0, nextRequestAt - Date.now());
      nextRequestAt = Math.max(nextRequestAt, Date.now()) + 300;
      setTimeout(() => entry.task().then(entry.resolve, entry.reject).finally(() => { active--; pump(); }), delay);
    }
  }
  function cacheKey(method, params) {
    return `${method}|${Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join('&')}`;
  }
  async function request(method, params) {
    method = String(method || '').toLowerCase();
    if (!ttlByMethod[method] && method !== 'user.getrecenttracks') throw createLastfmError('method', 'Unsupported Last.fm discovery method.');
    const apiKey = String(getApiKey() || '').trim();
    if (!apiKey) throw createLastfmError('credentials', 'A Last.fm API key is required.');
    const safeParams = { ...(params || {}) };
    const key = cacheKey(method, safeParams);
    let cached = cache.get(key);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      // API-client cache entries keep raw method responses. Validate them at
      // the same boundary as network responses; normalized discovery pools
      // live in a separate cache and never enter this map.
      try { return validateResponseShape(method, cached.value); }
      catch (_) { cache.delete(key); cached = null; }
    }
    if (inFlight.has(key)) return inFlight.get(key);
    const work = runLimited(async () => {
      let lastError;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const url = new URL(API_ORIGIN);
          url.search = new URLSearchParams({ method, api_key: apiKey, format: 'json', ...safeParams }).toString();
          const response = await fetchImpl(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
          const contentLength = Number(response.headers && response.headers.get && response.headers.get('content-length') || 0);
          if (contentLength > MAX_RESPONSE_BYTES) throw createLastfmError('response-too-large', 'Last.fm response was too large.');
          const body = await response.text();
          if (Buffer.byteLength(body, 'utf8') > MAX_RESPONSE_BYTES) throw createLastfmError('response-too-large', 'Last.fm response was too large.');
          let data;
          try { data = JSON.parse(body); } catch (_) { throw createLastfmError('malformed-response', 'Last.fm returned malformed JSON.'); }
          if (!response.ok || data.error) {
            const code = Number(data.error) || response.status;
            const retryable = response.status === 429 || code === 29 || response.status >= 500;
            throw createLastfmError(code, data.message || `Last.fm request failed (${response.status}).`, retryable);
          }
          validateResponseShape(method, data);
          if (ttlByMethod[method]) {
            cache.set(key, { value: data, expiresAt: now + ttlByMethod[method] });
            while (cache.size > 120) cache.delete(cache.keys().next().value);
          }
          return data;
        } catch (error) {
          lastError = error && error.name === 'AbortError' ? createLastfmError('timeout', 'Last.fm request timed out.', true) : error;
          if (!lastError.retryable || attempt === maxAttempts - 1) break;
          await new Promise((resolve) => setTimeout(resolve, 300 * Math.pow(2, attempt) + Math.floor(Math.random() * 100)));
        } finally { clearTimeout(timeout); }
      }
      if (cached && cached.value) {
        try { return validateResponseShape(method, cached.value); }
        catch (_) { cache.delete(key); }
      }
      throw lastError || createLastfmError('failed', 'Last.fm request failed.');
    });
    inFlight.set(key, work);
    try { return await work; }
    finally { inFlight.delete(key); }
  }
  return { request, cache };
}

module.exports = { API_ORIGIN, MAX_RESPONSE_BYTES, MAX_CACHE_ENTRIES, restoreCacheEntries, createLastfmApiClient, createLastfmError, validateResponseShape };
