'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dense = require('../desktop/renderer/products-dense-view.js');

test('productStatus covers inactive, uncontrolled, out, low and normal inventory states', () => {
  assert.deepEqual(dense.productStatus({ active:false, trackStock:true, stockQuantity:9, minimumStock:2 }), { key:'inactive', label:'Inativo', tone:'muted' });
  assert.deepEqual(dense.productStatus({ active:true, trackStock:false, stockQuantity:0, minimumStock:2 }), { key:'uncontrolled', label:'Sem controle', tone:'info' });
  assert.deepEqual(dense.productStatus({ active:true, trackStock:true, stockQuantity:0, minimumStock:2 }), { key:'out', label:'Sem estoque', tone:'danger' });
  assert.deepEqual(dense.productStatus({ active:true, trackStock:true, stockQuantity:2, minimumStock:2 }), { key:'low', label:'Baixo', tone:'warning' });
  assert.deepEqual(dense.productStatus({ active:true, trackStock:true, stockQuantity:3, minimumStock:2 }), { key:'normal', label:'Normal', tone:'success' });
});

test('filterByStock preserves the source collection and follows status semantics', () => {
  const products = [
    { id:'a', active:true, trackStock:true, stockQuantity:5, minimumStock:2 },
    { id:'b', active:true, trackStock:true, stockQuantity:2, minimumStock:2 },
    { id:'c', active:true, trackStock:true, stockQuantity:0, minimumStock:2 },
    { id:'d', active:true, trackStock:false, stockQuantity:0, minimumStock:0 }
  ];

  assert.deepEqual(dense.filterByStock(products, 'low').map(item => item.id), ['b']);
  assert.deepEqual(dense.filterByStock(products, 'out').map(item => item.id), ['c']);
  assert.deepEqual(dense.filterByStock(products, 'uncontrolled').map(item => item.id), ['d']);
  assert.equal(products.length, 4);
});

test('dense Products renderer preserves all canonical action hooks', () => {
  const ux = {
    SearchField: options => `<input id="${options.id}" value="${options.value}">`,
    FilterBar: options => `<div data-filter-count="${options.filters.length}"></div>`,
    StatusBadge: options => `<span data-status="${options.label}"></span>`,
    DataTable: options => `<div class="${options.className}">${options.rows.map(row => options.columns.map(column => typeof column.render === 'function' ? column.render(row) : row[column.key]).join('')).join('')}</div>`
  };

  const html = dense.renderProductsDense({
    products:[{ id:'p1', name:'Café', sku:'SKU1', barcode:'789', categoryName:'Bebidas', salePriceCents:1000, costCents:600, stockQuantity:2, minimumStock:2, unit:'UN', trackStock:true, active:true, photo:{} }],
    categories:[{ id:'c1', name:'Bebidas' }],
    query:'caf',
    categoryId:'c1',
    stockFilter:'low',
    syncLabel:'Sincronizado',
    formatCents:cents => `R$ ${cents}`,
    quantityLabel:value => String(value),
    calculateMarginPercent:() => 40
  }, ux);

  for (const marker of [
    'id="new-product"',
    'id="new-category"',
    'id="sync-product-photos"',
    'id="product-page-search"',
    'data-edit-product="p1"',
    'data-product-photo-edit="p1"',
    'data-product-photo-remove="p1"',
    'data-products-view="dense"',
    'products-dense-table',
    'data-product-title',
    'data-product-stock-cell'
  ]) assert.ok(html.includes(marker), marker);
});
