'use strict';
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { roundQuantity } = require('../inventory/inventory-rules');
const { assertCents } = require('../shared/money');
const { principalFromActor } = require('../../core/auth/principal-resolver');

function createProcurementService({db,inventory,finance,authorization=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!inventory||!finance)throw new TypeError('db, inventory and finance are required.');
  const requireProcurement=actor=>{if(authorization)authorization.require({principal:principalFromActor(actor),capability:'inventory.procurement'});};
  const text=v=>String(v||'').trim();
  const location=v=>text(v)||'MAIN';
  const qty=v=>roundQuantity(Number(v));

  function mapItem(row){
    if(!row)return null;
    const product=db.prepare('SELECT name,sku FROM products WHERE id=?').get(row.product_id);
    return{id:row.id,purchaseOrderId:row.order_id,productId:row.product_id,productName:product?.name||null,sku:product?.sku||null,quantity:qty(row.quantity),receivedQuantity:qty(row.received_quantity),pendingQuantity:qty(row.quantity-row.received_quantity),unitCostCents:row.unit_cost_cents,totalCents:Math.round(Number(row.quantity||0)*Number(row.unit_cost_cents||0)),createdAt:row.created_at,updatedAt:row.updated_at};
  }
  function mapReceipt(row){
    if(!row)return null;
    const order=db.prepare('SELECT location_id FROM purchase_orders WHERE id=?').get(row.order_id);
    const items=db.prepare('SELECT * FROM purchase_receipt_items WHERE receipt_id=? ORDER BY created_at,id').all(row.id).map(item=>({id:item.id,purchaseReceiptId:item.receipt_id,purchaseOrderItemId:item.order_item_id,productId:item.product_id,quantity:qty(item.quantity),unitCostCents:item.unit_cost_cents,totalCents:item.total_cents,createdAt:item.created_at}));
    return{id:row.id,receiptNumber:row.id,purchaseOrderId:row.order_id,status:'RECEIVED',stockLocationId:order?.location_id||'MAIN',receivedById:row.created_by,totalCents:row.total_cents,payableEntryId:row.payable_entry_id,mutationKey:row.idempotency_key,receivedAt:row.received_at,createdAt:row.created_at,updatedAt:row.created_at,items};
  }
  function mapOrder(row){
    if(!row)return null;
    const supplier=db.prepare('SELECT name FROM suppliers WHERE id=?').get(row.supplier_id);
    const items=db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY created_at,id').all(row.id).map(mapItem);
    return{id:row.id,orderNumber:row.id,supplierId:row.supplier_id,supplierName:supplier?.name||null,status:row.status,stockLocationId:row.location_id,expectedAt:row.expected_at,notes:row.notes,createdById:row.created_by,createdAt:row.created_at,updatedAt:row.updated_at,orderedAt:row.ordered_at,cancelledAt:row.cancelled_at,totalCents:items.reduce((sum,item)=>sum+item.totalCents,0),items};
  }
  function getPurchaseOrder(id){return mapOrder(db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(String(id)));}
  function requireOrder(id){const row=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(String(id));if(!row)throw new Error('Pedido de compra nao encontrado.');return row;}
  function getReceiptByMutation(key){return mapReceipt(db.prepare('SELECT * FROM purchase_receipts WHERE idempotency_key=?').get(String(key)));}

  function createPurchaseOrder(input={},actor=null){
    requireProcurement(actor);
    const supplierId=text(input.supplierId);if(!db.prepare('SELECT id FROM suppliers WHERE id=? AND active=1').get(supplierId))throw new Error('Fornecedor nao encontrado ou inativo.');
    const stockLocationId=location(input.locationId||input.stockLocationId);if(!db.prepare('SELECT id FROM stock_locations WHERE id=? AND active=1').get(stockLocationId))throw new Error('Local de estoque nao encontrado ou inativo.');
    if(!Array.isArray(input.items)||!input.items.length)throw new Error('Pedido de compra deve possuir ao menos um item.');
    const seen=new Set();
    const normalized=input.items.map(item=>{const productId=text(item.productId);if(seen.has(productId))throw new Error('Produto duplicado no pedido de compra.');seen.add(productId);const product=db.prepare('SELECT id FROM products WHERE id=? AND active=1').get(productId);if(!product)throw new Error(`Produto ${productId} nao encontrado ou inativo.`);const quantity=qty(item.quantity);if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Quantidade do pedido deve ser maior que zero.');const unitCostCents=assertCents(Number(item.unitCostCents),'unitCostCents');if(unitCostCents<0)throw new Error('Custo unitario nao pode ser negativo.');return{productId,quantity,unitCostCents};});
    const id=text(input.id||idFactory('po'));const ts=now();
    return withTransaction(db,()=>{
      db.prepare(`INSERT INTO purchase_orders(id,supplier_id,location_id,status,expected_at,notes,created_by,created_at,updated_at) VALUES(?,?,?,'DRAFT',?,?,?,?,?)`).run(id,supplierId,stockLocationId,input.expectedAt||null,input.notes||null,actor?.userId||null,ts,ts);
      const insert=db.prepare(`INSERT INTO purchase_order_items(id,order_id,product_id,quantity,unit_cost_cents,received_quantity,created_at,updated_at) VALUES(?,?,?,?,?,0,?,?)`);
      for(const item of normalized)insert.run(idFactory('poi'),id,item.productId,item.quantity,item.unitCostCents,ts,ts);
      writeAudit(db,{action:'procurement.order.create',entity:'purchase-order',entityId:id,actor,context:{supplierId,stockLocationId,itemCount:normalized.length}},now);
      return getPurchaseOrder(id);
    });
  }

  function submitPurchaseOrder(id,actor=null){
    requireProcurement(actor);const order=requireOrder(id);
    if(['ORDERED','PARTIALLY_RECEIVED','RECEIVED'].includes(order.status))return getPurchaseOrder(id);
    if(order.status!=='DRAFT')throw new Error(`Pedido de compra nao pode ser enviado no status ${order.status}.`);
    const ts=now();db.prepare("UPDATE purchase_orders SET status='ORDERED',ordered_at=?,updated_at=? WHERE id=?").run(ts,ts,String(id));
    writeAudit(db,{action:'procurement.order.submit',entity:'purchase-order',entityId:String(id),actor,context:{}},now);
    return getPurchaseOrder(id);
  }

  function receivePurchaseOrder(id,input={},actor=null){
    requireProcurement(actor);
    const mutationKey=text(input.idempotencyKey||input.mutationKey);if(!mutationKey)throw new Error('Chave de idempotencia obrigatoria no recebimento.');
    const previous=getReceiptByMutation(mutationKey);if(previous)return previous;
    return withTransaction(db,()=>{
      const order=requireOrder(id);if(!['ORDERED','PARTIALLY_RECEIVED'].includes(order.status))throw new Error(`Pedido de compra nao pode ser recebido no status ${order.status}.`);
      if(!Array.isArray(input.items)||!input.items.length)throw new Error('Recebimento deve possuir ao menos um item.');
      const orderItems=db.prepare('SELECT * FROM purchase_order_items WHERE order_id=? ORDER BY created_at,id').all(order.id);const byProduct=new Map(orderItems.map(row=>[String(row.product_id),row]));const seen=new Set();const normalized=[];let totalCents=0;
      for(const item of input.items){const productId=text(item.productId);if(seen.has(productId))throw new Error('Produto duplicado no recebimento.');seen.add(productId);const poItem=byProduct.get(productId);if(!poItem)throw new Error(`Produto ${productId} nao pertence ao pedido de compra.`);const quantity=qty(item.quantity);if(quantity<=0)throw new Error('Quantidade recebida deve ser maior que zero.');const pending=qty(poItem.quantity-poItem.received_quantity);if(quantity>pending)throw new Error(`Quantidade recebida excede a quantidade pendente (${pending}).`);const line=Math.round(quantity*Number(poItem.unit_cost_cents));normalized.push({poItem,productId,quantity,totalCents:line});totalCents+=line;}
      const receiptId=text(input.id||idFactory('receipt'));const ts=now();
      db.prepare(`INSERT INTO purchase_receipts(id,order_id,idempotency_key,received_at,total_cents,payable_entry_id,created_by,created_at) VALUES(?,?,?,?,?,NULL,?,?)`).run(receiptId,order.id,mutationKey,ts,totalCents,actor?.userId||null,ts);
      const insertReceiptItem=db.prepare(`INSERT INTO purchase_receipt_items(id,receipt_id,order_item_id,product_id,quantity,unit_cost_cents,total_cents,created_at) VALUES(?,?,?,?,?,?,?,?)`);
      for(const item of normalized){
        const product=db.prepare('SELECT cost_cents FROM products WHERE id=?').get(item.productId);const aggregateBefore=inventory.getBalance(item.productId,{aggregate:true});const oldCost=Number(product?.cost_cents||0);
        inventory.move({productId:item.productId,locationId:order.location_id,type:'purchase',quantityDelta:item.quantity,reason:`Recebimento ${receiptId}`,sourceType:'purchase-receipt',sourceId:receiptId},actor);
        const denominator=roundQuantity(aggregateBefore+item.quantity);const weighted=denominator>0?Math.round(((aggregateBefore*oldCost)+(item.quantity*Number(item.poItem.unit_cost_cents)))/denominator):Number(item.poItem.unit_cost_cents);
        db.prepare('UPDATE products SET cost_cents=?,updated_at=? WHERE id=?').run(weighted,ts,item.productId);
        db.prepare('UPDATE purchase_order_items SET received_quantity=received_quantity+?,updated_at=? WHERE id=?').run(item.quantity,ts,item.poItem.id);
        insertReceiptItem.run(idFactory('reci'),receiptId,item.poItem.id,item.productId,item.quantity,item.poItem.unit_cost_cents,item.totalCents,ts);
      }
      if(totalCents>0){const payable=finance.createEntry({kind:'PAYABLE',description:`Recebimento ${receiptId}`,category:'COMPRAS',amountCents:totalCents,dueAt:input.dueAt||order.expected_at||ts,sourceType:'purchase-receipt',sourceId:receiptId,notes:`Fornecedor ${order.supplier_id}`},actor);db.prepare('UPDATE purchase_receipts SET payable_entry_id=? WHERE id=?').run(payable.id,receiptId);}
      const remaining=Number(db.prepare('SELECT COUNT(*) AS n FROM purchase_order_items WHERE order_id=? AND received_quantity < quantity').get(order.id).n||0);const status=remaining?'PARTIALLY_RECEIVED':'RECEIVED';db.prepare('UPDATE purchase_orders SET status=?,updated_at=? WHERE id=?').run(status,ts,order.id);
      writeAudit(db,{action:'procurement.receipt.create',entity:'purchase-receipt',entityId:receiptId,actor,context:{purchaseOrderId:order.id,totalCents,status}},now);
      return mapReceipt(db.prepare('SELECT * FROM purchase_receipts WHERE id=?').get(receiptId));
    });
  }

  function listPurchaseOrders(filters={}){const clauses=[];const params=[];if(filters.status){clauses.push('status=?');params.push(String(filters.status).toUpperCase());}if(filters.supplierId){clauses.push('supplier_id=?');params.push(String(filters.supplierId));}if(filters.locationId){clauses.push('location_id=?');params.push(location(filters.locationId));}return db.prepare(`SELECT * FROM purchase_orders${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at DESC,id DESC`).all(...params).map(mapOrder);}
  function listReceipts({purchaseOrderId=null}={}){const rows=purchaseOrderId?db.prepare('SELECT * FROM purchase_receipts WHERE order_id=? ORDER BY received_at,id').all(String(purchaseOrderId)):db.prepare('SELECT * FROM purchase_receipts ORDER BY received_at,id').all();return rows.map(mapReceipt);}
  return{createPurchaseOrder,submitPurchaseOrder,receivePurchaseOrder,getPurchaseOrder,listPurchaseOrders,listReceipts};
}
module.exports={createProcurementService};
