const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const eventTypesPath = path.join(__dirname, '..', 'js', 'core', 'pdv-event-types.js');

test('pdv event catalog module exists', () => {
  assert.equal(fs.existsSync(eventTypesPath), true);
});

test('exposes canonical sale cash inventory and print event names for V1', () => {
  const { PDV_EVENT_TYPES } = require(eventTypesPath);

  assert.equal(PDV_EVENT_TYPES.SALE_COMPLETED, 'sale.completed');
  assert.equal(PDV_EVENT_TYPES.SALE_CANCELLED, 'sale.cancelled');
  assert.equal(PDV_EVENT_TYPES.CASH_SESSION_OPENED, 'cash-session.opened');
  assert.equal(PDV_EVENT_TYPES.CASH_SESSION_CLOSED, 'cash-session.closed');
  assert.equal(PDV_EVENT_TYPES.INVENTORY_MOVEMENT_RECORDED, 'inventory.movement-recorded');
  assert.equal(PDV_EVENT_TYPES.RECEIPT_REQUESTED, 'receipt.requested');
  assert.equal(Object.keys(PDV_EVENT_TYPES).some(key=>key.startsWith('FISCAL_')), false);
});

test('event catalog is immutable', () => {
  const { PDV_EVENT_TYPES } = require(eventTypesPath);
  assert.equal(Object.isFrozen(PDV_EVENT_TYPES), true);
});
