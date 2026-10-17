import test from 'node:test';
import assert from 'node:assert/strict';
import { runCrosscutContracts } from '../qa/runtime/src/crosscut-runner.js';

test('aggregates covered and optional crosscut contracts deterministically', async()=>{
  const contracts=[
    {
      id:'covered-contract',
      critical:true,
      async runContract(){
        return {
          checks:[{name:'covered-contract',status:'passed',critical:true}],
          findings:[{code:'info-only',severity:'low'}],
          evidence:['covered.json'],
          networkErrors:[{type:'requestfailed',expected:true}],
          consoleErrors:[{level:'warning',text:'known warning'}]
        };
      }
    },
    {
      id:'optional-contract',
      critical:false,
      async runContract(){
        return {status:'not-applicable',reason:'surface not implemented'};
      }
    }
  ];

  const result=await runCrosscutContracts({contracts,context:{}});
  assert.deepEqual(result.coverage,{discovered:2,covered:1,uncovered:1,uncoveredCritical:0});
  assert.equal(result.checks.find(x=>x.name==='optional-contract')?.status,'not-applicable');
  assert.equal(result.checks.find(x=>x.name==='optional-contract')?.details?.reason,'surface not implemented');
  assert.equal(result.findings[0].contractId,'covered-contract');
  assert.equal(result.evidence[0].contractId,'covered-contract');
  assert.equal(result.networkErrors[0].contractId,'covered-contract');
  assert.equal(result.consoleErrors[0].contractId,'covered-contract');
});

test('turns contract exceptions into critical harness findings and keeps running', async()=>{
  const contracts=[
    {id:'broken-contract',critical:true,async runContract(){throw new Error('boom');}},
    {id:'later-contract',critical:true,async runContract(){return {checks:[{name:'later-contract',status:'passed'}]};}}
  ];

  const result=await runCrosscutContracts({contracts,context:{}});
  assert.equal(result.checks.find(x=>x.name==='broken-contract')?.status,'failed');
  assert.equal(result.checks.find(x=>x.name==='later-contract')?.status,'passed');
  assert.equal(result.findings.find(x=>x.code==='qa-harness-error')?.severity,'critical');
  assert.equal(result.coverage.uncoveredCritical,1);
});

test('requires a reason for not-applicable contracts', async()=>{
  const result=await runCrosscutContracts({
    contracts:[{id:'optional-contract',critical:false,async runContract(){return {status:'not-applicable'};}}],
    context:{}
  });
  assert.equal(result.checks[0].status,'failed');
  assert.equal(result.findings[0].code,'qa-harness-error');
});
