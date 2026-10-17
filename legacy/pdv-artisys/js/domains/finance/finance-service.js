'use strict';
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');
const { assertCents } = require('../shared/money');

function createFinanceService({ db, dimensions = null, now = () => new Date().toISOString(), idFactory = p => `${p}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');

  function mapAccount(row) {
    return row && { id:row.id,name:row.name,type:row.type,active:Boolean(row.active),createdAt:row.created_at,updatedAt:row.updated_at };
  }
  function getAccount(id) { return mapAccount(db.prepare('SELECT * FROM financial_accounts WHERE id=?').get(String(id))); }
  function createAccount(input = {}, actor = null) {
    const name=String(input.name||'').trim(); if(!name)throw new Error('Nome da conta financeira obrigatorio.');
    const type=String(input.type||'OTHER').trim().toUpperCase(); if(!['CASH','BANK','CARD','OTHER'].includes(type))throw new Error('Tipo de conta financeira invalido.');
    const id=String(input.id||idFactory('finacc'));const timestamp=now();
    db.prepare('INSERT INTO financial_accounts (id,name,type,active,created_at,updated_at) VALUES (?,?,?,?,?,?)').run(id,name,type,input.active===false?0:1,timestamp,timestamp);
    writeAudit(db,{action:'finance.account.create',entity:'financial-account',entityId:id,actor,context:{name,type}},now);
    return getAccount(id);
  }
  function listAccounts({includeInactive=false}={}) { return db.prepare(`SELECT * FROM financial_accounts${includeInactive?'':' WHERE active=1'} ORDER BY name,id`).all().map(mapAccount); }

  function settlementRows(entryId,{includeReversed=false}={}) {
    return db.prepare(`SELECT * FROM financial_settlements WHERE entry_id=?${includeReversed?'':' AND reversed_at IS NULL'} ORDER BY created_at,id`).all(String(entryId));
  }
  function activeSettlements(entryId) { return settlementRows(entryId); }
  function mapSettlement(row) { return row&&{id:row.id,entryId:row.entry_id,amountCents:row.amount_cents,method:row.method,note:row.note,createdAt:row.created_at,reversedAt:row.reversed_at}; }
  function mapEntry(row, asOf = now()) {
    if(!row)return null;
    const settlementHistory=settlementRows(row.id,{includeReversed:true}).map(mapSettlement);
    const settlements=settlementHistory.filter(item=>!item.reversedAt);
    const settledCents=settlements.reduce((sum,item)=>sum+item.amountCents,0);
    const openCents=Math.max(row.amount_cents-settledCents,0);
    const dims=dimensions?.getEntryDimensions?.(row.id)||null;
    return {id:row.id,kind:row.kind,description:row.description,category:row.category,categoryId:dims?.categoryId||null,costCenterId:dims?.costCenterId||null,competencyDate:dims?.competencyDate||null,accountId:row.account_id,amountCents:row.amount_cents,dueAt:row.due_at,status:row.status,sourceType:row.source_type,sourceId:row.source_id,notes:row.notes,createdAt:row.created_at,updatedAt:row.updated_at,cancelledAt:row.cancelled_at,settledCents,openCents,isOverdue:['OPEN','PARTIAL'].includes(row.status)&&Date.parse(row.due_at)<Date.parse(asOf),settlements,settlementHistory};
  }
  function getEntry(id,{asOf}={}) { return mapEntry(db.prepare('SELECT * FROM financial_entries WHERE id=?').get(String(id)),asOf||now()); }
  function requireEntry(id){const row=db.prepare('SELECT * FROM financial_entries WHERE id=?').get(String(id));if(!row)throw new Error('Lancamento financeiro nao encontrado.');return row;}

  function createEntry(input = {}, actor = null) {
    const kind=String(input.kind||'').toUpperCase();if(!['PAYABLE','RECEIVABLE'].includes(kind))throw new Error('Tipo de lancamento financeiro invalido.');
    const description=String(input.description||'').trim();if(!description)throw new Error('Descricao do lancamento obrigatoria.');
    const amountCents=assertCents(input.amountCents,'amountCents');if(amountCents<=0)throw new Error('Valor do lancamento deve ser maior que zero.');
    const dueAt=String(input.dueAt||'').trim();if(!dueAt||!Number.isFinite(Date.parse(dueAt)))throw new Error('Vencimento invalido.');
    if(input.accountId&&!getAccount(input.accountId))throw new Error('Conta financeira nao encontrada.');
    const hasDimensions=Boolean(input.categoryId||input.costCenterId||input.competencyDate);
    if(hasDimensions&&!dimensions)throw new Error('Servico de dimensoes financeiras nao configurado.');
    if(dimensions)dimensions.validateEntryDimensions(input,kind);
    const id=String(input.id||idFactory('fin'));const timestamp=now();
    db.prepare(`INSERT INTO financial_entries
      (id,kind,description,category,account_id,amount_cents,due_at,status,source_type,source_id,notes,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,'OPEN',?,?,?,?,?)`)
      .run(id,kind,description,input.category||null,input.accountId||null,amountCents,dueAt,input.sourceType||null,input.sourceId||null,input.notes||null,timestamp,timestamp);
    if(dimensions&&hasDimensions)dimensions.setEntryDimensions(id,{categoryId:input.categoryId||null,costCenterId:input.costCenterId||null,competencyDate:input.competencyDate||null},actor);
    writeAudit(db,{action:'finance.entry.create',entity:'financial-entry',entityId:id,actor,context:{kind,amountCents,dueAt,categoryId:input.categoryId||null,costCenterId:input.costCenterId||null,competencyDate:input.competencyDate||null,sourceType:input.sourceType||null,sourceId:input.sourceId||null}},now);
    return getEntry(id);
  }

  function recalculateStatus(entryId) {
    const row=requireEntry(entryId);if(row.status==='CANCELLED')return row.status;
    const settled=Number(db.prepare('SELECT COALESCE(SUM(amount_cents),0) AS total FROM financial_settlements WHERE entry_id=? AND reversed_at IS NULL').get(entryId).total||0);
    const status=settled<=0?'OPEN':settled<row.amount_cents?'PARTIAL':'SETTLED';
    db.prepare('UPDATE financial_entries SET status=?,updated_at=? WHERE id=?').run(status,now(),entryId);
    return status;
  }

  function settleEntry(entryId, input = {}, actor = null) {
    return withTransaction(db,()=>{
      const row=requireEntry(entryId);if(row.status==='CANCELLED')throw new Error('Lancamento cancelado nao pode ser liquidado.');
      const current=getEntry(entryId);if(current.openCents<=0)throw new Error('Lancamento ja liquidado; nao ha saldo aberto.');
      const amountCents=assertCents(input.amountCents,'amountCents');if(amountCents<=0)throw new Error('Valor da baixa deve ser maior que zero.');
      if(amountCents>current.openCents)throw new Error('Valor da baixa excede o saldo aberto.');
      const id=String(input.id||idFactory('settlement'));const timestamp=now();
      db.prepare('INSERT INTO financial_settlements (id,entry_id,amount_cents,method,note,created_at) VALUES (?,?,?,?,?,?)').run(id,String(entryId),amountCents,input.method||null,input.note||null,timestamp);
      recalculateStatus(entryId);
      writeAudit(db,{action:'finance.settle',entity:'financial-entry',entityId:String(entryId),actor,context:{settlementId:id,amountCents,method:input.method||null}},now);
      return {settlement:mapSettlement(db.prepare('SELECT * FROM financial_settlements WHERE id=?').get(id)),entry:getEntry(entryId)};
    });
  }

  function reverseSettlement(settlementId, {reason='',actor=null}={}) {
    return withTransaction(db,()=>{
      const row=db.prepare('SELECT * FROM financial_settlements WHERE id=?').get(String(settlementId));
      if(!row)throw new Error('Baixa financeira nao encontrada.');if(row.reversed_at)throw new Error('Baixa financeira ja estornada.');
      const text=String(reason||'').trim();if(!text)throw new Error('Informe o motivo do estorno.');
      const timestamp=now();const note=[row.note,text?`ESTORNO: ${text}`:''].filter(Boolean).join(' | ');
      db.prepare('UPDATE financial_settlements SET reversed_at=?,note=? WHERE id=? AND reversed_at IS NULL').run(timestamp,note,String(settlementId));
      recalculateStatus(row.entry_id);
      writeAudit(db,{action:'finance.settlement.reverse',entity:'financial-entry',entityId:row.entry_id,actor,context:{settlementId:String(settlementId),reason:text}},now);
      return {settlement:mapSettlement(db.prepare('SELECT * FROM financial_settlements WHERE id=?').get(String(settlementId))),entry:getEntry(row.entry_id)};
    });
  }

  function cancelEntry(entryId,{reason='',actor=null}={}) {
    return withTransaction(db,()=>{
      const row=requireEntry(entryId);if(row.status==='CANCELLED')return getEntry(entryId);
      const active=activeSettlements(entryId);if(active.length)throw new Error('Estorne as baixas antes de cancelar o lancamento.');
      const text=String(reason||'').trim();if(!text)throw new Error('Informe o motivo do cancelamento.');
      const timestamp=now();
      db.prepare("UPDATE financial_entries SET status='CANCELLED',notes=?,cancelled_at=?,updated_at=? WHERE id=?").run([row.notes,`CANCELAMENTO: ${text}`].filter(Boolean).join(' | '),timestamp,timestamp,String(entryId));
      writeAudit(db,{action:'finance.entry.cancel',entity:'financial-entry',entityId:String(entryId),actor,context:{reason:text}},now);
      return getEntry(entryId);
    });
  }

  function listEntries(filters={}) {
    const clauses=[];const params=[];
    if(filters.kind){clauses.push('kind=?');params.push(String(filters.kind).toUpperCase());}
    if(filters.status){clauses.push('status=?');params.push(String(filters.status).toUpperCase());}
    if(filters.from){clauses.push('due_at>=?');params.push(String(filters.from));}
    if(filters.to){clauses.push('due_at<=?');params.push(String(filters.to));}
    if(filters.accountId){clauses.push('account_id=?');params.push(String(filters.accountId));}
    if(filters.query){clauses.push('(LOWER(description) LIKE ? OR LOWER(COALESCE(category,\'\')) LIKE ?)');const q=`%${String(filters.query).trim().toLowerCase()}%`;params.push(q,q);}
    const rows=db.prepare(`SELECT * FROM financial_entries${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY due_at,id`).all(...params);
    const overdue=filters.overdue===true||String(filters.overdue||'').toLowerCase()==='true';
    return rows.map(row=>mapEntry(row,filters.asOf||now())).filter(entry=>overdue?entry.isOverdue:true).filter(entry=>filters.categoryId?entry.categoryId===String(filters.categoryId):true).filter(entry=>filters.costCenterId?entry.costCenterId===String(filters.costCenterId):true);
  }

  function getSummary({from=null,to=null,asOf=now()}={}) {
    const entries=listEntries({from,to,asOf});
    const summary={payableTotalCents:0,payableSettledCents:0,payableOpenCents:0,receivableTotalCents:0,receivableSettledCents:0,receivableOpenCents:0,overduePayableCents:0,overdueReceivableCents:0};
    for(const entry of entries){if(entry.status==='CANCELLED')continue;const prefix=entry.kind==='PAYABLE'?'payable':'receivable';summary[`${prefix}TotalCents`]+=entry.amountCents;summary[`${prefix}SettledCents`]+=entry.settledCents;summary[`${prefix}OpenCents`]+=entry.openCents;if(entry.isOverdue)summary[entry.kind==='PAYABLE'?'overduePayableCents':'overdueReceivableCents']+=entry.openCents;}
    return summary;
  }

  return {createAccount,getAccount,listAccounts,createEntry,getEntry,listEntries,settleEntry,reverseSettlement,cancelEntry,getSummary};
}

module.exports={createFinanceService};
