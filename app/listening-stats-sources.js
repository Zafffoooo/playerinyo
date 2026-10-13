(function(root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.ListeningStatsSources = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  'use strict';

  function normalize(value) {
    var result = { local: { count: 0, time: 0 }, remote: { count: 0, time: 0 } };
    ['local', 'remote'].forEach(function(source) {
      var row = value && value[source];
      if (!row || typeof row !== 'object') return;
      result[source].count = Math.max(0, Number(row.count) || 0);
      result[source].time = Math.max(0, Number(row.time) || 0);
      result[source].firstPlayedAt = typeof row.firstPlayedAt === 'string' ? row.firstPlayedAt : '';
      result[source].lastPlayedAt = typeof row.lastPlayedAt === 'string' ? row.lastPlayedAt : '';
    });
    return result;
  }

  function add(target, source, count, time) {
    if (!target || (source !== 'local' && source !== 'remote')) return target;
    var sources = normalize(target.sources);
    sources[source].count += Math.max(0, Number(count) || 0);
    sources[source].time += Math.max(0, Number(time) || 0);
    target.sources = sources;
    return target;
  }

  function merge(target, source) {
    var sources = normalize(source && source.sources);
    add(target, 'local', sources.local.count, sources.local.time);
    add(target, 'remote', sources.remote.count, sources.remote.time);
    ['local', 'remote'].forEach(function (name) {
      var dest = target.sources[name], input = sources[name];
      if (input.firstPlayedAt && (!dest.firstPlayedAt || Date.parse(input.firstPlayedAt) < Date.parse(dest.firstPlayedAt))) dest.firstPlayedAt = input.firstPlayedAt;
      if (input.lastPlayedAt && (!dest.lastPlayedAt || Date.parse(input.lastPlayedAt) > Date.parse(dest.lastPlayedAt))) dest.lastPlayedAt = input.lastPlayedAt;
    });
    return target;
  }

  function values(entry, source) {
    if (source === 'all') return { count: Math.max(0, Number(entry && entry.count) || 0), time: Math.max(0, Number(entry && entry.time) || 0) };
    var normalized = normalize(entry && entry.sources);
    var row = source === 'remote' ? normalized.remote : normalized.local;
    return { count: row.count, time: row.time };
  }

  return { normalize: normalize, add: add, merge: merge, values: values };
});
