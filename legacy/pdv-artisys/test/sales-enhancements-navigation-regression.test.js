'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.join(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'desktop', 'renderer', 'app.js'), 'utf8');

test('current navigation no longer depends on removed sales-enhancements legacy QA flow', () => {
  assert.equal(fs.existsSync(path.join(root, 'qa', 'flows', 'sales-enhancements-v2.json')), false);
  assert.match(app, /home:\s*\{ label: 'Início'/);
  assert.match(app, /sellers:\s*\{ label: 'Equipe comercial'/);
  assert.match(app, /access:\s*\{ label: 'Acessos e equipe'/);
  assert.match(app, /state\.route = route;\s*document\.body\.dataset\.activeRoute = route;/);
  assert.match(app, /routeRegistry\.render\(state\.route, \{ state \}\)/);
  assert.match(app, /sellers:\s*\(\) => renderSellers\(\)/);
});
