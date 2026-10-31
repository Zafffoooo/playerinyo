'use strict';

const fs = require('fs');
const path = require('path');

const MAX_METADATA_EDIT_BYTES = 512 * 1024 * 1024;
const MAX_DOWNLOADED_AUDIO_BYTES = MAX_METADATA_EDIT_BYTES;

async function writeTextFileAtomic(filePath, text) {
  const tmpPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`);
  try {
    await fs.promises.writeFile(tmpPath, text, { encoding: 'utf8', mode: 0o600 });
    await fs.promises.rename(tmpPath, filePath);
  } catch (error) {
    try { await fs.promises.unlink(tmpPath); } catch (_) { /* The failed atomic-write temp file may not exist. */ }
    throw error;
  }
}

module.exports = { writeTextFileAtomic, MAX_METADATA_EDIT_BYTES, MAX_DOWNLOADED_AUDIO_BYTES };
