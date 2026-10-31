'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPendingWriteDrainer } = require('../app/pending-write-drainer');
const { createCoalescedWrite } = require('../app/coalesced-write');
const { createKnownTrackIndex, indexTrack, serializeKnownTrackIndex, MAX_SERIALIZED_BYTES } = require('../app/known-track-index');

function createManualTimers() {
  const timers = new Map();
  let nextId = 0;
  return {
    timers,
    setTimer(task) { const id = ++nextId; timers.set(id, task); return id; },
    clearTimer(id) { timers.delete(id); },
    fire() { const tasks = Array.from(timers.values()); timers.clear(); tasks.forEach((task) => task()); },
  };
}

test('multiple known-index persists serialize once at flush using the newest state', async () => {
  const timers = createManualTimers();
  const drainer = createPendingWriteDrainer();
  const index = createKnownTrackIndex();
  let serializations = 0;
  let snapshot;
  const persistence = createCoalescedWrite({ ...timers, drainer, write() {
    serializations++;
    snapshot = serializeKnownTrackIndex(index, MAX_SERIALIZED_BYTES);
  } });
  for (let i = 0; i < 20; i++) {
    indexTrack(index, { artist: 'Artist', title: `Track ${i}` }, 'local', i + 1);
    persistence.schedule();
    await Promise.resolve();
  }
  assert.equal(serializations, 0);
  assert.equal(timers.timers.size, 2); // debounce + max-wait
  timers.fire();
  await drainer.drain();
  assert.equal(serializations, 1);
  assert.equal(snapshot, serializeKnownTrackIndex(index, MAX_SERIALIZED_BYTES));
  assert.ok(Buffer.byteLength(snapshot) <= MAX_SERIALIZED_BYTES);
});

test('shutdown flush cancels debounce and waits for its durable write', async () => {
  const timers = createManualTimers();
  const drainer = createPendingWriteDrainer();
  let release;
  let serializations = 0;
  const persistence = createCoalescedWrite({ ...timers, drainer, write() {
    serializations++;
    return new Promise((resolve) => { release = resolve; });
  } });
  persistence.schedule();
  let drained = false;
  const shutdown = persistence.flush().then(() => { drained = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.timers.size, 0);
  assert.equal(serializations, 1);
  assert.equal(drained, false);
  release();
  await shutdown;
  await persistence.flush();
  assert.equal(serializations, 1);
});

test('updates during a write are not lost or written concurrently', async () => {
  const timers = createManualTimers();
  const drainer = createPendingWriteDrainer();
  let value = 1;
  let release;
  const snapshots = [];
  const persistence = createCoalescedWrite({ ...timers, drainer, write() {
    snapshots.push(value);
    if (snapshots.length === 1) return new Promise((resolve) => { release = resolve; });
  } });
  persistence.schedule();
  const first = persistence.flush();
  await new Promise((resolve) => setImmediate(resolve));
  value = 2;
  persistence.schedule();
  const second = persistence.flush();
  assert.deepEqual(snapshots, [1]);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(snapshots, [1, 2]);
});

test('failed writes stay dirty for a later flush', async () => {
  const timers = createManualTimers();
  let attempts = 0;
  const persistence = createCoalescedWrite({ ...timers, drainer: createPendingWriteDrainer(), write() {
    if (++attempts === 1) throw new Error('write failed');
  } });
  persistence.schedule();
  await assert.rejects(persistence.flush(), /write failed/);
  await persistence.flush();
  assert.equal(attempts, 2);
});

test('max wait flushes even when schedule keeps resetting the debounce', async () => {
  const timers = [];
  const drainer = createPendingWriteDrainer();
  let writes = 0;
  const persistence = createCoalescedWrite({ drainer, write() { writes++; }, delayMs: 1500, maxWaitMs: 10000,
    setTimer(task, ms) { const entry = { task, ms, live: true }; timers.push(entry); return entry; },
    clearTimer(entry) { entry.live = false; } });
  for (let i = 0; i < 5; i++) persistence.schedule();
  const maxTimers = timers.filter((entry) => entry.ms === 10000 && entry.live);
  assert.equal(maxTimers.length, 1);
  assert.equal(timers.filter((entry) => entry.ms === 1500 && entry.live).length, 1);
  maxTimers[0].live = false;
  maxTimers[0].task();
  await drainer.drain();
  assert.equal(writes, 1);
  assert.equal(timers.filter((entry) => entry.live).length, 0);
});
