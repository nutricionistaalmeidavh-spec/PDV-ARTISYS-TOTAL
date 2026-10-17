import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { buildModuleContractPlan, validateModuleProbeConfig } from '../qa/runtime/src/module-contracts.js';

const require=createRequire(import.meta.url);
const {MODULES}=require('../js/core/modules/module-registry.js');

function probes(){
  return JSON.parse(fs.readFileSync(new URL('../qa/crosscut/modules.json',import.meta.url),'utf8')).probes;
}

test('builds fully covered crosscut contracts for all real optional modules',()=>{
  const plan=buildModuleContractPlan({modules:MODULES,probes:probes()});
  assert.equal(MODULES.length,2);
  assert.equal(plan.contracts.length,2);
  assert.deepEqual(plan.coverage,{discovered:2,covered:2,uncovered:0,uncoveredCritical:0});

  const expected={
    FOOD:{launcher:'#sidebar-nav [data-route="FOOD"]',path:'/api/v1/restaurant/tables',heading:'Alimentação'},
    WHOLESALE:{launcher:'[data-route="WHOLESALE"]',path:'/api/v1/wholesale/orders',heading:'Atacado'}
  };

  for(const contract of plan.contracts){
    const item=expected[contract.moduleId];
    assert.ok(item,`unexpected module ${contract.moduleId}`);
    assert.equal(contract.critical,true,`${contract.moduleId} must be release critical`);
    assert.equal(contract.launcher.status,'covered',`${contract.moduleId} launcher`);
    assert.equal(contract.launcherSelector,item.launcher);
    assert.equal(contract.protected.status,'covered',`${contract.moduleId} protected probe`);
    assert.equal(contract.protectedProbe?.path,item.path);
    assert.equal(contract.supportsLiveSync,true,`${contract.moduleId} live sync`);
    assert.equal(contract.workspaceSelector,`[data-module-workspace="${contract.moduleId}"]`);
    assert.equal(contract.workspaceHeading,item.heading);
  }

});

test('validates unknown probes and missing module dependencies',()=>{
  const unknown=validateModuleProbeConfig({
    modules:MODULES,
    probes:{...probes(),NOT_A_MODULE:{reason:'invalid fixture'}}
  });
  assert.equal(unknown.ok,false);
  assert.ok(unknown.errors.includes('unknown module probe: NOT_A_MODULE'));

  const missingDependency=validateModuleProbeConfig({
    modules:[{id:'SAMPLE',dependsOn:['MISSING'],defaultEnabled:false}],
    probes:{}
  });
  assert.equal(missingDependency.ok,false);
  assert.ok(missingDependency.errors.includes('unknown dependency for SAMPLE: MISSING'));
});

test('requires explicit reasons for unmapped QA subcapabilities',()=>{
  const invalid=validateModuleProbeConfig({
    modules:[{id:'SAMPLE',dependsOn:[],defaultEnabled:false}],
    probes:{SAMPLE:{critical:false}}
  });
  assert.equal(invalid.ok,false);
  assert.ok(invalid.errors.some(error=>error.includes('SAMPLE')&&error.includes('reason')));
});
