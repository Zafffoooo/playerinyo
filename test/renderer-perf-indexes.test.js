'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const espree = require('espree');

function load(context, file, names) {
  const source = fs.readFileSync(require.resolve('../app/' + file), 'utf8');
  const ast = espree.parse(source, { ecmaVersion: 2022, sourceType: 'script', range: true });
  names.forEach((name) => {
    const node = ast.body.find((item) => (item.type === 'FunctionDeclaration' && item.id.name === name)
      || (item.type === 'VariableDeclaration' && item.declarations.some((d) => d.id.name === name)));
    assert.ok(node, name);
    vm.runInContext(source.slice(...node.range), context);
  });
}

function likedContext(likedSongs) {
  const c = vm.createContext({ state: { likedSongs } });
  load(c, 'renderer-playback-downloads.js', ['likedIdentity', 'likedRecordMatches', 'likedLookupCache', 'getLikedLookup', 'isTrackLiked']);
  vm.runInContext('function oldIsTrackLiked(track) { return state.likedSongs.some(function (r) { return likedRecordMatches(r, track); }); }', c);
  return c;
}

test('isTrackLiked Set lookup equals the old .some() scan', () => {
  const mbid = '12345678-1234-1234-1234-123456789abc';
  const liked = ['/m/a.mp3', { identity: 'name:artist::song' }, { identity: 'mbid:' + mbid }, { identity: '' }, null];
  const c = likedContext(liked);
  const tracks = [
    { matchedFile: { filePath: '/m/a.mp3' } },
    { filePath: '/m/a.mp3' },
    { artist: 'ARTIST', title: ' Song ' },
    { trackMbid: mbid.toUpperCase() },
    { artist: 'x', title: 'y' },
    {}, null,
  ];
  tracks.forEach((t) => { c.t = t; assert.equal(vm.runInContext('isTrackLiked(t)', c), vm.runInContext('oldIsTrackLiked(t)', c)); });
  assert.equal(vm.runInContext('isTrackLiked(t)', Object.assign(c, { t: tracks[0] })), true);
});

test('liked lookup rebuilds after push, splice and array replacement', () => {
  const c = likedContext([]);
  c.t = { artist: 'A', title: 'B' };
  assert.equal(vm.runInContext('isTrackLiked(t)', c), false);
  vm.runInContext("state.likedSongs.push({ identity: 'name:a::b' })", c);
  assert.equal(vm.runInContext('isTrackLiked(t)', c), true);
  vm.runInContext('state.likedSongs.splice(0, 1)', c);
  assert.equal(vm.runInContext('isTrackLiked(t)', c), false);
  vm.runInContext("state.likedSongs = [{ identity: 'name:a::b' }]", c);
  assert.equal(vm.runInContext('isTrackLiked(t)', c), true);
});

test('local musical identity index returns first library file like the old find()', () => {
  const files = [
    { filePath: '/1', artist: 'The Artist', title: 'Song (Live)' },
    { filePath: '/2', artist: 'The Artist', title: 'Song  Live' },
    { filePath: '/3', artist: 'Other', title: 'Tune', trackMbid: 'MBID-1' },
    { filePath: '/4', artist: 'Other', title: 'Tune' },
  ];
  const index = {};
  const c = vm.createContext({ state: { musicFiles: files }, getLibraryIndex: () => index });
  load(c, 'renderer-playback-downloads.js', ['normalizeMusicalIdentityText', 'getMusicalIdentity', 'getMusicalIdentityIndex', 'findLocalMusicalIdentity']);
  const old = (row) => { const id = vm.runInContext('getMusicalIdentity', c)(row); return id ? files.find((f) => vm.runInContext('getMusicalIdentity', c)(f) === id) || null : null; };
  const rows = [
    { Artist: 'the artist', Song: 'song live' }, { Artist: 'Other', Song: 'Tune' },
    { TrackMbid: 'mbid-1' }, { TrackMbid: 'nope' }, { Artist: '', Song: 'x' }, {},
  ];
  rows.forEach((row) => assert.equal(vm.runInContext('findLocalMusicalIdentity', c)(row), old(row)));
  assert.equal(vm.runInContext('findLocalMusicalIdentity', c)(rows[0]), files[0]);
  assert.ok(index.musicalIdentityIndex);
});

test('fuzzy pool matching keeps findMatchingFile priority and ambiguity semantics', () => {
  const files = [
    { filePath: '/a', title: 'Hello World', artist: 'Band', album: 'First', filename: 'a.mp3' },
    { filePath: '/b', title: 'Hello World (Remix)', artist: 'Band', album: 'Second', filename: 'b.mp3' },
    { filePath: '/c', title: 'Unique Song', artist: 'Solo', album: 'Album', filename: 'c.flac' },
    { filePath: '/d', title: 'Other', artist: 'Solo', album: 'Album', filename: 'Stem Name.mp3' },
  ];
  const c = vm.createContext({ state: { musicFiles: files, mappings: {} }, stripFileUrl: (p) => p });
  load(c, 'renderer.js', ['normalize', 'getAlbumKey', 'fuzzyMatch', 'indexedMatchResult', 'fuzzyNormMatch', 'getFuzzyPool', 'fuzzyPoolResult']);
  vm.runInContext(`
    function mk() {
      var m = function (k, f) { var map = new Map(); state.musicFiles.forEach(function (x) { var key = k(x); if (key) { if (!map.has(key)) map.set(key, []); map.get(key).push(x); } }); return map; };
      return { byStrippedPath: new Map(), byPath: new Map(),
        byNormalizedTitleArtistAlbum: m(function (x) { return normalize(x.title) + '::' + normalize(x.artist) + '::' + normalize(x.album); }),
        byNormalizedTitleAlbum: m(function (x) { return normalize(x.title) + '::' + normalize(x.album); }),
        byNormalizedTitleArtist: m(function (x) { return normalize(x.title) + '::' + normalize(x.artist); }),
        byNormalizedTitle: m(function (x) { return normalize(x.title); }),
        byNormalizedFilename: m(function (x) { return normalize(x.filename.replace(/\\.[^.]+$/, '')); }) };
    }
    var libIdx = mk(); function getLibraryIndex() { return libIdx; }`, c);
  load(c, 'renderer.js', ['findMatchingFileUncached']);
  // Reference implementation: the pre-change fuzzy passes over the raw library.
  const ref = vm.runInContext('(function(){ return function(song, artist, album) {' +
    'function fr(p){var m=null;for(var i=0;i<state.musicFiles.length;i++){if(!p(state.musicFiles[i]))continue;if(m)return{match:null,ambiguous:true};m=state.musicFiles[i];}return{match:m,ambiguous:false};}' +
    'var r=album?fr(function(f){return fuzzyMatch(f.title,song)&&(!artist||fuzzyMatch(f.artist,artist))&&fuzzyMatch(f.album,album);}):null;' +
    'if(r&&r.match)return r.match;if(r&&r.ambiguous)return null;' +
    'r=fr(function(f){return fuzzyMatch(f.title,song)&&(!artist||fuzzyMatch(f.artist,artist));});return r.match;}})()', c);
  const find = vm.runInContext('findMatchingFileUncached', c);
  // Only inputs that reach the fuzzy passes (no exact index hit).
  assert.equal(find('Hello', 'Band', 'Fir'), ref('Hello', 'Band', 'Fir'));
  assert.equal(find('Hello', 'Band', ''), null); // ambiguous: /a and /b both fuzzy-match
  assert.equal(find('Unique', 'Solo', 'Alb'), files[2]);
  assert.equal(find('Stem Name', 'Solo', ''), files[3]); // filename fuzzy fallback
  assert.equal(find('Nope', 'Nobody', 'Nothing'), null);
});
