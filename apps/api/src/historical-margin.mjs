// Historical sales margin uses the SAME immutable sale_stock_allocations
// created during checkout, plus sale_returns compensation events.
// Never substitute today's last cost for absent historical evidence.
export function createHistoricalMarginService(h){
 const {all,branchExists,period,allocateSaleDiscount,error}=h;
 const MAX_ITEMS=10000;
 const chunks=(items,size)=>Array.from({length:Math.ceil(items.length/size)},
  (_,i)=>items.slice(i*size,(i+1)*size));
 const amount=(milli,cents)=>Math.round(milli*cents/1000);
 return {
  async margin(tenant,branch,{from='',to='',productId=''}={}){
   await branchExists(tenant,branch);
   const {a,b}=period({from,to});
   const original=await all(`SELECT i.id AS saleItemId,i.sale_id AS saleId,
    i.product_id AS productId,i.product_name AS name,
    i.quantity_milli AS quantityMilli,i.unit_price_cents AS unitPriceCents,
    s.discount_cents AS discountCents
    FROM sale_items i JOIN sales s ON s.tenant_id=i.tenant_id AND s.branch_id=i.branch_id AND s.id=i.sale_id
    WHERE i.tenant_id=? AND i.branch_id=? AND s.status IN ('COMPLETED','CANCELLED')
      AND s.completed_at BETWEEN ? AND ?
    ORDER BY s.completed_at,s.id,i.id LIMIT 10001`,tenant,branch,a,b);
   const reversed=await all(`SELECT ri.sale_item_id AS saleItemId,
    i.sale_id AS saleId,i.product_id AS productId,i.product_name AS name,
    i.quantity_milli AS quantityMilli,i.unit_price_cents AS unitPriceCents,
    s.discount_cents AS discountCents
    FROM sale_return_items ri
    JOIN sale_returns r ON r.id=ri.return_id AND r.tenant_id=ri.tenant_id AND r.branch_id=ri.branch_id
    JOIN sale_items i ON i.id=ri.sale_item_id AND i.tenant_id=ri.tenant_id AND i.branch_id=ri.branch_id
    JOIN sales s ON s.id=i.sale_id AND s.tenant_id=i.tenant_id AND s.branch_id=i.branch_id
    WHERE r.tenant_id=? AND r.branch_id=? AND r.created_at BETWEEN ? AND ?
    ORDER BY r.created_at,r.id,ri.id LIMIT 10001`,tenant,branch,a,b);
   if(original.length>MAX_ITEMS||reversed.length>MAX_ITEMS)
    throw error(413,'Período com mais de 10 mil linhas. Divida o relatório em períodos menores.');
   const originalsById=new Map([...original,...reversed].map(x=>[x.saleItemId,x]));
   const allIds=[...originalsById.keys()];
   const allocations=new Map();
   const returns=[];
   for(const ids of chunks(allIds,100)){
    const markers=ids.map(()=>'?').join(',');
    const parts=await all(`SELECT sale_item_id AS saleItemId,quantity_milli AS milli,
     unit_cost_cents AS unitCostCents FROM sale_stock_allocations
     WHERE tenant_id=? AND branch_id=? AND sale_item_id IN (${markers})`,tenant,branch,...ids);
    for(const row of parts){
     if(!allocations.has(row.saleItemId))allocations.set(row.saleItemId,[]);
     allocations.get(row.saleItemId).push(row);
    }
    const events=await all(`SELECT ri.sale_item_id AS saleItemId,ri.quantity_milli AS quantityMilli,
     ri.net_cents AS netCents,r.created_at AS occurredAt,r.id AS returnId,ri.id AS itemId
     FROM sale_return_items ri JOIN sale_returns r ON r.id=ri.return_id
      AND r.tenant_id=ri.tenant_id AND r.branch_id=ri.branch_id
     WHERE ri.tenant_id=? AND ri.branch_id=? AND ri.sale_item_id IN (${markers})
     ORDER BY r.created_at,r.id,ri.id`,tenant,branch,...ids);
    returns.push(...events);
   }
   const saleGroups=new Map();
   for(const row of original){
    if(!saleGroups.has(row.saleId))saleGroups.set(row.saleId,[]);
    saleGroups.get(row.saleId).push(row);
   }
   const products=new Map(),flagged=new Set();
   const record=original=>{
    if(!products.has(original.productId))products.set(original.productId,{
      productId:original.productId,name:original.name,
      revenueCents:0,returnedCents:0,costCents:0,quantityMilli:0,missingCostLines:0
    });
    return products.get(original.productId);
   };
   const snapshot=itemId=>(allocations.get(itemId)||[])
     .reduce((sum,row)=>sum+amount(row.milli,row.unitCostCents),0);
   const isKnown=itemId=>(allocations.get(itemId)||[]).length>0
     && allocations.get(itemId).every(row=>row.unitCostCents>0);
   const markUnknown=row=>{
    if(!isKnown(row.saleItemId)&&!flagged.has(row.saleItemId)){
      flagged.add(row.saleItemId);record(row).missingCostLines++;
    }
   };
   for(const lines of saleGroups.values()){
    const discounted=allocateSaleDiscount(lines.map(row=>({
      id:row.saleItemId,productId:row.productId,unitPriceCents:row.unitPriceCents,
      quantity:row.quantityMilli/1000
    })),lines[0].discountCents);
    const netById=new Map(discounted.map(x=>[x.id,x.netTotalCents]));
    for(const row of lines){
      const p=record(row);
      p.revenueCents+=netById.get(row.saleItemId)||0;
      p.quantityMilli+=row.quantityMilli;
      p.costCents+=snapshot(row.saleItemId);
      markUnknown(row);
    }
   }
   const cumulative=new Map();
   // All events, even before the filter window, inform proportional rounding.
   returns.sort((x,y)=>x.occurredAt.localeCompare(y.occurredAt)||
     x.returnId.localeCompare(y.returnId)||x.itemId.localeCompare(y.itemId));
   for(const ev of returns){
     const row=originalsById.get(ev.saleItemId);
     if(!row)continue;
     const prior=cumulative.get(ev.saleItemId)||0;
     cumulative.set(ev.saleItemId,prior+ev.quantityMilli);
     if(ev.occurredAt<a||ev.occurredAt>b)continue;
     const p=record(row);
     p.revenueCents-=ev.netCents;
     p.returnedCents+=ev.netCents;
     p.quantityMilli-=ev.quantityMilli;
     const historic=snapshot(ev.saleItemId);
     p.costCents-=Math.round(historic*(prior+ev.quantityMilli)/row.quantityMilli)-
       Math.round(historic*prior/row.quantityMilli);
     markUnknown(row);
   }
   let rows=[...products.values()];
   if(productId)rows=rows.filter(x=>x.productId===productId);
   rows.sort((a,b)=>b.revenueCents-a.revenueCents||a.productId.localeCompare(b.productId));
   const total={revenueCents:0,costCents:0,returnedCents:0,missingCostLines:0};
   const detail=rows.map(p=>{
     total.revenueCents+=p.revenueCents;
     total.costCents+=p.costCents;
     total.returnedCents+=p.returnedCents;
     total.missingCostLines+=p.missingCostLines;
     return {...p,quantity:p.quantityMilli/1000,marginCents:p.missingCostLines?null:p.revenueCents-p.costCents,
      costBasis:p.missingCostLines?'INCOMPLETE':'CHECKOUT_SNAPSHOT'};
   });
   return {period:{from:from||null,to:to||null},...total,
     marginCents:total.missingCostLines?null:total.revenueCents-total.costCents,
     costBasis:total.missingCostLines?'INCOMPLETE':'CHECKOUT_SNAPSHOT',
     products:detail};
  }
 };
}
