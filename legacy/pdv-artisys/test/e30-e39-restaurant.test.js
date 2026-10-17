'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

function fixture({persistent=false}={}){
  let seq=0;const now=()=>new Date(Date.UTC(2026,8,10,18,0,seq++)).toISOString();const idFactory=prefix=>`${prefix}-${++seq}`;
  const dir=persistent?fs.mkdtempSync(path.join(os.tmpdir(),'pdv-restaurant-')):null;
  const runtime=createPdvRuntime({dbPath:dir?path.join(dir,'pdv.sqlite'):':memory:',now,idFactory,appVersion:'1.1.0',serverVersion:'1.1.0'});
  const user=runtime.catalog.createUser({id:'u1',username:'operador',name:'Operador',profileId:'profile-cashier',password:'senha-forte-123'});
  const product=runtime.catalog.upsertProduct({id:'p1',name:'Prato executivo',sku:'PRATO1',salePriceCents:2590,costCents:1000,trackStock:false,menuEnabled:true});
  const table=runtime.restaurant.upsertTable({id:'t1',label:'Mesa 1',seats:4});
  const station=runtime.kitchen.upsertStation({id:'k1',name:'Cozinha',printEnabled:true});
  runtime.kitchen.assignProduct(product.id,station.id);
  return{runtime,user,product,table,station,dir,close(){runtime.close();if(dir)fs.rmSync(dir,{recursive:true,force:true});}};
}

test('E30-E39: migration, comanda, KDS, prebill, checkout and sale close form one durable flow',async()=>{
  const ctx=fixture();const {runtime,user,table}=ctx;
  try{
    const currentSchema=runtime.db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get().v;
    assert.ok(currentSchema>=5);
    assert.ok(runtime.db.prepare("SELECT 1 FROM schema_migrations WHERE version=5 AND name='pdv_restaurant_e30_e34'").get());
    for(const name of ['restaurant_tables','table_sessions','restaurant_orders','kitchen_stations','kitchen_tickets','mobile_devices'])assert.equal(Boolean(runtime.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)),true,name);
    const session=runtime.restaurant.openTable(table.id,{operatorId:user.id,actor:{userId:user.id,profileId:'profile-cashier'}});
    const order=runtime.restaurant.addOrder(session.id,{items:[{productId:'p1',quantity:2,note:'sem cebola'}],source:'DESKTOP',actor:{userId:user.id,profileId:'profile-cashier'}});
    assert.equal(order.totalCents,5180);
    const dispatch=await runtime.dispatchPending();assert.equal(dispatch.failures.length,0,JSON.stringify(dispatch.failures));
    const tickets=runtime.kitchen.listTickets();assert.equal(tickets.length,1);assert.equal(tickets[0].items[0].productName,'Prato executivo');
    assert.equal(runtime.printing.listJobs({type:'KITCHEN_TICKET'}).length,1);
    runtime.kitchen.updateTicketStatus(tickets[0].id,'PREPARING',{userId:user.id});
    runtime.kitchen.updateTicketStatus(tickets[0].id,'READY',{userId:user.id});
    assert.equal(runtime.restaurant.getOrder(order.id).status,'READY');
    const prebill=runtime.nonFiscalPrinting.tablePreBill(runtime.restaurant.getSession(session.id));assert.equal(prebill.type,'TABLE_PREBILL');
    runtime.cash.openSession({terminalId:'PDV-01',operatorId:user.id,initialCashCents:10000,actor:{userId:user.id,profileId:'profile-cashier',terminalId:'PDV-01'}});
    const checkout=runtime.restaurant.checkoutToSale(session.id,{terminalId:'PDV-01',operatorId:user.id,actor:{userId:user.id,profileId:'profile-cashier',terminalId:'PDV-01'}},runtime.sales);
    assert.equal(checkout.sale.totalCents,5180);assert.equal(checkout.session.status,'CHECKOUT');
    runtime.sales.completeSale(checkout.sale.id,{payments:[{method:'CASH',amountCents:5180}],actor:{userId:user.id,profileId:'profile-cashier',terminalId:'PDV-01'}});
    const finalDispatch=await runtime.dispatchPending();assert.equal(finalDispatch.failures.length,0,JSON.stringify(finalDispatch.failures));
    assert.equal(runtime.restaurant.getSession(session.id).status,'CLOSED');assert.equal(runtime.restaurant.listTables()[0].status,'FREE');
    assert.equal(runtime.inventory.listMovements({productId:'p1'}).length,0,'untracked restaurant products must not create phantom stock movements');
    const report=runtime.restaurantReports.summary();assert.equal(report.ordersCount,1);assert.equal(report.grossCents,5180);assert.equal(report.topProducts[0].quantity,2);
    assert.match(runtime.restaurantReports.exportOrdersCsv(),/Prato executivo|pedido/);
  }finally{ctx.close();}
});

test('E31/E38: voiding an unpaid checkout sale reopens the same table session',async()=>{
  const ctx=fixture();const {runtime,user,table}=ctx;
  try{
    const session=runtime.restaurant.openTable(table.id,{operatorId:user.id,actor:{userId:user.id,profileId:'profile-cashier'}});
    runtime.restaurant.addOrder(session.id,{items:[{productId:'p1',quantity:1}],source:'DESKTOP',actor:{userId:user.id,profileId:'profile-cashier'}});
    let dispatch=await runtime.dispatchPending();assert.equal(dispatch.failures.length,0,JSON.stringify(dispatch.failures));
    const checkout=runtime.restaurant.checkoutToSale(session.id,{terminalId:'PDV-01',operatorId:user.id,actor:{userId:user.id,profileId:'profile-cashier',terminalId:'PDV-01'}},runtime.sales);
    assert.equal(checkout.session.status,'CHECKOUT');
    runtime.sales.cancelSale(checkout.sale.id,{reason:'Voltar para a mesa',actor:{userId:user.id,profileId:'profile-cashier',terminalId:'PDV-01'},mutationId:'void-checkout'});
    dispatch=await runtime.dispatchPending();assert.equal(dispatch.failures.length,0,JSON.stringify(dispatch.failures));
    const reopened=runtime.restaurant.getSession(session.id);assert.equal(reopened.status,'OPEN');assert.equal(reopened.checkoutSaleId,null);
    assert.equal(runtime.restaurant.listTables()[0].status,'OCCUPIED');
    assert.equal(runtime.inventory.listMovements({productId:'p1'}).length,0);
  }finally{ctx.close();}
});

test('E33-E36: mobile credentials are hashed, revocable and authorize only the local device flows',async()=>{
  const ctx=fixture({persistent:true});const {runtime,user,table}=ctx;let server;
  try{
    const waiter=runtime.mobileDevices.createDevice({id:'w1',name:'Garcom 1',deviceType:'WAITER',userId:user.id});
    const kitchen=runtime.mobileDevices.createDevice({id:'kd1',name:'KDS',deviceType:'KITCHEN'});
    const stored=runtime.db.prepare('SELECT credential_hash AS hash FROM mobile_devices WHERE id=?').get(waiter.id);assert.equal(stored.hash.includes(waiter.credential),false);
    server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'local-secret',requireTerminalAuth:false});const address=await server.start();const base=`http://${address.host}:${address.port}`;
    const mobilePage=await fetch(`${base}/mobile`);assert.equal(mobilePage.status,200);assert.match(await mobilePage.text(),/ArtiSys Restaurante/);
    assert.equal((await fetch(`${base}/api/v1/restaurant/tables`)).status,401);
    assert.equal((await fetch(`${base}/api/v1/restaurant/tables`,{headers:{'x-pdv-token':'local-secret'}})).status,200);
    const waiterHeaders={'x-device-id':waiter.id,'x-device-key':waiter.credential,'content-type':'application/json','x-mutation-id':'open-table-1'};
    const opened=await fetch(`${base}/api/v1/mobile/tables/${table.id}/open`,{method:'POST',headers:waiterHeaders,body:'{}'});assert.equal(opened.status,201);
    const kctx=await fetch(`${base}/api/v1/mobile/context`,{headers:{'x-device-id':kitchen.id,'x-device-key':kitchen.credential}});assert.equal(kctx.status,200);assert.equal(Array.isArray((await kctx.json()).tickets),true);
    runtime.mobileDevices.setStatus(waiter.id,'BLOCKED',{userId:'admin'});
    const blocked=await fetch(`${base}/api/v1/mobile/context`,{headers:waiterHeaders});assert.equal(blocked.status,401);
    const rotated=runtime.mobileDevices.rotateCredential(waiter.id,{userId:'admin'});assert.notEqual(rotated.credential,waiter.credential);assert.equal(runtime.mobileDevices.authenticate(waiter.id,waiter.credential).ok,false);assert.equal(runtime.mobileDevices.authenticate(waiter.id,rotated.credential).ok,true);
  }finally{if(server)await server.stop();ctx.close();}
});
test('E38: repeated mutation id produces one waiter table open',async()=>{
  const ctx=fixture({persistent:true});const {runtime,user,table}=ctx;let server;
  try{
    const waiter=runtime.mobileDevices.createDevice({id:'w2',name:'Garcom 2',deviceType:'WAITER',userId:user.id});
    server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'x'});const address=await server.start();const base=`http://${address.host}:${address.port}`;
    const headers={'x-device-id':waiter.id,'x-device-key':waiter.credential,'content-type':'application/json','x-mutation-id':'same-open'};
    const req=()=>fetch(`${base}/api/v1/mobile/tables/${table.id}/open`,{method:'POST',headers,body:'{}'});
    const [a,b]=await Promise.all([req(),req()]);assert.equal(a.status,201);assert.equal(b.status,201);assert.deepEqual(await a.json(),await b.json());
    assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM table_sessions WHERE table_id=? AND status='OPEN'").get(table.id).n,1);
  }finally{if(server)await server.stop();ctx.close();}
});

test('E33 canonical schema and sources no longer expose TABLET',()=>{
  const ctx=fixture();
  try{
    const {runtime}=ctx;
    const deviceSql=runtime.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='mobile_devices'").get().sql;
    const orderSql=runtime.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='restaurant_orders'").get().sql;
    assert.doesNotMatch(deviceSql,/TABLET/);
    assert.match(orderSql,/TABLE/);
    assert.doesNotMatch(orderSql,/TABLET/);
    assert.throws(()=>runtime.mobileDevices.createDevice({id:'legacy-tablet',name:'Legacy',deviceType:'TABLET'}),/Tipo de dispositivo invalido/i);
    const session=runtime.restaurant.openTable('t1',{operatorId:'u1',actor:{userId:'u1'}});
    const order=runtime.restaurant.addOrder(session.id,{items:[{productId:'p1',quantity:1}],source:'TABLE',actor:{userId:'u1'}});
    assert.equal(order.source,'TABLE');
  }finally{ctx.close();}
});
