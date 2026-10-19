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


test('Urano POP-S lê apenas PESO L de USE-CB2 e ignora a tara',()=>{
  const {window:w}=browser();
  const raw='DATA: 00/00/00 TARA:   0.500kg      PESO L:  1.542kg      R$/kg: 0.00';
  assert.equal(w.PdvWebHardwareUtils.parseUranoWeight(new TextEncoder().encode(raw)),1.542);
});
test('Urano POP-S lê os frames binários completos USE-P2',()=>{
  const {window:w}=browser(),parse=w.PdvWebHardwareUtils.parseUranoWeight;
  function frame(weight){
    const bytes=new Uint8Array(56).fill(0x20);
    bytes[0]=27;bytes.set(new TextEncoder().encode('T2'),1);
    bytes[3]=27;bytes[4]=66;bytes[5]=27;bytes.set(new TextEncoder().encode('N0'),6);
    bytes.set(new TextEncoder().encode(weight.padStart(6,' ')),18);
    bytes.set(new TextEncoder().encode('kg'),24);
    bytes[51]=27;bytes[52]=69;bytes[53]=27;bytes.set(new TextEncoder().encode('P1'),54);
    return bytes;
  }
  assert.equal(parse(frame('1.250')),1.25);
  assert.equal(parse(frame('0.000')),0);
});
test('Urano POP-S rejeita frames incompletos, resposta numérica solta e tara',()=>{
  const {window:w}=browser(),parse=w.PdvWebHardwareUtils.parseUranoWeight;
  for (const frame of ['1.250','TARA: 0.500kg','PESO L:','garbage']){
    assert.throws(()=>parse(new TextEncoder().encode(frame)),/Urano|frame/i);
  }
});

test('cap-027 serial printer disconnect invalidates handle and only explicit reconnect resumes',async()=>{
  const {window:w}=browser();
  let opened=0,writes=0,closed=0;
  const serialPort=()=>{
    const number=++opened;
    return {
      open:async()=>{},
      close:async()=>{closed++;},
      writable:{getWriter:()=>({
        write:async()=>{writes++;if(number===1)throw Error('EIO simulated disconnect');},
        releaseLock(){}
      })}
    };
  };
  w.navigator.serial={requestPort:async()=>serialPort()};
  w.PdvWebHardware.saveSettings({printerMode:'serial',printerBaud:9600});
  const sale={id:'serial-sim-1',status:'COMPLETED',saleNumber:'R3',items:[],payments:[],totalCents:100,changeCents:0};
  await w.PdvWebHardware.connect('printer');
  await assert.rejects(w.PdvWebHardware.printSale(sale),/EIO simulated disconnect/);
  await assert.rejects(w.PdvWebHardware.printSale(sale),/Conecte este dispositivo/);
  assert.equal(opened,1,'browser must never silently re-request USB/serial permission');
  await w.PdvWebHardware.connect('printer');
  const result=await w.PdvWebHardware.printSale(sale);
  assert.equal(result.sentToSerial,true);
  assert.equal(opened,2);assert.equal(writes,2);assert.equal(closed,2);
});

test('cap-026 web renderer preserves frozen branding for browser and textual transports',()=>{
  const {window:w}=browser();
  w.PdvReceiptBranding={normalize:value=>value};
  const sale={id:'sale-immut',status:'COMPLETED',saleNumber:'7',items:[],payments:[],totalCents:0,changeCents:0};
  const oldBrand={name:'Loja Antiga',address:'Rua Antiga',phone:'(16)5555',logoDataUrl:null};
  const text=w.PdvWebHardwareUtils.receiptText(sale,{branding:oldBrand});
  const html=w.PdvWebHardwareUtils.receiptHtml(sale,{paperMm:80,branding:oldBrand});
  assert.match(text,/Loja Antiga/);assert.match(text,/Rua Antiga/);
  assert.match(html,/Loja Antiga/);assert.match(html,/Rua Antiga/);
  assert.doesNotMatch(text,/PDV TOTAL/);
});

test('cap-029 prebill uses a distinct non-fiscal document and cannot finalize an OPEN sale',()=>{
  const {window:w,opened}=browser();
  const open={id:'prebill-1',saleNumber:'1001',status:'OPEN',items:[],payments:[],totalCents:900,changeCents:0};
  const document={documentType:'PREBILL',sale:open,branding:{name:'Loja Preconta',address:'Rua 3',phone:'',logoDataUrl:null}};
  const result=w.PdvWebHardware.printPrebill(document);
  assert.equal(result.dialogOpened,true);
  assert.match(opened[0].html,/PRÉ-CONTA · NÃO FISCAL/);
  assert.match(opened[0].html,/Loja Preconta/);
  assert.equal(open.status,'OPEN');
  assert.throws(()=>w.PdvWebHardwareUtils.receiptHtml(open),/Somente venda concluída/);
  assert.throws(()=>w.PdvWebHardware.printPrebill({...document,documentType:'SALE_RECEIPT'}));
});

test('checkout-016 R3 WebSerial stable fragmented scale response is normalized before canonical weighted sale',async()=>{
  const {window:w}=browser(),parse=w.PdvWebHardwareUtils.parseWeight;
  assert.equal(parse('ST,GS,+ 1.250 kg').weight,1.25);
  assert.equal(parse('ST,NT, +1,250 kg').weight,1.25);
  assert.throws(()=>parse('US,GS,+1.250 kg'),/inválida/);
  let chunks=[new TextEncoder().encode('ST,GS,+ 1.'),new TextEncoder().encode('250 kg\r\n')];
  let portClosed=false;
  const port={open:async()=>{},close:async()=>{portClosed=true;},readable:{getReader:()=>({
    read:async()=>({value:chunks.shift()||new Uint8Array(),done:false}),
    cancel:async()=>{},releaseLock(){}
  })}};
  w.navigator.serial={requestPort:async()=>port};
  await w.PdvWebHardware.connect('scale');
  const result=await w.PdvWebHardware.readWeight();
  assert.equal(result.weight,1.25);
  assert.equal(portClosed,true);
});

test('cap-030 R3 ESC/POS serial sends logo raster before sale text, never sends text-only on decoder error',async()=>{
  const {window:w}=browser();
  const writes=[],image=[29,118,48,0,1,0,1,0,128],png='data:image/png;base64,VALID';
  w.PdvReceiptBranding={normalize:v=>v};
  w.PdvEscposLogo={encode:async()=>Uint8Array.from(image)};
  const port={open:async()=>{},close:async()=>{},writable:{getWriter:()=>({
    write:async bytes=>writes.push(Array.from(bytes)),releaseLock(){}
  })}};
  w.navigator.serial={requestPort:async()=>port};
  w.PdvWebHardware.saveSettings({printerMode:'serial',paperMm:58});
  await w.PdvWebHardware.connect('printer');
  const sale={id:'sale-logo-1',status:'COMPLETED',saleNumber:'1',totalCents:100,changeCents:0,items:[],payments:[]};
  const brand={name:'Loja Logo',address:'Rua A',phone:'16',logoDataUrl:png};
  const result=await w.PdvWebHardware.printSale(sale,{branding:brand});
  assert.equal(result.sentToSerial,true);
  assert.deepEqual(writes[0].slice(0,2+image.length),[27,64,...image]);
  assert.match(new TextDecoder().decode(Uint8Array.from(writes[0].slice(2+image.length))),/Loja Logo/);
  w.PdvEscposLogo={encode:async()=>{throw Error('broken bitmap');}};
  await assert.rejects(w.PdvWebHardware.printSale(sale,{branding:brand}),/broken bitmap/);
  assert.equal(writes.length,1,'must never send a text-only ticket when frozen logo raster fails');
});

test('cap-029 R3 untrusted operational document text is HTML escaped and does not edit accounting state',()=>{
  const {window:w,opened}=browser();
  const document={fiscal:false,documentType:'KITCHEN_TICKET',text:'COZINHA\n<script>alert(1)</script>'};
  const out=w.PdvWebHardware.printTextDocument(document);
  assert.equal(out.dialogOpened,true);
  assert.match(opened[0].html,/&lt;script&gt;/);
  assert.doesNotMatch(opened[0].html,/<script>/);
  assert.throws(()=>w.PdvWebHardware.printTextDocument({...document,fiscal:true}),/não fiscal/i);
});

test('cap-026 R3 ESC/POS CP850 preserves Brazilian accents and never prints untrusted ESC sequences',()=>{
 const {window:w}=browser();
 const bytes=w.PdvWebHardwareUtils.escpos('Ação café: pão, maçã, água\n\x1b[31m',{cut:true});
 assert.deepEqual(Array.from(bytes.slice(0,5)),[27,64,27,116,2]);
 assert.ok(bytes.includes(135)); // ç
 assert.ok(bytes.includes(130)); // é
 assert.ok(bytes.includes(198)); // ã
 assert.ok(bytes.includes(160)); // á
 assert.equal(bytes.slice(5,-3).includes(27),false,'ESC control bytes must be replaced');
 assert.deepEqual(Array.from(bytes.slice(-3)),[29,86,0]);
});

test('cap-028 R3 serial harness completes 250 explicit open/write/close cycles without stale handles',async()=>{
 const {window:w}=browser();
 let opened=0,closed=0,writes=0;
 w.navigator.serial={requestPort:async()=>({
  open:async()=>{opened++;},close:async()=>{closed++;},
  writable:{getWriter:()=>({write:async bytes=>{writes++;assert.ok(bytes.length>5);},releaseLock(){}})}
 })};
 w.PdvWebHardware.saveSettings({printerMode:'serial'});
 const sale={id:'stress-r3',saleNumber:'STRESS',status:'COMPLETED',items:[],payments:[],totalCents:0,changeCents:0};
 for(let i=0;i<250;i++){
   await w.PdvWebHardware.connect('printer');
   const out=await w.PdvWebHardware.printSale(sale);
   assert.equal(out.sentToSerial,true);
 }
 assert.equal(opened,250);
 assert.equal(writes,250);
 assert.equal(closed,250);
});
