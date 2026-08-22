'use strict';

// Small, dependency-free serial queue used by durable state that must be
// drained before Electron exits. Keeping it here makes shutdown behavior
// regression-testable without starting Electron.
function createPendingWriteDrainer() {
  let pending = Promise.resolve();
  function enqueue(task) {
    pending = pending.catch(() => {}).then(task);
    return pending;
  }
  function drain() {
    return pending.catch(() => {});
  }
  return { enqueue, drain };
}

module.exports = { createPendingWriteDrainer };
