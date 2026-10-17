'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const includesAll = (source, markers, label) => markers.forEach(marker => assert.ok(source.includes(marker), `${label}: missing ${marker}`));

test('Products canonical assets load without feature-flag or search-shim fallbacks', () => {
  const index = read('desktop/renderer/index.html');
  includesAll(index, ['./ux-components.css','./products-dense-view.css','./products-dense-view.js','./app.js','./products-dense-controller.js'], 'index');
  assert.doesNotMatch(index, /feature-flags\.js|catalog-search-stability\.js/);
  assert.equal(fs.existsSync(path.join(root,'desktop/renderer/feature-flags.js')), false);
  assert.equal(fs.existsSync(path.join(root,'desktop/renderer/catalog-search-stability.js')), false);
});

test('Products renderer owns incremental search/category updates and stable action selectors', () => {
  const app = read('desktop/renderer/app.js');
  includesAll(app, [
    'function productsListHtml()',
    'function renderProductsList()',
    'function renderProducts()',
    'data-products-canonical="true"',
    'id="products-list"',
    'id="new-product"',
    'id="new-category"',
    'id="product-page-search"',
    'id="product-category-filter"',
    'id="sync-product-photos"',
    'data-product-photo-edit=',
    'data-product-photo-remove=',
    'data-edit-product=',
    "routeRegistry.updated('products'"
  ], 'Products canonical renderer');
  assert.match(app, /product-page-search'[\s\S]*renderProductsList\(\)/);
  assert.match(app, /product-category-filter'[\s\S]*renderProductsList\(\)/);
});

test('Products dense presentation is lifecycle-owned with no MutationObserver or reversible fallback', () => {
  const controller = read('desktop/renderer/products-dense-controller.js');
  includesAll(controller, ['PdvUiLifecycle','route:mounted','route:updated','PdvProductsDenseView.productStatus','PdvProductsDenseView.filterByStock','function decorateProducts','PdvProductsDenseController'], 'Products controller');
  assert.doesNotMatch(controller, /MutationObserver|PdvFeatureFlags|restoreLegacy/);
});

test('variants and kits/combos keep the canonical Product hooks', () => {
  const variants = read('desktop/renderer/product-variants-ui.js');
  const kits = read('desktop/renderer/kits-combos-ui.js');
  includesAll(variants, ['.data-row','[data-edit-product]','data-new-product-variant','data-edit-product-variant','PdvUiLifecycle'], 'variants');
  assert.doesNotMatch(variants, /MutationObserver/);
  includesAll(kits, ['Kits e combos','dataset.newKit','dataset.newCombo','data-edit-kit','data-edit-combo'], 'kits/combos');
});

test('Products parity document records canonical P2 architecture', () => {
  const matrix = read('docs/architecture/products-dense-parity.md');
  includesAll(matrix, ['P2 canônico','sem feature flag','lifecycle','busca incremental','Variações','Kits e combos'], 'Products parity');
});
