'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isPathInsideScanRoot } = require('../app/scan-root-filter');

test('scan root filter selects only direct and nested paths inside a POSIX root', () => {
  assert.equal(isPathInsideScanRoot('/music/library/a.flac', '/music/library'), true);
  assert.equal(isPathInsideScanRoot('/music/library/live/b.flac', '/music/library/'), true);
  assert.equal(isPathInsideScanRoot('/music/library-other/c.flac', '/music/library'), false);
});

test('scan root filter normalizes Windows separators and drive-letter case', () => {
  assert.equal(isPathInsideScanRoot('C:/Music/Albums/a.flac', 'c:\\music'), true);
  assert.equal(isPathInsideScanRoot('C:\\MusicBox\\a.flac', 'C:\\Music'), false);
});
