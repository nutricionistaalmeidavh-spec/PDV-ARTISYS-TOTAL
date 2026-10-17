'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runErpFinanceMigrations}=require('../js/core/database/erp-finance-migrations');
const {createFinanceDimensionsService}=require('../js/domains/finance/finance-dimensions');
const {createFinanceService}=require('../js/domains/finance/finance-service');
const {createReportingService}=require('../js/domains/reports/historical-reporting-service');
const {createFinanceManagementService}=require('../js/domains/finance/finance-management');
const admin={userId:'admin',profileId:'profile-administrator'};
function fixture(now='2026-09-20T12:00:00.000Z'){
 const db=openDatabase(':memory:');runMigrations(db,()=>now);runErpFinanceMigrations(db,()=>now);let seq=0;
 const dimensions=createFinanceDimensionsService({db,now:()=>now,idFactory:p=>`${p}-${++seq}`});
 const finance=createFinanceService({db,dimensions,now:()=>now,idFactory:p=>`${p}-${++seq}`});
 const reports=createReportingService({db,now:()=>now});
 const management=createFinanceManagementService({db,finance,reports,dimensions,now:()=>now});
 return{db,dimensions,finance,reports,management};
}

test('cash DRE uses active settlements and accrual DRE uses competency',()=>{
 const fx=fixture();
 const entry=fx.finance.createEntry({kind:'PAYABLE',description:'Aluguel',categoryId:'RENT',amountCents:10000,dueAt:'2026-09-25T12:00:00.000Z',competencyDate:'2026-09-01'},admin);
 const paid=fx.finance.settleEntry(entry.id,{amountCents:4000,method:'PIX'},admin);
 assert.equal(fx.management.dre({basis:'cash',from:'2026-09-01',to:'2026-09-30'}).expenseCents,4000);
 assert.equal(fx.management.dre({basis:'accrual',from:'2026-09-01',to:'2026-09-30'}).expenseCents,10000);
 fx.finance.reverseSettlement(paid.settlement.id,{reason:'teste',actor:admin});
 assert.equal(fx.management.dre({basis:'cash',from:'2026-09-01',to:'2026-09-30'}).expenseCents,0);
 fx.db.close();
});

test('dashboard honors selected DRE basis instead of forcing cash',()=>{
 const fx=fixture();
 const entry=fx.finance.createEntry({kind:'PAYABLE',description:'Aluguel base',amountCents:10000,dueAt:'2026-09-25T12:00:00.000Z',competencyDate:'2026-09-01'},admin);
 fx.finance.settleEntry(entry.id,{amountCents:4000,method:'PIX'},admin);
 const cash=fx.management.dashboard({from:'2026-09-01',to:'2026-09-30',basis:'cash'});
 const accrual=fx.management.dashboard({from:'2026-09-01',to:'2026-09-30',basis:'accrual'});
 assert.equal(cash.basis,'cash');assert.equal(cash.expenseCents,4000);
 assert.equal(accrual.basis,'accrual');assert.equal(accrual.expenseCents,10000);
 fx.db.close();
});

test('cashflow projects open receivables/payables at 7 30 90 days',()=>{
 const fx=fixture();
 fx.finance.createEntry({kind:'RECEIVABLE',description:'Cliente',categoryId:'OTHER',amountCents:15000,dueAt:'2026-09-25T12:00:00.000Z',competencyDate:'2026-09-01'},admin);
 fx.finance.createEntry({kind:'PAYABLE',description:'Fornecedor',categoryId:'OTHER',amountCents:6000,dueAt:'2026-10-10T12:00:00.000Z',competencyDate:'2026-10-01'},admin);
 const flow=fx.management.cashflow({from:'2026-09-20',to:'2026-09-20',projectionDays:30});
 assert.equal(flow.projectedReceivableCents,15000);
 assert.equal(flow.projectedPayableCents,6000);
 assert.equal(flow.projectedDeltaCents,9000);
 const dashboard=fx.management.dashboard({from:'2026-09-01',to:'2026-09-30'});
 assert.ok('resultCents' in dashboard);
 assert.ok(dashboard.projections['7']&&dashboard.projections['30']&&dashboard.projections['90']);
 fx.db.close();
});

test('period comparison and drilldown preserve source traceability',()=>{
 const fx=fixture();
 const entry=fx.finance.createEntry({kind:'PAYABLE',description:'Taxa',categoryId:'FEES',amountCents:1000,dueAt:'2026-09-20T12:00:00.000Z',competencyDate:'2026-09-01',sourceType:'manual-test',sourceId:'source-77'},admin);
 fx.finance.settleEntry(entry.id,{amountCents:1000,method:'PIX'},admin);
 const comparison=fx.management.compare({from:'2026-09-01',to:'2026-09-30',previousFrom:'2026-08-01',previousTo:'2026-08-31'});
 assert.equal(comparison.current.expenseCents,1000);
 assert.equal(comparison.previous.expenseCents,0);
 const detail=fx.management.drilldown({entryId:entry.id});
 assert.equal(detail.sourceType,'manual-test');
 assert.equal(detail.sourceId,'source-77');
 fx.db.close();
});
