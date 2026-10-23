// Targeted transactional proof for QA-05. Tests execute the real API and
// SQLite contracts, not mocked UI interactions. No production state is touched.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const out=resolve('qa-artifacts/journeys');mkdirSync(out,{recursive:true});
const cases=[
  {scope:'table transfer, split and concurrent conflicts',
   file:'apps/api/test/vertical-parity.test.mjs',
   names:'cap-031|cap-032|transferir mesa|transferências concorrentes'},
  {scope:'cashier split, partial prepayment, refund, stale and duplicate payment',
   file:'apps/api/test/checkout-documents.test.mjs',
   names:'split|prepay|prepaid'}
];
const result={case:'QA-05',environment:'real isolated API/SQLite test fixture',
  evidenceType:'API and database only; not human-visible E2E',groups:[]};
let failure=null;
for(const group of cases){
 const child=spawnSync(process.execPath,['--experimental-sqlite','--test',
   '--test-name-pattern='+group.names,group.file],{encoding:'utf8',maxBuffer:4*1024*1024});
 const stdout=String(child.stdout||'');
 const total=Number(stdout.match(/# pass\s+(\d+)/)?.[1]||0);
 const failed=Number(stdout.match(/# fail\s+(\d+)/)?.[1]||0);
 const names=stdout.split('\n')
   .filter(line=>/^\s*ok\s+\d+\s+-\s+/.test(line)&&!/# SKIP/.test(line))
   .map(line=>line.replace(/^\s*ok\s+\d+\s+-\s+/,'').trim());
 result.groups.push({scope:group.scope,sourceFile:group.file,passedTests:total,
   failedTests:failed,assertedTestNames:names.slice(0,60),status:child.status===0&&total>0&&failed===0?'PASS':'FAIL'});
 if(child.status!==0||!total||failed)failure=group.scope+' failed (exit '+child.status+', pass '+total+', fail '+failed+')';
}
writeFileSync(resolve(out,'QA-05-transaction-api.json'),JSON.stringify(result,null,2)+'\n');
assert.equal(failure,null,failure||'QA-05 API transaction tests failed');
console.log('QA-05 real SQLite/API transfer, split, prepayment and retry contracts passed.');
