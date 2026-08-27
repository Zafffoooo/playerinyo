'use strict';

const path = require('node:path');
const { fileURLToPath } = require('node:url');

function normalizePathInput(value) {
  if (typeof value !== 'string') return '';
  if (value.startsWith('file://')) {
    try { return fileURLToPath(value); }
    catch (_) { return ''; }
  }
  return value;
}

function isExistingDirectory(dirPath, fsApi) {
  const candidate = normalizePathInput(dirPath);
  if (!path.isAbsolute(candidate)) return false;
  try { return fsApi.statSync(candidate).isDirectory(); }
  catch (_) { return false; }
}

function isExistingFileWithExt(filePath, extensions, fsApi) {
  const candidate = normalizePathInput(filePath);
  if (!path.isAbsolute(candidate) || !extensions.includes(path.extname(candidate).toLowerCase())) return false;
  try { return fsApi.statSync(candidate).isFile(); }
  catch (_) { return false; }
}

function isAllowedRadioStreamUrl(value, allowedHosts) {
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      && Array.from(allowedHosts).some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
  } catch (_) { return false; }
}

function getRadioStreamLeaseToken(requestUrl) {
  try {
    const parsed = new URL(requestUrl);
    if (parsed.hostname !== 'lease' || !/^\/[A-Za-z0-9_-]{20,}$/.test(parsed.pathname || '')) return '';
    return parsed.pathname.slice(1);
  } catch (_) { return ''; }
}

module.exports = {
  normalizePathInput,
  isExistingDirectory,
  isExistingFileWithExt,
  isAllowedRadioStreamUrl,
  getRadioStreamLeaseToken,
};
