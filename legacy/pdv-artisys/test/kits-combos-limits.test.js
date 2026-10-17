'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runReleaseMigrations}=require('../js/core/database/release-migrations');
const {runVerticalMigrations}=require('../js/core/database/vertical-migrations');
const {runKitComboMigrations}=require('../js/core/database/kit-combo-migrations');
const {createCatalogService}=require('../js/domains/catalog/catalog-service');
const {createRecipeService}=require('../js/domains/inventory/recipe-service');
const {createKitComboService}=require('../js/domains/catalog/kit-combo-service');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

test('maxApplicationsPerSale is global across all participating products',()=>{
  const db=openDatabase(':memory:');runMigrations(db);runReleaseMigrations(db);runVerticalMigrations(db);runKitComboMigrations(db);
  let seq=0;const idFactory=p=>`${p}-${++seq}`;const now=()=> '2026-09-12T12:00:00.000Z';
  const catalog=createCatalogService({db,now,idFactory});const recipes=createRecipeService({db,now,idFactory});const service=createKitComboService({db,catalog,recipes,now,idFactory});
  catalog.upsertProduct({id:'a',name:'A',salePriceCents:500,trackStock:true});
  catalog.upsertProduct({id:'b',name:'B',salePriceCents:500,trackStock:true});
  service.upsertPromotionalCombo({id:'limit-one',name:'2 por 8',selectionMode:'SAME_PRODUCT',requiredQuantity:2,bundlePriceCents:800,maxApplicationsPerSale:1,productIds:['a','b']});
  const promo=service.resolvePromotions([{productId:'a',quantity:2,unitPriceCents:500},{productId:'b',quantity:2,unitPriceCents:500}]);
  assert.equal(promo.discountCents,200);
  assert.equal(promo.applied[0].applications,1);
  db.close();
});

test('kit cannot contain another kit even when nested kit is inactive',()=>{
  const db=openDatabase(':memory:');runMigrations(db);runReleaseMigrations(db);runVerticalMigrations(db);runKitComboMigrations(db);
  let seq=0;const idFactory=p=>`${p}-${++seq}`;const now=()=> '2026-09-12T12:00:00.000Z';
  const catalog=createCatalogService({db,now,idFactory});const recipes=createRecipeService({db,now,idFactory});const service=createKitComboService({db,catalog,recipes,now,idFactory});
  catalog.upsertProduct({id:'base',name:'Base',salePriceCents:100,trackStock:true});
  service.upsertKit({id:'kit-a',name:'Kit A',salePriceCents:150,components:[{productId:'base',quantity:1}],active:false});
  assert.throws(()=>service.upsertKit({id:'kit-b',name:'Kit B',salePriceCents:200,components:[{productId:'kit-a',quantity:1}]}),/Kit dentro de kit nao e suportado/);
  db.close();
});

test('exclusive combo activation clears an earlier manual discount safely',()=>{
  let seq=0;const rt=createPdvRuntime({idFactory:p=>`${p}-${++seq}`,now:()=> '2026-09-12T12:00:00.000Z'});
  rt.catalog.createUser({id:'u1',username:'caixa',name:'Caixa',profileId:'profile-cashier',password:'senha-forte-123'});
  rt.catalog.upsertProduct({id:'p',name:'Produto',salePriceCents:399,trackStock:false});
  rt.kitsCombos.upsertPromotionalCombo({id:'exclusive',name:'3 por 10',selectionMode:'SAME_PRODUCT',requiredQuantity:3,bundlePriceCents:1000,allowManualDiscount:false,productIds:['p']});
  rt.sales.openSale({id:'s1',saleNumber:'1',terminalId:'T1',operatorId:'u1'});
  rt.sales.addItem('s1',{productId:'p',quantity:2});
  let sale=rt.sales.applyDiscount('s1',{discountCents:100});
  assert.equal(sale.manualDiscountCents,100);
  sale=rt.sales.addItem('s1',{productId:'p',quantity:1});
  assert.equal(sale.manualDiscountCents,0);
  assert.equal(sale.promotionDiscountCents,197);
  assert.equal(sale.totalCents,1000);
  assert.throws(()=>rt.sales.applyDiscount('s1',{discountCents:1}),/nao permite desconto manual/i);
  rt.close();
});
