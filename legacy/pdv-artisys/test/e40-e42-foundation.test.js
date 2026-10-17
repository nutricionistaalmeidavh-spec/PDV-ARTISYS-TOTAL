'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const { createPdvRuntime }=require('../js/core/pdv-runtime');

function ids(){let n=0;return prefix=>`${prefix}-${++n}`;}
function actor(){return{userId:'admin-1',profileId:'profile-administrator',terminalId:'pdv-1'};}
function runtime(){return createPdvRuntime({dbPath:':memory:',idFactory:ids(),now:(()=>{let i=0;return()=>`2026-09-11T00:00:${String(i++).padStart(2,'0')}.000Z`;})()});}

function seed(rt){
  rt.catalog.createUser({id:'admin-1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'1234567890'},actor());
  rt.catalog.upsertProduct({id:'burger',name:'Burger',salePriceCents:2000,costCents:800,trackStock:false},actor());
  rt.catalog.upsertProduct({id:'cheese',name:'Queijo',salePriceCents:300,costCents:100,trackStock:true},actor());
  rt.catalog.upsertProduct({id:'bread',name:'Pao',salePriceCents:200,costCents:80,trackStock:true},actor());
  rt.inventory.move({productId:'cheese',type:'opening',quantityDelta:50,reason:'seed'},actor());
  rt.inventory.move({productId:'bread',type:'opening',quantityDelta:50,reason:'seed'},actor());
  rt.cash.openSession({id:'cash-pdv-1',terminalId:'pdv-1',operatorId:'admin-1',initialCashCents:0,actor:actor()});
}

test('E40-E47 migrations remain present while current schema advances beyond v7',()=>{
  const rt=runtime();
  const version=rt.db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get().version;
  assert.ok(version>=7);
  const migrations=rt.db.prepare('SELECT version,name FROM schema_migrations ORDER BY version').all();
  assert.ok(migrations.some(m=>m.version===6&&m.name==='pdv_modular_foundation_e40_e42'));
  assert.ok(migrations.some(m=>m.version===7&&m.name==='pdv_verticals_e43_e47'));
  const tables=new Set(rt.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  for(const name of ['catalog_option_groups','catalog_options','product_option_groups','product_variants','combo_groups','combo_group_items','product_recipes','recipe_components','pizza_profiles','pizza_sizes','pizza_flavors','pizza_crusts','delivery_orders','fast_food_orders','bakery_orders']) assert.equal(tables.has(name),true,name);
  rt.close();
});

test('E40 prices configured items deterministically and snapshots choices',()=>{
  const rt=runtime();seed(rt);
  const g=rt.catalogCustomization.upsertOptionGroup({id:'extras',name:'Adicionais',minSelections:0,maxSelections:2},actor());
  rt.catalogCustomization.upsertOption({id:'extra-cheese',groupId:g.id,name:'Queijo extra',priceDeltaCents:300},actor());
  rt.catalogCustomization.linkGroupToProduct('burger',g.id,{sortOrder:1},actor());
  const priced=rt.catalogCustomization.priceConfiguredItem({productId:'burger',selections:[{optionId:'extra-cheese'}]});
  assert.equal(priced.unitPriceCents,2300);
  assert.equal(priced.configurationSnapshot.options[0].name,'Queijo extra');
  const sale=rt.sales.openSale({id:'sale-1',saleNumber:'1',terminalId:'pdv-1',operatorId:'admin-1'},actor());
  rt.sales.addItem(sale.id,{productId:'burger',quantity:1,unitPriceCents:priced.unitPriceCents,configurationSnapshot:priced.configurationSnapshot});
  const item=rt.sales.getSale(sale.id).items[0];
  assert.equal(item.unitPriceCents,2300);
  assert.equal(item.configuration.options[0].id,'extra-cheese');
  rt.close();
});

test('E41 recipe expands completed sale into ingredient stock movements idempotently',async()=>{
  const rt=runtime();seed(rt);
  rt.recipes.setRecipe('burger',{components:[{productId:'bread',quantity:1,unit:'UN'},{productId:'cheese',quantity:2,unit:'UN'}]},actor());
  const sale=rt.sales.openSale({id:'sale-r',saleNumber:'R1',terminalId:'pdv-1',operatorId:'admin-1'},actor());
  rt.sales.addItem(sale.id,{productId:'burger',quantity:2});
  rt.sales.completeSale(sale.id,{payments:[{method:'CASH',amountCents:4000}],actor});
  await rt.dispatchPending();
  assert.equal(rt.inventory.getBalance('bread'),48);
  assert.equal(rt.inventory.getBalance('cheese'),46);
  await rt.dispatchPending();
  assert.equal(rt.inventory.getBalance('bread'),48);
  assert.equal(rt.inventory.getBalance('cheese'),46);
  rt.close();
});

test('E42 modules persist enablement, validate ids and expose capabilities',()=>{
  const rt=runtime();seed(rt);
  assert.equal(rt.modules.isEnabled('FOOD'),true);
  rt.modules.setEnabled('FOOD',false,actor());
  assert.equal(rt.modules.isEnabled('FOOD'),false);
  rt.modules.setEnabled('FOOD',true,actor());
  assert.equal(rt.modules.list().find(m=>m.id==='FOOD').enabled,true);
  for(const legacy of ['PIZZERIA','DELIVERY','FAST_FOOD','MARKET_BAKERY','RETAIL','SELF_SERVICE'])assert.throws(()=>rt.modules.isEnabled(legacy),/Modulo desconhecido/);
  assert.throws(()=>rt.modules.setEnabled('UNKNOWN',true,actor()),/Modulo desconhecido/);
  assert.ok(rt.db.prepare("SELECT 1 FROM audit_log WHERE action='module.toggle' AND entity_id='FOOD'").get());
  rt.close();
});

test('E42 direct module settings enforce boolean type and admin permission',()=>{
  const rt=runtime();seed(rt);const admin=actor();
  assert.throws(()=>rt.settings.set('modules.PIZZERIA.enabled',true,{scope:'global',actor:admin}),/desconhecido/i);
  assert.throws(()=>rt.settings.set('modules.FOOD.enabled','true',{scope:'global',actor:admin}),/booleano/i);
  assert.throws(()=>rt.settings.set('modules.FOOD.enabled',false,{scope:'global',actor:{userId:'cashier',profileId:'profile-cashier'}}),/Permissao insuficiente/);
  assert.throws(()=>rt.settings.set('modules.FOOD.enabled',false,{scope:'global',actor:{userId:'manager',profileId:'profile-manager'}}),/Permissao insuficiente/);
  rt.settings.set('modules.WHOLESALE.enabled',true,{scope:'global',actor:admin});
  assert.deepEqual(rt.modules.list().map(module=>module.id),['FOOD','WHOLESALE']);
  rt.settings.set('modules.WHOLESALE.enabled',false,{scope:'global',actor:admin});
  assert.throws(()=>rt.settings.set('modules.SERVICES.enabled',true,{scope:'global',actor:admin}),/desconhecido/i);
  const audit=rt.db.prepare("SELECT action FROM audit_log WHERE entity_id='WHOLESALE' ORDER BY created_at DESC LIMIT 1").get();
  assert.equal(audit.action,'module.toggle');
  rt.close();
});
