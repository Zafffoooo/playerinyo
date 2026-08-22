'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseReleaseVersion, isNewerReleaseVersion } = require('../app/release-update');

test('parses normal and v-prefixed release versions', () => {
  assert.deepEqual(parseReleaseVersion('0.1.0'), [0, 1, 0]);
  assert.deepEqual(parseReleaseVersion('v1.2.3'), [1, 2, 3]);
  assert.equal(parseReleaseVersion('release-1.2.3'), null);
});

test('only reports a strictly newer release', () => {
  assert.equal(isNewerReleaseVersion('0.1.0', 'v0.1.1'), true);
  assert.equal(isNewerReleaseVersion('0.1.0', 'v0.1.0'), false);
  assert.equal(isNewerReleaseVersion('0.1.0', 'v0.0.9'), false);
});
