'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

test('parent product variants work as a Core capability without any retail module',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-parent-variants-'));
  let seq=0;
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:p=>`${p}-${++seq}`});
  try{
    runtime.catalog.createUser({id:'admin',username:'admin-variant',name:'Admin',profileId:'profile-administrator',password:'senha-forte-123'});
    runtime.catalog.upsertProduct({id:'tang',name:'Tang',salePriceCents:399,costCents:150,trackStock:false});
    runtime.catalogCustomization.upsertVariant({id:'tang-uva',productId:'tang',name:'Uva',sku:'TANG-UVA',barcode:'789100000101',priceDeltaCents:0,costCents:150,attributes:{Sabor:'Uva'}});
    runtime.retail.setProductVariantStock('tang-uva',8);
    assert.equal(runtime.retail.getProductVariantStock('tang-uva').quantity,8);
    assert.equal(runtime.retail.listProductVariants({productId:'tang'})[0].name,'Uva');

    const sale=runtime.sales.openSale({id:'sale-variant',saleNumber:'PV1',terminalId:'PDV-01',operatorId:'admin'});
    const updated=runtime.retail.addProductVariantToSale(sale.id,{variantId:'tang-uva',quantity:2});
    const line=updated.items.find(item=>item.configuration?.productVariant?.id==='tang-uva');
    assert.ok(line);
    assert.equal(line.configuration.variant.name,'Uva');
    assert.equal(line.unitPriceCents,399);

    runtime.retail.applySaleEvent({eventId:'variant-sale',occurredAt:'2026-09-12T15:00:00.000Z',payload:{items:updated.items}},'sale');
    assert.equal(runtime.retail.getProductVariantStock('tang-uva').quantity,6);
    runtime.db.prepare("UPDATE product_variants SET active=0 WHERE id='tang-uva'").run();
    runtime.retail.applyReturnEvent({eventId:'variant-return',occurredAt:'2026-09-12T15:00:30.000Z',payload:{items:[{...line,quantity:1}]}},'return');
    assert.equal(runtime.retail.getProductVariantStock('tang-uva',{includeInactive:true}).quantity,7);
    runtime.retail.applyReturnEvent({eventId:'variant-return-cancel',occurredAt:'2026-09-12T15:00:40.000Z',payload:{items:[{...line,quantity:1}]}},'cancel');
    assert.equal(runtime.retail.getProductVariantStock('tang-uva',{includeInactive:true}).quantity,6);
    runtime.retail.applySaleEvent({eventId:'variant-cancel',occurredAt:'2026-09-12T15:01:00.000Z',payload:{items:updated.items}},'cancel');
    assert.equal(runtime.retail.getProductVariantStock('tang-uva',{includeInactive:true}).quantity,8);
  }finally{runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('sale completion rechecks variant stock after the item entered the cart',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-parent-variant-stock-gate-'));
  let seq=0;
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:p=>`${p}-${++seq}`});
  try{
    runtime.catalog.createUser({id:'admin',username:'admin-stock',name:'Admin',profileId:'profile-administrator',password:'senha-forte-123'});
    runtime.catalog.upsertProduct({id:'drink',name:'Bebida',salePriceCents:500,costCents:200,trackStock:false});
    runtime.catalogCustomization.upsertVariant({id:'drink-lemon',productId:'drink',name:'Limão',priceDeltaCents:0,costCents:200});
    runtime.retail.setProductVariantStock('drink-lemon',2);
    runtime.sales.openSale({id:'sale-stock',saleNumber:'PV2',terminalId:'PDV-01',operatorId:'admin'});
    runtime.retail.addProductVariantToSale('sale-stock',{variantId:'drink-lemon',quantity:2});
    runtime.retail.setProductVariantStock('drink-lemon',1);
    assert.throws(()=>runtime.sales.completeSale('sale-stock',{payments:[{method:'CASH',amountCents:1000}]}),/Estoque insuficiente/);
  }finally{runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('generic parent variant API prepares parent and exposes stock-aware children',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pdv-parent-variants-api-'));
  let seq=0;
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite'),idFactory:p=>`${p}-${++seq}`});
  runtime.catalog.upsertProduct({id:'coca',name:'Coca-Cola',salePriceCents:500,costCents:250,trackStock:true});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'install'});
  try{
    const address=await server.start();
    const req=async(method,url,body)=>{
      const response=await fetch(`http://127.0.0.1:${address.port}${url}`,{method,headers:{'content-type':'application/json','x-pdv-token':'install'},body:body==null?undefined:JSON.stringify(body)});
      const payload=await response.json();
      return{status:response.status,body:payload};
    };
    let response=await req('POST','/api/v1/product-variants',{productId:'coca',name:'2 L',sku:'COCA-2L',barcode:'789100000202',salePriceCents:1099,costCents:620,attributes:{Volume:'2 L'}});
    assert.equal(response.status,201);
    assert.equal(runtime.catalog.getProduct('coca').trackStock,false);
    const variantId=response.body.variantId;
    response=await req('PUT',`/api/v1/product-variants/${encodeURIComponent(variantId)}/stock`,{quantity:12});
    assert.equal(response.status,200);
    assert.equal(response.body.quantity,12);
    response=await req('GET','/api/v1/product-variants?productId=coca');
    assert.equal(response.status,200);
    assert.equal(response.body.length,1);
    assert.equal(response.body[0].unitPriceCents,1099);
  }finally{await server.stop();runtime.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('desktop loads parent/subitem extension without replacing the canonical renderer',()=>{
  const root=path.join(__dirname,'..');
  const html=fs.readFileSync(path.join(root,'desktop/renderer/index.html'),'utf8');
  const script=fs.readFileSync(path.join(root,'desktop/renderer/product-variants-ui.js'),'utf8');
  assert.match(html,/product-variants\.css/);
  assert.match(html,/product-variants-ui\.js/);
  assert.match(script,/Produto pai/);
  assert.match(script,/Nova varia[cç][aã]o/i);
  assert.match(script,/productVariant/);
  assert.match(script,/product-search/);
});
