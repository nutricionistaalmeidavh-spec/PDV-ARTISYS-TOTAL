'use strict';

const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const restaurantUi=fs.readFileSync(path.join(root,'desktop/renderer/restaurant-ui.js'),'utf8');

test('restaurant management reports missing destinations without exposing a second route editor',()=>{
  assert.match(restaurantUi,/function routingConfigurationAlert\(/);
  assert.match(restaurantUi,/data-routing-alert/);
  assert.match(restaurantUi,/sem destino configurado/i);
  assert.match(restaurantUi,/data-routing-review/);
  assert.match(restaurantUi,/Setores de produção/);
  assert.doesNotMatch(restaurantUi,/id="assignment-form"/);
  assert.doesNotMatch(restaurantUi,/data-product-routing-list/);
  assert.doesNotMatch(restaurantUi,/>Salvar destino</);
});

test('routing alert opens the canonical inventory editor for the first pending product',()=>{
  assert.match(restaurantUi,/dataset\.routingReview/);
  assert.match(restaurantUi,/PdvAppNavigation\?\.navigate\?\.\('inventory'\)/);
  assert.match(restaurantUi,/PdvCatalogAdmin\?\.openInventoryItem\?\.\(productId\)/);
  assert.doesNotMatch(restaurantUi,/elements\.namedItem\('productId'\)/);
});
