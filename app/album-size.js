const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function commonPath(paths) {
  if (!paths.length) return '';
  let parts = path.resolve(paths[0]).split(path.sep);
  for (const value of paths.slice(1)) {
    const next = path.resolve(value).split(path.sep);
    let i = 0;
    while (i < parts.length && i < next.length && parts[i] === next[i]) i++;
    parts = parts.slice(0, i);
  }
  return parts.join(path.sep) || path.parse(path.resolve(paths[0])).root;
}

function getAlbumRoot(filePaths) {
  const dirs = [...new Set(filePaths.map((filePath) => path.dirname(path.resolve(filePath))))];
  if (!dirs.length) return '';
  if (dirs.length === 1) return dirs[0];
  const root = commonPath(dirs);
  if (!root || root === path.parse(root).root) return '';
  // Multi-disc folders are a safe, intentional album-root pattern. Other
  // unrelated folders fall back to summing the actual track files.
  const relDirs = dirs.map((dir) => path.relative(root, dir));
  if (relDirs.every((rel) => /^[^/\\]+$/.test(rel) && /^(disc|cd)\s*\d+/i.test(rel))) return root;
  return '';
}

async function sumRegularFiles(root) {
  let total = 0;
  async function walk(dir) {
    let entries;
    try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); }
    catch (_) { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      try {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) await walk(full);
        else if (entry.isFile()) {
          const stat = await fs.promises.lstat(full);
          if (stat.isFile() && !stat.isSymbolicLink()) total += stat.size;
        }
      } catch (_) { /* unreadable entries do not invalidate the album */ }
    }
  }
  try {
    const stat = await fs.promises.lstat(root);
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    await walk(root);
    return total;
  } catch (_) { return null; }
}

async function sumTrackFiles(filePaths) {
  let total = 0;
  let readable = false;
  for (const filePath of [...new Set(filePaths)]) {
    try {
      const stat = await fs.promises.lstat(filePath);
      if (stat.isFile() && !stat.isSymbolicLink()) { total += stat.size; readable = true; }
    } catch (_) { /* Missing tracks are excluded from a best-effort size total. */ }
  }
  return readable ? total : null;
}

function makeAlbumSizeKey(albumId, tracks) {
  const material = tracks.map((track) => [track.filePath || '', Number(track.fileSize) || 0, Number(track.modifiedAtMs) || 0].join('|')).sort().join('\n');
  return crypto.createHash('sha256').update(String(albumId || '') + '\n' + material).digest('hex');
}

async function calculateAlbumSize(tracks, options = {}) {
  const filePaths = [...new Set((tracks || []).map((track) => track && track.filePath).filter((filePath) => typeof filePath === 'string' && path.isAbsolute(filePath)))];
  if (!filePaths.length) return { bytes: null, mode: 'unavailable', root: '' };
  const readablePaths = [];
  for (const filePath of filePaths) {
    try {
      const stat = await fs.promises.lstat(filePath);
      if (stat.isFile() && !stat.isSymbolicLink()) readablePaths.push(filePath);
    } catch (_) { /* Unreadable tracks are unavailable for folder sizing. */ }
  }
  if (!readablePaths.length) return { bytes: null, mode: 'tracks', root: '' };
  const root = getAlbumRoot(readablePaths);
  if (root && options.allowFolder !== false) {
    const bytes = await sumRegularFiles(root);
    if (bytes !== null) return { bytes, mode: 'folder', root };
  }
  return { bytes: await sumTrackFiles(readablePaths), mode: 'tracks', root: '' };
}

module.exports = { getAlbumRoot, sumRegularFiles, sumTrackFiles, makeAlbumSizeKey, calculateAlbumSize };
