'use strict';

const path=require('node:path');
const {registerWhatsappIpc}=require('./whatsapp-actions.cjs');

function isoDate(value) {
  const date=value instanceof Date?value:new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString().slice(0,10) : date.toISOString().slice(0,10);
}

function safeSegment(value) {
  return String(value || 'Venda')
    .normalize('NFKD')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g,'-')
    .replace(/\s+/g,'-')
    .replace(/-+/g,'-')
    .replace(/^[.\-\s]+|[.\-\s]+$/g,'')
    .slice(0,80) || 'Venda';
}

function safePdfFileName(saleNumber,date=new Date()) {
  return `Venda-${safeSegment(saleNumber)}-${isoDate(date)}.pdf`;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function safeLogo(value) {
  const text=String(value || '');
  return /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(text) && text.length<=2_000_000 ? text : '';
}

function receiptHtml(receipt) {
  const logo=safeLogo(receipt.logoDataUrl);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page{margin:3mm}html,body{margin:0;padding:0;background:#fff;color:#000}body{font-family:ui-monospace,Consolas,"Courier New",monospace;font-size:10pt;line-height:1.25}main{box-sizing:border-box;width:100%}.receipt-logo{display:block;max-width:80%;max-height:24mm;margin:0 auto 3mm;object-fit:contain}pre{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font:inherit}
  </style></head><body><main>${logo?`<img class="receipt-logo" alt="" src="${logo}">`:''}<pre>${escapeHtml(receipt.text)}</pre></main></body></html>`;
}

function pageHeightMicrons(scrollHeightPx) {
  const px=Number(scrollHeightPx);
  const bodyPx=Number.isFinite(px) && px>0 ? px : 480;
  return Math.max(50000,Math.ceil((bodyPx*25400)/96)+6000);
}

function createReceiptActions({BrowserWindow,dialog,writeFile,getReceipt,createPrintAttempt=null,finishPrintAttempt=null,printReceipt,env=process.env,getParentWindow=()=>null,now=()=>new Date()}={}) {
  if(typeof BrowserWindow!=='function')throw new TypeError('BrowserWindow e obrigatorio.');
  if(!dialog||typeof dialog.showSaveDialog!=='function')throw new TypeError('dialog.showSaveDialog e obrigatorio.');
  if(typeof writeFile!=='function')throw new TypeError('writeFile e obrigatorio.');
  if(typeof getReceipt!=='function')throw new TypeError('getReceipt e obrigatorio.');
  if(typeof printReceipt!=='function')throw new TypeError('printReceipt e obrigatorio.');

  function requireInput(input={}) {
    const saleId=String(input.saleId || '').trim();
    const sessionToken=String(input.sessionToken || '').trim();
    if(!saleId)throw new Error('Venda obrigatoria para comprovante.');
    if(!sessionToken)throw new Error('Sessao obrigatoria para comprovante.');
    return {saleId,sessionToken};
  }

  async function resolve(input={}) {
    const {saleId,sessionToken}=requireInput(input);
    return getReceipt(saleId,sessionToken);
  }

  async function printSale(input={}) {
    if(typeof createPrintAttempt!=='function'||typeof finishPrintAttempt!=='function')throw new Error('Auditoria de impressao manual indisponivel.');
    const {saleId,sessionToken}=requireInput(input);
    const attempt=await createPrintAttempt(saleId,sessionToken);
    const jobId=String(attempt?.job?.id || '').trim();
    const receipt=attempt?.receipt;
    if(!jobId||!receipt)throw new Error('Tentativa manual de impressao invalida.');

    let result;
    try {
      const qaSimulated=String(env?.ARTISYS_QA||'')==='1'&&String(env?.ARTISYS_QA_SIMULATE_PRINTER||'')==='1';
      result=qaSimulated?{success:true,driver:'qa-simulated'}:await printReceipt(receipt);
      if(result&&result.success===false)throw new Error(result.failureReason||'Falha de impressao.');
    } catch(error) {
      try {
        await finishPrintAttempt(saleId,jobId,{success:false,error:String(error?.message||error||'Falha de impressao.')},sessionToken);
      } catch {}
      throw error;
    }

    try {
      await finishPrintAttempt(saleId,jobId,{success:true},sessionToken);
      return result;
    } catch(error) {
      return {
        ...(result&&typeof result==='object'?result:{success:true}),
        success:true,
        auditPending:true,
        auditError:String(error?.message||error||'Falha ao registrar auditoria da impressao.')
      };
    }
  }

  async function saveSalePdf(input={}) {
    const receipt=await resolve(input);
    const paperMm=Number(receipt.paperMm);
    if(![58,80].includes(paperMm))throw new Error('Papel do comprovante deve ser 58 ou 80 mm.');
    const hidden=new BrowserWindow({
      show:false,
      width:paperMm===58?300:400,
      height:600,
      webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}
    });
    try {
      await hidden.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(receiptHtml(receipt))}`);
      const scrollHeight=await hidden.webContents.executeJavaScript('Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)');
      const pdf=await hidden.webContents.printToPDF({
        printBackground:true,
        pageSize:{width:paperMm*1000,height:pageHeightMicrons(scrollHeight)}
      });
      const fileName=safePdfFileName(receipt.saleNumber,now());
      let filePath='';
      if(String(env?.ARTISYS_QA || '')==='1' && String(env?.ARTISYS_QA_PDF_DIR || '').trim()) {
        filePath=path.join(path.resolve(String(env.ARTISYS_QA_PDF_DIR)),fileName);
      } else {
        const choice=await dialog.showSaveDialog(getParentWindow?.() || undefined,{
          title:'Salvar comprovante em PDF',
          defaultPath:fileName,
          filters:[{name:'PDF',extensions:['pdf']}]
        });
        if(choice?.canceled || !choice?.filePath)return {cancelled:true};
        filePath=/\.pdf$/i.test(choice.filePath)?choice.filePath:`${choice.filePath}.pdf`;
      }
      await writeFile(filePath,pdf);
      return {cancelled:false,fileName};
    } finally {
      if(typeof hidden.destroy==='function')hidden.destroy();
    }
  }

  return Object.freeze({printSale,saveSalePdf});
}

function registerReceiptIpc({ipcMain,actions,isTrustedSender=null}={}) {
  if(!ipcMain||!actions)throw new TypeError('ipcMain e actions sao obrigatorios.');
  if(typeof actions.printSale!=='function'||typeof actions.saveSalePdf!=='function')throw new TypeError('Acoes de comprovante invalidas.');
  const trusted=event=>typeof isTrustedSender!=='function'||Boolean(isTrustedSender(event));
  const handle=(channel,fn)=>ipcMain.handle(channel,async(event,input)=>{
    if(!trusted(event))throw new Error('Origem IPC nao autorizada.');
    return fn(input||{});
  });
  handle('artisys:receipts:print-sale',input=>actions.printSale(input));
  handle('artisys:receipts:save-pdf',input=>actions.saveSalePdf(input));
  registerWhatsappIpc({ipcMain,isTrustedSender});
}

module.exports={createReceiptActions,registerReceiptIpc,safePdfFileName,receiptHtml,pageHeightMicrons};