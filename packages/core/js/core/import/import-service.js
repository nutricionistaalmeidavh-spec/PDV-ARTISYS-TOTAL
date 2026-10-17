'use strict';

const { createHash }=require('node:crypto');
const { writeAudit }=require('../audit-log');
const { withTransaction }=require('../database/sqlite-database');
const { principalFromActor }=require('../auth/principal-resolver');

function ensureImportTables(db){
 db.exec(`CREATE TABLE IF NOT EXISTS import_batches(
  id TEXT PRIMARY KEY,type TEXT NOT NULL,format TEXT NOT NULL,content_hash TEXT NOT NULL,collision_policy TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN('PREVIEWED','COMMITTED','FAILED')),rows_json TEXT NOT NULL,summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,committed_at TEXT,committed_by TEXT,
  UNIQUE(type,format,content_hash,collision_policy)
 );
 CREATE TABLE IF NOT EXISTS import_errors(
  id INTEGER PRIMARY KEY AUTOINCREMENT,batch_id TEXT NOT NULL,row_number INTEGER NOT NULL,message TEXT NOT NULL,row_json TEXT,
  FOREIGN KEY(batch_id) REFERENCES import_batches(id) ON DELETE CASCADE
 );
 CREATE INDEX IF NOT EXISTS idx_import_batches_status_created ON import_batches(status,created_at);
 CREATE INDEX IF NOT EXISTS idx_import_errors_batch ON import_errors(batch_id,row_number);`);
}

function sha256(value){return createHash('sha256').update(Buffer.from(String(value),'utf8')).digest('hex');}
function normalizeHeader(value){return String(value||'').replace(/^\uFEFF/,'').trim();}
function parseCsvLine(line,delimiter){const out=[];let current='';let quoted=false;for(let i=0;i<line.length;i+=1){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){current+='"';i+=1;}else quoted=!quoted;}else if(ch===delimiter&&!quoted){out.push(current);current='';}else current+=ch;}out.push(current);return out;}
function parseCsv(content){
 const text=String(content||'').replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');const lines=text.split('\n').filter((line,index,array)=>line.trim()||index<array.length-1);
 if(!lines.length||!lines[0].trim())throw new Error('CSV vazio.');
 const delimiter=(lines[0].match(/;/g)||[]).length>=(lines[0].match(/,/g)||[]).length?';':',';
 const headers=parseCsvLine(lines[0],delimiter).map(normalizeHeader);if(headers.some(h=>!h))throw new Error('Cabecalho CSV invalido.');
 return lines.slice(1).filter(line=>line.trim()).map((line,index)=>{const values=parseCsvLine(line,delimiter);const row={};headers.forEach((h,i)=>{row[h]=String(values[i]??'').trim();});return{rowNumber:index+2,row};});
}
function parseNumber(value,field,{integer=false,min=0}={}){const text=String(value??'').trim().replace(',','.');const number=text===''?0:Number(text);if(!Number.isFinite(number)||(integer&&!Number.isInteger(number))||number<min)throw new Error(`${field} invalido.`);return number;}
function normalizeDigits(value){const text=String(value||'').replace(/\s+/g,'').trim();return text||null;}
function normalizeDoc(value){const text=String(value||'').replace(/\D+/g,'');return text||null;}
function upper(value,fallback=''){return String(value||fallback).trim().toUpperCase();}

function createImportService({db,catalog,inventory,authorization=null,now=()=>new Date().toISOString(),idFactory=p=>`${p}-${Date.now()}`}={}){
 if(!db||!catalog||!inventory)throw new TypeError('db, catalog and inventory are required.');ensureImportTables(db);
 const supported=new Set(['products','categories','customers','suppliers','inventory']);
 function findProduct(row){if(row.sku){const v=db.prepare('SELECT id FROM products WHERE sku=?').get(row.sku);if(v)return v.id;}if(row.barcode){const v=db.prepare('SELECT id FROM products WHERE barcode=?').get(row.barcode);if(v)return v.id;}return null;}
 function normalize(type,row){
  if(type==='products'){
   const name=String(row.name||row.nome||'').trim();if(!name)throw new Error('Nome do produto obrigatorio.');
   return{sku:normalizeDigits(row.sku),barcode:normalizeDigits(row.barcode||row.codigoBarras),name,unit:upper(row.unit||row.unidade,'UN'),salePriceCents:parseNumber(row.salePriceCents??row.precoVenda,'salePriceCents',{integer:true}),costCents:parseNumber(row.costCents??row.custo,'costCents',{integer:true}),minimumStock:parseNumber(row.minimumStock??row.estoqueMinimo,'minimumStock'),trackStock:String(row.trackStock||'true').toLowerCase()!=='false'};
  }
  if(type==='categories'){const name=String(row.name||row.nome||'').trim();if(!name)throw new Error('Nome da categoria obrigatorio.');return{name};}
  if(type==='customers'){const name=String(row.name||row.nome||'').trim();if(!name)throw new Error('Nome do cliente obrigatorio.');return{name,document:normalizeDoc(row.document||row.documento||row.cpf||row.cnpj),phone:String(row.phone||row.telefone||'').trim()||null,email:String(row.email||'').trim()||null};}
  if(type==='suppliers'){const name=String(row.name||row.nome||'').trim();if(!name)throw new Error('Nome do fornecedor obrigatorio.');return{name,document:normalizeDoc(row.document||row.documento||row.cpf||row.cnpj),phone:String(row.phone||row.telefone||'').trim()||null,email:String(row.email||'').trim()||null};}
  if(type==='inventory'){const sku=normalizeDigits(row.sku);const barcode=normalizeDigits(row.barcode||row.codigoBarras);if(!sku&&!barcode)throw new Error('SKU ou codigo de barras obrigatorio para estoque.');return{sku,barcode,quantity:parseNumber(row.quantity??row.quantidade,'quantity')};}
  throw new Error('Tipo de importacao nao suportado.');
 }
 function collision(type,normalized){
  if(type==='products'||type==='inventory')return findProduct(normalized);
  if(type==='categories')return db.prepare('SELECT id FROM categories WHERE lower(name)=lower(?)').get(normalized.name)?.id||null;
  if((type==='customers'||type==='suppliers')&&normalized.document){return db.prepare(`SELECT id FROM ${type} WHERE document=?`).get(normalized.document)?.id||null;}
  return null;
 }
 function rowForPreview(type,item,policy){
  try{const data=normalize(type,item.row);const existingId=collision(type,data);let action='CREATE';if(existingId){if(policy==='CREATE')throw new Error('Registro ja existe e politica CREATE nao permite colisao.');action=policy;}
   if(type==='inventory'&&!existingId)throw new Error('Produto do estoque nao encontrado.');
   return{rowNumber:item.rowNumber,data,existingId,action,valid:true};
  }catch(error){return{rowNumber:item.rowNumber,data:item.row,existingId:null,action:null,valid:false,error:error.message};}
 }
 function mapBatch(row){if(!row)return null;const storedRows=JSON.parse(row.rows_json);const rows=storedRows.map(item=>({...item.data,...item}));const errors=db.prepare('SELECT row_number AS rowNumber,message,row_json AS rowJson FROM import_errors WHERE batch_id=? ORDER BY row_number').all(row.id).map(e=>({rowNumber:e.rowNumber,message:e.message,row:e.rowJson?JSON.parse(e.rowJson):null}));return{batchId:row.id,type:row.type,format:row.format,contentHash:row.content_hash,collisionPolicy:row.collision_policy,status:row.status,rows,errors,summary:JSON.parse(row.summary_json),createdAt:row.created_at,committedAt:row.committed_at,committedBy:row.committed_by};}
 function getBatch(id){return mapBatch(db.prepare('SELECT * FROM import_batches WHERE id=?').get(String(id)));}
 function preview({type,format='csv',content,collisionPolicy='CREATE'}={}){
  const kind=String(type||'').toLowerCase();if(!supported.has(kind))throw new Error('Tipo de importacao invalido.');const fmt=String(format||'csv').toLowerCase();if(!['csv','xlsx'].includes(fmt))throw new Error('Formato de importacao invalido.');const policy=upper(collisionPolicy,'CREATE');if(!['CREATE','UPDATE','SKIP'].includes(policy))throw new Error('Politica de colisao invalida.');
  const raw=String(content??'');const hash=sha256(raw);const existing=db.prepare('SELECT * FROM import_batches WHERE type=? AND format=? AND content_hash=? AND collision_policy=?').get(kind,fmt,hash,policy);if(existing)return mapBatch(existing);
  let parsed;if(fmt==='csv')parsed=parseCsv(raw);else{let XLSX;try{XLSX=require('xlsx');}catch{throw new Error('Suporte XLSX requer dependencia xlsx instalada.');}const wb=XLSX.read(Buffer.from(raw,'base64'),{type:'buffer'});const sheet=wb.Sheets[wb.SheetNames[0]];parsed=XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false}).map((row,i)=>({rowNumber:i+2,row}));}
  const rows=parsed.map(item=>rowForPreview(kind,item,policy));const errors=rows.filter(r=>!r.valid).map(r=>({rowNumber:r.rowNumber,message:r.error,row:r.data}));const summary={total:rows.length,valid:rows.length-errors.length,invalid:errors.length,create:rows.filter(r=>r.valid&&r.action==='CREATE').length,update:rows.filter(r=>r.valid&&r.action==='UPDATE').length,skip:rows.filter(r=>r.valid&&r.action==='SKIP').length};
  const id=idFactory('import');const timestamp=now();db.prepare(`INSERT INTO import_batches(id,type,format,content_hash,collision_policy,status,rows_json,summary_json,created_at) VALUES(?,?,?,?,?,'PREVIEWED',?,?,?)`).run(id,kind,fmt,hash,policy,JSON.stringify(rows),JSON.stringify(summary),timestamp);const insert=db.prepare('INSERT INTO import_errors(batch_id,row_number,message,row_json) VALUES(?,?,?,?)');for(const e of errors)insert.run(id,e.rowNumber,e.message,JSON.stringify(e.row));return getBatch(id);
 }
 function applyRow(batch,row,actor){if(row.action==='SKIP')return;if(batch.type==='products'){catalog.upsertProduct({...row.data,id:row.existingId||undefined},actor);return;}if(batch.type==='categories'){catalog.upsertCategory({...row.data,id:row.existingId||undefined},actor);return;}if(batch.type==='customers'){catalog.upsertCustomer({...row.data,id:row.existingId||undefined},actor);return;}if(batch.type==='suppliers'){catalog.upsertSupplier({...row.data,id:row.existingId||undefined},actor);return;}if(batch.type==='inventory'){const productId=row.existingId;const current=inventory.getBalance(productId);const delta=Number((row.data.quantity-current).toFixed(3));if(delta!==0)inventory.move({productId,type:current===0?'opening':(delta>0?'adjustment-in':'adjustment-out'),quantityDelta:delta,reason:'Importacao de estoque inicial',sourceType:'import',sourceId:batch.batchId},actor);}}
 function commit(batchId,{actor={}}={}){
  const batch=getBatch(batchId);if(!batch)throw new Error('Lote de importacao nao encontrado.');if(batch.status==='COMMITTED')return batch;if(batch.status!=='PREVIEWED')throw new Error('Lote nao esta em preview.');if(batch.errors.length)throw new Error('Lote de importacao possui erros e nao pode ser confirmado.');if(authorization)authorization.require({principal:principalFromActor(actor),capability:'products.manage'});
  try{
   withTransaction(db,()=>{
    for(const row of batch.rows)applyRow(batch,row,actor);
    const timestamp=now();db.prepare("UPDATE import_batches SET status='COMMITTED',committed_at=?,committed_by=? WHERE id=? AND status='PREVIEWED'").run(timestamp,actor.userId||null,batch.batchId);
    writeAudit(db,{action:'import.commit',entity:'import',entityId:batch.batchId,actor,context:{type:batch.type,summary:batch.summary}},now);
   });
   return getBatch(batch.batchId);
  }catch(error){db.prepare("UPDATE import_batches SET status='FAILED' WHERE id=? AND status='PREVIEWED'").run(batch.batchId);throw error;}
 }
 return{preview,commit,getBatch};
}
module.exports={createImportService,parseCsv,ensureImportTables};
