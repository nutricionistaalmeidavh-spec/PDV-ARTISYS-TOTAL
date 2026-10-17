'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

const admin={userId:'admin',profileId:'profile-administrator',terminalId:'PDV-01'};

function fixture(){
  let seq=0;
  const runtime=createPdvRuntime({
    dbPath:':memory:',
    now:()=>new Date(Date.UTC(2026,9,3,21,0,0,seq++)).toISOString(),
    idFactory:prefix=>`${prefix}-${++seq}`
  });
  runtime.catalog.createUser({id:'admin',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-forte-123'},admin);
  runtime.catalog.upsertProduct({id:'burger',name:'Burger',salePriceCents:2000,trackStock:false,menuEnabled:true},admin);
  runtime.catalog.upsertProduct({id:'juice',name:'Suco',salePriceCents:900,trackStock:false,menuEnabled:true},admin);
  runtime.modules.setEnabled('FOOD',true,admin);
  const kitchen=runtime.kitchen.upsertStation({id:'kitchen',name:'Cozinha',printEnabled:false},admin);
  const bar=runtime.kitchen.upsertStation({id:'bar',name:'Bar',printEnabled:false},admin);
  runtime.kitchen.configureProductRoute('burger',{mode:'PRODUCTION',stationId:kitchen.id},admin);
  runtime.kitchen.configureProductRoute('juice',{mode:'PRODUCTION',stationId:bar.id},admin);
  return {runtime,kitchen,bar,close:()=>runtime.close()};
}

test('delivery keeps its item snapshot before creating the canonical sale',()=>{
  const ctx=fixture();
  try{
    const order=ctx.runtime.delivery.create({
      customerName:'Pedido salvo',fulfillmentType:'PICKUP',paymentMethod:'PIX',
      items:[{productId:'burger',quantity:2,note:'sem cebola'}]
    },admin);
    assert.equal(order.saleId,null);
    assert.equal(order.items.length,1);
    assert.equal(order.items[0].productId,'burger');
    assert.equal(order.items[0].quantity,2);
    assert.equal(order.items[0].note,'sem cebola');

    const sale=ctx.runtime.delivery.createSale(order.id,{terminalId:'PDV-01',operatorId:'admin'},admin);
    assert.equal(sale.items.length,1);
    assert.equal(sale.items[0].productId,'burger');
    assert.equal(ctx.runtime.delivery.get(order.id).saleId,sale.id);
  }finally{ctx.close();}
});

test('delivery item snapshot keeps the confirmed price if the catalog changes before checkout',()=>{
  const ctx=fixture();
  try{
    const order=ctx.runtime.delivery.create({customerName:'Preço salvo',fulfillmentType:'PICKUP',paymentMethod:'PIX',items:[{productId:'burger',quantity:1}]},admin);
    ctx.runtime.catalog.upsertProduct({id:'burger',name:'Burger',salePriceCents:2600,trackStock:false,menuEnabled:true},admin);
    const sale=ctx.runtime.delivery.createSale(order.id,{terminalId:'PDV-01',operatorId:'admin'},admin);
    assert.equal(sale.items[0].unitPriceCents,2000);
    assert.equal(sale.totalCents,2000);
  }finally{ctx.close();}
});

test('direct-only pickup becomes ready without fabricating a KDS ticket',()=>{
  const ctx=fixture();
  try{
    ctx.runtime.kitchen.configureProductRoute('burger',{mode:'DIRECT'},admin);
    const order=ctx.runtime.delivery.create({customerName:'Direto',fulfillmentType:'PICKUP',paymentMethod:'PIX',items:[{productId:'burger',quantity:1}]},admin);
    ctx.runtime.delivery.createSale(order.id,{terminalId:'PDV-01',operatorId:'admin'},admin);
    assert.equal(ctx.runtime.delivery.get(order.id).status,'READY');
    assert.equal(ctx.runtime.kitchen.listTickets().filter(ticket=>ticket.sourceType==='DELIVERY'&&ticket.sourceId===order.id).length,0);
  }finally{ctx.close();}
});

test('delivery production status is driven by all KDS tickets, not by the delivery panel',()=>{
  const ctx=fixture();
  try{
    const order=ctx.runtime.delivery.create({customerName:'Ana',fulfillmentType:'PICKUP',paymentMethod:'PIX'},admin);
    ctx.runtime.delivery.createSale(order.id,{
      terminalId:'PDV-01',
      operatorId:'admin',
      items:[{productId:'burger',quantity:1},{productId:'juice',quantity:1}]
    },admin);

    const tickets=ctx.runtime.kitchen.listTickets().filter(ticket=>ticket.sourceType==='DELIVERY'&&ticket.sourceId===order.id);
    assert.equal(tickets.length,2);

    const kitchenTicket=tickets.find(ticket=>ticket.stationId===ctx.kitchen.id);
    const barTicket=tickets.find(ticket=>ticket.stationId===ctx.bar.id);

    ctx.runtime.kitchen.updateTicketStatus(kitchenTicket.id,'PREPARING',admin);
    assert.equal(ctx.runtime.delivery.get(order.id).status,'PREPARING');

    ctx.runtime.kitchen.updateTicketStatus(kitchenTicket.id,'READY',admin);
    assert.equal(ctx.runtime.delivery.get(order.id).status,'PREPARING','one ready sector must not make the whole order ready');

    ctx.runtime.kitchen.updateTicketStatus(barTicket.id,'PREPARING',admin);
    assert.equal(ctx.runtime.delivery.get(order.id).status,'PREPARING');

    ctx.runtime.kitchen.updateTicketStatus(barTicket.id,'READY',admin);
    assert.equal(ctx.runtime.delivery.get(order.id).status,'READY');

    assert.equal(ctx.runtime.delivery.updateStatus(order.id,'PICKED_UP',admin).status,'PICKED_UP');
  }finally{ctx.close();}
});

test('cancelling delivery cancels its active production tickets and KDS cannot resurrect it',()=>{
  const ctx=fixture();
  try{
    const order=ctx.runtime.delivery.create({customerName:'Cancelado',fulfillmentType:'PICKUP',paymentMethod:'PIX',items:[{productId:'burger',quantity:1}]},admin);
    const linkedSale=ctx.runtime.delivery.createSale(order.id,{terminalId:'PDV-01',operatorId:'admin'},admin);
    const ticket=ctx.runtime.kitchen.listTickets().find(item=>item.sourceType==='DELIVERY'&&item.sourceId===order.id);
    ctx.runtime.kitchen.updateTicketStatus(ticket.id,'PREPARING',admin);
    const cancelled=ctx.runtime.delivery.cancel(order.id,'Cliente desistiu',admin);
    assert.equal(cancelled.status,'CANCELLED');
    assert.equal(ctx.runtime.kitchen.getTicket(ticket.id).status,'CANCELLED');
    assert.equal(ctx.runtime.delivery.get(order.id).status,'CANCELLED');
    assert.equal(ctx.runtime.sales.getSale(linkedSale.id).status,'CANCELLED');
    assert.throws(()=>ctx.runtime.kitchen.updateTicketStatus(ticket.id,'PREPARING',admin),/cancelado/i);
    assert.equal(ctx.runtime.delivery.get(order.id).status,'CANCELLED');
  }finally{ctx.close();}
});

test('delivery panel cannot impersonate production by manually advancing NEW or PREPARING',()=>{
  const ctx=fixture();
  try{
    const order=ctx.runtime.delivery.create({customerName:'Bia',fulfillmentType:'DELIVERY',address:{street:'Rua A'},paymentMethod:'PIX'},admin);
    assert.throws(()=>ctx.runtime.delivery.updateStatus(order.id,'PREPARING',admin),/KDS|produ/i);
  }finally{ctx.close();}
});

test('KDS devices can be scoped to one or more production stations',()=>{
  const ctx=fixture();
  try{
    const device=ctx.runtime.mobileDevices.createDevice({
      id:'kds-bar',
      name:'KDS Bar',
      deviceType:'KITCHEN',
      stationIds:[ctx.bar.id]
    },admin);
    assert.deepEqual(device.stationIds,[ctx.bar.id]);
    assert.deepEqual(ctx.runtime.mobileDevices.getDevice(device.id).stationIds,[ctx.bar.id]);
  }finally{ctx.close();}
});

test('delivery projection exposes each production station and its current status',()=>{
  const ctx=fixture();
  try{
    const order=ctx.runtime.delivery.create({customerName:'Caio',fulfillmentType:'PICKUP',paymentMethod:'PIX'},admin);
    ctx.runtime.delivery.createSale(order.id,{terminalId:'PDV-01',operatorId:'admin',items:[{productId:'burger',quantity:1},{productId:'juice',quantity:1}]},admin);
    const first=ctx.runtime.delivery.get(order.id);
    assert.deepEqual(first.production.stations.map(item=>[item.id,item.name,item.status]),[
      ['bar','Bar','NEW'],
      ['kitchen','Cozinha','NEW']
    ]);
    const barTicket=ctx.runtime.kitchen.listTickets().find(ticket=>ticket.sourceType==='DELIVERY'&&ticket.sourceId===order.id&&ticket.stationId==='bar');
    ctx.runtime.kitchen.updateTicketStatus(barTicket.id,'PREPARING',admin);
    const updated=ctx.runtime.delivery.get(order.id);
    assert.equal(updated.production.status,'PREPARING');
    assert.equal(updated.production.stations.find(item=>item.id==='bar').status,'PREPARING');
    assert.equal(updated.production.stations.find(item=>item.id==='kitchen').status,'NEW');
  }finally{ctx.close();}
});

test('mobile KDS context returns only tickets assigned to the device stations',async()=>{
  const ctx=fixture();let server;
  try{
    const order=ctx.runtime.delivery.create({customerName:'Dani',fulfillmentType:'PICKUP',paymentMethod:'PIX'},admin);
    ctx.runtime.delivery.createSale(order.id,{terminalId:'PDV-01',operatorId:'admin',items:[{productId:'burger',quantity:1},{productId:'juice',quantity:1}]},admin);
    const device=ctx.runtime.mobileDevices.createDevice({id:'kds-bar-api',name:'KDS Bar',deviceType:'KITCHEN',stationIds:['bar']},admin);
    server=createLocalServer({runtime:ctx.runtime,host:'127.0.0.1',port:0,token:'local-secret',requireTerminalAuth:false});
    const address=await server.start();
    const response=await fetch(`http://${address.host}:${address.port}/api/v1/mobile/context`,{headers:{'x-device-id':device.id,'x-device-key':device.credential}});
    assert.equal(response.status,200);
    const payload=await response.json();
    assert.ok(payload.tickets.length>=1);
    assert.ok(payload.tickets.every(ticket=>ticket.stationId==='bar'));
  }finally{if(server)await server.stop();ctx.close();}
});

test('delivery and pickup UI is one operational surface without legacy DOM observation or technical sale IDs',()=>{
  const vertical=fs.readFileSync(path.join(__dirname,'..','desktop','renderer','vertical-modules.js'),'utf8');
  const parity=fs.readFileSync(path.join(__dirname,'..','desktop','renderer','vertical-parity-p1.js'),'utf8');
  const checkout=fs.readFileSync(path.join(__dirname,'..','desktop','renderer','app.js'),'utf8');
  const access=fs.readFileSync(path.join(__dirname,'..','desktop','renderer','access-center-ui.js'),'utf8');
  const accessRouter=fs.readFileSync(path.join(__dirname,'..','server','access-control-router.js'),'utf8');

  assert.match(vertical,/Entrega e retirada/);
  assert.match(vertical,/Delivery/);
  assert.match(vertical,/Retirada/);
  assert.doesNotMatch(parity,/new MutationObserver/);
  assert.doesNotMatch(vertical,/new MutationObserver/);
  assert.doesNotMatch(parity,/function mountDelivery|parity-delivery-p1|data-delivery-next|data-delivery-prefill-sale/);
  assert.doesNotMatch(vertical,/delivery-sale-form|Gerar venda do pedido|data-delivery-prefill-sale/);
  assert.doesNotMatch(parity,/Avançar para PREPARING|Avançar para READY/);
  assert.match(vertical+parity,/Avisar no WhatsApp/);
  assert.match(vertical,/data-delivery-view="DELIVERY"/);
  assert.match(vertical,/data-delivery-view="PICKUP"/);
  assert.match(vertical,/Enviar para produção/);
  assert.match(vertical,/Aguardando produção/);
  assert.match(vertical,/production\??\.stations/);
  assert.match(vertical,/openCheckoutSale/);
  assert.match(checkout,/openCheckoutSale/);
  assert.match(access,/Setores de produção/);
  assert.match(access,/stationIds/);
  assert.match(accessRouter,/kitchen-stations/);
});
