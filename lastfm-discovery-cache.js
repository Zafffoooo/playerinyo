'use strict';

const MAX_ENTRIES = 120;
const MAX_ENTRY_BYTES = 512 * 1024;

function isNormalizedCandidate(candidate) {
  return !!candidate && typeof candidate === 'object'
    && candidate.providerId === 'lastfm' && candidate.itemKind === 'candidate'
    && typeof candidate.id === 'string' && typeof candidate.artist === 'string' && typeof candidate.title === 'string'
    && candidate.discovery && typeof candidate.discovery === 'object';
}

function isNormalizedPoolValue(value) {
  const pools = value && value.value && value.value.pools;
  return !!value && Number.isFinite(value.expiresAt) && value.value && value.value.version === 1
    && typeof value.value.genreId === 'string' && pools && typeof pools === 'object'
    && ['core', 'discovery', 'deep'].every((tier) => Array.isArray(pools[tier]) && pools[tier].every(isNormalizedCandidate));
}

function getPersistableDiscoveryCacheEntries(cache, now) {
  return Array.from(cache || []).slice(-MAX_ENTRIES).filter(([key, value]) => {
    try {
      return typeof key === 'string' && key.startsWith('pool:') && value.expiresAt > now
        && isNormalizedPoolValue(value) && Buffer.byteLength(JSON.stringify(value.value), 'utf8') <= MAX_ENTRY_BYTES;
    } catch (_) { return false; }
  });
}

function setBoundedDiscoveryCacheEntry(cache, key, value, now) {
  if (!cache || typeof cache.set !== 'function') return false;
  const current = Number.isFinite(now) ? now : Date.now();
  for (const [cacheKey, cached] of cache) {
    if (!cached || !Number.isFinite(cached.expiresAt) || cached.expiresAt <= current) cache.delete(cacheKey);
  }
  cache.delete(key);
  while (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(key, value);
  return true;
}

module.exports = { MAX_ENTRIES, MAX_ENTRY_BYTES, isNormalizedPoolValue, getPersistableDiscoveryCacheEntries, setBoundedDiscoveryCacheEntry };
