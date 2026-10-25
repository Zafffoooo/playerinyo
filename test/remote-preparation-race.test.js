'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('an obsolete preparation cannot release the newer track’s audio lease', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../app/renderer-playback-downloads.js'), 'utf8');
  const start = source.indexOf('async function prepareRemoteTrackInSlotOwned(');
  const end = source.indexOf('function prepareNextRadioTrack()', start);
  assert.ok(start >= 0 && end > start);
  const deferred = [];
  const releases = [];
  const audio = { _radioLeaseId: '', _radioPrepareRequestId: '', load() {} };
  let requestNumber = 0;
  let currentKey = '';
  const context = {
    state: { radioSession: null, currentPlayingTrack: null },
    playbackGeneration: 1,
    audioEls: [audio],
    preparedRadioSlot: null,
    remotePreparationInFlight: { get: () => ({ key: currentKey }) },
    playbackResolver: { preparePlayback: () => new Promise((resolve, reject) => deferred.push({ resolve, reject })) },
    nextRadioResolverRequestId: () => 'request-' + ++requestNumber,
    releaseRadioLeaseFromAudio: element => { if (element._radioLeaseId) releases.push(element._radioLeaseId); element._radioLeaseId = ''; },
    waitForRadioAudioReady: async () => true,
    window: { api: { releaseRadioPlayback: async leaseId => { releases.push(leaseId); } } },
    performance: { now: () => 0 },
    console: { info() {}, warn() {} },
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  const first = { queueEntryId: 'first', playback: { videoId: 'aaaaaaaaaaa' } };
  const second = { queueEntryId: 'second', playback: { videoId: 'bbbbbbbbbbb' } };
  currentKey = 'first';
  const oldWork = context.prepareRemoteTrackInSlotOwned(first, 0, 1, 'first');
  currentKey = 'second';
  const newWork = context.prepareRemoteTrackInSlotOwned(second, 0, 1, 'second');
  deferred[1].resolve({ src: 'playerinyo-stream://lease/new', leaseId: 'new', expiresAt: Date.now() + 60000 });
  assert.equal(await newWork, true);
  deferred[0].reject(new Error('Old request failed'));
  assert.equal(await oldWork, false);
  assert.equal(audio._radioLeaseId, 'new');
  assert.equal(releases.includes('new'), false);
});
