'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createCart}=require('../shared/order-composer');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {renderSaleReceipt}=require('../js/domains/printing/receipt-renderer');
const {renderTablePreBill}=require('../js/domains/printing/non-fiscal-renderer');

const admin={userId:'qa-admin',profileId:'profile-administrator',terminalId:'qa-pdv'};
function fixture(){
  let next=4000;
  const rt=createPdvRuntime({dbPath:':memory:',now:()=> '2026-10-15T12:20:00.000Z',idFactory:prefix=>prefix+'-'+String(next--)});
  rt.catalog.createUser({id:'qa-admin',username:'qa-admin',name:'Operador QA',password:'strong-password-123',profileId:'profile-administrator'},admin);
  rt.modules.setEnabled('FOOD',true,admin);
  rt.catalog.upsertProduct({id:'fries',name:'Porção de fritas',salePriceCents:0,trackStock:false,menuEnabled:true},admin);
  rt.kitchen.configureProductRoute('fries',{mode:'DIRECT'},admin);
  rt.catalogCustomization.upsertVariant({id:'fries-10',productId:'fries',name:'Sem queijo',priceDeltaCents:1000},admin);
  rt.catalogCustomization.upsertVariant({id:'fries-18',productId:'fries',name:'Com queijo',priceDeltaCents:1800},admin);
  const other=[];
  for(let i=0;i<18;i++){
    const id='food-'+i;
    const price=200+(i*75);
    rt.catalog.upsertProduct({id,name:'Produto teste '+i,salePriceCents:price,trackStock:false,menuEnabled:true},admin);
    rt.kitchen.configureProductRoute(id,{mode:'DIRECT'},admin);
    other.push({id,price});
  }
  rt.restaurant.upsertTable({id:'qa-table',label:'Mesa QA',seats:4},admin);
  const token=rt.publicOrdering.issueTableAccess('qa-table',admin).token;
  return {rt,token,other,close:()=>rt.close()};
}

test('QA 1: opening the same product with options cannot add an unselected R$ 0,00 phantom line',()=>{
  const {rt,token,close}=fixture();
  try {
    assert.throws(()=>rt.publicOrdering.submitOrder(token,{items:[{productId:'fries',quantity:1}]}),/Escolha uma variação ou adicional/);
    assert.equal(rt.db.prepare('SELECT COUNT(*) AS count FROM restaurant_order_items').get().count,0);
    const order=rt.publicOrdering.submitOrder(token,{items:[{productId:'fries',variantId:'fries-10',quantity:1,note:'sem queijo'}]});
    assert.equal(order.items.length,1);
    assert.equal(order.items[0].productName,'Porção de fritas');
    assert.equal(order.items[0].unitPriceCents,1000);
    assert.equal(order.items[0].configuration.variant.name,'Sem queijo');
    assert.equal(rt.db.prepare('SELECT COUNT(*) AS count FROM restaurant_order_items').get().count,1);
  }finally{close();}
});

test('QA 2/3: 20 intentional selections generate precisely 20 lines, no unrequested copies or zero prices',()=>{
  const {rt,token,other,close}=fixture();
  try{
    const cart=createCart({idFactory:(()=>{let n=0;return()=> 'qa-cart-'+(++n);})()});
    cart.add({productId:'fries',name:'Porção de fritas',unitPriceCents:1000,quantity:1,configuration:{variantId:'fries-10'},note:'sem queijo'});
    for(const item of other)cart.add({productId:item.id,name:'Produto teste',quantity:1,unitPriceCents:item.price});
    cart.add({productId:'fries',name:'Porção de fritas',unitPriceCents:1800,quantity:1,configuration:{variantId:'fries-18'}});
    const intended=cart.toOrderItems();
    assert.equal(intended.length,20);
    assert.equal(cart.lines().length,20);
    assert.ok(cart.lines().every(item=>item.unitPriceCents>0),'cart must not contain a phantom R$ 0,00 item');
    const order=rt.publicOrdering.submitOrder(token,{items:intended});
    assert.equal(order.items.length,20);
    assert.equal(rt.db.prepare('SELECT COUNT(*) AS count FROM restaurant_order_items').get().count,20);
    assert.equal(order.items.reduce((sum,item)=>sum+item.totalCents,0),order.totalCents);
    assert.equal(order.totalCents,cart.summary().totalCents);
    assert.ok(order.items.every(item=>item.unitPriceCents>0));
    const byVariant=order.items.filter(item=>item.productId==='fries');
    assert.equal(byVariant.length,2);
    assert.deepEqual(new Set(byVariant.map(item=>item.configuration.variant.name)),new Set(['Sem queijo','Com queijo']));
    assert.deepEqual(new Set(byVariant.map(item=>item.unitPriceCents)),new Set([1000,1800]));
    const sales=rt.restaurant.checkoutToSale(rt.restaurant.currentSession('qa-table').id,{terminalId:'qa-pdv',operatorId:'qa-admin',actor:admin},rt.sales);
    const sale=sales.sale;
    assert.equal(sale.items.length,20);
    assert.equal(sale.totalCents,order.totalCents);
    const cupom=renderSaleReceipt({sale,width:42,documentLabel:'CUPOM NAO FISCAL'});
    assert.match(cupom,/CUPOM NAO FISCAL/);
    assert.match(cupom,/Sem queijo/);
    assert.match(cupom,/Com queijo/);
    assert.doesNotMatch(cupom,/R\$ 0,00/);
    for(const line of sale.items){
      const isolated=renderSaleReceipt({sale:{...sale,items:[line]},width:42});
      if(line.productId==='fries'){
        assert.match(isolated,new RegExp(line.configuration.variant.name));
        assert.doesNotMatch(isolated,new RegExp(line.configuration.variant.name==='Sem queijo'?'Com queijo':'Sem queijo'));
      }else{
        assert.doesNotMatch(isolated,/Variacao: Sem queijo|Variacao: Com queijo/);
      }
    }
    const prebill=renderTablePreBill({session:rt.restaurant.currentSession('qa-table'),width:42});
    assert.match(prebill,/Sem queijo/);
    assert.match(prebill,/Com queijo/);
  }finally{close();}
});

test('QA 1/2: mobile reusable product form triggers one submit per choice across 15 dialog openings',()=>{
  const source=fs.readFileSync(path.join(__dirname,'..','server/customer-menu/app.js'),'utf8');
  const begin=source.indexOf('  function validateConfiguration(form,product){');
  const end=source.indexOf('\n  function addLine(',begin);
  assert.ok(begin>=0&&end>begin);
  const cart=createCart({idFactory:(()=>{let n=0;return()=> 'sim-'+(++n);})()});
  const products=[
    {id:'fries',name:'Porção de fritas',available:true,salePriceCents:0,configuration:{variants:[{id:'fries-10',name:'Sem queijo',priceDeltaCents:1000}],groups:[]}},
    ...Array.from({length:14},(_,i)=>({id:'qa-'+i,name:'Item '+i,available:true,salePriceCents:250+i*50,configuration:{variants:[{id:'v-'+i,name:'Único',priceDeltaCents:50}],groups:[]}}))
  ];
  const errors={classList:{add(){},remove(){}},textContent:''};
  let selectedVariantId=null;
  const form={
    innerHTML:'',onsubmit:null,registered:[],
    querySelector(selector){
      if(selector==='[data-close]')return{addEventListener(){}};
      if(selector==='input[name="variantId"]:checked')return selectedVariantId?{value:selectedVariantId}:null;
      if(selector==='[data-option]:checked'||selector==='[data-combo]:checked')return null;
      return null;
    },
    querySelectorAll(){return[];},
    addEventListener(event,fn){this.registered.push(event);}
  };
  const dialog={showModal(){},close(){}};
  const context={
    state:{context:{products},activeProduct:null},
    $:selector=>selector==='#product-dialog'?dialog:selector==='#product-form'?form:selector==='#product-error'?errors:null,
    hasConfiguration:()=>true,
    productDialogHtml:()=>'<form></form>',
    syncPizzaFlavorLimit:()=>{},
    refreshDraftPrice:()=>{},
    FormData:class{get(name){return name==='variantId'?selectedVariantId:'';}},
    addLine:item=>cart.add({...item,configuration:{variantId:item.variantId,selections:item.selections,comboSelections:item.comboSelections}}),
    calculateDraft:(product)=>product.salePriceCents+(product.configuration.variants.find(row=>row.id===selectedVariantId)?.priceDeltaCents||0)
  };
  vm.runInNewContext(source.slice(begin,end),context,{filename:'customer-menu/app.js'});
  context.selectProduct('fries');
  selectedVariantId=null;
  form.onsubmit({preventDefault(){}});
  assert.equal(cart.lines().length,0,'unselected zero-base product must NOT enter cart');
  for(const product of products){
    context.selectProduct(product.id);
    selectedVariantId=product.configuration.variants[0].id;
    form.onsubmit({preventDefault(){}});
    assert.equal(cart.lines().length,products.indexOf(product)+1);
  }
  assert.equal(cart.lines().length,15);
  assert.ok(cart.lines().every(row=>row.unitPriceCents>0));
  assert.equal(form.registered.filter(name=>name==='submit').length,0,'no stacked submission listeners');
});
