'use strict';
const {randomUUID}=require('node:crypto');
const {withTransaction}=require('../../core/database/sqlite-database');
const {writeAudit}=require('../../core/audit-log');
const {parseOfx}=require('./ofx-parser');

function createStatementImport({db,finance,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${randomUUID()}`}={}){
  if(!db||!finance)throw new TypeError('db and finance are required.');
  let domainPromise=null;
  const domain=()=>domainPromise||(domainPromise=import('../../../vendor/artisys-finance-domain/src/index.mjs'));
  function account(id){const result=finance.getAccount(String(id||''));if(!result||!result.active)throw new Error('Conta bancaria nao encontrada ou inativa.');return result;}
  function safeSourceName(value){const text=String(value||'').trim();if(!text)throw new Error('Nome do arquivo de extrato obrigatorio.');return text.slice(0,240);}

  async function normalize(input={}){
    const accountId=String(input.accountId||'').trim();const acc=account(accountId);if(acc.type!=='BANK'&&acc.type!=='CARD')throw new Error('Extrato deve ser associado a conta bancaria ou cartao.');
    const sourceName=safeSourceName(input.sourceName);const content=String(input.content||'');const parsed=parseOfx(content);const mod=await domain();const sourceHash=mod.stableHash(content);
    const seen=new Set();const transactions=[];
    for(const row of parsed){
      const sourceIdentity=row.externalId?{source:`OFX:${accountId}`,documentId:accountId,externalId:row.externalId}:{source:`OFX:${accountId}`,documentId:sourceHash,rowIndex:row.rowIndex};
      const sourceFingerprint=mod.sourceFingerprint({...row,accountId},sourceIdentity);const businessFingerprint=mod.businessFingerprint({...row,accountId});
      const classification=mod.applyDeterministicRules({...row,accountId,normalized:row.description},mod.BASIC_PT_BR_FINANCE_RULES||[]);
      const stored=db.prepare('SELECT id FROM bank_statement_transactions WHERE source_fingerprint=?').get(sourceFingerprint);const duplicate=Boolean(stored)||seen.has(sourceFingerprint);seen.add(sourceFingerprint);
      const similar=Number(db.prepare('SELECT COUNT(*) n FROM bank_statement_transactions WHERE business_fingerprint=?').get(businessFingerprint)?.n||0)>0;
      transactions.push({...row,accountId,sourceFingerprint,businessFingerprint,classification,duplicate,businessDuplicate:similar});
    }
    return{accountId,sourceName,format:'OFX',sourceHash,transactions,duplicates:transactions.filter(row=>row.duplicate).length};
  }

  async function preview(input={}){return normalize(input);}

  async function commit(input={},actor=null){
    const prepared=await normalize(input);const batchId=String(input.batchId||idFactory('stmt'));const timestamp=now();
    return withTransaction(db,()=>{
      db.prepare(`INSERT INTO bank_statement_batches(id,account_id,source_name,format,source_hash,inserted_count,duplicate_count,created_by,created_at)
        VALUES(?,?,?,?,?,0,0,?,?)`).run(batchId,prepared.accountId,prepared.sourceName,prepared.format,prepared.sourceHash,actor?.userId||null,timestamp);
      const insert=db.prepare(`INSERT OR IGNORE INTO bank_statement_transactions(id,batch_id,account_id,posted_date,direction,amount_cents,description,external_id,source_fingerprint,business_fingerprint,classification_json,match_status,created_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,'UNMATCHED',?)`);
      let inserted=0;let duplicates=0;
      for(const row of prepared.transactions){
        const result=insert.run(idFactory('stx'),batchId,row.accountId,row.date,row.direction,row.amountCents,row.description,row.externalId,row.sourceFingerprint,row.businessFingerprint,JSON.stringify(row.classification||{}),timestamp);
        if(result.changes)inserted+=1;else duplicates+=1;
      }
      db.prepare('UPDATE bank_statement_batches SET inserted_count=?,duplicate_count=? WHERE id=?').run(inserted,duplicates,batchId);
      writeAudit(db,{action:'finance.statement.import',entity:'bank-statement-batch',entityId:batchId,actor,context:{accountId:prepared.accountId,format:'OFX',inserted,duplicates,sourceHash:prepared.sourceHash}},now);
      return{batchId,inserted,duplicates,total:prepared.transactions.length,accountId:prepared.accountId,sourceName:prepared.sourceName};
    });
  }

  function listBatches({accountId=null,limit=100}={}){
    const n=Math.max(1,Math.min(500,Number(limit)||100));const rows=accountId?db.prepare('SELECT * FROM bank_statement_batches WHERE account_id=? ORDER BY created_at DESC,id DESC LIMIT ?').all(String(accountId),n):db.prepare('SELECT * FROM bank_statement_batches ORDER BY created_at DESC,id DESC LIMIT ?').all(n);
    return rows.map(row=>({id:row.id,accountId:row.account_id,sourceName:row.source_name,format:row.format,sourceHash:row.source_hash,inserted:Number(row.inserted_count),duplicates:Number(row.duplicate_count),createdBy:row.created_by,createdAt:row.created_at}));
  }
  function listTransactions({accountId=null,batchId=null,from=null,to=null,matchStatus=null,limit=500}={}){
    const clauses=[];const params=[];if(accountId){clauses.push('account_id=?');params.push(String(accountId));}if(batchId){clauses.push('batch_id=?');params.push(String(batchId));}if(from){clauses.push('posted_date>=?');params.push(String(from));}if(to){clauses.push('posted_date<=?');params.push(String(to));}if(matchStatus){clauses.push('match_status=?');params.push(String(matchStatus).toUpperCase());}const n=Math.max(1,Math.min(2000,Number(limit)||500));params.push(n);
    return db.prepare(`SELECT * FROM bank_statement_transactions${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY posted_date DESC,id DESC LIMIT ?`).all(...params).map(row=>({id:row.id,batchId:row.batch_id,accountId:row.account_id,date:row.posted_date,direction:row.direction,amountCents:Number(row.amount_cents),description:row.description,externalId:row.external_id,sourceFingerprint:row.source_fingerprint,businessFingerprint:row.business_fingerprint,classification:row.classification_json?JSON.parse(row.classification_json):null,matchStatus:row.match_status,createdAt:row.created_at}));
  }

  return{preview,commit,listBatches,listTransactions};
}

module.exports={createStatementImport};
