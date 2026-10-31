'use strict';

// Defer snapshot creation as well as I/O. Callers only mark their mutable state
// dirty; the serial drainer snapshots the newest state when a flush starts.
function createCoalescedWrite({ drainer, write, delayMs = 1500, maxWaitMs = 10000, onError = console.error, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let dirty = false;
  let timer = null;
  let maxTimer = null;

  function flush() {
    if (timer !== null) clearTimer(timer);
    if (maxTimer !== null) clearTimer(maxTimer);
    timer = null;
    maxTimer = null;
    return drainer.enqueue(async () => {
      if (!dirty) return;
      dirty = false;
      try { await write(); }
      catch (error) { dirty = true; throw error; }
    });
  }

  function schedule() {
    dirty = true;
    if (timer !== null) clearTimer(timer);
    timer = setTimer(() => {
      timer = null;
      flush().catch(onError);
    }, delayMs);
    if (timer && typeof timer.unref === 'function') timer.unref();
    // Continuous callers keep resetting the debounce; the max-wait timer
    // guarantees a flush at least every maxWaitMs while dirty.
    if (maxTimer === null) {
      maxTimer = setTimer(() => {
        maxTimer = null;
        flush().catch(onError);
      }, maxWaitMs);
      if (maxTimer && typeof maxTimer.unref === 'function') maxTimer.unref();
    }
  }

  return { schedule, flush };
}

module.exports = { createCoalescedWrite };
