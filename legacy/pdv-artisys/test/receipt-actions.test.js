'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createReceiptActions,safePdfFileName,receiptHtml,registerReceiptIpc}=require('../desktop/receipt-actions.cjs');

function receipt(overrides={}){return {saleId:'sale-1',saleNumber:'V/001:*?',paperMm:80,width:48,text:'LOJA <QA>\nVenda V-001\nTOTAL 10,00',logoDataUrl:null,...overrides};}
function fakeWindow({pdf=Buffer.from('%PDF-FAKE'),height=480,throwPdf=null}={}){
  const state={destroyed:false,loaded:null,options:null};
  class BrowserWindow{
    constructor(){this.webContents={executeJavaScript:async()=>height,printToPDF:async options=>{state.options=options;if(throwPdf)throw throwPdf;return pdf;}};}
    async loadURL(url){state.loaded=url;}
    destroy(){state.destroyed=true;}
  }
  return {BrowserWindow,state};
}

test('safe PDF filename removes Windows-reserved characters',()=>{
  assert.equal(safePdfFileName('V/001:*?','2026-09-24T12:00:00Z'),'Venda-V-001-2026-09-24.pdf');
});

test('receipt HTML escapes quotes with complete entities',()=>{
  const html=receiptHtml(receipt({text:'A "quoted" & <tag>'}));
  assert.match(html,/A &quot;quoted&quot; &amp; &lt;tag&gt;/);
});

test('print sale creates and finishes an auditable attempt from the immutable snapshot',async()=>{
  const calls=[];
  const actions=createReceiptActions({
    getReceipt:async()=>{throw new Error('manual print must use attempt snapshot');},
    createPrintAttempt:async(id,token)=>{calls.push(['create',id,token]);return {job:{id:'manual-1'},receipt:receipt()};},
    finishPrintAttempt:async(id,jobId,outcome,token)=>{calls.push(['finish',id,jobId,outcome,token]);return {job:{id:jobId,status:'PRINTED'}};},
    printReceipt:async value=>{calls.push(['print',value.saleId]);return {success:true};},
    dialog:{showSaveDialog:async()=>{throw new Error('not used');}},writeFile:async()=>{},BrowserWindow:class{},env:{}
  });
  const result=await actions.printSale({saleId:'sale-1',sessionToken:'session'});
  assert.equal(result.success,true);
  assert.deepEqual(calls,[
    ['create','sale-1','session'],
    ['print','sale-1'],
    ['finish','sale-1','manual-1',{success:true},'session']
  ]);
});

test('print sale records a sanitized failed attempt when local hardware rejects',async()=>{
  const outcomes=[];
  const actions=createReceiptActions({
    getReceipt:async()=>receipt(),
    createPrintAttempt:async()=>({job:{id:'manual-2'},receipt:receipt()}),
    finishPrintAttempt:async(_saleId,_jobId,outcome)=>{outcomes.push(outcome);return {job:{status:'FAILED'}};},
    printReceipt:async()=>{throw new Error('spooler indisponivel');},
    dialog:{showSaveDialog:async()=>({canceled:true})},writeFile:async()=>{},BrowserWindow:class{},env:{}
  });
  await assert.rejects(()=>actions.printSale({saleId:'sale-1',sessionToken:'session'}),/spooler indisponivel/);
  assert.deepEqual(outcomes,[{success:false,error:'spooler indisponivel'}]);
});

test('cancelled Save As is not an error and does not write',async()=>{
  const {BrowserWindow,state}=fakeWindow();let writes=0;
  const actions=createReceiptActions({BrowserWindow,dialog:{showSaveDialog:async()=>({canceled:true})},writeFile:async()=>{writes+=1;},getReceipt:async()=>receipt(),printReceipt:async()=>({}),env:{},getParentWindow:()=>null});
  const result=await actions.saveSalePdf({saleId:'sale-1',sessionToken:'session'});
  assert.deepEqual(result,{cancelled:true});
  assert.equal(writes,0);
  assert.equal(state.destroyed,true);
});

test('QA PDF directory writes a real printToPDF buffer without opening Save As',async()=>{
  const {BrowserWindow,state}=fakeWindow({pdf:Buffer.from('%PDF-QA')});const writes=[];let dialogs=0;
  const qaPdfDir='/tmp/artisys-pdf';
  const actions=createReceiptActions({
    BrowserWindow,dialog:{showSaveDialog:async()=>{dialogs+=1;return {canceled:true};}},
    writeFile:async(file,bytes)=>writes.push([file,bytes.toString('utf8')]),
    getReceipt:async()=>receipt({saleNumber:'QA-123'}),printReceipt:async()=>({}),
    env:{ARTISYS_QA:'1',ARTISYS_QA_PDF_DIR:qaPdfDir},getParentWindow:()=>null,
    now:()=>new Date('2026-09-24T12:00:00Z')
  });
  const result=await actions.saveSalePdf({saleId:'sale-1',sessionToken:'session'});
  assert.equal(dialogs,0);
  assert.equal(result.cancelled,false);
  assert.equal(result.fileName,'Venda-QA-123-2026-09-24.pdf');
  assert.deepEqual(writes,[[path.join(path.resolve(qaPdfDir),'Venda-QA-123-2026-09-24.pdf'),'%PDF-QA']]);
  assert.equal(state.destroyed,true);
  assert.equal(state.options.pageSize.width,80000);
  assert.ok(state.options.pageSize.height>0);
});

test('printToPDF failure propagates but hidden window is destroyed',async()=>{
  const {BrowserWindow,state}=fakeWindow({throwPdf:new Error('pdf failed')});
  const actions=createReceiptActions({BrowserWindow,dialog:{showSaveDialog:async()=>({canceled:false,filePath:'/tmp/a.pdf'})},writeFile:async()=>{},getReceipt:async()=>receipt(),printReceipt:async()=>({}),env:{},getParentWindow:()=>null});
  await assert.rejects(()=>actions.saveSalePdf({saleId:'sale-1',sessionToken:'session'}),/pdf failed/);
  assert.equal(state.destroyed,true);
});

test('receipt IPC rejects untrusted senders and delegates trusted requests',async()=>{
  const handlers=new Map();
  const ipcMain={handle:(name,fn)=>handlers.set(name,fn)};
  const calls=[];
  registerReceiptIpc({
    ipcMain,
    actions:{printSale:async input=>{calls.push(['print',input]);return {success:true};},saveSalePdf:async input=>{calls.push(['pdf',input]);return {cancelled:false};}},
    isTrustedSender:event=>event.sender==='trusted'
  });
  await assert.rejects(()=>handlers.get('artisys:receipts:print-sale')({sender:'evil'},{saleId:'s1',sessionToken:'t'}),/nao autorizada/i);
  assert.deepEqual(await handlers.get('artisys:receipts:print-sale')({sender:'trusted'},{saleId:'s1',sessionToken:'t'}),{success:true});
  assert.deepEqual(await handlers.get('artisys:receipts:save-pdf')({sender:'trusted'},{saleId:'s1',sessionToken:'t'}),{cancelled:false});
  assert.equal(calls.length,2);
});

test('desktop main wires trusted receipt actions through auditable attempt API and local printer',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
  assert.match(main,/createReceiptActions/);
  assert.match(main,/registerReceiptIpc/);
  assert.match(main,/\/api\/v1\/sales\/\$\{encodeURIComponent\(saleId\)\}\/receipt/);
  assert.match(main,/print-attempts/);
  assert.match(main,/createPrintAttempt/);
  assert.match(main,/finishPrintAttempt/);
  assert.match(main,/hardwareController\.print/);
  assert.match(main,/writeFile/);
});

test('desktop detects a pre-existing database before resolving legacy printing defaults',()=>{
  const main=fs.readFileSync(path.join(__dirname,'../desktop/main.cjs'),'utf8');
  assert.match(main,/existsSync\(dbPath\)/);
  assert.match(main,/isExistingInstall:\s*installationWasExisting/);
});