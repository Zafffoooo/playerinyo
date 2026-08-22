'use strict';
const SECRET_KEYS = ['lastfmApiKey', 'lastfmSharedSecret', 'lastfmSessionKey'];
function mergeRendererSettings(current, incoming) {
  const next = { ...(current || {}), ...(incoming || {}) };
  SECRET_KEYS.forEach((key) => { if (current && current[key]) next[key] = current[key]; else delete next[key]; });
  return next;
}
function clearLastfmCredentials(settings) {
  const next = { ...(settings || {}), lastfmUsername: null };
  SECRET_KEYS.forEach((key) => { delete next[key]; });
  return next;
}
function canPersistLastfmCredentials(secureStorageAvailable) {
  return secureStorageAvailable === true;
}
module.exports = { SECRET_KEYS, mergeRendererSettings, clearLastfmCredentials, canPersistLastfmCredentials };
