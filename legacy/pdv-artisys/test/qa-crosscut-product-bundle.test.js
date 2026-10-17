import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductQaSummary } from '../qa/runtime/src/product-report.js';

test('crosscut product bundle preserves aggregate evidence and blocks critical findings',()=>{
  const summary=buildProductQaSummary({
    systemId:'pdv-artisys',
    profile:'crosscut',
    checks:[
      {name:'module:FOOD',category:'module-contract',status:'passed',critical:true},
      {name:'renderer-health',category:'renderer-health',status:'passed',critical:true},
    ],
    coverage:{discovered:9,covered:9,uncovered:0,uncoveredCritical:0},
    consoleErrors:[],
    networkErrors:[{type:'requestfailed',expected:true,url:'http://127.0.0.1/recovery'}],
    findings:[{code:'interactive-overlap',name:'overlap in critical action',severity:'critical'}],
    evidence:[
      {type:'qa-flow',flowId:'restaurant-module-sync-e2e',path:'qa-artifacts/restaurant-module-sync-e2e'},
      {type:'module-contract',moduleId:'FOOD',path:'qa-artifacts/module-food.json'},
    ],
  });

  assert.equal(summary.coverage.discovered,9);
  assert.equal(summary.findingCount,1);
  assert.equal(summary.networkErrorCount,1);
  assert.equal(summary.evidenceCount,2);
  assert.equal(summary.gate.allowed,false);
  assert.equal(summary.gate.blockers.some(item=>item.type==='critical-finding'),true);
  assert.equal(summary.gate.blockers.some(item=>item.type==='request-failure'),false);
});
