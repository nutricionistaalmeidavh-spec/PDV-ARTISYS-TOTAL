'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

test('last physical unit is reserved by the first completed POS sale before EventBus stock effect runs',async()=>{
  const runtime=createPdvRuntime({dbPath:':memory:'});
  try{
    const admin={userId:'admin',profileId:'profile-administrator',terminalId:'ADMIN'};
    runtime.catalog.createUser({id:'cash-a',username:'cash-a',name:'Caixa A',profileId:'profile-cashier',password:'Cashier-A-123!'},admin);
    runtime.catalog.createUser({id:'cash-b',username:'cash-b',name:'Caixa B',profileId:'profile-cashier',password:'Cashier-B-123!'},admin);
    runtime.catalog.upsertProduct({id:'last-unit',name:'Ultima unidade',sku:'LAST-1',salePriceCents:1000,costCents:500,trackStock:true},admin);
    runtime.inventory.move({productId:'last-unit',type:'opening',quantityDelta:1,reason:'seed'},admin);
    runtime.cash.openSession({id:'cash-session-a',terminalId:'CAIXA-A',operatorId:'cash-a',initialCashCents:0,actor:{userId:'cash-a',profileId:'profile-cashier',terminalId:'CAIXA-A'}});
    runtime.cash.openSession({id:'cash-session-b',terminalId:'CAIXA-B',operatorId:'cash-b',initialCashCents:0,actor:{userId:'cash-b',profileId:'profile-cashier',terminalId:'CAIXA-B'}});

    const saleA=runtime.sales.openSale({id:'sale-a',saleNumber:'A',terminalId:'CAIXA-A',operatorId:'cash-a'});
    const saleB=runtime.sales.openSale({id:'sale-b',saleNumber:'B',terminalId:'CAIXA-B',operatorId:'cash-b'});
    runtime.sales.addItem(saleA.id,{productId:'last-unit',quantity:1});
    runtime.sales.addItem(saleB.id,{productId:'last-unit',quantity:1});

    runtime.sales.completeSale(saleA.id,{payments:[{method:'PIX',amountCents:1000}],actor:{userId:'cash-a',profileId:'profile-cashier',terminalId:'CAIXA-A'},mutationId:'last-unit-a'});

    assert.equal(runtime.inventory.getBalance('last-unit'),1,'physical decrement remains an EventBus effect');
    assert.throws(
      ()=>runtime.sales.completeSale(saleB.id,{payments:[{method:'PIX',amountCents:1000}],actor:{userId:'cash-b',profileId:'profile-cashier',terminalId:'CAIXA-B'},mutationId:'last-unit-b'}),
      /Estoque disponivel insuficiente/i
    );

    const dispatch=await runtime.dispatchPending();
    assert.equal(dispatch.failed,0);
    assert.equal(runtime.inventory.getBalance('last-unit'),0);
    assert.equal(runtime.sales.getSale(saleA.id).status,'COMPLETED');
    assert.equal(runtime.sales.getSale(saleB.id).status,'OPEN');
    assert.equal(runtime.db.prepare("SELECT COUNT(*) AS n FROM inventory_movements WHERE product_id='last-unit' AND type='sale'").get().n,1);
  }finally{
    runtime.close();
  }
});
