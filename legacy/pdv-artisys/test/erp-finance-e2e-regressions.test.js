'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');

const read=path=>fs.readFileSync(path,'utf8');

test('finance QA fixture uses the seeded revenue DRE group',()=>{
  const adapter=read('qa/runtime/adapters/erp-finance-ci.mjs');
  const migrations=read('js/core/database/erp-finance-migrations.js');
  assert.match(migrations,/\['REVENUE','Receitas','REVENUE',10\]/);
  assert.doesNotMatch(adapter,/OPERATING_REVENUE/);
  assert.match(adapter,/kind==='INCOME'\?'REVENUE':'OPERATING_EXPENSE'/);
});

test('finance E2E surfaces are visible before user interaction',()=>{
  const management=read('desktop/renderer/erp-finance-ui.js');
  const operations=read('desktop/renderer/erp-finance-operations-ui.js');
  assert.doesNotMatch(management,/id="erp-drilldown-panel" class="ops-card" hidden/);
  assert.match(management,/id="erp-drilldown-panel" class="ops-card">[^<]*<p>/);
  assert.match(operations,/id="erp-statement-preview"/);
});
