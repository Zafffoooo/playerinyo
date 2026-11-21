'use strict';

const { parse } = require('csv-parse/sync');
const { createHash } = require('node:crypto');
const { zipEntries } = require('./spotify-account-playlists');

const VIDEO_ID = /^[\w-]{11}$/;
const clean = input => typeof input === 'string' ? input.trim().slice(0, 500) : '';

function parseArchiveCsv(text) {
  const lines = parse(text, { bom: true, skip_empty_lines: true, relax_column_count: true, max_record_size: 10000 });
  const header = lines.shift()?.map(value => value.trim().toLowerCase()) || [];
  const column = (...names) => header.findIndex(value => names.includes(value));
  const idCol = column('video id', 'videoid', 'video id (youtube)');
  const titleCol = column('song', 'title', 'track', 'song title');
  const artistCol = column('artist', 'artist name');
  if (idCol < 0 && titleCol < 0) throw new Error('CSV needs a Video ID or Song column.');
  const playlistCol = column('playlist', 'playlist title');
  const albumCol = column('album', 'album title');
  return lines.map(row => ({
    name: clean(row[titleCol]), artist: clean(row[artistCol]), album: clean(row[albumCol]),
    videoId: VIDEO_ID.test(clean(row[idCol])) ? clean(row[idCol]) : '',
    playlist: clean(row[playlistCol]),
  })).filter(row => row.name || row.videoId);
}

function readArchiveInput(input, filename) {
  const lists = new Map();
  function add(text, name) {
    for (const { playlist, ...row } of parseArchiveCsv(text)) {
      const key = playlist || name;
      if (!lists.has(key)) lists.set(key, []);
      lists.get(key).push(row);
    }
  }
  if (/\.zip$/i.test(filename)) {
    zipEntries(input, (text, name) => add(text, name.split('/').at(-1).replace(/[ -]videos\.csv$/i, '')),
      name => /(?:^|\/)playlists\/[^/]+[ -]videos\.csv$/i.test(name), true);
  } else if (/\.csv$/i.test(filename)) add(input.toString('utf8'), filename.replace(/\.csv$/i, ''));
  else throw new Error('Choose a Takeout ZIP or playlist CSV.');
  return [...lists].map(([name, tracks]) => ({ name, tracks }));
}

function makeArchiveVersion(name, tracks, previous, now = Date.now()) {
  const known = new Map(previous.flatMap(item => item.tracks).filter(row => row.videoId && row.name).map(row => [row.videoId, row]));
  const normalized = tracks.map(row => {
    const old = known.get(row.videoId);
    return { ...row, name: row.name || old?.name || '', artist: row.artist || old?.artist || '' };
  });
  const id = createHash('sha256').update(JSON.stringify([name, normalized])).digest('hex');
  return { id, name, tracks: normalized, savedAt: now };
}

function playlistChanges(oldRows, newRows) {
  const counts = new Map();
  for (const row of newRows) counts.set(row.key, (counts.get(row.key) || 0) + 1);
  return oldRows.filter(row => {
    const count = counts.get(row.key) || 0;
    if (!count) return true;
    counts.set(row.key, count - 1);
    return false;
  });
}

module.exports = { readArchiveInput, parseArchiveCsv, makeArchiveVersion, playlistChanges };
