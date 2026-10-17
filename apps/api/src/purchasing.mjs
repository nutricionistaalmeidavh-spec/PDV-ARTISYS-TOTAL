// Purchase documents are operational commitments, never additional stock.
// Physical receipts post only to the existing canonical inventory ledger.
export function createPurchasingService(h){
 const {q,first,all,batch,applied,audit,stamp,branchExists,requiredMutation,
   quantityMilli,error,text,randomId,ledgerReceipt}=h;
 const scope=(branch,id,kind)=>'purchasing.'+kind+':'+branch+(id?':'+id:'');
 const cost=n=>{
   if(!Number.isSafeInteger(n)||n<0||n>10000000)throw error(400,'Custo unitário inválido.');
   return n;
 };
 const money=(milli,unitCost)=>Math.round(milli*unitCost/1000);
 async function orderRecord(t,b,id){
   await branchExists(t,b);
   const o=await first('SELECT * FROM purchase_orders WHERE id=? AND tenant_id=? AND branch_id=?',id,t,b);
   if(!o)throw error(404,'Pedido de compra não encontrado nesta filial.');
   const lines=await all(`SELECT l.id,l.product_id AS productId,p.name,
     l.quantity_milli AS quantityMilli,l.unit_cost_cents AS unitCostCents,
     COALESCE((SELECT SUM(r.quantity_milli) FROM purchase_receipt_lines r
       WHERE r.tenant_id=l.tenant_id AND r.branch_id=l.branch_id AND
       r.order_id=l.order_id AND r.line_id=l.id),0) AS receivedMilli
     FROM purchase_order_lines l JOIN products p ON p.id=l.product_id AND p.tenant_id=l.tenant_id
     WHERE l.tenant_id=? AND l.branch_id=? AND l.order_id=? ORDER BY l.id`,t,b,id);
   const received=lines.reduce((s,l)=>s+l.receivedMilli,0),ordered=lines.reduce((s,l)=>s+l.quantityMilli,0);
   const status=o.status==='CANCELLED'?'CANCELLED':received===ordered?'RECEIVED':received?'PARTIAL':'OPEN';
   return {id:o.id,branchId:b,supplierId:o.supplier_id,status,createdAt:o.created_at,
     cancelledAt:o.cancelled_at||null,reason:o.reason||null,
     totalOrderedCents:lines.reduce((s,l)=>s+money(l.quantityMilli,l.unitCostCents),0),
     totalReceivedCents:lines.reduce((s,l)=>s+money(l.receivedMilli,l.unitCostCents),0),
     items:lines.map(l=>({id:l.id,productId:l.productId,name:l.name,
       quantity:l.quantityMilli/1000,unitCostCents:l.unitCostCents,
       receivedQuantity:l.receivedMilli/1000,remainingQuantity:(l.quantityMilli-l.receivedMilli)/1000}))
   };
 }
 return {
  async createPurchaseOrder(t,b,user,body,header){
   await branchExists(t,b);
   const key=requiredMutation(body,header),s=scope(b,'','create');
   const prev=await applied(t,s,key);if(prev)return prev;
   const supplierId=String(body?.supplierId||'');
   const supplier=await first('SELECT id FROM suppliers WHERE tenant_id=? AND id=? AND active=1',t,supplierId);
   if(!supplier)throw error(404,'Fornecedor não encontrado nesta empresa.');
   if(!Array.isArray(body?.items)||body.items.length<1||body.items.length>60)
     throw error(400,'Informe de 1 a 60 produtos no pedido.');
   const ids=new Set(),lines=[];
   for(const item of body.items){
     const productId=String(item?.productId||''),milli=quantityMilli(item?.quantity),
       unitCostCents=cost(item?.unitCostCents);
     if(!milli||!productId||ids.has(productId))
       throw error(400,'Produto repetido ou quantidade inválida.');
     const product=await first('SELECT id FROM products WHERE tenant_id=? AND id=? AND active=1 AND track_stock=1',t,productId);
     if(!product)throw error(404,'Produto ativo com controle de estoque não encontrado.');
     const id=randomId();ids.add(productId);
     lines.push({id,productId,quantity:item.quantity,quantityMilli:milli,unitCostCents});
   }
   const id=randomId(),at=stamp();
   const result={id,branchId:b,supplierId,status:'OPEN',createdAt:at,
     totalOrderedCents:lines.reduce((s,l)=>s+money(l.quantityMilli,l.unitCostCents),0),
     totalReceivedCents:0,items:lines.map(({quantityMilli,...l})=>({...l,receivedQuantity:0,remainingQuantity:l.quantity}))};
   const rows=[q(`INSERT INTO purchase_orders(id,tenant_id,branch_id,supplier_id,status,created_by,created_at)
     VALUES(?,?,?,?,'OPEN',?,?)`,id,t,b,supplierId,user,at)];
   for(const line of lines)rows.push(q(`INSERT INTO purchase_order_lines(id,tenant_id,branch_id,order_id,product_id,quantity_milli,unit_cost_cents)
     VALUES(?,?,?,?,?,?,?)`,line.id,t,b,id,line.productId,line.quantityMilli,line.unitCostCents));
   rows.push(audit(t,s,key,result));
   await batch(rows);
   return result;
  },
  purchaseOrder:orderRecord,
  async purchaseOrders(t,b){
   await branchExists(t,b);
   const ids=await all('SELECT id FROM purchase_orders WHERE tenant_id=? AND branch_id=? ORDER BY created_at DESC,id DESC LIMIT 100',t,b);
   return Promise.all(ids.map(x=>orderRecord(t,b,x.id)));
  },
  async receivePurchaseOrder(t,b,id,user,body,header){
   const key=requiredMutation(body,header),s=scope(b,id,'receipt');
   const prev=await applied(t,s,key);if(prev)return prev;
   const order=await orderRecord(t,b,id);
   if(order.status==='CANCELLED'||order.status==='RECEIVED')throw error(409,'Pedido encerrado.');
   if(!Array.isArray(body?.items)||body.items.length<1||body.items.length>60)
     throw error(400,'Informe itens para recebimento parcial.');
   const byId=new Map(order.items.map(l=>[l.id,l])),seen=new Set(),requested=[];
   for(const raw of body.items){
     const l=byId.get(raw?.lineId),milli=quantityMilli(raw?.quantity);
     if(!l||!milli||seen.has(l.id))throw error(400,'Linha ou quantidade inválida/repetida.');
     if(milli>Math.round(l.remainingQuantity*1000))throw error(409,'Recebimento excede a quantidade pendente.');
     seen.add(l.id);requested.push({line:l,milli});
   }
   const receiptId=randomId(),at=stamp(),statements=[q(`INSERT INTO purchase_receipts
     (id,tenant_id,branch_id,order_id,operator_id,mutation_id,created_at)
     VALUES(?,?,?,?,?,?,?)`,receiptId,t,b,id,user,key,at)];
   for(const {line,milli} of requested){
     const movementId=randomId();
     statements.push(...ledgerReceipt(t,b,user,line.productId,milli,line.unitCostCents,
       order.supplierId,key,at,movementId));
     statements.push(q(`INSERT INTO purchase_receipt_lines
       (id,tenant_id,branch_id,order_id,receipt_id,line_id,product_id,movement_id,quantity_milli,unit_cost_cents)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,randomId(),t,b,id,receiptId,line.id,line.productId,movementId,milli,line.unitCostCents));
   }
   const becomesComplete=order.items.every(line=>{
     const requestedMilli=requested.find(x=>x.line.id===line.id)?.milli||0;
     return Math.round(line.remainingQuantity*1000)===requestedMilli;
   });
   const result={receiptId,orderId:id,status:becomesComplete?'RECEIVED':'PARTIAL',
     items:requested.map(({line,milli})=>({lineId:line.id,productId:line.productId,
       quantity:milli/1000,unitCostCents:line.unitCostCents})),createdAt:at};
   statements.push(audit(t,s,key,result));
   await batch(statements);
   return result;
  },
  async cancelPurchaseOrder(t,b,id,user,body,header){
   const key=requiredMutation(body,header),s=scope(b,id,'cancel');
   const prev=await applied(t,s,key);if(prev)return prev;
   const order=await orderRecord(t,b,id),reason=text(body?.reason,240);
   if(order.status==='CANCELLED'||order.status==='RECEIVED')throw error(409,'Pedido já encerrado.');
   if(reason.length<3)throw error(400,'Informe motivo do cancelamento.');
   const result={id,status:'CANCELLED',reason,cancelledAt:stamp()};
   await batch([
    q(`UPDATE purchase_orders SET status='CANCELLED',reason=?,cancelled_at=?
      WHERE id=? AND tenant_id=? AND branch_id=? AND status='OPEN'`,reason,result.cancelledAt,id,t,b),
    audit(t,s,key,result)
   ]);
   return result;
  },
  async purchaseCostSummary(t,b,{productId=null}={}){
   await branchExists(t,b);
   const results=await all(`SELECT p.product_id AS productId,pr.name AS name,
       SUM(p.quantity_milli)/1000.0 AS totalReceivedQuantity,
       ROUND(SUM(p.quantity_milli*p.unit_cost_cents)*1.0/SUM(p.quantity_milli)) AS weightedAverageUnitCostCents,
       pr.last_cost_cents AS lastCostCents
       FROM purchase_cost_history p
       JOIN products pr ON pr.tenant_id=p.tenant_id AND pr.id=p.product_id
       WHERE p.tenant_id=? AND p.branch_id=? AND (? IS NULL OR p.product_id=?)
       GROUP BY p.product_id ORDER BY pr.name LIMIT 100`,t,b,productId,productId);
   return results;
  }
 };
}
