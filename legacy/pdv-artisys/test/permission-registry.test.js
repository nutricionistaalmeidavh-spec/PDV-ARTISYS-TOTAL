'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {
  PERMISSION_GROUPS,
  PERMISSIONS,
  getPermissionDefinition,
  listPermissions,
  isKnownPermission
}=require('../js/core/auth/permission-registry');

const REQUIRED_PERMISSIONS=[
  'sales.view','sales.create','sales.discount','sales.cancel',
  'cash.view','cash.open','cash.close','cash.withdraw',
  'customers.view','customers.manage','products.view','products.manage',
  'inventory.view','inventory.adjust',
  'restaurant.access','restaurant.orders.view','restaurant.orders.create','restaurant.orders.transfer','restaurant.tables.manage',
  'kitchen.view','kitchen.update_status','kitchen.configure',
  'wholesale.access',
  'finance.view','finance.manage','reports.view',
  'users.view','users.create','users.edit','users.disable',
  'profiles.view','profiles.create','profiles.edit','profiles.assign',
  'devices.view','devices.pair','devices.block','devices.rotate_credential',
  'modules.view','modules.manage','settings.view','settings.manage','deployment.manage','security.view','audit.view'
];

test('P1 permission registry is canonical, unique and immutable',()=>{
  assert.ok(Object.isFrozen(PERMISSION_GROUPS));
  assert.ok(Object.isFrozen(PERMISSIONS));
  assert.ok(PERMISSIONS.length>=REQUIRED_PERMISSIONS.length);

  const ids=PERMISSIONS.map(item=>item.id);
  assert.equal(new Set(ids).size,ids.length,'permission ids must be unique');

  for(const permission of PERMISSIONS){
    assert.ok(Object.isFrozen(permission),permission.id);
    assert.match(permission.id,/^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9_]*)+$/);
    assert.ok(PERMISSION_GROUPS[permission.group],permission.id);
    assert.equal(typeof permission.label,'string');
    assert.ok(permission.label.trim().length>0,permission.id);
    assert.equal(typeof permission.description,'string');
    assert.ok(permission.description.trim().length>0,permission.id);
  }

  for(const id of REQUIRED_PERMISSIONS)assert.equal(isKnownPermission(id),true,id);
});

test('P1 permission lookup normalizes ids and group listing is deterministic',()=>{
  assert.equal(getPermissionDefinition('  SALES.CREATE  ')?.id,'sales.create');
  assert.equal(getPermissionDefinition('unknown.permission'),null);

  const access=listPermissions({group:'access'});
  assert.ok(access.length>0);
  assert.ok(access.every(permission=>permission.group==='access'));
  assert.deepEqual(access.map(permission=>permission.id),[...access.map(permission=>permission.id)].sort());

  const all=listPermissions();
  assert.deepEqual(all.map(permission=>permission.id),[...all.map(permission=>permission.id)].sort());
});

test('P1 registry keeps surfaces/modules distinct from human profile names',()=>{
  for(const forbidden of ['admin','manager','cashier','waiter','tablet','kds','self_service','food']){
    assert.equal(isKnownPermission(forbidden),false,forbidden);
  }
  assert.equal(isKnownPermission('restaurant.access'),true);
  assert.equal(isKnownPermission('kitchen.view'),true);
  assert.equal(isKnownPermission('modules.manage'),true);
});
