import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {TextDecoder,TextEncoder} from 'node:util';

const source=readFileSync(new URL('../apps/web/report-xlsx.js',import.meta.url),'utf8');
const root={};
runInNewContext(source,{window:root,TextEncoder,Uint32Array,Uint8Array,Blob,URL,setTimeout});
const {buildXlsx,parseCsv,MIME}=root.PdvReportXlsx;

function unzipStore(bytes){
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const decode=new TextDecoder();const entries=new Map();let offset=0;
  while(offset+30<=bytes.length&&view.getUint32(offset,true)===0x04034b50){
    const size=view.getUint32(offset+18,true);
    const length=view.getUint16(offset+26,true);
    const extra=view.getUint16(offset+28,true);
    const name=decode.decode(bytes.subarray(offset+30,offset+30+length));
    const start=offset+30+length+extra;
    entries.set(name,decode.decode(bytes.subarray(start,start+size)));
    offset=start+size;
  }
  assert.equal(view.getUint32(offset,true),0x02014b50,'ZIP central directory must start after local entries');
  return entries;
}
test('XLSX uses a standards-based local ZIP and OOXML package with UTF-8 accents',()=>{
  const bytes=buildXlsx(['Produto','Saldo','Etiqueta'],[['Açúcar',2.5,'A&B <"a">']],{sheetName:'Cobertura do estoque'});
  const files=unzipStore(bytes);
  assert.deepEqual([...files.keys()],['[Content_Types].xml','_rels/.rels','xl/workbook.xml',
    'xl/_rels/workbook.xml.rels','xl/worksheets/sheet1.xml']);
  assert.match(files.get('xl/workbook.xml'),/Cobertura do estoque/);
  const sheet=files.get('xl/worksheets/sheet1.xml');
  assert.match(sheet,/<c r="B2"><v>2.5<\/v><\/c>/);
  assert.match(sheet,/Açúcar/);
  assert.match(sheet,/A&amp;B &lt;&quot;a&quot;&gt;/);
  assert.equal(MIME,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
});
test('CSV quoted multiline, delimiters, escaped quotes and locale amounts are preserved',()=>{
  const csv='\uFEFF"Produto";"Quantidade";"Preço unitário (R$)";"SKU"\r\n'+
    '"Pão; ""da casa""\nEspecial";"1,5";"12,35";"00123"\r\n';
  const result=parseCsv(csv);
  assert.deepEqual([...result.headers],['Produto','Quantidade','Preço unitário (R$)','SKU']);
  assert.deepEqual(Array.from(result.rows[0]),['Pão; "da casa"\nEspecial',1.5,12.35,'00123']);
  const sheet=unzipStore(buildXlsx(result.headers,result.rows)).get('xl/worksheets/sheet1.xml');
  assert.match(sheet,/00123/);
  assert.match(sheet,/<c r="C2"><v>12.35<\/v><\/c>/);
});
test('User-controlled fields are XML-escaped and never run as spreadsheet formula',()=>{
  const sheet=unzipStore(buildXlsx(['Texto'],[['=HYPERLINK("http://evil","click")'],['+SUM(1,2)'],['@evil'],['<tag>&']]))
    .get('xl/worksheets/sheet1.xml');
  assert.doesNotMatch(sheet,/<f[ >]/);
  assert.match(sheet,/t="inlineStr"/);
  assert.match(sheet,/=HYPERLINK\(&quot;http:\/\/evil/);
  assert.match(sheet,/&lt;tag&gt;&amp;/);
});
test('Export refuses truncation or inconsistent rows instead of claiming completeness',()=>{
  assert.throws(()=>buildXlsx(['SKU'],Array.from({length:10001},()=>['a'])),/10 mil/);
  assert.throws(()=>buildXlsx(['SKU','Saldo'],[['a']]),/incompatível/);
  assert.throws(()=>parseCsv('"A";"B"\r\n"x"\r\n'),/inconsistentes/);
  assert.throws(()=>parseCsv('"A";"B"\r\n"x";"não fechou'),/não fechadas/);
});
