'use strict';

function parseReleaseVersion(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(String(value || '').trim());
  return match ? match.slice(1, 4).map(Number) : null;
}

function isNewerReleaseVersion(currentVersion, candidateVersion) {
  const current = parseReleaseVersion(currentVersion);
  const candidate = parseReleaseVersion(candidateVersion);
  if (!current || !candidate) return false;
  for (let index = 0; index < current.length; index += 1) {
    if (candidate[index] !== current[index]) return candidate[index] > current[index];
  }
  return false;
}

module.exports = { parseReleaseVersion, isNewerReleaseVersion };
