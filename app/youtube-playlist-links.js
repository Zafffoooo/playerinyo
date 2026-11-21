'use strict';

const { playlistChanges } = require('./youtube-playlist-archive');

const CHECK_INTERVAL = 4 * 60 * 60 * 1000;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,80}$/;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const HOSTS = new Set(['music.youtube.com', 'www.youtube.com', 'youtube.com', 'm.youtube.com', 'youtu.be']);

function playlistIdFromUrl(url) {
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !HOSTS.has(url.hostname)) return null;
  const allowedPath = /^\/(playlist|watch)\/?$/.test(url.pathname) ||
    (url.hostname === 'youtu.be' && /^\/[\w-]{11}\/?$/.test(url.pathname));
  const id = url.searchParams.get('list');
  return allowedPath && PLAYLIST_ID.test(id || '') ? id : null;
}

function playlistUrl(id) {
  return `https://music.youtube.com/playlist?list=${id}`;
}

function youtubeTrackRecord(row) {
  return { Song: row.name, Artist: row.artist, Album: '', VideoId: row.videoId,
    SourceUrl: `https://music.youtube.com/watch?v=${row.videoId}`, SourceFormat: 'url' };
}

function decodePlaylistResult(result, id) {
  if (result.cancelled) return { ok: false, cancelled: true };
  const fail = error => ({ ok: false, error });
  const incomplete = () => fail('YouTube returned an incomplete playlist. Try again.');
  if (result.timedOut) return fail('The YouTube playlist request timed out. Try again.');
  if (result.error?.code === 'ENOENT') return fail('yt-dlp is required to read YouTube playlists. Install it and try again.');
  if (/incomplete data|did not get any data|unable to (?:download|extract).*continuation/i.test(result.stderr)) return incomplete();
  if (!result.ok) {
    if (/private|does not exist|unavailable|not available|not exist|not found|login required|sign in to (?:view|access)/i.test(result.stderr)) {
      return fail('This YouTube playlist is private or unavailable. Check that the link opens without signing in.');
    }
    return fail('Could not read this YouTube playlist. Check your connection and try again.');
  }
  let data;
  try { data = JSON.parse(result.stdout); } catch { return incomplete(); }
  if (data?.id !== id || !Array.isArray(data.entries)) return incomplete();
  if (data.availability === 'private') return fail('This YouTube playlist is private. Use a public or unlisted playlist link.');
  if (!data.entries.length) return fail('YouTube returned an empty playlist.');
  if (data.entries.length > 2000 || Number(data.playlist_count) > data.entries.length ||
      data.entries.some(row => !row || !VIDEO_ID.test(row.id || ''))) return incomplete();
  const tracks = data.entries.map(row => {
    const title = String(row.title || '').trim().slice(0, 300);
    const placeholder = /^\[?(?:private|deleted|unavailable) video\]?$/i.test(title);
    const unavailable = !title || placeholder || row.is_playable === false ||
      ['private', 'premium_only', 'subscriber_only', 'needs_auth'].includes(row.availability);
    return { videoId: row.id, name: placeholder ? '' : title,
      artist: String(row.artist || row.uploader || row.channel || '').trim().slice(0, 200), unavailable };
  });
  const coverUrl = Array.isArray(data.thumbnails) ? String(data.thumbnails.at(-1)?.url || '') : '';
  return { ok: true, name: String(data.title || 'YouTube Music Playlist').slice(0, 200),
    coverUrl: /^https:\/\//.test(coverUrl) ? coverUrl.slice(0, 4096) : '', tracks };
}

function updateArchive(prior, result, now) {
  const previous = prior?.tracks || [];
  const known = new Map((prior?.known || []).map(row => [row.videoId, { ...row }]));
  const counts = new Map();
  for (const row of result.tracks) {
    counts.set(row.videoId, (counts.get(row.videoId) || 0) + 1);
    const old = known.get(row.videoId);
    known.set(row.videoId, { videoId: row.videoId, name: (!row.unavailable && row.name) || old?.name || row.name,
      artist: (!row.unavailable && row.artist) || old?.artist || row.artist, count: old?.count || 0 });
  }
  for (const [id, count] of counts) known.get(id).count = Math.max(known.get(id).count, count);
  const withMetadata = row => {
    const { name, artist } = known.get(row.videoId);
    return { ...row, name, artist };
  };
  const diff = (left, right) => playlistChanges(
    left.map(row => ({ ...row, key: row.videoId })), right.map(row => ({ key: row.videoId }))
  ).map(({ key, ...row }) => row);
  const tracks = result.tracks.map(withMetadata);
  const available = rows => rows.filter(row => !row.unavailable);
  const added = prior ? diff(available(tracks), available(previous)) : [];
  const recentlyRemoved = diff(previous, tracks);
  const recentCounts = new Map();
  for (const row of recentlyRemoved) recentCounts.set(row.videoId, (recentCounts.get(row.videoId) || 0) + 1);
  const removed = [];
  for (const { count, ...row } of known.values()) {
    const missing = count - (counts.get(row.videoId) || 0);
    for (let index = 0; index < missing; index++) removed.push({ ...row, recentlyRemoved: index < (recentCounts.get(row.videoId) || 0) });
  }
  return { ...prior, name: result.name, tracks, known: [...known.values()], added, removed, lastSuccess: now, error: '' };
}

function createPlaylistLinkTracker({ load, save, read, canCheck = () => true, now = Date.now, onError = console.warn }) {
  let entries;
  let writeTail = Promise.resolve();
  let checkTail = Promise.resolve();
  let timer;
  let running = false;
  let refreshing = false;
  const checks = new Map();
  const state = () => entries || (entries = new Map(load().map(row => [row.id, row])));
  const nextCheck = row => row.lastAttempt + CHECK_INTERVAL;

  function schedule(minimumDelay = 0) {
    clearTimeout(timer);
    if (!running || refreshing) return;
    let due = Infinity;
    for (const row of state().values()) {
      if (row.following) due = Math.min(due, nextCheck(row));
    }
    if (Number.isFinite(due)) {
      timer = setTimeout(() => refreshDue().catch(error => {
        onError(error);
        schedule(60000);
      }), Math.min(2147483647, Math.max(minimumDelay, due - now()))).unref();
    }
  }
  function queueWrite(operation) {
    const task = writeTail.then(operation);
    writeTail = task.catch(() => {});
    return task;
  }
  async function store(row) {
    const updated = new Map(state()).set(row.id, row);
    await save([...updated.values()]);
    entries = updated;
    schedule();
    return row;
  }
  function check(id, dueOnly = false) {
    const pending = checks.get(id);
    if (pending) {
      if (!dueOnly) pending.dueOnly = false;
      return pending.task;
    }
    const request = { dueOnly };
    const task = checkTail.then(async () => {
      const attempt = await queueWrite(() => {
        const prior = state().get(id);
        if (!canCheck() || !prior?.following || (request.dueOnly && (!running || nextCheck(prior) > now()))) return null;
        return store({ ...prior, lastAttempt: now(), error: 'The last check did not finish.' });
      });
      if (!attempt) return state().get(id) || null;
      let result;
      try { result = await read(id); }
      catch (error) {
        onError(error);
        result = { ok: false, error: 'Could not check the YouTube playlist. Try again.' };
      }
      return queueWrite(() => {
        const current = state().get(id);
        if (current !== attempt) return current;
        return store(result.ok ? updateArchive(attempt, result, now()) :
          { ...attempt, error: result.error || 'Could not check the YouTube playlist.' });
      });
    });
    request.task = task;
    checks.set(id, request);
    checkTail = task.catch(() => {});
    const clear = () => checks.delete(id);
    task.then(clear, clear);
    return task;
  }
  async function refreshDue() {
    if (refreshing) return;
    refreshing = true;
    try {
      for (const row of state().values()) {
        if (row.following && nextCheck(row) <= now()) await check(row.id, true);
      }
    } finally {
      refreshing = false;
    }
    schedule();
  }
  return {
    list: () => [...state().values()].map(({ known, tracks, removed, added, ...row }) => ({ ...row, count: tracks.length })),
    get: id => state().get(id) || null,
    follow: (id, result, readAt) => queueWrite(() => {
      const prior = state().get(id);
      if (prior?.following) return prior;
      const next = prior && prior.lastSuccess >= readAt ? prior : updateArchive(prior, result, readAt);
      return store({ ...next, id, following: true, lastAttempt: Math.max(prior?.lastAttempt || 0, readAt) });
    }),
    stop: id => queueWrite(() => {
      const row = state().get(id);
      if (!row?.following) return row || null;
      const error = checks.has(id) && row.error === 'The last check did not finish.' ? '' : row.error;
      return store({ ...row, following: false, error });
    }),
    check,
    reload() { entries = undefined; },
    start() { running = true; schedule(); },
    close() { running = false; clearTimeout(timer); }
  };
}

module.exports = { CHECK_INTERVAL, playlistIdFromUrl, playlistUrl, youtubeTrackRecord, decodePlaylistResult, createPlaylistLinkTracker };
