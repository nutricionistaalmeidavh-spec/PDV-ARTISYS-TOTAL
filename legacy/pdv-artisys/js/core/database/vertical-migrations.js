'use strict';

const { withTransaction }=require('./sqlite-database');

const VERTICAL_SCHEMA_VERSION=8;

const V6_SQL=`
  ALTER TABLE sale_items ADD COLUMN configuration_json TEXT;
  ALTER TABLE restaurant_order_items ADD COLUMN configuration_json TEXT;

  CREATE TABLE catalog_option_groups (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    selection_type TEXT NOT NULL DEFAULT 'MULTIPLE' CHECK(selection_type IN('SINGLE','MULTIPLE')),
    min_selections INTEGER NOT NULL DEFAULT 0 CHECK(min_selections>=0),
    max_selections INTEGER NOT NULL DEFAULT 1 CHECK(max_selections>=1),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE catalog_options (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price_delta_cents INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(group_id) REFERENCES catalog_option_groups(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_catalog_options_group ON catalog_options(group_id,active,name);

  CREATE TABLE product_option_groups (
    product_id TEXT NOT NULL,
    group_id TEXT NOT NULL,
    sort_order INTEGER NOT NULL DEFAULT 0,
    required INTEGER NOT NULL DEFAULT 0 CHECK(required IN(0,1)),
    PRIMARY KEY(product_id,group_id),
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE,
    FOREIGN KEY(group_id) REFERENCES catalog_option_groups(id) ON DELETE CASCADE
  );

  CREATE TABLE product_variants (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    sku TEXT,
    barcode TEXT,
    price_delta_cents INTEGER NOT NULL DEFAULT 0,
    cost_cents INTEGER,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX idx_product_variants_sku ON product_variants(sku) WHERE sku IS NOT NULL AND sku<>'';
  CREATE UNIQUE INDEX idx_product_variants_barcode ON product_variants(barcode) WHERE barcode IS NOT NULL AND barcode<>'';
  CREATE INDEX idx_product_variants_product ON product_variants(product_id,active,name);

  CREATE TABLE combo_groups (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    min_selections INTEGER NOT NULL DEFAULT 1 CHECK(min_selections>=0),
    max_selections INTEGER NOT NULL DEFAULT 1 CHECK(max_selections>=1),
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE combo_group_items (
    group_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity REAL NOT NULL DEFAULT 1 CHECK(quantity>0),
    price_delta_cents INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY(group_id,product_id),
    FOREIGN KEY(group_id) REFERENCES combo_groups(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );

  CREATE TABLE product_recipes (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    version INTEGER NOT NULL CHECK(version>=1),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    created_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE(product_id,version),
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE UNIQUE INDEX uq_product_active_recipe ON product_recipes(product_id) WHERE active=1;

  CREATE TABLE recipe_components (
    id TEXT PRIMARY KEY,
    recipe_id TEXT NOT NULL,
    ingredient_product_id TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity>0),
    unit TEXT NOT NULL DEFAULT 'UN',
    conversion_factor REAL NOT NULL DEFAULT 1 CHECK(conversion_factor>0),
    loss_percent REAL NOT NULL DEFAULT 0 CHECK(loss_percent>=0 AND loss_percent<100),
    FOREIGN KEY(recipe_id) REFERENCES product_recipes(id) ON DELETE CASCADE,
    FOREIGN KEY(ingredient_product_id) REFERENCES products(id)
  );
  CREATE INDEX idx_recipe_components_recipe ON recipe_components(recipe_id,ingredient_product_id);
`;

const V7_SQL=`
  CREATE TABLE pizza_profiles (
    product_id TEXT PRIMARY KEY,
    pricing_policy TEXT NOT NULL DEFAULT 'HIGHEST_FLAVOR' CHECK(pricing_policy IN('HIGHEST_FLAVOR','PROPORTIONAL_AVERAGE')),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE TABLE pizza_sizes (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    max_flavors INTEGER NOT NULL DEFAULT 1 CHECK(max_flavors>=1),
    price_delta_cents INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_pizza_sizes_product ON pizza_sizes(product_id,active,name);
  CREATE TABLE pizza_flavors (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price_delta_cents INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_pizza_flavors_product ON pizza_flavors(product_id,active,name);
  CREATE TABLE pizza_crusts (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    name TEXT NOT NULL,
    price_delta_cents INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
  );

  CREATE TABLE restaurant_item_cancellations (
    id TEXT PRIMARY KEY,
    order_item_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    actor_id TEXT,
    actor_role TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(order_item_id) REFERENCES restaurant_order_items(id)
  );
  CREATE TABLE restaurant_settlements (
    id TEXT PRIMARY KEY,
    table_session_id TEXT NOT NULL,
    sale_id TEXT,
    amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
    service_charge_cents INTEGER NOT NULL DEFAULT 0 CHECK(service_charge_cents>=0),
    status TEXT NOT NULL CHECK(status IN('OPEN','COMPLETED','CANCELLED')),
    created_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY(table_session_id) REFERENCES table_sessions(id),
    FOREIGN KEY(sale_id) REFERENCES sales(id)
  );
  CREATE INDEX idx_restaurant_settlements_session ON restaurant_settlements(table_session_id,status,created_at);
  CREATE TABLE restaurant_settlement_items (
    settlement_id TEXT NOT NULL,
    order_item_id TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity>0),
    amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
    PRIMARY KEY(settlement_id,order_item_id),
    FOREIGN KEY(settlement_id) REFERENCES restaurant_settlements(id) ON DELETE CASCADE,
    FOREIGN KEY(order_item_id) REFERENCES restaurant_order_items(id)
  );

  CREATE TABLE delivery_orders (
    id TEXT PRIMARY KEY,
    sale_id TEXT,
    customer_id TEXT,
    customer_name TEXT NOT NULL,
    phone TEXT,
    fulfillment_type TEXT NOT NULL CHECK(fulfillment_type IN('DELIVERY','PICKUP')),
    address_json TEXT,
    region TEXT,
    fee_cents INTEGER NOT NULL DEFAULT 0 CHECK(fee_cents>=0),
    courier TEXT,
    manual_eta TEXT,
    payment_method TEXT,
    note TEXT,
    status TEXT NOT NULL,
    cancel_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(sale_id) REFERENCES sales(id),
    FOREIGN KEY(customer_id) REFERENCES customers(id)
  );
  CREATE INDEX idx_delivery_status_created ON delivery_orders(status,created_at);

  CREATE TABLE fast_food_orders (
    id TEXT PRIMARY KEY,
    sale_id TEXT,
    order_date TEXT NOT NULL,
    daily_number INTEGER NOT NULL CHECK(daily_number>=1),
    status TEXT NOT NULL CHECK(status IN('NEW','PREPARING','READY','DELIVERED','CANCELLED')),
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(order_date,daily_number),
    FOREIGN KEY(sale_id) REFERENCES sales(id)
  );
  CREATE INDEX idx_fast_food_status ON fast_food_orders(status,order_date,daily_number);

  CREATE TABLE production_tickets (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL CHECK(source_type IN('DELIVERY','FAST_FOOD')),
    source_id TEXT NOT NULL,
    station_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN('NEW','PREPARING','READY','CANCELLED')),
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_type,source_id,station_id),
    FOREIGN KEY(station_id) REFERENCES kitchen_stations(id)
  );
  CREATE INDEX idx_production_tickets_status ON production_tickets(status,station_id,created_at);
  CREATE TABLE production_ticket_items (
    id TEXT PRIMARY KEY,
    ticket_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity>0),
    configuration_json TEXT,
    note TEXT,
    FOREIGN KEY(ticket_id) REFERENCES production_tickets(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );
  CREATE INDEX idx_production_ticket_items_ticket ON production_ticket_items(ticket_id);

  CREATE TABLE weight_barcode_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    total_length INTEGER NOT NULL CHECK(total_length>0),
    product_start INTEGER NOT NULL CHECK(product_start>=0),
    product_length INTEGER NOT NULL CHECK(product_length>0),
    weight_start INTEGER NOT NULL CHECK(weight_start>=0),
    weight_length INTEGER NOT NULL CHECK(weight_length>0),
    decimal_places INTEGER NOT NULL DEFAULT 3 CHECK(decimal_places>=0 AND decimal_places<=6),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE bakery_orders (
    id TEXT PRIMARY KEY,
    customer_id TEXT,
    customer_name TEXT NOT NULL,
    requested_pickup_at TEXT,
    status TEXT NOT NULL CHECK(status IN('OPEN','READY','PICKED_UP','CANCELLED')),
    note TEXT,
    cancel_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(customer_id) REFERENCES customers(id)
  );
  CREATE INDEX idx_bakery_status_pickup ON bakery_orders(status,requested_pickup_at);
  CREATE TABLE bakery_order_items (
    id TEXT PRIMARY KEY,
    bakery_order_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    product_name TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity>0),
    unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
    total_cents INTEGER NOT NULL CHECK(total_cents>=0),
    FOREIGN KEY(bakery_order_id) REFERENCES bakery_orders(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );
`;

const V8_SQL=`
  ALTER TABLE product_variants ADD COLUMN attributes_json TEXT;

  CREATE TABLE retail_variant_balances (
    variant_id TEXT PRIMARY KEY,
    quantity REAL NOT NULL DEFAULT 0,
    minimum_stock REAL NOT NULL DEFAULT 0 CHECK(minimum_stock>=0),
    updated_at TEXT NOT NULL,
    FOREIGN KEY(variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
  );
  CREATE TABLE retail_variant_movements (
    id TEXT PRIMARY KEY,
    variant_id TEXT NOT NULL,
    movement_type TEXT NOT NULL,
    quantity_delta REAL NOT NULL,
    reference_key TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    FOREIGN KEY(variant_id) REFERENCES product_variants(id) ON DELETE CASCADE
  );
  CREATE INDEX idx_retail_variant_movements_variant ON retail_variant_movements(variant_id,created_at);

  CREATE TABLE service_catalog (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK(duration_minutes>0),
    price_cents INTEGER NOT NULL CHECK(price_cents>=0),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(product_id) REFERENCES products(id)
  );
  CREATE TABLE service_professionals (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    default_commission_bps INTEGER NOT NULL DEFAULT 0 CHECK(default_commission_bps>=0 AND default_commission_bps<=10000),
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN(0,1)),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE service_professional_links (
    service_id TEXT NOT NULL,
    professional_id TEXT NOT NULL,
    commission_bps INTEGER NOT NULL CHECK(commission_bps>=0 AND commission_bps<=10000),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(service_id,professional_id),
    FOREIGN KEY(service_id) REFERENCES service_catalog(id) ON DELETE CASCADE,
    FOREIGN KEY(professional_id) REFERENCES service_professionals(id) ON DELETE CASCADE
  );
  CREATE TABLE service_appointments (
    id TEXT PRIMARY KEY,
    service_id TEXT NOT NULL,
    professional_id TEXT NOT NULL,
    customer_id TEXT,
    starts_at TEXT NOT NULL,
    ends_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN('SCHEDULED','IN_PROGRESS','COMPLETED','CANCELLED','NO_SHOW')),
    note TEXT,
    sale_id TEXT,
    commission_bps INTEGER NOT NULL DEFAULT 0 CHECK(commission_bps>=0 AND commission_bps<=10000),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(service_id) REFERENCES service_catalog(id),
    FOREIGN KEY(professional_id) REFERENCES service_professionals(id),
    FOREIGN KEY(customer_id) REFERENCES customers(id),
    FOREIGN KEY(sale_id) REFERENCES sales(id)
  );
  CREATE INDEX idx_service_appointments_professional ON service_appointments(professional_id,starts_at,ends_at,status);

  CREATE TABLE workshop_assets (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN('VEHICLE','EQUIPMENT')),
    identifier TEXT NOT NULL,
    make TEXT,
    model TEXT,
    year TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(customer_id) REFERENCES customers(id)
  );
  CREATE INDEX idx_workshop_assets_customer ON workshop_assets(customer_id,identifier);
  CREATE TABLE work_orders (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL,
    asset_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN('OPEN','DIAGNOSIS','QUOTED','APPROVED','IN_PROGRESS','READY','CLOSED','CANCELLED')),
    complaint TEXT,
    diagnosis TEXT,
    quoted_total_cents INTEGER NOT NULL DEFAULT 0 CHECK(quoted_total_cents>=0),
    approval_note TEXT,
    approved_at TEXT,
    sale_id TEXT,
    cancel_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(customer_id) REFERENCES customers(id),
    FOREIGN KEY(asset_id) REFERENCES workshop_assets(id),
    FOREIGN KEY(sale_id) REFERENCES sales(id)
  );
  CREATE INDEX idx_work_orders_status ON work_orders(status,updated_at);
  CREATE TABLE work_order_items (
    id TEXT PRIMARY KEY,
    work_order_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN('PART','LABOR')),
    product_id TEXT NOT NULL,
    service_id TEXT,
    description TEXT NOT NULL,
    quantity REAL NOT NULL CHECK(quantity>0),
    unit_price_cents INTEGER NOT NULL CHECK(unit_price_cents>=0),
    total_cents INTEGER NOT NULL CHECK(total_cents>=0),
    created_at TEXT NOT NULL,
    FOREIGN KEY(work_order_id) REFERENCES work_orders(id) ON DELETE CASCADE,
    FOREIGN KEY(product_id) REFERENCES products(id),
    FOREIGN KEY(service_id) REFERENCES service_catalog(id)
  );
  CREATE INDEX idx_work_order_items_order ON work_order_items(work_order_id,created_at);

  CREATE TABLE onboarding_state (
    id TEXT PRIMARY KEY,
    business_name TEXT,
    segment TEXT,
    module_ids_json TEXT NOT NULL DEFAULT '[]',
    completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN(0,1)),
    completed_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE hardware_compatibility_evidence (
    id TEXT PRIMARY KEY,
    manufacturer TEXT NOT NULL,
    model TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN('PRINTER','SCALE','DRAWER','SCANNER','OTHER')),
    connection TEXT NOT NULL,
    driver TEXT,
    configuration_json TEXT NOT NULL DEFAULT '{}',
    os TEXT NOT NULL,
    tested_at TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN('VERIFIED','PARTIAL','UNSUPPORTED','BLOCKED_EXTERNAL')),
    result TEXT NOT NULL,
    limitations TEXT,
    evidence TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX idx_hardware_evidence_model ON hardware_compatibility_evidence(manufacturer,model,kind,tested_at);
`;

const VERTICAL_MIGRATIONS=Object.freeze([
  {version:6,name:'pdv_modular_foundation_e40_e42',sql:V6_SQL},
  {version:7,name:'pdv_verticals_e43_e47',sql:V7_SQL},
  {version:VERTICAL_SCHEMA_VERSION,name:'pdv_verticals_e48_e54',sql:V8_SQL}
]);

function runVerticalMigrations(db,now=()=>new Date().toISOString()){
  if(!db)throw new TypeError('Database is required.');
  const currentRow=db.prepare('SELECT COALESCE(MAX(version),0) AS version FROM schema_migrations').get();
  let current=Number(currentRow?.version||0);
  for(const migration of VERTICAL_MIGRATIONS){
    if(current>=migration.version)continue;
    withTransaction(db,()=>{
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(migration.version,migration.name,now());
    });
    current=migration.version;
  }
  return current;
}

module.exports={VERTICAL_SCHEMA_VERSION,V6_SQL,V7_SQL,V8_SQL,VERTICAL_MIGRATIONS,runVerticalMigrations};
