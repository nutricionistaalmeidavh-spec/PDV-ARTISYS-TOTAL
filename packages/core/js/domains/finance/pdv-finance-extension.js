'use strict';
const { runErpFinanceMigrations }=require('../../core/database/erp-finance-migrations');
const { runErpFinanceP3Migrations }=require('../../core/database/erp-finance-p3-migrations');
const { createFinanceDimensionsService }=require('./finance-dimensions');
const { createFinanceService }=require('./finance-service');
const { createProcurementService }=require('../procurement/procurement-service');
const { createFinanceManagementService }=require('./finance-management');
const { createStatementImport }=require('./statement-import');
const { createReconciliation }=require('./reconciliation');
const { createRecurrenceService }=require('./recurrence');
const { createFinanceAlertService }=require('./finance-alerts');

function ensurePdvFinance(runtime,{now=()=>new Date().toISOString(),idFactory}={}){
  if(!runtime?.db||!runtime?.inventory)throw new TypeError('PDV runtime invalido para extensao financeira.');
  if(runtime.__pdvFinanceP0P3Attached)return runtime;
  runErpFinanceMigrations(runtime.db,now);runErpFinanceP3Migrations(runtime.db);
  const common={db:runtime.db,authorization:runtime.authorization||null,now};if(idFactory)common.idFactory=idFactory;
  const financeDimensions=createFinanceDimensionsService(common);
  const finance=createFinanceService({...common,dimensions:financeDimensions});
  const procurement=createProcurementService({...common,inventory:runtime.inventory,finance});
  const financeManagement=createFinanceManagementService({db:runtime.db,finance,reports:runtime.reports,dimensions:financeDimensions,now});
  const bankStatements=createStatementImport({...common,finance});
  const financeReconciliation=createReconciliation({...common,finance,statements:bankStatements});
  const financeRecurrences=createRecurrenceService({...common,finance});
  const financeAlerts=createFinanceAlertService({db:runtime.db,finance,financeManagement,settings:runtime.settings,now});
  Object.assign(runtime,{financeDimensions,finance,procurement,financeManagement,bankStatements,financeReconciliation,financeRecurrences,financeAlerts});
  Object.defineProperty(runtime,'__pdvFinanceP0P3Attached',{value:true,enumerable:false,configurable:false});
  return runtime;
}
module.exports={ensurePdvFinance};
