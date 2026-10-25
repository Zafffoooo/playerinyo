'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const espree = require('espree');

const root = path.join(__dirname, '..');
const rendererFiles = [
  'renderer.js',
  'renderer-radio-library.js',
  'renderer-library-playback.js',
  'renderer-playback-downloads.js',
  'renderer-downloads-ui.js',
  'renderer-import-review.js',
  'renderer-lyrics.js',
  'renderer-audio-output.js',
  'renderer-settings-ui.js',
  'renderer-metadata-ui.js',
  'renderer-playback-ui.js',
];
const rendererInitializers = [
  'initCoreControls',
  'initRadioLibraryControls',
  'initLibraryControls',
  'initPlaybackDownloadControls',
  'initDownloadControls',
  'initImportReviewControls',
  'initLyricsControls',
  'initAudioOutputControls',
  'initSettingsControls',
  'initMetadataControls',
  'initPlaybackControls',
];

function readAppFile(file) {
  return fs.readFileSync(path.join(root, 'app', file), 'utf8');
}

test('renderer slices load in their declared dependency order', () => {
  const html = readAppFile('index.html');
  const declared = [...html.matchAll(/<script src="(renderer(?:-[^"]+)?\.js)"><\/script>/g)].map((match) => match[1]);
  assert.deepEqual(declared, rendererFiles);
});

test('renderer slices remain within the reviewable size limits', () => {
  rendererFiles.forEach((file) => {
    const lineCount = readAppFile(file).split('\n').length - 1;
    assert.ok(lineCount <= 2000, `${file} has ${lineCount} lines`);
  });
  assert.ok(readAppFile('renderer.js').split('\n').length - 1 < 3000);
});

test('renderer bundle has one final bootstrap and no retired modal or render globals', () => {
  const sources = rendererFiles.map(readAppFile);
  const bundle = sources.join('\n');
  assert.equal((bundle.match(/\bbootstrap\(\);/g) || []).length, 1);
  assert.match(sources.at(-1), /bootstrap\(\);\s*$/);
  assert.doesNotMatch(bundle, /window\._/);
  assert.doesNotMatch(bundle, /^var _[A-Za-z0-9_$]+/m);
  assert.doesNotMatch(bundle, /\b(?:alert|confirm)\s*\(/);
  assert.match(bundle, /function esc\(v\)/);
});

test('DOM wiring is collected behind the explicit bootstrap lifecycle', () => {
  rendererFiles.forEach((file, index) => {
    const source = readAppFile(file);
    const ast = espree.parse(source, { ecmaVersion: 2022, sourceType: 'script', range: true });
    const initializer = ast.body.find((node) => node.type === 'FunctionDeclaration' && node.id.name === rendererInitializers[index]);
    assert.ok(initializer, `${file} does not declare ${rendererInitializers[index]}`);
    ast.body.forEach((node) => {
      if (node.type === 'FunctionDeclaration') return;
      if (node.type === 'VariableDeclaration') {
        assert.doesNotMatch(source.slice(node.range[0], node.range[1]), /(?:\$\s*\(|document\.)/, `${file} initializes DOM state at top level`);
        return;
      }
      const isFinalBootstrap = file === rendererFiles.at(-1)
        && node.type === 'ExpressionStatement'
        && node.expression.type === 'CallExpression'
        && node.expression.callee.name === 'bootstrap';
      assert.ok(isFinalBootstrap, `${file} has top-level ${node.type} outside bootstrap`);
    });
  });
  const bootstrapSource = readAppFile(rendererFiles.at(-1));
  let previous = -1;
  rendererInitializers.forEach((initializer) => {
    const next = bootstrapSource.indexOf(`  ${initializer}();`, previous + 1);
    assert.ok(next > previous, `${initializer} is missing or out of order`);
    previous = next;
  });
});

test('renderer slices form one syntactically valid classic-script bundle', () => {
  assert.doesNotThrow(() => new vm.Script(rendererFiles.map(readAppFile).join('\n'), { filename: 'renderer-bundle.js' }));
});
