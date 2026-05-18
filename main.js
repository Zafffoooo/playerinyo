const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, globalShortcut, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
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
let isQuitting = false;
let appSettings = { minimizeToTray: false };
const SENSITIVE_SETTING_KEYS = ['lastfmApiKey', 'lastfmSharedSecret', 'lastfmSessionKey', 'discogsToken'];
const APP_ICON = path.join(__dirname, 'spotify-xxl_png.ico');

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
    width: 1200,
    height: 800,
    minWidth: 980,
    minHeight: 640,
    frame: false,
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
    if (!isQuitting && appSettings.minimizeToTray) {
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

if (gotSingleInstanceLock) {
app.on('second-instance', () => {
  showMainWindow();
});

app.whenReady().then(async () => {
  if (process.platform === 'win32') app.setAppUserModelId('com.playerinyo.audio');
  await loadMM();
  createWindow();

  try {
    const icon = nativeImage.createFromPath(APP_ICON);
    tray = new Tray(icon);
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show Playerinyo', click: () => mainWindow.show() },
      {
        label: 'Quit', click: () => {
          isQuitting = true;
          app.quit();
        }
      }
    ]);
    tray.setToolTip('Playerinyo');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => mainWindow.show());
  } catch (e) {
    console.log("Tray init error:", e);
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  globalShortcut.register('MediaPlayPause', () => {
    if (mainWindow) mainWindow.webContents.send('thumbar-action', 'playpause');
  });
  globalShortcut.register('MediaNextTrack', () => {
    if (mainWindow) mainWindow.webContents.send('thumbar-action', 'next');
  });
  globalShortcut.register('MediaPreviousTrack', () => {
    if (mainWindow) mainWindow.webContents.send('thumbar-action', 'prev');
  });
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

function getSafeFileUrl(absolutePath) {
  return pathToFileURL(absolutePath).href;
}

function isExistingDirectory(dirPath) {
  if (typeof dirPath !== 'string' || !path.isAbsolute(dirPath)) return false;
  try { return fs.statSync(dirPath).isDirectory(); }
  catch (e) { return false; }
}

function isExistingFileWithExt(filePath, extensions) {
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
      'User-Agent': 'AudioPlayerinyo/1.0.0',
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

async function writeFolderJpgForTrack(filePath, imageSourceOrBuffer) {
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

ipcMain.handle('save-library', (event, musicFiles) => {
  try { fs.writeFileSync(LIBRARY_FILE, JSON.stringify(musicFiles)); return true; }
  catch (e) { return false; }
});

ipcMain.handle('export-backup', async (event, extras) => {
  const stamp = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    filters: [{ name: 'Playerinyo Backup', extensions: ['json'] }],
    defaultPath: `playerinyo_backup_${stamp}.json`,
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  try {
    const data = {
      library: readJsonFile(LIBRARY_FILE, []),
      playlists: readJsonFile(PLAYLISTS_FILE, []),
      mappings: readJsonFile(MAPPINGS_FILE, {}),
      settings: sanitizeSettingsForBackup(appSettings),
      likedSongs: extras && Array.isArray(extras.likedSongs) ? extras.likedSongs : [],
      exportedFrom: 'Audio Playerinyo',
    };
    const payload = {
      app: 'Audio Playerinyo',
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
    filters: [{ name: 'Playerinyo Backup', extensions: ['json'] }],
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
  if (typeof backupPath !== 'string' || !path.isAbsolute(backupPath) || !fs.existsSync(backupPath)) return { ok: false, error: 'Invalid backup path' };
  try {
    const parsed = JSON.parse(await fs.promises.readFile(backupPath, 'utf8'));
    const data = parsed && parsed.data && typeof parsed.data === 'object' ? parsed.data : parsed;
    if (Array.isArray(data.library)) await fs.promises.writeFile(LIBRARY_FILE, JSON.stringify(data.library), 'utf8');
    if (Array.isArray(data.playlists)) await fs.promises.writeFile(PLAYLISTS_FILE, JSON.stringify(data.playlists), 'utf8');
    if (data.mappings && typeof data.mappings === 'object') await fs.promises.writeFile(MAPPINGS_FILE, JSON.stringify(data.mappings), 'utf8');
    if (data.settings && typeof data.settings === 'object') {
      appSettings = { ...appSettings, ...data.settings };
      await fs.promises.writeFile(SETTINGS_FILE, JSON.stringify(serializeSettingsForDisk(appSettings)), 'utf8');
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
    const filePath = file && typeof file.filePath === 'string' ? file.filePath : '';
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
    if (!f.filePath || !fs.existsSync(f.filePath)) continue;
    try {
      const metadata = await mm.parseFile(f.filePath, { duration: false });
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
    try { fs.writeFileSync(LIBRARY_FILE, JSON.stringify(musicFiles)); } catch (e) { }
  }
  return musicFiles;
});

ipcMain.handle('load-playlists', () => {
  try {
    if (fs.existsSync(PLAYLISTS_FILE)) return JSON.parse(fs.readFileSync(PLAYLISTS_FILE, 'utf8'));
  } catch (e) { console.error(e); }
  return [];
});

ipcMain.handle('save-playlists', (event, playlists) => {
  try { fs.writeFileSync(PLAYLISTS_FILE, JSON.stringify(playlists)); return true; }
  catch (e) { return false; }
});

ipcMain.handle('load-mappings', () => {
  try {
    if (fs.existsSync(MAPPINGS_FILE)) return JSON.parse(fs.readFileSync(MAPPINGS_FILE, 'utf8'));
  } catch (e) { console.error(e); }
  return {};
});

ipcMain.handle('save-mappings', (event, mappings) => {
  try { fs.writeFileSync(MAPPINGS_FILE, JSON.stringify(mappings)); return true; }
  catch (e) { return false; }
});

ipcMain.handle('load-settings', () => {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      appSettings = deserializeSettingsFromDisk(JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')));
    }
  } catch (e) { console.error(e); }
  if (appSettings && appSettings.discordRpc) {
    discordConnect();
  }
  return appSettings;
});

ipcMain.handle('save-settings', (event, settings) => {
  try {
    const wasDiscord = appSettings.discordRpc;
    appSettings = settings;
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(serializeSettingsForDisk(settings)));
    // Handle Discord toggle
    if (settings.discordRpc && !wasDiscord) discordConnect();
    else if (!settings.discordRpc && wasDiscord) { discordClear(); if (discordClient) { try { discordClient.destroy(); } catch (e) { } discordClient = null; discordEnabled = false; } }
    return true;
  }
  catch (e) { return false; }
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
  const vendor = Buffer.from(vendorString || 'audio-playerinyo', 'utf8');
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
  if (!block || block.length < 8) return { vendor: 'audio-playerinyo', tags: [] };
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
  let parsed = vorbisIndex >= 0 ? parseVorbisComment(blocks[vorbisIndex].data) : { vendor: 'audio-playerinyo', tags: [] };
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
    const editablePaths = (Array.isArray(filePaths) ? filePaths : []).filter(fp => isExistingFileWithExt(fp, ['.mp3', '.flac']));
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
        const cover = await fetchCoverImageWithFallback(tags.image);
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
    if (!file || !file.filePath || !file.picture || !isExistingFileWithExt(file.filePath, AUDIO_EXTENSIONS)) continue;
    const dir = path.dirname(file.filePath);
    if (!byDir.has(dir)) byDir.set(dir, file);
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
    const res = await fetch(url, { headers: { 'User-Agent': 'AudioPlayerinyo/1.0.0 ( zafer@example.com )' } });
    const data = await res.json();
    return data.releases || [];
  } catch (e) { return []; }
});

ipcMain.handle('get-musicbrainz-release', async (event, releaseId) => {
  try {
    const res = await fetch(`https://musicbrainz.org/ws/2/release/${releaseId}?inc=recordings+artists&fmt=json`, { headers: { 'User-Agent': 'AudioPlayerinyo/1.0.0 ( zafer@example.com )' } });
    return await res.json();
  } catch (e) { return null; }
});

function safeYear(value) {
  const match = String(value || '').match(/\d{4}/);
  return match ? match[0] : '';
}

function normalizeSourceResult(source, id, title, artist, year, extra = {}) {
  return { source, id: String(id || ''), title: title || 'Unknown Album', artist: artist || 'Unknown Artist', date: year || '', thumb: extra.thumb || '', label: extra.label || '' };
}

function toArtistCredit(name) {
  return [{ name: name || 'Unknown Artist' }];
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
      media: [{ position: 1, tracks: songs.map((song, index) => ({ title: song.trackName || '', position: song.trackNumber || (index + 1), length: song.trackTimeMillis || 0 })) }]
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
      media: [{ position: 1, tracks: data.tracks && data.tracks.data ? data.tracks.data.map((song, index) => ({ title: song.title || '', position: song.track_position || (index + 1), length: song.duration ? song.duration * 1000 : 0 })) : [] }]
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
      media: [{ position: 1, tracks: (data.tracklist || []).filter(t => t.type_ !== 'heading').map((song, index) => ({ title: song.title || '', position: index + 1, length: 0 })) }]
    };
  }
  return null;
}

ipcMain.handle('search-metadata-sources', async (event, query, discogsToken) => {
  const q = String(query || '').trim();
  if (!q) return [];
  const headers = { 'User-Agent': 'AudioPlayerinyo/1.0.0 ( zafer@example.com )' };
  const jobs = [];
  jobs.push(fetch(`https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(q)}&fmt=json&limit=10`, { headers }).then(r => r.json()).then(data => (data.releases || []).map(r => normalizeSourceResult('musicbrainz', r.id, r.title, r['artist-credit'] ? r['artist-credit'].map(a => a.name || (a.artist && a.artist.name) || '').join(', ') : '', safeYear(r.date), { label: 'MusicBrainz' }))).catch(() => []));
  jobs.push(fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=album&limit=8`).then(r => r.json()).then(data => (data.results || []).map(r => normalizeSourceResult('itunes', r.collectionId, r.collectionName, r.artistName, safeYear(r.releaseDate), { thumb: r.artworkUrl100 || '', label: 'iTunes' }))).catch(() => []));
  jobs.push(fetch(`https://api.deezer.com/search/album?q=${encodeURIComponent(q)}&limit=8`).then(r => r.json()).then(data => (data.data || []).map(r => normalizeSourceResult('deezer', r.id, r.title, r.artist && r.artist.name, '', { thumb: r.cover_medium || '', label: 'Deezer' }))).catch(() => []));
  const token = String(discogsToken || '').trim();
  if (token) {
    jobs.push(fetch(`https://api.discogs.com/database/search?type=release&per_page=8&q=${encodeURIComponent(q)}&token=${encodeURIComponent(token)}`, { headers }).then(r => r.json()).then(data => (data.results || []).map(r => {
      const parts = String(r.title || '').split(' - ');
      return normalizeSourceResult('discogs', r.id, parts.length > 1 ? parts.slice(1).join(' - ') : r.title, parts.length > 1 ? parts[0] : '', safeYear(r.year), { thumb: r.thumb || '', label: 'Discogs' });
    })).catch(() => []));
  }
  const groups = await Promise.all(jobs);
  return groups.flat().filter(r => r.id);
});

ipcMain.handle('get-metadata-release', async (event, source, id, discogsToken) => {
  try {
    source = String(source || '');
    id = String(id || '');
    const headers = { 'User-Agent': 'AudioPlayerinyo/1.0.0 ( zafer@example.com )' };
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
      const token = String(discogsToken || '').trim();
      if (!token) return null;
      const res = await fetch(`https://api.discogs.com/releases/${encodeURIComponent(id)}?token=${encodeURIComponent(token)}`, { headers });
      return normalizeMetadataRelease(source, await res.json());
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

  const musicFiles = [];
  const totalFiles = rawFiles.length;

  event.sender.send('scan-progress', { current: 0, total: totalFiles });

  for (let i = 0; i < totalFiles; i++) {
    const filePath = rawFiles[i];
    let fileStat;

    // Update progress every 50 files
    if (i % 50 === 0) {
      event.sender.send('scan-progress', { current: i, total: totalFiles });
    }
    if (i % 20 === 0) {
      await new Promise((resolve) => setImmediate(resolve));
    }
    try {
      fileStat = await fs.promises.stat(filePath);
    } catch (e) {
      continue;
    }

    const existingItem = existingMap.get(filePath);
    if (existingItem && existingItem.fileSize === fileStat.size && existingItem.modifiedAtMs === fileStat.mtimeMs) {
      musicFiles.push(existingItem);
      continue;
    }

      const filename = path.basename(filePath);
      const dirPath = path.dirname(filePath);

    try {
      const metadata = await mm.parseFile(filePath);
      const rg = getReplayGainFields(metadata);
      const albumName = metadata.common.album || 'Unknown Album';
      const artistName = metadata.common.artist || 'Unknown Artist';
      const albumArtistName = metadata.common.albumartist || (metadata.common.compilation ? 'Various Artists' : null);

      let pictureDataUrl = null;

      // Hash album+artist to avoid saving the same cover 100 times
      const coverHash = crypto.createHash('md5').update(albumName + (albumArtistName || artistName)).digest('hex');
      const coverFilePath = path.join(COVERS_DIR, `${coverHash}.jpg`);

      // Check folder.jpg FIRST (stable, always same file per album)
      const folderCover = await findFallbackCover(dirPath);
      if (folderCover) {
        pictureDataUrl = folderCover;
      } else if (metadata.common.picture && metadata.common.picture.length > 0) {
        // Fall back to embedded art (can differ per track → causes cover flickering)
        if (!fs.existsSync(coverFilePath)) {
          await fs.promises.writeFile(coverFilePath, metadata.common.picture[0].data);
        }
        pictureDataUrl = getSafeFileUrl(coverFilePath);
      }

      musicFiles.push({
        filePath: filePath,
        filename: filename,
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
      });
    } catch (err) {
      const localCover = await findFallbackCover(dirPath);
      musicFiles.push({
        filePath: filePath,
        filename: filename,
        title: path.parse(filename).name,
        artist: 'Unknown Artist',
        album: 'Unknown Album',
        duration: 0,
        picture: localCover,
        trackNo: 0,
        trackTotal: 0,
        discNo: 0,
        discTotal: 0,
        fileSize: fileStat.size,
        modifiedAtMs: fileStat.mtimeMs,
      });
    }
  }

  event.sender.send('scan-progress', { current: totalFiles, total: totalFiles });
  return musicFiles;
});

// IPC Handler: Read and Parse CSV
ipcMain.handle('parse-csv', async (event, csvPath) => {
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

  fs.writeFileSync(filePath, csvContent, 'utf8');
  return true;
});

// IPC: Scan folder for image files (for album cover slideshow)
ipcMain.handle('scan-folder-images', async (event, folderPath) => {
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
  // Always keep media keys registered base
  for (const sc of shortcuts) {
    if (!sc.enabled || !sc.accelerator) continue;
    try {
      globalShortcut.register(sc.accelerator, () => {
        if (mainWindow) mainWindow.webContents.send('thumbar-action', sc.action);
      });
    } catch (e) {
      console.log('Failed to register shortcut:', sc.accelerator, e.message);
    }
  }
  return true;
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
