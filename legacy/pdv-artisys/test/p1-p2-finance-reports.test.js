'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {runErpFinanceMigrations}=require('../js/core/database/erp-finance-migrations');
const {createFinanceDimensionsService}=require('../js/domains/finance/finance-dimensions');
const {createFinanceService}=require('../js/domains/finance/finance-service');
const {createFinanceManagementService}=require('../js/domains/finance/finance-management');
const {createReportingService}=require('../js/domains/reports/reporting-service');

const admin={userId:'admin-p12',profileId:'profile-administrator'};
const NOW='2026-10-02T12:00:00.000Z';

function financeFixture(){
  const db=openDatabase(':memory:');
  runMigrations(db,()=>NOW);
  runErpFinanceMigrations(db,()=>NOW);
  let seq=0;
  const ids=p=>`${p}-${++seq}`;
  const dimensions=createFinanceDimensionsService({db,now:()=>NOW,idFactory:ids});
  const finance=createFinanceService({db,dimensions,now:()=>NOW,idFactory:ids});
  return{db,dimensions,finance,ids};
}

test('finance entry exposes complete settlement history including reversals',()=>{
  const fx=financeFixture();
  try{
    const entry=fx.finance.createEntry({kind:'PAYABLE',description:'Fornecedor',amountCents:10000,dueAt:'2026-10-10T12:00:00.000Z'},admin);
    const first=fx.finance.settleEntry(entry.id,{amountCents:4000,method:'PIX',note:'Parcial'},admin).settlement;
    fx.finance.reverseSettlement(first.id,{reason:'Baixa duplicada',actor:admin});
    fx.finance.settleEntry(entry.id,{amountCents:3000,method:'CASH'},admin);
    const detail=fx.finance.getEntry(entry.id);
    assert.equal(detail.settlements.length,1,'active settlements stay compatible');
    assert.equal(detail.settlementHistory.length,2);
    assert.equal(detail.settlementHistory.find(row=>row.id===first.id).reversedAt!=null,true);
  }finally{fx.db.close();}
});

test('finance filters accept category cost center and overdue query semantics',()=>{
  const fx=financeFixture();
  try{
    fx.dimensions.saveDreGroup({id:'OPS',name:'Operacional',nature:'EXPENSE',sortOrder:30},admin);
    fx.dimensions.saveCategory({id:'RENT-X',name:'Aluguel',kind:'EXPENSE',dreGroupId:'OPS'},admin);
    fx.dimensions.saveCostCenter({id:'STORE-X',name:'Loja'},admin);
    const entry=fx.finance.createEntry({kind:'PAYABLE',description:'Aluguel loja',amountCents:5000,dueAt:'2026-09-01T12:00:00.000Z',categoryId:'RENT-X',costCenterId:'STORE-X',competencyDate:'2026-09-01'},admin);
    const rows=fx.finance.listEntries({categoryId:'RENT-X',costCenterId:'STORE-X',overdue:'true',asOf:NOW});
    assert.deepEqual(rows.map(row=>row.id),[entry.id]);
  }finally{fx.db.close();}
});

test('DRE groups by configured DRE group, respects sort order and exposes trace ids',()=>{
  const fx=financeFixture();
  try{
    fx.dimensions.saveDreGroup({id:'G20',name:'Despesas administrativas',nature:'EXPENSE',sortOrder:20},admin);
    fx.dimensions.saveDreGroup({id:'G10',name:'Receitas adicionais',nature:'REVENUE',sortOrder:10},admin);
    fx.dimensions.saveCategory({id:'C20',name:'Aluguel',kind:'EXPENSE',dreGroupId:'G20'},admin);
    fx.dimensions.saveCategory({id:'C10',name:'Outras receitas',kind:'INCOME',dreGroupId:'G10'},admin);
    const expense=fx.finance.createEntry({kind:'PAYABLE',description:'Aluguel',amountCents:3000,dueAt:'2026-10-02T12:00:00.000Z',categoryId:'C20',competencyDate:'2026-10-01'},admin);
    const income=fx.finance.createEntry({kind:'RECEIVABLE',description:'Receita extra',amountCents:5000,dueAt:'2026-10-02T12:00:00.000Z',categoryId:'C10',competencyDate:'2026-10-01'},admin);
    const management=createFinanceManagementService({db:fx.db,finance:fx.finance,dimensions:fx.dimensions,now:()=>NOW});
    const dre=management.dre({basis:'accrual',from:'2026-10-01',to:'2026-10-31'});
    const configured=dre.groups.filter(row=>['G10','G20'].includes(row.id));
    assert.deepEqual(configured.map(row=>row.id),['G10','G20']);
    assert.deepEqual(configured[0].entryIds,[income.id]);
    assert.deepEqual(configured[1].entryIds,[expense.id]);
  }finally{fx.db.close();}
});

function reportFixture(){
  const db=openDatabase(':memory:');runMigrations(db,()=>NOW);
  db.prepare("INSERT INTO users (id,username,name,role,password_hash,password_salt,active,created_at,updated_at) VALUES ('u1','ana','Ana','cashier','h','s',1,?,?)").run(NOW,NOW);
  db.prepare("INSERT INTO categories (id,name,active,created_at,updated_at) VALUES ('c1','Geral',1,?,?)").run(NOW,NOW);
  db.prepare("INSERT INTO customers (id,name,active,credit_limit_cents,credit_used_cents,created_at,updated_at) VALUES ('cli1','Maria',1,0,0,?,?)").run(NOW,NOW);
  db.prepare("INSERT INTO products (id,sku,name,category_id,unit,sale_price_cents,cost_cents,track_stock,minimum_stock,active,created_at,updated_at) VALUES ('p1','SKU1','Café','c1','UN',2000,1000,0,0,1,?,?)").run(NOW,NOW);
  db.prepare(`INSERT INTO sales (id,sale_number,terminal_id,operator_id,customer_id,status,subtotal_cents,discount_cents,total_cents,change_cents,opened_at,completed_at,updated_at)
    VALUES ('s1','V-001','T1','u1','cli1','COMPLETED',2000,0,2000,0,?,?,?)`).run('2026-10-02T10:00:00.000Z','2026-10-02T10:05:00.000Z','2026-10-02T10:05:00.000Z');
  db.prepare("INSERT INTO sale_items (id,sale_id,product_id,product_name,sku,quantity,unit_price_cents,total_cents,created_at,updated_at) VALUES ('i1','s1','p1','Café','SKU1',1,2000,2000,?,?)").run(NOW,NOW);
  db.prepare("INSERT INTO payments (id,sale_id,method,amount_cents,created_at) VALUES ('pa1','s1','PIX',2000,?)").run(NOW);
  return{db,reports:createReportingService({db,now:()=>NOW})};
}

test('sales drilldown returns source sales for customer product and payment filters',()=>{
  const fx=reportFixture();
  try{
    for(const filters of [{customerId:'cli1'},{productId:'p1'},{paymentMethod:'PIX'}]){
      const rows=fx.reports.buildSalesDetails({from:'2026-10-01',to:'2026-10-31',...filters});
      assert.equal(rows.length,1);
      assert.equal(rows[0].saleNumber,'V-001');
      assert.equal(rows[0].customerName,'Maria');
      assert.equal(rows[0].payments[0].method,'PIX');
    }
  }finally{fx.db.close();}
});

test('P1/P2 renderer contract exposes traceability without redesigning approved pages',()=>{
  const renderer=path.join(__dirname,'..','desktop','renderer');
  const finance=fs.readFileSync(path.join(renderer,'operational-pages.js'),'utf8');
  const management=fs.readFileSync(path.join(renderer,'erp-finance-ui.js'),'utf8');
  const reports=fs.readFileSync(path.join(renderer,'reporting-v2.js'),'utf8');
  const api=fs.readFileSync(path.join(renderer,'api-client.js'),'utf8');
  const erpApi=fs.readFileSync(path.join(renderer,'erp-finance-api-client.js'),'utf8');

  const financeStart=finance.indexOf('async function renderFinance');
  const financeEnd=finance.indexOf('async function renderReports',financeStart);
  const financeSection=finance.slice(financeStart,financeEnd);
  assert.doesNotMatch(financeSection,/name="category"/);
  for(const marker of ['ops-finance-filter','data-finance-detail','data-finance-reverse','categoryId','costCenterId','competencyDate']) assert.match(financeSection,new RegExp(marker));
  assert.match(api,/financeEntry\(id\)/);
  assert.match(api,/reportSalesDetails/);

  for(const marker of ['data-dre-group','erp-export-dre','saveDreGroup','saveFinanceCategory','Abrir Relatórios']) assert.match(management,new RegExp(marker));
  assert.match(erpApi,/saveDreGroup/);
  assert.doesNotMatch(management,/>REVENUE<|>COST<|>EXPENSE</);

  assert.match(reports,/role="tablist"/);
  assert.match(reports,/role="tab"/);
  assert.match(reports,/aria-selected/);
  assert.match(reports,/ArrowRight|ArrowLeft/);
  for(const preset of ['Hoje','Últimos 7 dias','Este mês','Mês anterior']) assert.match(reports,new RegExp(preset));
  assert.match(reports,/data-report-drilldown/);
  assert.match(reports,/Abrir Gestão/);
  assert.match(reports,/Margem %/);
  assert.doesNotMatch(reports,/Qtd\. devolvida<\/th><th>Qtd\. líquida<\/th><th>Linhas antes desc\./);
});
