'use strict';

function createBackupRetentionCache(maxEntries = 256) {
  const entries = new Map();
  const signature = (stat) => [stat.size, stat.mtimeMs, stat.ctimeMs, stat.dev, stat.ino].join(':');
  function get(filePath, stat) {
    const entry = entries.get(filePath);
    if (!entry || entry.signature !== signature(stat)) {
      entries.delete(filePath);
      return null;
    }
    return entry.value;
  }
  function set(filePath, stat, value) {
    entries.delete(filePath);
    entries.set(filePath, { signature: signature(stat), value });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }
  return { get, set, delete: (filePath) => entries.delete(filePath) };
}

module.exports = { createBackupRetentionCache };
