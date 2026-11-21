'use strict';

function normalizeListenbrainzTrack(track, playingNow, now) {
  const artist = typeof track?.artist === 'string' ? track.artist.trim().slice(0, 500) : '';
  const title = typeof track?.title === 'string' ? track.title.trim().slice(0, 500) : '';
  const album = typeof track?.album === 'string' ? track.album.trim().slice(0, 500) : '';
  const startedAtSeconds = track?.startedAtSeconds;
  if (!artist || !title || (!playingNow && (!Number.isSafeInteger(startedAtSeconds) ||
      startedAtSeconds < 1033430400 || startedAtSeconds > Math.floor(now / 1000)))) return null;
  return { artist, title, album, startedAtSeconds };
}

function createListenBrainzClient({ fetchJson, fetchArchive, now = Date.now }) {
  let nextRequestAt = 0;
  let tail = Promise.resolve();

  function request(endpoint, token, body, archive = false, isCurrent) {
    const task = tail.then(async () => {
      const wait = nextRequestAt - now();
      if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
      if (isCurrent && !isCurrent()) throw new Error('ListenBrainz account changed.');
      nextRequestAt = now() + 1000;
      return (archive ? fetchArchive : fetchJson)('https://api.listenbrainz.org/1/' + endpoint, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: 'Token ' + token, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        redirect: 'error',
        signal: AbortSignal.timeout(archive ? 120000 : 10000),
      });
    });
    tail = task.catch(() => {});
    return task;
  }

  return {
    async recentListens(username, token, cursor, count) {
      const data = await request(`user/${encodeURIComponent(username)}/listens?max_ts=${cursor}&count=${count}`, token);
      return data?.payload?.listens;
    },
    listExports: token => request('export/list', token),
    createExport: token => request('export/', token, {}),
    exportStatus: (token, id) => request('export/' + id, token),
    downloadExport: (token, id) => request('export/' + id + '/download', token, undefined, true),
    async validateToken(token) {
      const data = await request('validate-token', token);
      return data?.valid === true && typeof data.user_name === 'string' ? data.user_name.trim().slice(0, 500) : '';
    },
    async submit(token, track, playingNow, isCurrent) {
      const normalized = normalizeListenbrainzTrack(track, playingNow, now());
      if (!normalized) return false;
      const metadata = { artist_name: normalized.artist, track_name: normalized.title };
      if (normalized.album) metadata.release_name = normalized.album;
      const listen = { track_metadata: metadata };
      if (!playingNow) listen.listened_at = normalized.startedAtSeconds;
      const result = await request('submit-listens', token, { listen_type: playingNow ? 'playing_now' : 'single', payload: [listen] }, false, isCurrent);
      return result?.status === 'ok';
    },
  };
}

module.exports = { createListenBrainzClient, normalizeListenbrainzTrack };
