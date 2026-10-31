const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_EXPANDED_BYTES = 160 * 1024 * 1024;
const MAX_RECORDS = 250000;
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function tableCrc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const crc32 = typeof zlib.crc32 === 'function' ? (buffer) => zlib.crc32(buffer) >>> 0 : tableCrc32;

function spotifyRows(text, rows = []) {
  const value = JSON.parse(text.replace(/^\uFEFF/, ''));
  if (!value || !Array.isArray(value.playlists)) throw new Error('This is not a Spotify playlist export.');
  for (const playlist of value.playlists) {
    if (!playlist || typeof playlist.name !== 'string' || !Array.isArray(playlist.items)) throw new Error('Spotify playlist data is incomplete.');
    for (const item of playlist.items) {
      if (rows.length >= MAX_RECORDS) throw new Error('Spotify export has too many tracks.');
      const track = item && item.track;
      if (!track || typeof track.trackName !== 'string' || !track.trackName.trim() || typeof track.artistName !== 'string' || !track.artistName.trim()) throw new Error('Spotify playlist contains an incomplete track.');
      rows.push({ Playlist: playlist.name, Song: track.trackName, Artist: track.artistName, Album: typeof track.albumName === 'string' ? track.albumName : '', TrackUri: typeof track.trackUri === 'string' ? track.trackUri : '', SourceStatus: 'spotify-account' });
    }
  }
  return rows;
}

function zipEntries(buffer, onText) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0 || end + 22 > buffer.length) throw new Error('ZIP directory is incomplete.');
  const count = buffer.readUInt16LE(end + 10);
  let offset = buffer.readUInt32LE(end + 16);
  const entries = [];
  let declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error('ZIP entry is incomplete.');
    const method = buffer.readUInt16LE(offset + 10);
    const compressed = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const expectedCrc = buffer.readUInt32LE(offset + 16);
    if (buffer.readUInt16LE(offset + 8) & 1) throw new Error('Encrypted ZIP entries are not supported.');
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);
    const localOffset = buffer.readUInt32LE(offset + 42);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!/(?:^|\/)Playlist\d*\.json$/i.test(name)) continue;
    if (size > MAX_ENTRY_BYTES || compressed > MAX_ARCHIVE_BYTES || ![0, 8].includes(method)) throw new Error('Spotify ZIP entry is too large or unsupported.');
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('ZIP local entry is incomplete.');
    const start = localOffset + 30 + buffer.readUInt16LE(localOffset + 26) + buffer.readUInt16LE(localOffset + 28);
    if (start + compressed > buffer.length) throw new Error('ZIP data is incomplete.');
    declaredTotal += size;
    if (declaredTotal > MAX_TOTAL_EXPANDED_BYTES) throw new Error('Spotify ZIP expands beyond the size limit.');
    entries.push({ method, start, compressed, size, expectedCrc });
  }
  if (!entries.length) throw new Error('No Spotify Playlist JSON files were found in the ZIP.');
  let actualTotal = 0;
  for (const entry of entries) {
    const data = buffer.subarray(entry.start, entry.start + entry.compressed);
    let decoded = data;
    if (entry.method === 8) {
      try { decoded = zlib.inflateRawSync(data, { maxOutputLength: Math.min(MAX_ENTRY_BYTES, entry.size + 1) }); }
      catch (error) {
        if (error && error.code === 'ERR_BUFFER_TOO_LARGE') throw new Error('ZIP entry size does not match.');
        throw error;
      }
    }
    if (decoded.length !== entry.size) throw new Error('ZIP entry size does not match.');
    actualTotal += decoded.length;
    if (actualTotal > MAX_TOTAL_EXPANDED_BYTES) throw new Error('Spotify ZIP expands beyond the size limit.');
    if (crc32(decoded) !== entry.expectedCrc) throw new Error('ZIP entry is corrupted.');
    onText(decoded.toString('utf8'));
  }
}

async function parseSpotifyAccountFile(filePath) {
  const stat = await fs.promises.stat(filePath);
  if (!stat.isFile() || stat.size > MAX_ARCHIVE_BYTES) throw new Error('Spotify export exceeds the 64 MB limit.');
  const buffer = await fs.promises.readFile(filePath);
  const extension = path.extname(filePath).toLowerCase();
  const records = [];
  if (extension === '.zip') zipEntries(buffer, (text) => spotifyRows(text, records));
  else spotifyRows(buffer.toString('utf8'), records);
  if (records.length > MAX_RECORDS) throw new Error('Spotify export has too many tracks.');
  return { ok: true, sourcePath: filePath, format: 'spotify-account', name: 'Spotify Playlists', records, summary: { entries: records.length, statuses: { 'spotify-account': records.length } } };
}

module.exports = { parseSpotifyAccountFile, crc32, tableCrc32 };
