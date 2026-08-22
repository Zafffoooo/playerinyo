'use strict';

const AUTOMATIC_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const AUTOMATIC_BACKUP_RETENTION = 7;
const AUTOMATIC_BACKUP_FILENAME_PATTERN = /^playerinyo-auto-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/;
const SAFETY_BACKUP_FILENAME_PATTERN = /^playerinyo-safety-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)\.json$/;

function formatUtcBackupTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new TypeError('Backup timestamp must be a valid date');
  return date.toISOString().replace(/:/g, '-').replace('.', '-');
}

function createLocalBackupFilename(kind, value) {
  if (kind !== 'automatic' && kind !== 'safety') throw new TypeError('Unsupported local backup kind');
  const label = kind === 'automatic' ? 'auto' : 'safety';
  return `playerinyo-${label}-${formatUtcBackupTimestamp(value)}.json`;
}

function getBackupTime(filename, pattern) {
  const match = pattern.exec(String(filename || ''));
  if (!match) return null;
  const isoTimestamp = match[1].replace(/-(\d{2})-(\d{2})-(\d{3})Z$/, ':$1:$2.$3Z');
  const time = Date.parse(isoTimestamp);
  if (!Number.isFinite(time) || formatUtcBackupTimestamp(time) !== match[1]) return null;
  return time;
}

function getAutomaticBackupTime(filename) { return getBackupTime(filename, AUTOMATIC_BACKUP_FILENAME_PATTERN); }
function getSafetyBackupTime(filename) { return getBackupTime(filename, SAFETY_BACKUP_FILENAME_PATTERN); }

function isAutomaticBackupFilename(filename) {
  return getAutomaticBackupTime(filename) !== null;
}

function isSafetyBackupFilename(filename) { return getSafetyBackupTime(filename) !== null; }

function selectAutomaticBackupsToPrune(filenames, retention = AUTOMATIC_BACKUP_RETENTION) {
  const keep = Number.isInteger(retention) && retention >= 0 ? retention : AUTOMATIC_BACKUP_RETENTION;
  return Array.from(new Set(Array.isArray(filenames) ? filenames : []))
    .map((name) => ({ name, time: getAutomaticBackupTime(name) }))
    .filter((entry) => entry.time !== null)
    .sort((a, b) => b.time - a.time || b.name.localeCompare(a.name))
    .slice(keep)
    .map((entry) => entry.name);
}

function getAutomaticBackupDueAt(lastSuccessAt, now = Date.now(), intervalMs = AUTOMATIC_BACKUP_INTERVAL_MS) {
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(currentTime)) throw new TypeError('Current time must be valid');
  if (lastSuccessAt === null || lastSuccessAt === undefined || lastSuccessAt === '') return currentTime;
  const lastTime = lastSuccessAt instanceof Date
    ? lastSuccessAt.getTime()
    : (typeof lastSuccessAt === 'number' ? lastSuccessAt : Date.parse(String(lastSuccessAt)));
  if (!Number.isFinite(lastTime)) return currentTime;
  const interval = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : AUTOMATIC_BACKUP_INTERVAL_MS;
  return lastTime + interval;
}

function isAutomaticBackupDue(lastSuccessAt, now = Date.now(), intervalMs = AUTOMATIC_BACKUP_INTERVAL_MS) {
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(currentTime) && currentTime >= getAutomaticBackupDueAt(lastSuccessAt, currentTime, intervalMs);
}

module.exports = {
  AUTOMATIC_BACKUP_FILENAME_PATTERN,
  AUTOMATIC_BACKUP_INTERVAL_MS,
  AUTOMATIC_BACKUP_RETENTION,
  SAFETY_BACKUP_FILENAME_PATTERN,
  createLocalBackupFilename,
  formatUtcBackupTimestamp,
  getAutomaticBackupDueAt,
  getAutomaticBackupTime,
  getSafetyBackupTime,
  isAutomaticBackupDue,
  isAutomaticBackupFilename,
  isSafetyBackupFilename,
  selectAutomaticBackupsToPrune,
};
