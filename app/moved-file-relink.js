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

const pathCollator = new Intl.Collator();

// Normalized fields are computed once per record instead of once per scored pair.
function describeFile(file) {
  const filePath = file && file.filePath;
  const filename = normalizedFilename(file);
  const extension = path.extname(filename).toLowerCase();
  const stemBase = filename.slice(0, filename.length - path.extname(filename).length);
  let parts = null;
  let canonical = null;
  return {
    file,
    filePath,
    filename,
    extension,
    stem: normalizedText(stemBase),
    size: Number(file.fileSize || file.size || 0),
    duration: Number(file.duration || 0),
    title: normalizedText(file.title),
    artist: normalizedText(file.artist),
    album: normalizedText(file.album),
    get canonical() {
      if (canonical === null) canonical = canonicalPath(filePath);
      return canonical;
    },
    get parts() {
      if (parts === null) {
        parts = path.resolve(filePath).split(path.sep).filter(Boolean);
        if (process.platform === 'win32') parts = parts.map((part) => part.toLowerCase());
      }
      return parts;
    },
  };
}

function suffixSegmentCount(a, b) {
  let count = 0;
  while (count < a.length && count < b.length && a[a.length - 1 - count] === b[b.length - 1 - count]) count++;
  return count;
}

// Canonical destinations a missing record would have if its old library root moved to the search root.
function expectedMovePaths(missing, options) {
  const expected = new Set();
  if (!options.searchRoot || !Array.isArray(options.oldRoots)) return expected;
  options.oldRoots.forEach((root) => {
    if (!root || !isPathWithin(missing.filePath, root)) return;
    const relative = path.relative(path.resolve(root), path.resolve(missing.filePath));
    if (relative) expected.add(canonicalPath(path.join(options.searchRoot, relative)));
  });
  return expected;
}

function scoreDescribed(m, c, expected, reasons) {
  let score = 0;
  const exactRelativeMove = expected.size > 0 && expected.has(c.canonical);
  const suffixSegments = suffixSegmentCount(m.parts, c.parts);
  if (exactRelativeMove) {
    score += 240;
    if (reasons) reasons.push('Exact relative path under a moved library root');
  } else if (suffixSegments >= 4) {
    score += 170;
    if (reasons) reasons.push('Long relative path suffix matches');
  } else if (suffixSegments === 3) {
    score += 145;
    if (reasons) reasons.push('Album folder and filename match');
  } else if (suffixSegments === 2) {
    score += 115;
    if (reasons) reasons.push('Parent folder and filename match');
  }

  if (m.filename && m.filename === c.filename) {
    score += 70;
    if (reasons) reasons.push('Filename matches');
  } else if (m.stem && m.stem === c.stem) {
    score += 44;
    if (reasons) reasons.push('Normalized filename matches');
  }

  if (m.extension && m.extension === c.extension) {
    score += 10;
    if (reasons) reasons.push('Extension matches');
  } else if (m.extension && c.extension) {
    score -= 24;
  }

  const oldSize = m.size;
  const newSize = c.size;
  if (oldSize > 0 && newSize > 0) {
    const sizeDelta = Math.abs(oldSize - newSize);
    if (sizeDelta === 0) {
      score += 36;
      if (reasons) reasons.push('File size matches');
    } else if (sizeDelta <= Math.max(2048, oldSize * 0.005)) {
      score += 18;
      if (reasons) reasons.push('File size is very close');
    } else if (sizeDelta > oldSize * 0.2) {
      score -= 16;
    }
  }

  if (m.title && m.title === c.title) {
    score += 55;
    if (reasons) reasons.push('Title matches');
  }
  if (m.artist && m.artist === c.artist) {
    score += 35;
    if (reasons) reasons.push('Artist matches');
  }
  if (m.album && m.album === c.album) {
    score += 25;
    if (reasons) reasons.push('Album matches');
  }

  const oldDuration = m.duration;
  const newDuration = c.duration;
  if (oldDuration > 0 && newDuration > 0) {
    const durationDelta = Math.abs(oldDuration - newDuration);
    if (durationDelta <= 2) {
      score += 25;
      if (reasons) reasons.push('Duration matches within 2 seconds');
    } else if (durationDelta <= 5) {
      score += 14;
      if (reasons) reasons.push('Duration is close');
    } else if (durationDelta <= 10) {
      score += 5;
    } else {
      score -= 12;
    }
  }

  return { score, suffixSegments, exactRelativeMove };
}

function scoreRelinkCandidate(missing, candidate, options = {}) {
  const reasons = [];
  const oldPath = missing && missing.filePath;
  const newPath = candidate && candidate.filePath;
  if (!oldPath || !newPath) return { score: -Infinity, reasons };
  const scored = scoreDescribed(describeFile(missing), describeFile(candidate), expectedMovePaths(missing, options), reasons);
  return { score: scored.score, reasons, suffixSegments: scored.suffixSegments, exactRelativeMove: scored.exactRelativeMove };
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

// Binary max-heap over parallel arrays (scores / candidate indexes) for one missing record.
// Ordering: higher score first, then canonical candidate path, then candidate order (stable).
function createCandidateHeap(scores, candidateIds, described) {
  const before = (i, j) => {
    if (scores[i] !== scores[j]) return scores[i] > scores[j];
    const a = described[candidateIds[i]].canonical;
    const b = described[candidateIds[j]].canonical;
    if (a !== b) {
      const order = pathCollator.compare(a, b);
      if (order !== 0) return order < 0;
    }
    return candidateIds[i] < candidateIds[j];
  };
  const swap = (i, j) => {
    const score = scores[i]; scores[i] = scores[j]; scores[j] = score;
    const id = candidateIds[i]; candidateIds[i] = candidateIds[j]; candidateIds[j] = id;
  };
  const siftDown = (start) => {
    let i = start;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let best = i;
      if (left < scores.length && before(left, best)) best = left;
      if (right < scores.length && before(right, best)) best = right;
      if (best === i) return;
      swap(i, best);
      i = best;
    }
  };
  for (let i = (scores.length >> 1) - 1; i >= 0; i--) siftDown(i);
  return {
    get size() { return scores.length; },
    topScore() { return scores[0]; },
    topId() { return candidateIds[0]; },
    secondScore() {
      if (scores.length < 2) return null;
      if (scores.length === 2) return scores[1];
      return before(1, 2) ? scores[1] : scores[2];
    },
    pop() {
      const last = scores.length - 1;
      swap(0, last);
      scores.pop();
      candidateIds.pop();
      siftDown(0);
    },
  };
}

function buildRelinkProposals(missingFiles, candidates, options = {}) {
  missingFiles = Array.isArray(missingFiles) ? missingFiles.filter(Boolean) : [];
  candidates = Array.isArray(candidates) ? candidates.filter((candidate) => candidate && candidate.filePath) : [];
  const described = candidates.map(describeFile);
  const indexes = {
    filename: new Map(), stem: new Map(), size: new Map(), title: new Map(), titleArtist: new Map(), titleAlbum: new Map(),
  };
  const candidateFilenameCounts = new Map();
  described.forEach((candidate, id) => {
    addToIndex(indexes.filename, candidate.filename, id);
    addToIndex(indexes.stem, candidate.stem, id);
    addToIndex(indexes.size, candidate.size, id);
    addToIndex(indexes.title, candidate.title, id);
    addToIndex(indexes.titleArtist, candidate.title + '::' + candidate.artist, id);
    addToIndex(indexes.titleAlbum, candidate.title + '::' + candidate.album, id);
    if (candidate.filename !== '') candidateFilenameCounts.set(candidate.filename, (candidateFilenameCounts.get(candidate.filename) || 0) + 1);
  });

  const missingDescribed = missingFiles.map(describeFile);
  const missingFilenameCounts = new Map();
  missingDescribed.forEach((missing) => {
    if (missing.filename !== '') missingFilenameCounts.set(missing.filename, (missingFilenameCounts.get(missing.filename) || 0) + 1);
  });

  // Per missing record: plausible candidates (score >= 45) kept in a lazy heap rather than a full sort.
  const heaps = missingDescribed.map((missing) => {
    const shortlist = new Set();
    if (missing.filePath) {
    addIndexedValues(shortlist, indexes.filename, missing.filename);
    addIndexedValues(shortlist, indexes.stem, missing.stem);
    addIndexedValues(shortlist, indexes.size, missing.size);
    addIndexedValues(shortlist, indexes.title, missing.title);
    addIndexedValues(shortlist, indexes.titleArtist, missing.title + '::' + missing.artist);
    addIndexedValues(shortlist, indexes.titleAlbum, missing.title + '::' + missing.album);
    }
    const expected = expectedMovePaths(missing.file, options);
    const scores = [];
    const ids = [];
    shortlist.forEach((id) => {
      const { score } = scoreDescribed(missing, described[id], expected, null);
      if (score >= 45) { scores.push(score); ids.push(id); }
    });
    return createCandidateHeap(scores, ids, described);
  });

  // Snapshot ranking facts before the assignment pass consumes the heaps.
  const topCandidateDemand = new Map();
  const ranking = heaps.map((heap) => {
    if (!heap.size) return { count: 0, best: null, bestId: -1, second: null };
    const info = { count: heap.size, best: heap.topScore(), bestId: heap.topId(), second: heap.secondScore() };
    topCandidateDemand.set(info.bestId, (topCandidateDemand.get(info.bestId) || 0) + 1);
    return info;
  });

  // Greedy global assignment: repeatedly take the best remaining (score, missing path, candidate path) pair.
  const outer = [];
  const outerBefore = (a, b) => {
    const sa = heaps[a].topScore();
    const sb = heaps[b].topScore();
    if (sa !== sb) return sa > sb;
    if (missingDescribed[a].canonical !== missingDescribed[b].canonical) {
      const order = pathCollator.compare(missingDescribed[a].canonical, missingDescribed[b].canonical);
      if (order !== 0) return order < 0;
    }
    const ca = described[heaps[a].topId()].canonical;
    const cb = described[heaps[b].topId()].canonical;
    if (ca !== cb) {
      const order = pathCollator.compare(ca, cb);
      if (order !== 0) return order < 0;
    }
    return a < b;
  };
  const outerSiftDown = (start) => {
    let i = start;
    for (;;) {
      const left = 2 * i + 1;
      const right = left + 1;
      let best = i;
      if (left < outer.length && outerBefore(outer[left], outer[best])) best = left;
      if (right < outer.length && outerBefore(outer[right], outer[best])) best = right;
      if (best === i) return;
      const tmp = outer[i]; outer[i] = outer[best]; outer[best] = tmp;
      i = best;
    }
  };
  heaps.forEach((heap, index) => { if (heap.size) outer.push(index); });
  for (let i = (outer.length >> 1) - 1; i >= 0; i--) outerSiftDown(i);

  const assignedMissing = new Map();
  const assignedCandidates = new Set();
  while (outer.length) {
    const index = outer[0];
    const heap = heaps[index];
    const score = heap.topScore();
    if (score < 60) break;
    const id = heap.topId();
    if (!assignedCandidates.has(id)) {
      assignedMissing.set(index, { id, score });
      assignedCandidates.add(id);
      outer[0] = outer[outer.length - 1];
      outer.pop();
    } else {
      heap.pop();
      if (!heap.size) { outer[0] = outer[outer.length - 1]; outer.pop(); }
    }
    outerSiftDown(0);
  }

  return missingFiles.map((missing, index) => {
    const info = ranking[index];
    const assigned = assignedMissing.get(index) || null;
    if (!assigned) {
      return {
        oldPath: missing.filePath,
        title: missing.title || '',
        artist: missing.artist || '',
        album: missing.album || '',
        candidate: null,
        confidence: 'low',
        reasons: [],
        ambiguous: info.count > 0,
        ambiguityReasons: info.count ? ['No unique one-to-one candidate remains'] : ['No plausible candidate found'],
        autoSelected: false,
        score: info.best === null ? 0 : info.best,
        secondBestScore: info.second,
      };
    }

    const ambiguityReasons = [];
    const filename = missingDescribed[index].filename;
    if (info.second !== null && info.best - info.second <= 20) ambiguityReasons.push('Best and second-best candidates are too close');
    if ((candidateFilenameCounts.get(filename) || 0) > 1) ambiguityReasons.push('Duplicate filename exists in the search folder');
    if ((missingFilenameCounts.get(filename) || 0) > 1) ambiguityReasons.push('Multiple missing entries share this filename');
    if (info.bestId !== assigned.id) ambiguityReasons.push('The strongest candidate was assigned to another missing entry');
    if ((topCandidateDemand.get(assigned.id) || 0) > 1) ambiguityReasons.push('Candidate is contested by multiple missing entries');
    const confidence = confidenceForScore(assigned.score);
    const ambiguous = ambiguityReasons.length > 0;
    const reasons = [];
    scoreDescribed(missingDescribed[index], described[assigned.id], expectedMovePaths(missing, options), reasons);
    return {
      oldPath: missing.filePath,
      title: missing.title || '',
      artist: missing.artist || '',
      album: missing.album || '',
      candidate: candidates[assigned.id],
      confidence,
      reasons,
      ambiguous,
      ambiguityReasons,
      autoSelected: confidence === 'high' && !ambiguous,
      score: assigned.score,
      secondBestScore: info.second,
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
