'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeDownloadRecoveryRecord, normalizeDownloadRecoveryRecords } = require('./download-recovery');

const options = { isExistingAudioFile: (filePath) => filePath === '/music/finished.opus', now: () => 1234 };

test('download recovery accepts only completed accessible audio with a bounded id', () => {
  const record = sanitizeDownloadRecoveryRecord({ id: 'job_A-1', libraryItem: { filePath: '/music/finished.opus', title: 'Track' } }, options);
  assert.equal(record.createdAtMs, 1234);
  assert.equal(record.libraryItem.title, 'Track');
  assert.equal(sanitizeDownloadRecoveryRecord({ id: '../bad', libraryItem: { filePath: '/music/finished.opus' } }, options), null);
  assert.equal(sanitizeDownloadRecoveryRecord({ id: 'gone', libraryItem: { filePath: '/music/missing.opus' } }, options), null);
});

test('download recovery drops stale records and keeps the newest record for each job', () => {
  const records = normalizeDownloadRecoveryRecords([
    { id: 'keep', libraryItem: { filePath: '/music/finished.opus', title: 'Old' }, createdAtMs: 1 },
    { id: 'gone', libraryItem: { filePath: '/music/missing.opus' } },
    { id: 'keep', libraryItem: { filePath: '/music/finished.opus', title: 'New' }, createdAtMs: 2 },
  ], options);
  assert.deepEqual(records.map((record) => [record.id, record.libraryItem.title]), [['keep', 'New']]);
});
