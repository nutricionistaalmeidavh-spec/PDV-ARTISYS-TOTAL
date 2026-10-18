import test from 'node:test';
import assert from 'node:assert/strict';
import {readdirSync,readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createCommerceService} from '../src/commerce.mjs';

let serial=0;
const key=()=> 'p1-catalog-safety-'+(++serial);
const stamp='2026-10-17T20:00:00.000Z';
async function fixture(){
 const db=openLocalDatabase();
 for(const file of readdirSync(new URL('../migrations/',import.meta.url)).filter(x=>/^\\d{4}_.*\\.sql$/.test(x)).sort())
   db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
   .bind('operator','operator@example.test','Operator','unused',stamp).run();
 for(const [tenant,branch] of [['store-one','front'],['store-two','other']]){
   await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
     .bind(tenant,'slug-'+tenant,tenant,stamp).run();
   await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
     .bind(branch,tenant,'MAIN','Main',stamp).run();
 }
 return {db,service:createCommerceService(db,{now:()=>stamp}),close:()=>db.close()};
}
const get=async(db,sql,...args)=>db.prepare(sql).bind(...args).first();

test('P1 restored category rename preserves product references and rejects duplicate/cross-tenant names',async()=>{
 const x=await fixture();try{
   const a=await x.service.createCategory('store-one','front','operator',{name:'Original'},key());
   const b=await x.service.createCategory('store-one','front','operator',{name:'Other group'},key());
   const p=await x.service.createProduct('store-one','operator',{name:'Milk',sku:'MILK-01',salePriceCents:350,categoryId:a.id},key());
   const mutation=key();
   const renamed=await x.service.renameCategory('store-one','front','operator',a.id,{name:'Dairy'},mutation);
   assert.equal(renamed.id,a.id);
   assert.equal((await x.service.categories('store-one','front')).find(c=>c.id===a.id).name,'Dairy');
   assert.equal((await x.service.products('store-one','front')).find(r=>r.id===p.id).categoryId,a.id);
   assert.deepEqual(await x.service.renameCategory('store-one','front','operator',a.id,{name:'Dairy'},mutation),renamed);
   await assert.rejects(x.service.renameCategory('store-one','front','operator',a.id,{name:'Other group'},key()),e=>e.status===409);
   await assert.rejects(x.service.renameCategory('store-two','other','operator',a.id,{name:'Not mine'},key()),e=>e.status===404);
   assert.equal((await x.service.categories('store-one','front')).find(c=>c.id===b.id).name,'Other group');
 }finally{x.close();}
});

test('P1 stale product editor cannot overwrite another operator even when clock precision is identical',async()=>{
 const x=await fixture();try{
   const p=await x.service.createProduct('store-one','operator',{name:'Old label',sku:'SKU-EDIT-01',salePriceCents:900},key());
   const snapshot=(await x.service.products('store-one','front')).find(v=>v.id===p.id);
   assert.equal(typeof snapshot.editVersion,'string');
   const saved=await x.service.updateProduct('store-one','front',p.id,{name:'New label',expectedVersion:snapshot.editVersion},key());
   assert.equal(saved.name,'New label');
   await assert.rejects(
     x.service.updateProduct('store-one','front',p.id,{salePriceCents:123,expectedVersion:snapshot.editVersion},key()),
     e=>e.status===409);
   const after=await get(x.db,'SELECT name,sale_price_cents AS price FROM products WHERE id=?',p.id);
   assert.equal(after.price,900);
   assert.equal(after.name,'New label');
 }finally{x.close();}
});

test('P1 SQL CAS rejects a concurrent edit between server read and database batch without audit',async()=>{
 const x=await fixture();try{
   const item=await x.service.createProduct('store-one','operator',{name:'First entry',sku:'RACE-01',salePriceCents:250},key());
   const snapshot=(await x.service.products('store-one','front')).find(p=>p.id===item.id);
   let raced=false;
   const db={prepare:(...args)=>x.db.prepare(...args),batch:async stmts=>{
     if(!raced){
       raced=true;
       await x.db.prepare('UPDATE products SET name=? WHERE id=?').bind('Other terminal',item.id).run();
     }
     return x.db.batch(stmts);
   }};
   const service=createCommerceService(db,{now:()=>stamp}),mutation=key();
   await assert.rejects(service.updateProduct('store-one','front',item.id,
     {name:'Stale entry',expectedVersion:snapshot.editVersion},mutation),e=>e.status===409);
   assert.equal((await get(x.db,'SELECT name FROM products WHERE id=?',item.id)).name,'Other terminal');
   assert.equal((await get(x.db,'SELECT COUNT(*) AS n FROM commerce_mutations WHERE mutation_id=?',mutation)).n,0);
 }finally{x.close();}
});

test('P1 CSV upsert is all-or-nothing if another terminal changes an existing SKU mid-commit',async()=>{
 const x=await fixture();try{
   const item=await x.service.createProduct('store-one','operator',{name:'Before',sku:'BATCH-OLD',salePriceCents:450},key());
   const csv='sku;name;salePriceCents\\nBATCH-OLD;Imported name;500\\nBATCH-NEW;New product;600\\n';
   const prev=await x.service.previewCatalogImport('store-one','front',{csv,mode:'upsert'});
   assert.equal(prev.invalidRows,0);
   let raced=false;
   const db={prepare:(...args)=>x.db.prepare(...args),batch:async stmts=>{
     if(!raced){
       raced=true;
       await x.db.prepare('UPDATE products SET sale_price_cents=? WHERE id=?').bind(777,item.id).run();
     }
     return x.db.batch(stmts);
   }};
   const service=createCommerceService(db,{now:()=>stamp}),mutation=key();
   await assert.rejects(service.commitCatalogImport('store-one','front','operator',
     {csv,mode:'upsert',previewToken:prev.previewToken},mutation),e=>e.status===409);
   assert.equal((await get(x.db,'SELECT sale_price_cents AS value FROM products WHERE id=?',item.id)).value,777);
   assert.equal((await get(x.db,'SELECT COUNT(*) AS n FROM products WHERE tenant_id=?','store-one')).n,1);
   assert.equal((await get(x.db,'SELECT COUNT(*) AS n FROM commerce_mutations WHERE mutation_id=?',mutation)).n,0);
 }finally{x.close();}
});
