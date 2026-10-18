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
 return {
  details:(tenant,branch,filters={})=>salesHistory(tenant,branch,{
   ...filters,limit:filters.limit??25,offset:filters.offset??0
  }),
  async detailedCsv(tenant,branch,filters={}){
   // If the result cannot be exported in full, refuse instead of making an
   // unlabelled partial CSV that a customer could interpret as a complete audit.
   const first=await salesHistory(tenant,branch,{...filters,limit:100,offset:0});
   if(first.total>MAX_EXPORT_SALES)
     throw error(413,'Mais de 2000 vendas. Divida o período para exportar sem truncamento.');
   const sales=[...first.items];
   for(let offset=100;offset<first.total;offset+=100){
    const batch=await salesHistory(tenant,branch,{...filters,limit:100,offset});
    sales.push(...batch.items);
   }
   let rows=0;
   const lines=[['Venda','Data','Estado','Operador','Vendedor','Cliente ID',
    'SKU','Produto','Configuração vendida','Observação','Quantidade','Preço unitário (R$)','Bruto do item (R$)',
    'Desconto da venda (R$)','Reembolso da venda (R$)','Pagamentos'].map(csvCell).join(';')];
   for(const sale of sales){
    for(const item of sale.items||[]){
     rows++;
     if(rows>10000)throw error(413,'Mais de 10 mil itens. Divida o período para exportar sem truncamento.');
     lines.push([sale.saleNumber,sale.completedAt||'',sale.status,
       sale.operatorId,sale.sellerId,sale.customerId||'',item.sku,item.productName,
       configurationText(item),item.note||'',String(item.quantity).replace('.',','),currency(item.unitPriceCents),
       currency(item.totalCents),currency(sale.discountCents),
       currency(sale.refundedCents),
       (sale.payments||[]).map(p=>p.method).join(' + ')].map(csvCell).join(';'));
    }
   }
   return '\uFEFF'+lines.join('\r\n')+'\r\n';
  },
  async stockCoverage(tenant,branch,{asOf='',days=30}={}){
   await branchExists(tenant,branch);
   const span=Number(days);
   if(!Number.isSafeInteger(span)||span<1||span>365)
     throw error(400,'Janela de consumo deve ter entre 1 e 365 dias.');
   const end=asOf||stamp().slice(0,10);
   // Shared date parser forbids impossible dates.
   period({from:end,to:end});
   const start=new Date(Date.parse(end+'T00:00:00.000Z')-(span-1)*86400000)
     .toISOString().slice(0,10);
   // A code deployment may precede the additive D1 migration.
   // Keep existing reports available while new minimum editing stays disabled.
   const minimumPoliciesAvailable=Boolean((await all(
     "SELECT name FROM sqlite_master WHERE type='table' AND name='inventory_minimum_levels'")).length);
   const minimumColumn=minimumPoliciesAvailable?'ml.minimum_milli':'NULL';
   const minimumJoin=minimumPoliciesAvailable?
     'LEFT JOIN inventory_minimum_levels ml ON ml.tenant_id=p.tenant_id AND ml.branch_id=? AND ml.product_id=p.id':'';
   const rows=await all(`SELECT p.id AS productId,p.sku,p.name,p.unit,
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
    branch,branch,start+'T00:00:00.000Z',end+'T23:59:59.999Z',
    branch,start+'T00:00:00.000Z',end+'T23:59:59.999Z',
    branch,start+'T00:00:00.000Z',end+'T23:59:59.999Z',
    branch,...(minimumPoliciesAvailable?[branch]:[]),tenant);
   if(rows.length>1000)
     throw error(413,'Mais de 1000 produtos. Filtre ou exporte o cadastro por lotes.');
   const products=rows.map(row=>{
    const quantity=row.quantityMilli/1000,reserved=row.reservedMilli/1000;
    const available=Math.max(0,quantity-reserved);
    const consumed=Math.max(0,row.consumedMilli/1000);
    const daily=consumed/span;
    const minimum=row.minimumMilli==null?null:row.minimumMilli/1000;
    const minimumStatus=minimum===null?'NOT_CONFIGURED':
      available<minimum?'BELOW_MINIMUM':available===minimum?'AT_MINIMUM':'ABOVE_MINIMUM';
    return {productId:row.productId,sku:row.sku,name:row.name,unit:row.unit,
      quantity,reserved,available,consumed,
      averageDailyConsumption:Number(daily.toFixed(4)),
      daysCoverage:daily>0?Number((available/daily).toFixed(1)):null,
      minimumQuantity:minimum,minimumStatus,
      transfersIn:row.incomingMilli/1000,transfersOut:row.outgoingMilli/1000,
      depleted:available<=0
    };
   });
   return {period:{from:start,to:end,days:span},minimumPoliciesAvailable,products,
    zeroOrReservedOut:products.filter(x=>x.depleted).length,
    unknownMinimum:products.filter(x=>x.minimumQuantity===null).length,
    belowMinimum:products.filter(x=>x.minimumStatus==='BELOW_MINIMUM').length,
    atMinimum:products.filter(x=>x.minimumStatus==='AT_MINIMUM').length,
    coverageUnknown:products.filter(x=>x.daysCoverage==null).length};
  }
 };
}
