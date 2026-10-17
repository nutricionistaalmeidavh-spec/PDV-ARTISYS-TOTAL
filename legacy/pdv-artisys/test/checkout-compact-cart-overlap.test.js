'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const css=fs.readFileSync(path.join(__dirname,'..','desktop/renderer/ux-home-checkout.css'),'utf8');

test('compact checkout scrolls when the payment footer exceeds available height',()=>{
  assert.match(css,/\.sale-panel\s*\{[^}]*grid-template-rows:[^;}]*minmax\(84px,1fr\)[^;}]*auto[^}]*overflow-y:auto/s);
  assert.match(css,/\.sale-cart-region\s*\{[^}]*min-height:0[^}]*overflow:hidden/s);
  assert.match(css,/\.sale-cart-region \.cart-list\s*\{[^}]*min-height:0[^}]*overflow:auto/s);
  assert.match(css,/\.sale-checkout-footer\s*\{/);
  assert.match(css,/@media \(max-height:800px\)[\s\S]*?\.sale-panel\s*\{[^}]*overflow-y:auto/s);
  assert.doesNotMatch(css,/\.sale-panel\s*\{[^}]*overflow-y:hidden/s);
});
