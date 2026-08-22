const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { getAlbumRoot, calculateAlbumSize, makeAlbumSizeKey } = require('./album-size');

async function fixture(build) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'playerinyo-album-size-'));
  try { await build(root); } finally { await fs.rm(root, { recursive: true, force: true }); }
}
async function write(filePath, size) { await fs.mkdir(path.dirname(filePath), { recursive: true }); await fs.writeFile(filePath, Buffer.alloc(size)); }

test('single-folder album includes audio and sidecar files recursively', async () => fixture(async (root) => {
  const album = path.join(root, 'Album');
  const track = path.join(album, '01.flac');
  await write(track, 100); await write(path.join(album, 'cover.jpg'), 20); await write(path.join(album, 'lyrics.lrc'), 5);
  const result = await calculateAlbumSize([{ filePath: track }]);
  assert.deepEqual(result, { bytes: 125, mode: 'folder', root: album });
}));

test('multi-disc album uses the common disc root', async () => fixture(async (root) => {
  const album = path.join(root, 'Album'); const one = path.join(album, 'Disc 1', '01.flac'); const two = path.join(album, 'Disc 2', '01.flac');
  await write(one, 10); await write(two, 20); await write(path.join(album, 'folder.jpg'), 3);
  const result = await calculateAlbumSize([{ filePath: one }, { filePath: two }]);
  assert.equal(result.bytes, 33); assert.equal(result.mode, 'folder'); assert.equal(result.root, album);
}));

test('independent folders fall back to unique track file sizes', async () => fixture(async (root) => {
  const one = path.join(root, 'A', '01.flac'); const two = path.join(root, 'B', '01.flac');
  await write(one, 10); await write(two, 20); await write(path.join(root, 'A', 'cover.jpg'), 99);
  const result = await calculateAlbumSize([{ filePath: one }, { filePath: one }, { filePath: two }]);
  assert.equal(getAlbumRoot([one, two]), ''); assert.deepEqual(result, { bytes: 30, mode: 'tracks', root: '' });
}));

test('missing paths are safe and no readable track is unavailable', async () => {
  const result = await calculateAlbumSize([{ filePath: path.join(os.tmpdir(), 'playerinyo-does-not-exist.flac') }]);
  assert.deepEqual(result, { bytes: null, mode: 'tracks', root: '' });
});

test('cache keys distinguish same-name albums at different paths and change after mutation', () => {
  const a = makeAlbumSizeKey('Same::Artist', [{ filePath: '/music/A/01.flac', fileSize: 1, modifiedAtMs: 1 }]);
  const b = makeAlbumSizeKey('Same::Artist', [{ filePath: '/music/B/01.flac', fileSize: 1, modifiedAtMs: 1 }]);
  const changed = makeAlbumSizeKey('Same::Artist', [{ filePath: '/music/A/01.flac', fileSize: 2, modifiedAtMs: 2 }]);
  assert.notEqual(a, b); assert.notEqual(a, changed);
});
