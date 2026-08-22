'use strict';

function normalizeForRootComparison(value, windowsStyle) {
  var text = String(value || '').replace(/[\\/]+$/, '');
  if (windowsStyle) return text.replace(/\//g, '\\').toLowerCase();
  return text.replace(/\\/g, '/');
}

function isPathInsideScanRoot(filePath, rootPath) {
  var rawRoot = String(rootPath || '');
  var windowsStyle = /^[a-z]:/i.test(rawRoot) || rawRoot.includes('\\');
  var root = normalizeForRootComparison(rawRoot, windowsStyle);
  var file = normalizeForRootComparison(filePath, windowsStyle);
  if (!root || !file) return false;
  var separator = windowsStyle ? '\\' : '/';
  return file === root || file.startsWith(root + separator);
}

var scanRootFilterApi = { isPathInsideScanRoot: isPathInsideScanRoot };
if (typeof module !== 'undefined' && module.exports) module.exports = scanRootFilterApi;
if (typeof window !== 'undefined') window.ScanRootFilter = scanRootFilterApi;
