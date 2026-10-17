'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runErpFinanceMigrations}=require('../js/core/database/erp-finance-migrations');
const {createFinanceDimensionsService}=require('../js/domains/finance/finance-dimensions');
const {createFinanceService}=require('../js/domains/finance/finance-service');
const {createStatementImport}=require('../js/domains/finance/statement-import');
const {createReconciliation}=require('../js/domains/finance/reconciliation');
const admin={userId:'admin',role:'admin'};
function ofx({amount='-100.00',fitid='TX-1',name='FORNECEDOR TESTE',date='20260925',type='DEBIT'}={}){return `<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNTYPE>${type}<DTPOSTED>${date}120000[-3:BRT]<TRNAMT>${amount}<FITID>${fitid}<NAME>${name}</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;}
async function fixture(){const db=openDatabase(':memory:');runMigrations(db);runErpFinanceMigrations(db);let seq=0;const dimensions=createFinanceDimensionsService({db,idFactory:p=>`${p}-${++seq}`});const finance=createFinanceService({db,dimensions,idFactory:p=>`${p}-${++seq}`});finance.createAccount({id:'BANK-1',name:'Banco 1',type:'BANK'},admin);finance.createAccount({id:'BANK-2',name:'Banco 2',type:'BANK'},admin);const statements=createStatementImport({db,finance,idFactory:p=>`${p}-${++seq}`});const reconciliation=createReconciliation({db,finance,statements,idFactory:p=>`${p}-${++seq}`});return{db,finance,statements,reconciliation};}

test('payable suggestion never settles before explicit confirmation and confirmation is idempotent',async()=>{
 const fx=await fixture();const entry=fx.finance.createEntry({kind:'PAYABLE',description:'FORNECEDOR TESTE',categoryId:'PURCHASES',amountCents:10000,dueAt:'2026-09-25T12:00:00.000Z'},admin);
 await fx.statements.commit({accountId:'BANK-1',sourceName:'extrato.ofx',content:ofx()},admin);
 const suggestions=await fx.reconciliation.suggest({accountId:'BANK-1'});assert.ok(suggestions.some(s=>s.entryId===entry.id));assert.equal(fx.finance.getEntry(entry.id).openCents,10000);
 const suggestion=suggestions.find(s=>s.entryId===entry.id);const first=await fx.reconciliation.confirm({transactionId:suggestion.transactionId,entryId:entry.id,amountCents:10000,idempotencyKey:'accept-1'},admin);assert.equal(first.decision,'ACCEPTED');assert.equal(fx.finance.getEntry(entry.id).openCents,0);
 const second=await fx.reconciliation.confirm({transactionId:suggestion.transactionId,entryId:entry.id,amountCents:10000,idempotencyKey:'accept-1'},admin);assert.equal(second.id,first.id);assert.equal(fx.finance.getEntry(entry.id).settlements.length,1);fx.db.close();
});

test('credit statement can reconcile a receivable',async()=>{
 const fx=await fixture();const entry=fx.finance.createEntry({kind:'RECEIVABLE',description:'CLIENTE TESTE',categoryId:'OTHER',amountCents:25000,dueAt:'2026-09-26T12:00:00.000Z'},admin);
 await fx.statements.commit({accountId:'BANK-1',sourceName:'recebimentos.ofx',content:ofx({amount:'250.00',fitid:'REC-1',name:'CLIENTE TESTE',date:'20260926',type:'CREDIT'})},admin);
 const suggestions=await fx.reconciliation.suggest({accountId:'BANK-1'});const match=suggestions.find(s=>s.entryId===entry.id);assert.ok(match);await fx.reconciliation.confirm({transactionId:match.transactionId,entryId:entry.id,amountCents:25000,idempotencyKey:'receive-1'},admin);assert.equal(fx.finance.getEntry(entry.id).openCents,0);fx.db.close();
});

test('rejection is audited as a decision but leaves transaction and finance entry open',async()=>{
 const fx=await fixture();const entry=fx.finance.createEntry({kind:'PAYABLE',description:'FORNECEDOR TESTE',categoryId:'PURCHASES',amountCents:10000,dueAt:'2026-09-25T12:00:00.000Z'},admin);await fx.statements.commit({accountId:'BANK-1',sourceName:'x.ofx',content:ofx()},admin);const tx=fx.statements.listTransactions()[0];const result=fx.reconciliation.reject({transactionId:tx.id,entryId:entry.id,reason:'nao corresponde',idempotencyKey:'reject-1'},admin);assert.equal(result.decision,'REJECTED');assert.equal(fx.finance.getEntry(entry.id).openCents,10000);assert.equal(fx.statements.listTransactions()[0].matchStatus,'UNMATCHED');fx.db.close();
});

test('own-account transfer detection and confirmation do not create finance entries',async()=>{
 const fx=await fixture();await fx.statements.commit({accountId:'BANK-1',sourceName:'a.ofx',content:ofx({amount:'-500.00',fitid:'OUT-1',name:'TRANSFERENCIA PROPRIA'})},admin);await fx.statements.commit({accountId:'BANK-2',sourceName:'b.ofx',content:ofx({amount:'500.00',fitid:'IN-1',name:'TRANSFERENCIA PROPRIA',type:'CREDIT'})},admin);const pairs=await fx.reconciliation.suggestTransfers();assert.equal(pairs.length,1);const transfer=fx.reconciliation.confirmTransfer({...pairs[0],idempotencyKey:'transfer-1'},admin);assert.equal(transfer.status,'CONFIRMED');assert.equal(fx.finance.listEntries().length,0);assert.ok(fx.statements.listTransactions().every(row=>row.matchStatus==='TRANSFERRED'));fx.db.close();
});
