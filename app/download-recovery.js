'use strict';

const RECOVERY_ID = /^[A-Za-z0-9_-]{1,160}$/;

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function sanitizeDownloadRecoveryRecord(value, options) {
  options = options || {};
  const isExistingAudioFile = typeof options.isExistingAudioFile === 'function' ? options.isExistingAudioFile : () => true;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  if (!isPlainObject(value) || typeof value.id !== 'string' || !RECOVERY_ID.test(value.id)) return null;
  if (!isPlainObject(value.libraryItem) || typeof value.libraryItem.filePath !== 'string' || !isExistingAudioFile(value.libraryItem.filePath)) return null;
  return {
    id: value.id,
    libraryItem: value.libraryItem,
    canonicalMetadata: isPlainObject(value.canonicalMetadata) ? value.canonicalMetadata : {},
    createdAtMs: Number(value.createdAtMs) || now(),
  };
}

function normalizeDownloadRecoveryRecords(records, options) {
  const byId = new Map();
  (Array.isArray(records) ? records : []).forEach((record) => {
    const safe = sanitizeDownloadRecoveryRecord(record, options);
    if (safe) byId.set(safe.id, safe);
  });
  return Array.from(byId.values()).slice(-200);
}

module.exports = { RECOVERY_ID, sanitizeDownloadRecoveryRecord, normalizeDownloadRecoveryRecords };
