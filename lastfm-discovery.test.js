'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeGenreKey, hasGenreTag, getArtistTitleKey, getCandidateIdentity, candidateFromTrack,
  buildCandidatePools, selectDiscoveryBatch,
} = require('./lastfm-discovery');

function track(name, artist, rank, mbid) {
  return { name, artist: { name: artist }, mbid: mbid || '', '@attr': { rank: String(rank) } };
}

test('genre and track identity normalization is conservative', () => {
  assert.equal(normalizeGenreKey('  Trip–Hop  '), 'trip-hop');
  assert.equal(getArtistTitleKey('Björk', 'Jóga (Live Remaster)'), 'björk::jóga (live remaster)');
  assert.equal(getCandidateIdentity({ artist: 'A', title: 'Same', trackMbid: 'e0d4f2ca-99f8-4d37-8de0-5cfdf2ea791b' }), 'mbid:e0d4f2ca-99f8-4d37-8de0-5cfdf2ea791b');
  assert.equal(getCandidateIdentity({ artist: '', title: 'Roads' }), '');
});

test('similar artist expansion requires an explicit matching genre tag', () => {
  assert.equal(hasGenreTag('Trip-Hop', [{ name: 'trip hop' }, { name: 'electronic' }]), true);
  assert.equal(hasGenreTag('Trip-Hop', [{ name: 'electronic' }]), false);
  assert.equal(hasGenreTag('Trip-Hop', [{ name: 'trip-hop' }]), true);
});

test('candidate pools separate core discovery and deep sources and deduplicate tracks', () => {
  const pools = buildCandidatePools({
    genreId: 'Trip Hop',
    topTracks: [track('Core', 'One', 1), track('Middle', 'Two', 100), track('Deep', 'Three', 190)],
    topArtists: [{ name: 'Artist Four', '@attr': { rank: '12' } }, { name: 'Artist Five', '@attr': { rank: '30' } }],
    artistTopTracks: {
      'artist four': [track('Established', 'Artist Four', 1)],
      'artist five': [track('Obscure', 'Artist Five', 1)],
    },
    similarArtistTracks: [track('Similar', 'Six', 1)],
  });
  assert.deepEqual(pools.core.map((item) => item.title), ['Core']);
  assert.ok(pools.discovery.some((item) => item.title === 'Middle'));
  assert.ok(pools.discovery.some((item) => item.title === 'Established'));
  assert.ok(pools.deep.some((item) => item.title === 'Deep'));
  assert.ok(pools.deep.some((item) => item.title === 'Similar'));
});

test('rank weighted batch selection avoids duplicate, recent and adjacent artists', () => {
  const pools = buildCandidatePools({
    genreId: 'rock',
    topTracks: Array.from({ length: 96 }, (_, index) => track(`Track ${index}`, index % 2 ? `Artist ${index}` : 'Repeated', index + 1)),
  });
  const first = selectDiscoveryBatch(pools, { requestedCount: 24, random: () => 0.81 });
  assert.equal(first.selected.length, 24);
  assert.equal(new Set(first.selected.map(getCandidateIdentity)).size, 24);
  assert.ok(first.selected.every((item, index) => index === 0 || item.artist !== first.selected[index - 1].artist));
  assert.ok(first.selected.some((item) => item.discovery.rank > 24));
  const second = selectDiscoveryBatch(pools, { requestedCount: 8, recentItemIds: first.recentItemIds, random: () => 0.35 });
  assert.ok(second.selected.every((item) => !first.recentItemIds.includes(getCandidateIdentity(item))));
});

test('strict heard filtering rejects a heard track but accepts another track by that artist', () => {
  const roads = candidateFromTrack(track('Roads', 'Portishead', 1), { genreId: 'trip-hop', rank: 1, tier: 'core' });
  const sweet = candidateFromTrack(track('It Could Be Sweet', 'Portishead', 2), { genreId: 'trip-hop', rank: 2, tier: 'core' });
  const pools = { core: [roads, sweet], discovery: [], deep: [] };
  const known = { has(candidate) { return candidate.title === 'Roads'; } };
  const result = selectDiscoveryBatch(pools, { requestedCount: 2, excludeKnownTracks: true, knownTrackIndex: known, random: () => 0 });
  assert.deepEqual(result.selected.map((item) => item.title), ['It Could Be Sweet']);
});

test('MBID and artist/title variants merge into one canonical candidate', () => {
  const mbid = 'e0d4f2ca-99f8-4d37-8de0-5cfdf2ea791b';
  const pools = buildCandidatePools({
    genreId: 'rock',
    topTracks: [track('Same', 'Artist', 1, mbid)],
    topArtists: [{ name: 'Artist', '@attr': { rank: '10' } }],
    artistTopTracks: { artist: [track('Same', 'Artist', 1)] },
  });
  const all = ['core', 'discovery', 'deep'].flatMap((tier) => pools[tier]);
  assert.equal(all.length, 1);
  assert.equal(getCandidateIdentity(all[0]), `mbid:${mbid}`);
});

test('tier schedule is weighted and mixed within a batch', () => {
  const pools = { core: [], discovery: [], deep: [] };
  ['core', 'discovery', 'deep'].forEach((tier) => {
    for (let index = 0; index < 30; index++) pools[tier].push(candidateFromTrack(track(`${tier}-${index}`, `${tier}-artist-${index}`, index + 1), { genreId: 'rock', tier, rank: index + 1 }));
  });
  const selected = selectDiscoveryBatch(pools, { requestedCount: 24, random: () => 0 }).selected;
  const tiers = selected.map((item) => item.discovery.tier);
  assert.deepEqual(tiers.reduce((counts, tier) => ({ ...counts, [tier]: (counts[tier] || 0) + 1 }), {}), { core: 12, discovery: 8, deep: 4 });
  assert.ok(tiers.slice(0, 6).includes('deep'));
  assert.notDeepEqual(tiers.slice(0, 6), ['core', 'core', 'core', 'core', 'core', 'core']);
});

test('depth weights retain core while shifting selection toward deep candidates', () => {
  const pools = { core: [], discovery: [], deep: [] };
  ['core', 'discovery', 'deep'].forEach((tier) => {
    for (let index = 0; index < 40; index++) pools[tier].push(candidateFromTrack(track(`${tier}-${index}`, `${tier}-artist-${index}`, index + 1), { genreId: 'rock', tier, rank: index + 1 }));
  });
  const essentials = selectDiscoveryBatch(pools, { requestedCount: 24, tierWeights: { core: 6, discovery: 3, deep: 1 }, random: () => 0 }).selected;
  const deep = selectDiscoveryBatch(pools, { requestedCount: 24, tierWeights: { core: 2, discovery: 5, deep: 4 }, random: () => 0 }).selected;
  const count = (items, tier) => items.filter((item) => item.discovery.tier === tier).length;
  assert.ok(count(essentials, 'core') > count(deep, 'core'));
  assert.ok(count(deep, 'deep') > count(essentials, 'deep'));
  assert.ok(count(deep, 'core') > 0);
});

test('similarity boost cannot bypass known-track filtering', () => {
  const favorite = candidateFromTrack(track('Favorite', 'Artist', 1), { genreId: 'rock', tier: 'core', rank: 1 });
  const other = candidateFromTrack(track('Other', 'Other Artist', 2), { genreId: 'rock', tier: 'core', rank: 2 });
  const result = selectDiscoveryBatch({ core: [favorite, other], discovery: [], deep: [] }, {
    requestedCount: 2, excludeKnownTracks: true, knownTrackIndex: { has: (item) => item.title === 'Favorite' }, similarity: { keys: new Set([favorite.id]), strength: 1 }, random: () => 0,
  });
  assert.deepEqual(result.selected.map((item) => item.title), ['Other']);
});
