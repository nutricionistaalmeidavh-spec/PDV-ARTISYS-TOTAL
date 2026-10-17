'use strict';
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { resolvePayment, normalizeMethod } = require('../payments/payment-rules');
const { calculateSaleTotals, allocateSaleDiscount } = require('./pricing');
const { roundQuantity } = require('../inventory/inventory-rules');
const { assertCents } = require('../shared/money');
const { runSalesEnhancementMigrations } = require('../../core/database/sales-enhancement-migrations');
const { runCommercialMediaMigrations } = require('../../core/database/commercial-media-migrations');
const { runEnterpriseDepthMigrations } = require('../../core/database/enterprise-depth-migrations');
const { ensureIntegritySchema } = require('../../core/database/integrity-migrations');
const { createTerminalStockLocationService } = require('../inventory/terminal-stock-location-service');
const { principalFromActor } = require('../../core/auth/principal-resolver');
const VALID_PAYMENT_METHODS = new Set(['CASH','PIX','DEBIT_CARD','CREDIT_CARD','STORE_CREDIT','OTHER']);

function createSaleService({
  db,
  outbox,
  now = () => new Date().toISOString(),
  idFactory = p => `${p}-${randomUUID()}`,
  stockRequirementsResolver = null,
  commissionService = null,
  cashSessionResolver = null,
  authorization = null
} = {}) {
  if (!db || !outbox) throw new TypeError('Database and outbox are required.');
  runSalesEnhancementMigrations(db, now);
  runCommercialMediaMigrations(db, now);
  runEnterpriseDepthMigrations(db, now);
  ensureIntegritySchema(db);
  const terminalStockLocations = createTerminalStockLocationService({db,now});

  function getSaleRow(id) { return db.prepare('SELECT * FROM sales WHERE id=?').get(String(id)); }
  function getItems(id) {
    return db.prepare(`SELECT id,product_id AS productId,product_name AS productName,sku,quantity,unit_price_cents AS unitPriceCents,total_cents AS totalCents,
      catalog_unit_price_cents AS catalogUnitPriceCents,price_override_reason AS priceOverrideReason,price_changed_by_id AS priceChangedById,
      price_authorized_by_id AS priceAuthorizedById,commission_bps_snapshot AS commissionBpsSnapshot,commission_base_cents AS commissionBaseCents,
      commission_cents AS commissionCents,allocated_discount_cents AS allocatedDiscountCents,net_total_cents AS netTotalCents,
      configuration_json AS configurationJson FROM sale_items WHERE sale_id=? ORDER BY created_at,id`).all(String(id)).map(item=>{
      let configuration=null;try{configuration=item.configurationJson?JSON.parse(item.configurationJson):null;}catch{configuration=null;}
      const {configurationJson,...safe}=item;return{...safe,configuration};
    });
  }
  function getPayments(id) { return db.prepare(`SELECT id,method,amount_cents AS amountCents,metadata_json AS metadataJson,created_at AS createdAt FROM payments WHERE sale_id=? ORDER BY created_at,id`).all(String(id)).map(p => ({ ...p, metadata: p.metadataJson ? JSON.parse(p.metadataJson) : null })); }
  function mapSale(row) { if (!row) return null; return { id: row.id, saleNumber: row.sale_number, terminalId: row.terminal_id, operatorId: row.operator_id, sellerId: row.seller_id || row.operator_id, sellerName: row.seller_name_snapshot || null, customerId: row.customer_id, stockLocationId: row.stock_location_id || 'MAIN', cashSessionId:row.cash_session_id || null, status: row.status, subtotalCents: row.subtotal_cents, discountCents: row.discount_cents, totalCents: row.total_cents, changeCents: row.change_cents, cancelReason: row.cancel_reason, openedAt: row.opened_at, completedAt: row.completed_at, cancelledAt: row.cancelled_at, updatedAt: row.updated_at, items: getItems(row.id), payments: getPayments(row.id) }; }
  function getSale(id) { return mapSale(getSaleRow(id)); }
  function getSaleDetails(id) { return getSale(id); }
  function requireSale(id, states) { const row = getSaleRow(id); if (!row) throw new Error('Venda nao encontrada.'); if (states && !states.includes(row.status)) throw new Error(`Venda nao esta aberta para esta operacao (status ${row.status}).`); return row; }

  function getCanonicalCompletion(saleId) {
    const row=db.prepare(`SELECT payload_json AS payloadJson FROM domain_events
      WHERE aggregate_type='sale' AND aggregate_id=? AND type='sale.completed' ORDER BY occurred_at DESC LIMIT 1`).get(String(saleId));
    if(!row?.payloadJson)return null;
    try{return JSON.parse(row.payloadJson);}catch{return null;}
  }

  function resolveCashSession(terminalId) {
    if(typeof cashSessionResolver!=='function')return null;
    const session=cashSessionResolver(String(terminalId));
    if(!session||session.status!=='OPEN')throw new Error('Nao existe caixa aberto neste terminal.');
    return session;
  }

  function stockSnapshotFor(item) {
    const raw=typeof stockRequirementsResolver==='function'
      ? stockRequirementsResolver([item])
      : [{productId:item.productId,quantity:item.quantity}];
    const totals=new Map();
    for(const requirement of raw||[]){
      const productId=String(requirement?.productId||'').trim();
      const quantity=roundQuantity(Number(requirement?.quantity||0));
      if(!productId||quantity<=0)continue;
      totals.set(productId,roundQuantity((totals.get(productId)||0)+quantity));
    }
    return[...totals].sort(([a],[b])=>a.localeCompare(b)).map(([productId,quantity])=>({productId,quantity}));
  }

  function eventItem(item) {
    return {
      itemId:item.id,
      productId:item.productId,
      quantity:item.quantity,
      allocatedDiscountCents:Number(item.allocatedDiscountCents||0),
      netTotalCents:item.netTotalCents==null?Number(item.totalCents||0):Number(item.netTotalCents),
      configuration:item.configuration||null,
      stockItems:stockSnapshotFor(item)
    };
  }

  function listSales({ status = null, limit = 50 } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const normalizedStatus = status ? String(status).trim().toUpperCase() : null;
    if (normalizedStatus && !['OPEN','SUSPENDED','COMPLETED','CANCELLED'].includes(normalizedStatus)) throw new Error('Status de venda invalido.');
    const rows = normalizedStatus
      ? db.prepare('SELECT * FROM sales WHERE status=? ORDER BY opened_at DESC,id DESC LIMIT ?').all(normalizedStatus, safeLimit)
      : db.prepare('SELECT * FROM sales ORDER BY opened_at DESC,id DESC LIMIT ?').all(safeLimit);
    return rows.map(mapSale);
  }

  function listHistory(filters = {}) {
    const clauses=[]; const params=[];
    const status=filters.status && String(filters.status).toUpperCase() !== 'ALL' ? String(filters.status).toUpperCase() : null;
    if(status){if(!['OPEN','SUSPENDED','COMPLETED','CANCELLED'].includes(status))throw new Error('Status de venda invalido.');clauses.push('s.status=?');params.push(status);}
    if(filters.customerId){clauses.push('s.customer_id=?');params.push(String(filters.customerId));}
    if(filters.operatorId){clauses.push('s.operator_id=?');params.push(String(filters.operatorId));}
    if(filters.sellerId){clauses.push('COALESCE(s.seller_id,s.operator_id)=?');params.push(String(filters.sellerId));}
    if(filters.from){clauses.push('COALESCE(s.completed_at,s.cancelled_at,s.opened_at)>=?');params.push(String(filters.from));}
    if(filters.to){clauses.push('COALESCE(s.completed_at,s.cancelled_at,s.opened_at)<=?');params.push(String(filters.to));}
    if(filters.paymentMethod){clauses.push('EXISTS (SELECT 1 FROM payments p WHERE p.sale_id=s.id AND p.method=?)');params.push(normalizeMethod(filters.paymentMethod));}
    if(filters.query){const q=`%${String(filters.query).trim().toLowerCase()}%`;clauses.push('(LOWER(s.sale_number) LIKE ? OR LOWER(COALESCE(c.name,\'\')) LIKE ? OR LOWER(COALESCE(u.name,\'\')) LIKE ?)');params.push(q,q,q);}
    const limit=Math.min(Math.max(Number(filters.limit)||100,1),500);
    const offset=Math.max(Number.parseInt(filters.offset,10)||0,0);
    params.push(limit,offset);
    const sql=`SELECT s.* FROM sales s LEFT JOIN customers c ON c.id=s.customer_id LEFT JOIN users u ON u.id=s.operator_id${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY COALESCE(s.completed_at,s.cancelled_at,s.opened_at) DESC,s.id DESC LIMIT ? OFFSET ?`;
    return db.prepare(sql).all(...params).map(mapSale);
  }

  function recalculate(saleId, discountOverride) {
    const sale = requireSale(saleId, ['OPEN','SUSPENDED']);
    const items = getItems(saleId);
    const totals = calculateSaleTotals({ items, discountCents: discountOverride === undefined ? sale.discount_cents : discountOverride });
    db.prepare('UPDATE sales SET subtotal_cents=?,discount_cents=?,total_cents=?,updated_at=? WHERE id=?').run(totals.subtotalCents, totals.discountCents, totals.totalCents, now(), saleId);
    return totals;
  }

  function openSale(input = {}, actor = null) {
    const id = String(input.id || idFactory('sale')); const terminalId = String(input.terminalId || '').trim(); const operatorId = String(input.operatorId || '').trim();
    if (!terminalId || !operatorId) throw new Error('Terminal e operador sao obrigatorios.');
    const sellerId = String(input.sellerId || operatorId).trim();
    const seller = db.prepare('SELECT id,name FROM users WHERE id=? AND active=1').get(sellerId);
    if (!seller) throw new Error('Vendedor ou garcom nao encontrado ou inativo.');
    const timestamp = now(); const saleNumber = String(input.saleNumber || id).trim();
    const stockLocationId = input.stockLocationId ? String(input.stockLocationId).trim() : terminalStockLocations.resolveTerminalLocation(terminalId).locationId;
    const stockLocation = db.prepare('SELECT id FROM stock_locations WHERE id=? AND active=1').get(stockLocationId);
    if (!stockLocation) throw new Error(`Local de estoque ${stockLocationId} nao encontrado ou inativo.`);
    db.prepare(`INSERT INTO sales (id,sale_number,terminal_id,operator_id,seller_id,seller_name_snapshot,customer_id,stock_location_id,status,opened_at,updated_at) VALUES (?,?,?,?,?,?,?,?,'OPEN',?,?)`)
      .run(id, saleNumber, terminalId, operatorId, seller.id, seller.name, input.customerId || null, stockLocationId, timestamp, timestamp);
    writeAudit(db, { action: 'sale.open', entity: 'sale', entityId: id, actor: actor || { userId: operatorId, role: 'cashier', terminalId }, context: { saleNumber, terminalId, sellerId:seller.id, stockLocationId } }, now);
    return getSale(id);
  }

  function setCustomer(saleId, customerId) {
    return withTransaction(db, () => {
      requireSale(saleId, ['OPEN','SUSPENDED']);
      const normalized = customerId == null || String(customerId).trim() === '' ? null : String(customerId).trim();
      if (normalized) {
        const customer = db.prepare('SELECT id FROM customers WHERE id=? AND active=1').get(normalized);
        if (!customer) throw new Error('Cliente nao encontrado ou inativo.');
      }
      db.prepare('UPDATE sales SET customer_id=?,updated_at=? WHERE id=?').run(normalized, now(), saleId);
      return getSale(saleId);
    });
  }

  function addItem(saleId, input = {}) {
    return withTransaction(db, () => {
      requireSale(saleId, ['OPEN']); const product = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(String(input.productId));
      if (!product) throw new Error('Produto nao encontrado ou inativo.');
      const quantity = roundQuantity(input.quantity ?? 1); if (quantity <= 0) throw new Error('Quantidade deve ser maior que zero.');
      const configured=Boolean(input.configurationSnapshot)||input.unitPriceCents!==undefined||input.forceSeparateLine===true;
      const unitPrice=input.unitPriceCents===undefined?product.sale_price_cents:assertCents(Number(input.unitPriceCents),'unitPriceCents');
      if(unitPrice<0)throw new Error('Preco do item nao pode ser negativo.');
      const existing = configured?null:db.prepare('SELECT * FROM sale_items WHERE sale_id=? AND product_id=? AND configuration_json IS NULL').get(saleId, product.id); const timestamp = now();
      if (existing) { const next = roundQuantity(existing.quantity + quantity); db.prepare('UPDATE sale_items SET quantity=?,total_cents=?,allocated_discount_cents=0,net_total_cents=NULL,updated_at=? WHERE id=?').run(next, Math.round(existing.unit_price_cents * next), timestamp, existing.id); }
      else { db.prepare(`INSERT INTO sale_items (id,sale_id,product_id,product_name,sku,quantity,unit_price_cents,total_cents,allocated_discount_cents,net_total_cents,created_at,updated_at,configuration_json) VALUES (?,?,?,?,?,?,?,?,0,NULL,?,?,?)`).run(idFactory('item'), saleId, product.id, product.name, product.sku, quantity, unitPrice, Math.round(unitPrice * quantity), timestamp, timestamp,input.configurationSnapshot?JSON.stringify(input.configurationSnapshot):null); }
      recalculate(saleId); return getSale(saleId);
    });
  }

  function updateItemQuantity(saleId, productId, quantity) { return withTransaction(db, () => { requireSale(saleId, ['OPEN']); const q = roundQuantity(quantity); if (q <= 0) throw new Error('Quantidade deve ser maior que zero.'); const row = db.prepare('SELECT * FROM sale_items WHERE sale_id=? AND product_id=? ORDER BY created_at,id LIMIT 1').get(saleId, productId); if (!row) throw new Error('Item nao encontrado na venda.'); db.prepare('UPDATE sale_items SET quantity=?,total_cents=?,allocated_discount_cents=0,net_total_cents=NULL,updated_at=? WHERE id=?').run(q, Math.round(row.unit_price_cents * q), now(), row.id); recalculate(saleId); return getSale(saleId); }); }
  function updateItemQuantityById(saleId,itemId,quantity){return withTransaction(db,()=>{requireSale(saleId,['OPEN']);const q=roundQuantity(quantity);if(q<=0)throw new Error('Quantidade deve ser maior que zero.');const row=db.prepare('SELECT * FROM sale_items WHERE sale_id=? AND id=?').get(saleId,String(itemId));if(!row)throw new Error('Item nao encontrado na venda.');db.prepare('UPDATE sale_items SET quantity=?,total_cents=?,allocated_discount_cents=0,net_total_cents=NULL,updated_at=? WHERE id=?').run(q,Math.round(row.unit_price_cents*q),now(),row.id);recalculate(saleId);return getSale(saleId);});}
  function overrideItemPrice(saleId,itemId,{unitPriceCents,reason='',actor={}}={}){
    return withTransaction(db,()=>{
      requireSale(saleId,['OPEN']);
      if(authorization)authorization.require({principal:principalFromActor(actor),capability:'sales.discount'});
      const price=assertCents(Number(unitPriceCents),'unitPriceCents');if(price<0)throw new Error('Preco do item nao pode ser negativo.');
      const text=String(reason||'').trim();if(!text)throw new Error('Informe o motivo da alteracao de preco.');
      const row=db.prepare('SELECT * FROM sale_items WHERE sale_id=? AND id=?').get(saleId,String(itemId));if(!row)throw new Error('Item nao encontrado na venda.');
      const timestamp=now();const actorId=String(actor.userId||'').trim()||null;
      db.prepare(`UPDATE sale_items SET catalog_unit_price_cents=COALESCE(catalog_unit_price_cents,unit_price_cents),unit_price_cents=?,total_cents=?,
        allocated_discount_cents=0,net_total_cents=NULL,price_override_reason=?,price_changed_by_id=?,price_authorized_by_id=?,updated_at=? WHERE id=?`)
        .run(price,Math.round(price*Number(row.quantity)),text,actorId,actorId,timestamp,row.id);
      recalculate(saleId);
      writeAudit(db,{action:'sale.item-price-override',entity:'sale-item',entityId:row.id,actor,context:{saleId,previousUnitPriceCents:row.unit_price_cents,newUnitPriceCents:price,reason:text}},now);
      return getSale(saleId);
    });
  }

  function setSeller(saleId, sellerId, actor = null) {
    return withTransaction(db, () => {
      requireSale(saleId, ['OPEN','SUSPENDED']);
      const seller = db.prepare('SELECT id,name FROM users WHERE id=? AND active=1').get(String(sellerId || '').trim());
      if (!seller) throw new Error('Vendedor ou garcom nao encontrado ou inativo.');
      db.prepare('UPDATE sales SET seller_id=?,seller_name_snapshot=?,updated_at=? WHERE id=?').run(seller.id,seller.name,now(),saleId);
      writeAudit(db,{action:'sale.seller-change',entity:'sale',entityId:saleId,actor,context:{sellerId:seller.id}},now);
      return getSale(saleId);
    });
  }
  function removeItem(saleId, productId) { return withTransaction(db, () => { requireSale(saleId, ['OPEN']); db.prepare('DELETE FROM sale_items WHERE sale_id=? AND product_id=?').run(saleId, productId); recalculate(saleId); return getSale(saleId); }); }
  function removeItemById(saleId,itemId){return withTransaction(db,()=>{requireSale(saleId,['OPEN']);db.prepare('DELETE FROM sale_items WHERE sale_id=? AND id=?').run(saleId,String(itemId));recalculate(saleId);return getSale(saleId);});}
  function applyDiscount(saleId, { discountCents = 0 } = {}) { return withTransaction(db, () => { requireSale(saleId, ['OPEN']); recalculate(saleId, discountCents); return getSale(saleId); }); }
  function suspendSale(saleId) { requireSale(saleId, ['OPEN']); db.prepare("UPDATE sales SET status='SUSPENDED',updated_at=? WHERE id=?").run(now(), saleId); return getSale(saleId); }
  function resumeSale(saleId) { requireSale(saleId, ['SUSPENDED']); db.prepare("UPDATE sales SET status='OPEN',updated_at=? WHERE id=?").run(now(), saleId); return getSale(saleId); }

  function completeSale(saleId, { payments = [], actor = {}, mutationId = null } = {}) {
    return withTransaction(db, () => {
      const sale = requireSale(saleId, ['OPEN']);
      const initialItems = getItems(saleId); if (!initialItems.length) throw new Error('Adicione pelo menos um item antes de finalizar a venda.');
      const totals = recalculate(saleId);
      const cashSession=resolveCashSession(sale.terminal_id);
      const allocated=allocateSaleDiscount(initialItems,totals.discountCents);
      const updateNet=db.prepare('UPDATE sale_items SET allocated_discount_cents=?,net_total_cents=? WHERE id=?');
      for(const item of allocated)updateNet.run(item.allocatedDiscountCents,item.netTotalCents,item.id);
      const items=getItems(saleId);
      const eventItems=items.map(eventItem);
      const aggregate = eventItems.flatMap(item=>item.stockItems||[]).reduce((map, item) => map.set(String(item.productId), roundQuantity((map.get(String(item.productId)) || 0) + Number(item.quantity||0))), new Map());
      for (const [productId, quantity] of aggregate) { const product = db.prepare('SELECT track_stock AS trackStock,name FROM products WHERE id=?').get(productId); if (product?.trackStock) { const stock = db.prepare('SELECT quantity FROM inventory_location_balances WHERE product_id=? AND location_id=?').get(productId, sale.stock_location_id || 'MAIN')?.quantity ?? 0; if (quantity > stock) throw new Error(`Estoque insuficiente para ${product.name}.`); } }
      const customer = sale.customer_id ? db.prepare('SELECT * FROM customers WHERE id=?').get(sale.customer_id) : null;
      const normalizedPayments = payments.map(p => { const method = normalizeMethod(p.method); if (!VALID_PAYMENT_METHODS.has(method)) throw new Error(`Forma de pagamento invalida: ${method}.`); return { method, amountCents: p.amountCents, metadata: p.metadata || null }; });
      const paymentSummary = resolvePayment({ totalCents: totals.totalCents, payments: normalizedPayments, creditMethods: ['STORE_CREDIT'], changeMethods: ['CASH'], availableCreditCents: customer ? Math.max(customer.credit_limit_cents - customer.credit_used_cents, 0) : 0, customerName: customer?.name });
      if (paymentSummary.status === 'insufficient') throw new Error(`Pagamento insuficiente. Faltam ${paymentSummary.remainingTotalCents} centavos.`);
      const timestamp = now(); db.prepare('DELETE FROM payments WHERE sale_id=?').run(saleId);
      const insert = db.prepare('INSERT INTO payments (id,sale_id,method,amount_cents,metadata_json,created_at) VALUES (?,?,?,?,?,?)');
      for (const payment of normalizedPayments) insert.run(idFactory('pay'), saleId, payment.method, payment.amountCents, payment.metadata ? JSON.stringify(payment.metadata) : null, timestamp);
      if (customer && paymentSummary.creditTotalCents) db.prepare('UPDATE customers SET credit_used_cents=credit_used_cents+?,updated_at=? WHERE id=?').run(paymentSummary.creditTotalCents, timestamp, customer.id);
      commissionService?.recordSaleCompleted(saleId,{netTotalCents:totals.totalCents,createdAt:timestamp});
      db.prepare("UPDATE sales SET status='COMPLETED',subtotal_cents=?,discount_cents=?,total_cents=?,change_cents=?,cash_session_id=?,completed_at=?,updated_at=? WHERE id=? AND status='OPEN'").run(totals.subtotalCents, totals.discountCents, totals.totalCents, paymentSummary.changeDueCents, cashSession?.id||null, timestamp, timestamp, saleId);
      const event = { eventId: idFactory('evt'), type: 'sale.completed', aggregate: 'sale', aggregateId: saleId, occurredAt: timestamp, actor: actor && typeof actor === 'object' ? actor : {}, source: 'server', mutationId, payload: { saleNumber: sale.sale_number, terminalId: sale.terminal_id, cashSessionId:cashSession?.id||null, stockLocationId: sale.stock_location_id || 'MAIN', totalCents: totals.totalCents, changeCents: paymentSummary.changeDueCents, items:eventItems, payments: normalizedPayments.map(p => ({ method: p.method, amountCents: p.amountCents })) } };
      outbox.insert(event); writeAudit(db, { action: 'sale.complete', entity: 'sale', entityId: saleId, actor, context: { totalCents: totals.totalCents, cashSessionId:cashSession?.id||null, eventId: event.eventId } }, now); return getSale(saleId);
    });
  }

  function cancelSale(saleId, { reason = '', actor = {}, mutationId = null } = {}) {
    const text = String(reason).trim(); if (!text) throw new Error('Informe o motivo do cancelamento.');
    const current = requireSale(saleId);
    if (['OPEN','SUSPENDED'].includes(current.status)) {
      return withTransaction(db, () => {
        const timestamp = now();
        db.prepare("UPDATE sales SET status='CANCELLED',cancel_reason=?,cancelled_at=?,updated_at=? WHERE id=? AND status IN ('OPEN','SUSPENDED')").run(text, timestamp, timestamp, saleId);
        const event = { eventId:idFactory('evt'), type:'sale.voided', aggregate:'sale', aggregateId:saleId, occurredAt:timestamp, actor:actor && typeof actor === 'object' ? actor : {}, source:'server', mutationId, payload:{ saleNumber:current.sale_number, terminalId:current.terminal_id, reason:text } };
        outbox.insert(event);
        writeAudit(db, { action: 'sale.void', entity: 'sale', entityId: saleId, actor, context: { reason: text, eventId:event.eventId } }, now);
        return getSale(saleId);
      });
    }
    if (current.status !== 'COMPLETED') throw new Error(`Venda nao pode ser cancelada no status ${current.status}.`);
    if(authorization)authorization.require({principal:principalFromActor(actor),capability:'sales.cancel'});
    return withTransaction(db, () => {
      const sale = requireSale(saleId, ['COMPLETED']); const items = getItems(saleId); const payments = getPayments(saleId); const timestamp = now();
      const creditTotal = payments.filter(p => p.method === 'STORE_CREDIT').reduce((sum, p) => sum + p.amountCents, 0);
      if (sale.customer_id && creditTotal) db.prepare('UPDATE customers SET credit_used_cents=MAX(credit_used_cents-?,0),updated_at=? WHERE id=?').run(creditTotal, timestamp, sale.customer_id);
      commissionService?.reverseSale(saleId,timestamp);
      db.prepare("UPDATE sales SET status='CANCELLED',cancel_reason=?,cancelled_at=?,updated_at=? WHERE id=? AND status='COMPLETED'").run(text, timestamp, timestamp, saleId);
      const completion=getCanonicalCompletion(saleId);
      const eventItems=Array.isArray(completion?.items)&&completion.items.length?completion.items:items.map(eventItem);
      const event = { eventId: idFactory('evt'), type: 'sale.cancelled', aggregate: 'sale', aggregateId: saleId, occurredAt: timestamp, actor, source: 'server', mutationId, payload: { saleNumber: sale.sale_number, terminalId: sale.terminal_id, cashSessionId:sale.cash_session_id||completion?.cashSessionId||null, stockLocationId: sale.stock_location_id || 'MAIN', reason: text, items:eventItems, payments: payments.map(p => ({ method: p.method, amountCents: p.amountCents })) } };
      outbox.insert(event); writeAudit(db, { action: 'sale.cancel', entity: 'sale', entityId: saleId, actor, context: { reason: text, cashSessionId:sale.cash_session_id||null, eventId: event.eventId } }, now); return getSale(saleId);
    });
  }

  return { openSale, setCustomer, setSeller, addItem, updateItemQuantity, updateItemQuantityById, overrideItemPrice, removeItem, removeItemById, applyDiscount, suspendSale, resumeSale, completeSale, cancelSale, getSale, getSaleDetails, listSales, listHistory };
}
module.exports = { createSaleService };
