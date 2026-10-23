// Evidence index. A screenshot is evidence of a rendered state, not proof of a
// complete user journey. Statuses below deliberately distinguish nominal and
// partial coverage from end-to-end certification.
import {existsSync,mkdirSync,readFileSync,writeFileSync,appendFileSync} from 'node:fs';
import {resolve} from 'node:path';

const root=resolve('qa-artifacts'),target=resolve(root,'journeys');
mkdirSync(target,{recursive:true});
const requirements=[
  {id:'QA-00',title:'Login, roles, sessions and tenant isolation',
    files:['journeys/qa-roles-results.json','journeys/QA-00-owner.png','journeys/QA-00-cashier.png',
      'journeys/QA-00-waiter.png','journeys/QA-00-kitchen.png','journeys/QA-00-stockkeeper.png',
      'journeys/QA-00-finance.png','journeys/QA-00-read_only.png',
      'journeys/QA-00-login-invalid.png','journeys/QA-00-revoked-session.png'],
    level:'PARTIAL',missing:'Suspended user, filial B by all roles, human usability and real email invitation'},
  {id:'QA-01',title:'Prepare menu, ingredient and recipe',
    files:['audit-fixes/ficha-tecnica.png'],level:'PARTIAL',
    missing:'Invalid form fields, duplicate SKU and all menu/station combinations by role'},
  {id:'QA-02',title:'Open cash and complete counter purchase',
    files:['audit-fixes/balcao-390.png'],level:'PARTIAL',
    missing:'Cash shortage, inactive item, retry after lost response and second cash terminal UI variants'},
  {id:'QA-03',title:'Waiter opens table and sends order',
    files:['audit-fixes/QA-03-garcom-comanda.png','audit-fixes/QA-03-04-06-sqlite-proof.json'],
    level:'NOMINAL',missing:'Concurrent order creation, duplicate submission and interrupted waiter session'},
  {id:'QA-04',title:'Kitchen prepares and returns status',
    files:['audit-fixes/QA-04-cozinha-pronto.png','audit-fixes/QA-03-04-06-sqlite-proof.json'],
    level:'NOMINAL',missing:'Two competing cooks, network timeout, multiple kitchens and station permissions'},
  {id:'QA-05',title:'Change, transfer, split and prepay table',
    files:['journeys/QA-05-transaction-api.json'],level:'PARTIAL',missing:'Full visible-UI transfer, split, prepayment, concurrency, permissions and retries'},
  {id:'QA-06',title:'Cashier receives order and releases table',
    files:['audit-fixes/QA-06-caixa-pagamento.png','audit-fixes/QA-06-mesa-livre.png',
      'audit-fixes/QA-03-04-06-sqlite-proof.json'],
    level:'NOMINAL',missing:'Mixed payments, split bill, underpayment, lost network and double-tap variants'},
  {id:'QA-07',title:'Returns, cancellation and cash reconciliation',
    files:['pdv-parity-sales-history.png'],level:'PARTIAL',
    missing:'Full UI partial return, repeated refund, cash withdrawal/supply and independent reconciliation'},
  {id:'QA-08',title:'Contextual customer and store credit',
    files:['pdv-finance-mobile.png'],level:'PARTIAL',
    missing:'Credit limit exceeded, partial installment, repeat collection and READ_ONLY rejection in UI'},
  {id:'QA-09',title:'Pickup, delivery and returned dispatch',
    files:['pdv-r4-multiline-food.png'],level:'PARTIAL',
    missing:'Delivery lifecycle, dispatch, return, resending and cancellation after preparation'},
  {id:'QA-10',title:'Finance, wallet, recurrence and bank reconciliation',
    files:['pdv-p4-wallets-bank-filters-plan.png','pdv-p4-recurrence-alerts.png'],
    level:'PARTIAL',missing:'CSV/OFX duplicate and out-of-order fetch, double-entry DRE independent proof'},
  {id:'QA-11',title:'Purchasing, inventory, filtered reports and exports',
    files:['pdv-parity-stock-history.png','pdv-reports-desktop.png'],
    level:'PARTIAL',missing:'Partial receipt, stock count conflict, costs and multi-page independent report reconciliation'},
  {id:'QA-12',title:'Mobile accessibility, offline interruption and recovery',
    files:['journeys/QA-12-network-offline.png','journeys/QA-12-network-recovered.png'],
    level:'PARTIAL',missing:'Physical Safari/iPhone, installed PWA, VoiceOver, keyboard, cache after app update, p50/p95'}
];
let transactions=null;
try{transactions=JSON.parse(readFileSync(resolve(target,'QA-05-transaction-api.json'),'utf8'));}catch{}
let roleRun=null;
try{roleRun=JSON.parse(readFileSync(resolve(target,'qa-roles-results.json'),'utf8'));}catch{}
const proof=resolve(root,'audit-fixes/QA-03-04-06-sqlite-proof.json');
let sqliteProof=null;
try{sqliteProof=JSON.parse(readFileSync(proof,'utf8'));}catch{}
let variantManifest=null;
try{variantManifest=JSON.parse(readFileSync(resolve(root,'journey-variants/qa-00-12-variants.json'),'utf8'));}catch{}
const scored=requirements.map(entry=>{
  const present=entry.files.filter(f=>existsSync(resolve(root,f)));
  const missingFiles=entry.files.filter(f=>!existsSync(resolve(root,f)));
  const checksOk=entry.id==='QA-00'
    ?Boolean(roleRun?.results?.filter(x=>x.result==='PASS'&&x.variant.startsWith('signed-in-')).length===7
        &&roleRun?.results?.some(x=>x.variant==='cross-tenant-denied'&&x.result==='PASS')
        &&roleRun?.results?.some(x=>x.variant==='revoked-session-no-access'&&x.result==='PASS'))
    :entry.id==='QA-05'
      ?Boolean(transactions?.groups?.length===2&&transactions.groups.every(g=>g.status==='PASS'&&g.passedTests>0))
      :entry.id==='QA-12'
      ?Boolean(roleRun?.results?.some(x=>x.variant==='offline-failure-followed-by-recovery'&&x.result==='PASS'))
      :['QA-03','QA-04','QA-06'].includes(entry.id)
        ?Boolean(sqliteProof?.stockBalanceMilli===9000
           &&sqliteProof?.closedCashSessionsZeroDivergence===1
           &&sqliteProof?.paidSaleTotalCents===1000)
        :true;
  const variantGroups=variantManifest?.results?.filter(x=>x.id===entry.id)||[];
  const apiVariantsPassed=variantGroups.length>0&&variantGroups.every(x=>x.status==='PASS');
  return {...entry,observed:checksOk&&missingFiles.length===0&&entry.files.length>0,
    apiVariantContracts:{tested:variantGroups.length,passed:apiVariantsPassed,
      totalNamedCases:variantGroups.reduce((sum,x)=>sum+x.passed,0),
      scope:'Isolated API/domain contracts, not physical or complete browser E2E'},
    evidenceFiles:present,missingFiles,
    status:checksOk&&missingFiles.length===0&&entry.files.length>0?entry.level:'NOT_PROVED'};
});
const completed=scored.filter(x=>x.observed).length;
const report={revision:process.env.GITHUB_SHA||'local',environment:'Synthetic isolated browser + SQLite, Chromium',
  timestamp:new Date().toISOString(),total:13,withEvidence:completed,
  fullyCertified:0,reason:'Missing variants and physical integrations must never be silently marked green',
  cases:scored};
writeFileSync(resolve(target,'qa-00-12-coverage.json'),JSON.stringify(report,null,2)+'\n');
const md=['# PDV TOTAL — QA 00–12', '',
  'CI revision: '+report.revision,
  'Nominal/partial evidence: '+completed+'/13. Full end-to-end certification: **0/13**.',
  'API variants pass for '+scored.filter(x=>x.apiVariantContracts.passed).length+'/13 journey groups. These cannot certify physical devices or complete browser flows.',
  'An existing screenshot alone does not prove retries, negative and recovery variants.',
  '', '| Case | Evidence | Assessment | Not yet validated |',
  '|---|---|---|---|',
  ...scored.map(x=>'| '+x.id+' | '+(x.observed?'Recorded':'Missing/incomplete')+
    ' | '+x.status+' | '+x.missing.replaceAll('|','/')+' |'),
  '', 'Evidence paths and missing artifacts are listed in qa-00-12-coverage.json.',
  'No production tenant data, credentials, token, real payment or outbound mail is included.',''];
writeFileSync(resolve(target,'qa-00-12-coverage.md'),md.join('\n'));
if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,md.join('\n'));
console.log(md.join('\n'));
