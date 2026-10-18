import test from 'node:test';
import assert from 'node:assert/strict';
import {buildR0Audit,R1_IDS} from './r0-r1-audit.mjs';

const matrix={modules:[{id:'checkout',contracts:[
  {id:'checkout-008',status:'covered',webEvidence:{file:'apps/api/src/commerce.mjs',testFile:'apps/api/test/commerce.test.mjs'}},
  {id:'checkout-017',status:'partial',webEvidence:{file:'apps/api/src/commerce.mjs'}}
]}]};
function inventory(){
  return {contracts:Array.from({length:56},(_,i)=>({
    id:'cap-'+String(i+1).padStart(3,'0'),
    capability:'capability-'+(i+1),
    dependsOn:i===11?['checkout-008']:i===4?['checkout-017']:[],
    status:i===11?'partial':'gap',
    testedContractRefs:[],
    sourceEvidence:{file:'release/capabilities.json'}
  }))};
}
test('R0 audits 56 exactly once and R1 is 21 IDs with no duplicate second backlog',()=>{
  const report=buildR0Audit(matrix,inventory(),()=>true);
  assert.equal(report.all.length,56);
  assert.equal(report.R1.length,21);
  assert.equal(new Set(report.R1.map(x=>x.id)).size,21);
  assert.deepEqual(report.R1.map(x=>x.id),R1_IDS);
  assert.equal(report.summary.R1.total,21);
  assert.equal(report.summary.all.total,56);
  assert.equal(report.summary.contractsInternal,2);
});
test('R0 distinguishes visible code evidence, missing behavior and unverified equivalence',()=>{
  const report=buildR0Audit(matrix,inventory(),p=>p!=='apps/api/test/commerce.test.mjs');
  const coveredContract=report.R1.find(x=>x.id==='cap-012');
  assert.equal(coveredContract.status,'partial','no status promotion from a covered sub-contract');
  assert.equal(coveredContract.needsImplementationReview,true);
  assert.deepEqual(coveredContract.blockingContracts,[]);
  assert.equal(coveredContract.linkedContracts[0].implementationExists,true);
  assert.equal(coveredContract.linkedContracts[0].testFileExists,false);
  assert.equal(coveredContract.nextAction,'confirmar-paridade-integral');
  const gap=report.R1.find(x=>x.id==='cap-005');
  assert.equal(gap.status,'gap');
  assert.deepEqual(gap.blockingContracts,['checkout-017']);
  assert.equal(gap.nextAction,'inspecionar-implementacao');
  assert.match(report.disclaimer,/nao comprova ausencia de codigo/i);
});
test('R0 rejects inventories with duplicate IDs or missing internal contract references',()=>{
  const original=inventory();
  original.contracts[1].id=original.contracts[0].id;
  assert.throws(()=>buildR0Audit(matrix,original,()=>true),/56 capacidades unicas/);
  const broken=inventory();broken.contracts[11].dependsOn=['checkout-missing'];
  assert.throws(()=>buildR0Audit(matrix,broken,()=>true),/contrato desconhecido/);
});
