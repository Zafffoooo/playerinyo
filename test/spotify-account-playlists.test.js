const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { parseSpotifyAccountFile, crc32 } = require('../app/spotify-account-playlists');

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
