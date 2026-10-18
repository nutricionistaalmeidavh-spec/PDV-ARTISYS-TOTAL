import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../../web/receipt-branding.js',import.meta.url),'utf8');
const peripheral=readFileSync(new URL('../../web/peripherals-web.js',import.meta.url),'utf8');
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfWQAAAAASUVORK5CYII=';
const sale=()=>({id:'sale-r3',status:'COMPLETED',saleNumber:'0003',completedAt:'2026-10-18',items:[],payments:[],totalCents:1230,changeCents:0});
function browser(){
  const stored=new Map();
  let context={tenantId:'t1',branchId:'b1'};
  const root={atob,localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},isSecureContext:true,
    navigator:{},document:{addEventListener(){}},
    PdvApiClient:{ApiClient:class{get tenantId(){return context.tenantId;}get branchId(){return context.branchId;}}}};
  runInNewContext(source,{window:root,Uint8Array});
  runInNewContext(peripheral,{window:root,TextEncoder,TextDecoder,Uint8Array,FormData,setTimeout,clearTimeout});
  return {root,stored,setContext:v=>{context=v;}};
}
test('cap-030 R3: store name, address, phone and validated PNG logo persist per tenant and branch and render only on completed receipts',()=>{
  const {root,stored,setContext}=browser();
  const branding=root.PdvReceiptBranding.write({name:'Loja R3',address:'Rua 1, 55',phone:'(16) 99999-9999',logoDataUrl:PNG});
  assert.equal(branding.logoDataUrl,PNG);
  const html=root.PdvWebHardwareUtils.receiptHtml(sale(),{paperMm:58});
  const text=root.PdvWebHardwareUtils.receiptText(sale());
  assert.match(html,/Loja R3/);
  assert.match(html,/Rua 1, 55/);
  assert.match(html,/\(16\) 99999-9999/);
  assert.match(html,/<img class="receipt-logo" src="data:image\/png;base64,/);
  assert.match(text,/Loja R3/);
  assert.match(text,/Telefone: \(16\) 99999-9999/);
  assert.equal(stored.size,1);
  setContext({tenantId:'t1',branchId:'b2'});
  assert.equal(root.PdvReceiptBranding.read().name,'PDV TOTAL');
  setContext({tenantId:'t2',branchId:'b1'});
  assert.equal(root.PdvReceiptBranding.read().logoDataUrl,null);
  assert.throws(()=>root.PdvWebHardwareUtils.receiptHtml({...sale(),status:'OPEN'}));
});
test('cap-030 R3: malicious branding cannot inject HTML, line breaks or SVG logo',()=>{
  const {root,setContext}=browser();
  const logo=root.PdvReceiptBranding.normalize({logoDataUrl:'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='});
  assert.equal(logo.logoDataUrl,null);
  assert.equal(root.PdvReceiptBranding.normalize({logoDataUrl:'data:image/png;base64,aGVsbG8='}).logoDataUrl,null);
  root.PdvReceiptBranding.write({name:'<script>bad</script>\n Loja',address:'Rua\n 2',phone:'111\t222',
    logoDataUrl:'data:text/html;base64,PHNjcmlwdD4='});
  const html=root.PdvWebHardwareUtils.receiptHtml(sale());
  assert.match(html,/&lt;script&gt;bad&lt;\/script&gt;/);
  assert.doesNotMatch(html,/<script>bad<\/script>/);
  assert.doesNotMatch(html,/src="data:text\/html/);
  assert.equal(root.PdvReceiptBranding.read().address,'Rua 2');
  assert.equal(root.PdvReceiptBranding.read().phone,'111 222');
  setContext({tenantId:null,branchId:null});
  assert.throws(()=>root.PdvReceiptBranding.write({name:'unauthorized'}),/estabelecimento|filial/i);
});
