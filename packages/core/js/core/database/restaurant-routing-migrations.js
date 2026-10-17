'use strict';

const { withTransaction }=require('./sqlite-database');

const RESTAURANT_ROUTING_SCHEMA_VERSION=1;
const RESTAURANT_ROUTING_MIGRATION_NAME='restaurant_product_routing_v1';

function runRestaurantRoutingMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  db.exec(`CREATE TABLE IF NOT EXISTS restaurant_routing_schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`);
  const current=Number(db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM restaurant_routing_schema_migrations').get()?.version||0);
  if(current>=RESTAURANT_ROUTING_SCHEMA_VERSION)return RESTAURANT_ROUTING_SCHEMA_VERSION;
  withTransaction(db,()=>{
    db.exec(`CREATE TABLE IF NOT EXISTS restaurant_product_routes (
      product_id TEXT PRIMARY KEY,
      mode TEXT NOT NULL CHECK(mode IN('DIRECT','PRODUCTION')),
      station_id TEXT,
      updated_at TEXT NOT NULL,
      CHECK((mode='DIRECT' AND station_id IS NULL) OR (mode='PRODUCTION' AND station_id IS NOT NULL)),
      FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY(station_id) REFERENCES kitchen_stations(id)
    )`);
    db.exec(`INSERT OR IGNORE INTO restaurant_product_routes(product_id,mode,station_id,updated_at)
      SELECT product_id,'PRODUCTION',station_id,updated_at FROM product_kitchen_stations`);
    db.prepare('INSERT INTO restaurant_routing_schema_migrations(version,name,applied_at) VALUES(?,?,?)')
      .run(RESTAURANT_ROUTING_SCHEMA_VERSION,RESTAURANT_ROUTING_MIGRATION_NAME,now());
  });
  return RESTAURANT_ROUTING_SCHEMA_VERSION;
}

module.exports={
  RESTAURANT_ROUTING_SCHEMA_VERSION,
  RESTAURANT_ROUTING_MIGRATION_NAME,
  runRestaurantRoutingMigrations
};
