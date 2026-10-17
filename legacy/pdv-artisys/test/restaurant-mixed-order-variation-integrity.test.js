'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {renderTablePreBill,renderKitchenTicket}=require('../js/domains/printing/non-fiscal-renderer');

const admin={userId:'admin',profileId:'profile-administrator',terminalId:'PDV-01'};
function fixture(){
  let next=10000;
  const runtime=createPdvRuntime({dbPath:':memory:',now:()=> '2026-10-15T12:00:00.000Z',idFactory:prefix=>prefix+'-'+String(next--)});
  runtime.catalog.createUser({id:'admin',username:'admin',name:'Administrador',profileId:'profile-administrator',password:'senha-forte-123'},admin);
  runtime.modules.setEnabled('FOOD',true,admin);
  for(const [id,name,price] of [
    ['fries','Porção de fritas',0],['soda','Coca lata',200],['juice','Suco',1400],['water','Água',200]
  ]){
    runtime.catalog.upsertProduct({id,name,salePriceCents:price,menuEnabled:true,trackStock:false,usageType:'DIRECT',active:true},admin);
    runtime.kitchen.configureProductRoute(id,{mode:'DIRECT'},admin);
  }
  runtime.catalogCustomization.upsertVariant({id:'fries-small',productId:'fries',name:'150g',priceDeltaCents:1000},admin);
  runtime.catalogCustomization.upsertVariant({id:'fries-large',productId:'fries',name:'300g',priceDeltaCents:1800},admin);
  runtime.catalogCustomization.upsertVariant({id:'juice-strawberry',productId:'juice',name:'Morango',priceDeltaCents:100},admin);
  runtime.restaurant.upsertTable({id:'t1',label:'Mesa 1'},admin);
  const token=runtime.publicOrdering.issueTableAccess('t1',admin).token;
  return{runtime,token,close:()=>runtime.close()};
}

test('public multi-item QR order preserves price and variation for EACH inserted product even with inverse randomized IDs',()=>{
  const {runtime:rt,token,close}=fixture();
  try{
    const result=rt.publicOrdering.submitOrder(token,{items:[
      {productId:'fries',quantity:1,variantId:'fries-small',note:'sem queijo'},
      {productId:'soda',quantity:2},
      {productId:'juice',quantity:1,variantId:'juice-strawberry'},
      {productId:'fries',quantity:1,variantId:'fries-large'}
    ]});
    assert.equal(result.items.length,4);
    assert.equal(result.totalCents,1000+400+1500+1800);
    // An ID-based sort intentionally returns a different order from insertion.
    assert.notDeepEqual(result.items.map(x=>x.productId),['fries','soda','juice','fries']);
    const fries=result.items.filter(x=>x.productId==='fries');
    assert.deepEqual(new Set(fries.map(x=>x.unitPriceCents)),new Set([1000,1800]));
    assert.equal(fries.find(x=>x.unitPriceCents===1000).configuration.variant.name,'150g');
    assert.equal(fries.find(x=>x.unitPriceCents===1000).note,'sem queijo');
    assert.equal(fries.find(x=>x.unitPriceCents===1800).configuration.variant.name,'300g');
    const soda=result.items.find(x=>x.productId==='soda');
    assert.equal(soda.unitPriceCents,200);
    assert.equal(soda.quantity,2);
    assert.equal(soda.configuration?.variant??null,null);
    const juice=result.items.find(x=>x.productId==='juice');
    assert.equal(juice.unitPriceCents,1500);
    assert.equal(juice.configuration.variant.name,'Morango');
    const prebill=renderTablePreBill({storeName:'ArtiSys',session:rt.restaurant.currentSession('t1')});
    assert.match(prebill,/150g/);
    assert.match(prebill,/300g/);
    assert.match(prebill,/Morango/);
    assert.equal(rt.db.prepare('SELECT COUNT(*) AS n FROM restaurant_orders').get().n,1);
    assert.equal(rt.db.prepare('SELECT COUNT(*) AS n FROM restaurant_order_items').get().n,4);
  }finally{close();}
});

test('updating a variant with a different product ID never moves that variant to an unrelated item',()=>{
  const {runtime:rt,close}=fixture();
  try{
    assert.throws(()=>rt.catalogCustomization.upsertVariant({id:'fries-small',productId:'juice',name:'Variação indevida',priceDeltaCents:10},admin),/pertence a outro produto/);
    const current=rt.catalogCustomization.getProductConfiguration('fries').variants.find(v=>v.id==='fries-small');
    assert.equal(current.name,'150g');
    assert.equal(rt.catalogCustomization.getProductConfiguration('juice').variants.some(v=>v.id==='fries-small'),false);
  }finally{close();}
});

test('destination error identifies the exact unconfigured product and creates no order',()=>{
  const {runtime:rt,token,close}=fixture();
  try{
    rt.catalog.upsertProduct({id:'unrouted',name:'Batata sem destino',salePriceCents:600,menuEnabled:true,trackStock:false,usageType:'DIRECT'},admin);
    assert.throws(()=>rt.publicOrdering.submitOrder(token,{items:[{productId:'soda',quantity:1},{productId:'unrouted',quantity:1}]}),/Batata sem destino/);
    assert.equal(rt.db.prepare('SELECT COUNT(*) AS n FROM restaurant_orders').get().n,0);
  }finally{close();}
});

test('customer cart reuses mutation key for retries and shows price and variation details',()=>{
  const script=fs.readFileSync(path.join(__dirname,'..','server/customer-menu/app.js'),'utf8');
  assert.match(script,/state\.pendingOrder\?\.signature!==signature/);
  assert.match(script,/mutationKey:state\.pendingOrder\.id/);
  assert.match(script,/function cartLineDetails/);
  assert.match(script,/Confira o preço zerado/);
});

test('inventory warns when no KDS exists and does not silently claim save after failed route persist',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','desktop/renderer/app.js'),'utf8');
  assert.match(source,/Nenhum setor KDS ativo/);
  assert.match(source,/savedProduct=saved/);
  assert.match(source,/api\.removeProduct\(savedProduct\.id\)/);
});

test('opening several configured products reuses one submit handler and adds ONLY the latest product',()=>{
  const script=fs.readFileSync(path.join(__dirname,'..','server/customer-menu/app.js'),'utf8');
  const match=script.match(/^  function selectProduct\(productId\)\{.*\}$/m);
  assert.ok(match,'product dialog handler must be found');
  const products=[
    {id:'fries',name:'Porção fritas',available:true,configuration:{variants:[{id:'fries-option'}]}},
    {id:'juice',name:'Suco',available:true,configuration:{variants:[{id:'juice-option'}]}}
  ];
  const added=[];
  const form={
    innerHTML:'',onsubmit:null,listeners:[],
    addEventListener(event,fn){this.listeners.push({event,fn});},
    querySelector(selector){
      if(selector==='[data-close]')return{addEventListener(){}};
      if(selector==='#product-error')return{classList:{add(){},remove(){}},textContent:''};
      return null;
    },
    querySelectorAll(){return[];}
  };
  const dialog={showModal(){},close(){}};
  const context={
    state:{context:{products},activeProduct:null},
    $:selector=>selector==='#product-dialog'?dialog:selector==='#product-form'?form:selector==='#product-error'?{classList:{add(){},remove(){}},textContent:''}:null,
    hasConfiguration:()=>true,
    productDialogHtml:()=>'<form>...</form>',
    syncPizzaFlavorLimit:()=>{},
    refreshDraftPrice:()=>{},
    validateConfiguration:()=>'', 
    FormData:class {get(){return null;}},
    addLine:line=>added.push(line),
    calculateDraft:()=>1000
  };
  vm.runInNewContext(match[0]+"\nselectProduct('fries');selectProduct('juice');",context);
  assert.equal(typeof form.onsubmit,'function');
  assert.equal(form.listeners.filter(v=>v.event==='submit').length,0);
  form.onsubmit({preventDefault(){}});
  assert.deepEqual(added.map(x=>x.productId),['juice']);
});

test('kitchen note prints each distinct variation under its own product in a mixed order',async()=>{
  const {runtime:rt,token,close}=fixture();
  try{
    const station=rt.kitchen.upsertStation({id:'kds',name:'Cozinha',printEnabled:false},admin);
    rt.kitchen.configureProductRoute('fries',{mode:'PRODUCTION',stationId:station.id},admin);
    rt.kitchen.configureProductRoute('juice',{mode:'PRODUCTION',stationId:station.id},admin);
    const order=rt.publicOrdering.submitOrder(token,{items:[
      {productId:'fries',quantity:1,variantId:'fries-small'},
      {productId:'soda',quantity:1},
      {productId:'juice',quantity:1,variantId:'juice-strawberry'},
      {productId:'fries',quantity:1,variantId:'fries-large'}
    ]});
    assert.equal(order.items.length,4);
    const dispatched=await rt.dispatchPending();
    assert.deepEqual(dispatched.failures,[]);
    const tickets=rt.kitchen.listTickets();
    assert.equal(tickets.length,1);
    const ticket=tickets[0];
    assert.equal(ticket.items.length,3);
    const byProduct=ticket.items.reduce((acc,item)=>{(acc[item.productName]??=[]).push(item);return acc;},{});
    assert.deepEqual(new Set(byProduct['Porção de fritas'].map(row=>row.configuration.variant.name)),new Set(['150g','300g']));
    assert.equal(byProduct['Suco'][0].configuration.variant.name,'Morango');
    const print=renderKitchenTicket({ticket,width:42});
    assert.match(print,/150g/);
    assert.match(print,/300g/);
    assert.match(print,/Morango/);
    // Render each printed line on its own to prove a variation is never borrowed
    // from another product even if the full ticket's item order changes.
    for(const item of ticket.items){
      const lineText=renderKitchenTicket({ticket:{...ticket,items:[item]},width:42});
      if(item.productName==='Suco'){
        assert.match(lineText,/Morango/);
        assert.doesNotMatch(lineText,/150g|300g/);
      }else{
        assert.match(lineText,new RegExp(item.configuration.variant.name));
        assert.doesNotMatch(lineText,/Morango/);
      }
    }
  }finally{close();}
});
