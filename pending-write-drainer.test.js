'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPendingWriteDrainer } = require('./pending-write-drainer');

test('shutdown drain waits for a pending known-track index write', async () => {
  const writer = createPendingWriteDrainer();
  let release;
  let wrote = false;
  writer.enqueue(() => new Promise((resolve) => { release = () => { wrote = true; resolve(); }; }));
  const draining = writer.drain().then(() => assert.equal(wrote, true));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(wrote, false);
  release();
  await draining;
});
