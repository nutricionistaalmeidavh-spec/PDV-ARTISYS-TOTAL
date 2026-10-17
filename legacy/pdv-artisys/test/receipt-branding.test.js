'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {openDatabase}=require('../js/core/database/sqlite-database');
const {runMigrations}=require('../js/core/database/migrations');
const {DomainEventBus}=require('../js/core/domain-event-bus');
const {SqliteEffectStore}=require('../js/core/database/effect-store');
const {createPrintService}=require('../js/domains/printing/print-service');
const {renderSaleReceipt}=require('../js/domains/printing/receipt-renderer');
const {registerPrintEffects}=require('../js/domains/printing/print-effects');
const {normalizeLogoDataUrl,resolveReceiptBranding}=require('../js/domains/printing/receipt-branding');
const {createElectronPrinterDriver}=require('../vendor/artisys-printing/src/drivers/electron-printer');
const {createThermalPrinterDriver}=require('../vendor/artisys-printing/src/drivers/thermal-printer');

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZfWQAAAAASUVORK5CYII=';
function sale(){return {id:'s1',saleNumber:'V-001',terminalId:'T1',operatorId:'u1',status:'COMPLETED',subtotalCents:2500,discountCents:0,totalCents:2500,changeCents:500,completedAt:'2026-09-12T12:00:00Z',items:[{productName:'Café especial',sku:'CAF1',quantity:2,unitPriceCents:1250,totalCents:2500}],payments:[{method:'CASH',amountCents:3000}]};}

test('receipt branding prints name address and phone without exceeding configured width',()=>{
  for(const width of [32,42,48]){
    const text=renderSaleReceipt({branding:{name:'Loja ArtiSys',address:'Rua Exemplo, 123',phone:'(16) 3333-4444'},sale:sale(),width});
    assert.match(text,/Loja ArtiSys/);assert.match(text,/Rua Exemplo, 123/);assert.match(text,/Telefone: \(16\) 3333-4444/);
    assert.equal(Math.max(...text.split('\n').map(line=>line.length))<=width,true,`width ${width}`);
  }
});

test('receipt branding reads global store settings and accepts only bounded PNG logos',()=>{
  assert.equal(normalizeLogoDataUrl(PNG),PNG);
  assert.equal(normalizeLogoDataUrl('data:image/png;base64,aGVsbG8='),null);
  const values={'store.name':'Minha Loja','store.address':'Rua A','store.phone':'123','store.logoDataUrl':PNG};
  const branding=resolveReceiptBranding({settings:{get:(key,{defaultValue})=>Object.hasOwn(values,key)?values[key]:defaultValue},defaults:{name:'Fallback'}});
  assert.deepEqual({...branding},{name:'Minha Loja',address:'Rua A',phone:'123',logoDataUrl:PNG});
});

test('sale receipt effect snapshots branding into durable print job for safe reprint',async()=>{
  const db=openDatabase(':memory:');runMigrations(db);let n=0;
  const print=createPrintService({db,now:()=> '2026-09-12T12:00:00Z',idFactory:p=>`${p}-${++n}`});
  const bus=new DomainEventBus();const effectStore=new SqliteEffectStore(db);
  const values={'store.name':'Loja Configurada','store.address':'Av. Central, 10','store.phone':'(16) 99999-9999','store.logoDataUrl':PNG};
  registerPrintEffects({bus,effectStore,printService:print,saleService:{getSaleDetails:id=>id==='s1'?sale():null},settings:{get:(key,{defaultValue})=>Object.hasOwn(values,key)?values[key]:defaultValue},storeName:'Fallback'});
  const event={eventId:'evt-branding-1',type:'sale.completed',aggregate:'sale',aggregateId:'s1',occurredAt:'2026-09-12T12:00:00Z',actor:{userId:'u1',profileId:'profile-cashier',terminalId:'T1'},source:'server',mutationId:null,payload:{terminalId:'T1'}};
  const result=await bus.publishAsync(event);assert.equal(result.failures.length,0);
  const [job]=print.listJobs({entityId:'s1'});assert.match(job.payload.text,/Loja Configurada/);assert.match(job.payload.text,/Av\. Central, 10/);assert.equal(job.payload.logoDataUrl,PNG);
  const reprint=print.reprint(job.id);assert.equal(reprint.payload.logoDataUrl,PNG);assert.equal(reprint.payload.reprintOf,job.id);
  db.close();
});

test('print service forwards persisted logo payload to hardware driver',async()=>{
  const db=openDatabase(':memory:');runMigrations(db);let received=null;
  const print=createPrintService({db,idFactory:()=> 'print-1'});
  print.queueJob({id:'print-1',type:'SALE_RECEIPT',entityType:'sale',entityId:'s1',payload:{text:'cupom',logoDataUrl:PNG},width:42});
  const result=await print.processJob('print-1',{print:async input=>{received=input;return{success:true};}});
  assert.equal(result.job.status,'PRINTED');assert.equal(received.logoDataUrl,PNG);assert.equal(received.text,'cupom');
  db.close();
});

test('print service forwards persisted A4 HTML to hardware driver',async()=>{
  const db=openDatabase(':memory:');runMigrations(db);let received=null;
  const print=createPrintService({db,idFactory:()=> 'print-a4'});
  print.queueJob({id:'print-a4',type:'DANFE_NFE_A4',entityType:'fiscal-document',entityId:'f1',payload:{html:'<!doctype html><html><body>DANFE</body></html>',format:'A4'},width:42});
  const result=await print.processJob('print-a4',{print:async input=>{received=input;return{success:true};}});
  assert.equal(result.job.status,'PRINTED');assert.equal(received.format,'A4');assert.match(received.html,/DANFE/);assert.equal(received.text,'');
  db.close();
});

test('electron printer embeds only safe local PNG logo before receipt text',async()=>{
  let loaded='';class FakeWindow{constructor(){this.webContents={print:(_opts,cb)=>cb(true,'')};}async loadURL(url){loaded=decodeURIComponent(url.slice(url.indexOf(',')+1));}isDestroyed(){return false;}close(){}}
  const driver=createElectronPrinterDriver({BrowserWindow:FakeWindow});const result=await driver.print({text:'cupom',logoDataUrl:PNG,width:42},{mode:'electron',width:42});
  assert.equal(result.success,true);assert.match(loaded,/receipt-logo/);assert.ok(loaded.indexOf('<img')<loaded.indexOf('<pre>cupom'));
});

test('electron receipt printer applies configured 58 and 80 mm paper width',async()=>{
  const options=[];
  class FakeWindow{
    constructor(){this.webContents={executeJavaScript:async()=>600,print:(value,cb)=>{options.push(value);cb(true,'');}};}
    async loadURL(){}
    isDestroyed(){return false;}
    close(){}
  }
  const driver=createElectronPrinterDriver({BrowserWindow:FakeWindow});
  await driver.print({text:'cupom 58',paperMm:58,width:32},{mode:'electron',width:32});
  await driver.print({text:'cupom 80',paperMm:80,width:48},{mode:'electron',width:48});
  assert.equal(options[0].pageSize.width,58000);
  assert.ok(options[0].pageSize.height>=50000);
  assert.equal(options[1].pageSize.width,80000);
  assert.ok(options[1].pageSize.height>=50000);
});

test('electron printer prints trusted local A4 HTML and rejects active or remote content',async()=>{
  let loaded='';let options=null;class FakeWindow{constructor(){this.webContents={print:(opts,cb)=>{options=opts;cb(true,'');}};}async loadURL(url){loaded=decodeURIComponent(url.slice(url.indexOf(',')+1));}isDestroyed(){return false;}close(){}}
  const driver=createElectronPrinterDriver({BrowserWindow:FakeWindow});
  const html='<!doctype html><html><body><h1>DANFE</h1></body></html>';const result=await driver.print({html,format:'A4',width:42},{mode:'electron',width:42});
  assert.equal(result.success,true);assert.equal(result.format,'A4');assert.equal(loaded,html);assert.equal(options.pageSize,'A4');assert.equal(options.printBackground,true);
  await assert.rejects(()=>driver.print({html:'<!doctype html><html><body><script>alert(1)</script></body></html>',format:'A4'},{mode:'electron',width:42}),/HTML A4 invalido|PRINTER_RENDER_FAILED/);
  await assert.rejects(()=>driver.print({html:'<!doctype html><html><body><img src="https://example.com/x.png"></body></html>',format:'A4'},{mode:'electron',width:42}),/HTML A4 invalido|PRINTER_RENDER_FAILED/);
});

test('thermal printer emits PNG logo buffer before receipt text when driver supports images',async()=>{
  const calls=[];class FakePrinter{constructor(){}alignCenter(){calls.push('center');}async printImageBuffer(buffer){calls.push(['logo',buffer.subarray(0,8).toString('hex')]);}alignLeft(){calls.push('left');}println(text){calls.push(['text',text]);}async execute(){calls.push('execute');return true;}}
  const driver=createThermalPrinterDriver({thermalPrinter:{ThermalPrinter:FakePrinter,PrinterTypes:{EPSON:'epson',STAR:'star'}}});
  const result=await driver.print({text:'cupom',logoDataUrl:PNG},{mode:'thermal',printerType:'epson',interface:'tcp://printer',width:42});
  assert.equal(result.success,true);assert.deepEqual(calls.slice(0,4),['center',['logo','89504e470d0a1a0a'],'left',['text','cupom']]);
});

test('canonical company settings own receipt branding and runtime wiring stays connected',()=>{
  const uiPath=path.join(__dirname,'../desktop/renderer/admin-ops.js');
  const checked=spawnSync(process.execPath,['--check',uiPath],{encoding:'utf8'});assert.equal(checked.status,0,checked.stderr);
  const ui=fs.readFileSync(uiPath,'utf8');
  assert.match(ui,/id="settings-company-store"/);
  assert.match(ui,/store\.address/);
  assert.match(ui,/store\.phone/);
  assert.match(ui,/store\.logoDataUrl/);
  const index=fs.readFileSync(path.join(__dirname,'../desktop/renderer/index.html'),'utf8');
  assert.doesNotMatch(index,/store-branding-ui\.js/);
  const runtime=fs.readFileSync(path.join(__dirname,'../js/core/pdv-runtime.js'),'utf8');
  assert.match(runtime,/registerPrintEffects\(\{bus,effectStore,printService:printing,saleService:sales,settings,\.\.\.receiptOptions\}\)/);
});