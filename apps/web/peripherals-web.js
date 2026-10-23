'use strict';
/* Browser-only peripheral adapters. No Electron, remote spooler or cloud hardware access. */
(function (root) {
  const STORE_KEY = 'pdv-total.peripherals.v1';
  const DEFAULTS = Object.freeze({ paperMm:80, scaleProfile:'generic', scaleBaud:9600, uranoCommand:'0x04', printerMode:'browser', printerBaud:9600, drawerBaud:9600, cut:false, autoPrint:false });
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
    if (['browser','serial','bridge'].includes(value?.printerMode)) next.printerMode = value.printerMode;
    for (const field of ['scaleBaud','printerBaud','drawerBaud']) {
      const n = Number(value?.[field]);
      if (Number.isInteger(n) && n >= 300 && n <= 115200) next[field] = n;
    }
    next.cut = value?.cut === true;
    next.autoPrint=value?.autoPrint === true;
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
    const match = /^(?:(?:ST|S),\s*(?:GS|NT),\s*)?[+]?\s*(\d{1,5}(?:[,.]\d{1,3})?)\s*(kg|g)?$/i.exec(clean);
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
    }catch(error){
      // USB/serial disconnect invalidates a formerly approved handle. Never reuse
      // an uncertain port or silently ask for another device in a background task.
      ports[kind]=null;
      throw error;
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
    }catch(error){
      // A timeout or transport error requires another explicit connect gesture.
      ports.scale=null;
      throw error;
    }finally{
      clearTimeout(timer);
      try{await reader?.cancel();}catch{}
      try{reader?.releaseLock();}catch{}
      try{await port?.close();}catch{}
      busy=false;
    }
  }
  // ESC/POS codepage 2 (CP850) preserves Portuguese accents in thermal receipts.
  // Unsupported glyphs degrade to '?' rather than emitting arbitrary device commands.
  const CP850_PT=Object.freeze({
    'á':160,'à':133,'â':131,'ã':198,'é':130,'ê':136,'í':161,
    'ó':162,'ô':147,'õ':228,'ú':163,'ü':129,'ç':135,
    'Á':181,'À':183,'Â':182,'Ã':199,'É':144,'Ê':210,'Í':214,
    'Ó':224,'Ô':226,'Õ':229,'Ú':233,'Ü':154,'Ç':128,
    'º':167,'ª':166,'°':248
  });
  function escpos(text,{cut=false,drawer=false}={}) {
    const bytes=[27,64,27,116,2]; // Initialize, select CP850.
    for(const char of String(text??'').slice(0,16000)){
      const n=char.charCodeAt(0);
      if(n===10||n===13||(n>=32&&n<=126))bytes.push(n);
      else bytes.push(CP850_PT[char]??63);
    }
    if(drawer)bytes.push(27,112,0,25,250);
    if(cut)bytes.push(29,86,0);
    return bytes;
  }
  async function openDrawer() {if(settings().printerMode==='bridge')return root.PdvLocalBridge.drawer();return writeSerial('drawer',escpos('',{drawer:true}),settings().drawerBaud);}
  function receiptHtml(sale,options={}) {
    const prebill=options.documentType==='PREBILL';
    if(!sale?.id||(prebill?!['OPEN','SUSPENDED'].includes(sale.status):sale.status!=='COMPLETED'))
      throw new Error(prebill?'Pré-conta exige venda em aberto.':'Somente venda concluída pode ser impressa.');
    const prefs=normalizeSettings(options);
    const branding=root.PdvReceiptBranding?.normalize(options.branding||root.PdvReceiptBranding.read())||options.branding||{name:'PDV TOTAL',address:'',phone:'',logoDataUrl:null};
    const amount=n=>(Number(n||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    const qty=n=>Number(n||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
    const items=(sale.items||[]).map(item=>
      '<tr><td>'+escapeHtml(item.productName||item.sku||item.productId||'Produto')+
      '</td><td>'+escapeHtml(qty(item.quantity))+'</td><td>'+escapeHtml(amount(item.totalCents??Math.round(item.quantity*item.unitPriceCents)))+'</td></tr>').join('');
    const payments=(sale.payments||[]).map(p=>'<div>'+escapeHtml(p.method)+': '+escapeHtml(amount(p.amountCents))+'</div>').join('');
    return '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>'+(prebill?'Pré-conta':'Cupom não fiscal')+'</title><style>@page{size:'+prefs.paperMm+'mm auto;margin:3mm}body{font:12px monospace;margin:0;color:#000}h1{text-align:center;font-size:15px}.receipt-logo{max-width:95%;max-height:26mm;display:block;margin:0 auto 2mm;object-fit:contain}.receipt-meta{text-align:center;overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}td{border-bottom:1px dotted #aaa;padding:6px 2px}td:not(:first-child){text-align:right}strong{font-size:15px}.total{display:flex;justify-content:space-between;margin:12px 0}</style></head><body>'+(branding.logoDataUrl?'<img class="receipt-logo" src="'+escapeHtml(branding.logoDataUrl)+'" alt="Logotipo da loja">':'')+'<h1>'+escapeHtml(branding.name)+'</h1>'+(branding.address?'<p class="receipt-meta">'+escapeHtml(branding.address)+'</p>':'')+(branding.phone?'<p class="receipt-meta">Telefone: '+escapeHtml(branding.phone)+'</p>':'')+'<p>'+(prebill?'PRÉ-CONTA · NÃO FISCAL':'CUPOM NÃO FISCAL')+'</p><p>Venda '+escapeHtml(sale.saleNumber||sale.id)+'</p><p>'+escapeHtml(sale.completedAt||'')+'</p><table><tbody>'+items+'</tbody></table><div class="total"><strong>TOTAL</strong><strong>'+escapeHtml(amount(sale.totalCents))+'</strong></div>'+payments+'<div>Troco: '+escapeHtml(amount(sale.changeCents))+'</div><hr><p>Obrigado pela preferência.</p></body></html>';
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
  function receiptText(sale,options={}) {
    if(!sale||sale.status!=='COMPLETED'||!sale.id)throw new Error('Somente venda concluída pode ser impressa.');
    const branding=root.PdvReceiptBranding?.normalize(options.branding||root.PdvReceiptBranding.read())||options.branding||{name:'PDV TOTAL',address:'',phone:''};
    const fmt=n=>(Number(n||0)/100).toFixed(2);
    return [branding.name,...(branding.address?[branding.address]:[]),...(branding.phone?['Telefone: '+branding.phone]:[]),'CUPOM NAO FISCAL','Venda '+String(sale.saleNumber||sale.id),String(sale.completedAt||''),...((sale.items||[]).map(i=>String(i.productName||i.sku||i.productId||'Produto')+'  '+String(i.quantity)+' x '+fmt(i.unitPriceCents)+' = '+fmt(i.totalCents??Math.round(i.quantity*i.unitPriceCents)))),'TOTAL: '+fmt(sale.totalCents),...((sale.payments||[]).map(p=>String(p.method)+': '+fmt(p.amountCents))),'Troco: '+fmt(sale.changeCents),'Obrigado pela preferencia.','',''].join('\n');
  }
  function printTextDocument(document,{popup}={}){
    if(!document||document.fiscal!==false||!['KITCHEN_TICKET','CASH_CLOSE','TABLE_PREBILL'].includes(document.documentType)
      ||typeof document.text!=='string'||document.text.length>14000)
      throw new Error('Documento não fiscal canônico e limitado obrigatório.');
    const paperMm=settings().paperMm;
    const html='<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Documento não fiscal</title>'
      +'<style>@page{size:'+paperMm+'mm auto;margin:3mm}body{margin:0;color:#000}pre{font:11px monospace;white-space:pre-wrap;overflow-wrap:anywhere}</style>'
      +'</head><body><pre>'+escapeHtml(document.text)+'</pre></body></html>';
    return openPrintDocument(html,popup);
  }
  function printPrebill(document,{popup}={}) {
    if(document?.documentType!=='PREBILL'||!document.sale||!document.branding)
      throw new Error('Pré-conta canônica exigida.');
    return openPrintDocument(receiptHtml(document.sale,{...settings(),branding:document.branding,documentType:'PREBILL'}),popup);
  }
  async function printSale(sale,opts={}) {
    if(!sale||sale.status!=='COMPLETED'||!sale.id)throw new Error('Venda concluída obrigatória.');
    if(settings().printerMode==='bridge' && !opts.forceBrowser){const job=await root.PdvLocalBridge.print(sale,opts.text||receiptText(sale,{branding:opts.branding}),{reprint:opts.reprint===true});return {queued:true,job};}
    if(settings().printerMode==='serial' && !opts.forceBrowser) {
      // On-demand serial transport; never send an automatic second copy through browser.
      const branding=opts.branding||root.PdvReceiptBranding?.read?.();
      const bytes=escpos(opts.text||receiptText(sale,{branding}),{cut:settings().cut});
      if(branding?.logoDataUrl){
        // Rasterize first; a decode error must NOT send a misleading text-only cupom.
        if(!root.PdvEscposLogo?.encode)throw Error('Driver de logotipo ESC/POS indisponível.');
        const raster=await root.PdvEscposLogo.encode(branding.logoDataUrl,{paperMm:settings().paperMm});
        bytes.splice(2,0,...raster); // ESC @ then bounded GS v 0 bitmap then text
      }
      await writeSerial('printer',bytes,settings().printerBaud);
      return {sentToSerial:true};
    }
    return openPrintDocument(receiptHtml(sale,{...settings(),branding:opts.branding}),opts.popup);
  }

  function settingsMarkup(){
    return [
      '<form method="dialog" id="pdv-peripherals-form" class="pdv-peripherals-form">',
      '<header class="pdv-peripherals-header"><div><p class="pdv-peripherals-eyebrow">Configurações deste terminal</p><h2 id="pdv-peripherals-title">Dispositivos e impressão</h2><p>Configure a impressão e os equipamentos conectados a este dispositivo.</p></div><button type="button" id="pdv-peripherals-close" class="pdv-peripherals-close" aria-label="Fechar configurações">×</button></header>',
      '<nav class="pdv-peripherals-tabs" role="tablist" aria-label="Tipo de dispositivo">',
      '<button type="button" role="tab" data-peripherals-tab="printer" id="pdv-peripherals-tab-printer" aria-controls="pdv-peripherals-panel-printer" aria-selected="true" tabindex="0">Impressora</button>',
      '<button type="button" role="tab" data-peripherals-tab="scale" id="pdv-peripherals-tab-scale" aria-controls="pdv-peripherals-panel-scale" aria-selected="false" tabindex="-1">Balança</button>',
      '<button type="button" role="tab" data-peripherals-tab="drawer" id="pdv-peripherals-tab-drawer" aria-controls="pdv-peripherals-panel-drawer" aria-selected="false" tabindex="-1">Gaveta</button>',
      '<button type="button" role="tab" data-peripherals-tab="receipt" id="pdv-peripherals-tab-receipt" aria-controls="pdv-peripherals-panel-receipt" aria-selected="false" tabindex="-1">Comprovante</button>',
      '</nav><div class="pdv-peripherals-content">',
      '<section role="tabpanel" id="pdv-peripherals-panel-printer" aria-labelledby="pdv-peripherals-tab-printer" data-peripherals-panel="printer">',
      '<h3>Impressão de comprovantes</h3><p class="pdv-peripherals-muted">Para imprimir normalmente, use o navegador. Não é necessário instalar um conector nem informar código de pareamento.</p>',
      '<label class="pdv-peripherals-field">Como deseja imprimir?<select name="printerMode"><option value="browser">Impressão pelo navegador (recomendado)</option><option value="serial">Impressora serial ESC/POS (experimental)</option><option value="bridge">Conector local (sem janela de impressão)</option></select></label>',
      '<div class="pdv-peripherals-method" data-printer-mode="browser"><strong>Pronto para imprimir pelo navegador</strong><p>Sem instalação adicional ou chave. O sistema abre a janela de impressão do dispositivo para escolher a impressora ou salvar PDF.</p></div>',
      '<div class="pdv-peripherals-method" data-printer-mode="serial" hidden><strong>Impressora serial</strong><p>A conexão depende do suporte Web Serial do navegador e de autorização explícita. Este modo não foi homologado para todos os modelos.</p><p data-serial-warning="printer" class="pdv-peripherals-warning" hidden></p><div class="pdv-peripherals-field-grid"><label class="pdv-peripherals-field">Velocidade serial (bps)<input name="printerBaud" type="number" min="300" max="115200"></label></div><label class="pdv-peripherals-check"><input name="cut" type="checkbox"> Acionar corte ESC/POS somente quando compatível</label><button type="button" data-device="printer" class="pdv-peripherals-secondary">Conectar impressora serial</button><p class="pdv-peripherals-state" data-device-status="printer">Impressora serial não conectada.</p></div>',
      '<div class="pdv-peripherals-method" data-printer-mode="bridge" hidden><strong>Impressão automática pelo computador</strong><p>Opção avançada: exige um conector open source executando no mesmo computador. O código de pareamento é exibido no terminal ao iniciar o conector — não é a licença do PDV.</p><p class="pdv-peripherals-warning" data-bridge-mobile-warning hidden>Este conector usa o próprio computador (127.0.0.1). Para imprimir pelo celular, use o diálogo de impressão do sistema; o pareamento com uma impressora de outro PC não está disponível neste modo.</p><label class="pdv-peripherals-field">Código do conector local<input name="bridgeToken" type="password" autocomplete="off" placeholder="Código gerado no computador (64 caracteres)"></label><div class="pdv-peripherals-actions"><button type="button" id="pdv-bridge-connect" class="pdv-peripherals-secondary">Conectar serviço local</button><button type="button" id="pdv-bridge-queue" class="pdv-peripherals-secondary">Consultar fila</button></div><label class="pdv-peripherals-check"><input name="autoPrint" type="checkbox"> Imprimir automaticamente após a conclusão da venda (apenas conector local)</label><div id="pdv-bridge-history" class="pdv-peripherals-history"></div></div>',
      '<label class="pdv-peripherals-field">Largura do papel<select name="paperMm"><option value="58">58 mm</option><option value="80">80 mm</option></select></label><button type="button" id="pdv-test-printer" class="pdv-peripherals-secondary">Imprimir teste</button><p class="pdv-peripherals-note">O teste abre o diálogo ou envia uma solicitação; confirme a saída física na impressora.</p>',
      '</section>',
      '<section role="tabpanel" id="pdv-peripherals-panel-scale" aria-labelledby="pdv-peripherals-tab-scale" data-peripherals-panel="scale" hidden>',
      '<h3>Balança</h3><p class="pdv-peripherals-muted">Conecte uma balança serial compatível apenas quando for utilizar pesagem na venda.</p><label class="pdv-peripherals-field">Modelo da balança<select name="scaleProfile"><option value="generic">Serial numérica genérica</option><option value="urano-pop-s">Urano POP-S (requer homologação)</option></select></label><p data-serial-warning="scale" class="pdv-peripherals-warning" hidden></p><button type="button" data-device="scale" class="pdv-peripherals-secondary">Conectar balança</button><p class="pdv-peripherals-state" data-device-status="scale">Balança não conectada.</p><details class="pdv-peripherals-advanced"><summary>Configurações avançadas da balança</summary><div class="pdv-peripherals-field-grid"><label class="pdv-peripherals-field">Velocidade serial (bps)<input name="scaleBaud" type="number" min="300" max="115200"></label><label class="pdv-peripherals-field">Comando de leitura Urano<select name="uranoCommand"><option value="0x04">0x04 (padrão)</option><option value="0x05">0x05</option></select></label></div></details>',
      '</section>',
      '<section role="tabpanel" id="pdv-peripherals-panel-drawer" aria-labelledby="pdv-peripherals-tab-drawer" data-peripherals-panel="drawer" hidden>',
      '<h3>Gaveta de dinheiro</h3><p class="pdv-peripherals-muted">Somente gavetas seriais compatíveis com o pulso ESC/POS. A abertura exige ação explícita.</p><p data-serial-warning="drawer" class="pdv-peripherals-warning" hidden></p><div class="pdv-peripherals-actions"><button type="button" data-device="drawer" class="pdv-peripherals-secondary">Conectar gaveta</button><button type="button" id="pdv-test-drawer" class="pdv-peripherals-secondary">Abrir gaveta (teste)</button></div><p class="pdv-peripherals-state" data-device-status="drawer">Gaveta não conectada.</p><details class="pdv-peripherals-advanced"><summary>Configurações avançadas da gaveta</summary><label class="pdv-peripherals-field">Velocidade serial (bps)<input name="drawerBaud" type="number" min="300" max="115200"></label></details>',
      '</section>',
      '<section role="tabpanel" id="pdv-peripherals-panel-receipt" aria-labelledby="pdv-peripherals-tab-receipt" data-peripherals-panel="receipt" hidden>',
      '<h3>Identificação do comprovante não fiscal</h3><p class="pdv-peripherals-muted">Estes dados pertencem à filial e são compartilhados. Comprovantes de vendas anteriores preservam a identificação da venda.</p>',
      '<fieldset class="pdv-peripherals-branding"><legend>Dados da filial</legend><label class="pdv-peripherals-field">Nome da loja<input name="receiptName" maxlength="80" autocomplete="organization"></label><label class="pdv-peripherals-field">Endereço<input name="receiptAddress" maxlength="160" autocomplete="street-address"></label><label class="pdv-peripherals-field">Telefone<input name="receiptPhone" maxlength="60" autocomplete="tel"></label><label class="pdv-peripherals-field">Logotipo PNG (até 512 KB; somente no PDF e no diálogo do navegador)<input type="file" name="receiptLogo" accept="image/png"></label><label class="pdv-peripherals-check"><input type="checkbox" name="receiptRemoveLogo"> Remover logotipo atual</label></fieldset>',
      '<p class="pdv-peripherals-muted" data-branding-restricted hidden>Seu perfil não tem acesso à identificação do comprovante.</p>',
      '</section>',
      '</div><div class="pdv-peripherals-footer"><p role="status" id="pdv-peripherals-status" aria-live="polite"></p><div class="pdv-peripherals-footer-buttons"><button type="button" class="pdv-peripherals-secondary" data-peripherals-close>Fechar</button><button type="button" id="pdv-peripherals-save" class="pdv-peripherals-primary">Salvar configurações</button></div></div></form>'
    ].join('');
  }

  function showSettings() {
    const previous=root.document.getElementById('pdv-peripherals-dialog');
    if(previous){previous.close();previous.remove();}
    const canReadBranding=()=>root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,'settings.view')===true;
    const canManageBranding=()=>root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,'settings.manage')===true;
    const dialog=root.document.createElement('dialog');
    dialog.id='pdv-peripherals-dialog';
    dialog.setAttribute('aria-label','Dispositivos e impressão');
    dialog.className='pdv-peripherals-dialog';
    dialog.innerHTML=settingsMarkup();
    root.document.body.append(dialog);
    const form=dialog.querySelector('form');
    const saved=settings();

    // A method selected for one peripheral must never expose unrelated credentials.
    const tabButtons=Array.from(dialog.querySelectorAll('[data-peripherals-tab]'));
    function selectPanel(selected){
      for(const button of tabButtons){
        const active=button.dataset.peripheralsTab===selected;
        button.setAttribute('aria-selected',String(active));
        button.tabIndex=active?0:-1;
      }
      for(const panel of dialog.querySelectorAll('[data-peripherals-panel]'))
        panel.hidden=panel.dataset.peripheralsPanel!==selected;
    }
    function updatePrinterMode(){
      const mode=form.elements.namedItem('printerMode').value;
      for(const section of dialog.querySelectorAll('[data-printer-mode]'))
        section.hidden=section.dataset.printerMode!==mode;
      const unsupported=(mode==='serial'&&!supportsSerial)||(mode==='bridge'&&isMobile);
      const test=dialog.querySelector('#pdv-test-printer');
      test.disabled=unsupported;
      test.title=unsupported?'Este método de impressão não está disponível neste dispositivo.':'';
    }
    const supportsSerial=Boolean(root.isSecureContext&&root.navigator?.serial);
    const isMobile=/Android|iPhone|iPad|iPod/i.test(root.navigator?.userAgent||'');
    for(const kind of ['printer','scale','drawer']){
      const warning=dialog.querySelector('[data-serial-warning="'+kind+'"]');
      if(!supportsSerial&&warning){
        warning.hidden=false;
        warning.textContent='Conexão serial indisponível neste navegador. Use Chrome ou Edge em um computador com HTTPS.'+(kind==='scale'?' Quando permitido, informe o peso manualmente na venda.':'');
      }
      const button=dialog.querySelector('[data-device="'+kind+'"]');
      if(button&&!supportsSerial){button.disabled=true;button.title='Web Serial não está disponível neste navegador.';}
    }
    const mobileWarning=dialog.querySelector('[data-bridge-mobile-warning]');
    if(mobileWarning)mobileWarning.hidden=!isMobile;
    for(const id of ['pdv-bridge-connect','pdv-bridge-queue']){
      const button=dialog.querySelector('#'+id);
      if(button&&isMobile){button.disabled=true;button.title='O conector local funciona no computador onde está instalado.';}
    }
    dialog.querySelector('[data-branding-restricted]').hidden=canReadBranding();
    form.addEventListener('submit',event=>event.preventDefault());
    form.elements.namedItem('printerMode').addEventListener('change',updatePrinterMode);
    dialog.addEventListener('click',event=>{
      if(event.target?.closest?.('[data-peripherals-close]')||event.target?.id==='pdv-peripherals-close'){
        dialog.close();return;
      }
      const tab=event.target?.closest?.('[data-peripherals-tab]');
      if(tab)selectPanel(tab.dataset.peripheralsTab);
    });
    for(const button of tabButtons)button.addEventListener('keydown',event=>{
      const index=tabButtons.indexOf(button);
      const target=event.key==='Home'?0:event.key==='End'?tabButtons.length-1
        :event.key==='ArrowRight'?(index+1)%tabButtons.length
        :event.key==='ArrowLeft'?(index+tabButtons.length-1)%tabButtons.length:null;
      if(target===null)return;
      event.preventDefault();selectPanel(tabButtons[target].dataset.peripheralsTab);tabButtons[target].focus();
    });
    updatePrinterMode();
    const brandingFields=dialog.querySelector('fieldset');
    brandingFields.disabled=true;
    if(!canReadBranding())brandingFields.hidden=true;
    dialog.addEventListener('close',()=>dialog.remove());
    let receiptBrand=root.PdvReceiptBranding?.read()||{name:'PDV TOTAL',address:'',phone:'',logoDataUrl:null};
    for(const [key,value] of [['receiptName',receiptBrand.name],['receiptAddress',receiptBrand.address],['receiptPhone',receiptBrand.phone]])form.elements.namedItem(key).value=value;
    for(const key of ['paperMm','printerMode','scaleProfile','scaleBaud','uranoCommand','printerBaud','drawerBaud'])form.elements.namedItem(key).value=String(saved[key]);
    form.elements.namedItem('cut').checked=saved.cut;
    form.elements.namedItem('autoPrint').checked=saved.autoPrint;
    const status=dialog.querySelector('#pdv-peripherals-status');
    if(canReadBranding()&&root.PdvReceiptBranding?.load){
      status.textContent='Carregando identificação da filial…';
      void root.PdvReceiptBranding.load().then(value=>{
        receiptBrand=value;
        for(const [field,key] of [['receiptName','name'],['receiptAddress','address'],['receiptPhone','phone']])
          form.elements.namedItem(field).value=value[key]||'';
        brandingFields.disabled=!canManageBranding();
        status.textContent='Identificação carregada do servidor.';
      }).catch(error=>{
        status.textContent='Não foi possível carregar a identificação da filial: '+(error?.message||'Conexão indisponível.')+
          ' A identificação não pode ser alterada offline.';
      });
    }
    async function refreshBridgeJobs(){
      const data=await root.PdvLocalBridge.jobs();
      const pane=dialog.querySelector('#pdv-bridge-history');
      pane.replaceChildren();
      for(const job of (data.jobs||[]).slice(0,20)){
        const row=root.document.createElement('div');
        row.style.cssText='display:flex;gap:8px;align-items:center;padding:4px 0;';
        const text=root.document.createElement('span');
        text.textContent=job.saleId+' · '+job.status+' · '+job.attempts+' tentativa(s)';
        row.append(text);
        if(job.status==='FAILED'){
          const retry=root.document.createElement('button');
          retry.type='button';
          retry.textContent='Tentar novamente';
          retry.addEventListener('click',async()=>{
            retry.disabled=true;
            try{await root.PdvLocalBridge.retry(job.id);await refreshBridgeJobs();}
            catch(e){status.textContent=e.message;}
            finally{retry.disabled=false;}
          });
          row.append(retry);
        }
        pane.append(row);
      }
      if(!data.jobs?.length)pane.textContent='Fila vazia.';
    }
    dialog.addEventListener('click',async e=>{
      const button=e.target?.closest?.('button');
      const kind=button?.dataset?.device;
      const action=kind||['pdv-test-printer','pdv-bridge-connect','pdv-bridge-queue','pdv-test-drawer','pdv-peripherals-save'].includes(button?.id);
      if(!action||button.disabled)return;
      button.disabled=true;
      let localSaved=false;
      try{
        status.textContent='Processando solicitação…';
        if(kind){
          await connect(kind);
          const node=dialog.querySelector('[data-device-status="'+kind+'"]');
          if(node)node.textContent='Dispositivo autorizado e conectado para uso nesta sessão.';
          status.textContent='Dispositivo autorizado: '+kind+'.';
        }
        if(button.id==='pdv-test-printer'){
          saveSettings({...settings(),...Object.fromEntries(new FormData(form)),cut:form.elements.namedItem('cut').checked,autoPrint:form.elements.namedItem('autoPrint').checked});
          const result=await printTest();
          status.textContent=result?.dialogOpened?'Janela de impressão solicitada. Confirme a saída no equipamento.'
            :result?.status==='UNCERTAIN'?'Resultado incerto. Confira a impressora antes de tentar novamente.'
            :'Solicitação enviada à impressora. Confirme a saída física no equipamento.';
        }
        if(button.id==='pdv-bridge-connect'){
          const token=form.elements.namedItem('bridgeToken').value;
          if(token)root.PdvLocalBridge.pair(token);
          await root.PdvLocalBridge.getStatus();
          status.textContent='Conector local pareado e autenticado.';
        }
        if(button.id==='pdv-bridge-queue'){
          const token=form.elements.namedItem('bridgeToken').value;
          if(token)root.PdvLocalBridge.pair(token);
          await refreshBridgeJobs();
          status.textContent='Fila local atualizada.';
        }
        if(button.id==='pdv-test-drawer'){await openDrawer();status.textContent='Pulso enviado; verifique a gaveta.';}
        if(button.id==='pdv-peripherals-save'){
          const token=form.elements.namedItem('bridgeToken').value;
          if(token&&form.elements.namedItem('printerMode').value==='bridge')root.PdvLocalBridge.pair(token);
          saveSettings({...settings(),...Object.fromEntries(new FormData(form)),cut:form.elements.namedItem('cut').checked,autoPrint:form.elements.namedItem('autoPrint').checked});
          localSaved=true;
          status.textContent='Preferências dos dispositivos salvas neste navegador.';
          if(!canManageBranding()||brandingFields.disabled)return;
          const logoFile=form.elements.namedItem('receiptLogo').files?.[0];
          let logoDataUrl=receiptBrand.logoDataUrl;
          if(form.elements.namedItem('receiptRemoveLogo').checked)logoDataUrl=null;
          if(logoFile){
            if(logoFile.type!=='image/png'||logoFile.size<8||logoFile.size>root.PdvReceiptBranding.MAX_LOGO_BYTES)
              throw Error('Use um PNG válido com no máximo 512 KB.');
            logoDataUrl=await new Promise((resolve,reject)=>{
              const reader=new FileReader();
              reader.onerror=()=>reject(Error('Falha ao ler PNG.'));
              reader.onload=()=>resolve(reader.result);
              reader.readAsDataURL(logoFile);
            });
            if(!root.PdvReceiptBranding.normalize({logoDataUrl}).logoDataUrl)
              throw Error('Arquivo não contém um logotipo PNG válido.');
          }
          const updated=await root.PdvReceiptBranding.save({
            name:form.elements.namedItem('receiptName').value,
            address:form.elements.namedItem('receiptAddress').value,
            phone:form.elements.namedItem('receiptPhone').value,
            logoDataUrl});
          receiptBrand=updated;
          status.textContent='Identificação sincronizada com a filial. Preferências dos dispositivos salvas neste navegador.';
        }
      }catch(error){status.textContent=(localSaved?'As preferências locais foram salvas. Falha ao sincronizar a identificação: ':'')+(error?.message||'Falha ao acessar dispositivo.');}
      finally{button.disabled=false;}
    });
    dialog.showModal();
  }
  function printTest(){
    return printSale({id:('TESTE-'+(root.crypto?.randomUUID?.()||String(Date.now())+'-'+Math.random().toString(36).slice(2))),status:'COMPLETED',saleNumber:'TESTE',completedAt:new Date().toISOString(),items:[],payments:[],totalCents:0,changeCents:0});
  }
  root.PdvWebHardware=Object.freeze({settings,saveSettings,readWeight,connect,openDrawer,printSale,printPrebill,printTextDocument,printTest,showSettings});
  root.PdvWebHardwareUtils=Object.freeze({parseWeight,parseUranoWeight,normalizeSettings,receiptHtml,receiptText,escpos,escapeHtml,settingsMarkup});
  root.document?.addEventListener('click',e=>{
    if(e.target?.closest?.('#peripherals-settings'))showSettings();
  });
})(window);
