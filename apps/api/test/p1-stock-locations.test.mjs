import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createCommerceService} from '../src/commerce.mjs';
let serial=0;const key=()=> 'p1-locations-'+(++serial);
const time='2026-10-17T22:00:00.000Z';
async function setup(){
 const db=openLocalDatabase();
 for(const name of readdirSync(new URL('../migrations/',import.meta.url)).filter(n=>/^\d{4}_.+\.sql$/.test(n)).sort())
   db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
   .bind('person','p@example.test','Staff','unused',time).run();
 for(const [t,b] of [['a','front'],['a','warehouse'],['b','other']]){
   if(b!=='warehouse')await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
     .bind(t,'site-'+t,t,time).run();
   await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
     .bind(b,t,b,b,time).run();
 }
 return {db,service:createCommerceService(db,{now:()=>time}),close:()=>db.close()};
}
test('P1 internal storage location is only an address; canonical stock ledger and available quantity never change',async()=>{
 const x=await setup();try{
  const p=await x.service.createProduct('a','person',{sku:'BIN-01',name:'Bolo embalado',salePriceCents:500},key());
  await x.service.receipt('a','front','person',{productId:p.id,quantity:8,type:'opening'},key());
  const k=key(),created=await x.service.createStorageLocation('a','front','person',{code:'A-01',name:'Prateleira A'},k);
  assert.equal(created.code,'A-01');
  assert.deepEqual(await x.service.createStorageLocation('a','front','person',{code:'A-01',name:'Prateleira A'},k),created);
  const assigned=await x.service.assignStorageLocation('a','front','person',
    {productId:p.id,locationId:created.id},key());
  assert.equal(assigned.locationId,created.id);
  const locations=await x.service.storageLocations('a','front');
  assert.equal(locations.length,1);
  assert.equal(locations[0].assignedProducts,1);
  const products=await x.service.products('a','front');
  assert.equal(products.find(item=>item.id===p.id).sku,'BIN-01');
  assert.deepEqual((await x.service.storageAssignments('a','front')).map(v=>v.locationCode),['A-01']);
  assert.equal((await x.db.prepare('SELECT COUNT(*) AS n FROM inventory_movements').bind().first()).n,1);
  assert.equal((await x.db.prepare('SELECT balance_milli AS n FROM stock_positions WHERE product_id=?').bind(p.id).first()).n,8000);
  assert.equal((await x.service.stock('a','front')).find(item=>item.productId===p.id).quantity,8);
 }finally{x.close();}
});
test('P1 locations reject other branch/tenant and malformed codes; clearing does not delete historical movements',async()=>{
 const x=await setup();try{
  const p=await x.service.createProduct('a','person',{sku:'BIN-02',name:'Pacote',salePriceCents:200},key());
  const l=await x.service.createStorageLocation('a','front','person',{code:'B-01',name:'Área de embalagens'},key());
  await assert.rejects(x.service.createStorageLocation('a','front','person',{code:'B-01',name:'Repetido'},key()),e=>e.status===409);
  await assert.rejects(x.service.createStorageLocation('a','front','person',{code:'../EX',name:'Invasão'},key()),e=>e.status===400);
  await assert.rejects(x.service.assignStorageLocation('a','warehouse','person',{productId:p.id,locationId:l.id},key()),e=>e.status===404);
  await assert.rejects(x.service.assignStorageLocation('b','other','person',{productId:p.id,locationId:l.id},key()),e=>e.status===404);
  await x.service.assignStorageLocation('a','front','person',{productId:p.id,locationId:l.id},key());
  const unassigned=await x.service.assignStorageLocation('a','front','person',{productId:p.id,locationId:null},key());
  assert.equal(unassigned.locationId,null);
  assert.equal((await x.service.storageAssignments('a','front')).length,0);
  assert.equal((await x.service.storageLocations('a','front'))[0].assignedProducts,0);
 }finally{x.close();}
});
