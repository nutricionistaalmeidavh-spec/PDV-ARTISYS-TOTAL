'use strict';

const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { assertCents } = require('../shared/money');
const { principalFromActor } = require('../../core/auth/principal-resolver');

function validateBps(value) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 10000) throw new Error('Percentual de comissao invalido.');
  return result;
}

function createCommissionService({ db, authorization = null, now = () => new Date().toISOString(), idFactory = prefix => `${prefix}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');

  function requireSeller(id) {
    const seller = db.prepare('SELECT id,name,active FROM users WHERE id=?').get(String(id || '').trim());
    if (!seller) throw new Error('Vendedor ou garcom nao encontrado.');
    return seller;
  }

  function listRules({ sellerId = null, includeInactive = false } = {}) {
    const clauses = []; const params = [];
    if (sellerId) { clauses.push('r.seller_id=?'); params.push(String(sellerId)); }
    if (!includeInactive) clauses.push('r.active=1');
    return db.prepare(`SELECT r.id,r.seller_id AS sellerId,u.name AS sellerName,r.product_id AS productId,p.name AS productName,
      r.commission_bps AS commissionBps,r.active,r.created_at AS createdAt,r.updated_at AS updatedAt
      FROM seller_commission_rules r JOIN users u ON u.id=r.seller_id LEFT JOIN products p ON p.id=r.product_id
      ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY u.name,p.name,r.id`).all(...params).map(row => ({ ...row, active:Boolean(row.active) }));
  }

  function upsertRule(input = {}, actor = {}) {
    const seller = requireSeller(input.sellerId);
    const productId = String(input.productId || '').trim() || null;
    if (productId && !db.prepare('SELECT id FROM products WHERE id=?').get(productId)) throw new Error('Produto da regra de comissao nao encontrado.');
    const commissionBps = validateBps(input.commissionBps);
    const active = input.active === false ? 0 : 1; const timestamp = now();
    return withTransaction(db, () => {
      const existing = productId
        ? db.prepare('SELECT id FROM seller_commission_rules WHERE seller_id=? AND product_id=?').get(seller.id, productId)
        : db.prepare('SELECT id FROM seller_commission_rules WHERE seller_id=? AND product_id IS NULL').get(seller.id);
      const id = String(existing?.id || input.id || idFactory('commission-rule'));
      if (existing) db.prepare('UPDATE seller_commission_rules SET commission_bps=?,active=?,updated_at=? WHERE id=?').run(commissionBps,active,timestamp,id);
      else db.prepare('INSERT INTO seller_commission_rules(id,seller_id,product_id,commission_bps,active,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,seller.id,productId,commissionBps,active,timestamp,timestamp);
      writeAudit(db,{action:'commission.rule.upsert',entity:'commission-rule',entityId:id,actor,context:{sellerId:seller.id,productId,commissionBps,active:Boolean(active)}},now);
      return listRules({sellerId:seller.id,includeInactive:true}).find(rule => rule.id === id);
    });
  }

  function resolveRule(sellerId, productId) {
    return db.prepare(`SELECT commission_bps FROM seller_commission_rules
      WHERE seller_id=? AND active=1 AND (product_id=? OR product_id IS NULL)
      ORDER BY CASE WHEN product_id=? THEN 0 ELSE 1 END LIMIT 1`).get(sellerId,productId,productId)?.commission_bps || 0;
  }

  function addLedger(entry) {
    db.prepare(`INSERT OR IGNORE INTO commission_ledger
      (id,seller_id,sale_id,sale_item_id,return_id,payment_id,kind,amount_cents,reference_key,description,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(entry.id || idFactory('commission-entry'),entry.sellerId,entry.saleId||null,entry.saleItemId||null,entry.returnId||null,
        entry.paymentId||null,entry.kind,entry.amountCents,entry.referenceKey,entry.description||null,entry.createdAt||now());
  }

  function recordSaleCompleted(saleId, { netTotalCents, createdAt = now() } = {}) {
    const sale = db.prepare('SELECT id,COALESCE(seller_id,operator_id) AS seller_id FROM sales WHERE id=?').get(String(saleId));
    if (!sale) throw new Error('Venda nao encontrada para calcular comissao.');
    const items = db.prepare('SELECT id,product_id,total_cents FROM sale_items WHERE sale_id=? ORDER BY created_at,id').all(sale.id);
    const subtotal = items.reduce((sum,item)=>sum+Number(item.total_cents||0),0);
    const net = assertCents(Number(netTotalCents ?? subtotal),'netTotalCents');
    let allocated = 0;
    items.forEach((item,index) => {
      const base = index === items.length-1 ? Math.max(net-allocated,0) : (subtotal ? Math.round(Number(item.total_cents||0)*net/subtotal) : 0);
      allocated += base;
      const commissionBps = validateBps(resolveRule(sale.seller_id,item.product_id));
      const commissionCents = Math.round(base*commissionBps/10000);
      db.prepare('UPDATE sale_items SET commission_bps_snapshot=?,commission_base_cents=?,commission_cents=? WHERE id=?').run(commissionBps,base,commissionCents,item.id);
      if (commissionCents) addLedger({sellerId:sale.seller_id,saleId:sale.id,saleItemId:item.id,kind:'EARNED',amountCents:commissionCents,referenceKey:`sale:${sale.id}:item:${item.id}`,description:'Comissao de venda',createdAt});
    });
  }

  function reverseSale(saleId, createdAt = now()) {
    const rows = db.prepare(`SELECT cl.seller_id AS sellerId,cl.sale_item_id AS saleItemId,cl.amount_cents AS amountCents
      FROM commission_ledger cl WHERE cl.sale_id=? AND cl.kind='EARNED'`).all(String(saleId));
    for (const row of rows) addLedger({sellerId:row.sellerId,saleId:String(saleId),saleItemId:row.saleItemId,kind:'SALE_REVERSAL',amountCents:-Math.abs(row.amountCents),referenceKey:`sale-cancel:${saleId}:item:${row.saleItemId}`,description:'Estorno por cancelamento da venda',createdAt});
  }

  function reverseReturn(returnId, createdAt = now()) {
    const rows = db.prepare(`SELECT rt.sale_id AS saleId,s.seller_id AS sellerId,ri.sale_item_id AS saleItemId,ri.quantity,
      si.quantity AS soldQuantity,si.commission_cents AS commissionCents
      FROM return_transactions rt JOIN sales s ON s.id=rt.sale_id JOIN return_items ri ON ri.return_id=rt.id JOIN sale_items si ON si.id=ri.sale_item_id
      WHERE rt.id=?`).all(String(returnId));
    for (const row of rows) {
      const amount = Math.min(Math.round(Number(row.commissionCents||0)*Number(row.quantity||0)/Number(row.soldQuantity||1)),Number(row.commissionCents||0));
      if (amount) addLedger({sellerId:row.sellerId,saleId:row.saleId,saleItemId:row.saleItemId,returnId:String(returnId),kind:'RETURN_REVERSAL',amountCents:-amount,referenceKey:`return:${returnId}:item:${row.saleItemId}`,description:'Estorno por devolucao',createdAt});
    }
  }

  function restoreReturn(returnId, createdAt = now()) {
    const rows = db.prepare(`SELECT seller_id AS sellerId,sale_id AS saleId,sale_item_id AS saleItemId,amount_cents AS amountCents
      FROM commission_ledger WHERE return_id=? AND kind='RETURN_REVERSAL'`).all(String(returnId));
    for (const row of rows) addLedger({sellerId:row.sellerId,saleId:row.saleId,saleItemId:row.saleItemId,returnId:String(returnId),kind:'RETURN_RESTORED',amountCents:Math.abs(row.amountCents),referenceKey:`return-cancel:${returnId}:item:${row.saleItemId}`,description:'Restauracao por cancelamento da devolucao',createdAt});
  }

  function outstanding(sellerId) {
    return Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total FROM commission_ledger WHERE seller_id=?').get(String(sellerId)).total || 0);
  }

  function pay(input = {}, actor = {}) {
    if (authorization) authorization.require({principal:principalFromActor(actor),capability:'finance.manage'});
    const seller = requireSeller(input.sellerId); const amount = assertCents(Number(input.amountCents),'amountCents');
    if (amount <= 0) throw new Error('Pagamento de comissao deve ser maior que zero.');
    if (amount > outstanding(seller.id)) throw new Error('Pagamento excede a comissao em aberto.');
    const id = String(input.id || idFactory('commission-payment')); const timestamp = now();
    return withTransaction(db, () => {
      db.prepare('INSERT INTO commission_payments(id,seller_id,amount_cents,period_from,period_to,note,paid_by_id,paid_at) VALUES(?,?,?,?,?,?,?,?)')
        .run(id,seller.id,amount,input.periodFrom||null,input.periodTo||null,String(input.note||'').trim()||null,actor.userId||null,timestamp);
      addLedger({sellerId:seller.id,paymentId:id,kind:'PAYMENT',amountCents:-amount,referenceKey:`payment:${id}`,description:'Pagamento de comissao',createdAt:timestamp});
      writeAudit(db,{action:'commission.payment',entity:'commission-payment',entityId:id,actor,context:{sellerId:seller.id,amountCents:amount,periodFrom:input.periodFrom||null,periodTo:input.periodTo||null}},now);
      return {id,sellerId:seller.id,sellerName:seller.name,amountCents:amount,periodFrom:input.periodFrom||null,periodTo:input.periodTo||null,note:String(input.note||'').trim()||null,paidById:actor.userId||null,paidAt:timestamp};
    });
  }

  function report({ from = null, to = null, sellerId = null } = {}) {
    const clauses=[];const params=[];
    if(from){clauses.push('cl.created_at>=?');params.push(String(from));}if(to){clauses.push('cl.created_at<=?');params.push(String(to));}if(sellerId){clauses.push('cl.seller_id=?');params.push(String(sellerId));}
    const rows=db.prepare(`SELECT cl.id,cl.seller_id AS sellerId,u.name AS sellerName,cl.sale_id AS saleId,cl.sale_item_id AS saleItemId,
      cl.return_id AS returnId,cl.payment_id AS paymentId,cl.kind,cl.amount_cents AS amountCents,cl.description,cl.created_at AS createdAt
      FROM commission_ledger cl JOIN users u ON u.id=cl.seller_id ${clauses.length?`WHERE ${clauses.join(' AND ')}`:''} ORDER BY cl.created_at,cl.id`).all(...params);
    const sellers=new Map();
    for(const row of rows){const current=sellers.get(row.sellerId)||{sellerId:row.sellerId,sellerName:row.sellerName,earnedCents:0,reversedCents:0,paidCents:0,periodBalanceCents:0,outstandingCents:outstanding(row.sellerId)};if(row.kind==='EARNED')current.earnedCents+=row.amountCents;else if(row.kind==='PAYMENT')current.paidCents+=Math.abs(row.amountCents);else current.reversedCents+=row.amountCents<0?Math.abs(row.amountCents):-row.amountCents;current.periodBalanceCents+=row.amountCents;sellers.set(row.sellerId,current);}
    return {from,to,rows,sellers:[...sellers.values()].sort((a,b)=>b.periodBalanceCents-a.periodBalanceCents||a.sellerName.localeCompare(b.sellerName)),totalEarnedCents:rows.filter(row=>row.kind==='EARNED').reduce((sum,row)=>sum+row.amountCents,0),totalReversedCents:rows.filter(row=>!['EARNED','PAYMENT'].includes(row.kind)).reduce((sum,row)=>sum-row.amountCents,0),totalPaidCents:rows.filter(row=>row.kind==='PAYMENT').reduce((sum,row)=>sum+Math.abs(row.amountCents),0)};
  }

  return { listRules, upsertRule, resolveRule, recordSaleCompleted, reverseSale, reverseReturn, restoreReturn, outstanding, pay, report };
}

module.exports = { createCommissionService, validateBps };
