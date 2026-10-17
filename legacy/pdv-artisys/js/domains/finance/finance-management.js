'use strict';

function businessDate(value,label='data'){
  const text=String(value||'').trim();
  if(!/^\d{4}-\d{2}-\d{2}$/.test(text))throw new Error(`${label} invalida; use AAAA-MM-DD.`);
  const date=new Date(`${text}T00:00:00.000Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==text)throw new Error(`${label} invalida.`);
  return text;
}
function addDays(dateText,days){const date=new Date(`${businessDate(dateText)}T00:00:00.000Z`);date.setUTCDate(date.getUTCDate()+Number(days||0));return date.toISOString().slice(0,10);}
function rangeIso(from,to){return{fromIso:`${businessDate(from,'Data inicial')}T00:00:00.000Z`,toIso:`${businessDate(to,'Data final')}T23:59:59.999Z`};}
function cents(value){return Number.isFinite(Number(value))?Math.round(Number(value)):0;}

function createFinanceManagementService({db,finance,reports=null,dimensions=null,now=()=>new Date().toISOString()}={}){
  if(!db||!finance)throw new TypeError('db and finance are required.');

  function categoryNature(entryId,kind){
    const row=db.prepare(`SELECT g.id AS group_id,g.name AS group_name,g.nature,g.sort_order,c.id AS category_id,c.name AS category_name,cc.id AS cost_center_id,cc.name AS cost_center_name,d.competency_date
      FROM financial_entry_dimensions d
      LEFT JOIN financial_categories c ON c.id=d.category_id
      LEFT JOIN finance_dre_groups g ON g.id=c.dre_group_id
      LEFT JOIN cost_centers cc ON cc.id=d.cost_center_id
      WHERE d.entry_id=?`).get(String(entryId));
    return{nature:row?.nature||(kind==='RECEIVABLE'?'REVENUE':'EXPENSE'),groupId:row?.group_id||null,groupName:row?.group_name||null,sortOrder:Number(row?.sort_order??900),categoryId:row?.category_id||null,categoryName:row?.category_name||null,costCenterId:row?.cost_center_id||null,costCenterName:row?.cost_center_name||null,competencyDate:row?.competency_date||null};
  }

  function salesSummary(from,to){
    if(!reports||typeof reports.buildSalesSummary!=='function')return{netSalesCents:0,estimatedCostCents:0,estimatedMarginCents:0,saleIds:[]};
    const {fromIso,toIso}=rangeIso(from,to);
    try{return reports.buildSalesSummary({from:fromIso,to:toIso})||{netSalesCents:0,estimatedCostCents:0,estimatedMarginCents:0,saleIds:[]};}
    catch{return{netSalesCents:0,estimatedCostCents:0,estimatedMarginCents:0,saleIds:[]};}
  }

  function financialDreRows({basis,from,to}){
    const fromDate=businessDate(from,'Data inicial');const toDate=businessDate(to,'Data final');
    if(fromDate>toDate)throw new Error('Data inicial nao pode ser posterior a data final.');
    if(basis==='cash'){
      return db.prepare(`SELECT fe.id,fe.kind,fe.source_type,fe.source_id,fs.amount_cents AS amount_cents,substr(fs.created_at,1,10) AS business_date
        FROM financial_settlements fs JOIN financial_entries fe ON fe.id=fs.entry_id
        WHERE fs.reversed_at IS NULL AND fe.status<>'CANCELLED' AND substr(fs.created_at,1,10)>=? AND substr(fs.created_at,1,10)<=?
        ORDER BY fs.created_at,fs.id`).all(fromDate,toDate);
    }
    if(basis!=='accrual')throw new Error('Base DRE deve ser cash ou accrual.');
    return db.prepare(`SELECT fe.id,fe.kind,fe.source_type,fe.source_id,fe.amount_cents,
        COALESCE(d.competency_date,substr(fe.due_at,1,10)) AS business_date
      FROM financial_entries fe LEFT JOIN financial_entry_dimensions d ON d.entry_id=fe.id
      WHERE fe.status<>'CANCELLED' AND COALESCE(d.competency_date,substr(fe.due_at,1,10))>=? AND COALESCE(d.competency_date,substr(fe.due_at,1,10))<=?
      ORDER BY business_date,fe.id`).all(fromDate,toDate);
  }

  function dre({basis='cash',from,to}={}){
    const rows=financialDreRows({basis,from,to});
    const sales=salesSummary(from,to);
    const result={basis,from:businessDate(from),to:businessDate(to),revenueCents:cents(sales.netSalesCents),costCents:cents(sales.estimatedCostCents),expenseCents:0,otherResultCents:0,resultCents:0,groups:[],financialRows:rows.length};
    const groups=new Map();
    const addGroup=(key,name,nature,amount,{sortOrder=900,entryId=null,saleIds=[]}={})=>{
      const current=groups.get(key)||{id:key,name:name||key,nature,sortOrder:Number(sortOrder??900),amountCents:0,entryIds:[],saleIds:[]};
      current.amountCents+=amount;
      if(entryId&&!current.entryIds.includes(String(entryId)))current.entryIds.push(String(entryId));
      for(const saleId of saleIds||[])if(saleId&&!current.saleIds.includes(String(saleId)))current.saleIds.push(String(saleId));
      groups.set(key,current);
    };
    if(result.revenueCents)addGroup('PDV_SALES','Vendas PDV','REVENUE',result.revenueCents,{sortOrder:0,saleIds:sales.saleIds||[]});
    if(result.costCents)addGroup('PDV_COGS','Custo das vendas','COST',result.costCents,{sortOrder:15,saleIds:sales.saleIds||[]});
    for(const row of rows){
      if(row.source_type==='sale' || row.source_type==='sale-payment')continue;
      const meta=categoryNature(row.id,row.kind);const amount=cents(row.amount_cents);
      if(meta.nature==='REVENUE')result.revenueCents+=amount;
      else if(meta.nature==='COST')result.costCents+=amount;
      else if(meta.nature==='EXPENSE')result.expenseCents+=amount;
      else result.otherResultCents+=(row.kind==='RECEIVABLE'?amount:-amount);
      const key=meta.groupId||`${row.kind}_UNCLASSIFIED`;
      const name=meta.groupName||(row.kind==='RECEIVABLE'?'Receitas sem grupo':'Despesas sem grupo');
      const groupAmount=meta.nature==='OTHER'&&row.kind==='PAYABLE'?-amount:amount;
      addGroup(key,name,meta.nature,groupAmount,{sortOrder:meta.sortOrder,entryId:row.id});
    }
    result.resultCents=result.revenueCents-result.costCents-result.expenseCents+result.otherResultCents;
    result.groups=[...groups.values()].sort((a,b)=>a.sortOrder-b.sortOrder||a.name.localeCompare(b.name,'pt-BR'));
    return result;
  }

  function activeSettlementTotals(from,to){
    const fromDate=businessDate(from);const toDate=businessDate(to);
    const rows=db.prepare(`SELECT fe.kind,COALESCE(SUM(fs.amount_cents),0) AS total
      FROM financial_settlements fs JOIN financial_entries fe ON fe.id=fs.entry_id
      WHERE fs.reversed_at IS NULL AND fe.status<>'CANCELLED' AND substr(fs.created_at,1,10)>=? AND substr(fs.created_at,1,10)<=?
      GROUP BY fe.kind`).all(fromDate,toDate);
    const out={inflowCents:0,outflowCents:0};for(const row of rows){if(row.kind==='RECEIVABLE')out.inflowCents+=cents(row.total);else out.outflowCents+=cents(row.total);}return out;
  }

  function cashflow({from,to,projectionDays=30}={}){
    const fromDate=businessDate(from,'Data inicial');const toDate=businessDate(to,'Data final');if(fromDate>toDate)throw new Error('Data inicial nao pode ser posterior a data final.');
    const days=Number(projectionDays);if(!Number.isInteger(days)||days<0||days>3660)throw new Error('Periodo de projecao invalido.');
    const realized=activeSettlementTotals(fromDate,toDate);const sales=salesSummary(fromDate,toDate);
    realized.inflowCents+=cents(sales.netSalesCents);
    const horizon=addDays(toDate,days);
    const open=finance.listEntries({asOf:`${toDate}T23:59:59.999Z`}).filter(entry=>entry.status!=='CANCELLED'&&entry.openCents>0&&String(entry.dueAt||'').slice(0,10)>=toDate&&String(entry.dueAt||'').slice(0,10)<=horizon);
    let projectedReceivableCents=0,projectedPayableCents=0;
    for(const entry of open){if(entry.kind==='RECEIVABLE')projectedReceivableCents+=entry.openCents;else projectedPayableCents+=entry.openCents;}
    return{from:fromDate,to:toDate,projectionDays:days,horizon,realizedInflowCents:realized.inflowCents,realizedOutflowCents:realized.outflowCents,realizedDeltaCents:realized.inflowCents-realized.outflowCents,projectedReceivableCents,projectedPayableCents,projectedDeltaCents:projectedReceivableCents-projectedPayableCents,projectedClosingDeltaCents:(realized.inflowCents-realized.outflowCents)+(projectedReceivableCents-projectedPayableCents)};
  }

  function dashboard({from,to,basis='cash'}={}){
    const current=dre({basis,from,to});const financeSummary=finance.getSummary({from:`${businessDate(from)}T00:00:00.000Z`,to:`${businessDate(to)}T23:59:59.999Z`,asOf:now()});
    const projections={};for(const days of [7,30,90])projections[String(days)]=cashflow({from:to,to,projectionDays:days});
    const grossBase=current.revenueCents;const marginPercent=grossBase?Number((((current.revenueCents-current.costCents)/grossBase)*100).toFixed(2)):0;
    return{basis:current.basis,from:businessDate(from),to:businessDate(to),revenueCents:current.revenueCents,costCents:current.costCents,expenseCents:current.expenseCents,resultCents:current.resultCents,marginPercent,...financeSummary,projections};
  }

  function compare({from,to,previousFrom,previousTo,basis='cash'}={}){
    const current=dre({basis,from,to});const previous=dre({basis,from:previousFrom,to:previousTo});
    return{current,previous,delta:{revenueCents:current.revenueCents-previous.revenueCents,costCents:current.costCents-previous.costCents,expenseCents:current.expenseCents-previous.expenseCents,resultCents:current.resultCents-previous.resultCents}};
  }

  function drilldown({entryId}={}){const entry=finance.getEntry(entryId);if(!entry)throw new Error('Lancamento financeiro nao encontrado.');return entry;}

  function aggregateDimension({from,to,basis='accrual',dimension='category'}={}){
    const rows=financialDreRows({basis,from,to});const map=new Map();
    for(const row of rows){const meta=categoryNature(row.id,row.kind);const key=dimension==='costCenter'?(meta.costCenterId||'UNASSIGNED'):(meta.categoryId||'UNCLASSIFIED');const name=dimension==='costCenter'?(meta.costCenterName||'Sem centro de custo'):(meta.categoryName||'Sem categoria');const item=map.get(key)||{id:key,name,receivableCents:0,payableCents:0,netCents:0};const amount=cents(row.amount_cents);if(row.kind==='RECEIVABLE')item.receivableCents+=amount;else item.payableCents+=amount;item.netCents=item.receivableCents-item.payableCents;map.set(key,item);}
    return[...map.values()].sort((a,b)=>Math.abs(b.netCents)-Math.abs(a.netCents));
  }
  function byCategory(input={}){return aggregateDimension({...input,dimension:'category'});}
  function byCostCenter(input={}){return aggregateDimension({...input,dimension:'costCenter'});}

  return{dre,cashflow,dashboard,compare,drilldown,byCategory,byCostCenter};
}

module.exports={createFinanceManagementService,businessDate,addDays};
