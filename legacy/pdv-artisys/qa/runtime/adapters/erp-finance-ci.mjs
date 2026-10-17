function fail(message, details={}){return{ok:false,message,details};}
function pass(details={}){return{ok:true,details};}

async function ensureAuthenticated(page){
  const changed=await page.evaluate(async()=>{
    const api=new window.PdvApiClient.ApiClient();
    const config=await api.initialize();
    try{
      await api.currentSession();
      return false;
    }catch(error){
      if(Number(error?.status)!==401)throw error;
    }
    const credentials={name:'QA Finance',username:'qafinance',password:`Qa-Finance-${Date.now()}-Aa1!`};
    const setup=await api.setupStatus();
    if(setup?.needsSetup)await api.setupAdmin(credentials);
    try{
      await api.login({username:credentials.username,password:credentials.password,terminalId:config.terminalId});
    }catch(error){
      if(!setup?.needsSetup)throw new Error(`ERP finance QA fixture is unauthenticated and cannot reuse an unknown local admin: ${error.message}`);
      throw error;
    }
    return true;
  });
  if(changed){
    await page.reload({waitUntil:'domcontentloaded'});
    await page.locator('#auth-overlay').waitFor({state:'hidden',timeout:15000});
    await page.locator('#app-topbar').waitFor({state:'visible',timeout:15000});
  }
}

async function setup(page,scenario){
  await ensureAuthenticated(page);
  return page.evaluate(async scenario=>{
    const api=new window.PdvApiClient.ApiClient();await api.initialize();
    const uid=prefix=>`${prefix}-${crypto.randomUUID()}`;
    const date=n=>{const d=new Date();d.setUTCHours(12,0,0,0);d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);};
    const iso=n=>`${date(n)}T12:00:00.000Z`;
    const ofx=({amount='-100.00',fitid=uid('TX'),name='QA FORNECEDOR',days=0,type='DEBIT'}={})=>`<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST><STMTTRN><TRNTYPE>${type}<DTPOSTED>${date(days).replaceAll('-','')}120000[-3:BRT]<TRNAMT>${amount}<FITID>${fitid}<NAME>${name}</STMTTRN></BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const state={scenario,nonce:uid('qa'),today:date(0)};
    const account=async suffix=>{const id=uid(`QA-BANK-${suffix}`);await api.createFinanceAccount({id,name:`Banco QA ${suffix}`,type:'BANK'});return id;};
    const category=async(kind='EXPENSE')=>{const id=uid('QA-CAT');await api.saveFinanceCategory({id,name:`Categoria QA ${state.nonce.slice(-8)}`,kind,dreGroupId:kind==='INCOME'?'REVENUE':'OPERATING_EXPENSE'});return id;};
    const center=async()=>{const id=uid('QA-CC');await api.saveCostCenter({id,name:`Centro QA ${state.nonce.slice(-8)}`});return id;};
    const entry=async input=>api.createFinanceEntry({dueAt:iso(0),...input});
    if(scenario==='management-base'){
      state.accountId=await account('BASE');
      const p=await entry({kind:'PAYABLE',description:`QA Base Pagar ${state.nonce}`,amountCents:10000,accountId:state.accountId});
      await api.settleFinanceEntry(p.id,{amountCents:4000,method:'PIX'});await api.settleFinanceEntry(p.id,{amountCents:6000,method:'PIX'});
      const r=await entry({kind:'RECEIVABLE',description:`QA Base Receber ${state.nonce}`,amountCents:15000,accountId:state.accountId});await api.settleFinanceEntry(r.id,{amountCents:15000,method:'PIX'});
      state.payableId=p.id;state.receivableId=r.id;
    }else if(scenario==='source-link'){
      const e=await entry({kind:'RECEIVABLE',description:`QA Origem ${state.nonce}`,amountCents:12345,sourceType:'qa-e2e',sourceId:state.nonce});state.entryId=e.id;
    }else if(scenario==='dimensions'){
      state.categoryId=await category('EXPENSE');state.costCenterId=await center();const e=await entry({kind:'PAYABLE',description:`QA Dimensoes ${state.nonce}`,amountCents:9000,categoryId:state.categoryId,costCenterId:state.costCenterId,competencyDate:date(0)});state.entryId=e.id;
    }else if(scenario==='base-idempotency'){
      state.categoryId=uid('QA-IDEMP-CAT');const payload={id:state.categoryId,name:`Categoria Idempotente ${state.nonce.slice(-8)}`,kind:'EXPENSE',dreGroupId:'OPERATING_EXPENSE'};await api.saveFinanceCategory(payload);await api.saveFinanceCategory(payload);
      state.costCenterId=uid('QA-IDEMP-CC');const cp={id:state.costCenterId,name:`Centro QA ${state.nonce.slice(-8)}`};await api.saveCostCenter(cp);await api.saveCostCenter(cp);
    }else if(scenario==='business-dashboard'){
      const a=await account('DASH');const r=await entry({kind:'RECEIVABLE',description:`QA Dashboard Receita ${state.nonce}`,amountCents:50000,accountId:a});const p=await entry({kind:'PAYABLE',description:`QA Dashboard Despesa ${state.nonce}`,amountCents:15000,accountId:a});await api.settleFinanceEntry(r.id,{amountCents:50000,method:'PIX'});await api.settleFinanceEntry(p.id,{amountCents:15000,method:'PIX'});state.receivableId=r.id;state.payableId=p.id;
    }else if(scenario==='ui-reverse-settlement'){
      const e=await entry({kind:'PAYABLE',description:`QA Estorno UI ${state.nonce}`,amountCents:12300});
      const settled=await api.settleFinanceEntry(e.id,{amountCents:12300,method:'PIX',note:'QA baixa para estorno pela interface'});
      state.entryId=e.id;state.settlementId=settled.settlement.id;
    }else if(scenario==='dre'){
      state.categoryId=await category('EXPENSE');const a=await account('DRE');const p=await entry({kind:'PAYABLE',description:`QA DRE Despesa ${state.nonce}`,amountCents:10000,accountId:a,categoryId:state.categoryId,competencyDate:date(0)});const r=await entry({kind:'RECEIVABLE',description:`QA DRE Receita ${state.nonce}`,amountCents:20000,accountId:a,competencyDate:date(0)});const ps=await api.settleFinanceEntry(p.id,{amountCents:10000,method:'PIX'});await api.settleFinanceEntry(r.id,{amountCents:20000,method:'PIX'});await api.reverseFinanceSettlement(ps.settlement.id,'QA estorno');state.payableId=p.id;state.receivableId=r.id;
    }else if(scenario==='cashflow'||scenario==='cash-projection'){
      const p=await api.createFinanceEntry({kind:'PAYABLE',description:`QA Projecao Pagar ${state.nonce}`,amountCents:90000,dueAt:iso(5)});const r=await api.createFinanceEntry({kind:'RECEIVABLE',description:`QA Projecao Receber ${state.nonce}`,amountCents:10000,dueAt:iso(5)});const r30=await api.createFinanceEntry({kind:'RECEIVABLE',description:`QA Projecao 30 ${state.nonce}`,amountCents:15000,dueAt:iso(20)});state.payableId=p.id;state.receivableId=r.id;state.receivable30Id=r30.id;
    }else if(scenario==='period-comparison'){
      const now=new Date();const previous=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth()-1,15));const prev=previous.toISOString().slice(0,10);state.previousFrom=`${prev.slice(0,7)}-01`;state.previousTo=`${prev.slice(0,7)}-28`;state.currentFrom=`${state.today.slice(0,7)}-01`;state.currentTo=state.today;
      const c=await category('INCOME');await api.createFinanceEntry({kind:'RECEIVABLE',description:`QA Atual ${state.nonce}`,amountCents:30000,dueAt:iso(0),categoryId:c,competencyDate:state.today});await api.createFinanceEntry({kind:'RECEIVABLE',description:`QA Anterior ${state.nonce}`,amountCents:10000,dueAt:`${prev}T12:00:00.000Z`,categoryId:c,competencyDate:prev});
    }else if(scenario==='cost-center'){
      state.costCenterId=await center();const e=await entry({kind:'PAYABLE',description:`QA Centro ${state.nonce}`,amountCents:7700,costCenterId:state.costCenterId,competencyDate:date(0)});state.entryId=e.id;
    }else if(scenario==='statement-ofx'||scenario==='statement-dedupe'){
      state.accountId=await account('OFX');state.fitid=uid('FIT');state.content=ofx({fitid:state.fitid,name:`QA OFX ${state.nonce}`});const preview=await api.statementPreview({accountId:state.accountId,sourceName:'qa.ofx',content:state.content});state.previewCount=preview.transactions.length;state.batch1=uid('batch');state.commit1=await api.statementCommit(state.batch1,{accountId:state.accountId,sourceName:'qa.ofx',content:state.content});if(scenario==='statement-dedupe'){state.batch2=uid('batch');state.commit2=await api.statementCommit(state.batch2,{accountId:state.accountId,sourceName:'qa-2.ofx',content:state.content});}
    }else if(scenario==='reconciliation-payable'||scenario==='reconciliation-receivable'){
      const payable=scenario==='reconciliation-payable';state.accountId=await account(payable?'RECP':'RECR');const description=payable?`QA FORNECEDOR ${state.nonce}`:`QA CLIENTE ${state.nonce}`;const amountCents=payable?11000:25000;const e=await entry({kind:payable?'PAYABLE':'RECEIVABLE',description,amountCents,dueAt:iso(1)});state.entryId=e.id;state.amountCents=amountCents;const content=ofx({amount:payable?'-110.00':'250.00',fitid:uid('REC'),name:description,days:1,type:payable?'DEBIT':'CREDIT'});const batch=uid('batch');await api.statementCommit(batch,{accountId:state.accountId,sourceName:'reconcile.ofx',content});const tx=(await api.statementTransactions({accountId:state.accountId}))[0];state.transactionId=tx.id;const suggestions=await api.reconciliationSuggestions(tx.id,{accountId:state.accountId});const match=suggestions.find(s=>s.entryId===e.id)||suggestions[0];if(!match)throw new Error('QA reconciliation produced no suggestion');await api.acceptReconciliation(tx.id,{entryId:e.id,amountCents,idempotencyKey:uid('accept')});
    }else if(scenario==='bank-transfer'){
      state.accountA=await account('TRA');state.accountB=await account('TRB');state.before=(await api.financeEntries()).length;const fitA=uid('OUT'),fitB=uid('IN');await api.statementCommit(uid('batch'),{accountId:state.accountA,sourceName:'out.ofx',content:ofx({amount:'-500.00',fitid:fitA,name:'QA TRANSFERENCIA PROPRIA',type:'DEBIT'})});await api.statementCommit(uid('batch'),{accountId:state.accountB,sourceName:'in.ofx',content:ofx({amount:'500.00',fitid:fitB,name:'QA TRANSFERENCIA PROPRIA',type:'CREDIT'})});const pairs=await api.request('/api/v1/erp-finance/transfers/suggestions');if(!pairs.length)throw new Error('QA transfer pair not suggested');state.transfer=await api.request('/api/v1/erp-finance/transfers/confirm',{method:'POST',body:{...pairs[0],idempotencyKey:uid('transfer')}});
    }else if(scenario==='finance-recurrence'||scenario==='recurrence-idempotency'){
      const rule=await api.createRecurrence({kind:'PAYABLE',description:`QA Recorrencia ${state.nonce}`,amountCents:12300,startDate:state.today,dueDay:Number(state.today.slice(-2)),maxOccurrences:1});state.ruleId=rule.id;state.description=rule.description;state.first=await api.generateRecurrences(state.today);if(scenario==='recurrence-idempotency')state.second=await api.generateRecurrences(state.today);
    }else if(scenario==='financial-alerts'){
      const e=await api.createFinanceEntry({kind:'PAYABLE',description:`QA Vencida ${state.nonce}`,amountCents:32100,dueAt:iso(-2)});state.entryId=e.id;state.before=await api.financeSummary({});const alerts=await api.financeAlerts(true);const alert=alerts.find(a=>a.entryId===e.id);if(!alert)throw new Error('QA overdue alert was not generated');state.alertKey=alert.key;await api.markFinanceAlertRead(alert.key);await api.hideFinanceAlert(alert.key);state.after=await api.financeSummary({});
    }else throw new Error(`Unknown ERP finance QA scenario: ${scenario}`);
    return state;
  },scenario);
}

async function verify(page,state){
  return page.evaluate(async state=>{
    const api=new window.PdvApiClient.ApiClient();await api.initialize();const s=state.scenario;
    if(s==='management-base'){const p=(await api.financeEntries()).find(x=>x.id===state.payableId),r=(await api.financeEntries()).find(x=>x.id===state.receivableId);return p?.status==='SETTLED'&&r?.status==='SETTLED'?{ok:true}:{ok:false,message:'base entries are not settled',details:{p,r}};}
    if(s==='source-link'){const rows=await api.financeEntries({query:'QA Origem'});const e=rows.find(x=>x.id===state.entryId);return e?.sourceType==='qa-e2e'&&e?.sourceId===state.nonce?{ok:true}:{ok:false,message:'source link not preserved',details:e};}
    if(s==='dimensions'){const rows=await api.financeEntries({costCenterId:state.costCenterId});const e=rows.find(x=>x.id===state.entryId);return e?.categoryId===state.categoryId&&e?.costCenterId===state.costCenterId?{ok:true}:{ok:false,message:'dimensions not preserved',details:e};}
    if(s==='base-idempotency'){const cats=(await api.financeCategories(true)).filter(x=>x.id===state.categoryId);const centers=(await api.costCenters(true)).filter(x=>x.id===state.costCenterId);return cats.length===1&&centers.length===1?{ok:true}:{ok:false,message:'dimension upsert duplicated records',details:{cats,centers}};}
    if(s==='business-dashboard'){const d=await api.erpDashboard({from:`${state.today.slice(0,7)}-01`,to:state.today});return d.receivableSettledCents>=50000&&d.payableSettledCents>=15000?{ok:true}:{ok:false,message:'dashboard did not aggregate settled entries',details:d};}
    if(s==='ui-reverse-settlement'){const e=await api.financeEntry(state.entryId);const history=e?.settlementHistory||e?.settlements||[];const settlement=history.find(row=>String(row.id)===String(state.settlementId));return settlement?.reversedAt?{ok:true,details:settlement}:{ok:false,message:'UI reversal did not persist',details:{entry:e,settlementId:state.settlementId}};}
    if(s==='dre'){const from=`${state.today.slice(0,7)}-01`;const cash=await api.erpDre({from,to:state.today,basis:'cash'});const accrual=await api.erpDre({from,to:state.today,basis:'accrual'});return cash.revenueCents>=20000&&cash.expenseCents===0&&accrual.expenseCents>=10000?{ok:true}:{ok:false,message:'DRE cash/accrual or reversal semantics failed',details:{cash,accrual}};}
    if(s==='cashflow'||s==='cash-projection'){const base={from:state.today,to:state.today};const f7=await api.erpCashflow({...base,projectionDays:7}),f30=await api.erpCashflow({...base,projectionDays:30}),f90=await api.erpCashflow({...base,projectionDays:90});const ok=f7.projectedPayableCents>=90000&&f7.projectedReceivableCents>=10000&&f30.projectedReceivableCents>=25000&&f90.projectedClosingDeltaCents<0;return ok?{ok:true,details:{f7,f30,f90}}:{ok:false,message:'cash projection 7/30/90 failed',details:{f7,f30,f90}};}
    if(s==='period-comparison'){const c=await api.erpCompare({from:state.currentFrom,to:state.currentTo,previousFrom:state.previousFrom,previousTo:state.previousTo,basis:'accrual'});return c.current.revenueCents>=30000&&c.previous.revenueCents>=10000&&c.delta.revenueCents>0?{ok:true}:{ok:false,message:'period comparison failed',details:c};}
    if(s==='cost-center'){const rows=await api.financeEntries({costCenterId:state.costCenterId});return rows.some(x=>x.id===state.entryId)?{ok:true}:{ok:false,message:'cost-center filter failed',details:rows};}
    if(s==='statement-ofx'||s==='statement-dedupe'){const tx=await api.statementTransactions({accountId:state.accountId});const matching=tx.filter(x=>x.externalId===state.fitid);const ok=state.previewCount===1&&matching.length===1&&state.commit1.inserted===1&&(s!=='statement-dedupe'||(state.commit2.inserted===0&&state.commit2.duplicates===1));return ok?{ok:true,details:{matching,commit1:state.commit1,commit2:state.commit2}}:{ok:false,message:'OFX ingestion/dedupe failed',details:{matching,commit1:state.commit1,commit2:state.commit2}};}
    if(s==='reconciliation-payable'||s==='reconciliation-receivable'){const e=(await api.financeEntries()).find(x=>x.id===state.entryId);return e?.openCents===0&&e?.status==='SETTLED'?{ok:true}:{ok:false,message:'explicit reconciliation did not settle target',details:e};}
    if(s==='bank-transfer'){const after=(await api.financeEntries()).length;const txA=await api.statementTransactions({accountId:state.accountA}),txB=await api.statementTransactions({accountId:state.accountB});return after===state.before&&[...txA,...txB].every(x=>x.matchStatus==='TRANSFERRED')?{ok:true}:{ok:false,message:'transfer created finance entries or did not mark transactions',details:{before:state.before,after,txA,txB}};}
    if(s==='finance-recurrence'||s==='recurrence-idempotency'){const rows=await api.financeEntries({query:state.description});const ok=state.first.length===1&&rows.length===1&&(s!=='recurrence-idempotency'||state.second.length===0);return ok?{ok:true,details:{rows,first:state.first,second:state.second}}:{ok:false,message:'recurrence generation/idempotency failed',details:{rows,first:state.first,second:state.second}};}
    if(s==='financial-alerts'){const visible=await api.financeAlerts(false),all=await api.financeAlerts(true);const row=all.find(a=>a.key===state.alertKey);const same=JSON.stringify(state.before)===JSON.stringify(state.after);return same&&!visible.some(a=>a.key===state.alertKey)&&Boolean(row?.readAt)&&Boolean(row?.hiddenAt)?{ok:true}:{ok:false,message:'alert state changed finance or hide/read failed',details:{row,same}};}
    return{ok:false,message:`Unknown assert scenario ${s}`};
  },state);
}

export default {
  capabilities:{
    'finance.setup':async({page,step,runtimeContext})=>{const state=await setup(page,step.scenario);runtimeContext.erpFinanceState=state;},
    'finance.assert':async({page,runtimeContext})=>{const result=await verify(page,runtimeContext.erpFinanceState||{});if(!result.ok)throw new Error(`${result.message}: ${JSON.stringify(result.details||{})}`);},
    'finance.openReverseDialog':async({page,runtimeContext})=>{const settlementId=runtimeContext.erpFinanceState?.settlementId;if(!settlementId)throw new Error('finance.openReverseDialog requires a seeded settlement');const target=page.locator(`#backend-finance-parity [data-reverse-settlement="${settlementId}"]`);await target.waitFor({state:'visible',timeout:15000});await target.click();await page.locator('.ux-dialog').waitFor({state:'visible',timeout:10000});},
    'finance.openManagement':async({page})=>{await page.evaluate(()=>window.PdvErpFinanceUi.renderManagement());await page.locator('.erp-management-page').waitFor({state:'visible',timeout:15000});},
    'finance.openFinance':async({page})=>{await page.locator("[data-route='finance']").click();await page.locator('#ops-finance-form').waitFor({state:'visible',timeout:15000});}
  }
};
