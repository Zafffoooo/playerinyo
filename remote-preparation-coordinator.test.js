'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRemotePreparationCoordinator } = require('./remote-preparation-coordinator');

test('remote preparation coordinator shares one in-flight promise for the same slot and key', async () => {
  const coordinator = createRemotePreparationCoordinator();
  let calls = 0;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const first = coordinator.run(1, 'slot::next', async () => { calls++; await pending; return true; });
  const second = coordinator.run(1, 'slot::next', async () => { calls++; return false; });
  assert.equal(first, second);
  release();
  assert.equal(await first, true);
  assert.equal(calls, 1);
});

test('a newer preparation replaces slot ownership without cancelling the older caller promise', async () => {
  const coordinator = createRemotePreparationCoordinator();
  const first = coordinator.run(0, 'old', async () => 'old');
  const second = coordinator.run(0, 'new', async () => 'new');
  assert.notEqual(first, second);
  assert.equal(await second, 'new');
  assert.equal(await first, 'old');
  assert.equal(coordinator.get(0), undefined);
});
