import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReport} from './p6-capability-report.mjs';
test('all 56 P6 IDs remain visible, grouped exactly once and never overclaimed',()=>{
  const matrix={modules:[{contracts:[{id:'checkout-008',status:'covered'},{id:'cash-046',status:'partial'}]}]};
  const contracts=Array.from({length:56},(_,i)=>({
    id:'cap-'+String(i+1).padStart(3,'0'),
    capability:'desktop-'+(i+1),dependsOn:i===1?['cash-046']:[],
    status:i<14?'partial':'gap'
  }));
  const report=buildReport(matrix,{contracts,fullSystemClaim:'incomplete'});
  assert.equal(report.summary.total,56);
  assert.equal(report.summary.covered,0);
  assert.equal(report.summary.partial,14);
  assert.equal(report.summary.gap,42);
  assert.equal(Object.values(report.groups).flat().length,56);
  assert.equal(report.rows.find(r=>r.id==='cap-002').front,'infra-lan-selfhost');
  assert.match(report.rows.find(r=>r.id==='cap-002').blockers.join(' '),/cash-046/);
  assert.doesNotMatch(report.rows.find(r=>r.id==='cap-025').blockers.join(' '),/homologacao fisica|teste fisico|hardware real/i);
  assert.equal(report.rows.find(r=>r.id==='cap-025').fieldValidation.requiredForCodeReady,false);
  assert.equal(report.rows.find(r=>r.id==='cap-025').fieldValidation.status,'not-verified');
  assert.throws(()=>buildReport(matrix,{contracts:contracts.slice(1)}),/56 unique/);
});


test('one visible 56-capability board summarizes four delivery states; 68 contracts remain internal',()=>{
  const contracts=Array.from({length:56},(_,i)=>({
    id:'cap-'+String(i+1).padStart(3,'0'),
    capability:'desktop-'+(i+1),dependsOn:[],
    status:i===0?'covered':i<15?'partial':'gap'
  }));
  const matrix={modules:[{id:'checkout',contracts:[
    {id:'checkout-005',status:'covered'},{id:'checkout-007',status:'partial'}
  ]}]};
  const report=buildReport(matrix,{contracts,fullSystemClaim:'incomplete'});
  assert.deepEqual(report.progress.counts,{
    integral:1,parcial:14,nao_copiado:41,aguardando_homologacao:0
  });
  assert.equal(report.progress.total,56);
  assert.equal(report.contractDiagnostics.total,2);
  assert.equal(report.rows.find(r=>r.id==='cap-016').classification,'nao_copiado');
  assert.equal(report.rows.find(r=>r.id==='cap-016').certainty,'sem-evidencia-de-equivalencia');
  assert.match(report.progress.notes.join(' '),/gap.*nao comprova ausencia de codigo/i);
});

test('implementation awaiting code parity audit requires an explicit reviewed proof, never inferred from tests or dependencies',()=>{
  const contracts=Array.from({length:56},(_,i)=>({
    id:'cap-'+String(i+1).padStart(3,'0'),
    capability:'desktop-'+(i+1),dependsOn:[],
    status:i<2?'partial':'gap'
  }));
  const matrix={modules:[{contracts:[{id:'checkout-005',status:'covered'}]}]};
  contracts[0].dependsOn=['checkout-005'];
  contracts[0].implementationReview={
    state:'ready-for-homologation',
    reviewer:'QA Artisys',
    reviewedAt:'2026-10-18',
    testFiles:['apps/api/test/commerce.test.mjs']
  };
  contracts[1].dependsOn=['checkout-005'];
  contracts[1].implementationReview={state:'ready-for-homologation'};
  const report=buildReport(matrix,{contracts,fullSystemClaim:'incomplete'});
  assert.equal(report.rows[0].classification,'aguardando_homologacao');
  assert.equal(report.rows[1].classification,'parcial');
  assert.equal(report.progress.counts.aguardando_homologacao,1);
  assert.equal(report.progress.counts.parcial,1);
  assert.equal(report.progress.counts.nao_copiado,54);
  assert.equal(report.rows[0].blockerType,'auditoria-de-codigo');
  assert.equal(report.rows[1].blockerType,'implementacao');
});

test('all 56 capabilities are assigned once to roadmap waves without an extra duplicate 68-item backlog',()=>{
  const contracts=Array.from({length:56},(_,i)=>({
    id:'cap-'+String(i+1).padStart(3,'0'),
    capability:'desktop-'+(i+1),dependsOn:[],status:'gap'
  }));
  const report=buildReport({modules:[{contracts:[]}]},{contracts,fullSystemClaim:'incomplete'});
  assert.equal(Object.values(report.roadmap.waves).flat().length,56);
  assert.equal(new Set(Object.values(report.roadmap.waves).flat().map(x=>x.id)).size,56);
  assert.equal(report.rows.find(r=>r.id==='cap-014').wave,'R1');
  assert.equal(report.rows.find(r=>r.id==='cap-002').wave,'R2');
  assert.equal(report.rows.find(r=>r.id==='cap-025').wave,'R3');
  assert.equal(report.rows.find(r=>r.id==='cap-034').wave,'R4');
});
