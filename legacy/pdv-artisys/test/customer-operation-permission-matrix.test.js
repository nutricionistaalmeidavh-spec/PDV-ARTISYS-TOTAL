'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createAuthorizationService}=require('../js/core/auth/authorization-service');
const {isKnownPermission}=require('../js/core/auth/permission-registry');
const {DEFAULT_PROFILES}=require('../js/core/auth/default-profiles');

const registry=JSON.parse(fs.readFileSync(path.join(__dirname,'..','release','customer-operations.json'),'utf8'));

test('every customer/admin operation has known permissions and the default-profile allow/deny matrix is deterministic',()=>{
  const operations=registry.operations.filter(operation=>operation.exposure!=='internal');
  assert.ok(operations.length>0);
  for(const operation of operations){
    assert.ok(Array.isArray(operation.permissions)&&operation.permissions.length>0,operation.id);
    assert.ok(DEFAULT_PROFILES.some(profile=>operation.permissions.every(permission=>profile.permissions.includes(permission))),operation.id+' is unreachable for every default profile');
    for(const permission of operation.permissions)assert.equal(isKnownPermission(permission),true,operation.id+': '+permission);
    for(const profile of DEFAULT_PROFILES){
      const granted=new Set(profile.permissions);
      const auth=createAuthorizationService({resolvePermissions:()=>profile.permissions});
      const principal={kind:'human',id:'qa-'+profile.id};
      for(const permission of operation.permissions){
        assert.equal(
          auth.can({principal,capability:permission}),
          granted.has(permission),
          operation.id+' / '+profile.id+' / '+permission
        );
      }
    }
  }
});

test('each registered operation permission denies a principal that has none of its grants',()=>{
  const auth=createAuthorizationService({resolvePermissions:()=>[]});
  for(const operation of registry.operations.filter(item=>item.exposure!=='internal')){
    for(const permission of operation.permissions){
      assert.equal(auth.can({principal:{kind:'human',id:'qa-denied'},capability:permission}),false,operation.id+' / '+permission);
      assert.throws(()=>auth.require({principal:{kind:'human',id:'qa-denied'},capability:permission}),/Permissao insuficiente/);
    }
  }
});
