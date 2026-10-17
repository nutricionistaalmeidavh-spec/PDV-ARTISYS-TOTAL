'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const {createLanReachability}=require('../server/lan-reachability.cjs');
const {publicNetworkState,testPublicNetwork}=require('../desktop/public-network.cjs');
const {createMobileAccessService}=require('../js/core/mobile-access/mobile-access-service.js');

async function withHttp(handler,run){
  const server=http.createServer((req,res)=>{
    if(!handler(req,res)){res.writeHead(404);res.end();}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{return await run('http://127.0.0.1:'+server.address().port);}
  finally{await new Promise(resolve=>server.close(resolve));}
}

test('local QR prioritizes the actual IPv4 even when mDNS resolves on Windows',()=>{
  const interfaces={
    'Ethernet':[ {address:'192.168.10.42',family:'IPv4',internal:false} ],
    'VMware Network Adapter':[ {address:'192.168.56.1',family:'IPv4',internal:false} ]
  };
  const state=publicNetworkState({config:{mode:'lan-host',port:4174},lanEnabled:true,stableHost:'artisys-demo.local',interfaces});
  assert.equal(state.host,'192.168.10.42');
  assert.equal(state.baseUrl,'http://192.168.10.42:4174');
  assert.equal(state.stable,false);
  assert.equal(state.stableAvailable,true);
  assert.equal(state.stableHost,'artisys-demo.local');
  assert.deepEqual(state.addresses,['192.168.10.42']);
});

test('testing from the desktop never claims phone connectivity',async()=>{
  const state=publicNetworkState({
    config:{mode:'lan-host',port:4174},
    lanEnabled:true,
    interfaces:{Ethernet:[{address:'192.168.3.2',internal:false}]}
  });
  const result=await testPublicNetwork({state,fetchImpl:async url=>{
    assert.equal(url,'http://192.168.3.2:4174/api/v1/health');
    return{ok:true,json:async()=>({ok:true})};
  }});
  assert.equal(result.mobileConfirmed,false);
  assert.equal(result.testedFrom,'pc-local');
});

test('phone challenge requires explicit POST confirmation and expires without modifying persisted data',async()=>{
  let instant=100;
  const check=createLanReachability({now:()=>instant,ttlMs:2000});
  const started=check.start();
  assert.match(started.token,/^[a-f0-9]{32}$/);
  const route='/lan-check/'+started.token;
  await withHttp((req,res)=>check.handle(req,res),async base=>{
    const viewed=await fetch(base+route);
    assert.equal(viewed.status,200);
    const html=await viewed.text();
    assert.match(html,/Confirmar acesso pelo celular/);
    assert.deepEqual(check.status(started.token),{confirmed:false,expired:false,expiresAt:2100});
    const completed=await fetch(base+route,{method:'POST'});
    assert.equal(completed.status,200);
    assert.match(await completed.text(),/Acesso pelo celular confirmado/);
    assert.equal(check.status(started.token).confirmed,true);
    const bad=await fetch(base+'/lan-check/'+'a'.repeat(32));
    assert.equal(bad.status,404);
    assert.equal((await bad.text()).includes('Teste expirado'),true);
    instant=2101;
    assert.deepEqual(check.status(started.token),{confirmed:false,expired:true});
    assert.equal((await fetch(base+route)).status,404);
  });
});

test('QR service encodes same host, port, and temporary challenge path',()=>{
  const access=createMobileAccessService().getLanAccess({
    host:'192.168.1.32',port:4174,path:'/lan-check/'+'b'.repeat(32)
  });
  assert.equal(access.url,'http://192.168.1.32:4174/lan-check/'+'b'.repeat(32));
  assert.match(access.qrSvg,/data-qr-payload=/);
});

test('desktop and restaurant UI wire LAN phone test without migration or external dependency',()=>{
  const root=path.join(__dirname,'..');
  const main=fs.readFileSync(path.join(root,'desktop/main.cjs'),'utf8');
  const server=fs.readFileSync(path.join(root,'server/local-server.js'),'utf8');
  const preload=fs.readFileSync(path.join(root,'desktop/preload.cjs'),'utf8');
  const ui=fs.readFileSync(path.join(root,'desktop/renderer/restaurant-public-ordering-ui.js'),'utf8');
  assert.match(main,/artisys:public-network:challenge-status/);
  assert.match(server,/runtime\.lanReachability\?\.handle/);
  assert.match(preload,/challengeStatus:/);
  assert.match(ui,/Confirmar acesso pelo celular/);
  assert.match(ui,/confirmedLanHosts\.add/);
  assert.match(ui,/Antes de imprimir, confirme no celular/);
});
