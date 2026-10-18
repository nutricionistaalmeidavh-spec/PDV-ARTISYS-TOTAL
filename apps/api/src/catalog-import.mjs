// CSV catalogue import is a preview-then-commit adapter over products, not a
// second catalogue. Explicit cents, no ambiguous locale-priced inputs.
const UNIT_CODES=new Set(['UN','KG','G','L','M','M2','M3','CX','PCT']);
const FIELDS=['sku','name','salepricecents','unit','barcode','brand','trackstock','categoryid'];
function parseCatalogCsv(csv,error){
 if(typeof csv!=='string'||csv.length<10||csv.length>13500)
   throw error(400,'CSV inválido ou maior que 13.500 caracteres.');
 const source=csv.replace(/^\uFEFF/,'');
 const header=source.split(/\r?\n/,1)[0];
 const delimiter=(header.match(/;/g)||[]).length>=(header.match(/,/g)||[]).length?';':',';
 const rows=[];let record=[],field='',quoted=false,started=false;
 function addRecord(){
   record.push(field);
   if(record.some(x=>String(x).trim()!==''))rows.push(record);
   record=[];field='';started=false;
   if(rows.length>101)throw error(400,'CSV limitado a 100 produtos.');
 }
 for(let i=0;i<source.length;i++){
   const ch=source[i];
   if(quoted){
     if(ch==='"'){
       if(source[i+1]==='"'){field+='"';i++;}
       else quoted=false;
     }else field+=ch;
   }else if(ch==='"'){
     if(field!=='')throw error(400,'Aspas inválidas no CSV.');
     quoted=true;started=true;
   }else if(ch===delimiter){
     record.push(field);field='';started=false;
   }else if(ch==='\n'||ch==='\r'){
     addRecord();
     if(ch==='\r'&&source[i+1]==='\n')i++;
   }else{field+=ch;started=true;}
 }
 if(quoted)throw error(400,'Aspas não fechadas no CSV.');
 if(record.length||field) addRecord();
 if(rows.length<2)throw error(400,'CSV deve conter cabeçalho e ao menos um produto.');
 const headers=rows[0].map(x=>x.trim().toLowerCase());
 if(!headers.includes('sku')||!headers.includes('name')||!headers.includes('salepricecents'))
   throw error(400,'Cabeçalho CSV exige sku, name e salePriceCents.');
 if(new Set(headers).size!==headers.length||headers.some(x=>!FIELDS.includes(x)))
   throw error(400,'Cabeçalho CSV tem colunas desconhecidas ou repetidas.');
 return rows.slice(1).map((values,index)=>{
   const raw={};
   for(const [i,h] of headers.entries())raw[h]=String(values[i]??'').trim();
   return {line:index+2,raw,extraColumns:values.length!==headers.length};
 });
}
// "upsert" is explicit: legacy CSV imports always remain create-only.
// Existing rows are matched by immutable tenant-scoped SKU and retain stock/history.
const has=(obj,key)=>Object.prototype.hasOwnProperty.call(obj,key);
const snapshotToken=async(input)=>{
 const bytes=new TextEncoder().encode(JSON.stringify(input));
 const hash=await crypto.subtle.digest('SHA-256',bytes);
 return Array.from(new Uint8Array(hash),b=>b.toString(16).padStart(2,'0')).join('');
};
export function createCatalogImportService(h){
 const {q,first,batch,applied,audit,stamp,branchExists,requiredMutation,error,text,randomId}=h;
 async function preview(tenant,branch,body){
  await branchExists(tenant,branch);
  const mode=body?.mode??'create';
  if(!['create','upsert'].includes(mode))throw error(400,'Modo de importação inválido.');
  const parsed=parseCatalogCsv(body?.csv,error);
  const skuCounts=new Map();
  const normalized=[];
  const existingSnapshots=[];
  for(const {line,raw,extraColumns} of parsed){
   const sku=(raw.sku||'').toUpperCase(),name=text(raw.name,120),
     incomingBarcode=raw.barcode||null,unit=(raw.unit||'UN').toUpperCase(),
     price=Number(raw.salepricecents),categoryId=raw.categoryid||null,
     trackRaw=(raw.trackstock||'true').toLowerCase();
   const errors=[];
   if(extraColumns)errors.push('Número de colunas diferente do cabeçalho.');
   if(!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku))errors.push('SKU inválido.');
   if(name.length<2)errors.push('Nome muito curto.');
   if(!/^\d+$/.test(raw.salepricecents||'')||!Number.isSafeInteger(price)||price>1000000000)
     errors.push('Preço deve estar em centavos inteiros não negativos.');
   if(!UNIT_CODES.has(unit))errors.push('Unidade não permitida.');
   if(incomingBarcode&&!/^[A-Za-z0-9._-]{4,80}$/.test(incomingBarcode))errors.push('Código de barras inválido.');
   if(!['true','false'].includes(trackRaw))errors.push('trackStock deve ser true ou false.');
   if(sku)skuCounts.set(sku,(skuCounts.get(sku)||0)+1);
   const existing=sku?await first(`SELECT id,name,sku,unit,sale_price_cents,track_stock,active,brand,
      barcode,category_id,parent_product_id,variant_label,last_cost_cents,updated_at
      FROM products WHERE tenant_id=? AND sku=?`,tenant,sku):null;
   existingSnapshots.push(existing);
   const updating=mode==='upsert'&&!!existing;
   if(existing&&mode==='create')errors.push('SKU já existe no catálogo.');
   if(updating&&!existing.active)errors.push('Produto inativo. Reative o cadastro antes de importar.');
   if(updating&&has(raw,'unit')&&unit!==existing.unit)
     errors.push('Alteração da unidade de produto existente exige conversão auditada.');
   if(updating&&has(raw,'trackstock')&&(trackRaw==='true')!==Boolean(existing.track_stock))
     errors.push('Controle de estoque do produto existente não pode mudar.');
   const row={
     line,sku,name,salePriceCents:price,
     unit:updating&&!has(raw,'unit')?existing.unit:unit,
     barcode:updating&&!has(raw,'barcode')?existing.barcode||null:incomingBarcode,
     brand:updating&&!has(raw,'brand')?existing.brand||'':text(raw.brand||'',100),
     trackStock:updating&&!has(raw,'trackstock')?Boolean(existing.track_stock):trackRaw==='true',
     categoryId:updating&&!has(raw,'categoryid')?existing.category_id||null:categoryId,
     action:updating?'update':'create',productId:updating?existing.id:null,
     errors
   };
   normalized.push(row);
  }
  const barcodeCounts=new Map();
  for(const row of normalized)if(row.barcode)barcodeCounts.set(row.barcode,(barcodeCounts.get(row.barcode)||0)+1);
  for(const row of normalized){
   if(skuCounts.get(row.sku)>1)row.errors.push('SKU duplicado dentro do CSV.');
   if(row.barcode&&barcodeCounts.get(row.barcode)>1)
     row.errors.push('Código de barras duplicado dentro do CSV.');
   if(row.categoryId){
     const cat=await first('SELECT 1 AS ok FROM product_categories WHERE tenant_id=? AND id=?',tenant,row.categoryId);
     if(!cat)row.errors.push('Categoria não pertence à empresa.');
   }
   if(row.barcode){
     const holder=await first('SELECT id FROM products WHERE tenant_id=? AND barcode=?',tenant,row.barcode);
     if(holder&&holder.id!==row.productId)
       row.errors.push('Código de barras já existe em outro produto.');
   }
  }
  const invalidRows=normalized.filter(x=>x.errors.length).length;
  const result={mode,totalRows:normalized.length,validRows:normalized.length-invalidRows,
    invalidRows,createCount:normalized.filter(x=>x.action==='create').length,
    updateCount:normalized.filter(x=>x.action==='update').length,
    rows:normalized.map(r=>({...r,valid:r.errors.length===0}))};
  if(mode==='upsert')result.previewToken=await snapshotToken({
    tenant,branch,mode,csv:body.csv,rows:result.rows,existingSnapshots
  });
  return result;
 }
 return {
  preview,
  async commit(tenant,branch,user,body,header){
   await branchExists(tenant,branch);
   const mode=body?.mode??'create';
   if(!['create','upsert'].includes(mode))throw error(400,'Modo de importação inválido.');
   const key=requiredMutation(body,header),scope='catalog.csv.import:'+branch+(mode==='upsert'?':upsert':'');
   const previous=await applied(tenant,scope,key);
   if(previous)return previous;
   const p=await preview(tenant,branch,body);
   if(p.invalidRows)throw error(409,'Corrija as linhas inválidas na prévia antes de importar.');
   if(mode==='upsert'&&(typeof body?.previewToken!=='string'||body.previewToken!==p.previewToken))
     throw error(409,'O catálogo mudou após a prévia. Valide o CSV novamente antes de gravar.');
   const at=stamp(),createdIds=[],updatedIds=[],statements=[];
   for(const row of p.rows){
     if(row.action==='update'){
       updatedIds.push(row.productId);
       statements.push(q(`UPDATE products SET name=?,sale_price_cents=?,brand=?,barcode=?,category_id=?,updated_at=?
         WHERE tenant_id=? AND id=? AND sku=? AND active=1`,
         row.name,row.salePriceCents,row.brand,row.barcode,row.categoryId,at,tenant,row.productId,row.sku));
     }else{
       const id=randomId();createdIds.push(id);
       statements.push(q(`INSERT INTO products(id,tenant_id,sku,name,sale_price_cents,unit,
         track_stock,created_at,updated_at,brand,barcode,category_id)
         VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,id,tenant,row.sku,row.name,row.salePriceCents,row.unit,
         row.trackStock?1:0,at,at,row.brand,row.barcode,row.categoryId));
     }
   }
   const result={createdCount:createdIds.length,updatedCount:updatedIds.length,
     productIds:createdIds,updatedProductIds:updatedIds,createdAt:at};
   statements.push(audit(tenant,scope,key,result));
   await batch(statements);
   return result;
  }
 };
}
