'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const CLIENT_ID = 'd85db5c7dc4f4f7abb48dbca4b2c6a89';
const REDIRECT_URI = 'http://127.0.0.1:8888/callback';
const API_BASE = 'https://api.spotify.com/v1';
const MAX_PLAYLIST_ITEMS = 250000;
function spotifyCoverUrl(images) {
  const candidate = Array.isArray(images) && images.find(image => image && typeof image.url === 'string');
  if (!candidate || candidate.url.length > 4096) return '';
  try {
    const url = new URL(candidate.url);
    if (url.protocol !== 'https:' || url.username || url.password || !/(?:^|\.)(?:scdn\.co|spotifycdn\.com)$/.test(url.hostname)) return '';
    return url.href;
  } catch (_) { return ''; }
}

function createSpotifyAccountClient({ userDataPath, safeStorage, openExternal, isSecureStorageAvailable = () => safeStorage.isEncryptionAvailable(), fetchImpl = fetch }) {
  const authPath = path.join(userDataPath, 'spotify-account-auth.json');
  let refreshToken = '';
  let accessToken = '';
  let expiresAt = 0;
  let account = null;
  let pendingLogin = null;
  const imports = new Map();

  function secureStorageReady() { return !!(safeStorage && isSecureStorageAvailable()); }
  function load() {
    if (!secureStorageReady()) return;
    try {
      const saved = JSON.parse(fs.readFileSync(authPath, 'utf8'));
      if (saved.version !== 1 || typeof saved.refreshToken !== 'string') return;
      refreshToken = safeStorage.decryptString(Buffer.from(saved.refreshToken, 'base64'));
      account = saved.account && typeof saved.account.id === 'string' ? saved.account : null;
    } catch (_) { /* Missing or unusable credentials leave the account disconnected. */ }
  }
  function save() {
    if (!secureStorageReady() || !refreshToken) throw new Error('Secure credential storage is unavailable.');
    const data = { version: 1, refreshToken: safeStorage.encryptString(refreshToken).toString('base64'), account };
    const tempPath = authPath + '.tmp';
    fs.writeFileSync(tempPath, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tempPath, authPath);
  }
  load();
  function status() { return { connected: !!refreshToken, secureStorageAvailable: secureStorageReady(), account: account ? { id: account.id, name: account.name } : null }; }
  function disconnect() {
    if (pendingLogin) pendingLogin.cancel();
    imports.forEach(controller => controller.abort()); imports.clear();
    refreshToken = ''; accessToken = ''; expiresAt = 0; account = null;
    try { fs.unlinkSync(authPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return status();
  }
  async function tokenRequest(params) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetchImpl('https://accounts.spotify.com/api/token', {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
      });
      if (!response.ok) throw new Error('Spotify authorization failed (HTTP ' + response.status + ').');
      const result = await response.json();
      if (!result || typeof result.access_token !== 'string' || !Number(result.expires_in)) throw new Error('Spotify returned an incomplete token response.');
      accessToken = result.access_token;
      expiresAt = Date.now() + Math.max(0, Number(result.expires_in) - 60) * 1000;
      if (typeof result.refresh_token === 'string' && result.refresh_token) refreshToken = result.refresh_token;
      if (refreshToken) save();
    } finally { clearTimeout(timeout); }
  }
  async function ensureToken(force) {
    if (!refreshToken) throw new Error('Connect your Spotify account first.');
    if (force || !accessToken || Date.now() >= expiresAt) await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
    return accessToken;
  }
  async function requestApi(apiPath, signal) {
    const url = new URL(apiPath, API_BASE + '/');
    if (url.protocol !== 'https:' || url.hostname !== 'api.spotify.com' || !url.pathname.startsWith('/v1/')) throw new Error('Spotify returned an invalid page URL.');
    for (let attempt = 0; attempt < 4; attempt++) {
      const token = await ensureToken(false);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const abort = () => controller.abort();
      if (signal) { if (signal.aborted) throw new Error('Import cancelled.'); signal.addEventListener('abort', abort, { once: true }); }
      try {
        const response = await fetchImpl(url, { signal: controller.signal, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
        if (response.status === 401 && attempt === 0) { await ensureToken(true); continue; }
        if (response.status === 429 && attempt < 3) {
          const retry = Math.min(15000, Math.max(1000, (Number(response.headers.get('retry-after')) || 1) * 1000));
          await new Promise(resolve => setTimeout(resolve, retry));
          continue;
        }
        if (response.status === 403) throw new Error('Spotify denied playlist access. Check the app allowlist and playlist permissions.');
        if (!response.ok) throw new Error('Spotify playlist request failed (HTTP ' + response.status + ').');
        if (Number(response.headers.get('content-length')) > 4 * 1024 * 1024) throw new Error('Spotify response is too large.');
        const body = await response.text();
        if (Buffer.byteLength(body, 'utf8') > 4 * 1024 * 1024) throw new Error('Spotify response is too large.');
        return JSON.parse(body);
      } finally {
        clearTimeout(timeout);
        if (signal) signal.removeEventListener('abort', abort);
      }
    }
    throw new Error('Spotify is rate limiting requests. Try again later.');
  }
  async function connect() {
    if (!secureStorageReady()) throw new Error('Secure credential storage is unavailable on this computer.');
    if (pendingLogin) throw new Error('Spotify sign-in is already open.');
    const verifier = crypto.randomBytes(48).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    const state = crypto.randomBytes(24).toString('base64url');
    const code = await new Promise((resolve, reject) => {
      const server = http.createServer((request, response) => {
        let callback;
        try { callback = new URL(request.url || '', REDIRECT_URI); } catch (_) { response.writeHead(400); response.end(); return; }
        if (callback.pathname !== '/callback') { response.writeHead(404); response.end(); return; }
        if (callback.searchParams.get('state') !== state) { response.writeHead(400); response.end('Invalid sign-in state.'); finish(new Error('Spotify sign-in state did not match.')); return; }
        if (callback.searchParams.get('error')) { response.writeHead(400); response.end('Sign-in declined.'); finish(new Error('Spotify sign-in was declined.')); return; }
        if (!callback.searchParams.get('code')) { response.writeHead(400); response.end('Missing authorization code.'); finish(new Error('Spotify did not return an authorization code.')); return; }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        response.end('<!doctype html><title>Playerinyo</title><p>You can return to Playerinyo.</p>');
        finish(null, callback.searchParams.get('code'));
      });
      const timer = setTimeout(() => finish(new Error('Spotify sign-in timed out.')), 180000);
      function finish(error, result) {
        if (!pendingLogin) return;
        pendingLogin = null;
        clearTimeout(timer);
        server.close();
        if (error) reject(error); else resolve(result);
      }
      pendingLogin = { cancel: () => finish(new Error('Spotify sign-in cancelled.')) };
      server.once('error', error => finish(error.code === 'EADDRINUSE' ? new Error('Port 8888 is in use. Close the other app and retry Spotify sign-in.') : error));
      server.listen(8888, '127.0.0.1', async () => {
        const authUrl = new URL('https://accounts.spotify.com/authorize');
        authUrl.search = new URLSearchParams({ client_id: CLIENT_ID, response_type: 'code', redirect_uri: REDIRECT_URI, state, scope: 'playlist-read-private playlist-read-collaborative', code_challenge_method: 'S256', code_challenge: challenge }).toString();
        try { await openExternal(authUrl.toString()); }
        catch (error) { finish(error); }
      });
    });
    await tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, code_verifier: verifier });
    const profile = await requestApi('/v1/me');
    account = { id: String(profile.id || ''), name: String(profile.display_name || profile.id || 'Spotify account').slice(0, 150) };
    save();
    return status();
  }
  async function listPlaylists() {
    const profile = await requestApi('/v1/me');
    account = { id: String(profile.id || ''), name: String(profile.display_name || profile.id || 'Spotify account').slice(0, 150) };
    save();
    const playlists = [];
    let next = '/v1/me/playlists?limit=50';
    while (next && playlists.length < 2000) {
      const page = await requestApi(next);
      if (!Array.isArray(page.items)) throw new Error('Spotify returned an incomplete playlist page.');
      playlists.push(...page.items);
      next = page.next;
    }
    if (next) throw new Error('Spotify returned too many playlists to review safely.');
    return { account: status().account, playlists: playlists.filter(playlist => playlist && (playlist.owner?.id === account.id || playlist.collaborative)).map(playlist => ({ id: playlist.id, name: String(playlist.name || 'Untitled playlist').slice(0, 200), count: Number(playlist.items?.total ?? playlist.tracks?.total) || 0, owner: String(playlist.owner?.display_name || playlist.owner?.id || ''), snapshotId: String(playlist.snapshot_id || ''), coverUrl: spotifyCoverUrl(playlist.images) })) };
  }
  async function importPlaylist(playlistId, requestId, onProgress) {
    if (!/^[A-Za-z0-9]{22}$/.test(playlistId) || !/^[A-Za-z0-9_-]{1,80}$/.test(requestId)) throw new Error('Invalid playlist request.');
    const controller = new AbortController(); imports.set(requestId, controller);
    try {
      const playlist = await requestApi('/v1/playlists/' + playlistId, controller.signal);
      if (playlist.owner?.id !== account?.id && !playlist.collaborative) throw new Error('Only your own or collaborative playlists are available in Spotify development mode.');
      const records = [];
      let next = '/v1/playlists/' + playlistId + '/items?limit=50';
      let expected = null;
      while (next) {
        if (controller.signal.aborted) throw new Error('Import cancelled.');
        const page = await requestApi(next, controller.signal);
        if (!Array.isArray(page.items)) throw new Error('Spotify returned an incomplete playlist page.');
        if (expected === null) expected = Number(page.total);
        if (!Number.isSafeInteger(expected) || expected < 0 || expected > MAX_PLAYLIST_ITEMS) throw new Error('Spotify playlist is too large or incomplete.');
        for (const row of page.items) {
          const item = row && (row.item || row.track);
          if (!item || item.type !== 'track' || !item.name) {
            records.push({ Playlist: String(playlist.name || 'Spotify Playlist'), Song: 'Unavailable item', Artist: '', Album: '', SourceStatus: 'unavailable' });
          } else {
            records.push({ Playlist: String(playlist.name || 'Spotify Playlist'), Song: String(item.name).slice(0, 300), Artist: String((item.artists || []).map(artist => artist.name).filter(Boolean).join(', ')).slice(0, 200), Album: String(item.album?.name || '').slice(0, 300), TrackUri: String(item.uri || ''), SourceStatus: 'spotify-login' });
          }
        }
        if (records.length > MAX_PLAYLIST_ITEMS || records.length > expected) throw new Error('Spotify playlist changed while reading. Retry the import.');
        onProgress({ requestId, done: records.length, total: expected });
        next = page.next;
      }
      if (records.length !== expected) throw new Error('Spotify playlist changed while reading. Retry the import.');
      if (!records.length) throw new Error('This Spotify playlist is empty.');
      return { ok: true, format: 'spotify-login', sourcePath: 'spotify:playlist:' + playlistId, name: String(playlist.name || 'Spotify Playlist').slice(0, 200), coverUrl: spotifyCoverUrl(playlist.images), records };
    } finally { imports.delete(requestId); }
  }
  function cancelImport(requestId) {
    const controller = imports.get(String(requestId || ''));
    if (!controller) return false;
    controller.abort(); return true;
  }
  return { status, connect, cancelLogin: () => pendingLogin && pendingLogin.cancel(), disconnect, listPlaylists, importPlaylist, cancelImport };
}

module.exports = { createSpotifyAccountClient, CLIENT_ID, REDIRECT_URI };
