'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('checkout guards payment opening and sale completion against rapid double clicks',()=>{
  const app=fs.readFileSync(path.join(__dirname,'..','desktop','renderer','app.js'),'utf8');
  assert.match(app,/let paymentFlowInFlight\s*=\s*false/);
  assert.match(app,/if\s*\(paymentFlowInFlight\s*\|\|/);
  assert.match(app,/let saleCompletionInFlight\s*=\s*false/);
  assert.match(app,/if\s*\(saleCompletionInFlight\)\s*return/);
  assert.match(app,/confirm-payment[^\n]+addEventListener\('click', completeCurrentSale\)/);
});
