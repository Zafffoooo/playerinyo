'use strict';

const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { isPlainObject } = require('./main-data-sanitizers');
const { writeTextFileAtomic, MAX_METADATA_EDIT_BYTES } = require('./main-file-helpers');
const { MAX_BACKUP_BYTES, validateBackupData, summarizeBackupData } = require('./backup-validation');

let builtBackup = null;

async function readJsonFileStrict(filePath, fallback) {
  try {
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('is not a regular data file');
    if (stat.size > MAX_BACKUP_BYTES) throw new Error(`is larger than the ${MAX_BACKUP_BYTES / (1024 * 1024)} MB backup limit`);
    return JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${path.basename(filePath)} for backup: ${error.message || error}`);
  }
}

async function buildBackup({ paths, settings, fallbackLikedSongs, kind, appName }) {
  builtBackup = null;
  const storedSettings = await readJsonFileStrict(paths.settings, {});
  const storedListeningStats = await readJsonFileStrict(paths.listeningStats, {});
  if (!isPlainObject(storedSettings)) throw new Error('Could not create backup: settings.json must contain an object');
  if (!isPlainObject(storedListeningStats)) throw new Error('Could not create backup: listening-stats.json must contain an object');
  const data = {
    library: await readJsonFileStrict(paths.library, []),
    playlists: await readJsonFileStrict(paths.playlists, []),
    mappings: await readJsonFileStrict(paths.mappings, {}),
    settings,
    likedSongs: await readJsonFileStrict(paths.likedSongs, fallbackLikedSongs),
    exportedFrom: appName,
  };
  const payload = { app: appName, schemaVersion: 1, kind, exportedAt: new Date().toISOString(), data };
  validateBackupData(payload);
  const text = JSON.stringify(payload, null, 2);
  if (Buffer.byteLength(text, 'utf8') > MAX_BACKUP_BYTES) throw new Error(`Backup exceeds the ${MAX_BACKUP_BYTES / (1024 * 1024)} MB export limit`);
  builtBackup = { kind, text };
  return {
    summary: summarizeBackupData(data),
    hasExistingData: !!(data.library.length || data.playlists.length || Object.keys(data.mappings).length || data.likedSongs.length || Object.keys(storedSettings).length || Object.keys(storedListeningStats).length),
  };
}

async function writeBackup({ filePath }) {
  if (!builtBackup) throw new Error('No validated backup is ready to write');
  await writeTextFileAtomic(filePath, builtBackup.text);
  try {
    const writtenPayload = await readJsonFileStrict(filePath, null);
    validateBackupData(writtenPayload);
    if (!writtenPayload || writtenPayload.kind !== builtBackup.kind) throw new Error('Written backup kind does not match the requested backup');
  } catch (error) {
    await fs.promises.rm(filePath, { force: true }).catch(() => { /* Preserve the original validation error if cleanup fails. */ });
    throw new Error(`Written backup could not be validated: ${error.message || error}`);
  }
  builtBackup = null;
  return true;
}

async function inspectBackup({ filePath }) {
  const parsed = await readJsonFileStrict(filePath, null);
  validateBackupData(parsed);
  return { kind: parsed.kind };
}

async function updateMp3({ filePath, tags }) {
  // node-id3 0.2.x's Promise.update still reads synchronously before its async
  // write. Keep both that read and the full-buffer rewrite off the main thread.
  const NodeID3 = require('node-id3');
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_METADATA_EDIT_BYTES) throw new Error('MP3 file exceeds the 512 MB metadata editing limit');
  if (tags.image && tags.image.imageBuffer) tags.image.imageBuffer = Buffer.from(tags.image.imageBuffer);
  const result = NodeID3.update(tags, filePath);
  if (result !== true) throw (result instanceof Error ? result : new Error('MP3 metadata writer returned an invalid result'));
  return true;
}

const operations = { buildBackup, writeBackup, inspectBackup, updateMp3 };
parentPort.on('message', async ({ id, operation, args }) => {
  try {
    if (!Object.prototype.hasOwnProperty.call(operations, operation)) throw new Error('Unknown file worker operation');
    const value = await operations[operation](args);
    parentPort.postMessage({ id, value });
  } catch (error) {
    parentPort.postMessage({ id, error: { message: error.message || String(error), name: error.name || 'Error', code: error.code } });
  }
});
