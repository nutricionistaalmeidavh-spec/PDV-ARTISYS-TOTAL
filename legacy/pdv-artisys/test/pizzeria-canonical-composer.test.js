'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {expandStockItems}=require('../js/domains/inventory/item-stock-expander');
const {VERTICAL_SCHEMA_VERSION}=require('../js/core/database/vertical-migrations');
const {PIZZERIA_CANONICAL_SCHEMA_VERSION,runPizzeriaCanonicalMigrations}=require('../js/core/database/pizzeria-canonical-migrations');
const {openDatabase}=require('../js/core/database/sqlite-database');
const composer=require('../shared/order-composer');

const admin={userId:'admin-pizza',profileId:'profile-administrator',terminalId:'PDV-01'};
function ids(){let n=0;return prefix=>`${prefix}-${++n}`;}
function runtime(){return createPdvRuntime({dbPath:':memory:',idFactory:ids()});}

function seed(rt){
  rt.modules.setEnabled('FOOD',true,{kind:'system',id:'system'});
  rt.catalog.createUser({id:'admin-pizza',username:'admin-pizza',name:'Admin Pizza',profileId:'profile-administrator',password:'Pizza-123456!'},admin);
  const products=[
    ['pizza','Pizza da Casa',3000,false,'UN'],['pizza-cal-recipe','Cobertura Calabresa',0,false,'UN'],
    ['pizza-mar-recipe','Cobertura Marguerita',0,false,'UN'],['pizza-crust-recipe','Borda Catupiry',0,false,'UN'],
    ['dough','Massa',0,true,'UN'],['sauce','Molho de tomate',0,true,'LT'],['mozz','Mussarela',0,true,'KG'],
    ['cal','Calabresa',0,true,'KG'],['onion','Cebola',0,true,'KG'],['oregano','Orégano',0,true,'KG'],
    ['tomato','Tomate',0,true,'KG'],['catupiry','Catupiry',0,true,'KG']
  ];
  for(const [id,name,salePriceCents,trackStock,unit] of products)rt.catalog.upsertProduct({id,name,salePriceCents,trackStock,unit,menuEnabled:id==='pizza',active:true},admin);

  rt.recipes.setRecipe('pizza',{yieldQuantity:1,portionQuantity:1,components:[
    {productId:'dough',quantity:1,unit:'UN'},{productId:'sauce',quantity:0.2,unit:'LT'}
  ]},admin);
  rt.recipes.setRecipe('pizza-cal-recipe',{yieldQuantity:1,portionQuantity:1,components:[
    {productId:'mozz',quantity:0.2,unit:'KG'},{productId:'cal',quantity:0.15,unit:'KG'},
    {productId:'onion',quantity:0.05,unit:'KG'},{productId:'oregano',quantity:0.01,unit:'KG'}
  ]},admin);
  rt.recipes.setRecipe('pizza-mar-recipe',{yieldQuantity:1,portionQuantity:1,components:[
    {productId:'mozz',quantity:0.2,unit:'KG'},{productId:'tomato',quantity:0.12,unit:'KG'},
    {productId:'oregano',quantity:0.01,unit:'KG'}
  ]},admin);
  rt.recipes.setRecipe('pizza-crust-recipe',{yieldQuantity:1,portionQuantity:1,components:[
    {productId:'catupiry',quantity:0.1,unit:'KG'}
  ]},admin);

  rt.pizzeria.upsertProfile({productId:'pizza',pricingPolicy:'HIGHEST_FLAVOR'},admin);
  rt.pizzeria.upsertSize({id:'large',productId:'pizza',name:'Grande',maxFlavors:2,priceDeltaCents:500,consumptionMultiplier:1.5},admin);
  rt.pizzeria.upsertFlavor({id:'calabresa',productId:'pizza',name:'Calabresa',priceDeltaCents:400,recipeProductId:'pizza-cal-recipe'},admin);
  rt.pizzeria.upsertFlavor({id:'marguerita',productId:'pizza',name:'Marguerita',priceDeltaCents:200,recipeProductId:'pizza-mar-recipe'},admin);
  rt.pizzeria.upsertCrust({id:'catupiry-crust',productId:'pizza',name:'Catupiry',priceDeltaCents:600,recipeProductId:'pizza-crust-recipe'},admin);
}

test('pizza schema keeps canonical recipe links and size consumption multiplier',()=>{
  const rt=runtime();try{
    assert.equal(VERTICAL_SCHEMA_VERSION,8);
    assert.equal(PIZZERIA_CANONICAL_SCHEMA_VERSION,33);
    const sizeColumns=new Set(rt.db.prepare('PRAGMA table_info(pizza_sizes)').all().map(row=>row.name));
    const flavorColumns=new Set(rt.db.prepare('PRAGMA table_info(pizza_flavors)').all().map(row=>row.name));
    const crustColumns=new Set(rt.db.prepare('PRAGMA table_info(pizza_crusts)').all().map(row=>row.name));
    assert.equal(sizeColumns.has('consumption_multiplier'),true);
    assert.equal(flavorColumns.has('recipe_product_id'),true);
    assert.equal(crustColumns.has('recipe_product_id'),true);
  }finally{rt.close();}
});

test('canonical pizza pricing snapshots identity, price and proportional stock consumption',()=>{
  const rt=runtime();try{
    seed(rt);
    const priced=rt.pizzeria.pricePizza({productId:'pizza',sizeId:'large',flavorIds:['calabresa','marguerita'],crustId:'catupiry-crust'});
    assert.equal(priced.unitPriceCents,4500);
    assert.equal(priced.configurationSnapshot.pizza.size.name,'Grande');
    assert.deepEqual(priced.configurationSnapshot.pizza.flavors.map(row=>({name:row.name,fraction:row.fraction})),[
      {name:'Calabresa',fraction:0.5},{name:'Marguerita',fraction:0.5}
    ]);
    assert.equal(priced.configurationSnapshot.pizza.crust.name,'Catupiry');
    const stock=new Map(priced.configurationSnapshot.stockItems.map(row=>[row.productId,row.quantity]));
    assert.equal(stock.get('dough'),1.5);
    assert.equal(stock.get('sauce'),0.3);
    assert.equal(stock.get('cal'),0.112);
    assert.equal(stock.get('tomato'),0.09);
    assert.equal(stock.get('catupiry'),0.15);
    assert.equal(stock.get('mozz'),0.3);
  }finally{rt.close();}
});

test('inventory expands immutable configured stock snapshot proportionally to sold quantity',()=>{
  const expanded=expandStockItems([{productId:'pizza',quantity:2,configuration:{stockItems:[
    {productId:'dough',quantity:1.5},{productId:'cal',quantity:0.1125}
  ]}}],null);
  assert.deepEqual(expanded,[{productId:'cal',quantity:0.225},{productId:'dough',quantity:3}]);
});

test('shared cart preserves canonical pizza selection without trusting a client price snapshot',()=>{
  const cart=composer.createCart({idFactory:()=> 'line-1'});
  cart.add({productId:'pizza',name:'Pizza da Casa',unitPriceCents:4500,quantity:1,configuration:{
    pizza:{sizeId:'large',flavorIds:['calabresa','marguerita'],crustId:'catupiry-crust'},
    variantId:null,selections:[],comboSelections:[]
  }});
  assert.deepEqual(cart.toOrderItems(),[{
    productId:'pizza',quantity:1,variantId:null,selections:[],comboSelections:[],
    pizza:{sizeId:'large',flavorIds:['calabresa','marguerita'],crustId:'catupiry-crust'},note:''
  }]);
  assert.match(composer.configurationSummary({
    pizza:{size:{name:'Grande'},flavors:[{name:'Calabresa',fraction:0.5},{name:'Marguerita',fraction:0.5}],crust:{name:'Catupiry'}}
  }),/Grande.*½ Calabresa.*½ Marguerita.*Borda Catupiry/);
});


test('pizza composers keep size-specific flavor limits and customer draft price aligned with canonical policy',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const desktop=fs.readFileSync(path.join(__dirname,'../desktop/renderer/restaurant-order-composer-ui.js'),'utf8');
  const customer=fs.readFileSync(path.join(__dirname,'../server/customer-menu/app.js'),'utf8');

  assert.match(desktop,/function syncPizzaFlavorLimit\(/);
  assert.match(desktop,/data-pizza-size-max-flavors/);
  assert.match(customer,/function syncPizzaFlavorLimit\(/);
  assert.match(customer,/function pizzaDraftPrice\(/);
  assert.match(customer,/HIGHEST_FLAVOR/);
  assert.match(customer,/PROPORTIONAL_AVERAGE/);
});


test('pizza composer requires a size before adding configured pizza',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const desktop=fs.readFileSync(path.join(__dirname,'../desktop/renderer/restaurant-order-composer-ui.js'),'utf8');
  const customer=fs.readFileSync(path.join(__dirname,'../server/customer-menu/app.js'),'utf8');
  assert.match(desktop,/Escolha o tamanho da pizza/);
  assert.match(customer,/Escolha o tamanho da pizza/);
});

test('global migration upgrades an existing v32 pizza database to v33 without losing configuration',()=>{
  const db=openDatabase(':memory:');
  try{
    db.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,name TEXT NOT NULL,applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations(version,name,applied_at) VALUES(32,'pdv_public_table_ordering_v32','2026-10-01T00:00:00.000Z');
      CREATE TABLE products(id TEXT PRIMARY KEY);
      INSERT INTO products(id) VALUES('pizza'),('recipe-flavor');
      CREATE TABLE pizza_sizes(
        id TEXT PRIMARY KEY,product_id TEXT NOT NULL,name TEXT NOT NULL,max_flavors INTEGER NOT NULL DEFAULT 1,
        price_delta_cents INTEGER NOT NULL DEFAULT 0,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      CREATE TABLE pizza_flavors(
        id TEXT PRIMARY KEY,product_id TEXT NOT NULL,name TEXT NOT NULL,price_delta_cents INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      CREATE TABLE pizza_crusts(
        id TEXT PRIMARY KEY,product_id TEXT NOT NULL,name TEXT NOT NULL,price_delta_cents INTEGER NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      INSERT INTO pizza_sizes VALUES('g','pizza','Grande',2,500,1,'old','old');
      INSERT INTO pizza_flavors VALUES('cal','pizza','Calabresa',400,1,'old','old');
      INSERT INTO pizza_crusts VALUES('cat','pizza','Catupiry',600,1,'old','old');
    `);
    assert.equal(runPizzeriaCanonicalMigrations(db,()=> '2026-10-07T00:00:00.000Z'),33);
    assert.equal(db.prepare('SELECT consumption_multiplier FROM pizza_sizes WHERE id=?').get('g').consumption_multiplier,1);
    assert.equal(db.prepare('SELECT name,price_delta_cents,recipe_product_id FROM pizza_flavors WHERE id=?').get('cal').name,'Calabresa');
    assert.equal(db.prepare('SELECT name,price_delta_cents,recipe_product_id FROM pizza_crusts WHERE id=?').get('cat').name,'Catupiry');
    assert.equal(db.prepare('SELECT name FROM schema_migrations WHERE version=33').get().name,'pdv_pizzeria_canonical_composer_v33');
  }finally{db.close();}
});
