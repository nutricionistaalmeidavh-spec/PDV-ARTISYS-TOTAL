'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const ui=require('../desktop/renderer/ui-model');
const policy=require('../desktop/renderer/access-policy');
const {homeForUser}=require('../desktop/renderer/home-role-model');

const baseTiles=[...ui.HOME_TILES,{key:'management',label:'Gestão',description:'Resultado, DRE e fluxo de caixa',route:'management',tone:'cyan',icon:'chart'}];
const user=permissions=>({profile:{id:'profile-test',name:'Perfil'},permissions});
const keys=permissions=>homeForUser(user(permissions),baseTiles).sections.flatMap(section=>section.tiles.map(tile=>tile.key));

test('operator Home is derived from capabilities',()=>{
  assert.deepEqual(keys(['sales.create','sales.view','returns.view','cash.view','customers.view','products.view']),['checkout','cash','post-sale','catalog']);
});

test('management and access hubs appear only for granted capabilities',()=>{
  assert.deepEqual(
    keys(['sales.create','sales.view','returns.view','cash.view','customers.view','products.view','inventory.view','finance.view','reports.view','management.view']),
    ['checkout','cash','post-sale','catalog','financial-management']
  );
  assert.deepEqual(
    keys(['sales.create','sales.view','returns.view','cash.view','customers.view','products.view','inventory.view','finance.view','reports.view','management.view','users.view','settings.view']),
    ['checkout','cash','post-sale','catalog','financial-management','access','settings']
  );
});

test('route policy checks capabilities rather than role/profile names',()=>{
  const operator=user(['sales.create','sales.view','returns.view','cash.view','customers.view','products.view']);
  assert.equal(policy.canAccessRoute(operator,'catalog'),true);
  assert.equal(policy.canAccessRoute(operator,'customers'),true);
  assert.equal(policy.canAccessRoute(operator,'products'),true);
  assert.equal(policy.canAccessRoute(operator,'reports'),false);
  assert.equal(policy.canAccessRoute(operator,'settings'),false);

  const manager=user(['products.view','inventory.view','sellers.view','finance.view','reports.view','management.view']);
  assert.equal(policy.canAccessRoute(manager,'products'),true);
  assert.equal(policy.canAccessRoute(manager,'inventory'),true);
  assert.equal(policy.canAccessRoute(manager,'sellers'),true);
  assert.equal(policy.canAccessRoute(manager,'financial-management'),true);
});


test('Access Center derives partial tabs, loads and actions from capabilities',()=>{
  const manager=user(['users.view','users.create','users.edit','users.reset_password']);
  const managerModel=policy.accessCenterModel(manager);
  assert.deepEqual(managerModel.tabs,['people']);
  assert.deepEqual(managerModel.load,{users:true,profiles:false,permissions:false,devices:false,security:false});
  assert.equal(managerModel.actions.createPerson,true);
  assert.equal(managerModel.actions.editPerson,true);
  assert.equal(managerModel.actions.resetPassword,true);
  assert.equal(managerModel.actions.assignProfile,false);
  assert.equal(managerModel.actions.createProfile,false);
  assert.equal(managerModel.actions.pairDevice,false);
  assert.equal(managerModel.actions.revokeSession,false);

  const readOnly=user(['users.view']);
  const readOnlyModel=policy.accessCenterModel(readOnly);
  assert.deepEqual(readOnlyModel.tabs,['people']);
  assert.deepEqual(readOnlyModel.load,{users:true,profiles:false,permissions:false,devices:false,security:false});
  assert.equal(Object.values(readOnlyModel.actions).some(Boolean),false);

  const deviceAdmin=user(['devices.view','devices.block','devices.rotate_credential']);
  const deviceModel=policy.accessCenterModel(deviceAdmin);
  assert.deepEqual(deviceModel.tabs,['devices']);
  assert.deepEqual(deviceModel.load,{users:false,profiles:false,permissions:false,devices:true,security:false});
  assert.equal(deviceModel.actions.blockDevice,true);
  assert.equal(deviceModel.actions.rotateDeviceCredential,true);
  assert.equal(deviceModel.actions.pairDevice,false);
});

test('Access Center only exposes profile assignment when profile catalog is visible',()=>{
  const assignOnly=user(['users.view','profiles.assign']);
  assert.equal(policy.accessCenterModel(assignOnly).actions.assignProfile,false);
  const assignWithView=user(['users.view','profiles.view','profiles.assign']);
  const model=policy.accessCenterModel(assignWithView);
  assert.deepEqual(model.tabs,['people','profiles']);
  assert.equal(model.actions.assignProfile,true);
  assert.equal(model.load.profiles,true);
  assert.equal(model.load.permissions,true);
});


test('desktop common-data loading is capability-aware for partial profiles',()=>{
  const readOnly=user(['users.view']);
  assert.deepEqual(policy.commonDataLoadPlan(readOnly),{
    categories:false,
    products:false,
    productPhotos:false,
    customers:false,
    sellers:false,
    users:true,
    cash:false
  });

  const operator=user(['sales.create','products.view','customers.view','cash.view']);
  assert.deepEqual(policy.commonDataLoadPlan(operator),{
    categories:true,
    products:true,
    productPhotos:true,
    customers:true,
    sellers:false,
    users:false,
    cash:true
  });
});
