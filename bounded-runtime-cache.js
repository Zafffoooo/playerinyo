'use strict';

function getFreshEntry(cache, key, now, ttlMs) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (!Number.isFinite(entry.createdAt) || now - entry.createdAt >= ttlMs) {
    cache.delete(key);
    return null;
  }
  return entry;
}

function setBoundedEntry(cache, key, entry, options) {
  const now = options && Number.isFinite(options.now) ? options.now : Date.now();
  const ttlMs = options && Number.isFinite(options.ttlMs) ? options.ttlMs : 0;
  const maxEntries = Math.max(1, options && Number(options.maxEntries) || 100);
  if (ttlMs > 0) {
    for (const [cacheKey, cached] of cache) {
      if (!cached || !Number.isFinite(cached.createdAt) || now - cached.createdAt >= ttlMs) cache.delete(cacheKey);
    }
  }
  cache.delete(key);
  while (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
  cache.set(key, entry);
  return entry;
}

module.exports = { getFreshEntry, setBoundedEntry };
