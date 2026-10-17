// Read-only ranking derived from canonical sales, refunds and commission ledger.
// The only persisted data here are administrative seller goals.
const validMonth=value=>typeof value==='string'&&/^20\d\d-(0[1-9]|1[0-2])$/.test(value);
export function createSellerTargetService({q,first,all,batch,applied,audit,stamp,branchExists,requiredMutation,error}){
 const ensure=month=>{if(!validMonth(month))throw error(400,'Mês inválido (AAAA-MM).');return month;};
 const window=month=>{
   const start=month+'-01T00:00:00.000Z',end=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5)),1))
     .toISOString().slice(0,10)+'T00:00:00.000Z';
   return {start,end};
 };
 return {
  async save(t,b,user,body,header){
   await branchExists(t,b);
   const month=ensure(body?.month),sellerId=String(body?.sellerId||'');
   if(!sellerId||sellerId.length>128)throw error(400,'Vendedor inválido.');
   const targetCents=body?.targetCents;
   if(!Number.isSafeInteger(targetCents)||targetCents<=0||targetCents>10000000000)
     throw error(400,'Meta deve ser um valor positivo em centavos.');
   const seller=await first(`SELECT user_id AS id FROM tenant_memberships
      WHERE tenant_id=? AND user_id=? AND active=1`,t,sellerId);
   if(!seller)throw error(404,'Vendedor não encontrado neste estabelecimento.');
   const key=requiredMutation(body,header),scope='seller.sales-target:'+b+':'+sellerId+':'+month;
   const previous=await applied(t,scope,key);if(previous)return previous;
   const result={branchId:b,sellerId,month,targetCents};
   const at=stamp();
   await batch([
     q(`INSERT INTO seller_sales_targets(tenant_id,branch_id,seller_id,month_key,target_cents,
       updated_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(tenant_id,branch_id,seller_id,month_key) DO UPDATE
       SET target_cents=excluded.target_cents,updated_by=excluded.updated_by,updated_at=excluded.updated_at`,
       t,b,sellerId,month,targetCents,user,at,at),
     audit(t,scope,key,result)
   ]);
   return result;
  },
  async ranking(t,b,{month=stamp().slice(0,7)}={}){
   await branchExists(t,b);ensure(month);
   const {start,end}=window(month);
   const [targets,sales,returns,commissions]=await Promise.all([
     all(`SELECT seller_id AS sellerId,target_cents AS targetCents FROM seller_sales_targets
       WHERE tenant_id=? AND branch_id=? AND month_key=?`,t,b,month),
     all(`SELECT COALESCE(s.seller_id,s.operator_id) AS sellerId,
       SUM(s.total_cents) AS grossCents,COUNT(*) AS salesCount
       FROM sales s WHERE s.tenant_id=? AND s.branch_id=? AND s.status IN('COMPLETED','CANCELLED')
       AND s.completed_at>=? AND s.completed_at<? GROUP BY COALESCE(s.seller_id,s.operator_id)`,
       t,b,start,end),
     all(`SELECT COALESCE(s.seller_id,s.operator_id) AS sellerId,
       SUM(r.amount_cents) AS refundedCents,COUNT(*) AS refundCount
       FROM sale_returns r JOIN sales s ON s.tenant_id=r.tenant_id AND s.branch_id=r.branch_id AND s.id=r.sale_id
       WHERE r.tenant_id=? AND r.branch_id=? AND r.created_at>=? AND r.created_at<?
       GROUP BY COALESCE(s.seller_id,s.operator_id)`,t,b,start,end),
     all(`SELECT seller_id AS sellerId,
       COALESCE(SUM(CASE WHEN kind='EARNED' THEN amount_cents ELSE 0 END),0) AS earnedCents,
       COALESCE(SUM(CASE WHEN kind='REVERSED' THEN -amount_cents ELSE 0 END),0) AS reversedCents,
       COALESCE(SUM(CASE WHEN kind='PAID' THEN -amount_cents ELSE 0 END),0) AS paidCents
       FROM seller_commission_ledger WHERE tenant_id=? AND branch_id=?
       AND occurred_at>=? AND occurred_at<? GROUP BY seller_id`,t,b,start,end)
   ]);
   const grouped=new Map();
   const get=sellerId=>{
     if(!grouped.has(sellerId))grouped.set(sellerId,{sellerId,targetCents:null,
       grossSalesCents:0,refundedCents:0,netSalesCents:0,salesCount:0,refundCount:0,
       commissionEarnedCents:0,commissionReversedCents:0,commissionPaidCents:0,
       commissionBalanceCents:0,progressPercent:null});
     return grouped.get(sellerId);
   };
   for(const r of targets)get(r.sellerId).targetCents=r.targetCents;
   for(const r of sales){const x=get(r.sellerId);x.grossSalesCents=r.grossCents;x.salesCount=r.salesCount;}
   for(const r of returns){const x=get(r.sellerId);x.refundedCents=r.refundedCents;x.refundCount=r.refundCount;}
   for(const r of commissions){const x=get(r.sellerId);x.commissionEarnedCents=r.earnedCents;
     x.commissionReversedCents=r.reversedCents;x.commissionPaidCents=r.paidCents;}
   const sellers=[...grouped.values()];
   const ids=sellers.map(x=>x.sellerId);
   if(ids.length>250)throw error(413,'Mais de 250 vendedores ativos no período. Separe o período.');
   if(ids.length){
     const placeholders=ids.map(()=>'?').join(',');
     const names=await all(`SELECT id,display_name AS name FROM users WHERE id IN (${placeholders})`,...ids);
     const byId=new Map(names.map(x=>[x.id,x.name]));
     for(const x of sellers)x.sellerName=byId.get(x.sellerId)||'Vendedor';
   }
   for(const x of sellers){
     x.netSalesCents=x.grossSalesCents-x.refundedCents;
     x.commissionBalanceCents=x.commissionEarnedCents-x.commissionReversedCents-x.commissionPaidCents;
     x.progressPercent=x.targetCents==null?null:
       Math.round(10000*x.netSalesCents/x.targetCents)/100;
   }
   sellers.sort((a,b)=>b.netSalesCents-a.netSalesCents||a.sellerId.localeCompare(b.sellerId));
   return {month,sellers};
  }
 };
}
