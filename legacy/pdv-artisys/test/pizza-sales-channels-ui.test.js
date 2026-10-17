'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');

test('Delivery, Retirada and Balcao e senhas use the same configured pizza composer',()=>{
  const ui=read('desktop/renderer/vertical-modules.js');
  assert.match(ui,/PdvRestaurantOrderComposerUi\.configure/);
  assert.match(ui,/variantId:item\.configuration\?\.variantId/);
  assert.match(ui,/selections:item\.configuration\?\.selections/);
  assert.match(ui,/items:cart\.map/);
  assert.match(ui,/configurationSummary/);
});

test('regular checkout configures pizza before posting canonical sale item',()=>{
  const ui=read('desktop/renderer/app.js');
  assert.match(ui,/PdvRestaurantOrderComposerUi\.configure/);
  assert.match(ui,/api\.addConfiguredSaleItem/);
  assert.match(ui,/api\.removeConfiguredSaleItem/);
  assert.match(ui,/api\.updateConfiguredSaleItemQuantity/);
  assert.match(ui,/configurationSummary/);
});

test('shared composer preserves draft on persistence failure and waits for successful addition',()=>{
  const composer=read('desktop/renderer/restaurant-order-composer-ui.js');
  assert.match(composer,/await onAdd\(/);
  assert.match(composer,/configurationSnapshot:priced\.configurationSnapshot/);
  assert.match(composer,/submitButton\.disabled=true/);
});

test('configuration lookup and price quote are permitted to authorized operators without catalog edit rights',()=>{
  const router=read('server/vertical-router.js');
  assert.match(router,/requireOneOfCapabilities\(actor,\['products\.manage','sales\.create','restaurant\.orders\.create'\]\)/);
});
