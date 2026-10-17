'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');

const admin={userId:'admin',profileId:'profile-administrator',terminalId:'PDV-01'};

test('new stock products and technical-sheet products are not added to Cardapio implicitly',()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});
  try{
    const stock=rt.catalog.upsertProduct({id:'coke',name:'Coca-Cola',salePriceCents:600,costCents:300,trackStock:true},admin);
    const ingredient=rt.catalog.upsertProduct({id:'bread',name:'Pao',salePriceCents:100,costCents:80,trackStock:true},admin);
    const prepared=rt.catalog.upsertProduct({id:'x-tudo',name:'X-Tudo',salePriceCents:2790,trackStock:false},admin);
    rt.recipes.setRecipe(prepared.id,{components:[{productId:ingredient.id,quantity:1,unit:'UN'}]},admin);
    assert.equal(stock.menuEnabled,false);
    assert.equal(prepared.menuEnabled,false);
    assert.ok(rt.recipes.getRecipe(prepared.id));
    const published=rt.catalog.upsertProduct({...stock,menuEnabled:true},admin);
    assert.equal(published.menuEnabled,true);
    assert.equal(rt.catalog.getProduct(prepared.id).menuEnabled,false);
  }finally{rt.close();}
});

test('updating stock data preserves explicit Cardapio membership unless menuEnabled is supplied',()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});
  try{
    const product=rt.catalog.upsertProduct({id:'water',name:'Agua',salePriceCents:500,trackStock:true,menuEnabled:true},admin);
    const updated=rt.catalog.upsertProduct({...product,salePriceCents:550,menuEnabled:undefined},admin);
    assert.equal(updated.menuEnabled,true);
    assert.equal(updated.salePriceCents,550);
  }finally{rt.close();}
});


test('legacy upgrade does not keep ingredients or prepared products without technical sheet in Cardapio',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-menu-source-'));
  const dbPath=path.join(dir,'pdv.sqlite');
  let rt=createPdvRuntime({dbPath});
  try{
    const bread=rt.catalog.upsertProduct({id:'bread-old',name:'Pao antigo',salePriceCents:100,costCents:60,trackStock:true},admin);
    rt.catalog.upsertProduct({id:'coke-old',name:'Coca antiga',salePriceCents:600,costCents:300,trackStock:true},admin);
    const prepared=rt.catalog.upsertProduct({id:'x-with-recipe',name:'X-Tudo com ficha',salePriceCents:2800,trackStock:false},admin);
    rt.catalog.upsertProduct({id:'x-without-recipe',name:'X-Tudo sem ficha',salePriceCents:2600,trackStock:false},admin);
    const variantParent=rt.catalog.upsertProduct({id:'shirt-old',name:'Camiseta antiga',salePriceCents:5000,trackStock:false},admin);
    rt.recipes.setRecipe(prepared.id,{components:[{productId:bread.id,quantity:1,unit:'UN'}]},admin);
    rt.catalogCustomization.upsertVariant({id:'shirt-old-m',productId:variantParent.id,name:'M',sku:'SHIRT-M',priceDeltaCents:0,costCents:1000},admin);
  }finally{rt.close();}

  const raw=new DatabaseSync(dbPath);
  try{raw.exec('ALTER TABLE products DROP COLUMN menu_enabled');}finally{raw.close();}

  rt=createPdvRuntime({dbPath});
  try{
    assert.equal(rt.catalog.getProduct('coke-old').menuEnabled,true,'direct stock item remains a valid legacy menu source');
    assert.equal(rt.catalog.getProduct('bread-old').menuEnabled,false,'ingredient referenced by a technical sheet must not become a menu item implicitly');
    assert.equal(rt.catalog.getProduct('x-with-recipe').menuEnabled,true,'prepared item with technical sheet remains selectable');
    assert.equal(rt.catalog.getProduct('x-without-recipe').menuEnabled,false,'prepared-looking legacy item without technical sheet must leave the menu');
    assert.equal(rt.catalog.getProduct('shirt-old').menuEnabled,true,'variant-backed stock parent remains selectable');
  }finally{rt.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('Cardapio reconhece destino cadastrado antes da publicacao sem alterar estoque',async()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});
  try{
    const product=rt.catalog.upsertProduct({
      id:'agua-com-gas',
      name:'Agua com gas',
      salePriceCents:400,
      costCents:200,
      trackStock:true,
      usageType:'DIRECT',
      menuEnabled:false,
      active:true
    },admin);
    rt.inventory.move({productId:product.id,type:'opening',quantityDelta:12,reason:'estoque inicial'},admin);
    rt.kitchen.configureProductRoute(product.id,{mode:'DIRECT'},admin);

    // A rota individual existe mesmo quando a listagem do Cardapio a omite.
    assert.equal(rt.kitchen.listProductRoutes().some(route=>route.productId===product.id),false);
    assert.equal(rt.kitchen.getProductRoute(product.id)?.mode,'DIRECT');

    const renderer=fs.readFileSync(path.join(__dirname,'../desktop/renderer/app.js'),'utf8');
    const implementation=renderer.match(/  async function ensureMenuProductHasDestination\(product\) \{[\s\S]*?\n  \}/);
    assert.ok(implementation,'validador do Cardapio deve existir');
    const requests=[];
    const resolveDestination=vm.runInNewContext(
      `${implementation[0]}\nensureMenuProductHasDestination`,
      {api:{request:async url=>{
        requests.push(url);
        const id=decodeURIComponent(url.split('/').pop());
        return rt.kitchen.getProductRoute(id);
      }}}
    );

    assert.equal(await resolveDestination(product),'DIRECT');
    assert.deepEqual(requests,['/api/v1/restaurant/kitchen/routing/agua-com-gas']);
    assert.equal(await resolveDestination({id:'sem-destino'}),null);

    const saved=rt.catalog.upsertProduct({...rt.catalog.getProduct(product.id),menuEnabled:true},admin);
    assert.equal(saved.menuEnabled,true);
    assert.equal(rt.catalog.getProduct(product.id).stockQuantity,12);
    assert.equal(rt.kitchen.listProductRoutes().find(route=>route.productId===product.id)?.mode,'DIRECT');
  }finally{rt.close();}
});
