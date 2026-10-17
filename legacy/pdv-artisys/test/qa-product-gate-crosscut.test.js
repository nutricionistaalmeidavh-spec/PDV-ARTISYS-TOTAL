import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProductGate, buildProductQaSummary } from '../qa/runtime/src/product-report.js';

test('expected network failures do not block product gate but unexpected failures do',()=>{
  const expected=evaluateProductGate({
    networkErrors:[
      {type:'requestfailed',url:'http://local.test/retry',expected:true},
      {type:'http',status:503,url:'http://local.test/recovery',expected:true}
    ]
  });
  assert.equal(expected.allowed,true);
  assert.equal(expected.blockers.some(item=>item.type==='request-failure'),false);
  assert.equal(expected.blockers.some(item=>item.type==='http-5xx'),false);

  const unexpected=evaluateProductGate({
    networkErrors:[{type:'requestfailed',url:'http://local.test/unexpected'}]
  });
  assert.equal(unexpected.allowed,false);
  assert.equal(unexpected.blockers.find(item=>item.type==='request-failure')?.count,1);
});

test('required crosscut categories are enforced instead of remaining declarative only',()=>{
  const requiredCategories=['state-sync','module-contract','renderer-health'];
  const missing=evaluateProductGate({
    checks:[
      {name:'state-sync',category:'state-sync',status:'passed',critical:true},
      {name:'module-contract',category:'module-contract',status:'passed',critical:true},
    ],
    policy:{requiredCategories},
  });
  assert.equal(missing.allowed,false);
  assert.deepEqual(missing.blockers.find(item=>item.type==='missing-category')?.items,['renderer-health']);

  const complete=evaluateProductGate({
    checks:requiredCategories.map(category=>({name:category,category,status:'passed',critical:true})),
    policy:{requiredCategories},
  });
  assert.equal(complete.allowed,true);
});

test('product summary consumes crosscut checks coverage findings and evidence without false blockers',()=>{
  const summary=buildProductQaSummary({
    systemId:'pdv-artisys',
    profile:'crosscut',
    checks:[{name:'module-state-contract',category:'crosscut',status:'passed',critical:true}],
    coverage:{discovered:1,covered:1,uncovered:0,uncoveredCritical:0},
    consoleErrors:[],
    networkErrors:[{type:'requestfailed',expected:true,url:'http://local.test/recovery'}],
    findings:[{code:'informational',severity:'low'}],
    evidence:[{contractId:'module-state-contract',path:'module-state.json'}]
  });

  assert.equal(summary.status,'PASS');
  assert.equal(summary.gate.allowed,true);
  assert.equal(summary.counts.passed,1);
  assert.equal(summary.evidenceCount,1);
  assert.equal(summary.networkErrorCount,1);
  assert.equal(summary.coverage.uncoveredCritical,0);
});
