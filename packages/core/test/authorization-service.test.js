'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  AuthorizationError,
  createAuthorizationService,
  normalizePrincipal
}=require('../js/core/auth/authorization-service');
const {permissionsForPublicResource}=require('../js/core/auth/public-resource-access');
const {DEFAULT_PROFILE_IDS}=require('../js/core/auth/default-profiles');

test('P2 canonical principals distinguish humans devices system and public resources',()=>{
  assert.deepEqual(normalizePrincipal({kind:'human',id:'u1'}),{kind:'human',id:'u1'});
  assert.deepEqual(
    normalizePrincipal({kind:'device',id:'d1',surface:'KITCHEN',userId:'u2'}),
    {kind:'device',id:'d1',surface:'kitchen',userId:'u2'}
  );
  assert.deepEqual(normalizePrincipal({kind:'system'}),{kind:'system',id:'system'});
  assert.deepEqual(
    normalizePrincipal({kind:'public-resource',id:'table-token',resourceType:'table',resourceId:'t1'}),
    {kind:'public-resource',id:'table-token',resourceType:'table',resourceId:'t1'}
  );
  assert.equal(normalizePrincipal(null),null);
  assert.equal(normalizePrincipal({kind:'human'}),null);
  assert.equal(normalizePrincipal({kind:'unknown',id:'x'}),null);
});

test('P2 authorization service fails closed and system only bypasses known capabilities',()=>{
  const authorization=createAuthorizationService({resolvePermissions:()=>['sales.view']});
  assert.equal(authorization.can({principal:{kind:'human',id:'u1'},capability:'sales.view'}),true);
  assert.equal(authorization.can({principal:{kind:'human',id:'u1'},capability:'sales.cancel'}),false);
  assert.equal(authorization.can({principal:{kind:'human',id:'u1'},capability:'made.up'}),false);
  assert.equal(authorization.can({principal:{kind:'system'},capability:'sales.cancel'}),true);
  assert.equal(authorization.can({principal:{kind:'system'},capability:'made.up'}),false);
  assert.equal(authorization.can({principal:null,capability:'sales.view'}),false);
});

test('P2 authorization composes capability with surface and resource policies',()=>{
  const authorization=createAuthorizationService({
    resolvePermissions:principal=>principal.kind==='device'?['kitchen.view','kitchen.update_status']:['sales.view'],
    surfacePolicy:({principal,capability,surface})=>principal.kind!=='device'||(principal.surface===surface&&capability.startsWith('kitchen.')),
    resourcePolicy:({resource})=>!resource||resource.allowed===true
  });
  const kitchen={kind:'device',id:'kds-1',surface:'kitchen'};
  assert.equal(authorization.can({principal:kitchen,capability:'kitchen.view',surface:'kitchen',resource:{allowed:true}}),true);
  assert.equal(authorization.can({principal:kitchen,capability:'kitchen.view',surface:'waiter',resource:{allowed:true}}),false);
  assert.equal(authorization.can({principal:kitchen,capability:'kitchen.view',surface:'kitchen',resource:{allowed:false}}),false);
});

test('P2 require returns authorization decision or throws a stable 403 error',()=>{
  const authorization=createAuthorizationService({resolvePermissions:()=>[]});
  assert.throws(
    ()=>authorization.require({principal:{kind:'human',id:'u1'},capability:'finance.manage'}),
    error=>error instanceof AuthorizationError&&error.statusCode===403&&error.code==='AUTHORIZATION_DENIED'&&error.capability==='finance.manage'
  );
  assert.equal(authorization.require({principal:{kind:'system'},capability:'finance.manage'}),true);
});

test('P2 public resource principals receive only explicit public capabilities',()=>{
  const publicTable={kind:'public-resource',id:'opaque-token',resourceType:'table',resourceId:'t1'};
  assert.equal(permissionsForPublicResource(publicTable).includes('public.menu.view'),true);
  assert.equal(permissionsForPublicResource(publicTable).includes('public.order.create'),true);
  assert.equal(permissionsForPublicResource(publicTable).includes('users.view'),false);
});


test('P2 runtime exposes canonical authorization service and P3 resolves humans from persisted profiles',()=>{
  const {createPdvRuntime}=require('../js/core/pdv-runtime');
  const runtime=createPdvRuntime({dbPath:':memory:'});
  try{
    const admin=runtime.catalog.createUser({id:'a1',username:'admin-p2',name:'Admin P2',profileId:DEFAULT_PROFILE_IDS.ADMINISTRATOR,password:'senha-admin-p2'});
    const cashier=runtime.catalog.createUser({id:'c1',username:'cashier-p2',name:'Cashier P2',profileId:DEFAULT_PROFILE_IDS.CASHIER,password:'senha-cashier-p2'});
    assert.ok(runtime.authorization);
    assert.equal(runtime.authorization.can({principal:{kind:'human',id:admin.id},capability:'profiles.edit'}),true);
    assert.equal(runtime.authorization.can({principal:{kind:'human',id:cashier.id},capability:'finance.manage'}),false);
    assert.equal(runtime.authorization.can({principal:{kind:'human',id:'ghost'},capability:'profiles.edit'}),false);
  }finally{runtime.close();}
});
