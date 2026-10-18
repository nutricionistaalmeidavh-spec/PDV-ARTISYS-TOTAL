// Immutable per-lot subledger: the ordinary inventory_movements record remains
// the only authority for physical stock. Unlabelled historical stock is UNKNOWN,
// never fabricated as an existing tracked lot.
export function createLotLedger({all,q,randomId,error}){
 const cacheKey=(t,b,p)=>[t,b,p].join('\u0000');
 async function consume(tenant,branch,productId,quantityMilli,cache=new Map()){
   const key=cacheKey(tenant,branch,productId);
   let batches=cache.get(key);
   if(!batches){
     batches=await all(`SELECT b.lot_receipt_id AS lotId,b.balance_milli AS balance,
       l.lot_code AS lotCode,l.expires_at AS expiresAt
       FROM inventory_lot_balances b JOIN inventory_lot_receipts l ON l.id=b.lot_receipt_id
       WHERE b.tenant_id=? AND b.branch_id=? AND b.product_id=?
         AND b.balance_milli>0
       ORDER BY COALESCE(l.expires_at,'9999-12-31'),l.created_at,l.id`,
       tenant,branch,productId);
     cache.set(key,batches);
   }
   let left=quantityMilli;
   const chosen=[];
   for(const lot of batches){
     if(left<=0)break;
     if(lot.expiresAt&&lot.expiresAt<new Date().toISOString().slice(0,10))
       throw error(409,'Há lote vencido em estoque; faça baixa/segregação antes da saída.');
     const take=Math.min(left,lot.balance);
     if(!take)continue;
     lot.balance-=take;
     left-=take;
     chosen.push({lotId:lot.lotId,quantityMilli:take});
   }
   // Remaining demand can come from the unlabelled canonical stock.
   // Only the normal movement's stock_positions trigger can authorize it.
   return chosen;
 }
 const statements=(tenant,branch,productId,movementId,chosen,sign,at,saleItemId=null)=>
   chosen.map(c=>q(`INSERT INTO inventory_lot_entries
     (id,tenant_id,branch_id,product_id,lot_receipt_id,movement_id,sale_item_id,delta_milli,created_at)
     VALUES(?,?,?,?,?,?,?,?,?)`,randomId(),tenant,branch,productId,
     c.lotId,movementId,saleItemId,sign*c.quantityMilli,at));
 const check=(tenant,branch,productId,movementId,at)=>q(`INSERT INTO inventory_lot_integrity_checks
   (id,tenant_id,branch_id,product_id,movement_id,created_at)
   VALUES(?,?,?,?,?,?)`,randomId(),tenant,branch,productId,movementId,at);
 return {consume,statements,check};
}
