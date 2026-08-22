'use strict';

const crypto = require('crypto');

function getLfmSignature(params, sharedSecret) {
  if (!sharedSecret) return null;
  const text = Object.keys(params || {}).sort().filter((key) => key !== 'format')
    .map((key) => `${key}${params[key]}`).join('') + sharedSecret;
  return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

function hasLastfmScrobbleCredentials(settings) {
  return !!(settings && String(settings.lastfmApiKey || '').trim() && String(settings.lastfmSharedSecret || '').trim() && String(settings.lastfmSessionKey || '').trim());
}

function redactLastfmCredentials(settings) {
  const result = { ...(settings || {}) };
  delete result.lastfmApiKey;
  delete result.lastfmSharedSecret;
  delete result.lastfmSessionKey;
  return result;
}

module.exports = { getLfmSignature, hasLastfmScrobbleCredentials, redactLastfmCredentials };
