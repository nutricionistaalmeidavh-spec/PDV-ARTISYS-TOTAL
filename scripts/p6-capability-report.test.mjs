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
  assert.match(report.rows.find(r=>r.id==='cap-025').blockers.join(' '),/homologacao fisica/);
  assert.throws(()=>buildReport(matrix,{contracts:contracts.slice(1)}),/56 unique/);
});
