'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const read=relative=>fs.readFileSync(path.join(__dirname,'..',relative),'utf8');

test('finance operations are canonical routes, not DOM enhancements',()=>{
  const index=read('desktop/renderer/index.html');
  const app=read('desktop/renderer/app.js');
  const access=read('desktop/renderer/access-policy.js');
  const operations=read('desktop/renderer/erp-finance-operations-ui.js');

  assert.match(index,/erp-finance-operations-ui\.js/);
  assert.doesNotMatch(index,/erp-finance-automation-ui\.js/);
  for(const route of ['finance-banks','finance-recurrences','finance-alerts']){
    assert.match(app,new RegExp(`['"]${route}['"]\\s*:\\s*\\{`),`${route} must be a known app route`);
    assert.match(access,new RegExp(`['"]${route}['"]\\s*:\\s*Object\\.freeze\\(\\['finance\\.view'\\]\\)`),`${route} must have explicit capability access`);
    assert.match(operations,new RegExp(`register\\(['"]${route}['"]\\s*,\\s*\\{\\s*owner:['"]erp-finance-operations['"]`),`${route} must have one canonical renderer owner`);
  }

  assert.doesNotThrow(()=>new vm.Script(operations,{filename:'erp-finance-operations-ui.js'}));
  assert.doesNotMatch(operations,/MutationObserver/);
  assert.doesNotMatch(operations,/automationEnhanced|appendChild\(host\)|enhance\(\)/);
});

test('finance entry detail edits canonical dimensions instead of creating a parallel record',()=>{
  const operational=read('desktop/renderer/operational-pages.js');
  const start=operational.indexOf('async function renderFinance');
  const end=operational.indexOf('async function renderReports',start);
  const finance=operational.slice(start,end);

  assert.match(finance,/Editar classificação/);
  assert.match(finance,/updateFinanceDimensions\(/);
  assert.match(finance,/categoryId/);
  assert.match(finance,/costCenterId/);
  assert.match(finance,/competencyDate/);
  assert.match(finance,/PdvFinanceOperationsUi\?\.navigation\?\.\('finance'\)/);
});

test('banking and recurrence P1 actions use the existing ERP finance APIs',()=>{
  const api=read('desktop/renderer/erp-finance-api-client.js');
  const operations=read('desktop/renderer/erp-finance-operations-ui.js');

  assert.match(api,/transferSuggestions=function/);
  assert.match(api,/confirmFinanceTransfer=function/);
  assert.match(operations,/manualReconciliation\(/);
  assert.match(operations,/transferSuggestions\(/);
  assert.match(operations,/confirmFinanceTransfer\(/);
  assert.match(operations,/setRecurrenceStatus\(/);
  assert.match(operations,/generateRecurrences\(/);
  assert.match(operations,/data-recurrence-action="pause"/);
  assert.match(operations,/data-recurrence-action="resume"/);
  assert.match(operations,/data-recurrence-action="end"/);
});

test('management remains analytical and no longer owns bank, recurrence or alert operations',()=>{
  const management=read('desktop/renderer/erp-finance-ui.js');
  assert.doesNotMatch(management,/Bancos e conciliação/);
  assert.doesNotMatch(management,/erp-recurrence-form/);
  assert.doesNotMatch(management,/erp-finance-alerts/);
  assert.doesNotMatch(management,/PdvErpFinanceOperationsUi|PdvErpFinanceAutomationUi/);
});


test('bank route exposes imported OFX history and alert route restores hidden alerts',()=>{
  const api=read('desktop/renderer/erp-finance-api-client.js');
  const operations=read('desktop/renderer/erp-finance-operations-ui.js');

  assert.match(api,/statementBatches=function/);
  assert.match(api,/statementBatch=function/);
  assert.match(operations,/Extratos importados/);
  assert.match(operations,/data-statement-batch/);
  assert.match(operations,/financeAlerts\(true\)/);
  assert.match(operations,/Alertas ocultos/);
  assert.match(operations,/data-alert-unhide/);
  assert.match(operations,/unhideFinanceAlert\(/);
});

test('management renderer trusts the canonical management.view route gate instead of legacy roles',()=>{
  const management=read('desktop/renderer/erp-finance-ui.js');
  const app=read('desktop/renderer/app.js');
  assert.match(app,/hasCapability\(state\.user,'management\.view'\)/);
  assert.doesNotMatch(management,/\['admin','manager'\]|dataset\.userRole|gerentes e administradores/);
});
