'use strict';

const { normalizeMbid } = require('./lastfm-discovery');

function inspectFreshReleases(value) {
  if (!Array.isArray(value?.payload?.releases)) throw new Error('Invalid ListenBrainz releases.');
  const releases = new Map();
  const excluded = { type: 0, identity: 0, date: 0, duplicate: 0 };
  for (const row of value.payload.releases) {
    if (!['Album', 'EP'].includes(row?.release_group_primary_type)) { excluded.type++; continue; }
    const id = normalizeMbid(row.release_group_mbid);
    const coverId = normalizeMbid(row.caa_release_mbid);
    const name = typeof row.release_name === 'string' ? row.release_name.trim().slice(0, 300) : '';
    const artist = typeof row.artist_credit_name === 'string' ? row.artist_credit_name.trim().slice(0, 300) : '';
    const date = row.release_date;
    if (!id || !name || !artist) { excluded.identity++; continue; }
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) { excluded.date++; continue; }
    const parsed = new Date(date + 'T00:00:00Z');
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) { excluded.date++; continue; }
    const prior = releases.get(id);
    if (prior) excluded.duplicate++;
    if (prior && (prior.date < date || (prior.date === date && prior.image))) continue;
    releases.set(id, { id, name, artist, date, image: coverId ? `https://coverartarchive.org/release/${coverId}/front-250` : '' });
  }
  return { items: [...releases.values()], sourceCount: value.payload.releases.length, excluded };
}

async function loadFreshReleases(request, isCurrent) {
  const windows = [];
  for (const days of [30, 90]) {
    if (!isCurrent()) return null;
    let report;
    try { report = await request(days); }
    catch {
      return isCurrent() ? { status: 'error', items: [], days, windows } : null;
    }
    if (!isCurrent()) return null;
    const { items, ...counts } = report;
    windows.push({ days, ...counts });
    if (items.length) return { status: 'ready', items, days, windows };
  }
  return { status: windows.some(window => window.sourceCount > 0) ? 'filtered' : 'empty', items: [], days: 90, windows };
}

module.exports = { inspectFreshReleases, loadFreshReleases, normalizeFreshReleases: value => inspectFreshReleases(value).items };
