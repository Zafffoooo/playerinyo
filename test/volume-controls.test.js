'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'app', 'index.html'), 'utf8');
const playbackUi = fs.readFileSync(path.join(root, 'app', 'renderer-playback-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app', 'style.css'), 'utf8');
const projectionCss = fs.readFileSync(path.join(root, 'app', 'projection-room.css'), 'utf8');

test('Now Playing includes a shared volume control', () => {
  assert.match(html, /id="np-btn-like"[\s\S]*?id="np-btn-shuffle"/);
  assert.match(html, /id="np-btn-volume-toggle"/);
  assert.match(html, /id="np-volume-bar"/);
  assert.match(html, /id="np-volume-value"/);
  assert.match(html, /class="np-volume-popover"/);
});

test('studio utilities keep queue and lyrics as compact accessible icon buttons', () => {
  assert.match(html, /id="btn-queue-toggle"[^>]*aria-label="Open queue"[^>]*><i[^>]*aria-hidden="true"><\/i><span class="sr-only">Queue<\/span>/);
  assert.match(html, /id="btn-lyrics-toggle"[^>]*aria-label="Open lyrics"[^>]*><i[^>]*aria-hidden="true"><\/i><span class="sr-only">Lyrics<\/span>/);
  assert.match(projectionCss, /grid-template-columns: repeat\(4, var\(--studio-utility-control\)\) minmax\(0, 1fr\);/);
  assert.match(projectionCss, /\.listening-studio \.studio-tab \{\s+width: var\(--studio-utility-control\) !important;/);
  assert.match(projectionCss, /\.studio-volume-control \{\s+grid-column: 5;/);
});

test('volume controls synchronize and support scroll-wheel changes', () => {
  assert.match(playbackUi, /function handleVolumeWheel\(e\)/);
  assert.match(playbackUi, /e\.preventDefault\(\)/);
  assert.match(playbackUi, /document\.querySelectorAll\('\.volume-bar-container'\)/);
  assert.match(playbackUi, /document\.querySelectorAll\('\.studio-volume-control, \.np-volume-control'\)/);
  assert.match(playbackUi, /addEventListener\('wheel', handleVolumeWheel, \{ passive: false \}\)/);
  assert.match(playbackUi, /document\.querySelectorAll\('\.player-volume-icon'\)/);
});

test('Now Playing volume popover remains reachable without opening on mute click', () => {
  assert.match(css, /\.np-volume-control::before\{[^}]*height:10px/);
  assert.match(css, /\.np-volume-control:hover \.np-volume-popover,\.np-volume-control:has\(\.np-volume-bar-container:focus\) \.np-volume-popover/);
  assert.doesNotMatch(css, /\.np-volume-control:focus-within \.np-volume-popover/);
});
