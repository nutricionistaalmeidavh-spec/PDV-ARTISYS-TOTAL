'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

const admin={userId:'admin-clean',profileId:'profile-administrator',terminalId:'PDV-01'};
const png1x1='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zc7sAAAAASUVORK5CYII=';

function headers(device,mutationId){
  return {
    'x-device-id':device.id,
    'x-device-key':device.credential,
    'content-type':'application/json',
    ...(mutationId?{'x-mutation-id':mutationId}:{})
  };
}

test('garçom e QR compartilham pedido canônico, serviço e mídia segura',async()=>{
  const photoDir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-public-table-'));
  const rt=createPdvRuntime({dbPath:':memory:',productPhotoDir:photoDir});let server;
  try{
    rt.modules.setEnabled('FOOD',true,{kind:'system',id:'system'});
    const user=rt.catalog.createUser({id:'admin-clean',username:'admin-clean',name:'Garçom QA',profileId:'profile-administrator',password:'Qa-Clean-12345!'},admin);
    const customer=rt.catalog.upsertCustomer({id:'customer-clean',name:'Cliente Multicanal'},admin);
    const product=rt.catalog.upsertProduct({id:'burger-clean',name:'Burger Multicanal',salePriceCents:2000,trackStock:false,menuEnabled:true,usageType:'DIRECT'},admin);
    const hidden=rt.catalog.upsertProduct({id:'hidden-clean',name:'Item oculto',salePriceCents:1000,trackStock:false,menuEnabled:true,usageType:'DIRECT'},admin);
    rt.publicOrdering.updateMenuProduct(hidden.id,{visible:false},admin);
    rt.productPhotos.save({productId:product.id,mimeType:'image/png',originalBase64:png1x1,thumbnailBase64:png1x1},admin);
    rt.productPhotos.save({productId:hidden.id,mimeType:'image/png',originalBase64:png1x1,thumbnailBase64:png1x1},admin);

    const group=rt.catalogCustomization.upsertOptionGroup({id:'extras-clean',name:'Extras',selectionType:'MULTIPLE',minSelections:0,maxSelections:2},admin);
    const option=rt.catalogCustomization.upsertOption({id:'bacon-clean',groupId:group.id,name:'Bacon',priceDeltaCents:300},admin);
    rt.catalogCustomization.linkGroupToProduct(product.id,group.id,{required:false,sortOrder:1},admin);
    const station=rt.kitchen.upsertStation({id:'kitchen-clean',name:'Cozinha Multi'},admin);
    rt.kitchen.assignProduct(product.id,station.id,admin);
    for(const [id,label] of [['tw','Mesa Garçom'],['tq','Mesa QR']])rt.restaurant.upsertTable({id,label,seats:4},admin);

    const waiter=rt.mobileDevices.createDevice({id:'waiter-clean',name:'Garçom Multi',deviceType:'WAITER',userId:user.id},admin);
    server=createLocalServer({runtime:rt,host:'127.0.0.1',port:0,token:'local-clean'});
    const address=await server.start();
    const base=`http://${address.host}:${address.port}`;

    const waiterContext=await fetch(`${base}/api/v1/mobile/context`,{headers:headers(waiter)});
    assert.equal(waiterContext.status,200);
    const waiterData=await waiterContext.json();
    assert.ok(waiterData.customers.some(row=>row.id===customer.id));
    assert.ok(waiterData.products.find(row=>row.id===product.id).configuration.groups.some(row=>row.id===group.id));

    const opened=await fetch(`${base}/api/v1/mobile/tables/tw/open`,{
      method:'POST',
      headers:headers(waiter,'open-clean'),
      body:JSON.stringify({partySize:4,customerId:customer.id})
    });
    assert.equal(opened.status,201);
    const waiterSession=await opened.json();

    const access=rt.publicOrdering.issueTableAccess('tq',admin);
    const publicContext=await fetch(`${base}/api/v1/public/menu/${access.token}`);
    assert.equal(publicContext.status,200);
    const publicData=await publicContext.json();
    assert.equal(publicData.table.label,'Mesa QR');
    assert.equal(publicData.products.find(row=>row.id===product.id).photo.version,1);
    assert.equal(publicData.products.some(row=>row.id===hidden.id),false);

    const configuredItem={productId:product.id,quantity:1,selections:[option.id]};
    const waiterOrder=await fetch(`${base}/api/v1/mobile/orders`,{
      method:'POST',
      headers:headers(waiter,'waiter-clean-order'),
      body:JSON.stringify({sessionId:waiterSession.id,items:[{...configuredItem,note:'sem cebola'}]})
    });
    assert.equal(waiterOrder.status,201);

    const qrOrder=await fetch(`${base}/api/v1/public/menu/${access.token}/orders`,{
      method:'POST',
      headers:{'content-type':'application/json','x-mutation-id':'qr-clean-order'},
      body:JSON.stringify({items:[{...configuredItem,note:'bem passado'}]})
    });
    assert.equal(qrOrder.status,201);

    const sessions=['tw','tq'].map(id=>rt.restaurant.currentSession(id));
    assert.deepEqual(sessions.map(session=>session.orders.length),[1,1]);
    const items=sessions.map(session=>session.orders[0].items[0]);
    assert.deepEqual(items.map(item=>item.unitPriceCents),[2300,2300]);
    assert.deepEqual(items.map(item=>item.note),['sem cebola','bem passado']);
    assert.deepEqual(sessions.map(session=>session.orders[0].source),['WAITER','TABLE']);
    assert.equal(rt.kitchen.listTickets().length,2);

    for(const [requestType,mutation] of [['WAITER','qr-waiter'],['BILL','qr-bill']]){
      const service=await fetch(`${base}/api/v1/public/menu/${access.token}/service`,{
        method:'POST',
        headers:{'content-type':'application/json','x-mutation-id':mutation},
        body:JSON.stringify({requestType})
      });
      assert.equal(service.status,201);
      const request=await service.json();
      assert.equal(request.tableId,'tq');
      assert.equal(request.requestType,requestType);
    }

    const photo=await fetch(`${base}/api/v1/public/menu/${access.token}/products/${product.id}/photo`);
    assert.equal(photo.status,200);
    assert.equal(photo.headers.get('content-type'),'image/png');
    const hiddenPhoto=await fetch(`${base}/api/v1/public/menu/${access.token}/products/${hidden.id}/photo`);
    assert.equal(hiddenPhoto.status,404);

    const mobileComposer=await fetch(`${base}/mobile/order-composer.js`);
    const menuComposer=await fetch(`${base}/menu/order-composer.js`);
    assert.equal(mobileComposer.status,200);
    assert.equal(menuComposer.status,200);
    assert.equal(await mobileComposer.text(),await menuComposer.text());
  }finally{
    if(server)await server.stop();
    rt.close();
    fs.rmSync(photoDir,{recursive:true,force:true});
  }
});

test('QR rejects an item that becomes unavailable after context load',async()=>{
  const rt=createPdvRuntime({dbPath:':memory:'});let server;
  try{
    rt.modules.setEnabled('FOOD',true,{kind:'system',id:'system'});
    rt.restaurant.upsertTable({id:'late-table',label:'Mesa temporária',seats:2},admin);
    rt.catalog.upsertProduct({id:'late-item',name:'Item temporário',salePriceCents:1500,trackStock:false,menuEnabled:true,active:true},admin);
    const access=rt.publicOrdering.issueTableAccess('late-table',admin);
    server=createLocalServer({runtime:rt,host:'127.0.0.1',port:0,token:'local-clean'});
    const address=await server.start();
    const base=`http://${address.host}:${address.port}`;

    const before=await fetch(`${base}/api/v1/public/menu/${access.token}`);
    assert.equal(before.status,200);
    assert.equal((await before.json()).products.some(item=>item.id==='late-item'),true);

    rt.catalog.upsertProduct({id:'late-item',name:'Item temporário',salePriceCents:1500,trackStock:false,menuEnabled:true,active:false},admin);
    const submit=await fetch(`${base}/api/v1/public/menu/${access.token}/orders`,{
      method:'POST',
      headers:{'content-type':'application/json','x-mutation-id':'late-submit'},
      body:JSON.stringify({items:[{productId:'late-item',quantity:1}]})
    });
    assert.equal(submit.status,409);
  }finally{
    if(server)await server.stop();
    rt.close();
  }
});
