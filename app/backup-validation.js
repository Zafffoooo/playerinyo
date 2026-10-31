'use strict';

const { isPlainObject, sanitizeImportedSettings, sanitizeLikedSongs } = require('./main-data-sanitizers');

const APP_NAME = 'Playerinyo';
const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const MAX_BACKUP_VALUES = 1000000;
const MAX_LIBRARY_TRACKS = 250000;
const MAX_PLAYLISTS = 10000;
const MAX_PLAYLIST_TRACKS = 250000;
const PLAYLIST_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const SENSITIVE_SETTING_KEYS = ['lastfmApiKey', 'lastfmSharedSecret', 'lastfmSessionKey', 'discogsToken'];

function sanitizeSettingsForBackup(settings) {
  const next = { ...(settings || {}) };
  // A fresh profile may not have created the separate statistics sidecar yet.
  if (next.listeningStats === undefined) delete next.listeningStats;
  for (const key of SENSITIVE_SETTING_KEYS) delete next[key];
  // Cookie locations can disclose local directory structure in shared backups.
  delete next.ytdlCookiesFile;
  delete next.shortcuts;
  delete next.accentColor;
  delete next.themeColors;
  return next;
}

function summarizeBackupData(data) {
  return {
    library: Array.isArray(data && data.library) ? data.library.length : 0,
    playlists: Array.isArray(data && data.playlists) ? data.playlists.length : 0,
    likedSongs: Array.isArray(data && data.likedSongs) ? data.likedSongs.length : 0,
    hasSettings: !!(data && data.settings && typeof data.settings === 'object'),
    hasMappings: !!(data && data.mappings && typeof data.mappings === 'object'),
  };
}

function validateBackupJsonShape(value, depth, budget) {
  if (--budget.remaining < 0) throw new Error('Backup contains too many values');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Backup contains an invalid number');
    return;
  }
  if (typeof value === 'string') {
    if (value.length > 16 * 1024 * 1024) throw new Error('Backup contains an oversized value');
    return;
  }
  if (depth >= 12) throw new Error('Backup nesting is too deep');
  if (Array.isArray(value)) {
    if (value.length > 500000) throw new Error('Backup contains an oversized array');
    for (const item of value) validateBackupJsonShape(item, depth + 1, budget);
    return;
  }
  if (!isPlainObject(value)) throw new Error('Backup contains an invalid value');
  const keys = Object.keys(value);
  if (keys.length > 500000) throw new Error('Backup object has too many fields');
  for (const key of keys) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('Backup contains a forbidden field');
    validateBackupJsonShape(value[key], depth + 1, budget);
  }
}

function validateBackupStringField(record, field, key, maxLength, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(record, field)) {
    if (options.required) throw new Error(`${key}.${field} is required`);
    return;
  }
  const value = record[field];
  if (value === null && options.nullable) return;
  if (typeof value !== 'string' || value.length > maxLength || value.includes('\0') || (options.nonEmpty && !value)) {
    throw new Error(`${key}.${field} must be ${options.nonEmpty ? 'a non-empty ' : 'a '}string of at most ${maxLength} characters`);
  }
}

function validateBackupNumberField(record, field, key, min, max, integer = false, nullable = true) {
  if (!Object.prototype.hasOwnProperty.call(record, field)) return;
  const value = record[field];
  if (value === null && nullable) return;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new Error(`${key}.${field} contains an invalid number`);
  }
}

function validateBackupLibrary(library) {
  if (library.length > MAX_LIBRARY_TRACKS) throw new Error(`Backup library contains more than ${MAX_LIBRARY_TRACKS} tracks`);
  for (let index = 0; index < library.length; index++) {
    const track = library[index];
    const key = `library[${index}]`;
    if (!isPlainObject(track)) throw new Error(`Backup ${key} must be an object`);
    validateBackupStringField(track, 'filePath', key, 4096, { required: true, nonEmpty: true });
    validateBackupStringField(track, 'filename', key, 1024, { required: true, nonEmpty: true });
    for (const field of ['title', 'artist', 'album']) validateBackupStringField(track, field, key, 2000, { required: true });
    validateBackupStringField(track, 'albumArtist', key, 2000, { nullable: true });
    validateBackupStringField(track, 'picture', key, 16384, { nullable: true });
    validateBackupStringField(track, 'genre', key, 2000, { nullable: true });
    validateBackupStringField(track, 'replayGainMethod', key, 40, { nullable: true });
    if (Object.prototype.hasOwnProperty.call(track, 'year') && track.year !== null) {
      if (typeof track.year === 'string') {
        if (track.year.length > 40 || track.year.includes('\0')) throw new Error(`${key}.year is invalid`);
      } else if (typeof track.year !== 'number' || !Number.isFinite(track.year)) throw new Error(`${key}.year must be a string, number, or null`);
    }
    validateBackupNumberField(track, 'duration', key, 0, 7 * 24 * 60 * 60);
    for (const field of ['trackNo', 'trackTotal', 'discNo', 'discTotal', '__displayDiscNo']) validateBackupNumberField(track, field, key, 0, 100000, true);
    validateBackupNumberField(track, 'fileSize', key, 0, Number.MAX_SAFE_INTEGER, true);
    validateBackupNumberField(track, 'modifiedAtMs', key, 0, Number.MAX_SAFE_INTEGER);
    validateBackupNumberField(track, 'addedAtMs', key, 0, Number.MAX_SAFE_INTEGER);
    for (const field of ['replayGainTrackDb', 'replayGainAlbumDb']) validateBackupNumberField(track, field, key, -1000, 1000);
    for (const field of ['replayGainTrackPeak', 'replayGainAlbumPeak']) validateBackupNumberField(track, field, key, 0, 1000000);
    if (Object.prototype.hasOwnProperty.call(track, 'isDisabled') && typeof track.isDisabled !== 'boolean') throw new Error(`${key}.isDisabled must be a boolean`);
  }
}

const PLAYLIST_TRACK_STRING_FIELDS = new Set([
  'Song', 'song', 'title', 'Title', 'TITLE', 'Name', 'name',
  'Artist', 'artist', 'ARTIST', 'Album', 'album', 'ALBUM', 'AlbumArtist',
  'FilePath', 'filePath', 'Path', 'path', 'Playlist',
]);

function validateBackupPlaylistTrack(track, key) {
  if (!isPlainObject(track)) throw new Error(`Backup ${key} must be an object`);
  const entries = Object.entries(track);
  if (entries.length > 128) throw new Error(`Backup ${key} has too many CSV fields`);
  for (const [field, value] of entries) {
    if (field.length > 256 || field.includes('\0')) throw new Error(`Backup ${key} contains an invalid CSV field name`);
    if (PLAYLIST_TRACK_STRING_FIELDS.has(field)) {
      if (typeof value !== 'string' || value.length > (field.toLowerCase().includes('path') ? 4096 : 2000) || value.includes('\0')) {
        throw new Error(`Backup ${key}.${field} must be a bounded string`);
      }
      continue;
    }
    if (field === 'AddedAtMs' || field === 'addedAtMs') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) throw new Error(`Backup ${key}.${field} contains an invalid added timestamp`);
      continue;
    }
    if (typeof value === 'string') {
      if (value.length > 16384 || value.includes('\0')) throw new Error(`Backup ${key}.${field} contains an oversized string`);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Backup ${key}.${field} contains an invalid number`);
    } else if (value !== null && typeof value !== 'boolean') {
      throw new Error(`Backup ${key}.${field} must be a primitive CSV value`);
    }
  }
}

function validateBackupPlaylists(playlists) {
  if (playlists.length > MAX_PLAYLISTS) throw new Error(`Backup contains more than ${MAX_PLAYLISTS} playlists`);
  const playlistIds = new Set();
  let trackCount = 0;
  for (let index = 0; index < playlists.length; index++) {
    const playlist = playlists[index];
    const key = `playlists[${index}]`;
    if (!isPlainObject(playlist)) throw new Error(`Backup ${key} must be an object`);
    validateBackupStringField(playlist, 'id', key, 500, { required: true, nonEmpty: true });
    validateBackupStringField(playlist, 'name', key, 1000, { required: true, nonEmpty: true });
    if (playlistIds.has(playlist.id)) throw new Error(`Backup contains duplicate playlist id "${playlist.id}"`);
    playlistIds.add(playlist.id);
    if (!Array.isArray(playlist.tracks)) throw new Error(`Backup ${key}.tracks must be an array`);
    trackCount += playlist.tracks.length;
    if (trackCount > MAX_PLAYLIST_TRACKS) throw new Error(`Backup contains more than ${MAX_PLAYLIST_TRACKS} playlist tracks`);
    if (Object.prototype.hasOwnProperty.call(playlist, 'color')) {
      if (typeof playlist.color !== 'string' || !PLAYLIST_COLOR_PATTERN.test(playlist.color)) throw new Error(`Backup ${key}.color is invalid`);
    }
    validateBackupStringField(playlist, 'folderId', key, 100, { nullable: true });
    validateBackupStringField(playlist, 'cover', key, 2097152, { nullable: true });
    validateBackupStringField(playlist, 'lastPlayed', key, 100, { nullable: true });
    validateBackupStringField(playlist, 'sortBy', key, 100, { nullable: true });
    if (Object.prototype.hasOwnProperty.call(playlist, 'sortDirection') && !['asc', 'desc'].includes(playlist.sortDirection)) throw new Error(`Backup ${key}.sortDirection must be asc or desc`);
    for (const field of ['pinned', 'isSpecial']) {
      if (Object.prototype.hasOwnProperty.call(playlist, field) && typeof playlist[field] !== 'boolean') throw new Error(`Backup ${key}.${field} must be a boolean`);
    }
    for (let trackIndex = 0; trackIndex < playlist.tracks.length; trackIndex++) {
      validateBackupPlaylistTrack(playlist.tracks[trackIndex], `${key}.tracks[${trackIndex}]`);
    }
  }
}

function validateBackupMappings(mappings) {
  const entries = Object.entries(mappings);
  if (entries.length > MAX_LIBRARY_TRACKS) throw new Error('Backup mappings contain too many entries');
  for (const [key, value] of entries) {
    if (!key || key.length > 6000 || key.includes('\0')) throw new Error('Backup mappings contain an invalid key');
    if (typeof value !== 'string' || !value || value.length > 4096 || value.includes('\0')) throw new Error(`Backup mapping "${key.slice(0, 100)}" must be a bounded path or NO_MATCH string`);
  }
}

function validateBackupContainers(data, requireLikedSongs = false) {
  if (!Array.isArray(data.library)) throw new Error('Backup library must be an array');
  if (!Array.isArray(data.playlists)) throw new Error('Backup playlists must be an array');
  if (!isPlainObject(data.mappings)) throw new Error('Backup mappings must be an object');
  if (!isPlainObject(data.settings)) throw new Error('Backup settings must be an object');
  if (requireLikedSongs && !Array.isArray(data.likedSongs)) throw new Error('Backup liked songs must be an array');
  if (data.likedSongs !== undefined) {
    if (!Array.isArray(data.likedSongs) || data.likedSongs.length > MAX_LIBRARY_TRACKS) throw new Error('Backup liked songs are invalid');
    if (sanitizeLikedSongs(data.likedSongs).length !== data.likedSongs.length) throw new Error('Backup liked songs contain invalid entries');
  }
  validateBackupLibrary(data.library);
  validateBackupPlaylists(data.playlists);
  validateBackupMappings(data.mappings);
}

function validateBackupData(parsed) {
  if (!isPlainObject(parsed)) throw new Error('Backup root must be an object');
  let data = parsed;
  if (Object.prototype.hasOwnProperty.call(parsed, 'data')) {
    if (parsed.app !== APP_NAME || parsed.schemaVersion !== 1) throw new Error('Unsupported backup format or version');
    data = parsed.data;
  } else {
    const legacyFields = ['library', 'playlists', 'mappings', 'settings'];
    if (!legacyFields.every(key => Object.prototype.hasOwnProperty.call(parsed, key))) throw new Error('Unsupported legacy backup format');
  }
  if (!isPlainObject(data)) throw new Error('Backup data must be an object');
  validateBackupJsonShape(data, 0, { remaining: MAX_BACKUP_VALUES });
  validateBackupContainers(data);
  return { ...data, settings: sanitizeImportedSettings(data.settings) };
}

module.exports = {
  MAX_BACKUP_BYTES, MAX_BACKUP_VALUES, MAX_LIBRARY_TRACKS, MAX_PLAYLIST_TRACKS, SENSITIVE_SETTING_KEYS,
  sanitizeSettingsForBackup, summarizeBackupData, validateBackupJsonShape, validateBackupLibrary,
  validateBackupPlaylistTrack, validateBackupPlaylists, validateBackupMappings, validateBackupContainers, validateBackupData,
};
