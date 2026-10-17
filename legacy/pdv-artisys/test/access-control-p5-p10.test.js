'use strict';

const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const {createPdvRuntime}=require('../js/core/pdv-runtime');
const {MODULES}=require('../js/core/modules/module-registry');

function runtimeFixture(){
  let seq=0;
  return createPdvRuntime({
    dbPath:':memory:',
    now:()=>new Date(Date.UTC(2026,9,3,18,0,seq++)).toISOString(),
    idFactory:prefix=>prefix+'-'+(++seq)
  });
}

test('P5 modules declare capabilities instead of human roles and enforce them canonically',()=>{
  for(const module of MODULES){
    assert.equal(typeof module.accessCapability,'string',module.id);
    assert.equal(typeof module.manageCapability,'string',module.id);
    assert.equal('accessRoles' in module,false,module.id);
    assert.equal('manageRoles' in module,false,module.id);
  }

  const runtime=runtimeFixture();
  try{
    const admin=runtime.catalog.createUser({id:'a1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-123'},{kind:'system',userId:'setup'});
    const limited=runtime.profiles.createProfile({
      name:'Food somente leitura',
      permissions:['restaurant.access']
    },{kind:'human',userId:admin.id});
    const user=runtime.catalog.createUser({
      id:'food1',username:'food',name:'Food',profileId:limited.id,password:'senha-food-123'
    },{kind:'human',userId:admin.id});

    assert.equal(runtime.modules.requireAccess('FOOD',{kind:'human',userId:user.id}),true);
    assert.throws(()=>runtime.modules.setEnabled('FOOD',false,{kind:'human',userId:user.id}),/permiss/i);
    runtime.modules.setEnabled('FOOD',false,{kind:'human',userId:admin.id});
    assert.throws(()=>runtime.modules.requireAccess('FOOD',{kind:'human',userId:user.id}),/desativado/i);
  }finally{runtime.close();}
});

test('P6 Access Center is a native route with Pessoas Perfis Dispositivos and Segurança',()=>{
  const ui=fs.readFileSync(path.join(__dirname,'../desktop/renderer/access-center-ui.js'),'utf8');
  assert.match(ui,/PdvRouteRegistry/);
  assert.match(ui,/register\(['"]access['"]/);
  for(const label of ['Pessoas','Perfis','Dispositivos','Segurança'])assert.ok(ui.includes(label),label);
  assert.doesNotMatch(ui,/Comiss[oõ]es/i);

  const server=fs.readFileSync(path.join(__dirname,'../server/access-control-router.js'),'utf8');
  for(const route of ['/api/v1/access/profiles','/api/v1/access/devices','/api/v1/access/security'])assert.ok(server.includes(route),route);
});

test('P7 renderer route authorization is declarative and capability based',()=>{
  const home=fs.readFileSync(path.join(__dirname,'../desktop/renderer/home-role-model.js'),'utf8');
  const policy=fs.readFileSync(path.join(__dirname,'../desktop/renderer/access-policy.js'),'utf8');
  const app=fs.readFileSync(path.join(__dirname,'../desktop/renderer/app.js'),'utf8');
  assert.doesNotMatch(home,/ROUTE_ACCESS/);
  assert.doesNotMatch(app,/routesForRole|canAccessRoute\(state\.user\?\.role/);
  assert.match(policy,/sales\.create/);
  assert.match(policy,/finance\.view/);
  assert.match(policy,/users\.view/);
});

test('P8 core production authorization no longer gates by roles or module role arrays',()=>{
  const files=[
    'js/core/modules/module-registry.js',
    'js/core/modules/module-service.js',
    'js/core/settings/settings-service.js',
    'server/router.js',
    'server/catalog-management-router.js',
    'server/vertical-router.js'
  ];
  for(const relative of files){
    const source=fs.readFileSync(path.join(__dirname,'..',relative),'utf8');
    assert.doesNotMatch(source,/\baccessRoles\b|\bmanageRoles\b|\brequireRole\s*\(|\bbusinessRole\s*\(/,relative);
  }
});

test('P9 session access projection and security events are first-class',()=>{
  const runtime=runtimeFixture();
  try{
    const admin=runtime.catalog.createUser({id:'a1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-123'},{kind:'system',userId:'setup'});
    const access=runtime.profiles.getUserAccess(admin.id);
    assert.equal(access.profile.systemKey,'admin');
    assert.equal(access.permissions.includes('security.view'),true);

    runtime.accessSecurity.record({action:'auth.login.success',actor:{kind:'human',userId:admin.id},context:{terminalId:'PDV-01'}});
    const recent=runtime.accessSecurity.listRecent({limit:10});
    assert.equal(recent.some(event=>event.action==='auth.login.success'&&event.actorId===admin.id),true);
  }finally{runtime.close();}
});

test('P10 authorization matrix fails closed across person profile module device surface and scope',()=>{
  const runtime=runtimeFixture();
  try{
    const admin=runtime.catalog.createUser({id:'a1',username:'admin',name:'Admin',profileId:'profile-administrator',password:'senha-admin-123'},{kind:'system',userId:'setup'});
    const cashier=runtime.catalog.createUser({id:'c1',username:'cashier',name:'Cashier',profileId:'profile-cashier',password:'senha-cashier-123'},{kind:'human',userId:admin.id});

    assert.equal(runtime.authorization.can({principal:{kind:'human',id:cashier.id},capability:'sales.create'}),true);
    assert.equal(runtime.authorization.can({principal:{kind:'human',id:cashier.id},capability:'finance.manage'}),false);
    assert.equal(runtime.authorization.can({principal:{kind:'human',id:cashier.id},capability:'unknown.capability'}),false);

    assert.throws(()=>runtime.mobileDevices.createDevice({id:'tab1',name:'Tablet',deviceType:'TABLET'}),/Tipo de dispositivo invalido/i);
    assert.throws(()=>runtime.mobileDevices.createDevice({id:'self1',name:'Totem',deviceType:'SELF_SERVICE'}),/Tipo de dispositivo invalido/i);

    runtime.modules.setEnabled('FOOD',false,{kind:'human',userId:admin.id});
    assert.throws(()=>runtime.modules.requireAccess('FOOD',{kind:'human',userId:admin.id}),/desativado/i);
  }finally{runtime.close();}
});
