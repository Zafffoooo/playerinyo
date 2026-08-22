const fs = require('fs');
const path = require('path');

const iconPng = path.join(__dirname, 'assets', 'icon.png');
const packagerConfig = {
  name: 'Playerinyo',
  executableName: 'playerinyo',
  asar: { unpack: '**/*.node' },
  prune: true,
  // Electron Packager matches these regexes against app-relative paths beginning with "/".
  ignore: [
    /^\/(?:build|docs|out|dist|test)(?:\/|$)/,
    /^\/\.git(?:\/|$)/,
    /^\/\.git(?:ignore|attributes|modules)$/,
    /^\/(?:AGENTS|allah|playleirnyo)\.md$/,
    /^\/forge\.config\.js$/,
    /^\/session(?:[-_.]|$)/i,
    /^\/[^/]+\.csv$/i,
    /^\/spotify-xxl_png\.(?:ico|png)$/i,
    /^\/test-flac\.js$/,
    /^\/scripts\/package\.js$/,
  ],
};

if (fs.existsSync(iconPng)) {
  packagerConfig.icon = './assets/icon';
} else {
  console.warn('assets/icon.png bulunamadı, Linux menü iconu için 512x512 veya 1024x1024 PNG ekle.');
}

module.exports = {
  packagerConfig,
};
