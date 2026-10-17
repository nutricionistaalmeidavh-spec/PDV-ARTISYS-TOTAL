'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {renderKitchenTicket,renderTablePreBill}=require('../js/domains/printing/non-fiscal-renderer');

const admin={userId:'admin',profileId:'profile-administrator',terminalId:'pdv-1'};

test('E43 configured pizza reaches KDS and non-fiscal prints with size flavors and crust',async()=>{
  let seq=0;
  const rt=createPdvRuntime({dbPath:':memory:',idFactory:p=>`${p}-${++seq}`,now:()=>`2026-09-11T03:00:${String(seq).padStart(2,'0')}.000Z`});
  try{
    rt.catalog.createUser({id:'admin',username:'admin',name:'Admin',profileId:'profile-administrator',password:'1234567890'},admin);
    rt.catalog.upsertProduct({id:'pizza',name:'Pizza',salePriceCents:3000,trackStock:false},admin);
    rt.modules.setEnabled('FOOD',true,admin);
    rt.pizzeria.upsertProfile({productId:'pizza',pricingPolicy:'HIGHEST_FLAVOR'},admin);
    rt.pizzeria.upsertSize({id:'g',productId:'pizza',name:'Grande',maxFlavors:2,priceDeltaCents:500},admin);
    rt.pizzeria.upsertFlavor({id:'cal',productId:'pizza',name:'Calabresa',priceDeltaCents:400},admin);
    rt.pizzeria.upsertFlavor({id:'mar',productId:'pizza',name:'Marguerita',priceDeltaCents:200},admin);
    rt.pizzeria.upsertCrust({id:'cat',productId:'pizza',name:'Catupiry',priceDeltaCents:600},admin);
    const priced=rt.pizzeria.pricePizza({productId:'pizza',sizeId:'g',flavorIds:['cal','mar'],crustId:'cat'});
    rt.restaurant.upsertTable({id:'t1',label:'Mesa 1'},admin);
    const session=rt.restaurant.openTable('t1',{operatorId:'admin',actor:admin});
    const station=rt.kitchen.upsertStation({id:'cozinha',name:'Cozinha',printEnabled:false},admin);
    rt.kitchen.assignProduct('pizza',station.id,admin);
    rt.restaurant.addOrder(session.id,{items:[{productId:'pizza',quantity:1,unitPriceCents:priced.unitPriceCents,configurationSnapshot:priced.configurationSnapshot}],actor:admin});
    const dispatch=await rt.dispatchPending();
    assert.equal(dispatch.failures.length,0);
    const ticket=rt.kitchen.listTickets()[0];
    assert.equal(ticket.items[0].configuration.pizza.size.name,'Grande');
    const kitchenText=renderKitchenTicket({ticket,width:42});
    assert.match(kitchenText,/Tamanho: Grande/);
    assert.match(kitchenText,/1\/2 Calabresa/);
    assert.match(kitchenText,/1\/2 Marguerita/);
    assert.match(kitchenText,/Borda: Catupiry/);
    assert.match(kitchenText,/NAO FISCAL/);
    const prebillText=renderTablePreBill({session:rt.restaurant.getSession(session.id),width:42});
    assert.match(prebillText,/Tamanho: Grande/);
    assert.match(prebillText,/Calabresa/);
    assert.match(prebillText,/Marguerita/);
    assert.match(prebillText,/NAO FISCAL/);
  }finally{rt.close();}
});
