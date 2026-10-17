'use strict';
const { randomUUID }=require('node:crypto');
const { withTransaction }=require('../../core/database/sqlite-database');
const { writeAudit }=require('../../core/audit-log');
const { roundQuantity }=require('../inventory/inventory-rules');
const { assertCents }=require('../shared/money');
const { normalizeCustomerAddress }=require('../catalog/catalog-service');
const { runDeliveryOrderMigrations }=require('../../core/database/delivery-order-migrations');
const { principalFromActor }=require('../../core/auth/principal-resolver');

function createSalesOrderService({db,sales,logistics,authorization=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!sales||!logistics)throw new TypeError('db, sales and logistics are required.');
  runDeliveryOrderMigrations(db);
  const text=v=>String(v||'').trim();
  const requireCapability=(actor,capability)=>{if(authorization)authorization.require({principal:principalFromActor(actor),capability});};
  const parseJson=value=>{if(!value)return null;try{return JSON.parse(value);}catch{return null;}};
  const addressFromCustomer=row=>normalizeCustomerAddress({postalCode:row?.address_postal_code,street:row?.address_street,number:row?.address_number,complement:row?.address_complement,district:row?.address_district,city:row?.address_city,state:row?.address_state,reference:row?.address_reference});
  const completeDeliveryAddress=address=>Boolean(address&&address.postalCode?.length===8&&address.street&&address.number&&address.district&&address.city&&address.state?.length===2);

  function mapItem(row){const p=db.prepare('SELECT name,sku FROM products WHERE id=?').get(row.product_id);return{id:row.id,orderId:row.order_id,productId:row.product_id,productName:p?.name||null,sku:p?.sku||null,quantity:roundQuantity(row.quantity),fulfilledQuantity:roundQuantity(row.fulfilled_quantity),pendingQuantity:roundQuantity(row.quantity-row.fulfilled_quantity),unitPriceCents:row.unit_price_cents,totalCents:Math.round(Number(row.quantity)*Number(row.unit_price_cents)),pricingSnapshot:parseJson(row.pricing_snapshot_json),createdAt:row.created_at,updatedAt:row.updated_at};}
  function mapOrder(row){if(!row)return null;const customer=db.prepare('SELECT name FROM customers WHERE id=?').get(row.customer_id);const items=db.prepare('SELECT * FROM sales_order_items WHERE order_id=? ORDER BY created_at,id').all(row.id).map(mapItem);return{id:row.id,orderNumber:row.order_number||row.id,origin:row.origin||'STANDARD',customerId:row.customer_id,customerName:customer?.name||null,locationId:row.location_id,fulfillmentType:row.fulfillment_type,deliveryAddress:parseJson(row.delivery_address_json),deliveryInstructions:row.delivery_instructions||null,status:row.status,expectedAt:row.expected_at,notes:row.notes,createdBy:row.created_by,createdAt:row.created_at,updatedAt:row.updated_at,quotedAt:row.quoted_at,confirmedAt:row.confirmed_at,fulfilledAt:row.fulfilled_at,cancelledAt:row.cancelled_at,cancelReason:row.cancel_reason,commercialPolicySnapshot:parseJson(row.commercial_policy_snapshot_json),totalCents:items.reduce((s,i)=>s+i.totalCents,0),items};}
  function getOrder(id){return mapOrder(db.prepare('SELECT * FROM sales_orders WHERE id=?').get(String(id)));}
  function requireOrder(id){const row=db.prepare('SELECT * FROM sales_orders WHERE id=?').get(String(id));if(!row)throw new Error('Pedido nao encontrado.');return row;}
  function mapFulfillment(row){if(!row)return null;const items=db.prepare('SELECT * FROM sales_order_fulfillment_items WHERE fulfillment_id=? ORDER BY created_at,id').all(row.id).map(i=>({id:i.id,orderItemId:i.order_item_id,productId:i.product_id,quantity:roundQuantity(i.quantity),unitPriceCents:i.unit_price_cents,createdAt:i.created_at}));return{id:row.id,orderId:row.order_id,idempotencyKey:row.idempotency_key,saleId:row.sale_id,status:row.status,terminalId:row.terminal_id,operatorId:row.operator_id,sellerId:row.seller_id,createdAt:row.created_at,completedAt:row.completed_at,items};}

  function createQuote(input={},actor=null){
    requireCapability(actor,'sales.create');
    const customerId=text(input.customerId);
    const customer=db.prepare('SELECT * FROM customers WHERE id=? AND active=1').get(customerId);
    if(!customer)throw new Error('Cliente nao encontrado ou inativo.');
    const locationId=text(input.locationId)||'MAIN';
    if(!db.prepare('SELECT id FROM stock_locations WHERE id=? AND active=1').get(locationId))throw new Error('Local de estoque nao encontrado ou inativo.');
    const fulfillmentType=text(input.fulfillmentType||'PICKUP').toUpperCase();
    if(!['PICKUP','DELIVERY'].includes(fulfillmentType))throw new Error('Tipo de atendimento do pedido invalido.');
    let deliveryAddress=null,deliveryInstructions=null;
    if(fulfillmentType==='DELIVERY'){
      deliveryAddress=normalizeCustomerAddress(input.deliveryAddress===undefined?addressFromCustomer(customer):input.deliveryAddress);
      if(!completeDeliveryAddress(deliveryAddress))throw new Error('Informe um endereco de entrega completo (CEP, logradouro, numero, bairro, cidade e UF).');
      deliveryInstructions=text(input.deliveryInstructions)||null;
    }
    if(!Array.isArray(input.items)||!input.items.length)throw new Error('Orcamento deve possuir ao menos um item.');
    const origin=text(input.origin||'STANDARD').toUpperCase();if(!['STANDARD','WHOLESALE'].includes(origin))throw new Error('Origem do pedido invalida.');
    const seen=new Set();
    const normalized=input.items.map(item=>{const productId=text(item.productId);if(seen.has(productId))throw new Error('Produto duplicado no pedido.');seen.add(productId);const p=db.prepare('SELECT id,sale_price_cents FROM products WHERE id=? AND active=1').get(productId);if(!p)throw new Error(`Produto ${productId} nao encontrado ou inativo.`);const quantity=roundQuantity(item.quantity);if(quantity<=0)throw new Error('Quantidade do pedido deve ser maior que zero.');const unitPriceCents=item.unitPriceCents==null?Number(p.sale_price_cents):assertCents(Number(item.unitPriceCents),'unitPriceCents');if(unitPriceCents<0)throw new Error('Preco unitario nao pode ser negativo.');const pricingSnapshot=item.pricingSnapshot&&typeof item.pricingSnapshot==='object'?item.pricingSnapshot:null;return{productId,quantity,unitPriceCents,pricingSnapshot};});
    const id=text(input.id||idFactory('order')),ts=now();
    return withTransaction(db,()=>{
      const nextNumber=Number(db.prepare("SELECT COALESCE(MAX(CAST(SUBSTR(order_number,3) AS INTEGER)),0)+1 AS n FROM sales_orders WHERE order_number LIKE 'P-%'").get()?.n||1);
      const orderNumber=text(input.orderNumber||`P-${String(nextNumber).padStart(6,'0')}`);
      db.prepare(`INSERT INTO sales_orders(id,customer_id,location_id,fulfillment_type,status,expected_at,notes,delivery_address_json,delivery_instructions,created_by,created_at,updated_at,quoted_at,origin,order_number,commercial_policy_snapshot_json) VALUES(?,?,?,?,'QUOTED',?,?,?,?,?,?,?,?,?,?,?)`).run(id,customerId,locationId,fulfillmentType,input.expectedAt||null,input.notes||null,deliveryAddress?JSON.stringify(deliveryAddress):null,deliveryInstructions,actor?.userId||null,ts,ts,ts,origin,orderNumber,input.commercialPolicySnapshot?JSON.stringify(input.commercialPolicySnapshot):null);
      const ins=db.prepare('INSERT INTO sales_order_items(id,order_id,product_id,quantity,unit_price_cents,fulfilled_quantity,created_at,updated_at,pricing_snapshot_json) VALUES(?,?,?,?,?,0,?,?,?)');for(const item of normalized)ins.run(idFactory('oi'),id,item.productId,item.quantity,item.unitPriceCents,ts,ts,item.pricingSnapshot?JSON.stringify(item.pricingSnapshot):null);
      writeAudit(db,{action:'sales-order.quote',entity:'sales-order',entityId:id,actor,context:{customerId,locationId,fulfillmentType,origin,hasDeliveryAddress:Boolean(deliveryAddress)}},now);
      return getOrder(id);
    });
  }

  function confirmOrder(id,actor=null){requireCapability(actor,'sales.create');return withTransaction(db,()=>{const row=requireOrder(id);if(row.status==='CONFIRMED'||row.status==='PARTIALLY_FULFILLED'||row.status==='FULFILLED')return getOrder(id);if(!['DRAFT','QUOTED'].includes(row.status))throw new Error(`Pedido nao pode ser confirmado no status ${row.status}.`);const order=getOrder(id);for(const item of order.items){const tracked=db.prepare('SELECT track_stock AS tracked FROM products WHERE id=?').get(item.productId);if(tracked?.tracked)logistics.createReservation({productId:item.productId,locationId:order.locationId,quantity:item.pendingQuantity,sourceType:'sales-order',sourceId:order.id},actor);}const ts=now();db.prepare("UPDATE sales_orders SET status='CONFIRMED',confirmed_at=?,updated_at=? WHERE id=?").run(ts,ts,row.id);writeAudit(db,{action:'sales-order.confirm',entity:'sales-order',entityId:row.id,actor,context:{}},now);return getOrder(row.id);});}

  function cancelOrder(id,{reason=''}={},actor=null){requireCapability(actor,'sales.cancel');const why=text(reason);if(!why)throw new Error('Informe o motivo do cancelamento.');return withTransaction(db,()=>{const row=requireOrder(id);if(row.status==='CANCELLED')return getOrder(id);if(row.status==='FULFILLED')throw new Error('Pedido atendido nao pode ser cancelado.');logistics.releaseSourceReservations('sales-order',row.id,actor);const ts=now();db.prepare("UPDATE sales_orders SET status='CANCELLED',cancelled_at=?,cancel_reason=?,updated_at=? WHERE id=?").run(ts,why,ts,row.id);writeAudit(db,{action:'sales-order.cancel',entity:'sales-order',entityId:row.id,actor,context:{reason:why}},now);return getOrder(row.id);});}

  function prepareCheckout(id,input={},actor=null){
    requireCapability(actor,'sales.create');
    return withTransaction(db,()=>{
      const row=requireOrder(id);
      if(!['CONFIRMED','PARTIALLY_FULFILLED'].includes(row.status))throw new Error(`Pedido nao pode ir ao caixa no status ${row.status}.`);
      const existing=db.prepare("SELECT * FROM sales_order_fulfillments WHERE order_id=? AND status='PENDING' AND sale_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").get(row.id);
      if(existing){
        const current=sales.getSale(existing.sale_id);
        if(current&&['OPEN','SUSPENDED'].includes(current.status))return{order:getOrder(row.id),fulfillment:mapFulfillment(existing),sale:current};
      }
      const order=getOrder(row.id);
      const pending=order.items.filter(item=>item.pendingQuantity>0);
      if(!pending.length)throw new Error('Pedido nao possui itens pendentes.');
      const terminalId=text(input.terminalId),operatorId=text(input.operatorId),sellerId=text(input.sellerId||operatorId);
      if(!terminalId||!operatorId)throw new Error('Terminal e operador obrigatorios para levar o pedido ao caixa.');
      const fulfillmentId=text(input.id||idFactory('fulfill')),key=text(input.idempotencyKey||`checkout:${row.id}:${fulfillmentId}`),ts=now();
      const sale=sales.openSale({terminalId,operatorId,sellerId,customerId:row.customer_id,stockLocationId:row.location_id},actor);
      for(const item of pending)sales.addItem(sale.id,{productId:item.productId,quantity:item.pendingQuantity,unitPriceCents:item.unitPriceCents,forceSeparateLine:true,configurationSnapshot:{sourceDocument:{type:'SALES_ORDER',id:row.id,orderNumber:order.orderNumber,orderItemId:item.id},pricingSnapshot:item.pricingSnapshot||null,commercialPolicySnapshot:order.commercialPolicySnapshot||null}});
      db.prepare(`INSERT INTO sales_order_fulfillments(id,order_id,idempotency_key,status,terminal_id,operator_id,seller_id,sale_id,created_at) VALUES(?,?,?,'PENDING',?,?,?,?,?)`).run(fulfillmentId,row.id,key,terminalId,operatorId,sellerId||null,sale.id,ts);
      const ins=db.prepare('INSERT INTO sales_order_fulfillment_items(id,fulfillment_id,order_item_id,product_id,quantity,unit_price_cents,created_at) VALUES(?,?,?,?,?,?,?)');
      for(const item of pending)ins.run(idFactory('fui'),fulfillmentId,item.id,item.productId,item.pendingQuantity,item.unitPriceCents,ts);
      writeAudit(db,{action:'sales-order.checkout.prepare',entity:'sales-order',entityId:row.id,actor,context:{fulfillmentId,saleId:sale.id,orderNumber:order.orderNumber}},now);
      return{order:getOrder(row.id),fulfillment:mapFulfillment(db.prepare('SELECT * FROM sales_order_fulfillments WHERE id=?').get(fulfillmentId)),sale:sales.getSale(sale.id)};
    });
  }

  function fulfillOrder(id,input={},actor=null){
    requireCapability(actor,'sales.create');const key=text(input.idempotencyKey);if(!key)throw new Error('Chave de idempotencia obrigatoria no atendimento.');const existing=db.prepare('SELECT * FROM sales_order_fulfillments WHERE idempotency_key=?').get(key);if(existing)return mapFulfillment(existing);
    return withTransaction(db,()=>{
      const row=requireOrder(id);if(!['CONFIRMED','PARTIALLY_FULFILLED'].includes(row.status))throw new Error(`Pedido nao pode ser atendido no status ${row.status}.`);const order=getOrder(id);if(!Array.isArray(input.items)||!input.items.length)throw new Error('Atendimento deve possuir ao menos um item.');const byProduct=new Map(order.items.map(i=>[i.productId,i]));const chosen=[];const seen=new Set();for(const requested of input.items){const productId=text(requested.productId);if(seen.has(productId))throw new Error('Produto duplicado no atendimento.');seen.add(productId);const item=byProduct.get(productId);if(!item)throw new Error(`Produto ${productId} nao pertence ao pedido.`);const quantity=roundQuantity(requested.quantity);if(quantity<=0)throw new Error('Quantidade atendida deve ser maior que zero.');if(quantity>item.pendingQuantity)throw new Error(`Quantidade atendida excede a quantidade pendente (${item.pendingQuantity}).`);chosen.push({item,quantity});}
      const terminalId=text(input.terminalId),operatorId=text(input.operatorId),sellerId=text(input.sellerId||operatorId);if(!terminalId||!operatorId)throw new Error('Terminal e operador obrigatorios no atendimento.');const fulfillmentId=text(input.id||idFactory('fulfill')),ts=now();db.prepare(`INSERT INTO sales_order_fulfillments(id,order_id,idempotency_key,status,terminal_id,operator_id,seller_id,created_at) VALUES(?,?,?,'PENDING',?,?,?,?)`).run(fulfillmentId,row.id,key,terminalId,operatorId,sellerId||null,ts);const sale=sales.openSale({terminalId,operatorId,sellerId,customerId:row.customer_id,stockLocationId:row.location_id},actor);for(const selected of chosen)sales.addItem(sale.id,{productId:selected.item.productId,quantity:selected.quantity,unitPriceCents:selected.item.unitPriceCents,forceSeparateLine:true});sales.completeSale(sale.id,{payments:input.payments||[],actor,reservationSource:{type:'sales-order',id:row.id}});const insert=db.prepare('INSERT INTO sales_order_fulfillment_items(id,fulfillment_id,order_item_id,product_id,quantity,unit_price_cents,created_at) VALUES(?,?,?,?,?,?,?)');for(const selected of chosen){insert.run(idFactory('fui'),fulfillmentId,selected.item.id,selected.item.productId,selected.quantity,selected.item.unitPriceCents,ts);db.prepare('UPDATE sales_order_items SET fulfilled_quantity=fulfilled_quantity+?,updated_at=? WHERE id=?').run(selected.quantity,ts,selected.item.id);}const remaining=Number(db.prepare('SELECT COUNT(*) AS n FROM sales_order_items WHERE order_id=? AND fulfilled_quantity < quantity').get(row.id).n||0);const orderStatus=remaining?'PARTIALLY_FULFILLED':'FULFILLED';db.prepare('UPDATE sales_orders SET status=?,fulfilled_at=?,updated_at=? WHERE id=?').run(orderStatus,orderStatus==='FULFILLED'?ts:null,ts,row.id);db.prepare("UPDATE sales_order_fulfillments SET sale_id=?,status='COMPLETED',completed_at=? WHERE id=?").run(sale.id,ts,fulfillmentId);writeAudit(db,{action:'sales-order.fulfill',entity:'sales-order',entityId:row.id,actor,context:{fulfillmentId,saleId:sale.id,orderStatus}},now);return mapFulfillment(db.prepare('SELECT * FROM sales_order_fulfillments WHERE id=?').get(fulfillmentId));
    });
  }

  function listOrders(filters={}){const clauses=[];const params=[];if(filters.status){clauses.push('status=?');params.push(String(filters.status).toUpperCase());}if(filters.customerId){clauses.push('customer_id=?');params.push(String(filters.customerId));}if(filters.locationId){clauses.push('location_id=?');params.push(String(filters.locationId));}if(filters.origin){clauses.push('origin=?');params.push(String(filters.origin).toUpperCase());}return db.prepare(`SELECT * FROM sales_orders${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at DESC,id DESC`).all(...params).map(mapOrder);}
  function listFulfillments(orderId){return db.prepare('SELECT * FROM sales_order_fulfillments WHERE order_id=? ORDER BY created_at,id').all(String(orderId)).map(mapFulfillment);}
  return{createQuote,confirmOrder,cancelOrder,prepareCheckout,fulfillOrder,getOrder,listOrders,listFulfillments};
}
module.exports={createSalesOrderService};
