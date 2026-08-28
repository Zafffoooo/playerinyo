'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const espree = require('espree');

test('every intentionally silent main-process catch explains why it is safe', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'main.js'), 'utf8');
  const ast = espree.parse(source, { ecmaVersion: 2022, sourceType: 'script', range: true });
  const silentCatches = [];

  function visit(node) {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'CatchClause' && node.body.body.length === 0) silentCatches.push(node);
    Object.entries(node).forEach(([key, value]) => {
      if (key === 'range' || key === 'loc') return;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object' && value.type) visit(value);
    });
  }

  visit(ast);
  assert.ok(silentCatches.length > 0, 'expected documented best-effort catches');
  silentCatches.forEach((clause) => {
    const body = source.slice(clause.body.range[0], clause.body.range[1]);
    assert.match(body, /(?:\/\*[^*]+\*\/|\/\/[^\n]+)/, `silent catch at offset ${clause.range[0]} needs a justification`);
  });
});
