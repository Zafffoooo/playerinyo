'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RADIO_BATCH_SIZE,
  createLocalLibraryProvider,
  createLastfmProvider,
  createRadioProviderRegistry,
  getLastfmGenreCatalog,
  normalizeLastfmGenreKey,
  searchLastfmGenreCatalog,
} = require('../app/radio-providers');

function file(index, genre, artist) {
  return {
    filePath: `/music/${index}.flac`,
    filename: `${index}.flac`,
    title: `Track ${index}`,
    artist: artist || `Artist ${index}`,
    album: `Album ${index}`,
    genre,
    duration: 180,
  };
}

function sequenceRandom() {
  var value = 0;
  return () => {
    value = (value + 0.61803398875) % 1;
    return value;
  };
}

test('local provider catalogs distinct genre labels case-insensitively', async () => {
  const provider = createLocalLibraryProvider();
  const genres = await provider.listGenres({ musicFiles: [file(1, 'Rock; Indie'), file(2, 'rock'), file(3, 'Jazz')] });
  assert.deepEqual(genres, [
    { id: 'indie', label: 'Indie', trackCount: 1 },
    { id: 'jazz', label: 'Jazz', trackCount: 1 },
    { id: 'rock', label: 'Rock', trackCount: 2 },
  ]);
});

test('local provider creates a 24-item genre batch with exact genre matching', async () => {
  const provider = createLocalLibraryProvider();
  const rock = Array.from({ length: 30 }, (_, index) => file(index, 'Rock', `Artist ${index}`));
  const hardRock = [file(40, 'Hard Rock', 'Other')];
  const result = await provider.startStation({ genreIds: ['rock'] }, { musicFiles: rock.concat(hardRock), random: sequenceRandom() });
  assert.equal(result.items.length, RADIO_BATCH_SIZE);
  assert.ok(result.items.every((item) => item.genres.includes('Rock')));
  assert.ok(result.items.every((item) => item.playback.kind === 'local-file'));
  assert.equal(result.items.some((item) => item.id === 'local:/music/40.flac'), false);
});

test('local provider excludes missing files and preserves best-effort artist variety', async () => {
  const provider = createLocalLibraryProvider();
  const tracks = [
    file(1, 'Electronic', 'Same'), file(2, 'Electronic', 'Same'), file(3, 'Electronic', 'Different'),
    file(4, 'Electronic', 'Same'), file(5, 'Electronic', 'Different'),
  ];
  const result = await provider.startStation({ genreIds: ['electronic'] }, {
    musicFiles: tracks,
    missingFilePaths: new Set(['/music/4.flac']),
    random: sequenceRandom(),
  });
  assert.equal(result.items.some((item) => item.id === 'local:/music/4.flac'), false);
  assert.ok(result.items.every((item, index, items) => index === 0 || item.artist !== items[index - 1].artist));
});

test('small genres repeat only after the cycle is consumed and retain last-five protection when possible', async () => {
  const provider = createLocalLibraryProvider();
  const tracks = Array.from({ length: 6 }, (_, index) => file(index, 'Ambient', `Artist ${index}`));
  const first = await provider.startStation({ genreIds: ['ambient'] }, { musicFiles: tracks, random: sequenceRandom() });
  const second = await provider.nextBatch(first.providerSession, { genreIds: ['ambient'] }, { musicFiles: tracks, random: sequenceRandom() });
  assert.equal(first.items.length, RADIO_BATCH_SIZE);
  assert.equal(second.items.length, RADIO_BATCH_SIZE);
  assert.equal(new Set(first.items.slice(0, 6).map((item) => item.id)).size, 6);
  assert.notEqual(second.items[0].id, first.items[first.items.length - 1].id);
});

test('next batches preserve provider state without mutating the previous session', async () => {
  const provider = createLocalLibraryProvider();
  const tracks = Array.from({ length: 30 }, (_, index) => file(index, 'House', `Artist ${index % 7}`));
  const first = await provider.startStation({ genreIds: ['house'] }, { musicFiles: tracks, random: sequenceRandom() });
  const previousSession = structuredClone(first.providerSession);
  const second = await provider.nextBatch(first.providerSession, { genreIds: ['house'] }, { musicFiles: tracks, random: sequenceRandom() });
  assert.deepEqual(first.providerSession, previousSession);
  assert.deepEqual(second.providerSession.genreIds, ['house']);
  assert.equal(second.providerSession.recentItemIds.length, 5);
  const third = await provider.nextBatch(second.providerSession, { genreIds: ['house'] }, { musicFiles: tracks, random: sequenceRandom() });
  assert.equal(third.items.length, RADIO_BATCH_SIZE);
  assert.equal(third.providerSession.recentItemIds.length, 5);
});

test('an empty refill returns an advanced serializable provider state', async () => {
  const provider = createLocalLibraryProvider();
  const first = await provider.startStation({ genreIds: ['house'] }, {
    musicFiles: [file(1, 'House', 'Artist')],
    random: sequenceRandom(),
  });
  const refill = await provider.nextBatch(first.providerSession, { genreIds: ['house'] }, {
    musicFiles: [],
    random: sequenceRandom(),
  });

  assert.deepEqual(refill.items, []);
  assert.deepEqual(refill.providerSession, { genreIds: ['house'], remainingItemIds: [], recentItemIds: first.providerSession.recentItemIds });
});

test('provider registry is explicit and rejects duplicate provider IDs', () => {
  const provider = createLocalLibraryProvider();
  const registry = createRadioProviderRegistry([provider]);
  assert.equal(registry.get('local-library'), provider);
  assert.deepEqual(registry.list(), [provider]);
  assert.throws(() => createRadioProviderRegistry([provider, provider]), /unique/);
});

test('Last.fm provider keeps a bounded versioned candidate continuation session', async () => {
  const client = {
    async start() { return { items: [{ id: 'lastfm:track:name:a::b', itemKind: 'candidate' }], providerSession: { version: 1, genreIds: ['Trip Hop'], poolKey: 'pool:one', remainingItemIds: ['lastfm:track:name:c::d'], recentItemIds: [], lastArtistKey: '' } }; },
    async next(session) { return { items: [], providerSession: session, exhausted: true }; },
  };
  const provider = createLastfmProvider(client);
  const first = await provider.startStation({ genreIds: ['Trip Hop'] });
  assert.equal(first.items[0].itemKind, 'candidate');
  assert.deepEqual(first.providerSession.genreIds, ['trip hop']);
  assert.equal(first.providerSession.mode, 'balanced');
  assert.equal(provider.normalizeSession({ version: 1, genreIds: ['trip hop'], poolKey: '' }), null);
  assert.equal(provider.normalizeSession({ version: 999, genreIds: ['trip hop'], poolKey: 'pool:one' }), null);
});

test('Last.fm refill applies an updated exclude-known preference to the active continuation', async () => {
  let seenSession = null;
  const client = {
    async next(session) { seenSession = session; return { items: [], providerSession: session, exhausted: true }; },
  };
  const provider = createLastfmProvider(client);
  const previous = { version: 1, genreIds: ['rock'], poolKey: 'pool:one', excludeKnownTracks: false, remainingItemIds: [], recentItemIds: [], lastArtistKey: '' };
  const result = await provider.nextBatch(previous, { genreIds: ['rock'], excludeKnownTracks: true });
  assert.equal(seenSession.excludeKnownTracks, true);
  assert.equal(result.providerSession.excludeKnownTracks, true);
  assert.equal(previous.excludeKnownTracks, false);
});

test('Last.fm genre catalog exposes the curated pinned starter set without unreliable counts', async () => {
  const provider = createLastfmProvider({});
  const genres = await provider.listGenres();
  assert.deepEqual(genres.filter((genre) => genre.pinned).map((genre) => genre.label), [
    'Rock', 'Pop', 'Electronic', 'Hip-Hop', 'Indie', 'Ambient', 'Jazz', 'Metal',
    'Trip-Hop', 'Alternative', 'Post-Punk', 'Dream Pop', 'Shoegaze', 'Industrial', 'Synthpop', 'Darkwave'
  ]);
  assert.ok(genres.length > 60);
  assert.ok(genres.length > 110);
  assert.deepEqual(searchLastfmGenreCatalog('symphonic metal').map((genre) => genre.id), ['symphonic-metal']);
  assert.equal(genres.some((genre) => Object.hasOwn(genre, 'trackCount')), false);
  assert.deepEqual(genres, getLastfmGenreCatalog());
});

test('Last.fm catalog search is case-insensitive and normalizes common aliases', () => {
  assert.equal(normalizeLastfmGenreKey(' trip hop '), 'trip-hop');
  assert.equal(normalizeLastfmGenreKey('HIP HOP'), 'hip-hop');
  assert.equal(normalizeLastfmGenreKey('dreampop'), 'dream-pop');
  assert.deepEqual(searchLastfmGenreCatalog('trip hop').map((genre) => genre.id), ['trip-hop']);
  assert.deepEqual(searchLastfmGenreCatalog('DREAMPOP').map((genre) => genre.id), ['dream-pop']);
  assert.deepEqual(searchLastfmGenreCatalog('').map((genre) => genre.id), getLastfmGenreCatalog().map((genre) => genre.id));
});
