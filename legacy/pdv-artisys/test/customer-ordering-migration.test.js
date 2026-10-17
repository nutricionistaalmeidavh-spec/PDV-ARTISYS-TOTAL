'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runCustomerOrderingMigrations,CUSTOMER_ORDERING_SCHEMA_VERSION}=require('../js/core/database/customer-ordering-migrations');

test('v32 upgrades legacy table orders and removes retired customer device state',()=>{
  const db=openDatabase(':memory:');
  try{
    db.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version,name,applied_at) VALUES(31,'previous','2026-10-04T00:00:00.000Z');

      CREATE TABLE users(id TEXT PRIMARY KEY);
      INSERT INTO users(id) VALUES('u1');

      CREATE TABLE restaurant_tables(id TEXT PRIMARY KEY);
      INSERT INTO restaurant_tables(id) VALUES('t1');

      CREATE TABLE table_sessions(id TEXT PRIMARY KEY,table_id TEXT NOT NULL);
      INSERT INTO table_sessions(id,table_id) VALUES('s1','t1');

      CREATE TABLE restaurant_orders(
        id TEXT PRIMARY KEY,
        table_session_id TEXT NOT NULL,
        source TEXT NOT NULL CHECK(source IN('DESKTOP','WAITER','TABLET')),
        device_id TEXT,
        created_by TEXT,
        status TEXT NOT NULL CHECK(status IN('NEW','PREPARING','READY','SERVED','CANCELLED')),
        note TEXT,
        total_cents INTEGER NOT NULL DEFAULT 0 CHECK(total_cents >= 0),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(table_session_id) REFERENCES table_sessions(id),
        FOREIGN KEY(created_by) REFERENCES users(id)
      );
      CREATE INDEX idx_restaurant_orders_session ON restaurant_orders(table_session_id,created_at);
      CREATE INDEX idx_restaurant_orders_status ON restaurant_orders(status,created_at);
      INSERT INTO restaurant_orders(id,table_session_id,source,status,total_cents,created_at,updated_at)
        VALUES('o1','s1','TABLET','NEW',1000,'2026-10-04','2026-10-04');

      CREATE TABLE restaurant_order_items(
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        product_id TEXT NOT NULL,
        product_name TEXT NOT NULL,
        quantity REAL NOT NULL,
        unit_price_cents INTEGER NOT NULL,
        total_cents INTEGER NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(order_id) REFERENCES restaurant_orders(id) ON DELETE CASCADE
      );
      INSERT INTO restaurant_order_items(id,order_id,product_id,product_name,quantity,unit_price_cents,total_cents,created_at)
        VALUES('oi1','o1','p1','Produto',1,1000,1000,'2026-10-04');

      CREATE TABLE mobile_devices(
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        device_type TEXT NOT NULL CHECK(device_type IN('WAITER','TABLET','KITCHEN','SELF_SERVICE')),
        table_id TEXT,
        user_id TEXT,
        credential_hash TEXT NOT NULL,
        credential_salt TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN('ACTIVE','BLOCKED')),
        last_seen_at TEXT,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        surface TEXT,
        scope_type TEXT,
        scope_id TEXT
      );
      CREATE INDEX idx_mobile_devices_status_type ON mobile_devices(status,device_type,name);
      CREATE UNIQUE INDEX uq_active_tablet_per_table ON mobile_devices(table_id) WHERE device_type='TABLET' AND status='ACTIVE';
      CREATE INDEX idx_mobile_devices_surface_status ON mobile_devices(surface,status,name);
      CREATE INDEX idx_mobile_devices_scope ON mobile_devices(scope_type,scope_id,status);

      INSERT INTO mobile_devices VALUES
        ('waiter','Garçom','WAITER',NULL,'u1','h','s','ACTIVE',NULL,'u1','2026-10-04','2026-10-04','waiter','establishment',NULL),
        ('tablet','Tablet','TABLET','t1',NULL,'h','s','ACTIVE',NULL,'u1','2026-10-04','2026-10-04','table','TABLE','t1'),
        ('self','Totem','SELF_SERVICE',NULL,NULL,'h','s','ACTIVE',NULL,'u1','2026-10-04','2026-10-04','self-service','establishment',NULL),
        ('compat','Compat','KITCHEN',NULL,NULL,'h','s','ACTIVE',NULL,'u1','2026-10-04','2026-10-04','self-service','establishment',NULL);

      CREATE TABLE self_service_profiles(
        device_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        table_id TEXT,
        operator_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(device_id) REFERENCES mobile_devices(id) ON DELETE CASCADE
      );
      INSERT INTO self_service_profiles VALUES
        ('self','PICKUP',NULL,'u1','2026-10-04','2026-10-04'),
        ('compat','PICKUP',NULL,'u1','2026-10-04','2026-10-04');

      CREATE TABLE kitchen_stations(id TEXT PRIMARY KEY);
      INSERT INTO kitchen_stations(id) VALUES('ks1');
      CREATE TABLE mobile_device_kitchen_stations(
        device_id TEXT NOT NULL,
        station_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(device_id,station_id),
        FOREIGN KEY(device_id) REFERENCES mobile_devices(id) ON DELETE CASCADE,
        FOREIGN KEY(station_id) REFERENCES kitchen_stations(id)
      );
      INSERT INTO mobile_device_kitchen_stations VALUES('compat','ks1','2026-10-04');
    `);

    assert.equal(runCustomerOrderingMigrations(db,()=> '2026-10-04T23:59:00.000Z'),CUSTOMER_ORDERING_SCHEMA_VERSION);

    assert.equal(db.prepare('SELECT source FROM restaurant_orders WHERE id=?').get('o1').source,'TABLE');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM restaurant_order_items WHERE order_id=?').get('o1').n,1);

    const orderSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='restaurant_orders'").get().sql;
    assert.match(orderSql,/['"]TABLE['"]/);
    assert.doesNotMatch(orderSql,/['"]TABLET['"]/);

    const devices=db.prepare('SELECT id,device_type FROM mobile_devices ORDER BY id').all().map(row=>({id:row.id,device_type:row.device_type}));
    assert.deepEqual(devices,[{id:'waiter',device_type:'WAITER'}]);
    const deviceSql=db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='mobile_devices'").get().sql;
    assert.doesNotMatch(deviceSql,/TABLET|SELF_SERVICE/);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='self_service_profiles'").get(),undefined);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);

    assert.doesNotThrow(()=>db.prepare(`INSERT INTO restaurant_orders(id,table_session_id,source,status,total_cents,created_at,updated_at)
      VALUES('o2','s1','TABLE','NEW',0,'2026-10-04','2026-10-04')`).run());
    assert.throws(()=>db.prepare(`INSERT INTO restaurant_orders(id,table_session_id,source,status,total_cents,created_at,updated_at)
      VALUES('o3','s1','TABLET','NEW',0,'2026-10-04','2026-10-04')`).run());
  }finally{
    db.close();
  }
});
