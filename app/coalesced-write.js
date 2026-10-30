'use strict';

// Defer snapshot creation as well as I/O. Callers only mark their mutable state
// dirty; the serial drainer snapshots the newest state when a flush starts.
function createCoalescedWrite({ drainer, write, delayMs = 1500, onError = console.error, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let dirty = false;
  let timer = null;

  function flush() {
    if (timer !== null) clearTimer(timer);
    timer = null;
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
  }

  return { schedule, flush };
}

module.exports = { createCoalescedWrite };
