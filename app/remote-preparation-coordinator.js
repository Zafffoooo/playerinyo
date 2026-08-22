'use strict';

function createRemotePreparationCoordinator() {
  const bySlot = new Map();
  function get(slot) { return bySlot.get(slot); }
  function run(slot, key, work) {
    const existing = bySlot.get(slot);
    if (existing && existing.key === key) return existing.promise;
    const promise = Promise.resolve().then(work);
    bySlot.set(slot, { key, promise });
    promise.then(() => { if (bySlot.get(slot) && bySlot.get(slot).promise === promise) bySlot.delete(slot); }, () => { if (bySlot.get(slot) && bySlot.get(slot).promise === promise) bySlot.delete(slot); });
    return promise;
  }
  return { get, run };
}

const remotePreparationCoordinatorApi = { createRemotePreparationCoordinator };
if (typeof module !== 'undefined' && module.exports) module.exports = remotePreparationCoordinatorApi;
if (typeof window !== 'undefined') window.RemotePreparationCoordinator = remotePreparationCoordinatorApi;
