'use strict';

const { withTransaction }=require('../../core/database/sqlite-database');
const { writeAudit }=require('../../core/audit-log');
const { assertCents }=require('../shared/money');

function parseConfiguration(text){if(!text)return null;try{return JSON.parse(text);}catch{return null;}}

function createConfiguredRestaurantService({db,baseService,kitchenService=null,now=()=>new Date().toISOString()}={}){
  if(!db||!baseService)throw new TypeError('db and baseService are required.');

  function enrichOrder(order){
    if(!order)return null;
    const metadata=new Map(db.prepare(`SELECT i.id,i.configuration_json AS configurationJson,r.mode AS productionMode
      FROM restaurant_order_items i
      LEFT JOIN restaurant_product_routes r ON r.product_id=i.product_id
      WHERE i.order_id=?`).all(order.id).map(row=>[row.id,{configuration:parseConfiguration(row.configurationJson),productionMode:row.productionMode||null}]));
    return{...order,items:order.items.map(item=>({...item,configuration:metadata.get(item.id)?.configuration||null,productionMode:metadata.get(item.id)?.productionMode||null}))};
  }
  function enrichSession(session){if(!session)return null;return{...session,orders:(session.orders||[]).map(enrichOrder)};}
  function getOrder(id){return enrichOrder(baseService.getOrder(id));}
  function getSession(id){return enrichSession(baseService.getSession(id));}
  function currentSession(tableId){return enrichSession(baseService.currentSession(tableId));}

  function addOrder(sessionId,input={}){
    const items=Array.isArray(input.items)?input.items:[];
    kitchenService?.assertOrderRouting?.(items);
    const configured=items.some(item=>item.unitPriceCents!==undefined||item.configurationSnapshot);
    if(!configured)return enrichOrder(baseService.addOrder(sessionId,input));
    return withTransaction(db,()=>{
      const order=baseService.addOrder(sessionId,input);
      // mapOrder() sorts by timestamp and random item ID. That is NOT insertion
      // order, so matching order.items[index] to input.items[index] can attach a
      // different product's price or customization to this row.
      // Resolve newly inserted rows in SQLite insertion order before applying
      // per-item prices and configuration snapshots.
      const createdItems=db.prepare('SELECT id,product_id AS productId,quantity,unit_price_cents AS unitPriceCents FROM restaurant_order_items WHERE order_id=? ORDER BY rowid').all(order.id);
      if(createdItems.length!==items.length)throw new Error('Inconsistência no pedido: quantidade de linhas divergente.');
      let totalCents=0;
      for(let index=0;index<createdItems.length;index+=1){
        const requested=items[index]||{};const created=createdItems[index];
        if(String(created.productId)!==String(requested.productId||''))throw new Error('Inconsistência no pedido: associação de produtos divergente.');
        const unitPrice=requested.unitPriceCents===undefined?created.unitPriceCents:assertCents(Number(requested.unitPriceCents),'unitPriceCents');
        if(unitPrice<0)throw new Error('Preco configurado nao pode ser negativo.');
        const total=Math.round(unitPrice*Number(created.quantity));totalCents+=total;
        db.prepare('UPDATE restaurant_order_items SET unit_price_cents=?,total_cents=?,configuration_json=? WHERE id=?').run(unitPrice,total,requested.configurationSnapshot?JSON.stringify(requested.configurationSnapshot):null,created.id);
      }
      db.prepare('UPDATE restaurant_orders SET total_cents=?,updated_at=? WHERE id=?').run(totalCents,now(),order.id);
      writeAudit(db,{action:'restaurant.order.configure',entity:'restaurant_order',entityId:order.id,actor:input.actor||{},context:{totalCents,configuredItems:items.filter(item=>item.configurationSnapshot).length}},now);
      return getOrder(order.id);
    });
  }

  function checkoutToSale(sessionId,{terminalId,operatorId,actor={},mutationId=null}={},saleService){
    if(!saleService)throw new TypeError('Sale service is required.');
    return withTransaction(db,()=>{
      const row=db.prepare("SELECT * FROM table_sessions WHERE id=? AND status IN ('OPEN','CHECKOUT')").get(String(sessionId));
      if(!row)throw new Error('Comanda ativa nao encontrada.');
      if(row.checkout_sale_id){const existing=saleService.getSale(row.checkout_sale_id);if(existing)return{session:getSession(row.id),sale:existing};}
      const orderItems=db.prepare(`SELECT i.id,i.product_id AS productId,i.quantity,i.unit_price_cents AS unitPriceCents,i.configuration_json AS configurationJson
        FROM restaurant_order_items i JOIN restaurant_orders o ON o.id=i.order_id
        WHERE o.table_session_id=? AND o.status<>'CANCELLED' AND NOT EXISTS(SELECT 1 FROM restaurant_item_cancellations c WHERE c.order_item_id=i.id)
        ORDER BY o.created_at,o.id,i.created_at,i.id`).all(row.id);
      if(!orderItems.length)throw new Error('Comanda sem pedidos para fechamento.');
      const sale=saleService.openSale({terminalId,operatorId},actor);
      if(row.customer_id)saleService.setCustomer(sale.id,row.customer_id);
      for(const item of orderItems){saleService.addItem(sale.id,{productId:item.productId,quantity:item.quantity,unitPriceCents:item.unitPriceCents,configurationSnapshot:parseConfiguration(item.configurationJson)||undefined,forceSeparateLine:Boolean(item.configurationJson)});}
      db.prepare("UPDATE table_sessions SET status='CHECKOUT',checkout_sale_id=?,updated_at=? WHERE id=?").run(sale.id,now(),row.id);
      writeAudit(db,{action:'restaurant.table.checkout',entity:'table_session',entityId:row.id,actor,context:{saleId:sale.id,mutationId,configured:true}},now);
      return{session:getSession(row.id),sale:saleService.getSale(sale.id)};
    });
  }

  return{
    ...baseService,
    getOrder,
    getSession,
    currentSession,
    addOrder,
    checkoutToSale
  };
}

module.exports={createConfiguredRestaurantService};
