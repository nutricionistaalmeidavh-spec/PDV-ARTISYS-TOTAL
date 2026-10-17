'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const includesAll = (source, markers, label) => markers.forEach(marker => assert.ok(source.includes(marker), `${label}: missing ${marker}`));

test('Customers canonical assets load without reversible feature-flag fallback', () => {
  const index = read('desktop/renderer/index.html');
  includesAll(index, ['./customers-master-detail.css','./customers-master-detail-view.js','./app.js','./customers-master-detail-controller.js'], 'index');
  assert.doesNotMatch(index, /feature-flags\.js|catalog-search-stability\.js/);
});

test('Customers renderer owns incremental search and canonical edit/form selectors', () => {
  const app = read('desktop/renderer/app.js');
  includesAll(app, [
    'function customersListHtml()',
    'function renderCustomersList()',
    'function renderCustomers()',
    'data-customers-canonical="true"',
    'id="customers-list"',
    'id="new-customer"',
    'id="customer-page-search"',
    'data-edit-customer=',
    'function openCustomerForm(customer = null)',
    'api.saveCustomer',
    "routeRegistry.updated('customers'"
  ], 'Customers canonical renderer');
  assert.match(app, /customer-page-search'[\s\S]*renderCustomersList\(\)/);
});

test('Customers master-detail presentation is lifecycle-owned without DOM observer or legacy restoration', () => {
  const controller = read('desktop/renderer/customers-master-detail-controller.js');
  includesAll(controller, ['PdvUiLifecycle','route:mounted','route:updated','PdvCustomersMasterDetail','function decorateCustomers','PdvCustomersMasterDetailController','originalEdit?.click()'], 'Customers controller');
  assert.doesNotMatch(controller, /MutationObserver|PdvFeatureFlags|restoreLegacy/);
});

test('customer history remains canonical and delivery address form integration remains intact', () => {
  const controller = read('desktop/renderer/customers-master-detail-controller.js');
  const address = read('desktop/renderer/delivery-address-ui.js');
  includesAll(controller, ['api.salesHistory({','customerId:id',"status:'COMPLETED'",'limit:HISTORY_PAGE_SIZE','offset:state.offset'], 'history');
  includesAll(address, ["document.getElementById('customer-form')",'[data-customer-address]','p.saveCustomer=function(body)'], 'delivery address');
});

test('Customers parity document records canonical P2 architecture', () => {
  const matrix = read('docs/architecture/customers-master-detail-parity.md');
  includesAll(matrix, ['P2 canônico','sem feature flag','lifecycle','busca incremental','Endereço de entrega','Histórico'], 'Customers parity');
});
