'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function rendererContext(file, values) {
  const context = vm.createContext(values);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'app', file), 'utf8'), context);
  return context;
}

test('personal lyrics save to the opened track and failed saves restore previous data', async () => {
  const controls = {
    'lyrics-editor-text': { value: 'A new line' },
    'lyrics-editor-type': { value: 'plain' },
    'lyrics-editor-error': { hidden: true, textContent: '' },
    'lyrics-editor-save': { disabled: false },
  };
  const track = { artist: 'Artist', title: 'Song', matchedFile: { filePath: '/music/song.mp3' } };
  const context = rendererContext('renderer-lyrics.js', {
    $: id => controls[id] || null,
    appSettings: { customLyrics: { 'path:/music/song.mp3': JSON.stringify({ plainLyrics: 'Old line' }) } },
    state: { currentPlayingTrack: { artist: 'Other', title: 'Song' } },
    lyricsCurrentTrackKey: '',
    lyricsRawText: '',
    lyricsData: [],
    plainLyricsText: '',
    npOverlayOpen: false,
    persistSettings: async () => true,
    hideModal: () => {},
    showToast: () => {},
  });
  context.lyricsEditorTrack = track;
  context.lyricsEditorKey = 'path:/music/song.mp3';
  await vm.runInContext('saveLyricsEditor()', context);
  assert.equal(JSON.parse(context.appSettings.customLyrics['path:/music/song.mp3']).plainLyrics, 'A new line');
  assert.equal(context.lyricsRawText, '');

  context.lyricsEditorTrack = track;
  context.lyricsEditorKey = 'path:/music/song.mp3';
  controls['lyrics-editor-text'].value = 'Failed line';
  context.persistSettings = async () => { throw new Error('disk full'); };
  await vm.runInContext('saveLyricsEditor()', context);
  assert.equal(JSON.parse(context.appSettings.customLyrics['path:/music/song.mp3']).plainLyrics, 'A new line');
  assert.equal(controls['lyrics-editor-error'].hidden, false);
});

test('invalid timed LRC is rejected before persistence', async () => {
  let saves = 0;
  const controls = {
    'lyrics-editor-text': { value: 'No timestamp' },
    'lyrics-editor-type': { value: 'synced' },
    'lyrics-editor-error': { hidden: true, textContent: '' },
  };
  const context = rendererContext('renderer-lyrics.js', {
    $: id => controls[id] || null,
    appSettings: { customLyrics: {} },
    state: { currentPlayingTrack: null },
    persistSettings: async () => { saves++; },
  });
  context.lyricsEditorTrack = { artist: 'A', title: 'B' };
  context.lyricsEditorKey = 'a::b';
  await vm.runInContext('saveLyricsEditor()', context);
  assert.equal(saves, 0);
  assert.match(controls['lyrics-editor-error'].textContent, /LRC needs/);
});

test('an in-flight online lookup cannot replace newly edited lyrics', async () => {
  let finishRequest;
  const response = new Promise(resolve => { finishRequest = resolve; });
  const track = { artist: 'Artist', title: 'Song', album: '', duration: 120 };
  const context = rendererContext('renderer-lyrics.js', {
    $: () => null,
    appSettings: {},
    state: { currentPlayingTrack: track },
    lyricsCurrentTrackKey: '',
    lyricsData: [],
    lyricsRawText: '',
    plainLyricsText: '',
    npOverlayOpen: false,
    npLyricsActiveIdx: -2,
    lyricsActiveIdx: -2,
    lyricsCache: null,
    fetch: () => response,
  });
  const pending = vm.runInContext('fetchLyricsForTrack(state.currentPlayingTrack)', context);
  context.lyricsFetchGeneration++;
  context.lyricsRawText = 'My edited lyrics';
  finishRequest({ ok: true, json: async () => ({ artistName: 'Artist', trackName: 'Song', plainLyrics: 'Online lyrics' }) });
  await pending;
  assert.equal(context.lyricsRawText, 'My edited lyrics');
});

test('missing remembered output falls back to default without forgetting preference', async () => {
  const routes = [];
  const messages = [];
  const context = rendererContext('renderer-audio-output.js', {
    audioCtx: { setSinkId: async id => { routes.push(id); if (id === 'unplugged') throw new Error('missing'); } },
    appSettings: { audioOutputDeviceId: 'unplugged' },
    $: () => null,
    showToast: message => messages.push(message),
  });
  await vm.runInContext('applyAudioOutputPreference()', context);
  assert.deepEqual(routes, ['unplugged', '']);
  assert.equal(context.appSettings.audioOutputDeviceId, 'unplugged');
  assert.equal(context.activeAudioOutputDeviceId, '');
  assert.equal(messages.length, 1);
});

test('output selection persists only after routing succeeds', async () => {
  const routes = [];
  const select = { value: 'speakers' };
  const context = rendererContext('renderer-audio-output.js', {
    audioCtx: { setSinkId: async id => { routes.push(id); if (id === 'missing') throw new Error('unavailable'); } },
    appSettings: { audioOutputDeviceId: '' },
    $: id => id === 'setting-audio-device' ? select : null,
    initAudioCtx: () => {},
    persistSettings: async () => true,
    showToast: () => {},
  });
  await vm.runInContext("selectAudioOutputDevice('speakers')", context);
  assert.equal(context.appSettings.audioOutputDeviceId, 'speakers');
  assert.equal(context.activeAudioOutputDeviceId, 'speakers');
  await vm.runInContext("selectAudioOutputDevice('missing')", context);
  assert.equal(context.appSettings.audioOutputDeviceId, 'speakers');
  assert.equal(context.activeAudioOutputDeviceId, 'speakers');
  assert.equal(select.value, 'speakers');
  assert.deepEqual(routes, ['speakers', 'missing', 'speakers']);
});
