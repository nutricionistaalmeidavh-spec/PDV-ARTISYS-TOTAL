'use strict';
// Offline, dependency-free XLSX (OOXML + ZIP Store). No external converter or SaaS.
(function initReportsSpreadsheet(root){
  const encoder=new TextEncoder();
  const MIME='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'')
    .replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[ch]));
  const makeTable=(headers,rows)=>{
    if(!Array.isArray(headers)||!headers.length||headers.length>50)throw Error('Colunas de relatório inválidas.');
    if(!Array.isArray(rows)||rows.length>10000)throw Error('Mais de 10 mil linhas. Divida o período para exportar.');
    const col=n=>{let out='';for(let x=n+1;x>0;x=Math.floor((x-1)/26))out=String.fromCharCode(65+(x-1)%26)+out;return out;};
    const render=(values,rowIndex)=>'<row r="'+rowIndex+'">'+values.map((v,i)=>{
      const ref=col(i)+' '+rowIndex;
      const cell=ref.replace(' ','');
      if(typeof v==='number'&&Number.isFinite(v))return '<c r="'+cell+'"><v>'+v+'</v></c>';
      const text=String(v??'');
      if(text.length>32767)throw Error('Uma célula excede o limite do Excel. Reduza o período.');
      // Inline strings cannot execute spreadsheet formulas, even when starting with =, +, -, or @.
      return '<c r="'+cell+'" t="inlineStr"><is><t xml:space="preserve">'+xml(text)+'</t></is></c>';
    }).join('')+'</row>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'+
      '<sheetData>'+render(headers,1)+rows.map((row,i)=>{
        if(!Array.isArray(row)||row.length!==headers.length)throw Error('Linha de relatório incompatível com cabeçalho.');
        return render(row,i+2);
      }).join('')+'</sheetData></worksheet>';
  };
  const crcTable=new Uint32Array(256);
  for(let i=0;i<256;i++){let x=i;for(let j=0;j<8;j++)x=x&1?(x>>>1)^0xEDB88320:x>>>1;crcTable[i]=x>>>0;}
  const crc32=data=>{let c=0xFFFFFFFF;for(const b of data)c=crcTable[(c^b)&255]^(c>>>8);return(c^0xFFFFFFFF)>>>0;};
  const u16=(n)=>[n&255,(n>>>8)&255],u32=(n)=>[n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255];
  function zip(files){
    const parts=[],central=[];let offset=0;
    for(const [path,source] of files){
      const name=encoder.encode(path),data=encoder.encode(source),checksum=crc32(data);
      if(data.length>0xFFFFFFFF)throw Error('Planilha grande demais.');
      const local=new Uint8Array([80,75,3,4,20,0,0,0,0,0,0,0,33,0,...u32(checksum),
        ...u32(data.length),...u32(data.length),...u16(name.length),0,0]);
      parts.push(local,name,data);
      central.push(new Uint8Array([80,75,1,2,20,0,20,0,0,0,0,0,0,0,33,0,...u32(checksum),
        ...u32(data.length),...u32(data.length),...u16(name.length),0,0,0,0,0,0,0,0,0,0,0,0,...u32(offset)]),name);
      offset+=local.length+name.length+data.length;
    }
    const centralLength=central.reduce((sum,item)=>sum+item.length,0);
    const footer=new Uint8Array([80,75,5,6,0,0,0,0,...u16(files.length),...u16(files.length),
      ...u32(centralLength),...u32(offset),0,0]);
    const total=offset+centralLength+footer.length;
    const bytes=new Uint8Array(total);let index=0;
    for(const part of [...parts,...central,footer]){bytes.set(part,index);index+=part.length;}
    return bytes;
  }
  function buildXlsx(headers,rows,{sheetName='Relatório'}={}){
    const name=String(sheetName).replace(/[:\\/?*\[\]]/g,' ').trim().slice(0,31)||'Relatório';
    return zip([
      ['[Content_Types].xml','<?xml version="1.0" encoding="UTF-8"?>'+
       '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'+
       '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'+
       '<Default Extension="xml" ContentType="application/xml"/>'+
       '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'+
       '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'],
      ['_rels/.rels','<?xml version="1.0" encoding="UTF-8"?>'+
       '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
       '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml','<?xml version="1.0" encoding="UTF-8"?>'+
       '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
       '<sheets><sheet name="'+xml(name)+'" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels','<?xml version="1.0" encoding="UTF-8"?>'+
       '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+
       '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'],
      ['xl/worksheets/sheet1.xml',makeTable(headers,rows)]
    ]);
  }
  function parseCsv(text){
    const source=String(text??'').replace(/^\uFEFF/,'');const result=[];let row=[],value='',quoted=false;
    for(let i=0;i<source.length;i++){
      const ch=source[i];
      if(quoted){
        if(ch==='"'&&source[i+1]==='"'){value+='"';i++;}
        else if(ch==='"')quoted=false;
        else value+=ch;
      }else if(ch==='"'&&value==='')quoted=true;
      else if(ch===';'){row.push(value);value='';}
      else if(ch==='\n'||ch==='\r'){
        if(ch==='\r'&&source[i+1]==='\n')i++;
        row.push(value);if(row.some(v=>v!==''))result.push(row);
        row=[];value='';
      }else value+=ch;
    }
    if(quoted)throw Error('CSV inválido: aspas não fechadas.');
    if(row.length||value!==''){row.push(value);result.push(row);}
    const [headers=[],...rows]=result;
    if(!headers.length)throw Error('Relatório vazio, sem cabeçalhos.');
    if(rows.some(r=>r.length!==headers.length))throw Error('CSV possui colunas inconsistentes.');
    // Quantities and BRL amounts from the canonical detailed export; other fields remain text.
    const numeric=headers.map(h=>h==='Quantidade'||/\(R\$\)$/.test(h));
    return {headers,rows:rows.map(row=>row.map((v,i)=>{
      if(numeric[i]&&/^-?\d+(?:,\d+)?$/.test(v))return Number(v.replace(',','.'));
      return v;
    }))};
  }
  function download(name,headers,rows,options){
    const bytes=buildXlsx(headers,rows,options);
    const url=URL.createObjectURL(new Blob([bytes],{type:MIME}));
    const link=document.createElement('a');link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  root.PdvReportXlsx=Object.freeze({buildXlsx,parseCsv,download,MIME});
})(typeof window!=='undefined'?window:globalThis);
