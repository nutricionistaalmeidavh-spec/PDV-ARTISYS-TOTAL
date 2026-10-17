'use strict';

const PDV_EVENT_TYPES = Object.freeze({
  SALE_OPENED: 'sale.opened',
  SALE_ITEM_ADDED: 'sale.item-added',
  SALE_ITEM_REMOVED: 'sale.item-removed',
  SALE_DISCOUNT_APPLIED: 'sale.discount-applied',
  SALE_SUSPENDED: 'sale.suspended',
  SALE_RESUMED: 'sale.resumed',
  SALE_COMPLETED: 'sale.completed',
  SALE_CANCELLED: 'sale.cancelled',
  SALE_VOIDED: 'sale.voided',

  RETURN_COMPLETED: 'return.completed',
  RETURN_CANCELLED: 'return.cancelled',

  PAYMENT_RECORDED: 'payment.recorded',
  PAYMENT_REVERSED: 'payment.reversed',

  CASH_SESSION_OPENED: 'cash-session.opened',
  CASH_SUPPLY_ADDED: 'cash-session.supply-added',
  CASH_WITHDRAWAL_RECORDED: 'cash-session.withdrawal-recorded',
  CASH_SESSION_CLOSED: 'cash-session.closed',

  INVENTORY_MOVEMENT_RECORDED: 'inventory.movement-recorded',
  INVENTORY_LOW_STOCK: 'inventory.low-stock',

  RECEIPT_REQUESTED: 'receipt.requested',
  RECEIPT_PRINTED: 'receipt.printed',
  RECEIPT_FAILED: 'receipt.failed',

  RESTAURANT_TABLE_OPENED: 'restaurant.table-opened',
  RESTAURANT_TABLE_TRANSFERRED: 'restaurant.table-transferred',
  RESTAURANT_TABLE_CLOSED: 'restaurant.table-closed',
  RESTAURANT_ORDER_CREATED: 'restaurant.order-created',
  RESTAURANT_WAITER_CALLED: 'restaurant.waiter-called',
  RESTAURANT_BILL_REQUESTED: 'restaurant.bill-requested',


  HARDWARE_STATUS_CHANGED: 'hardware.status-changed',
  BACKUP_COMPLETED: 'backup.completed',
  BACKUP_FAILED: 'backup.failed'
});

module.exports = { PDV_EVENT_TYPES };