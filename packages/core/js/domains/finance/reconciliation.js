'use strict';
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');
const { writeAudit } = require('../../core/audit-log');

function createReconciliation({ db, finance, statements, now = () => new Date().toISOString(), idFactory = p => `${p}-${randomUUID()}` } = {}) {
  if (!db || !finance || !statements) throw new TypeError('db, finance and statements are required.');

  const clean = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const tokens = value => new Set(clean(value).split(/\s+/).filter(token => token.length >= 3));
  const overlap = (a, b) => {
    const left = tokens(a); const right = tokens(b); if (!left.size || !right.size) return 0;
    let common = 0; for (const token of left) if (right.has(token)) common += 1;
    return common / Math.max(left.size, right.size);
  };
  const dayDistance = (a, b) => {
    const aa = Date.parse(String(a || '').slice(0, 10)); const bb = Date.parse(String(b || '').slice(0, 10));
    if (!Number.isFinite(aa) || !Number.isFinite(bb)) return Number.POSITIVE_INFINITY;
    return Math.abs(aa - bb) / 86400000;
  };
  function transaction(id) {
    const row = db.prepare('SELECT * FROM bank_statement_transactions WHERE id=?').get(String(id));
    if (!row) throw new Error('Transacao de extrato nao encontrada.');
    return row;
  }
  function reconciliationByKey(key) {
    return db.prepare('SELECT * FROM finance_reconciliations WHERE idempotency_key=?').get(String(key));
  }
  function mapReconciliation(row) {
    return row && { id:row.id,idempotencyKey:row.idempotency_key,transactionId:row.transaction_id,entryId:row.entry_id,decision:row.decision,amountCents:Number(row.amount_cents),settlementId:row.settlement_id,reason:row.reason,createdBy:row.created_by,createdAt:row.created_at };
  }
  function mapTransfer(row) {
    return row && { id:row.id,idempotencyKey:row.idempotency_key,debitTransactionId:row.debit_transaction_id,creditTransactionId:row.credit_transaction_id,amountCents:Number(row.amount_cents),status:row.status,createdBy:row.created_by,createdAt:row.created_at };
  }

  async function suggest({ accountId = null, limit = 200 } = {}) {
    const txs = statements.listTransactions({ accountId, matchStatus:'UNMATCHED', limit });
    const entries = finance.listEntries().filter(entry => entry.status !== 'CANCELLED' && entry.openCents > 0);
    const rejectedPair = db.prepare("SELECT 1 FROM finance_reconciliations WHERE transaction_id=? AND entry_id=? AND decision='REJECTED' LIMIT 1");
    const suggestions = [];
    for (const tx of txs) {
      const expectedKind = tx.direction === 'debit' ? 'PAYABLE' : 'RECEIVABLE';
      for (const entry of entries) {
        if (entry.kind !== expectedKind) continue;
        if (rejectedPair.get(tx.id,entry.id)) continue;
        const amountDelta = Math.abs(Number(tx.amountCents) - Number(entry.openCents));
        if (amountDelta > Math.max(100, Math.round(Number(tx.amountCents) * 0.02))) continue;
        const days = dayDistance(tx.date, entry.dueAt);
        if (days > 15) continue;
        const textScore = overlap(tx.description, entry.description);
        const exactAmount = amountDelta === 0;
        const score = (exactAmount ? 60 : 40) + Math.max(0, 25 - Math.round(days * 2)) + Math.round(textScore * 15);
        suggestions.push({ transactionId:tx.id,entryId:entry.id,accountId:tx.accountId,direction:tx.direction,amountCents:Math.min(Number(tx.amountCents),Number(entry.openCents)),transactionAmountCents:Number(tx.amountCents),entryOpenCents:Number(entry.openCents),postedDate:tx.date,dueAt:entry.dueAt,description:tx.description,entryDescription:entry.description,score,reason:{exactAmount,dayDistance:days,textOverlap:textScore} });
      }
    }
    return suggestions.sort((a,b)=>b.score-a.score||a.postedDate.localeCompare(b.postedDate)||a.transactionId.localeCompare(b.transactionId));
  }

  function confirm(input = {}, actor = null) {
    const key = String(input.idempotencyKey || '').trim(); if (!key) throw new Error('Chave de idempotencia obrigatoria.');
    const existing = reconciliationByKey(key); if (existing) return mapReconciliation(existing);
    const tx = transaction(input.transactionId); if (tx.match_status !== 'UNMATCHED') throw new Error('Transacao de extrato ja conciliada.');
    const entry = finance.getEntry(String(input.entryId || '')); if (!entry || entry.status === 'CANCELLED') throw new Error('Lancamento financeiro invalido para conciliacao.');
    const expectedKind = tx.direction === 'debit' ? 'PAYABLE' : 'RECEIVABLE'; if (entry.kind !== expectedKind) throw new Error('Direcao do extrato incompativel com o lancamento financeiro.');
    const requested = Number(input.amountCents); if (!Number.isInteger(requested) || requested <= 0) throw new Error('Valor de conciliacao invalido.');
    if (requested > Number(tx.amount_cents) || requested > entry.openCents) throw new Error('Valor de conciliacao excede o saldo disponivel.');
    return withTransaction(db, () => {
      const again = reconciliationByKey(key); if (again) return mapReconciliation(again);
      const settlementId = String(input.settlementId || idFactory('settlement'));
      const settled = finance.settleEntry(entry.id,{id:settlementId,amountCents:requested,method:'BANK_RECONCILIATION',note:`Conciliacao extrato ${tx.id}`},actor);
      const id = String(input.id || idFactory('recon')); const timestamp = now();
      db.prepare(`INSERT INTO finance_reconciliations(id,idempotency_key,transaction_id,entry_id,decision,amount_cents,settlement_id,reason,created_by,created_at) VALUES(?,?,?,?, 'ACCEPTED',?,?,?,?,?)`)
        .run(id,key,tx.id,entry.id,requested,settled.settlement.id,input.reason||null,actor?.userId||null,timestamp);
      db.prepare("UPDATE bank_statement_transactions SET match_status='MATCHED' WHERE id=?").run(tx.id);
      writeAudit(db,{action:'finance.reconciliation.accept',entity:'bank-statement-transaction',entityId:tx.id,actor,context:{reconciliationId:id,entryId:entry.id,amountCents:requested,settlementId:settled.settlement.id}},now);
      return mapReconciliation(db.prepare('SELECT * FROM finance_reconciliations WHERE id=?').get(id));
    });
  }

  function reject(input = {}, actor = null) {
    const key = String(input.idempotencyKey || '').trim(); if (!key) throw new Error('Chave de idempotencia obrigatoria.');
    const existing = reconciliationByKey(key); if (existing) return mapReconciliation(existing);
    const tx = transaction(input.transactionId); if (tx.match_status !== 'UNMATCHED') throw new Error('Transacao de extrato ja conciliada.');
    const entry = finance.getEntry(String(input.entryId || '')); if (!entry) throw new Error('Lancamento financeiro nao encontrado.');
    const reason = String(input.reason || '').trim(); if (!reason) throw new Error('Motivo da rejeicao obrigatorio.');
    return withTransaction(db, () => {
      const again = reconciliationByKey(key); if (again) return mapReconciliation(again);
      const id=String(input.id||idFactory('recon'));const timestamp=now();
      db.prepare(`INSERT INTO finance_reconciliations(id,idempotency_key,transaction_id,entry_id,decision,amount_cents,settlement_id,reason,created_by,created_at) VALUES(?,?,?,?,'REJECTED',0,NULL,?,?,?)`)
        .run(id,key,tx.id,entry.id,reason,actor?.userId||null,timestamp);
      writeAudit(db,{action:'finance.reconciliation.reject',entity:'bank-statement-transaction',entityId:tx.id,actor,context:{reconciliationId:id,entryId:entry.id,reason}},now);
      return mapReconciliation(db.prepare('SELECT * FROM finance_reconciliations WHERE id=?').get(id));
    });
  }

  async function suggestTransfers({ limit = 1000, maxDays = 2 } = {}) {
    const rows = statements.listTransactions({ matchStatus:'UNMATCHED', limit });
    const debits = rows.filter(row=>row.direction==='debit'); const credits = rows.filter(row=>row.direction==='credit'); const pairs=[]; const used=new Set();
    for (const debit of debits) {
      const candidates = credits.filter(credit=>credit.accountId!==debit.accountId && credit.amountCents===debit.amountCents && dayDistance(credit.date,debit.date)<=maxDays && !used.has(credit.id));
      candidates.sort((a,b)=>dayDistance(a.date,debit.date)-dayDistance(b.date,debit.date)||overlap(b.description,debit.description)-overlap(a.description,debit.description));
      const credit=candidates[0]; if(!credit)continue; used.add(credit.id);
      pairs.push({debitTransactionId:debit.id,creditTransactionId:credit.id,fromAccountId:debit.accountId,toAccountId:credit.accountId,amountCents:debit.amountCents,dateDistance:dayDistance(debit.date,credit.date),descriptionSimilarity:overlap(debit.description,credit.description)});
    }
    return pairs;
  }

  function confirmTransfer(input = {}, actor = null) {
    const key=String(input.idempotencyKey||'').trim();if(!key)throw new Error('Chave de idempotencia obrigatoria.');
    const old=db.prepare('SELECT * FROM financial_transfers WHERE idempotency_key=?').get(key);if(old)return mapTransfer(old);
    const debit=transaction(input.debitTransactionId);const credit=transaction(input.creditTransactionId);
    if(debit.direction!=='debit'||credit.direction!=='credit')throw new Error('Par de transferencia invalido.');
    if(debit.account_id===credit.account_id)throw new Error('Transferencia entre a mesma conta nao e permitida.');
    if(debit.match_status!=='UNMATCHED'||credit.match_status!=='UNMATCHED')throw new Error('Uma das transacoes ja foi conciliada.');
    if(Number(debit.amount_cents)!==Number(credit.amount_cents))throw new Error('Valores da transferencia nao conferem.');
    return withTransaction(db,()=>{
      const again=db.prepare('SELECT * FROM financial_transfers WHERE idempotency_key=?').get(key);if(again)return mapTransfer(again);
      const id=String(input.id||idFactory('transfer'));const timestamp=now();
      db.prepare(`INSERT INTO financial_transfers(id,idempotency_key,debit_transaction_id,credit_transaction_id,amount_cents,status,created_by,created_at) VALUES(?,?,?,?,?,'CONFIRMED',?,?)`)
        .run(id,key,debit.id,credit.id,Number(debit.amount_cents),actor?.userId||null,timestamp);
      db.prepare("UPDATE bank_statement_transactions SET match_status='TRANSFERRED' WHERE id IN (?,?)").run(debit.id,credit.id);
      writeAudit(db,{action:'finance.transfer.confirm',entity:'financial-transfer',entityId:id,actor,context:{debitTransactionId:debit.id,creditTransactionId:credit.id,amountCents:Number(debit.amount_cents)}},now);
      return mapTransfer(db.prepare('SELECT * FROM financial_transfers WHERE id=?').get(id));
    });
  }

  function listDecisions({ transactionId = null, entryId = null } = {}) {
    const clauses=[];const params=[];if(transactionId){clauses.push('transaction_id=?');params.push(String(transactionId));}if(entryId){clauses.push('entry_id=?');params.push(String(entryId));}
    return db.prepare(`SELECT * FROM finance_reconciliations${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at,id`).all(...params).map(mapReconciliation);
  }

  return { suggest, confirm, reject, suggestTransfers, confirmTransfer, listDecisions };
}

module.exports = { createReconciliation };
