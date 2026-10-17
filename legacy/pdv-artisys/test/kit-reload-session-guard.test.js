'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function read(relativePath) {
  return fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
}

test('kit reload keeps authentication overlay blocking until session restoration finishes', () => {
  const html = read('desktop/renderer/index.html');
  const guard = read('desktop/renderer/reload-transition-ui.js');
  const kits = read('desktop/renderer/kits-combos-ui.js');

  assert.match(html, /id="auth-overlay" class="overlay"/);
  assert.doesNotMatch(html, /id="auth-overlay" class="overlay hidden"/);
  assert.match(html, /data-bootstrap-auth/);
  assert.ok(html.indexOf('./kits-combos-ui.js') < html.indexOf('./reload-transition-ui.js'));

  assert.match(kits, /setTimeout\(\(\)=>window\.location\.reload\(\),250\)/);
  assert.match(kits, /PdvUiLifecycle/);
  assert.match(kits, /route:mounted/);
  assert.match(kits, /route:updated/);
  assert.doesNotMatch(kits, /new MutationObserver/);
  assert.match(guard, /event\.target\?\.id !== 'kc-kit-form'/);
  assert.match(guard, /overlay\.classList\.remove\('hidden'\)/);
  assert.match(guard, /\.toast\.error/);
});
