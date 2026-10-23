'use strict';
// Browser post-sale experience. Sale data always comes from the canonical tenant API.
(() => {
  const root=window, Client=root.PdvApiClient?.ApiClient;
  if(!Client || !root.PdvWebHardware || !root.PdvUiLifecycle)return;
  const api=new Client();
  let currentSale=null;
  let receiptSubmitted=false;
  let remoteSubmitted=false,remoteJobId=null;
  const esc=value=>root.PdvWebHardwareUtils.escapeHtml(value);
  const money=n=>(Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  function panel(){
    let host=document.getElementById('post-sale-receipt-root');
    if(!host){
      host=document.createElement('div');
      host.id='post-sale-receipt-root';
      host.className='post-sale-receipt-root hidden';
      host.style.cssText='position:fixed;right:8px;bottom:8px;z-index:99;width:min(370px,calc(100vw - 96px));max-width:calc(100vw - 96px);pointer-events:none';
      document.body.append(host);
    }
    return host;
  }
  function closePostSaleModal(){
    const host=document.getElementById('post-sale-receipt-root');
    if(host){host.classList.add('hidden');host.replaceChildren();}
    currentSale=null;
    receiptSubmitted=false;remoteSubmitted=false;remoteJobId=null;
  }
  function notice(message,isError=false){
    const el=document.getElementById('post-sale-receipt-status');
    if(el){el.textContent=message;el.className='post-sale-status'+(isError?' error':'');}
  }
  async function doPrint(button,pdf=false){
    if(!currentSale || button.disabled)return;
    // A popup must be opened synchronously from the user's click in browsers.
    const browserMode=pdf || root.PdvWebHardware.settings().printerMode==='browser';
    const popup=browserMode?root.open('','_blank'):null;
    if(browserMode&&!popup){notice('Autorize pop-ups para imprimir ou salvar PDF.',true);return;}
    button.disabled=true;
    notice('Carregando venda do servidor…');
    try{
      // Always fetch the transaction-time immutable receipt snapshot.
      // A later store-logo edit must never rewrite an older sale receipt.
      const receipt=await api.request('/api/v1/sales/'+encodeURIComponent(currentSale.id)+'/receipt');
      if(receipt?.sale?.status!=='COMPLETED')throw new Error('Venda não concluída ou indisponível.');
      const result=await root.PdvWebHardware.printSale(receipt.sale,{popup,forceBrowser:pdf,
        branding:receipt.branding,text:receipt.text,reprint:receiptSubmitted&&!pdf});
      if(!pdf){receiptSubmitted=true;button.textContent='Reimprimir comprovante';}
      notice(pdf?'No diálogo, escolha Salvar como PDF.':result?.queued?'Enviado ao spooler local. Confira a impressão no equipamento.':'Diálogo aberto ou comando enviado; confirme a impressão.');
    }catch(error){
      try{popup?.close();}catch{}
      notice(error?.message||'Falha ao emitir comprovante.',true);
    }finally{button.disabled=false;}
  }
  async function availableRemotePrinters(saleId){
    const host=document.getElementById('post-sale-receipt-root');
    const target=host?.querySelector('#post-sale-remote');
    if(!target)return;
    try{
      const result=await api.request('/api/v1/printing/remote/agents?branchId='+encodeURIComponent(api.branchId));
      if(!result.agents?.length||currentSale?.id!==saleId)return;
      const select=target.querySelector('#post-sale-remote-agent');
      select.replaceChildren();
      for(const agent of result.agents){
        const option=document.createElement('option');
        option.value=agent.id;
        option.textContent=agent.label+(agent.online?' · PC conectado':' · PC desconectado (ficará na fila)');
        select.append(option);
      }
      target.hidden=false;
    }catch{
      // Lack of remote-print permission must never block ordinary browser printing.
    }
  }
  async function sendRemote(button){
    if(!currentSale||button.disabled)return;
    const select=document.getElementById('post-sale-remote-agent');
    const selected=select?.value,saleId=currentSale.id;
    if(!selected){notice('Selecione um computador autorizado.',true);return;}
    button.disabled=true;notice('Enviando solicitação ao servidor…');
    try{
      const reprint=remoteSubmitted;
      if(reprint&&typeof root.crypto?.randomUUID!=='function')throw Error('Este navegador não permite identificar uma nova via com segurança.');
      const payload={branchId:api.branchId,agentId:selected,saleId,...(reprint?{reprint:true,requestId:root.crypto.randomUUID()}:{})};
      const result=await api.request('/api/v1/printing/remote/jobs',{method:'POST',body:payload});
      if(currentSale?.id!==saleId)return;
      remoteSubmitted=true;remoteJobId=result.job.id;
      button.textContent='Reimprimir pelo PC';
      const messages={PENDING:'Solicitação na fila. O PC poderá estar desligado; ela será processada quando voltar.',
        LEASED:'Computador processando a impressão.',SUBMITTED:'Enviado ao spooler. Confirme se o papel saiu.',
        FAILED:'Falha confirmada. Consulte a fila antes de solicitar uma nova via.',
        UNCERTAIN:'Resultado incerto: confira a impressora antes de reimprimir.'};
      notice(messages[result.job.status]||'Solicitação registrada. Consulte o estado da fila.',result.job.status==='FAILED'||result.job.status==='UNCERTAIN');
    }catch(e){notice(e.message||'Não foi possível enviar para o computador.',true);}
    finally{button.disabled=false;}
  }
  async function remoteJobStatus(button){
    if(!remoteJobId)return;
    button.disabled=true;
    try{
      const response=await api.request('/api/v1/printing/remote/jobs?branchId='+encodeURIComponent(api.branchId));
      const job=response.jobs?.find(x=>x.id===remoteJobId);
      if(!job)throw Error('Solicitação não encontrada na fila desta filial.');
      const status={PENDING:'Na fila, aguardando o PC.',LEASED:'PC processando.',
        SUBMITTED:'Aceito pelo spooler do PC (sem confirmação física).',
        FAILED:'Falha confirmada: '+(job.lastError||'confira a impressora.'),
        UNCERTAIN:'Resultado incerto; não reenvie sem conferir o equipamento.'};
      notice(status[job.status]||'Estado indisponível.',job.status==='FAILED'||job.status==='UNCERTAIN');
    }catch(e){notice(e.message,true);}finally{button.disabled=false;}
  }
  function showPostSaleModal(sale){
    if(!sale?.id)return;
    currentSale={id:String(sale.id)};
    receiptSubmitted=false;remoteSubmitted=false;remoteJobId=null;
    const host=panel();
    host.classList.remove('hidden');
    host.innerHTML='<section class="modal-card post-sale-card" role="dialog" aria-labelledby="post-sale-title" style="pointer-events:auto;width:100%;max-width:100%;box-sizing:border-box;padding:16px"><header class="modal-head"><div><h2 id="post-sale-title">Venda concluída</h2><p class="post-sale-subtitle">Venda '+esc(sale.saleNumber||sale.id)+' — comprovante disponível.</p></div><button class="modal-close" id="post-sale-close" type="button" aria-label="Fechar">×</button></header><div class="modal-body"><div class="post-sale-summary"><div><span>Total</span><strong>'+esc(money(sale.totalCents))+'</strong></div><div><span>Troco</span><strong>'+esc(money(sale.changeCents))+'</strong></div></div><p class="post-sale-help">A impressão usa os dispositivos deste navegador. O PDF é salvo pelo diálogo do sistema, sem impressora física.</p><div class="post-sale-primary-actions"><button type="button" class="primary-button" id="post-sale-print">Imprimir comprovante</button><button type="button" class="secondary-button post-sale-pdf-button" id="post-sale-save-pdf">Salvar como PDF</button></div><div class="post-sale-remote" id="post-sale-remote" hidden><label for="post-sale-remote-agent">Enviar comprovante para um computador autorizado</label><select id="post-sale-remote-agent" aria-label="Impressora do computador"></select><div class="post-sale-primary-actions"><button type="button" class="secondary-button" id="post-sale-remote-send">Enviar para o PC</button><button type="button" class="secondary-button" id="post-sale-remote-check">Consultar situação</button></div><p>O PC recebe pelo servidor seguro. Caso esteja desligado, o pedido aguarda na fila.</p></div><div id="post-sale-receipt-status" class="post-sale-status" aria-live="polite"></div><div class="modal-actions post-sale-footer-actions"><button type="button" class="secondary-button" id="post-sale-new-sale">Nova venda</button></div></div></section>';
    host.querySelector('#post-sale-print').addEventListener('click',e=>{void doPrint(e.currentTarget);});
    host.querySelector('#post-sale-save-pdf').addEventListener('click',e=>{void doPrint(e.currentTarget,true);});
    host.querySelector('#post-sale-remote-send').addEventListener('click',e=>{void sendRemote(e.currentTarget);});
    host.querySelector('#post-sale-remote-check').addEventListener('click',e=>{void remoteJobStatus(e.currentTarget);});
    void availableRemotePrinters(currentSale.id);
    host.querySelector('#post-sale-close').addEventListener('click',closePostSaleModal);
    host.querySelector('#post-sale-new-sale').addEventListener('click',closePostSaleModal);
    const prefs=root.PdvWebHardware.settings();
    if(prefs.printerMode==='bridge'&&prefs.autoPrint){
      if(root.PdvLocalBridge?.pairedToken?.())void doPrint(host.querySelector('#post-sale-print'));
      else notice('Impressão automática pendente: autorize o conector neste computador em Configurações → Impressora.',true);
    }
  }
  if(!Client.prototype.__artisysWebReceiptPatched){
    const original=Client.prototype.completeSale;
    Object.defineProperty(Client.prototype,'__artisysWebReceiptPatched',{value:true});
    Client.prototype.completeSale=async function(...args){
      const result=await original.apply(this,args);
      if(result?.sale?.status==='COMPLETED')setTimeout(()=>showPostSaleModal(result.sale),0);
      return result;
    };
  }
  root.PdvUiLifecycle.on('route:before',closePostSaleModal);
  root.PdvPostSaleReceiptUi=Object.freeze({showPostSaleModal,closePostSaleModal});
})();
