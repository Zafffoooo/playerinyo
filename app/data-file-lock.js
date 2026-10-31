'use strict';

// FIFO exclusive lock shared by snapshot reads, queued source writes, and
// multi-file replacement. Failed operations still release their turn.
function createDataFileLock() {
  let pending = Promise.resolve();
  function run(task) {
    const previous = pending;
    let release;
    pending = new Promise((resolve) => { release = resolve; });
    return previous.then(task).finally(release);
  }
  return { run };
}

module.exports = { createDataFileLock };
