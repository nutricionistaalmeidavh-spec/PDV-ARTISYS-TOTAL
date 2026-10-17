'use strict';

const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');

const TICKET_STATUSES = new Set(['NEW','PREPARING','READY','CANCELLED']);
const PRODUCTION_SOURCES = new Set(['DELIVERY','FAST_FOOD']);
const PRODUCT_ROUTE_MODES = new Set(['DIRECT','PRODUCTION']);

function parseConfiguration(value) {
  if (!value) return null;
  try { return JSON.parse(value); }
  catch { return null; }
}

function createKitchenService({ db, now = () => new Date().toISOString(), idFactory = prefix => `${prefix}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');

  function mapStation(row) {
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      printerName: row.printer_name,
      printEnabled: Boolean(row.print_enabled),
      active: Boolean(row.active),
      sortOrder: row.sort_order,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function mapRestaurantTicket(row) {
    if (!row) return null;
    const items = db.prepare(`SELECT kti.id,kti.order_item_id AS orderItemId,kti.product_name AS productName,kti.quantity,kti.note,
        roi.configuration_json AS configurationJson
      FROM kitchen_ticket_items kti
      LEFT JOIN restaurant_order_items roi ON roi.id=kti.order_item_id
      WHERE kti.ticket_id=? ORDER BY kti.id`).all(row.id).map(item => {
        const { configurationJson, ...safe } = item;
        return { ...safe, configuration: parseConfiguration(configurationJson) };
      });
    return {
      id: row.id,
      sourceType: 'RESTAURANT',
      sourceId: row.order_id,
      orderId: row.order_id,
      stationId: row.station_id,
      stationName: row.station_name,
      printerName: row.printer_name,
      printEnabled: Boolean(row.print_enabled),
      tableSessionId: row.table_session_id,
      tableLabel: row.table_label,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items
    };
  }

  function productionSourceLabel(row) {
    if(row.source_type!=='DELIVERY')return 'Balcão';
    const order=db.prepare('SELECT channel,fulfillment_type,ticket_number FROM delivery_orders WHERE id=?').get(row.source_id);
    const channel=order?.channel||order?.fulfillment_type;
    const label=channel==='COUNTER'?'Balcão':channel==='PICKUP'?'Retirada':'Entrega';
    return order?.ticket_number?`${label} · Senha ${order.ticket_number}`:label;
  }

  function mapProductionTicket(row) {
    if (!row) return null;
    const items = db.prepare(`SELECT id,product_id AS productId,product_name AS productName,quantity,configuration_json AS configurationJson,note
      FROM production_ticket_items WHERE ticket_id=? ORDER BY id`).all(row.id).map(item => {
      const { configurationJson, ...safe } = item;
      return { ...safe, configuration: parseConfiguration(configurationJson) };
    });
    return {
      id: row.id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      orderId: null,
      stationId: row.station_id,
      stationName: row.station_name,
      printerName: row.printer_name,
      printEnabled: Boolean(row.print_enabled),
      tableSessionId: null,
      tableLabel: productionSourceLabel(row),
      status: row.status,
      note: row.note,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      items
    };
  }

  function stationSelect(where = '') {
    return `SELECT * FROM kitchen_stations ${where}`;
  }

  function restaurantTicketSelect(where = '') {
    return `SELECT kt.*,ks.name AS station_name,ks.printer_name,ks.print_enabled,o.table_session_id,t.label AS table_label
      FROM kitchen_tickets kt
      JOIN kitchen_stations ks ON ks.id=kt.station_id
      JOIN restaurant_orders o ON o.id=kt.order_id
      JOIN table_sessions ts ON ts.id=o.table_session_id
      JOIN restaurant_tables t ON t.id=ts.table_id ${where}`;
  }

  function productionTicketSelect(where = '') {
    return `SELECT pt.*,ks.name AS station_name,ks.printer_name,ks.print_enabled
      FROM production_tickets pt
      JOIN kitchen_stations ks ON ks.id=pt.station_id ${where}`;
  }

  function getStation(id) {
    return mapStation(db.prepare(stationSelect('WHERE id=?')).get(String(id)));
  }

  function upsertStation(input = {}, actor = {}) {
    const id = String(input.id || idFactory('station')).trim();
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Nome do setor de producao obrigatorio.');
    const printerName = String(input.printerName || '').trim() || null;
    const printEnabled = input.printEnabled === false ? 0 : 1;
    const active = input.active === false ? 0 : 1;
    const sortOrder = Number.isFinite(Number(input.sortOrder)) ? Math.trunc(Number(input.sortOrder)) : 0;
    const timestamp = now();
    db.prepare(`INSERT INTO kitchen_stations(id,name,printer_name,print_enabled,active,sort_order,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,printer_name=excluded.printer_name,print_enabled=excluded.print_enabled,
        active=excluded.active,sort_order=excluded.sort_order,updated_at=excluded.updated_at`)
      .run(id,name,printerName,printEnabled,active,sortOrder,timestamp,timestamp);
    writeAudit(db,{action:'restaurant.kitchen.station.upsert',entity:'kitchen_station',entityId:id,actor,context:{name,printerName,printEnabled:Boolean(printEnabled),active:Boolean(active)}},now);
    return getStation(id);
  }

  function listStations({ includeInactive = false } = {}) {
    return db.prepare(`${stationSelect(includeInactive ? '' : 'WHERE active=1')} ORDER BY sort_order,name,id`).all().map(mapStation);
  }

  function getProductRoute(productId) {
    const row=db.prepare(`SELECT p.id AS productId,p.name AS productName,r.mode,r.station_id AS stationId,ks.name AS stationName,ks.active AS stationActive
      FROM products p
      LEFT JOIN restaurant_product_routes r ON r.product_id=p.id
      LEFT JOIN kitchen_stations ks ON ks.id=r.station_id
      WHERE p.id=? AND p.active=1`).get(String(productId));
    if(!row||!row.mode)return null;
    const route={
      productId:row.productId,
      productName:row.productName,
      mode:row.mode,
      stationId:row.stationId||null,
      stationName:row.stationName||null
    };
    if(row.mode==='PRODUCTION')route.stationActive=Boolean(row.stationActive);
    return route;
  }

  function listProductRoutes() {
    return db.prepare(`SELECT p.id AS productId,p.name AS productName,r.mode,r.station_id AS stationId,ks.name AS stationName,ks.active AS stationActive
      FROM products p
      LEFT JOIN restaurant_product_routes r ON r.product_id=p.id
      LEFT JOIN kitchen_stations ks ON ks.id=r.station_id
      WHERE p.active=1 AND p.menu_enabled=1
      ORDER BY p.name,p.id`).all().map(row=>({
        productId:row.productId,
        productName:row.productName,
        mode:row.mode||null,
        stationId:row.stationId||null,
        stationName:row.stationName||null,
        stationActive:row.mode==='PRODUCTION'?Boolean(row.stationActive):null
      }));
  }

  function configureProductRoute(productId,{mode,stationId=null}={},actor={}) {
    const product=db.prepare('SELECT id,name FROM products WHERE id=? AND active=1').get(String(productId));
    if(!product)throw new Error('Produto nao encontrado ou inativo.');
    const normalized=String(mode||'').trim().toUpperCase();
    if(!PRODUCT_ROUTE_MODES.has(normalized))throw new Error('Destino do produto invalido.');
    return withTransaction(db,()=>{
      let station=null;
      if(normalized==='PRODUCTION'){
        station=db.prepare('SELECT id,name FROM kitchen_stations WHERE id=? AND active=1').get(String(stationId||''));
        if(!station)throw new Error('Setor de producao nao encontrado ou inativo.');
        db.prepare(`INSERT INTO product_kitchen_stations(product_id,station_id,updated_at) VALUES(?,?,?)
          ON CONFLICT(product_id) DO UPDATE SET station_id=excluded.station_id,updated_at=excluded.updated_at`)
          .run(product.id,station.id,now());
      }else{
        db.prepare('DELETE FROM product_kitchen_stations WHERE product_id=?').run(product.id);
      }
      db.prepare(`INSERT INTO restaurant_product_routes(product_id,mode,station_id,updated_at) VALUES(?,?,?,?)
        ON CONFLICT(product_id) DO UPDATE SET mode=excluded.mode,station_id=excluded.station_id,updated_at=excluded.updated_at`)
        .run(product.id,normalized,station?.id||null,now());
      writeAudit(db,{action:'restaurant.kitchen.product.route',entity:'product',entityId:product.id,actor,context:{mode:normalized,stationId:station?.id||null,stationName:station?.name||null}},now);
      const route=getProductRoute(product.id);
      if(route&&route.mode==='PRODUCTION')delete route.stationActive;
      return route;
    });
  }

  function assertOrderRouting(items=[]) {
    const productIds=[...new Set((Array.isArray(items)?items:[]).map(item=>String(item.productId||'').trim()).filter(Boolean))];
    for(const productId of productIds){
      const route=getProductRoute(productId);
      const name=route?.productName||db.prepare('SELECT name FROM products WHERE id=?').get(productId)?.name||productId;
      if(!route)throw new Error(`O produto "${name}" não tem destino de pedido. Configure no Estoque: Sem KDS ou Produção.`);
      if(route.mode==='PRODUCTION'&&!route.stationActive)throw new Error(`O setor de produção do produto "${name}" está inativo. Configure outro setor no Estoque.`);
    }
    return true;
  }

  function assignProduct(productId, stationId, actor = {}) {
    return configureProductRoute(productId,{mode:'PRODUCTION',stationId},actor);
  }

  function unassignProduct(productId, actor = {}) {
    return withTransaction(db,()=>{
      const assignment=db.prepare('DELETE FROM product_kitchen_stations WHERE product_id=?').run(String(productId));
      const route=db.prepare('DELETE FROM restaurant_product_routes WHERE product_id=?').run(String(productId));
      if(assignment.changes||route.changes)writeAudit(db,{action:'restaurant.kitchen.product.unassign',entity:'product',entityId:String(productId),actor,context:{}},now);
      return { productId:String(productId), removed:Boolean(assignment.changes||route.changes) };
    });
  }

  function listAssignments() {
    return db.prepare(`SELECT p.id AS productId,p.name AS productName,ks.id AS stationId,ks.name AS stationName,ks.printer_name AS printerName,ks.print_enabled AS printEnabled
      FROM product_kitchen_stations pks JOIN products p ON p.id=pks.product_id JOIN kitchen_stations ks ON ks.id=pks.station_id
      ORDER BY p.name,p.id`).all().map(row => ({...row,printEnabled:Boolean(row.printEnabled)}));
  }

  function getRestaurantTicket(id) {
    return mapRestaurantTicket(db.prepare(restaurantTicketSelect('WHERE kt.id=?')).get(String(id)));
  }

  function getProductionTicket(id) {
    return mapProductionTicket(db.prepare(productionTicketSelect('WHERE pt.id=?')).get(String(id)));
  }

  function getTicket(id) {
    return getRestaurantTicket(id) || getProductionTicket(id);
  }

  function routeOrder(orderId) {
    const order = db.prepare("SELECT id,status FROM restaurant_orders WHERE id=? AND status<>'CANCELLED'").get(String(orderId));
    if (!order) throw new Error('Pedido nao encontrado ou cancelado.');
    const routed = db.prepare(`SELECT i.id AS orderItemId,i.product_name AS productName,i.quantity,i.note,ks.id AS stationId
      FROM restaurant_order_items i
      JOIN product_kitchen_stations pks ON pks.product_id=i.product_id
      JOIN kitchen_stations ks ON ks.id=pks.station_id AND ks.active=1
      WHERE i.order_id=? ORDER BY ks.sort_order,ks.name,i.id`).all(order.id);
    if (!routed.length) return [];

    return withTransaction(db, () => {
      const stationIds = [...new Set(routed.map(item => item.stationId))];
      const tickets = [];
      for (const stationId of stationIds) {
        let ticket = db.prepare('SELECT id FROM kitchen_tickets WHERE order_id=? AND station_id=?').get(order.id,stationId);
        if (!ticket) {
          const id = idFactory('kitchen-ticket');
          const timestamp = now();
          db.prepare(`INSERT INTO kitchen_tickets(id,order_id,station_id,status,created_at,updated_at) VALUES(?,?,?,'NEW',?,?)`)
            .run(id,order.id,stationId,timestamp,timestamp);
          const insert = db.prepare(`INSERT INTO kitchen_ticket_items(id,ticket_id,order_item_id,product_name,quantity,note) VALUES(?,?,?,?,?,?)`);
          for (const item of routed.filter(entry => entry.stationId === stationId)) {
            insert.run(idFactory('kitchen-item'),id,item.orderItemId,item.productName,item.quantity,item.note || null);
          }
          ticket = { id };
        }
        tickets.push(getRestaurantTicket(ticket.id));
      }
      return tickets;
    });
  }

  function routeProduction({ sourceType, sourceId, items = [], note = '' } = {}) {
    const normalizedSource = String(sourceType || '').trim().toUpperCase();
    const normalizedSourceId = String(sourceId || '').trim();
    if (!PRODUCTION_SOURCES.has(normalizedSource)) throw new Error('Origem de producao invalida.');
    if (!normalizedSourceId) throw new Error('Identificador da origem de producao obrigatorio.');
    if (!Array.isArray(items) || !items.length) return [];

    const routed = [];
    for (const input of items) {
      const productId = String(input.productId || '').trim();
      if (!productId) continue;
      const row = db.prepare(`SELECT p.id AS productId,p.name AS productName,ks.id AS stationId,ks.sort_order AS stationSort,ks.name AS stationName
        FROM products p
        JOIN product_kitchen_stations pks ON pks.product_id=p.id
        JOIN kitchen_stations ks ON ks.id=pks.station_id AND ks.active=1
        WHERE p.id=? AND p.active=1`).get(productId);
      if (!row) continue;
      const quantity = Number(input.quantity || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('Quantidade de producao invalida.');
      routed.push({
        ...row,
        quantity,
        configuration: input.configuration || input.configurationSnapshot || null,
        note: String(input.note || '').trim() || null
      });
    }
    if (!routed.length) return [];

    return withTransaction(db, () => {
      const stationIds = [...new Set(routed.sort((a,b)=>a.stationSort-b.stationSort||a.stationName.localeCompare(b.stationName)).map(item => item.stationId))];
      const tickets = [];
      for (const stationId of stationIds) {
        let ticket = db.prepare('SELECT id FROM production_tickets WHERE source_type=? AND source_id=? AND station_id=?').get(normalizedSource,normalizedSourceId,stationId);
        if (!ticket) {
          const id = idFactory('production-ticket');
          const timestamp = now();
          db.prepare(`INSERT INTO production_tickets(id,source_type,source_id,station_id,status,note,created_at,updated_at)
            VALUES(?,?,?,?, 'NEW',?,?,?)`).run(id,normalizedSource,normalizedSourceId,stationId,String(note||'').trim()||null,timestamp,timestamp);
          const insert = db.prepare(`INSERT INTO production_ticket_items(id,ticket_id,product_id,product_name,quantity,configuration_json,note)
            VALUES(?,?,?,?,?,?,?)`);
          for (const item of routed.filter(entry => entry.stationId === stationId)) {
            insert.run(idFactory('production-item'),id,item.productId,item.productName,item.quantity,item.configuration?JSON.stringify(item.configuration):null,item.note);
          }
          ticket = { id };
        }
        tickets.push(getProductionTicket(ticket.id));
      }
      return tickets;
    });
  }

  function listTickets({ status = null, stationId = null, limit = 200 } = {}) {
    const normalizedStatus=status?String(status).toUpperCase():null;
    if (normalizedStatus && !TICKET_STATUSES.has(normalizedStatus)) throw new Error('Status de cozinha invalido.');
    const safeLimit=Math.min(Math.max(Number(limit)||200,1),500);

    const restaurantClauses=[];const restaurantParams=[];
    const productionClauses=[];const productionParams=[];
    if(normalizedStatus){restaurantClauses.push('kt.status=?');restaurantParams.push(normalizedStatus);productionClauses.push('pt.status=?');productionParams.push(normalizedStatus);}
    if(stationId){restaurantClauses.push('kt.station_id=?');restaurantParams.push(String(stationId));productionClauses.push('pt.station_id=?');productionParams.push(String(stationId));}
    restaurantParams.push(safeLimit);productionParams.push(safeLimit);
    const restaurant=db.prepare(`${restaurantTicketSelect(restaurantClauses.length?`WHERE ${restaurantClauses.join(' AND ')}`:'')} ORDER BY kt.created_at,kt.id LIMIT ?`).all(...restaurantParams).map(mapRestaurantTicket);
    const production=db.prepare(`${productionTicketSelect(productionClauses.length?`WHERE ${productionClauses.join(' AND ')}`:'')} ORDER BY pt.created_at,pt.id LIMIT ?`).all(...productionParams).map(mapProductionTicket);
    return restaurant.concat(production).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))||String(a.id).localeCompare(String(b.id))).slice(0,safeLimit);
  }

  function syncOrderStatus(orderId) {
    const rows=db.prepare('SELECT status,COUNT(*) AS count FROM kitchen_tickets WHERE order_id=? GROUP BY status').all(String(orderId));
    if (!rows.length) return;
    const counts=Object.fromEntries(rows.map(row => [row.status,Number(row.count)]));
    let next='NEW';
    if ((counts.READY||0) === rows.reduce((sum,row)=>sum+Number(row.count),0)) next='READY';
    else if ((counts.PREPARING||0) > 0 || (counts.READY||0) > 0) next='PREPARING';
    db.prepare("UPDATE restaurant_orders SET status=?,updated_at=? WHERE id=? AND status<>'CANCELLED'").run(next,now(),String(orderId));
  }

  function syncProductionSourceStatus(sourceType,sourceId){
    const normalizedSource=String(sourceType||'').toUpperCase();
    if(!PRODUCTION_SOURCES.has(normalizedSource))return null;
    const rows=db.prepare("SELECT status,COUNT(*) AS count FROM production_tickets WHERE source_type=? AND source_id=? AND status<>'CANCELLED' GROUP BY status").all(normalizedSource,String(sourceId));
    if(!rows.length)return null;
    const counts=Object.fromEntries(rows.map(row=>[row.status,Number(row.count||0)]));
    const total=rows.reduce((sum,row)=>sum+Number(row.count||0),0);
    const next=(counts.READY||0)===total?'READY':((counts.PREPARING||0)>0||(counts.READY||0)>0)?'PREPARING':'NEW';
    const timestamp=now();
    if(normalizedSource==='DELIVERY')db.prepare("UPDATE delivery_orders SET status=?,updated_at=? WHERE id=? AND status IN('NEW','PREPARING','READY')").run(next,timestamp,String(sourceId));
    if(normalizedSource==='FAST_FOOD')db.prepare("UPDATE fast_food_orders SET status=?,updated_at=? WHERE id=? AND status IN('NEW','PREPARING','READY')").run(next,timestamp,String(sourceId));
    return next;
  }

  function cancelSourceTickets(sourceType,sourceId,actor={}){
    const normalizedSource=String(sourceType||'').trim().toUpperCase();
    if(!PRODUCTION_SOURCES.has(normalizedSource))throw new Error('Origem de producao invalida.');
    const tickets=listTickets({limit:500}).filter(ticket=>ticket.sourceType===normalizedSource&&String(ticket.sourceId)===String(sourceId)&&ticket.status!=='CANCELLED');
    return withTransaction(db,()=>tickets.map(ticket=>updateTicketStatus(ticket.id,'CANCELLED',actor)));
  }

  function updateTicketStatus(id, status, actor = {}) {
    const normalized=String(status||'').toUpperCase();
    if (!TICKET_STATUSES.has(normalized)) throw new Error('Status de cozinha invalido.');
    return withTransaction(db,()=>{
      const current=getTicket(id);
      if (!current) throw new Error('Ticket de cozinha nao encontrado.');
      if(current.status==='CANCELLED'&&normalized!=='CANCELLED')throw new Error('Ticket de cozinha cancelado nao pode ser reaberto.');
      if(current.sourceType==='RESTAURANT'){
        db.prepare('UPDATE kitchen_tickets SET status=?,updated_at=? WHERE id=?').run(normalized,now(),String(id));
        syncOrderStatus(current.orderId);
      }else{
        db.prepare('UPDATE production_tickets SET status=?,updated_at=? WHERE id=?').run(normalized,now(),String(id));
        syncProductionSourceStatus(current.sourceType,current.sourceId);
      }
      writeAudit(db,{action:'restaurant.kitchen.ticket.status',entity:'kitchen_ticket',entityId:String(id),actor,context:{from:current.status,to:normalized,sourceType:current.sourceType,sourceId:current.sourceId}},now);
      return getTicket(id);
    });
  }

  return { upsertStation,getStation,listStations,configureProductRoute,getProductRoute,listProductRoutes,assertOrderRouting,assignProduct,unassignProduct,listAssignments,routeOrder,routeProduction,getTicket,listTickets,updateTicketStatus,cancelSourceTickets,syncProductionSourceStatus,TICKET_STATUSES,PRODUCTION_SOURCES,PRODUCT_ROUTE_MODES };
}

module.exports={createKitchenService};
