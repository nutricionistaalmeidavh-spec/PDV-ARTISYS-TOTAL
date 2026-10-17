'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {AREAS,MODULES,getModuleDefinition,getAreaDefinition}=require('../js/core/modules/module-registry');
const {createModuleService}=require('../js/core/modules/module-service');

test('module registry exposes only flows that materially change the operation',()=>{
  assert.deepEqual(Object.keys(AREAS),['FOOD','WHOLESALE']);
  assert.deepEqual(MODULES.map(module=>module.id),['FOOD','WHOLESALE']);
  assert.equal(new Set(MODULES.map(module=>module.id)).size,MODULES.length);
  for(const module of MODULES){
    assert.ok(module.name&&module.description&&module.routeId&&module.icon);
    assert.ok(getAreaDefinition(module.area.id));
    assert.equal(typeof module.accessCapability,'string');
    assert.equal(typeof module.manageCapability,'string');
    assert.equal('accessRoles' in module,false);
    assert.equal('manageRoles' in module,false);
    for(const dependency of module.dependsOn)assert.ok(getModuleDefinition(dependency));
  }
  assert.equal(getAreaDefinition('FOOD').navigation,'module');
  assert.equal(getModuleDefinition('FOOD').name,'Alimentação');
  assert.equal(getModuleDefinition('WHOLESALE').name,'Atacado');
  assert.equal(getModuleDefinition('WHOLESALE').defaultEnabled,false);
  for(const legacy of ['RESTAURANT','PIZZERIA','DELIVERY','FAST_FOOD','MARKET_BAKERY','RETAIL','SELF_SERVICE','SERVICES','WORKSHOP'])assert.equal(getModuleDefinition(legacy),null);
});

test('module service exposes capability metadata and enforces module management through authorization',()=>{
  const values=new Map();
  const settings={
    get:(key,{defaultValue})=>values.has(key)?values.get(key):defaultValue,
    set:(key,value)=>{values.set(key,value);return{key,value};}
  };
  const authorization={
    require:({principal,capability})=>{
      if(principal?.kind==='system')return true;
      if(principal?.id==='admin'&&capability==='modules.manage')return true;
      if(principal?.id==='manager'&&capability==='restaurant.access')return true;
      throw Object.assign(new Error('Permissao insuficiente.'),{statusCode:403});
    }
  };
  const service=createModuleService({db:{},settings,authorization});
  const listed=service.list();
  const food=listed.find(module=>module.id==='FOOD');
  const wholesale=listed.find(module=>module.id==='WHOLESALE');
  assert.equal(food.routeId,'FOOD');
  assert.equal(food.area.routeId,'FOOD');
  assert.equal(food.enabled,true);
  assert.equal(food.accessCapability,'restaurant.access');
  assert.equal(food.manageCapability,'modules.manage');
  assert.equal(wholesale.enabled,false);
  assert.equal(wholesale.routeId,'WHOLESALE');
  assert.equal(service.requireAccess('FOOD',{kind:'human',userId:'manager'}),true);
  assert.throws(()=>service.setEnabled('FOOD',false,{kind:'human',userId:'manager'}),/Permissao insuficiente/);
  assert.equal(service.setEnabled('FOOD',false,{kind:'human',userId:'admin'}).enabled,false);
});
