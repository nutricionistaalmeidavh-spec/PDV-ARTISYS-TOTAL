import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
// Every selected case uses real API/domain logic and isolated SQLite. These
// checks supplement real-browser tests; they are not a UX certification.
const groups=[
 ['QA-00','apps/api/test/saas-security.test.mjs',[
 'OWNER can create a scoped branch','invites use single-use bearer proof','owner role management cannot demote owner','owner sessions may be revoked']],
 ['QA-00','apps/api/test/p2-account-security.test.mjs',[
 'password login requires TOTP','verified-email gate protects tenant data']],
 ['QA-01','apps/api/test/p2-catalog-inventory.test.mjs',[
 'P2 category, barcode and parent/variant identity','P2 stock reservations block checkout stock debit']],
 ['QA-02','apps/api/test/p1-reversals.test.mjs',[
 'P1 cash: cross-terminal closed-session audit','P2 pinned desktop cash closing nominal']],
 ['QA-03','apps/api/test/vertical-parity.test.mjs',[
 'P7 restaurant: table reservation is singular','cap-031 two concurrent operators cannot hold two OPEN sessions','cap-035: concurrent kitchen status requests']],
 ['QA-04','apps/api/test/vertical-parity.test.mjs',[
 'P7 restaurant: kitchen must be ready','cap-034: KDS claim is single-owner','cap-035: concurrent kitchen status requests']],
 ['QA-05','apps/api/test/vertical-parity.test.mjs',[
 'R4 cap-031: transferir mesa','R4 cap-032: partial item transfer','R4 cap-032: equal split',
 'cap-031: duas transferências concorrentes','cap-032: antecipação parcial','cap-032: adiantamento por pagador']],
 ['QA-06','apps/api/test/checkout-documents.test.mjs',[
 'cashier can settle a delivered table','Balcão settles delivered table split',
 'Balcão settlement removes fully prepaid shares','Balcão closes a fully prepaid split',
 'Balcão opens delivered pickup from its immutable source']],
 ['QA-07','apps/api/test/p1-reversals.test.mjs',[
 'P1: completed sale cancellation','P1: partial returns',
 'P1: cash refund cannot use closed original session','P1 regression: two terminals cannot reverse']],
 ['QA-08','apps/api/test/vertical-parity.test.mjs',[
 'P7 crediário and commissions','P7 credit repayment reduces receivable']],
 ['QA-09','apps/api/test/vertical-parity.test.mjs',[
 'R4 cap-033/cap-037: retirada vira','R4 cap-037/038: counter ticket',
 'cap-037 delivery checkpoint returns to courier']],
 ['QA-10','apps/api/test/advanced-finance.test.mjs',[
 'repeated or overlapping imported statements','matching a bank transaction creates one settlement',
 'DRE cash and accrual differ','P4: real due balances','P0 wallets: immutable audited balances']],
 ['QA-11','apps/api/test/p2-purchasing.test.mjs',[
 'purchase order receives in partial batches','purchase receipts are idempotent',
 'purchase order cannot cross company/branch','weighted average acquisition cost']],
 ['QA-11','scripts/report-xlsx.test.mjs',[
 'XLSX uses a standards-based local ZIP','CSV quoted multiline','User-controlled fields are XML-escaped','Export refuses truncation']],
 ['QA-12','apps/api/test/r2-lan-operations.test.mjs',[
 'cap-003 cap-044 cap-045 cap-046 R2: independently paired',
 'cap-053 cap-055 R2: tenant-scoped readiness']]
];
const target=resolve('qa-artifacts/journey-variants');mkdirSync(target,{recursive:true});
const results=[];
for(const [id,file,expected] of groups){
 const run=spawnSync(process.execPath,['--experimental-sqlite','--test',
   '--test-name-pattern='+expected.join('|'),file],{encoding:'utf8',timeout:120000,maxBuffer:4*1024*1024});
 const log=String(run.stdout||'')+'\n'+String(run.stderr||'');
 const num=key=>Number(log.match(new RegExp('^# '+key+'\\s+(\\d+)','m'))?.[1]||0);
 const names=log.split('\n').filter(line=>/^\s*ok\s+\d+\s+-\s+/.test(line)&&!/# SKIP/.test(line))
   .map(line=>line.replace(/^\s*ok\s+\d+\s+-\s+/,'').trim());
 const missing=expected.filter(name=>!names.some(actual=>actual.includes(name)));
 const status=run.status===0&&num('fail')===0&&num('cancelled')===0&&missing.length===0&&num('pass')>=expected.length?'PASS':'FAIL';
 results.push({id,file,status,passed:num('pass'),failed:num('fail'),missing,
  namedCases:names.slice(0,50),category:'API/domain and isolated SQLite'});
 console.log('QA variants',id,file,status,'passed',num('pass'),'missing',missing.length);
 if(status==='FAIL')console.error(log.slice(-2200).replace(/[A-Za-z0-9_-]{64,}/g,'[REDACTED]'));
}
const manifest={revision:process.env.GITHUB_SHA||'local',
 limitation:'These checks are API/domain contracts, not human UI, real Safari, installed PWA, printers, real payments or email',
 results,allPassed:results.every(x=>x.status==='PASS')};
writeFileSync(resolve(target,'qa-00-12-variants.json'),JSON.stringify(manifest,null,2)+'\n');
assert.equal(manifest.allPassed,true,'Named QA scenario contracts failed');
console.log('QA scenario contract groups passed:',results.length);
