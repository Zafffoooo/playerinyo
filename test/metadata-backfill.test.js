'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createMetadataBackfillStamp, hasCurrentMetadataBackfill } = require('../app/metadata-backfill');
const { validateBackupData } = require('../app/backup-validation');

const mainSource = fs.readFileSync(path.join(__dirname, '../app/main.js'), 'utf8');
const rendererSource = fs.readFileSync(path.join(__dirname, '../app/renderer.js'), 'utf8');
const fields = ['trackMbid', 'year', 'genre', 'discNo', 'discTotal', 'trackTotal', 'replayGainTrackDb', 'replayGainAlbumDb', 'replayGainTrackPeak', 'replayGainAlbumPeak'];
function track(overrides = {}) {
  return { filePath: '/music/test.mp3', filename: 'test.mp3', title: 'Title', artist: 'Artist', album: 'Album', fileSize: 1000, modifiedAtMs: 123.5, duration: 100, ...Object.fromEntries(fields.map((field) => [field, null])), ...overrides };
}

function loadRenderer(files) {
  let persisted = 0;
  let marked = 0;
  const state = { musicFiles: files, currentTracks: [], currentView: '' };
  const context = vm.createContext({ state,
    getLibraryIndex: () => ({ byPath: new Map(files.map((file) => [file.filePath, file])), byStrippedPath: new Map() }),
    stripFileUrl: (value) => value,
    markLibraryDirty: () => marked++,
    persistLibrary: async (library) => { assert.equal(library, files); persisted++; },
  });
  const constant = rendererSource.match(/^const BACKFILL_METADATA_FIELDS = .*;$/m)[0];
  const start = rendererSource.indexOf('async function mergeBackfilledMetadata(');
  const end = rendererSource.indexOf('function toFileUrl(', start);
  vm.runInContext(constant + '\n' + rendererSource.slice(start, end), context);
  return { context, get persisted() { return persisted; }, get marked() { return marked; } };
}

function loadMain(parseFile) {
  let handler;
  const context = vm.createContext({
    registerIpcHandler: (_name, callback) => { handler = callback; },
    mm: { parseFile }, getReplayGainFields: () => ({}),
    createMetadataBackfillStamp, hasCurrentMetadataBackfill,
    normalizePathInput: (value) => value, path,
    isExistingFileWithExt: () => true, AUDIO_EXTENSIONS: new Set(['.mp3']),
  });
  const start = mainSource.indexOf("registerIpcHandler('backfill-metadata',");
  const end = mainSource.indexOf("registerIpcHandler('load-playlists',", start);
  vm.runInContext(mainSource.slice(start, end), context);
  return handler;
}

test('backfill stamps match version, size, and fractional mtime', () => {
  const file = track();
  file.metadataBackfillSig = createMetadataBackfillStamp(file);
  assert.equal(file.metadataBackfillSig, '1:1000:123.5');
  assert.equal(typeof file.metadataBackfillSig, 'string');
  assert.equal(hasCurrentMetadataBackfill(file), true);
  assert.equal(hasCurrentMetadataBackfill({ ...file, fileSize: 1001 }), false);
  assert.equal(hasCurrentMetadataBackfill({ ...file, modifiedAtMs: 124 }), false);
  assert.equal(hasCurrentMetadataBackfill({ ...file, metadataBackfillSig: '2:1000:123.5', metadataBackfill: { v: 1, sig: '1000:123.5' } }), false);
});

test('main skips stamped null tags and stamps every successful parse without covers', async () => {
  const parsed = [];
  const handler = loadMain(async (filePath, options) => {
    parsed.push(filePath);
    assert.equal(options.skipCovers, true);
    assert.equal(options.duration, false);
    return { common: {}, format: {} };
  });
  const file = track();
  const result = await handler(null, [file]);
  assert.equal(result.updates.length, 1);
  assert.equal(result.updates[0].metadataBackfillSig, '1:1000:123.5');
  assert.equal(result.updates[0].year, null);
  file.metadataBackfillSig = result.updates[0].metadataBackfillSig;
  assert.equal((await handler(null, [file])).updates.length, 0);
  assert.equal(parsed.length, 1);
});

test('failed parses get no stamp and changed signatures are parsed again', async () => {
  let parses = 0;
  const file = track();
  file.metadataBackfillSig = createMetadataBackfillStamp(file);
  const handler = loadMain(async () => {
    if (++parses === 1) throw new Error('malformed file');
    return { common: {}, format: {} };
  });
  file.fileSize++;
  assert.equal((await handler(null, [file])).updates.length, 0);
  const result = await handler(null, [file]);
  assert.equal(result.updates[0].metadataBackfillSig, '1:1001:123.5');
});

test('renderer saves stamp-only changes without overwriting present tag fields', async () => {
  const file = track({ year: 2000, genre: 'Existing', metadataBackfillSig: '1:1:old' });
  const renderer = loadRenderer([file]);
  const patch = { filePath: file.filePath, metadataBackfillSig: createMetadataBackfillStamp(file), year: 2020, genre: 'New' };
  await renderer.context.mergeBackfilledMetadata({ ok: true, updates: [patch] });
  assert.equal(file.year, 2000);
  assert.equal(file.genre, 'Existing');
  assert.equal(file.metadataBackfillSig, patch.metadataBackfillSig);
  assert.equal(renderer.persisted, 1);
  assert.equal(renderer.marked, 1);
  await renderer.context.mergeBackfilledMetadata({ ok: true, updates: [patch] });
  assert.equal(renderer.persisted, 1);
});

test('stale stamp re-parses only while duration or a backfill field is still missing', async () => {
  const complete = track(Object.fromEntries(fields.map((field) => [field, 1])));
  complete.metadataBackfillSig = createMetadataBackfillStamp(complete);
  const renderer = loadRenderer([complete]);
  assert.equal(renderer.context.getPendingMetadataBackfillFiles([complete]).length, 0);
  complete.modifiedAtMs++;
  assert.equal(renderer.context.getPendingMetadataBackfillFiles([complete]).length, 0);
  const missingField = { ...complete, year: null };
  assert.equal(renderer.context.getPendingMetadataBackfillFiles([missingField]).length, 1);
  const missingDuration = { ...complete, duration: 0 };
  assert.equal(renderer.context.getPendingMetadataBackfillFiles([missingDuration]).length, 1);
  const current = track({ metadataBackfillSig: '1:1000:123.5' });
  assert.equal(renderer.context.getPendingMetadataBackfillFiles([current]).length, 0);
  let parses = 0;
  const handler = loadMain(async () => { parses++; return { common: {}, format: {} }; });
  assert.equal((await handler(null, [complete])).updates.length, 0);
  assert.equal(parses, 0);
  assert.equal((await handler(null, [{ ...complete, year: null }])).updates.length, 1);
  assert.equal(parses, 1);
});

test('library backup validation preserves the new backfill stamp', () => {
  const file = track();
  file.metadataBackfillSig = createMetadataBackfillStamp(file);
  const result = validateBackupData({ library: [file], playlists: [], mappings: {}, settings: {} });
  assert.equal(result.library[0].metadataBackfillSig, file.metadataBackfillSig);
});
