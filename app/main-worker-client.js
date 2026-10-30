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

  return { request, close };
}

async function runMainWorkerTask(operation, args) {
  const worker = createMainWorkerClient();
  try { return await worker.request(operation, args); }
  finally { await worker.close(); }
}

module.exports = { createMainWorkerClient, runMainWorkerTask };
