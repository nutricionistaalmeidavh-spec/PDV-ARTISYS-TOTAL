'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

const system={kind:'system',id:'system'};

test('counter daily tickets increment atomically and reset on the store-local date',()=>{
  let current='2026-10-05T02:30:00.000Z';
  let seq=0;
  const runtime=createPdvRuntime({
    dbPath:':memory:',
    now:()=>current,
    idFactory:prefix=>`${prefix}-${++seq}`
  });
  try{
    runtime.modules.setEnabled('FOOD',true,system);
    runtime.settings.set('store.timeZone','America/Sao_Paulo',{scope:'global',actor:system});
    runtime.catalog.upsertProduct({id:'burger',name:'Burger',salePriceCents:2000,trackStock:false,menuEnabled:true},system);
    runtime.kitchen.configureProductRoute('burger',{mode:'DIRECT'},system);

    const first=runtime.delivery.create({channel:'COUNTER',useTicket:true,items:[{productId:'burger',quantity:1}]},system);
    const second=runtime.delivery.create({channel:'COUNTER',useTicket:true,items:[{productId:'burger',quantity:1}]},system);

    assert.equal(first.channel,'COUNTER');
    assert.equal(first.ticketDate,'2026-10-04');
    assert.equal(first.ticketNumber,1);
    assert.equal(second.ticketDate,'2026-10-04');
    assert.equal(second.ticketNumber,2);

    current='2026-10-05T03:30:00.000Z';
    const nextDay=runtime.delivery.create({channel:'COUNTER',useTicket:true,items:[{productId:'burger',quantity:1}]},system);

    assert.equal(nextDay.ticketDate,'2026-10-05');
    assert.equal(nextDay.ticketNumber,1);
  }finally{
    runtime.close();
  }
});
