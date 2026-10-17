'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');
test('PDV management UI exposes owner dashboard and finance dimensions',()=>{
 const api=fs.readFileSync('desktop/renderer/erp-finance-api-client.js','utf8');
 const ui=fs.readFileSync('desktop/renderer/erp-finance-ui.js','utf8');
 const finance=fs.readFileSync('desktop/renderer/operational-pages.js','utf8');
 const index=fs.readFileSync('desktop/renderer/index.html','utf8');
 for(const method of ['financeCategories','saveFinanceCategory','costCenters','saveCostCenter','updateFinanceDimensions','erpDashboard','erpDre','erpCashflow','erpCompare','erpDrilldown'])assert.match(api,new RegExp(`${method}\\s*=function`));
 assert.match(api,/route:'management'.*label:'Gestão'|label:'Gestão'.*route:'management'/s);
 for(const id of ['erp-management-filter','erp-management-metrics','erp-dre','erp-cashflow','erp-period-comparison','erp-drilldown-panel'])assert.match(ui,new RegExp(id));
 assert.match(finance,/name=\\?"categoryId/);assert.match(finance,/name=\\?"costCenterId/);assert.match(finance,/name=\\?"competencyDate/);
 assert.match(index,/erp-finance-api-client\.js/);assert.match(index,/erp-finance-ui\.js/);
});
