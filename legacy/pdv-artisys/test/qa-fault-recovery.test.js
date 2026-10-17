'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalServer}=require('../server/local-server');

async function login(base,password){
  const response=await fetch(base+'/api/v1/auth/login',{
    method:'POST',
    headers:{'content-type':'application/json','x-pdv-token':'qa-install'},
    body:JSON.stringify({username:'qa-admin',password,terminalId:'PDV-QA'})
  });
  assert.equal(response.status,200);
  return (await response.json()).sessionToken;
}

test('fault recovery: completed sale and stock survive process/server restart and LAN reconnect',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-qa-restart-'));
  const dbPath=path.join(dir,'pdv.sqlite');
  const password='Qa-Restart-12345!';
  const actor={userId:'qa-admin',profileId:'profile-administrator',terminalId:'PDV-QA'};
  let runtime=null;
  let server=null;
  try{
    runtime=createPdvRuntime({dbPath,appVersion:'qa',serverVersion:'qa'});
    runtime.catalog.createUser({id:'qa-admin',username:'qa-admin',name:'QA Admin',profileId:'profile-administrator',password},actor);
    runtime.catalog.upsertProduct({id:'qa-restart-product',sku:'QA-RST-1',barcode:'0001234500007',name:'Produto Restart QA',salePriceCents:1500,costCents:500,trackStock:true,active:true},actor);
    runtime.inventory.move({productId:'qa-restart-product',type:'opening',quantityDelta:2,reason:'QA restart seed'},actor);
    runtime.cash.openSession({id:'qa-restart-cash',terminalId:'PDV-QA',operatorId:'qa-admin',initialCashCents:0,actor});
    const sale=runtime.sales.openSale({id:'qa-restart-sale',saleNumber:'QA-RST-001',terminalId:'PDV-QA',operatorId:'qa-admin'},actor);
    runtime.sales.addItem(sale.id,{productId:'qa-restart-product',quantity:1});
    runtime.sales.completeSale(sale.id,{payments:[{method:'PIX',amountCents:1500}],actor,mutationId:'qa-restart-complete'});
    const dispatch=await runtime.dispatchPending();
    assert.equal(dispatch.failed,0);
    assert.equal(runtime.inventory.getBalance('qa-restart-product'),1);

    server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'qa-install',requireTerminalAuth:false});
    let address=await server.start();
    let base='http://'+address.host+':'+address.port;
    let token=await login(base,password);
    let response=await fetch(base+'/api/v1/sales/qa-restart-sale',{headers:{authorization:'Bearer '+token,'x-pdv-token':'qa-install'}});
    assert.equal(response.status,200);
    { const body=await response.json(); assert.equal((body.sale||body).status,'COMPLETED'); }

    await server.stop();
    server=null;
    let unavailable=false;
    try{await fetch(base+'/api/v1/health',{signal:AbortSignal.timeout(750)});}catch{unavailable=true;}
    assert.equal(unavailable,true,'server should be unreachable during the injected outage');

    runtime.close();
    runtime=null;

    runtime=createPdvRuntime({dbPath,appVersion:'qa',serverVersion:'qa'});
    assert.equal(runtime.sales.getSale('qa-restart-sale').status,'COMPLETED');
    assert.equal(runtime.inventory.getBalance('qa-restart-product'),1);

    server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'qa-install',requireTerminalAuth:false});
    address=await server.start();
    base='http://'+address.host+':'+address.port;
    token=await login(base,password);
    response=await fetch(base+'/api/v1/sales/qa-restart-sale',{headers:{authorization:'Bearer '+token,'x-pdv-token':'qa-install'}});
    assert.equal(response.status,200);
    const persistedBody=await response.json();
    const persisted=persistedBody.sale||persistedBody;
    assert.equal(persisted.status,'COMPLETED');
    assert.equal(persisted.totalCents,1500);
  }finally{
    if(server)await server.stop().catch(()=>{});
    if(runtime)runtime.close();
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
