(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DailySmartPlaylists = api;
}(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function hash(value) {
    var result = 2166136261;
    for (var index = 0; index < value.length; index++) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  function selectTracks(options) {
    options = options || {};
    var mode = options.mode || 'discovery';
    var dayKey = String(options.dayKey || '');
    var playedPaths = options.playedPaths || new Set();
    var albumKey = options.albumKey || function (file) { return String(file.album || '') + '::' + String(file.albumArtist || file.artist || ''); };
    var limit = Math.max(1, Math.min(50, Number(options.limit) || 50));
    var albumLimit = Math.max(1, Math.min(2, Number(options.albumLimit) || 2));
    var files = (Array.isArray(options.files) ? options.files : []).filter(function (file) {
      if (!file || !file.filePath) return false;
      var played = playedPaths.has(file.filePath);
      return mode === 'rediscover' ? played : (mode === 'unplayed' ? !played : true);
    }).slice();
    files.sort(function (left, right) {
      var leftScore = hash(dayKey + '::' + mode + '::' + left.filePath);
      var rightScore = hash(dayKey + '::' + mode + '::' + right.filePath);
      return leftScore - rightScore || String(left.filePath).localeCompare(String(right.filePath));
    });
    var albumCounts = new Map();
    return files.filter(function (file) {
      var key = albumKey(file);
      var count = albumCounts.get(key) || 0;
      if (count >= albumLimit) return false;
      albumCounts.set(key, count + 1);
      return true;
    }).slice(0, limit);
  }

  return { selectTracks: selectTracks };
}));
