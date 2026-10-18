// Local OOXML-to-CSV adapter. No upload to third parties and no second catalog.
// All rows still pass through the existing server-side CSV preview/atomic commit.
'use strict';
((root)=>{
  const MAX_FILE=512*1024,MAX_XML=512*1024,MAX_TOTAL=1500*1024,MAX_ROWS=100;
  const fail=message=>{throw new Error('Importação XLSX: '+message);};
  const decoder=new TextDecoder('utf-8',{fatal:true});
  function archiveEntries(bytes){
    if(bytes.length<22||bytes.length>MAX_FILE)fail('arquivo vazio ou maior que 512 KB.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    const u16=p=>view.getUint16(p,true),u32=p=>view.getUint32(p,true);
    let end=-1;
    for(let p=bytes.length-22;p>=Math.max(0,bytes.length-22-65535);p--){
      if(u32(p)===0x06054b50&&p+22+u16(p+20)===bytes.length){end=p;break;}
    }
    if(end<0||u16(end+4)||u16(end+6)||u16(end+8)!==u16(end+10))
      fail('estrutura ZIP inválida ou arquivo multidisco.');
    const count=u16(end+10),centralLength=u32(end+12),centralOffset=u32(end+16);
    if(!count||count>128||centralOffset+centralLength>end)fail('diretório ZIP inválido.');
    const entries=new Map();let cursor=centralOffset,total=0;
    for(let i=0;i<count;i++){
      if(cursor+46>end||u32(cursor)!==0x02014b50)fail('entrada ZIP inválida.');
      const flags=u16(cursor+8),method=u16(cursor+10),compressed=u32(cursor+20),
        expanded=u32(cursor+24),n=u16(cursor+28),e=u16(cursor+30),
        comment=u16(cursor+32),offset=u32(cursor+42);
      if(flags&1||![0,8].includes(method)||compressed===0xffffffff||expanded===0xffffffff)
        fail('compactação ou criptografia XLSX não suportada.');
      const name=decoder.decode(bytes.subarray(cursor+46,cursor+46+n));
      if(name.includes('..')||name.startsWith('/')||name.includes('\\')||entries.has(name))
        fail('nome de arquivo interno inválido.');
      if(offset+30>centralOffset||u32(offset)!==0x04034b50)fail('cabeçalho ZIP inválido.');
      const start=offset+30+u16(offset+26)+u16(offset+28);
      if(start+compressed>centralOffset)fail('arquivo ZIP truncado.');
      total+=expanded;
      if(total>MAX_TOTAL)fail('planilha descompactada excede o limite permitido.');
      entries.set(name,{method,expanded,content:bytes.slice(start,start+compressed)});
      cursor+=46+n+e+comment;
    }
    if(cursor!==centralOffset+centralLength)fail('diretório ZIP inconsistente.');
    return entries;
  }
  async function unpack(entry){
    if(!entry||entry.expanded>MAX_XML)fail('XML ausente ou muito grande.');
    if(entry.method===0){
      if(entry.content.length!==entry.expanded)fail('arquivo XLSX truncado.');
      return decoder.decode(entry.content);
    }
    if(typeof DecompressionStream!=='function')
      fail('seu navegador não permite descompactar XLSX offline; utilize CSV.');
    let reader;
    try{reader=new Blob([entry.content]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();}
    catch{fail('compactação não suportada neste navegador; utilize CSV.');}
    const chunks=[];let size=0;
    try{
      for(;;){
        const {value,done}=await reader.read();
        if(done)break;
        size+=value.length;
        if(size>MAX_XML||size>entry.expanded){await reader.cancel();fail('planilha excede o tamanho declarado.');}
        chunks.push(value);
      }
    }catch(e){fail('falha ao descompactar XLSX ('+e.message+').');}
    if(size!==entry.expanded)fail('tamanho do XML incompatível.');
    const joined=new Uint8Array(size);let at=0;
    for(const chunk of chunks){joined.set(chunk,at);at+=chunk.length;}
    return decoder.decode(joined);
  }
  function parseXml(xml){
    if(/<!DOCTYPE|<!ENTITY/i.test(xml))fail('DTD e entidades XML externas são proibidas.');
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.getElementsByTagName('parsererror').length)fail('estrutura XML inválida.');
    return doc;
  }
  const tags=(node,name)=>Array.from(node.getElementsByTagNameNS('*',name));
  const textValue=(node)=>tags(node,'t').map(n=>n.textContent||'').join('');
  function indexOfColumn(ref){
    const match=/^([A-Z]{1,3})[1-9]\d*$/.exec(ref);
    if(!match)fail('referência de célula inválida.');
    let index=0;
    for(const ch of match[1])index=index*26+ch.charCodeAt(0)-64;
    if(index>16)fail('máximo de 16 colunas por planilha de catálogo.');
    return index-1;
  }
  function cellValue(cell,strings){
    if(tags(cell,'f').length)fail('células com fórmulas não são permitidas; substitua por valores.');
    const kind=cell.getAttribute('t')||'n';
    if(kind==='inlineStr')return textValue(cell);
    const value=tags(cell,'v')[0]?.textContent||'';
    if(kind==='s'){
      if(!/^\d+$/.test(value)||Number(value)>=strings.length)fail('índice de texto compartilhado inválido.');
      return strings[Number(value)];
    }
    if(!['n','str','b','e'].includes(kind))fail('tipo de célula XLSX não suportado.');
    if(kind==='e')fail('célula com erro no XLSX.');
    return value;
  }
  async function firstWorkbookSheet(entries){
    // Excel's first visible/logical sheet may live at sheet2.xml, sheet7.xml, etc.
    // Resolving a hard-coded filename can import the wrong goods and prices.
    const workbook=parseXml(await unpack(entries.get('xl/workbook.xml')));
    const first=tags(workbook,'sheet')[0];
    const relationId=first?.getAttributeNS(
      'http://schemas.openxmlformats.org/officeDocument/2006/relationships','id'
    )||first?.getAttribute('r:id');
    if(!relationId)fail('primeira aba sem relacionamento no workbook.');
    const relations=parseXml(await unpack(entries.get('xl/_rels/workbook.xml.rels')));
    const matched=tags(relations,'Relationship').filter(node=>node.getAttribute('Id')===relationId);
    if(matched.length!==1)fail('relacionamento da primeira aba ausente ou duplicado.');
    const relation=matched[0];
    if(relation.getAttribute('Type')!==
       'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet')
      fail('a primeira aba não é uma planilha de células válida.');
    if(relation.getAttribute('TargetMode')==='External')
      fail('referências externas de planilhas não são permitidas.');
    const target=relation.getAttribute('Target')||'';
    // Only OOXML worksheet paths inside this ZIP are allowed: never URLs,
    // network shares, encoded traversal, directories or alternate protocols.
    let path;
    if(/^worksheets\/[A-Za-z0-9._-]+\.xml$/.test(target))path='xl/'+target;
    else if(/^\/?xl\/worksheets\/[A-Za-z0-9._-]+\.xml$/.test(target))
      path=target.replace(/^\//,'');
    else fail('caminho da primeira aba inválido.');
    if(!entries.has(path))fail('arquivo da primeira aba não encontrado.');
    return entries.get(path);
  }
  function safeCsv(value){
    const raw=String(value??'');
    if(/^[\t\r\n ]*[=+@]/.test(raw))fail('célula com possível fórmula CSV; converta para texto literal.');
    return '"'+raw.replace(/"/g,'""')+'"';
  }
  async function toCsv(input){
    const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
    const entries=archiveEntries(bytes);
    const sheet=await firstWorkbookSheet(entries);
    const shared=entries.get('xl/sharedStrings.xml');
    const strings=shared?tags(parseXml(await unpack(shared)),'si').map(textValue):[];
    const parsed=parseXml(await unpack(sheet));
    const sheetData=tags(parsed,'sheetData')[0];
    if(!sheetData)fail('aba sem dados.');
    const rows=tags(sheetData,'row');
    if(rows.length>MAX_ROWS+1)fail('máximo de 100 produtos por arquivo.');
    const output=[];
    for(const row of rows){
      const cells=tags(row,'c');
      if(cells.length>16)fail('quantidade de colunas excedida.');
      const values=[],seen=new Set();
      for(const cell of cells){
        const col=indexOfColumn(cell.getAttribute('r')||'');
        if(seen.has(col))fail('coluna repetida na linha.');
        seen.add(col);values[col]=cellValue(cell,strings);
      }
      if(values.some(v=>String(v||'').trim()))output.push(values);
    }
    if(output.length<2||output.length>MAX_ROWS+1)fail('informe cabeçalho e de 1 a 100 produtos.');
    const header=output[0].map(x=>String(x||'').trim().toLowerCase());
    if(!header.includes('sku')||!header.includes('name')||!header.includes('salepricecents'))
      fail('colunas obrigatórias: sku, name e salePriceCents.');
    const csv=output.map(row=>Array.from({length:header.length},(_,index)=>safeCsv(row[index]||'')).join(';')).join('\n')+'\n';
    if(csv.length>13500)fail('conteúdo acima do limite do importador; divida a planilha.');
    return csv;
  }
  root.PdvCatalogXlsx=Object.freeze({toCsv});
})(window);
