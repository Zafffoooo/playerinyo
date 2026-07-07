const fs = require('fs');
const path = require('path');

const iconPng = path.join(__dirname, 'assets', 'icon.png');
const packagerConfig = {
  name: 'Playerinyo',
  executableName: 'playerinyo',
};

if (fs.existsSync(iconPng)) {
  packagerConfig.icon = './assets/icon';
} else {
  console.warn('assets/icon.png bulunamadı, Linux menü iconu için 512x512 veya 1024x1024 PNG ekle.');
}

module.exports = {
  packagerConfig,
};
