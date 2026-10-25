'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  sanitizeImportedSettings,
  sanitizeLikedSongs,
} = require('../app/main-data-sanitizers');

test('imported settings retain only validated allowlisted values', () => {
  const sanitized = sanitizeImportedSettings({
    minimizeToTray: true,
    audioMode: 'mono',
    audioOutputDeviceId: 'speaker-123',
    volume: 0.75,
    libraryRoots: ['/music', '/music'],
    accentColor: '#A1B2C3',
    ytdlCookiesFile: '/home/user/private-cookies.txt',
    lastfmApiKey: 'must-not-cross-backup-boundary',
    unknownSetting: 'ignored',
  });
  assert.deepEqual(sanitized, {
    minimizeToTray: true,
    audioMode: 'mono',
    audioOutputDeviceId: 'speaker-123',
    volume: 0.75,
    libraryRoots: ['/music'],
    accentColor: '#A1B2C3',
  });
});

test('imported settings reject invalid types and bounded values', () => {
  assert.throws(() => sanitizeImportedSettings([]), /must be an object/);
  assert.throws(() => sanitizeImportedSettings({ minimizeToTray: 'yes' }), /must be a boolean/);
  assert.throws(() => sanitizeImportedSettings({ volume: 2 }), /invalid number/);
  assert.throws(() => sanitizeImportedSettings({ accentColor: 'red' }), /six-digit hex color/);
  assert.throws(() => sanitizeImportedSettings({ libraryRoots: ['bad\0path'] }), /invalid string value/);
  assert.throws(() => sanitizeImportedSettings({ audioOutputDeviceId: 'x'.repeat(513) }), /invalid string value/);
});

test('liked songs preserve safe local and remote identities only', () => {
  const remote = {
    version: 1,
    identity: 'name:artist|title',
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    duration: 250,
    videoId: 'AbCdEfGhI_1',
    playbackSource: 'youtube',
  };
  const sanitized = sanitizeLikedSongs([
    '/music/local.mp3',
    '',
    'bad\0path',
    remote,
    { ...remote },
    { ...remote, identity: 'invalid', videoId: 'short' },
  ]);
  assert.equal(sanitized.length, 2);
  assert.equal(sanitized[0], '/music/local.mp3');
  assert.deepEqual(sanitized[1], {
    version: 1,
    identity: 'name:artist|title',
    title: 'Title',
    artist: 'Artist',
    album: 'Album',
    duration: 250,
    trackMbid: '',
    videoId: 'AbCdEfGhI_1',
    playbackSource: 'youtube',
    artwork: '',
    dateAdded: '',
  });
});

test('imported settings preserve bounded notes and rule-based Smart Playlists', () => {
  const sanitized = sanitizeImportedSettings({
    trackNotes: { '/music/a.flac': 'Warm mastering' },
    albumNotes: { 'Album::Artist': 'Try again on headphones' },
    customSmartPlaylists: [{
      id: 'sp_custom_1', name: 'Unplayed jazz', icon: 'ph-faders', color: 'linear-gradient(135deg,#171717,#4A4A4A)',
      rules: [{ field: 'genre', value: 'jazz' }, { field: 'played', value: 'false' }], desc: 'Two rules',
    }],
  });
  assert.equal(sanitized.trackNotes['/music/a.flac'], 'Warm mastering');
  assert.equal(sanitized.albumNotes['Album::Artist'], 'Try again on headphones');
  assert.deepEqual(sanitized.customSmartPlaylists[0].rules, [{ field: 'genre', value: 'jazz' }, { field: 'played', value: 'false' }]);
});

test('listening history keeps source counts and recorded dates through settings sanitization', () => {
  const first = '2026-10-12T10:00:00.000Z';
  const last = '2026-10-13T12:30:00.000Z';
  const row = {
    count: 3, time: 420, title: 'Song', artist: 'Artist', album: 'Album', albumArtist: 'Album Artist',
    firstPlayedAt: first, lastPlayedAt: last,
    sources: {
      local: { count: 2, time: 300, firstPlayedAt: first, lastPlayedAt: last },
      remote: { count: 1, time: 120, firstPlayedAt: last, lastPlayedAt: last },
    },
  };
  const sanitized = sanitizeImportedSettings({ listeningStats: { 'name:artist::song': row } });
  assert.equal(sanitized.listeningStats['name:artist::song'].albumArtist, 'Album Artist');
  assert.equal(sanitized.listeningStats['name:artist::song'].firstPlayedAt, first);
  assert.equal(sanitized.listeningStats['name:artist::song'].lastPlayedAt, last);
  assert.deepEqual(sanitized.listeningStats['name:artist::song'].sources, row.sources);
});

test('imported settings reject malformed Smart Playlist rules', () => {
  assert.throws(() => sanitizeImportedSettings({ customSmartPlaylists: [{ id: 'x', name: 'X', rules: [{ field: 'played', value: 'maybe' }] }] }), /invalid/);
  assert.throws(() => sanitizeImportedSettings({ trackNotes: { '/music/a.flac': 'x'.repeat(2001) } }), /invalid string value/);
});
