'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runErpFinanceMigrations}=require('../js/core/database/erp-finance-migrations');
const {createFinanceService}=require('../js/domains/finance/finance-service');
const {parseOfx}=require('../js/domains/finance/ofx-parser');
const {createStatementImport}=require('../js/domains/finance/statement-import');
const {createReconciliation}=require('../js/domains/finance/reconciliation');

const OFX=`OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\n<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260925120000[-3:BRT]<TRNAMT>100.00<FITID>PIX-A<NAME>PIX CLIENTE</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260926103000[-3:BRT]<TRNAMT>-12.50<FITID>TAR-1<NAME>TARIFA BANCARIA</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
function fixture(){const db=openDatabase(':memory:');runMigrations(db);runErpFinanceMigrations(db);let seq=0;const ids=p=>`${p}-${++seq}`;const finance=createFinanceService({db,idFactory:ids});const account=finance.createAccount({id:'BANK-1',name:'Banco',type:'BANK'});const statements=createStatementImport({db,finance,idFactory:ids,now:()=> '2026-09-23T12:00:00.000Z'});const reconciliation=createReconciliation({db,finance,statements,idFactory:ids,now:()=> '2026-09-23T12:00:00.000Z'});return{db,finance,account,statements,reconciliation};}

test('OFX parser preserves business date, cents, direction and FITID',()=>{
 const rows=parseOfx(OFX);assert.equal(rows.length,2);
 assert.deepEqual({date:rows[0].date,amountCents:rows[0].amountCents,direction:rows[0].direction,externalId:rows[0].externalId},{date:'2026-09-25',amountCents:10000,direction:'credit',externalId:'PIX-A'});
 assert.deepEqual({date:rows[1].date,amountCents:rows[1].amountCents,direction:rows[1].direction},{date:'2026-09-26',amountCents:1250,direction:'debit'});
});

test('preview does not mutate and repeated OFX commit is hard-deduplicated',async()=>{
 const fx=fixture();
 const preview=await fx.statements.preview({accountId:'BANK-1',sourceName:'extrato.ofx',content:OFX});
 assert.equal(preview.transactions.length,2);assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM bank_statement_transactions').get().n,0);
 const first=await fx.statements.commit({accountId:'BANK-1',sourceName:'extrato.ofx',content:OFX},{userId:'admin',profileId:'profile-administrator'});
 assert.equal(first.inserted,2);assert.equal(first.duplicates,0);
 const second=await fx.statements.commit({accountId:'BANK-1',sourceName:'outro-nome.ofx',content:OFX},{userId:'admin',profileId:'profile-administrator'});
 assert.equal(second.inserted,0);assert.equal(second.duplicates,2);
 assert.equal(fx.db.prepare('SELECT COUNT(*) n FROM bank_statement_transactions').get().n,2);fx.db.close();
});

test('equal PIX values with distinct FITIDs coexist while business fingerprint warns similarity',async()=>{
 const fx=fixture();
 const content=OFX.replace('TARIFA BANCARIA','PIX CLIENTE').replace('-12.50','100.00').replace('TAR-1','PIX-B').replace('20260926103000','20260925120000').replace('<TRNTYPE>DEBIT','<TRNTYPE>CREDIT');
 const result=await fx.statements.commit({accountId:'BANK-1',sourceName:'pix.ofx',content},{userId:'admin',profileId:'profile-administrator'});
 assert.equal(result.inserted,2);
 const rows=fx.db.prepare('SELECT source_fingerprint,business_fingerprint FROM bank_statement_transactions ORDER BY external_id').all();
 assert.notEqual(rows[0].source_fingerprint,rows[1].source_fingerprint);assert.equal(rows[0].business_fingerprint,rows[1].business_fingerprint);fx.db.close();
});

test('deterministic classification is advisory metadata only',async()=>{
 const fx=fixture();const result=await fx.statements.commit({accountId:'BANK-1',sourceName:'extrato.ofx',content:OFX},{userId:'admin',profileId:'profile-administrator'});
 const fee=fx.db.prepare("SELECT classification_json FROM bank_statement_transactions WHERE external_id='TAR-1'").get();
 const classification=JSON.parse(fee.classification_json);assert.equal(classification.assignments.category,'Tarifas bancárias');
 assert.equal(fx.finance.listEntries().length,0);assert.equal(result.inserted,2);fx.db.close();
});


test('rejected reconciliation pair is not suggested again',async()=>{
 const fx=fixture();const actor={userId:'admin',profileId:'profile-administrator'};
 const entry=fx.finance.createEntry({kind:'RECEIVABLE',description:'PIX CLIENTE',amountCents:10000,dueAt:'2026-09-25T12:00:00.000Z'},actor);
 await fx.statements.commit({accountId:'BANK-1',sourceName:'extrato.ofx',content:OFX},actor);
 const tx=fx.statements.listTransactions({accountId:'BANK-1'}).find(row=>row.externalId==='PIX-A');
 const before=await fx.reconciliation.suggest({accountId:'BANK-1'});
 assert.equal(before.some(row=>row.transactionId===tx.id&&row.entryId===entry.id),true);
 fx.reconciliation.reject({transactionId:tx.id,entryId:entry.id,reason:'Registro diferente',idempotencyKey:'reject-1'},actor);
 const after=await fx.reconciliation.suggest({accountId:'BANK-1'});
 assert.equal(after.some(row=>row.transactionId===tx.id&&row.entryId===entry.id),false);
 assert.equal(fx.statements.listTransactions({accountId:'BANK-1'}).find(row=>row.id===tx.id).matchStatus,'UNMATCHED');
 fx.db.close();
});
