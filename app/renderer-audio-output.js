/* One AudioContext carries both crossfade players, EQ and normalization. */
var audioOutputReady = Promise.resolve();
var audioOutputRoutingQueue = Promise.resolve();
var activeAudioOutputDeviceId = '';
var audioOutputListGeneration = 0;
var audioOutputFallbackNotified = false;
var audioOutputSelectionPending = false;

function audioOutputAvailable() {
  return !!(audioCtx && typeof audioCtx.setSinkId === 'function');
}

function audioOutputStatus(message) {
  var status = $('audio-device-status');
  if (status) status.textContent = message;
}

function ensureAudioOutputReady() {
  return audioOutputReady;
}

function queueAudioOutputRoute(deviceId) {
  var task = audioOutputRoutingQueue.catch(function () { }).then(async function () {
    if (!audioOutputAvailable()) {
      if (deviceId) throw new Error('Audio output selection is unavailable on this system.');
      activeAudioOutputDeviceId = '';
      return;
    }
    await audioCtx.setSinkId(deviceId || '');
    activeAudioOutputDeviceId = deviceId || '';
  });
  audioOutputRoutingQueue = task.catch(function () { });
  return task;
}

function applyAudioOutputPreference() {
  var wanted = appSettings.audioOutputDeviceId || '';
  return queueAudioOutputRoute(wanted).then(function () {
    audioOutputFallbackNotified = false;
    audioOutputStatus(wanted ? 'Using selected output device.' : 'Using system default.');
  }).catch(async function () {
    try {
      await queueAudioOutputRoute('');
      audioOutputStatus(!audioOutputAvailable() ? 'Device selection unavailable; using system default.' : wanted ? 'Saved device unavailable; using system default.' : 'Using system default.');
      if (wanted && !audioOutputFallbackNotified) {
        audioOutputFallbackNotified = true;
        showToast('Saved audio device is unavailable. Using system default.');
      }
    } catch (_) {
      audioOutputStatus('Could not switch audio output. Check the system audio device.');
    }
  });
}

async function refreshAudioOutputDevices() {
  var select = $('setting-audio-device');
  if (!select) return;
  var mediaDevices = navigator.mediaDevices;
  var generation = ++audioOutputListGeneration;
  var choose = $('audio-device-choose');
  var AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  var supportsRouting = !!(AudioContextConstructor && typeof AudioContextConstructor.prototype.setSinkId === 'function');
  if (choose) choose.hidden = !(supportsRouting && mediaDevices && typeof mediaDevices.selectAudioOutput === 'function');
  if (!mediaDevices || typeof mediaDevices.enumerateDevices !== 'function') {
    select.disabled = true;
    audioOutputStatus('Device discovery is unavailable; using system default.');
    return;
  }
  try {
    var devices = (await mediaDevices.enumerateDevices()).filter(function (device) { return device.kind === 'audiooutput' && device.deviceId && device.deviceId !== 'default'; });
    if (generation !== audioOutputListGeneration) return;
    select.replaceChildren();
    var system = document.createElement('option');
    system.value = '';
    system.textContent = 'System default';
    select.appendChild(system);
    var seen = new Set();
    devices.forEach(function (device) {
      if (seen.has(device.deviceId)) return;
      seen.add(device.deviceId);
      var option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || 'Audio output ' + seen.size;
      select.appendChild(option);
    });
    var saved = appSettings.audioOutputDeviceId || '';
    if (saved && !seen.has(saved)) {
      var unavailable = document.createElement('option');
      unavailable.value = saved;
      unavailable.textContent = 'Saved device (unavailable)';
      unavailable.disabled = true;
      select.appendChild(unavailable);
    }
    select.value = saved;
    select.disabled = !supportsRouting;
    if (!supportsRouting) audioOutputStatus('Device selection unavailable; using system default.');
    else if (!audioCtx) audioOutputStatus(saved ? (seen.has(saved) ? 'Selected device will be used when playback starts.' : 'Saved device unavailable; using system default.') : 'Using system default.');
    else if (saved && activeAudioOutputDeviceId !== saved) audioOutputStatus('Saved device unavailable; using system default.');
  } catch (_) {
    if (generation === audioOutputListGeneration) audioOutputStatus('Could not list audio devices. Retry by reopening Settings.');
  }
}

async function selectAudioOutputDevice(deviceId) {
  var previous = appSettings.audioOutputDeviceId || '';
  var select = $('setting-audio-device');
  if (deviceId === previous && (!audioCtx || activeAudioOutputDeviceId === deviceId)) return;
  if (audioOutputSelectionPending) return;
  audioOutputSelectionPending = true;
  if (select) select.disabled = true;
  try {
    initAudioCtx();
    await audioOutputReady;
    audioOutputReady = queueAudioOutputRoute(deviceId);
    await audioOutputReady;
    appSettings.audioOutputDeviceId = deviceId;
    await persistSettings(appSettings);
    audioOutputFallbackNotified = false;
    audioOutputStatus(deviceId ? 'Using selected output device.' : 'Using system default.');
  } catch (_) {
    appSettings.audioOutputDeviceId = previous;
    try { audioOutputReady = queueAudioOutputRoute(previous); await audioOutputReady; }
    catch (_) { audioOutputReady = applyAudioOutputPreference(); await audioOutputReady; }
    if (select) select.value = previous;
    audioOutputStatus('Could not select or save that device.');
    showToast('Could not select or save that audio device.');
  } finally {
    audioOutputSelectionPending = false;
    if (select) select.disabled = !audioOutputAvailable();
  }
}

function initAudioOutputControls() {
  var select = $('setting-audio-device');
  if (select) select.addEventListener('change', function () { selectAudioOutputDevice(select.value); });
  var choose = $('audio-device-choose');
  if (choose) choose.addEventListener('click', async function () {
    try {
      var device = await navigator.mediaDevices.selectAudioOutput();
      await refreshAudioOutputDevices();
      if (device && device.deviceId) { await selectAudioOutputDevice(device.deviceId); await refreshAudioOutputDevices(); }
    } catch (error) {
      if (error && error.name !== 'NotAllowedError') showToast('Could not access audio output devices.');
    }
  });
  if (navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', function () {
      refreshAudioOutputDevices();
      if (audioCtx && !audioOutputSelectionPending) audioOutputReady = applyAudioOutputPreference();
    });
  }
}
