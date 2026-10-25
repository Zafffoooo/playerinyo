'use strict';

const fs = require('fs');
const path = require('path');
const globals = require('globals');

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
const rendererBundleProcessor = {
  preprocess(_text, filename) {
    if (path.basename(filename) !== rendererFiles[0]) return [];
    return [rendererFiles.map((file) => fs.readFileSync(path.join(__dirname, 'app', file), 'utf8')).join('\n')];
  },
  postprocess(messageLists) {
    return messageLists.flat();
  },
};

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
  eqeqeq: 'error',
  radix: 'error',
  'no-fallthrough': 'error',
  'no-await-in-loop': 'off',
  'no-empty': ['error', { allowEmptyCatch: false }],
};

module.exports = [
  { ignores: ['node_modules/**', 'out/**', 'dist/**'] },
  {
    files: ['app/main.js', 'app/preload.js', 'scripts/**/*.js', 'test/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: globals.node },
    rules,
  },
  {
    files: ['app/renderer*.js'],
    processor: rendererBundleProcessor,
    languageOptions: { ecmaVersion: 2022, sourceType: 'script', globals: globals.browser },
    rules,
  },
  {
    files: ['app/**/*.js'],
    ignores: ['app/main.js', 'app/preload.js', 'app/renderer*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
    rules,
  },
];
