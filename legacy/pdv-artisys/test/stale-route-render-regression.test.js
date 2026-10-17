'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../desktop/renderer/app.js'), 'utf8');

test('async stock product save does not redraw Cardapio after another route became active', () => {
  assert.match(source, /function isRouteActive\(route\)/);
  assert.match(source, /closeModal\(\);if\(isRouteActive\('products'\)\)renderProducts\(\);showToast\(usageType==='INGREDIENT'\?'Insumo salvo no Estoque\.':'Produto salvo no Estoque\. Adicione-o ao Cardápio (?:somente )?quando quiser vendê-lo\.'[\s\S]*'success'\)/);
});
test('active route comes from the shared DOM route marker instead of stale app state', () => { assert.match(source, /function isRouteActive\(route\) \{ return document\.body\.dataset\.activeRoute === route; \}/); assert.match(source, /state\.route = route;\s*document\.body\.dataset\.activeRoute = route;/); assert.doesNotMatch(source, /state\.route\s*===\s*'products'\)\s*renderProducts\(\)/); });
test('route renderers reject stale asynchronous redraws', () => { for (const [name,route] of [['renderCheckout','checkout'],['renderCustomers','customers'],['renderSellers','sellers'],['renderProducts','products']]) { const start=source.indexOf(`function ${name}(`); assert.notEqual(start,-1,`${name} must exist`); const block=source.slice(start,start+260); assert.match(block,new RegExp(`if \\(!isRouteActive\\('${route}'\\)\\) return;`),`${name} must ignore stale route redraws`); } });
test('photo sync monitor checks the real active route', () => { const start=source.indexOf('function monitorProductPhotoSync()'); assert.notEqual(start,-1); const block=source.slice(start,start+700); assert.match(block,/isRouteActive\('products'\)/); assert.match(block,/isRouteActive\('checkout'\)/); assert.doesNotMatch(block,/state\.route/); });
