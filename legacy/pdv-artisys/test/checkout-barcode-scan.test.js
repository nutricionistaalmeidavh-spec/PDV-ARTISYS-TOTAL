const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('checkout barcode input filters products without rebuilding the checkout input',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','desktop/renderer/app.js'),'utf8');
  assert.match(app,/function renderCheckoutProductGrid\(\)/);
  const binding=app.match(/function bindCheckoutEvents\(\) \{([\s\S]*?)\n  \}/)?.[1]||'';
  const inputHandler=binding.split('\n').find(line=>line.includes("search?.addEventListener('input'"))||'';
  assert.match(inputHandler,/state\.productQuery = event\.target\.value; renderCheckoutProductGrid\(\);/);
  assert.doesNotMatch(inputHandler,/renderCheckout\(\)/);
});
