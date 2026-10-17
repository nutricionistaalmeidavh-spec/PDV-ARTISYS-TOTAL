'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

const admin={userId:'admin',profileId:'profile-administrator',terminalId:'PDV-01'};
function setup(){let seq=0;const rt=createPdvRuntime({dbPath:':memory:',idFactory:p=>`${p}-${++seq}`,now:()=>`2026-09-11T04:00:${String(seq).padStart(2,'0')}.000Z`});
  rt.catalog.createUser({id:'admin',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-forte-123'},admin);
  rt.catalog.upsertProduct({id:'burger',name:'Burger',salePriceCents:2000,trackStock:false},admin);
  rt.catalog.upsertProduct({id:'ham',name:'Presunto kg',salePriceCents:4000,unit:'KG',trackStock:true},admin);
  rt.inventory.move({productId:'ham',type:'opening',quantityDelta:10,reason:'seed'},admin);
  const station=rt.kitchen.upsertStation({id:'k1',name:'Cozinha',printEnabled:false},admin);
  rt.kitchen.assignProduct('burger',station.id,admin);
  return rt;
}

test('E45 delivery creates one canonical open sale and routes configured items to shared KDS',()=>{
  const rt=setup();try{
    rt.modules.setEnabled('FOOD',true,admin);
    const order=rt.delivery.create({customerName:'Ana',fulfillmentType:'PICKUP',paymentMethod:'PIX'},admin);
    const sale=rt.delivery.createSale(order.id,{terminalId:'PDV-01',operatorId:'admin',items:[{productId:'burger',quantity:1,configurationSnapshot:{version:1,options:[{id:'extra',name:'Queijo extra'}]}}]},admin);
    assert.equal(sale.status,'OPEN');
    assert.equal(rt.delivery.get(order.id).saleId,sale.id);
    const tickets=rt.kitchen.listTickets();
    assert.equal(tickets.length,1);
    assert.equal(tickets[0].sourceType,'DELIVERY');
    assert.equal(tickets[0].sourceId,order.id);
    assert.equal(tickets[0].items[0].configuration.options[0].name,'Queijo extra');
    assert.equal(rt.db.prepare('SELECT COUNT(*) AS n FROM sales WHERE id=?').get(sale.id).n,1);
  }finally{rt.close();}
});

test('E46 fast-food can create a canonical configured sale and route it to shared KDS',()=>{
  const rt=setup();try{
    rt.modules.setEnabled('FOOD',true,admin);
    const order=rt.fastFood.create({terminalId:'PDV-01',operatorId:'admin',items:[{productId:'burger',quantity:1,unitPriceCents:2300,configurationSnapshot:{version:1,options:[{id:'bacon',name:'Bacon'}]}}]},admin);
    assert.ok(order.saleId);
    const sale=rt.sales.getSale(order.saleId);
    assert.equal(sale.totalCents,2300);
    assert.equal(sale.items[0].configuration.options[0].name,'Bacon');
    const ticket=rt.kitchen.listTickets().find(item=>item.sourceType==='FAST_FOOD');
    assert.ok(ticket);
    assert.equal(ticket.sourceId,order.id);
    assert.equal(ticket.items[0].configuration.options[0].name,'Bacon');
    assert.deepEqual(rt.fastFood.readyBoard(),[]);
  }finally{rt.close();}
});

test('E47 weighted Core item enters canonical sale without Alimentação enabled',()=>{
  const rt=setup();try{
    rt.modules.setEnabled('FOOD',false,admin);
    const sale=rt.sales.openSale({id:'sale-weight',saleNumber:'W1',terminalId:'PDV-01',operatorId:'admin'},admin);
    const updated=rt.marketBakery.addWeightedItemToSale(sale.id,{productId:'ham',grams:250,source:'MANUAL'},admin);
    assert.equal(updated.totalCents,1000);
    assert.equal(updated.items[0].quantity,0.25);
    assert.equal(updated.items[0].configuration.weight.grams,250);
    assert.equal(updated.items[0].configuration.weight.source,'MANUAL');
  }finally{rt.close();}
});
