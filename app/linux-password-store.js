'use strict';

function configureLinuxPasswordStore(platform, commandLine) {
  if (platform !== 'linux' || !commandLine || typeof commandLine.appendSwitch !== 'function') return false;
  if (typeof commandLine.hasSwitch === 'function' && commandLine.hasSwitch('password-store')) return false;
  commandLine.appendSwitch('password-store', 'gnome-libsecret');
  return true;
}

module.exports = { configureLinuxPasswordStore };
