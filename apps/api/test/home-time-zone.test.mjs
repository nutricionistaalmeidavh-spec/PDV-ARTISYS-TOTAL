import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createCommerceService} from '../src/commerce.mjs';
import {businessDateBounds,businessDay} from '../src/business-time.mjs';

test('business days use IANA boundaries including DST and a skipped midnight',()=>{
 assert.equal(businessDay('2026-10-21T02:59:59.999Z','America/Sao_Paulo'),'2026-10-20');
 assert.deepEqual(businessDateBounds('2026-10-20','America/Sao_Paulo'),{a:'2026-10-20T03:00:00.000Z',b:'2026-10-21T02:59:59.999Z'});
 const dst=businessDateBounds('2026-03-08','America/New_York');
 assert.equal(Date.parse(dst.b)-Date.parse(dst.a)+1,23*3600000);
 assert.deepEqual(businessDateBounds('2018-11-04','America/Sao_Paulo'),{a:'2018-11-04T03:00:00.000Z',b:'2018-11-05T01:59:59.999Z'});
 assert.throws(()=>businessDateBounds('2026-02-30','America/Sao_Paulo'));
 assert.throws(()=>businessDateBounds('2026-10-20','Invalid/Zone'));
});

async function fixture(){
 const db=openLocalDatabase();
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>x.endsWith('.sql')).sort())
  db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 let instant='2026-10-01T12:00:00.000Z';
 await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind('test','home-time-zone','Loja',instant).run();
 await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)').bind('owner','owner@example.test','Owner','not-an-auth-fixture',instant).run();
 await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind('test','owner','OWNER',instant).run();
 for(const branch of ['sao-paulo','utc']){
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind(branch,'test',branch,branch,instant).run();
  await db.prepare('INSERT INTO r4_branch_ticket_clock(tenant_id,branch_id,time_zone,updated_at) VALUES(?,?,?,?)').bind('test',branch,branch==='utc'?'UTC':'America/Sao_Paulo',instant).run();
 }
 const service=createCommerceService(db,{now:()=>instant});
 const product=await service.createProduct('test','owner',{name:'Produto de teste',sku:'HOME-TIME',salePriceCents:100,unit:'UN',trackStock:true},crypto.randomUUID());
 await service.receipt('test','sao-paulo','owner',{productId:product.id,quantity:10,unitCostCents:1000,type:'opening'},crypto.randomUUID());
 await service.openCash('test','sao-paulo','owner',{terminalId:'TEST',openingCents:0},crypto.randomUUID());
 async function sell(at,price=100){
  instant=at;
  await service.updateProduct('test','sao-paulo',product.id,{salePriceCents:price},crypto.randomUUID());
  const sale=await service.openSale('test','sao-paulo','owner',{terminalId:'TEST'},crypto.randomUUID());
  await service.addItem('test','sao-paulo',sale.id,{productId:product.id,quantity:1},crypto.randomUUID());
  await service.complete('test','sao-paulo',sale.id,'owner',{payments:[{method:'PIX',amountCents:price}]},crypto.randomUUID());
 }
 return {db,service,sell,setNow:value=>{instant=value;}};
}

test('Home uses branch local day for sales, negative-margin alerts and month totals without mixing branches',async()=>{
 const x=await fixture();try{
  await x.sell('2026-10-20T02:59:59.999Z'); // Previous local day.
  await x.sell('2026-10-20T03:00:00.000Z',200);
  await x.sell('2026-10-21T02:59:59.999Z',300);
  await x.sell('2026-10-21T03:00:00.000Z',400); // Next local day.
  x.setNow('2026-10-21T02:59:59.999Z');
  const home=await x.service.homeIndicators('test','sao-paulo');
  assert.equal(home.asOf,'2026-10-20');assert.equal(home.timeZone,'America/Sao_Paulo');
  assert.equal(home.salesCount,2);assert.equal(home.netSalesCents,500);
  assert.equal(home.monthToDateNetSalesCents,600);
  assert.equal(home.negativeMarginCount,1);
  const utc=await x.service.homeIndicators('test','utc');
  assert.equal(utc.asOf,'2026-10-21');assert.equal(utc.salesCount,0);
  await assert.rejects(x.service.homeIndicators('test','missing'),error=>error.status===404);
 }finally{x.db.close();}
});

test('Home month boundary retains late local sales and excludes the previous local month',async()=>{
 const x=await fixture();try{
  await x.sell('2026-10-01T02:59:59.999Z'); // September in São Paulo.
  await x.sell('2026-10-01T03:00:00.000Z');
  await x.sell('2026-11-01T02:59:59.999Z'); // October in São Paulo.
  x.setNow('2026-11-01T02:59:59.999Z');
  const home=await x.service.homeIndicators('test','sao-paulo');
  assert.equal(home.asOf,'2026-10-31');assert.equal(home.month,'2026-10');
  assert.equal(home.salesCount,1);assert.equal(home.monthToDateNetSalesCents,200);
 }finally{x.db.close();}
});
