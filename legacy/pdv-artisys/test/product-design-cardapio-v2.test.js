'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

const admin={userId:'admin',profileId:'profile-administrator',terminalId:'PDV-01'};

function runtime(){return createPdvRuntime({dbPath:':memory:'});}
function read(relative){return fs.readFileSync(path.join(__dirname,'..',relative),'utf8');}

test('pure ingredients cannot be published while direct and both items can',()=>{
  const rt=runtime();
  try{
    const ingredient=rt.catalog.upsertProduct({id:'bread',name:'Pao',costCents:100,trackStock:true,usageType:'INGREDIENT'},admin);
    assert.equal(ingredient.usageType,'INGREDIENT');
    assert.throws(()=>rt.catalog.upsertProduct({...ingredient,menuEnabled:true},admin),/Insumo puro/i);

    const direct=rt.catalog.upsertProduct({id:'coke',name:'Coca',salePriceCents:700,costCents:350,trackStock:true,usageType:'DIRECT',menuEnabled:true},admin);
    const both=rt.catalog.upsertProduct({id:'icecream',name:'Sorvete',salePriceCents:900,costCents:400,trackStock:true,usageType:'BOTH',menuEnabled:true},admin);
    assert.equal(direct.menuEnabled,true);
    assert.equal(both.menuEnabled,true);
  }finally{rt.close();}
});

test('technical sheet yield controls cost, consumption and prepared availability',()=>{
  const rt=runtime();
  try{
    const ingredient=rt.catalog.upsertProduct({id:'meat',name:'Carne',costCents:100,trackStock:true,minimumStock:2,usageType:'INGREDIENT'},admin);
    const prepared=rt.catalog.upsertProduct({id:'burger',name:'Burger',salePriceCents:1000,trackStock:false,usageType:'DIRECT'},admin);
    rt.inventory.move({productId:ingredient.id,type:'opening',quantityDelta:20,reason:'seed'},admin);

    const recipe=rt.recipes.setRecipe(prepared.id,{
      yieldQuantity:10,
      yieldUnit:'UN',
      portionQuantity:1,
      prepTimeMinutes:12,
      preparationNotes:'Montar e finalizar.',
      notes:'Manter refrigerado.',
      components:[{productId:ingredient.id,quantity:10,unit:'UN',conversionFactor:1,lossPercent:10}]
    },admin);

    assert.equal(recipe.yieldQuantity,10);
    assert.equal(recipe.portionQuantity,1);
    assert.equal(recipe.prepTimeMinutes,12);
    assert.equal(recipe.preparationNotes,'Montar e finalizar.');
    assert.equal(recipe.theoreticalCostCents,1100);
    assert.equal(recipe.costPerPortionCents,110);
    assert.equal(rt.recipes.theoreticalCostCents(prepared.id),110);

    const expanded=rt.recipes.expandItems([{productId:prepared.id,quantity:2}]);
    assert.equal(expanded.length,1);
    assert.equal(expanded[0].productId,ingredient.id);
    assert.equal(expanded[0].quantity,2.2);

    const enriched=rt.catalog.getProduct(prepared.id);
    assert.equal(enriched.prepared,true);
    assert.equal(enriched.recipeStockStatus,'OK');
    assert.equal(enriched.recipeCapacity,18);

    const columns=new Set(rt.db.prepare('PRAGMA table_info(product_recipes)').all().map(row=>row.name));
    for(const name of ['yield_quantity','yield_unit','portion_quantity','prep_time_minutes','preparation_notes','notes'])assert.equal(columns.has(name),true,name);
    assert.equal(rt.db.prepare('SELECT name FROM schema_migrations WHERE version=9').get()?.name,'pdv_hardware_confidence_e54_1');
  }finally{rt.close();}
});

test('a direct stock product becomes BOTH when it is used by a technical sheet',()=>{
  const rt=runtime();
  try{
    rt.catalog.upsertProduct({id:'milk',name:'Leite',salePriceCents:500,costCents:250,trackStock:true,usageType:'DIRECT'},admin);
    rt.catalog.upsertProduct({id:'shake',name:'Milkshake',salePriceCents:1600,trackStock:false,usageType:'DIRECT'},admin);
    rt.recipes.setRecipe('shake',{components:[{productId:'milk',quantity:0.3,unit:'LT'}]},admin);
    assert.equal(rt.catalog.getProduct('milk').usageType,'BOTH');
  }finally{rt.close();}
});


test('prepared products reject new stock variants while legacy variants remain editable',()=>{
  const rt=runtime();
  try{
    rt.catalog.upsertProduct({id:'bread-v',name:'Pao',costCents:100,trackStock:true,usageType:'INGREDIENT'},admin);
    rt.catalog.upsertProduct({id:'burger-v',name:'Burger',salePriceCents:1200,trackStock:false,usageType:'DIRECT'},admin);
    rt.recipes.setRecipe('burger-v',{components:[{productId:'bread-v',quantity:1,unit:'UN'}]},admin);
    assert.throws(()=>rt.catalogCustomization.upsertVariant({productId:'burger-v',name:'Grande',sku:'BURGER-G'},admin),/nao aceita variacao de estoque/i);
  }finally{rt.close();}
});

test('Cardapio UI exposes the corrected source model and complete technical sheet fields',()=>{
  const app=read('desktop/renderer/app.js');
  const dense=read('desktop/renderer/products-dense-view.js');
  const controller=read('desktop/renderer/products-dense-controller.js');
  const styles=read('desktop/renderer/styles.css');
  const operational=read('desktop/renderer/operational-pages.js');
  const variants=read('desktop/renderer/product-variants-ui.js');

  assert.match(app,/value="INGREDIENT"[\s\S]*>Insumo</);
  assert.match(app,/value="DIRECT"[\s\S]*>Venda direta</);
  assert.match(app,/value="BOTH"[\s\S]*>Produto e insumo</);
  assert.match(app,/\['DIRECT','BOTH'\]\.includes\(item\.product\.usageType\)/);
  assert.match(app,/name="yieldQuantity"/);
  assert.match(app,/name="portionQuantity"/);
  assert.match(app,/data-recipe-conversion/);
  assert.match(app,/data-recipe-loss/);
  assert.match(app,/name="preparationNotes"/);
  assert.match(app,/Itens disponíveis para venda, preços e categorias\./);
  assert.doesNotMatch(app,/Itens, preços, categorias e fichas técnicas\./);

  assert.match(dense,/Indisponível por insumo/);
  assert.match(dense,/Insumo baixo/);
  assert.match(dense,/Insumos OK/);
  assert.ok(dense.indexOf("if (product.prepared)") < dense.indexOf("if (product.trackStock === false)"));
  assert.match(controller,/Ficha: insumos OK/);
  assert.match(styles,/\.modal-close[^}]*width: 44px/);
  assert.match(styles,/button:focus-visible/);
  assert.match(styles,/\.menu-source-row/);
  assert.match(styles,/\[data-product-sale-only\]\[hidden\]/);
  assert.match(styles,/\.products-secondary-actions-menu/);
  assert.match(styles,/\.recipe-origin-summary[^}]*grid-template-columns:repeat\(3/);
  assert.match(app,/Mais ações/);
  assert.match(app,/Insumos usados apenas em fichas técnicas permanecem no Estoque/);
  assert.match(app,/Capacidade atual/);
  assert.match(dense,/Mais ações/);
  assert.match(dense,/Até \$\{esc\(quantityLabel\(product\.recipeCapacity/);
  assert.match(operational,/SKUs de estoque/);
  assert.match(operational,/product\.trackStock/);
  assert.match(variants,/if\(!product\?\.prepared\)/);
  assert.doesNotMatch(operational,/＋/);
  assert.doesNotMatch(variants,/＋/);
});
