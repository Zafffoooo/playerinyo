'use strict';

function createMetadataBackfillStamp(file) {
  return `1:${file.fileSize}:${file.modifiedAtMs}`;
}

function hasCurrentMetadataBackfill(file) {
  return !!file && file.metadataBackfillSig === createMetadataBackfillStamp(file);
}

module.exports = { createMetadataBackfillStamp, hasCurrentMetadataBackfill };
