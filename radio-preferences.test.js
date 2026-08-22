'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const prefs = require('./radio-preferences');

test('radio preferences safely fall back and preserve explicit choices', () => {
  assert.deepEqual(prefs.sanitizeRadioPreferences({ avoidLive: false, avoidClean: true }), {
    version: 1, excludeKnownTracks: true, avoidClean: true, avoidLive: false, avoidCovers: true, avoidRemixes: true, avoidSlowedSped: true, discoveryDepth: 0.5,
  });
  assert.equal(prefs.sanitizeRadioPreferences({ avoidLive: 'false' }).avoidLive, true);
  assert.equal(prefs.sanitizeRadioPreferences({ discoveryDepth: 1 }).discoveryDepth, 1);
  assert.equal(prefs.sanitizeRadioPreferences({ discoveryDepth: 1.1 }).discoveryDepth, 0.5);
});
test('track and artist blocklist identities prefer MBIDs and use conservative fallbacks', () => {
  const mbid = '123e4567-e89b-12d3-a456-426614174000';
  assert.equal(prefs.radioTrackKey({ trackMbid: mbid, artist: 'A', title: 'B' }), 'mbid:' + mbid);
  assert.equal(prefs.radioTrackKey({ artist: 'Artist', title: 'Title' }), 'name:artist::title');
  assert.equal(prefs.radioArtistKey({ artist: 'Artist' }), 'name:artist');
  const list = prefs.sanitizeRadioBlocklist({ tracks: [{ artist: 'Artist', title: 'Title' }], artists: [{ artist: 'Artist' }] });
  assert.deepEqual(prefs.isBlocked({ artist: 'Artist', title: 'Title' }, list), { track: true, artist: true });
  assert.deepEqual(prefs.isBlocked({ artist: 'Artist', title: 'Other' }, list), { track: false, artist: true });
  assert.deepEqual(prefs.isBlocked({ artist: 'Artist Two', title: 'Title' }, list), { track: false, artist: false });
});
test('corrupt and duplicate blocklist rows are safely dropped', () => {
  const list = prefs.sanitizeRadioBlocklist({ tracks: [{ key: 'name:a::b', artist: 'A', title: 'B' }, { key: 'name:a::b', artist: 'A', title: 'B' }, { key: 'bad' }] });
  assert.equal(list.tracks.length, 1); assert.deepEqual(list.artists, []);
});
