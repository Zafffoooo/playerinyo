(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.LyricsCache = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function createBoundedLyricsCache(limit) {
    const maxEntries = Math.max(1, Number(limit) || 100);
    const entries = new Map();
    return {
      get(key) {
        if (!entries.has(key)) return null;
        const value = entries.get(key);
        entries.delete(key);
        entries.set(key, value);
        return value;
      },
      set(key, value) {
        if (!key || !value) return;
        entries.delete(key);
        entries.set(key, value);
        while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
      },
      size() { return entries.size; },
    };
  }
  return { createBoundedLyricsCache };
});
