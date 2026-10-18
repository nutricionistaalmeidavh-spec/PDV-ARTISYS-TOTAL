import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {DESKTOP_SHA,DESKTOP_REPO} from './parity-rules.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const baseline=JSON.parse(readFileSync(resolve(root,'docs/parity/fixtures/pricing-desktop-v2.json'),'utf8'));
const source=readFileSync(resolve(root,'packages/core/js/domains/sales/pricing.js'));
const hash=createHash('sha1').update('blob '+source.length+'\\0').update(source).digest('hex');
const require=createRequire(import.meta.url);
const functions=require('../packages/core/js/domains/sales/pricing.js');

test('P0 pricing implementation is byte-identical to the pinned desktop source Git blob',()=>{
  assert.equal(baseline.desktop.repo,DESKTOP_REPO);
  assert.equal(baseline.desktop.commit,DESKTOP_SHA);
  assert.equal(baseline.desktop.sourcePath,'js/domains/sales/pricing.js');
  assert.equal(baseline.desktop.sourceBlobSha,'165bfb0af4aa4764474f421cc04f0c32f1b71fb8');
  assert.equal(hash,baseline.desktop.sourceBlobSha,
    'The canonical price engine diverged from the frozen desktop without a new audited comparison');
});

for(const row of baseline.cases){
  test('P0 desktop pricing golden vector: '+row.id,()=>{
    const operation=functions[row.method];
    assert.equal(typeof operation,'function');
    const invoke=()=>row.method==='allocateSaleDiscount'?
      operation(row.input.items,row.input.discountCents):operation(row.input);
    if(row.throws){
      assert.throws(invoke,error=>error.name===row.throws.name&&error.message===row.throws.message);
    }else if(row.expectedAllocations){
      const actual=invoke().map(({grossCents,allocatedDiscountCents,netTotalCents})=>
        ({grossCents,allocatedDiscountCents,netTotalCents}));
      assert.deepEqual(actual,row.expectedAllocations);
    }else{
      assert.deepEqual(invoke(),row.expected);
    }
  });
}
