'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { chooseYouTubeMatch, modifiers } = require('./youtube-track-matcher');
const candidate = { title: 'Roads', artist: 'Portishead', duration: 307 };
function result(id, title) { return { id, title, channel: 'Portishead - Topic', duration: 307 }; }
test('original is preferred over a labeled clean version', () => {
  const match = chooseYouTubeMatch(candidate, [result('abcdefghijk', 'Portishead - Roads (Clean Version)'), result('zyxwvutsrqp', 'Portishead - Roads')], { avoidClean: true });
  assert.equal(match.videoId, 'zyxwvutsrqp');
});
test('a clean candidate may still accept its matching clean result', () => {
  const match = chooseYouTubeMatch({ ...candidate, version: 'Clean Version' }, [result('abcdefghijk', 'Portishead - Roads (Clean Version)')], { avoidClean: true });
  assert.equal(match.videoId, 'abcdefghijk');
});
test('preference filtering narrows safe matches without making live acceptable when disabled', () => {
  assert.equal(chooseYouTubeMatch(candidate, [result('abcdefghijk', 'Portishead - Roads Live')], { avoidLive: true }), null);
  assert.equal(chooseYouTubeMatch(candidate, [result('abcdefghijk', 'Portishead - Roads Live')], { avoidLive: false }), null);
});
test('ordinary edit words are not radio edit modifiers', () => {
  assert.equal(modifiers('Editor\'s Song').has('radio edit'), false);
  assert.equal(modifiers('Song (Radio Edit)').has('radio edit'), true);
});
