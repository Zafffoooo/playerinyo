const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { parseSpotifyAccountFile, crc32, tableCrc32 } = require('../app/spotify-account-playlists');

test('reads every playlist and preserves its source group', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'playerinyo-spotify-'));
  try {
    const file = path.join(folder, 'Playlist1.json');
    await fs.writeFile(file, JSON.stringify({ playlists: [
      { name: 'One', items: [{ track: { trackName: 'Song A', artistName: 'Artist A', albumName: 'Album A', trackUri: 'spotify:track:123' } }] },
      { name: 'Two', items: [{ track: { trackName: 'Song B', artistName: 'Artist B' } }] },
    ] }));
    const result = await parseSpotifyAccountFile(file);
    assert.equal(result.records.length, 2);
    assert.deepEqual(result.records.map(row => row.Playlist), ['One', 'Two']);
    await fs.writeFile(file, JSON.stringify({ playlists: [{ name: 'Broken', items: [{ track: { trackName: 'Missing artist' } }] }] }));
    await assert.rejects(parseSpotifyAccountFile(file), /incomplete track/);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});
test('reads Spotify playlist JSON entries inside a ZIP', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'playerinyo-spotify-zip-'));
  try {
    const name = Buffer.from('MyData/Playlist1.json');
    const payload = Buffer.from(JSON.stringify({ playlists: [{ name: 'From ZIP', items: [{ track: { trackName: 'Song', artistName: 'Artist' } }] }] }));
    const compressed = zlib.deflateRawSync(payload);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(payload), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(payload.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(payload), 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(payload.length, 24); central.writeUInt16LE(name.length, 28);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length + name.length, 12); end.writeUInt32LE(local.length + name.length + compressed.length, 16);
    const file = path.join(folder, 'spotify.zip');
    await fs.writeFile(file, Buffer.concat([local, name, compressed, central, name, end]));
    const result = await parseSpotifyAccountFile(file);
    assert.equal(result.records[0].Playlist, 'From ZIP');
    central.writeUInt32LE(0, 16);
    await fs.writeFile(file, Buffer.concat([local, name, compressed, central, name, end]));
    await assert.rejects(parseSpotifyAccountFile(file), /corrupted/);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

function buildZip(entries) {
  const parts = []; const centrals = []; let offset = 0;
  for (const { name: n, payload, declaredSize } of entries) {
    const name = Buffer.from(n);
    const compressed = zlib.deflateRawSync(payload);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(crc32(payload), 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(payload.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(crc32(payload), 16); central.writeUInt32LE(compressed.length, 20); central.writeUInt32LE(declaredSize === undefined ? payload.length : declaredSize, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    parts.push(local, name, compressed);
    centrals.push(central, name);
    offset += local.length + name.length + compressed.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

async function withZip(entries, fn) {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'playerinyo-spotify-zip-'));
  try {
    const file = path.join(folder, 'spotify.zip');
    await fs.writeFile(file, buildZip(entries));
    return await fn(file);
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
}

test('table CRC32 matches the bitwise reference', () => {
  const bitwise = (buffer) => {
    let crc = 0xffffffff;
    for (const byte of buffer) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const samples = [Buffer.alloc(0), Buffer.from('123456789'), Buffer.from(JSON.stringify({ a: 'Ünïcode ☃' })), Buffer.from(Array.from({ length: 5000 }, (_, i) => (i * 31 + 7) & 0xff))];
  for (const sample of samples) {
    assert.equal(tableCrc32(sample), bitwise(sample));
    assert.equal(crc32(sample), bitwise(sample));
  }
  assert.equal(tableCrc32(Buffer.from('123456789')), 0xcbf43926);
});

test('ZIP rejects cumulative expanded bytes above the budget before inflating', async () => {
  const payload = Buffer.alloc(10 * 1024 * 1024, 0x20);
  const entries = Array.from({ length: 6 }, (_, i) => ({ name: `Playlist${i + 1}.json`, payload }));
  await withZip(entries, (file) => assert.rejects(parseSpotifyAccountFile(file), /expands beyond the size limit/));
});

test('ZIP rejects a record count above the budget across entries', async () => {
  const item = { track: { trackName: 'S', artistName: 'A' } };
  const items = new Array(150000).fill(item);
  const payload = Buffer.from(JSON.stringify({ playlists: [{ name: 'P', items }] }));
  const entries = [{ name: 'Playlist1.json', payload }, { name: 'Playlist2.json', payload }];
  await withZip(entries, (file) => assert.rejects(parseSpotifyAccountFile(file), /too many tracks/));
});
