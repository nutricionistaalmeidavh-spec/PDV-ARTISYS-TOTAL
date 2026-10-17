'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('checkout and settings enhancements consume semantic lifecycle instead of DOM observers', () => {
  for (const relative of [
    'desktop/renderer/ux-home-checkout.js',
    'desktop/renderer/seller-select-sync.js',
    'desktop/renderer/post-sale-receipt-ui.js',
    'desktop/renderer/telemetry-ui.js'
  ]) {
    const source = read(relative);
    assert.match(source, /PdvUiLifecycle/, `${relative} must consume lifecycle`);
    assert.match(source, /route:updated/, `${relative} must react to semantic updates`);
    assert.doesNotMatch(source, /new MutationObserver\b/, `${relative} must not watch DOM mutations`);
  }
});

test('settings hub is mounted by the canonical Settings owner and only consumes update lifecycle', () => {
  const source = read('desktop/renderer/settings-hub-ui.js');
  const operational = read('desktop/renderer/operational-pages.js');
  assert.match(source, /PdvUiLifecycle/);
  assert.match(source, /route:updated/);
  assert.doesNotMatch(source, /route:mounted|MutationObserver|legacyObserver/);
  assert.match(operational, /PdvSettingsHub\?\.mount\?\.\(pageRoot\)/);
});

test('canonical renderers publish checkout and settings update signals', () => {
  const app = read('desktop/renderer/app.js');
  const operational = read('desktop/renderer/operational-pages.js');
  assert.match(app, /routeRegistry\.updated\('checkout', \{ surface:'checkout' \}\)/);
  assert.match(operational, /routeRegistry\.updated\('settings', \{ surface:'settings' \}\)/);
});


test('migrated Settings extensions declare explicit categories instead of title guessing', () => {
  assert.match(read('desktop/renderer/settings-hub-ui.js'), /dataset\.settingsCategory/);
  assert.match(read('desktop/renderer/admin-ops.js'), /data-settings-category="company"/);
  assert.match(read('desktop/renderer/post-sale-receipt-ui.js'), /settingsCategory = 'printing'/);
  assert.match(read('desktop/renderer/telemetry-ui.js'), /settingsCategory='privacy'/);
  assert.match(read('desktop/renderer/vertical-modules.js'), /settingsCategory='modules'/);
});
