import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const source=readFileSync(new URL('../../web/peripherals-web.js',import.meta.url),'utf8');
function browser(){
  const opened=[];
  const store=new Map();
  const win={
    isSecureContext:true,
    navigator:{},
    localStorage:{getItem:key=>store.get(key)||null,setItem:(key,value)=>store.set(key,value)},
    document:{addEventListener(){}},
    open(){
      const popup={document:{open(){},write(text){popup.html=text;},close(){}},focus(){},print(){popup.printed=true;}};
      opened.push(popup);
      return popup;
    }
  };
  runInNewContext(source,{window:win,TextEncoder,TextDecoder,Uint8Array,FormData,setTimeout,clearTimeout});
  return {window:win,opened};
}
test('balança genérica aceita resposta completa em kg ou gramas e rejeita fragmentos',()=>{
  const {window:w}=browser(),p=w.PdvWebHardwareUtils.parseWeight;
  assert.equal(p('1,250 kg').weight,1.25);
  assert.equal(p('1250 g').weight,1.25);
  for(const raw of ['1.','', 'ESTAVEL?', '-2kg', '9001kg','1kgfoobar']){
    assert.throws(()=>p(raw));
  }
});
test('preferências do periférico são restritas e locais ao navegador',()=>{
  const {window:w}=browser();
  const saved=w.PdvWebHardware.saveSettings({paperMm:500,scaleBaud:Infinity,printerMode:'unsafe',secret:'not-supported'});
  assert.equal(saved.paperMm,80);
  assert.equal(saved.scaleBaud,9600);
  assert.equal(saved.printerMode,'browser');
  assert.equal(w.PdvWebHardware.settings().secret,undefined);
});
test('comprovante web só aceita venda concluída e escapa entradas',()=>{
  const {window:w}=browser();
  const sale={id:'sale-1',status:'COMPLETED',saleNumber:'A-1',items:[{productName:'<script>alert(1)</script>',quantity:1,totalCents:1000,unitPriceCents:1000}],totalCents:1000,changeCents:0,payments:[{method:'CASH',amountCents:1000}]};
  const html=w.PdvWebHardwareUtils.receiptHtml(sale,{paperMm:58});
  assert.match(html,/58mm auto/);
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.throws(()=>w.PdvWebHardwareUtils.receiptHtml({...sale,status:'OPEN'}));
});
test('diálogo de impressão não altera a venda nem afirma sucesso físico',async()=>{
  const {window:w,opened}=browser();
  const sale={id:'v1',status:'COMPLETED',saleNumber:13,items:[],payments:[],totalCents:100,changeCents:0};
  const result=await w.PdvWebHardware.printSale(sale);
  assert.equal(result.dialogOpened,true);
  assert.equal(opened.length,1);
  assert.equal(opened[0].printed,true);
  assert.equal(sale.status,'COMPLETED');
});
test('ESC/POS conserva quebras e emite apenas bytes de comandos esperados',()=>{
  const {window:w}=browser();
  const bytes=w.PdvWebHardwareUtils.escpos('Ação\n',{cut:true});
  assert.equal(bytes[0],27);
  assert.equal(bytes[1],64);
  assert.ok(bytes.includes(10));
  assert.equal(bytes.at(-3),29);
  assert.equal(bytes.at(-2),86);
  assert.equal(bytes.at(-1),0);
});
test('sem permissão explícita não tenta ler porta física',async()=>{
  const {window:w}=browser();
  await assert.rejects(w.PdvWebHardware.readWeight(),/Porta serial requer/);
});
