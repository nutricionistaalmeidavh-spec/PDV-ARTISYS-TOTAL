// Read-only P4 report facets built from the original commerce authorities.
// Neither sales nor stock is copied into report storage.
const MAX_EXPORT_SALES=2000;
const configurationText=item=>[item.configuration?.variant?.name,
  ...(item.configuration?.options||[]).map(option=>option.groupName+': '+option.name)].filter(Boolean).join(' · ');
const csvCell=value=>'"'+String(value??'')
  .replace(/"/g,'""').replace(/^[\t\r\n ]*[=+@\-\uFF1D\uFF0B\uFF0D\uFF20]/u,"'$&")+'"';
export function createReportDepthService(h){
 const {all,branchExists,period,stamp,error,salesHistory}=h;
 const currency=cents=>(Number(cents||0)/100).toFixed(2).replace('.',',');
 // Resolve names only for the current page. User names require active tenant membership;
 // customer names are scoped by tenant. Historical identity IDs remain authoritative.
 const namedDetails=async(tenant,branch,filters={})=>{
   const page=await salesHistory(tenant,branch,{
     ...filters,limit:filters.limit??25,offset:filters.offset??0
   });
   const sales=page.items||[];
   const sellers=[...new Set(sales.flatMap(s=>[s.sellerId,s.operatorId]).filter(Boolean))];
   const customers=[...new Set(sales.map(s=>s.customerId).filter(Boolean))];
   const sellerNames=sellers.length?await all(`SELECT u.id,u.display_name AS name
     FROM users u JOIN tenant_memberships tm ON tm.user_id=u.id
     WHERE tm.tenant_id=? AND tm.active=1 AND u.id IN (${sellers.map(()=>'?').join(',')})`,
     tenant,...sellers):[];
   const customerNames=customers.length?await all(`SELECT id,name FROM customers
     WHERE tenant_id=? AND id IN (${customers.map(()=>'?').join(',')})`,
     tenant,...customers):[];
   const sellerLookup=new Map(sellerNames.map(x=>[x.id,x.name]));
   const customerLookup=new Map(customerNames.map(x=>[x.id,x.name]));
   return {...page,items:sales.map(s=>({...s,
     sellerName:s.sellerId?sellerLookup.get(s.sellerId)||null:null,
     operatorName:s.operatorId?sellerLookup.get(s.operatorId)||null:null,
     customerName:s.customerId?customerLookup.get(s.customerId)||null:'Consumidor não identificado'
   }))};
 };
 return {
  details:namedDetails,
  async detailedCsv(tenant,branch,filters={}){
   // If the result cannot be exported in full, refuse instead of making an
   // unlabelled partial CSV that a customer could interpret as a complete audit.
   const first=await namedDetails(tenant,branch,{...filters,limit:100,offset:0});
   if(first.total>MAX_EXPORT_SALES)
     throw error(413,'Mais de 2000 vendas. Divida o período para exportar sem truncamento.');
   const sales=[...first.items];
   for(let offset=100;offset<first.total;offset+=100){
    const batch=await namedDetails(tenant,branch,{...filters,limit:100,offset});
    sales.push(...batch.items);
   }
   let rows=0;
   const lines=[['Venda','Data','Estado','Operador','Vendedor','Cliente ID','Cliente',
    'SKU','Produto','Configuração vendida','Observação','Quantidade','Preço unitário (R$)','Bruto do item (R$)',
    'Desconto da venda (R$)','Reembolso da venda (R$)','Pagamentos'].map(csvCell).join(';')];
   for(const sale of sales){
    for(const item of sale.items||[]){
     rows++;
     if(rows>10000)throw error(413,'Mais de 10 mil itens. Divida o período para exportar sem truncamento.');
     lines.push([sale.saleNumber,sale.completedAt||'',sale.status,
       sale.operatorName||sale.operatorId,sale.sellerName||sale.sellerId,
       sale.customerId||'',sale.customerName||'',item.sku,item.productName,
       configurationText(item),item.note||'',String(item.quantity).replace('.',','),currency(item.unitPriceCents),
       currency(item.totalCents),currency(sale.discountCents),
       currency(sale.refundedCents),
       (sale.payments||[]).map(p=>p.method).join(' + ')].map(csvCell).join(';'));
    }
   }
   return '\uFEFF'+lines.join('\r\n')+'\r\n';
  },
  async stockCoverage(tenant,branch,{asOf='',days=30,timeZone}={}){
   await branchExists(tenant,branch);
   const span=Number(days);
   if(!Number.isSafeInteger(span)||span<1||span>365)
     throw error(400,'Janela de consumo deve ter entre 1 e 365 dias.');
   const end=asOf||stamp().slice(0,10);
   // Shared date parser forbids impossible dates.
   period({from:end,to:end});
   const start=new Date(Date.parse(end+'T00:00:00.000Z')-(span-1)*86400000)
     .toISOString().slice(0,10);
   const bounds=period({from:start,to:end,timeZone});
   // A code deployment may precede the additive D1 migration.
   // Keep existing reports available while new minimum editing stays disabled.
   const minimumPoliciesAvailable=Boolean((await all(
     "SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_minimum_levels'")).length);
   const minimumColumn=minimumPoliciesAvailable?'ml.minimum_milli':'NULL';
   const minimumJoin=minimumPoliciesAvailable?
     'LEFT JOIN inventory_minimum_levels ml ON ml.tenant_id=p.tenant_id AND ml.branch_id=? AND ml.product_id=p.id':'';
   const rows=await all(`SELECT p.id AS productId,p.sku,p.name,p.unit,
      p.last_cost_cents AS lastRecordedCostCents,
      ${minimumColumn} AS minimumMilli,
      COALESCE(s.balance_milli,0) AS quantityMilli,
      COALESCE((SELECT SUM(r.quantity_milli) FROM inventory_reservations r
        WHERE r.tenant_id=p.tenant_id AND r.branch_id=? AND r.product_id=p.id
          AND r.status='ACTIVE'),0) AS reservedMilli,
      COALESCE((SELECT SUM(CASE WHEN m.type='sale' THEN -m.delta_milli
                                 WHEN m.type='return' THEN -m.delta_milli ELSE 0 END)
        FROM inventory_movements m WHERE m.tenant_id=p.tenant_id
          AND m.branch_id=? AND m.product_id=p.id
          AND m.type IN('sale','return') AND m.occurred_at BETWEEN ? AND ?),0) AS consumedMilli,
      COALESCE((SELECT SUM(t.quantity_milli) FROM inventory_transfers t
        WHERE t.tenant_id=p.tenant_id AND t.product_id=p.id AND t.to_branch_id=?
          AND t.created_at BETWEEN ? AND ?),0) AS incomingMilli,
      COALESCE((SELECT SUM(t.quantity_milli) FROM inventory_transfers t
        WHERE t.tenant_id=p.tenant_id AND t.product_id=p.id AND t.from_branch_id=?
          AND t.created_at BETWEEN ? AND ?),0) AS outgoingMilli
    FROM products p LEFT JOIN stock_positions s ON s.tenant_id=p.tenant_id
      AND s.branch_id=? AND s.product_id=p.id
    ${minimumJoin}
    WHERE p.tenant_id=? AND p.track_stock=1 AND p.active=1
    ORDER BY p.name,p.id LIMIT 1001`,
    branch,branch,bounds.a,bounds.b,
    branch,bounds.a,bounds.b,
    branch,bounds.a,bounds.b,
    branch,...(minimumPoliciesAvailable?[branch]:[]),tenant);
   if(rows.length>1000)
     throw error(413,'Mais de 1000 produtos. Filtre ou exporte o cadastro por lotes.');
   const products=rows.map(row=>{
    const quantity=row.quantityMilli/1000,reserved=row.reservedMilli/1000;
    const available=Math.max(0,quantity-reserved);
    const consumed=Math.max(0,row.consumedMilli/1000);
    const daily=consumed/span;
    const minimum=row.minimumMilli==null?null:row.minimumMilli/1000;
    // Desktop baseline: shortage=max(minimum-quantity,0), purchase cost=shortage*unit cost.
    // Web adds branch reservations to availability and leaves a missing purchase cost unknown.
    const shortageMilli=minimum===null?null:Math.max(0,row.minimumMilli-
      Math.max(0,row.quantityMilli-row.reservedMilli));
    const shortageToMinimum=shortageMilli===null?null:shortageMilli/1000;
    const costKnown=Number(row.lastRecordedCostCents)>0;
    const suggestedPurchaseCostCents=shortageMilli===null||!costKnown?null:
      Math.round(shortageMilli*row.lastRecordedCostCents/1000);
    const minimumStatus=minimum===null?'NOT_CONFIGURED':
      available<minimum?'BELOW_MINIMUM':available===minimum?'AT_MINIMUM':'ABOVE_MINIMUM';
    return {productId:row.productId,sku:row.sku,name:row.name,unit:row.unit,
      quantity,reserved,available,consumed,
      averageDailyConsumption:Number(daily.toFixed(4)),
      daysCoverage:daily>0?Number((available/daily).toFixed(1)):null,
      minimumQuantity:minimum,minimumStatus,
      shortageToMinimum,suggestedPurchaseCostCents,
      purchaseCostBasis:!costKnown?'NO_RECORDED_COST':'LAST_RECORDED_COST',
      transfersIn:row.incomingMilli/1000,transfersOut:row.outgoingMilli/1000,
      depleted:available<=0
    };
   });
   return {period:{from:start,to:end,days:span},minimumPoliciesAvailable,products,
    zeroOrReservedOut:products.filter(x=>x.depleted).length,
    unknownMinimum:products.filter(x=>x.minimumQuantity===null).length,
    belowMinimum:products.filter(x=>x.minimumStatus==='BELOW_MINIMUM').length,
    atMinimum:products.filter(x=>x.minimumStatus==='AT_MINIMUM').length,
    lowStockCount:products.filter(x=>x.minimumStatus==='AT_MINIMUM'||
      x.minimumStatus==='BELOW_MINIMUM').length,
    suggestedPurchaseCostCents:products.some(x=>x.shortageToMinimum>0&&
      x.suggestedPurchaseCostCents==null)?null:products.reduce((sum,x)=>
      sum+Number(x.suggestedPurchaseCostCents||0),0),
    unpricedShortages:products.filter(x=>x.shortageToMinimum>0&&x.suggestedPurchaseCostCents==null).length,
    coverageUnknown:products.filter(x=>x.daysCoverage==null).length};
  }
 };
}
