'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('auto print worker drains only original sale receipts, never manual reprint attempts',()=>{
  const source=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
  assert.match(source,/listJobs\(\{\s*status:'PENDING'\s*,\s*type:'SALE_RECEIPT'\s*\}\)/);
});