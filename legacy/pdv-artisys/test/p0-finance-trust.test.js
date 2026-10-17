'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runErpFinanceMigrations}=require('../js/core/database/erp-finance-migrations');
const {createFinanceDimensionsService}=require('../js/domains/finance/finance-dimensions');
const {createFinanceService}=require('../js/domains/finance/finance-service');
const {createFinanceManagementService}=require('../js/domains/finance/finance-management');
const {createReconciliation}=require('../js/domains/finance/reconciliation');

const admin={userId:'admin-p0',profileId:'profile-administrator'};
const now='2026-10-02T12:00:00.000Z';

function fixture(){
  const db=openDatabase(':memory:');
  runMigrations(db,()=>now);
  runErpFinanceMigrations(db,()=>now);
  let seq=0;
  const dimensions=createFinanceDimensionsService({db,now:()=>now,idFactory:p=>`${p}-${++seq}`});
  const finance=createFinanceService({db,dimensions,now:()=>now,idFactory:p=>`${p}-${++seq}`});
  const management=createFinanceManagementService({db,finance,dimensions,now:()=>now});
  return{db,finance,management};
}

test('management dashboard uses the requested DRE basis',()=>{
  const fx=fixture();
  try{
    fx.finance.createEntry({
      kind:'PAYABLE',
      description:'Aluguel outubro',
      amountCents:100000,
      dueAt:'2026-10-10T12:00:00.000Z',
      competencyDate:'2026-10-01'
    },admin);
    const cash=fx.management.dashboard({basis:'cash',from:'2026-10-01',to:'2026-10-31'});
    const accrual=fx.management.dashboard({basis:'accrual',from:'2026-10-01',to:'2026-10-31'});
    assert.equal(cash.basis,'cash');
    assert.equal(accrual.basis,'accrual');
    assert.equal(cash.expenseCents,0);
    assert.equal(accrual.expenseCents,100000);
  }finally{fx.db.close();}
});

test('rejected reconciliation pair is not suggested again',async()=>{
  const fx=fixture();
  try{
    const account=fx.finance.createAccount({id:'bank-1',name:'Banco teste',type:'BANK'},admin);
    const entry=fx.finance.createEntry({
      id:'entry-1',
      kind:'RECEIVABLE',
      description:'Cliente Alfa',
      accountId:account.id,
      amountCents:25000,
      dueAt:'2026-10-02T12:00:00.000Z'
    },admin);
    fx.db.prepare('INSERT INTO bank_statement_batches(id,account_id,source_name,format,source_hash,inserted_count,duplicate_count,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run('batch-1',account.id,'teste.ofx','OFX','hash-p0',1,0,admin.userId,now);
    fx.db.prepare('INSERT INTO bank_statement_transactions(id,batch_id,account_id,posted_date,direction,amount_cents,description,external_id,source_fingerprint,business_fingerprint,classification_json,match_status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run('tx-1','batch-1',account.id,'2026-10-02','credit',25000,'CLIENTE ALFA','fit-p0','source-p0','business-p0',null,'UNMATCHED',now);
    const statements={
      listTransactions({accountId=null,matchStatus=null}={}){
        return fx.db.prepare('SELECT * FROM bank_statement_transactions ORDER BY posted_date,id').all()
          .filter(row=>!accountId||row.account_id===accountId)
          .filter(row=>!matchStatus||row.match_status===matchStatus)
          .map(row=>({id:row.id,accountId:row.account_id,date:row.posted_date,direction:row.direction,amountCents:Number(row.amount_cents),description:row.description,matchStatus:row.match_status}));
      }
    };
    let seq=0;
    const reconciliation=createReconciliation({db:fx.db,finance:fx.finance,statements,now:()=>now,idFactory:p=>`${p}-p0-${++seq}`});
    const before=await reconciliation.suggest({accountId:account.id});
    assert.equal(before.some(row=>row.transactionId==='tx-1'&&row.entryId===entry.id),true);
    reconciliation.reject({transactionId:'tx-1',entryId:entry.id,reason:'Não corresponde ao cliente',idempotencyKey:'reject-p0'},admin);
    const after=await reconciliation.suggest({accountId:account.id});
    assert.equal(after.some(row=>row.transactionId==='tx-1'&&row.entryId===entry.id),false);
  }finally{fx.db.close();}
});

test('P0 renderer contract avoids native finance prompts and requires reconciliation review',()=>{
  const renderer=path.join(__dirname,'..','desktop','renderer');
  const operational=fs.readFileSync(path.join(renderer,'operational-pages.js'),'utf8');
  const management=fs.readFileSync(path.join(renderer,'erp-finance-ui.js'),'utf8');
  const operations=fs.readFileSync(path.join(renderer,'erp-finance-operations-ui.js'),'utf8');
  const ux=fs.readFileSync(path.join(renderer,'ux-components.js'),'utf8');
  for(const [name,source] of [['operational-pages.js',operational],['erp-finance-ui.js',management],['erp-finance-operations-ui.js',operations],['ux-components.js',ux]]) assert.doesNotThrow(()=>new vm.Script(source,{filename:name}));
  const start=operational.indexOf('async function renderFinance');
  const end=operational.indexOf('async function renderReports',start);
  const financeSection=operational.slice(start,end);
  assert.doesNotMatch(financeSection,/\bprompt\s*\(/);
  assert.match(financeSection,/openFormDialog/);
  assert.match(management,/erpDashboard\(\{from,to,basis\}\)/);
  assert.match(management,/equivalentPreviousPeriod\(from,to\)/);
  assert.match(operations,/\[data-reconcile-reject\]/);
  assert.match(operations,/reviewSuggestion\(button\.dataset\.reconcileAccept,'accept'\)/);
  assert.match(operations,/reviewSuggestion\(button\.dataset\.reconcileReject,'reject'\)/);
});
