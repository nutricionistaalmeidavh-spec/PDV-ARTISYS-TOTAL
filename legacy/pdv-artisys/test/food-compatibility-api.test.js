'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

test('unified food orders API keeps legacy daily tickets behind the server compatibility boundary',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-food-compat-'));
  const runtime=createPdvRuntime({dbPath:path.join(dir,'pdv.sqlite')});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'install-secret',requireTerminalAuth:false});
  const address=await server.start();
  const base=`http://${address.host}:${address.port}`;
  const install={'x-pdv-token':'install-secret','content-type':'application/json'};
  try{
    let response=await fetch(base+'/api/v1/setup/admin',{method:'POST',headers:install,body:JSON.stringify({username:'admin',name:'Admin',password:'senha-forte-123'})});
    assert.equal(response.status,201);
    response=await fetch(base+'/api/v1/auth/login',{method:'POST',headers:install,body:JSON.stringify({username:'admin',password:'senha-forte-123',terminalId:'PDV-01'})});
    assert.equal(response.status,200);
    const token=(await response.json()).sessionToken;
    const headers={authorization:`Bearer ${token}`,'content-type':'application/json'};
    response=await fetch(base+'/api/v1/settings/modules.FOOD.enabled',{method:'PUT',headers,body:JSON.stringify({value:true,scope:'global'})});
    assert.equal(response.status,200);
    response=await fetch(base+'/api/v1/vertical/delivery',{method:'POST',headers,body:JSON.stringify({customerName:'Ana',fulfillmentType:'PICKUP'})});
    assert.equal(response.status,201);
    const current=await response.json();
    response=await fetch(base+'/api/v1/vertical/fast-food',{method:'POST',headers,body:'{}'});
    assert.equal(response.status,201);
    const legacy=await response.json();
    response=await fetch(base+'/api/v1/vertical/food/orders',{headers});
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.orders.some(order=>order.id===current.id),true);
    assert.equal(body.legacyOrders.some(order=>order.id===legacy.id),true);
    response=await fetch(base+`/api/v1/vertical/food/legacy-orders/${encodeURIComponent(legacy.id)}/status`,{method:'PATCH',headers,body:JSON.stringify({status:'PREPARING'})});
    assert.equal(response.status,200);
    assert.equal((await response.json()).status,'PREPARING');
  }finally{
    await server.stop();
    runtime.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
