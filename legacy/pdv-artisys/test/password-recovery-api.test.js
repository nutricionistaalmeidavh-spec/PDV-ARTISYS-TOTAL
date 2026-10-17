'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const { createPdvRuntime }=require('../js/core/pdv-runtime');
const { createAccountService }=require('../js/core/account/account-service');
const { createLocalServer }=require('../server/local-server');

const installHeaders={'content-type':'application/json','x-pdv-token':'installation-secret'};

async function start(){
  const calls=[];
  const runtime=createPdvRuntime({now:()=> '2026-09-26T12:00:00.000Z'});
  const user=runtime.catalog.createUser({username:'admin',name:'Admin',profileId:'profile-administrator',email:'owner@example.com',password:'senha-antiga-123'});
  const fetchImpl=async(url,options={})=>{
    const body=JSON.parse(options.body||'{}');calls.push({url,body});
    if(url.endsWith('/v1/password-recovery/request'))return{ok:true,status:202,json:async()=>({accepted:true})};
    if(url.endsWith('/v1/password-recovery/verify')&&body.code==='654321')return{ok:true,status:200,json:async()=>({verified:true,accountEmail:'owner@example.com'})};
    return{ok:false,status:400,json:async()=>({error:'Codigo de recuperacao invalido ou expirado.'})};
  };
  runtime.account=createAccountService({db:runtime.db,installationId:'install-1',endpoint:'https://account.example',fetchImpl,countUsers:()=>runtime.catalog.countUsers(),now:()=> '2026-09-26T12:00:00.000Z'});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'installation-secret'});
  const address=await server.start();
  return{runtime,user,calls,base:`http://${address.host}:${address.port}`,close:async()=>{await server.stop();runtime.close();}};
}

async function login(ctx,password){
  return fetch(`${ctx.base}/api/v1/auth/login`,{method:'POST',headers:installHeaders,body:JSON.stringify({username:'admin',password,terminalId:'PDV-01'})});
}

test('password recovery is enumeration-safe, changes only the local password and revokes prior sessions',async()=>{
  const ctx=await start();
  try{
    const before=await login(ctx,'senha-antiga-123');assert.equal(before.status,200);
    const sessionToken=(await before.json()).sessionToken;

    let response=await fetch(`${ctx.base}/api/v1/auth/password-recovery/request`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:' Owner@Example.COM '})});
    assert.equal(response.status,202);
    assert.deepEqual(await response.json(),{accepted:true,message:'Se os dados estiverem vinculados a esta instalacao, solicite o codigo de recuperacao ao administrador ArtiSys.'});
    assert.equal(ctx.calls.at(-1).body.email,'owner@example.com');

    response=await fetch(`${ctx.base}/api/v1/auth/password-recovery/confirm`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'owner@example.com',code:'654321',password:'senha-nova-456'})});
    assert.equal(response.status,200);
    assert.deepEqual(await response.json(),{reset:true});
    assert.deepEqual(Object.keys(ctx.calls.at(-1).body).sort(),['code','email','installationId']);

    const oldSession=await fetch(`${ctx.base}/api/v1/auth/session`,{headers:{authorization:`Bearer ${sessionToken}`}});
    assert.equal(oldSession.status,401);
    assert.equal((await login(ctx,'senha-antiga-123')).status,401);
    assert.equal((await login(ctx,'senha-nova-456')).status,200);

    const row=ctx.runtime.db.prepare('SELECT password_changed_at FROM users WHERE id=?').get(ctx.user.id);
    assert.equal(row.password_changed_at,'2026-09-26T12:00:00.000Z');
    const audit=ctx.runtime.db.prepare("SELECT action FROM audit_log WHERE entity_id=? ORDER BY created_at DESC LIMIT 1").get(ctx.user.id);
    assert.equal(audit.action,'user.password.reset');
  }finally{await ctx.close();}
});

test('invalid recovery code never changes the local password',async()=>{
  const ctx=await start();
  try{
    const response=await fetch(`${ctx.base}/api/v1/auth/password-recovery/confirm`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'owner@example.com',code:'000000',password:'senha-nova-456'})});
    assert.equal(response.status,400);
    assert.equal((await login(ctx,'senha-antiga-123')).status,200);
  }finally{await ctx.close();}
});

test('recovery request keeps unknown local e-mail indistinguishable',async()=>{
  const ctx=await start();
  try{
    const response=await fetch(`${ctx.base}/api/v1/auth/password-recovery/request`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'missing@example.com'})});
    assert.equal(response.status,202);
    assert.deepEqual(await response.json(),{accepted:true,message:'Se os dados estiverem vinculados a esta instalacao, solicite o codigo de recuperacao ao administrador ArtiSys.'});
  }finally{await ctx.close();}
});