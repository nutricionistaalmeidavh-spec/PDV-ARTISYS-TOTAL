// A linked restaurant checkout is safe during LAN contingency only when the
// canonical order snapshots have one unambiguous CASH settlement. Every check
// runs identically on SQLite before writing and on D1 before machine replay.
const reject=message=>{throw Object.assign(new Error(message),{status:403});};
export async function offlineLinkedCheckoutAllowed(db,tenantId,branchId,body){
 if(body?.wholesaleOrderId)reject('Atacado requer confirmação financeira online.');
 const sessionId=body?.restaurantSessionId||null;
 const orderId=body?.restaurantOrderId||null;
 if(!sessionId&&!orderId)return true;
 if(Boolean(sessionId)===Boolean(orderId))reject('Informe apenas uma origem.');
 if(sessionId){
  const session=await db.prepare('SELECT status FROM restaurant_table_sessions WHERE tenant_id=? AND branch_id=? AND id=?')
   .bind(tenantId,branchId,sessionId).first();
  if(!session||session.status!=='OPEN')reject('Comanda inexistente ou indisponível.');
  const [plan,prepay,transfer,linked,orders]=await Promise.all([
   db.prepare('SELECT 1 AS ok FROM r4_split_plans WHERE tenant_id=? AND branch_id=? AND table_session_id=?').bind(tenantId,branchId,sessionId).first(),
   db.prepare('SELECT 1 AS ok FROM r4_table_prepayments WHERE tenant_id=? AND branch_id=? AND table_session_id=?').bind(tenantId,branchId,sessionId).first(),
   db.prepare('SELECT 1 AS ok FROM r4_item_transfers WHERE tenant_id=? AND branch_id=? AND (source_session_id=? OR target_session_id=?)').bind(tenantId,branchId,sessionId,sessionId).first(),
   db.prepare('SELECT 1 AS ok FROM restaurant_sale_links WHERE tenant_id=? AND branch_id=? AND table_session_id=?').bind(tenantId,branchId,sessionId).first(),
   db.prepare("SELECT COUNT(*) AS total,SUM(CASE WHEN status='DELIVERED' THEN 1 ELSE 0 END) AS delivered,SUM(CASE WHEN status NOT IN('DELIVERED','CANCELLED') THEN 1 ELSE 0 END) AS pending FROM restaurant_orders WHERE tenant_id=? AND branch_id=? AND table_session_id=?")
    .bind(tenantId,branchId,sessionId).first()
  ]);
  if(plan||prepay||transfer||linked||!orders.delivered||orders.pending)
   reject('Comanda com divisão, antecipação, transferência, venda vinculada ou pedido pendente requer caixa online.');
 }else{
  const order=await db.prepare('SELECT status,fulfillment FROM restaurant_orders WHERE tenant_id=? AND branch_id=? AND id=?')
   .bind(tenantId,branchId,orderId).first();
  if(!order||order.status!=='DELIVERED'||order.fulfillment==='TABLE')
   reject('Pedido não entregue ou de mesa: feche pela comanda.');
  const linked=await db.prepare('SELECT 1 AS ok FROM restaurant_sale_links WHERE tenant_id=? AND branch_id=? AND order_id=?')
   .bind(tenantId,branchId,orderId).first();
  if(linked)reject('Pedido já vinculado a uma venda.');
 }
 return true;
}
