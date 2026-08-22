'use strict';

const path = require('path');
const { packager } = require('@electron/packager');
const { rebuild } = require('@electron/rebuild');
const { packagerConfig } = require('../forge.config');
const electronVersion = require('electron/package.json').version;

const root = path.resolve(__dirname, '..');

async function packageApp() {
  await rebuild({
    buildPath: root,
    electronVersion,
    force: true,
    extraModules: ['abstract-socket'],
    onlyModules: ['abstract-socket'],
  });
  const paths = await packager({
    ...packagerConfig,
    dir: root,
    out: path.join(root, 'out'),
    overwrite: true,
    platform: process.platform,
    arch: process.arch,
    electronVersion,
  });
  paths.forEach((outputPath) => console.log(`Packaged: ${outputPath}`));
}

packageApp().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
