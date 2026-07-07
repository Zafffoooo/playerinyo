const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, globalShortcut, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { pathToFileURL, fileURLToPath } = require('url');
const { parse } = require('csv-parse');
const NodeID3 = require('node-id3');

// Discord RPC
let DiscordRPC = null;
let discordClient = null;
let discordEnabled = false;
try {
  DiscordRPC = require('discord-rpc');
  DiscordRPC.register('497005876856053760'); // generic clientId - works without app approval for RPC
} catch (e) { console.log('discord-rpc not available:', e.message); }

let discordLastError = null;
async function discordConnect() {
  if (!DiscordRPC) { discordLastError = "discord-rpc module missing (run npm install)"; return; }
  if (discordClient) return;
  discordLastError = null;
  try {
    discordClient = new DiscordRPC.Client({ transport: 'ipc' });
    discordClient.on('ready', () => { discordEnabled = true; discordLastError = null; console.log('Discord RPC connected'); });
    discordClient.on('disconnected', () => { discordEnabled = false; discordClient = null; discordLastError = "Disconnected from Discord"; });
    await discordClient.login({ clientId: '497005876856053760' });
  } catch (e) { console.log('Discord RPC connect failed:', e.message); discordLastError = e.message; discordClient = null; }
}

async function discordSetActivity(title, artist, album, startTime) {
  if (!discordClient || !discordEnabled) return;
  try {
    await discordClient.setActivity({
      details: title || 'Unknown Track',
      state: artist ? 'by ' + artist : 'Unknown Artist',
      largeImageKey: 'music',
      largeImageText: album || '',
      startTimestamp: startTime ? new Date(startTime) : undefined,
      instance: false,
    });
  } catch (e) { console.log('Discord setActivity error:', e); }
}

async function discordClear() {
  if (!discordClient) return;
  try { await discordClient.clearActivity(); } catch (e) { }
}

function getLfmSignature(params, sharedSecret) {
  if (!sharedSecret) return null;
  let keys = Object.keys(params).sort();
  let sig = "";
  for (let k of keys) {
    if (k !== 'format') sig += k + params[k];
  }
  sig += sharedSecret;
  return crypto.createHash('md5').update(sig, 'utf8').digest('hex');
}

// We use dynamic import for music-metadata because modern versions are ESM-only,
// but since we are installing version 7, we can use require.
// However, to be safe against versions, dynamic import or require('music-metadata') works.
let mainWindow;
let mm;
let tray = null;
let trayAvailable = false;
let isQuitting = false;
let appSettings = { minimizeToTray: false, useNativeTitleBar: false, ytdlCookiesMode: 'none', ytdlCookiesBrowser: 'firefox', ytdlCookiesFile: '' };
let mprisPlayer = null;
let mprisTrackId = 0;
let mprisTrackKey = '';
let mprisPositionUs = 0;
let mprisPositionUpdatedAt = 0;
let spotifyTokenCache = { token: '', expiresAt: 0, key: '' };
const metadataCoverCache = new Map();
const downloadSearchCache = new Map();
const downloadSearchInFlight = new Map();
const activeYtdlpDownloads = new Map();
const cancelledYtdlpDownloads = new Set();
const DOWNLOAD_SEARCH_CACHE_TTL_MS = 10 * 60 * 1000;
const SENSITIVE_SETTING_KEYS = ['lastfmApiKey', 'lastfmSharedSecret', 'lastfmSessionKey', 'discogsToken', 'spotifyClientId', 'spotifyClientSecret'];
const APP_NAME = 'Playerinyo';
const APP_ID = 'playerinyo';
const APP_USER_AGENT = `${APP_NAME}/1.0.0`;
const APP_ICON = path.join(__dirname, 'assets', 'icon.png');

app.setName(APP_NAME);
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('class', APP_ID);
  app.commandLine.appendSwitch('name', APP_ID);
  if (typeof app.setDesktopName === 'function') app.setDesktopName(`${APP_ID}.desktop`);
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

function serializeSettingsForDisk(settings) {
  const next = { ...settings };
  if (!safeStorage.isEncryptionAvailable()) return next;
  for (const key of SENSITIVE_SETTING_KEYS) {
    if (typeof next[key] === 'string' && next[key]) {
      next[key] = {
        __secure: 'electron',
        value: safeStorage.encryptString(next[key]).toString('base64'),
      };
    }
  }
  return next;
}

function deserializeSettingsFromDisk(settings) {
  const next = { ...settings };
  for (const key of SENSITIVE_SETTING_KEYS) {
    const value = next[key];
    if (!value || typeof value !== 'object' || value.__secure !== 'electron' || typeof value.value !== 'string') continue;
    if (!safeStorage.isEncryptionAvailable()) {
      next[key] = '';
      continue;
    }
    try {
      next[key] = safeStorage.decryptString(Buffer.from(value.value, 'base64'));
    } catch (e) {
      console.error(`Failed to decrypt setting: ${key}`, e);
      next[key] = '';
    }
  }
  return next;
}

function readJsonFile(filePath, fallback) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) { console.error('Failed to read JSON:', filePath, e); }
  return fallback;
}

const fileWriteQueues = new Map();

async function writeTextFileAtomic(filePath, text) {
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    await fs.promises.writeFile(tmpPath, text, 'utf8');
    await fs.promises.rename(tmpPath, filePath);
  } catch (e) {
    try { await fs.promises.unlink(tmpPath); } catch (_) { }
    throw e;
  }
}

function queueTextFileWrite(filePath, text) {
  const previous = fileWriteQueues.get(filePath) || Promise.resolve();
  const next = previous.catch(() => { }).then(() => writeTextFileAtomic(filePath, text));
  fileWriteQueues.set(filePath, next);
  const cleanup = () => { if (fileWriteQueues.get(filePath) === next) fileWriteQueues.delete(filePath); };
  next.then(cleanup, cleanup);
  return next;
}

function queueJsonWrite(filePath, data) {
  return queueTextFileWrite(filePath, JSON.stringify(data));
}

function sanitizeSettingsForBackup(settings) {
  const next = { ...(settings || {}) };
  for (const key of SENSITIVE_SETTING_KEYS) delete next[key];
  return next;
}

function summarizeBackupData(data) {
  return {
    library: Array.isArray(data && data.library) ? data.library.length : 0,
    playlists: Array.isArray(data && data.playlists) ? data.playlists.length : 0,
    likedSongs: Array.isArray(data && data.likedSongs) ? data.likedSongs.length : 0,
    hasSettings: !!(data && data.settings && typeof data.settings === 'object'),
    hasMappings: !!(data && data.mappings && typeof data.mappings === 'object'),
  };
}


async function loadMM() {
  mm = await import('music-metadata');
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    frame: appSettings.useNativeTitleBar === true,
    icon: APP_ICON,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true,
    backgroundColor: '#000000'
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('close', (event) => {
    if (!isQuitting && appSettings.minimizeToTray && trayAvailable) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

function showMainWindow() {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendPlayerAction(action, detail) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('thumbar-action', action, detail);
}

function initMprisPlayer() {
  if (process.platform !== 'linux' || mprisPlayer) return;
  try {
    const MprisService = require('mpris-service');
    mprisPlayer = MprisService({
      name: APP_ID,
      identity: APP_NAME,
      desktopEntry: APP_ID,
      supportedUriSchemes: ['file'],
      supportedMimeTypes: ['audio/mpeg', 'audio/flac', 'audio/mp4', 'audio/wav', 'audio/x-wav'],
      supportedInterfaces: ['player']
    });

    mprisPlayer.playbackStatus = 'Stopped';
    mprisPlayer.loopStatus = 'None';
    mprisPlayer.rate = 1;
    mprisPlayer.minimumRate = 1;
    mprisPlayer.maximumRate = 1;
    mprisPlayer.volume = 1;
    mprisPlayer.canControl = true;
    mprisPlayer.canPlay = true;
    mprisPlayer.canPause = true;
    mprisPlayer.canSeek = true;
    mprisPlayer.canGoNext = true;
    mprisPlayer.canGoPrevious = true;

    mprisPlayer.getPosition = function () {
      if (mprisPlayer.playbackStatus !== 'Playing') return Math.max(0, Math.floor(mprisPositionUs));
      const elapsedUs = Math.max(0, Date.now() - mprisPositionUpdatedAt) * 1000;
      return Math.max(0, Math.floor(mprisPositionUs + elapsedUs));
    };

    mprisPlayer.on('raise', showMainWindow);
    mprisPlayer.on('quit', () => { isQuitting = true; app.quit(); });
    mprisPlayer.on('next', () => sendPlayerAction('next'));
    mprisPlayer.on('previous', () => sendPlayerAction('prev'));
    mprisPlayer.on('playpause', () => sendPlayerAction('playpause'));
    mprisPlayer.on('play', () => sendPlayerAction('play'));
    mprisPlayer.on('pause', () => sendPlayerAction('pause'));
    mprisPlayer.on('stop', () => sendPlayerAction('pause'));
    mprisPlayer.on('seek', (offset) => sendPlayerAction('seek', offset));
    mprisPlayer.on('position', (event) => sendPlayerAction('set-position', event && event.position));
    mprisPlayer.on('shuffle', (enabled) => { mprisPlayer.shuffle = !!enabled; });
    mprisPlayer.on('loopStatus', (status) => { mprisPlayer.loopStatus = status || 'None'; });
    mprisPlayer.on('volume', (volume) => { mprisPlayer.volume = volume; sendPlayerAction('volume', volume); });
    mprisPlayer.on('error', (err) => console.log('MPRIS error:', err && err.message ? err.message : err));
  } catch (e) {
    mprisPlayer = null;
    console.log('MPRIS unavailable:', e && e.message ? e.message : e);
  }
}

function updateMpris(payload) {
  if (!mprisPlayer || !payload || typeof payload !== 'object') return false;
  const hasTrack = !!payload.title;
  const status = hasTrack ? (payload.isPlaying ? 'Playing' : 'Paused') : 'Stopped';
  const positionSeconds = Number(payload.positionSeconds || 0);
  const durationSeconds = Number(payload.durationSeconds || 0);
  const trackKey = String(payload.filePath || `${payload.title || ''}::${payload.artist || ''}::${payload.album || ''}`);

  if (hasTrack && trackKey !== mprisTrackKey) {
    mprisTrackKey = trackKey;
    mprisTrackId++;
  }

  mprisPositionUs = Math.max(0, Math.floor(positionSeconds * 1000000));
  mprisPositionUpdatedAt = Date.now();
  mprisPlayer.playbackStatus = status;
  mprisPlayer.shuffle = !!payload.shuffle;
  mprisPlayer.loopStatus = payload.loopStatus || 'None';
  mprisPlayer.canSeek = durationSeconds > 0;
  mprisPlayer.volume = typeof payload.volume === 'number' ? payload.volume : mprisPlayer.volume;

  if (!hasTrack) {
    mprisTrackKey = '';
    mprisPlayer.metadata = {};
    return true;
  }

  const metadata = {
    'mpris:trackid': mprisPlayer.objectPath(`track/${mprisTrackId}`),
    'xesam:title': String(payload.title || 'Unknown Track'),
    'xesam:artist': [String(payload.artist || 'Unknown Artist')],
  };
  if (payload.album) metadata['xesam:album'] = String(payload.album);
  if (durationSeconds > 0) metadata['mpris:length'] = Math.floor(durationSeconds * 1000000);
  if (payload.artUrl) metadata['mpris:artUrl'] = String(payload.artUrl);
  if (payload.fileUrl) metadata['xesam:url'] = String(payload.fileUrl);
  mprisPlayer.metadata = metadata;
  if (payload.seeked) {
    try { mprisPlayer.seeked(mprisPositionUs); } catch (e) { }
  }
  return true;
}

function registerGlobalShortcut(accelerator, action, failures) {
  try {
    const registered = globalShortcut.register(accelerator, () => {
      if (mainWindow) mainWindow.webContents.send('thumbar-action', action);
    });
    if (!registered && failures) failures.push({ accelerator, action, error: 'Unavailable or already registered' });
    return registered;
  } catch (e) {
    if (failures) failures.push({ accelerator, action, error: e.message || String(e) });
    console.log('Failed to register shortcut:', accelerator, e.message || e);
    return false;
  }
}

if (gotSingleInstanceLock) {
app.on('second-instance', () => {
  showMainWindow();
});

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.playerinyo.playerinyo');
  Menu.setApplicationMenu(null);
  loadSettingsFromDisk();
  await loadMM();
  createWindow();
  initMprisPlayer();

  try {
    const icon = nativeImage.createFromPath(APP_ICON);
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
      { label: `Show ${APP_NAME}`, click: () => mainWindow.show() },
      {
        label: 'Quit', click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setToolTip(APP_NAME);
    tray.setContextMenu(contextMenu);
    tray.on('click', () => mainWindow.show());
    trayAvailable = true;
  } catch (e) {
    trayAvailable = false;
    console.log("Tray init error:", e);
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  registerGlobalShortcut('MediaPlayPause', 'playpause');
  registerGlobalShortcut('MediaNextTrack', 'next');
  registerGlobalShortcut('MediaPreviousTrack', 'prev');
});
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});

// IPC Handler: Open Folder
ipcMain.handle('open-external', async (event, url) => {
  try {
    const parsed = new URL(String(url || ''));
    if (parsed.protocol !== 'https:') return false;
    await shell.openExternal(parsed.href);
    return true;
  } catch (e) {
    return false;
  }
});

ipcMain.handle('show-item-in-folder', async (event, fullPath) => {
  fullPath = normalizePathInput(fullPath);
  if (typeof fullPath !== 'string' || !path.isAbsolute(fullPath) || !fs.existsSync(fullPath)) return false;
  shell.showItemInFolder(fullPath);
  return true;
});

ipcMain.handle('window-control', async (event, action) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return false;
  if (action === 'minimize') win.minimize();
  else if (action === 'toggle-maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
  else if (action === 'close') win.close();
  else return false;
  return true;
});

ipcMain.on('mpris-update', (event, payload) => {
  updateMpris(payload);
});

ipcMain.handle('dialog:openFolder', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory']
  });
  if (canceled) {
    return null;
  } else {
    return filePaths[0];
  }
});

ipcMain.handle('get-default-download-folder', () => getDefaultDownloadFolder());

ipcMain.handle('check-ytdlp-tools', async () => {
  const ytdlp = await runProcess('yt-dlp', ['--version'], { timeoutMs: 8000 });
  const ffmpeg = await runProcess('ffmpeg', ['-version'], { timeoutMs: 8000 });
  return {
    ytdlp: ytdlp.ok ? (ytdlp.stdout || '').trim().split(/\s+/)[0] : '',
    ffmpeg: ffmpeg.ok ? (ffmpeg.stdout || '').trim().split(/\s+/)[0] : '',
    ok: ytdlp.ok && ffmpeg.ok,
    error: !ytdlp.ok ? 'yt-dlp was not found in PATH.' : (!ffmpeg.ok ? 'ffmpeg was not found in PATH.' : '')
  };
});

ipcMain.handle('search-download-candidates', async (event, track, limit) => {
  try {
    const meta = normalizeImportTrackMeta(track);
    if (!meta.title || !meta.artist) return { ok: false, error: 'Track title and artist are required.', candidates: [] };
    const max = Math.max(1, Math.min(10, parseInt(limit, 10) || 5));
    const cacheKey = getDownloadSearchCacheKey(meta, max);
    const cached = downloadSearchCache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < DOWNLOAD_SEARCH_CACHE_TTL_MS) return { ...cached.result, cached: true };
    if (downloadSearchInFlight.has(cacheKey)) return await downloadSearchInFlight.get(cacheKey);

    const searchPromise = searchDownloadCandidates(meta, max)
      .then((result) => {
        if (result && result.ok) downloadSearchCache.set(cacheKey, { createdAt: Date.now(), result });
        return result;
      })
      .finally(() => { downloadSearchInFlight.delete(cacheKey); });
    downloadSearchInFlight.set(cacheKey, searchPromise);
    return await searchPromise;
  } catch (e) {
    return { ok: false, error: e.message || String(e), candidates: [] };
  }
});

async function searchDownloadCandidates(meta, max) {
  try {
    const perQuery = Math.max(4, Math.min(5, max));
    const queries = buildDownloadSearchQueries(meta);
    const result = await runProcess('yt-dlp', [
      '--ignore-config',
      '--dump-json',
      '--flat-playlist',
      '--skip-download',
      '--no-playlist',
      ...queries.map(query => `ytsearch${perQuery}:${query}`)
    ], { timeoutMs: 2 * 60 * 1000 });
    const candidateMap = new Map();
    result.stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean).forEach((line) => {
      let item = null;
      try { item = JSON.parse(line); }
      catch (e) { return; }
      const thumbnails = Array.isArray(item.thumbnails) ? item.thumbnails : [];
      const bestThumb = thumbnails.length ? thumbnails[thumbnails.length - 1].url : (item.thumbnail || '');
      const candidate = {
        id: item.id || '',
        title: item.title || '',
        uploader: item.uploader || item.channel || '',
        channel: item.channel || item.uploader || '',
        duration: parseDurationSeconds(item.duration || item.duration_string || 0),
        webpageUrl: item.webpage_url || (item.id ? `https://www.youtube.com/watch?v=${item.id}` : (item.original_url || item.url || '')),
        thumbnail: bestThumb || '',
        channelVerified: item.channel_is_verified === true,
      };
      const key = candidate.id || candidate.webpageUrl || normalizeSearchText(`${candidate.title} ${candidate.uploader}`);
      if (!key) return;
      candidate.score = downloadCandidateScore(meta, candidate);
      const existing = candidateMap.get(key);
      if (existing) {
        existing.score = Math.max(existing.score, candidate.score);
        existing.seen = (existing.seen || 1) + 1;
        if (!existing.thumbnail && candidate.thumbnail) existing.thumbnail = candidate.thumbnail;
        if (!existing.duration && candidate.duration) existing.duration = candidate.duration;
      } else {
        candidate.seen = 1;
        candidateMap.set(key, candidate);
      }
    });
    const candidates = Array.from(candidateMap.values()).map((candidate) => {
      if (candidate.seen > 1) candidate.score += Math.min(16, (candidate.seen - 1) * 4);
      candidate.confidence = candidateConfidence(candidate.score);
      return candidate;
    }).sort((a, b) => b.score - a.score).slice(0, max);
    if (!result.ok && !candidates.length) {
      return { ok: false, error: formatYtdlpError(result.stderr || result.stdout, 'yt-dlp search failed.'), candidates: [] };
    }
    return { ok: true, queries, candidates };
  } catch (e) {
    return { ok: false, error: e.message || String(e), candidates: [] };
  }
}

ipcMain.handle('download-playlist-track', async (event, track, downloadRoot, requestId) => {
  try {
    const meta = normalizeImportTrackMeta(track);
    if (!meta.title || !meta.artist) return { ok: false, error: 'Track title and artist are required.' };
    const root = normalizePathInput(downloadRoot) || getDefaultDownloadFolder();
    if (!path.isAbsolute(root)) return { ok: false, error: 'Download folder must be an absolute path.' };
    await fs.promises.mkdir(root, { recursive: true });
    const targetPath = await ensureUniquePath(buildDownloadTargetPath(track, root));
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });

    const tempDir = path.join(root, '.downloading', `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
    await fs.promises.mkdir(tempDir, { recursive: true });
    const query = buildDownloadSearchQueries(meta)[0] || `${meta.artist} ${meta.title}`;
    const source = meta.downloadUrl || `ytsearch1:${query}`;
    const args = [
      '--ignore-config',
      '--no-playlist',
      '--format', 'bestaudio/best',
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '320K',
      '--output', path.join(tempDir, 'download.%(ext)s'),
      ...getYtdlpAuthArgs(),
      source
    ];
    requestId = String(requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const sendProgress = (chunk) => {
      if (!requestId || !event.sender || event.sender.isDestroyed()) return;
      const matches = String(chunk || '').matchAll(/\[download\]\s+(\d+(?:\.\d+)?)%/g);
      let last = null;
      for (const match of matches) last = Number(match[1]);
      if (last !== null && !Number.isNaN(last)) event.sender.send('download-progress', { requestId, percent: last });
    };
    const result = await runProcess('yt-dlp', args, { timeoutMs: 10 * 60 * 1000, processKey: requestId, onStdout: sendProgress, onStderr: sendProgress });
    if (result.cancelled) {
      try { await fs.promises.rm(tempDir, { recursive: true, force: true }); } catch (e) { }
      return { ok: false, cancelled: true, error: 'Download cancelled.' };
    }
    if (!result.ok) {
      try { await fs.promises.rm(tempDir, { recursive: true, force: true }); } catch (e) { }
      return { ok: false, error: formatYtdlpError(result.stderr || result.stdout, 'yt-dlp failed.'), ageRestricted: isYtdlpAgeRestrictedError(result.stderr || result.stdout) };
    }

    const tempFiles = await fs.promises.readdir(tempDir);
    const mp3 = tempFiles.find(f => path.extname(f).toLowerCase() === '.mp3');
    if (!mp3) {
      try { await fs.promises.rm(tempDir, { recursive: true, force: true }); } catch (e) { }
      return { ok: false, error: 'yt-dlp finished, but no MP3 file was created.' };
    }
    await fs.promises.rename(path.join(tempDir, mp3), targetPath);
    try { await fs.promises.rm(tempDir, { recursive: true, force: true }); } catch (e) { }

    await writeDownloadedMp3Metadata(targetPath, track);
    const libraryItem = await buildLibraryItemFromAudioFile(targetPath);
    if (requestId && event.sender && !event.sender.isDestroyed()) event.sender.send('download-progress', { requestId, percent: 100 });
    return { ok: true, filePath: targetPath, libraryItem, targetPath };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('cancel-download', async (event, requestId) => {
  requestId = String(requestId || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  if (!requestId) return false;
  const child = activeYtdlpDownloads.get(requestId);
  if (!child) return false;
  cancelledYtdlpDownloads.add(requestId);
  try { child.kill('SIGTERM'); return true; }
  catch (e) { return false; }
});

// IPC Handler: Open File (CSV)
ipcMain.handle('dialog:openFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });
  if (canceled) {
    return null;
  } else {
    return filePaths[0];
  }
});

ipcMain.handle('dialog:openCookiesFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Cookies', extensions: ['txt'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  return canceled ? null : filePaths[0];
});

// IPC Handler: Open Image File (for custom playlist cover)
ipcMain.handle('dialog:openImage', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'bmp', 'webp', 'tiff', 'tif', 'gif', 'avif'] }]
  });
  return canceled ? null : getSafeFileUrl(filePaths[0]);
});

// IPC Handler: Open Audio File (for manual match)
ipcMain.handle('dialog:openAudio', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'wav', 'flac', 'm4a'] }]
  });
  return canceled ? null : filePaths[0];
});

ipcMain.handle('scan-audio-file', async (event, filePath) => {
  filePath = normalizePathInput(filePath);
  if (!isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) return null;
  try { return await buildLibraryItemFromAudioFile(filePath); }
  catch (e) { console.error('Failed to scan audio file:', e); return null; }
});

async function walkDir(dir, supportedExtensions, fileList) {
  let files;
  try {
    files = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR')) {
      console.warn('Skipping missing directory:', dir);
    } else {
      console.error('Error reading directory', dir, e);
    }
    return;
  }
  for (const file of files) {
    const fullPath = path.join(dir, file.name);
    if (file.isDirectory()) {
      await walkDir(fullPath, supportedExtensions, fileList);
    } else {
      const ext = path.extname(file.name).toLowerCase();
      if (supportedExtensions.includes(ext)) {
        fileList.push(fullPath);
      }
    }
  }
}

const folderCoverCache = new Map();

async function findFallbackCover(dirPath) {
  if (folderCoverCache.has(dirPath)) return folderCoverCache.get(dirPath);
  // Priority names first, then any image in folder
  const priorityNames = [
    'folder.jpg', 'folder.jpeg', 'cover.jpg', 'cover.jpeg', 'front.jpg', 'front.jpeg',
    'folder.png', 'cover.png', 'folder.bmp', 'cover.bmp', 'folder.webp', 'cover.webp'
  ];
  const extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff', '.tif', '.gif', '.avif'];
  try {
    const files = await fs.promises.readdir(dirPath);
    const filesLower = files.map(f => f.toLowerCase());
    // Check priority names first
    for (const name of priorityNames) {
      const idx = filesLower.indexOf(name);
      if (idx !== -1) {
        const coverPath = path.join(dirPath, files[idx]);
        const fileUrl = getSafeFileUrl(coverPath);
        folderCoverCache.set(dirPath, fileUrl);
        return fileUrl;
      }
    }
    // Then any image
    for (const file of files) {
      if (extensions.includes(path.extname(file).toLowerCase())) {
        const coverPath = path.join(dirPath, file);
        const fileUrl = getSafeFileUrl(coverPath);
        folderCoverCache.set(dirPath, fileUrl);
        return fileUrl;
      }
    }
  } catch (e) {
    folderCoverCache.set(dirPath, null);
    return null;
  }
  folderCoverCache.set(dirPath, null);
  return null;
}

const LIBRARY_FILE = path.join(app.getPath('userData'), 'library.json');
const PLAYLISTS_FILE = path.join(app.getPath('userData'), 'playlists.json');
const MAPPINGS_FILE = path.join(app.getPath('userData'), 'mappings.json');
const SETTINGS_FILE = path.join(app.getPath('userData'), 'settings.json');
const COVERS_DIR = path.join(app.getPath('userData'), 'covers');

if (!fs.existsSync(COVERS_DIR)) {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
}

function getDefaultDownloadFolder() {
  let musicDir = '';
  try { musicDir = app.getPath('music'); }
  catch (e) { musicDir = app.getPath('home'); }
  return path.join(musicDir || app.getPath('home'), `${APP_NAME} Downloads`);
}

function sanitizePathSegment(value, fallback) {
  let s = String(value || '').trim();
  if (!s) s = fallback || 'Unknown';
  s = s.replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ').replace(/\s+/g, ' ').trim();
  s = s.replace(/[. ]+$/g, '');
  if (!s) s = fallback || 'Unknown';
  return s.slice(0, 110);
}

function parseTrackNumber(value) {
  if (value === null || value === undefined) return 0;
  const match = String(value).match(/\d+/);
  return match ? parseInt(match[0], 10) || 0 : 0;
}

function parseDurationSeconds(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return value > 1000 ? Math.round(value / 1000) : value;
  const s = String(value).trim();
  if (/^\d+(?:\.\d+)?$/.test(s)) {
    const n = parseFloat(s);
    return n > 1000 ? Math.round(n / 1000) : n;
  }
  const parts = s.split(':').map(part => parseFloat(part) || 0);
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return 0;
}

function normalizeSearchText(value) {
  return String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function searchTokens(value) {
  return normalizeSearchText(value).split(/\s+/).filter(token => token.length > 2);
}

function tokenCoverage(tokens, text) {
  if (!tokens.length) return 0;
  const hit = tokens.filter(token => text.includes(token)).length;
  return hit / tokens.length;
}

function searchArtistVariants(value) {
  const normalized = String(value || '')
    .replace(/\b(feat\.?|featuring|ft\.?|with)\b/ig, ',')
    .split(/,|&|\+/)
    .map(part => searchTokens(part))
    .filter(tokens => tokens.length);
  return normalized.length ? normalized : [searchTokens(value)].filter(tokens => tokens.length);
}

function bestTokenCoverage(tokenGroups, text) {
  return tokenGroups.reduce((best, tokens) => Math.max(best, tokenCoverage(tokens, text)), 0);
}

function formatYtdlpError(raw, fallback) {
  const text = String(raw || '').trim();
  if (!text) return fallback;
  if (isYtdlpAgeRestrictedError(text)) {
    return 'YouTube requires sign-in/age confirmation for this video. Pick another candidate, or enable YouTube cookies in Settings.';
  }
  return text.split(/\r?\n/).map(line => line.trim()).filter(Boolean).slice(-3).join('\n').slice(0, 600) || fallback;
}

function isYtdlpAgeRestrictedError(raw) {
  return /sign in to confirm your age|inappropriate for some users|cookies-from-browser|pass cookies/i.test(String(raw || ''));
}

function getYtdlpAuthArgs() {
  const mode = appSettings.ytdlCookiesMode || 'none';
  if (mode === 'browser') {
    const allowed = new Set(['firefox', 'chrome', 'chromium', 'brave', 'edge', 'vivaldi', 'opera']);
    const browser = allowed.has(appSettings.ytdlCookiesBrowser) ? appSettings.ytdlCookiesBrowser : 'firefox';
    return ['--cookies-from-browser', browser];
  }
  if (mode === 'file') {
    const cookiePath = normalizePathInput(appSettings.ytdlCookiesFile || '');
    if (cookiePath && path.isAbsolute(cookiePath) && isExistingFileWithExt(cookiePath, ['.txt'])) return ['--cookies', cookiePath];
  }
  return [];
}

function getDownloadSearchCacheKey(meta, max) {
  return [
    normalizeSearchText(meta.title),
    normalizeSearchText(meta.artist),
    normalizeSearchText(meta.album),
    Math.round(Number(meta.duration || 0)),
    max,
  ].join('|');
}

function buildDownloadSearchQueries(meta) {
  const title = String(meta.title || '').trim();
  const artist = String(meta.artist || '').trim();
  const album = String(meta.album || '').trim();
  const queries = [
    `"${title}" "${artist}"`,
    `${artist} ${title}`,
    `${title} ${artist} topic`,
  ];
  if (album) queries.push(`${title} ${artist} ${album}`);
  queries.push(`${artist} ${title} official audio`);
  return Array.from(new Set(queries.map(q => q.replace(/\s+/g, ' ').trim()).filter(Boolean)));
}

function downloadCandidateScore(meta, candidate) {
  const expectedTitle = normalizeSearchText(meta.title);
  const expectedArtist = normalizeSearchText(meta.artist);
  const expectedAlbum = normalizeSearchText(meta.album);
  const titleTokens = searchTokens(meta.title);
  const artistGroups = searchArtistVariants(meta.artist);
  const title = normalizeSearchText(candidate.title || '');
  const uploader = normalizeSearchText(candidate.uploader || candidate.channel || '');
  const combined = `${title} ${uploader}`;
  const titleCoverage = tokenCoverage(titleTokens, title);
  const uploaderArtistCoverage = bestTokenCoverage(artistGroups, uploader);
  const titleArtistCoverage = bestTokenCoverage(artistGroups, title);
  const combinedArtistCoverage = bestTokenCoverage(artistGroups, combined);
  let score = 0;

  if (expectedTitle && title.includes(expectedTitle)) score += 58;
  else score += Math.round(titleCoverage * 34);

  if (expectedArtist && uploader.includes(expectedArtist)) score += 48;
  else score += Math.round(uploaderArtistCoverage * 44);
  if (!(expectedArtist && uploader.includes(expectedArtist)) && titleArtistCoverage >= 0.8) score += 12;
  else if (titleArtistCoverage >= 0.5) score += 6;

  if (expectedAlbum && combined.includes(expectedAlbum)) score += 8;
  if (/\btopic\b/.test(uploader) && uploaderArtistCoverage >= 0.8) score += 22;
  if (candidate.channelVerified && uploaderArtistCoverage >= 0.8) score += 6;
  if (/official audio|provided to youtube|auto generated|audio only/i.test(candidate.title || '')) score += 8;
  if (/official/i.test(candidate.uploader || candidate.channel || '')) score += 3;
  if (titleCoverage < 0.5) score -= 28;
  if (artistGroups.length && uploaderArtistCoverage < 0.45) score -= titleArtistCoverage >= 0.8 ? 34 : 26;
  if (artistGroups.length && combinedArtistCoverage < 0.45) score -= 14;
  if (/live|slowed|nightcore|sped up|remix|cover|karaoke|instrumental|sound effect|sfx|tutorial|photoshop|scam|compilation|mix -/i.test(candidate.title || '')) score -= 28;
  if (/sound effect|sfx|audio library|piximperfect/i.test(candidate.uploader || candidate.channel || '')) score -= 22;
  if (meta.duration && candidate.duration) {
    const diff = Math.abs(Number(candidate.duration) - Number(meta.duration));
    if (diff <= 3) score += 20;
    else if (diff <= 8) score += 12;
    else if (diff <= 20) score += 4;
    else score -= 18;
  }
  return score;
}

function candidateConfidence(score) {
  if (score >= 70) return 'high';
  if (score >= 45) return 'medium';
  return 'low';
}

function normalizeImportTrackMeta(track) {
  track = track && typeof track === 'object' ? track : {};
  const title = track.title || track.Song || track.song || track.Name || track.name || track.TITLE || '';
  const artist = track.artist || track.Artist || track.ARTIST || '';
  const album = track.album || track.Album || track.ALBUM || '';
  const albumArtist = track.albumArtist || track.AlbumArtist || track['Album Artist'] || track.Album_Artist || '';
  const albumDate = track.albumDate || track['Album Date'] || track.AlbumDate || track.Year || track.year || '';
  const genre = track.genre || track.Genres || track.Genre || track.GENRE || '';
  const duration = parseDurationSeconds(track.duration || track.Duration || track.DURATION || '');
  const trackNo = parseTrackNumber(track.trackNo || track.TrackNo || track['Track No'] || track.TrackNumber || track['Track Number']);
  const discNo = parseTrackNumber(track.discNo || track.DiscNo || track['Disc No'] || track.DiscNumber || track['Disc Number']);
  const coverUrl = track.coverUrl || track.CoverUrl || track.Cover || track.Image || track.Artwork || track.thumbnailUrl || track.thumbnail || track.downloadThumbnail || '';
  const spotifyTrackId = track.spotifyTrackId || track['Spotify Track Id'] || track.SpotifyTrackId || '';
  const isrc = track.isrc || track.ISRC || '';
  const downloadUrl = track.downloadUrl || track.webpageUrl || track.webpage_url || track.url || '';
  return { title, artist, album, albumArtist, albumDate, genre, duration, trackNo, discNo, coverUrl, spotifyTrackId, isrc, downloadUrl };
}

function buildDownloadTargetPath(track, rootFolder) {
  const meta = normalizeImportTrackMeta(track);
  const root = normalizePathInput(rootFolder) || getDefaultDownloadFolder();
  if (!path.isAbsolute(root)) throw new Error('Download folder must be an absolute path');
  const artistFolder = sanitizePathSegment(meta.albumArtist || meta.artist, 'Unknown Artist');
  const albumFolder = sanitizePathSegment(meta.album || 'Singles', 'Singles');
  const title = sanitizePathSegment(meta.title, 'Unknown Track');
  const prefix = meta.trackNo ? String(meta.trackNo).padStart(2, '0') + ' - ' : '';
  return path.join(root, artistFolder, albumFolder, `${prefix}${title}.mp3`);
}

async function ensureUniquePath(filePath) {
  if (!fs.existsSync(filePath)) return filePath;
  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  for (let i = 2; i < 1000; i++) {
    const candidate = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error('Could not create a unique file path');
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd: options.cwd || undefined, shell: false, windowsHide: true });
    const processKey = options.processKey || '';
    if (processKey) activeYtdlpDownloads.set(processKey, child);
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeoutMs = options.timeoutMs || 0;
    const cleanup = () => {
      if (processKey) activeYtdlpDownloads.delete(processKey);
    };
    let timer = null;
    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill('SIGTERM'); } catch (e) { }
        cleanup();
        resolve({ ok: false, code: -1, stdout, stderr: stderr || 'Timed out' });
      }, timeoutMs);
    }
    child.stdout.on('data', (d) => { const s = d.toString(); stdout += s; if (options.onStdout) options.onStdout(s); });
    child.stderr.on('data', (d) => { const s = d.toString(); stderr += s; if (options.onStderr) options.onStderr(s); });
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cleanup();
      if (processKey && cancelledYtdlpDownloads.delete(processKey)) {
        resolve({ ok: false, cancelled: true, code: -1, stdout, stderr: stderr || 'Cancelled' });
        return;
      }
      resolve({ ok: false, code: -1, stdout, stderr: err.message || String(err), error: err });
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      cleanup();
      if (processKey && cancelledYtdlpDownloads.delete(processKey)) {
        resolve({ ok: false, cancelled: true, code, stdout, stderr: stderr || 'Cancelled' });
        return;
      }
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

async function writeDownloadedMp3Metadata(filePath, track) {
  const meta = normalizeImportTrackMeta(track);
  const tags = {};
  if (meta.title) tags.title = meta.title;
  if (meta.artist) tags.artist = meta.artist;
  if (meta.album) tags.album = meta.album;
  if (meta.albumArtist) tags.performerInfo = meta.albumArtist;
  if (meta.albumDate) tags.year = String(meta.albumDate).slice(0, 4);
  if (meta.genre) tags.genre = meta.genre;
  if (meta.trackNo) tags.trackNumber = String(meta.trackNo);
  if (meta.discNo) tags.partOfSet = String(meta.discNo);
  if (meta.coverUrl && /^https:\/\//i.test(meta.coverUrl)) {
    try {
      const cover = await fetchCachedCoverImage(meta.coverUrl);
      tags.image = {
        mime: cover.contentType.split(';')[0],
        type: { id: 3, name: 'front cover' },
        description: '',
        imageBuffer: cover.imageBuffer,
      };
      try { await fs.promises.writeFile(path.join(path.dirname(filePath), 'folder.jpg'), cover.imageBuffer); }
      catch (e) { console.error('Failed to write downloaded folder.jpg:', e); }
    } catch (e) {
      console.error('Failed to fetch downloaded track cover:', e);
    }
  }
  if (Object.keys(tags).length) NodeID3.update(tags, filePath);
}

async function buildLibraryItemFromAudioFile(filePath, fileStat) {
  filePath = normalizePathInput(filePath);
  if (!isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) return null;
  if (!fileStat) fileStat = await fs.promises.stat(filePath);
  const filename = path.basename(filePath);
  const dirPath = path.dirname(filePath);
  try {
    const metadata = await mm.parseFile(filePath);
    const rg = getReplayGainFields(metadata);
    const albumName = metadata.common.album || 'Unknown Album';
    const artistName = metadata.common.artist || 'Unknown Artist';
    const albumArtistName = metadata.common.albumartist || (metadata.common.compilation ? 'Various Artists' : null);
    let pictureDataUrl = await findFallbackCover(dirPath);
    if (!pictureDataUrl && metadata.common.picture && metadata.common.picture.length > 0) {
      const coverHash = crypto.createHash('md5').update(albumName + (albumArtistName || artistName)).digest('hex');
      const coverFilePath = path.join(COVERS_DIR, `${coverHash}.jpg`);
      if (!fs.existsSync(coverFilePath)) await fs.promises.writeFile(coverFilePath, metadata.common.picture[0].data);
      pictureDataUrl = getSafeFileUrl(coverFilePath);
    }
    return {
      filePath,
      filename,
      title: metadata.common.title || path.parse(filename).name,
      artist: artistName,
      albumArtist: albumArtistName,
      album: albumName,
      duration: metadata.format.duration || 0,
      picture: pictureDataUrl,
      trackNo: (metadata.common.track && metadata.common.track.no) ? metadata.common.track.no : 0,
      trackTotal: (metadata.common.track && metadata.common.track.of) ? metadata.common.track.of : 0,
      discNo: (metadata.common.disk && metadata.common.disk.no) ? metadata.common.disk.no : 0,
      discTotal: (metadata.common.disk && metadata.common.disk.of) ? metadata.common.disk.of : 0,
      year: metadata.common.year || null,
      genre: metadata.common.genre ? metadata.common.genre[0] : null,
      replayGainTrackDb: rg.replayGainTrackDb,
      replayGainAlbumDb: rg.replayGainAlbumDb,
      replayGainTrackPeak: rg.replayGainTrackPeak,
      replayGainAlbumPeak: rg.replayGainAlbumPeak,
      fileSize: fileStat.size,
      modifiedAtMs: fileStat.mtimeMs,
    };
  } catch (e) {
    return {
      filePath,
      filename,
      title: path.parse(filename).name,
      artist: 'Unknown Artist',
      albumArtist: null,
      album: 'Unknown Album',
      duration: 0,
      picture: await findFallbackCover(dirPath),
      trackNo: 0,
      trackTotal: 0,
      discNo: 0,
      discTotal: 0,
      year: null,
      genre: null,
      replayGainTrackDb: null,
      replayGainAlbumDb: null,
      replayGainTrackPeak: null,
      replayGainAlbumPeak: null,
      fileSize: fileStat.size,
      modifiedAtMs: fileStat.mtimeMs,
    };
  }
}

function loadSettingsFromDisk() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      appSettings = { ...appSettings, ...deserializeSettingsFromDisk(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'))) };
    }
  } catch (e) { console.error(e); }
  return appSettings;
}

function getSafeFileUrl(absolutePath) {
  return pathToFileURL(absolutePath).href;
}

function normalizePathInput(value) {
  if (typeof value !== 'string') return '';
  if (value.startsWith('file://')) {
    try { return fileURLToPath(value); }
    catch (e) { return ''; }
  }
  return value;
}

function isExistingDirectory(dirPath) {
  dirPath = normalizePathInput(dirPath);
  if (typeof dirPath !== 'string' || !path.isAbsolute(dirPath)) return false;
  try { return fs.statSync(dirPath).isDirectory(); }
  catch (e) { return false; }
}

function isExistingFileWithExt(filePath, extensions) {
  filePath = normalizePathInput(filePath);
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) return false;
  if (!extensions.includes(path.extname(filePath).toLowerCase())) return false;
  try { return fs.statSync(filePath).isFile(); }
  catch (e) { return false; }
}

function readReplayGainValue(value) {
  if (!value) return null;
  if (typeof value.dB === 'number') return value.dB;
  if (typeof value === 'number') return value;
  const match = String(value).match(/-?\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function readReplayGainPeak(value) {
  if (!value) return null;
  if (typeof value.ratio === 'number') return value.ratio;
  if (typeof value === 'number') return value;
  const match = String(value).match(/\d+(?:\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

function getReplayGainFields(metadata) {
  const common = metadata && metadata.common ? metadata.common : {};
  const format = metadata && metadata.format ? metadata.format : {};
  return {
    replayGainTrackDb: readReplayGainValue(common.replaygain_track_gain) ?? readReplayGainValue(format.trackGain),
    replayGainAlbumDb: readReplayGainValue(common.replaygain_album_gain) ?? readReplayGainValue(format.albumGain),
    replayGainTrackPeak: readReplayGainPeak(common.replaygain_track_peak),
    replayGainAlbumPeak: readReplayGainPeak(common.replaygain_album_peak),
  };
}

async function loadImageBufferFromSource(source) {
  if (!source || typeof source !== 'string') return null;
  if (/^https:\/\//i.test(source)) {
    const res = await fetch(new URL(source).href);
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.toLowerCase().startsWith('image/')) return null;
    return Buffer.from(await res.arrayBuffer());
  }
  if (source.startsWith('data:image/')) {
    const base64Data = source.replace(/^data:image\/\w+;base64,/, '');
    return Buffer.from(base64Data, 'base64');
  }
  let imagePath = source;
  if (source.startsWith('file://')) {
    try { imagePath = fileURLToPath(source); }
    catch (e) { return null; }
  }
  if (!isExistingFileWithExt(imagePath, IMAGE_EXTENSIONS)) return null;
  return fs.promises.readFile(imagePath);
}

async function fetchImageBuffer(url) {
  const res = await fetch(new URL(url).href, {
    headers: {
      'User-Agent': APP_USER_AGENT,
      'Accept': 'image/*,*/*;q=0.8',
    }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || 'image/jpeg';
  if (!contentType.toLowerCase().startsWith('image/')) throw new Error(`not an image: ${contentType}`);
  return { imageBuffer: Buffer.from(await res.arrayBuffer()), contentType };
}

async function fetchCoverImageWithFallback(sourceUrl) {
  const urls = [sourceUrl];
  if (/\/front-\d+$/i.test(sourceUrl)) {
    urls.push(sourceUrl.replace(/\/front-\d+$/i, '/front-500'));
    urls.push(sourceUrl.replace(/\/front-\d+$/i, '/front-250'));
    urls.push(sourceUrl.replace(/\/front-\d+$/i, '/front'));
  }
  let lastError = null;
  for (const url of [...new Set(urls)]) {
    try { return await fetchImageBuffer(url); }
    catch (e) { lastError = e; }
  }
  throw lastError || new Error('cover unavailable');
}

async function fetchCachedCoverImage(sourceUrl) {
  const key = String(sourceUrl || '').trim();
  if (!key) throw new Error('cover URL missing');
  if (!metadataCoverCache.has(key)) {
    metadataCoverCache.set(key, fetchCoverImageWithFallback(key).catch(err => {
      metadataCoverCache.delete(key);
      throw err;
    }));
    if (metadataCoverCache.size > 40) metadataCoverCache.delete(metadataCoverCache.keys().next().value);
  }
  return metadataCoverCache.get(key);
}

async function writeFolderJpgForTrack(filePath, imageSourceOrBuffer) {
  filePath = normalizePathInput(filePath);
  if (!isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) return false;
  const imageBuffer = Buffer.isBuffer(imageSourceOrBuffer) ? imageSourceOrBuffer : await loadImageBufferFromSource(imageSourceOrBuffer);
  if (!imageBuffer || !imageBuffer.length) return false;
  await fs.promises.writeFile(path.join(path.dirname(filePath), 'folder.jpg'), imageBuffer);
  return true;
}

const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.flac', '.m4a'];
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.bmp', '.webp', '.tiff', '.tif', '.gif', '.avif'];

ipcMain.handle('load-library', () => {
  try {
    if (fs.existsSync(LIBRARY_FILE)) {
      return JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
    }
  } catch (e) { console.error(e); }
  return [];
});

ipcMain.handle('save-library', async (event, musicFiles) => {
  try { await queueJsonWrite(LIBRARY_FILE, musicFiles); return true; }
  catch (e) { return false; }
});

ipcMain.handle('export-backup', async (event, extras) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: `${APP_NAME} Backup`, extensions: ['json'] }],
    defaultPath: `${APP_ID}_backup_${stamp}.json`,
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    const data = {
      library: readJsonFile(LIBRARY_FILE, []),
      playlists: readJsonFile(PLAYLISTS_FILE, []),
      mappings: readJsonFile(MAPPINGS_FILE, {}),
      settings: sanitizeSettingsForBackup(appSettings),
      likedSongs: extras && Array.isArray(extras.likedSongs) ? extras.likedSongs : [],
      exportedFrom: APP_NAME,
    };
    const payload = {
      app: APP_NAME,
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      data,
    };
    await fs.promises.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    return { ok: true, filePath, summary: summarizeBackupData(data) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('import-backup', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: `${APP_NAME} Backup`, extensions: ['json'] }],
  });
  if (canceled || !filePaths || !filePaths[0]) return { ok: false, canceled: true };
  try {
    const parsed = JSON.parse(await fs.promises.readFile(filePaths[0], 'utf8'));
    const data = parsed && parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    return { ok: true, filePath: filePaths[0], summary: summarizeBackupData(data) };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('restore-backup', async (event, backupPath) => {
  backupPath = normalizePathInput(backupPath);
  if (typeof backupPath !== 'string' || !path.isAbsolute(backupPath) || !fs.existsSync(backupPath)) return { ok: false, error: 'Invalid backup path' };
  try {
    const parsed = JSON.parse(await fs.promises.readFile(backupPath, 'utf8'));
    const data = parsed && parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    if (Array.isArray(data.library)) await queueJsonWrite(LIBRARY_FILE, data.library);
    if (Array.isArray(data.playlists)) await queueJsonWrite(PLAYLISTS_FILE, data.playlists);
    if (data.mappings && typeof data.mappings === 'object') await queueJsonWrite(MAPPINGS_FILE, data.mappings);
    if (data.settings && typeof data.settings === 'object') {
      appSettings = { ...appSettings, ...data.settings };
      await queueJsonWrite(SETTINGS_FILE, serializeSettingsForDisk(appSettings));
    }
    return { ok: true, summary: summarizeBackupData(data), likedSongs: Array.isArray(data.likedSongs) ? data.likedSongs : [] };
  } catch (e) {
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('check-library-files', async (event, musicFiles) => {
  if (!Array.isArray(musicFiles)) return { ok: false, missing: [] };
  const missing = [];
  for (let i = 0; i < musicFiles.length; i++) {
    const file = musicFiles[i];
    const filePath = normalizePathInput(file && typeof file.filePath === 'string' ? file.filePath : '');
    if (!path.isAbsolute(filePath) || !AUDIO_EXTENSIONS.includes(path.extname(filePath).toLowerCase())) continue;
    try {
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile()) missing.push(filePath);
    } catch (e) {
      missing.push(filePath);
    }
    if (i % 100 === 0) await new Promise((resolve) => setImmediate(resolve));
  }
  return { ok: true, missing };
});

// Back-fill year/genre for existing library files that are missing those fields
ipcMain.handle('backfill-metadata', async (event, musicFiles) => {
  let updated = 0;
  for (let f of musicFiles) {
    if ((f.year !== null && f.year !== undefined) && (f.genre !== null && f.genre !== undefined) && (f.discNo !== null && f.discNo !== undefined) && (f.discTotal !== null && f.discTotal !== undefined)) continue;
    const filePath = normalizePathInput(f.filePath);
    if (!filePath || !fs.existsSync(filePath)) continue;
    try {
      const metadata = await mm.parseFile(filePath, { duration: false });
      const rg = getReplayGainFields(metadata);
      if (f.year === null || f.year === undefined) f.year = metadata.common.year || null;
      if (f.genre === null || f.genre === undefined) f.genre = metadata.common.genre ? metadata.common.genre[0] : null;
      if (f.discNo === null || f.discNo === undefined) f.discNo = metadata.common.disk && metadata.common.disk.no ? metadata.common.disk.no : 0;
      if (f.discTotal === null || f.discTotal === undefined) f.discTotal = metadata.common.disk && metadata.common.disk.of ? metadata.common.disk.of : 0;
      if (f.trackTotal === null || f.trackTotal === undefined) f.trackTotal = metadata.common.track && metadata.common.track.of ? metadata.common.track.of : 0;
      if (f.replayGainTrackDb === null || f.replayGainTrackDb === undefined) f.replayGainTrackDb = rg.replayGainTrackDb;
      if (f.replayGainAlbumDb === null || f.replayGainAlbumDb === undefined) f.replayGainAlbumDb = rg.replayGainAlbumDb;
      if (f.replayGainTrackPeak === null || f.replayGainTrackPeak === undefined) f.replayGainTrackPeak = rg.replayGainTrackPeak;
      if (f.replayGainAlbumPeak === null || f.replayGainAlbumPeak === undefined) f.replayGainAlbumPeak = rg.replayGainAlbumPeak;
      updated++;
    } catch (e) { }
  }
  if (updated > 0) {
    try { await queueJsonWrite(LIBRARY_FILE, musicFiles); } catch (e) { }
  }
  return musicFiles;
});

ipcMain.handle('load-playlists', () => {
  try {
    if (fs.existsSync(PLAYLISTS_FILE)) return JSON.parse(fs.readFileSync(PLAYLISTS_FILE, 'utf8'));
  } catch (e) { console.error(e); }
  return [];
});

ipcMain.handle('save-playlists', async (event, playlists) => {
  try { await queueJsonWrite(PLAYLISTS_FILE, playlists); return true; }
  catch (e) { return false; }
});

ipcMain.handle('load-mappings', () => {
  try {
    if (fs.existsSync(MAPPINGS_FILE)) return JSON.parse(fs.readFileSync(MAPPINGS_FILE, 'utf8'));
  } catch (e) { console.error(e); }
  return {};
});

ipcMain.handle('save-mappings', async (event, mappings) => {
  try { await queueJsonWrite(MAPPINGS_FILE, mappings); return true; }
  catch (e) { return false; }
});

ipcMain.handle('load-settings', () => {
  loadSettingsFromDisk();
  if (appSettings && appSettings.discordRpc) {
    discordConnect();
  }
  return appSettings;
});

ipcMain.handle('save-settings', async (event, settings) => {
  try {
    const wasDiscord = appSettings.discordRpc;
    appSettings = settings;
    await queueJsonWrite(SETTINGS_FILE, serializeSettingsForDisk(settings));
    // Handle Discord toggle
    if (settings.discordRpc && !wasDiscord) discordConnect();
    else if (!settings.discordRpc && wasDiscord) { discordClear(); if (discordClient) { try { discordClient.destroy(); } catch (e) { } discordClient = null; discordEnabled = false; } }
    return true;
  }
  catch (e) { return false; }
});

ipcMain.handle('safe-storage-status', () => {
  return {
    encryptionAvailable: safeStorage.isEncryptionAvailable(),
    backend: typeof safeStorage.getSelectedStorageBackend === 'function' ? safeStorage.getSelectedStorageBackend() : '',
  };
});

// Discord RPC IPC handlers
ipcMain.handle('discord-update', async (event, title, artist, album, startTime) => {
  await discordSetActivity(title, artist, album, startTime);
  return true;
});
ipcMain.handle('discord-clear', async () => {
  await discordClear();
  return true;
});
ipcMain.handle('discord-status', () => { return { enabled: discordEnabled, error: discordLastError }; });

ipcMain.handle('get-metadata', async (event, filePath) => {
  filePath = normalizePathInput(filePath);
  if (!isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) return null;
  try {
    const metadata = await mm.parseFile(filePath);
    const rg = getReplayGainFields(metadata);
    return {
      year: metadata.common.year || null,
      codec: metadata.format.codec || null,
      bitrate: metadata.format.bitrate || null,
      sampleRate: metadata.format.sampleRate || null,
      genre: metadata.common.genre ? metadata.common.genre.join(', ') : null,
      albumartist: metadata.common.albumartist || null,
      discNo: metadata.common.disk && metadata.common.disk.no ? metadata.common.disk.no : 0,
      discTotal: metadata.common.disk && metadata.common.disk.of ? metadata.common.disk.of : 0,
      trackNo: metadata.common.track && metadata.common.track.no ? metadata.common.track.no : 0,
      trackTotal: metadata.common.track && metadata.common.track.of ? metadata.common.track.of : 0,
      replayGainTrackDb: rg.replayGainTrackDb,
      replayGainAlbumDb: rg.replayGainAlbumDb,
      replayGainTrackPeak: rg.replayGainTrackPeak,
      replayGainAlbumPeak: rg.replayGainAlbumPeak
    };
  } catch (e) {
    return null;
  }
});

function setFlacTag(flac, name, value) {
  if (value === null || value === undefined || value === '') return;
  const upper = name.toUpperCase();
  flac.tags = flac.tags.filter(item => item.split('=')[0].toUpperCase() !== upper);
  flac.tags.push(`${upper}=${String(value)}`);
}

function buildVorbisComment(vendorString, comments) {
  const vendor = Buffer.from(vendorString || APP_ID, 'utf8');
  const vendorLen = Buffer.alloc(4);
  vendorLen.writeUInt32LE(vendor.length, 0);
  const count = Buffer.alloc(4);
  count.writeUInt32LE(comments.length, 0);
  const parts = [vendorLen, vendor, count];
  comments.forEach(comment => {
    const body = Buffer.from(comment, 'utf8');
    const len = Buffer.alloc(4);
    len.writeUInt32LE(body.length, 0);
    parts.push(len, body);
  });
  return Buffer.concat(parts);
}

function parseVorbisComment(block) {
  let offset = 0;
  if (!block || block.length < 8) return { vendor: APP_ID, tags: [] };
  const vendorLen = block.readUInt32LE(offset); offset += 4;
  const vendor = block.slice(offset, offset + vendorLen).toString('utf8'); offset += vendorLen;
  if (offset + 4 > block.length) return { vendor, tags: [] };
  const count = block.readUInt32LE(offset); offset += 4;
  const tags = [];
  for (let i = 0; i < count && offset + 4 <= block.length; i++) {
    const len = block.readUInt32LE(offset); offset += 4;
    if (offset + len > block.length) break;
    tags.push(block.slice(offset, offset + len).toString('utf8'));
    offset += len;
  }
  return { vendor, tags };
}

function buildFlacPictureBlock(image) {
  const mime = Buffer.from((image.mime || 'image/jpeg').split(';')[0], 'ascii');
  const description = Buffer.alloc(0);
  const data = image.imageBuffer;
  const pictureType = Buffer.alloc(4);
  const mimeLength = Buffer.alloc(4);
  const descriptionLength = Buffer.alloc(4);
  const width = Buffer.alloc(4);
  const height = Buffer.alloc(4);
  const depth = Buffer.alloc(4);
  const colors = Buffer.alloc(4);
  const pictureLength = Buffer.alloc(4);
  pictureType.writeUInt32BE(3, 0);
  mimeLength.writeUInt32BE(mime.length, 0);
  descriptionLength.writeUInt32BE(description.length, 0);
  width.writeUInt32BE(0, 0);
  height.writeUInt32BE(0, 0);
  depth.writeUInt32BE(0, 0);
  colors.writeUInt32BE(0, 0);
  pictureLength.writeUInt32BE(data.length, 0);
  return Buffer.concat([pictureType, mimeLength, mime, descriptionLength, description, width, height, depth, colors, pictureLength, data]);
}

function buildFlacMetadataBlock(type, data, isLast) {
  if (data.length > 0xffffff) throw new Error('FLAC metadata block is too large');
  const header = Buffer.alloc(4);
  header[0] = (isLast ? 0x80 : 0) | (type & 0x7f);
  header.writeUIntBE(data.length, 1, 3);
  return Buffer.concat([header, data]);
}

function updateFlacMetadata(filePath, tags) {
  const input = fs.readFileSync(filePath);
  const markerOffset = input.indexOf(Buffer.from('fLaC'));
  if (markerOffset < 0) throw new Error('FLAC marker not found');
  const prefix = input.slice(0, markerOffset);
  let offset = markerOffset + 4;
  const blocks = [];
  while (offset + 4 <= input.length) {
    const first = input[offset];
    const isLast = !!(first & 0x80);
    const type = first & 0x7f;
    const length = input.readUIntBE(offset + 1, 3);
    offset += 4;
    if (offset + length > input.length) throw new Error('Invalid FLAC metadata length');
    blocks.push({ type, data: input.slice(offset, offset + length) });
    offset += length;
    if (isLast) break;
  }
  if (!blocks.length || blocks[0].type !== 0) throw new Error('Invalid FLAC streaminfo block');
  const audioFrames = input.slice(offset);
  let vorbisIndex = blocks.findIndex(block => block.type === 4);
  let parsed = vorbisIndex >= 0 ? parseVorbisComment(blocks[vorbisIndex].data) : { vendor: APP_ID, tags: [] };
  const flac = { tags: parsed.tags };
  if (tags.title) setFlacTag(flac, 'TITLE', tags.title);
  if (tags.artist) setFlacTag(flac, 'ARTIST', tags.artist);
  if (tags.album) setFlacTag(flac, 'ALBUM', tags.album);
  if (tags.performerInfo) setFlacTag(flac, 'ALBUMARTIST', tags.performerInfo);
  if (tags.year) setFlacTag(flac, 'DATE', tags.year);
  if (tags.genre) setFlacTag(flac, 'GENRE', tags.genre);
  if (tags.trackNumber) setFlacTag(flac, 'TRACKNUMBER', tags.trackNumber);
  if (tags.trackTotal) setFlacTag(flac, 'TOTALTRACKS', tags.trackTotal);
  if (tags.discNumber) setFlacTag(flac, 'DISCNUMBER', tags.discNumber);
  if (tags.discTotal) setFlacTag(flac, 'TOTALDISCS', tags.discTotal);
  if (tags.partOfSet) {
    setFlacTag(flac, 'DISCNUMBER', tags.partOfSet);
    const parts = String(tags.partOfSet).split('/');
    if (parts[1]) setFlacTag(flac, 'TOTALDISCS', parts[1]);
  }
  const vorbisBlock = { type: 4, data: buildVorbisComment(parsed.vendor, flac.tags) };
  if (vorbisIndex >= 0) blocks[vorbisIndex] = vorbisBlock;
  else blocks.splice(1, 0, vorbisBlock);
  if (tags.image && tags.image.imageBuffer) {
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].type === 6) blocks.splice(i, 1);
    }
    blocks.push({ type: 6, data: buildFlacPictureBlock(tags.image) });
  }
  const metadata = blocks.map((block, index) => buildFlacMetadataBlock(block.type, block.data, index === blocks.length - 1));
  fs.writeFileSync(filePath, Buffer.concat([prefix, Buffer.from('fLaC'), ...metadata, audioFrames]));
  return true;
}

ipcMain.handle('save-metadata', async (event, filePaths, tags, saveFolderJpg) => {
  try {
    if (!Array.isArray(filePaths) || filePaths.length === 0 || !tags || typeof tags !== 'object') return { ok: false, error: 'Invalid metadata save request' };
    let success = true;
    const normalizedFilePaths = filePaths.map(normalizePathInput);
    const editablePaths = normalizedFilePaths.filter(fp => isExistingFileWithExt(fp, ['.mp3', '.flac']));
    if (editablePaths.length !== filePaths.length) return { ok: false, error: 'Only existing MP3 and FLAC files can be edited' };

    // Helper: get MIME type from file extension
    function getMimeFromExt(filePath) {
      const ext = path.extname(filePath).toLowerCase();
      const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
        '.bmp': 'image/bmp', '.webp': 'image/webp', '.gif': 'image/gif',
        '.tiff': 'image/tiff', '.tif': 'image/tiff', '.avif': 'image/avif' };
      return mimeMap[ext] || 'image/jpeg';
    }

    // Normalize image: if it's a remote cover URL, download it into buffer form.
    if (tags.image && /^https:\/\//i.test(tags.image)) {
      try {
        const cover = await fetchCachedCoverImage(tags.image);
        if (saveFolderJpg && filePaths.length > 0) {
          try { await writeFolderJpgForTrack(filePaths[0], cover.imageBuffer); }
          catch (err) { console.error('Failed to save folder.jpg', err); }
        }
        tags.image = {
          mime: cover.contentType.split(';')[0],
          type: { id: 3, name: 'front cover' },
          description: '',
          imageBuffer: cover.imageBuffer,
        };
      } catch (coverErr) {
        console.warn('Cover download failed, saving metadata without cover:', coverErr.message || coverErr);
        delete tags.image;
      }
    } else if (tags.image && !tags.image.startsWith('data:image/')) {
      // It's a file path
      if (isExistingFileWithExt(tags.image, IMAGE_EXTENSIONS)) {
        const imageBuffer = fs.readFileSync(tags.image);
        const mimeType = getMimeFromExt(tags.image);
        // Handle saving folder.jpg if requested
        if (saveFolderJpg && filePaths.length > 0) {
          try {
            const dir = path.dirname(filePaths[0]);
            const folderJpgPath = path.join(dir, 'folder.jpg');
            fs.writeFileSync(folderJpgPath, imageBuffer);
          } catch (err) { console.error('Failed to save folder.jpg', err); }
        }
        tags.image = {
          mime: mimeType,
          type: { id: 3, name: 'front cover' },
          description: '',
          imageBuffer: imageBuffer
        };
      } else {
        delete tags.image; // file not found, skip
      }
    } else if (tags.image && tags.image.startsWith('data:image/')) {
      // Handle saving folder.jpg if requested
      if (saveFolderJpg && filePaths.length > 0) {
        try {
          const dir = path.dirname(filePaths[0]);
          const folderJpgPath = path.join(dir, 'folder.jpg');
          const base64Data = tags.image.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(folderJpgPath, Buffer.from(base64Data, 'base64'));
        } catch (err) { console.error('Failed to save folder.jpg', err); }
      }
      // Convert data URL to buffer for node-id3
      const base64Data = tags.image.replace(/^data:image\/\w+;base64,/, '');
      const mimeMatch = tags.image.match(/^data:(image\/\w+);base64,/);
      const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
      tags.image = {
        mime: mimeType,
        type: { id: 3, name: 'front cover' },
        description: '',
        imageBuffer: Buffer.from(base64Data, 'base64')
      };
    }

    for (let fp of editablePaths) {
      try {
        const ext = path.extname(fp).toLowerCase();
        if (ext === '.mp3') {
          let updateRes = NodeID3.update(tags, fp);
          if (!updateRes) success = false;
        } else if (ext === '.flac') {
          if (!updateFlacMetadata(fp, tags)) success = false;
        }
      } catch (e) {
        console.error(`Failed to save metadata for ${fp}:`, e);
        return { ok: false, error: `${path.basename(fp)}: ${e.message || e}` };
      }
    }
    return success ? true : { ok: false, error: 'Metadata writer returned false' };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e.message || String(e) };
  }
});

ipcMain.handle('save-folder-covers', async (event, musicFiles) => {
  if (!Array.isArray(musicFiles)) return { ok: false, saved: 0, failed: 0 };
  const byDir = new Map();
  for (const file of musicFiles) {
    const filePath = normalizePathInput(file && file.filePath);
    if (!file || !filePath || !file.picture || !isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) continue;
    const dir = path.dirname(filePath);
    if (!byDir.has(dir)) byDir.set(dir, { ...file, filePath });
  }
  let saved = 0;
  let failed = 0;
  const failures = [];
  for (const file of byDir.values()) {
    try {
      if (await writeFolderJpgForTrack(file.filePath, file.picture)) saved++;
      else {
        failed++;
        failures.push({ folder: path.dirname(file.filePath), filePath: file.filePath, reason: 'cover source unavailable' });
      }
    } catch (e) {
      failed++;
      failures.push({ folder: path.dirname(file.filePath), filePath: file.filePath, reason: e.message || String(e) });
      console.error('Failed to save folder cover:', file.filePath, e);
    }
  }
  return { ok: true, saved, failed, failures };
});

ipcMain.handle('search-musicbrainz', async (event, query) => {
  try {
    const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(query)}&fmt=json`;
    const res = await fetch(url, { headers: { 'User-Agent': `${APP_USER_AGENT} ( zafer@example.com )` } });
    const data = await res.json();
    return data.releases || [];
  } catch (e) { return []; }
});

ipcMain.handle('get-musicbrainz-release', async (event, releaseId) => {
  try {
    const res = await fetch(`https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artists&fmt=json`, { headers: { 'User-Agent': `${APP_USER_AGENT} ( zafer@example.com )` } });
    return await res.json();
  } catch (e) { return null; }
});

function safeYear(value) {
  const match = String(value || '').match(/\d{4}/);
  return match ? match[0] : '';
}

function normalizeMetadataOptions(options) {
  if (options && typeof options === 'object') return options;
  return { discogsToken: String(options || '') };
}

function normalizeSourceResult(source, id, title, artist, year, extra = {}) {
  return { source, id: String(id || ''), title: title || 'Unknown Album', artist: artist || 'Unknown Artist', date: year || '', thumb: extra.thumb || '', label: extra.label || '' };
}

function toArtistCredit(name) {
  return [{ name: name || 'Unknown Artist' }];
}

function joinSourceNames(items) {
  return Array.isArray(items) ? items.map(item => item && (item.name || item.artist || '')).filter(Boolean).join(', ') : '';
}

async function getSpotifyAccessToken(clientId, clientSecret) {
  clientId = String(clientId || '').trim();
  clientSecret = String(clientSecret || '').trim();
  if (!clientId || !clientSecret) return '';
  const cacheKey = crypto.createHash('sha1').update(clientId + ':' + clientSecret).digest('hex');
  if (spotifyTokenCache.token && spotifyTokenCache.key === cacheKey && Date.now() < spotifyTokenCache.expiresAt - 60000) return spotifyTokenCache.token;
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`Spotify auth HTTP ${res.status}`);
  const data = await res.json();
  spotifyTokenCache = { token: data.access_token || '', expiresAt: Date.now() + ((data.expires_in || 3600) * 1000), key: cacheKey };
  return spotifyTokenCache.token;
}

function spotifyArtistNames(items) {
  return Array.isArray(items) ? items.map(a => a && a.name).filter(Boolean).join(', ') : '';
}

function spotifyImage(images, preferredIndex = 1) {
  if (!Array.isArray(images) || !images.length) return '';
  return (images[preferredIndex] || images[0]).url || '';
}

async function fetchSpotifyJson(url, token) {
  const res = await fetch(url, { headers: { 'Authorization': 'Bearer ' + token, 'User-Agent': APP_USER_AGENT } });
  if (!res.ok) throw new Error(`Spotify HTTP ${res.status}`);
  return await res.json();
}

function normalizeMetadataRelease(source, data) {
  if (!data) return null;
  if (source === 'musicbrainz') return { ...data, source: 'MusicBrainz' };
  if (source === 'itunes') {
    const album = data.album || {};
    const songs = data.songs || [];
    return {
      source: 'iTunes',
      id: `itunes:${album.collectionId || ''}`,
      title: album.collectionName || '',
      date: safeYear(album.releaseDate),
      genres: album.primaryGenreName ? [{ name: album.primaryGenreName }] : [],
      'artist-credit': toArtistCredit(album.artistName),
      coverUrl: album.artworkUrl100 ? album.artworkUrl100.replace(/100x100bb\.jpg$/i, '600x600bb.jpg') : '',
      media: [{ position: 1, tracks: songs.map((song, index) => ({ title: song.trackName || '', artist: song.artistName || album.artistName || '', position: song.trackNumber || (index + 1), length: song.trackTimeMillis || 0 })) }]
    };
  }
  if (source === 'deezer') {
    return {
      source: 'Deezer',
      id: `deezer:${data.id || ''}`,
      title: data.title || '',
      date: safeYear(data.release_date),
      genres: data.genres && data.genres.data && data.genres.data[0] ? [{ name: data.genres.data[0].name }] : [],
      'artist-credit': toArtistCredit(data.artist && data.artist.name),
      coverUrl: data.cover_xl || data.cover_big || data.cover_medium || '',
      media: [{ position: 1, tracks: data.tracks && data.tracks.data ? data.tracks.data.map((song, index) => ({ title: song.title || '', artist: song.artist && song.artist.name || data.artist && data.artist.name || '', position: song.track_position || (index + 1), length: song.duration ? song.duration * 1000 : 0 })) : [] }]
    };
  }
  if (source === 'discogs') {
    const titleParts = String(data.title || '').split(' - ');
    const artist = data.artists_sort || (data.artists && data.artists.map(a => a.name).join(', ')) || titleParts[0] || '';
    const albumTitle = titleParts.length > 1 ? titleParts.slice(1).join(' - ') : (data.title || '');
    return {
      source: 'Discogs',
      id: `discogs:${data.id || ''}`,
      title: albumTitle,
      date: safeYear(data.year),
      genres: data.genres && data.genres[0] ? [{ name: data.genres[0] }] : [],
      'artist-credit': toArtistCredit(artist),
      coverUrl: data.images && data.images[0] ? data.images[0].uri : '',
      media: [{ position: 1, tracks: (data.tracklist || []).filter(t => t.type_ !== 'heading').map((song, index) => ({ title: song.title || '', artist: joinSourceNames(song.artists) || artist, position: index + 1, length: 0 })) }]
    };
  }
  if (source === 'spotify') {
    const album = data.album || data;
    const albumArtist = spotifyArtistNames(album.artists);
    const tracks = Array.isArray(data.tracks) ? data.tracks : ((album.tracks && album.tracks.items) || []);
    const discs = new Map();
    for (const song of tracks) {
      const discNo = song.disc_number || 1;
      if (!discs.has(discNo)) discs.set(discNo, []);
      discs.get(discNo).push(song);
    }
    const discNumbers = [...discs.keys()].sort((a, b) => a - b);
    return {
      source: 'Spotify',
      id: `spotify:${album.id || ''}`,
      title: album.name || '',
      date: safeYear(album.release_date),
      genres: album.genres && album.genres[0] ? [{ name: album.genres[0] }] : [],
      'artist-credit': toArtistCredit(albumArtist),
      coverUrl: spotifyImage(album.images, 0),
      media: discNumbers.map((discNo) => {
        const discTracks = (discs.get(discNo) || []).sort((a, b) => (a.track_number || 0) - (b.track_number || 0));
        return {
          position: discNo,
          tracks: discTracks.map((song, index) => ({ title: song.name || '', artist: spotifyArtistNames(song.artists) || albumArtist, position: song.track_number || (index + 1), length: song.duration_ms || 0 }))
        };
      })
    };
  }
  return null;
}

ipcMain.handle('search-metadata-sources', async (event, query, options) => {
  const q = String(query || '').trim();
  if (!q) return [];
  const metadataOptions = normalizeMetadataOptions(options);
  const headers = { 'User-Agent': `${APP_USER_AGENT} ( zafer@example.com )` };
  const jobs = [];
  jobs.push(fetch(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(q)}&fmt=json&limit=10`, { headers }).then(r => r.json()).then(data => (data.releases || []).map(r => normalizeSourceResult('musicbrainz', r.id, r.title, r['artist-credit'] ? r['artist-credit'].map(a => a.name || (a.artist && a.artist.name) || '').join(', ') : '', safeYear(r.date), { label: 'MusicBrainz', thumb: r.id ? `https://coverartarchive.org/release/${encodeURIComponent(r.id)}/front-250` : '' }))).catch(() => []));
  jobs.push(fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=album&limit=8`).then(r => r.json()).then(data => (data.results || []).map(r => normalizeSourceResult('itunes', r.collectionId, r.collectionName, r.artistName, safeYear(r.releaseDate), { thumb: r.artworkUrl100 || '', label: 'iTunes' }))).catch(() => []));
  jobs.push(fetch(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=8`).then(r => r.json()).then(data => (data.data || []).map(r => normalizeSourceResult('deezer', r.id, r.title, r.artist && r.artist.name, '', { thumb: r.cover_medium || '', label: 'Deezer' }))).catch(() => []));
  const token = String(metadataOptions.discogsToken || '').trim();
  if (token) {
    jobs.push(fetch(`https://api.discogs.com/database/search?type=release&per_page=8&q=${encodeURIComponent(q)}&token=${encodeURIComponent(token)}`, { headers }).then(r => r.json()).then(data => (data.results || []).map(r => {
      const parts = String(r.title || '').split(' - ');
      return normalizeSourceResult('discogs', r.id, parts.length > 1 ? parts.slice(1).join(' - ') : r.title, parts.length > 1 ? parts[0] : '', safeYear(r.year), { thumb: r.thumb || '', label: 'Discogs' });
    })).catch(() => []));
  }
  if (metadataOptions.spotifyClientId && metadataOptions.spotifyClientSecret) {
    jobs.push((async () => {
      const spotifyToken = await getSpotifyAccessToken(metadataOptions.spotifyClientId, metadataOptions.spotifyClientSecret);
      const data = await fetchSpotifyJson(`https://api.spotify.com/v1/search?type=album&limit=8&q=${encodeURIComponent(q)}`, spotifyToken);
      return (((data.albums || {}).items) || []).map(album => normalizeSourceResult('spotify', album.id, album.name, spotifyArtistNames(album.artists), safeYear(album.release_date), { thumb: spotifyImage(album.images, 1), label: 'Spotify' }));
    })().catch(() => []));
  }
  const groups = await Promise.all(jobs);
  return groups.flat().filter(r => r.id);
});

ipcMain.handle('get-metadata-release', async (event, source, id, options) => {
  try {
    source = String(source || '');
    id = String(id || '');
    const metadataOptions = normalizeMetadataOptions(options);
    const headers = { 'User-Agent': `${APP_USER_AGENT} ( zafer@example.com )` };
    if (source === 'musicbrainz') {
      const res = await fetch(`https://musicbrainz.org/ws/2/release/${encodeURIComponent(id)}?inc=recordings+artists&fmt=json`, { headers });
      return normalizeMetadataRelease(source, await res.json());
    }
    if (source === 'itunes') {
      const res = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song&limit=200`);
      const data = await res.json();
      const album = (data.results || []).find(x => x.wrapperType === 'collection') || {};
      const songs = (data.results || []).filter(x => x.wrapperType === 'track').sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0));
      return normalizeMetadataRelease(source, { album, songs });
    }
    if (source === 'deezer') {
      const res = await fetch(`https://api.deezer.com/album/${encodeURIComponent(id)}`);
      return normalizeMetadataRelease(source, await res.json());
    }
    if (source === 'discogs') {
      const token = String(metadataOptions.discogsToken || '').trim();
      if (!token) return null;
      const res = await fetch(`https://api.discogs.com/releases/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, { headers });
      return normalizeMetadataRelease(source, await res.json());
    }
    if (source === 'spotify') {
      const spotifyToken = await getSpotifyAccessToken(metadataOptions.spotifyClientId, metadataOptions.spotifyClientSecret);
      if (!spotifyToken) return null;
      const album = await fetchSpotifyJson(`https://api.spotify.com/v1/albums/${encodeURIComponent(id)}`, spotifyToken);
      const tracks = album.tracks && Array.isArray(album.tracks.items) ? album.tracks.items.slice() : [];
      let nextUrl = album.tracks && album.tracks.next;
      while (nextUrl) {
        const page = await fetchSpotifyJson(nextUrl, spotifyToken);
        tracks.push(...(page.items || []));
        nextUrl = page.next;
      }
      return normalizeMetadataRelease(source, { album, tracks });
    }
    return null;
  } catch (e) {
    console.error('Metadata release fetch failed:', e);
    return null;
  }
});

ipcMain.handle('lastfm-get-auth-url', async (event, apiKey) => {
  let key = (apiKey || '').trim();
  if (!key) return null;
  try {
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=auth.getToken&api_key=${key}&format=json`);
    const data = await res.json();
    if (data.token) {
      let url = `https://www.last.fm/api/auth/?api_key=${key}&token=${data.token}`;
      shell.openExternal(url);
      return { url, token: data.token };
    }
    return null;
  } catch (e) { return null; }
});

ipcMain.handle('lastfm-get-session', async (event, token, apiKey, sharedSecret) => {
  let key = (apiKey || '').trim();
  let secret = (sharedSecret || '').trim();
  if (!key || !secret || !token) return null;
  try {
    let params = { api_key: key, method: 'auth.getSession', token: token };
    let sig = getLfmSignature(params, secret);
    if (!sig) return null;
    const res = await fetch(`https://ws.audioscrobbler.com/2.0/?method=auth.getSession&api_key=${key}&token=${token}&api_sig=${sig}&format=json`);
    const data = await res.json();
    if (data.session) return { sessionKey: data.session.key, name: data.session.name };
    return null;
  } catch (e) { return null; }
});

ipcMain.handle('lastfm-update-now-playing', async (event, sessionKey, artist, track, apiKey, sharedSecret) => {
  let key = (apiKey || '').trim();
  let secret = (sharedSecret || '').trim();
  if (!key || !secret || !sessionKey) return false;
  try {
    let params = { method: 'track.updateNowPlaying', artist: artist, track: track, api_key: key, sk: sessionKey };
    let sig = getLfmSignature(params, secret);
    if (!sig) return false;
    let body = new URLSearchParams({ ...params, api_sig: sig, format: 'json' });
    await fetch('https://ws.audioscrobbler.com/2.0/', { method: 'POST', body });
    return true;
  } catch (e) { return false; }
});


ipcMain.on('update-thumbar', (event, isPlaying) => {
  if (process.platform === 'win32' && mainWindow) {
    const { nativeImage } = require('electron');

    function makeIcon(type) {
      const iconPath = path.join(__dirname, 'assets', 'taskbar', `taskbar-${type}.png`);
      if (fs.existsSync(iconPath)) {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) return icon.resize({ width: 24, height: 24, quality: 'best' });
      }
      const paths = {
        prev: '<path d="M11 7L5 12L11 17V7Z" fill="white"/><path d="M19 7L13 12L19 17V7Z" fill="white"/><path d="M4 7V17" stroke="white" stroke-width="2.2" stroke-linecap="round"/>',
        next: '<path d="M13 7L19 12L13 17V7Z" fill="white"/><path d="M5 7L11 12L5 17V7Z" fill="white"/><path d="M20 7V17" stroke="white" stroke-width="2.2" stroke-linecap="round"/>',
        play: '<path d="M8.5 6.8C8.5 6.1 9.25 5.68 9.85 6.04L18.15 11.24C18.72 11.6 18.72 12.4 18.15 12.76L9.85 17.96C9.25 18.32 8.5 17.9 8.5 17.2V6.8Z" fill="white"/>',
        pause: '<rect x="7" y="6" width="3.6" height="12" rx="1.2" fill="white"/><rect x="13.4" y="6" width="3.6" height="12" rx="1.2" fill="white"/>'
      };
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${paths[type] || paths.play}</svg>`;
      return nativeImage.createFromDataURL('data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64'));
    }

    mainWindow.setThumbarButtons([
      {
        tooltip: 'Previous',
        icon: makeIcon('prev'),
        click() { mainWindow.webContents.send('thumbar-action', 'prev'); }
      },
      {
        tooltip: isPlaying ? 'Pause' : 'Play',
        icon: makeIcon(isPlaying ? 'pause' : 'play'),
        click() { mainWindow.webContents.send('thumbar-action', 'playpause'); }
      },
      {
        tooltip: 'Next',
        icon: makeIcon('next'),
        click() { mainWindow.webContents.send('thumbar-action', 'next'); }
      }
    ]);
  }
});



ipcMain.handle('lastfm-scrobble', async (event, sessionKey, artist, track, timestamp, apiKey, sharedSecret) => {
  let key = (apiKey || '').trim();
  let secret = (sharedSecret || '').trim();
  if (!key || !secret || !sessionKey) return false;
  try {
    let params = { method: 'track.scrobble', 'artist[0]': artist, 'track[0]': track, 'timestamp[0]': timestamp, api_key: key, sk: sessionKey };
    let sig = getLfmSignature(params, secret);
    if (!sig) return false;
    let body = new URLSearchParams({ ...params, api_sig: sig, format: 'json' });
    await fetch('https://ws.audioscrobbler.com/2.0/', { method: 'POST', body });
    return true;
  } catch (e) { return false; }
});

ipcMain.handle('lastfm-get-recommendations', async (event, sessionKey, apiKey, username) => {
  let key = (apiKey || '').trim();
  if (!key || !username) return [];
  try {
    let recentRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getRecentTracks&user=${encodeURIComponent(username)}&api_key=${key}&limit=20&format=json`);
    let recentData = await recentRes.json();
    let artistName = "";
    if (recentData.recenttracks && recentData.recenttracks.track && recentData.recenttracks.track.length > 0) {
      let randIdx = Math.floor(Math.random() * recentData.recenttracks.track.length);
      artistName = recentData.recenttracks.track[randIdx].artist['#text'];
    }

    if (!artistName) {
      let topRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=user.getTopArtists&user=${encodeURIComponent(username)}&api_key=${key}&limit=20&format=json`);
      let topData = await topRes.json();
      if (topData.topartists && topData.topartists.artist && topData.topartists.artist.length > 0) {
        let randIdx = Math.floor(Math.random() * topData.topartists.artist.length);
        artistName = topData.topartists.artist[randIdx].name;
      }
    }

    if (artistName) {
      let simRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getSimilar&artist=${encodeURIComponent(artistName)}&api_key=${key}&limit=30&format=json`);
      let simData = await simRes.json();
      if (simData.similarartists && simData.similarartists.artist) {
        let simArtists = simData.similarartists.artist.sort(() => 0.5 - Math.random()).slice(0, 13);
        let fetchPromises = simArtists.map(async (simArtist) => {
          try {
            let topAlbRes = await fetch(`https://ws.audioscrobbler.com/2.0/?method=artist.getTopAlbums&artist=${encodeURIComponent(simArtist.name)}&api_key=${key}&limit=2&format=json`);
            let topAlbData = await topAlbRes.json();
            if (topAlbData.topalbums && topAlbData.topalbums.album && topAlbData.topalbums.album.length > 0) {
              return topAlbData.topalbums.album.slice(0, 2).map(function(alb) {
                return {
                  name: alb.name,
                  artist: simArtist.name,
                  image: (alb.image && alb.image.length > 2) ? alb.image[2]['#text'] : null
                };
              });
            }
          } catch (err) { }
          return [];
        });
        let recsNested = await Promise.all(fetchPromises);
        let recs = [].concat.apply([], recsNested).filter(r => r !== null).sort(() => 0.5 - Math.random());
        return recs;
      }
    }
    return [];
  } catch (e) { return []; }
});

// IPC Handler: Scan Folder for Music
ipcMain.handle('scan-folder', async (event, folderPath, existingLibrary = []) => {
  folderPath = normalizePathInput(folderPath);
  if (!isExistingDirectory(folderPath)) return [];
  const supportedExtensions = AUDIO_EXTENSIONS;
  const rawFiles = [];
  try {
    await walkDir(folderPath, supportedExtensions, rawFiles);
  } catch (e) {
    console.error("Error walking directory", e);
  }

  const existingMap = new Map();
  existingLibrary.forEach(item => existingMap.set(item.filePath, item));

  const musicFiles = new Array(rawFiles.length);
  const totalFiles = rawFiles.length;
  let nextIndex = 0;
  let completed = 0;

  event.sender.send('scan-progress', { current: 0, total: totalFiles });

  async function scanWorker() {
    while (true) {
      const i = nextIndex++;
      if (i >= totalFiles) return;
      const filePath = rawFiles[i];
      try {
        const fileStat = await fs.promises.stat(filePath);
        const existingItem = existingMap.get(filePath);
        if (existingItem && existingItem.fileSize === fileStat.size && existingItem.modifiedAtMs === fileStat.mtimeMs) {
          musicFiles[i] = existingItem;
        } else {
          musicFiles[i] = await buildLibraryItemFromAudioFile(filePath, fileStat);
        }
      } catch (e) { }

      completed++;
      if (completed % 25 === 0 || completed === totalFiles) {
        event.sender.send('scan-progress', { current: completed, total: totalFiles });
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
  }

  const concurrency = Math.min(4, Math.max(1, totalFiles));
  await Promise.all(Array.from({ length: concurrency }, () => scanWorker()));

  event.sender.send('scan-progress', { current: totalFiles, total: totalFiles });
  return musicFiles.filter(Boolean);
});

// IPC Handler: Read and Parse CSV
ipcMain.handle('parse-csv', async (event, csvPath) => {
  csvPath = normalizePathInput(csvPath);
  if (!isExistingFileWithExt(csvPath, ['.csv'])) return [];
  return new Promise((resolve, reject) => {
    const results = [];
    fs.createReadStream(csvPath)
      .pipe(parse({ columns: true, skip_empty_lines: true }))
      .on('data', (data) => results.push(data))
      .on('end', () => {
        resolve(results);
      })
      .on('error', (err) => {
        reject(err);
      });
  });
});

// Play audio file
ipcMain.handle('get-audio-file', async (event, filePath) => {
  filePath = normalizePathInput(filePath);
  if (!isExistingFileWithExt(filePath, AUDIO_EXTENSIONS)) return null;
  try {
    const buffer = fs.readFileSync(filePath);
    return buffer; // Returns as Uint8Array to renderer
  } catch (e) {
    console.error(e);
    return null;
  }
});

// Export CSV
ipcMain.handle('export-csv', async (event, playlists) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    defaultPath: 'playlists_export.csv'
  });

  if (canceled || !filePath) return false;

  const escapeCSV = (str) => {
    if (str === null || str === undefined) return '';
    const s = String(str);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  // Normalize a track object into standard fields regardless of source format
  const normTrack = (track) => {
    const mf = track.matchedFile || {};
    // Library tracks: {matchedFile:{title,artist,album,duration,...}, title, artist, album, duration}
    // CSV-imported tracks: {Song, Artist, Album, Duration, BPM, ...} (external tools)
    // Drag-drop added: {Song, Artist, Album}
    const title = track.title || mf.title || track.Song || track.song || track.Name || track.name || track.TITLE || '';
    const artist = track.artist || mf.artist || track.Artist || track.ARTIST || '';
    const album = track.album || mf.album || track.Album || track.ALBUM || '';
    const duration = track.duration || mf.duration || track.Duration || track.DURATION || 0;
    const genre = track.genre || mf.genre || track.Genres || track.Genre || track.GENRE || '';
    const filePath = track.filePath || mf.filePath || track.FilePath || track.FILEPATH || track.Path || track.path || '';
    return { title, artist, album, duration, genre, filePath };
  };

  let csvContent = 'Playlist,Song,Artist,Album,Duration,Genre,FilePath\n';

  playlists.forEach(pl => {
    if (!pl.tracks) return;
    pl.tracks.forEach(track => {
      const t = normTrack(track);
      csvContent += `${escapeCSV(pl.name)},${escapeCSV(t.title)},${escapeCSV(t.artist)},${escapeCSV(t.album)},${escapeCSV(t.duration)},${escapeCSV(t.genre)},${escapeCSV(t.filePath)}\n`;
    });
  });

  await fs.promises.writeFile(filePath, csvContent, 'utf8');
  return true;
});

// IPC: Scan folder for image files (for album cover slideshow)
ipcMain.handle('scan-folder-images', async (event, folderPath) => {
  folderPath = normalizePathInput(folderPath);
  if (!isExistingDirectory(folderPath)) return [];
  const imgExts = IMAGE_EXTENSIONS;
  try {
    const files = await fs.promises.readdir(folderPath);
    return files
      .filter(f => imgExts.includes(path.extname(f).toLowerCase()))
      .map(f => getSafeFileUrl(path.join(folderPath, f)));
  } catch (e) { return []; }
});

// IPC: Register / unregister global shortcuts dynamically
ipcMain.handle('register-shortcuts', (event, shortcuts) => {
  // shortcuts: [{id, accelerator, action, enabled}]
  globalShortcut.unregisterAll();
  const result = { ok: true, registered: [], failed: [] };
  for (const sc of shortcuts) {
    if (!sc.enabled || !sc.accelerator) continue;
    if (registerGlobalShortcut(sc.accelerator, sc.action, result.failed)) result.registered.push(sc.accelerator);
  }
  result.ok = result.failed.length === 0;
  return result;
});

// IPC: Open LRC file dialog
ipcMain.handle('dialog:openLrc', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'LRC Lyrics', extensions: ['lrc', 'txt'] }]
  });
  if (canceled) return null;
  try {
    return fs.readFileSync(filePaths[0], 'utf8');
  } catch (e) { return null; }
});
