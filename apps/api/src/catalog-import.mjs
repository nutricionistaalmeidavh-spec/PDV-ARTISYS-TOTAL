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
export function createCatalogImportService(h){
 const {q,first,batch,applied,audit,stamp,branchExists,requiredMutation,error,text,randomId}=h;
 async function preview(tenant,branch,body){
  await branchExists(tenant,branch);
  const parsed=parseCatalogCsv(body?.csv,error);
  const skuCounts=new Map(),barcodeCounts=new Map();
  const normalized=parsed.map(({line,raw,extraColumns})=>{
    const sku=raw.sku?.toUpperCase()||'',name=text(raw.name,120),
      barcode=raw.barcode||null,brand=text(raw.brand||'',100),
      unit=(raw.unit||'UN').toUpperCase(),
      cost=Number(raw.salepricecents),categoryId=raw.categoryid||null,
      trackRaw=(raw.trackstock||'true').toLowerCase();
    const errors=[];
    if(extraColumns)errors.push('Número de colunas diferente do cabeçalho.');
    if(!/^[A-Z0-9][A-Z0-9._-]{0,63}$/.test(sku))errors.push('SKU inválido.');
    if(name.length<2)errors.push('Nome muito curto.');
    if(!/^\d+$/.test(raw.salepricecents||'')||!Number.isSafeInteger(cost)||cost>1000000000)
      errors.push('Preço deve estar em centavos inteiros não negativos.');
    if(!UNIT_CODES.has(unit))errors.push('Unidade não permitida.');
    if(barcode&&!/^[A-Za-z0-9._-]{4,80}$/.test(barcode))errors.push('Código de barras inválido.');
    if(!['true','false'].includes(trackRaw))errors.push('trackStock deve ser true ou false.');
    if(sku)skuCounts.set(sku,(skuCounts.get(sku)||0)+1);
    if(barcode)barcodeCounts.set(barcode,(barcodeCounts.get(barcode)||0)+1);
    return {line,sku,name,salePriceCents:cost,unit,barcode,brand,trackStock:trackRaw==='true',
      categoryId,errors};
  });
  for(const row of normalized){
    if(skuCounts.get(row.sku)>1)row.errors.push('SKU duplicado dentro do CSV.');
    if(row.barcode&&barcodeCounts.get(row.barcode)>1)row.errors.push('Código de barras duplicado no CSV.');
    if(row.categoryId){
      const cat=await first('SELECT 1 AS ok FROM product_categories WHERE tenant_id=? AND id=?',tenant,row.categoryId);
      if(!cat)row.errors.push('Categoria não pertence à empresa.');
    }
    if(row.sku&&await first('SELECT 1 AS ok FROM products WHERE tenant_id=? AND sku=?',tenant,row.sku))
      row.errors.push('SKU já existe no catálogo.');
    if(row.barcode&&await first('SELECT 1 AS ok FROM products WHERE tenant_id=? AND barcode=?',tenant,row.barcode))
      row.errors.push('Código de barras já existe no catálogo.');
  }
  const invalidRows=normalized.filter(x=>x.errors.length).length;
  return {totalRows:normalized.length,validRows:normalized.length-invalidRows,
    invalidRows,rows:normalized.map(r=>({...r,valid:r.errors.length===0}))};
 }
 return {
  preview,
  async commit(tenant,branch,user,body,header){
   await branchExists(tenant,branch);
   const key=requiredMutation(body,header),scope='catalog.csv.import:'+branch;
   const previous=await applied(tenant,scope,key);
   if(previous)return previous;
   const p=await preview(tenant,branch,body);
   if(p.invalidRows)throw error(409,'Corrija as linhas inválidas na prévia antes de importar.');
   const at=stamp(),ids=[];
   const statements=p.rows.map(row=>{
     const id=randomId();ids.push(id);
     return q(`INSERT INTO products(id,tenant_id,sku,name,sale_price_cents,unit,
       track_stock,created_at,updated_at,brand,barcode,category_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,id,tenant,row.sku,row.name,row.salePriceCents,row.unit,
       row.trackStock?1:0,at,at,row.brand,row.barcode,row.categoryId);
   });
   const result={createdCount:ids.length,productIds:ids,createdAt:at};
   statements.push(audit(tenant,scope,key,result));
   await batch(statements);
   return result;
  }
 };
}
