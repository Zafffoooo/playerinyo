'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizePathInput,
  isExistingDirectory,
  isExistingFileWithExt,
  isAllowedRadioStreamUrl,
  getRadioStreamLeaseToken,
} = require('../app/main-security-helpers');

test('path helpers accept only existing absolute directories and allowlisted files', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'playerinyo-security-'));
  const track = path.join(root, 'track.mp3');
  await fsp.writeFile(track, 'fixture');
  try {
    assert.equal(normalizePathInput(pathToFileURL(track).href), track);
    assert.equal(normalizePathInput('file://bad host'), '');
    assert.equal(isExistingDirectory(root, fs), true);
    assert.equal(isExistingDirectory('relative', fs), false);
    assert.equal(isExistingFileWithExt(track, ['.mp3'], fs), true);
    assert.equal(isExistingFileWithExt(track, ['.flac'], fs), false);
    assert.equal(isExistingFileWithExt(path.join(root, 'missing.mp3'), ['.mp3'], fs), false);
  } finally { await fsp.rm(root, { recursive: true, force: true }); }
});

test('radio stream URLs and leases keep their host and token boundaries', () => {
  const hosts = new Set(['googlevideo.com', 'youtube.com', 'www.youtube.com', 'music.youtube.com']);
  assert.equal(isAllowedRadioStreamUrl('https://r3---sn.googlevideo.com/audio', hosts), true);
  assert.equal(isAllowedRadioStreamUrl('http://googlevideo.com/audio', hosts), false);
  assert.equal(isAllowedRadioStreamUrl('https://googlevideo.com@attacker.invalid/audio', hosts), false);
  assert.equal(isAllowedRadioStreamUrl('https://googlevideo.com.attacker.invalid/audio', hosts), false);
  assert.equal(getRadioStreamLeaseToken('playerinyo-stream://lease/AbCdEfGhIjKlMnOpQrSt'), 'AbCdEfGhIjKlMnOpQrSt');
  assert.equal(getRadioStreamLeaseToken('playerinyo-stream://lease/short'), '');
  assert.equal(getRadioStreamLeaseToken('playerinyo-stream://other/AbCdEfGhIjKlMnOpQrSt'), '');
});
