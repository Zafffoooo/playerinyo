'use strict';

const MAX_LIBRARY_TRACKS = 250000;

function sanitizeRadioPreferencesForSettings(value) {
  const source = isPlainObject(value) ? value : {};
  const next = { version: 1, excludeKnownTracks: true, avoidClean: true, avoidLive: true, avoidCovers: true, avoidRemixes: true, avoidSlowedSped: true, discoveryDepth: 0.5 };
  ['excludeKnownTracks', 'avoidClean', 'avoidLive', 'avoidCovers', 'avoidRemixes', 'avoidSlowedSped'].forEach((key) => { if (typeof source[key] === 'boolean') next[key] = source[key]; });
  if (typeof source.discoveryDepth === 'number' && Number.isFinite(source.discoveryDepth) && source.discoveryDepth >= 0 && source.discoveryDepth <= 1) next.discoveryDepth = source.discoveryDepth;
  return next;
}

function sanitizeRadioBlocklistForSettings(value) {
  const source = isPlainObject(value) ? value : {}; const sanitizeRows = (rows, kind) => {
    const seen = new Set(); return (Array.isArray(rows) ? rows : []).slice(0, 500).map((row, index) => {
      if (!isPlainObject(row)) return null;
      const key = boundedBackupString(row.key || '', `radioBlocklist.${kind}[${index}].key`, 1200, false);
      if (!/^(mbid:|name:)/.test(key) || seen.has(key)) return null;
      seen.add(key); const out = { key, artist: boundedBackupString(row.artist || '', `radioBlocklist.${kind}[${index}].artist`, 500) };
      if (kind === 'tracks') out.title = boundedBackupString(row.title || '', `radioBlocklist.${kind}[${index}].title`, 500);
      return out;
    }).filter(Boolean);
  };
  return { version: 1, tracks: sanitizeRows(source.tracks, 'tracks'), artists: sanitizeRows(source.artists, 'artists') };
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function backupSettingError(key, message) {
  throw new Error(`Backup setting "${key}" ${message}`);
}

function boundedBackupString(value, key, maxLength = 4096, allowEmpty = true) {
  if (typeof value !== 'string') backupSettingError(key, 'must be a string');
  if ((!allowEmpty && !value) || value.length > maxLength || value.includes('\0')) backupSettingError(key, 'contains an invalid string value');
  return value;
}

function boundedBackupNumber(value, key, min, max, integer = false) {
  const number = typeof value === 'string' && value.trim() ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
    backupSettingError(key, 'contains an invalid number');
  }
  return number;
}

function sanitizeSourceRadio(value, key) {
  if (!isPlainObject(value)) backupSettingError(key, 'must be an object');
  const providerId = boundedBackupString(value.providerId, `${key}.providerId`, 120, false);
  if (!Array.isArray(value.genreIds) || value.genreIds.length < 1 || value.genreIds.length > 200) {
    backupSettingError(`${key}.genreIds`, 'must be an array of 1 to 200 genres');
  }
  const genreIds = Array.from(new Set(value.genreIds.map((genre, index) => boundedBackupString(genre, `${key}.genreIds[${index}]`, 500, false))));
  return { providerId, genreIds };
}

function sanitizeRadioContext(value) {
  const source = sanitizeSourceRadio(value, 'playbackSession.radioContext');
  if (!isPlainObject(value.providerSession)) backupSettingError('playbackSession.radioContext.providerSession', 'must be an object');
  const providerSession = value.providerSession;
  const sessionGenres = sanitizeSourceRadio({ providerId: source.providerId, genreIds: providerSession.genreIds }, 'playbackSession.radioContext.providerSession').genreIds;
  if (sessionGenres.length !== source.genreIds.length || sessionGenres.some((genre, index) => genre !== source.genreIds[index])) {
    backupSettingError('playbackSession.radioContext.providerSession.genreIds', 'must match radioContext.genreIds');
  }
  const sanitizeItemIds = (field, maxItems) => {
    if (!Array.isArray(providerSession[field]) || providerSession[field].length > maxItems) {
      backupSettingError(`playbackSession.radioContext.providerSession.${field}`, `must be an array of at most ${maxItems} item ids`);
    }
    return providerSession[field].map((itemId, index) => boundedBackupString(itemId, `playbackSession.radioContext.providerSession.${field}[${index}]`, 4200, false));
  };
  const playedTracks = value.playedTracks === undefined ? [] : value.playedTracks;
  if (!Array.isArray(playedTracks) || playedTracks.length > 100) backupSettingError('playbackSession.radioContext.playedTracks', 'must be an array of at most 100 tracks');
  const safePlayedTracks = playedTracks.map((track, index) => sanitizeTrackReference(track, `playbackSession.radioContext.playedTracks[${index}]`));
  if (source.providerId === 'lastfm') {
    if (providerSession.version !== 1) backupSettingError('playbackSession.radioContext.providerSession.version', 'must be version 1');
    const poolKey = boundedBackupString(providerSession.poolKey, 'playbackSession.radioContext.providerSession.poolKey', 240, false);
    if (providerSession.mode !== undefined && providerSession.mode !== 'balanced') backupSettingError('playbackSession.radioContext.providerSession.mode', 'must be balanced');
    if (providerSession.excludeKnownTracks !== undefined && typeof providerSession.excludeKnownTracks !== 'boolean') backupSettingError('playbackSession.radioContext.providerSession.excludeKnownTracks', 'must be a boolean');
    return {
      providerId: source.providerId,
      genreIds: source.genreIds,
      playedTracks: safePlayedTracks,
      providerSession: {
        version: 1,
        genreIds: sessionGenres,
        mode: 'balanced',
        excludeKnownTracks: providerSession.excludeKnownTracks === true,
        poolKey,
        remainingItemIds: sanitizeItemIds('remainingItemIds', 2000),
        recentItemIds: sanitizeItemIds('recentItemIds', 5),
        lastArtistKey: providerSession.lastArtistKey === undefined ? '' : boundedBackupString(providerSession.lastArtistKey, 'playbackSession.radioContext.providerSession.lastArtistKey', 500),
      },
    };
  }
  return {
    providerId: source.providerId,
    genreIds: source.genreIds,
    playedTracks: safePlayedTracks,
    providerSession: {
      genreIds: sessionGenres,
      remainingItemIds: sanitizeItemIds('remainingItemIds', 250000),
      recentItemIds: sanitizeItemIds('recentItemIds', 5),
    },
  };
}

function sanitizeTrackReference(value, key) {
  if (!isPlainObject(value)) backupSettingError(key, 'must be an object');
  const next = {};
  const legacyFilePath = isPlainObject(value.matchedFile) ? value.matchedFile.filePath : null;
  const filePath = value.filePath !== undefined && value.filePath !== null ? value.filePath : legacyFilePath;
  if (filePath !== undefined && filePath !== null) next.filePath = boundedBackupString(filePath, `${key}.filePath`, 4096, false);
  else next.filePath = null;
  for (const field of ['title', 'artist', 'album']) {
    if (value[field] !== undefined && value[field] !== null) next[field] = boundedBackupString(value[field], `${key}.${field}`, 2000);
  }
  if (value.sourcePlaylistId !== undefined && value.sourcePlaylistId !== null) next.sourcePlaylistId = boundedBackupString(value.sourcePlaylistId, `${key}.sourcePlaylistId`, 500, false);
  if (value.sourceRadio !== undefined && value.sourceRadio !== null) next.sourceRadio = sanitizeSourceRadio(value.sourceRadio, `${key}.sourceRadio`);
  if (value.queueEntryId !== undefined && value.queueEntryId !== null) next.queueEntryId = boundedBackupString(value.queueEntryId, `${key}.queueEntryId`, 160, false);
  if (value.duration !== undefined && value.duration !== null) next.duration = boundedBackupNumber(value.duration, `${key}.duration`, 0, 7 * 24 * 60 * 60);
  // candidateId is only a resolver hint. Older hydrated remote queue entries
  // can carry an empty placeholder; dropping it is safe and must not block
  // persistence of the entire playback session.
  if (typeof value.candidateId === 'string' && value.candidateId.trim()) next.candidateId = boundedBackupString(value.candidateId, `${key}.candidateId`, 420, false);
  if (value.trackMbid !== undefined && value.trackMbid !== null) next.trackMbid = boundedBackupString(value.trackMbid, `${key}.trackMbid`, 80);
  if (value.playback !== undefined && value.playback !== null) {
    if (!isPlainObject(value.playback) || value.playback.kind !== 'youtube' || !/^[A-Za-z0-9_-]{11}$/.test(String(value.playback.videoId || ''))) backupSettingError(`${key}.playback`, 'must be an allowed remote descriptor');
    next.playback = { kind: 'youtube', videoId: String(value.playback.videoId) };
    next.resolvedSource = 'youtube';
    next.playbackSource = 'youtube';
  }
  return next;
}

function sanitizePlaybackSession(value) {
  if (!isPlainObject(value)) backupSettingError('playbackSession', 'must be an object');
  const strictNumber = (field, fallback, min, max, integer = false) => {
    const number = value[field] === undefined || value[field] === null ? fallback : value[field];
    if (typeof number !== 'number' || !Number.isFinite(number) || number < min || number > max || (integer && !Number.isInteger(number))) {
      backupSettingError(`playbackSession.${field}`, 'contains an invalid number');
    }
    return number;
  };
  const version = strictNumber('version', 1, 1, 1, true);
  const sanitizeQueue = (field) => {
    const queue = value[field];
    if (!Array.isArray(queue) || queue.length > 250000) backupSettingError(`playbackSession.${field}`, 'must be an array of at most 250000 tracks');
    return queue.map((track, index) => sanitizeTrackReference(track, `playbackSession.${field}[${index}]`));
  };
  const queue = sanitizeQueue('queue');
  const userQueue = sanitizeQueue('userQueue');
  const shuffleQueue = sanitizeQueue('shuffleQueue');
  const rawPlayQueueIndex = strictNumber('playQueueIndex', -1, -1, 250000, true);
  const rawShuffleQueueIndex = strictNumber('shuffleQueueIndex', -1, -1, 250000, true);
  const playQueueIndex = rawPlayQueueIndex >= 0 && rawPlayQueueIndex < queue.length ? rawPlayQueueIndex : -1;
  const shuffleQueueIndex = rawShuffleQueueIndex >= 0 && rawShuffleQueueIndex < shuffleQueue.length ? rawShuffleQueueIndex : -1;
  const next = {
    version,
    queue,
    userQueue,
    shuffleQueue,
    currentTrack: value.currentTrack === null || value.currentTrack === undefined ? null : sanitizeTrackReference(value.currentTrack, 'playbackSession.currentTrack'),
    positionSeconds: strictNumber('positionSeconds', 0, 0, 7 * 24 * 60 * 60),
    shuffleMode: strictNumber('shuffleMode', 0, 0, 2, true),
    loopMode: strictNumber('loopMode', 0, 0, 2, true),
    playQueueIndex,
    shuffleQueueIndex,
    playQueueCursor: value.playQueueCursor === null || value.playQueueCursor === undefined ? null : sanitizeTrackReference(value.playQueueCursor, 'playbackSession.playQueueCursor'),
    shuffleQueueCursor: value.shuffleQueueCursor === null || value.shuffleQueueCursor === undefined ? null : sanitizeTrackReference(value.shuffleQueueCursor, 'playbackSession.shuffleQueueCursor'),
    savedAtMs: strictNumber('savedAtMs', 0, 0, Number.MAX_SAFE_INTEGER, true),
  };
  if (value.sourcePlaylistId !== undefined && value.sourcePlaylistId !== null) next.sourcePlaylistId = boundedBackupString(value.sourcePlaylistId, 'playbackSession.sourcePlaylistId', 500, false);
  if (value.radioContext !== undefined && value.radioContext !== null) next.radioContext = sanitizeRadioContext(value.radioContext);
  if (value.manualQueuePlayback !== undefined && typeof value.manualQueuePlayback !== 'boolean') backupSettingError('playbackSession.manualQueuePlayback', 'must be a boolean');
  next.manualQueuePlayback = value.manualQueuePlayback === true;
  if (value.wasPlaying !== undefined && typeof value.wasPlaying !== 'boolean') backupSettingError('playbackSession.wasPlaying', 'must be a boolean');
  next.wasPlaying = value.wasPlaying === true;
  return next;
}

function sanitizeNumberMap(value, key, limits) {
  if (!isPlainObject(value)) backupSettingError(key, 'must be an object');
  const entries = Object.entries(value);
  if (entries.length > limits.maxItems) backupSettingError(key, 'contains too many entries');
  const next = {};
  for (const [entryKey, entryValue] of entries) {
    boundedBackupString(entryKey, `${key} key`, limits.maxKeyLength || 4096, false);
    next[entryKey] = boundedBackupNumber(entryValue, `${key}.${entryKey}`, limits.min, limits.max, !!limits.integer);
  }
  return next;
}

function sanitizeCustomSmartPlaylists(value) {
  if (!Array.isArray(value) || value.length > 100) backupSettingError('customSmartPlaylists', 'must be an array of at most 100 entries');
  const fields = new Set(['artist', 'album', 'genre', 'year', 'decade', 'playHistory', 'liked', 'unplayed', 'duration_min', 'duration_max', 'no_genre', 'randomDiscovery']);
  const ruleFields = new Set(['artist', 'album', 'genre', 'year', 'duration_min', 'duration_max', 'liked', 'played']);
  const sanitizeRuleGroup = (rules, key) => {
    if (!Array.isArray(rules) || !rules.length || rules.length > 12) backupSettingError(`${key}.rules`, 'must contain 1 to 12 rules');
    return rules.map((rule, ruleIndex) => {
      const ruleKey = `${key}.rules[${ruleIndex}]`;
      if (!isPlainObject(rule)) backupSettingError(ruleKey, 'must be an object');
      const field = boundedBackupString(rule.field, `${ruleKey}.field`, 40, false);
      if (!ruleFields.has(field)) backupSettingError(`${ruleKey}.field`, 'is not supported');
      const value = boundedBackupString(rule.value, `${ruleKey}.value`, 500, false);
      if ((field === 'liked' && !['true', 'false'].includes(value)) || (field === 'played' && !['true', 'false'].includes(value))) backupSettingError(`${ruleKey}.value`, 'is invalid');
      if ((field === 'year' || field === 'duration_min' || field === 'duration_max') && (!/^\d+(?:\.\d+)?$/.test(value) || Number(value) < 0 || Number(value) > (field === 'year' ? 9999 : 604800))) backupSettingError(`${ruleKey}.value`, 'is invalid');
      return { field, value };
    });
  };
  return value.map((playlist, index) => {
    const key = `customSmartPlaylists[${index}]`;
    if (!isPlainObject(playlist) || (!isPlainObject(playlist.rule) && !Array.isArray(playlist.rules))) backupSettingError(key, 'must contain a rule object');
    if (Array.isArray(playlist.rules)) {
      const color = boundedBackupString(playlist.color || '', `${key}.color`, 100);
      if (color && !/^linear-gradient\(\d{1,3}deg,#[0-9a-f]{6},#[0-9a-f]{6}\)$/i.test(color)) backupSettingError(`${key}.color`, 'is invalid');
      const icon = boundedBackupString(playlist.icon || 'ph-faders', `${key}.icon`, 80);
      if (icon && !/^ph-[a-z0-9-]+$/.test(icon)) backupSettingError(`${key}.icon`, 'is invalid');
      return {
        id: boundedBackupString(playlist.id, `${key}.id`, 120, false),
        name: boundedBackupString(playlist.name, `${key}.name`, 500, false),
        icon,
        color,
        type: 'smart',
        rules: sanitizeRuleGroup(playlist.rules, key),
        desc: boundedBackupString(playlist.desc || '', `${key}.desc`, 1000),
      };
    }
    const field = boundedBackupString(playlist.rule.field, `${key}.rule.field`, 40, false);
    if (!fields.has(field)) backupSettingError(`${key}.rule.field`, 'is not supported');
    const nextRule = { field };
    if (playlist.rule.value !== undefined) {
      nextRule.value = field === 'duration_min' || field === 'duration_max'
        ? boundedBackupNumber(playlist.rule.value, `${key}.rule.value`, 0, 7 * 24 * 60 * 60)
        : boundedBackupString(playlist.rule.value, `${key}.rule.value`, 500);
    }
    if (playlist.rule.limit !== undefined) nextRule.limit = boundedBackupNumber(playlist.rule.limit, `${key}.rule.limit`, 1, 1000, true);
    if (field === 'randomDiscovery') {
      if (!Array.isArray(playlist.rule.genres) || playlist.rule.genres.length > 200) backupSettingError(`${key}.rule.genres`, 'must be an array of at most 200 genres');
      nextRule.genres = playlist.rule.genres.map((genre, genreIndex) => boundedBackupString(genre, `${key}.rule.genres[${genreIndex}]`, 500, false));
      nextRule.albumLimit = playlist.rule.albumLimit === undefined
        ? 5
        : boundedBackupNumber(playlist.rule.albumLimit, `${key}.rule.albumLimit`, 1, 5, true);
    }
    const color = boundedBackupString(playlist.color || '', `${key}.color`, 100);
    if (color && !/^linear-gradient\(\d{1,3}deg,#[0-9a-f]{6},#[0-9a-f]{6}\)$/i.test(color)) backupSettingError(`${key}.color`, 'is invalid');
    const icon = boundedBackupString(playlist.icon || '', `${key}.icon`, 80);
    if (icon && !/^ph-[a-z0-9-]+$/.test(icon)) backupSettingError(`${key}.icon`, 'is invalid');
    const next = {
      id: boundedBackupString(playlist.id, `${key}.id`, 120, false),
      name: boundedBackupString(playlist.name, `${key}.name`, 500, false),
      icon,
      color,
      type: 'smart',
      rule: nextRule,
      desc: boundedBackupString(playlist.desc || '', `${key}.desc`, 1000),
    };
    if (field === 'randomDiscovery') {
      if (!Array.isArray(playlist.trackPaths) || playlist.trackPaths.length > 100) backupSettingError(`${key}.trackPaths`, 'must be an array of at most 100 paths');
      next.trackPaths = playlist.trackPaths.map((filePath, pathIndex) => boundedBackupString(filePath, `${key}.trackPaths[${pathIndex}]`, 4096, false));
    }
    return next;
  });
}

function sanitizeStringMap(value, key, maxItems, maxKeyLength, maxValueLength) {
  if (!isPlainObject(value)) backupSettingError(key, 'must be an object');
  const entries = Object.entries(value);
  if (entries.length > maxItems) backupSettingError(key, 'contains too many entries');
  const next = {};
  entries.forEach(([entryKey, entryValue], index) => {
    next[boundedBackupString(entryKey, `${key}.${index}.key`, maxKeyLength, false)] = boundedBackupString(entryValue, `${key}.${index}.value`, maxValueLength);
  });
  return next;
}

function sanitizeImportedSettings(settings) {
  if (!isPlainObject(settings)) throw new Error('Backup settings must be an object');
  const next = {};
  const booleanKeys = [
    'minimizeToTray', 'useNativeTitleBar', 'discordRpc', 'normalization', 'notifications',
    'virtualScrolling', 'lazyLoading', 'glassEffects', 'npLyricsVisible', 'sortAscending',
    'likedSongsSortAscending', 'isPlaylistGridView', 'automaticBackupsEnabled',
  ];
  for (const key of booleanKeys) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
    if (typeof settings[key] !== 'boolean') backupSettingError(key, 'must be a boolean');
    next[key] = settings[key];
  }

  const enumSettings = {
    audioMode: new Set(['stereo', 'mono']),
    ytdlCookiesMode: new Set(['none', 'browser', 'file']),
    ytdlCookiesBrowser: new Set(['firefox', 'chrome', 'chromium', 'brave', 'edge', 'vivaldi', 'opera']),
    likedSongsSortBy: new Set(['Custom Order', 'Title', 'Artist', 'Album', 'Recently Added']),
    dockMode: new Set(['collapsed', 'expanded']),
  };
  for (const [key, allowed] of Object.entries(enumSettings)) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
    const value = boundedBackupString(settings[key], key, 40, false);
    if (!allowed.has(value)) backupSettingError(key, 'is not supported');
    next[key] = value;
  }

  // Cookie-file locations are intentionally device-local. Older exports may
  // still contain one, but restoring it on another machine is neither useful
  // nor privacy-preserving.
  const stringSettings = { ytdlDownloadFolder: 4096, lastfmUsername: 500 };
  for (const [key, maxLength] of Object.entries(stringSettings)) {
    if (!Object.prototype.hasOwnProperty.call(settings, key)) continue;
    if (key === 'lastfmUsername' && settings[key] === null) next[key] = null;
    else next[key] = boundedBackupString(settings[key], key, maxLength);
  }

  const numberSettings = {
    sidebarWidth: [120, 2000, true],
    crossfade: [0, 10, false],
    masterGain: [0, 100, false],
    volume: [0, 1, false],
    folderCoversBackfilledVersion: [0, 100, true],
    savedQueueIndex: [0, 250000, true],
  };
  for (const [key, limits] of Object.entries(numberSettings)) {
    if (Object.prototype.hasOwnProperty.call(settings, key)) next[key] = boundedBackupNumber(settings[key], key, ...limits);
  }

  if (Object.prototype.hasOwnProperty.call(settings, 'accentColor')) {
    const accentColor = boundedBackupString(settings.accentColor, 'accentColor', 7, false);
    if (!/^#[0-9a-f]{6}$/i.test(accentColor)) backupSettingError('accentColor', 'must be a six-digit hex color');
    next.accentColor = accentColor;
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'themeColors')) {
    if (!isPlainObject(settings.themeColors)) backupSettingError('themeColors', 'must be an object');
    const colors = {};
    for (const key of ['accent', 'bg', 'panel', 'glass', 'border', 'text', 'muted', 'danger']) {
      if (!Object.prototype.hasOwnProperty.call(settings.themeColors, key)) continue;
      const color = boundedBackupString(settings.themeColors[key], `themeColors.${key}`, 7, false);
      if (!/^#[0-9a-f]{6}$/i.test(color)) backupSettingError(`themeColors.${key}`, 'must be a six-digit hex color');
      colors[key] = color;
    }
    next.themeColors = colors;
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'eqGains')) {
    if (!Array.isArray(settings.eqGains) || settings.eqGains.length !== 5) backupSettingError('eqGains', 'must contain five bands');
    next.eqGains = settings.eqGains.map((gain, index) => boundedBackupNumber(gain, `eqGains[${index}]`, -12, 12));
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'libraryRoots')) {
    if (!Array.isArray(settings.libraryRoots) || settings.libraryRoots.length > 512) backupSettingError('libraryRoots', 'must be an array of at most 512 paths');
    next.libraryRoots = Array.from(new Set(settings.libraryRoots.map((root, index) => boundedBackupString(root, `libraryRoots[${index}]`, 4096, false))));
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'savedQueue')) {
    if (!Array.isArray(settings.savedQueue) || settings.savedQueue.length > 250000) backupSettingError('savedQueue', 'must be an array of at most 250000 paths');
    next.savedQueue = settings.savedQueue.map((filePath, index) => boundedBackupString(filePath, `savedQueue[${index}]`, 4096, false));
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'playbackSession')) next.playbackSession = sanitizePlaybackSession(settings.playbackSession);
  if (Object.prototype.hasOwnProperty.call(settings, 'lastTrack')) next.lastTrack = settings.lastTrack === null ? null : sanitizeTrackReference(settings.lastTrack, 'lastTrack');
  if (Object.prototype.hasOwnProperty.call(settings, 'playHistory')) {
    if (!Array.isArray(settings.playHistory) || settings.playHistory.length > 50) backupSettingError('playHistory', 'must be an array of at most 50 tracks');
    next.playHistory = settings.playHistory.map((track, index) => sanitizeTrackReference(track, `playHistory[${index}]`));
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'lastPlayed')) {
    if (!isPlainObject(settings.lastPlayed)) backupSettingError('lastPlayed', 'must be an object');
    next.lastPlayed = { path: boundedBackupString(settings.lastPlayed.path, 'lastPlayed.path', 4096, false) };
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'lyricsOffsets')) {
    next.lyricsOffsets = sanitizeNumberMap(settings.lyricsOffsets, 'lyricsOffsets', { maxItems: 10000, maxKeyLength: 2000, min: -3600, max: 3600 });
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'playCounts')) {
    next.playCounts = sanitizeNumberMap(settings.playCounts, 'playCounts', { maxItems: 250000, min: 0, max: 1000000000, integer: true });
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'playTimes')) {
    next.playTimes = sanitizeNumberMap(settings.playTimes, 'playTimes', { maxItems: 250000, min: 0, max: 1000000000000 });
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'listeningStats')) {
    if (!isPlainObject(settings.listeningStats)) backupSettingError('listeningStats', 'must be an object');
    const seen = new Set(); const stats = {};
    Object.entries(settings.listeningStats).slice(0, 250000).forEach(([key, value], index) => {
      if (!isPlainObject(value)) backupSettingError(`listeningStats.${index}`, 'must be an object');
      const identity = boundedBackupString(key, `listeningStats.${index}.key`, 1200, false);
      if (!/^(mbid:|name:)/.test(identity) || seen.has(identity)) return;
      seen.add(identity);
      stats[identity] = {
        count: boundedBackupNumber(value.count || 0, `listeningStats.${index}.count`, 0, 1000000000, true),
        time: boundedBackupNumber(value.time || 0, `listeningStats.${index}.time`, 0, 1000000000000),
        title: boundedBackupString(value.title || '', `listeningStats.${index}.title`, 1000),
        artist: boundedBackupString(value.artist || '', `listeningStats.${index}.artist`, 1000),
        album: boundedBackupString(value.album || '', `listeningStats.${index}.album`, 1000),
        albumArtist: boundedBackupString(value.albumArtist || '', `listeningStats.${index}.albumArtist`, 1000),
        picture: boundedBackupString(value.picture || '', `listeningStats.${index}.picture`, 16384),
        trackMbid: boundedBackupString(value.trackMbid || '', `listeningStats.${index}.trackMbid`, 80),
        nameKey: boundedBackupString(value.nameKey || '', `listeningStats.${index}.nameKey`, 1200),
        filePath: boundedBackupString(value.filePath || '', `listeningStats.${index}.filePath`, 4096),
        firstPlayedAt: boundedBackupString(value.firstPlayedAt || '', `listeningStats.${index}.firstPlayedAt`, 40),
        lastPlayedAt: boundedBackupString(value.lastPlayedAt || '', `listeningStats.${index}.lastPlayedAt`, 40),
      };
      if (isPlainObject(value.sources)) {
        const sources = {};
        for (const source of ['local', 'remote']) {
          const row = isPlainObject(value.sources[source]) ? value.sources[source] : {};
          sources[source] = {
            count: boundedBackupNumber(row.count || 0, `listeningStats.${index}.sources.${source}.count`, 0, 1000000000, true),
            time: boundedBackupNumber(row.time || 0, `listeningStats.${index}.sources.${source}.time`, 0, 1000000000000),
            firstPlayedAt: boundedBackupString(row.firstPlayedAt || '', `listeningStats.${index}.sources.${source}.firstPlayedAt`, 40),
            lastPlayedAt: boundedBackupString(row.lastPlayedAt || '', `listeningStats.${index}.sources.${source}.lastPlayedAt`, 40),
          };
        }
        stats[identity].sources = sources;
      }
    });
    next.listeningStats = stats;
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'customSmartPlaylists')) next.customSmartPlaylists = sanitizeCustomSmartPlaylists(settings.customSmartPlaylists);
  if (Object.prototype.hasOwnProperty.call(settings, 'trackNotes')) next.trackNotes = sanitizeStringMap(settings.trackNotes, 'trackNotes', MAX_LIBRARY_TRACKS, 4096, 2000);
  if (Object.prototype.hasOwnProperty.call(settings, 'albumNotes')) next.albumNotes = sanitizeStringMap(settings.albumNotes, 'albumNotes', 100000, 2000, 2000);
  if (Object.prototype.hasOwnProperty.call(settings, 'albumRatings')) {
    if (!isPlainObject(settings.albumRatings)) backupSettingError('albumRatings', 'must be an object');
    const ratings = {};
    Object.entries(settings.albumRatings).slice(0, 100000).forEach(([key, value]) => {
      const rating = Number(value);
      if (key && key.length <= 2000 && Number.isFinite(rating) && rating >= 0.5 && rating <= 5 && Math.round(rating * 2) === rating * 2) ratings[key] = rating;
    });
    next.albumRatings = ratings;
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'likedAlbums')) {
    if (!isPlainObject(settings.likedAlbums)) backupSettingError('likedAlbums', 'must be an object');
    const likedAlbums = {};
    Object.entries(settings.likedAlbums).slice(0, 100000).forEach(([key, value]) => { if (key && key.length <= 2000 && value === true) likedAlbums[key] = true; });
    next.likedAlbums = likedAlbums;
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'customLyrics')) next.customLyrics = sanitizeStringMap(settings.customLyrics, 'customLyrics', 100000, 100000, 2000);
  if (Object.prototype.hasOwnProperty.call(settings, 'lastfmRecommendationPrefs')) {
    const prefs = settings.lastfmRecommendationPrefs;
    if (!isPlainObject(prefs)) backupSettingError('lastfmRecommendationPrefs', 'must be an object');
    next.lastfmRecommendationPrefs = {
      mode: ['recent', 'genres', 'artist'].includes(prefs.mode) ? prefs.mode : 'recent',
      genres: Array.isArray(prefs.genres) ? Array.from(new Set(prefs.genres.slice(0, 5).map(value => boundedBackupString(value, 'lastfmRecommendationPrefs.genres', 200, false)))) : [],
      artist: boundedBackupString(prefs.artist || '', 'lastfmRecommendationPrefs.artist', 500),
      artists: Array.isArray(prefs.artists) ? Array.from(new Set(prefs.artists.slice(0, 5).map(value => boundedBackupString(value, 'lastfmRecommendationPrefs.artists', 500, false)))) : [],
    };
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'radioPreferences')) next.radioPreferences = sanitizeRadioPreferencesForSettings(settings.radioPreferences);
  if (Object.prototype.hasOwnProperty.call(settings, 'radioBlocklist')) next.radioBlocklist = sanitizeRadioBlocklistForSettings(settings.radioBlocklist);
  return next;
}

function sanitizeLikedSongs(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, MAX_LIBRARY_TRACKS).map((entry) => {
    if (typeof entry === 'string') return entry && entry.length <= 4096 && !entry.includes('\0') ? entry : null;
    if (!isPlainObject(entry) || entry.version !== 1 || entry.playbackSource !== 'youtube') return null;
    const identity = typeof entry.identity === 'string' && /^(mbid:|name:)/.test(entry.identity) ? entry.identity.slice(0, 1200) : '';
    const videoId = typeof entry.videoId === 'string' && /^[A-Za-z0-9_-]{11}$/.test(entry.videoId) ? entry.videoId : '';
    if (!identity || !videoId || seen.has(identity)) return null;
    seen.add(identity);
    return { version: 1, identity, title: String(entry.title || '').slice(0, 2000), artist: String(entry.artist || '').slice(0, 2000), album: String(entry.album || '').slice(0, 2000), duration: Math.max(0, Math.min(7 * 24 * 60 * 60, Number(entry.duration) || 0)), trackMbid: String(entry.trackMbid || '').slice(0, 80), videoId, playbackSource: 'youtube', artwork: String(entry.artwork || '').slice(0, 4096), dateAdded: typeof entry.dateAdded === 'string' ? entry.dateAdded.slice(0, 100) : '' };
  }).filter(Boolean);
}

module.exports = {
  sanitizeRadioPreferencesForSettings,
  sanitizeRadioBlocklistForSettings,
  isPlainObject,
  backupSettingError,
  boundedBackupString,
  boundedBackupNumber,
  sanitizeSourceRadio,
  sanitizeRadioContext,
  sanitizeTrackReference,
  sanitizePlaybackSession,
  sanitizeNumberMap,
  sanitizeCustomSmartPlaylists,
  sanitizeStringMap,
  sanitizeImportedSettings,
  sanitizeLikedSongs,
};
