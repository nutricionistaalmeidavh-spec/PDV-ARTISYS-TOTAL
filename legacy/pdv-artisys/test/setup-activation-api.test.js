'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createAccountService } = require('../js/core/account/account-service');
const { createLocalServer } = require('../server/local-server');

async function start({ existing=false, offline=false }={}) {
  const runtime=createPdvRuntime({ now:()=> '2026-09-25T22:00:00.000Z', idFactory:(prefix)=>`${prefix}-${Math.random()}` });
  if(existing) runtime.catalog.createUser({username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-forte-123'});
  const fetchImpl=offline
    ? async()=>{ throw new Error('offline'); }
    : async(url)=> url.endsWith('/request')
      ? ({ok:true,status:202,json:async()=>({accepted:true})})
      : ({ok:true,status:200,json:async()=>({licenseId:'lic-1',accountEmail:'owner@example.com'})});
  runtime.account=createAccountService({
    db:runtime.db,installationId:'install-1',endpoint:'https://account.example',requireCommercialActivation:true,
    countUsers:()=>runtime.catalog.countUsers(),fetchImpl,now:()=> '2026-09-25T22:00:00.000Z'
  });
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'installation-secret'});
  const address=await server.start();
  return {runtime,server,base:`http://${address.host}:${address.port}`,close:async()=>{await server.stop();runtime.close();}};
}

const installHeaders={'content-type':'application/json','x-pdv-token':'installation-secret'};

test('new installation requires commercial activation, binds the owner email and issues an offline recovery key', async()=>{
  const ctx=await start();
  try{
    let res=await fetch(`${ctx.base}/api/v1/setup/status`);
    let body=await res.json();
    assert.equal(body.needsSetup,true);
    assert.equal(body.activation.required,true);

    res=await fetch(`${ctx.base}/api/v1/setup/admin`,{method:'POST',headers:installHeaders,body:JSON.stringify({username:'admin',name:'Admin',password:'senha-forte-123'})});
    assert.equal(res.status,409);

    res=await fetch(`${ctx.base}/api/v1/setup/activation/request`,{method:'POST',headers:installHeaders,body:JSON.stringify({email:'owner@example.com'})});
    assert.equal(res.status,202);
    res=await fetch(`${ctx.base}/api/v1/setup/activation/verify`,{method:'POST',headers:installHeaders,body:JSON.stringify({email:'owner@example.com',code:'123456'})});
    assert.equal(res.status,200);

    res=await fetch(`${ctx.base}/api/v1/setup/admin`,{method:'POST',headers:installHeaders,body:JSON.stringify({username:'admin',name:'Admin',email:'other@example.com',password:'senha-forte-123'})});
    assert.equal(res.status,409);

    res=await fetch(`${ctx.base}/api/v1/setup/admin`,{method:'POST',headers:installHeaders,body:JSON.stringify({username:'admin',name:'Admin',password:'senha-forte-123'})});
    assert.equal(res.status,409);

    res=await fetch(`${ctx.base}/api/v1/setup/admin`,{method:'POST',headers:installHeaders,body:JSON.stringify({username:'admin',name:'Admin',email:'OWNER@example.com',password:'senha-forte-123'})});
    assert.equal(res.status,201);
    const admin=await res.json();
    assert.equal(admin.email,'owner@example.com');
    assert.equal(admin.profileId,'profile-administrator');
    assert.equal(admin.recoveryKey.length,64);
    assert.equal(ctx.runtime.account.activation().ownerUserId,admin.id);

    const recovery=await fetch(`${ctx.base}/api/v1/auth/password-recovery/local-confirm`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:'admin',key:admin.recoveryKey,password:'nova-senha-forte-123'})});
    assert.equal(recovery.status,200);
    assert.equal(ctx.runtime.catalog.verifyUserPassword('admin','nova-senha-forte-123').ok,true);

    const duplicate=await fetch(`${ctx.base}/api/v1/setup/admin`,{method:'POST',headers:installHeaders,body:JSON.stringify({username:'other',name:'Other',email:'owner@example.com',password:'senha-forte-123'})});
    assert.equal(duplicate.status,409);
  }finally{await ctx.close();}
});

test('existing unactivated installation cannot bypass commercial activation through local login', async()=>{
  const ctx=await start({existing:true});
  try{
    let res=await fetch(`${ctx.base}/api/v1/setup/status`);
    const status=await res.json();
    assert.equal(status.needsSetup,false);
    assert.equal(status.activation.required,true);

    res=await fetch(`${ctx.base}/api/v1/auth/login`,{method:'POST',headers:installHeaders,body:JSON.stringify({username:'admin',password:'senha-forte-123',terminalId:'PDV-01'})});
    assert.equal(res.status,403);

    res=await fetch(`${ctx.base}/api/v1/setup/activation/verify`,{method:'POST',headers:installHeaders,body:JSON.stringify({email:'owner@example.com',code:'123456'})});
    assert.equal(res.status,200);

    res=await fetch(`${ctx.base}/api/v1/auth/login`,{method:'POST',headers:installHeaders,body:JSON.stringify({username:'admin',password:'senha-forte-123',terminalId:'PDV-01'})});
    assert.equal(res.status,200);
  } finally { await ctx.close(); }
});
