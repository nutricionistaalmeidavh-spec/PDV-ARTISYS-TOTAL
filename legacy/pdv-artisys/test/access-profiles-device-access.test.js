'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {createPdvRuntime}=require('../js/core/pdv-runtime');

function fixture(){
  let seq=0;
  const runtime=createPdvRuntime({
    dbPath:':memory:',
    now:()=>new Date(Date.UTC(2026,9,3,16,0,seq++)).toISOString(),
    idFactory:prefix=>`${prefix}-${++seq}`,
    appVersion:'1.4.23',
    serverVersion:'1.4.23'
  });
  return runtime;
}

test('P3 clean install bootstraps canonical profiles and users receive profile_id',()=>{
  const runtime=fixture();
  try{
    const profiles=runtime.profiles.listProfiles({includeInactive:true});
    const adminProfile=profiles.find(profile=>profile.systemKey==='admin');
    const managerProfile=profiles.find(profile=>profile.systemKey==='manager');
    const operatorProfile=profiles.find(profile=>profile.systemKey==='operator');

    assert.ok(adminProfile);
    assert.ok(managerProfile);
    assert.ok(operatorProfile);
    assert.equal(adminProfile.protected,true);
    assert.equal(managerProfile.protected,true);
    assert.equal(operatorProfile.protected,true);
    assert.equal(adminProfile.permissions.includes('profiles.edit'),true);
    assert.equal(managerProfile.permissions.includes('profiles.edit'),false);

    const admin=runtime.catalog.createUser({id:'a1',username:'admin',name:'Administrador',profileId:'profile-administrator',password:'senha-admin-123'});
    const manager=runtime.catalog.createUser({id:'m1',username:'gerente',name:'Gerente',profileId:'profile-manager',password:'senha-manager-123'});
    const operator=runtime.catalog.createUser({id:'o1',username:'operador',name:'Operador',profileId:'profile-operator',password:'senha-operador-123'});

    assert.equal(admin.profileId,adminProfile.id);
    assert.equal(manager.profileId,managerProfile.id);
    assert.equal(operator.profileId,operatorProfile.id);
    assert.equal(runtime.authorization.can({principal:{kind:'human',id:admin.id},capability:'profiles.edit'}),true);
    assert.equal(runtime.authorization.can({principal:{kind:'human',id:manager.id},capability:'profiles.edit'}),false);
  }finally{runtime.close();}
});

test('P3 creates configurable profiles, enforces anti-escalation and assigns safely',()=>{
  const runtime=fixture();
  try{
    const admin=runtime.catalog.createUser({id:'a1',username:'admin',name:'Administrador',profileId:'profile-administrator',password:'senha-admin-123'});
    const manager=runtime.catalog.createUser({id:'m1',username:'gerente',name:'Gerente',profileId:'profile-manager',password:'senha-manager-123'});
    const operator=runtime.catalog.createUser({id:'o1',username:'operador',name:'Operador',profileId:'profile-cashier',password:'senha-operador-123'});

    const waiterProfile=runtime.profiles.createProfile({
      name:'Garçom',
      permissions:['restaurant.access','restaurant.orders.view','restaurant.orders.create']
    },{userId:admin.id,profileId:'profile-administrator'});

    assert.equal(waiterProfile.protected,false);
    assert.deepEqual(waiterProfile.permissions,['restaurant.access','restaurant.orders.create','restaurant.orders.view']);

    const assigned=runtime.profiles.assignProfile(operator.id,waiterProfile.id,{userId:admin.id,profileId:'profile-administrator'});
    assert.equal(assigned.profileId,waiterProfile.id);
    assert.equal(assigned.profileId,waiterProfile.id);
    assert.equal(runtime.authorization.can({principal:{kind:'human',id:operator.id},capability:'restaurant.orders.create'}),true);
    assert.equal(runtime.authorization.can({principal:{kind:'human',id:operator.id},capability:'finance.manage'}),false);

    assert.throws(
      ()=>runtime.profiles.createProfile({name:'Escalada',permissions:['profiles.edit']},{userId:manager.id,profileId:'profile-manager'}),
      /Permissao insuficiente|AUTHORIZATION_DENIED/i
    );

    const adminProfile=runtime.profiles.listProfiles().find(profile=>profile.systemKey==='admin');
    assert.throws(()=>runtime.profiles.updateProfile(adminProfile.id,{name:'Admin alterado'},{userId:admin.id,profileId:'profile-administrator'}),/protegido/i);
    assert.throws(()=>runtime.profiles.deleteProfile(adminProfile.id,{userId:admin.id,profileId:'profile-administrator'}),/protegido/i);
  }finally{runtime.close();}
});

test('P3 installation owner cannot leave the protected Administrator profile',()=>{
  const runtime=fixture();
  try{
    const admin=runtime.catalog.createUser({id:'owner1',username:'owner',name:'Owner',profileId:'profile-administrator',email:'owner@example.com',password:'senha-owner-123'});
    runtime.db.prepare(`INSERT INTO installation_activation(installation_id,account_email,license_id,activated_at,activation_source,metadata_json,owner_user_id)
      VALUES(?,?,?,?,?,?,?)`).run('local','owner@example.com','lic-owner','2026-10-03T16:00:00.000Z','test','{}',admin.id);
    const custom=runtime.profiles.createProfile({name:'Gestão limitada',permissions:['reports.view']},{userId:admin.id,profileId:'profile-administrator'});
    assert.throws(()=>runtime.profiles.assignProfile(admin.id,custom.id,{userId:admin.id,profileId:'profile-administrator'}),/proprietario|Administrador/i);
    const current=runtime.catalog.getUser(admin.id);
    assert.equal(runtime.profiles.getProfile(current.profileId).systemKey,'admin');
  }finally{runtime.close();}
});

test('P4 device access separates credential, surface, scope and human binding',()=>{
  const runtime=fixture();
  try{
    const admin=runtime.catalog.createUser({id:'a1',username:'admin',name:'Administrador',profileId:'profile-administrator',password:'senha-admin-123'});

    const waiter=runtime.mobileDevices.createDevice({id:'w1',name:'Garçom João',deviceType:'WAITER',userId:admin.id});
    const kitchen=runtime.mobileDevices.createDevice({id:'k1',name:'KDS Cozinha',deviceType:'KITCHEN'});
    assert.throws(()=>runtime.mobileDevices.createDevice({id:'tab1',name:'Tablet Mesa 1',deviceType:'TABLET'}),/Tipo de dispositivo invalido/i);
    assert.throws(()=>runtime.mobileDevices.createDevice({id:'self1',name:'Totem Entrada',deviceType:'SELF_SERVICE'}),/Tipo de dispositivo invalido/i);
    assert.equal(waiter.surface,'waiter');
    assert.equal(waiter.userId,admin.id);
    assert.deepEqual(waiter.scope,{type:'establishment',id:null});
    assert.equal(kitchen.surface,'kitchen');
    assert.deepEqual(kitchen.scope,{type:'establishment',id:null});

    const raw=runtime.db.prepare('SELECT credential_hash,surface,scope_type,scope_id FROM mobile_devices WHERE id=?').get(kitchen.id);
    assert.equal(raw.credential_hash.includes(kitchen.credential),false);
    assert.equal(raw.surface,'kitchen');
    assert.equal(raw.scope_type,'establishment');
    assert.equal(raw.scope_id,null);

    const authenticated=runtime.deviceAccess.authenticate(kitchen.id,kitchen.credential);
    assert.equal(authenticated.ok,true);
    assert.deepEqual(authenticated.principal,{kind:'device',id:kitchen.id,surface:'kitchen',userId:null,scope:{type:'establishment',id:null}});
    assert.equal(runtime.authorization.can({principal:authenticated.principal,capability:'kitchen.update_status'}),true);
    assert.equal(runtime.authorization.can({principal:authenticated.principal,capability:'finance.manage'}),false);

    const waiterAuth=runtime.deviceAccess.authenticate(waiter.id,waiter.credential);
    assert.equal(waiterAuth.ok,true);
    assert.equal(runtime.authorization.can({principal:waiterAuth.principal,capability:'finance.manage'}),false,'binding a device to an admin must not inherit admin permissions');
  }finally{runtime.close();}
});
test('P4 blocking and credential rotation remain device-authentication concerns',()=>{
  const runtime=fixture();
  try{
    const kitchen=runtime.mobileDevices.createDevice({id:'k1',name:'KDS Cozinha',deviceType:'KITCHEN'});
    assert.equal(runtime.deviceAccess.authenticate(kitchen.id,kitchen.credential).ok,true);

    runtime.mobileDevices.setStatus(kitchen.id,'BLOCKED',{kind:'system',id:'system'});
    assert.equal(runtime.deviceAccess.authenticate(kitchen.id,kitchen.credential).ok,false);

    const rotated=runtime.mobileDevices.rotateCredential(kitchen.id,{kind:'system',id:'system'});
    assert.equal(runtime.deviceAccess.authenticate(kitchen.id,kitchen.credential).ok,false);
    assert.equal(runtime.deviceAccess.authenticate(kitchen.id,rotated.credential).ok,true);
  }finally{runtime.close();}
});
