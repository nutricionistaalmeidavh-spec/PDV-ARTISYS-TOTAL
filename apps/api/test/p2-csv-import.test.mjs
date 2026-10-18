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
 '0010_purchase_orders.sql','0011_product_media.sql','0012_sale_item_notes.sql','0013_cash_terminals.sql','0014_checkout_configurations.sql','0015_seller_sales_targets.sql' ,'0017_inventory_minimum_levels.sql'])db.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
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

test('P1 assisted CSV upsert changes existing catalogue identity without recreating stock or sales snapshots',async()=>{
 const x=await setup();try{
  const old=await x.service.createProduct('a','user',{sku:'KEEP-01',name:'Sabonete antigo',salePriceCents:500,unit:'UN',barcode:'7890001112223',brand:'Marca legada',trackStock:true},key());
  await x.service.receipt('a','x','user',{productId:old.id,quantity:8,type:'opening',unitCostCents:200},key());
  const csv='sku;name;salePriceCents;barcode;brand\nKEEP-01;Sabonete novo;650;7890001112223;Marca nova\nNEW-02;Creme vegetal;430;7890001112224;Marca nova\n';
  const preview=await x.service.previewCatalogImport('a','x',{csv,mode:'upsert'});
  assert.equal(preview.invalidRows,0);
  assert.equal(preview.updateCount,1);
  assert.equal(preview.createCount,1);
  assert.equal(preview.rows[0].action,'update');
  assert.equal(preview.rows[0].productId,old.id);
  assert.equal(preview.rows[1].action,'create');
  assert.equal(typeof preview.previewToken,'string');
  const mutation=key(),result=await x.service.commitCatalogImport('a','x','user',{csv,mode:'upsert',previewToken:preview.previewToken},mutation);
  assert.equal(result.createdCount,1);
  assert.equal(result.updatedCount,1);
  assert.deepEqual(result.updatedProductIds,[old.id]);
  assert.deepEqual(await x.service.commitCatalogImport('a','x','user',{csv,mode:'upsert',previewToken:preview.previewToken},mutation),result,'retry must not apply the batch again');
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM products WHERE tenant_id=?','a'),2);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM inventory_movements WHERE tenant_id=? AND product_id=?','a',old.id),1);
  const products=await x.service.products('a','x');
  const edited=products.find(p=>p.id===old.id);
  assert.equal(edited.name,'Sabonete novo');
  assert.equal(edited.salePriceCents,650);
  assert.equal(edited.balance,8);
  assert.equal(edited.lastCostCents,200);
  assert.equal(edited.trackStock,true);
 }finally{x.close();}
});

test('P1 assisted upsert never erases unspecified stock/unit/category/barcode and rejects unsafe unit change',async()=>{
 const x=await setup();try{
  const category=await x.service.createCategory('a','x','user',{name:'Categoria atual'},key());
  const existing=await x.service.createProduct('a','user',{sku:'SAFE-01',name:'Produto velho',salePriceCents:400,unit:'KG',brand:'Marca',barcode:'7890007771000',categoryId:category.id,trackStock:false},key());
  const csv='sku;name;salePriceCents\nSAFE-01;Produto novo;555\n';
  const preview=await x.service.previewCatalogImport('a','x',{csv,mode:'upsert'});
  assert.equal(preview.validRows,1);
  await x.service.commitCatalogImport('a','x','user',{csv,mode:'upsert',previewToken:preview.previewToken},key());
  const products=await x.service.products('a','x');
  const updated=products.find(p=>p.id===existing.id);
  assert.equal(updated.unit,'KG');
  assert.equal(updated.brand,'Marca');
  assert.equal(updated.barcode,'7890007771000');
  assert.equal(updated.categoryId,category.id);
  assert.equal(updated.trackStock,false);
  const wrong='sku;name;salePriceCents;unit\nSAFE-01;Produto novo;555;UN\n';
  const invalid=await x.service.previewCatalogImport('a','x',{csv:wrong,mode:'upsert'});
  assert.equal(invalid.invalidRows,1);
  assert.match(invalid.rows[0].errors.join(' '),/unidade/i);
  await assert.rejects(x.service.commitCatalogImport('a','x','user',{csv:wrong,mode:'upsert',previewToken:invalid.previewToken},key()),e=>e.status===409);
 }finally{x.close();}
});

test('P1 upsert previews are optimistic: stale catalog modification cancels every row atomically',async()=>{
 const x=await setup();try{
  const product=await x.service.createProduct('a','user',{sku:'LOCK-01',name:'Produto inicial',salePriceCents:100},key());
  const csv='sku;name;salePriceCents\nLOCK-01;Mudança proposta;200\nNEW-LOCK;Novo item;300\n';
  const preview=await x.service.previewCatalogImport('a','x',{csv,mode:'upsert'});
  await x.service.updateProduct('a','x',product.id,{salePriceCents:125},key());
  await assert.rejects(x.service.commitCatalogImport('a','x','user',{csv,mode:'upsert',previewToken:preview.previewToken},key()),e=>e.status===409);
  assert.equal(await x.scalar('SELECT sale_price_cents AS n FROM products WHERE id=?',product.id),125);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM products WHERE tenant_id=?','a'),1);
  const refreshed=await x.service.previewCatalogImport('a','x',{csv,mode:'upsert'});
  assert.notEqual(refreshed.previewToken,preview.previewToken);
  assert.equal(refreshed.invalidRows,0);
 }finally{x.close();}
});

test('P1 assisted upsert rejects barcode collisions in whole batch and isolates same SKU between companies',async()=>{
 const x=await setup();try{
  await x.service.createProduct('a','user',{sku:'OWNER-01',name:'Owner one',salePriceCents:100,barcode:'7890000000999'},key());
  const existing=await x.service.createProduct('a','user',{sku:'OWNER-02',name:'Owner two',salePriceCents:200,barcode:'7890000000888'},key());
  const conflict='sku;name;salePriceCents;barcode\nOWNER-02;Wrong owner;999;7890000000999\nEXTRA-03;Extra;300;7890000000777\n';
  const invalid=await x.service.previewCatalogImport('a','x',{csv:conflict,mode:'upsert'});
  assert.equal(invalid.invalidRows,1);
  await assert.rejects(x.service.commitCatalogImport('a','x','user',{csv:conflict,mode:'upsert',previewToken:invalid.previewToken},key()),e=>e.status===409);
  assert.equal(await x.scalar('SELECT sale_price_cents AS n FROM products WHERE id=?',existing.id),200);
  assert.equal(await x.scalar('SELECT COUNT(*) AS n FROM products WHERE tenant_id=?','a'),2);
  const isolated=await x.service.previewCatalogImport('b','y',{csv:'sku;name;salePriceCents\nOWNER-02;Empresa B;700\n',mode:'upsert'});
  assert.equal(isolated.createCount,1);
  assert.equal(isolated.updateCount,0);
  assert.equal(isolated.rows[0].action,'create');
 }finally{x.close();}
});
