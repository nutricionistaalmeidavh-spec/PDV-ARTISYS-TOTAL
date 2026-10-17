'use strict';
const { randomUUID }=require('node:crypto');
const { withTransaction }=require('../../core/database/sqlite-database');
const { writeAudit }=require('../../core/audit-log');
const { assertCents }=require('../shared/money');
const { normalizeMethod }=require('../payments/payment-rules');
const { calculateCashClosing }=require('./cash-rules');

function createCashService({db,outbox,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!outbox)throw new TypeError('Database and outbox are required.');
  function mapMovement(row){if(!row)return null;const mapped={id:row.id,cashSessionId:row.cash_session_id,type:row.type,amountCents:row.amount_cents,paymentMethod:row.payment_method,saleId:row.sale_id,note:row.note,createdAt:row.created_at};const match=/^RETURN:([^:]+):/.exec(String(row.note||''));if(match)mapped.returnId=match[1];return mapped;}
  function listSessionMovements(sessionId){return db.prepare('SELECT * FROM cash_movements WHERE cash_session_id=? ORDER BY created_at,id').all(String(sessionId)).map(mapMovement);}
  function mapSession(row){if(!row)return null;const movements=listSessionMovements(row.id);const liveExpected=row.expected_cash_cents==null&&row.status==='OPEN'?calculateCashClosing({initialCashCents:row.initial_cash_cents,movements:movements.filter(m=>m.type!=='OPENING'),countedByMethod:{CASH:0}}).expectedCashCents:row.expected_cash_cents;return{id:row.id,terminalId:row.terminal_id,operatorId:row.operator_id,status:row.status,initialCashCents:row.initial_cash_cents,expectedCashCents:liveExpected,countedCashCents:row.counted_cash_cents,divergenceCents:row.divergence_cents,openedAt:row.opened_at,closedAt:row.closed_at,movements};}
  function getSession(id){return mapSession(db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(String(id)));}
  function getOpenSession(terminalId){return mapSession(db.prepare("SELECT * FROM cash_sessions WHERE terminal_id=? AND status='OPEN'").get(String(terminalId)));}
  function listSessions(filters={}){
    const clauses=[];const params=[];
    if(filters.terminalId){clauses.push('terminal_id=?');params.push(String(filters.terminalId));}
    if(filters.status){clauses.push('status=?');params.push(String(filters.status).toUpperCase());}
    if(filters.from){clauses.push('opened_at>=?');params.push(String(filters.from));}
    if(filters.to){clauses.push('opened_at<=?');params.push(String(filters.to));}
    const sql=`SELECT * FROM cash_sessions${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY opened_at DESC,id DESC`;
    return db.prepare(sql).all(...params).map(mapSession);
  }
  function requireOpen(id){const row=db.prepare("SELECT * FROM cash_sessions WHERE id=? AND status='OPEN'").get(String(id));if(!row)throw new Error('Caixa nao esta aberto.');return row;}
  function insertMovement({sessionId,type,amountCents,paymentMethod='CASH',saleId=null,note=null,createdAt}){
    assertCents(amountCents,'amountCents');if(amountCents<0)throw new Error('Valor do movimento nao pode ser negativo.');
    const method=normalizeMethod(paymentMethod)||'CASH';
    const id=idFactory('cashmov');
    try{db.prepare(`INSERT INTO cash_movements (id,cash_session_id,type,amount_cents,payment_method,sale_id,note,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(id,sessionId,type,amountCents,method,saleId,note,createdAt||now());return mapMovement(db.prepare('SELECT * FROM cash_movements WHERE id=?').get(id));}
    catch(error){if(saleId&&/UNIQUE constraint failed/.test(error.message)){return mapMovement(db.prepare('SELECT * FROM cash_movements WHERE cash_session_id=? AND sale_id=? AND payment_method=? AND type=?').get(sessionId,saleId,method,type));}throw error;}
  }
  function openSession(input={}){const initial=assertCents(input.initialCashCents??0,'initialCashCents');if(initial<0)throw new Error('Saldo inicial nao pode ser negativo.');const terminalId=String(input.terminalId||'').trim();const operatorId=String(input.operatorId||'').trim();if(!terminalId||!operatorId)throw new Error('Terminal e operador sao obrigatorios.');if(getOpenSession(terminalId))throw new Error('Ja existe caixa aberto neste terminal.');const id=String(input.id||idFactory('cash'));const timestamp=now();return withTransaction(db,()=>{db.prepare("INSERT INTO cash_sessions (id,terminal_id,operator_id,status,initial_cash_cents,opened_at) VALUES (?,?,?,'OPEN',?,?)").run(id,terminalId,operatorId,initial,timestamp);insertMovement({sessionId:id,type:'OPENING',amountCents:initial,paymentMethod:'CASH',note:'Abertura',createdAt:timestamp});const event={eventId:idFactory('evt'),type:'cash-session.opened',aggregate:'cash-session',aggregateId:id,occurredAt:timestamp,actor:input.actor||{userId:operatorId,role:'cashier',terminalId},source:'server',mutationId:input.mutationId||null,payload:{terminalId,initialCashCents:initial}};outbox.insert(event);writeAudit(db,{action:'cash.open',entity:'cash-session',entityId:id,actor:event.actor,context:{terminalId,initialCashCents:initial,eventId:event.eventId}},now);return getSession(id);});}
  function addSupply(id,{amountCents,note='',actor=null}={}){requireOpen(id);assertCents(amountCents,'amountCents');if(amountCents<=0)throw new Error('Suprimento deve ser maior que zero.');const movement=withTransaction(db,()=>insertMovement({sessionId:id,type:'SUPPLY',amountCents,paymentMethod:'CASH',note,createdAt:now()}));writeAudit(db,{action:'cash.supply',entity:'cash-session',entityId:id,actor,context:{amountCents,note}},now);return movement;}
  function withdraw(id,{amountCents,note='',actor=null}={}){const session=requireOpen(id);assertCents(amountCents,'amountCents');if(amountCents<=0)throw new Error('Sangria deve ser maior que zero.');const movements=db.prepare('SELECT type,amount_cents AS amountCents,payment_method AS paymentMethod FROM cash_movements WHERE cash_session_id=?').all(id);const current=calculateCashClosing({initialCashCents:session.initial_cash_cents,movements:movements.filter(m=>m.type!=='OPENING'),countedByMethod:{CASH:0}}).expectedCashCents;if(amountCents>current)throw new Error('Saldo em dinheiro insuficiente para sangria.');const movement=withTransaction(db,()=>insertMovement({sessionId:id,type:'WITHDRAWAL',amountCents,paymentMethod:'CASH',note,createdAt:now()}));writeAudit(db,{action:'cash.withdraw',entity:'cash-session',entityId:id,actor,context:{amountCents,note}},now);return movement;}

  function findSessionAt(terminalId,occurredAt){
    if(!terminalId||!occurredAt)return null;
    return mapSession(db.prepare(`SELECT * FROM cash_sessions WHERE terminal_id=? AND opened_at<=?
      AND (closed_at IS NULL OR closed_at>=?) ORDER BY opened_at DESC,id DESC LIMIT 1`).get(String(terminalId),String(occurredAt),String(occurredAt)));
  }
  function resolveEffectSession({cashSessionId=null,terminalId=null,occurredAt=null}={}){
    if(cashSessionId){
      const session=getSession(cashSessionId);
      if(!session)throw new Error('Sessao de caixa original nao encontrada.');
      if(terminalId&&String(session.terminalId)!==String(terminalId))throw new Error('Sessao de caixa original nao pertence ao terminal da operacao.');
      return session;
    }
    const historical=findSessionAt(terminalId,occurredAt);
    if(historical)return historical;
    const current=getOpenSession(terminalId);
    if(current)return current;
    throw new Error('Nao existe caixa correspondente a esta operacao.');
  }
  function aggregateAmountsByMethod(items=[]){
    const grouped=new Map();
    for(const item of items||[]){
      const method=normalizeMethod(item?.method)||'CASH';
      const amountCents=assertCents(item?.amountCents,'amountCents');
      if(amountCents<0)throw new Error('Valor do movimento nao pode ser negativo.');
      grouped.set(method,(grouped.get(method)||0)+amountCents);
    }
    return [...grouped].map(([method,amountCents])=>({method,amountCents}));
  }
  function recalculateClosedSession(sessionId){
    const row=db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(String(sessionId));
    if(!row||row.status!=='CLOSED')return;
    const movements=db.prepare('SELECT type,amount_cents AS amountCents,payment_method AS paymentMethod FROM cash_movements WHERE cash_session_id=?').all(row.id).filter(item=>item.type!=='OPENING');
    const summary=calculateCashClosing({initialCashCents:row.initial_cash_cents,movements,countedByMethod:{CASH:Number(row.counted_cash_cents||0)}});
    db.prepare('UPDATE cash_sessions SET expected_cash_cents=?,divergence_cents=? WHERE id=?').run(summary.expectedCashCents,summary.divergenceCents,row.id);
  }
  function recordSalePayments({cashSessionId=null,terminalId,saleId,payments=[],occurredAt=null}={}){const session=resolveEffectSession({cashSessionId,terminalId,occurredAt});const grouped=aggregateAmountsByMethod(payments);const result=withTransaction(db,()=>grouped.map(payment=>insertMovement({sessionId:session.id,type:'SALE',amountCents:payment.amountCents,paymentMethod:payment.method,saleId,createdAt:occurredAt||now()})));recalculateClosedSession(session.id);return result;}
  function reverseSalePayments({cashSessionId=null,terminalId,saleId,payments=[],occurredAt=null}={}){const session=resolveEffectSession({cashSessionId,terminalId,occurredAt});const grouped=aggregateAmountsByMethod(payments);const result=withTransaction(db,()=>grouped.map(payment=>insertMovement({sessionId:session.id,type:'REVERSAL',amountCents:payment.amountCents,paymentMethod:payment.method,saleId,createdAt:occurredAt||now()})));recalculateClosedSession(session.id);return result;}
  function recordReturnRefunds({cashSessionId=null,terminalId,returnId,refunds=[],direction='return',occurredAt=null}={}){
    const session=resolveEffectSession({cashSessionId,terminalId,occurredAt});
    const type=direction==='cancel'?'SALE':'REVERSAL';
    const note=`RETURN:${String(returnId)}:${direction==='cancel'?'CANCELLED':'COMPLETED'}`;
    const result=withTransaction(db,()=>refunds.map(refund=>{
      const method=normalizeMethod(refund.method)||'CASH';
      const existing=db.prepare('SELECT * FROM cash_movements WHERE cash_session_id=? AND type=? AND payment_method=? AND note=?').get(session.id,type,method,note);
      if(existing)return mapMovement(existing);
      return insertMovement({sessionId:session.id,type,amountCents:refund.amountCents,paymentMethod:method,saleId:null,note,createdAt:occurredAt||now()});
    }));
    recalculateClosedSession(session.id);
    return result;
  }
  function closeSession(id,{countedByMethod={},actor={},mutationId=null}={}){const session=requireOpen(id);return withTransaction(db,()=>{const movements=db.prepare('SELECT type,amount_cents AS amountCents,payment_method AS paymentMethod FROM cash_movements WHERE cash_session_id=?').all(id).filter(m=>m.type!=='OPENING');const summary=calculateCashClosing({initialCashCents:session.initial_cash_cents,movements,countedByMethod});const timestamp=now();db.prepare("UPDATE cash_sessions SET status='CLOSED',expected_cash_cents=?,counted_cash_cents=?,divergence_cents=?,closed_at=? WHERE id=? AND status='OPEN'").run(summary.expectedCashCents,summary.countedCashCents,summary.divergenceCents,timestamp,id);const event={eventId:idFactory('evt'),type:'cash-session.closed',aggregate:'cash-session',aggregateId:id,occurredAt:timestamp,actor,source:'server',mutationId,payload:{terminalId:session.terminal_id,...summary}};outbox.insert(event);writeAudit(db,{action:'cash.close',entity:'cash-session',entityId:id,actor,context:{status:summary.status,divergenceCents:summary.divergenceCents,eventId:event.eventId}},now);return getSession(id);});}
  return{openSession,addSupply,withdraw,recordSalePayments,reverseSalePayments,recordReturnRefunds,closeSession,getOpenSession,getSession,listSessionMovements,listSessions,resolveEffectSession};
}
module.exports={createCashService};
