'use strict';

const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

const PATH_ALIASES = ['FilePath', 'filePath', 'Path', 'path'];

function normalizedText(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function canonicalPath(value) {
  if (typeof value !== 'string' || !value) return '';
  const resolved = path.resolve(value);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function samePath(a, b) {
  return !!a && !!b && canonicalPath(a) === canonicalPath(b);
}

function isPathWithin(candidate, parent) {
  if (!candidate || !parent) return false;
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function normalizedFilename(file) {
  return path.basename(String((file && (file.filePath || file.filename)) || '')).toLowerCase();
}

function normalizedStem(file) {
  const filename = normalizedFilename(file);
  return normalizedText(filename.slice(0, filename.length - path.extname(filename).length));
}

function sharedSuffixSegments(a, b) {
  const aParts = path.resolve(a).split(path.sep).filter(Boolean);
  const bParts = path.resolve(b).split(path.sep).filter(Boolean);
  let count = 0;
  while (count < aParts.length && count < bParts.length) {
    const aa = aParts[aParts.length - 1 - count];
    const bb = bParts[bParts.length - 1 - count];
    const equal = process.platform === 'win32' ? aa.toLowerCase() === bb.toLowerCase() : aa === bb;
    if (!equal) break;
    count++;
  }
  return count;
}

function hasExactRelativeMove(oldPath, newPath, oldRoots, searchRoot) {
  if (!searchRoot || !Array.isArray(oldRoots)) return false;
  return oldRoots.some((root) => {
    if (!root || !isPathWithin(oldPath, root)) return false;
    const relative = path.relative(path.resolve(root), path.resolve(oldPath));
    return !!relative && samePath(path.join(searchRoot, relative), newPath);
  });
}

function scoreRelinkCandidate(missing, candidate, options = {}) {
  const reasons = [];
  const oldPath = missing && missing.filePath;
  const newPath = candidate && candidate.filePath;
  if (!oldPath || !newPath) return { score: -Infinity, reasons };
  let score = 0;

  const exactRelativeMove = hasExactRelativeMove(oldPath, newPath, options.oldRoots, options.searchRoot);
  const suffixSegments = sharedSuffixSegments(oldPath, newPath);
  if (exactRelativeMove) {
    score += 240;
    reasons.push('Exact relative path under a moved library root');
  } else if (suffixSegments >= 4) {
    score += 170;
    reasons.push('Long relative path suffix matches');
  } else if (suffixSegments === 3) {
    score += 145;
    reasons.push('Album folder and filename match');
  } else if (suffixSegments === 2) {
    score += 115;
    reasons.push('Parent folder and filename match');
  }

  const oldFilename = normalizedFilename(missing);
  const newFilename = normalizedFilename(candidate);
  if (oldFilename && oldFilename === newFilename) {
    score += 70;
    reasons.push('Filename matches');
  } else if (normalizedStem(missing) && normalizedStem(missing) === normalizedStem(candidate)) {
    score += 44;
    reasons.push('Normalized filename matches');
  }

  const oldExtension = path.extname(oldFilename).toLowerCase();
  const newExtension = path.extname(newFilename).toLowerCase();
  if (oldExtension && oldExtension === newExtension) {
    score += 10;
    reasons.push('Extension matches');
  } else if (oldExtension && newExtension) {
    score -= 24;
  }

  const oldSize = Number(missing.fileSize || missing.size || 0);
  const newSize = Number(candidate.fileSize || candidate.size || 0);
  if (oldSize > 0 && newSize > 0) {
    const sizeDelta = Math.abs(oldSize - newSize);
    if (sizeDelta === 0) {
      score += 36;
      reasons.push('File size matches');
    } else if (sizeDelta <= Math.max(2048, oldSize * 0.005)) {
      score += 18;
      reasons.push('File size is very close');
    } else if (sizeDelta > oldSize * 0.2) {
      score -= 16;
    }
  }

  const tagWeights = [
    ['title', 55, 'Title matches'],
    ['artist', 35, 'Artist matches'],
    ['album', 25, 'Album matches'],
  ];
  for (const [field, weight, reason] of tagWeights) {
    const oldValue = normalizedText(missing[field]);
    const newValue = normalizedText(candidate[field]);
    if (oldValue && newValue && oldValue === newValue) {
      score += weight;
      reasons.push(reason);
    }
  }

  const oldDuration = Number(missing.duration || 0);
  const newDuration = Number(candidate.duration || 0);
  if (oldDuration > 0 && newDuration > 0) {
    const durationDelta = Math.abs(oldDuration - newDuration);
    if (durationDelta <= 2) {
      score += 25;
      reasons.push('Duration matches within 2 seconds');
    } else if (durationDelta <= 5) {
      score += 14;
      reasons.push('Duration is close');
    } else if (durationDelta <= 10) {
      score += 5;
    } else {
      score -= 12;
    }
  }

  return { score, reasons, suffixSegments, exactRelativeMove };
}

function addToIndex(index, key, value) {
  if (key === '' || key === null || key === undefined) return;
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

function addIndexedValues(target, index, key) {
  const values = index.get(key);
  if (values) values.forEach((value) => target.add(value));
}

function confidenceForScore(score) {
  if (score >= 180) return 'high';
  if (score >= 95) return 'medium';
  return 'low';
}

function buildRelinkProposals(missingFiles, candidates, options = {}) {
  missingFiles = Array.isArray(missingFiles) ? missingFiles.filter(Boolean) : [];
  candidates = Array.isArray(candidates) ? candidates.filter((candidate) => candidate && candidate.filePath) : [];
  const indexes = {
    filename: new Map(), stem: new Map(), size: new Map(), title: new Map(), titleArtist: new Map(), titleAlbum: new Map(),
  };
  candidates.forEach((candidate) => {
    const title = normalizedText(candidate.title);
    addToIndex(indexes.filename, normalizedFilename(candidate), candidate);
    addToIndex(indexes.stem, normalizedStem(candidate), candidate);
    addToIndex(indexes.size, Number(candidate.fileSize || candidate.size || 0), candidate);
    addToIndex(indexes.title, title, candidate);
    addToIndex(indexes.titleArtist, title + '::' + normalizedText(candidate.artist), candidate);
    addToIndex(indexes.titleAlbum, title + '::' + normalizedText(candidate.album), candidate);
  });

  const candidateFilenameCounts = new Map();
  candidates.forEach((candidate) => addToIndex(candidateFilenameCounts, normalizedFilename(candidate), candidate));
  const missingFilenameCounts = new Map();
  missingFiles.forEach((missing) => addToIndex(missingFilenameCounts, normalizedFilename(missing), missing));
  const rankings = new Map();
  const allPairs = [];

  missingFiles.forEach((missing) => {
    const shortlist = new Set();
    const title = normalizedText(missing.title);
    addIndexedValues(shortlist, indexes.filename, normalizedFilename(missing));
    addIndexedValues(shortlist, indexes.stem, normalizedStem(missing));
    addIndexedValues(shortlist, indexes.size, Number(missing.fileSize || missing.size || 0));
    addIndexedValues(shortlist, indexes.title, title);
    addIndexedValues(shortlist, indexes.titleArtist, title + '::' + normalizedText(missing.artist));
    addIndexedValues(shortlist, indexes.titleAlbum, title + '::' + normalizedText(missing.album));
    const ranked = Array.from(shortlist).map((candidate) => {
      const scored = scoreRelinkCandidate(missing, candidate, options);
      return { missing, candidate, ...scored };
    }).filter((entry) => entry.score >= 45).sort((a, b) => b.score - a.score || canonicalPath(a.candidate.filePath).localeCompare(canonicalPath(b.candidate.filePath)));
    rankings.set(missing, ranked);
    ranked.forEach((entry) => allPairs.push(entry));
  });

  allPairs.sort((a, b) => b.score - a.score
    || canonicalPath(a.missing.filePath).localeCompare(canonicalPath(b.missing.filePath))
    || canonicalPath(a.candidate.filePath).localeCompare(canonicalPath(b.candidate.filePath)));
  const assignedMissing = new Map();
  const assignedCandidates = new Set();
  allPairs.forEach((entry) => {
    if (entry.score < 60 || assignedMissing.has(entry.missing) || assignedCandidates.has(entry.candidate)) return;
    assignedMissing.set(entry.missing, entry);
    assignedCandidates.add(entry.candidate);
  });

  const topCandidateDemand = new Map();
  rankings.forEach((ranked) => {
    if (!ranked[0]) return;
    topCandidateDemand.set(ranked[0].candidate, (topCandidateDemand.get(ranked[0].candidate) || 0) + 1);
  });

  return missingFiles.map((missing) => {
    const ranked = rankings.get(missing) || [];
    const assigned = assignedMissing.get(missing) || null;
    if (!assigned) {
      return {
        oldPath: missing.filePath,
        title: missing.title || '',
        artist: missing.artist || '',
        album: missing.album || '',
        candidate: null,
        confidence: 'low',
        reasons: [],
        ambiguous: ranked.length > 0,
        ambiguityReasons: ranked.length ? ['No unique one-to-one candidate remains'] : ['No plausible candidate found'],
        autoSelected: false,
        score: ranked[0] ? ranked[0].score : 0,
        secondBestScore: ranked[1] ? ranked[1].score : null,
      };
    }

    const ambiguityReasons = [];
    const best = ranked[0];
    const second = ranked[1];
    const filename = normalizedFilename(missing);
    if (second && best.score - second.score <= 20) ambiguityReasons.push('Best and second-best candidates are too close');
    if ((candidateFilenameCounts.get(filename) || []).length > 1) ambiguityReasons.push('Duplicate filename exists in the search folder');
    if ((missingFilenameCounts.get(filename) || []).length > 1) ambiguityReasons.push('Multiple missing entries share this filename');
    if (best && best.candidate !== assigned.candidate) ambiguityReasons.push('The strongest candidate was assigned to another missing entry');
    if ((topCandidateDemand.get(assigned.candidate) || 0) > 1) ambiguityReasons.push('Candidate is contested by multiple missing entries');
    const confidence = confidenceForScore(assigned.score);
    const ambiguous = ambiguityReasons.length > 0;
    return {
      oldPath: missing.filePath,
      title: missing.title || '',
      artist: missing.artist || '',
      album: missing.album || '',
      candidate: assigned.candidate,
      confidence,
      reasons: assigned.reasons,
      ambiguous,
      ambiguityReasons,
      autoSelected: confidence === 'high' && !ambiguous,
      score: assigned.score,
      secondBestScore: second ? second.score : null,
    };
  });
}

function inferRootReplacements(libraryRoots, remap, options = {}) {
  const roots = Array.isArray(libraryRoots) ? libraryRoots.filter(Boolean) : [];
  const entries = Object.entries(remap || {});
  const missingSet = new Set((options.missingPaths || []).map(canonicalPath));
  const libraryPaths = (options.libraryPaths || []).filter(Boolean);
  const replacements = {};
  roots.forEach((root) => {
    const libraryUnderRoot = libraryPaths.filter((filePath) => isPathWithin(filePath, root));
    const missingUnderRoot = (options.missingPaths || []).filter((filePath) => isPathWithin(filePath, root));
    const selectedUnderRoot = entries.filter(([oldPath]) => isPathWithin(oldPath, root));
    if (!libraryUnderRoot.length || !missingUnderRoot.length || selectedUnderRoot.length !== missingUnderRoot.length) return;
    if (!libraryUnderRoot.every((filePath) => missingSet.has(canonicalPath(filePath)))) return;
    if (!missingUnderRoot.every((filePath) => Object.prototype.hasOwnProperty.call(remap, filePath))) return;
    let inferredRoot = '';
    for (const [oldPath, newPath] of selectedUnderRoot) {
      const relative = path.relative(path.resolve(root), path.resolve(oldPath));
      if (!relative || relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) return;
      const parts = relative.split(path.sep).filter(Boolean);
      const candidateRoot = path.resolve(newPath, ...parts.map(() => '..'));
      if (!samePath(path.join(candidateRoot, relative), newPath)) return;
      if (!inferredRoot) inferredRoot = candidateRoot;
      else if (!samePath(inferredRoot, candidateRoot)) return;
    }
    if (!inferredRoot || (options.searchRoot && !samePath(inferredRoot, options.searchRoot))) return;
    replacements[root] = inferredRoot;
  });
  return replacements;
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function remapPath(value, remap) {
  if (typeof remap === 'function') return remap(value);
  if (typeof value !== 'string') return value;
  if (Object.prototype.hasOwnProperty.call(remap, value)) return remap[value];
  if (/^file:/i.test(value)) {
    try {
      const localPath = fileURLToPath(value);
      if (Object.prototype.hasOwnProperty.call(remap, localPath)) return pathToFileURL(remap[localPath]).href;
    } catch (_) { /* Invalid file URLs keep their original value. */ }
  }
  const valueKey = canonicalPath(value);
  for (const [oldPath, newPath] of Object.entries(remap)) {
    if (valueKey && valueKey === canonicalPath(oldPath)) return newPath;
  }
  return value;
}

function createPathRemapper(remap) {
  const direct = remap && typeof remap === 'object' ? remap : {};
  const canonical = new Map();
  Object.entries(direct).forEach(([oldPath, newPath]) => {
    const key = canonicalPath(oldPath);
    if (key) canonical.set(key, newPath);
  });
  return function resolveRemappedPath(value) {
    if (typeof value !== 'string') return value;
    if (Object.prototype.hasOwnProperty.call(direct, value)) return direct[value];
    if (/^file:/i.test(value)) {
      try {
        const localPath = fileURLToPath(value);
        const replacement = direct[localPath] || canonical.get(canonicalPath(localPath));
        if (replacement) return pathToFileURL(replacement).href;
      } catch (_) { /* Invalid file URLs keep their original value. */ }
      return value;
    }
    return canonical.get(canonicalPath(value)) || value;
  };
}

function remapTrackReference(reference, remap) {
  if (typeof reference === 'string') return remapPath(reference, remap);
  if (!reference || typeof reference !== 'object' || Array.isArray(reference)) return reference;
  const next = { ...reference };
  if (typeof next.filePath === 'string') next.filePath = remapPath(next.filePath, remap);
  if (next.matchedFile && typeof next.matchedFile === 'object' && !Array.isArray(next.matchedFile)) {
    next.matchedFile = { ...next.matchedFile, filePath: remapPath(next.matchedFile.filePath, remap) };
  }
  return next;
}

function remapNumberMap(value, remap, mode, warnings, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = {};
  Object.entries(value).forEach(([key, number]) => {
    const destination = remapPath(key, remap);
    if (!Object.prototype.hasOwnProperty.call(next, destination)) {
      next[destination] = number;
      return;
    }
    if (mode === 'sum' && Number.isFinite(Number(next[destination])) && Number.isFinite(Number(number))) {
      next[destination] = Number(next[destination]) + Number(number);
    } else if (destination !== key) {
      next[destination] = number;
      warnings.push(`${label} already contained ${destination}; the moved track value was kept.`);
    }
  });
  return next;
}

function remapListeningStats(value, remap) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = {};
  Object.entries(value).forEach(([key, row]) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      next[key] = row;
      return;
    }
    next[key] = typeof row.filePath === 'string'
      ? { ...row, filePath: remapPath(row.filePath, remap) }
      : { ...row };
  });
  return next;
}

function remapStringMap(value, remap, warnings, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const next = {};
  Object.entries(value).forEach(([key, entry]) => {
    const mappedKey = remapPath(key, remap);
    if (Object.prototype.hasOwnProperty.call(next, mappedKey) && next[mappedKey] !== entry) {
      warnings.push(`${label}: kept the first entry for ${mappedKey}`);
      return;
    }
    next[mappedKey] = entry;
  });
  return next;
}

function applyPathRemap(data, remap, options = {}) {
  const warnings = [];
  const source = cloneJson(data || {}) || {};
  const candidateByOldPath = options.candidateByOldPath instanceof Map
    ? options.candidateByOldPath
    : new Map(Object.entries(options.candidateByOldPath || {}));
  const remapValue = createPathRemapper(remap);

  let library = (Array.isArray(source.library) ? source.library : []).map((file) => {
    if (!file || !Object.prototype.hasOwnProperty.call(remap, file.filePath)) return file;
    const candidate = candidateByOldPath.get(file.filePath) || {};
    const next = { ...file, ...candidate, filePath: remap[file.filePath] };
    next.addedAtMs = Object.prototype.hasOwnProperty.call(file, 'addedAtMs') ? file.addedAtMs : null;
    delete next.id;
    return next;
  });
  const indexedDestinations = options.indexedDestinationPaths instanceof Set ? options.indexedDestinationPaths : new Set();
  if (indexedDestinations.size) {
    const oldPaths = new Set(Object.keys(remap));
    const destinationByPath = new Map();
    for (const file of source.library || []) {
      if (file && !oldPaths.has(file.filePath) && indexedDestinations.has(file.filePath)) destinationByPath.set(file.filePath, file);
    }
    library = library.filter((file, index) => {
      const original = source.library[index];
      if (!original || !oldPaths.has(original.filePath) || !indexedDestinations.has(file.filePath)) return true;
      const destination = destinationByPath.get(file.filePath);
      if (!destination) return true;
      if (!(Number(destination.trackNo) > 0) && Number(original.trackNo) > 0) destination.trackNo = original.trackNo;
      warnings.push(`Merged missing library entry into existing file: ${file.filePath}`);
      return false;
    });
  }

  const playlists = (Array.isArray(source.playlists) ? source.playlists : []).map((playlist) => ({
    ...playlist,
    tracks: (Array.isArray(playlist.tracks) ? playlist.tracks : []).map((track) => {
      if (!track || typeof track !== 'object' || Array.isArray(track)) return track;
      const next = { ...track };
      PATH_ALIASES.forEach((alias) => {
        if (typeof next[alias] === 'string') next[alias] = remapPath(next[alias], remapValue);
      });
      if (next.matchedFile && typeof next.matchedFile === 'object') next.matchedFile = remapTrackReference({ matchedFile: next.matchedFile }, remapValue).matchedFile;
      return next;
    }),
  }));

  const mappings = source.mappings && typeof source.mappings === 'object' && !Array.isArray(source.mappings)
    ? Object.fromEntries(Object.entries(source.mappings).map(([key, value]) => [key, remapPath(value, remapValue)]))
    : {};
  const likedSongs = Array.from(new Set((Array.isArray(source.likedSongs) ? source.likedSongs : []).map((filePath) => remapPath(filePath, remapValue))));
  const settings = source.settings && typeof source.settings === 'object' && !Array.isArray(source.settings) ? source.settings : {};

  if (Array.isArray(settings.savedQueue)) settings.savedQueue = settings.savedQueue.map((filePath) => remapPath(filePath, remapValue));
  settings.playCounts = remapNumberMap(settings.playCounts, remapValue, 'sum', warnings, 'Play counts');
  settings.playTimes = remapNumberMap(settings.playTimes, remapValue, 'sum', warnings, 'Play times');
  settings.listeningStats = remapListeningStats(settings.listeningStats, remapValue);
  settings.lyricsOffsets = remapNumberMap(settings.lyricsOffsets, remapValue, 'replace', warnings, 'Lyrics offsets');
  settings.trackNotes = remapStringMap(settings.trackNotes, remapValue, warnings, 'Track notes');
  if (settings.lastTrack !== undefined) settings.lastTrack = remapTrackReference(settings.lastTrack, remapValue);
  if (Array.isArray(settings.playHistory)) settings.playHistory = settings.playHistory.map((track) => remapTrackReference(track, remapValue));
  if (settings.lastPlayed && typeof settings.lastPlayed === 'object' && typeof settings.lastPlayed.path === 'string') {
    settings.lastPlayed = { ...settings.lastPlayed, path: remapPath(settings.lastPlayed.path, remapValue) };
  }
  if (settings.playbackSession && typeof settings.playbackSession === 'object') {
    const session = { ...settings.playbackSession };
    ['queue', 'userQueue', 'shuffleQueue'].forEach((field) => {
      if (Array.isArray(session[field])) session[field] = session[field].map((track) => remapTrackReference(track, remapValue));
    });
    ['current', 'currentTrack', 'playQueueCursor', 'shuffleQueueCursor'].forEach((field) => {
      if (session[field] !== undefined) session[field] = remapTrackReference(session[field], remapValue);
    });
    settings.playbackSession = session;
  }
  if (Array.isArray(settings.customSmartPlaylists)) {
    settings.customSmartPlaylists = settings.customSmartPlaylists.map((playlist) => {
      if (!playlist || typeof playlist !== 'object' || !Array.isArray(playlist.trackPaths)) return playlist;
      return { ...playlist, trackPaths: playlist.trackPaths.map((filePath) => remapPath(filePath, remapValue)) };
    });
  }
  if (Array.isArray(settings.libraryRoots)) {
    const rootReplacements = options.rootReplacements || {};
    const remapRoot = createPathRemapper(rootReplacements);
    settings.libraryRoots = Array.from(new Set(settings.libraryRoots.map((root) => remapPath(root, remapRoot))));
  }

  return { library, playlists, mappings, likedSongs, settings, warnings };
}

module.exports = {
  applyPathRemap,
  remapListeningStats,
  buildRelinkProposals,
  canonicalPath,
  confidenceForScore,
  inferRootReplacements,
  isPathWithin,
  normalizedText,
  scoreRelinkCandidate,
};
