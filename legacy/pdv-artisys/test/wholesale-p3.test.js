'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

const admin={userId:'admin',profileId:'profile-administrator',terminalId:'T1'};
const manager={userId:'manager',profileId:'profile-manager',terminalId:'T1'};
const cashier={userId:'cashier',profileId:'profile-cashier',terminalId:'T1'};

function setup(){
  let seq=0;
  const runtime=createPdvRuntime({dbPath:':memory:',now:()=>`2026-10-02T21:30:${String(seq%60).padStart(2,'0')}.000Z`,idFactory:p=>`${p}-${++seq}`});
  runtime.catalog.createUser({id:'admin',username:'admin-p3',name:'Admin',profileId:'profile-administrator',password:'senha-admin-p3-123'},admin);
  runtime.catalog.createUser({id:'manager',username:'manager-p3',name:'Gerente',profileId:'profile-manager',password:'senha-manager-p3-123'},admin);
  runtime.catalog.createUser({id:'cashier',username:'cashier-p3',name:'Caixa',profileId:'profile-cashier',password:'senha-cashier-p3-123'},admin);
  runtime.catalog.upsertCustomer({id:'customer',name:'Mercado Silva',creditLimitCents:30000},admin);
  runtime.catalog.upsertProduct({id:'product',name:'Refrigerante 2L',salePriceCents:1000,costCents:500,trackStock:true,menuEnabled:true},admin);
  runtime.inventory.move({productId:'product',type:'opening',quantityDelta:200,reason:'seed'},admin);
  runtime.cash.openSession({id:'cash-T1',terminalId:'T1',operatorId:'cashier',initialCashCents:0,actor:cashier});
  runtime.modules.setEnabled('WHOLESALE',true,admin);
  runtime.commercialPricing.upsertQuantityTier({productId:'product',minQuantity:6,unitPriceCents:900},manager);
  runtime.commercialPricing.upsertQuantityTier({productId:'product',minQuantity:12,unitPriceCents:800},manager);
  runtime.commercialPricing.upsertQuantityTier({productId:'product',minQuantity:24,unitPriceCents:700},manager);
  return runtime;
}

test('P3 applies the same quantity tiers in normal Balcao sales',()=>{
  const runtime=setup();
  try{
    const sale=runtime.sales.openSale({terminalId:'T1',operatorId:'cashier',sellerId:'cashier'},cashier);
    let current=runtime.sales.addItem(sale.id,{productId:'product',quantity:5});
    assert.equal(current.items[0].unitPriceCents,1000);
    current=runtime.sales.updateItemQuantity(sale.id,'product',6);
    assert.equal(current.items[0].unitPriceCents,900);
    current=runtime.sales.updateItemQuantity(sale.id,'product',12);
    assert.equal(current.items[0].unitPriceCents,800);
    assert.equal(current.items[0].catalogUnitPriceCents,1000);
    current=runtime.sales.updateItemQuantity(sale.id,'product',24);
    assert.equal(current.items[0].unitPriceCents,700);
    current=runtime.sales.updateItemQuantity(sale.id,'product',2);
    assert.equal(current.items[0].unitPriceCents,1000);
  }finally{runtime.close();}
});

test('P3 creates human order number and cashier opens confirmed wholesale order without retyping items',async()=>{
  const runtime=setup();
  try{
    const quote=runtime.wholesale.createQuote({customerId:'customer',locationId:'MAIN',fulfillmentType:'PICKUP',expectedAt:'2026-10-08T17:00:00.000Z',items:[{productId:'product',quantity:12}]},manager);
    assert.match(quote.orderNumber,/^P-\d{6}$/);
    assert.equal(quote.expectedAt,'2026-10-08T17:00:00.000Z');
    assert.equal(quote.items[0].unitPriceCents,800);
    runtime.wholesale.confirmOrder(quote.id,manager);

    const checkout=runtime.orders.prepareCheckout(quote.id,{terminalId:'T1',operatorId:'cashier',sellerId:'cashier'},cashier);
    assert.equal(checkout.sale.status,'OPEN');
    assert.equal(checkout.sale.customerId,'customer');
    assert.equal(checkout.sale.items.length,1);
    assert.equal(checkout.sale.items[0].quantity,12);
    assert.equal(checkout.sale.items[0].unitPriceCents,800);
    assert.equal(checkout.sale.items[0].configuration.sourceDocument.orderNumber,quote.orderNumber);

    runtime.sales.completeSale(checkout.sale.id,{payments:[{method:'CASH',amountCents:9600}],actor:cashier});
    await runtime.dispatchPending();
    assert.equal(runtime.orders.getOrder(quote.id).status,'FULFILLED');
    assert.equal(runtime.sales.getSale(checkout.sale.id).status,'COMPLETED');
  }finally{runtime.close();}
});

test('P3 quoted price is immutable even if the product tier changes before checkout',()=>{
  const runtime=setup();
  try{
    const quote=runtime.wholesale.createQuote({customerId:'customer',locationId:'MAIN',fulfillmentType:'PICKUP',items:[{productId:'product',quantity:12}]},manager);
    assert.equal(quote.items[0].unitPriceCents,800);
    runtime.commercialPricing.upsertQuantityTier({productId:'product',minQuantity:12,unitPriceCents:750},manager);
    assert.equal(runtime.commercialPricing.resolveUnitPrice({productId:'product',quantity:12}).unitPriceCents,750);
    runtime.wholesale.confirmOrder(quote.id,manager);
    const checkout=runtime.orders.prepareCheckout(quote.id,{terminalId:'T1',operatorId:'cashier',sellerId:'cashier'},cashier);
    assert.equal(checkout.sale.items[0].unitPriceCents,800);
  }finally{runtime.close();}
});

test('P3 quantity pricing is inactive when Atacado is disabled',()=>{
  const runtime=setup();
  try{
    runtime.modules.setEnabled('WHOLESALE',false,admin);
    const sale=runtime.sales.openSale({terminalId:'T1',operatorId:'cashier',sellerId:'cashier'},cashier);
    const current=runtime.sales.addItem(sale.id,{productId:'product',quantity:24});
    assert.equal(current.items[0].unitPriceCents,1000);
  }finally{runtime.close();}
});


test('P3 B2B policy enforces minimum order and allowed payment methods while reusing customer credit',async()=>{
  const runtime=setup();
  try{
    const policy=runtime.wholesale.saveCustomerPolicy({customerId:'customer',minimumOrderCents:10000,allowedPaymentMethods:['PIX','STORE_CREDIT']},manager);
    assert.equal(policy.minimumOrderCents,10000);
    assert.deepEqual(policy.allowedPaymentMethods,['PIX','STORE_CREDIT']);
    assert.equal(policy.creditLimitCents,30000);
    assert.equal(policy.availableCreditCents,30000);

    assert.throws(()=>runtime.wholesale.createQuote({customerId:'customer',locationId:'MAIN',fulfillmentType:'PICKUP',items:[{productId:'product',quantity:12}]},manager),/Pedido minimo/i);

    const quote=runtime.wholesale.createQuote({customerId:'customer',locationId:'MAIN',fulfillmentType:'PICKUP',items:[{productId:'product',quantity:24}]},manager);
    assert.equal(quote.commercialPolicySnapshot.minimumOrderCents,10000);
    assert.deepEqual(quote.commercialPolicySnapshot.allowedPaymentMethods,['PIX','STORE_CREDIT']);
    runtime.wholesale.confirmOrder(quote.id,manager);
    const checkout=runtime.orders.prepareCheckout(quote.id,{terminalId:'T1',operatorId:'cashier',sellerId:'cashier'},cashier);
    assert.throws(()=>runtime.sales.completeSale(checkout.sale.id,{payments:[{method:'CASH',amountCents:16800}],actor:cashier}),/nao permitida/i);
    runtime.sales.completeSale(checkout.sale.id,{payments:[{method:'PIX',amountCents:16800}],actor:cashier});
    await runtime.dispatchPending();
    assert.equal(runtime.orders.getOrder(quote.id).status,'FULFILLED');
  }finally{runtime.close();}
});

test('P3 wholesale schema keeps policy and pricing snapshots additive',()=>{
  const runtime=setup();
  try{
    const tables=new Set(runtime.db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row=>row.name));
    assert.equal(tables.has('wholesale_price_tiers'),true);
    assert.equal(tables.has('wholesale_customer_policies'),true);
    const orderColumns=new Set(runtime.db.prepare('PRAGMA table_info(sales_orders)').all().map(row=>row.name));
    const itemColumns=new Set(runtime.db.prepare('PRAGMA table_info(sales_order_items)').all().map(row=>row.name));
    assert.equal(orderColumns.has('origin'),true);
    assert.equal(orderColumns.has('order_number'),true);
    assert.equal(orderColumns.has('commercial_policy_snapshot_json'),true);
    assert.equal(itemColumns.has('pricing_snapshot_json'),true);
  }finally{runtime.close();}
});
