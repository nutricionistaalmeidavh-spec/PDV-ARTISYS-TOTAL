import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openLocalDatabase} from '../src/local-db.mjs';
import {createCommerceService} from '../src/commerce.mjs';
const now='2026-10-17T19:00:00.000Z';
let seq=0,key=()=> 'import-test-'+(++seq);
async function setup(){
 const db=openLocalDatabase();
 for(const name of ['0001_identity.sql','0002_commerce.sql','0003_cash_finance.sql',
 '0004_advanced_finance.sql','0005_vertical_parity.sql','0006_desktop_parity.sql',
 '0007_stock_transfers.sql','0008_transaction_reversals.sql','0009_catalog_inventory.sql',
 '0010_purchase_orders.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
 await db.prepare('INSERT INTO users(id,email_norm,display_name,password_hash,created_at) VALUES(?,?,?,?,?)')
  .bind('user','user@example.test','User','unused',now).run();
 for(const [t,b] of [['a','x'],['b','y']]){
  await db.prepare('INSERT INTO tenants(id,slug,name,created_at) VALUES(?,?,?,?)')
   .bind(t,'shop-'+t,t,now).run();
  await db.prepare('INSERT INTO branches(id,tenant_id,code,name,created_at) VALUES(?,?,?,?,?)')
   .bind(b,t,'MAIN','Principal',now).run();
 }
 const service=createCommerceService(db,{now:()=>now});
 const scalar=async(sql,...args)=>(await db.prepare(sql).bind(...args).first()).n;
 return {db,service,scalar,close:()=>db.close()};
}
test('P2 import CSV preview parses quotes, validates rows, reports duplicates and never writes products',async()=>{
 const x=await setup();try{
  const csv='\uFEFFsku;name;salePriceCents;unit;barcode;brand;trackStock\n'+
    'CSV-100;"Queijo; Azul";1500;UN;7890001234567;Marca A;true\n'+
    'CSV-100;Duplicado;2300;UN;7890001234568;Marca B;true\n'+
    'BAD;F;not-a-number;XX;;;\n';
  const result=await x.service.previewCatalogImport('a','x',{csv});
  assert.equal(result.totalRows,3);
  assert.equal(result.validRows,0,'duplicate rows must both be marked invalid');
  assert.equal(result.invalidRows,3);
  assert.match(result.rows[0].name,/Queijo; Azul/);
  assert.match(result.rows[1].errors.join(' '),/SKU|duplicado/i);
  assert.match(result.rows[2].errors.join(' '),/preço|unidade|nome/i);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM products'),0);
 }finally{x.close();}
});
test('P2 CSV commit is all-or-nothing, idempotent and retains existing tenant product identity',async()=>{
 const x=await setup();try{
  const csv='sku;name;salePriceCents;unit;barcode;brand;trackStock\n'+
    'IMPORT-A;"Suco, cítrico";650;UN;7890000000001;Acme;true\n'+
    'IMPORT-B;Gelo triturado;120;KG;7890000000002;Acme;true\n';
  const preview=await x.service.previewCatalogImport('a','x',{csv});
  assert.equal(preview.validRows,2);
  const transactionKey=key();
  const committed=await x.service.commitCatalogImport('a','x','user',{csv},transactionKey);
  assert.equal(committed.createdCount,2);
  assert.deepEqual(await x.service.commitCatalogImport('a','x','user',{csv},transactionKey),committed);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM products WHERE tenant_id=?','a'),2);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM products WHERE tenant_id=? AND barcode IS NOT NULL','a'),2);
  const rows=await x.service.products('a','x',{});
  assert.equal(rows.find(r=>r.sku==='IMPORT-A').name,'Suco, cítrico');
  await assert.rejects(x.service.commitCatalogImport('a','x','user',{csv},key()),e=>e.status===409);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM products WHERE tenant_id=?','a'),2);
 }finally{x.close();}
});
test('P2 CSV import detects changes after preview and preserves all rows on collision',async()=>{
 const x=await setup();try{
  const csv='sku;name;salePriceCents\nCSV-1;Primeiro produto;700\nCSV-2;Segundo produto;900\n';
  assert.equal((await x.service.previewCatalogImport('a','x',{csv})).validRows,2);
  await x.service.createProduct('a','user',{sku:'CSV-2',name:'Already sold',salePriceCents:500},key());
  await assert.rejects(x.service.commitCatalogImport('a','x','user',{csv},key()),e=>e.status===409);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM products WHERE tenant_id=?','a'),1);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM products WHERE tenant_id=? AND sku=?','a','CSV-1'),0);
 }finally{x.close();}
});
test('P2 CSV importer uses tenant scoped categories and same code cannot select other tenant category',async()=>{
 const x=await setup();try{
  const category=await x.service.createCategory('a','x','user',{name:'Bebidas'},key());
  const csv='sku;name;salePriceCents;categoryId\nCSV-X;Coca Cola;700;'+category.id+'\n';
  assert.equal((await x.service.previewCatalogImport('a','x',{csv})).validRows,1);
  assert.equal((await x.service.previewCatalogImport('b','y',{csv})).invalidRows,1);
  await assert.rejects(x.service.commitCatalogImport('b','y','user',{csv},key()),e=>e.status===409);
  const yes=await x.service.commitCatalogImport('a','x','user',{csv},key());
  assert.equal(yes.createdCount,1);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM products WHERE tenant_id=?','b'),0);
 }finally{x.close();}
});
