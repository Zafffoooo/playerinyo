'use strict';

const path = require('path');
const { packager } = require('@electron/packager');
const { rebuild } = require('@electron/rebuild');
const { packagerConfig } = require('../forge.config');
const electronVersion = require('electron/package.json').version;

const root = path.resolve(__dirname, '..');
const argumentsByName = Object.fromEntries(process.argv.slice(2).map((argument) => {
  const match = /^--([^=]+)=(.+)$/.exec(argument);
  return match ? [match[1], match[2]] : [argument.replace(/^--/, ''), true];
}));
const targetPlatform = argumentsByName.platform || process.platform;
const targetArch = argumentsByName.arch || process.arch;

if (!['darwin', 'linux', 'win32'].includes(targetPlatform)) {
  throw new Error(`Unsupported release platform: ${targetPlatform}`);
}

// `abstract-socket` contains native code. Build each release on its target OS
// rather than producing a potentially unusable cross-compiled package.
if (targetPlatform !== process.platform) {
  throw new Error(`Build ${targetPlatform} releases on ${targetPlatform}; current host is ${process.platform}.`);
}

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
    platform: targetPlatform,
    arch: targetArch,
    electronVersion,
  });
  paths.forEach((outputPath) => console.log(`Packaged: ${outputPath}`));
}

packageApp().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
