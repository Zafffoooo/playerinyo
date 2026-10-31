'use strict';

const path = require('path');
const { Worker } = require('worker_threads');

function createMainWorkerClient() {
  const worker = new Worker(path.join(__dirname, 'main-io-worker.js'));
  const pending = new Map();
  let nextId = 0;
  let closedError = null;

  function fail(error) {
    closedError = error;
    for (const task of pending.values()) task.reject(error);
    pending.clear();
  }

  worker.on('message', ({ id, value, error }) => {
    const task = pending.get(id);
    if (!task) return;
    pending.delete(id);
    if (error) task.reject(Object.assign(new Error(error.message), { name: error.name, code: error.code }));
    else task.resolve(value);
  });
  worker.on('error', fail);
  worker.on('exit', (code) => fail(closedError || new Error(`File worker exited with code ${code}`)));

  function request(operation, args) {
    if (closedError) return Promise.reject(closedError);
    return new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, operation, args }); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }

  async function close() {
    fail(new Error('File worker closed'));
    await worker.terminate();
  }

  return { request, close, isClosed: () => closedError !== null, ref: () => worker.ref(), unref: () => worker.unref() };
}

// Lazily created worker that is recreated after it dies and terminated after
// idleMs without in-flight requests. A request that was running when the worker
// died rejects; later requests transparently get a fresh worker.
function createSharedWorkerClient({ idleMs = 30000, create = createMainWorkerClient, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let client = null;
  let inflight = 0;
  let idleTimer = null;

  function clearIdle() {
    if (idleTimer !== null) clearTimer(idleTimer);
    idleTimer = null;
  }
  function armIdle() {
    clearIdle();
    idleTimer = setTimer(() => {
      idleTimer = null;
      if (inflight === 0) close().catch(() => { /* An idle worker that fails to terminate is already unusable. */ });
    }, idleMs);
    if (idleTimer && typeof idleTimer.unref === 'function') idleTimer.unref();
  }
  async function request(operation, args) {
    clearIdle();
    if (!client || client.isClosed()) client = create();
    const current = client;
    if (typeof current.ref === 'function') current.ref();
    inflight++;
    try { return await current.request(operation, args); }
    finally {
      inflight--;
      if (inflight === 0) {
        // An idle worker must not keep the process alive before idle-close.
        if (typeof current.unref === 'function') current.unref();
        armIdle();
      }
    }
  }
  async function close() {
    clearIdle();
    const current = client;
    client = null;
    if (current) await current.close();
  }
  return { request, close };
}

const sharedMainWorker = createSharedWorkerClient();

async function runMainWorkerTask(operation, args) {
  return sharedMainWorker.request(operation, args);
}

module.exports = { createMainWorkerClient, createSharedWorkerClient, runMainWorkerTask };
