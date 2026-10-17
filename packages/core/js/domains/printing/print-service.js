'use strict';
const { randomUUID } = require('node:crypto');
const { withTransaction } = require('../../core/database/sqlite-database');

const WIDTHS = new Set([32,42,48]);
const STATUSES = new Set(['PENDING','PRINTED','FAILED','CANCELLED']);

function createPrintService({ db, now = () => new Date().toISOString(), idFactory = p => `${p}-${randomUUID()}` } = {}) {
  if (!db) throw new TypeError('Database is required.');

  function mapJob(row) {
    if (!row) return null;
    let payload = {};
    try { payload = JSON.parse(row.payload_json || '{}'); } catch { payload = {}; }
    return { id:row.id,type:row.type,entityType:row.entity_type,entityId:row.entity_id,payload,width:row.width,status:row.status,attempts:row.attempts,lastError:row.last_error,createdAt:row.created_at,updatedAt:row.updated_at,printedAt:row.printed_at };
  }
  function getJob(id) { return mapJob(db.prepare('SELECT * FROM print_jobs WHERE id=?').get(String(id))); }
  function getOriginalSaleReceipt(saleId) {
    const id=String(saleId||'').trim();
    if(!id)return null;
    return mapJob(db.prepare("SELECT * FROM print_jobs WHERE entity_type='sale' AND entity_id=? AND type='SALE_RECEIPT' ORDER BY created_at ASC,id ASC LIMIT 1").get(id));
  }
  function queueJob(input = {}) {
    const id=String(input.id||idFactory('print'));
    const existing=getJob(id); if(existing)return existing;
    const type=String(input.type||'').trim().toUpperCase(); if(!type)throw new Error('Tipo do trabalho de impressao obrigatorio.');
    const width=Number(input.width||42);if(!WIDTHS.has(width))throw new Error('Largura de impressao invalida.');
    const payload=input.payload&&typeof input.payload==='object'?input.payload:{};
    const timestamp=now();
    db.prepare(`INSERT INTO print_jobs (id,type,entity_type,entity_id,payload_json,width,status,attempts,created_at,updated_at)
      VALUES (?,?,?,?,?,?,'PENDING',0,?,?)`).run(id,type,input.entityType||null,input.entityId||null,JSON.stringify(payload),width,timestamp,timestamp);
    return getJob(id);
  }
  function requireJob(id){const job=getJob(id);if(!job)throw new Error('Trabalho de impressao nao encontrado.');return job;}
  function markFailed(id,error='Falha de impressao'){
    requireJob(id);const timestamp=now();db.prepare("UPDATE print_jobs SET status='FAILED',attempts=attempts+1,last_error=?,updated_at=? WHERE id=?").run(String(error||'Falha de impressao'),timestamp,String(id));return getJob(id);
  }
  function retryJob(id){const job=requireJob(id);if(!['FAILED','PENDING'].includes(job.status))throw new Error('Somente trabalho pendente ou com falha pode ser reenviado.');db.prepare("UPDATE print_jobs SET status='PENDING',last_error=NULL,updated_at=? WHERE id=?").run(now(),String(id));return getJob(id);}
  function markPrinted(id){const job=requireJob(id);if(job.status==='CANCELLED')throw new Error('Trabalho cancelado nao pode ser impresso.');const timestamp=now();db.prepare("UPDATE print_jobs SET status='PRINTED',attempts=attempts+1,last_error=NULL,printed_at=?,updated_at=? WHERE id=?").run(timestamp,timestamp,String(id));return getJob(id);}
  function cancelJob(id){requireJob(id);db.prepare("UPDATE print_jobs SET status='CANCELLED',updated_at=? WHERE id=? AND status<>'PRINTED'").run(now(),String(id));return getJob(id);}
  function reprint(id){const original=requireJob(id);return queueJob({type:'REPRINT',entityType:original.entityType,entityId:original.entityId,payload:{...original.payload,reprintOf:original.id},width:original.width});}
  function createManualAttempt(saleId){
    const original=getOriginalSaleReceipt(saleId);
    if(!original)throw new Error('Comprovante original da venda nao encontrado.');
    return queueJob({
      type:'REPRINT',
      entityType:'sale',
      entityId:original.entityId,
      payload:{...original.payload,reprintOf:original.id,manual:true},
      width:original.width
    });
  }
  function listJobs(filters={}){
    const clauses=[];const params=[];
    if(filters.status){const status=String(filters.status).toUpperCase();if(!STATUSES.has(status))throw new Error('Status de impressao invalido.');clauses.push('status=?');params.push(status);}
    if(filters.type){clauses.push('type=?');params.push(String(filters.type).toUpperCase());}
    if(filters.entityId){clauses.push('entity_id=?');params.push(String(filters.entityId));}
    if(filters.entityType){clauses.push('entity_type=?');params.push(String(filters.entityType));}
    const rows=db.prepare(`SELECT * FROM print_jobs${clauses.length?` WHERE ${clauses.join(' AND ')}`:''} ORDER BY created_at DESC,id DESC`).all(...params);
    return rows.map(mapJob);
  }
  async function processJob(id, printer){
    const job=requireJob(id);if(job.status!=='PENDING')throw new Error('Trabalho nao esta pendente.');
    if(!printer||typeof printer.print!=='function')throw new Error('Impressora indisponivel.');
    try {
      const paperMm=Number(job.payload.paperMm);
      const result=await printer.print({id:job.id,text:String(job.payload.text||''),html:job.payload.html?String(job.payload.html):null,format:job.payload.format?String(job.payload.format):null,width:job.width,paperMm:[58,80].includes(paperMm)?paperMm:undefined,printerName:job.payload.printerName,silent:job.payload.silent,logoDataUrl:job.payload.logoDataUrl||null});
      if(result&&result.success===false)throw new Error(result.failureReason||'Falha de impressao.'); return {job:markPrinted(id),result};
    }
    catch(error){markFailed(id,error?.message||String(error));throw error;}
  }
  return {queueJob,getJob,getOriginalSaleReceipt,listJobs,markFailed,retryJob,markPrinted,cancelJob,reprint,createManualAttempt,processJob};
}

module.exports={createPrintService};
