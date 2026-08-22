'use strict';

const path = require('path');
const { fileURLToPath, pathToFileURL } = require('url');

const MAX_PLAYLIST_BYTES = 64 * 1024 * 1024;
const MAX_PLAYLIST_ENTRIES = 250000;
const MAX_LINE_BYTES = 1024 * 1024;
const MAX_PATH_CHARS = 4096;
const MAX_META_CHARS = 2000;
const MAX_PLAYLIST_NAME_CHARS = 1000;

function assertSafeText(value, label, maxLength) {
  const text = String(value == null ? '' : value);
  if (text.length > maxLength) throw new Error(`${label} is too long`);
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 0 || text.charCodeAt(index) === 10 || text.charCodeAt(index) === 13) {
      throw new Error(`${label} contains a forbidden line break or NUL character`);
    }
  }
  return text;
}

function isWindowsAbsolute(filePath) {
  return /^[a-z]:[\\/]/i.test(filePath) || /^\\\\/.test(filePath);
}

function pathFlavor(filePath) {
  return isWindowsAbsolute(filePath) ? path.win32 : path.posix;
}

function extensionOf(filePath) {
  return pathFlavor(filePath).extname(filePath).toLowerCase();
}

function resolveLocalLocation(value, playlistPath) {
  if (isWindowsAbsolute(value)) return path.win32.normalize(value);
  if (path.posix.isAbsolute(value)) return path.posix.normalize(value);
  const flavor = isWindowsAbsolute(playlistPath) ? path.win32 : path.posix;
  return flavor.resolve(flavor.dirname(playlistPath), value);
}

function titleFromLocation(location) {
  let value = location;
  try {
    const parsed = new URL(location);
    value = decodeURIComponent(parsed.pathname);
  } catch (_) { }
  const flavor = pathFlavor(value);
  return flavor.basename(value, flavor.extname(value));
}

function splitDisplayTitle(displayTitle, location) {
  const display = String(displayTitle || '').trim();
  const separator = display.indexOf(' - ');
  if (separator > 0 && separator < display.length - 3) {
    return { Artist: display.slice(0, separator).trim(), Song: display.slice(separator + 3).trim() };
  }
  return { Artist: '', Song: display || titleFromLocation(location) };
}

function classifyLocation(rawLocation, playlistPath, supportedExtensions, hlsPlaylist) {
  let location = rawLocation;
  let protocol = '';
  if (/^\\\\|^\/\/[^/]/.test(rawLocation)) {
    return { location: rawLocation, status: 'remote-unsupported', local: false, remote: true, hls: false, supported: false, reason: 'Network share entries require explicit local import' };
  }
  const nativeAbsolute = isWindowsAbsolute(rawLocation) || path.posix.isAbsolute(rawLocation);

  if (!nativeAbsolute && /^[a-z][a-z0-9+.-]*:/i.test(rawLocation)) {
    let parsed;
    try { parsed = new URL(rawLocation); }
    catch (_) {
      return { location: rawLocation, status: 'invalid', local: false, remote: false, hls: false, supported: false, reason: 'Invalid URI' };
    }
    protocol = parsed.protocol.toLowerCase();
    if (protocol === 'file:') {
      if (parsed.hostname && parsed.hostname.toLowerCase() !== 'localhost') {
        return { location: rawLocation, status: 'remote-unsupported', local: false, remote: true, hls: false, supported: false, reason: 'Network file URLs require explicit local import' };
      }
      try { location = fileURLToPath(parsed); }
      catch (_) {
        return { location: rawLocation, status: 'invalid', local: false, remote: false, hls: false, supported: false, reason: 'Invalid file URL' };
      }
    } else if (protocol === 'http:' || protocol === 'https:') {
      return {
        location: rawLocation,
        status: hlsPlaylist || /\.m3u8?(?:$|[?#])/i.test(parsed.pathname) ? 'hls-unsupported' : 'remote-unsupported',
        local: false,
        remote: true,
        hls: hlsPlaylist || /\.m3u8?(?:$|[?#])/i.test(parsed.pathname),
        supported: false,
        reason: 'Remote playlist entries are not fetched',
      };
    } else {
      return { location: rawLocation, status: 'remote-unsupported', local: false, remote: true, hls: false, supported: false, reason: `Unsupported ${protocol || 'remote'} URI` };
    }
  }

  location = resolveLocalLocation(location, playlistPath);
  if (location.length > MAX_PATH_CHARS) throw new Error('M3U path is too long');
  const extension = extensionOf(location);
  const nestedPlaylist = extension === '.m3u' || extension === '.m3u8';
  if (hlsPlaylist || nestedPlaylist) {
    return { location, status: 'hls-unsupported', local: true, remote: false, hls: true, supported: false, reason: 'HLS and nested playlist entries are not playable tracks' };
  }
  const supported = supportedExtensions.has(extension);
  return {
    location,
    status: supported ? 'local-missing' : 'local-unsupported',
    local: true,
    remote: false,
    hls: false,
    supported,
    reason: supported ? 'Local file was not found' : `Unsupported local file type${extension ? ` (${extension})` : ''}`,
  };
}

function parseM3u(text, playlistPath, options = {}) {
  if (typeof text !== 'string') throw new Error('M3U content must be UTF-8 text');
  if (Buffer.byteLength(text, 'utf8') > MAX_PLAYLIST_BYTES) throw new Error('Playlist is larger than the 64 MB import limit');
  if (typeof playlistPath !== 'string' || !playlistPath || playlistPath.length > MAX_PATH_CHARS) throw new Error('Playlist path is invalid');

  const supportedExtensions = new Set((options.supportedExtensions || ['.mp3', '.wav', '.flac', '.m4a']).map(ext => String(ext).toLowerCase()));
  const lines = text.replace(/^\uFEFF/, '').split(/\n/);
  const entries = [];
  let pendingMeta = null;
  let playlistName = '';
  let hlsPlaylist = false;

  for (let index = 0; index < lines.length; index++) {
    let line = lines[index];
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) throw new Error(`M3U line ${index + 1} exceeds the 1 MB limit`);
    if (line.includes('\0')) throw new Error(`M3U line ${index + 1} contains a NUL character`);
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#EXT-X-/i.test(trimmed)) {
      hlsPlaylist = true;
      continue;
    }
    if (/^#PLAYLIST:/i.test(trimmed)) {
      playlistName = assertSafeText(trimmed.slice(trimmed.indexOf(':') + 1).trim(), 'M3U playlist name', MAX_PLAYLIST_NAME_CHARS);
      continue;
    }
    if (/^#EXTINF:/i.test(trimmed)) {
      const payload = trimmed.slice(trimmed.indexOf(':') + 1);
      const comma = payload.indexOf(',');
      const durationText = comma === -1 ? payload : payload.slice(0, comma);
      const displayTitle = comma === -1 ? '' : payload.slice(comma + 1).trim();
      const parsedDuration = Number.parseFloat(durationText.trim());
      pendingMeta = {
        duration: Number.isFinite(parsedDuration) && parsedDuration >= 0 ? parsedDuration : 0,
        displayTitle: assertSafeText(displayTitle, 'M3U display title', MAX_META_CHARS),
      };
      continue;
    }
    if (trimmed.startsWith('#')) continue;
    if (entries.length >= MAX_PLAYLIST_ENTRIES) throw new Error(`Playlist contains more than ${MAX_PLAYLIST_ENTRIES} entries`);
    if (trimmed.length > MAX_PATH_CHARS) throw new Error(`M3U path on line ${index + 1} is too long`);
    entries.push({ rawLocation: trimmed, meta: pendingMeta });
    pendingMeta = null;
  }

  const records = entries.map((entry) => {
    const source = classifyLocation(entry.rawLocation, playlistPath, supportedExtensions, hlsPlaylist);
    const names = splitDisplayTitle(entry.meta && entry.meta.displayTitle, source.location);
    return {
      Song: names.Song,
      Artist: names.Artist,
      Duration: entry.meta ? entry.meta.duration : 0,
      FilePath: source.location,
      SourceFormat: extensionOf(playlistPath).slice(1).toLowerCase(),
      SourceLocation: entry.rawLocation,
      SourceStatus: source.status,
      SourceExists: false,
      SourceLocal: source.local,
      SourceRemote: source.remote,
      SourceHls: source.hls,
      SourceSupported: source.supported,
      SourceReason: source.reason,
    };
  });

  return { name: playlistName, records, hls: hlsPlaylist };
}

function setLocalRecordExistence(record, exists) {
  if (!record || !record.SourceLocal) return record;
  record.SourceExists = !!exists;
  if (record.SourceSupported && !record.SourceHls) {
    record.SourceStatus = exists ? 'local-existing' : 'local-missing';
    record.SourceReason = exists ? 'Local audio file exists outside or inside the library' : 'Local file was not found';
  }
  return record;
}

function normalizeExportTrack(track) {
  const matched = track && track.matchedFile ? track.matchedFile : {};
  track = track || {};
  return {
    title: track.title || matched.title || track.Song || track.song || track.Name || track.name || track.TITLE || '',
    artist: track.artist || matched.artist || track.Artist || track.ARTIST || '',
    album: track.album || matched.album || track.Album || track.ALBUM || '',
    duration: track.duration || matched.duration || track.Duration || track.DURATION || 0,
    genre: track.genre || matched.genre || track.Genres || track.Genre || track.GENRE || '',
    filePath: track.filePath || matched.filePath || track.FilePath || track.FILEPATH || track.Path || track.path || '',
  };
}

function localPathFromExportValue(value) {
  if (!/^file:/i.test(value)) return value;
  try { return fileURLToPath(value); }
  catch (_) { throw new Error('Track contains an invalid file URL'); }
}

function relativeExportPath(destinationPath, trackPath) {
  const destinationIsWindows = isWindowsAbsolute(destinationPath);
  const trackIsWindows = isWindowsAbsolute(trackPath);
  const destinationIsPosix = path.posix.isAbsolute(destinationPath);
  const trackIsPosix = path.posix.isAbsolute(trackPath);
  if (destinationIsWindows && trackIsWindows) {
    if (path.win32.parse(destinationPath).root.toLowerCase() !== path.win32.parse(trackPath).root.toLowerCase()) return trackPath;
    return path.win32.relative(path.win32.dirname(destinationPath), trackPath) || path.win32.basename(trackPath);
  }
  if (destinationIsPosix && trackIsPosix) {
    if (path.posix.parse(destinationPath).root !== path.posix.parse(trackPath).root) return trackPath;
    return path.posix.relative(path.posix.dirname(destinationPath), trackPath) || path.posix.basename(trackPath);
  }
  return trackPath;
}

function buildM3u(playlist, destinationPath, format) {
  if (!playlist || !Array.isArray(playlist.tracks)) throw new Error('Playlist export data is invalid');
  if (playlist.tracks.length > MAX_PLAYLIST_ENTRIES) throw new Error(`Playlist contains more than ${MAX_PLAYLIST_ENTRIES} entries`);
  if (format !== 'm3u' && format !== 'm3u8') throw new Error('Unsupported M3U export format');
  const name = assertSafeText(playlist.name || 'Playlist', 'Playlist name', MAX_PLAYLIST_NAME_CHARS);
  const lines = ['#EXTM3U', `#PLAYLIST:${name}`];
  let skipped = 0;

  for (const sourceTrack of playlist.tracks) {
    const track = normalizeExportTrack(sourceTrack);
    if (!track.filePath) {
      skipped++;
      continue;
    }
    const title = assertSafeText(track.title, 'Track title', MAX_META_CHARS);
    const artist = assertSafeText(track.artist, 'Track artist', MAX_META_CHARS);
    let filePath = assertSafeText(track.filePath, 'Track path', MAX_PATH_CHARS);
    filePath = localPathFromExportValue(filePath);
    var localFilePath = filePath;
    filePath = assertSafeText(relativeExportPath(destinationPath, filePath), 'Exported track path', MAX_PATH_CHARS);
    if (filePath.trim() !== filePath || filePath.startsWith('#')) filePath = pathToFileURL(localFilePath).href;
    const displayTitle = artist && title ? `${artist} - ${title}` : (title || artist || titleFromLocation(filePath));
    assertSafeText(displayTitle, 'Track display title', MAX_META_CHARS);
    const numericDuration = Number(track.duration);
    const duration = Number.isFinite(numericDuration) && numericDuration >= 0 ? Math.round(numericDuration) : -1;
    lines.push(`#EXTINF:${duration},${displayTitle}`, filePath);
  }

  let content = lines.join('\n') + '\n';
  if (format === 'm3u') content = '\uFEFF' + content;
  if (Buffer.byteLength(content, 'utf8') > MAX_PLAYLIST_BYTES) throw new Error('Playlist export would exceed the 64 MB limit');
  return { content, skipped, written: playlist.tracks.length - skipped };
}

module.exports = {
  MAX_PLAYLIST_BYTES,
  MAX_PLAYLIST_ENTRIES,
  MAX_LINE_BYTES,
  MAX_PATH_CHARS,
  MAX_META_CHARS,
  parseM3u,
  setLocalRecordExistence,
  normalizeExportTrack,
  buildM3u,
};
