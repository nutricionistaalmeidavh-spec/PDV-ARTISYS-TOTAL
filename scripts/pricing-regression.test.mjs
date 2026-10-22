import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const baseline=JSON.parse(readFileSync(resolve(root,'apps/api/test/fixtures/regression/fixtures/pricing-desktop-v2.json'),'utf8'));
const require=createRequire(import.meta.url);
const functions=require('../packages/core/js/domains/sales/pricing.js');


for(const row of baseline.cases){
  test('Pricing regression: '+row.id,()=>{
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
