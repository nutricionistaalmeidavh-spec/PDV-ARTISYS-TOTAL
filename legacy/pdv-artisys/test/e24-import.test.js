'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {createCatalogService}=require('../js/domains/catalog/catalog-service');
const {createInventoryService}=require('../js/domains/inventory/inventory-service');
const {createImportService}=require('../js/core/import/import-service');

function fixture(){const db=openDatabase(':memory:');let seq=0;const now=()=>new Date(1789000200000+seq++*1000).toISOString();runMigrations(db,now);const idFactory=p=>`${p}-${++seq}`;const catalog=createCatalogService({db,now,idFactory});const inventory=createInventoryService({db,now,idFactory});const imports=createImportService({db,catalog,inventory,now,idFactory});return{db,catalog,inventory,imports};}

test('product CSV preview normalizes fields and commit is idempotent',()=>{const f=fixture();try{
 const csv='sku;barcode;name;unit;salePriceCents;costCents;minimumStock\n 001 ; 789 123 ; Café 500g ; un ; 1590 ; 900 ; 2\n';
 const preview=f.imports.preview({type:'products',format:'csv',content:csv,collisionPolicy:'CREATE'});
 assert.equal(preview.status,'PREVIEWED');assert.equal(preview.summary.valid,1);assert.equal(preview.rows[0].sku,'001');assert.equal(preview.rows[0].barcode,'789123');assert.equal(preview.rows[0].salePriceCents,1590);
 const first=f.imports.commit(preview.batchId,{actor:{userId:'admin',profileId:'profile-administrator'}});assert.equal(first.status,'COMMITTED');assert.equal(f.catalog.listProducts().length,1);
 const again=f.imports.commit(preview.batchId,{actor:{userId:'admin',profileId:'profile-administrator'}});assert.equal(again.status,'COMMITTED');assert.equal(f.catalog.listProducts().length,1);
}finally{f.db.close();}});

test('preview reports row errors and commit refuses invalid batch atomically',()=>{const f=fixture();try{
 const csv='sku;name;salePriceCents\nA1;Produto OK;1000\nA2;;900\n';
 const preview=f.imports.preview({type:'products',format:'csv',content:csv,collisionPolicy:'CREATE'});
 assert.equal(preview.summary.valid,1);assert.equal(preview.summary.invalid,1);assert.equal(preview.errors.length,1);
 assert.throws(()=>f.imports.commit(preview.batchId,{actor:{userId:'admin',profileId:'profile-administrator'}}),/erros|invalido/i);
 assert.equal(f.catalog.listProducts().length,0);
}finally{f.db.close();}});

test('collision policies CREATE UPDATE and SKIP are explicit',()=>{const f=fixture();try{
 f.catalog.upsertProduct({id:'existing',sku:'SKU1',name:'Antigo',salePriceCents:100});
 let p=f.imports.preview({type:'products',format:'csv',content:'sku;name;salePriceCents\nSKU1;Novo;200\n',collisionPolicy:'CREATE'});assert.equal(p.summary.invalid,1);
 p=f.imports.preview({type:'products',format:'csv',content:'sku;name;salePriceCents\nSKU1;Novo;200\n',collisionPolicy:'SKIP'});f.imports.commit(p.batchId,{actor:{userId:'admin',profileId:'profile-administrator'}});assert.equal(f.catalog.getProduct('existing').name,'Antigo');
 p=f.imports.preview({type:'products',format:'csv',content:'sku;name;salePriceCents\nSKU1;Novo;200\n',collisionPolicy:'UPDATE'});f.imports.commit(p.batchId,{actor:{userId:'admin',profileId:'profile-administrator'}});assert.equal(f.catalog.getProduct('existing').name,'Novo');assert.equal(f.catalog.getProduct('existing').salePriceCents,200);
}finally{f.db.close();}});

test('initial inventory import writes opening movements instead of direct balance updates',()=>{const f=fixture();try{
 f.catalog.upsertProduct({id:'p1',sku:'P1',name:'Produto',salePriceCents:500});
 const p=f.imports.preview({type:'inventory',format:'csv',content:'sku;quantity\nP1;12.5\n',collisionPolicy:'UPDATE'});f.imports.commit(p.batchId,{actor:{userId:'admin',profileId:'profile-administrator'}});
 assert.equal(f.inventory.getBalance('p1'),12.5);const movements=f.inventory.listMovements({productId:'p1'});assert.equal(movements.length,1);assert.equal(movements[0].type,'opening');assert.equal(movements[0].quantityDelta,12.5);
}finally{f.db.close();}});

test('customer documents are normalized and content hash deduplicates equivalent preview request',()=>{const f=fixture();try{
 const input={type:'customers',format:'csv',content:'name;document;phone\nMaria;123.456.789-00;16999999999\n',collisionPolicy:'CREATE'};
 const a=f.imports.preview(input);const b=f.imports.preview(input);assert.equal(a.batchId,b.batchId);f.imports.commit(a.batchId,{actor:{userId:'admin',profileId:'profile-administrator'}});assert.equal(f.catalog.listCustomers()[0].document,'12345678900');
}finally{f.db.close();}});
