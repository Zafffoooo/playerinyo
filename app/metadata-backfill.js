'use strict';

function createMetadataBackfillStamp(file) {
  return { v: 1, sig: `${file.fileSize}:${file.modifiedAtMs}` };
}

function hasCurrentMetadataBackfill(file) {
  const stamp = file && file.metadataBackfill;
  return !!stamp && stamp.v === 1 && stamp.sig === createMetadataBackfillStamp(file).sig;
}

module.exports = { createMetadataBackfillStamp, hasCurrentMetadataBackfill };
