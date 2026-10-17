'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createPdvRuntime } = require('../js/core/pdv-runtime');

function insertCompletedSale(runtime, { id, customerId, completedAt }) {
  runtime.db.prepare(`INSERT INTO sales
    (id,sale_number,terminal_id,operator_id,customer_id,status,subtotal_cents,discount_cents,total_cents,change_cents,opened_at,completed_at,updated_at)
    VALUES (?,?,?,?,?,'COMPLETED',1000,0,1000,0,?,?,?)`)
    .run(id, id, 'PDV-01', 'mgr', customerId, completedAt, completedAt, completedAt);
}

function timestamp(index, base = Date.UTC(2026, 0, 1)) {
  return new Date(base + index * 60_000).toISOString();
}

test('customer-specific history remains accurate after more than 200 newer global sales and paginates without overlap', () => {
  const runtime = createPdvRuntime();
  try {
    runtime.db.prepare("INSERT INTO users (id,username,name,profile_id,password_hash,password_salt,active,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)")
      .run('mgr','gerente','Gerente','profile-manager','hash','salt',1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z');
    runtime.catalog.upsertCustomer({ id:'target', name:'Cliente Antigo', active:true });
    runtime.catalog.upsertCustomer({ id:'other', name:'Cliente Recente', active:true });

    for (let index = 0; index < 61; index += 1) {
      insertCompletedSale(runtime, { id:`target-${String(index).padStart(3,'0')}`, customerId:'target', completedAt:timestamp(index) });
    }
    for (let index = 0; index < 250; index += 1) {
      insertCompletedSale(runtime, { id:`other-${String(index).padStart(3,'0')}`, customerId:'other', completedAt:timestamp(index, Date.UTC(2026, 6, 1)) });
    }

    const page1 = runtime.sales.listHistory({ customerId:'target', status:'COMPLETED', limit:25, offset:0 });
    const page2 = runtime.sales.listHistory({ customerId:'target', status:'COMPLETED', limit:25, offset:25 });
    const page3 = runtime.sales.listHistory({ customerId:'target', status:'COMPLETED', limit:25, offset:50 });

    assert.equal(page1.length, 25);
    assert.equal(page2.length, 25);
    assert.equal(page3.length, 11);
    assert.equal(new Set([...page1, ...page2, ...page3].map(sale => sale.id)).size, 61);
    assert.equal(page1[0].id, 'target-060');
    assert.equal(page3.at(-1).id, 'target-000');

    const customer = runtime.catalog.listCustomers({ includeInactive:true }).find(item => item.id === 'target');
    assert.equal(customer.lastSale.id, 'target-060');
    assert.equal(customer.lastSale.totalCents, 1000);
  } finally {
    runtime.close();
  }
});

test('Customers master-detail loads history through the customer-filtered history API instead of the 200-sale global list', () => {
  const controller = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'renderer', 'customers-master-detail-controller.js'), 'utf8');
  assert.match(controller, /api\.salesHistory\s*\(\s*\{[^}]*customerId/s);
  assert.doesNotMatch(controller, /api\.sales\s*\(\s*['"]COMPLETED['"]\s*,\s*200\s*\)/);
});
