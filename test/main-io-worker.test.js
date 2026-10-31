'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const NodeID3 = require('node-id3');
const { createDataFileLock } = require('../app/data-file-lock');
const { createMainWorkerClient, createSharedWorkerClient, runMainWorkerTask } = require('../app/main-worker-client');
const { sanitizeSettingsForBackup, validateBackupData } = require('../app/backup-validation');
const { createBackupRetentionCache } = require('../app/backup-retention-cache');
const { createLocalBackupFilename, isAutomaticBackupFilename, isSafetyBackupFilename } = require('../app/backup-helpers');

async function fixture(t) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'playerinyo-main-worker-'));
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  return root;
}
function backupArgs(root) {
  return { paths: Object.fromEntries(['settings', 'listeningStats', 'library', 'playlists', 'mappings', 'likedSongs'].map((name) => [name, path.join(root, `${name}.json`)])),
    settings: {}, fallbackLikedSongs: [], kind: 'automatic', appName: 'Playerinyo' };
}

test('worker builds, atomically writes, and rereads identical pretty JSON backup format', async (t) => {
  const root = await fixture(t);
  const args = backupArgs(root);
  args.settings = sanitizeSettingsForBackup({ volume: 0.5, lastfmSessionKey: 'private', ytdlCookiesFile: '/private/cookies.txt' });
  const library = [{ filePath: '/music/test.mp3', filename: 'test.mp3', title: 'Title', artist: 'Artist', album: 'Album', metadataBackfillSig: '1:100:123' }];
  await fs.promises.writeFile(args.paths.library, JSON.stringify(library));
  const worker = createMainWorkerClient();
  t.after(() => worker.close());
  const built = await worker.request('buildBackup', args);
  assert.equal(built.hasExistingData, true);
  assert.deepEqual(built.summary, { library: 1, playlists: 0, likedSongs: 0, hasSettings: true, hasMappings: true });
  assert.equal(built.text, undefined);
  assert.equal(built.payload, undefined);
  const filePath = path.join(root, 'backup.json');
  await worker.request('writeBackup', { filePath });
  const text = await fs.promises.readFile(filePath, 'utf8');
  const payload = JSON.parse(text);
  assert.equal(text, JSON.stringify(payload, null, 2));
  assert.equal(payload.kind, 'automatic');
  assert.equal(payload.app, 'Playerinyo');
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.data.exportedFrom, 'Playerinyo');
  assert.deepEqual(payload.data.library, library);
  assert.deepEqual(payload.data.settings, { volume: 0.5 });
  assert.deepEqual(validateBackupData(payload).library, library);
  assert.equal((await worker.request('inspectBackup', { filePath })).kind, 'automatic');
  if (process.platform !== 'win32') assert.equal((await fs.promises.stat(filePath)).mode & 0o777, 0o600);
  assert.equal((await fs.promises.readdir(root)).some((name) => name.endsWith('.tmp')), false);
});

test('worker keeps blank safety-backup detection and invalid data errors', async (t) => {
  const root = await fixture(t);
  const worker = createMainWorkerClient();
  t.after(() => worker.close());
  const args = backupArgs(root);
  args.kind = 'safety';
  assert.equal((await worker.request('buildBackup', args)).hasExistingData, false);
  await fs.promises.writeFile(args.paths.listeningStats, '{"track":{"count":1}}');
  assert.equal((await worker.request('buildBackup', args)).hasExistingData, true);
  await fs.promises.writeFile(args.paths.settings, '[]');
  await assert.rejects(worker.request('buildBackup', args), /Could not create backup: settings.json must contain an object/);
  await assert.rejects(worker.request('writeBackup', { filePath: path.join(root, 'not-created.json') }), /No validated backup is ready/);
});

test('worker rejects symlinks and malformed backups with the existing strict errors', async (t) => {
  const root = await fixture(t);
  const args = backupArgs(root);
  const worker = createMainWorkerClient();
  t.after(() => worker.close());
  await fs.promises.writeFile(args.paths.settings, '{bad json');
  await assert.rejects(worker.request('buildBackup', args), /Could not read settings.json for backup:/);
  await fs.promises.unlink(args.paths.settings);
  await fs.promises.writeFile(path.join(root, 'real.json'), '{}');
  if (process.platform === 'win32') await fs.promises.mkdir(args.paths.settings);
  else await fs.promises.symlink(path.join(root, 'real.json'), args.paths.settings);
  await assert.rejects(worker.request('buildBackup', args), /is not a regular data file/);
  const invalid = path.join(root, 'invalid.json');
  await fs.promises.writeFile(invalid, JSON.stringify({ library: [], playlists: [], mappings: {}, settings: {}, constructor: {} }));
  await assert.rejects(worker.request('inspectBackup', { filePath: invalid }), /forbidden field/);
});

test('MP3 worker preserves tags and audio bytes while restoring cloned image buffers', async (t) => {
  const root = await fixture(t);
  const filePath = path.join(root, 'track.mp3');
  const audio = Buffer.alloc(1024, 0x55);
  await fs.promises.writeFile(filePath, Buffer.concat([NodeID3.create({ artist: 'Existing Artist', title: 'Old Title' }), audio]));
  const imageBuffer = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aYz8AAAAASUVORK5CYII=', 'base64');
  assert.equal(await runMainWorkerTask('updateMp3', { filePath, tags: { title: 'New Title', image: { mime: 'image/png', type: { id: 3 }, description: '', imageBuffer } } }), true);
  const tags = NodeID3.read(filePath);
  assert.equal(tags.title, 'New Title');
  assert.equal(tags.artist, 'Existing Artist');
  assert.deepEqual(tags.image.imageBuffer, imageBuffer);
  assert.deepEqual((await fs.promises.readFile(filePath)).subarray(-audio.length), audio);
});

test('MP3 editing retains atomic replacement, file mode, and failure cleanup', async (t) => {
  const root = await fixture(t);
  const source = fs.readFileSync(path.join(__dirname, '../app/main.js'), 'utf8');
  const start = source.indexOf('async function updateMp3Metadata(');
  const end = source.indexOf('const metadataWriteQueues =', start);
  const context = vm.createContext({ fs, path, crypto, process, runMainWorkerTask, MAX_METADATA_EDIT_BYTES: 512 * 1024 * 1024,
    preserveReplacementMode: (filePath, stat) => fs.promises.chmod(filePath, stat.mode) });
  vm.runInContext(source.slice(start, end), context);
  const filePath = path.join(root, 'track.mp3');
  await fs.promises.writeFile(filePath, Buffer.concat([NodeID3.create({ title: 'Old' }), Buffer.alloc(1024)]), { mode: 0o640 });
  await context.updateMp3Metadata(filePath, { title: 'New' });
  assert.equal(NodeID3.read(filePath).title, 'New');
  if (process.platform !== 'win32') assert.equal((await fs.promises.stat(filePath)).mode & 0o777, 0o640);
  const before = await fs.promises.readFile(filePath);
  context.runMainWorkerTask = async () => { throw new Error('worker failed'); };
  await assert.rejects(context.updateMp3Metadata(filePath, { title: 'Failed' }), /worker failed/);
  assert.deepEqual(await fs.promises.readFile(filePath), before);
  assert.deepEqual(await fs.promises.readdir(root), ['track.mp3']);
});

test('backup retention validates unchanged files once and rechecks changed content', async (t) => {
  const root = await fixture(t);
  const source = fs.readFileSync(path.join(__dirname, '../app/main.js'), 'utf8');
  const start = source.indexOf('const backupRetentionCache =');
  const end = source.indexOf('async function ensureAutomaticBackupHistoryLoaded(', start);
  let inspections = 0;
  const context = vm.createContext({ fs, path, BACKUPS_DIR: root, createBackupRetentionCache, isAutomaticBackupFilename, isSafetyBackupFilename, setImmediate, console,
    createMainWorkerClient: () => {
      const worker = createMainWorkerClient();
      return { ...worker, request: (...args) => { inspections++; return worker.request(...args); } };
    }, createSharedWorkerClient });
  vm.runInContext(source.slice(start, end), context);
  const name = createLocalBackupFilename('automatic', Date.now());
  const filePath = path.join(root, name);
  const payload = { app: 'Playerinyo', schemaVersion: 1, kind: 'automatic', data: { library: [], playlists: [], mappings: {}, settings: {} } };
  await fs.promises.writeFile(filePath, JSON.stringify(payload));
  assert.deepEqual(Array.from(await context.getValidatedAutomaticBackupNames()), [name]);
  assert.deepEqual(Array.from(await context.getValidatedAutomaticBackupNames()), [name]);
  assert.equal(inspections, 1);
  payload.kind = 'safety';
  await fs.promises.writeFile(filePath, JSON.stringify(payload));
  assert.equal((await context.getValidatedAutomaticBackupNames()).length, 0);
  assert.equal(inspections, 2);
});

test('backup snapshot reads and source writes share one lock; unrelated writes stay independent', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/main.js'), 'utf8');
  const start = source.indexOf('function queueTextFileWrite(');
  const end = source.indexOf('function queueJsonWrite(', start);
  const backupSourceLock = createDataFileLock();
  const writes = [];
  const context = vm.createContext({ fileWriteQueues: new Map(), backupSourceLock, backupSourceFiles: new Set(['/library.json']),
    writeTextFileAtomic: async (...args) => writes.push(args) });
  vm.runInContext(source.slice(start, end), context);
  let release;
  const held = backupSourceLock.run(() => new Promise((resolve) => { release = resolve; }));
  const save = context.queueTextFileWrite('/library.json', 'new data');
  const other = context.queueTextFileWrite('/cache.json', 'cache');
  await other;
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [['/cache.json', 'cache']]);
  release();
  await held;
  await save;
  assert.deepEqual(writes, [['/cache.json', 'cache'], ['/library.json', 'new data']]);
});

test('data file lock serializes tasks FIFO and releases after failures', async () => {
  const lock = createDataFileLock();
  const order = [];
  let release;
  const first = lock.run(async () => { order.push('a-start'); await new Promise((resolve) => { release = resolve; }); order.push('a-end'); });
  const second = lock.run(async () => { order.push('b'); throw new Error('boom'); });
  const third = lock.run(async () => { order.push('c'); });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['a-start']);
  release();
  await first;
  await assert.rejects(second, /boom/);
  await third;
  assert.deepEqual(order, ['a-start', 'a-end', 'b', 'c']);
});

test('shared worker client recreates a dead worker and idle-closes', async () => {
  const created = [];
  const timers = new Map();
  let nextTimer = 0;
  function fakeWorker(dieOn) {
    let closed = false;
    const worker = { closes: 0, isClosed: () => closed,
      async request(op, args) {
        if (closed) throw new Error('closed');
        if (args && args.crash === dieOn) { closed = true; throw new Error('worker died'); }
        return `${created.indexOf(worker)}:${op}`;
      },
      async close() { closed = true; worker.closes++; } };
    created.push(worker);
    return worker;
  }
  const shared = createSharedWorkerClient({ create: () => fakeWorker(true),
    setTimer: (task) => { const id = ++nextTimer; timers.set(id, task); return id; }, clearTimer: (id) => timers.delete(id) });
  assert.equal(await shared.request('x', {}), '0:x');
  await assert.rejects(shared.request('x', { crash: true }), /worker died/);
  assert.equal(await shared.request('x', {}), '1:x');
  assert.equal(created.length, 2);
  assert.equal(timers.size, 1);
  Array.from(timers.values())[0]();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(created[1].closes, 1);
  assert.equal(await shared.request('x', {}), '2:x');
  await shared.close();
});

test('backup retention keeps validating later files after the worker dies', async (t) => {
  const root = await fixture(t);
  const source = fs.readFileSync(path.join(__dirname, '../app/main.js'), 'utf8');
  const start = source.indexOf('const backupRetentionCache =');
  const end = source.indexOf('async function ensureAutomaticBackupHistoryLoaded(', start);
  let creations = 0;
  const context = vm.createContext({ fs, path, BACKUPS_DIR: root, createBackupRetentionCache, isAutomaticBackupFilename, isSafetyBackupFilename, setImmediate, console: { warn() {} },
    createSharedWorkerClient, createMainWorkerClient: () => {
      const worker = createMainWorkerClient();
      const id = ++creations;
      return { ...worker, request: async (op, args) => {
        if (id === 1) { await worker.close(); throw new Error('worker crashed'); }
        return worker.request(op, args);
      } };
    } });
  vm.runInContext(source.slice(start, end), context);
  const payload = { app: 'Playerinyo', schemaVersion: 1, kind: 'automatic', data: { library: [], playlists: [], mappings: {}, settings: {} } };
  const names = [0, 1].map((offset) => createLocalBackupFilename('automatic', Date.now() + offset * 1000));
  for (const name of names) await fs.promises.writeFile(path.join(root, name), JSON.stringify(payload));
  const valid = Array.from(await context.getValidatedAutomaticBackupNames());
  assert.equal(valid.length, 1);
  assert.equal(creations, 2);
});

test('worker rejects oversized backup source before reading its contents', async (t) => {
  const root = await fixture(t);
  const args = backupArgs(root);
  await fs.promises.writeFile(args.paths.library, '');
  await fs.promises.truncate(args.paths.library, 256 * 1024 * 1024 + 1);
  await assert.rejects(runMainWorkerTask('buildBackup', args), /larger than the 256 MB backup limit/);
});

test('worker rejects oversized MP3 before its synchronous tag parser runs', async (t) => {
  const root = await fixture(t);
  const filePath = path.join(root, 'large.mp3');
  await fs.promises.writeFile(filePath, '');
  await fs.promises.truncate(filePath, 512 * 1024 * 1024 + 1);
  await assert.rejects(runMainWorkerTask('updateMp3', { filePath, tags: { title: 'Too large' } }), /512 MB metadata editing limit/);
});
