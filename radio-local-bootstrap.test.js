'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { findFirstLocalCandidate } = require('./radio-local-bootstrap');
test('local bootstrap selects candidate #4 without resolving earlier remote candidates', () => {
  const items = ['a', 'b', 'c', 'd'].map((title) => ({ id: title, itemKind: 'candidate', title, artist: 'artist' })); let calls = 0;
  const found = findFirstLocalCandidate(items, (candidate) => { calls++; return candidate.candidateId === 'd' ? { filePath: '/d' } : null; }, []);
  assert.equal(found.index, 3); assert.equal(calls, 4);
});
test('local bootstrap forwards unavailable file paths to the local matcher', () => {
  const items = [{ id: 'a', itemKind: 'candidate', title: 'a', artist: 'artist' }];
  let receivedOptions = null;
  findFirstLocalCandidate(items, (candidate, library, options) => { receivedOptions = options; return null; }, [], { unplayableFilePaths: new Set(['/missing']) });
  assert.deepEqual(receivedOptions.unplayableFilePaths, new Set(['/missing']));
});
