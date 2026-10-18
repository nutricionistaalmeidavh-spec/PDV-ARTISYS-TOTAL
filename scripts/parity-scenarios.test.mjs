import test from 'node:test';
import assert from 'node:assert/strict';
import {buildScenarioCatalog,validateScenarioEvidence} from './parity-scenarios.mjs';
import {verifyClaim,DESKTOP_SHA} from './parity-rules.mjs';

const row=(id,name,owner='sales')=>({
  id,name,owner,acceptance:'Assert equivalent persistence, authorization and rollback in the original desktop and canonical web implementation.',
  status:'partial',dependsOn:[],webEvidence:{file:'apps/api/src/commerce.mjs',contains:'async openSale('}
});
const sampleMatrix={desktop:{commit:DESKTOP_SHA},modules:[{id:'checkout',desktopEvidence:['js/domains/sales/sale-service.js'],contracts:[
  row('checkout-005','Abertura de venda'),row('checkout-007','Desconto de venda com permissão')]}]};
const sampleInventory={baseline:{repo:'nutricionistaalmeidavh-spec/PDV-ARTISYS',commit:DESKTOP_SHA,
  manifest:'release/capabilities.json'},contracts:[{...row('cap-001','physical checkout peripherals','peripherals'),
  capability:'hardware-protocol-simulation-ci-and-recovery-tests',
  sourceEvidence:{repo:'nutricionistaalmeidavh-spec/PDV-ARTISYS',commit:DESKTOP_SHA,file:'release/capabilities.json',manifestIndex:0}}]};

test('P0 maps every contract to four reproducible review dimensions and hardware uses software test gate',()=>{
  const cases=buildScenarioCatalog(sampleMatrix,sampleInventory);
  assert.equal(cases.filter(c=>c.contractId==='checkout-005').length,4);
  assert.deepEqual(cases.filter(c=>c.contractId==='checkout-007').map(c=>c.dimension),
    ['nominal','authorization','tenant-isolation','failure-recovery']);
  assert.equal(cases.filter(c=>c.contractId==='cap-001').length,4);
  assert.equal(cases.some(c=>c.dimension==='physical-device'),false,'physical field QA is not a code-readiness gate');
  assert.equal(new Set(cases.map(c=>c.id)).size,cases.length);
  assert(cases.every(c=>c.desktopSource.commit===DESKTOP_SHA));
});

test('P0 refuses non-existent, duplicate or unexecuted proof for scenario certification',()=>{
  const cases=buildScenarioCatalog(sampleMatrix,sampleInventory);
  const input={schemaVersion:1,desktopBaselineCommit:DESKTOP_SHA,results:[]};
  const empty=validateScenarioEvidence(cases,input,()=>{throw Error('no file expected')});
  assert.equal(empty.verified,0);assert.equal(empty.complete,false);
  const fake={scenarioId:cases[0].id,method:'automated',desktopBaselineCommit:DESKTOP_SHA,testFile:'apps/api/test/commerce.test.mjs',
    testContains:"test('sale')",testAssertionContains:'assert.equal(result,true)',testRunner:'node-test',
    desktopFixtureId:'desktop-fixture-v1',fixtureFile:'docs/parity/fixtures/pricing-desktop-v2.json'};
  assert.throws(()=>validateScenarioEvidence(cases,{...input,results:[fake]},()=>"test('sale',()=>{})"),/assertion|evidence/);
  assert.throws(()=>validateScenarioEvidence(cases,{...input,results:[fake,fake]},()=>''),/duplicate/);
  assert.throws(()=>validateScenarioEvidence(cases,{...input,results:[{...fake,scenarioId:'invented-001'}]},()=>''),/unknown scenario/);
});

test('P0 cannot certify completed scope without verified scenario suite even with passing CI metadata',()=>{
  const certification={scope:'seven-screen-operations',desktopBaselineCommit:DESKTOP_SHA,webCommit:'a'.repeat(40),
    testRunUrl:'https://github.com/owner/repo/actions/runs/1234',independentReviewer:'External QA',
    verifiedAt:'2026-10-17',testSuitePassed:true};
  const covered=[{status:'covered'}];
  assert.throws(()=>verifyClaim(covered,'complete',certification,'seven-screen-operations'),/scenario/i);
  assert.equal(verifyClaim(covered,'complete',certification,'seven-screen-operations',{scenarioEvidenceComplete:true}),true);
});
