'use strict';
const {withTransaction}=require('./sqlite-database');
function runFoodOrderMigrations(db,now=()=>new Date().toISOString()){
  withTransaction(db,()=>{
    const columns=new Set(db.prepare('PRAGMA table_info(delivery_orders)').all().map(row=>row.name));
    for(const [name,type] of [['channel',"TEXT"],['ticket_date','TEXT'],['ticket_number','INTEGER']])if(!columns.has(name))db.exec(`ALTER TABLE delivery_orders ADD COLUMN ${name} ${type}`);
    db.exec(`CREATE TABLE IF NOT EXISTS food_daily_counters(order_date TEXT PRIMARY KEY,last_number INTEGER NOT NULL);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_food_daily_ticket ON delivery_orders(ticket_date,ticket_number) WHERE ticket_number IS NOT NULL;`);
    db.prepare('INSERT OR IGNORE INTO schema_migrations(version,name,applied_at) VALUES(30,?,?)').run('food_unified_orders_v30',now());
  });
  return 30;
}
module.exports={runFoodOrderMigrations};
