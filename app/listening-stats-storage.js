(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ListeningStatsStorage = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
  }

  function splitSerializedSettings(snapshot) {
    const settingsSnapshot = { ...(snapshot || {}) };
    const listeningStats = isPlainObject(settingsSnapshot.listeningStats) ? settingsSnapshot.listeningStats : {};
    delete settingsSnapshot.listeningStats;
    return { settingsSnapshot, listeningStats };
  }

  return { splitSerializedSettings };
});
