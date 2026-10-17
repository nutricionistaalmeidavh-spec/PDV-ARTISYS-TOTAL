'use strict';
const {statusForError}=require('./http-error-status');

const {createSaleReceiptService}=require('../js/domains/printing/sale-receipt-projection');
const {resolvePrintingPreferences,validatePrintingPreferences}=require('../js/domains/printing/printing-preferences');

function sendJson(res,status,payload){if(res.headersSent)return;res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(payload));}
function bearer(req){const value=String(req.headers.authorization||'');return value.startsWith('Bearer ')?value.slice(7).trim():'';}
async function readJson(req,maxBytes=64*1024){const chunks=[];let total=0;for await(const chunk of req){total+=chunk.length;if(total>maxBytes)throw Object.assign(new Error('Corpo excede o limite permitido.'),{statusCode:413});chunks.push(chunk);}if(!chunks.length)return{};try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(new Error('JSON invalido.'),{statusCode:400});}}
function httpError(statusCode,message){return Object.assign(new Error(message),{statusCode});}
function sanitizePrintFailure(value){return String(value||'Falha de impressao.').replace(/\s+/g,' ').trim().slice(0,500)||'Falha de impressao.';}

function createReceiptRouter({runtime,sessionStore,env=process.env,isExistingInstall=true}={}) {
  if(!runtime||!sessionStore)throw new TypeError('runtime e sessionStore sao obrigatorios no router de comprovante.');
  const receipts=createSaleReceiptService({saleService:runtime.sales,settings:runtime.settings,env});
  function session(req){const token=bearer(req);const current=sessionStore.get(token);if(!current||current.expiresAt<=Date.now()){if(token)sessionStore.delete(token);throw httpError(401,'Sessao invalida ou expirada.');}return current;}
  function requireCapability(current,capability){try{return runtime.authorization.require({principal:{kind:'human',id:current.userId},capability});}catch(error){throw httpError(error.statusCode||403,error.message||'Permissao insuficiente.');}}
  function printingPreferences(){return resolvePrintingPreferences({settings:runtime.settings,env,isExistingInstall});}
  function jobReceipt(job,saleId=job?.entityId){
    if(!job)return null;
    const payload=job.payload&&typeof job.payload==='object'&&!Array.isArray(job.payload)?job.payload:{};
    const text=String(payload.text||'');
    const width=Number(job.width);
    const paperMm=Number(payload.paperMm);
    if(!text||![32,42,48].includes(width)||![58,80].includes(paperMm))return null;
    return Object.freeze({saleId:String(saleId),saleNumber:String(payload.saleNumber||saleId),width,paperMm,text,logoDataUrl:payload.logoDataUrl||null});
  }
  function originalReceipt(saleId){return jobReceipt(runtime.printing?.getOriginalSaleReceipt?.(saleId),saleId);}
  function saleReceipt(saleId){return originalReceipt(saleId)||receipts.build(saleId);}
  function savePrintingPreferences(input,current){
    requireCapability(current,'settings.manage');
    const normalized=validatePrintingPreferences({...printingPreferences(),...(input||{})});
    const actor={kind:'human',userId:current.userId,terminalId:current.terminalId||null};
    const values={
      'printing.deviceName':normalized.deviceName,
      'printing.paperMm':normalized.paperMm,
      'printing.columnsMode':normalized.columnsMode,
      'printing.columns':normalized.columns,
      'printing.autoPrint':normalized.autoPrint,
      'printing.showSystemDialog':normalized.showSystemDialog,
      'printing.cut':normalized.cut,
      'printing.openDrawerAfterPrint':normalized.openDrawerAfterPrint
    };
    for(const [key,value] of Object.entries(values))runtime.settings.set(key,value,{scope:'global',actor});
    return printingPreferences();
  }
  function requireManualAttempt(saleId,jobId){
    const job=runtime.printing?.getJob?.(jobId);
    if(!job||job.entityType!=='sale'||String(job.entityId)!==String(saleId)||job.type!=='REPRINT'||job.payload?.manual!==true)throw httpError(404,'Tentativa manual de impressao nao encontrada.');
    return job;
  }
  function createManualAttempt(saleId){
    if(typeof runtime.printing?.createManualAttempt!=='function')throw httpError(503,'Servico de impressao manual indisponivel.');
    const job=runtime.printing.createManualAttempt(saleId);
    const receipt=jobReceipt(job,saleId);
    if(!receipt)throw httpError(500,'Snapshot do comprovante manual invalido.');
    return {job,receipt};
  }
  async function finishManualAttempt(saleId,jobId,req){
    const job=requireManualAttempt(saleId,jobId);
    if(job.status!=='PENDING')throw httpError(409,'Tentativa manual de impressao ja finalizada.');
    const input=await readJson(req);
    if(typeof input.success!=='boolean')throw httpError(400,'Resultado de impressao invalido.');
    const updated=input.success
      ? runtime.printing.markPrinted(job.id)
      : runtime.printing.markFailed(job.id,sanitizePrintFailure(input.error));
    return {job:updated};
  }
  return async function route(req,res){
    const url=new URL(req.url||'/','http://localhost');
    const receiptMatch=url.pathname.match(/^\/api\/v1\/sales\/([^/]+)\/receipt$/);
    const attemptMatch=url.pathname.match(/^\/api\/v1\/sales\/([^/]+)\/print-attempts$/);
    const attemptResultMatch=url.pathname.match(/^\/api\/v1\/sales\/([^/]+)\/print-attempts\/([^/]+)\/result$/);
    const isPreferences=url.pathname==='/api/v1/printing/preferences';
    if(!receiptMatch&&!attemptMatch&&!attemptResultMatch&&!isPreferences)return false;
    try{
      const current=session(req);
      const method=String(req.method||'GET').toUpperCase();
      if(isPreferences){
        if(method==='GET'){sendJson(res,200,printingPreferences());return true;}
        if(method==='PUT'){sendJson(res,200,savePrintingPreferences(await readJson(req),current));return true;}
        throw httpError(405,'Metodo nao permitido.');
      }
      if(attemptMatch){
        if(method!=='POST')throw httpError(405,'Metodo nao permitido.');
        const saleId=decodeURIComponent(attemptMatch[1]);
        sendJson(res,201,createManualAttempt(saleId));
        return true;
      }
      if(attemptResultMatch){
        if(method!=='POST')throw httpError(405,'Metodo nao permitido.');
        const saleId=decodeURIComponent(attemptResultMatch[1]);
        const jobId=decodeURIComponent(attemptResultMatch[2]);
        sendJson(res,200,await finishManualAttempt(saleId,jobId,req));
        return true;
      }
      if(method!=='GET')throw httpError(405,'Metodo nao permitido.');
      const saleId=decodeURIComponent(receiptMatch[1]);
      sendJson(res,200,saleReceipt(saleId));
      return true;
    }catch(error){sendJson(res,statusForError(error),{error:error.message||'Falha ao processar comprovante/impressao.'});return true;}
  };
}

module.exports={createReceiptRouter};
