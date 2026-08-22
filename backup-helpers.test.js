'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  AUTOMATIC_BACKUP_INTERVAL_MS,
  createLocalBackupFilename,
  getAutomaticBackupDueAt,
  getAutomaticBackupTime,
  isAutomaticBackupDue,
  isAutomaticBackupFilename,
  isSafetyBackupFilename,
  selectAutomaticBackupsToPrune,
} = require('./backup-helpers');

test('automatic backup filenames use the exact safe UTC pattern', () => {
  const timestamp = new Date('2026-08-02T13:14:15.016Z');
  const filename = createLocalBackupFilename('automatic', timestamp);
  assert.equal(filename, 'playerinyo-auto-2026-08-02T13-14-15-016Z.json');
  assert.equal(createLocalBackupFilename('safety', timestamp), 'playerinyo-safety-2026-08-02T13-14-15-016Z.json');
  assert.equal(isSafetyBackupFilename('playerinyo-safety-2026-08-02T13-14-15-016Z.json'), true);
  assert.equal(getAutomaticBackupTime(filename), timestamp.getTime());
  assert.equal(isAutomaticBackupFilename(filename), true);

  for (const invalid of [
    'playerinyo-safety-2026-08-02T13-14-15-016Z.json',
    'playerinyo-auto-2026-08-02T13:14:15.016Z.json',
    'playerinyo-auto-2026-02-30T13-14-15-016Z.json',
    '../playerinyo-auto-2026-08-02T13-14-15-016Z.json',
    'playerinyo-auto-2026-08-02T13-14-15-016Z.json.tmp',
  ]) assert.equal(isAutomaticBackupFilename(invalid), false, invalid);
});

test('retention selection prunes only exact automatic names beyond the newest seven', () => {
  const automatic = Array.from({ length: 9 }, (_, index) => createLocalBackupFilename('automatic', Date.UTC(2026, 0, index + 1)));
  const selected = selectAutomaticBackupsToPrune([
    automatic[3],
    'playerinyo-safety-2026-01-01T00-00-00-000Z.json',
    ...automatic,
    automatic[3],
    'notes.json',
  ]);
  assert.deepEqual(selected, [automatic[1], automatic[0]]);
});

test('due calculation runs immediately without a success and waits a full day after success', () => {
  const now = Date.parse('2026-08-02T12:00:00.000Z');
  const lastSuccess = new Date(now - (AUTOMATIC_BACKUP_INTERVAL_MS - 1)).toISOString();
  assert.equal(getAutomaticBackupDueAt(null, now), now);
  assert.equal(isAutomaticBackupDue(lastSuccess, now), false);
  assert.equal(isAutomaticBackupDue(lastSuccess, now + 1), true);
  assert.equal(getAutomaticBackupDueAt('not-a-date', now), now);
});
