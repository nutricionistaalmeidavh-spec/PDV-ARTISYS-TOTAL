'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Home has one canonical renderer and no operational Home hub', () => {
  const html = read('desktop/renderer/index.html');
  const checkoutLayer = read('desktop/renderer/ux-home-checkout.js');
  assert.match(html, /home-role-model\.js[\s\S]*classic-home-ui\.js/);
  assert.doesNotMatch(checkoutLayer, /enhanceHome|home-hub|salesHistory/);
});

test('checkout enhancement keeps the existing checkout controls in place', () => {
  const js = read('desktop/renderer/ux-home-checkout.js');
  assert.match(js, /function enhanceCheckout\(\)/);
  assert.match(js, /\.checkout-layout:not\(\[data-ux-checkout-preserved\]\)/);
  assert.match(js, /PdvUiLifecycle/);
  assert.match(js, /route:updated/);
  assert.doesNotMatch(js, /MutationObserver/);
  assert.doesNotMatch(js, /appendChild\(finalize\)/);
});

test('core checkout shortcuts and supported payment methods remain unchanged', () => {
  const ui = require('../desktop/renderer/ui-model');
  const app = read('desktop/renderer/app.js');
  for (const method of ['cash','card','pix']) assert.match(app, new RegExp(`data-pay=\\"${method}\\"`));
  assert.doesNotMatch(app,/data-pay=\\"tef\\"|>TEF</);
  assert.deepEqual(ui.CHECKOUT_SHORTCUTS, {
    F1:{type:'checkout.new-sale'}, F2:{type:'checkout.focus-scan'}, F3:{type:'checkout.remove-selected'},
    F4:{type:'checkout.cancel-sale'}, F6:{type:'checkout.suspend-sale'}, F12:{type:'checkout.finalize'}
  });
});
