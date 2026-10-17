'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

function requireMarkers(source, markers, label) {
  for (const marker of markers) {
    assert.ok(source.includes(marker), `${label}: contrato funcional ausente: ${marker}`);
  }
}

test('Entrega 1 keeps a written inventory of every Products/Customers extension surface', () => {
  const inventoryPath = path.join(root, 'docs', 'architecture', 'ux-products-clients-inventory.md');
  assert.equal(fs.existsSync(inventoryPath), true, 'inventário funcional deve permanecer versionado');
  const inventory = fs.readFileSync(inventoryPath, 'utf8');

  requireMarkers(inventory, [
    'Regra de paridade',
    'Produtos — superfície atual',
    'Fotos de produto',
    'Variações/subitens — funcionalidade injetada',
    'Kits e combos — funcionalidade injetada',
    'Clientes — superfície atual',
    'Endereço de entrega — funcionalidade injetada',
    'Cliente no fluxo de venda',
    'funcionalidades depois >= funcionalidades antes'
  ], 'inventário');
});

test('base Products UI keeps all current actions and integration selectors available', () => {
  const app = read('desktop/renderer/app.js');
  requireMarkers(app, [
    'function renderProducts()',
    'function openProductForm(product = null)',
    'function openCategoryForm()',
    'id="new-product"',
    'id="new-category"',
    'id="product-page-search"',
    'id="product-category-filter"',
    'id="sync-product-photos"',
    'data-product-photo-edit=',
    'data-product-photo-remove=',
    'data-edit-product=',
    'syncProductPhotos(true)',
    'uploadProductPhoto(',
    'removeProductPhoto('
  ], 'Produtos/app.js');
});

test('base Customers UI keeps search, create/edit and checkout linkage available', () => {
  const app = read('desktop/renderer/app.js');
  requireMarkers(app, [
    'function renderCustomers()',
    'function openCustomerForm(customer = null)',
    'id="new-customer"',
    'id="customer-page-search"',
    'data-edit-customer=',
    'function customerSearchInput(event)',
    'function renderCustomerSuggestions()',
    'async function setCustomer(customerId)',
    'api.setSaleCustomer('
  ], 'Clientes/app.js');
});

test('renderer API contract preserves catalog, photo and customer operations used by the current UI', () => {
  const api = read('desktop/renderer/api-client.js');
  requireMarkers(api, [
    'categories(includeInactive = false)',
    'saveCategory(body)',
    'products(includeInactive = false)',
    'saveProduct(body)',
    'syncProductPhotos(force = false)',
    'productPhotoSyncStatus()',
    'productPhotoDataUrl(productId, variant = \'thumbnail\')',
    'uploadProductPhoto(productId)',
    'removeProductPhoto(productId)',
    'customers(includeInactive = false)',
    'saveCustomer(body)',
    'setSaleCustomer(id, customerId)'
  ], 'ApiClient');
});

test('Products extension modules keep their DOM hooks and canonical features', () => {
  const variants = read('desktop/renderer/product-variants-ui.js');
  requireMarkers(variants, [
    '.page .data-card',
    '[data-edit-product]',
    'data-new-product-variant',
    'data-edit-product-variant',
    '/api/v1/product-variants',
    'lockParentStockForm'
  ], 'variações');

  const kits = read('desktop/renderer/kits-combos-ui.js');
  requireMarkers(kits, [
    'Kits e combos',
    'dataset.newKit',
    'dataset.newCombo',
    'data-edit-kit',
    'data-edit-combo',
    'saveKit',
    'savePromotionalCombo'
  ], 'kits/combos');
});

test('customer address extension keeps persistence hook and full delivery-address fields', () => {
  const address = read('desktop/renderer/delivery-address-ui.js');
  requireMarkers(address, [
    'p.saveCustomer=function(body)',
    "document.getElementById('customer-form')",
    '[data-customer-address]',
    "field('postalCode','CEP'",
    "field('street','Logradouro')",
    "field('number','Número')",
    "field('district','Bairro')",
    "field('city','Cidade')",
    "field('state','UF'",
    "field('reference','Referência')"
  ], 'endereço de cliente');
});

test('catalog domain remains the source of truth for Products and Customers persistence', () => {
  const catalog = read('js/domains/catalog/catalog-service.js');
  requireMarkers(catalog, [
    'function upsertProduct(input = {}, actor = null)',
    'function listProducts({ includeInactive = false } = {})',
    "action: 'product.upsert'",
    'function upsertCustomer(input = {}, actor = null)',
    'function listCustomers({ includeInactive = false } = {})',
    "action: 'customer.upsert'",
    'normalizeCustomerAddress',
    'creditLimitCents',
    'creditUsedCents'
  ], 'catálogo');
});
