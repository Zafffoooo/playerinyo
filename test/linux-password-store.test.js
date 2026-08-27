'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { configureLinuxPasswordStore } = require('../app/linux-password-store');

function commandLine(explicit) {
  const calls = [];
  return { calls, hasSwitch: (name) => explicit === name, appendSwitch: (name, value) => calls.push([name, value]) };
}

test('Linux defaults to gnome-libsecret only when password-store was not explicitly selected', () => {
  const defaults = commandLine('');
  assert.equal(configureLinuxPasswordStore('linux', defaults), true);
  assert.deepEqual(defaults.calls, [['password-store', 'gnome-libsecret']]);
  const explicit = commandLine('password-store');
  assert.equal(configureLinuxPasswordStore('linux', explicit), false);
  assert.deepEqual(explicit.calls, []);
});

test('non-Linux platforms never receive a password-store switch', () => {
  const win = commandLine('');
  assert.equal(configureLinuxPasswordStore('win32', win), false);
  assert.deepEqual(win.calls, []);
});
