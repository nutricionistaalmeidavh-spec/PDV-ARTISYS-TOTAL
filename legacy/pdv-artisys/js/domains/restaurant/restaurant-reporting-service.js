'use strict';

function csvCell(value){const text=String(value??'');return /[;"\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;}

function createRestaurantReportingService({db}={}){
  if(!db)throw new TypeError('Database is required.');

  function periodClauses({from=null,to=null}={}){
    const clauses=["o.status<>'CANCELLED'"];const params=[];
    if(from){clauses.push('o.created_at>=?');params.push(String(from));}
    if(to){clauses.push('o.created_at<=?');params.push(String(to));}
    return{where:`WHERE ${clauses.join(' AND ')}`,params};
  }

  function summary(filters={}){
    const {where,params}=periodClauses(filters);
    const totals=db.prepare(`SELECT COUNT(*) AS ordersCount,COALESCE(SUM(o.total_cents),0) AS grossCents FROM restaurant_orders o ${where}`).get(...params);
    const occupied=Number(db.prepare("SELECT COUNT(*) AS n FROM table_sessions WHERE status IN('OPEN','CHECKOUT')").get().n||0);
    const requests=Number(db.prepare("SELECT COUNT(*) AS n FROM service_requests WHERE status IN('OPEN','ACKNOWLEDGED')").get().n||0);
    const tickets=db.prepare("SELECT status,COUNT(*) AS count FROM kitchen_tickets GROUP BY status").all();
    const topProducts=db.prepare(`SELECT i.product_id AS productId,i.product_name AS productName,SUM(i.quantity) AS quantity,SUM(i.total_cents) AS grossCents
      FROM restaurant_order_items i JOIN restaurant_orders o ON o.id=i.order_id ${where}
      GROUP BY i.product_id,i.product_name ORDER BY grossCents DESC,quantity DESC LIMIT 20`).all(...params);
    const bySource=db.prepare(`SELECT o.source,COUNT(*) AS ordersCount,COALESCE(SUM(o.total_cents),0) AS grossCents FROM restaurant_orders o ${where} GROUP BY o.source ORDER BY o.source`).all(...params);
    const ordersCount=Number(totals.ordersCount||0);const grossCents=Number(totals.grossCents||0);
    return{
      period:{from:filters.from||null,to:filters.to||null},ordersCount,grossCents,averageOrderCents:ordersCount?Math.round(grossCents/ordersCount):0,
      occupiedTables:occupied,openServiceRequests:requests,
      kitchenByStatus:Object.fromEntries(tickets.map(row=>[row.status,Number(row.count)])),
      bySource:bySource.map(row=>({source:row.source,ordersCount:Number(row.ordersCount),grossCents:Number(row.grossCents)})),
      topProducts:topProducts.map(row=>({...row,quantity:Number(row.quantity),grossCents:Number(row.grossCents)}))
    };
  }

  function listOrders(filters={}){
    const {where,params}=periodClauses(filters);
    const limit=Math.min(Math.max(Number(filters.limit)||500,1),2000);params.push(limit);
    return db.prepare(`SELECT o.id,o.source,o.status,o.total_cents AS totalCents,o.created_at AS createdAt,t.label AS tableLabel,ts.id AS tableSessionId,u.name AS operatorName
      FROM restaurant_orders o JOIN table_sessions ts ON ts.id=o.table_session_id JOIN restaurant_tables t ON t.id=ts.table_id LEFT JOIN users u ON u.id=o.created_by
      ${where} ORDER BY o.created_at DESC,o.id DESC LIMIT ?`).all(...params);
  }

  function exportOrdersCsv(filters={}){
    const rows=listOrders({...filters,limit:2000});
    const header=['pedido','mesa','origem','status','total_centavos','operador','criado_em'];
    const lines=[header.join(';')];
    for(const row of rows)lines.push([row.id,row.tableLabel,row.source,row.status,row.totalCents,row.operatorName||'',row.createdAt].map(csvCell).join(';'));
    return `${lines.join('\n')}\n`;
  }

  return{summary,listOrders,exportOrdersCsv};
}

module.exports={createRestaurantReportingService};
