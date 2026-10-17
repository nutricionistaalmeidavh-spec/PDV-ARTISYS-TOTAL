'use strict';
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { ensureIntegritySchema } = require('../../core/database/integrity-migrations');
const { assertCents } = require('../shared/money');
const { normalizeMethod } = require('../payments/payment-rules');
const { roundQuantity } = require('../inventory/inventory-rules');
const { principalFromActor } = require('../../core/auth/principal-resolver');

const VALID_REFUND_METHODS = new Set(['CASH','PIX','DEBIT_CARD','CREDIT_CARD','STORE_CREDIT','OTHER']);
function parseConfiguration(value){try{return value?JSON.parse(value):null;}catch{return null;}}

function createReturnService({ db, outbox, now = () => new Date().toISOString(), idFactory = p => `${p}-${randomUUID()}`, commissionService = null, cashSessionResolver = null, authorization = null } = {}) {
  if (!db || !outbox) throw new TypeError('Database and outbox are required.');
  ensureIntegritySchema(db);

  function getItems(returnId) {
    return db.prepare(`SELECT id,sale_item_id AS saleItemId,product_id AS productId,product_name AS productName,
      quantity,unit_price_cents AS unitPriceCents,total_cents AS totalCents,created_at AS createdAt
      FROM return_items WHERE return_id=? ORDER BY created_at,id`).all(String(returnId));
  }

  function getCanonicalPayload(returnId) {
    const row = db.prepare(`SELECT payload_json AS payloadJson FROM domain_events
      WHERE aggregate_type='return' AND aggregate_id=? AND type='return.completed' ORDER BY occurred_at DESC LIMIT 1`).get(String(returnId));
    if (!row?.payloadJson) return null;
    try { return JSON.parse(row.payloadJson); } catch { return null; }
  }

  function getSaleCompletionPayload(saleId) {
    const row=db.prepare(`SELECT payload_json AS payloadJson FROM domain_events
      WHERE aggregate_type='sale' AND aggregate_id=? AND type='sale.completed' ORDER BY occurred_at DESC LIMIT 1`).get(String(saleId));
    if(!row?.payloadJson)return null;
    try{return JSON.parse(row.payloadJson);}catch{return null;}
  }

  function mapReturn(row) {
    if (!row) return null;
    const payload = getCanonicalPayload(row.id);
    return {
      id: row.id, saleId: row.sale_id, terminalId: row.terminal_id, cashSessionId:row.cash_session_id || payload?.cashSessionId || null, operatorId: row.operator_id,
      status: row.status, totalCents: row.total_cents, reason: row.reason,
      authorizedById: row.authorized_by_id, createdAt: row.created_at, cancelledAt: row.cancelled_at,
      items: getItems(row.id), refunds: payload?.refunds || []
    };
  }

  function getReturn(id) { return mapReturn(db.prepare('SELECT * FROM return_transactions WHERE id=?').get(String(id))); }

  function listReturns(filters = {}) {
    const clauses = []; const params = [];
    if (filters.saleId) { clauses.push('sale_id=?'); params.push(String(filters.saleId)); }
    if (filters.status) { clauses.push('status=?'); params.push(String(filters.status).toUpperCase()); }
    if (filters.from) { clauses.push('created_at>=?'); params.push(String(filters.from)); }
    if (filters.to) { clauses.push('created_at<=?'); params.push(String(filters.to)); }
    const rows = db.prepare(`SELECT * FROM return_transactions${clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''} ORDER BY created_at DESC,id DESC`).all(...params);
    return rows.map(mapReturn);
  }

  function assertManage(actor) { if(authorization)authorization.require({principal:principalFromActor(actor),capability:'returns.manage'}); }
  function assertApprove(actor) { if(authorization)authorization.require({principal:principalFromActor(actor),capability:'returns.approve'}); }

  function resolveCashSession(terminalId) {
    if(typeof cashSessionResolver!=='function')return null;
    const session=cashSessionResolver(String(terminalId));
    if(!session||session.status!=='OPEN')throw new Error('Nao existe caixa aberto neste terminal.');
    return session;
  }

  function normalizeRefunds(refunds, totalCents) {
    if (!Array.isArray(refunds) || !refunds.length) throw new Error('Informe a forma de reembolso da devolucao.');
    const grouped = new Map();
    for (const refund of refunds) {
      const method = normalizeMethod(refund.method);
      if (!VALID_REFUND_METHODS.has(method)) throw new Error(`Forma de reembolso invalida: ${method}.`);
      const amountCents = assertCents(refund.amountCents, 'refund.amountCents');
      if (amountCents <= 0) throw new Error('Valor do reembolso deve ser maior que zero.');
      grouped.set(method, (grouped.get(method) || 0) + amountCents);
    }
    const normalized = [...grouped].map(([method, amountCents]) => ({ method, amountCents }));
    const sum = normalized.reduce((value, item) => value + item.amountCents, 0);
    if (sum !== totalCents) throw new Error('Total do reembolso deve ser igual ao total da devolucao.');
    return normalized;
  }

  function completedReturnTotals(saleItemId) {
    return db.prepare(`SELECT COALESCE(SUM(ri.quantity),0) AS quantity,COALESCE(SUM(ri.total_cents),0) AS totalCents
      FROM return_items ri JOIN return_transactions rt ON rt.id=ri.return_id
      WHERE ri.sale_item_id=? AND rt.status='COMPLETED'`).get(String(saleItemId));
  }

  function returnItemAmount(item, quantity, returnedQuantity, returnedCents) {
    const originalQuantity=Number(item.quantity||0);
    const lineNetCents=Number(item.net_total_cents==null?item.total_cents:item.net_total_cents);
    const available=roundQuantity(originalQuantity-Number(returnedQuantity||0));
    const remainingCents=Math.max(lineNetCents-Number(returnedCents||0),0);
    if(quantity>=available)return remainingCents;
    return Math.min(remainingCents,Math.max(0,Math.round((lineNetCents*quantity)/originalQuantity)));
  }

  function scaleStockSnapshot(snapshot, requestedQuantity, soldQuantity) {
    if(!Array.isArray(snapshot)||!snapshot.length||Number(soldQuantity)<=0)return null;
    const ratio=Number(requestedQuantity)/Number(soldQuantity);
    return snapshot.map(component=>({
      productId:String(component.productId),
      quantity:roundQuantity(Number(component.quantity||0)*ratio)
    })).filter(component=>component.productId&&component.quantity>0);
  }

  function createReturn(input = {}) {
    const actor = input.actor || {};
    const authorizedBy = input.authorizedBy || actor;
    assertManage(actor);
    assertApprove(authorizedBy);
    const saleId = String(input.saleId || '').trim();
    const terminalId = String(input.terminalId || actor.terminalId || '').trim();
    const operatorId = String(input.operatorId || actor.userId || '').trim();
    const reason = String(input.reason || '').trim();
    if (!saleId || !terminalId || !operatorId) throw new Error('Venda, terminal e operador sao obrigatorios.');
    if (!reason) throw new Error('Informe o motivo da devolucao.');
    const sale = db.prepare("SELECT * FROM sales WHERE id=? AND status='COMPLETED'").get(saleId);
    if (!sale) throw new Error('Somente venda concluida pode receber devolucao.');
    if (!Array.isArray(input.items) || !input.items.length) throw new Error('Informe ao menos um item para devolucao.');
    const cashSession=resolveCashSession(terminalId);
    const completion=getSaleCompletionPayload(saleId);
    const completionItems=new Map((completion?.items||[]).map(item=>[String(item.itemId||''),item]));

    return withTransaction(db, () => {
      const normalizedItems = [];
      const seen = new Set();
      for (const requested of input.items) {
        const saleItemId = String(requested.saleItemId || '').trim();
        if (!saleItemId || seen.has(saleItemId)) throw new Error('Item de devolucao invalido ou repetido.');
        seen.add(saleItemId);
        const item = db.prepare('SELECT * FROM sale_items WHERE id=? AND sale_id=?').get(saleItemId, saleId);
        if (!item) throw new Error('Item nao pertence a venda informada.');
        const quantity = roundQuantity(requested.quantity);
        if (quantity <= 0) throw new Error('Quantidade devolvida deve ser maior que zero.');
        const returned = completedReturnTotals(saleItemId);
        const available = roundQuantity(item.quantity - Number(returned.quantity||0));
        if (quantity > available) throw new Error(`Quantidade devolvida excede a quantidade disponivel para devolucao (${available}).`);
        const totalCents=returnItemAmount(item,quantity,returned.quantity,returned.totalCents);
        const completionItem=completionItems.get(saleItemId);
        const stockItems=scaleStockSnapshot(completionItem?.stockItems,quantity,item.quantity);
        normalizedItems.push({
          saleItemId,
          productId:item.product_id,
          productName:item.product_name,
          quantity,
          unitPriceCents:item.unit_price_cents,
          totalCents,
          configuration:parseConfiguration(item.configuration_json),
          stockItems
        });
      }
      const totalCents = normalizedItems.reduce((sum, item) => sum + item.totalCents, 0);
      const refunds = normalizeRefunds(input.refunds, totalCents);
      const id = String(input.id || idFactory('return'));
      const timestamp = now();
      db.prepare(`INSERT INTO return_transactions
        (id,sale_id,terminal_id,cash_session_id,operator_id,status,total_cents,reason,authorized_by_id,created_at)
        VALUES (?,?,?,?,?,'COMPLETED',?,?,?,?)`)
        .run(id, saleId, terminalId, cashSession?.id||null, operatorId, totalCents, reason, authorizedBy.userId || null, timestamp);
      const insertItem = db.prepare(`INSERT INTO return_items
        (id,return_id,sale_item_id,product_id,product_name,quantity,unit_price_cents,total_cents,created_at)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      for (const item of normalizedItems) insertItem.run(idFactory('returnitem'), id, item.saleItemId, item.productId, item.productName, item.quantity, item.unitPriceCents, item.totalCents, timestamp);
      commissionService?.reverseReturn(id,timestamp);
      const event = {
        eventId:idFactory('evt'), type:'return.completed', aggregate:'return', aggregateId:id, occurredAt:timestamp,
        actor, source:'server', mutationId:input.mutationId || null,
        payload:{ saleId, terminalId, cashSessionId:cashSession?.id||null, totalCents, authorizedById:authorizedBy.userId || null, items:normalizedItems.map(item=>({saleItemId:item.saleItemId,productId:item.productId,quantity:item.quantity,configuration:item.configuration||null,...(item.stockItems?{stockItems:item.stockItems}:{})})), refunds }
      };
      outbox.insert(event);
      writeAudit(db,{action:'return.complete',entity:'return',entityId:id,actor,context:{saleId,totalCents,cashSessionId:cashSession?.id||null,authorizedById:authorizedBy.userId || null,eventId:event.eventId}},now);
      return getReturn(id);
    });
  }

  function cancelReturn(id, { reason = '', actor = {}, mutationId = null } = {}) {
    assertManage(actor);
    const text = String(reason).trim();
    if (!text) throw new Error('Informe o motivo do cancelamento da devolucao.');
    return withTransaction(db, () => {
      const row = db.prepare("SELECT * FROM return_transactions WHERE id=? AND status='COMPLETED'").get(String(id));
      if (!row) throw new Error('Devolucao nao encontrada ou ja cancelada.');
      const payload = getCanonicalPayload(id) || { saleId:row.sale_id, terminalId:row.terminal_id, cashSessionId:row.cash_session_id||null, items:[], refunds:[] };
      const timestamp = now();
      db.prepare("UPDATE return_transactions SET status='CANCELLED',cancelled_at=? WHERE id=? AND status='COMPLETED'").run(timestamp,id);
      commissionService?.restoreReturn(id,timestamp);
      const event={eventId:idFactory('evt'),type:'return.cancelled',aggregate:'return',aggregateId:String(id),occurredAt:timestamp,actor,source:'server',mutationId,payload:{...payload,cashSessionId:row.cash_session_id||payload.cashSessionId||null,reason:text}};
      outbox.insert(event);
      writeAudit(db,{action:'return.cancel',entity:'return',entityId:String(id),actor,context:{reason:text,cashSessionId:row.cash_session_id||null,eventId:event.eventId}},now);
      return getReturn(id);
    });
  }

  return { createReturn, cancelReturn, getReturn, listReturns };
}

module.exports = { createReturnService };
