'use strict';
// Browser post-sale experience. Sale data always comes from the canonical tenant API.
(() => {
  const root=window, Client=root.PdvApiClient?.ApiClient;
  if(!Client || !root.PdvWebHardware || !root.PdvUiLifecycle)return;
  const api=new Client();
  let currentSale=null;
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
      const sale=await api.sale(currentSale.id);
      if(sale?.status!=='COMPLETED')throw new Error('Venda não concluída ou indisponível.');
      await root.PdvWebHardware.printSale(sale,{popup,forceBrowser:pdf});
      notice(pdf?'No diálogo, escolha Salvar como PDF.':'Diálogo de impressão aberto ou comando enviado. Confirme o resultado na impressora.');
    }catch(error){
      try{popup?.close();}catch{}
      notice(error?.message||'Falha ao emitir comprovante.',true);
    }finally{button.disabled=false;}
  }
  function showPostSaleModal(sale){
    if(!sale?.id)return;
    currentSale={id:String(sale.id)};
    const host=panel();
    host.classList.remove('hidden');
    host.innerHTML='<section class="modal-card post-sale-card" role="dialog" aria-labelledby="post-sale-title" style="pointer-events:auto;width:100%;max-width:100%;box-sizing:border-box;padding:16px"><header class="modal-head"><div><h2 id="post-sale-title">Venda concluída</h2><p class="post-sale-subtitle">Venda '+esc(sale.saleNumber||sale.id)+' — comprovante disponível.</p></div><button class="modal-close" id="post-sale-close" type="button" aria-label="Fechar">×</button></header><div class="modal-body"><div class="post-sale-summary"><div><span>Total</span><strong>'+esc(money(sale.totalCents))+'</strong></div><div><span>Troco</span><strong>'+esc(money(sale.changeCents))+'</strong></div></div><p class="post-sale-help">A impressão usa os dispositivos deste navegador. O PDF é salvo pelo diálogo do sistema, sem impressora física.</p><div class="post-sale-primary-actions"><button type="button" class="primary-button" id="post-sale-print">Imprimir comprovante</button><button type="button" class="secondary-button post-sale-pdf-button" id="post-sale-save-pdf">Salvar como PDF</button></div><div id="post-sale-receipt-status" class="post-sale-status" aria-live="polite"></div><div class="modal-actions post-sale-footer-actions"><button type="button" class="secondary-button" id="post-sale-new-sale">Nova venda</button></div></div></section>';
    host.querySelector('#post-sale-print').addEventListener('click',e=>{void doPrint(e.currentTarget);});
    host.querySelector('#post-sale-save-pdf').addEventListener('click',e=>{void doPrint(e.currentTarget,true);});
    host.querySelector('#post-sale-close').addEventListener('click',closePostSaleModal);
    host.querySelector('#post-sale-new-sale').addEventListener('click',closePostSaleModal);
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
