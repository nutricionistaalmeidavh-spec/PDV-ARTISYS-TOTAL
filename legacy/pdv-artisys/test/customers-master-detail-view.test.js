'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const view = require(path.join(__dirname, '..', 'desktop', 'renderer', 'customers-master-detail-view.js'));
const components = require(path.join(__dirname, '..', 'desktop', 'renderer', 'ux-components.js'));

test('customer master-detail exports the same guarded maturity contract expected by paired UX', () => {
  assert.equal(view.CUSTOMERS_UX_LEVEL, 4);
  assert.deepEqual(view.CUSTOMERS_UX_GUARDS, {
    canonicalRenderer: true,
    lifecycleOwned: true,
    legacyFallbackRemoved: true,
    parityGuarded: true,
    crossFlowGuarded: true,
    releaseRegressionGuarded: true
  });
});

test('creditSnapshot derives available credit without allowing a negative display balance', () => {
  assert.deepEqual(view.creditSnapshot({ creditLimitCents: 10000, creditUsedCents: 2500 }), {
    limitCents: 10000,
    usedCents: 2500,
    availableCents: 7500
  });
  assert.equal(view.creditSnapshot({ creditLimitCents: 1000, creditUsedCents: 1500 }).availableCents, 0);
});

test('salesForCustomer filters only the selected customer and orders most recent first', () => {
  const sales = [
    { id:'s-old', customerId:'c-1', completedAt:'2026-09-01T10:00:00.000Z' },
    { id:'s-other', customerId:'c-2', completedAt:'2026-09-20T10:00:00.000Z' },
    { id:'s-new', customerId:'c-1', completedAt:'2026-09-10T10:00:00.000Z' }
  ];
  assert.deepEqual(view.salesForCustomer(sales, 'c-1').map(sale => sale.id), ['s-new', 's-old']);
});

test('formatAddress keeps structured delivery-address information visible in the detail panel', () => {
  assert.equal(view.formatAddress({
    street:'Rua das Flores', number:'123', complement:'Apto 4', district:'Centro', city:'Ribeirão Preto', state:'SP', postalCode:'14000000', reference:'Portão azul'
  }), 'Rua das Flores, 123 · Apto 4 · Centro · Ribeirão Preto/SP · CEP 14000000 · Ref. Portão azul');
  assert.equal(view.formatAddress(null), '—');
});

test('renderCustomerDetail uses real credit, last purchase, address and canonical panel actions', () => {
  const customer = {
    id:'c-1', name:'Maria', document:'12345678900', phone:'16999999999', email:'maria@example.com',
    creditLimitCents:10000, creditUsedCents:2500, active:true,
    address:{ street:'Rua A', number:'10', city:'Ribeirão Preto', state:'SP', postalCode:'14000000' },
    notes:'Cliente preferencial'
  };
  const sales = [{ id:'s-1', saleNumber:'V-001', customerId:'c-1', totalCents:3500, completedAt:'2026-09-20T10:00:00.000Z' }];
  const html = view.renderCustomerDetail({
    customer,
    sales,
    components,
    formatCents:cents=>`R$ ${cents}`,
    formatDate:value=>String(value).slice(0,10),
    historyOpen:true
  });
  assert.match(html,/Maria/);
  assert.match(html,/R\$ 10000/);
  assert.match(html,/R\$ 2500/);
  assert.match(html,/R\$ 7500/);
  assert.match(html,/2026-09-20/);
  assert.match(html,/Rua A, 10/);
  assert.match(html,/data-action="edit-customer"/);
  assert.match(html,/data-action="customer-history"/);
  assert.match(html,/V-001/);
});