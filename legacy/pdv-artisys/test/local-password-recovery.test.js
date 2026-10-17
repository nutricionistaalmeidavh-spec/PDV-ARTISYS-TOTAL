'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {createLocalRecoveryService}=require('../js/core/auth/local-recovery-service');
const {createLocalServer}=require('../server/local-server');

test('offline key is hashed, rotated, consumed once and never logged',()=>{
  const runtime=createPdvRuntime();
  try{
    const user=runtime.catalog.createUser({username:'admin',name:'Admin',profileId:'profile-administrator',password:'old-password-123'});
    const service=createLocalRecoveryService({db:runtime.db,catalog:runtime.catalog});
    assert.throws(()=>service.issue({userId:user.id,password:'wrong'}),/senha atual/);
    const first=service.issue({userId:user.id,password:'old-password-123'}).key;
    const key=service.issue({userId:user.id,password:'old-password-123'}).key;
    assert.notEqual(runtime.db.prepare('SELECT key_hash FROM local_recovery_keys').get().key_hash,key);
    assert.throws(()=>service.recover({username:'admin',key:first,password:'new-password-123'}),/inválidos/);
    service.recover({username:'admin',key,password:'new-password-123'});
    assert.equal(runtime.catalog.verifyUserPassword('admin','old-password-123').ok,false);
    assert.equal(runtime.catalog.verifyUserPassword('admin','new-password-123').ok,true);
    assert.throws(()=>service.recover({username:'admin',key,password:'another-password-123'}),/inválidos/);
    assert.equal(runtime.db.prepare('SELECT COUNT(*) n FROM local_recovery_keys').get().n,0);
    assert.equal(JSON.stringify(runtime.db.prepare('SELECT * FROM audit_log').all()).includes(key),false);
  }finally{runtime.close();}
});

test('recovery rate limit survives recreating the service and rejects username switching',()=>{
  const runtime=createPdvRuntime();
  try{
    const opts={db:runtime.db,catalog:runtime.catalog,now:()=>1000};
    for(let i=0;i<5;i++)assert.throws(()=>createLocalRecoveryService(opts).recover({username:`unknown${i}`,key:'wrong',password:'new-password-123'}),/inválidos/);
    assert.throws(()=>createLocalRecoveryService(opts).recover({username:'different',key:'wrong',password:'new-password-123'}),error=>error.statusCode===429);
  }finally{runtime.close();}
});

test('failed password validation preserves the recovery key and user profile',()=>{
  const runtime=createPdvRuntime();
  try{
    const user=runtime.catalog.createUser({username:'cashier',name:'Caixa',profileId:'profile-cashier',password:'old-password-123'});
    const before=runtime.db.prepare('SELECT profile_id FROM users WHERE id=?').get(user.id);
    const service=createLocalRecoveryService({db:runtime.db,catalog:runtime.catalog});
    const {key}=service.issue({userId:user.id,password:'old-password-123'});
    assert.throws(()=>service.recover({username:'cashier',key,password:'short'}),/10 caracteres/);
    service.recover({username:'cashier',key,password:'new-password-123'});
    assert.deepEqual(runtime.db.prepare('SELECT profile_id FROM users WHERE id=?').get(user.id),before);
    assert.equal(runtime.catalog.getUser(user.id).profileId,'profile-cashier');
  }finally{runtime.close();}
});

test('offline API requires password challenge for generation and revokes active sessions after recovery',async()=>{
  const runtime=createPdvRuntime();
  runtime.catalog.createUser({username:'admin',name:'Admin',profileId:'profile-administrator',password:'old-password-123'});
  const server=createLocalServer({runtime,host:'127.0.0.1',port:0,token:'install'});
  const address=await server.start();const base=`http://${address.host}:${address.port}`;
  const post=(path,body,token)=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json','x-pdv-token':'install',...(token?{authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  try{
    const path='/api/v1/auth/password-recovery/';
    assert.equal((await post(path+'local-key',{password:'old-password-123'})).status,401);
    const login=await post('/api/v1/auth/login',{username:'admin',password:'old-password-123',terminalId:'PDV-01'});
    const token=(await login.json()).sessionToken;
    assert.equal((await post(path+'local-key',{password:'wrong'},token)).status,400);
    const issued=await post(path+'local-key',{password:'old-password-123'},token);assert.equal(issued.status,201);
    const {key}=await issued.json();assert.equal(key.length,64);
    const recovered=await post(path+'local-confirm',{username:'admin',key,password:'new-password-123'});assert.equal(recovered.status,200);
    const session=await fetch(base+'/api/v1/auth/session',{headers:{authorization:`Bearer ${token}`}});assert.equal(session.status,401);
    assert.equal((await post(path+'local-confirm',{username:'admin',key,password:'another-password-123'})).status,400);
  }finally{await server.stop();runtime.close();}
});
