'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

const admin={userId:'admin-pizza',profileId:'profile-administrator',terminalId:'PDV-01'};
function deviceHeaders(device,mutationId){return{'x-device-id':device.id,'x-device-key':device.credential,'content-type':'application/json',...(mutationId?{'x-mutation-id':mutationId}:{})};}

test('pizza configuration and authoritative price are identical across waiter, QR, desktop table and delivery',async()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});let server;
  try{
    rt.modules.setEnabled('FOOD',true,{kind:'system',id:'system'});
    const user=rt.catalog.createUser({id:'admin-pizza',username:'admin-pizza',name:'Garçom Pizza',profileId:'profile-administrator',password:'Pizza-123456!'},admin);
    rt.catalog.upsertProduct({id:'pizza',name:'Pizza da Casa',salePriceCents:3000,trackStock:false,menuEnabled:true,active:true},admin);
    const station=rt.kitchen.upsertStation({id:'cozinha-pizza',name:'Cozinha Pizza'},admin);
    rt.kitchen.configureProductRoute('pizza',{mode:'PRODUCTION',stationId:station.id},admin);
    rt.pizzeria.upsertProfile({productId:'pizza',pricingPolicy:'HIGHEST_FLAVOR'},admin);
    rt.pizzeria.upsertSize({id:'g',productId:'pizza',name:'Grande',maxFlavors:2,priceDeltaCents:500},admin);
    rt.pizzeria.upsertFlavor({id:'cal',productId:'pizza',name:'Calabresa',priceDeltaCents:400},admin);
    rt.pizzeria.upsertFlavor({id:'mar',productId:'pizza',name:'Marguerita',priceDeltaCents:200},admin);
    rt.pizzeria.upsertCrust({id:'cat',productId:'pizza',name:'Catupiry',priceDeltaCents:600},admin);
    for(const [id,label] of [['tw','Mesa Garçom'],['tq','Mesa QR'],['td','Mesa Desktop']])rt.restaurant.upsertTable({id,label,seats:4},admin);
    const waiter=rt.mobileDevices.createDevice({id:'waiter-pizza',name:'Garçom Pizza',deviceType:'WAITER',userId:user.id},admin);

    server=createLocalServer({runtime:rt,host:'127.0.0.1',port:0,token:'pizza-local'});
    const address=await server.start();const base=`http://${address.host}:${address.port}`;

    const waiterContext=await fetch(`${base}/api/v1/mobile/context`,{headers:deviceHeaders(waiter)});
    assert.equal(waiterContext.status,200);const waiterData=await waiterContext.json();
    const waiterPizza=waiterData.products.find(row=>row.id==='pizza');
    assert.equal(waiterPizza.configuration.pizza.sizes[0].name,'Grande');
    assert.deepEqual(waiterPizza.configuration.pizza.flavors.map(row=>row.name),['Calabresa','Marguerita']);

    const opened=await fetch(`${base}/api/v1/mobile/tables/tw/open`,{method:'POST',headers:deviceHeaders(waiter,'open-pizza'),body:JSON.stringify({partySize:2})});
    assert.equal(opened.status,201);const waiterSession=await opened.json();

    const selection={productId:'pizza',quantity:1,unitPriceCents:1,pizza:{sizeId:'g',flavorIds:['cal','mar'],crustId:'cat'}};
    const waiterOrder=await fetch(`${base}/api/v1/mobile/orders`,{method:'POST',headers:deviceHeaders(waiter,'order-pizza'),body:JSON.stringify({sessionId:waiterSession.id,items:[selection]})});
    assert.equal(waiterOrder.status,201);const waiterResult=await waiterOrder.json();
    assert.equal(waiterResult.order.items[0].unitPriceCents,4500);
    assert.equal(waiterResult.order.items[0].configuration.pizza.size.name,'Grande');

    const access=rt.publicOrdering.issueTableAccess('tq',admin);
    const publicContext=await fetch(`${base}/api/v1/public/menu/${access.token}`);
    assert.equal(publicContext.status,200);const publicData=await publicContext.json();
    assert.equal(publicData.products.find(row=>row.id==='pizza').configuration.pizza.crusts[0].name,'Catupiry');
    const qrOrder=await fetch(`${base}/api/v1/public/menu/${access.token}/orders`,{method:'POST',headers:{'content-type':'application/json','x-mutation-id':'qr-pizza'},body:JSON.stringify({items:[selection]})});
    assert.equal(qrOrder.status,201);const qrResult=await qrOrder.json();
    assert.equal(qrResult.order.items[0].unitPriceCents,4500);
    assert.equal(qrResult.order.items[0].configuration.pizza.flavors.length,2);

    const desktopSession=rt.restaurant.openTable('td',{operatorId:user.id,actor:admin});
    const desktopOrder=await fetch(`${base}/api/v1/restaurant/sessions/${desktopSession.id}/orders`,{method:'POST',headers:{'x-pdv-token':'pizza-local','content-type':'application/json','x-mutation-id':'desktop-pizza'},body:JSON.stringify({operatorId:user.id,items:[selection]})});
    assert.equal(desktopOrder.status,201);const desktopResult=await desktopOrder.json();
    assert.equal(desktopResult.order.items[0].unitPriceCents,4500);

    const pickup=rt.delivery.create({customerName:'Cliente Pizza',fulfillmentType:'PICKUP',items:[selection]},admin);
    assert.equal(pickup.items[0].unitPriceCents,4500);
    assert.equal(pickup.items[0].configurationSnapshot.pizza.crust.name,'Catupiry');

    const delivery=rt.delivery.create({
      customerName:'Cliente Entrega',fulfillmentType:'DELIVERY',
      address:{street:'Rua das Pizzas',number:'10',district:'Centro',city:'Sao Paulo',state:'SP'},
      items:[selection]
    },admin);
    assert.equal(delivery.items[0].unitPriceCents,4500);
    assert.deepEqual(delivery.items[0].configurationSnapshot.pizza.flavors.map(row=>row.name),['Calabresa','Marguerita']);

    const counter=rt.delivery.create({
      customerName:'Cliente Balcao',channel:'COUNTER',items:[
        selection,
        {productId:'pizza',quantity:1,variantId:'g',selections:['mar','cat']}
      ]
    },admin);
    assert.equal(counter.items.length,2);
    assert.deepEqual(counter.items.map(row=>row.unitPriceCents).sort((a,b)=>a-b),[4300,4500]);
    const halfHalf=counter.items.find(row=>row.unitPriceCents===4500);
    const singleFlavor=counter.items.find(row=>row.unitPriceCents===4300);
    assert.equal(halfHalf.configurationSnapshot.pizza.flavors.length,2);
    assert.equal(singleFlavor.configurationSnapshot.pizza.flavors[0].name,'Marguerita');
  }finally{if(server)await server.stop();rt.close();}
});
