const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runReleaseMigrations}=require('../js/core/database/release-migrations');
const {runVerticalMigrations}=require('../js/core/database/vertical-migrations');
const {runSalesEnhancementMigrations}=require('../js/core/database/sales-enhancement-migrations');
const {runCommercialMediaMigrations}=require('../js/core/database/commercial-media-migrations');
const {runAccessProfileMigrations}=require('../js/core/database/access-profile-migrations');
const {runCanonicalAccessMigrations}=require('../js/core/database/canonical-access-migrations');
const {SqliteOutboxStore}=require('../js/core/database/outbox-store');
const {createCatalogService}=require('../js/domains/catalog/catalog-service');
const {createInventoryService}=require('../js/domains/inventory/inventory-service');
const {createTerminalStockLocationService}=require('../js/domains/inventory/terminal-stock-location-service');
const {createSaleService}=require('../js/domains/sales/sale-service');

function fixture(){
  const db=openDatabase(':memory:');runMigrations(db);runReleaseMigrations(db);runVerticalMigrations(db);runSalesEnhancementMigrations(db);runCommercialMediaMigrations(db);runAccessProfileMigrations(db);runCanonicalAccessMigrations(db);let seq=0;const ids=p=>p+'-'+(++seq);
  const catalog=createCatalogService({db,idFactory:ids,now:()=> '2026-09-20T12:00:00Z'});
  catalog.createUser({id:'u1',username:'caixa',name:'Caixa',profileId:'profile-cashier',password:'senha-forte-123'});
  catalog.upsertProduct({id:'p1',sku:'P1',name:'Produto',salePriceCents:1000,trackStock:true});
  const inventory=createInventoryService({db,idFactory:ids,now:()=> '2026-09-20T12:00:00Z'});
  db.prepare("INSERT INTO stock_locations(id,name,type,active,created_at,updated_at) VALUES('LOJA-A','Loja A','STORE',1,'x','x'),('LOJA-B','Loja B','STORE',1,'x','x')").run();
  inventory.move({productId:'p1',locationId:'LOJA-A',type:'opening',quantityDelta:5});
  inventory.move({productId:'p1',locationId:'LOJA-B',type:'opening',quantityDelta:20});
  const terminals=createTerminalStockLocationService({db,now:()=> '2026-09-20T12:00:00Z'});
  const outbox=new SqliteOutboxStore(db);
  const sales=createSaleService({db,outbox,idFactory:ids,now:()=> '2026-09-20T12:01:00Z'});
  return {db,inventory,terminals,outbox,sales};
}

test('terminal binding resolves configured location and legacy terminal falls back to MAIN',()=>{
  const {db,terminals}=fixture();
  terminals.bindTerminal('PDV-A','LOJA-A',{userId:'u1',profileId:'profile-administrator'});
  assert.equal(terminals.resolveTerminalLocation('PDV-A').locationId,'LOJA-A');
  assert.equal(terminals.resolveTerminalLocation('LEGACY').locationId,'MAIN');
  assert.equal(terminals.listTerminalBindings().length,1);
  db.close();
});

test('sale snapshots terminal stock location and later rebind does not mutate old sale',()=>{
  const {db,terminals,sales}=fixture();
  terminals.bindTerminal('PDV-A','LOJA-A');
  const first=sales.openSale({id:'s1',terminalId:'PDV-A',operatorId:'u1'});
  assert.equal(first.stockLocationId,'LOJA-A');
  terminals.bindTerminal('PDV-A','LOJA-B');
  assert.equal(sales.getSale('s1').stockLocationId,'LOJA-A');
  assert.equal(sales.openSale({id:'s2',terminalId:'PDV-A',operatorId:'u1'}).stockLocationId,'LOJA-B');
  db.close();
});

test('completion validates stock at sale location instead of aggregate company stock',()=>{
  const {db,terminals,sales}=fixture();
  terminals.bindTerminal('PDV-A','LOJA-A');
  sales.openSale({id:'s1',terminalId:'PDV-A',operatorId:'u1'});
  sales.addItem('s1',{productId:'p1',quantity:6});
  assert.equal(db.prepare("SELECT quantity FROM inventory_balances WHERE product_id='p1'").get().quantity,25);
  assert.throws(()=>sales.completeSale('s1',{payments:[{method:'CASH',amountCents:6000}],actor:{userId:'u1',profileId:'profile-cashier'}}),/Estoque insuficiente/);
  assert.equal(sales.getSale('s1').status,'OPEN');
  db.close();
});

test('sale completed and cancelled events carry the immutable stock location',async()=>{
  const {db,terminals,outbox,sales}=fixture();
  terminals.bindTerminal('PDV-A','LOJA-A');
  sales.openSale({id:'s1',terminalId:'PDV-A',operatorId:'u1'});
  sales.addItem('s1',{productId:'p1',quantity:2});
  sales.completeSale('s1',{payments:[{method:'CASH',amountCents:2000}],actor:{userId:'u1',profileId:'profile-cashier'}});
  sales.cancelSale('s1',{reason:'teste',actor:{userId:'u1',profileId:'profile-manager'}});
  const events=await outbox.listPending(10);
  assert.deepEqual(events.map(e=>e.payload.stockLocationId),['LOJA-A','LOJA-A']);
  db.close();
});
