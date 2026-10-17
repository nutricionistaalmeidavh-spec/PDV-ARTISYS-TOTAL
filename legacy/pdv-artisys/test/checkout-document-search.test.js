'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {Readable}=require('node:stream');
const {createCheckoutDocumentRouter}=require('../server/checkout-document-router');

function responseCapture(){
  return{
    statusCode:null,
    headers:null,
    body:'',
    writeHead(statusCode,headers){this.statusCode=statusCode;this.headers=headers;},
    end(chunk=''){this.body+=String(chunk||'');}
  };
}

function request(query){
  const req=Readable.from([]);
  req.url=`/api/v1/checkout/documents?query=${encodeURIComponent(query)}`;
  req.method='GET';
  req.headers={host:'localhost',authorization:'Bearer test-token'};
  return req;
}

async function search(router,query){
  const res=responseCapture();
  assert.equal(await router(request(query),res),true);
  assert.equal(res.statusCode,200);
  return JSON.parse(res.body);
}

function fixture(){
  const session={
    id:'session-1',
    status:'OPEN',
    totalCents:4200,
    checkoutSaleId:null,
    openedAt:'2026-10-03T12:00:00.000Z'
  };
  const order={
    id:'order-1',
    orderNumber:'ATC-0041',
    customerName:'Cliente Alfa',
    status:'CONFIRMED',
    createdAt:'2026-10-03T13:00:00.000Z',
    items:[{pendingQuantity:2,unitPriceCents:1500}]
  };
  const deliveryOrders=[
    {id:'delivery-42',customerName:'Maria Entrega',phone:'16999990001',fulfillmentType:'DELIVERY',status:'PREPARING',saleId:'sale-delivery',createdAt:'2026-10-03T14:00:00.000Z'},
    {id:'pickup-17',customerName:'João Retira',phone:'16999990002',fulfillmentType:'PICKUP',status:'READY',saleId:'sale-pickup',createdAt:'2026-10-03T15:00:00.000Z'}
  ];
  const salesById={
    'sale-delivery':{id:'sale-delivery',status:'OPEN',totalCents:6800},
    'sale-pickup':{id:'sale-pickup',status:'SUSPENDED',totalCents:4290}
  };
  const runtime={
    sales:{getSale:id=>salesById[id]||null},
    modules:{isEnabled:name=>name==='FOOD'||name==='WHOLESALE'},
    restaurant:{
      listTables:()=>[{id:'table-1',label:'Setor A',sessionId:session.id}],
      getSession:id=>id===session.id?session:null
    },
    orders:{
      listOrders:({origin}={})=>origin==='WHOLESALE'?[order]:[],
      prepareCheckout(){throw new Error('not used by search tests');}
    },
    delivery:{
      list:()=>deliveryOrders,
      get:id=>deliveryOrders.find(order=>order.id===id)||null
    }
  };
  const sessionStore=new Map([['test-token',{
    userId:'user-1',
    profileId:'profile-cashier',
    terminalId:'terminal-1',
    expiresAt:Date.now()+60_000
  }]]);
  return createCheckoutDocumentRouter({runtime,sessionStore});
}

test('checkout document search accepts tolerant command type terms',async()=>{
  const router=fixture();

  for(const term of ['mesa','mesas','comanda','comandas']){
    const rows=await search(router,term);
    assert.equal(rows.length,1,term);
    assert.equal(rows[0].type,'COMMAND',term);
  }
});

test('checkout document search accepts tolerant wholesale type terms',async()=>{
  const router=fixture();

  for(const term of ['atacado','pedido','pedidos','pedido atacado','pedidos de atacado']){
    const rows=await search(router,term);
    assert.equal(rows.length,1,term);
    assert.equal(rows[0].type,'ORDER',term);
  }
});

test('checkout document search combines type aliases with free-text terms',async()=>{
  const router=fixture();

  assert.equal((await search(router,'comanda setor a'))[0]?.type,'COMMAND');
  assert.equal((await search(router,'atacado cliente alfa'))[0]?.type,'ORDER');
});

test('checkout document search keeps existing identifier and customer matching',async()=>{
  const router=fixture();

  assert.equal((await search(router,'ATC-0041'))[0]?.type,'ORDER');
  assert.equal((await search(router,'Cliente Alfa'))[0]?.type,'ORDER');
  assert.equal((await search(router,'Setor A'))[0]?.type,'COMMAND');
});


test('checkout document search includes delivery and pickup using the canonical linked sale',async()=>{
  const router=fixture();

  const deliveries=await search(router,'delivery');
  assert.equal(deliveries.length,1);
  assert.equal(deliveries[0].type,'DELIVERY');
  assert.equal(deliveries[0].fulfillmentType,'DELIVERY');
  assert.equal(deliveries[0].saleId,'sale-delivery');
  assert.equal(deliveries[0].totalCents,6800);

  const pickups=await search(router,'retirada');
  assert.equal(pickups.length,1);
  assert.equal(pickups[0].type,'DELIVERY');
  assert.equal(pickups[0].fulfillmentType,'PICKUP');
  assert.equal(pickups[0].saleId,'sale-pickup');
  assert.equal(pickups[0].totalCents,4290);
});

test('checkout document search finds delivery by customer phone and combines channel filter with free text',async()=>{
  const router=fixture();

  assert.equal((await search(router,'Maria Entrega'))[0]?.id,'delivery-42');
  assert.equal((await search(router,'16999990002'))[0]?.id,'pickup-17');
  assert.equal((await search(router,'delivery maria'))[0]?.id,'delivery-42');
  assert.equal((await search(router,'retirada joao'))[0]?.id,'pickup-17');
});

test('checkout document search excludes delivery orders that do not yet have a canonical sale',async()=>{
  const router=createCheckoutDocumentRouter({
    runtime:{
      sales:{getSale:()=>null},
      modules:{isEnabled:name=>name==='FOOD'},
      restaurant:{listTables:()=>[]},
      orders:{listOrders:()=>[]},
      delivery:{list:()=>[{id:'draft-delivery',customerName:'Sem envio',fulfillmentType:'DELIVERY',status:'NEW',saleId:null,createdAt:'2026-10-03T16:00:00.000Z'}]}
    },
    sessionStore:new Map([['test-token',{userId:'user-1',profileId:'profile-cashier',terminalId:'terminal-1',expiresAt:Date.now()+60_000}]])
  });

  assert.deepEqual(await search(router,'delivery'),[]);
});


test('checkout opens delivery through its existing canonical sale without recreating order or items',async()=>{
  let resumed=0;
  const order={id:'pickup-17',customerName:'João Retira',fulfillmentType:'PICKUP',status:'READY',saleId:'sale-pickup'};
  const runtime={
    sales:{
      getSale:id=>id==='sale-pickup'?{id,status:'SUSPENDED',totalCents:4290}:null,
      resumeSale:id=>{resumed++;return{id,status:'OPEN',totalCents:4290};}
    },
    modules:{isEnabled:name=>name==='FOOD'},
    restaurant:{listTables:()=>[]},
    orders:{listOrders:()=>[]},
    delivery:{list:()=>[order],get:id=>id===order.id?order:null}
  };
  const router=createCheckoutDocumentRouter({
    runtime,
    sessionStore:new Map([['test-token',{userId:'user-1',profileId:'profile-cashier',terminalId:'terminal-1',expiresAt:Date.now()+60_000}]])
  });
  const req=Readable.from([]);
  req.url='/api/v1/checkout/documents/delivery/pickup-17/open';
  req.method='POST';
  req.headers={host:'localhost',authorization:'Bearer test-token'};
  const res=responseCapture();

  assert.equal(await router(req,res),true);
  assert.equal(res.statusCode,200);
  const payload=JSON.parse(res.body);
  assert.equal(payload.type,'DELIVERY');
  assert.equal(payload.document.id,'pickup-17');
  assert.equal(payload.sale.id,'sale-pickup');
  assert.equal(payload.sale.status,'OPEN');
  assert.equal(resumed,1);
});


test('checkout locator allows reopening the document already loaded as the same canonical sale',()=>{
  const fs=require('node:fs');
  const path=require('node:path');
  const app=fs.readFileSync(path.join(__dirname,'..','desktop','renderer','app.js'),'utf8');
  assert.match(app,/data-checkout-document-sale/);
  assert.match(app,/const targetSaleId=/);
  assert.match(app,/const sameCanonicalSale=/);
  assert.match(app,/!sameCanonicalSale/);
  assert.match(app,/state\.checkoutDocumentContext=\{type,document:/);
});
