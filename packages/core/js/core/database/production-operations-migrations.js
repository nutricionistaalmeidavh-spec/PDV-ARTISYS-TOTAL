'use strict';

const {withTransaction}=require('./sqlite-database');

const PRODUCTION_OPERATIONS_SCHEMA_VERSION=28;
const PRODUCTION_OPERATIONS_MIGRATION_NAME='pdv_production_device_stations_v28';

function runProductionOperationsMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const applied=Boolean(db.prepare('SELECT 1 FROM schema_migrations WHERE version=?').get(PRODUCTION_OPERATIONS_SCHEMA_VERSION));
  const stationScopePresent=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='mobile_device_kitchen_stations'").get());
  const deliveryItemsPresent=Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='delivery_order_items'").get());
  if(applied&&stationScopePresent&&deliveryItemsPresent)return PRODUCTION_OPERATIONS_SCHEMA_VERSION;
  withTransaction(db,()=>{
    db.exec(`
      CREATE TABLE IF NOT EXISTS mobile_device_kitchen_stations (
        device_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(device_id,station_id),
        FOREIGN KEY(device_id) REFERENCES mobile_devices(id) ON DELETE CASCADE,
        FOREIGN KEY(station_id) REFERENCES kitchen_stations(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_mobile_device_kitchen_station ON mobile_device_kitchen_stations(station_id,device_id);

      CREATE TABLE IF NOT EXISTS delivery_order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        quantity REAL NOT NULL CHECK(quantity > 0),
        unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents >= 0),
        configuration_json TEXT,
        note TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(order_id) REFERENCES delivery_orders(id) ON DELETE CASCADE,
        FOREIGN KEY(product_id) REFERENCES products(id)
      );
      CREATE INDEX IF NOT EXISTS idx_delivery_order_items_order ON delivery_order_items(order_id,id);
    `);
    if(!applied)db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(PRODUCTION_OPERATIONS_SCHEMA_VERSION,PRODUCTION_OPERATIONS_MIGRATION_NAME,now());
  });
  return PRODUCTION_OPERATIONS_SCHEMA_VERSION;
}

module.exports={
  PRODUCTION_OPERATIONS_SCHEMA_VERSION,
  PRODUCTION_OPERATIONS_MIGRATION_NAME,
  runProductionOperationsMigrations
};
