'use strict';

const {storeDateKey,storeTimeZone}=require('../shared/store-date');
const { randomUUID }=require('node:crypto');
const { withTransaction }=require('../../core/database/sqlite-database');
const { writeAudit }=require('../../core/audit-log');
const { assertCents }=require('../shared/money');

const MANUAL_PAYMENT_METHODS=new Set(['CASH','PIX','DEBIT_CARD','CREDIT_CARD','STORE_CREDIT','OTHER']);
const DELIVERY_TRANSITIONS={NEW:['PREPARING','CANCELLED'],PREPARING:['READY','CANCELLED'],READY:['OUT_FOR_DELIVERY','CANCELLED'],OUT_FOR_DELIVERY:['DELIVERED','CANCELLED'],DELIVERED:[],CANCELLED:[]};
const PICKUP_TRANSITIONS={NEW:['PREPARING','CANCELLED'],PREPARING:['READY','CANCELLED'],READY:['PICKED_UP','CANCELLED'],PICKED_UP:[],CANCELLED:[]};
const DELIVERY_FEE_PRODUCT_ID='__artisys_delivery_fee__';

function createDeliveryService({db,modules,sales,kitchen=null,configuredItemPricing=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!modules||!sales)throw new TypeError('db, modules and sales are required.');
  const gate=()=>modules.requireEnabled('FOOD');
  function parseJson(value){if(!value)return null;try{return JSON.parse(value);}catch{return null;}}
  function productionState(orderId){
    const stations=db.prepare(`SELECT pt.station_id AS id,ks.name,pt.status,pt.updated_at AS updatedAt
      FROM production_tickets pt JOIN kitchen_stations ks ON ks.id=pt.station_id
      WHERE pt.source_type='DELIVERY' AND pt.source_id=? AND pt.status<>'CANCELLED'
      ORDER BY ks.sort_order,ks.name,ks.id`).all(String(orderId));
    if(!stations.length)return{status:null,stations:[]};
    const allReady=stations.every(item=>item.status==='READY');
    const active=stations.some(item=>item.status==='PREPARING'||item.status==='READY');
    return{status:allReady?'READY':active?'PREPARING':'NEW',stations};
  }
  function orderItems(orderId){
    return db.prepare(`SELECT id,product_id AS productId,product_name AS productName,quantity,unit_price_cents AS unitPriceCents,configuration_json AS configurationJson,note,created_at AS createdAt
      FROM delivery_order_items WHERE order_id=? ORDER BY created_at,id`).all(String(orderId)).map(row=>{
        const configurationSnapshot=parseJson(row.configurationJson);delete row.configurationJson;
        return{...row,configurationSnapshot};
      });
  }
  function map(row){if(!row)return null;let address=null;try{address=row.address_json?JSON.parse(row.address_json):null;}catch{}return{id:row.id,saleId:row.sale_id,customerId:row.customer_id,customerName:row.customer_name,phone:row.phone,fulfillmentType:row.fulfillment_type,channel:row.channel||row.fulfillment_type,ticketNumber:row.ticket_number||null,ticketDate:row.ticket_date||null,address,region:row.region,feeCents:row.fee_cents,courier:row.courier,manualEta:row.manual_eta,paymentMethod:row.payment_method,note:row.note,status:row.status,items:orderItems(row.id),production:productionState(row.id),cancelReason:row.cancel_reason,createdAt:row.created_at,updatedAt:row.updated_at};}
  function get(id){gate();const row=db.prepare('SELECT * FROM delivery_orders WHERE id=?').get(String(id));if(!row)throw new Error('Pedido de delivery nao encontrado.');return map(row);}
  function normalizeOrderItem(input={}){
    const productId=String(input.productId||'').trim();if(!productId)throw new Error('Produto obrigatorio no pedido.');
    const product=db.prepare('SELECT id,name,sale_price_cents AS salePriceCents FROM products WHERE id=? AND active=1').get(productId);if(!product)throw new Error('Produto nao encontrado ou inativo.');
    if(configuredItemPricing?.price){
      const priced=configuredItemPricing.price({...input,productId:product.id});
      return{productId:product.id,productName:product.name,quantity:priced.quantity,unitPriceCents:priced.unitPriceCents,configurationSnapshot:priced.configurationSnapshot,note:priced.note||null};
    }
    const quantity=Number(input.quantity??1);if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Quantidade do item deve ser maior que zero.');
    const unitPriceCents=input.unitPriceCents===undefined||input.unitPriceCents===null?Number(product.salePriceCents):assertCents(Number(input.unitPriceCents),'unitPriceCents');
    const configurationSnapshot=input.configurationSnapshot||input.configuration||null;
    return{productId:product.id,productName:product.name,quantity,unitPriceCents,configurationSnapshot,note:String(input.note||'').trim().slice(0,500)||null};
  }
  function persistOrderItems(orderId,items=[],timestamp=now()){
    const normalized=items.map(normalizeOrderItem);if(!normalized.length)return[];
    const insert=db.prepare(`INSERT INTO delivery_order_items(id,order_id,product_id,product_name,quantity,unit_price_cents,configuration_json,note,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`);
    for(const item of normalized)insert.run(idFactory('delivery-item'),String(orderId),item.productId,item.productName,item.quantity,item.unitPriceCents,item.configurationSnapshot?JSON.stringify(item.configurationSnapshot):null,item.note,timestamp);
    return orderItems(orderId);
  }
  function create(input={},actor={}){
    gate();
    const channel=String(input.channel||input.fulfillmentType||'DELIVERY').toUpperCase();if(!['COUNTER','PICKUP','DELIVERY'].includes(channel))throw new Error('Canal de atendimento inválido.');
    const id=String(input.id||idFactory('delivery'));const customerName=String(input.customerName||(channel==='COUNTER'?'Cliente no balcão':'')).trim();if(!customerName)throw new Error('Nome do cliente obrigatorio.');
    const fulfillmentType=(channel==='COUNTER'?'PICKUP':channel);if(!['DELIVERY','PICKUP'].includes(fulfillmentType))throw new Error('Tipo de atendimento invalido.');
    if(fulfillmentType==='DELIVERY'&&(!input.address||typeof input.address!=='object'))throw new Error('Endereco obrigatorio para delivery.');
    const fee=assertCents(Number(fulfillmentType==='DELIVERY'?input.feeCents??0:0),'feeCents');if(fee<0)throw new Error('Taxa de entrega invalida.');
    const paymentMethod=input.paymentMethod?String(input.paymentMethod).toUpperCase():null;if(paymentMethod&&!MANUAL_PAYMENT_METHODS.has(paymentMethod))throw new Error('Forma de pagamento manual invalida.');
    const items=Array.isArray(input.items)?input.items:[];if(items.length&&kitchen?.assertOrderRouting)kitchen.assertOrderRouting(items);
    const ts=now();
    return withTransaction(db,()=>{
      db.prepare(`INSERT INTO delivery_orders(id,sale_id,customer_id,customer_name,phone,fulfillment_type,address_json,region,fee_cents,courier,manual_eta,payment_method,note,status,cancel_reason,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,'NEW',NULL,?,?)`).run(id,null,input.customerId||null,customerName,String(input.phone||'').trim()||null,fulfillmentType,input.address?JSON.stringify(input.address):null,String(input.region||'').trim()||null,fee,String(input.courier||'').trim()||null,String(input.manualEta||'').trim()||null,paymentMethod,String(input.note||'').trim()||null,ts,ts);
      let ticketNumber=null;let ticketDate=null;
      if(input.useTicket===true){
        ticketDate=storeDateKey(ts,storeTimeZone(db));
        const legacyMax=Number(db.prepare('SELECT COALESCE(MAX(daily_number),0) AS n FROM fast_food_orders WHERE order_date=?').get(ticketDate).n);
        db.prepare('INSERT INTO food_daily_counters(order_date,last_number) VALUES(?,?) ON CONFLICT(order_date) DO UPDATE SET last_number=MAX(last_number,excluded.last_number)').run(ticketDate,legacyMax);
        ticketNumber=db.prepare('UPDATE food_daily_counters SET last_number=last_number+1 WHERE order_date=? RETURNING last_number').get(ticketDate).last_number;
      }
      db.prepare('UPDATE delivery_orders SET channel=?,ticket_date=?,ticket_number=? WHERE id=?').run(channel,ticketDate,ticketNumber,id);
      if(items.length)persistOrderItems(id,items,ts);
      writeAudit(db,{action:'delivery.create',entity:'delivery_order',entityId:id,actor,context:{fulfillmentType,feeCents:fee,paymentMethod,itemCount:items.length}},now);
      return get(id);
    });
  }
  function updateStatus(id,status,actor={}){gate();const order=get(id);const next=String(status||'').toUpperCase();if(['PREPARING','READY'].includes(next))throw new Error('Status de producao e controlado pelo KDS.');const transitions=order.fulfillmentType==='PICKUP'?PICKUP_TRANSITIONS:DELIVERY_TRANSITIONS;if(!(transitions[order.status]||[]).includes(next))throw new Error(`Transicao de delivery invalida: ${order.status} -> ${next}.`);db.prepare('UPDATE delivery_orders SET status=?,updated_at=? WHERE id=?').run(next,now(),order.id);writeAudit(db,{action:'delivery.status',entity:'delivery_order',entityId:order.id,actor,context:{from:order.status,to:next}},now);return get(order.id);}
  function cancel(id,reason,actor={}){
    gate();
    const order=get(id);
    if(['DELIVERED','PICKED_UP','CANCELLED'].includes(order.status))throw new Error('Pedido nao pode ser cancelado no status atual.');
    const text=String(reason||'').trim();if(!text)throw new Error('Informe o motivo do cancelamento.');
    return withTransaction(db,()=>{
      if(order.saleId){
        const sale=sales.getSale(order.saleId);
        if(sale&&['OPEN','SUSPENDED'].includes(sale.status))sales.cancelSale(order.saleId,{reason:text,actor});
      }
      if(kitchen?.cancelSourceTickets)kitchen.cancelSourceTickets('DELIVERY',order.id,actor);
      else db.prepare("UPDATE production_tickets SET status='CANCELLED',updated_at=? WHERE source_type='DELIVERY' AND source_id=? AND status<>'CANCELLED'").run(now(),order.id);
      const timestamp=now();
      db.prepare("UPDATE delivery_orders SET status='CANCELLED',cancel_reason=?,updated_at=? WHERE id=?").run(text,timestamp,order.id);
      writeAudit(db,{action:'delivery.cancel',entity:'delivery_order',entityId:order.id,actor,context:{reason:text,saleId:order.saleId||null}},now);
      return get(order.id);
    });
  }
  function assignCourier(id,courier,actor={}){gate();const text=String(courier||'').trim();if(!text)throw new Error('Entregador obrigatorio.');const order=get(id);if(order.fulfillmentType!=='DELIVERY')throw new Error('Retirada nao utiliza entregador.');db.prepare('UPDATE delivery_orders SET courier=?,updated_at=? WHERE id=?').run(text,now(),order.id);writeAudit(db,{action:'delivery.courier',entity:'delivery_order',entityId:order.id,actor,context:{courier:text}},now);return get(order.id);}
  function ensureFeeProduct(){const ts=now();db.prepare(`INSERT INTO products(id,sku,barcode,name,category_id,unit,sale_price_cents,cost_cents,track_stock,minimum_stock,active,created_at,updated_at) VALUES(?,NULL,NULL,'Taxa de entrega',NULL,'UN',0,0,0,0,1,?,?) ON CONFLICT(id) DO UPDATE SET active=1,updated_at=excluded.updated_at`).run(DELIVERY_FEE_PRODUCT_ID,ts,ts);db.prepare('INSERT OR IGNORE INTO inventory_balances(product_id,quantity,updated_at) VALUES(?,0,?)').run(DELIVERY_FEE_PRODUCT_ID,ts);}
  function createSale(id,input={},actor={}){
    gate();const order=get(id);if(order.saleId)return sales.getSale(order.saleId);
    const terminalId=String(input.terminalId||'').trim();const operatorId=String(input.operatorId||'').trim();if(!terminalId||!operatorId)throw new Error('Terminal e operador sao obrigatorios.');
    const submittedItems=Array.isArray(input.items)?input.items:[];
    const items=order.items.length?order.items:submittedItems;if(!items.length)throw new Error('Adicione itens ao pedido.');
    if(kitchen?.assertOrderRouting)kitchen.assertOrderRouting(items);
    return withTransaction(db,()=>{
      if(!order.items.length&&submittedItems.length)persistOrderItems(order.id,submittedItems,now());
      const saleItems=order.items.length?order.items:orderItems(order.id);
      const sale=sales.openSale({terminalId,operatorId,customerId:order.customerId||null},actor);
      for(const item of saleItems){
        const configurationSnapshot={...(item.configurationSnapshot||{}),orderPriceSnapshot:{version:1,source:'DELIVERY',unitPriceCents:item.unitPriceCents}};
        sales.addItem(sale.id,{productId:item.productId,quantity:item.quantity??1,unitPriceCents:item.unitPriceCents,configurationSnapshot,forceSeparateLine:true});
      }
      if(order.feeCents>0){ensureFeeProduct();sales.addItem(sale.id,{productId:DELIVERY_FEE_PRODUCT_ID,quantity:1,unitPriceCents:order.feeCents,configurationSnapshot:{version:1,systemAdjustment:{type:'DELIVERY_FEE',label:'Taxa de entrega'}},forceSeparateLine:true});db.prepare('UPDATE products SET active=0,updated_at=? WHERE id=?').run(now(),DELIVERY_FEE_PRODUCT_ID);}
      db.prepare('UPDATE delivery_orders SET sale_id=?,updated_at=? WHERE id=?').run(sale.id,now(),order.id);
      const current=sales.getSale(sale.id);
      if(kitchen?.routeProduction){
        const productionItems=current.items.filter(item=>item.productId!==DELIVERY_FEE_PRODUCT_ID);
        const tickets=kitchen.routeProduction({sourceType:'DELIVERY',sourceId:order.id,items:productionItems,note:order.note||''});
        if(!tickets.length)db.prepare("UPDATE delivery_orders SET status='READY',updated_at=? WHERE id=? AND status='NEW'").run(now(),order.id);
      }
      writeAudit(db,{action:'delivery.sale.create',entity:'delivery_order',entityId:order.id,actor,context:{saleId:sale.id}},now);
      return current;
    });
  }
  function list({status=null,fulfillmentType=null}={}){gate();const clauses=[];const params=[];if(status){clauses.push('status=?');params.push(String(status).toUpperCase());}if(fulfillmentType){clauses.push('fulfillment_type=?');params.push(String(fulfillmentType).toUpperCase());}return db.prepare(`SELECT * FROM delivery_orders${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at DESC,id DESC`).all(...params).map(map);}
  return{create,get,list,updateStatus,cancel,assignCourier,createSale};
}
module.exports={createDeliveryService,MANUAL_PAYMENT_METHODS,DELIVERY_TRANSITIONS,PICKUP_TRANSITIONS,DELIVERY_FEE_PRODUCT_ID};
