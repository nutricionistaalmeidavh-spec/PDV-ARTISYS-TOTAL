'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

function fixture(){
  let seq=0;
  return createPdvRuntime({
    dbPath:':memory:',
    now:()=> '2026-10-03T16:30:00.000Z',
    idFactory:prefix=>`${prefix}-${++seq}`
  });
}

test('P3 fresh installs bootstrap canonical profiles and bind new users by profile_id',()=>{
  const runtime=fixture();
  try{
    const profiles=runtime.accessProfiles.listProfiles();
    const admin=profiles.find(profile=>profile.systemKey==='admin');
    const manager=profiles.find(profile=>profile.systemKey==='manager');
    const operator=profiles.find(profile=>profile.systemKey==='operator');

    assert.ok(admin&&manager&&operator);
    assert.equal(admin.protected,true);
    assert.equal(manager.protected,true);
    assert.equal(operator.protected,true);
    assert.equal(admin.permissions.includes('profiles.edit'),true);
    assert.equal(admin.permissions.includes('public.menu.view'),false);
    assert.equal(manager.permissions.includes('returns.approve'),true);
    assert.equal(operator.permissions.includes('returns.manage'),false);
    assert.equal(runtime.db.prepare('SELECT name FROM schema_migrations WHERE version=27').get()?.name,'pdv_access_capability_returns_approval_v27');

    const user=runtime.catalog.createUser({
      id:'u1',username:'op',name:'Operador',profileId:'profile-operator',password:'senha-forte-123'
    },{kind:'system',id:'system'});
    assert.equal(user.profileId,operator.id);

    const stored=runtime.db.prepare('SELECT profile_id FROM users WHERE id=?').get(user.id);
    assert.equal(stored.profile_id,operator.id);
  }finally{runtime.close();}
});

test('P3 custom profiles drive canonical human authorization from persisted profiles',()=>{
  const runtime=fixture();
  try{
    const admin=runtime.catalog.createUser({
      id:'admin1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-123'
    },{kind:'system',id:'system'});
    const custom=runtime.accessProfiles.createProfile({
      name:'Consulta de estoque',
      permissions:['products.view','inventory.view']
    },{kind:'system',id:'system'});
    const user=runtime.catalog.createUser({
      id:'stock1',username:'estoque',name:'Estoque',profileId:custom.id,password:'senha-estoque-123'
    },{userId:admin.id,profileId:'profile-administrator'});

    assert.equal(runtime.authorization.can({principal:{kind:'human',id:user.id},capability:'inventory.view'}),true);
    assert.equal(runtime.authorization.can({principal:{kind:'human',id:user.id},capability:'sales.create'}),false);
    assert.equal(runtime.catalog.getUser(user.id).profileId,custom.id);
  }finally{runtime.close();}
});

test('P3 blocks capability escalation and protects the Administrator profile',()=>{
  const runtime=fixture();
  try{
    const admin=runtime.catalog.createUser({
      id:'admin1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-123'
    },{kind:'system',id:'system'});
    const manager=runtime.catalog.createUser({
      id:'manager1',username:'manager',name:'Gerente',profileId:'profile-manager',password:'senha-manager-123'
    },{userId:admin.id,profileId:'profile-administrator'});

    assert.throws(
      ()=>runtime.accessProfiles.createProfile({name:'Escalado',permissions:['profiles.edit']},{kind:'human',id:manager.id}),
      /conceder|permiss/i
    );

    const administrator=runtime.accessProfiles.getProfileBySystemKey('admin');
    assert.throws(
      ()=>runtime.accessProfiles.updateProfile(administrator.id,{name:'Admin alterado',permissions:['sales.view']},{kind:'system',id:'system'}),
      /protegido/i
    );
    assert.throws(
      ()=>runtime.accessProfiles.deleteProfile(administrator.id,{kind:'system',id:'system'}),
      /protegido/i
    );
  }finally{runtime.close();}
});

test('P4 devices expose authentication, surface, scope and optional human binding separately',()=>{
  const runtime=fixture();
  try{
    const admin=runtime.catalog.createUser({
      id:'admin1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-123'
    },{kind:'system',id:'system'});
    const waiterUser=runtime.catalog.createUser({
      id:'waiter1',username:'garcom',name:'Garcom',profileId:'profile-cashier',password:'senha-garcom-123'
    },{userId:admin.id,profileId:'profile-administrator'});

    const waiter=runtime.mobileDevices.createDevice({id:'w1',name:'Garcom 1',deviceType:'WAITER',userId:waiterUser.id});
    const kitchen=runtime.mobileDevices.createDevice({id:'k1',name:'KDS',deviceType:'KITCHEN'});
    assert.throws(()=>runtime.mobileDevices.createDevice({id:'tab1',name:'Tablet Mesa',deviceType:'TABLET'}),/Tipo de dispositivo invalido/i);
    assert.throws(()=>runtime.mobileDevices.createDevice({id:'self1',name:'Totem',deviceType:'SELF_SERVICE'}),/Tipo de dispositivo invalido/i);
    assert.deepEqual({surface:waiter.surface,scope:waiter.scope,userId:waiter.userId},{surface:'waiter',scope:{type:'establishment',id:null},userId:waiterUser.id});
    assert.deepEqual({surface:kitchen.surface,scope:kitchen.scope},{surface:'kitchen',scope:{type:'establishment',id:null}});
    const storedSecret=runtime.db.prepare('SELECT credential_hash FROM mobile_devices WHERE id=?').get(kitchen.id).credential_hash;
    assert.equal(storedSecret.includes(kitchen.credential),false);
  }finally{runtime.close();}
});
test('P4 device authorization uses canonical waiter and kitchen surfaces',()=>{
  const runtime=fixture();
  try{
    runtime.catalog.createUser({
      id:'admin1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-123'
    },{kind:'system',id:'system'});
    const kitchen=runtime.mobileDevices.createDevice({id:'k1',name:'KDS',deviceType:'KITCHEN'});

    const kitchenAuth=runtime.mobileDevices.authenticatePrincipal(kitchen.id,kitchen.credential);

    assert.equal(kitchenAuth.ok,true);
    assert.equal(runtime.authorization.can({principal:kitchenAuth.principal,capability:'kitchen.update_status'}),true);
    assert.equal(runtime.authorization.can({principal:kitchenAuth.principal,capability:'restaurant.orders.create'}),false);

    const oldCredential=kitchen.credential;
    const rotated=runtime.mobileDevices.rotateCredential(kitchen.id,{userId:'admin1',profileId:'profile-administrator'});
    assert.equal(runtime.mobileDevices.authenticatePrincipal(kitchen.id,oldCredential).ok,false);
    assert.equal(runtime.mobileDevices.authenticatePrincipal(kitchen.id,rotated.credential).ok,true);
  }finally{runtime.close();}
});
