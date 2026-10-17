'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const products = require(path.join(root, 'desktop', 'renderer', 'products-dense-view.js'));
const customers = require(path.join(root, 'desktop', 'renderer', 'customers-master-detail-view.js'));

function includesAll(source, markers, label) {
  for (const marker of markers) assert.ok(source.includes(marker), `${label}: missing ${marker}`);
}

test('paired UX maturity advances together to cross-flow + release-regression guarded level', () => {
  assert.equal(products.PRODUCTS_UX_LEVEL, customers.CUSTOMERS_UX_LEVEL);
  assert.ok(products.PRODUCTS_UX_LEVEL >= 4, 'Products/Customers must remain at canonical P2 maturity');
  assert.deepEqual(products.PRODUCTS_UX_GUARDS, customers.CUSTOMERS_UX_GUARDS);
  assert.equal(products.PRODUCTS_UX_GUARDS.canonicalRenderer, true);
  assert.equal(products.PRODUCTS_UX_GUARDS.lifecycleOwned, true);
  assert.equal(products.PRODUCTS_UX_GUARDS.crossFlowGuarded, true);
  assert.equal(products.PRODUCTS_UX_GUARDS.releaseRegressionGuarded, true);
});

test('release-regression policy documents the two chained business invariants and paired gate', () => {
  const file = 'docs/architecture/ux-products-clients-release-regression.md';
  assert.equal(fs.existsSync(path.join(root, file)), true, `${file} must exist`);
  const policy = read(file);
  includesAll(policy, [
    'Cliente → Venda → Histórico',
    'Produto → Venda → Estoque → Relatórios',
    'release',
    'criticalFlows',
    'PRODUCTS_UX_LEVEL',
    'CUSTOMERS_UX_LEVEL',
    'evolução despareada'
  ], 'release-regression policy');
});
