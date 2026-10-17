'use strict';

const { withTransaction } = require('./sqlite-database');

const INTEGRITY_SCHEMA_VERSION = 19;
const INTEGRITY_MIGRATION_NAME = 'pdv_sale_cash_stock_integrity_v19';

function columns(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
}

function allocateDiscount(items, discountCents) {
  const total = items.reduce((sum,item) => sum + Number(item.total_cents || 0), 0);
  let remainingDiscount = Math.min(Math.max(Number(discountCents || 0), 0), total);
  let remainingBase = total;
  return items.map((item,index) => {
    const base = Number(item.total_cents || 0);
    let allocated = 0;
    if (remainingDiscount > 0 && remainingBase > 0) {
      allocated = index === items.length - 1 ? remainingDiscount : Math.round((remainingDiscount * base) / remainingBase);
      allocated = Math.min(Math.max(allocated,0), base, remainingDiscount);
    }
    remainingDiscount -= allocated;
    remainingBase -= base;
    return { id:item.id, allocatedDiscountCents:allocated, netTotalCents:base-allocated };
  });
}

function sessionAt(db, terminalId, timestamp) {
  if (!terminalId || !timestamp) return null;
  return db.prepare(`SELECT id FROM cash_sessions
    WHERE terminal_id=? AND opened_at<=? AND (closed_at IS NULL OR closed_at>=?)
    ORDER BY opened_at DESC,id DESC LIMIT 1`).get(String(terminalId),String(timestamp),String(timestamp))?.id || null;
}

function ensureIntegritySchema(db) {
  if (!db) throw new TypeError('Database is required.');
  const saleColumns = columns(db,'sales');
  if (!saleColumns.has('cash_session_id')) db.exec('ALTER TABLE sales ADD COLUMN cash_session_id TEXT REFERENCES cash_sessions(id)');

  const itemColumns = columns(db,'sale_items');
  if (!itemColumns.has('allocated_discount_cents')) db.exec('ALTER TABLE sale_items ADD COLUMN allocated_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (allocated_discount_cents >= 0)');
  if (!itemColumns.has('net_total_cents')) db.exec('ALTER TABLE sale_items ADD COLUMN net_total_cents INTEGER CHECK (net_total_cents >= 0)');

  const returnColumns = columns(db,'return_transactions');
  if (!returnColumns.has('cash_session_id')) db.exec('ALTER TABLE return_transactions ADD COLUMN cash_session_id TEXT REFERENCES cash_sessions(id)');

  const itemQuery = db.prepare('SELECT id,total_cents FROM sale_items WHERE sale_id=? ORDER BY created_at,id');
  const updateItem = db.prepare('UPDATE sale_items SET allocated_discount_cents=?,net_total_cents=? WHERE id=?');
  for (const sale of db.prepare('SELECT id,discount_cents FROM sales').all()) {
    for (const item of allocateDiscount(itemQuery.all(sale.id),sale.discount_cents)) {
      updateItem.run(item.allocatedDiscountCents,item.netTotalCents,item.id);
    }
  }

  const updateSale = db.prepare('UPDATE sales SET cash_session_id=? WHERE id=? AND cash_session_id IS NULL');
  for (const sale of db.prepare("SELECT id,terminal_id,completed_at FROM sales WHERE completed_at IS NOT NULL AND cash_session_id IS NULL").all()) {
    const cashSessionId=sessionAt(db,sale.terminal_id,sale.completed_at);
    if (cashSessionId) updateSale.run(cashSessionId,sale.id);
  }
  const updateReturn = db.prepare('UPDATE return_transactions SET cash_session_id=? WHERE id=? AND cash_session_id IS NULL');
  for (const ret of db.prepare('SELECT id,terminal_id,created_at FROM return_transactions WHERE cash_session_id IS NULL').all()) {
    const cashSessionId=sessionAt(db,ret.terminal_id,ret.created_at);
    if (cashSessionId) updateReturn.run(cashSessionId,ret.id);
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_sales_cash_session ON sales(cash_session_id,completed_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_returns_cash_session ON return_transactions(cash_session_id,created_at)');
}

function runIntegrityMigrations(db, now = () => new Date().toISOString()) {
  if (!db) throw new TypeError('Database is required.');
  const current = Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get()?.version || 0);
  if (current >= INTEGRITY_SCHEMA_VERSION) return current;
  withTransaction(db,()=>{
    ensureIntegritySchema(db);
    db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(INTEGRITY_SCHEMA_VERSION,INTEGRITY_MIGRATION_NAME,now());
  });
  return INTEGRITY_SCHEMA_VERSION;
}

module.exports={INTEGRITY_SCHEMA_VERSION,INTEGRITY_MIGRATION_NAME,ensureIntegritySchema,runIntegrityMigrations};
