'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runErpFinanceMigrations}=require('../js/core/database/erp-finance-migrations');
const {createFinanceService}=require('../js/domains/finance/finance-service');
const {createFinanceDimensionsService}=require('../js/domains/finance/finance-dimensions');

const admin={userId:'admin-1',profileId:'profile-administrator'};
function fixture(){
  const db=openDatabase(':memory:');
  runMigrations(db,()=> '2026-09-23T12:00:00.000Z');
  runErpFinanceMigrations(db,()=> '2026-09-23T12:00:00.000Z');
  let seq=0;
  const dimensions=createFinanceDimensionsService({db,now:()=> '2026-09-23T12:00:00.000Z',idFactory:p=>`${p}-${++seq}`});
  const finance=createFinanceService({db,dimensions,now:()=> '2026-09-23T12:00:00.000Z',idFactory:p=>`${p}-${++seq}`});
  return{db,dimensions,finance};
}

test('entry preserves source and dimensions across settlement/reversal',()=>{
  const fx=fixture();
  fx.dimensions.saveCategory({id:'TEST-EXP',name:'Teste',kind:'EXPENSE',dreGroupId:'OPERATING_EXPENSE'},admin);
  fx.dimensions.saveCostCenter({id:'STORE',name:'Loja'},admin);
  const entry=fx.finance.createEntry({kind:'PAYABLE',description:'Energia',amountCents:10000,dueAt:'2026-09-30T12:00:00.000Z',categoryId:'TEST-EXP',costCenterId:'STORE',competencyDate:'2026-09-01',sourceType:'manual-test',sourceId:'src-1'},admin);
  assert.equal(entry.categoryId,'TEST-EXP');
  assert.equal(entry.costCenterId,'STORE');
  assert.equal(entry.competencyDate,'2026-09-01');
  assert.equal(entry.sourceType,'manual-test');
  assert.equal(entry.sourceId,'src-1');
  const paid=fx.finance.settleEntry(entry.id,{amountCents:4000,method:'PIX'},admin);
  assert.equal(paid.entry.openCents,6000);
  const reversed=fx.finance.reverseSettlement(paid.settlement.id,{reason:'erro',actor:admin});
  assert.equal(reversed.entry.openCents,10000);
  assert.equal(reversed.entry.categoryId,'TEST-EXP');
  assert.equal(reversed.entry.costCenterId,'STORE');
  fx.db.close();
});

test('dimensions reject unknown/inactive references and invalid business date',()=>{
  const fx=fixture();
  assert.throws(()=>fx.finance.createEntry({kind:'PAYABLE',description:'Teste',amountCents:100,dueAt:'2026-09-30T12:00:00.000Z',categoryId:'MISSING'}),/categoria|category/i);
  fx.dimensions.saveCostCenter({id:'OLD',name:'Antigo',active:false},admin);
  assert.throws(()=>fx.finance.createEntry({kind:'PAYABLE',description:'Teste',amountCents:100,dueAt:'2026-09-30T12:00:00.000Z',costCenterId:'OLD'}),/centro|cost center/i);
  assert.throws(()=>fx.finance.createEntry({kind:'PAYABLE',description:'Teste',amountCents:100,dueAt:'2026-09-30T12:00:00.000Z',competencyDate:'23/09/2026'}),/compet/i);
  fx.db.close();
});

test('dimension catalogs remain editable without changing existing finance fields',()=>{
  const fx=fixture();
  const group=fx.dimensions.saveDreGroup({id:'SERVICES',name:'Serviços',nature:'REVENUE',sortOrder:15},admin);
  assert.equal(group.id,'SERVICES');
  const category=fx.dimensions.saveCategory({id:'SERVICE-REV',name:'Receita de serviços',kind:'INCOME',dreGroupId:'SERVICES'},admin);
  assert.equal(category.dreGroupId,'SERVICES');
  const center=fx.dimensions.saveCostCenter({id:'UNIT-A',name:'Unidade A'},admin);
  assert.equal(center.name,'Unidade A');
  assert.ok(fx.dimensions.listDreGroups().some(item=>item.id==='SERVICES'));
  assert.ok(fx.dimensions.listCategories().some(item=>item.id==='SERVICE-REV'));
  assert.ok(fx.dimensions.listCostCenters().some(item=>item.id==='UNIT-A'));
  fx.db.close();
});
