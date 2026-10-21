import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createCommerceService} from '../src/commerce.mjs';
import {createVerticalService} from '../src/vertical-service.mjs';

const stamp='2026-10-20T12:00:00.000Z',key=()=>crypto.randomUUID();
async function fixture({beforeMenu=false}={}){
 const db=openLocalDatabase();
 const files=readdirSync(new URL('../migrations/',import.meta.url)).filter(file=>/^\d{4}_.*\.sql$/.test(file)).sort();
 for(const file of files.filter(file=>!beforeMenu||!file.startsWith('0038_')))
  db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'));
 await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
  .bind('owner','owner@example.test','Owner','unused',stamp).run();
 for(const [tenant,branch] of [['a','branch-a'],['b','branch-b']]){
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)').bind(tenant,'menu-'+tenant,tenant,stamp).run();
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)').bind(branch,tenant,'MAIN','Matriz',stamp).run();
  await db.prepare('INSERT INTO tenant_memberships(tenant_id,user_id,profile_key,created_at) VALUES(?,?,?,?)').bind(tenant,'owner','OWNER',stamp).run();
 }
 const service=createCommerceService(db,{now:()=>stamp}),vertical=createVerticalService(db);
 const product=(sku,body={})=>service.createProduct('a','owner',{sku,name:'Produto '+sku,salePriceCents:500,...body},key());
 const rows=()=>service.products('a','branch-a');
 const get=async(sql,...args)=>db.prepare(sql).bind(...args).first();
 const sale=()=>service.openSale('a','branch-a','owner',{},key());
 return {db,service,vertical,product,rows,get,sale,close:()=>db.close()};
}

test('menu migration preserves existing catalogues and database constraints reject invalid metadata',async()=>{
 const x=await fixture({beforeMenu:true});try{
  await x.db.prepare('INSERT INTO products(id,tenant_id,sku,name,sale_price_cents,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').bind('old','a','OLD','Existing item',500,stamp,stamp).run();
  x.db.exec(readFileSync(new URL('../migrations/0038_product_menu_usage.sql',import.meta.url),'utf8'));
  const row=await x.get('SELECT menu_enabled,usage_type FROM products WHERE id=?','old');
  assert.equal(row.menu_enabled,1);assert.equal(row.usage_type,'DIRECT');
  assert.throws(()=>x.db.exec("UPDATE products SET menu_enabled=2 WHERE id='old'"),/CHECK/);
  assert.throws(()=>x.db.exec("UPDATE products SET usage_type='INGREDIENT' WHERE id='old'"),/CHECK/);
  x.db.exec("UPDATE products SET menu_enabled=0,usage_type='INGREDIENT' WHERE id='old'");
  assert.throws(()=>x.db.exec("UPDATE products SET menu_enabled=1 WHERE id='old'"),/CHECK/);
 }finally{x.close();}
});

test('master products stay separate from the menu and ingredients cannot opt into sales',async()=>{
 const x=await fixture();try{
  const direct=await x.product('DIRECT'),master=await x.product('MASTER',{menuEnabled:false});
  const ingredient=await x.product('INGREDIENT',{usageType:'INGREDIENT',menuEnabled:true});
  assert.equal(direct.menuEnabled,true);assert.equal(direct.usageType,'DIRECT');
  assert.equal(master.menuEnabled,false);assert.equal(ingredient.menuEnabled,false);
  const rows=await x.rows();assert.equal(rows.length,3,'master inventory retains every product');
  assert.equal(rows.find(p=>p.id===ingredient.id).usageType,'INGREDIENT');
  assert.equal(rows.filter(p=>p.menuEnabled).length,1);
  const saved=await x.service.updateProduct('a','branch-a',master.id,{menuEnabled:true,usageType:'BOTH'},key());
  assert.equal(saved.menuEnabled,true);assert.equal(saved.usageType,'BOTH');
  const removed=await x.service.updateProduct('a','branch-a',master.id,{usageType:'INGREDIENT'},key());
  assert.equal(removed.menuEnabled,false);
 }finally{x.close();}
});

test('product metadata validates booleans/enums, is tenant-scoped, and remains idempotent',async()=>{
 const x=await fixture();try{
  for(const body of [{menuEnabled:'false'},{menuEnabled:0},{usageType:'ingredient'},{usageType:null}])
   await assert.rejects(x.product('BAD-'+key().slice(0,8),body),error=>error.status===400);
  const p=await x.product('VALID');
  for(const body of [{menuEnabled:'true'},{usageType:'INVALID'}])
   await assert.rejects(x.service.updateProduct('a','branch-a',p.id,body,key()),error=>error.status===400);
  await assert.rejects(x.service.updateProduct('b','branch-b',p.id,{menuEnabled:false},key()),error=>error.status===404);
  const mutation=key(),saved=await x.service.updateProduct('a','branch-a',p.id,{menuEnabled:false},mutation);
  assert.deepEqual(await x.service.updateProduct('a','branch-a',p.id,{menuEnabled:false},mutation),saved);
 }finally{x.close();}
});

test('direct, configured, weighted, restaurant and wholesale additions reject non-menu products',async()=>{
 const x=await fixture();try{
  const sale=await x.sale(),customer=await x.vertical.upsertContact('a','branch-a','customers',{name:'Cliente'},key());
  for(const body of [{menuEnabled:false},{usageType:'INGREDIENT',menuEnabled:true}]){
   const p=await x.product('HIDDEN-'+key().slice(0,8),{...body,unit:'KG'});
   const rejects=error=>error.status===409&&/Cardápio/.test(error.message);
   await assert.rejects(x.service.addItem('a','branch-a',sale.id,{productId:p.id,quantity:1},key()),rejects);
   await assert.rejects(x.service.addConfiguredItem('a','branch-a',sale.id,{productId:p.id,quantity:1},key()),rejects);
   await assert.rejects(x.service.addWeightedItem('a','branch-a',sale.id,{productId:p.id,grams:100},key()),rejects);
   await assert.rejects(x.vertical.createFoodOrder('a','branch-a','owner',{fulfillment:'COUNTER',items:[{productId:p.id,quantity:1}]},key()),rejects);
   await assert.rejects(x.vertical.wholesaleQuote('a','branch-a','owner',{customerId:customer.id,items:[{productId:p.id,quantity:1}]},key()),rejects);
  }
  assert.equal((await x.get('SELECT COUNT(*) AS n FROM sale_items')).n,0);
  assert.equal((await x.get('SELECT COUNT(*) AS n FROM restaurant_orders')).n,0);
  assert.equal((await x.get('SELECT COUNT(*) AS n FROM wholesale_orders')).n,0);
 }finally{x.close();}
});

test('removing from menu preserves existing sale completion and ingredient inventory operations',async()=>{
 const x=await fixture();try{
  const p=await x.product('OPEN-SALE',{trackStock:false}),sale=await x.sale();
  await x.service.addItem('a','branch-a',sale.id,{productId:p.id,quantity:1},key());
  await x.service.updateProduct('a','branch-a',p.id,{menuEnabled:false},key());
  await x.service.openCash('a','branch-a','owner',{openingCents:0},key());
  const result=await x.service.complete('a','branch-a',sale.id,'owner',{payments:[{method:'PIX',amountCents:500}]},key());
  assert.equal(result.status,'COMPLETED');
  const ingredient=await x.product('RAW',{usageType:'INGREDIENT'});
  await x.service.receipt('a','branch-a','owner',{productId:ingredient.id,quantity:2,type:'opening'},key());
  assert.equal((await x.rows()).find(row=>row.id===ingredient.id).balance,2);
 }finally{x.close();}
});

test('menu and usage changes invalidate editor CAS and import previews even at the same timestamp',async()=>{
 const x=await fixture();try{
  const p=await x.product('CAS'),snapshot=(await x.rows()).find(row=>row.id===p.id);
  const csv='sku;name;salePriceCents\nCAS;Imported;600\n';
  const preview=await x.service.previewCatalogImport('a','branch-a',{csv,mode:'upsert'});
  await x.service.updateProduct('a','branch-a',p.id,{menuEnabled:false},key());
  await assert.rejects(x.service.updateProduct('a','branch-a',p.id,{name:'Stale',expectedVersion:snapshot.editVersion},key()),error=>error.status===409);
  await assert.rejects(x.service.commitCatalogImport('a','branch-a','owner',{csv,mode:'upsert',previewToken:preview.previewToken},key()),error=>error.status===409);
  const now=(await x.rows()).find(row=>row.id===p.id);
  await x.service.updateProduct('a','branch-a',p.id,{usageType:'INGREDIENT'},key());
  await assert.rejects(x.service.updateProduct('a','branch-a',p.id,{salePriceCents:999,expectedVersion:now.editVersion},key()),error=>error.status===409);
 }finally{x.close();}
});

test('SQL CAS aborts stale edits when menu changes after the server read without writing an audit',async()=>{
 const x=await fixture();try{
  const p=await x.product('RACE'),snapshot=(await x.rows()).find(row=>row.id===p.id);
  let raced=false;const db={prepare:(...args)=>x.db.prepare(...args),batch:async statements=>{
   if(!raced){raced=true;await x.db.prepare('UPDATE products SET menu_enabled=0 WHERE id=?').bind(p.id).run();}
   return x.db.batch(statements);
  }};
  const service=createCommerceService(db,{now:()=>stamp}),mutation=key();
  await assert.rejects(service.updateProduct('a','branch-a',p.id,{name:'Lost edit',expectedVersion:snapshot.editVersion},mutation),error=>error.status===409);
  const row=await x.get('SELECT name,menu_enabled FROM products WHERE id=?',p.id);
  assert.equal(row.name,p.name);assert.equal(row.menu_enabled,0);
  assert.equal((await x.get('SELECT COUNT(*) AS n FROM commerce_mutations WHERE mutation_id=?',mutation)).n,0);
 }finally{x.close();}
});

test('legacy CSV create stays sellable and upsert preserves ingredient/menu metadata',async()=>{
 const x=await fixture();try{
  const p=await x.product('CSV-RAW',{usageType:'INGREDIENT'});
  const csv='sku;name;salePriceCents\nCSV-RAW;Ingrediente editado;0\nCSV-NEW;Novo produto;600\n';
  const preview=await x.service.previewCatalogImport('a','branch-a',{csv,mode:'upsert'});
  await x.service.commitCatalogImport('a','branch-a','owner',{csv,mode:'upsert',previewToken:preview.previewToken},key());
  const rows=await x.rows(),raw=rows.find(row=>row.id===p.id),created=rows.find(row=>row.sku==='CSV-NEW');
  assert.equal(raw.usageType,'INGREDIENT');assert.equal(raw.menuEnabled,false);
  assert.equal(created.usageType,'DIRECT');assert.equal(created.menuEnabled,true);
 }finally{x.close();}
});
