'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

test('kit and promotional combo endpoints persist user-defined rules',async()=>{
  let seq=0;const runtime=createPdvRuntime({idFactory:p=>`${p}-${++seq}`,now:()=> '2026-09-12T12:00:00.000Z'});
  runtime.catalog.upsertProduct({id:'p1',name:'Produto 1',salePriceCents:399,costCents:200,trackStock:true});
  runtime.catalog.upsertProduct({id:'p2',name:'Produto 2',salePriceCents:250,costCents:100,trackStock:true});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'secret'});const address=await server.start();const base=`http://${address.host}:${address.port}`;
  const headers={'content-type':'application/json','x-pdv-token':'secret'};
  try{
    let response=await fetch(`${base}/api/v1/vertical/catalog/kits`,{method:'POST',headers,body:JSON.stringify({id:'kit1',name:'Kit 1',salePriceCents:990,components:[{productId:'p1',quantity:2},{productId:'p2',quantity:1}]})});
    assert.equal(response.status,201);let payload=await response.json();assert.equal(payload.salePriceCents,990);assert.equal(payload.components.length,2);
    response=await fetch(`${base}/api/v1/vertical/catalog/promotional-combos`,{method:'POST',headers,body:JSON.stringify({id:'promo1',name:'3 por 10',selectionMode:'SAME_PRODUCT',requiredQuantity:3,bundlePriceCents:1000,productIds:['p1']})});
    assert.equal(response.status,201);payload=await response.json();assert.equal(payload.requiredQuantity,3);assert.equal(payload.bundlePriceCents,1000);
    response=await fetch(`${base}/api/v1/vertical/catalog/kits`,{headers});assert.equal(response.status,200);payload=await response.json();assert.equal(payload.some(item=>item.id==='kit1'),true);
    response=await fetch(`${base}/api/v1/vertical/catalog/promotional-combos`,{headers});assert.equal(response.status,200);payload=await response.json();assert.equal(payload.some(item=>item.id==='promo1'),true);
  }finally{await server.stop();runtime.close();}
});
