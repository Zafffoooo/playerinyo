'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { compareSimilar } = require('../scripts/compare-similar');

test('comparison publishes each provider independently and reports missing data', async () => {
  const lines = [];
  const calls = [];
  const failures = await compareSimilar({
    ListenBrainz: async name => { calls.push(name); return name === 'Eths' ? ['Artist A'] : []; },
    Deezer: async name => name === 'Eths' ? ['Artist B'] : null,
    'Last.fm': async () => { throw new Error('private information'); },
  }, line => lines.push(line));
  const output = lines.join('\n');
  assert.deepEqual(calls, ['Eths', 'Kells', 'Queen Adreena', 'Sol Seppy']);
  assert.equal(failures, 4);
  assert.match(output, /Artist A\s+\| Artist B/);
  assert.match(output, /no results/);
  assert.match(output, /no exact artist match/);
  assert.match(output, /request failed/);
  assert.doesNotMatch(output, /private information/);
});
