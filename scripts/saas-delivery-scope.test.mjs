import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildReport,buildSaasDeliveryReport} from './p6-capability-report.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const load=p=>JSON.parse(readFileSync(resolve(root,p),'utf8'));
const inventory=load('docs/parity/desktop-capability-inventory.json');
const screen=load('docs/parity/desktop-web-matrix.json');
const scope=load('docs/parity/saas-delivery-scope.json');

test('hosted SaaS backlog never blocks launch on Windows installer, local LAN mobile or server/terminal deployment',()=>{
  const historical=buildReport(screen,inventory);
  const saas=buildSaasDeliveryReport(historical,scope);
  assert.deepEqual(saas.deferred.ids,['cap-001','cap-047','cap-056']);
  assert.equal(saas.deferred.total,3);
  assert.deepEqual(saas.active.counts,{covered:53,partial:0,gap:0});
  assert.equal(saas.active.total,53);
  assert.equal(saas.active.pending.length,0);
  for(const id of saas.deferred.ids){
    assert.ok(!saas.active.pending.some(row=>row.id===id),'LAN/desktop task must never be an SaaS backlog blocker: '+id);
    assert.equal(inventory.contracts.find(row=>row.id===id).status,'partial','historical parity status remains untouched');
  }
  assert.equal(historical.summary.total,56);
  assert.equal(historical.summary.partial,3,'historical 56 remains auditable');
  assert.equal(saas.primaryDelivery,'hosted-https-web-api');
  assert.ok(saas.deferred.items.every(row=>row.reason.length>=25));
});

test('scope filter rejects duplicated, missing and already-covered deferred IDs instead of silently changing release eligibility',()=>{
  const historical=buildReport(screen,inventory);
  const original=scope.deferredCapabilityIds;
  assert.throws(()=>buildSaasDeliveryReport(historical,{...scope,deferredCapabilityIds:[...original,original[0]]}),/duplicate|duplicad/i);
  assert.throws(()=>buildSaasDeliveryReport(historical,{...scope,deferredCapabilityIds:[...original,{id:'cap-999',reason:'invalid'}]}),/unknown|desconhecid/i);
  assert.throws(()=>buildSaasDeliveryReport(historical,{...scope,deferredCapabilityIds:[{id:'cap-002',reason:'remove a covered capability'}]}),/covered|cobert/i);
});
