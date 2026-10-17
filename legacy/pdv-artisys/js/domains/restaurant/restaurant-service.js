'use strict';

const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { roundQuantity } = require('../inventory/inventory-rules');

const ACTIVE_SESSION_STATUSES = ['OPEN', 'CHECKOUT'];
const ORDER_SOURCES = new Set(['DESKTOP', 'WAITER', 'TABLE']);
const SERVICE_TYPES = new Set(['WAITER', 'BILL']);
const SERVICE_STATUSES = new Set(['OPEN', 'ACKNOWLEDGED', 'CLOSED']);

function createRestaurantService({ db, outbox, now = () => new Date().toISOString(), idFactory = prefix => `${prefix}-${randomUUID()}` } = {}) {
  if (!db || !outbox) throw new TypeError('Database and outbox are required.');

  function mapTable(row) {
    if (!row) return null;
    return {
      id: row.id,
      label: row.label,
      seats: row.seats,
      active: Boolean(row.active),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function getTable(id) {
    return mapTable(db.prepare('SELECT * FROM restaurant_tables WHERE id=?').get(String(id)));
  }

  function requireTable(id, { active = true } = {}) {
    const row = db.prepare('SELECT * FROM restaurant_tables WHERE id=?').get(String(id));
    if (!row) throw new Error('Mesa nao encontrada.');
    if (active && !row.active) throw new Error('Mesa inativa.');
    return row;
  }

  function requireActiveWaiter(id) {
    if (id == null || String(id).trim() === '') return null;
    const user = db.prepare('SELECT id,name,active FROM users WHERE id=?').get(String(id));
    if (!user || !user.active) throw new Error('Garcom responsavel nao encontrado ou inativo.');
    return user;
  }

  function requireActiveCustomer(id) {
    if (id == null || String(id).trim() === '') return null;
    const customer = db.prepare('SELECT id,name,active FROM customers WHERE id=?').get(String(id));
    if (!customer || !customer.active) throw new Error('Cliente nao encontrado ou inativo.');
    return customer;
  }

  function normalizePartySize(value) {
    if (value == null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) throw new Error('Quantidade de pessoas deve ser um inteiro entre 1 e 50.');
    return parsed;
  }

  function productionSummary(sessionId) {
    if (!sessionId) return { productionStatus:null, readyItems:0, preparingItems:0, newItems:0 };
    const rows = db.prepare(`SELECT t.status,SUM(i.quantity) AS quantity
      FROM kitchen_tickets t
      JOIN kitchen_ticket_items i ON i.ticket_id=t.id
      JOIN restaurant_orders o ON o.id=t.order_id
      WHERE o.table_session_id=? AND t.status<>'CANCELLED' AND o.status<>'CANCELLED'
      GROUP BY t.status`).all(String(sessionId));
    const counts = Object.fromEntries(rows.map(row=>[row.status,Number(row.quantity||0)]));
    const readyItems=counts.READY||0,preparingItems=counts.PREPARING||0,newItems=counts.NEW||0;
    const productionStatus=preparingItems>0?'PREPARING':newItems>0?'NEW':readyItems>0?'READY':null;
    return { productionStatus, readyItems, preparingItems, newItems };
  }

  function activeSessionRow(tableId) {
    return db.prepare("SELECT * FROM table_sessions WHERE table_id=? AND status IN ('OPEN','CHECKOUT') ORDER BY opened_at DESC LIMIT 1").get(String(tableId));
  }

  function mapOrder(row) {
    if (!row) return null;
    const items = db.prepare(`SELECT id,product_id AS productId,product_name AS productName,quantity,unit_price_cents AS unitPriceCents,total_cents AS totalCents,note,created_at AS createdAt
      FROM restaurant_order_items WHERE order_id=? ORDER BY created_at,id`).all(row.id);
    return {
      id: row.id,
      tableSessionId: row.table_session_id,
      source: row.source,
      deviceId: row.device_id,
      createdBy: row.created_by,
      status: row.status,
      note: row.note,
      totalCents: row.total_cents,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items
    };
  }

  function getOrder(id) {
    return mapOrder(db.prepare('SELECT * FROM restaurant_orders WHERE id=?').get(String(id)));
  }

  function listOrders(sessionId) {
    return db.prepare('SELECT * FROM restaurant_orders WHERE table_session_id=? ORDER BY created_at,id').all(String(sessionId)).map(mapOrder);
  }

  function mapRequest(row) {
    if (!row) return null;
    return {
      id: row.id,
      tableSessionId: row.table_session_id,
      tableId: row.table_id,
      tableLabel: row.table_label,
      requestType: row.request_type,
      status: row.status,
      deviceId: row.device_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function listRequestsForSession(sessionId) {
    return db.prepare(`SELECT r.*,s.table_id,t.label AS table_label
      FROM service_requests r
      JOIN table_sessions s ON s.id=r.table_session_id
      JOIN restaurant_tables t ON t.id=s.table_id
      WHERE r.table_session_id=? ORDER BY r.created_at DESC,r.id DESC`).all(String(sessionId)).map(mapRequest);
  }

  function mapSession(row) {
    if (!row) return null;
    const orders = listOrders(row.id);
    const totalCents = orders.filter(order => order.status !== 'CANCELLED').reduce((sum, order) => sum + Number(order.totalCents || 0), 0);
    return {
      id: row.id,
      tableId: row.table_id,
      tableLabel: row.table_label || getTable(row.table_id)?.label || row.table_id,
      status: row.status,
      openedBy: row.opened_by,
      waiterId: row.waiter_id || null,
      partySize: row.party_size == null ? null : Number(row.party_size),
      customerId: row.customer_id || null,
      customerName: row.customer_id ? db.prepare('SELECT name FROM customers WHERE id=?').get(row.customer_id)?.name || null : null,
      checkoutSaleId: row.checkout_sale_id,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      updatedAt: row.updated_at,
      totalCents,
      orders,
      serviceRequests: listRequestsForSession(row.id)
    };
  }

  function getSession(id) {
    return mapSession(db.prepare(`SELECT s.*,t.label AS table_label FROM table_sessions s JOIN restaurant_tables t ON t.id=s.table_id WHERE s.id=?`).get(String(id)));
  }

  function currentSession(tableId) {
    const row = db.prepare(`SELECT s.*,t.label AS table_label FROM table_sessions s JOIN restaurant_tables t ON t.id=s.table_id
      WHERE s.table_id=? AND s.status IN ('OPEN','CHECKOUT') ORDER BY s.opened_at DESC LIMIT 1`).get(String(tableId));
    return mapSession(row);
  }

  function listTables({ includeInactive = false } = {}) {
    const rows = db.prepare(`SELECT * FROM restaurant_tables ${includeInactive ? '' : 'WHERE active=1 '}ORDER BY sort_order,label,id`).all();
    return rows.map(row => {
      const table = mapTable(row);
      const session = currentSession(row.id);
      const billRequested = session?.serviceRequests?.some(request => request.requestType === 'BILL' && request.status !== 'CLOSED');
      return {
        ...table,
        status: !session ? 'FREE' : billRequested ? 'BILL_REQUESTED' : session.status === 'CHECKOUT' ? 'CHECKOUT' : 'OCCUPIED',
        sessionId: session?.id || null,
        waiterId: session?.waiterId || null,
        partySize: session?.partySize || null,
        customerId: session?.customerId || null,
        customerName: session?.customerName || null,
        totalCents: session?.totalCents || 0,
        openedAt: session?.openedAt || null,
        ...productionSummary(session?.id)
      };
    });
  }

  function upsertTable(input = {}, actor = {}) {
    const id = String(input.id || idFactory('table')).trim();
    const label = String(input.label || '').trim();
    if (!label) throw new Error('Nome ou numero da mesa e obrigatorio.');
    const seats = Math.max(0, Math.min(50, Math.trunc(Number(input.seats) || 0)));
    const active = input.active === false ? 0 : 1;
    const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 0;
    const timestamp = now();
    db.prepare(`INSERT INTO restaurant_tables(id,label,seats,active,sort_order,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET label=excluded.label,seats=excluded.seats,active=excluded.active,sort_order=excluded.sort_order,updated_at=excluded.updated_at`)
      .run(id, label, seats, active, sortOrder, timestamp, timestamp);
    writeAudit(db, { action:'restaurant.table.upsert', entity:'restaurant_table', entityId:id, actor, context:{ label, seats, active:Boolean(active) } }, now);
    return getTable(id);
  }

  function insertEvent({ type, aggregate, aggregateId, actor = {}, mutationId = null, payload = {} }) {
    const event = {
      eventId: idFactory('evt'),
      type,
      aggregate,
      aggregateId,
      occurredAt: now(),
      actor: actor && typeof actor === 'object' ? actor : {},
      source: 'server',
      mutationId,
      payload
    };
    outbox.insert(event);
    return event;
  }

  function openTable(tableId, { operatorId = null, waiterId = null, partySize = null, customerId = null, actor = {}, mutationId = null } = {}) {
    return withTransaction(db, () => {
      const table = requireTable(tableId);
      const existing = activeSessionRow(table.id);
      if (existing) return getSession(existing.id);
      const waiter = requireActiveWaiter(waiterId);
      const customer = requireActiveCustomer(customerId);
      const normalizedPartySize = normalizePartySize(partySize);
      const id = idFactory('table-session');
      const timestamp = now();
      db.prepare(`INSERT INTO table_sessions(id,table_id,status,opened_by,waiter_id,party_size,customer_id,opened_at,updated_at) VALUES(?,?,'OPEN',?,?,?,?,?,?)`)
        .run(id, table.id, operatorId || null, waiter?.id || null, normalizedPartySize, customer?.id || null, timestamp, timestamp);
      const event = insertEvent({
        type:'restaurant.table-opened', aggregate:'table-session', aggregateId:id, actor, mutationId,
        payload:{ tableId:table.id, tableLabel:table.label, operatorId:operatorId || null, waiterId:waiter?.id || null, partySize:normalizedPartySize, customerId:customer?.id || null }
      });
      writeAudit(db, { action:'restaurant.table.open', entity:'table_session', entityId:id, actor, context:{ tableId:table.id, waiterId:waiter?.id || null, partySize:normalizedPartySize, customerId:customer?.id || null, eventId:event.eventId } }, now);
      return getSession(id);
    });
  }

  function updateSessionDetails(sessionId, input = {}, actor = {}) {
    return withTransaction(db, () => {
      const session = db.prepare("SELECT * FROM table_sessions WHERE id=? AND status IN ('OPEN','CHECKOUT')").get(String(sessionId));
      if (!session) throw new Error('Comanda ativa nao encontrada.');
      const partySize = Object.prototype.hasOwnProperty.call(input,'partySize') ? normalizePartySize(input.partySize) : session.party_size;
      const customer = Object.prototype.hasOwnProperty.call(input,'customerId') ? requireActiveCustomer(input.customerId) : (session.customer_id ? requireActiveCustomer(session.customer_id) : null);
      db.prepare('UPDATE table_sessions SET party_size=?,customer_id=?,updated_at=? WHERE id=?').run(partySize, customer?.id || null, now(), session.id);
      writeAudit(db, { action:'restaurant.session.details', entity:'table_session', entityId:session.id, actor, context:{ partySize, customerId:customer?.id || null } }, now);
      return getSession(session.id);
    });
  }

  function assignWaiter(sessionId, waiterId, actor = {}) {
    return withTransaction(db, () => {
      const session = db.prepare("SELECT * FROM table_sessions WHERE id=? AND status IN ('OPEN','CHECKOUT')").get(String(sessionId));
      if (!session) throw new Error('Comanda ativa nao encontrada.');
      const waiter = requireActiveWaiter(waiterId);
      db.prepare('UPDATE table_sessions SET waiter_id=?,updated_at=? WHERE id=?').run(waiter?.id || null, now(), session.id);
      writeAudit(db, { action:'restaurant.waiter.assign', entity:'table_session', entityId:session.id, actor, context:{ waiterId:waiter?.id || null } }, now);
      return getSession(session.id);
    });
  }

  function addOrder(sessionId, { items = [], source = 'DESKTOP', deviceId = null, note = '', actor = {}, mutationId = null } = {}) {
    return withTransaction(db, () => {
      const session = db.prepare("SELECT * FROM table_sessions WHERE id=? AND status='OPEN'").get(String(sessionId));
      if (!session) throw new Error('Comanda nao encontrada ou nao esta aberta para novos pedidos.');
      const normalizedSource = String(source || 'DESKTOP').toUpperCase();
      if (!ORDER_SOURCES.has(normalizedSource)) throw new Error('Origem do pedido invalida.');
      if (!Array.isArray(items) || !items.length) throw new Error('Adicione pelo menos um item ao pedido.');
      if (items.length > 100) throw new Error('Pedido excede o limite de itens.');
      const prepared = items.map(item => {
        const product = db.prepare('SELECT id,name,sale_price_cents AS salePriceCents,active FROM products WHERE id=?').get(String(item.productId || ''));
        if (!product || !product.active) throw new Error('Produto nao encontrado ou inativo.');
        const quantity = roundQuantity(item.quantity ?? 1);
        if (quantity <= 0) throw new Error('Quantidade deve ser maior que zero.');
        const unitPriceCents = Math.max(0, Math.trunc(Number(product.salePriceCents) || 0));
        return {
          productId:product.id,
          productName:product.name,
          quantity,
          unitPriceCents,
          totalCents:Math.round(unitPriceCents * quantity),
          note:String(item.note || '').trim().slice(0, 500) || null
        };
      });
      const totalCents = prepared.reduce((sum, item) => sum + item.totalCents, 0);
      const id = idFactory('order');
      const timestamp = now();
      db.prepare(`INSERT INTO restaurant_orders(id,table_session_id,source,device_id,created_by,status,note,total_cents,created_at,updated_at)
        VALUES(?,?,?,?,?,'NEW',?,?,?,?)`)
        .run(id, session.id, normalizedSource, deviceId || null, normalizedSource === 'TABLE' ? null : (actor?.userId || null), String(note || '').trim().slice(0,1000) || null, totalCents, timestamp, timestamp);
      const insert = db.prepare(`INSERT INTO restaurant_order_items(id,order_id,product_id,product_name,quantity,unit_price_cents,total_cents,note,created_at)
        VALUES(?,?,?,?,?,?,?,?,?)`);
      for (const item of prepared) insert.run(idFactory('order-item'), id, item.productId, item.productName, item.quantity, item.unitPriceCents, item.totalCents, item.note, timestamp);
      const event = insertEvent({
        type:'restaurant.order-created', aggregate:'restaurant-order', aggregateId:id, actor, mutationId,
        payload:{ tableSessionId:session.id, tableId:session.table_id, source:normalizedSource, deviceId:deviceId || null, totalCents, itemCount:prepared.length }
      });
      writeAudit(db, { action:'restaurant.order.create', entity:'restaurant_order', entityId:id, actor, context:{ tableSessionId:session.id, totalCents, eventId:event.eventId } }, now);
      return getOrder(id);
    });
  }

  function requestService(tableId, requestType, { deviceId = null, actor = {}, mutationId = null } = {}) {
    return withTransaction(db, () => {
      const type = String(requestType || '').toUpperCase();
      if (!SERVICE_TYPES.has(type)) throw new Error('Tipo de solicitacao invalido.');
      const table = requireTable(tableId);
      const session = activeSessionRow(table.id);
      if (!session) throw new Error('Mesa sem comanda aberta.');
      const existing = db.prepare(`SELECT r.*,s.table_id,t.label AS table_label FROM service_requests r
        JOIN table_sessions s ON s.id=r.table_session_id JOIN restaurant_tables t ON t.id=s.table_id
        WHERE r.table_session_id=? AND r.request_type=? AND r.status IN ('OPEN','ACKNOWLEDGED') ORDER BY r.created_at DESC LIMIT 1`).get(session.id, type);
      if (existing) return mapRequest(existing);
      const id = idFactory('service-request');
      const timestamp = now();
      db.prepare(`INSERT INTO service_requests(id,table_session_id,request_type,status,device_id,created_at,updated_at) VALUES(?,?,?,'OPEN',?,?,?)`)
        .run(id, session.id, type, deviceId || null, timestamp, timestamp);
      const eventType = type === 'BILL' ? 'restaurant.bill-requested' : 'restaurant.waiter-called';
      insertEvent({ type:eventType, aggregate:'service-request', aggregateId:id, actor, mutationId, payload:{ tableId:table.id, tableLabel:table.label, tableSessionId:session.id, deviceId:deviceId || null } });
      return mapRequest(db.prepare(`SELECT r.*,s.table_id,t.label AS table_label FROM service_requests r JOIN table_sessions s ON s.id=r.table_session_id JOIN restaurant_tables t ON t.id=s.table_id WHERE r.id=?`).get(id));
    });
  }

  function listServiceRequests({ status = null, requestType = null } = {}) {
    const clauses=[]; const params=[];
    if (status) { const value=String(status).toUpperCase(); if(!SERVICE_STATUSES.has(value)) throw new Error('Status de solicitacao invalido.'); clauses.push('r.status=?');params.push(value); }
    if (requestType) { const value=String(requestType).toUpperCase(); if(!SERVICE_TYPES.has(value)) throw new Error('Tipo de solicitacao invalido.'); clauses.push('r.request_type=?');params.push(value); }
    return db.prepare(`SELECT r.*,s.table_id,t.label AS table_label FROM service_requests r JOIN table_sessions s ON s.id=r.table_session_id JOIN restaurant_tables t ON t.id=s.table_id${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY r.created_at DESC,r.id DESC`).all(...params).map(mapRequest);
  }

  function updateServiceRequest(id, status, actor = {}) {
    const normalized = String(status || '').toUpperCase();
    if (!SERVICE_STATUSES.has(normalized)) throw new Error('Status de solicitacao invalido.');
    const result = db.prepare('UPDATE service_requests SET status=?,updated_at=? WHERE id=?').run(normalized, now(), String(id));
    if (!result.changes) throw new Error('Solicitacao nao encontrada.');
    writeAudit(db, { action:'restaurant.request.update', entity:'service_request', entityId:String(id), actor, context:{ status:normalized } }, now);
    return mapRequest(db.prepare(`SELECT r.*,s.table_id,t.label AS table_label FROM service_requests r JOIN table_sessions s ON s.id=r.table_session_id JOIN restaurant_tables t ON t.id=s.table_id WHERE r.id=?`).get(String(id)));
  }

  function transferTable(sessionId, targetTableId, { actor = {}, mutationId = null } = {}) {
    return withTransaction(db, () => {
      const session = db.prepare("SELECT * FROM table_sessions WHERE id=? AND status IN ('OPEN','CHECKOUT')").get(String(sessionId));
      if (!session) throw new Error('Comanda ativa nao encontrada.');
      const target = requireTable(targetTableId);
      if (session.table_id === target.id) return getSession(session.id);
      if (activeSessionRow(target.id)) throw new Error('Mesa de destino ja esta ocupada.');
      const sourceId = session.table_id;
      db.prepare('UPDATE table_sessions SET table_id=?,updated_at=? WHERE id=?').run(target.id, now(), session.id);
      insertEvent({ type:'restaurant.table-transferred', aggregate:'table-session', aggregateId:session.id, actor, mutationId, payload:{ fromTableId:sourceId, toTableId:target.id } });
      writeAudit(db, { action:'restaurant.table.transfer', entity:'table_session', entityId:session.id, actor, context:{ fromTableId:sourceId, toTableId:target.id } }, now);
      return getSession(session.id);
    });
  }

  function checkoutToSale(sessionId, { terminalId, operatorId, actor = {}, mutationId = null } = {}, saleService) {
    if (!saleService) throw new TypeError('Sale service is required.');
    return withTransaction(db, () => {
      const row = db.prepare("SELECT * FROM table_sessions WHERE id=? AND status IN ('OPEN','CHECKOUT')").get(String(sessionId));
      if (!row) throw new Error('Comanda ativa nao encontrada.');
      if (row.checkout_sale_id) {
        const existing = saleService.getSale(row.checkout_sale_id);
        if (existing) return { session:getSession(row.id), sale:existing };
      }
      const activeOrders = db.prepare("SELECT id FROM restaurant_orders WHERE table_session_id=? AND status<>'CANCELLED'").all(row.id);
      if (!activeOrders.length) throw new Error('Comanda sem pedidos para fechamento.');
      const aggregate = db.prepare(`SELECT i.product_id AS productId,SUM(i.quantity) AS quantity
        FROM restaurant_order_items i JOIN restaurant_orders o ON o.id=i.order_id
        WHERE o.table_session_id=? AND o.status<>'CANCELLED' GROUP BY i.product_id`).all(row.id);
      const sale = saleService.openSale({ terminalId, operatorId }, actor);
      if (row.customer_id) saleService.setCustomer(sale.id, row.customer_id);
      for (const item of aggregate) saleService.addItem(sale.id, { productId:item.productId, quantity:item.quantity });
      db.prepare("UPDATE table_sessions SET status='CHECKOUT',checkout_sale_id=?,updated_at=? WHERE id=?").run(sale.id, now(), row.id);
      writeAudit(db, { action:'restaurant.table.checkout', entity:'table_session', entityId:row.id, actor, context:{ saleId:sale.id, mutationId } }, now);
      return { session:getSession(row.id), sale:saleService.getSale(sale.id) };
    });
  }

  function finalizeCompletedSale(saleId, { actor = {} } = {}) {
    return withTransaction(db, () => {
      const row = db.prepare("SELECT * FROM table_sessions WHERE checkout_sale_id=? AND status='CHECKOUT'").get(String(saleId));
      if (!row) return null;
      const timestamp = now();
      db.prepare("UPDATE table_sessions SET status='CLOSED',closed_at=?,updated_at=? WHERE id=?").run(timestamp, timestamp, row.id);
      db.prepare("UPDATE service_requests SET status='CLOSED',updated_at=? WHERE table_session_id=? AND status<>'CLOSED'").run(timestamp, row.id);
      insertEvent({ type:'restaurant.table-closed', aggregate:'table-session', aggregateId:row.id, actor, payload:{ tableId:row.table_id, saleId:String(saleId) } });
      return getSession(row.id);
    });
  }

  function reopenCancelledCheckout(saleId, { actor = {} } = {}) {
    return withTransaction(db, () => {
      const row = db.prepare("SELECT * FROM table_sessions WHERE checkout_sale_id=? AND status='CHECKOUT'").get(String(saleId));
      if (!row) return null;
      db.prepare("UPDATE table_sessions SET status='OPEN',checkout_sale_id=NULL,updated_at=? WHERE id=?").run(now(), row.id);
      writeAudit(db, { action:'restaurant.table.checkout-reopen', entity:'table_session', entityId:row.id, actor, context:{ saleId:String(saleId) } }, now);
      return getSession(row.id);
    });
  }

  return {
    upsertTable,
    getTable,
    listTables,
    openTable,
    updateSessionDetails,
    assignWaiter,
    getSession,
    currentSession,
    addOrder,
    getOrder,
    requestService,
    listServiceRequests,
    updateServiceRequest,
    transferTable,
    checkoutToSale,
    finalizeCompletedSale,
    reopenCancelledCheckout,
    ACTIVE_SESSION_STATUSES
  };
}

module.exports = { createRestaurantService };
