'use strict';
/* Browser-only peripheral adapters. No Electron, remote spooler or cloud hardware access. */
(function (root) {
  const STORE_KEY = 'pdv-total.peripherals.v1';
  const DEFAULTS = Object.freeze({ paperMm:80, scaleProfile:'generic', scaleBaud:9600, uranoCommand:'0x04', printerMode:'browser', printerBaud:9600, drawerBaud:9600, cut:false });
  const ports = {scale:null,printer:null,drawer:null};
  let busy = false;

  function settings() {
    let saved = {};
    try { saved = JSON.parse(root.localStorage?.getItem(STORE_KEY)||'{}'); } catch {}
    return normalizeSettings(saved);
  }
  function normalizeSettings(value) {
    const next = {...DEFAULTS};
    if ([58,80].includes(Number(value?.paperMm))) next.paperMm = Number(value.paperMm);
    if (['generic','urano-pop-s'].includes(value?.scaleProfile)) next.scaleProfile = value.scaleProfile;
    if (['0x04','0x05'].includes(value?.uranoCommand)) next.uranoCommand = value.uranoCommand;
    if (['browser','serial'].includes(value?.printerMode)) next.printerMode = value.printerMode;
    for (const field of ['scaleBaud','printerBaud','drawerBaud']) {
      const n = Number(value?.[field]);
      if (Number.isInteger(n) && n >= 300 && n <= 115200) next[field] = n;
    }
    next.cut = value?.cut === true;
    return next;
  }
  function saveSettings(input) {
    const next = normalizeSettings(input);
    root.localStorage?.setItem(STORE_KEY,JSON.stringify(next));
    return next;
  }
  function escapeHtml(value) {
    return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function parseWeight(raw) {
    const clean = String(raw??'').trim();
    const match = /^([+]?\d{1,5}(?:[,.]\d{1,3})?)\s*(kg|g)?$/i.exec(clean);
    if (!match) throw new Error('Resposta da balança inválida ou incompleta. Confira o protocolo.');
    const number = Number(match[1].replace(',','.'));
    const weight = match[2]?.toLowerCase()==='g' ? number/1000 : number;
    if (!Number.isFinite(weight) || weight <= 0 || weight > 1000) throw new Error('Peso fora do intervalo permitido.');
    return {weight:Math.round(weight*1000)/1000,unit:'kg'};
  }
  // Browser-safe port of the canonical Urano POP-S frame recognition (USE-P2 / USE-CB2).
  // Unlike a numeric fallback, unknown data is rejected rather than guessed.
  function parseUranoWeight(input) {
    const data=Uint8Array.from(input||[]);
    if(!data.length)throw new Error('Frame Urano POP-S vazio.');
    const latin=bytes=>Array.from(bytes,b=>String.fromCharCode(b)).join('').replace(/\0/g,' ');
    const text=latin(data);
    const normalize=raw=>{
      const value=String(raw??'').trim().replace(',','.');
      if(!/^[+-]?\d+(?:\.\d+)?$/.test(value))throw new Error('Frame Urano POP-S sem peso válido.');
      const weight=Number(value);
      if(!Number.isFinite(weight)||weight<0)throw new Error('Peso Urano POP-S inválido.');
      return Math.round(weight*1000)/1000;
    };
    const cb=text.match(/PESO\s*L\s*:\s*([+-]?\d+(?:[.,]\d+)?)\s*kg/i);
    if(cb)return normalize(cb[1]);
    for(let start=0;start<data.length-3;start++){
      if(data[start]!==27||data[start+1]!==84||![49,50,51].includes(data[start+2]))continue;
      for(let end=start+3;end<data.length-1;end++){
        if(data[end]!==27||data[end+1]!==69)continue;
        const matches=[...latin(data.slice(start,end+2)).matchAll(/([+-]?\d+(?:[.,]\d+)?)\s*kg/gi)];
        if(matches.length)return normalize(matches[matches.length-1][1]);
        break;
      }
    }
    throw new Error('Frame Urano POP-S inválido ou sem peso líquido reconhecível.');
  }
  function serialApi() {
    if (!root.isSecureContext || !root.navigator?.serial) throw new Error('Porta serial requer Chrome ou Edge em HTTPS (não disponível neste navegador). Informe o peso manualmente.');
    return root.navigator.serial;
  }
  async function getPort(kind,requestPermission=false) {
    const api=serialApi();
    if(ports[kind]) return ports[kind];
    if(requestPermission){ports[kind]=await api.requestPort();return ports[kind];}
    // Never silently reuse a different peripheral's granted port.
    throw new Error('Conecte este dispositivo explicitamente em Dispositivos locais.');
  }
  async function connect(kind) {
    if(!Object.hasOwn(ports,kind)) throw new Error('Dispositivo inválido.');
    // Must be called by a user gesture, not a background task.
    ports[kind]=await serialApi().requestPort();
    return true;
  }
  async function writeSerial(kind,bytes,baudRate) {
    if(busy)throw new Error('Outra operação serial está em andamento.');
    busy=true;
    let port;
    try{
      port=await getPort(kind);
      await port.open({baudRate});
      const writer=port.writable.getWriter();
      try{await writer.write(Uint8Array.from(bytes));}finally{writer.releaseLock();}
      return true;
    }finally{
      try{await port?.close();}catch{}
      busy=false;
    }
  }
  async function readWeight() {
    if(busy) throw new Error('Outra operação serial está em andamento.');
    busy=true;
    let port,reader,timer;
    try{
      const prefs=settings();
      port=await getPort('scale');
      const urano=prefs.scaleProfile==='urano-pop-s';
      await port.open(urano?{baudRate:9600,dataBits:8,stopBits:2,parity:'none'}:{baudRate:prefs.scaleBaud});
      if(urano){
        const writer=port.writable.getWriter();
        try{await writer.write(Uint8Array.of(prefs.uranoCommand==='0x05'?5:4));}finally{writer.releaseLock();}
      }
      reader=port.readable.getReader();
      const chunks=[];
      // Timeout controls the entire read; do not parse a partial serial chunk.
      const timeout = new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),1600);});
      while(true) {
        const next=await Promise.race([reader.read(),timeout]);
        if(next.timeout)break;
        if(next.done)break;
        for(const byte of next.value||[]) {
          if(chunks.length>=256)throw new Error('Resposta serial muito longa.');
          chunks.push(byte);
        }
        // Delimiter means complete response; otherwise wait for idle/timeout.
        if(chunks.some(byte=>byte===10||byte===13))break;
      }
      if(!chunks.length)throw new Error('A balança não respondeu. Confira conexão e porta.');
      const raw=new TextDecoder().decode(Uint8Array.from(chunks)).trim();
      if(urano)return {weight:parseUranoWeight(chunks),unit:'kg'};
      return parseWeight(raw);
    }finally{
      clearTimeout(timer);
      try{await reader?.cancel();}catch{}
      try{reader?.releaseLock();}catch{}
      try{await port?.close();}catch{}
      busy=false;
    }
  }
  function escpos(text,{cut=false,drawer=false}={}) {
    const ascii=String(text).normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^\x0A\x0D\x20-\x7E]/g,'?').slice(0,16000);
    const bytes=[27,64,...new TextEncoder().encode(ascii)];
    if(drawer)bytes.push(27,112,0,25,250);
    if(cut)bytes.push(29,86,0);
    return bytes;
  }
  async function openDrawer() {return writeSerial('drawer',escpos('',{drawer:true}),settings().drawerBaud);}
  function receiptHtml(sale,options={}) {
    if(!sale || sale.status!=='COMPLETED' || !sale.id) throw new Error('Somente venda concluída pode ser impressa.');
    const prefs=normalizeSettings(options);
    const amount=n=>(Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    const qty=n=>Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
    const items=(sale.items||[]).map(item=>
      '<tr><td>'+escapeHtml(item.productName||item.sku||item.productId||'Produto')+
      '</td><td>'+escapeHtml(qty(item.quantity))+'</td><td>'+escapeHtml(amount(item.totalCents??Math.round(item.quantity*item.unitPriceCents)))+'</td></tr>').join('');
    const payments=(sale.payments||[]).map(p=>'<div>'+escapeHtml(p.method)+': '+escapeHtml(amount(p.amountCents))+'</div>').join('');
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Cupom não fiscal</title><style>@page{size:'+prefs.paperMm+'mm auto;margin:3mm}body{font:12px monospace;margin:0;color:#000}h1{text-align:center;font-size:15px}table{width:100%;border-collapse:collapse}td{border-bottom:1px dotted #aaa;padding:6px 2px}td:not(:first-child){text-align:right}strong{font-size:15px}.total{display:flex;justify-content:space-between;margin:12px 0}</style></head><body><h1>PDV TOTAL</h1><p>CUPOM NÃO FISCAL</p><p>Venda '+escapeHtml(sale.saleNumber||sale.id)+'</p><p>'+escapeHtml(sale.completedAt||'')+'</p><table><tbody>'+items+'</tbody></table><div class="total"><strong>TOTAL</strong><strong>'+escapeHtml(amount(sale.totalCents))+'</strong></div>'+payments+'<div>Troco: '+escapeHtml(amount(sale.changeCents))+'</div><hr><p>Obrigado pela preferência.</p></body></html>';
  }
  function openPrintDocument(html,providedPopup) {
    const popup=providedPopup||root.open('','_blank');
    if(!popup)throw new Error('O navegador bloqueou a janela de impressão. Autorize pop-ups para este site.');
    popup.document.open();
    popup.document.write(html);
    popup.document.close();
    popup.focus();
    popup.print();
    // Browser cannot reliably observe physical spooler success or PDF save.
    return {dialogOpened:true};
  }
  function receiptText(sale) {
    const fmt=n=>(Number(n||0)/100).toFixed(2);
    return ['PDV TOTAL','CUPOM NAO FISCAL','Venda '+String(sale.saleNumber||sale.id),String(sale.completedAt||''),...((sale.items||[]).map(i=>String(i.productName||i.sku||i.productId||'Produto')+'  '+String(i.quantity)+' x '+fmt(i.unitPriceCents)+' = '+fmt(i.totalCents??Math.round(i.quantity*i.unitPriceCents)))),'TOTAL: '+fmt(sale.totalCents),...((sale.payments||[]).map(p=>String(p.method)+': '+fmt(p.amountCents))),'Troco: '+fmt(sale.changeCents),'Obrigado pela preferencia.','',''].join('\n');
  }
  async function printSale(sale,opts={}) {
    if(!sale||sale.status!=='COMPLETED'||!sale.id)throw new Error('Venda concluída obrigatória.');
    if(settings().printerMode==='serial' && !opts.forceBrowser) {
      // On-demand serial transport; never send an automatic second copy through browser.
      await writeSerial('printer',escpos(receiptText(sale),{cut:settings().cut}),settings().printerBaud);
      return {sentToSerial:true};
    }
    return openPrintDocument(receiptHtml(sale,settings()),opts.popup);
  }
  function showSettings() {
    const previous=root.document.getElementById('pdv-peripherals-dialog');
    if(previous){previous.showModal();return;}
    const dialog=root.document.createElement('dialog');
    dialog.id='pdv-peripherals-dialog';
    dialog.setAttribute('aria-label','Dispositivos locais');
    dialog.style.cssText='max-width:min(540px,95vw);border:1px solid #64748b;border-radius:16px;padding:24px;color:#e5e7eb;background:#13233e;box-shadow:0 18px 60px #0008';
    dialog.innerHTML='<form method="dialog" id="pdv-peripherals-form"><h2>Dispositivos locais</h2><p>Configuração deste navegador. Não altera vendas nem dados do servidor.</p><label>Papel <select name="paperMm"><option value="58">58 mm</option><option value="80">80 mm</option></select></label><p><label>Impressora <select name="printerMode"><option value="browser">Diálogo do sistema (recomendado)</option><option value="serial">ESC/POS serial compatível (experimental)</option></select></label></p><p><label>Perfil da balança <select name="scaleProfile"><option value="generic">Serial numérico genérico</option><option value="urano-pop-s">Urano POP-S (requer homologação)</option></select></label></p><p><label>Velocidade serial <input name="scaleBaud" type="number" min="300" max="115200"></label></p><p><label>Comando de leitura Urano <select name="uranoCommand"><option value="0x04">0x04 (padrão)</option><option value="0x05">0x05</option></select></label></p><p><label>Velocidade da impressora serial <input name="printerBaud" type="number" min="300" max="115200"></label></p><p><label>Velocidade da gaveta serial <input name="drawerBaud" type="number" min="300" max="115200"></label></p><p><label><input name="cut" type="checkbox"> Acionar corte ESC/POS (somente quando compatível)</label></p><div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" data-device="scale">Conectar balança</button><button type="button" data-device="printer">Conectar impressora serial</button><button type="button" data-device="drawer">Conectar gaveta</button><button type="button" id="pdv-test-printer">Imprimir teste</button><button type="button" id="pdv-test-drawer">Abrir gaveta</button></div><p role="status" id="pdv-peripherals-status" aria-live="polite"></p><div style="display:flex;justify-content:flex-end;gap:8px"><button type="button" id="pdv-peripherals-save">Salvar</button><button value="cancel">Fechar</button></div></form>';
    root.document.body.append(dialog);
    const form=dialog.querySelector('form');
    const saved=settings();
    for(const key of ['paperMm','printerMode','scaleProfile','scaleBaud','uranoCommand','printerBaud','drawerBaud'])form.elements.namedItem(key).value=String(saved[key]);
    form.elements.namedItem('cut').checked=saved.cut;
    const status=dialog.querySelector('#pdv-peripherals-status');
    dialog.addEventListener('click',async e=>{
      const kind=e.target?.dataset?.device;
      try{
        if(kind){await connect(kind);status.textContent='Dispositivo conectado: '+kind+'.';}
        if(e.target?.id==='pdv-test-printer'){
          saveSettings({...settings(),...Object.fromEntries(new FormData(form)),cut:form.elements.namedItem('cut').checked});
          await printTest();
          status.textContent='Diálogo aberto ou comando enviado. Confirme o resultado no equipamento.';
        }
        if(e.target?.id==='pdv-test-drawer'){await openDrawer();status.textContent='Pulso enviado; verifique a gaveta.';}
        if(e.target?.id==='pdv-peripherals-save'){
          saveSettings({...settings(),...Object.fromEntries(new FormData(form)),cut:form.elements.namedItem('cut').checked});
          status.textContent='Preferências deste navegador salvas.';
        }
      }catch(error){status.textContent=error?.message||'Falha ao acessar dispositivo.';}
    });
    dialog.showModal();
  }
  function printTest(){
    return printSale({id:'TESTE',status:'COMPLETED',saleNumber:'TESTE',completedAt:new Date().toISOString(),items:[],payments:[],totalCents:0,changeCents:0});
  }
  root.PdvWebHardware=Object.freeze({settings,saveSettings,readWeight,connect,openDrawer,printSale,printTest,showSettings});
  root.PdvWebHardwareUtils=Object.freeze({parseWeight,parseUranoWeight,normalizeSettings,receiptHtml,receiptText,escpos,escapeHtml});
  root.document?.addEventListener('click',e=>{
    if(e.target?.closest?.('#peripherals-settings'))showSettings();
  });
})(window);
