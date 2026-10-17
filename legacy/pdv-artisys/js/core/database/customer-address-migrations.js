'use strict';

function hasColumn(db, table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(row => row.name === column);
}

const COLUMNS = [
  ['address_postal_code','TEXT'],
  ['address_street','TEXT'],
  ['address_number','TEXT'],
  ['address_complement','TEXT'],
  ['address_district','TEXT'],
  ['address_city','TEXT'],
  ['address_state','TEXT'],
  ['address_reference','TEXT']
];

function runCustomerAddressMigrations(db) {
  if (!db) throw new TypeError('Database is required.');
  for (const [column,type] of COLUMNS) {
    if (!hasColumn(db,'customers',column)) db.exec(`ALTER TABLE customers ADD COLUMN ${column} ${type}`);
  }
  return 1;
}

module.exports={runCustomerAddressMigrations};
