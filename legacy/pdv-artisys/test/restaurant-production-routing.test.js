'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const { createPdvRuntime }=require('../js/core/pdv-runtime');
const { createLocalServer }=require('../server/local-server');

const admin={userId:'admin',profileId:'profile-administrator',terminalId:'PDV-01'};

function fixture(){
  let seq=0;
  const runtime=createPdvRuntime({now:()=> '2026-10-03T12:00:00.000Z',idFactory:prefix=>`${prefix}-${++seq}`});
  runtime.catalog.createUser({id:'admin',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-forte-123'});
  runtime.catalog.upsertProduct({id:'coke',name:'Coca-Cola lata',sku:'COCA',salePriceCents:700,costCents:300,trackStock:false,menuEnabled:true});
  runtime.catalog.upsertProduct({id:'juice',name:'Suco de laranja',sku:'SUCO',salePriceCents:1200,costCents:500,trackStock:false,menuEnabled:true});
  runtime.restaurant.upsertTable({id:'t1',label:'Mesa 1',seats:4},admin);
  const session=runtime.restaurant.openTable('t1',{operatorId:'admin',actor:admin});
  return {runtime,session,close:()=>runtime.close()};
}

test('restaurant blocks menu items without an explicit production route',()=>{
  const ctx=fixture();
  try{
    assert.throws(
      ()=>ctx.runtime.restaurant.addOrder(ctx.session.id,{items:[{productId:'juice',quantity:1}],source:'WAITER',actor:admin}),
      /configure.*produção|atendimento direto|roteamento/i
    );
    assert.equal(ctx.runtime.db.prepare('SELECT COUNT(*) AS n FROM restaurant_orders').get().n,0);
  }finally{ctx.close();}
});

test('direct-service items remain on the command without creating kitchen tickets',async()=>{
  const ctx=fixture();
  try{
    ctx.runtime.kitchen.configureProductRoute('coke',{mode:'DIRECT'},admin);
    const order=ctx.runtime.restaurant.addOrder(ctx.session.id,{items:[{productId:'coke',quantity:2}],source:'WAITER',actor:admin});
    const dispatch=await ctx.runtime.dispatchPending();
    assert.equal(dispatch.failures.length,0,JSON.stringify(dispatch.failures));
    assert.equal(order.items.length,1);
    assert.equal(order.items[0].productId,'coke');
    assert.equal(ctx.runtime.kitchen.listTickets().length,0);
    assert.deepEqual(ctx.runtime.kitchen.getProductRoute('coke'),{
      productId:'coke',
      productName:'Coca-Cola lata',
      mode:'DIRECT',
      stationId:null,
      stationName:null
    });
  }finally{ctx.close();}
});

test('mixed orders route only production items to the configured kitchen station',async()=>{
  const ctx=fixture();
  try{
    const station=ctx.runtime.kitchen.upsertStation({id:'bar',name:'Bar',printEnabled:false},admin);
    ctx.runtime.kitchen.configureProductRoute('coke',{mode:'DIRECT'},admin);
    ctx.runtime.kitchen.configureProductRoute('juice',{mode:'PRODUCTION',stationId:station.id},admin);

    const order=ctx.runtime.restaurant.addOrder(ctx.session.id,{items:[
      {productId:'coke',quantity:1},
      {productId:'juice',quantity:2,note:'sem gelo'}
    ],source:'WAITER',actor:admin});
    const dispatch=await ctx.runtime.dispatchPending();
    assert.equal(dispatch.failures.length,0,JSON.stringify(dispatch.failures));

    assert.equal(order.items.length,2);
    const tickets=ctx.runtime.kitchen.listTickets();
    assert.equal(tickets.length,1);
    assert.equal(tickets[0].stationName,'Bar');
    assert.deepEqual(tickets[0].items.map(item=>item.productName),['Suco de laranja']);
    assert.equal(ctx.runtime.restaurant.getOrder(order.id).status,'NEW');
  }finally{ctx.close();}
});

test('waiter mobile context exposes order production status for the selected table',async()=>{
  const ctx=fixture();
  let server;
  try{
    ctx.runtime.modules.setEnabled('FOOD',true,admin);
    const station=ctx.runtime.kitchen.upsertStation({id:'bar',name:'Bar',printEnabled:false},admin);
    ctx.runtime.kitchen.configureProductRoute('juice',{mode:'PRODUCTION',stationId:station.id},admin);
    const order=ctx.runtime.restaurant.addOrder(ctx.session.id,{items:[{productId:'juice',quantity:1}],source:'WAITER',actor:admin});
    await ctx.runtime.dispatchPending();
    const ticket=ctx.runtime.kitchen.listTickets()[0];
    ctx.runtime.kitchen.updateTicketStatus(ticket.id,'PREPARING',admin);
    assert.equal(ctx.runtime.restaurant.getOrder(order.id).status,'PREPARING');

    const waiter=ctx.runtime.mobileDevices.createDevice({id:'waiter-1',name:'Garçom 1',deviceType:'WAITER',userId:'admin'},admin);
    server=createLocalServer({runtime:ctx.runtime,host:'127.0.0.1',port:0,token:'local-secret',requireTerminalAuth:false});
    const address=await server.start();
    const response=await fetch(`http://${address.host}:${address.port}/api/v1/mobile/context`,{
      headers:{'x-device-id':waiter.id,'x-device-key':waiter.credential}
    });
    assert.equal(response.status,200);
    const payload=await response.json();
    const table=payload.tables.find(item=>item.id==='t1');
    assert.ok(table);
    assert.equal(table.orders.length,1);
    assert.equal(table.orders[0].status,'PREPARING');
    assert.equal(table.orders[0].items[0].productName,'Suco de laranja');
  }finally{
    if(server)await server.stop();
    ctx.close();
  }
});


test('product production route can be read before the item enters the menu',async()=>{
  const ctx=fixture();
  let server;
  try{
    ctx.runtime.modules.setEnabled('FOOD',true,admin);
    ctx.runtime.catalog.upsertProduct({
      id:'water',
      name:'Água mineral',
      sku:'AGUA',
      salePriceCents:500,
      costCents:200,
      trackStock:true,
      usageType:'DIRECT',
      menuEnabled:false,
      active:true
    },admin);
    ctx.runtime.kitchen.configureProductRoute('water',{mode:'DIRECT'},admin);

    server=createLocalServer({runtime:ctx.runtime,host:'127.0.0.1',port:0,token:'local-secret',requireTerminalAuth:false});
    const address=await server.start();
    const response=await fetch(`http://${address.host}:${address.port}/api/v1/restaurant/kitchen/routing/water`,{
      headers:{'x-pdv-token':'local-secret'}
    });

    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{
      productId:'water',
      productName:'Água mineral',
      mode:'DIRECT',
      stationId:null,
      stationName:null
    });
    assert.equal(ctx.runtime.catalog.getProduct('water').menuEnabled,false);
  }finally{
    if(server)await server.stop();
    ctx.close();
  }
});
