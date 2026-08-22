const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, safeStorage, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');
const { parse } = require('csv-parse');
const NodeID3 = require('node-id3');
const { parseM3u, setLocalRecordExistence, normalizeExportTrack, buildM3u } = require('./playlist-format');
const { applyPathRemap, buildRelinkProposals, canonicalPath, inferRootReplacements } = require('./moved-file-relink');
const { createLastfmApiClient, restoreCacheEntries } = require('./lastfm-client');
const { enrichCanonicalDownloadMetadata, getLastfmTrackInfoParams, stripYoutubeTopicSuffix } = require('./download-canonical-metadata');
const { buildCandidatePools, selectDiscoveryBatch, flattenPools, getCandidateIdentity, getCandidateAliasIdentity, normalizeGenreKey, normalizeText, hasGenreTag } = require('./lastfm-discovery');
const { createKnownTrackIndex, seedFromHistory, indexTrack, hasKnownTrack, beginLastfmSync, ingestLastfmRecentPage, getLastfmRecentTracksRequest, MAX_SERIALIZED_BYTES, serializeKnownTrackIndex } = require('./known-track-index');
const { createPendingWriteDrainer } = require('./pending-write-drainer');
const { createLastfmSyncGuard } = require('./lastfm-sync-guard');
const { isNormalizedPoolValue, getPersistableDiscoveryCacheEntries, setBoundedDiscoveryCacheEntry } = require('./lastfm-discovery-cache');
const { getLfmSignature, hasLastfmScrobbleCredentials, redactLastfmCredentials } = require('./lastfm-auth');
const { mergeRendererSettings, clearLastfmCredentials, canPersistLastfmCredentials } = require('./lastfm-settings-lifecycle');
const { configureLinuxPasswordStore } = require('./linux-password-store');
const { isNewerReleaseVersion } = require('./release-update');
const { createRadioStreamResolver } = require('./radio-stream-resolver');
const { DurableMatchCache } = require('./radio-stream-cache');
const { makeAlbumSizeKey, calculateAlbumSize, getAlbumRoot } = require('./album-size');
const { sanitizeDownloadRecoveryRecord, normalizeDownloadRecoveryRecords } = require('./download-recovery');
const { splitSerializedSettings } = require('./listening-stats-storage');
const { getFreshEntry, setBoundedEntry } = require('./bounded-runtime-cache');
const {
  AUTOMATIC_BACKUP_INTERVAL_MS,
  AUTOMATIC_BACKUP_RETENTION,
  createLocalBackupFilename,
  getAutomaticBackupDueAt,
  getAutomaticBackupTime,
  getSafetyBackupTime,
  isAutomaticBackupDue,
  isAutomaticBackupFilename,
  isSafetyBackupFilename,
  selectAutomaticBackupsToPrune,
} = require('./backup-helpers');

let fatalExitInProgress = false;
function handleFatalProcessError(kind, error) {
  console.error(`${kind}:`, error);
  if (fatalExitInProgress) return;
  fatalExitInProgress = true;
  const message = error && error.message ? error.message : String(error || 'Unknown error');
  try {
    if (app.isReady()) dialog.showErrorBox('Playerinyo Fatal Error', `Playerinyo must close because of an unrecoverable error.\n\n${message}`);
  } catch (_) { }
  setImmediate(() => {
    try { app.exit(1); }
    catch (_) { process.exit(1); }
  });
}

process.on('uncaughtException', (err) => handleFatalProcessError('Uncaught exception', err));
process.on('unhandledRejection', (reason) => handleFatalProcessError('Unhandled rejection', reason));

// Discord RPC
let DiscordRPC = null;
let discordClient = null;
let discordEnabled = false;
try {
  DiscordRPC = require('discord-rpc');
} catch (e) { console.log('discord-rpc not available:', e.message); }

let discordLastError = null;
async function discordConnect() {
  if (!DiscordRPC) { discordLastError = "discord-rpc module missing (run npm install)"; return; }
  if (discordClient) return;
  discordLastError = null;
  try {
    discordClient = new DiscordRPC.Client({ transport: 'ipc' });
    discordClient.on('ready', () => { discordEnabled = true; discordLastError = null; console.log('Discord RPC connected'); });
    discordClient.on('disconnected', () => { discordEnabled = false; discordClient = null; discordLastError = "Disconnected from Discord"; });
    discordClient.on('error', (err) => { discordEnabled = false; discordLastError = err && err.message ? err.message : String(err); console.log('Discord RPC error:', discordLastError); });
    await discordClient.login({ clientId: '497005876856053760' });
  } catch (e) { console.log('Discord RPC connect failed:', e.message); discordLastError = e.message; discordClient = null; }
}

async function discordSetActivity(title, artist, album, startTime) {
  if (!discordClient || !discordEnabled) return;
  try {
    await discordClient.setActivity({
      details: title || 'Unknown Track',
      state: artist ? 'by ' + artist : 'Unknown Artist',
      largeImageKey: 'music',
      largeImageText: album || '',
      startTimestamp: startTime ? new Date(startTime) : undefined,
      instance: false,
    });
  } catch (e) { console.log('Discord setActivity error:', e); }
}

async function discordClear() {
  if (!discordClient) return true;
  try { await discordClient.clearActivity(); return true; }
  catch (e) {
    discordLastError = e && e.message ? e.message : String(e);
    console.log('Discord clearActivity error:', discordLastError);
    return false;
  }
}

// We use dynamic import for music-metadata because modern versions are ESM-only,
// but since we are installing version 7, we can use require.
// However, to be safe against versions, dynamic import or require('music-metadata') works.
let mainWindow;
let mm;
let tray = null;
let trayAvailable = false;
let isQuitting = false;
let quitFlushPending = false;
let quitFlushTimer = null;
let quitWriteDrainInProgress = false;
let pendingCloseAction = '';
let allowWindowClose = false;
let closeFinishInProgress = false;
let backupRestoreInProgress = false;
let movedFileRelinkCommitInProgress = false;
let activeDataTransactionPromise = null;
let activeBackupOperationPromise = null;
let activeBackupOperationKind = '';
let activeMetadataWriteOperations = 0;
let automaticBackupTimer = null;
let automaticBackupScheduleGeneration = 0;
let automaticBackupHistoryPromise = null;
let automaticBackupHistoryLoaded = false;
let automaticBackupLibraryReady = false;
let automaticBackupStatus = { lastSuccessAt: null, lastErrorAt: null, lastError: '' };
let appSettings = { minimizeToTray: false, useNativeTitleBar: false, ytdlCookiesMode: 'none', ytdlCookiesBrowser: 'firefox', ytdlCookiesFile: '', automaticBackupsEnabled: true };
let preservedEncryptedSettings = {};
const undecryptableSettingKeys = new Set();
let mprisPlayer = null;
let mprisTrackId = 0;
let mprisTrackKey = '';
let mprisPositionUs = 0;
let mprisPositionUpdatedAt = 0;
let mprisDurationUs = 0;
let mprisStopped = false;
const metadataCoverCache = new Map();
const downloadSearchCache = new Map();
const downloadSearchInFlight = new Map();
const activeYtdlpDownloads = new Map();
const cancelledYtdlpDownloads = new Set();
const activeRadioResolverRequests = new Set();
let radioStreamResolver = null;
const reservedDownloadRequestIds = new Set();
const pendingBackupImports = new Map();
const pendingMovedFileRelinks = new Map();
const DOWNLOAD_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_DOWNLOAD_SEARCH_CACHE_ENTRIES = 200;
const MAX_BACKUP_BYTES = 256 * 1024 * 1024;
const MAX_BACKUP_VALUES = 1000000;
const BACKUP_TOKEN_TTL_MS = 10 * 60 * 1000;
const MOVED_FILE_TOKEN_TTL_MS = 5 * 60 * 1000;
const AUTOMATIC_BACKUP_DEFER_MS = 5 * 60 * 1000;
const AUTOMATIC_BACKUP_RETRY_MS = 60 * 60 * 1000;
const AUTOMATIC_BACKUP_INITIAL_DELAY_MS = 30 * 1000;
const RENDERER_CLOSE_FLUSH_TIMEOUT_MS = 10 * 1000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_IMAGE_CACHE_ENTRIES = 12;
const MAX_CSV_BYTES = 64 * 1024 * 1024;
const MAX_CSV_RECORDS = 250000;
const MAX_AUDIO_IPC_BYTES = 128 * 1024 * 1024;
const MAX_METADATA_EDIT_BYTES = 512 * 1024 * 1024;
const MAX_DOWNLOADED_AUDIO_BYTES = 512 * 1024 * 1024;
const MAX_SCAN_AUDIO_FILES = 250000;
const MAX_LIBRARY_TRACKS = 250000;
const MAX_PLAYLISTS = 10000;
const MAX_PLAYLIST_TRACKS = 250000;
const PLAYLIST_COLOR_PATTERN = /^#[0-9a-f]{6}$/i;
const EXTERNAL_URL_HOSTS = new Set(['www.youtube.com', 'covers.musichoarders.xyz', 'www.last.fm']);
const IMAGE_URL_HOSTS = new Set(['coverartarchive.org', 'archive.org', 'i.scdn.co', 'i.discogs.com', 'i.ytimg.com', 'lastfm.freetls.fastly.net']);
const APP_ENTRY_URL = pathToFileURL(path.join(__dirname, 'index.html')).href;
const RELEASES_API_URL = 'https://api.github.com/repos/Zafffoooo/playerinyo/releases/latest';
const SENSITIVE_SETTING_KEYS = ['lastfmApiKey', 'lastfmSharedSecret', 'lastfmSessionKey', 'discogsToken'];
const LASTFM_DEBUG_ENABLED = process.env.LASTFM_DEBUG === '1';
function lastfmCredentialPresence(settings) {
  const source = settings || {};
  return {
    apiKey: !!String(source.lastfmApiKey || '').trim(),
    sharedSecret: !!String(source.lastfmSharedSecret || '').trim(),
    sessionKey: !!String(source.lastfmSessionKey || '').trim(),
    username: !!String(source.lastfmUsername || '').trim(),
  };
}
function lastfmEncryptedFieldPresence(snapshot) {
  const source = snapshot || {};
  const encrypted = (key) => !!(source[key] && typeof source[key] === 'object' && source[key].__secure === 'electron' && typeof source[key].value === 'string');
  return { apiKeyEncrypted: encrypted('lastfmApiKey'), sharedSecretEncrypted: encrypted('lastfmSharedSecret'), sessionKeyEncrypted: encrypted('lastfmSessionKey'), username: !!String(source.lastfmUsername || '').trim() };
}
function lastfmDebug(stage, fields) {
  if (!LASTFM_DEBUG_ENABLED) return;
  console.log('[lastfm-debug] ' + stage, fields || {});
}
// Temporary bounded radio pipeline trace.  It is deliberately main-process
// logging so `npm start` captures it, and never includes credentials or URLs.
const RADIO_DEBUG_ENABLED = process.env.RADIO_DEBUG === '1';
const radioDebugRequests = new Map();
function radioDebug(stage, fields) {
  if (!RADIO_DEBUG_ENABLED) return;
  console.log('[radio-debug] ' + stage, fields || {});
}
function radioDebugText(value, max) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max || 240);
}
const APP_NAME = 'Playerinyo';
const APP_ID = 'playerinyo';
const APP_USER_AGENT = `${APP_NAME}/1.0.0`;
const APP_ICON = path.join(__dirname, 'assets', 'icon.png');
const RADIO_MATCH_CACHE_FILE = path.join(app.getPath('userData'), 'radio-match-cache.json');
const RADIO_STREAM_SCHEME = 'playerinyo-stream';
const RADIO_STREAM_HOSTS = new Set(['googlevideo.com', 'youtube.com', 'www.youtube.com', 'music.youtube.com']);

protocol.registerSchemesAsPrivileged([{ scheme: RADIO_STREAM_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }]);

app.setName(APP_NAME);
if (process.platform === 'linux') {
  configureLinuxPasswordStore(process.platform, app.commandLine);
  app.commandLine.appendSwitch('class', APP_ID);
  app.commandLine.appendSwitch('name', APP_ID);
  if (typeof app.setDesktopName === 'function') app.setDesktopName(`${APP_ID}.desktop`);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

function isTrustedRendererEvent(event) {
  return !!(mainWindow
    && !mainWindow.isDestroyed()
    && event
    && event.sender === mainWindow.webContents
    && event.senderFrame === mainWindow.webContents.mainFrame
    && event.senderFrame.url === APP_ENTRY_URL);
}

function registerIpcHandler(channel, listener) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedRendererEvent(event)) throw new Error('Untrusted IPC sender');
    return listener(event, ...args);
  });
}

function registerIpcListener(channel, listener) {
  ipcMain.on(channel, (event, ...args) => {
    if (!isTrustedRendererEvent(event)) return;
    listener(event, ...args);
  });
}

function isSecureStorageAvailable() {
  if (!safeStorage.isEncryptionAvailable()) return false;
  const backend = typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : '';
  return backend !== 'basic_text';
}

function serializeSettingsForDisk(settings) {
  const next = { ...settings };
  if (!isSecureStorageAvailable()) {
    for (const key of SENSITIVE_SETTING_KEYS) {
      if (preservedEncryptedSettings[key]) next[key] = preservedEncryptedSettings[key];
      else delete next[key];
    }
    return next;
  }
  for (const key of SENSITIVE_SETTING_KEYS) {
    if (typeof next[key] === 'string' && next[key]) {
      next[key] = {
        __secure: 'electron',
        value: safeStorage.encryptString(next[key]).toString('base64'),
      };
      preservedEncryptedSettings[key] = next[key];
      undecryptableSettingKeys.delete(key);
    } else if (undecryptableSettingKeys.has(key) && preservedEncryptedSettings[key]) {
      next[key] = preservedEncryptedSettings[key];
    } else if (!next[key]) {
      delete preservedEncryptedSettings[key];
    }
  }
  return next;
}

function deserializeSettingsFromDisk(settings) {
  const next = { ...settings };
  lastfmDebug('settings-disk-observed', lastfmEncryptedFieldPresence(settings));
  for (const key of SENSITIVE_SETTING_KEYS) {
    const value = next[key];
    if (value && typeof value === 'object' && value.__secure === 'electron' && typeof value.value === 'string') preservedEncryptedSettings[key] = value;
    if (!isSecureStorageAvailable()) {
      next[key] = '';
      continue;
    }
    if (!value || typeof value !== 'object' || value.__secure !== 'electron' || typeof value.value !== 'string') continue;
    try {
      next[key] = safeStorage.decryptString(Buffer.from(value.value, 'base64'));
      undecryptableSettingKeys.delete(key);
    } catch (e) {
      console.error(`Failed to decrypt setting: ${key}`, e && e.message ? e.message : e);
      undecryptableSettingKeys.add(key);
      next[key] = '';
    }
  }
  lastfmDebug('settings-hydrated', { ...lastfmCredentialPresence(next), secureStorageAvailable: isSecureStorageAvailable(), safeStorageBackend: typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : '' });
  return next;
}

function readJsonFile(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { console.error('Failed to read JSON:', filePath, e); }
  return fallback;
}

function readAppDataFile(filePath, fallback, label, validate) {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular data file');
    const value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (validate) validate(value);
    return value;
  } catch (e) {
    throw new Error(`Could not load ${label}: ${e.message || e}`);
  }
}

function readJsonFileStrict(filePath, fallback) {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('is not a regular data file');
    if (stat.size > MAX_BACKUP_BYTES) throw new Error(`is larger than the ${MAX_BACKUP_BYTES / (1024 * 1024)} MB backup limit`);
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    if (e && e.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${path.basename(filePath)} for backup: ${e.message || e}`);
  }
}

const fileWriteQueues = new Map();

async function writeTextFileAtomic(filePath, text) {
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    await fs.promises.writeFile(tmpPath, text, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(tmpPath, filePath);
  } catch (e) {
    try { await fs.promises.unlink(tmpPath); } catch (_) { }
    throw e;
  }
}

function queueTextFileWrite(filePath, text) {
  const previous = fileWriteQueues.get(filePath) || Promise.resolve();
  const next = previous.catch(() => { }).then(() => writeTextFileAtomic(filePath, text));
  fileWriteQueues.set(filePath, next);
  const cleanup = () => { if (fileWriteQueues.get(filePath) === next) fileWriteQueues.delete(filePath); };
  next.then(cleanup, cleanup);
  return next;
}

function queueJsonWrite(filePath, data) {
  return queueTextFileWrite(filePath, JSON.stringify(data));
}

async function drainFileWriteQueues() {
  let firstError = null;
  while (fileWriteQueues.size) {
    const pending = Array.from(fileWriteQueues.values());
    const results = await Promise.allSettled(pending);
    for (const result of results) {
      if (result.status === 'rejected' && !firstError) firstError = result.reason;
    }
  }
  if (firstError) throw firstError;
}

async function waitForPendingDataWrites(timeoutMs) {
  const work = (async () => {
    while (activeDataTransactionPromise) await activeDataTransactionPromise;
    await drainFileWriteQueues();
    while (activeDataTransactionPromise) await activeDataTransactionPromise;
  })();
  if (!timeoutMs) return work;
  let timer = null;
  try {
    return await Promise.race([
      work,
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Timed out waiting for data writes')), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForMetadataWrites() {
  // Metadata writes replace files atomically, but app.exit() would still cut
  // off an in-progress replacement. Wait for both queued file writers and
  // folder-cover operations before the main process exits.
  while (activeMetadataWriteOperations || metadataWriteQueues.size) {
    const queued = Array.from(metadataWriteQueues.values());
    if (queued.length) await Promise.allSettled(queued);
    else await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function cancelActiveDownloadProcesses() {
  for (const [requestId, child] of activeYtdlpDownloads) {
    cancelledYtdlpDownloads.add(requestId);
    try { child.kill('SIGTERM'); } catch (_) { continue; }
    const forceKill = setTimeout(() => {
      try { if (activeYtdlpDownloads.get(requestId) === child) child.kill('SIGKILL'); } catch (_) { }
    }, 3000);
    forceKill.unref();
  }
}

async function waitForActiveDownloadProcesses() {
  while (activeYtdlpDownloads.size) await new Promise((resolve) => setTimeout(resolve, 20));
}

function transactionRecordData(records) {
  return records.map(record => ({ target: record.target, staged: record.staged, rollback: record.rollback, hadOriginal: record.hadOriginal }));
}

async function cleanupTransactionRecords(records) {
  for (const record of records) {
    await fs.promises.rm(record.staged, { force: true }).catch(() => { });
    await fs.promises.rm(record.rollback, { force: true }).catch(() => { });
  }
}

async function rollbackDataTransaction(records) {
  let rollbackSucceeded = true;
  for (const record of records.slice().reverse()) {
    try {
      if (record.hadOriginal) await fs.promises.copyFile(record.rollback, record.target);
      else await fs.promises.rm(record.target, { force: true });
    } catch (rollbackError) {
      rollbackSucceeded = false;
      console.error('Backup restore rollback failed:', record.target, rollbackError);
    }
  }
  return rollbackSucceeded;
}

async function replaceJsonFilesTransactionInner(entries) {
  const transactionId = `${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}`;
  const records = entries.map((entry) => ({
    target: entry.filePath,
    text: JSON.stringify(entry.data),
    staged: path.join(path.dirname(entry.filePath), `.${path.basename(entry.filePath)}.${transactionId}.stage`),
    rollback: path.join(path.dirname(entry.filePath), `.${path.basename(entry.filePath)}.${transactionId}.rollback`),
    hadOriginal: false,
  }));
  let manifestWritten = false;
  let commitComplete = false;
  try {
    for (const record of records) await fs.promises.writeFile(record.staged, record.text, { encoding: 'utf8', mode: 0o600 });
    for (const record of records) {
      try {
        const stat = await fs.promises.lstat(record.target);
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Invalid data file: ${path.basename(record.target)}`);
        record.hadOriginal = true;
        await fs.promises.copyFile(record.target, record.rollback, fs.constants.COPYFILE_EXCL);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
    }
    await writeTextFileAtomic(RESTORE_MANIFEST_FILE, JSON.stringify({ phase: 'prepared', records: transactionRecordData(records) }));
    manifestWritten = true;
    for (const record of records) await fs.promises.rename(record.staged, record.target);
    await writeTextFileAtomic(RESTORE_MANIFEST_FILE, JSON.stringify({ phase: 'committed', records: transactionRecordData(records) }));
    commitComplete = true;
    await cleanupTransactionRecords(records);
    await fs.promises.rm(RESTORE_MANIFEST_FILE, { force: true }).catch((e) => console.warn('Committed restore manifest will be cleaned on next startup:', e));
  } catch (error) {
    if (commitComplete) {
      console.warn('Backup restore committed; deferred transaction cleanup:', error);
      return;
    }
    if (manifestWritten) {
      const rolledBack = await rollbackDataTransaction(records);
      if (rolledBack) {
        await writeTextFileAtomic(RESTORE_MANIFEST_FILE, JSON.stringify({ phase: 'rolled-back', records: transactionRecordData(records) }));
        await cleanupTransactionRecords(records);
        await fs.promises.rm(RESTORE_MANIFEST_FILE, { force: true }).catch((e) => console.warn('Rolled-back restore manifest will be cleaned on next startup:', e));
      }
    } else {
      await cleanupTransactionRecords(records);
    }
    throw error;
  }
}

async function replaceJsonFilesTransaction(entries) {
  if (activeDataTransactionPromise) throw new Error('Another data transaction is already active');
  const transaction = replaceJsonFilesTransactionInner(entries);
  activeDataTransactionPromise = transaction;
  try { return await transaction; }
  finally { if (activeDataTransactionPromise === transaction) activeDataTransactionPromise = null; }
}

async function recoverInterruptedDataTransaction() {
  if (!fs.existsSync(RESTORE_MANIFEST_FILE)) return;
  try {
    const manifest = JSON.parse(await fs.promises.readFile(RESTORE_MANIFEST_FILE, 'utf8'));
    const records = Array.isArray(manifest.records) ? manifest.records : [];
    const legacyTargets = [LIBRARY_FILE, PLAYLISTS_FILE, MAPPINGS_FILE, SETTINGS_FILE];
    const currentTargets = [...legacyTargets, LIKED_SONGS_FILE];
    const currentTargetsWithListeningStats = [...currentTargets, LISTENING_STATS_FILE];
    const allowedTargets = new Set(currentTargetsWithListeningStats);
    const recordTargets = new Set(records.map(record => record && record.target));
    const hasExactTargets = (targets) => recordTargets.size === targets.length && targets.every(target => recordTargets.has(target));
    const userDataDir = app.getPath('userData');
    const valid = ((records.length === 4 && hasExactTargets(legacyTargets)) || (records.length === 5 && hasExactTargets(currentTargets)) || (records.length === 6 && hasExactTargets(currentTargetsWithListeningStats)))
      && records.every(record => record
      && typeof record.target === 'string'
      && typeof record.staged === 'string'
      && typeof record.rollback === 'string'
      && allowedTargets.has(record.target)
      && path.dirname(record.staged) === userDataDir
      && path.dirname(record.rollback) === userDataDir
      && path.basename(record.staged).startsWith(`.${path.basename(record.target)}.`)
      && path.basename(record.staged).endsWith('.stage')
      && path.basename(record.rollback).startsWith(`.${path.basename(record.target)}.`)
      && path.basename(record.rollback).endsWith('.rollback')
      && typeof record.hadOriginal === 'boolean');
    if (!valid) throw new Error('Invalid restore recovery manifest');
    if (manifest.phase !== 'committed' && manifest.phase !== 'rolled-back') {
      const rolledBack = await rollbackDataTransaction(records);
      if (!rolledBack) throw new Error('Backup restore rollback is incomplete');
      await writeTextFileAtomic(RESTORE_MANIFEST_FILE, JSON.stringify({ phase: 'rolled-back', records: transactionRecordData(records) }));
    }
    await cleanupTransactionRecords(records);
    await fs.promises.rm(RESTORE_MANIFEST_FILE, { force: true }).catch((e) => console.warn('Completed recovery manifest cleanup deferred:', e));
  } catch (e) {
    console.error('Could not recover interrupted backup restore:', e);
    throw e;
  }
}

function sanitizeSettingsForBackup(settings) {
  const next = { ...(settings || {}) };
  for (const key of SENSITIVE_SETTING_KEYS) delete next[key];
  // The cookie contents never enter app state, but a cookies.txt location can
  // disclose a user name or local directory structure when a backup is shared.
  delete next.ytdlCookiesFile;
  delete next.shortcuts;
  delete next.accentColor;
  delete next.themeColors;
  return next;
}

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

function summarizeBackupData(data) {
  return {
    library: Array.isArray(data && data.library) ? data.library.length : 0,
    playlists: Array.isArray(data && data.playlists) ? data.playlists.length : 0,
    likedSongs: Array.isArray(data && data.likedSongs) ? data.likedSongs.length : 0,
    hasSettings: !!(data && data.settings && typeof data.settings === 'object'),
    hasMappings: !!(data && data.mappings && typeof data.mappings === 'object'),
  };
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
  return value.map((playlist, index) => {
    const key = `customSmartPlaylists[${index}]`;
    if (!isPlainObject(playlist) || !isPlainObject(playlist.rule)) backupSettingError(key, 'must contain a rule object');
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
        picture: boundedBackupString(value.picture || '', `listeningStats.${index}.picture`, 16384),
        trackMbid: boundedBackupString(value.trackMbid || '', `listeningStats.${index}.trackMbid`, 80),
        nameKey: boundedBackupString(value.nameKey || '', `listeningStats.${index}.nameKey`, 1200),
        filePath: boundedBackupString(value.filePath || '', `listeningStats.${index}.filePath`, 4096),
      };
    });
    next.listeningStats = stats;
  }
  if (Object.prototype.hasOwnProperty.call(settings, 'customSmartPlaylists')) next.customSmartPlaylists = sanitizeCustomSmartPlaylists(settings.customSmartPlaylists);
  if (Object.prototype.hasOwnProperty.call(settings, 'radioPreferences')) next.radioPreferences = sanitizeRadioPreferencesForSettings(settings.radioPreferences);
  if (Object.prototype.hasOwnProperty.call(settings, 'radioBlocklist')) next.radioBlocklist = sanitizeRadioBlocklistForSettings(settings.radioBlocklist);
  return next;
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
    validateBackupStringField(playlist, 'cover', key, 16384, { nullable: true });
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

function validateAppStateSnapshot(snapshot) {
  if (!isPlainObject(snapshot)) throw new Error('App state snapshot must be an object');
  const playlists = Array.isArray(snapshot.playlists) ? snapshot.playlists.map((playlist) => {
    if (!isPlainObject(playlist) || !Array.isArray(playlist.tracks)) return playlist;
    return {
      ...playlist,
      tracks: playlist.tracks.map((track) => {
        if (!isPlainObject(track)) return track;
        return Object.fromEntries(Object.entries(track).filter(([key]) => !key.startsWith('__')));
      }),
    };
  }) : snapshot.playlists;
  const data = {
    library: snapshot.library,
    playlists,
    mappings: snapshot.mappings,
    settings: snapshot.settings,
    likedSongs: snapshot.likedSongs,
  };
  validateBackupJsonShape(data, 0, { remaining: MAX_BACKUP_VALUES });
  validateBackupContainers(data, true);
  const settings = sanitizeImportedSettings(data.settings);
  for (const key of SENSITIVE_SETTING_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(data.settings, key)) continue;
    settings[key] = boundedBackupString(data.settings[key], key, 16384);
  }
  return { ...data, settings };
}


async function loadMM() {
  mm = await import('music-metadata');
}

async function finishCloseAfterRendererFlush() {
  if (closeFinishInProgress) return;
  closeFinishInProgress = true;
  if (quitFlushTimer) clearTimeout(quitFlushTimer);
  quitFlushTimer = null;
  quitFlushPending = false;
  const action = pendingCloseAction;
  pendingCloseAction = '';
  cancelAutomaticBackupSchedule();
  if (action === 'quit') {
    cancelActiveDownloadProcesses();
    try { await waitForActiveDownloadProcesses(); }
    catch (e) { console.error('Failed to stop active downloads before close:', e); }
    try { await waitForMetadataWrites(); }
    catch (e) { console.error('Failed to finish metadata writes before close:', e); }
  }
  try { await waitForActiveBackupOperation(); }
  catch (e) { console.error('Failed to finish active backup before close:', e); }
  // Once the renderer has acknowledged its snapshot, queued atomic writes are
  // allowed to finish rather than being abandoned by a short shutdown timer.
  try { await waitForPendingDataWrites(); }
  catch (e) { console.error('Failed to finish pending data writes before close:', e); }
  if (action === 'close-window' && mainWindow && !mainWindow.isDestroyed()) {
    allowWindowClose = true;
    closeFinishInProgress = false;
    scheduleAutomaticBackup();
    mainWindow.close();
    return;
  }
  isQuitting = true;
  app.quit();
}

function requestRendererFlushBeforeClose(action) {
  if (quitFlushPending) { if (action === 'quit') pendingCloseAction = 'quit'; return; }
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    pendingCloseAction = action;
    finishCloseAfterRendererFlush();
    return;
  }
  quitFlushPending = true;
  pendingCloseAction = action;
  mainWindow.webContents.send('prepare-app-close');
  // A crashed renderer must not prevent closing forever, but a healthy
  // renderer gets enough time to flush a large playback/settings snapshot.
  quitFlushTimer = setTimeout(finishCloseAfterRendererFlush, RENDERER_CLOSE_FLUSH_TIMEOUT_MS);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    frame: appSettings.useNativeTitleBar === true,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    autoHideMenuBar: true,
    backgroundColor: '#070707'
  });

  const preventUntrustedNavigation = (event, url) => {
    const targetUrl = typeof url === 'string' ? url : event.url;
    if (targetUrl !== APP_ENTRY_URL) event.preventDefault();
  };
  mainWindow.webContents.on('will-navigate', preventUntrustedNavigation);
  mainWindow.webContents.on('will-frame-navigate', preventUntrustedNavigation);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat || input.key !== 'F12') return;
    event.preventDefault();
    mainWindow.webContents.toggleDevTools();
  });
  mainWindow.webContents.session.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(webContents === mainWindow.webContents && permission === 'notifications');
  });
  mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission) => {
    return webContents === mainWindow.webContents && permission === 'notifications';
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('close', (event) => {
    if (allowWindowClose) { allowWindowClose = false; return; }
    if (!isQuitting && appSettings.minimizeToTray && trayAvailable) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    if (!isQuitting) {
      event.preventDefault();
      requestRendererFlushBeforeClose(process.platform === 'darwin' ? 'close-window' : 'quit');
    }
  });
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendPlayerAction(action, detail) {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return false;
  try {
    mainWindow.webContents.send('thumbar-action', action, detail);
    return true;
  } catch (e) {
    console.log('Player integration action failed:', e && e.message ? e.message : e);
    return false;
  }
}

function getCurrentMprisTrackId() {
  if (!mprisPlayer || !mprisTrackKey) return '';
  return mprisPlayer.objectPath(`track/${mprisTrackId}`);
}

function initMprisPlayer() {
  if (process.platform !== 'linux' || mprisPlayer) return;
  try {
    const MprisService = require('mpris-service');
    mprisPlayer = MprisService({
      name: APP_ID,
      identity: APP_NAME,
      desktopEntry: APP_ID,
      supportedUriSchemes: ['file'],
      supportedMimeTypes: ['audio/mpeg', 'audio/flac', 'audio/mp4', 'audio/wav', 'audio/x-wav'],
      supportedInterfaces: ['player']
    });

    mprisPlayer.playbackStatus = 'Stopped';
    mprisPlayer.loopStatus = 'None';
    mprisPlayer.rate = 1;
    mprisPlayer.minimumRate = 1;
    mprisPlayer.maximumRate = 1;
    mprisPlayer.volume = 1;
    mprisPlayer.canControl = true;
    mprisPlayer.canPlay = true;
    mprisPlayer.canPause = true;
    mprisPlayer.canSeek = true;
    mprisPlayer.canGoNext = true;
    mprisPlayer.canGoPrevious = true;

    mprisPlayer.getPosition = function () {
      if (mprisPlayer.playbackStatus !== 'Playing') return Math.max(0, Math.floor(mprisPositionUs));
      const elapsedUs = Math.max(0, Date.now() - mprisPositionUpdatedAt) * 1000;
      const position = Math.max(0, Math.floor(mprisPositionUs + elapsedUs));
      return mprisDurationUs > 0 ? Math.min(position, mprisDurationUs) : position;
    };

    const onMpris = (name, handler) => mprisPlayer.on(name, (...args) => {
      try { handler(...args); }
      catch (e) { console.log(`MPRIS ${name} error:`, e && e.message ? e.message : e); }
    });
    onMpris('raise', showMainWindow);
    onMpris('quit', () => requestRendererFlushBeforeClose('quit'));
    onMpris('next', () => { mprisStopped = false; sendPlayerAction('next'); });
    onMpris('previous', () => { mprisStopped = false; sendPlayerAction('prev'); });
    onMpris('playpause', () => { mprisStopped = false; sendPlayerAction('playpause'); });
    onMpris('play', () => { mprisStopped = false; sendPlayerAction('play'); });
    onMpris('pause', () => { if (!mprisStopped) sendPlayerAction('pause'); });
    onMpris('stop', () => {
      mprisStopped = true;
      mprisPositionUs = 0;
      mprisPositionUpdatedAt = Date.now();
      sendPlayerAction('pause');
      sendPlayerAction('set-position', 0);
      mprisPlayer.playbackStatus = 'Stopped';
      try { mprisPlayer.seeked(0); } catch (_) { }
    });
    onMpris('seek', (offset) => {
      if (!mprisTrackKey || !Number.isFinite(offset)) return;
      sendPlayerAction('seek', Math.trunc(offset));
    });
    onMpris('position', (event) => {
      const position = event && Number(event.position);
      if (!event || String(event.trackId || '') !== getCurrentMprisTrackId() || !Number.isFinite(position) || position < 0) return;
      sendPlayerAction('set-position', Math.trunc(mprisDurationUs > 0 ? Math.min(position, mprisDurationUs) : position));
    });
    onMpris('shuffle', (enabled) => {
      const requested = enabled === true;
      mprisPlayer.shuffle = requested;
      sendPlayerAction('set-shuffle', requested);
    });
    onMpris('loopStatus', (status) => {
      if (!['None', 'Playlist', 'Track'].includes(status)) return;
      mprisPlayer.loopStatus = status;
      sendPlayerAction('set-loop-status', status);
    });
    onMpris('volume', (volume) => {
      if (!Number.isFinite(volume)) return;
      const safeVolume = Math.max(0, Math.min(1, volume));
      mprisPlayer.volume = safeVolume;
      sendPlayerAction('volume', safeVolume);
    });
    mprisPlayer.on('error', (err) => console.log('MPRIS error:', err && err.message ? err.message : err));
  } catch (e) {
    mprisPlayer = null;
    console.log('MPRIS unavailable:', e && e.message ? e.message : e);
  }
}

function updateMpris(payload) {
  try {
    return updateMprisInner(payload);
  } catch (e) {
    // D-Bus property setters can throw; a position tick must never crash the app
    console.log('MPRIS update error:', e && e.message ? e.message : e);
    return false;
  }
}

function updateMprisInner(payload) {
  if (!mprisPlayer || !payload || typeof payload !== 'object') return false;
  const hasTrack = !!payload.title;
  if (payload.isPlaying) mprisStopped = false;
  const status = hasTrack ? (payload.isPlaying ? 'Playing' : (mprisStopped ? 'Stopped' : 'Paused')) : 'Stopped';
  const rawPositionSeconds = Number(payload.positionSeconds || 0);
  const rawDurationSeconds = Number(payload.durationSeconds || 0);
  const positionSeconds = Number.isFinite(rawPositionSeconds) ? Math.max(0, rawPositionSeconds) : 0;
  const durationSeconds = Number.isFinite(rawDurationSeconds) ? Math.max(0, rawDurationSeconds) : 0;
  const trackKey = String(payload.filePath || `${payload.title || ''}::${payload.artist || ''}::${payload.album || ''}`);

  if (hasTrack && trackKey !== mprisTrackKey) {
    mprisTrackKey = trackKey;
    mprisTrackId++;
    if (payload.isPlaying) mprisStopped = false;
  }

  mprisPositionUs = Math.max(0, Math.floor(positionSeconds * 1000000));
  mprisDurationUs = Math.max(0, Math.floor(durationSeconds * 1000000));
  if (mprisDurationUs > 0) mprisPositionUs = Math.min(mprisPositionUs, mprisDurationUs);
  mprisPositionUpdatedAt = Date.now();
  mprisPlayer.playbackStatus = status;
  mprisPlayer.shuffle = !!payload.shuffle;
  mprisPlayer.loopStatus = payload.loopStatus || 'None';
  mprisPlayer.canSeek = durationSeconds > 0;
  mprisPlayer.volume = typeof payload.volume === 'number' ? payload.volume : mprisPlayer.volume;

  if (!hasTrack) {
    mprisTrackKey = '';
    mprisDurationUs = 0;
    mprisStopped = true;
    mprisPlayer.metadata = {};
    return true;
  }

  const metadata = {
    'mpris:trackid': getCurrentMprisTrackId(),
    'xesam:title': String(payload.title || 'Unknown Track'),
    'xesam:artist': [String(payload.artist || 'Unknown Artist')],
  };
  if (payload.album) metadata['xesam:album'] = String(payload.album);
  if (durationSeconds > 0) metadata['mpris:length'] = Math.floor(durationSeconds * 1000000);
  if (payload.artUrl) metadata['mpris:artUrl'] = String(payload.artUrl);
  if (payload.fileUrl) metadata['xesam:url'] = String(payload.fileUrl);
  mprisPlayer.metadata = metadata;
  if (payload.seeked) {
    try { mprisPlayer.seeked(mprisPositionUs); } catch (e) { }
  }
  return true;
}

async function reconcileDiscordRuntime(enabled) {
  const warnings = [];
  if (enabled) {
    await discordConnect();
    if (discordLastError) warnings.push(`Discord RPC could not be enabled: ${discordLastError}`);
    return warnings;
  }
  try {
    if (!(await discordClear())) warnings.push(`Discord RPC activity could not be cleared: ${discordLastError || 'unknown error'}`);
  } catch (e) { warnings.push(`Discord RPC activity could not be cleared: ${e.message || e}`); }
  if (discordClient) {
    try { await Promise.resolve(discordClient.destroy()); }
    catch (e) { warnings.push(`Discord RPC could not be disconnected: ${e.message || e}`); }
  }
  discordClient = null;
  discordEnabled = false;
  return warnings;
}

async function reconcileRestoredRuntime(settings) {
  const warnings = [];
  try { warnings.push(...await reconcileDiscordRuntime(settings.discordRpc === true)); }
  catch (e) { warnings.push(`Discord RPC runtime update failed: ${e.message || e}`); }
  return warnings;
}

if (gotSingleInstanceLock) {
app.on('second-instance', () => {
  showMainWindow();
});

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.playerinyo.playerinyo');
  Menu.setApplicationMenu(null);
  try { await recoverInterruptedDataTransaction(); }
  catch (e) {
    dialog.showErrorBox('Playerinyo Recovery Failed', 'A previous backup restore could not be recovered safely. Playerinyo will close without loading potentially mixed data.\n\n' + (e.message || String(e)));
    app.quit();
    return;
  }
  lastfmDebug('startup-paths', { userDataPath: app.getPath('userData'), settingsPath: SETTINGS_FILE, encryptionAvailable: safeStorage.isEncryptionAvailable(), safeStorageBackend: typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : '', secureStorageAvailable: isSecureStorageAvailable() });
  loadSettingsFromDisk();
  const startupDownloadRoot = normalizePathInput(appSettings.ytdlDownloadFolder || '');
  if (startupDownloadRoot && path.isAbsolute(startupDownloadRoot)) {
    cleanupStaleDownloadArtifacts(startupDownloadRoot).catch((error) => console.warn('Could not clean stale download artifacts:', error.message || error));
  }
  loadAutomaticBackupStatusFromDisk();
  await loadMM();
  initializeRadioStreamResolver();
  registerRadioStreamProtocol();
  createWindow();
  initMprisPlayer();

  try {
    const icon = nativeImage.createFromPath(APP_ICON);
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
      { label: `Show ${APP_NAME}`, click: () => mainWindow.show() },
      {
        label: 'Quit', click: () => {
          requestRendererFlushBeforeClose('quit');
        }
      }
    ]);
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(contextMenu);
    tray.on('click', () => mainWindow.show());
    trayAvailable = true;
  } catch (e) {
    trayAvailable = false;
    console.log("Tray init error:", e);
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

}).catch((e) => handleFatalProcessError('Fatal startup error', e));
}

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (quitWriteDrainInProgress) return;
  quitWriteDrainInProgress = true;
  for (const key of Array.from(activeRadioResolverRequests)) cancelRadioResolverRequest(key.replace(/^radio_/, ''));
  cancelActiveDownloadProcesses();
  if (radioStreamResolver) radioStreamResolver.clear();
  event.preventDefault();
  // Window-all-closed and OS quit paths do not necessarily pass through the
  // renderer close handshake. Drain the bounded known-index write too.
  Promise.resolve()
    .then(() => knownTrackIndexWriteDrainer.drain())
    .then(() => waitForActiveDownloadProcesses())
    .then(() => waitForMetadataWrites())
    .then(() => waitForPendingDataWrites())
    .catch((error) => console.error('Failed to drain data writes before quit:', error))
    .finally(() => app.exit(0));
});

// IPC Handler: Open Folder
registerIpcHandler('open-external', async (event, url) => {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || !EXTERNAL_URL_HOSTS.has(parsed.hostname.toLowerCase())) return false;
    await shell.openExternal(parsed.href);
    return true;
  } catch (e) {
    return false;
  }
});

registerIpcHandler('show-item-in-folder', async (event, fullPath) => {
  fullPath = normalizePathInput(fullPath);
  if (!isManagedLibraryAudioFile(fullPath)) return false;
  shell.showItemInFolder(fullPath);
  return true;
});

registerIpcHandler('window-control', async (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (action === 'minimize') win.minimize();
  else if (action === 'toggle-maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
  else return false;
  return true;
});

registerIpcListener('renderer-close-ready', (event) => {
  if (!quitFlushPending || !mainWindow || event.sender !== mainWindow.webContents) return;
  finishCloseAfterRendererFlush();
});

registerIpcListener('mpris-update', (event, payload) => {
  updateMpris(payload);
});

// Renderer resolution contains the local-library check.  Relay only the
// bounded, allow-listed diagnostic shape so the terminal trace covers it too.
registerIpcListener('radio-debug-event', (event, payload) => {
  if (!RADIO_DEBUG_ENABLED || !payload || typeof payload !== 'object') return;
  const stage = radioDebugText(payload.stage, 80);
  const allowed = new Set(['resolution-start', 'candidate', 'resolve-dispatch', 'resolve-return', 'local-resolve', 'resolution-metrics', 'playable-conversion', 'fill-summary']);
  if (!allowed.has(stage)) return;
  const fields = payload.fields && typeof payload.fields === 'object' ? payload.fields : {};
  const safe = {};
  ['stationId', 'candidateId', 'artist', 'title', 'itemKind', 'providerId', 'playbackKind', 'result', 'reason'].forEach((key) => {
    if (fields[key] !== undefined) safe[key] = radioDebugText(fields[key], key === 'candidateId' ? 420 : 240);
  });
  ['candidateBacklogSize', 'candidatesReceived', 'candidatesConsumed', 'localMatches', 'youtubeSearches', 'youtubeAccepted', 'rejected', 'playableCount', 'youtubeSearchMs', 'flatSearchMs', 'flatSearchCount', 'detailedExtractionCount', 'shortlistSize', 'rateLimitTrips', 'ytDlpSearches', 'matcherMs'].forEach((key) => {
    if (fields[key] !== undefined) safe[key] = Math.max(0, Math.min(100000, Number(fields[key]) || 0));
  });
  ['matched', 'hasResolver', 'acceptedByController', 'providerExhausted', 'hasVideoId', 'cached'].forEach((key) => {
    if (fields[key] !== undefined) safe[key] = fields[key] === true;
  });
  radioDebug(stage, safe);
});

registerIpcHandler('dialog:openFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (canceled) {
    return null;
  } else {
    return filePaths[0];
  }
});

registerIpcHandler('get-default-download-folder', () => getDefaultDownloadFolder());

registerIpcHandler('check-ytdlp-tools', async () => {
  const ytdlp = await runProcess('yt-dlp', ['--version'], { timeoutMs: 8000 });
  const ffmpeg = await runProcess('ffmpeg', ['-version'], { timeoutMs: 8000 });
  // `ffmpeg -version` output starts with "ffmpeg version N.N ..." — grab the actual version token
  const ffmpegVersionMatch = (ffmpeg.stdout || '').match(/version\s+(\S+)/);
  return {
    ytdlp: ytdlp.ok ? (ytdlp.stdout || '').trim().split(/\s+/)[0] : '',
    ffmpeg: ffmpeg.ok ? (ffmpegVersionMatch ? ffmpegVersionMatch[1] : 'installed') : '',
    ok: ytdlp.ok && ffmpeg.ok,
    error: !ytdlp.ok ? 'yt-dlp was not found in PATH.' : (!ffmpeg.ok ? 'ffmpeg was not found in PATH.' : '')
  };
});

registerIpcHandler('check-for-app-update', async () => {
  const currentVersion = app.getVersion();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(RELEASES_API_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': APP_USER_AGENT },
      signal: controller.signal,
    });
    if (response.status === 404) return { available: false, currentVersion, latestVersion: '' };
    if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
    const release = await response.json();
    const latestVersion = typeof release.tag_name === 'string' ? release.tag_name.slice(0, 80) : '';
    return { available: isNewerReleaseVersion(currentVersion, latestVersion), currentVersion, latestVersion };
  } catch (error) {
    return { available: false, currentVersion, latestVersion: '', error: error && error.name === 'AbortError' ? 'Update check timed out.' : 'Could not check for updates.' };
  } finally {
    clearTimeout(timeout);
  }
});

registerIpcHandler('search-download-candidates', async (event, track, limit, requestId) => {
  try {
    const directQuery = track && typeof track === 'object' ? String(track.searchQuery || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500) : '';
    const requestIdSupplied = requestId !== undefined && requestId !== null && String(requestId) !== '';
    requestId = requestIdSupplied ? String(requestId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80) : '';
    if (requestIdSupplied && !requestId) return { ok: false, error: 'Invalid download search request ID.', candidates: [] };
    if (requestId && (reservedDownloadRequestIds.has(requestId) || activeYtdlpDownloads.has(requestId))) {
      return { ok: false, error: 'A download operation with this request ID is already active.', candidates: [] };
    }
    const max = Math.max(1, Math.min(10, parseInt(limit, 10) || 5));
    if (directQuery) return await searchDownloadCandidatesByQuery(directQuery, max, requestId);
    const meta = normalizeImportTrackMeta(track);
    if (!meta.title || !meta.artist) return { ok: false, error: 'Track title and artist are required.', candidates: [] };
    const cacheKey = getDownloadSearchCacheKey(meta, max);
    const cached = getFreshEntry(downloadSearchCache, cacheKey, Date.now(), DOWNLOAD_SEARCH_CACHE_TTL_MS);
    if (cached) return { ...cached.result, cached: true };
    if (!requestId && downloadSearchInFlight.has(cacheKey)) return await downloadSearchInFlight.get(cacheKey);

    const searchPromise = searchDownloadCandidates(meta, max, requestId)
      .then((result) => {
        if (result && result.ok) setBoundedEntry(downloadSearchCache, cacheKey, { createdAt: Date.now(), result }, { ttlMs: DOWNLOAD_SEARCH_CACHE_TTL_MS, maxEntries: MAX_DOWNLOAD_SEARCH_CACHE_ENTRIES });
        return result;
      })
      .finally(() => { if (!requestId) downloadSearchInFlight.delete(cacheKey); });
    if (!requestId) downloadSearchInFlight.set(cacheKey, searchPromise);
    return await searchPromise;
  } catch (e) {
    return { ok: false, error: e.message || String(e), candidates: [] };
  }
});

async function searchDownloadCandidatesByQuery(query, max, requestId) {
  try {
    if (query.length < 2) return { ok: false, error: 'Enter at least two characters to search.', candidates: [] };
    const result = await runProcess('yt-dlp', [
      '--ignore-config', '--dump-json', '--flat-playlist', '--skip-download', '--no-playlist', `ytsearch${max}:${query}`
    ], { timeoutMs: 2 * 60 * 1000, processKey: requestId });
    const seen = new Set();
    const candidates = result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map((line) => {
      try { return JSON.parse(line); } catch (e) { return null; }
    }).filter((item) => {
      const id = String(item && item.id || '');
      if (!/^[A-Za-z0-9_-]{11}$/.test(id) || seen.has(id)) return false;
      seen.add(id); return true;
    }).map((item) => {
      const thumbnails = Array.isArray(item.thumbnails) ? item.thumbnails : [];
      return {
        id: item.id,
        title: String(item.title || '').slice(0, 1000),
        uploader: String(item.uploader || item.channel || '').slice(0, 1000),
        duration: parseDurationSeconds(item.duration || item.duration_string || 0),
        thumbnail: (thumbnails.length ? thumbnails[thumbnails.length - 1].url : (item.thumbnail || '')) || ''
      };
    }).slice(0, max);
    if (result.cancelled) return { ok: false, cancelled: true, error: 'Download search cancelled.', candidates: [] };
    if (!result.ok && !candidates.length) return { ok: false, error: formatYtdlpError(result.stderr || result.stdout, 'yt-dlp search failed.'), candidates: [] };
    return { ok: true, candidates };
  } catch (e) {
    return { ok: false, error: e.message || String(e), candidates: [] };
  }
}

async function searchDownloadCandidates(meta, max, requestId) {
  try {
    const perQuery = Math.max(4, Math.min(5, max));
    const queries = buildDownloadSearchQueries(meta);
    const result = await runProcess('yt-dlp', [
      '--ignore-config',
      '--dump-json',
      '--flat-playlist',
      '--skip-download',
      '--no-playlist',
      ...queries.map(query => `ytsearch${perQuery}:${query}`)
    ], { timeoutMs: 2 * 60 * 1000, processKey: requestId });
    const candidateMap = new Map();
    result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach((line) => {
      let item = null;
      try { item = JSON.parse(line); }
      catch (e) { return; }
      const thumbnails = Array.isArray(item.thumbnails) ? item.thumbnails : [];
      const bestThumb = thumbnails.length ? thumbnails[thumbnails.length - 1].url : (item.thumbnail || '');
      const candidate = {
        id: item.id || '',
        title: item.title || '',
        uploader: item.uploader || item.channel || '',
        channel: item.channel || item.uploader || '',
        duration: parseDurationSeconds(item.duration || item.duration_string || 0),
        webpageUrl: item.webpage_url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : (item.original_url || item.url || '')),
        thumbnail: bestThumb || '',
        channelVerified: item.channel_is_verified === true,
      };
      const key = candidate.id || candidate.webpageUrl || normalizeSearchText(`${candidate.title} ${candidate.uploader}`);
      if (!key) return;
      candidate.score = downloadCandidateScore(meta, candidate);
      const existing = candidateMap.get(key);
      if (existing) {
        existing.score = Math.max(existing.score, candidate.score);
        existing.seen = (existing.seen || 1) + 1;
        if (!existing.thumbnail && candidate.thumbnail) existing.thumbnail = candidate.thumbnail;
        if (!existing.duration && candidate.duration) existing.duration = candidate.duration;
      } else {
        candidate.seen = 1;
        candidateMap.set(key, candidate);
      }
    });
    const candidates = Array.from(candidateMap.values()).map((candidate) => {
      if (candidate.seen > 1) candidate.score += Math.min(16, (candidate.seen - 1) * 4);
      candidate.confidence = candidateConfidence(candidate.score);
      return candidate;
    }).sort((a, b) => b.score - a.score).slice(0, max);
    if (result.cancelled) return { ok: false, cancelled: true, error: 'Download candidate search cancelled.', candidates: [] };
    if (!result.ok && !candidates.length) {
      return { ok: false, error: formatYtdlpError(result.stderr || result.stdout, 'yt-dlp search failed.'), candidates: [] };
    }
    return { ok: true, queries, candidates };
  } catch (e) {
    return { ok: false, error: e.message || String(e), candidates: [] };
  }
}

function getSafeYtdlpDownloadSource(meta) {
  if (/^[A-Za-z0-9_-]{11}$/.test(String(meta.videoId || ''))) return `https://www.youtube.com/watch?v=${meta.videoId}`;
  if (!meta.downloadUrl) {
    const query = buildDownloadSearchQueries(meta)[0] || `${meta.artist} ${meta.title}`;
    return `ytsearch1:${query.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 1000)}`;
  }
  try {
    const parsed = new URL(String(meta.downloadUrl));
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    if (!['youtube.com', 'www.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host)) return '';
    return parsed.href.slice(0, 2000);
  } catch (e) {
    return '';
  }
}

registerIpcHandler('download-playlist-track', async (event, track, downloadRoot, requestId) => {
  const reservedHere = [];
  let tempDir = '';
  let finalizedPath = '';
  try {
    if (backupRestoreInProgress || movedFileRelinkCommitInProgress) return { ok: false, error: 'App-data maintenance is in progress.' };
    const meta = normalizeImportTrackMeta(track);
    if (!meta.title || !meta.artist) return { ok: false, error: 'Track title and artist are required.' };
    requestId = String(requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    if (!requestId) return { ok: false, error: 'Invalid download request ID.' };
    if (reservedDownloadRequestIds.has(requestId) || activeYtdlpDownloads.has(requestId)) return { ok: false, error: 'A download with this request ID is already active.' };
    reservedDownloadRequestIds.add(requestId);
    const canonicalMeta = await resolveCanonicalDownloadMetadata(meta);
    // Keep the original request-only fields (URL and quality) while ensuring
    // path, container tags, and ingest all share the same canonical values.
    const canonicalTrack = { ...(track || {}), ...canonicalMeta };
    const source = getSafeYtdlpDownloadSource(canonicalMeta);
    if (!source) return { ok: false, error: 'Only HTTPS YouTube download URLs are supported.' };
    const rootInput = normalizePathInput(downloadRoot) || getDefaultDownloadFolder();
    if (!path.isAbsolute(rootInput)) return { ok: false, error: 'Download folder must be an absolute path.' };
    const root = path.resolve(rootInput);
    await fs.promises.mkdir(root, { recursive: true });
    await ensureSafeDownloadDirectory(root, root);
    const tempRoot = path.join(root, '.downloading');
    await ensureSafeDownloadDirectory(root, tempRoot);
    cleanupStaleDownloadTempDirs(root).catch(() => { });
    tempDir = path.join(tempRoot, `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    await ensureSafeDownloadDirectory(root, tempDir);
    // Native modes deliberately omit -x: yt-dlp copies the selected audio
    // stream instead of asking ffmpeg to decode and lossy re-encode it.
    const quality = ['best-native', 'opus', 'm4a', 'mp3'].includes(track && track.downloadQuality) ? track.downloadQuality : 'best-native';
    const formatSelector = quality === 'opus' ? 'bestaudio[acodec=opus]/bestaudio' : (quality === 'm4a' ? 'bestaudio[ext=m4a]/bestaudio' : 'bestaudio/best');
    const args = [
      '--ignore-config',
      '--no-playlist',
      '--format', formatSelector,
      ...(quality === 'mp3' ? ['--extract-audio', '--audio-format', 'mp3'] : []),
      '--output', path.join(tempDir, 'download.%(ext)s'),
      ...getYtdlpAuthArgs(),
      '--',
      source
    ];
    const sendProgress = (chunk) => {
      if (!requestId || !event.sender || event.sender.isDestroyed()) return;
      const matches = String(chunk || '').matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g);
      let last = null;
      for (const match of matches) last = Number(match[1]);
      if (last !== null && !Number.isNaN(last)) {
        try { event.sender.send('download-progress', { requestId, percent: last }); } catch (_) { }
      }
    };
    const result = await runProcess('yt-dlp', args, { timeoutMs: 10 * 60 * 1000, processKey: requestId, onStdout: sendProgress, onStderr: sendProgress });
    if (result.cancelled) {
      try { await fs.promises.rm(tempDir, { recursive: true, force: true }); } catch (e) { }
      return { ok: false, cancelled: true, error: 'Download cancelled.' };
    }
    if (!result.ok) {
      try { await fs.promises.rm(tempDir, { recursive: true, force: true }); } catch (e) { }
      return { ok: false, error: formatYtdlpError(result.stderr || result.stdout, 'yt-dlp failed.'), ageRestricted: isYtdlpAgeRestrictedError(result.stderr || result.stdout) };
    }

    const tempFiles = await fs.promises.readdir(tempDir, { withFileTypes: true });
    const audioFile = tempFiles.find(file => file.isFile() && !file.isSymbolicLink() && AUDIO_EXTENSIONS.includes(path.extname(file.name).toLowerCase()));
    if (!audioFile) {
      try { await fs.promises.rm(tempDir, { recursive: true, force: true }); } catch (e) { }
      return { ok: false, error: 'yt-dlp finished, but no supported audio file was created.' };
    }
    let downloadedFile = path.join(tempDir, audioFile.name);
    let extension = path.extname(audioFile.name).toLowerCase();
    // WebM is a fine playback container, but Ogg Opus gives the native
    // download a standard Vorbis-comment metadata home. This is a stream-copy
    // remux: ffmpeg never decodes or re-encodes the Opus audio packets.
    if (extension === '.webm') {
      const sourceMetadata = await mm.parseFile(downloadedFile, { duration: false, skipCovers: true }).catch(() => null);
      if (sourceMetadata && /opus/i.test(String(sourceMetadata.format && sourceMetadata.format.codec || ''))) {
        const remuxed = path.join(tempDir, 'download.opus');
        await remuxWebmOpusToOpus(downloadedFile, remuxed, requestId);
        await fs.promises.unlink(downloadedFile).catch(() => { });
        downloadedFile = remuxed;
        extension = '.opus';
      }
    }
    const targetFilename = path.basename(buildDownloadTargetPath(canonicalTrack, root, extension));
    const canonicalAlbumDir = await resolveCanonicalDownloadAlbumDirectory(canonicalTrack, root);
    let targetPath = await ensureUniquePath(path.join(canonicalAlbumDir, targetFilename), reservedDownloadPaths);
    reservedDownloadPaths.add(targetPath); reservedHere.push(targetPath);
    const albumDir = path.dirname(targetPath);
    let albumDirWasMissing = false;
    try { await fs.promises.lstat(albumDir); }
    catch (e) { if (e.code === 'ENOENT') albumDirWasMissing = true; else throw e; }
    await ensureSafeDownloadDirectory(root, albumDir);
    cleanupStaleDownloadPartialFiles(albumDir).catch(() => { });
    if (albumDirWasMissing) downloadCreatedAlbumDirs.add(albumDir);
    while (true) {
      try {
        await ensureSafeDownloadDirectory(root, path.dirname(targetPath));
        await finalizeDownloadedFile(downloadedFile, targetPath);
        finalizedPath = targetPath;
        break;
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
        targetPath = await ensureUniquePath(targetPath, reservedDownloadPaths);
        reservedDownloadPaths.add(targetPath); reservedHere.push(targetPath);
      }
    }
    try { await fs.promises.rm(tempDir, { recursive: true, force: true }); } catch (e) { }

    // Canonical Radio/candidate metadata wins over upload title/channel text.
    // Each writer below changes container metadata only; audio stays bit-for-bit
    // stream copied for native formats.
    if (extension === '.mp3') await writeDownloadedMp3Metadata(targetPath, canonicalTrack, downloadCreatedAlbumDirs.has(albumDir));
    else if (['.opus', '.ogg', '.m4a'].includes(extension)) {
      await updateStreamCopyMetadata(targetPath, buildCanonicalDownloadTags(canonicalTrack));
      await writeDownloadedArtworkSidecar(targetPath, canonicalTrack, downloadCreatedAlbumDirs.has(albumDir));
    }
    const libraryItem = await buildLibraryItemFromAudioFile(targetPath);
    if (!libraryItem) throw new Error('Downloaded file metadata could not be added to the library');
    const recoveryId = String(track && track.__downloadRecoveryKey || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 160);
    if (recoveryId) await addDownloadRecoveryRecord({ id: recoveryId, libraryItem, canonicalMetadata: {
      title: canonicalMeta.title, artist: canonicalMeta.artist, album: canonicalMeta.album,
      albumArtist: canonicalMeta.albumArtist, duration: canonicalMeta.duration
    }, createdAtMs: Date.now() });
    if (requestId && event.sender && !event.sender.isDestroyed()) {
      try { event.sender.send('download-progress', { requestId, percent: 100 }); } catch (_) { }
    }
    return {
      ok: true, filePath: targetPath, libraryItem, recoveryId, targetPath, quality,
      container: extension.slice(1),
      codec: String(libraryItem.codec || (quality === 'mp3' ? 'mp3' : '')).slice(0, 120),
      canonicalMetadata: {
        title: canonicalMeta.title,
        artist: canonicalMeta.artist,
        album: canonicalMeta.album,
        albumArtist: canonicalMeta.albumArtist,
        duration: canonicalMeta.duration,
      }
    };
  } catch (e) {
    if (finalizedPath) await fs.promises.rm(finalizedPath, { force: true }).catch((cleanupError) => console.error('Could not remove failed finalized download:', cleanupError));
    return { ok: false, error: e.message || String(e) };
  } finally {
    if (tempDir) await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => { });
    for (const p of reservedHere) reservedDownloadPaths.delete(p);
    if (requestId) reservedDownloadRequestIds.delete(requestId);
  }
});

registerIpcHandler('cancel-download', async (event, requestId) => {
  requestId = String(requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!requestId) return false;
  const child = activeYtdlpDownloads.get(requestId);
  if (!child) return false;
  cancelledYtdlpDownloads.add(requestId);
  try {
    if (child.kill('SIGTERM')) return true;
  } catch (e) { }
  cancelledYtdlpDownloads.delete(requestId);
  return false;
});

function sanitizeRadioCandidate(value) {
  const source = value && typeof value === 'object' ? value : {};
  const text = (field, max) => String(source[field] || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  const candidateId = text('candidateId', 420) || text('id', 420);
  const title = text('title', 1000); const artist = text('artist', 1000);
  if (!candidateId || !title || !artist) return null;
  return { candidateId, trackMbid: text('trackMbid', 80), title, artist, album: text('album', 1000), duration: Math.max(0, Math.min(7 * 24 * 60 * 60, Number(source.duration) || 0)), radioDebug: source.radioDebug === true };
}

function sanitizeRadioLeaseOwnership(value) {
  const source = value && typeof value === 'object' ? value : {};
  const text = (field, max) => String(source[field] || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max);
  const stationId = text('stationId', 160); const queueEntryId = text('queueEntryId', 160); const generation = Number(source.generation);
  if (!stationId || !queueEntryId || !Number.isInteger(generation) || generation < 0 || generation > Number.MAX_SAFE_INTEGER) return null;
  return { stationId, queueEntryId, generation };
}

registerIpcHandler('resolve-radio-candidate', async (event, candidate, requestId, preferences) => {
  const safeCandidate = sanitizeRadioCandidate(candidate);
  if (!safeCandidate || !radioStreamResolver) return null;
  const safeRequestId = String(requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  const debugRequest = { ...safeCandidate, searches: 0 };
  radioDebugRequests.set(safeRequestId, debugRequest);
  let resolved;
  try { resolved = await radioStreamResolver.resolveCandidate(safeCandidate, requestId, sanitizeRadioPreferencesForSettings(preferences)); }
  finally { radioDebugRequests.delete(safeRequestId); }
  if (resolved && debugRequest.radioDebug) radioDebug('youtube-match', { requestId: safeRequestId, accepted: true, score: Number(resolved.confidence) || 0, reason: resolved.cached ? 'cache-hit' : 'matched', videoId: resolved.videoId || '' });
  if (!resolved || !/^[A-Za-z0-9_-]{11}$/.test(resolved.videoId || '')) return { videoId: '', rateLimited: !!(resolved && resolved.rateLimited), debugSearchCount: debugRequest.searches, debugMetrics: resolved && resolved.metrics || null };
  return { videoId: resolved.videoId, confidence: Number(resolved.confidence) || 0, cached: resolved.cached === true, debugSearchCount: debugRequest.searches, debugMetrics: resolved.metrics || null };
});

registerIpcHandler('prepare-radio-playback', async (event, videoId, ownership, requestId) => {
  const safeOwnership = sanitizeRadioLeaseOwnership(ownership);
  if (!radioStreamResolver || !safeOwnership || !/^[A-Za-z0-9_-]{11}$/.test(String(videoId || ''))) throw new Error('Invalid radio playback request.');
  return radioStreamResolver.prepare(String(videoId), safeOwnership, requestId);
});

registerIpcHandler('cancel-radio-resolver-request', async (event, requestId) => cancelRadioResolverRequest(requestId));
registerIpcHandler('release-radio-playback', async (event, leaseId) => radioStreamResolver ? radioStreamResolver.release(String(leaseId || '')) : false);
registerIpcHandler('get-radio-resolver-status', async () => ({ available: !!radioStreamResolver, activeRequests: activeRadioResolverRequests.size }));

// Playlist import uses one narrow picker; parsing and path resolution stay in main.
registerIpcHandler('import-playlist', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Playlist Files', extensions: ['csv', 'm3u', 'm3u8'] },
      { name: 'CSV', extensions: ['csv'] },
      { name: 'M3U Playlists', extensions: ['m3u', 'm3u8'] },
    ]
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
  return parsePlaylistImportFile(filePaths[0]);
});

registerIpcHandler('dialog:openCookiesFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Cookies', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return canceled ? null : filePaths[0];
});

// IPC Handler: Open Image File (for custom playlist cover)
registerIpcHandler('dialog:openImage', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff', 'tif', 'gif', 'avif'] }]
  });
  return canceled ? null : getSafeFileUrl(filePaths[0]);
});

// IPC Handler: Open Audio File (for manual match)
registerIpcHandler('dialog:openAudio', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a'] }]
  });
  return canceled ? null : filePaths[0];
});

registerIpcHandler('scan-audio-file', async (event, filePath) => {
  filePath = normalizePathInput(filePath);
  if (!isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) return null;
  try {
    const item = await buildLibraryItemFromAudioFile(filePath);
    if (item) item.addedAtMs = Date.now();
    return item;
  }
  catch (e) { console.error('Failed to scan audio file:', e); return null; }
});

async function walkDir(dir, supportedExtensions, fileList, failures) {
  let files;
  try {
    files = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
      console.warn('Skipping missing directory:', dir);
    } else {
      console.error('Error reading directory', dir, e);
    }
    if (failures && failures.length < 100) failures.push({ path: dir, error: e && (e.code || e.message) ? (e.code || e.message) : String(e) });
    return;
  }
  for (const file of files) {
    if (file.isSymbolicLink()) continue;
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      await walkDir(fullPath, supportedExtensions, fileList, failures);
    } else {
      const ext = path.extname(file.name).toLowerCase();
      if (supportedExtensions.includes(ext)) {
        if (fileList.length >= MAX_SCAN_AUDIO_FILES) {
          const error = new Error(`Folder contains more than the ${MAX_SCAN_AUDIO_FILES} audio-file scan limit`);
          error.code = 'AUDIO_SCAN_LIMIT';
          throw error;
        }
        fileList.push(fullPath);
      }
    }
  }
}

function isPathWithin(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function sendScanProgress(event, payload) {
  try {
    if (event.sender && !event.sender.isDestroyed()) event.sender.send('scan-progress', payload);
  } catch (_) { }
}

function finishFolderScan(event, files, failures, totalFiles) {
  const warnings = failures.slice(0, 100).map(failure => `${failure.path}: ${failure.error}`);
  files.warnings = warnings;
  files.partial = failures.length > 0;
  if (failures.length) {
    sendScanProgress(event, { current: totalFiles, total: totalFiles, partial: true, warnings });
    const details = warnings.slice(0, 8).map(warning => `- ${warning}`).join('\n');
    const more = failures.length > 8 ? `\n...and ${failures.length - 8} more.` : '';
    const options = {
      type: 'warning',
      title: 'Library Scan Incomplete',
      message: 'Some folders or files could not be scanned. Existing library entries were preserved.',
      detail: details + more,
    };
    const message = mainWindow && !mainWindow.isDestroyed() ? dialog.showMessageBox(mainWindow, options) : dialog.showMessageBox(options);
    message.catch((e) => console.warn('Could not show scan warning:', e));
  }
  return files;
}

const folderCoverCache = new Map();
const MAX_FOLDER_COVER_CACHE_ENTRIES = 500;

function rememberFolderCover(dirPath, value) {
  folderCoverCache.delete(dirPath);
  folderCoverCache.set(dirPath, value);
  while (folderCoverCache.size > MAX_FOLDER_COVER_CACHE_ENTRIES) folderCoverCache.delete(folderCoverCache.keys().next().value);
  return value;
}
function invalidateFolderCover(dirPath) {
  folderCoverCache.delete(dirPath);
}

async function findFallbackCover(dirPath) {
  if (folderCoverCache.has(dirPath)) {
    var cached = folderCoverCache.get(dirPath);
    // Refresh recency so frequently viewed albums retain their cache entry.
    return rememberFolderCover(dirPath, cached);
  }
  // Priority names first, then any image in folder
  const priorityNames = [
    'folder.jpg', 'folder.jpeg', 'cover.jpg', 'cover.jpeg', 'front.jpg', 'front.jpeg',
    'folder.png', 'cover.png', 'folder.bmp', 'cover.bmp', 'folder.webp', 'cover.webp'
  ];
  const extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff', '.tif', '.gif', '.avif'];
  try {
    const files = await fs.promises.readdir(dirPath);
    const filesLower = files.map(f => f.toLowerCase());
    // Check priority names first
    for (const name of priorityNames) {
      const idx = filesLower.indexOf(name);
      if (idx !== -1) {
        const coverPath = path.join(dirPath, files[idx]);
        const fileUrl = getSafeFileUrl(coverPath);
        return rememberFolderCover(dirPath, fileUrl);
      }
    }
    // Then any image
    for (const file of files) {
      if (extensions.includes(path.extname(file).toLowerCase())) {
        const coverPath = path.join(dirPath, file);
        const fileUrl = getSafeFileUrl(coverPath);
        return rememberFolderCover(dirPath, fileUrl);
      }
    }
  } catch (e) {
    return rememberFolderCover(dirPath, null);
  }
  return rememberFolderCover(dirPath, null);
}

const LIBRARY_FILE = path.join(app.getPath('userData'), 'library.json');
const PLAYLISTS_FILE = path.join(app.getPath('userData'), 'playlists.json');
const DOWNLOAD_RECOVERY_FILE = path.join(app.getPath('userData'), 'download-recovery.json');
const MAPPINGS_FILE = path.join(app.getPath('userData'), 'mappings.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const LISTENING_STATS_FILE = path.join(app.getPath('userData'), 'listening-stats.json');
const LIKED_SONGS_FILE = path.join(app.getPath('userData'), 'liked-songs.json');
const RESTORE_MANIFEST_FILE = path.join(app.getPath('userData'), '.backup-restore-transaction.json');
const COVERS_DIR = path.join(app.getPath('userData'), 'covers');
const BACKUPS_DIR = path.join(app.getPath('userData'), 'backups');
const AUTOMATIC_BACKUP_STATUS_FILE = path.join(app.getPath('userData'), 'automatic-backup-status.json');
const KNOWN_TRACK_INDEX_FILE = path.join(app.getPath('userData'), 'known-tracks.json');
const LASTFM_DISCOVERY_CACHE_FILE = path.join(app.getPath('userData'), 'lastfm-discovery-cache.json');

let managedLibraryAudioPaths = null;
let managedLibraryAudioPathsSignature = '';
function invalidateManagedLibraryAudioPaths() {
  managedLibraryAudioPaths = null;
  managedLibraryAudioPathsSignature = '';
}
function getManagedLibraryAudioPaths() {
  let stat;
  try {
    stat = fs.statSync(LIBRARY_FILE);
    if (!stat.isFile()) return new Set();
  } catch (_) {
    return new Set();
  }
  const signature = `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeMs}`;
  if (managedLibraryAudioPaths && managedLibraryAudioPathsSignature === signature) return managedLibraryAudioPaths;
  const library = readJsonFile(LIBRARY_FILE, []);
  const paths = new Set();
  if (Array.isArray(library)) {
    library.forEach((item) => {
      const filePath = normalizePathInput(item && item.filePath);
      if (filePath && path.isAbsolute(filePath) && AUDIO_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) paths.add(filePath);
    });
  }
  managedLibraryAudioPaths = paths;
  managedLibraryAudioPathsSignature = signature;
  return paths;
}

function splitSettingsForStorage(settings) {
  return splitSerializedSettings(serializeSettingsForDisk(settings));
}

function sanitizeListeningStats(value) {
  return sanitizeImportedSettings({ listeningStats: value }).listeningStats || {};
}

async function persistSettingsStorage(settings, includeListeningStats = true) {
  const stored = splitSettingsForStorage(settings);
  const writes = [queueJsonWrite(SETTINGS_FILE, stored.settingsSnapshot)];
  if (includeListeningStats) writes.push(queueJsonWrite(LISTENING_STATS_FILE, stored.listeningStats));
  await Promise.all(writes);
  return stored;
}

async function persistLastfmCredentialSettings(reason) {
  const stored = splitSettingsForStorage(appSettings);
  lastfmDebug('credential-write-requested', { reason, settingsPath: SETTINGS_FILE, memory: lastfmCredentialPresence(appSettings), serialized: lastfmEncryptedFieldPresence(stored.settingsSnapshot) });
  await queueJsonWrite(SETTINGS_FILE, stored.settingsSnapshot);
  const diskSnapshot = readAppDataFile(SETTINGS_FILE, {}, 'settings.json');
  lastfmDebug('credential-write-completed', { reason, settingsPath: SETTINGS_FILE, disk: lastfmEncryptedFieldPresence(diskSnapshot) });
}
const LASTFM_POOL_TTL_MS = 12 * 60 * 60 * 1000;

let knownTrackIndex = null;
let knownTrackIndexLoadPromise = null;
let knownTrackIndexWritePromise = Promise.resolve();
const knownTrackIndexWriteDrainer = createPendingWriteDrainer();
let lastfmKnownSyncPromise = null;
let lastfmKnownSyncTimer = null;
const lastfmKnownSyncGuard = createLastfmSyncGuard();
let pendingLastfmAuthToken = '';
let lastfmDiscoveryCacheLoaded = false;
const lastfmDiscoveryCache = new Map();
const lastfmApiCache = new Map();
const lastfmApiClient = createLastfmApiClient({
  getApiKey: () => appSettings.lastfmApiKey || '',
  cache: lastfmApiCache,
});

if (!fs.existsSync(COVERS_DIR)) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

function loadLastfmDiscoveryCache() {
  if (lastfmDiscoveryCacheLoaded) return;
  lastfmDiscoveryCacheLoaded = true;
  try {
    const stored = readAppDataFile(LASTFM_DISCOVERY_CACHE_FILE, {}, 'lastfm-discovery-cache.json', (value) => {
      if (!isPlainObject(value)) throw new Error('expected an object');
    });
    restoreCacheEntries(stored, Date.now())
      .filter(([key, value]) => key.startsWith('pool:') && isNormalizedPoolValue(value))
      .forEach(([key, value]) => lastfmDiscoveryCache.set(key, value));
  } catch (error) {
    console.warn('Ignoring corrupt Last.fm discovery cache:', error.message || error);
    lastfmDiscoveryCache.clear();
  }
}

async function persistLastfmDiscoveryCache() {
  loadLastfmDiscoveryCache();
  // Only normalized, bounded candidate pools are durable. API client entries
  // deliberately remain process-memory-only so raw Last.fm payloads never
  // reach userData.
  const entries = getPersistableDiscoveryCacheEntries(lastfmDiscoveryCache, Date.now());
  await writeTextFileAtomic(LASTFM_DISCOVERY_CACHE_FILE, JSON.stringify({ version: 1, entries }));
}

async function ensureKnownTrackIndex() {
  if (knownTrackIndex) return knownTrackIndex;
  if (knownTrackIndexLoadPromise) return knownTrackIndexLoadPromise;
  knownTrackIndexLoadPromise = Promise.resolve().then(() => {
    try {
      if (fs.existsSync(KNOWN_TRACK_INDEX_FILE)) {
        const stat = fs.lstatSync(KNOWN_TRACK_INDEX_FILE);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SERIALIZED_BYTES) throw new Error(`known track index exceeds ${MAX_SERIALIZED_BYTES} bytes`);
      }
      const stored = readAppDataFile(KNOWN_TRACK_INDEX_FILE, {}, 'known-tracks.json', (value) => {
        if (!isPlainObject(value)) throw new Error('expected an object');
      });
      knownTrackIndex = createKnownTrackIndex(stored);
    } catch (error) {
      console.warn('Ignoring corrupt known-track index:', error.message || error);
      knownTrackIndex = createKnownTrackIndex();
    }
    return knownTrackIndex;
  }).finally(() => { knownTrackIndexLoadPromise = null; });
  return knownTrackIndexLoadPromise;
}

function persistKnownTrackIndex() {
  if (!knownTrackIndex) return Promise.resolve();
  const snapshot = serializeKnownTrackIndex(knownTrackIndex, MAX_SERIALIZED_BYTES);
  knownTrackIndexWritePromise = knownTrackIndexWriteDrainer.enqueue(() => queueTextFileWrite(KNOWN_TRACK_INDEX_FILE, snapshot));
  return knownTrackIndexWritePromise;
}

async function seedKnownTrackIndexFromSettings() {
  const index = await ensureKnownTrackIndex();
  seedFromHistory(index, appSettings.playHistory);
  // Legacy playCounts is keyed by local file path. It remains supported until
  // the renderer has migrated any resolvable rows into listening-stats.json.
  const counts = appSettings.playCounts && typeof appSettings.playCounts === 'object' ? appSettings.playCounts : {};
  const library = readJsonFile(LIBRARY_FILE, []);
  const byPath = new Map((Array.isArray(library) ? library : []).filter((file) => file && file.filePath).map((file) => [file.filePath, file]));
  Object.keys(counts).slice(0, 250000).forEach((filePath) => {
    if (Number(counts[filePath]) > 0 && byPath.has(filePath)) indexTrack(index, byPath.get(filePath), 'local', 0);
  });
  const stats = appSettings.listeningStats && typeof appSettings.listeningStats === 'object' ? appSettings.listeningStats : {};
  Object.values(stats).slice(0, 250000).forEach((row) => {
    if (row && Number(row.count) > 0 && typeof row.filePath === 'string' && byPath.has(row.filePath)) {
      indexTrack(index, byPath.get(row.filePath), 'local', 0);
    }
  });
  return persistKnownTrackIndex();
}

function normalizeLastfmProviderSession(value, fallbackGenreIds) {
  const source = value && typeof value === 'object' ? value : {};
  const genreIds = Array.from(new Set((source.genreIds || fallbackGenreIds || []).map(normalizeGenreKey).filter(Boolean))).slice(0, 8);
  const poolKey = typeof source.poolKey === 'string' ? source.poolKey.slice(0, 240) : '';
  if (!genreIds.length || !poolKey || source.version !== 1) return null;
  return {
    version: 1,
    genreIds,
    mode: 'balanced',
    excludeKnownTracks: source.excludeKnownTracks === true,
    poolKey,
    remainingItemIds: Array.isArray(source.remainingItemIds) ? source.remainingItemIds.map((id) => String(id || '').slice(0, 600)).filter(Boolean).slice(0, 2000) : [],
    recentItemIds: Array.isArray(source.recentItemIds) ? source.recentItemIds.map((id) => String(id || '').slice(0, 600)).filter(Boolean).slice(-5) : [],
    lastArtistKey: typeof source.lastArtistKey === 'string' ? source.lastArtistKey.slice(0, 500) : '',
  };
}

function getLastfmTracks(data, key) {
  const group = data && data[key];
  const tracks = group && group.track;
  return Array.isArray(tracks) ? tracks : tracks ? [tracks] : [];
}

function getLastfmArtists(data) {
  const artists = data && data.topartists && data.topartists.artist;
  return Array.isArray(artists) ? artists : artists ? [artists] : [];
}

function getLastfmTags(data) {
  const tags = data && data.toptags && data.toptags.tag;
  return Array.isArray(tags) ? tags : tags ? [tags] : [];
}

function isArtistGenreVerified(genre, tagData) {
  return hasGenreTag(genre, getLastfmTags(tagData));
}

async function buildLastfmDiscoveryPools(genreId) {
  loadLastfmDiscoveryCache();
  const genre = normalizeGenreKey(genreId);
  if (!genre) throw new Error('A genre is required for Last.fm discovery.');
  const topTracksResponse = await lastfmApiClient.request('tag.gettoptracks', { tag: genre, limit: 200, page: 1 });
  const topArtistsResponse = await lastfmApiClient.request('tag.gettopartists', { tag: genre, limit: 80, page: 1 });
  const topTracks = getLastfmTracks(topTracksResponse, 'tracks');
  const topArtists = getLastfmArtists(topArtistsResponse);
  const artistTopTracks = {};
  // A narrow spread across the tag chart creates discovery/deep candidates
  // without walking an unbounded similar-artist graph.
  const artistIndexes = [10, 16, 22, 30, 40].filter((index) => topArtists[index] && topArtists[index].name);
  for (const index of artistIndexes) {
    const artist = topArtists[index];
    const data = await lastfmApiClient.request('artist.gettoptracks', { artist: artist.name, limit: 5, page: 1, autocorrect: 1 });
    artistTopTracks[normalizeText(artist.name)] = getLastfmTracks(data, 'toptracks');
  }
  let similarArtistTracks = [];
  const deepSeed = topArtists[30] || topArtists[topArtists.length - 1];
  if (deepSeed && deepSeed.name) {
    const similar = await lastfmApiClient.request('artist.getsimilar', { artist: deepSeed.name, limit: 2, autocorrect: 1 });
    const artists = similar && similar.similarartists && similar.similarartists.artist;
    for (const artist of (Array.isArray(artists) ? artists : artists ? [artists] : []).slice(0, 2)) {
      if (!artist || !artist.name) continue;
      // Similarity alone can jump scenes/genres. Require an explicit top-tag
      // match before deep tracks from a similar artist enter this station.
      const tags = await lastfmApiClient.request('artist.gettoptags', { artist: artist.name, autocorrect: 1 });
      if (!isArtistGenreVerified(genre, tags)) continue;
      const data = await lastfmApiClient.request('artist.gettoptracks', { artist: artist.name, limit: 3, page: 1, autocorrect: 1 });
      similarArtistTracks = similarArtistTracks.concat(getLastfmTracks(data, 'toptracks'));
    }
  }
  let similarTagTracks = [];
  if (topTracks.length < 30) {
    const similarTags = await lastfmApiClient.request('tag.getsimilar', { tag: genre });
    const tags = similarTags && similarTags.similartags && similarTags.similartags.tag;
    const firstTag = (Array.isArray(tags) ? tags : tags ? [tags] : [])[0];
    if (firstTag && firstTag.name) {
      const data = await lastfmApiClient.request('tag.gettoptracks', { tag: firstTag.name, limit: 30, page: 1 });
      similarTagTracks = getLastfmTracks(data, 'tracks');
    }
  }
  const pools = buildCandidatePools({ genreId: genre, topTracks, topArtists, artistTopTracks, similarArtistTracks, similarTagTracks });
  const poolKey = `pool:${crypto.createHash('sha256').update(`${genre}|balanced|v1`).digest('hex').slice(0, 32)}`;
  setBoundedDiscoveryCacheEntry(lastfmDiscoveryCache, poolKey, { value: { version: 1, genreId: genre, pools }, expiresAt: Date.now() + LASTFM_POOL_TTL_MS }, Date.now());
  await persistLastfmDiscoveryCache();
  return { poolKey, pools };
}

async function getLastfmPool(poolKey, genreId) {
  loadLastfmDiscoveryCache();
  const cached = lastfmDiscoveryCache.get(poolKey);
  if (cached && cached.expiresAt > Date.now() && cached.value && cached.value.version === 1 && cached.value.pools) return { poolKey, pools: cached.value.pools };
  return buildLastfmDiscoveryPools(genreId);
}

async function makeLastfmDiscoveryBatch(session, genreId, options) {
  const normalized = normalizeLastfmProviderSession(session, [genreId]);
  const poolResult = normalized ? await getLastfmPool(normalized.poolKey, normalized.genreIds[0]) : await buildLastfmDiscoveryPools(genreId);
  const baseSession = normalized || { version: 1, genreIds: [normalizeGenreKey(genreId)], mode: 'balanced', excludeKnownTracks: !!(options && options.excludeKnownTracks), poolKey: poolResult.poolKey, remainingItemIds: [], recentItemIds: [], lastArtistKey: '' };
  const index = await ensureKnownTrackIndex();
  const allItems = flattenPools(poolResult.pools);
  const remaining = baseSession.remainingItemIds.length ? new Set(baseSession.remainingItemIds) : null;
  const availablePools = Object.fromEntries(Object.entries(poolResult.pools).map(([tier, items]) => [tier, remaining ? items.filter((item) => remaining.has(item.id)) : items]));
  const depth = options && typeof options.discoveryDepth === 'number' && Number.isFinite(options.discoveryDepth) ? Math.max(0, Math.min(1, options.discoveryDepth)) : 0.5;
  const tierWeights = depth <= 0.5
    ? { core: Math.round(6 - depth * 4), discovery: Math.round(3 + depth * 2), deep: Math.round(1 + depth * 2) }
    : { core: Math.round(4 - (depth - 0.5) * 4), discovery: Math.round(4 + (depth - 0.5) * 2), deep: Math.round(2 + (depth - 0.5) * 4) };
  const bias = options && options.similarityBias && typeof options.similarityBias === 'object' ? options.similarityBias : null;
  const similarityKeys = new Set(Array.isArray(bias && bias.candidateIds) ? bias.candidateIds.map(String).slice(0, 80) : []);
  const selection = selectDiscoveryBatch(availablePools, {
    requestedCount: 24,
    recentItemIds: baseSession.recentItemIds,
    previousArtist: baseSession.lastArtistKey,
    excludeKnownTracks: baseSession.excludeKnownTracks,
    knownTrackIndex: { has: (candidate) => hasKnownTrack(index, candidate) },
    tierWeights,
    similarity: similarityKeys.size ? { keys: similarityKeys, strength: Math.max(0, Math.min(1, Number(bias.strength) || 0)), remainingSelections: Math.max(0, Math.min(24, Number(bias.remainingSelections) || 0)) } : null,
  });
  if (options && options.radioDebugStationId) {
    const knownFiltered = baseSession.excludeKnownTracks ? allItems.filter((item) => hasKnownTrack(index, item)).length : 0;
    radioDebug('discovery-result', { stationId: options.radioDebugStationId, totalCandidates: allItems.length, core: (poolResult.pools.core || []).length, discovery: (poolResult.pools.discovery || []).length, deep: (poolResult.pools.deep || []).length, knownFilteringAfter: Math.max(0, allItems.length - knownFiltered), selected: selection.selected.length });
  }
  const selectedIds = new Set(selection.selected.map((item) => item.id));
  const remainingItemIds = allItems.filter((item) => !selectedIds.has(item.id) && (!remaining || remaining.has(item.id))).map((item) => item.id);
  return {
    items: selection.selected,
    providerSession: { ...baseSession, poolKey: poolResult.poolKey, remainingItemIds, recentItemIds: selection.recentItemIds, lastArtistKey: selection.previousArtist },
    exhausted: selection.selected.length === 0,
  };
}

function getLastfmSimilarTracks(data) {
  const tracks = data && data.similartracks && data.similartracks.track;
  return Array.isArray(tracks) ? tracks : tracks ? [tracks] : [];
}
async function getLastfmSimilarityCandidateIds(seed, genreId) {
  const genre = normalizeGenreKey(genreId);
  const artist = String(seed && seed.artist || '').trim();
  const title = String(seed && (seed.title || seed.name) || '').trim();
  if (!genre || !artist || !title) return [];
  const params = { artist, track: title, limit: 24, autocorrect: 1 };
  const mbid = String(seed && (seed.trackMbid || seed.recordingMbid || seed.mbid) || '').trim();
  if (/^[0-9a-f-]{36}$/i.test(mbid)) params.mbid = mbid;
  const [trackResponse, artistResponse] = await Promise.all([
    lastfmApiClient.request('track.getsimilar', params),
    lastfmApiClient.request('artist.getsimilar', { artist, limit: 8, autocorrect: 1 }),
  ]);
  const candidates = getLastfmSimilarTracks(trackResponse).map((track, index) => ({ artist: track.artist && (track.artist.name || track.artist['#text']) || '', title: track.name || '', trackMbid: track.mbid || '', id: '' })).filter((track) => track.artist && track.title);
  const artists = artistResponse && artistResponse.similarartists && artistResponse.similarartists.artist;
  for (const similar of (Array.isArray(artists) ? artists : artists ? [artists] : []).slice(0, 8)) {
    if (!similar || !similar.name) continue;
    const tags = await lastfmApiClient.request('artist.gettoptags', { artist: similar.name, autocorrect: 1 });
    if (!isArtistGenreVerified(genre, tags)) continue;
    const top = await lastfmApiClient.request('artist.gettoptracks', { artist: similar.name, limit: 3, page: 1, autocorrect: 1 });
    getLastfmTracks(top, 'toptracks').forEach((track) => candidates.push({ artist: similar.name, title: track.name || '', trackMbid: track.mbid || '', id: '' }));
  }
  // Bias only boosts the station's already genre-vetted pool. The return is
  // identity metadata, never raw Last.fm data or a separate station.
  const pool = await buildLastfmDiscoveryPools(genre);
  const stationIds = new Map();
  flattenPools(pool.pools).forEach((item) => { stationIds.set(getCandidateIdentity(item), item.id); stationIds.set(getCandidateAliasIdentity(item), item.id); });
  return candidates.map((track) => stationIds.get(getCandidateIdentity(track)) || stationIds.get(getCandidateAliasIdentity(track))).filter(Boolean).slice(0, 80);
}

function scheduleLastfmKnownTrackSync() {
  if (lastfmKnownSyncTimer || lastfmKnownSyncPromise || !appSettings.lastfmApiKey || !appSettings.lastfmUsername) return;
  lastfmKnownSyncTimer = setTimeout(() => {
    lastfmKnownSyncTimer = null;
    runLastfmKnownTrackSync().catch((error) => console.warn('Last.fm known-track sync failed:', error.message || error));
  }, 0);
}

function invalidateLastfmKnownTrackSync() {
  lastfmKnownSyncGuard.invalidate();
  if (lastfmKnownSyncTimer) clearTimeout(lastfmKnownSyncTimer);
  lastfmKnownSyncTimer = null;
}

function isCurrentLastfmKnownSync(token) {
  return lastfmKnownSyncGuard.isCurrent(token, appSettings.lastfmUsername, appSettings.lastfmApiKey);
}

async function runLastfmKnownTrackSync() {
  if (lastfmKnownSyncPromise) return lastfmKnownSyncPromise;
  let runToken = null;
  lastfmKnownSyncPromise = (async () => {
    const username = String(appSettings.lastfmUsername || '').trim();
    const apiKey = String(appSettings.lastfmApiKey || '').trim();
    const token = lastfmKnownSyncGuard.capture(username, apiKey);
    runToken = token;
    if (!username || !apiKey) return { started: false, complete: false };
    const index = await ensureKnownTrackIndex();
    if (!isCurrentLastfmKnownSync(token)) return { started: false, complete: false, stale: true };
    beginLastfmSync(index, username, Math.floor(Date.now() / 1000), 300);
    const maxPages = 10;
    let complete = false;
    for (let count = 0; count < maxPages && !complete; count++) {
      if (!isCurrentLastfmKnownSync(token)) return { started: false, complete: false, stale: true };
      const params = getLastfmRecentTracksRequest(index, username);
      if (!params) return { started: false, complete: false, stale: true };
      const data = await lastfmApiClient.request('user.getrecenttracks', params);
      if (!isCurrentLastfmKnownSync(token)) return { started: false, complete: false, stale: true };
      const result = ingestLastfmRecentPage(index, data, username, Math.floor(Date.now() / 1000));
      complete = result.complete;
      await persistKnownTrackIndex();
      if (!isCurrentLastfmKnownSync(token)) return { started: false, complete: false, stale: true };
    }
    if (!complete && isCurrentLastfmKnownSync(token)) {
      lastfmKnownSyncTimer = setTimeout(() => { lastfmKnownSyncTimer = null; runLastfmKnownTrackSync().catch((error) => console.warn('Last.fm known-track sync failed:', error.message || error)); }, 1000);
    }
    return { started: true, complete: index.lastfmSync.initialComplete, lastSeenUts: index.lastfmSync.lastSeenUts };
  })();
  try { return await lastfmKnownSyncPromise; }
  finally {
    lastfmKnownSyncPromise = null;
    // An invalidated request may finish after a new profile connected. Start
    // that profile only after the old request has fully stopped writing.
    if (runToken && !isCurrentLastfmKnownSync(runToken)) scheduleLastfmKnownTrackSync();
  }
}

function normalizeAutomaticBackupStatus(value) {
  const next = { lastSuccessAt: null, lastErrorAt: null, lastError: '' };
  if (!isPlainObject(value)) return next;
  for (const key of ['lastSuccessAt', 'lastErrorAt']) {
    if (typeof value[key] === 'string' && Number.isFinite(Date.parse(value[key]))) next[key] = new Date(value[key]).toISOString();
  }
  if (typeof value.lastError === 'string') next.lastError = value.lastError.slice(0, 2000);
  return next;
}

function loadAutomaticBackupStatusFromDisk() {
  try {
    automaticBackupStatus = normalizeAutomaticBackupStatus(readAppDataFile(
      AUTOMATIC_BACKUP_STATUS_FILE,
      {},
      'automatic-backup-status.json',
      (value) => { if (!isPlainObject(value)) throw new Error('expected an object'); }
    ));
  } catch (e) {
    automaticBackupStatus = {
      lastSuccessAt: null,
      lastErrorAt: new Date().toISOString(),
      lastError: `Could not read the previous automatic backup status: ${e.message || e}`.slice(0, 2000),
    };
    console.error('Could not load automatic backup status:', e);
  }
}

async function persistAutomaticBackupStatus() {
  await writeTextFileAtomic(AUTOMATIC_BACKUP_STATUS_FILE, JSON.stringify(automaticBackupStatus));
}

async function updateAutomaticBackupStatus(patch) {
  automaticBackupStatus = normalizeAutomaticBackupStatus({ ...automaticBackupStatus, ...patch });
  try {
    await persistAutomaticBackupStatus();
    return '';
  } catch (e) {
    const message = `Backup status could not be saved: ${e.message || e}`;
    automaticBackupStatus.lastErrorAt = new Date().toISOString();
    automaticBackupStatus.lastError = automaticBackupStatus.lastError ? `${automaticBackupStatus.lastError} ${message}`.slice(0, 2000) : message.slice(0, 2000);
    console.error(message);
    return message;
  }
}

async function ensureBackupDirectory() {
  await fs.promises.mkdir(BACKUPS_DIR, { recursive: true, mode: 0o700 });
  const stat = await fs.promises.lstat(BACKUPS_DIR);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('The backup path is not a regular directory');
  await fs.promises.chmod(BACKUPS_DIR, 0o700);
  return BACKUPS_DIR;
}

async function getValidatedAutomaticBackupNames() {
  let directoryStat;
  try { directoryStat = await fs.promises.lstat(BACKUPS_DIR); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('The backup path is not a regular directory');
  const entries = await fs.promises.readdir(BACKUPS_DIR, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !isAutomaticBackupFilename(entry.name)) continue;
    const filePath = path.join(BACKUPS_DIR, entry.name);
    try {
      const stat = await fs.promises.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const parsed = readJsonFileStrict(filePath, null);
      validateBackupData(parsed);
      if (parsed.kind !== undefined && parsed.kind !== 'automatic') continue;
      names.push(entry.name);
    } catch (e) {
      console.warn('Ignoring invalid automatic backup during retention:', entry.name, e.message || e);
    }
  }
  return names;
}

async function getValidatedSafetyBackupNames() {
  let entries;
  try { entries = await fs.promises.readdir(BACKUPS_DIR, { withFileTypes: true }); }
  catch (e) { if (e.code === 'ENOENT') return []; throw e; }
  const names = [];
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !isSafetyBackupFilename(entry.name)) continue;
    const filePath = path.join(BACKUPS_DIR, entry.name);
    try {
      const stat = await fs.promises.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const parsed = readJsonFileStrict(filePath, null);
      validateBackupData(parsed);
      if (parsed.kind === 'safety') names.push(entry.name);
    } catch (e) { console.warn('Ignoring invalid safety backup during retention:', entry.name, e.message || e); }
  }
  return names;
}

async function ensureAutomaticBackupHistoryLoaded() {
  if (automaticBackupHistoryLoaded) return;
  if (automaticBackupHistoryPromise) return automaticBackupHistoryPromise;
  automaticBackupHistoryPromise = (async () => {
    const names = await getValidatedAutomaticBackupNames();
    const newestTime = names.reduce((latest, name) => Math.max(latest, getAutomaticBackupTime(name) || 0), 0);
    automaticBackupStatus.lastSuccessAt = newestTime ? new Date(newestTime).toISOString() : null;
    automaticBackupHistoryLoaded = true;
  })();
  try { await automaticBackupHistoryPromise; }
  finally { automaticBackupHistoryPromise = null; }
}

function hasExistingBackupData(data, storedSettings, storedListeningStats) {
  return !!(
    data.library.length
    || data.playlists.length
    || Object.keys(data.mappings).length
    || data.likedSongs.length
    || Object.keys(storedSettings).length
    || Object.keys(storedListeningStats || {}).length
  );
}

async function buildValidatedBackupPayload(kind, extras) {
  await waitForPendingDataWrites();
  const storedSettings = readJsonFileStrict(SETTINGS_FILE, {});
  const storedListeningStats = readJsonFileStrict(LISTENING_STATS_FILE, {});
  if (!isPlainObject(storedSettings)) throw new Error('Could not create backup: settings.json must contain an object');
  if (!isPlainObject(storedListeningStats)) throw new Error('Could not create backup: listening-stats.json must contain an object');
  const data = {
    library: readJsonFileStrict(LIBRARY_FILE, []),
    playlists: readJsonFileStrict(PLAYLISTS_FILE, []),
    mappings: readJsonFileStrict(MAPPINGS_FILE, {}),
    settings: sanitizeSettingsForBackup(appSettings),
    likedSongs: readJsonFileStrict(LIKED_SONGS_FILE, extras && Array.isArray(extras.likedSongs) ? extras.likedSongs : []),
    exportedFrom: APP_NAME,
  };
  const payload = {
    app: APP_NAME,
    schemaVersion: 1,
    kind,
    exportedAt: new Date().toISOString(),
    data,
  };
  validateBackupData(payload);
  const text = JSON.stringify(payload, null, 2);
  if (Buffer.byteLength(text, 'utf8') > MAX_BACKUP_BYTES) throw new Error(`Backup exceeds the ${MAX_BACKUP_BYTES / (1024 * 1024)} MB export limit`);
  return { payload, text, data, summary: summarizeBackupData(data), hasExistingData: hasExistingBackupData(data, storedSettings, storedListeningStats) };
}

async function writeValidatedBackupFile(filePath, built) {
  await writeTextFileAtomic(filePath, built.text);
  try {
    const writtenPayload = readJsonFileStrict(filePath, null);
    validateBackupData(writtenPayload);
    if (!writtenPayload || writtenPayload.kind !== built.payload.kind) throw new Error('Written backup kind does not match the requested backup');
  } catch (e) {
    await fs.promises.rm(filePath, { force: true }).catch(() => { });
    throw new Error(`Written backup could not be validated: ${e.message || e}`);
  }
}

async function getUnusedLocalBackupPath(kind) {
  await ensureBackupDirectory();
  const now = Date.now();
  for (let offset = 0; offset < 1000; offset++) {
    const filePath = path.join(BACKUPS_DIR, createLocalBackupFilename(kind, now + offset));
    try { await fs.promises.lstat(filePath); }
    catch (e) { if (e.code === 'ENOENT') return filePath; throw e; }
  }
  throw new Error('Could not allocate a unique backup filename');
}

async function createLocalBackup(kind, extras) {
  const built = await buildValidatedBackupPayload(kind, extras);
  if (kind === 'safety' && !built.hasExistingData) return { ok: true, skipped: true, summary: built.summary };
  const filePath = await getUnusedLocalBackupPath(kind);
  await writeValidatedBackupFile(filePath, built);
  if (kind === 'safety') {
    try { await pruneSafetyBackups(); }
    catch (e) { console.warn('Safety backup was created, but old safety backups could not be pruned:', e.message || e); }
  }
  return { ok: true, filePath, summary: built.summary };
}

async function pruneAutomaticBackups() {
  const validNames = await getValidatedAutomaticBackupNames();
  const namesToPrune = selectAutomaticBackupsToPrune(validNames, AUTOMATIC_BACKUP_RETENTION);
  for (const name of namesToPrune) {
    if (!isAutomaticBackupFilename(name) || path.basename(name) !== name) continue;
    const filePath = path.join(BACKUPS_DIR, name);
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) continue;
    await fs.promises.unlink(filePath);
  }
  return namesToPrune.length;
}

async function pruneSafetyBackups() {
  const names = await getValidatedSafetyBackupNames();
  const namesToPrune = names
    .map(name => ({ name, time: getSafetyBackupTime(name) || 0 }))
    .sort((a, b) => b.time - a.time || b.name.localeCompare(a.name))
    .slice(AUTOMATIC_BACKUP_RETENTION)
    .map(entry => entry.name);
  for (const name of namesToPrune) {
    if (!isSafetyBackupFilename(name) || path.basename(name) !== name) continue;
    const filePath = path.join(BACKUPS_DIR, name);
    const stat = await fs.promises.lstat(filePath);
    if (stat.isFile() && !stat.isSymbolicLink()) await fs.promises.unlink(filePath);
  }
  return namesToPrune.length;
}

function startExclusiveBackupOperation(kind, task) {
  if (activeBackupOperationPromise) return null;
  const operation = Promise.resolve().then(task);
  activeBackupOperationPromise = operation;
  activeBackupOperationKind = kind;
  const cleanup = () => {
    if (activeBackupOperationPromise === operation) {
      activeBackupOperationPromise = null;
      activeBackupOperationKind = '';
    }
  };
  operation.then(cleanup, cleanup);
  return operation;
}

async function waitForActiveBackupOperation() {
  if (!activeBackupOperationPromise) return;
  await activeBackupOperationPromise.catch(() => { });
}

function getAutomaticBackupBlockReason() {
  if (isQuitting || closeFinishInProgress || quitFlushPending) return 'Playerinyo is closing';
  if (!automaticBackupLibraryReady) return 'The library is empty';
  if (backupRestoreInProgress) return 'A restore is in progress';
  if (movedFileRelinkCommitInProgress) return 'A moved-file relink is in progress';
  if (activeDataTransactionPromise) return 'An app-state transaction is in progress';
  if (reservedDownloadRequestIds.size || activeYtdlpDownloads.size) return 'Downloads are active';
  if (fileWriteQueues.size) return 'App data is still being written';
  if (activeBackupOperationPromise) return 'Another backup is active';
  return '';
}

async function runAutomaticBackup(options = {}) {
  try { await ensureAutomaticBackupHistoryLoaded(); }
  catch (e) {
    const message = `Could not inspect automatic backups: ${e.message || e}`;
    await updateAutomaticBackupStatus({ lastErrorAt: new Date().toISOString(), lastError: message });
    return { ok: false, error: message };
  }
  if (options.scheduled && !isAutomaticBackupDue(automaticBackupStatus.lastSuccessAt)) return { ok: false, notDue: true };
  const blockedBy = getAutomaticBackupBlockReason();
  if (blockedBy) return { ok: false, deferred: true, error: blockedBy };
  const operation = startExclusiveBackupOperation('automatic', async () => {
    const lateBlocker = getAutomaticBackupBlockReason();
    if (lateBlocker && lateBlocker !== 'Another backup is active') return { ok: false, deferred: true, error: lateBlocker };
    try {
      const result = await createLocalBackup('automatic');
      let warning = '';
      try { await pruneAutomaticBackups(); }
      catch (e) { warning = `Backup was created, but old automatic backups could not be pruned: ${e.message || e}`; }
      const statusWarning = await updateAutomaticBackupStatus({
        lastSuccessAt: new Date().toISOString(),
        lastErrorAt: warning ? new Date().toISOString() : null,
        lastError: warning,
      });
      if (statusWarning) warning = warning ? `${warning} ${statusWarning}` : statusWarning;
      return { ...result, warning };
    } catch (e) {
      const message = e.message || String(e);
      await updateAutomaticBackupStatus({ lastErrorAt: new Date().toISOString(), lastError: message });
      console.error('Automatic backup failed:', e);
      return { ok: false, error: message };
    }
  });
  return operation || { ok: false, deferred: true, error: 'Another backup is active' };
}

// Reusable pre-operation snapshot for restore and future local-data maintenance.
async function createSafetyBackup() {
  if (activeDataTransactionPromise) throw new Error('An app-state transaction is already active');
  const operation = startExclusiveBackupOperation('safety', () => createLocalBackup('safety'));
  if (!operation) throw new Error('Another backup is already active');
  return operation;
}

function cancelAutomaticBackupSchedule() {
  automaticBackupScheduleGeneration++;
  if (automaticBackupTimer) clearTimeout(automaticBackupTimer);
  automaticBackupTimer = null;
}

function scheduleAutomaticBackup(minimumDelayMs = 0) {
  cancelAutomaticBackupSchedule();
  if (appSettings.automaticBackupsEnabled !== true || !automaticBackupLibraryReady || isQuitting) return;
  const generation = automaticBackupScheduleGeneration;
  ensureAutomaticBackupHistoryLoaded().then(() => {
    if (generation !== automaticBackupScheduleGeneration || appSettings.automaticBackupsEnabled !== true || !automaticBackupLibraryReady || isQuitting) return;
    const dueAt = getAutomaticBackupDueAt(automaticBackupStatus.lastSuccessAt);
    const delay = Math.min(AUTOMATIC_BACKUP_INTERVAL_MS, Math.max(Number(minimumDelayMs) || 0, dueAt - Date.now(), 0));
    automaticBackupTimer = setTimeout(async () => {
      if (generation !== automaticBackupScheduleGeneration) return;
      automaticBackupTimer = null;
      const result = await runAutomaticBackup({ scheduled: true });
      if (appSettings.automaticBackupsEnabled !== true || !automaticBackupLibraryReady || isQuitting) return;
      scheduleAutomaticBackup(result.deferred ? AUTOMATIC_BACKUP_DEFER_MS : (result.ok || result.notDue ? 0 : AUTOMATIC_BACKUP_RETRY_MS));
    }, delay);
    if (typeof automaticBackupTimer.unref === 'function') automaticBackupTimer.unref();
  }).catch((e) => {
    if (generation !== automaticBackupScheduleGeneration) return;
    automaticBackupStatus.lastErrorAt = new Date().toISOString();
    automaticBackupStatus.lastError = `Could not inspect automatic backups: ${e.message || e}`.slice(0, 2000);
    automaticBackupTimer = setTimeout(() => scheduleAutomaticBackup(), AUTOMATIC_BACKUP_RETRY_MS);
    if (typeof automaticBackupTimer.unref === 'function') automaticBackupTimer.unref();
  });
}

function setAutomaticBackupLibraryReady(hasLibrary, initialDelay = AUTOMATIC_BACKUP_INITIAL_DELAY_MS) {
  automaticBackupLibraryReady = hasLibrary === true;
  if (!automaticBackupLibraryReady) cancelAutomaticBackupSchedule();
  else scheduleAutomaticBackup(initialDelay);
}

function getAutomaticBackupStatusSnapshot() {
  const enabled = appSettings.automaticBackupsEnabled === true;
  return {
    enabled,
    retention: AUTOMATIC_BACKUP_RETENTION,
    libraryReady: automaticBackupLibraryReady,
    running: !!activeBackupOperationPromise,
    operation: activeBackupOperationKind || '',
    lastSuccessAt: automaticBackupStatus.lastSuccessAt,
    lastErrorAt: automaticBackupStatus.lastErrorAt,
    lastError: automaticBackupStatus.lastError,
    nextDueAt: enabled && automaticBackupLibraryReady ? new Date(getAutomaticBackupDueAt(automaticBackupStatus.lastSuccessAt)).toISOString() : null,
    directory: BACKUPS_DIR,
  };
}

function getDefaultDownloadFolder() {
  let musicDir = '';
  try { musicDir = app.getPath('music'); }
  catch (e) { musicDir = app.getPath('home'); }
  return path.join(musicDir || app.getPath('home'), `${APP_NAME} Downloads`);
}

function sanitizePathSegment(value, fallback) {
  let s = String(value || '').trim();
  if (!s) s = fallback || 'Unknown';
  s = s.replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/[. ]+$/g, '');
  if (!s) s = fallback || 'Unknown';
  return s.slice(0, 110);
}

function parseTrackNumber(value) {
  if (value === null || value === undefined) return 0;
  const match = String(value).match(/\d+/);
  return match ? parseInt(match[0], 10) || 0 : 0;
}

function parseDurationSeconds(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value > 1000 ? Math.round(value / 1000) : value;
  const s = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    return n > 1000 ? Math.round(n / 1000) : n;
  }
  const parts = s.split(':').map(part => parseFloat(part) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchTokens(value) {
  return normalizeSearchText(value).split(/\s+/).filter(token => token.length > 2);
}

function tokenCoverage(tokens, text) {
  if (!tokens.length) return 0;
  const hit = tokens.filter(token => text.includes(token)).length;
  return hit / tokens.length;
}

function searchArtistVariants(value) {
  const normalized = String(value || '')
    .replace(/\b(feat\.?|featuring|ft\.?|with)\b/ig, ',')
    .split(/,|&|\+/)
    .map(part => searchTokens(part))
    .filter(tokens => tokens.length);
  return normalized.length ? normalized : [searchTokens(value)].filter(tokens => tokens.length);
}

function bestTokenCoverage(tokenGroups, text) {
  return tokenGroups.reduce((best, tokens) => Math.max(best, tokenCoverage(tokens, text)), 0);
}

function formatYtdlpError(raw, fallback) {
  const text = String(raw || '').trim();
  if (!text) return fallback;
  if (isYtdlpAgeRestrictedError(text)) {
    return 'YouTube requires sign-in/age confirmation for this video. Pick another candidate, or enable YouTube cookies in Settings.';
  }
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-3).join('\n').slice(0, 600) || fallback;
}

function isYtdlpAgeRestrictedError(raw) {
  return /sign in to confirm your age|inappropriate for some users|cookies-from-browser|pass cookies/i.test(String(raw || ''));
}

function getYtdlpAuthArgs() {
  const mode = appSettings.ytdlCookiesMode || 'none';
  if (mode === 'browser') {
    const allowed = new Set(['firefox', 'chrome', 'chromium', 'brave', 'edge', 'vivaldi', 'opera']);
    const browser = allowed.has(appSettings.ytdlCookiesBrowser) ? appSettings.ytdlCookiesBrowser : 'firefox';
    return ['--cookies-from-browser', browser];
  }
  if (mode === 'file') {
    const cookiePath = normalizePathInput(appSettings.ytdlCookiesFile || '');
    if (cookiePath && path.isAbsolute(cookiePath) && isExistingFileWithExt(cookiePath, ['.txt'])) return ['--cookies', cookiePath];
  }
  return [];
}

function getDownloadSearchCacheKey(meta, max) {
  return [
    normalizeSearchText(meta.title),
    normalizeSearchText(meta.artist),
    normalizeSearchText(meta.album),
    Math.round(Number(meta.duration || 0)),
    max,
  ].join('|');
}

function buildDownloadSearchQueries(meta) {
  const title = String(meta.title || '').trim();
  const artist = String(meta.artist || '').trim();
  const album = String(meta.album || '').trim();
  const queries = [
    `"${title}" "${artist}"`,
    `${artist} ${title}`,
    `${title} ${artist} topic`,
  ];
  if (album) queries.push(`${title} ${artist} ${album}`);
  queries.push(`${artist} ${title} official audio`);
  return Array.from(new Set(queries.map(q => q.replace(/\s+/g, ' ').trim()).filter(Boolean)));
}

function downloadCandidateScore(meta, candidate) {
  const expectedTitle = normalizeSearchText(meta.title);
  const expectedArtist = normalizeSearchText(meta.artist);
  const expectedAlbum = normalizeSearchText(meta.album);
  const titleTokens = searchTokens(meta.title);
  const artistGroups = searchArtistVariants(meta.artist);
  const title = normalizeSearchText(candidate.title || '');
  const uploader = normalizeSearchText(candidate.uploader || candidate.channel || '');
  const combined = `${title} ${uploader}`;
  const titleCoverage = tokenCoverage(titleTokens, title);
  const uploaderArtistCoverage = bestTokenCoverage(artistGroups, uploader);
  const titleArtistCoverage = bestTokenCoverage(artistGroups, title);
  const combinedArtistCoverage = bestTokenCoverage(artistGroups, combined);
  let score = 0;

  if (expectedTitle && title.includes(expectedTitle)) score += 58;
  else score += Math.round(titleCoverage * 34);

  if (expectedArtist && uploader.includes(expectedArtist)) score += 48;
  else score += Math.round(uploaderArtistCoverage * 44);
  if (!(expectedArtist && uploader.includes(expectedArtist)) && titleArtistCoverage >= 0.8) score += 12;
  else if (titleArtistCoverage >= 0.5) score += 6;

  if (expectedAlbum && combined.includes(expectedAlbum)) score += 8;
  if (/\btopic\b/.test(uploader) && uploaderArtistCoverage >= 0.8) score += 22;
  if (candidate.channelVerified && uploaderArtistCoverage >= 0.8) score += 6;
  if (/official audio|provided to youtube|auto generated|audio only/i.test(candidate.title || '')) score += 8;
  if (/official/i.test(candidate.uploader || candidate.channel || '')) score += 3;
  if (titleCoverage < 0.5) score -= 28;
  if (artistGroups.length && uploaderArtistCoverage < 0.45) score -= titleArtistCoverage >= 0.8 ? 34 : 26;
  if (artistGroups.length && combinedArtistCoverage < 0.45) score -= 14;
  if (/live|slowed|nightcore|sped up|remix|cover|karaoke|instrumental|sound effect|sfx|tutorial|photoshop|scam|compilation|mix -/i.test(candidate.title || '')) score -= 28;
  if (/sound effect|sfx|audio library|piximperfect/i.test(candidate.uploader || candidate.channel || '')) score -= 22;
  if (meta.duration && candidate.duration) {
    const diff = Math.abs(Number(candidate.duration) - Number(meta.duration));
    if (diff <= 3) score += 20;
    else if (diff <= 8) score += 12;
    else if (diff <= 20) score += 4;
    else score -= 18;
  }
  return score;
}

function candidateConfidence(score) {
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function normalizeImportTrackMeta(track) {
  track = track && typeof track === 'object' ? track : {};
  const title = track.title || track.Song || track.song || track.Name || track.name || track.TITLE || '';
  const artist = stripYoutubeTopicSuffix(track.artist || track.Artist || track.ARTIST || '');
  const album = track.album || track.Album || track.ALBUM || '';
  const albumArtist = stripYoutubeTopicSuffix(track.albumArtist || track.AlbumArtist || track['Album Artist'] || track.Album_Artist || '');
  const albumDate = track.albumDate || track['Album Date'] || track.AlbumDate || track.Year || track.year || '';
  const genre = track.genre || track.Genres || track.Genre || track.GENRE || '';
  const duration = parseDurationSeconds(track.duration || track.Duration || track.DURATION || '');
  const trackNo = parseTrackNumber(track.trackNo || track.TrackNo || track['Track No'] || track.TrackNumber || track['Track Number']);
  const discNo = parseTrackNumber(track.discNo || track.DiscNo || track['Disc No'] || track.DiscNumber || track['Disc Number']);
  const coverUrl = track.coverUrl || track.CoverUrl || track.Cover || track.Image || track.Artwork || track.thumbnailUrl || track.thumbnail || track.downloadThumbnail || '';
  const isrc = track.isrc || track.ISRC || '';
  const trackMbid = track.trackMbid || track.TrackMbid || track.recordingMbid || '';
  const downloadUrl = track.downloadUrl || track.webpageUrl || track.webpage_url || track.url || '';
  const videoId = track.videoId || track.VideoId || '';
  return { title, artist, album, albumArtist, albumDate, genre, duration, trackNo, discNo, coverUrl, isrc, trackMbid, downloadUrl, videoId };
}

async function resolveCanonicalDownloadMetadata(meta) {
  const canonical = normalizeImportTrackMeta(meta);
  // Album-context jobs already carry their canonical release metadata. Keeping
  // this early return also makes bulk album downloads network-independent.
  if (canonical.album) return canonical;
  const params = getLastfmTrackInfoParams(canonical);
  try {
    const response = await lastfmApiClient.request('track.getinfo', params);
    return enrichCanonicalDownloadMetadata(canonical, response).meta;
  } catch (error) {
    // Metadata enrichment must never turn an otherwise valid local download
    // into a network-dependent operation. The path helper keeps its Singles
    // fallback when no verified album can be resolved.
    console.warn('Could not enrich download metadata from Last.fm:', error && error.message ? error.message : error);
    return canonical;
  }
}

function buildDownloadTargetPath(track, rootFolder, extension) {
  const meta = normalizeImportTrackMeta(track);
  const root = normalizePathInput(rootFolder) || getDefaultDownloadFolder();
  if (!path.isAbsolute(root)) throw new Error('Download folder must be an absolute path');
  const artistFolder = sanitizePathSegment(meta.albumArtist || meta.artist, 'Unknown Artist');
  const albumFolder = sanitizePathSegment(meta.album || 'Singles', 'Singles');
  const title = sanitizePathSegment(meta.title, 'Unknown Track');
  const prefix = meta.trackNo ? String(meta.trackNo).padStart(2, '0') + ' - ' : '';
  const ext = String(extension || '.mp3').toLowerCase();
  if (!['.mp3', '.m4a', '.webm', '.opus', '.ogg'].includes(ext)) throw new Error('Unsupported downloaded audio container');
  return path.join(root, artistFolder, albumFolder, `${prefix}${title}${ext}`);
}

function normalizeDownloadDirectoryLabel(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201b\u02bc`]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase();
}

async function findUniqueNormalizedDownloadDirectory(parentDir, desiredName) {
  const desiredKey = normalizeDownloadDirectoryLabel(desiredName);
  if (!desiredKey) return null;
  let entries = [];
  try { entries = await fs.promises.readdir(parentDir, { withFileTypes: true }); }
  catch (_) { return null; }
  const matches = entries.filter((entry) => entry.isDirectory() && normalizeDownloadDirectoryLabel(entry.name) === desiredKey);
  // Never guess between two lookalike folders. The exact desired name is used
  // in that case, which keeps the download isolated rather than misfiling it.
  return matches.length === 1 ? matches[0].name : null;
}

async function resolveCanonicalDownloadAlbumDirectory(track, rootFolder) {
  const meta = normalizeImportTrackMeta(track);
  const root = normalizePathInput(rootFolder) || getDefaultDownloadFolder();
  if (!path.isAbsolute(root)) throw new Error('Download folder must be an absolute path');
  const desiredArtist = sanitizePathSegment(meta.albumArtist || meta.artist, 'Unknown Artist');
  const desiredAlbum = sanitizePathSegment(meta.album || 'Singles', 'Singles');
  const existingArtist = await findUniqueNormalizedDownloadDirectory(root, desiredArtist);
  const artistDir = path.join(root, existingArtist || desiredArtist);
  const existingAlbum = await findUniqueNormalizedDownloadDirectory(artistDir, desiredAlbum);
  return path.join(artistDir, existingAlbum || desiredAlbum);
}

// Paths picked as download targets but not created on disk yet; keeps two
// concurrent downloads of the same track from resolving to the same file.
const reservedDownloadPaths = new Set();
const downloadCreatedAlbumDirs = new Set();

async function ensureUniquePath(filePath, extraTaken) {
  const taken = (p) => fs.existsSync(p) || (extraTaken && extraTaken.has(p));
  if (!taken(filePath)) return filePath;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!taken(candidate)) return candidate;
  }
  throw new Error('Could not create a unique file path');
}

async function ensureSafeDownloadDirectory(root, targetDir) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(targetDir);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (relative.startsWith('..' + path.sep) || relative === '..' || path.isAbsolute(relative)) throw new Error('Download target escapes the selected folder');
  let current = resolvedRoot;
  const parts = relative ? relative.split(path.sep).filter(Boolean) : [];
  const rootStat = await fs.promises.lstat(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Download root must be a real directory, not a symbolic link');
  for (const part of parts) {
    current = path.join(current, part);
    try { await fs.promises.mkdir(current, { mode: 0o700 }); }
    catch (e) { if (e.code !== 'EEXIST') throw e; }
    const stat = await fs.promises.lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`Unsafe symbolic link or non-directory in download path: ${current}`);
  }
  return resolvedTarget;
}

async function finalizeDownloadedFile(sourcePath, targetPath) {
  const sourceStat = await fs.promises.lstat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error('Downloaded output is not a regular file');
  if (sourceStat.size > MAX_DOWNLOADED_AUDIO_BYTES) throw new Error('Downloaded audio exceeds the 512 MB output limit');
  let linkError = null;
  try {
    await fs.promises.link(sourcePath, targetPath);
  } catch (e) {
    if (e.code === 'EEXIST') throw e;
    linkError = e;
    const partialPath = path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.partial`);
    try {
      await fs.promises.copyFile(sourcePath, partialPath, fs.constants.COPYFILE_EXCL);
      await fs.promises.rename(partialPath, targetPath);
    }
    catch (copyError) {
      await fs.promises.rm(partialPath, { force: true }).catch(() => { });
      if (copyError.code === 'EEXIST') throw copyError;
      throw new Error(`Could not finalize download (link: ${linkError.message || linkError}; copy: ${copyError.message || copyError})`);
    }
  }
  await fs.promises.unlink(sourcePath).catch((e) => console.warn('Could not remove finalized download temp file:', e));
}

function normalizeStoredDownloadRecoveryRecords(records) {
  return normalizeDownloadRecoveryRecords(records, { isExistingAudioFile: (filePath) => isExistingFileWithExt(filePath, AUDIO_EXTENSIONS) });
}
async function addDownloadRecoveryRecord(record) {
  const existing = readJsonFile(DOWNLOAD_RECOVERY_FILE, []);
  const records = normalizeStoredDownloadRecoveryRecords(existing);
  await queueJsonWrite(DOWNLOAD_RECOVERY_FILE, normalizeStoredDownloadRecoveryRecords(records.filter((item) => item.id !== record.id).concat([record])));
}

// Remove .downloading temp dirs left behind by a crash (dir names start with a timestamp)
async function cleanupStaleDownloadTempDirs(root) {
  const base = path.join(root, '.downloading');
  try {
    const baseStat = await fs.promises.lstat(base);
    if (!baseStat.isDirectory() || baseStat.isSymbolicLink()) return;
  } catch (e) { return; }
  let entries;
  try { entries = await fs.promises.readdir(base, { withFileTypes: true }); } catch (e) { return; }
  const cutoff = Date.now() - 60 * 60 * 1000; // downloads time out after 10 min; 1h is safely stale
  for (const entry of entries) {
    const match = entry.name.match(/^(\d{13})-([0-9a-f]{8})$/);
    if (!match || !entry.isDirectory() || entry.isSymbolicLink()) continue;
    const full = path.join(base, entry.name);
    try {
      const stat = await fs.promises.lstat(full);
      const createdAt = Number(match[1]);
      if (stat.isDirectory() && !stat.isSymbolicLink() && createdAt < cutoff) await fs.promises.rm(full, { recursive: true, force: true });
    } catch (e) { }
  }
}

async function cleanupStaleDownloadPartialFiles(dirPath) {
  const cutoff = Date.now() - 60 * 60 * 1000;
  let entries;
  try { entries = await fs.promises.readdir(dirPath, { withFileTypes: true }); } catch (_) { return; }
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !/^\..+\.\d+\.\d+\.partial$/i.test(entry.name)) continue;
    const candidate = path.join(dirPath, entry.name);
    try {
      const stat = await fs.promises.lstat(candidate);
      if (stat.isFile() && !stat.isSymbolicLink() && stat.mtimeMs < cutoff) await fs.promises.rm(candidate, { force: true });
    } catch (_) { }
  }
}

async function cleanupStaleDownloadArtifacts(root) {
  let rootStat;
  try { rootStat = await fs.promises.lstat(root); }
  catch (_) { return; }
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return;
  // Downloads are placed directly under the root or in Artist/Album folders.
  // Keep startup cleanup bounded and never traverse symbolic links.
  const pending = [{ dirPath: root, depth: 0 }];
  let visited = 0;
  while (pending.length && visited < 5000) {
    const current = pending.shift();
    visited++;
    await cleanupStaleDownloadPartialFiles(current.dirPath);
    if (current.depth >= 2) continue;
    let entries;
    try { entries = await fs.promises.readdir(current.dirPath, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === '.downloading') continue;
      pending.push({ dirPath: path.join(current.dirPath, entry.name), depth: current.depth + 1 });
      if (pending.length + visited >= 5000) break;
    }
  }
  await cleanupStaleDownloadTempDirs(root);
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd || undefined, shell: false, windowsHide: true });
    const processKey = options.processKey || '';
    if (processKey) activeYtdlpDownloads.set(processKey, child);
    let stdout = '';
    let stderr = '';
    const maxOutputChars = Math.max(1024, options.maxOutputChars || 8 * 1024 * 1024);
    let settled = false;
    let timedOut = false;
    const timeoutMs = options.timeoutMs || 0;
    const cleanup = () => {
      if (processKey && activeYtdlpDownloads.get(processKey) === child) activeYtdlpDownloads.delete(processKey);
    };
    let timer = null;
    let forceKillTimer = null;
    const clearTimers = () => {
      if (timer) clearTimeout(timer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
    };
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        timedOut = true;
        try { child.kill('SIGTERM'); } catch (e) { }
        forceKillTimer = setTimeout(() => {
          if (settled) return;
          try { child.kill('SIGKILL'); } catch (e) { }
        }, 3000);
        forceKillTimer.unref();
      }, timeoutMs);
    }
    child.stdout.on('data', (d) => { const s = d.toString(); if (stdout.length < maxOutputChars) stdout += s.slice(0, maxOutputChars - stdout.length); if (options.onStdout) options.onStdout(s); });
    child.stderr.on('data', (d) => { const s = d.toString(); if (stderr.length < maxOutputChars) stderr += s.slice(0, maxOutputChars - stderr.length); if (options.onStderr) options.onStderr(s); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimers();
      cleanup();
      if (processKey && cancelledYtdlpDownloads.delete(processKey)) {
        resolve({ ok: false, cancelled: true, code: -1, stdout, stderr: stderr || 'Cancelled' });
        return;
      }
      resolve({ ok: false, timedOut, code: -1, stdout, stderr: timedOut ? (stderr || 'Timed out') : (err.message || String(err)), error: err });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimers();
      cleanup();
      if (processKey && cancelledYtdlpDownloads.delete(processKey)) {
        resolve({ ok: false, cancelled: true, code, stdout, stderr: stderr || 'Cancelled' });
        return;
      }
      if (timedOut) {
        resolve({ ok: false, timedOut: true, code, stdout, stderr: stderr || 'Timed out' });
        return;
      }
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

function normalizeRadioResolverRequestId(value) {
  const id = String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return id ? `radio_${id}` : '';
}

async function runRadioYtdlp(args, requestId) {
  const key = normalizeRadioResolverRequestId(requestId);
  if (!key) throw new Error('Invalid radio resolver request ID.');
  if (activeRadioResolverRequests.has(key) || activeYtdlpDownloads.has(key)) throw new Error('A radio resolver request is already active.');
  activeRadioResolverRequests.add(key);
  try {
    const debugCandidate = radioDebugRequests.get(String(requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80));
    const isSearch = String(args && args[0] || '').startsWith('ytsearch');
    if (isSearch && debugCandidate) {
      debugCandidate.searches++;
      if (debugCandidate.radioDebug) {
      radioDebug('youtube-search-start', { requestId: String(requestId || '').slice(0, 80), artist: radioDebugText(debugCandidate && debugCandidate.artist, 240), title: radioDebugText(debugCandidate && debugCandidate.title, 240) });
      }
    }
    const result = await runProcess('yt-dlp', ['--ignore-config', '--no-playlist', ...getYtdlpAuthArgs(), ...args], {
      timeoutMs: 90 * 1000,
      processKey: key,
      maxOutputChars: 4 * 1024 * 1024,
    });
    if (result.cancelled) throw new Error('Radio resolver request cancelled.');
    if (!result.ok) {
      if (isSearch && debugCandidate && debugCandidate.radioDebug) radioDebug('youtube-search-result', { requestId: String(requestId || '').slice(0, 80), exitCode: result.code, parsedResultCount: 0 });
      throw new Error(formatYtdlpError(result.stderr || result.stdout, result.timedOut ? 'yt-dlp timed out.' : 'yt-dlp could not resolve this track.'));
    }
    const text = String(result.stdout || '');
    if (!text || text.length > 4 * 1024 * 1024) throw new Error('yt-dlp returned invalid resolver data.');
    let data;
    try { data = require('./radio-stream-resolver').parseSearchPayload(text); } catch (_) { throw new Error('yt-dlp returned malformed resolver data.'); }
    if (!data || typeof data !== 'object') throw new Error('yt-dlp returned malformed resolver data.');
    if (isSearch && debugCandidate && debugCandidate.radioDebug) radioDebug('youtube-search-result', { requestId: String(requestId || '').slice(0, 80), exitCode: result.code, parsedResultCount: Array.isArray(data.entries) ? data.entries.length : 0 });
    return data;
  } finally {
    activeRadioResolverRequests.delete(key);
  }
}

function cancelRadioResolverRequest(requestId) {
  const key = normalizeRadioResolverRequestId(requestId);
  if (!key) return false;
  const child = activeYtdlpDownloads.get(key);
  if (!child) return false;
  cancelledYtdlpDownloads.add(key);
  try { child.kill('SIGTERM'); } catch (_) { return false; }
  const forceKill = setTimeout(() => { try { if (activeYtdlpDownloads.get(key) === child) child.kill('SIGKILL'); } catch (_) { } }, 3000);
  forceKill.unref();
  return true;
}

function isAllowedRadioStreamUrl(value) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      && Array.from(RADIO_STREAM_HOSTS).some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch (_) { return false; }
}

function initializeRadioStreamResolver() {
  const cache = new DurableMatchCache({
    write(entries) { return queueJsonWrite(RADIO_MATCH_CACHE_FILE, entries); },
  });
  cache.hydrate(readJsonFile(RADIO_MATCH_CACHE_FILE, []));
  radioStreamResolver = createRadioStreamResolver({
    matchCache: cache,
    runYtdlp: runRadioYtdlp,
    cancel: cancelRadioResolverRequest,
    onDiagnostic(diagnostic) {
      const candidate = diagnostic && diagnostic.candidate;
      const traced = Array.from(radioDebugRequests.values()).some((entry) => entry.radioDebug && entry.artist === (candidate && candidate.artist) && entry.title === (candidate && candidate.title));
      if (traced) radioDebug('youtube-match', { accepted: false, score: Number(diagnostic && diagnostic.score) || 0, reason: radioDebugText(diagnostic && diagnostic.reason, 120), videoId: '', artist: radioDebugText(candidate && candidate.artist, 240), title: radioDebugText(candidate && candidate.title, 240) });
    },
  });
}

function registerRadioStreamProtocol() {
  protocol.handle(RADIO_STREAM_SCHEME, async (request) => {
    try {
      const parsed = new URL(request.url);
      if (parsed.hostname !== 'lease' || !/^\/[A-Za-z0-9_-]{20,}$/.test(parsed.pathname || '') || !radioStreamResolver) return new Response('Not found', { status: 404 });
      const lease = radioStreamResolver.getLease(parsed.pathname.slice(1), null);
      if (!lease || !isAllowedRadioStreamUrl(lease.url)) return new Response('Not found', { status: 404 });
      const headers = new Headers();
      Object.entries(lease.headers || {}).forEach(([key, value]) => {
        if (/^(user-agent|referer|origin|accept-language|cookie)$/i.test(key) && typeof value === 'string') headers.set(key, value);
      });
      const range = request.headers && typeof request.headers.get === 'function' ? request.headers.get('range') : '';
      if (range && /^bytes=\d*-\d*$/.test(range)) headers.set('range', range);
      const response = await net.fetch(lease.url, { method: 'GET', headers, redirect: 'error' });
      const forward = new Headers();
      ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control'].forEach((key) => { const value = response.headers.get(key); if (value) forward.set(key, value); });
      return new Response(response.body, { status: response.status, headers: forward });
    } catch (error) {
      console.warn('Radio stream proxy error:', error && error.message ? error.message : error);
      return new Response('Stream unavailable', { status: 502 });
    }
  });
}

async function writeDownloadedMp3Metadata(filePath, track, createFolderCover) {
  const meta = normalizeImportTrackMeta(track);
  const tags = {};
  const fileStat = await fs.promises.stat(filePath);
  if (!fileStat.isFile() || fileStat.size > MAX_METADATA_EDIT_BYTES) throw new Error('Downloaded MP3 is too large for metadata editing');
  let folderCover = null;
  if (meta.title) tags.title = meta.title;
  if (meta.artist) tags.artist = meta.artist;
  if (meta.album) tags.album = meta.album;
  if (meta.albumArtist) tags.performerInfo = meta.albumArtist;
  if (meta.albumDate) tags.year = String(meta.albumDate).slice(0, 4);
  if (meta.genre) tags.genre = meta.genre;
  if (meta.trackNo) tags.trackNumber = String(meta.trackNo);
  if (meta.discNo) tags.partOfSet = String(meta.discNo);
  if (meta.trackMbid) tags.userDefinedText = [{ description: 'MusicBrainz Track Id', value: String(meta.trackMbid).slice(0, 80) }];
  if (meta.coverUrl && /^https:\/\//i.test(meta.coverUrl)) {
    try {
      const cover = await fetchCachedCoverImage(meta.coverUrl);
      tags.image = {
        mime: cover.contentType.split(';')[0].trim().toLowerCase(),
        type: { id: 3, name: 'front cover' },
        description: '',
        imageBuffer: cover.imageBuffer,
      };
      if (createFolderCover && ['image/jpeg', 'image/jpg'].includes(tags.image.mime)) folderCover = cover.imageBuffer;
    } catch (e) {
      console.error('Failed to fetch downloaded track cover:', e);
    }
  }
  if (Object.keys(tags).length) {
    const result = NodeID3.update(tags, filePath);
    if (result !== true) throw (result instanceof Error ? result : new Error('MP3 metadata writer returned an invalid result'));
    const updatedStat = await fs.promises.stat(filePath);
    if (!updatedStat.isFile() || updatedStat.size > MAX_DOWNLOADED_AUDIO_BYTES) throw new Error('Downloaded MP3 exceeds the 512 MB output limit after metadata editing');
  }
  if (folderCover) {
    try { await fs.promises.writeFile(path.join(path.dirname(filePath), 'folder.jpg'), folderCover, { flag: 'wx' }); invalidateFolderCover(path.dirname(filePath)); }
    catch (e) { if (e.code !== 'EEXIST') console.error('Failed to write downloaded folder.jpg:', e); }
  }
}

function buildCanonicalDownloadTags(track) {
  const meta = normalizeImportTrackMeta(track);
  return {
    title: meta.title, artist: meta.artist, album: meta.album,
    performerInfo: meta.albumArtist, year: meta.albumDate ? String(meta.albumDate).slice(0, 4) : '',
    genre: meta.genre, trackNumber: meta.trackNo ? String(meta.trackNo) : '',
    discNumber: meta.discNo ? String(meta.discNo) : '', trackMbid: meta.trackMbid
  };
}

async function writeDownloadedArtworkSidecar(filePath, track, createFolderCover) {
  const meta = normalizeImportTrackMeta(track);
  if (!createFolderCover || !meta.coverUrl || !/^https:\/\//i.test(meta.coverUrl)) return;
  try {
    const cover = await fetchCachedCoverImage(meta.coverUrl);
    const mime = cover.contentType.split(';')[0].trim().toLowerCase();
    if (!['image/jpeg', 'image/jpg'].includes(mime)) return;
    await fs.promises.writeFile(path.join(path.dirname(filePath), 'folder.jpg'), cover.imageBuffer, { flag: 'wx' });
    invalidateFolderCover(path.dirname(filePath));
  } catch (e) { console.error('Failed to write native download folder artwork:', e); }
}

function ffmpegMetadataArgs(tags) {
  const values = [
    ['title', tags.title], ['artist', tags.artist], ['album', tags.album],
    ['album_artist', tags.performerInfo], ['date', tags.year], ['genre', tags.genre],
    ['track', tags.trackNumber], ['disc', tags.discNumber], ['musicbrainz_trackid', tags.trackMbid]
  ];
  const args = [];
  values.forEach(([key, value]) => { if (value !== null && value !== undefined && String(value) !== '') args.push('-metadata', `${key}=${String(value).slice(0, 4000)}`); });
  return args;
}

function ffmpegClearMetadataArgs(tags) {
  const values = [
    ['title', tags.title], ['artist', tags.artist], ['album', tags.album],
    ['album_artist', tags.performerInfo], ['date', tags.year], ['genre', tags.genre],
    ['track', tags.trackNumber], ['disc', tags.discNumber], ['musicbrainz_trackid', tags.trackMbid]
  ];
  const args = [];
  values.forEach(([key, value]) => { if (value === '') args.push('-metadata', `${key}=`); });
  return args;
}

function ffmpegVorbisMetadataArgs(metadata, replacementTags) {
  const nativeTags = metadata && metadata.native && Array.isArray(metadata.native.vorbis) ? metadata.native.vorbis : [];
  const replacedNames = new Set();
  const replacements = [
    ['title', ['TITLE']],
    ['artist', ['ARTIST']],
    ['album', ['ALBUM']],
    ['performerInfo', ['ALBUMARTIST', 'ALBUM_ARTIST', 'ALBUM ARTIST']],
    ['year', ['DATE', 'YEAR']],
    ['genre', ['GENRE']],
    ['trackNumber', ['TRACKNUMBER', 'TRACK']],
    ['discNumber', ['DISCNUMBER', 'DISC']],
    ['trackMbid', ['MUSICBRAINZ_TRACKID', 'MUSICBRAINZ_TRACK_ID']]
  ];
  replacements.forEach(([field, names]) => {
    if (replacementTags && replacementTags[field] !== undefined) names.forEach(name => replacedNames.add(name));
  });
  const args = [];
  nativeTags.forEach((tag) => {
    const name = String(tag && tag.id || '').trim();
    const value = tag && tag.value;
    // Picture blocks are binary values, not ordinary comments. ffmpeg carries
    // cover streams separately via -map 0, so never turn one into text.
    if (!name || replacedNames.has(name.toUpperCase()) || typeof value !== 'string' || !value) return;
    args.push('-metadata', `${name.toLowerCase()}=${value.slice(0, 4000)}`);
  });
  return args;
}

async function remuxWebmOpusToOpus(sourcePath, outputPath, processKey) {
  const result = await runProcess('ffmpeg', ['-y', '-i', sourcePath, '-map', '0:a:0', '-c:a', 'copy', '-f', 'opus', outputPath], { timeoutMs: 60 * 1000, processKey });
  if (result.cancelled) throw new Error('Download cancelled.');
  if (!result.ok) throw new Error(formatYtdlpError(result.stderr || result.stdout, 'Could not remux WebM/Opus without re-encoding.'));
  const stat = await fs.promises.lstat(outputPath);
  if (!stat.isFile() || stat.isSymbolicLink() || !stat.size) throw new Error('Opus remux did not produce a valid audio file.');
}

async function updateStreamCopyMetadata(filePath, tags) {
  const ext = path.extname(filePath).toLowerCase();
  if (!['.opus', '.ogg', '.m4a'].includes(ext)) throw new Error('This native container is not supported for safe metadata editing.');
  const originalStat = await fs.promises.lstat(filePath);
  if (!originalStat.isFile() || originalStat.isSymbolicLink() || originalStat.size > MAX_METADATA_EDIT_BYTES) throw new Error('Native audio file cannot be safely edited.');
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp${ext}`);
  try {
    // -c copy is the guarantee: ffmpeg only remuxes metadata/container bytes.
    // For Ogg/Opus, `-map_metadata 0` wins over later `-metadata` arguments
    // in FFmpeg and leaves the old Vorbis comment in place. Rebuild the text
    // comments instead: retain unrelated ones, omit fields being changed, and
    // write one authoritative replacement value.
    const isVorbisContainer = ext === '.opus' || ext === '.ogg';
    const sourceMetadata = isVorbisContainer ? await mm.parseFile(filePath, { duration: false, skipCovers: true }) : null;
    const metadataArgs = isVorbisContainer ? ffmpegVorbisMetadataArgs(sourceMetadata, tags) : [];
    const mapMetadataArgs = isVorbisContainer ? ['-map_metadata', '-1'] : ['-map_metadata', '0'];
    const result = await runProcess('ffmpeg', ['-y', '-i', filePath, '-map', '0', ...mapMetadataArgs, '-c', 'copy', ...metadataArgs, ...ffmpegMetadataArgs(tags), ...ffmpegClearMetadataArgs(tags), tmpPath], { timeoutMs: 60 * 1000 });
    if (!result.ok) throw new Error(formatYtdlpError(result.stderr || result.stdout, 'Could not write native metadata without re-encoding.'));
    const stat = await fs.promises.lstat(tmpPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_METADATA_EDIT_BYTES) throw new Error('Edited native audio is invalid.');
    await preserveReplacementMode(tmpPath, originalStat);
    await fs.promises.rename(tmpPath, filePath);
  } catch (e) {
    await fs.promises.unlink(tmpPath).catch(() => { });
    throw e;
  }
  return true;
}

async function buildLibraryItemFromAudioFile(filePath, fileStat) {
  filePath = normalizePathInput(filePath);
  if (!isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) return null;
  if (!fileStat) fileStat = await fs.promises.stat(filePath);
  const filename = path.basename(filePath);
  const dirPath = path.dirname(filePath);
  try {
    const metadata = await mm.parseFile(filePath);
    const rg = getReplayGainFields(metadata);
    const albumName = metadata.common.album || 'Unknown Album';
    const artistName = metadata.common.artist || 'Unknown Artist';
    const albumArtistName = metadata.common.albumartist || (metadata.common.compilation ? 'Various Artists' : null);
    let pictureDataUrl = await findFallbackCover(dirPath);
    if (!pictureDataUrl && metadata.common.picture && metadata.common.picture.length > 0) {
      const coverHash = crypto.createHash('md5').update(albumName + (albumArtistName || artistName)).digest('hex');
      const coverFilePath = path.join(COVERS_DIR, `${coverHash}.jpg`);
      if (!fs.existsSync(coverFilePath)) await fs.promises.writeFile(coverFilePath, metadata.common.picture[0].data);
      pictureDataUrl = getSafeFileUrl(coverFilePath);
    }
    return {
      filePath,
      filename,
      title: metadata.common.title || path.parse(filename).name,
      artist: artistName,
      trackMbid: typeof metadata.common.musicbrainz_recordingid === 'string' ? metadata.common.musicbrainz_recordingid : '',
      albumArtist: albumArtistName,
      album: albumName,
      duration: metadata.format.duration || 0,
      codec: typeof metadata.format.codec === 'string' ? metadata.format.codec.slice(0, 120) : '',
      picture: pictureDataUrl,
      trackNo: (metadata.common.track && metadata.common.track.no) ? metadata.common.track.no : 0,
      trackTotal: (metadata.common.track && metadata.common.track.of) ? metadata.common.track.of : 0,
      discNo: (metadata.common.disk && metadata.common.disk.no) ? metadata.common.disk.no : 0,
      discTotal: (metadata.common.disk && metadata.common.disk.of) ? metadata.common.disk.of : 0,
      year: metadata.common.year || null,
      genre: metadata.common.genre ? metadata.common.genre[0] : null,
      replayGainTrackDb: rg.replayGainTrackDb,
      replayGainAlbumDb: rg.replayGainAlbumDb,
      replayGainTrackPeak: rg.replayGainTrackPeak,
      replayGainAlbumPeak: rg.replayGainAlbumPeak,
      fileSize: fileStat.size,
      modifiedAtMs: fileStat.mtimeMs,
      addedAtMs: fileStat.mtimeMs,
    };
  } catch (e) {
    return {
      filePath,
      filename,
      title: path.parse(filename).name,
      artist: 'Unknown Artist',
      albumArtist: null,
      album: 'Unknown Album',
      duration: 0,
      codec: '',
      picture: await findFallbackCover(dirPath),
      trackNo: 0,
      trackTotal: 0,
      discNo: 0,
      discTotal: 0,
      year: null,
      genre: null,
      replayGainTrackDb: null,
      replayGainAlbumDb: null,
      replayGainTrackPeak: null,
      replayGainAlbumPeak: null,
      fileSize: fileStat.size,
      modifiedAtMs: fileStat.mtimeMs,
      addedAtMs: fileStat.mtimeMs,
    };
  }
}

let settingsLoadError = null;
let settingsLoadedFromDisk = false;
function loadSettingsFromDisk() {
  // Settings are authoritative in memory after startup. Rehydrating on every
  // renderer load-settings request can otherwise overwrite a successful
  // Last.fm credential mutation while its atomic write is still queued.
  if (settingsLoadedFromDisk) return appSettings;
  try {
    let legacyListeningStats = null;
    if (fs.existsSync(SETTINGS_FILE)) {
      const settings = readAppDataFile(SETTINGS_FILE, {}, 'settings.json', (value) => {
        if (!isPlainObject(value)) throw new Error('expected an object');
        if (Object.prototype.hasOwnProperty.call(value, 'automaticBackupsEnabled') && typeof value.automaticBackupsEnabled !== 'boolean') {
          throw new Error('automaticBackupsEnabled must be a boolean');
        }
      });
      const loadedSettings = deserializeSettingsFromDisk(settings);
      const removedSpotifyCredentials = ['spotifyClientId', 'spotifyClientSecret'].some((key) => Object.prototype.hasOwnProperty.call(loadedSettings, key));
      for (const key of ['spotifyClientId', 'spotifyClientSecret']) {
        delete loadedSettings[key];
        delete preservedEncryptedSettings[key];
        undecryptableSettingKeys.delete(key);
      }
      if (Object.prototype.hasOwnProperty.call(loadedSettings, 'listeningStats')) {
        legacyListeningStats = loadedSettings.listeningStats;
        delete loadedSettings.listeningStats;
      }
      if (Object.prototype.hasOwnProperty.call(loadedSettings, 'playbackSession')) {
        try { loadedSettings.playbackSession = sanitizePlaybackSession(loadedSettings.playbackSession); }
        catch (e) {
          console.warn('Ignoring invalid playback session in settings.json:', e.message);
          delete loadedSettings.playbackSession;
        }
      }
      loadedSettings.radioPreferences = sanitizeRadioPreferencesForSettings(loadedSettings.radioPreferences);
      try { loadedSettings.radioBlocklist = sanitizeRadioBlocklistForSettings(loadedSettings.radioBlocklist); }
      catch (e) { console.warn('Ignoring invalid radio blocklist in settings.json:', e.message); loadedSettings.radioBlocklist = { version: 1, tracks: [], artists: [] }; }
      appSettings = { ...appSettings, ...loadedSettings };
      if (removedSpotifyCredentials) {
        // Spotify metadata lookup has been retired; remove old credentials
        // from the on-disk settings file during the next startup.
        persistSettingsStorage(appSettings).catch((error) => console.warn('Could not remove retired Spotify settings:', error.message || error));
      }
      if (fs.existsSync(LISTENING_STATS_FILE)) {
        const storedStats = readAppDataFile(LISTENING_STATS_FILE, {}, 'listening-stats.json', (value) => {
          if (!isPlainObject(value)) throw new Error('expected an object');
        });
        appSettings.listeningStats = sanitizeListeningStats(storedStats);
      } else if (legacyListeningStats !== null) {
        appSettings.listeningStats = sanitizeListeningStats(legacyListeningStats);
        // Move the legacy embedded payload out of settings.json as soon as it
        // is safely validated. Future playback checkpoints then avoid writing
        // a growing settings document.
        persistSettingsStorage(appSettings).catch((error) => console.warn('Could not migrate listening stats:', error.message || error));
      }
      seedKnownTrackIndexFromSettings().catch((error) => console.warn('Could not seed known-track index:', error.message || error));
      scheduleLastfmKnownTrackSync();
    }
    settingsLoadError = null;
    settingsLoadedFromDisk = true;
  } catch (e) {
    settingsLoadError = e;
    console.error(e);
  }
  return appSettings;
}

function getSafeFileUrl(absolutePath) {
  return pathToFileURL(absolutePath).href;
}

function normalizePathInput(value) {
  if (typeof value !== 'string') return '';
  if (value.startsWith('file://')) {
    try { return fileURLToPath(value); }
    catch (e) { return ''; }
  }
  return value;
}

function isExistingDirectory(dirPath) {
  dirPath = normalizePathInput(dirPath);
  if (typeof dirPath !== 'string' || !path.isAbsolute(dirPath)) return false;
  try { return fs.statSync(dirPath).isDirectory(); }
  catch (e) { return false; }
}

function isExistingFileWithExt(filePath, extensions) {
  filePath = normalizePathInput(filePath);
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false;
  if (!extensions.includes(path.extname(filePath).toLowerCase())) return false;
  try { return fs.statSync(filePath).isFile(); }
  catch (e) { return false; }
}

function isManagedLibraryAudioFile(filePath) {
  filePath = normalizePathInput(filePath);
  if (!isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) return false;
  return getManagedLibraryAudioPaths().has(filePath);
}

function isAllowedImageUrl(value) {
  try {
    const parsed = new URL(String(value || ''));
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:'
      && !parsed.username
      && !parsed.password
      && (IMAGE_URL_HOSTS.has(host) || host.endsWith('.archive.org') || host.endsWith('.mzstatic.com') || host.endsWith('.dzcdn.net'));
  } catch (e) {
    return false;
  }
}

async function fetchAllowedImage(url, headers) {
  let currentUrl = String(url || '');
  for (let redirects = 0; redirects <= 4; redirects++) {
    if (!isAllowedImageUrl(currentUrl)) throw new Error('Unapproved image host');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const res = await fetch(currentUrl, { headers, redirect: 'manual', signal: controller.signal });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) throw new Error('Image redirect has no location');
        currentUrl = new URL(location, currentUrl).href;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.toLowerCase().startsWith('image/')) throw new Error(`not an image: ${contentType}`);
      const declaredSize = Number(res.headers.get('content-length') || 0);
      if (declaredSize > MAX_IMAGE_BYTES) throw new Error('Image is too large');
      if (!res.body) throw new Error('Image response has no body');
      const chunks = [];
      let total = 0;
      for await (const chunk of res.body) {
        total += chunk.length;
        if (total > MAX_IMAGE_BYTES) throw new Error('Image is too large');
        chunks.push(Buffer.from(chunk));
      }
      return { imageBuffer: Buffer.concat(chunks, total), contentType };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('Too many image redirects');
}

function readReplayGainValue(value) {
  if (!value) return null;
  if (typeof value.dB === 'number') return value.dB;
  if (typeof value === 'number') return value;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function readReplayGainPeak(value) {
  if (!value) return null;
  if (typeof value.ratio === 'number') return value.ratio;
  if (typeof value === 'number') return value;
  const match = String(value).match(/\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function getReplayGainFields(metadata) {
  const common = metadata && metadata.common ? metadata.common : {};
  const format = metadata && metadata.format ? metadata.format : {};
  return {
    replayGainTrackDb: readReplayGainValue(common.replaygain_track_gain) ?? readReplayGainValue(format.trackGain),
    replayGainAlbumDb: readReplayGainValue(common.replaygain_album_gain) ?? readReplayGainValue(format.albumGain),
    replayGainTrackPeak: readReplayGainPeak(common.replaygain_track_peak),
    replayGainAlbumPeak: readReplayGainPeak(common.replaygain_album_peak),
  };
}

async function loadImageBufferFromSource(source) {
  if (!source || typeof source !== 'string') return null;
  if (/^https:\/\//i.test(source)) {
    try { return (await fetchAllowedImage(source, { 'User-Agent': APP_USER_AGENT, 'Accept': 'image/*,*/*;q=0.8' })).imageBuffer; }
    catch (e) { return null; }
  }
  if (source.startsWith('data:image/')) {
    if (source.length > Math.ceil(MAX_IMAGE_BYTES * 4 / 3) + 1024) return null;
    const dataMatch = source.match(/^data:image\/[a-z0-9.+-]+;base64,/i);
    if (!dataMatch) return null;
    const base64Data = source.slice(dataMatch[0].length);
    const imageBuffer = Buffer.from(base64Data, 'base64');
    return imageBuffer.length <= MAX_IMAGE_BYTES ? imageBuffer : null;
  }
  let imagePath = source;
  if (source.startsWith('file://')) {
    try { imagePath = fileURLToPath(source); }
    catch (e) { return null; }
  }
  if (!isExistingFileWithExt(imagePath, IMAGE_EXTENSIONS)) return null;
  let handle = null;
  try {
    handle = await fs.promises.open(imagePath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) return null;
    const imageBuffer = Buffer.alloc(Math.min(MAX_IMAGE_BYTES + 1, stat.size + 1));
    let total = 0;
    while (total < imageBuffer.length) {
      const result = await handle.read(imageBuffer, total, imageBuffer.length - total, total);
      if (!result.bytesRead) break;
      total += result.bytesRead;
    }
    if (total !== stat.size) return null;
    return imageBuffer.subarray(0, total);
  } catch (e) {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => { });
  }
}

async function fetchImageBuffer(url) {
  return fetchAllowedImage(url, { 'User-Agent': APP_USER_AGENT, 'Accept': 'image/*,*/*;q=0.8' });
}

async function fetchCoverImageWithFallback(sourceUrl) {
  const urls = [sourceUrl];
  if (/\/front-\d+$/i.test(sourceUrl)) {
    urls.push(sourceUrl.replace(/\/front-\d+$/i, '/front-500'));
    urls.push(sourceUrl.replace(/\/front-\d+$/i, '/front-250'));
    urls.push(sourceUrl.replace(/\/front-\d+$/i, '/front'));
  }
  let lastError = null;
  for (const url of [...new Set(urls)]) {
    try { return await fetchImageBuffer(url); }
    catch (e) { lastError = e; }
  }
  throw lastError || new Error('cover unavailable');
}

async function fetchCachedCoverImage(sourceUrl) {
  const key = String(sourceUrl || '').trim();
  if (!key) throw new Error('cover URL missing');
  if (!metadataCoverCache.has(key)) {
    metadataCoverCache.set(key, fetchCoverImageWithFallback(key).catch(err => {
      metadataCoverCache.delete(key);
      throw err;
    }));
    if (metadataCoverCache.size > MAX_IMAGE_CACHE_ENTRIES) metadataCoverCache.delete(metadataCoverCache.keys().next().value);
  }
  return metadataCoverCache.get(key);
}

async function writeFolderJpgForTrack(filePath, imageSourceOrBuffer) {
  filePath = normalizePathInput(filePath);
  if (!isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) return false;
  const imageBuffer = Buffer.isBuffer(imageSourceOrBuffer) ? imageSourceOrBuffer : await loadImageBufferFromSource(imageSourceOrBuffer);
  if (!imageBuffer || !imageBuffer.length) return false;
  const folderJpgPath = path.join(path.dirname(filePath), 'folder.jpg');
  const tmpPath = path.join(path.dirname(filePath), `.folder.jpg.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.promises.writeFile(tmpPath, imageBuffer);
    await fs.promises.rename(tmpPath, folderJpgPath);
    invalidateFolderCover(path.dirname(filePath));
  } catch (e) {
    try { await fs.promises.unlink(tmpPath); } catch (_) { }
    throw e;
  }
  return true;
}

// Chromium and music-metadata both support the native YouTube audio outputs below.
// Keep this list aligned with the download finalizer so rescans see native downloads.
const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.m4a', '.webm', '.opus', '.ogg'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff', '.tif', '.gif', '.avif'];
const albumSizeCache = new Map();
const MAX_ALBUM_SIZE_CACHE_ENTRIES = 100;

function getLibraryAlbumKey(file) {
  return `${file && file.album || 'Unknown Album'}::${file && (file.albumArtist || file.artist) || 'Unknown Artist'}`;
}

function rememberAlbumSize(key, value) {
  albumSizeCache.delete(key);
  albumSizeCache.set(key, value);
  while (albumSizeCache.size > MAX_ALBUM_SIZE_CACHE_ENTRIES) albumSizeCache.delete(albumSizeCache.keys().next().value);
}

registerIpcHandler('load-library', () => {
  const library = readAppDataFile(LIBRARY_FILE, [], 'library.json', (value) => {
    if (!Array.isArray(value)) throw new Error('expected an array');
    validateBackupLibrary(value);
  });
  return library;
});

// The renderer may request only an already-indexed album identity. Paths are
// read from the persisted library here, so this IPC cannot become a path probe
// or arbitrary recursive filesystem traversal surface.
registerIpcHandler('get-album-size', async (event, albumId) => {
  albumId = typeof albumId === 'string' ? albumId.slice(0, 4000) : '';
  if (!albumId) return { bytes: null };
  const library = readAppDataFile(LIBRARY_FILE, [], 'library.json', (value) => { if (!Array.isArray(value)) throw new Error('expected an array'); });
  const tracks = library.filter((file) => file && typeof file.filePath === 'string' && getLibraryAlbumKey(file) === albumId);
  if (!tracks.length) return { bytes: null };
  const key = makeAlbumSizeKey(albumId, tracks);
  const cached = albumSizeCache.get(key);
  if (cached) return cached;
  const candidateRoot = getAlbumRoot(tracks.map((track) => track.filePath));
  // Do not treat a shared artist/library directory as a single album folder.
  // If indexed tracks from a different album live under the candidate root,
  // the calculator safely uses the unique-track fallback instead.
  const allowFolder = !!candidateRoot && !library.some((file) => file && typeof file.filePath === 'string' && getLibraryAlbumKey(file) !== albumId && isPathWithin(file.filePath, candidateRoot));
  const result = await calculateAlbumSize(tracks, { allowFolder });
  const value = { bytes: result.bytes, mode: result.mode };
  rememberAlbumSize(key, value);
  return value;
});

registerIpcHandler('invalidate-album-size-cache', () => { albumSizeCache.clear(); return true; });

registerIpcHandler('save-library', async (event, musicFiles) => {
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress || !Array.isArray(musicFiles)) return false;
  try {
    await queueJsonWrite(LIBRARY_FILE, musicFiles);
    invalidateManagedLibraryAudioPaths();
    setAutomaticBackupLibraryReady(musicFiles.length > 0);
    return true;
  }
  catch (e) { console.error('Failed to save library:', e); return false; }
});

registerIpcHandler('list-pending-download-recoveries', async () => {
  const existing = readJsonFile(DOWNLOAD_RECOVERY_FILE, []);
  const records = normalizeStoredDownloadRecoveryRecords(existing);
  if (!Array.isArray(existing) || records.length !== existing.length) await queueJsonWrite(DOWNLOAD_RECOVERY_FILE, records);
  return records;
});
registerIpcHandler('acknowledge-download-recovery', async (event, recoveryId) => {
  recoveryId = typeof recoveryId === 'string' ? recoveryId : '';
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(recoveryId)) return false;
  const existing = readJsonFile(DOWNLOAD_RECOVERY_FILE, []);
  await queueJsonWrite(DOWNLOAD_RECOVERY_FILE, normalizeStoredDownloadRecoveryRecords(existing).filter((item) => item.id !== recoveryId));
  return true;
});

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
registerIpcHandler('load-liked-songs', () => {
  if (!fs.existsSync(LIKED_SONGS_FILE)) return null;
  return sanitizeLikedSongs(readAppDataFile(LIKED_SONGS_FILE, [], 'liked-songs.json', () => {}));
});

registerIpcHandler('save-liked-songs', async (event, likedSongs) => {
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress || !Array.isArray(likedSongs)) return false;
  const safe = sanitizeLikedSongs(likedSongs);
  if (safe.length !== likedSongs.length) return false;
  try { await queueJsonWrite(LIKED_SONGS_FILE, safe); return true; }
  catch (e) { console.error('Failed to save liked songs:', e); return false; }
});

registerIpcHandler('export-backup', async (event, extras) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: `${APP_NAME} Backup`, extensions: ['json'] }],
    defaultPath: `${APP_ID}_backup_${stamp}.json`,
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  if (backupRestoreInProgress) return { ok: false, error: 'A restore is in progress.' };
  const operation = startExclusiveBackupOperation('manual', async () => {
    try {
      const built = await buildValidatedBackupPayload('manual', extras);
      await writeValidatedBackupFile(filePath, built);
      return { ok: true, filePath, summary: built.summary };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
  return operation || { ok: false, error: 'Another backup is already running.' };
});

registerIpcHandler('automatic-backup-status', async () => {
  try { await ensureAutomaticBackupHistoryLoaded(); }
  catch (e) {
    automaticBackupStatus.lastErrorAt = new Date().toISOString();
    automaticBackupStatus.lastError = `Could not inspect automatic backups: ${e.message || e}`.slice(0, 2000);
  }
  return getAutomaticBackupStatusSnapshot();
});

registerIpcHandler('automatic-backup-ready', (event, hasLibrary) => {
  if (typeof hasLibrary !== 'boolean') return false;
  setAutomaticBackupLibraryReady(hasLibrary);
  return true;
});

registerIpcHandler('run-automatic-backup', async () => {
  const result = await runAutomaticBackup();
  scheduleAutomaticBackup();
  return { ...result, status: getAutomaticBackupStatusSnapshot() };
});

registerIpcHandler('open-backup-folder', async () => {
  try {
    await ensureBackupDirectory();
    const error = await shell.openPath(BACKUPS_DIR);
    return error ? { ok: false, error } : { ok: true };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

registerIpcHandler('import-backup', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: `${APP_NAME} Backup`, extensions: ['json'] }],
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
  let handle = null;
  try {
    handle = await fs.promises.open(filePaths[0], 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_BACKUP_BYTES) throw new Error('Backup file is too large');
    const text = await handle.readFile({ encoding: 'utf8' });
    if (Buffer.byteLength(text, 'utf8') > MAX_BACKUP_BYTES) throw new Error('Backup file is too large');
    const data = validateBackupData(JSON.parse(text));
    const token = crypto.randomBytes(24).toString('hex');
    pendingBackupImports.clear();
    pendingBackupImports.set(token, { data, createdAt: Date.now() });
    setTimeout(() => pendingBackupImports.delete(token), BACKUP_TOKEN_TTL_MS).unref();
    return { ok: true, token, filePath: filePaths[0], summary: summarizeBackupData(data) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    if (handle) await handle.close().catch(() => { });
  }
});

registerIpcHandler('restore-backup', async (event, token) => {
  token = String(token || '');
  const pending = pendingBackupImports.get(token);
  if (!pending || Date.now() - pending.createdAt > BACKUP_TOKEN_TTL_MS) return { ok: false, error: 'Backup preview expired. Select the backup again.' };
  if (reservedDownloadRequestIds.size || activeYtdlpDownloads.size) return { ok: false, error: 'Wait for active downloads to finish before restoring a backup.' };
  if (activeMetadataWriteOperations || metadataWriteQueues.size) return { ok: false, error: 'Wait for metadata writes to finish before restoring a backup.' };
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress) return { ok: false, error: 'Another app-data maintenance operation is already running.' };
  await waitForActiveBackupOperation();
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress) return { ok: false, error: 'Another app-data maintenance operation is already running.' };
  if (reservedDownloadRequestIds.size || activeYtdlpDownloads.size) return { ok: false, error: 'Wait for active downloads to finish before restoring a backup.' };
  backupRestoreInProgress = true;
  try {
    const data = pending.data;
    let safetyWarning = '';
    try { await createSafetyBackup(); }
    catch (e) {
      safetyWarning = `The current app data could not be backed up before restore: ${e.message || e}`;
      console.warn(safetyWarning);
    }
    pendingBackupImports.delete(token);
    const restoredSettings = { minimizeToTray: false, useNativeTitleBar: false, ytdlCookiesMode: 'none', ytdlCookiesBrowser: 'firefox', ytdlCookiesFile: '', automaticBackupsEnabled: true, ...data.settings };
    for (const key of SENSITIVE_SETTING_KEYS) {
      if (appSettings[key]) restoredSettings[key] = appSettings[key];
    }
    const restoredLikedSongs = Array.isArray(data.likedSongs) ? data.likedSongs : readJsonFile(LIKED_SONGS_FILE, []);
    await waitForPendingDataWrites();
    const restoredStorage = splitSettingsForStorage(restoredSettings);
    await replaceJsonFilesTransaction([
      { filePath: LIBRARY_FILE, data: data.library },
      { filePath: PLAYLISTS_FILE, data: data.playlists },
      { filePath: MAPPINGS_FILE, data: data.mappings },
      { filePath: SETTINGS_FILE, data: restoredStorage.settingsSnapshot },
      { filePath: LISTENING_STATS_FILE, data: restoredStorage.listeningStats },
      { filePath: LIKED_SONGS_FILE, data: restoredLikedSongs },
    ]);
    invalidateManagedLibraryAudioPaths();
    appSettings = restoredSettings;
    setAutomaticBackupLibraryReady(data.library.length > 0);
    const warnings = await reconcileRestoredRuntime(restoredSettings);
    if (safetyWarning) warnings.unshift(safetyWarning);
    return { ok: true, summary: summarizeBackupData(data), likedSongs: restoredLikedSongs, warnings };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    backupRestoreInProgress = false;
  }
});

registerIpcHandler('restore-app-state', async (event, snapshot) => {
  if (reservedDownloadRequestIds.size || activeYtdlpDownloads.size) return { ok: false, error: 'Wait for active downloads to finish before undoing a backup restore.' };
  if (activeMetadataWriteOperations || metadataWriteQueues.size) return { ok: false, error: 'Wait for metadata writes to finish before restoring app state.' };
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress) return { ok: false, error: 'Another app-data maintenance operation is already running.' };
  await waitForActiveBackupOperation();
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress) return { ok: false, error: 'Another app-data maintenance operation is already running.' };
  if (reservedDownloadRequestIds.size || activeYtdlpDownloads.size) return { ok: false, error: 'Wait for active downloads to finish before undoing a backup restore.' };
  backupRestoreInProgress = true;
  try {
    const data = validateAppStateSnapshot(snapshot);
    try { await createSafetyBackup(); }
    catch (e) { throw new Error(`App-state restore canceled because the current app data could not be backed up safely: ${e.message || e}`); }
    const restoredSettings = { minimizeToTray: false, useNativeTitleBar: false, ytdlCookiesMode: 'none', ytdlCookiesBrowser: 'firefox', ytdlCookiesFile: '', automaticBackupsEnabled: true, ...data.settings };
    await waitForPendingDataWrites();
    const restoredStorage = splitSettingsForStorage(restoredSettings);
    await replaceJsonFilesTransaction([
      { filePath: LIBRARY_FILE, data: data.library },
      { filePath: PLAYLISTS_FILE, data: data.playlists },
      { filePath: MAPPINGS_FILE, data: data.mappings },
      { filePath: SETTINGS_FILE, data: restoredStorage.settingsSnapshot },
      { filePath: LISTENING_STATS_FILE, data: restoredStorage.listeningStats },
      { filePath: LIKED_SONGS_FILE, data: data.likedSongs },
    ]);
    invalidateManagedLibraryAudioPaths();
    appSettings = restoredSettings;
    setAutomaticBackupLibraryReady(data.library.length > 0);
    return { ok: true, warnings: await reconcileRestoredRuntime(restoredSettings) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    backupRestoreInProgress = false;
  }
});

registerIpcHandler('check-library-files', async (event, musicFiles) => {
  if (!Array.isArray(musicFiles)) return { ok: false, missing: [] };
  const missing = [];
  for (let i = 0; i < musicFiles.length; i++) {
    const file = musicFiles[i];
    const filePath = normalizePathInput(file && typeof file.filePath === 'string' ? file.filePath : '');
    if (!path.isAbsolute(filePath) || !AUDIO_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) continue;
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) missing.push(filePath);
    } catch (e) {
      missing.push(filePath);
    }
    if (i % 100 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  return { ok: true, missing };
});

function sendMovedFileRelinkProgress(event, payload) {
  try {
    if (event.sender && !event.sender.isDestroyed()) event.sender.send('moved-files:progress', payload);
  } catch (_) { }
}

function cleanupExpiredMovedFileRelinks() {
  const now = Date.now();
  for (const [token, preview] of pendingMovedFileRelinks) {
    if (!preview || now - preview.createdAt > MOVED_FILE_TOKEN_TTL_MS) pendingMovedFileRelinks.delete(token);
  }
  while (pendingMovedFileRelinks.size > 8) pendingMovedFileRelinks.delete(pendingMovedFileRelinks.keys().next().value);
}

function loadRelinkAppData() {
  const library = readAppDataFile(LIBRARY_FILE, [], 'library.json', (value) => {
    if (!Array.isArray(value)) throw new Error('expected an array');
    validateBackupLibrary(value);
  });
  const playlists = readAppDataFile(PLAYLISTS_FILE, [], 'playlists.json', (value) => {
    if (!Array.isArray(value)) throw new Error('expected an array');
    validateBackupPlaylists(value);
  });
  const mappings = readAppDataFile(MAPPINGS_FILE, {}, 'mappings.json', (value) => {
    if (!isPlainObject(value)) throw new Error('expected an object');
    validateBackupMappings(value);
  });
  const likedSongs = sanitizeLikedSongs(readAppDataFile(LIKED_SONGS_FILE, [], 'liked-songs.json', () => {}));
  return { library, playlists, mappings, likedSongs, settings: { ...appSettings, listeningStats: sanitizeListeningStats(appSettings.listeningStats || {}) } };
}

async function pathIsCurrentlyMissing(filePath) {
  try {
    const stat = await fs.promises.lstat(filePath);
    return !stat.isFile() || stat.isSymbolicLink();
  } catch (_) {
    return true;
  }
}

async function validateRelinkSearchRoot(folderPath) {
  if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) throw new Error('Search folder must be an absolute path');
  const resolved = path.resolve(folderPath);
  const stat = await fs.promises.lstat(resolved);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Search folder must be an existing regular directory, not a symbolic link');
  return resolved;
}

async function ensureRelinkPathHasNoSymlinks(root, filePath) {
  if (!isPathWithin(filePath, root)) throw new Error('Destination is outside the selected search folder');
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  const parts = relative.split(path.sep).filter(Boolean);
  let current = path.resolve(root);
  const rootStat = await fs.promises.lstat(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Search folder is no longer a regular directory');
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const stat = await fs.promises.lstat(current);
    if (stat.isSymbolicLink()) throw new Error(`Destination path contains a symbolic link: ${current}`);
    if (index === parts.length - 1) {
      if (!stat.isFile()) throw new Error(`Destination is not a regular file: ${current}`);
    } else if (!stat.isDirectory()) {
      throw new Error(`Destination parent is not a directory: ${current}`);
    }
  }
  const [realRoot, realFile] = await Promise.all([fs.promises.realpath(root), fs.promises.realpath(filePath)]);
  if (!isPathWithin(realFile, realRoot)) throw new Error('Destination resolves outside the selected search folder');
}

function movedFileCommitBlockReason() {
  if (reservedDownloadRequestIds.size || activeYtdlpDownloads.size) return 'Wait for active downloads to finish before applying moved-file links.';
  if (backupRestoreInProgress) return 'Wait for the backup restore to finish before applying moved-file links.';
  if (movedFileRelinkCommitInProgress) return 'Another moved-file relink is already being applied.';
  if (activeDataTransactionPromise) return 'Wait for the current app-data transaction to finish.';
  if (activeMetadataWriteOperations || metadataWriteQueues.size) return 'Wait for metadata writes to finish before applying moved-file links.';
  return '';
}

registerIpcHandler('moved-files:preview', async (event, requestedMissingPaths) => {
  try {
    cleanupExpiredMovedFileRelinks();
    if (!Array.isArray(requestedMissingPaths) || requestedMissingPaths.length > MAX_LIBRARY_TRACKS) {
      return { ok: false, error: 'Run Scan Missing Files before reviewing moved files.' };
    }
    if (backupRestoreInProgress || movedFileRelinkCommitInProgress || activeDataTransactionPromise || activeMetadataWriteOperations || metadataWriteQueues.size) {
      return { ok: false, error: 'Wait for app-data maintenance and metadata writes to finish before scanning.' };
    }
    await waitForPendingDataWrites();
    const data = loadRelinkAppData();
    const requested = new Set(requestedMissingPaths.filter(value => typeof value === 'string'));
    const missingFiles = [];
    for (const file of data.library) {
      if (!file || !requested.has(file.filePath) || !path.isAbsolute(file.filePath) || !AUDIO_EXTENSIONS.includes(path.extname(file.filePath).toLowerCase())) continue;
      if (await pathIsCurrentlyMissing(file.filePath)) missingFiles.push(file);
    }
    if (!missingFiles.length) return { ok: false, error: 'No scanned missing library entries remain. Run Scan Missing Files again.' };

    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
      title: 'Choose a Folder to Search for Moved Music',
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
    const searchRoot = await validateRelinkSearchRoot(filePaths[0]);
    const rawFiles = [];
    const failures = [];
    sendMovedFileRelinkProgress(event, { phase: 'discovering', label: 'Finding audio files', current: 0, total: 0 });
    await walkDir(searchRoot, AUDIO_EXTENSIONS, rawFiles, failures);

    const existingLibraryPaths = new Set(data.library.map(file => file && file.filePath).filter(Boolean).map(canonicalPath));
    const candidates = new Array(rawFiles.length);
    let nextIndex = 0;
    let completed = 0;
    sendMovedFileRelinkProgress(event, { phase: 'metadata', label: 'Reading candidate metadata', current: 0, total: rawFiles.length });
    async function candidateWorker() {
      while (true) {
        const index = nextIndex++;
        if (index >= rawFiles.length) return;
        const filePath = rawFiles[index];
        try {
          const fileStat = await fs.promises.lstat(filePath);
          if (!fileStat.isFile() || fileStat.isSymbolicLink() || existingLibraryPaths.has(canonicalPath(filePath))) continue;
          candidates[index] = await buildLibraryItemFromAudioFile(filePath, fileStat);
        } catch (e) {
          if (failures.length < 100) failures.push({ path: filePath, error: e && (e.code || e.message) ? (e.code || e.message) : String(e) });
        } finally {
          completed++;
          if (completed % 25 === 0 || completed === rawFiles.length) {
            sendMovedFileRelinkProgress(event, { phase: 'metadata', label: 'Reading candidate metadata', current: completed, total: rawFiles.length });
            await new Promise(resolve => setImmediate(resolve));
          }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, Math.max(1, rawFiles.length)) }, () => candidateWorker()));
    const scannedCandidates = candidates.filter(Boolean);
    const proposals = buildRelinkProposals(missingFiles, scannedCandidates, {
      oldRoots: Array.isArray(data.settings.libraryRoots) ? data.settings.libraryRoots : [],
      searchRoot,
    });
    const candidateRecords = new Map();
    const publicProposals = proposals.map((proposal) => {
      let candidateId = null;
      let newPath = '';
      if (proposal.candidate) {
        candidateId = crypto.randomBytes(18).toString('base64url');
        newPath = proposal.candidate.filePath;
        candidateRecords.set(candidateId, { oldPath: proposal.oldPath, candidate: proposal.candidate });
      }
      return {
        oldPath: proposal.oldPath,
        newPath,
        candidateId,
        title: proposal.title,
        artist: proposal.artist,
        album: proposal.album,
        confidence: proposal.confidence,
        reasons: proposal.reasons,
        ambiguous: proposal.ambiguous,
        ambiguityReasons: proposal.ambiguityReasons,
        autoSelected: proposal.autoSelected,
        score: proposal.score,
        secondBestScore: proposal.secondBestScore,
      };
    });
    const token = crypto.randomBytes(24).toString('base64url');
    const storedPreview = {
      createdAt: Date.now(),
      searchRoot,
      missingPaths: missingFiles.map(file => file.filePath),
      candidateRecords,
    };
    pendingMovedFileRelinks.set(token, storedPreview);
    setTimeout(() => {
      if (pendingMovedFileRelinks.get(token) === storedPreview) pendingMovedFileRelinks.delete(token);
    }, MOVED_FILE_TOKEN_TTL_MS).unref();
    cleanupExpiredMovedFileRelinks();
    sendMovedFileRelinkProgress(event, { phase: 'ready', label: 'Review ready', current: rawFiles.length, total: rawFiles.length });
    return {
      ok: true,
      token,
      searchRoot,
      proposals: publicProposals,
      summary: {
        missing: missingFiles.length,
        candidates: scannedCandidates.length,
        suggested: publicProposals.filter(proposal => proposal.candidateId).length,
        highConfidence: publicProposals.filter(proposal => proposal.autoSelected).length,
        ambiguous: publicProposals.filter(proposal => proposal.ambiguous).length,
      },
      warnings: failures.slice(0, 20).map(failure => `${failure.path}: ${failure.error}`),
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

registerIpcHandler('moved-files:cancel', (event, token) => {
  token = String(token || '');
  return token ? pendingMovedFileRelinks.delete(token) : false;
});

registerIpcHandler('moved-files:commit', async (event, token, selectedCandidateIds) => {
  token = String(token || '');
  cleanupExpiredMovedFileRelinks();
  const preview = pendingMovedFileRelinks.get(token);
  if (!preview || Date.now() - preview.createdAt > MOVED_FILE_TOKEN_TTL_MS) return { ok: false, error: 'Moved-file preview expired. Scan the search folder again.' };
  if (!Array.isArray(selectedCandidateIds) || !selectedCandidateIds.length || selectedCandidateIds.length > preview.candidateRecords.size) {
    return { ok: false, error: 'Select at least one proposed move to apply.' };
  }
  const selectedIds = Array.from(new Set(selectedCandidateIds.map(value => String(value || ''))));
  if (selectedIds.length !== selectedCandidateIds.length || selectedIds.some(id => !preview.candidateRecords.has(id))) {
    return { ok: false, error: 'The moved-file selection is invalid. Reopen the preview.' };
  }
  let blockedBy = movedFileCommitBlockReason();
  if (blockedBy) return { ok: false, error: blockedBy };
  await waitForActiveBackupOperation();
  blockedBy = movedFileCommitBlockReason();
  if (blockedBy) return { ok: false, error: blockedBy };

  movedFileRelinkCommitInProgress = true;
  try {
    if (activeMetadataWriteOperations || metadataWriteQueues.size || activeDataTransactionPromise || reservedDownloadRequestIds.size || activeYtdlpDownloads.size || backupRestoreInProgress) {
      throw new Error('Another write operation started. Wait for it to finish and apply the preview again.');
    }
    await waitForPendingDataWrites();
    sendMovedFileRelinkProgress(event, { phase: 'backup', label: 'Creating safety backup', current: 0, total: selectedIds.length });
    try { await createSafetyBackup(); }
    catch (e) { throw new Error(`Relink canceled because a safety backup could not be created: ${e.message || e}`); }
    await waitForPendingDataWrites();

    const data = loadRelinkAppData();
    const selectedRecords = selectedIds.map(id => preview.candidateRecords.get(id));
    const selectedOldPaths = new Set(selectedRecords.map(record => record.oldPath));
    if (selectedOldPaths.size !== selectedRecords.length) throw new Error('Each missing entry can only be linked once.');
    const currentLibraryByPath = new Map(data.library.map(file => [file && file.filePath, file]));
    const selectedDestinations = new Set(selectedRecords.map(record => canonicalPath(record.candidate.filePath)));
    if (selectedDestinations.size !== selectedRecords.length) throw new Error('Each destination can only be linked once.');
    for (const record of selectedRecords) {
      if (!currentLibraryByPath.has(record.oldPath)) throw new Error('The library changed after preview. Run Scan Missing Files again.');
      if (!(await pathIsCurrentlyMissing(record.oldPath))) throw new Error(`The original path is available again: ${record.oldPath}`);
      const destinationKey = canonicalPath(record.candidate.filePath);
      if (data.library.some(file => file && canonicalPath(file.filePath) === destinationKey && !selectedOldPaths.has(file.filePath))) {
        throw new Error(`Destination is already present in the library: ${record.candidate.filePath}`);
      }
    }

    const searchRoot = await validateRelinkSearchRoot(preview.searchRoot);
    const remap = {};
    const candidateByOldPath = new Map();
    const warnings = [];
    let completed = 0;
    for (const record of selectedRecords) {
      const destination = normalizePathInput(record.candidate.filePath);
      if (!path.isAbsolute(destination) || !AUDIO_EXTENSIONS.includes(path.extname(destination).toLowerCase())) {
        throw new Error('A proposed destination is no longer a supported absolute audio path.');
      }
      await ensureRelinkPathHasNoSymlinks(searchRoot, destination);
      const fileStat = await fs.promises.lstat(destination);
      if (!fileStat.isFile() || fileStat.isSymbolicLink()) throw new Error(`Destination is no longer a regular file: ${destination}`);
      const refreshed = await buildLibraryItemFromAudioFile(destination, fileStat);
      if (!refreshed) throw new Error(`Destination metadata could not be read: ${destination}`);
      if (Number(record.candidate.fileSize || 0) && Number(record.candidate.fileSize) !== Number(refreshed.fileSize || 0)) {
        warnings.push(`${destination} changed after preview; its latest metadata and file statistics were used.`);
      }
      remap[record.oldPath] = destination;
      candidateByOldPath.set(record.oldPath, refreshed);
      completed++;
      sendMovedFileRelinkProgress(event, { phase: 'validating', label: 'Revalidating selected files', current: completed, total: selectedIds.length });
    }

    const rootReplacements = inferRootReplacements(data.settings.libraryRoots, remap, {
      searchRoot,
      libraryPaths: data.library.map(file => file && file.filePath).filter(Boolean),
      missingPaths: preview.missingPaths,
    });
    const next = applyPathRemap(data, remap, { candidateByOldPath, rootReplacements });
    warnings.push(...next.warnings);
    validateBackupLibrary(next.library);
    validateBackupPlaylists(next.playlists);
    validateBackupMappings(next.mappings);
    if (!Array.isArray(next.likedSongs) || sanitizeLikedSongs(next.likedSongs).length !== next.likedSongs.length) throw new Error('Relink produced invalid liked-song data');
    if (!isPlainObject(next.settings)) throw new Error('Relink produced invalid settings data');

    sendMovedFileRelinkProgress(event, { phase: 'commit', label: 'Applying path updates atomically', current: selectedIds.length, total: selectedIds.length });
    const relinkedStorage = splitSettingsForStorage(next.settings);
    await replaceJsonFilesTransaction([
      { filePath: LIBRARY_FILE, data: next.library },
      { filePath: PLAYLISTS_FILE, data: next.playlists },
      { filePath: MAPPINGS_FILE, data: next.mappings },
      { filePath: SETTINGS_FILE, data: relinkedStorage.settingsSnapshot },
      { filePath: LISTENING_STATS_FILE, data: relinkedStorage.listeningStats },
      { filePath: LIKED_SONGS_FILE, data: next.likedSongs },
    ]);
    invalidateManagedLibraryAudioPaths();
    appSettings = next.settings;
    setAutomaticBackupLibraryReady(next.library.length > 0);
    pendingMovedFileRelinks.delete(token);
    return {
      ok: true,
      count: selectedIds.length,
      remap,
      rootReplacements,
      warnings,
    };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  } finally {
    movedFileRelinkCommitInProgress = false;
  }
});

// Back-fill lightweight metadata and missing durations for existing library files.
registerIpcHandler('backfill-metadata', async (event, musicFiles) => {
  if (!Array.isArray(musicFiles)) return { ok: false, updates: [] };
  const updates = [];
  const metadataFields = ['trackMbid', 'year', 'genre', 'discNo', 'discTotal', 'trackTotal', 'replayGainTrackDb', 'replayGainAlbumDb', 'replayGainTrackPeak', 'replayGainAlbumPeak'];
  const candidates = musicFiles.filter((f) => {
    if (!f || typeof f !== 'object') return false;
    return !(Number(f.duration) > 0) || metadataFields.some((field) => f[field] === null || f[field] === undefined);
  });
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const f = candidates[nextIndex++];
      if (!f) return;
    if (!f || typeof f !== 'object') continue;
    const filePath = normalizePathInput(f.filePath);
    if (!filePath || !path.isAbsolute(filePath)) continue;
    if (!isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) continue;
    const patch = { filePath };
    const durationMissing = !(Number(f.duration) > 0);
    if (durationMissing || metadataFields.some((field) => f[field] === null || f[field] === undefined)) {
      try {
        const metadata = await mm.parseFile(filePath, { duration: durationMissing });
        const rg = getReplayGainFields(metadata);
        const values = {
          duration: Number(metadata.format.duration) || 0,
          trackMbid: typeof metadata.common.musicbrainz_recordingid === 'string' ? metadata.common.musicbrainz_recordingid : '',
          year: metadata.common.year || null,
          genre: metadata.common.genre ? metadata.common.genre[0] : null,
          discNo: metadata.common.disk && metadata.common.disk.no ? metadata.common.disk.no : 0,
          discTotal: metadata.common.disk && metadata.common.disk.of ? metadata.common.disk.of : 0,
          trackTotal: metadata.common.track && metadata.common.track.of ? metadata.common.track.of : 0,
          replayGainTrackDb: rg.replayGainTrackDb,
          replayGainAlbumDb: rg.replayGainAlbumDb,
          replayGainTrackPeak: rg.replayGainTrackPeak,
          replayGainAlbumPeak: rg.replayGainAlbumPeak,
        };
        for (const field of metadataFields) {
          if (f[field] === null || f[field] === undefined) patch[field] = values[field];
        }
        if (durationMissing && values.duration > 0) patch.duration = values.duration;
      } catch (e) { }
    }
    if (Object.keys(patch).length > 1) updates.push(patch);
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, candidates.length) }, () => worker()));
  return { ok: true, updates };
});

registerIpcHandler('load-playlists', () => {
  return readAppDataFile(PLAYLISTS_FILE, [], 'playlists.json', (value) => {
    if (!Array.isArray(value)) throw new Error('expected an array');
    validateBackupPlaylists(value);
  });
});

registerIpcHandler('save-playlists', async (event, playlists) => {
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress || !Array.isArray(playlists)) return false;
  try { await queueJsonWrite(PLAYLISTS_FILE, playlists); return true; }
  catch (e) { console.error('Failed to save playlists:', e); return false; }
});

registerIpcHandler('load-mappings', () => {
  return readAppDataFile(MAPPINGS_FILE, {}, 'mappings.json', (value) => {
    if (!isPlainObject(value)) throw new Error('expected an object');
    validateBackupMappings(value);
  });
});

registerIpcHandler('save-mappings', async (event, mappings) => {
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress || !mappings || typeof mappings !== 'object' || Array.isArray(mappings)) return false;
  try { await queueJsonWrite(MAPPINGS_FILE, mappings); return true; }
  catch (e) { console.error('Failed to save mappings:', e); return false; }
});

registerIpcHandler('load-settings', () => {
  loadSettingsFromDisk();
  if (settingsLoadError) throw settingsLoadError;
  if (appSettings && appSettings.discordRpc) {
    discordConnect();
  }
  const rendererSettings = { ...redactLastfmCredentials(appSettings), lastfmConnected: !!appSettings.lastfmSessionKey };
  delete rendererSettings.listeningStats;
  return rendererSettings;
});

registerIpcHandler('load-listening-stats', () => {
  loadSettingsFromDisk();
  if (settingsLoadError) throw settingsLoadError;
  return isPlainObject(appSettings.listeningStats) ? appSettings.listeningStats : {};
});

registerIpcHandler('save-listening-stats', async (event, listeningStats) => {
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress) return false;
  try {
    const sanitized = sanitizeListeningStats(listeningStats);
    appSettings.listeningStats = sanitized;
    await queueJsonWrite(LISTENING_STATS_FILE, sanitized);
    return true;
  } catch (e) {
    console.error('Failed to save listening stats:', e);
    return false;
  }
});

registerIpcHandler('save-settings', async (event, settings) => {
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress || !settings || typeof settings !== 'object' || Array.isArray(settings)) return false;
  try {
    const wasDiscord = appSettings.discordRpc;
    const wasAutomaticBackupsEnabled = appSettings.automaticBackupsEnabled === true;
    if (Object.prototype.hasOwnProperty.call(settings, 'automaticBackupsEnabled') && typeof settings.automaticBackupsEnabled !== 'boolean') return false;
    // Renderer settings are redacted. Merge ordinary settings while retaining
    // main-only Last.fm credentials from the authoritative main state.
    const beforeMergeSnapshot = serializeSettingsForDisk(appSettings);
    const validatedSettings = { automaticBackupsEnabled: true, ...mergeRendererSettings(appSettings, settings) };
    if (Object.prototype.hasOwnProperty.call(validatedSettings, 'playbackSession')) {
      validatedSettings.playbackSession = sanitizePlaybackSession(validatedSettings.playbackSession);
    }
    sanitizeImportedSettings(sanitizeSettingsForBackup(validatedSettings));
    const stored = splitSettingsForStorage(validatedSettings);
    lastfmDebug('renderer-save-merge', { before: lastfmEncryptedFieldPresence(beforeMergeSnapshot), afterMerge: lastfmEncryptedFieldPresence(stored.settingsSnapshot), settingsPath: SETTINGS_FILE });
    await Promise.all([
      queueJsonWrite(SETTINGS_FILE, stored.settingsSnapshot),
      queueJsonWrite(LISTENING_STATS_FILE, stored.listeningStats),
    ]);
    lastfmDebug('renderer-save-completed', { disk: lastfmEncryptedFieldPresence(readAppDataFile(SETTINGS_FILE, {}, 'settings.json')), settingsPath: SETTINGS_FILE });
    appSettings = validatedSettings;
    if (validatedSettings.automaticBackupsEnabled !== wasAutomaticBackupsEnabled) {
      if (validatedSettings.automaticBackupsEnabled) scheduleAutomaticBackup();
      else cancelAutomaticBackupSchedule();
    }
    // Handle Discord toggle
    if (validatedSettings.discordRpc && !wasDiscord) discordConnect();
    else if (!validatedSettings.discordRpc && wasDiscord) { discordClear(); if (discordClient) { try { discordClient.destroy(); } catch (e) { } discordClient = null; discordEnabled = false; } }
    return true;
  }
  catch (e) { console.error('Failed to save settings:', e); return false; }
});

registerIpcHandler('safe-storage-status', () => {
  return {
    encryptionAvailable: isSecureStorageAvailable(),
    backend: typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : '',
  };
});

registerIpcHandler('clear-sensitive-setting', async (event, key) => {
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress) return false;
  key = String(key || '');
  if (!SENSITIVE_SETTING_KEYS.includes(key)) return false;
  delete preservedEncryptedSettings[key];
  undecryptableSettingKeys.delete(key);
  appSettings[key] = '';
  try { await persistSettingsStorage(appSettings); return true; }
  catch (e) { console.error('Failed to clear sensitive setting:', key, e); return false; }
});

// Discord RPC IPC handlers
registerIpcHandler('discord-update', async (event, title, artist, album, startTime) => {
  await discordSetActivity(title, artist, album, startTime);
  return true;
});
registerIpcHandler('discord-clear', async () => {
  await discordClear();
  return true;
});
registerIpcHandler('discord-status', () => { return { enabled: discordEnabled, error: discordLastError }; });

registerIpcHandler('get-metadata', async (event, filePath) => {
  filePath = normalizePathInput(filePath);
  if (!isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) return null;
  try {
    const metadata = await mm.parseFile(filePath);
    const rg = getReplayGainFields(metadata);
    return {
      // Return the identity fields too. The renderer uses this immediately
      // after a write, so it must reflect what the audio file actually says
      // rather than trusting a metadata writer's success result.
      title: metadata.common.title || null,
      artist: metadata.common.artist || null,
      album: metadata.common.album || null,
      year: metadata.common.year || null,
      codec: metadata.format.codec || null,
      bitrate: metadata.format.bitrate || null,
      sampleRate: metadata.format.sampleRate || null,
      genre: metadata.common.genre ? metadata.common.genre.join(', ') : null,
      albumartist: metadata.common.albumartist || null,
      discNo: metadata.common.disk && metadata.common.disk.no ? metadata.common.disk.no : 0,
      discTotal: metadata.common.disk && metadata.common.disk.of ? metadata.common.disk.of : 0,
      trackNo: metadata.common.track && metadata.common.track.no ? metadata.common.track.no : 0,
      trackTotal: metadata.common.track && metadata.common.track.of ? metadata.common.track.of : 0,
      replayGainTrackDb: rg.replayGainTrackDb,
      replayGainAlbumDb: rg.replayGainAlbumDb,
      replayGainTrackPeak: rg.replayGainTrackPeak,
      replayGainAlbumPeak: rg.replayGainAlbumPeak
    };
  } catch (e) {
    return null;
  }
});

function setFlacTag(flac, name, value) {
  if (value === null || value === undefined) return;
  const upper = name.toUpperCase();
  flac.tags = flac.tags.filter(item => item.split('=')[0].toUpperCase() !== upper);
  if (value === '') return;
  flac.tags.push(`${upper}=${String(value)}`);
}

function buildVorbisComment(vendorString, comments) {
  const vendor = Buffer.from(vendorString || APP_ID, 'utf8');
  const vendorLen = Buffer.alloc(4);
  vendorLen.writeUInt32LE(vendor.length, 0);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(comments.length, 0);
  const parts = [vendorLen, vendor, count];
  comments.forEach(comment => {
    const body = Buffer.from(comment, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(body.length, 0);
    parts.push(len, body);
  });
  return Buffer.concat(parts);
}

function parseVorbisComment(block) {
  let offset = 0;
  if (!block || block.length < 8) return { vendor: APP_ID, tags: [] };
  const vendorLen = block.readUInt32LE(offset); offset += 4;
  const vendor = block.slice(offset, offset + vendorLen).toString('utf8'); offset += vendorLen;
  if (offset + 4 > block.length) return { vendor, tags: [] };
  const count = block.readUInt32LE(offset); offset += 4;
  const tags = [];
  for (let i = 0; i < count && offset + 4 <= block.length; i++) {
    const len = block.readUInt32LE(offset); offset += 4;
    if (offset + len > block.length) break;
    tags.push(block.slice(offset, offset + len).toString('utf8'));
    offset += len;
  }
  return { vendor, tags };
}

function buildFlacPictureBlock(image) {
  const mime = Buffer.from((image.mime || 'image/jpeg').split(';')[0], 'ascii');
  const description = Buffer.alloc(0);
  const data = image.imageBuffer;
  const pictureType = Buffer.alloc(4);
  const mimeLength = Buffer.alloc(4);
  const descriptionLength = Buffer.alloc(4);
  const width = Buffer.alloc(4);
  const height = Buffer.alloc(4);
  const depth = Buffer.alloc(4);
  const colors = Buffer.alloc(4);
  const pictureLength = Buffer.alloc(4);
  pictureType.writeUInt32BE(3, 0);
  mimeLength.writeUInt32BE(mime.length, 0);
  descriptionLength.writeUInt32BE(description.length, 0);
  width.writeUInt32BE(0, 0);
  height.writeUInt32BE(0, 0);
  depth.writeUInt32BE(0, 0);
  colors.writeUInt32BE(0, 0);
  pictureLength.writeUInt32BE(data.length, 0);
  return Buffer.concat([pictureType, mimeLength, mime, descriptionLength, description, width, height, depth, colors, pictureLength, data]);
}

function buildFlacMetadataBlock(type, data, isLast) {
  if (data.length > 0xffffff) throw new Error('FLAC metadata block is too large');
  const header = Buffer.alloc(4);
  header[0] = (isLast ? 0x80 : 0) | (type & 0x7f);
  header.writeUIntBE(data.length, 1, 3);
  return Buffer.concat([header, data]);
}

async function updateFlacMetadata(filePath, tags) {
  const originalStat = await fs.promises.stat(filePath);
  if (!originalStat.isFile() || originalStat.size > MAX_METADATA_EDIT_BYTES) throw new Error('FLAC file exceeds the 512 MB metadata editing limit');
  const input = await fs.promises.readFile(filePath);
  const markerOffset = input.indexOf(Buffer.from('fLaC'));
  if (markerOffset < 0) throw new Error('FLAC marker not found');
  const prefix = input.slice(0, markerOffset);
  let offset = markerOffset + 4;
  const blocks = [];
  while (offset + 4 <= input.length) {
    const first = input[offset];
    const isLast = !!(first & 0x80);
    const type = first & 0x7f;
    const length = input.readUIntBE(offset + 1, 3);
    offset += 4;
    if (offset + length > input.length) throw new Error('Invalid FLAC metadata length');
    blocks.push({ type, data: input.slice(offset, offset + length) });
    offset += length;
    if (isLast) break;
  }
  if (!blocks.length || blocks[0].type !== 0) throw new Error('Invalid FLAC streaminfo block');
  const audioFrames = input.slice(offset);
  let vorbisIndex = blocks.findIndex(block => block.type === 4);
  let parsed = vorbisIndex >= 0 ? parseVorbisComment(blocks[vorbisIndex].data) : { vendor: APP_ID, tags: [] };
  const flac = { tags: parsed.tags };
  if (Object.prototype.hasOwnProperty.call(tags, 'title')) setFlacTag(flac, 'TITLE', tags.title);
  if (Object.prototype.hasOwnProperty.call(tags, 'artist')) setFlacTag(flac, 'ARTIST', tags.artist);
  if (Object.prototype.hasOwnProperty.call(tags, 'album')) setFlacTag(flac, 'ALBUM', tags.album);
  if (Object.prototype.hasOwnProperty.call(tags, 'performerInfo')) setFlacTag(flac, 'ALBUMARTIST', tags.performerInfo);
  if (Object.prototype.hasOwnProperty.call(tags, 'year')) setFlacTag(flac, 'DATE', tags.year);
  if (Object.prototype.hasOwnProperty.call(tags, 'genre')) setFlacTag(flac, 'GENRE', tags.genre);
  if (Object.prototype.hasOwnProperty.call(tags, 'trackNumber')) setFlacTag(flac, 'TRACKNUMBER', tags.trackNumber);
  if (Object.prototype.hasOwnProperty.call(tags, 'trackTotal')) setFlacTag(flac, 'TOTALTRACKS', tags.trackTotal);
  if (Object.prototype.hasOwnProperty.call(tags, 'discNumber')) setFlacTag(flac, 'DISCNUMBER', tags.discNumber);
  if (Object.prototype.hasOwnProperty.call(tags, 'discTotal')) setFlacTag(flac, 'TOTALDISCS', tags.discTotal);
  if (Object.prototype.hasOwnProperty.call(tags, 'partOfSet') && tags.partOfSet) {
    setFlacTag(flac, 'DISCNUMBER', tags.partOfSet);
    const parts = String(tags.partOfSet).split('/');
    if (parts[1]) setFlacTag(flac, 'TOTALDISCS', parts[1]);
  }
  const vorbisBlock = { type: 4, data: buildVorbisComment(parsed.vendor, flac.tags) };
  if (vorbisIndex >= 0) blocks[vorbisIndex] = vorbisBlock;
  else blocks.splice(1, 0, vorbisBlock);
  if (tags.image && tags.image.imageBuffer) {
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].type === 6) blocks.splice(i, 1);
    }
    blocks.push({ type: 6, data: buildFlacPictureBlock(tags.image) });
  }
  const metadata = blocks.map((block, index) => buildFlacMetadataBlock(block.type, block.data, index === blocks.length - 1));
  const outputSize = prefix.length + 4 + metadata.reduce((total, block) => total + block.length, 0) + audioFrames.length;
  if (outputSize > MAX_METADATA_EDIT_BYTES) throw new Error('Edited FLAC would exceed the 512 MB metadata editing limit');
  const output = Buffer.concat([prefix, Buffer.from('fLaC'), ...metadata, audioFrames]);
  // Write to a temp file then rename so a crash mid-write can't corrupt the original audio
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    await fs.promises.writeFile(tmpPath, output);
    await preserveReplacementMode(tmpPath, originalStat);
    await fs.promises.rename(tmpPath, filePath);
  } catch (e) {
    try { await fs.promises.unlink(tmpPath); } catch (_) { }
    throw e;
  }
  return true;
}

async function preserveReplacementMode(tempPath, originalStat) {
  try { await fs.promises.chmod(tempPath, originalStat.mode); }
  catch (e) { console.warn('Could not preserve audio file mode:', e && e.message ? e.message : e); }
}

async function updateMp3Metadata(filePath, tags) {
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${crypto.randomBytes(6).toString('hex')}.tmp.mp3`);
  try {
    const originalStat = await fs.promises.stat(filePath);
    if (!originalStat.isFile() || originalStat.size > MAX_METADATA_EDIT_BYTES) throw new Error('MP3 file exceeds the 512 MB metadata editing limit');
    await fs.promises.copyFile(filePath, tmpPath, fs.constants.COPYFILE_EXCL);
    const result = NodeID3.update(tags, tmpPath);
    if (result !== true) throw (result instanceof Error ? result : new Error('MP3 metadata writer returned an invalid result'));
    const updatedStat = await fs.promises.stat(tmpPath);
    if (!updatedStat.isFile() || updatedStat.size > MAX_METADATA_EDIT_BYTES) throw new Error('Edited MP3 would exceed the 512 MB metadata editing limit');
    await preserveReplacementMode(tmpPath, originalStat);
    await fs.promises.rename(tmpPath, filePath);
  } catch (e) {
    try { await fs.promises.unlink(tmpPath); } catch (_) { }
    throw e;
  }
  return true;
}

const metadataWriteQueues = new Map();

function queueMetadataWrite(filePath, task) {
  const previous = metadataWriteQueues.get(filePath) || Promise.resolve();
  const next = previous.catch(() => { }).then(task);
  metadataWriteQueues.set(filePath, next);
  const cleanup = () => { if (metadataWriteQueues.get(filePath) === next) metadataWriteQueues.delete(filePath); };
  next.then(cleanup, cleanup);
  return next;
}

function parseMetadataNumberPair(value) {
  const parts = String(value || '').split('/');
  return {
    no: parseInt(parts[0] || '0', 10) || 0,
    total: parseInt(parts[1] || '0', 10) || 0,
  };
}

async function mergeCompositeMetadataNumbers(filePath, tags) {
  const next = { ...tags };
  const trackTouched = Object.prototype.hasOwnProperty.call(next, 'trackNumber') || Object.prototype.hasOwnProperty.call(next, 'trackTotal');
  const discTouched = Object.prototype.hasOwnProperty.call(next, 'discNumber') || Object.prototype.hasOwnProperty.call(next, 'discTotal') || Object.prototype.hasOwnProperty.call(next, 'partOfSet');
  if (!trackTouched && !discTouched) return next;
  // An empty value is an intentional removal. Do not repopulate it from the
  // current combined track/disc value while normalizing the other field.
  const clearsTrack = next.trackNumber === '' || next.trackTotal === '';
  const clearsDisc = next.discNumber === '' || next.discTotal === '' || next.partOfSet === '';
  if (clearsTrack && !discTouched) return next;
  if (clearsDisc && !trackTouched) return next;
  const metadata = await mm.parseFile(filePath, { duration: false, skipCovers: true });
  if (trackTouched && !clearsTrack) {
    const incoming = parseMetadataNumberPair(next.trackNumber);
    const currentNo = metadata.common.track && metadata.common.track.no ? metadata.common.track.no : 0;
    const currentTotal = metadata.common.track && metadata.common.track.of ? metadata.common.track.of : 0;
    const finalNo = incoming.no || currentNo;
    const finalTotal = parseInt(next.trackTotal || '0', 10) || incoming.total || currentTotal;
    if (finalNo) next.trackNumber = finalTotal ? `${finalNo}/${finalTotal}` : String(finalNo);
    if (finalTotal) next.trackTotal = String(finalTotal);
  }
  if (discTouched && !clearsDisc) {
    const incoming = parseMetadataNumberPair(next.partOfSet || next.discNumber);
    const currentNo = metadata.common.disk && metadata.common.disk.no ? metadata.common.disk.no : 0;
    const currentTotal = metadata.common.disk && metadata.common.disk.of ? metadata.common.disk.of : 0;
    const finalNo = incoming.no || currentNo;
    const finalTotal = parseInt(next.discTotal || '0', 10) || incoming.total || currentTotal;
    if (finalNo) next.discNumber = String(finalNo);
    if (finalTotal) next.discTotal = String(finalTotal);
    if (finalNo || finalTotal) next.partOfSet = finalNo ? `${finalNo}${finalTotal ? `/${finalTotal}` : ''}` : `0/${finalTotal}`;
  }
  return next;
}

registerIpcHandler('save-metadata', async (event, filePaths, tags, saveFolderJpg) => {
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress) return { ok: false, error: 'App-data maintenance is in progress' };
  activeMetadataWriteOperations++;
  try {
    if (!Array.isArray(filePaths) || filePaths.length === 0 || !tags || typeof tags !== 'object') return { ok: false, error: 'Invalid metadata save request' };
    let success = true;
    const normalizedFilePaths = filePaths.map(normalizePathInput);
    const editablePaths = normalizedFilePaths.filter(fp => isExistingFileWithExt(fp, ['.mp3', '.flac', '.opus', '.ogg', '.m4a']));
    if (editablePaths.length !== filePaths.length) return { ok: false, error: 'Metadata editing supports MP3, FLAC, Opus/Ogg and M4A files. WebM is not safely editable in place.' };
    if (!editablePaths.every(isManagedLibraryAudioFile)) return { ok: false, error: 'Metadata editing is limited to files currently in the Playerinyo library.' };
    for (const fp of editablePaths) {
      const fileStat = await fs.promises.lstat(fp);
      if (fileStat.isSymbolicLink()) return { ok: false, error: 'Metadata editing does not support symbolic links' };
      if (!fileStat.isFile()) return { ok: false, error: 'Metadata target must be a regular file' };
      if (fileStat.nlink > 1) return { ok: false, error: 'Metadata editing does not support files with multiple hard links' };
    }

    // Helper: get MIME type from file extension
    function getMimeFromExt(filePath) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.bmp': 'image/bmp', '.webp': 'image/webp', '.gif': 'image/gif',
        '.tiff': 'image/tiff', '.tif': 'image/tiff', '.avif': 'image/avif' };
      return mimeMap[ext] || 'image/jpeg';
    }
    let folderImageBuffer = null;

    // Normalize image: if it's a remote cover URL, download it into buffer form.
    if (tags.image && /^https:\/\//i.test(tags.image)) {
      try {
        const cover = await fetchCachedCoverImage(tags.image);
        folderImageBuffer = cover.imageBuffer;
        tags.image = {
          mime: cover.contentType.split(';')[0],
          type: { id: 3, name: 'front cover' },
          description: '',
          imageBuffer: cover.imageBuffer,
        };
      } catch (coverErr) {
        return { ok: false, error: `Cover download failed: ${coverErr.message || coverErr}` };
      }
    } else if (tags.image) {
      const imageSource = tags.image;
      const imageBuffer = await loadImageBufferFromSource(imageSource);
      if (!imageBuffer) return { ok: false, error: 'Selected cover image is unavailable or larger than 12 MB' };
      const mimeMatch = imageSource.match(/^data:(image\/[a-z0-9.+-]+);base64,/i);
      const mimeType = mimeMatch ? mimeMatch[1].toLowerCase() : getMimeFromExt(normalizePathInput(imageSource));
      folderImageBuffer = imageBuffer;
      tags.image = {
        mime: mimeType,
        type: { id: 3, name: 'front cover' },
        description: '',
        imageBuffer: imageBuffer
      };
    }

    for (let fp of editablePaths) {
      try {
        await queueMetadataWrite(fp, async () => {
          const ext = path.extname(fp).toLowerCase();
          const writerTags = await mergeCompositeMetadataNumbers(fp, tags);
          if (ext === '.mp3') await updateMp3Metadata(fp, writerTags);
          else if (ext === '.flac' && !(await updateFlacMetadata(fp, writerTags))) success = false;
          else if (['.opus', '.ogg', '.m4a'].includes(ext)) await updateStreamCopyMetadata(fp, writerTags);
        });
      } catch (e) {
        console.error(`Failed to save metadata for ${fp}:`, e);
        return { ok: false, error: `${path.basename(fp)}: ${e.message || e}` };
      }
    }
    if (!success) return { ok: false, error: 'Metadata writer returned false' };
    const warnings = [];
    if (saveFolderJpg && folderImageBuffer) {
      const writtenDirs = new Set();
      for (const fp of editablePaths) {
        const dir = path.dirname(fp);
        if (writtenDirs.has(dir)) continue;
        writtenDirs.add(dir);
        try { await writeFolderJpgForTrack(fp, folderImageBuffer); }
        catch (e) { warnings.push(`Could not write ${path.join(dir, 'folder.jpg')}: ${e.message || e}`); }
      }
    }
    return warnings.length ? { ok: true, warnings } : true;
  } catch (e) {
    console.error(e);
    return { ok: false, error: e.message || String(e) };
  } finally {
    activeMetadataWriteOperations = Math.max(0, activeMetadataWriteOperations - 1);
  }
});

registerIpcHandler('save-folder-covers', async (event, musicFiles) => {
  if (backupRestoreInProgress || movedFileRelinkCommitInProgress) return { ok: false, saved: 0, failed: 0, error: 'App-data maintenance is in progress' };
  activeMetadataWriteOperations++;
  try {
    if (!Array.isArray(musicFiles)) return { ok: false, saved: 0, failed: 0 };
    const byDir = new Map();
    for (const file of musicFiles) {
      const filePath = normalizePathInput(file && file.filePath);
      if (!file || !filePath || !file.picture || !isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) continue;
      const dir = path.dirname(filePath);
      if (!byDir.has(dir)) byDir.set(dir, { ...file, filePath });
    }
    let saved = 0;
    let failed = 0;
    const failures = [];
    for (const file of byDir.values()) {
      try {
        if (await writeFolderJpgForTrack(file.filePath, file.picture)) saved++;
        else {
          failed++;
          failures.push({ folder: path.dirname(file.filePath), filePath: file.filePath, reason: 'cover source unavailable' });
        }
      } catch (e) {
        failed++;
        failures.push({ folder: path.dirname(file.filePath), filePath: file.filePath, reason: e.message || String(e) });
        console.error('Failed to save folder cover:', file.filePath, e);
      }
    }
    return { ok: true, saved, failed, failures };
  } finally {
    activeMetadataWriteOperations = Math.max(0, activeMetadataWriteOperations - 1);
  }
});

registerIpcHandler('search-musicbrainz', async (event, query) => {
  try {
    const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json`;
    const data = await fetchMetadataJson(url, { headers: { 'User-Agent': `${APP_USER_AGENT} ( zafer@example.com )` } });
    return data.releases || [];
  } catch (e) { return []; }
});

registerIpcHandler('get-musicbrainz-release', async (event, releaseId) => {
  try {
    return await fetchMetadataJson(`https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artists&fmt=json`, { headers: { 'User-Agent': `${APP_USER_AGENT} ( zafer@example.com )` } });
  } catch (e) { return null; }
});

function safeYear(value) {
  const match = String(value || '').match(/\d{4}/);
  return match ? match[0] : '';
}

const METADATA_API_TIMEOUT_MS = 15000;
const MAX_METADATA_API_RESPONSE_BYTES = 2 * 1024 * 1024;
async function fetchMetadataJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), METADATA_API_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...(options || {}), signal: controller.signal });
    if (!response.ok) throw new Error(`Metadata API HTTP ${response.status}`);
    const declaredLength = Number(response.headers.get('content-length')) || 0;
    if (declaredLength > MAX_METADATA_API_RESPONSE_BYTES) throw new Error('Metadata API response exceeds the 2 MB limit');
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_METADATA_API_RESPONSE_BYTES) throw new Error('Metadata API response exceeds the 2 MB limit');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function normalizeMetadataOptions(options) {
  if (options && typeof options === 'object') return options;
  return { discogsToken: String(options || '') };
}

function normalizeSourceResult(source, id, title, artist, year, extra = {}) {
  return { source, id: String(id || ''), title: title || 'Unknown Album', artist: artist || 'Unknown Artist', date: year || '', thumb: extra.thumb || '', label: extra.label || '' };
}

function toArtistCredit(name) {
  return [{ name: name || 'Unknown Artist' }];
}

function joinSourceNames(items) {
  return Array.isArray(items) ? items.map(item => item && (item.name || item.artist || '')).filter(Boolean).join(', ') : '';
}

function normalizeMetadataRelease(source, data) {
  if (!data) return null;
  if (source === 'musicbrainz') return { ...data, source: 'MusicBrainz' };
  if (source === 'itunes') {
    const album = data.album || {};
    const songs = data.songs || [];
    return {
      source: 'iTunes',
      id: `itunes:${album.collectionId || ''}`,
      title: album.collectionName || '',
      date: safeYear(album.releaseDate),
      genres: album.primaryGenreName ? [{ name: album.primaryGenreName }] : [],
      'artist-credit': toArtistCredit(album.artistName),
      coverUrl: album.artworkUrl100 ? album.artworkUrl100.replace(/100x100bb\.jpg$/i, '600x600bb.jpg') : '',
      media: [{ position: 1, tracks: songs.map((song, index) => ({ title: song.trackName || '', artist: song.artistName || album.artistName || '', position: song.trackNumber || (index + 1), length: song.trackTimeMillis || 0 })) }]
    };
  }
  if (source === 'deezer') {
    return {
      source: 'Deezer',
      id: `deezer:${data.id || ''}`,
      title: data.title || '',
      date: safeYear(data.release_date),
      genres: data.genres && data.genres.data && data.genres.data[0] ? [{ name: data.genres.data[0].name }] : [],
      'artist-credit': toArtistCredit(data.artist && data.artist.name),
      coverUrl: data.cover_xl || data.cover_big || data.cover_medium || '',
      media: [{ position: 1, tracks: data.tracks && data.tracks.data ? data.tracks.data.map((song, index) => ({ title: song.title || '', artist: song.artist && song.artist.name || data.artist && data.artist.name || '', position: song.track_position || (index + 1), length: song.duration ? song.duration * 1000 : 0 })) : [] }]
    };
  }
  if (source === 'discogs') {
    const titleParts = String(data.title || '').split(' - ');
    const artist = data.artists_sort || (data.artists && data.artists.map(a => a.name).join(', ')) || titleParts[0] || '';
    const albumTitle = titleParts.length > 1 ? titleParts.slice(1).join(' - ') : (data.title || '');
    return {
      source: 'Discogs',
      id: `discogs:${data.id || ''}`,
      title: albumTitle,
      date: safeYear(data.year),
      genres: data.genres && data.genres[0] ? [{ name: data.genres[0] }] : [],
      'artist-credit': toArtistCredit(artist),
      coverUrl: data.images && data.images[0] ? data.images[0].uri : '',
      media: [{ position: 1, tracks: (data.tracklist || []).filter(t => t.type_ !== 'heading').map((song, index) => ({ title: song.title || '', artist: joinSourceNames(song.artists) || artist, position: index + 1, length: 0 })) }]
    };
  }
  return null;
}

registerIpcHandler('search-metadata-sources', async (event, query, options) => {
  const q = String(query || '').trim();
  if (!q) return [];
  const metadataOptions = normalizeMetadataOptions(options);
  const headers = { 'User-Agent': `${APP_USER_AGENT} ( zafer@example.com )` };
  const jobs = [];
  jobs.push(fetchMetadataJson(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(q)}&fmt=json&limit=10`, { headers }).then(data => (data.releases || []).map(r => normalizeSourceResult('musicbrainz', r.id, r.title, r['artist-credit'] ? r['artist-credit'].map(a => a.name || (a.artist && a.artist.name) || '').join(', ') : '', safeYear(r.date), { label: 'MusicBrainz', thumb: r.id ? `https://coverartarchive.org/release/${encodeURIComponent(r.id)}/front-250` : '' }))).catch(() => []));
  jobs.push(fetchMetadataJson(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=album&limit=8`).then(data => (data.results || []).map(r => normalizeSourceResult('itunes', r.collectionId, r.collectionName, r.artistName, safeYear(r.releaseDate), { thumb: r.artworkUrl100 || '', label: 'iTunes' }))).catch(() => []));
  jobs.push(fetchMetadataJson(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=8`).then(data => (data.data || []).map(r => normalizeSourceResult('deezer', r.id, r.title, r.artist && r.artist.name, '', { thumb: r.cover_medium || '', label: 'Deezer' }))).catch(() => []));
  const token = String(metadataOptions.discogsToken || '').trim();
  if (token) {
    jobs.push(fetchMetadataJson(`https://api.discogs.com/database/search?type=release&per_page=8&q=${encodeURIComponent(q)}&token=${encodeURIComponent(token)}`, { headers }).then(data => (data.results || []).map(r => {
      const parts = String(r.title || '').split(' - ');
      return normalizeSourceResult('discogs', r.id, parts.length > 1 ? parts.slice(1).join(' - ') : r.title, parts.length > 1 ? parts[0] : '', safeYear(r.year), { thumb: r.thumb || '', label: 'Discogs' });
    })).catch(() => []));
  }
  const groups = await Promise.all(jobs);
  return groups.flat().filter(r => r.id);
});

registerIpcHandler('get-metadata-release', async (event, source, id, options) => {
  try {
    source = String(source || '');
    id = String(id || '');
    const metadataOptions = normalizeMetadataOptions(options);
    const headers = { 'User-Agent': `${APP_USER_AGENT} ( zafer@example.com )` };
    if (source === 'musicbrainz') {
      return normalizeMetadataRelease(source, await fetchMetadataJson(`https://musicbrainz.org/ws/2/release/${encodeURIComponent(id)}?inc=recordings+artists&fmt=json`, { headers }));
    }
    if (source === 'itunes') {
      const data = await fetchMetadataJson(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song&limit=200`);
      const album = (data.results || []).find(x => x.wrapperType === 'collection') || {};
      const songs = (data.results || []).filter(x => x.wrapperType === 'track').sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0));
      return normalizeMetadataRelease(source, { album, songs });
    }
    if (source === 'deezer') {
      return normalizeMetadataRelease(source, await fetchMetadataJson(`https://api.deezer.com/album/${encodeURIComponent(id)}`));
    }
    if (source === 'discogs') {
      const token = String(metadataOptions.discogsToken || '').trim();
      if (!token) return null;
      return normalizeMetadataRelease(source, await fetchMetadataJson(`https://api.discogs.com/releases/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, { headers }));
    }
    return null;
  } catch (e) {
    console.error('Metadata release fetch failed:', e);
    return null;
  }
});

registerIpcHandler('lastfm-get-auth-url', async (event, credentials) => {
  const key = String(credentials && credentials.apiKey || '').trim();
  const secret = String(credentials && credentials.sharedSecret || '').trim();
  if (!key || !secret) return false;
  if (!canPersistLastfmCredentials(isSecureStorageAvailable())) {
    lastfmDebug('credential-write-blocked', { reason: 'secure-storage-unavailable', settingsPath: SETTINGS_FILE, encryptionAvailable: safeStorage.isEncryptionAvailable(), safeStorageBackend: typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : '' });
    return { ok: false, error: 'secure-storage-unavailable' };
  }
  try {
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=auth.getToken&api_key=${key}&format=json`);
    const data = await res.json();
    if (data.token) {
      invalidateLastfmKnownTrackSync();
      appSettings.lastfmApiKey = key;
      appSettings.lastfmSharedSecret = secret;
      pendingLastfmAuthToken = data.token;
      await persistLastfmCredentialSettings('auth-token');
      shell.openExternal(`https://www.last.fm/api/auth/?api_key=${key}&token=${data.token}`);
      return { ok: true };
    }
    return { ok: false, error: 'lastfm-auth-failed' };
  } catch (e) { return { ok: false, error: 'lastfm-auth-failed' }; }
});

registerIpcHandler('lastfm-get-session', async () => {
  const key = String(appSettings.lastfmApiKey || '').trim();
  const secret = String(appSettings.lastfmSharedSecret || '').trim();
  const token = pendingLastfmAuthToken;
  if (!key || !secret || !token) return null;
  try {
    let params = { api_key: key, method: 'auth.getSession', token: token };
    let sig = getLfmSignature(params, secret);
    if (!sig) return null;
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=auth.getSession&api_key=${key}&token=${token}&api_sig=${sig}&format=json`);
    const data = await res.json();
    if (data.session && data.session.key && data.session.name) {
      invalidateLastfmKnownTrackSync();
      appSettings.lastfmSessionKey = data.session.key;
      appSettings.lastfmUsername = data.session.name;
      pendingLastfmAuthToken = '';
      await persistLastfmCredentialSettings('connected-session');
      scheduleLastfmKnownTrackSync();
      return { name: data.session.name };
    }
    return null;
  } catch (e) { return null; }
});

registerIpcHandler('lastfm-disconnect', async () => {
  invalidateLastfmKnownTrackSync();
  pendingLastfmAuthToken = '';
  appSettings = clearLastfmCredentials(appSettings);
  try { await persistLastfmCredentialSettings('explicit-disconnect'); return true; }
  catch (error) { console.error('Could not disconnect Last.fm:', error); return false; }
});

registerIpcHandler('lastfm-update-now-playing', async (event, artist, track) => {
  const key = String(appSettings.lastfmApiKey || '').trim();
  const secret = String(appSettings.lastfmSharedSecret || '').trim();
  const sessionKey = String(appSettings.lastfmSessionKey || '').trim();
  if (!hasLastfmScrobbleCredentials(appSettings)) return false;
  try {
    let params = { method: 'track.updateNowPlaying', artist: artist, track: track, api_key: key, sk: sessionKey };
    let sig = getLfmSignature(params, secret);
    if (!sig) return false;
    let body = new URLSearchParams({ ...params, api_sig: sig, format: 'json' });
    const resp = await fetch('https://ws.audioscrobbler.com/2.0/', { method: 'POST', body });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || (data && data.error)) {
      console.log('Last.fm now-playing failed:', data && data.message ? data.message : resp.status);
      return false;
    }
    return true;
  } catch (e) { return false; }
});


registerIpcListener('update-thumbar', (event, isPlaying) => {
  if (process.platform === 'win32' && mainWindow) {
    const { nativeImage } = require('electron');

    function makeIcon(type) {
      const iconPath = path.join(__dirname, 'assets', 'taskbar', `taskbar-${type}.png`);
      if (fs.existsSync(iconPath)) {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) return icon.resize({ width: 24, height: 24, quality: 'best' });
      }
      const paths = {
        prev: '<path d="M11 7L5 12L11 17V7Z" fill="white"/><path d="M19 7L13 12L19 17V7Z" fill="white"/><path d="M4 7V17" stroke="white" stroke-width="2.2" stroke-linecap="round"/>',
        next: '<path d="M13 7L19 12L13 17V7Z" fill="white"/><path d="M5 7L11 12L5 17V7Z" fill="white"/><path d="M20 7V17" stroke="white" stroke-width="2.2" stroke-linecap="round"/>',
        play: '<path d="M8.5 6.8C8.5 6.1 9.25 5.68 9.85 6.04L18.15 11.24C18.72 11.6 18.72 12.4 18.15 12.76L9.85 17.96C9.25 18.32 8.5 17.9 8.5 17.2V6.8Z" fill="white"/>',
        pause: '<rect x="7" y="6" width="3.6" height="12" rx="1.2" fill="white"/><rect x="13.4" y="6" width="3.6" height="12" rx="1.2" fill="white"/>'
      };
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${paths[type] || paths.play}</svg>`;
      return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
    }

    mainWindow.setThumbarButtons([
      {
        tooltip: 'Previous',
        icon: makeIcon('prev'),
        click() { mainWindow.webContents.send('thumbar-action', 'prev'); }
      },
      {
        tooltip: isPlaying ? 'Pause' : 'Play',
        icon: makeIcon(isPlaying ? 'pause' : 'play'),
        click() { mainWindow.webContents.send('thumbar-action', 'playpause'); }
      },
      {
        tooltip: 'Next',
        icon: makeIcon('next'),
        click() { mainWindow.webContents.send('thumbar-action', 'next'); }
      }
    ]);
  }
});



registerIpcHandler('lastfm-scrobble', async (event, artist, track, timestamp) => {
  const key = String(appSettings.lastfmApiKey || '').trim();
  const secret = String(appSettings.lastfmSharedSecret || '').trim();
  const sessionKey = String(appSettings.lastfmSessionKey || '').trim();
  if (!hasLastfmScrobbleCredentials(appSettings)) return false;
  try {
    let params = { method: 'track.scrobble', 'artist[0]': artist, 'track[0]': track, 'timestamp[0]': timestamp, api_key: key, sk: sessionKey };
    let sig = getLfmSignature(params, secret);
    if (!sig) return false;
    let body = new URLSearchParams({ ...params, api_sig: sig, format: 'json' });
    const resp = await fetch('https://ws.audioscrobbler.com/2.0/', { method: 'POST', body });
    const data = await resp.json().catch(() => null);
    if (!resp.ok || (data && data.error)) {
      console.log('Last.fm scrobble failed:', data && data.message ? data.message : resp.status);
      return false;
    }
    return true;
  } catch (e) { return false; }
});

registerIpcHandler('lastfm-get-recommendations', async () => {
  const key = String(appSettings.lastfmApiKey || '').trim();
  const username = String(appSettings.lastfmUsername || '').trim();
  if (!key || !username) return [];
  try {
    let recentRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getRecentTracks&user=${encodeURIComponent(username)}&api_key=${key}&limit=20&format=json`);
    let recentData = await recentRes.json();
    let artistName = "";
    if (recentData.recenttracks && recentData.recenttracks.track && recentData.recenttracks.track.length > 0) {
      let randIdx = Math.floor(Math.random() * recentData.recenttracks.track.length);
      artistName = recentData.recenttracks.track[randIdx].artist['#text'];
    }

    if (!artistName) {
      let topRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getTopArtists&user=${encodeURIComponent(username)}&api_key=${key}&limit=20&format=json`);
      let topData = await topRes.json();
      if (topData.topartists && topData.topartists.artist && topData.topartists.artist.length > 0) {
        let randIdx = Math.floor(Math.random() * topData.topartists.artist.length);
        artistName = topData.topartists.artist[randIdx].name;
      }
    }

    if (artistName) {
      let simRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getSimilar&artist=${encodeURIComponent(artistName)}&api_key=${key}&limit=30&format=json`);
      let simData = await simRes.json();
      if (simData.similarartists && simData.similarartists.artist) {
        let simArtists = simData.similarartists.artist.sort(() => 0.5 - Math.random()).slice(0, 13);
        let fetchPromises = simArtists.map(async (simArtist) => {
          try {
            let topAlbRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getTopAlbums&artist=${encodeURIComponent(simArtist.name)}&api_key=${key}&limit=2&format=json`);
            let topAlbData = await topAlbRes.json();
            if (topAlbData.topalbums && topAlbData.topalbums.album && topAlbData.topalbums.album.length > 0) {
              return topAlbData.topalbums.album.slice(0, 2).map(function(alb) {
                return {
                  name: alb.name,
                  artist: simArtist.name,
                  image: (alb.image && alb.image.length > 2) ? alb.image[2]['#text'] : null
                };
              });
            }
          } catch (err) { }
          return [];
        });
        let recsNested = await Promise.all(fetchPromises);
        let recs = [].concat.apply([], recsNested).filter(r => r !== null).sort(() => 0.5 - Math.random());
        return recs;
      }
    }
    return [];
  } catch (e) { return []; }
});

// Phase 4A discovery IPC is intentionally narrow: the renderer receives only
// normalized candidates and bounded continuation state, never credentials or
// raw Last.fm responses.
registerIpcHandler('lastfm-discovery-start', async (event, request) => {
  const genreIds = request && Array.isArray(request.genreIds) ? request.genreIds : [];
  const genreId = normalizeGenreKey(genreIds[0]);
  if (!genreId || genreId.length > 500) throw new Error('A valid genre is required.');
  const stationId = radioDebugText(request && request.stationId, 160);
  radioDebug('discovery-start', { provider: 'lastfm', genre: genreId, stationId });
  const result = await makeLastfmDiscoveryBatch(null, genreId, { excludeKnownTracks: request && request.excludeKnownTracks === true, discoveryDepth: request && request.discoveryDepth, radioDebugStationId: stationId });
  return { items: result.items, providerSession: normalizeLastfmProviderSession(result.providerSession, [genreId]), exhausted: result.exhausted };
});

registerIpcHandler('lastfm-discovery-next', async (event, providerSession, options) => {
  const session = normalizeLastfmProviderSession(providerSession);
  if (!session) throw new Error('Invalid Last.fm discovery session.');
  const result = await makeLastfmDiscoveryBatch(session, session.genreIds[0], options || {});
  return { items: result.items, providerSession: normalizeLastfmProviderSession(result.providerSession, session.genreIds), exhausted: result.exhausted };
});

registerIpcHandler('lastfm-discovery-similarity', async (event, seed, genreId) => {
  return { candidateIds: await getLastfmSimilarityCandidateIds(seed, genreId) };
});

registerIpcHandler('lastfm-known-track-status', async () => {
  const index = await ensureKnownTrackIndex();
  scheduleLastfmKnownTrackSync();
  return {
    indexedTrackCount: Object.keys(index.tracksByMbid).length + Object.keys(index.tracksByName).length,
    lastfmSync: { ...index.lastfmSync },
  };
});

registerIpcHandler('lastfm-sync-known-tracks', async () => runLastfmKnownTrackSync());

registerIpcHandler('known-track-record-play', async (event, track) => {
  if (!track || typeof track !== 'object' || Array.isArray(track)) return false;
  const artist = typeof track.artist === 'string' ? track.artist.slice(0, 2000) : '';
  const title = typeof track.title === 'string' ? track.title.slice(0, 2000) : '';
  const mbid = typeof track.mbid === 'string' ? track.mbid.slice(0, 80) : '';
  if (!artist || !title) return false;
  const index = await ensureKnownTrackIndex();
  if (!indexTrack(index, { artist, title, mbid }, 'local', Math.floor(Date.now() / 1000))) return false;
  await persistKnownTrackIndex();
  return true;
});

// IPC Handler: Scan Folder for Music
registerIpcHandler('scan-folder', async (event, folderPath, existingLibrary = []) => {
  folderPath = normalizePathInput(folderPath);
  existingLibrary = Array.isArray(existingLibrary) ? existingLibrary : [];
  if (typeof folderPath !== 'string' || !path.isAbsolute(folderPath)) return [];
  if (!isExistingDirectory(folderPath)) {
    const preserved = existingLibrary.filter(item => item && typeof item.filePath === 'string' && isPathWithin(item.filePath, folderPath));
    return finishFolderScan(event, preserved, [{ path: folderPath, error: 'Folder is missing or inaccessible' }], 0);
  }
  const supportedExtensions = AUDIO_EXTENSIONS;
  const rawFiles = [];
  const failures = [];
  try {
    await walkDir(folderPath, supportedExtensions, rawFiles, failures);
  } catch (e) {
    console.error("Error walking directory", e);
    failures.push({ path: folderPath, error: e.message || String(e) });
    if (e && e.code === 'AUDIO_SCAN_LIMIT') {
      const preserved = existingLibrary.filter(item => item && typeof item.filePath === 'string' && isPathWithin(item.filePath, folderPath));
      return finishFolderScan(event, preserved, failures, rawFiles.length);
    }
  }

  const existingMap = new Map();
  existingLibrary.forEach((item) => {
    if (item && typeof item.filePath === 'string') existingMap.set(item.filePath, item);
  });

  const musicFiles = new Array(rawFiles.length);
  const totalFiles = rawFiles.length;
  const scanStartedAt = Date.now();
  let nextIndex = 0;
  let completed = 0;

  sendScanProgress(event, { current: 0, total: totalFiles });

  async function scanWorker() {
    while (true) {
      const i = nextIndex++;
      if (i >= totalFiles) return;
      const filePath = rawFiles[i];
      try {
        const fileStat = await fs.promises.stat(filePath);
        const existingItem = existingMap.get(filePath);
        if (existingItem && existingItem.fileSize === fileStat.size && existingItem.modifiedAtMs === fileStat.mtimeMs) {
          musicFiles[i] = existingItem;
        } else {
          musicFiles[i] = await buildLibraryItemFromAudioFile(filePath, fileStat);
          // A re-parse of a known file (tags changed) is not a new addition — keep its original date
          if (musicFiles[i] && existingItem && existingItem.addedAtMs !== null && existingItem.addedAtMs !== undefined) {
            musicFiles[i].addedAtMs = existingItem.addedAtMs;
          } else if (musicFiles[i] && existingItem) {
            musicFiles[i].addedAtMs = null;
          } else if (musicFiles[i] && !existingItem) {
            musicFiles[i].addedAtMs = scanStartedAt;
          }
        }
      } catch (e) {
        const existingItem = existingMap.get(filePath);
        if (existingItem) musicFiles[i] = existingItem;
        if (failures.length < 100) failures.push({ path: filePath, error: e && (e.code || e.message) ? (e.code || e.message) : String(e) });
      }

      completed++;
      if (completed % 25 === 0 || completed === totalFiles) {
        sendScanProgress(event, { current: completed, total: totalFiles });
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }

  const concurrency = Math.min(4, Math.max(1, totalFiles));
  await Promise.all(Array.from({ length: concurrency }, () => scanWorker()));

  sendScanProgress(event, { current: totalFiles, total: totalFiles });
  const scanned = musicFiles.filter(Boolean);
  if (failures.length) {
    const byPath = new Map(scanned.map(item => [item.filePath, item]));
    for (const existingItem of existingLibrary) {
      if (!existingItem || typeof existingItem.filePath !== 'string' || byPath.has(existingItem.filePath)) continue;
      if (failures.some(failure => isPathWithin(existingItem.filePath, failure.path))) byPath.set(existingItem.filePath, existingItem);
    }
    return finishFolderScan(event, Array.from(byPath.values()), failures, totalFiles);
  }
  return finishFolderScan(event, scanned, [], totalFiles);
});

async function parseCsvPlaylistFile(csvPath) {
  csvPath = normalizePathInput(csvPath);
  if (!isExistingFileWithExt(csvPath, ['.csv'])) throw new Error('Selected CSV playlist is not an accessible file');
  const stat = await fs.promises.stat(csvPath);
  if (!stat.isFile() || stat.size > MAX_CSV_BYTES) throw new Error('CSV file is larger than the 64 MB import limit');
  return new Promise((resolve, reject) => {
    const results = [];
    const input = fs.createReadStream(csvPath);
    const parser = parse({ columns: true, skip_empty_lines: true, max_record_size: 1024 * 1024, bom: true });
    let settled = false;
    let bytesRead = 0;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      input.destroy();
      reject(err);
    };
    input.on('error', fail);
    input.on('data', (chunk) => {
      bytesRead += chunk.length;
      if (bytesRead > MAX_CSV_BYTES) {
        input.unpipe(parser);
        parser.destroy();
        fail(new Error('CSV file is larger than the 64 MB import limit'));
      }
    });
    input.pipe(parser)
      .on('data', (data) => {
        if (results.length >= MAX_CSV_RECORDS) {
          parser.destroy(new Error(`CSV contains more than ${MAX_CSV_RECORDS} records`));
          return;
        }
        results.push(data);
      })
      .on('end', () => {
        if (settled) return;
        settled = true;
        resolve(results);
      })
      .on('error', fail);
  });
}

async function markM3uLocalSources(records) {
  const localRecords = records.filter(record => record && record.SourceLocal && typeof record.FilePath === 'string' && path.isAbsolute(record.FilePath));
  let nextIndex = 0;
  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= localRecords.length) return;
      const record = localRecords[index];
      let exists = false;
      try { exists = (await fs.promises.stat(record.FilePath)).isFile(); }
      catch (_) { }
      setLocalRecordExistence(record, exists);
      if (index > 0 && index % 250 === 0) await new Promise(resolve => setImmediate(resolve));
    }
  }
  await Promise.all(Array.from({ length: Math.min(16, Math.max(1, localRecords.length)) }, () => worker()));
}

function summarizePlaylistSources(records) {
  const statuses = {};
  records.forEach(record => { statuses[record.SourceStatus || 'csv'] = (statuses[record.SourceStatus || 'csv'] || 0) + 1; });
  return { entries: records.length, statuses };
}

async function parsePlaylistImportFile(filePath) {
  filePath = normalizePathInput(filePath);
  const extension = path.extname(filePath).toLowerCase();
  if (!['.csv', '.m3u', '.m3u8'].includes(extension) || !isExistingFileWithExt(filePath, [extension])) {
    throw new Error('Selected file must be an accessible CSV, M3U, or M3U8 playlist');
  }
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_CSV_BYTES) throw new Error('Playlist file is larger than the 64 MB import limit');
  const format = extension.slice(1);
  if (extension === '.csv') {
    const records = await parseCsvPlaylistFile(filePath);
    return {
      ok: true,
      sourcePath: filePath,
      format,
      name: path.basename(filePath, extension),
      records,
      summary: summarizePlaylistSources(records),
    };
  }

  let handle = null;
  let text;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const openedStat = await handle.stat();
    if (!openedStat.isFile() || openedStat.size > MAX_CSV_BYTES) throw new Error('Playlist file is larger than the 64 MB import limit');
    const buffer = await handle.readFile();
    if (buffer.length > MAX_CSV_BYTES) throw new Error('Playlist file is larger than the 64 MB import limit');
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch (e) { throw new Error('Playlist is not valid UTF-8. Convert legacy M3U files to UTF-8 and try again.'); }
  } finally {
    if (handle) await handle.close().catch(() => { });
  }
  const parsed = parseM3u(text, filePath, { supportedExtensions: AUDIO_EXTENSIONS });
  await markM3uLocalSources(parsed.records);
  return {
    ok: true,
    sourcePath: filePath,
    format,
    name: parsed.name || path.basename(filePath, extension),
    records: parsed.records,
    summary: Object.assign(summarizePlaylistSources(parsed.records), { hls: parsed.hls }),
  };
}

// Play audio file
registerIpcHandler('get-audio-file', async (event, filePath) => {
  filePath = normalizePathInput(filePath);
  if (!isManagedLibraryAudioFile(filePath)) return null;
  let handle = null;
  try {
    handle = await fs.promises.open(filePath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > MAX_AUDIO_IPC_BYTES) {
      const error = new Error('Audio file exceeds the 128 MB in-memory analysis limit');
      error.code = 'AUDIO_IPC_LIMIT';
      throw error;
    }
    const buffer = await handle.readFile();
    return buffer; // Returns as Uint8Array to renderer
  } catch (e) {
    if (e && e.code === 'AUDIO_IPC_LIMIT') throw e;
    console.error(e);
    return null;
  } finally {
    if (handle) await handle.close().catch(() => { });
  }
});

function validatePlaylistExportPayload(playlist) {
  if (!isPlainObject(playlist) || typeof playlist.name !== 'string' || !playlist.name || playlist.name.length > 1000 || playlist.name.includes('\0')) {
    throw new Error('Playlist export name is invalid');
  }
  if (!Array.isArray(playlist.tracks) || playlist.tracks.length > MAX_PLAYLIST_TRACKS) throw new Error('Playlist export track list is invalid');
  playlist.tracks.forEach((track, index) => validateBackupPlaylistTrack(track, `export.tracks[${index}]`));
}

function escapeCsvValue(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (text.includes(',') || text.includes('"') || text.includes('\n') || text.includes('\r')) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function buildCsvPlaylist(playlist) {
  const lines = ['Playlist,Song,Artist,Album,Duration,Genre,FilePath'];
  playlist.tracks.forEach(track => {
    const normalized = normalizeExportTrack(track);
    lines.push([
      playlist.name,
      normalized.title,
      normalized.artist,
      normalized.album,
      normalized.duration,
      normalized.genre,
      normalized.filePath,
    ].map(escapeCsvValue).join(','));
  });
  const content = lines.join('\n') + '\n';
  if (Buffer.byteLength(content, 'utf8') > MAX_CSV_BYTES) throw new Error('CSV export would exceed the 64 MB limit');
  return { content, skipped: 0, written: playlist.tracks.length };
}

registerIpcHandler('export-playlist', async (event, format, playlist) => {
  format = String(format || '').toLowerCase();
  if (!['csv', 'm3u', 'm3u8'].includes(format)) throw new Error('Unsupported playlist export format');
  validatePlaylistExportPayload(playlist);
  const safeBaseName = sanitizePathSegment(playlist.name, 'playlist');
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: format === 'csv' ? 'CSV' : (format === 'm3u8' ? 'M3U8 Playlist' : 'M3U Playlist'), extensions: [format] }],
    defaultPath: `${safeBaseName}.${format}`,
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  const result = format === 'csv' ? buildCsvPlaylist(playlist) : buildM3u(playlist, filePath, format);
  await writeTextFileAtomic(filePath, result.content);
  return { ok: true, filePath, skipped: result.skipped, written: result.written, format };
});

// IPC: Scan folder for image files (for album cover slideshow)
registerIpcHandler('scan-folder-images', async (event, folderPath) => {
  folderPath = normalizePathInput(folderPath);
  if (!isExistingDirectory(folderPath)) return [];
  const imgExts = IMAGE_EXTENSIONS;
  try {
    const files = await fs.promises.readdir(folderPath);
    return files
      .filter(f => imgExts.includes(path.extname(f).toLowerCase()))
      .map(f => getSafeFileUrl(path.join(folderPath, f)));
  } catch (e) { return []; }
});

// IPC: Open LRC file dialog
registerIpcHandler('dialog:openLrc', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'LRC Lyrics', extensions: ['lrc', 'txt'] }]
  });
  if (canceled) return null;
  try {
    return fs.readFileSync(filePaths[0], 'utf8');
  } catch (e) { return null; }
});
