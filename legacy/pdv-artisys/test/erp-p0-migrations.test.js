'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runErpFinanceMigrations}=require('../js/core/database/erp-finance-migrations');

test('ERP finance migrations are additive/idempotent',()=>{
  const db=openDatabase(':memory:');
  runMigrations(db,()=> '2026-09-23T12:00:00.000Z');
  runErpFinanceMigrations(db,()=> '2026-09-23T12:00:00.000Z');
  runErpFinanceMigrations(db,()=> '2026-09-23T12:00:00.000Z');
  const names=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  for(const name of ['finance_dre_groups','financial_categories','cost_centers','financial_entry_dimensions']) assert.ok(names.has(name));
  db.close();
});
