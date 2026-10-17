const test=require('node:test');
const assert=require('node:assert/strict');
const { openDatabase }=require('../js/core/database/sqlite-database');
const { runMigrations }=require('../js/core/database/migrations');
const {runAccessProfileMigrations}=require('../js/core/database/access-profile-migrations');
const {runCanonicalAccessMigrations}=require('../js/core/database/canonical-access-migrations');
const { SqliteOutboxStore }=require('../js/core/database/outbox-store');
const { createCatalogService }=require('../js/domains/catalog/catalog-service');
const { calculateCashClosing }=require('../js/domains/cash/cash-rules');
const { createCashService }=require('../js/domains/cash/cash-service');

function setup(){const db=openDatabase(':memory:');runMigrations(db);runAccessProfileMigrations(db);runCanonicalAccessMigrations(db);let seq=0;const ids=p=>`${p}-${++seq}`;const catalog=createCatalogService({db,now:()=> '2026-09-09T09:00:00Z',idFactory:ids});catalog.createUser({id:'u1',username:'caixa',name:'Caixa',profileId:'profile-cashier',password:'senha-forte-123'});db.prepare("INSERT INTO sales (id,sale_number,terminal_id,operator_id,status,opened_at,updated_at) VALUES ('sale-1','000001','pdv-01','u1','COMPLETED','2026-09-09T09:00:00Z','2026-09-09T09:00:00Z')").run();const outbox=new SqliteOutboxStore(db);const cash=createCashService({db,outbox,now:()=> '2026-09-09T09:00:00Z',idFactory:ids});return{db,outbox,cash};}

test('calculateCashClosing summarizes opening supplies withdrawals sales and divergence in cents',()=>{
  const result=calculateCashClosing({initialCashCents:35000,movements:[
    {type:'SUPPLY',amountCents:5000,paymentMethod:'CASH'},
    {type:'WITHDRAWAL',amountCents:2500,paymentMethod:'CASH'},
    {type:'SALE',amountCents:10000,paymentMethod:'CASH'},
    {type:'SALE',amountCents:5000,paymentMethod:'PIX'}
  ],countedByMethod:{CASH:47400,PIX:5000}});
  assert.equal(result.expectedByMethod.CASH,47500);assert.equal(result.expectedByMethod.PIX,5000);assert.equal(result.divergenceByMethod.CASH,-100);assert.equal(result.status,'divergent');
});

test('openSession enforces one open cash session per terminal and records opening event',async()=>{
  const {db,outbox,cash}=setup();const session=cash.openSession({id:'cs1',terminalId:'pdv-01',operatorId:'u1',initialCashCents:10000,actor:{userId:'u1',profileId:'profile-cashier',terminalId:'pdv-01'}});assert.equal(session.status,'OPEN');assert.equal(session.initialCashCents,10000);assert.throws(()=>cash.openSession({id:'cs2',terminalId:'pdv-01',operatorId:'u1',initialCashCents:0}),/aberto|UNIQUE/i);const events=await outbox.listPending(10);assert.equal(events[0].type,'cash-session.opened');db.close();
});

test('supply withdrawal and sale payments are immutable and sale recording is idempotent',()=>{
  const {db,cash}=setup();cash.openSession({id:'cs1',terminalId:'pdv-01',operatorId:'u1',initialCashCents:10000});cash.addSupply('cs1',{amountCents:5000,note:'Troco'});cash.withdraw('cs1',{amountCents:2000,note:'Sangria'});cash.recordSalePayments({terminalId:'pdv-01',saleId:'sale-1',payments:[{method:'CASH',amountCents:3000},{method:'PIX',amountCents:4000}]});cash.recordSalePayments({terminalId:'pdv-01',saleId:'sale-1',payments:[{method:'CASH',amountCents:3000},{method:'PIX',amountCents:4000}]});const session=cash.getOpenSession('pdv-01');assert.equal(session.movements.filter(m=>m.type==='SALE').length,2);assert.equal(session.movements.length,5);db.close();
});

test('closeSession stores expected counted divergence and cash-session.closed event',async()=>{
  const {db,outbox,cash}=setup();cash.openSession({id:'cs1',terminalId:'pdv-01',operatorId:'u1',initialCashCents:10000});cash.recordSalePayments({terminalId:'pdv-01',saleId:'sale-1',payments:[{method:'CASH',amountCents:3000},{method:'PIX',amountCents:4000}]});const closed=cash.closeSession('cs1',{countedByMethod:{CASH:13000,PIX:4000},actor:{userId:'u1',profileId:'profile-cashier',terminalId:'pdv-01'}});assert.equal(closed.status,'CLOSED');assert.equal(closed.expectedCashCents,13000);assert.equal(closed.divergenceCents,0);const events=await outbox.listPending(10);assert.deepEqual(events.map(e=>e.type),['cash-session.opened','cash-session.closed']);db.close();
});
