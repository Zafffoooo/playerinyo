'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBackupRetentionCache } = require('../app/backup-retention-cache');

const stat = { size: 1000, mtimeMs: 123.5, ctimeMs: 124.5, dev: 1, ino: 10 };

test('retention reuses validated metadata only for the same file fingerprint', () => {
  const cache = createBackupRetentionCache();
  const metadata = { kind: 'automatic' };
  cache.set('/backups/first.json', stat, metadata);
  assert.equal(cache.get('/backups/first.json', { ...stat }), metadata);
  assert.equal(cache.get('/backups/other.json', stat), null);
  for (const field of ['size', 'mtimeMs', 'ctimeMs', 'dev', 'ino']) {
    cache.set('/backups/first.json', stat, metadata);
    assert.equal(cache.get('/backups/first.json', { ...stat, [field]: stat[field] + 1 }), null);
  }
});

test('retention cache bounds old metadata and supports pruning invalidation', () => {
  const cache = createBackupRetentionCache(2);
  cache.set('/first', stat, { kind: 'automatic' });
  cache.set('/second', stat, { kind: 'safety' });
  cache.set('/third', stat, { kind: undefined });
  assert.equal(cache.get('/first', stat), null);
  assert.equal(cache.get('/second', stat).kind, 'safety');
  assert.deepEqual(cache.get('/third', stat), { kind: undefined });
  cache.delete('/second');
  assert.equal(cache.get('/second', stat), null);
});
