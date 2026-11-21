'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { normalizeFreshReleases } = require('../app/listenbrainz-releases');

const id = '8f6bd1e4-fbe1-4f50-aa9b-94c450ec0f11';
const coverId = '10adbe5e-a2c0-4bf3-8249-2b4cbf6e6ca8';
const base = {
  artist_credit_name: 'Artist', release_name: 'Album', release_date: '2026-11-20',
  release_group_mbid: id, release_group_primary_type: 'Album',
};

test('fresh releases deduplicate editions and retain the earliest dated edition', () => {
  const releases = normalizeFreshReleases({ payload: { releases: [
    { ...base, caa_release_mbid: coverId }, { ...base, release_date: '2026-11-14' },
    { ...base, release_date: '2026-11-14', caa_release_mbid: coverId },
  ] } });
  assert.deepEqual(releases, [{
    id, name: 'Album', artist: 'Artist', date: '2026-11-14',
    image: 'https://coverartarchive.org/release/' + coverId + '/front-250',
  }]);
});

test('rejects malformed dates and skips singles while retaining upcoming EPs', () => {
  const releases = normalizeFreshReleases({ payload: { releases: [
    { ...base, release_date: '2026-02-30' }, { ...base, release_group_primary_type: 'Single' },
    { ...base, release_group_primary_type: 'EP' },
  ] } });
  assert.equal(releases.length, 1);
  assert.equal(releases[0].date, '2026-11-20');
  assert.equal(releases[0].image, '');
  assert.throws(() => normalizeFreshReleases({ payload: {} }));
});

const { inspectFreshReleases, loadFreshReleases } = require('../app/listenbrainz-releases');
const { createProviderJsonCache } = require('../app/provider-json-cache');
const report = releases => inspectFreshReleases({ payload: { releases } });

test('empty reports expand once and preserve the source counts and exclusion reasons', async () => {
  const requested = [];
  const result = await loadFreshReleases(async days => {
    requested.push(days);
    return days === 30 ? report([]) : report([
      { ...base, release_group_primary_type: 'Single' },
      { ...base, release_group_mbid: '' },
      { ...base, release_date: '2026-01' },
    ]);
  }, () => true);
  assert.deepEqual(requested, [30, 90]);
  assert.equal(result.status, 'filtered');
  assert.deepEqual(result.windows[1], {
    days: 90, sourceCount: 3, excluded: { type: 1, identity: 1, date: 1, duplicate: 0 },
  });
  assert.equal((await loadFreshReleases(async () => report([]), () => true)).status, 'empty');
});

test('first nonempty usable window wins, while an upstream failure is explicit', async () => {
  let calls = 0;
  const success = await loadFreshReleases(async () => { calls++; return report([base]); }, () => true);
  assert.equal(calls, 1);
  assert.equal(success.days, 30);
  assert.equal(success.status, 'ready');
  const error = await loadFreshReleases(async days => {
    if (days === 90) throw new Error('provider error');
    return report([]);
  }, () => true);
  assert.equal(error.status, 'error');
  assert.equal(error.days, 90);
  assert.equal(error.windows[0].sourceCount, 0);
});

test('account change discards an in-flight response and prevents the wider request', async () => {
  let active = true;
  let calls = 0;
  const result = await loadFreshReleases(async () => {
    calls++;
    active = false;
    return report([]);
  }, () => active);
  assert.equal(result, null);
  assert.equal(calls, 1);
});

test('refresh bypasses an existing provider cache entry', async () => {
  let calls = 0;
  const request = createProviderJsonCache(async () => ++calls);
  const get = refresh => request('releases', data => data, 300000, { refresh });
  assert.equal(await get(false), 1);
  assert.equal(await get(false), 1);
  assert.equal(await get(true), 2);
  assert.equal(await get(false), 2);
});
