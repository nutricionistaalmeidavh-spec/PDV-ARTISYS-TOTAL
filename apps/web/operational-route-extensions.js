'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;if(!ApiClient)return;
  const api=new ApiClient();
  const ux=window.ArtisysUxComponents;
  const ui=window.PdvUiModel;
  const statusLabel=value=>ui?.statusLabel?.(value,String(value||''))||String(value||'');
  const paymentLabel=value=>ui?.paymentMethodLabel?.(value,String(value||''))||String(value||'');
  const accountTypeLabel=value=>({CASH:'Dinheiro',BANK:'Banco',CARD:'Cartão',OTHER:'Outro'})[String(value||'').toUpperCase()]||String(value||'');
  const REQUEST_TIMEOUT_MS=5000;
  async function withTimeout(promise,message){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),REQUEST_TIMEOUT_MS);})]);}finally{clearTimeout(timer);}}
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const qty=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
  const toast=(message,error=false)=>window.PdvToast?.show?.(message,error?'error':'success');
  const currentPage=()=>document.getElementById('route-content')?.querySelector('.ops-page,.page');
  const field=(name,label,type='text',extra='')=>`<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" type="${esc(type)}" ${extra}></label>`;

  async function mountInventory(page=currentPage()){
    if(!page||page.querySelector('#backend-parity-stock'))return;
    const installation=await api.initialize().catch(()=>null);
    if(!page.isConnected||installation?.dataServer?.mode==='local')return;
    const heading=[...page.querySelectorAll('h2')].find(node=>node.textContent.trim()==='Posição de estoque');if(heading)heading.textContent='Posição do estoque principal (MAIN)';
    const card=document.createElement('section');card.id='backend-parity-stock';card.className='ops-card';
    card.innerHTML='<div class="ops-card-head"><div><h2>Estoque por local</h2><p class="ops-muted">Consulte e movimente um local específico sem misturar saldos entre lojas/depósitos.</p></div></div><div data-local-stock-body><div class="ops-loader"></div></div>';
    page.appendChild(card);
    try{
      let locations;
      try{locations=await withTimeout(api.stockLocations(),'O detalhamento por local não respondeu.');}
      catch{locations=[{id:'MAIN',name:'Estoque principal'}];}
      const cfg=await api.initialize();
      const body=card.querySelector('[data-local-stock-body]');
      body.innerHTML=`<div class="ops-form-grid"><label class="field"><span>Local</span><select id="parity-stock-location">${locations.map(row=>`<option value="${esc(row.id)}">${esc(row.name)} (${esc(row.id)})</option>`).join('')}</select></label><label class="field"><span>Visão</span><select id="parity-stock-view"><option value="local">Local selecionado</option><option value="aggregate">Total da empresa</option></select></label></div><div id="parity-stock-summary"></div><section class="ops-card"><h3>Movimentar local</h3><form id="parity-stock-move" class="ops-form-grid" novalidate><label class="field"><span>Produto</span><select name="productId" required></select></label><label class="field"><span>Tipo</span><select name="type"><option value="purchase">Entrada/compra</option><option value="adjustment-in">Ajuste de entrada</option><option value="adjustment-out">Ajuste de saída</option><option value="inventory-count">Inventário</option></select></label>${field('quantity','Quantidade','number','min="0.001" step="0.001" required')}${field('reason','Motivo','text','required')}<button class="ops-primary" type="submit">Registrar no local</button></form></section><div id="parity-stock-table"></div><small class="ops-muted">Terminal atual: ${esc(cfg.terminalId||'—')}</small>`;
      const locationSelect=body.querySelector('#parity-stock-location');const viewSelect=body.querySelector('#parity-stock-view');
      async function load(){
        const aggregate=viewSelect.value==='aggregate';const locationId=locationSelect.value||'MAIN';
        let balances,movements,fallback=false;
        try{[balances,movements]=await withTimeout(Promise.all([api.stockBalances({locationId,aggregate}),api.stockMovementsByLocation(aggregate?{}:{locationId})]),'O estoque por local demorou demais para responder.');}
        catch(error){if(locationId!=='MAIN'||aggregate)throw error;fallback=true;[balances,movements]=await Promise.all([api.inventoryBalances(),api.inventoryMovements()]);}
        const products=balances.filter(row=>row.trackStock!==false);
        body.querySelector('#parity-stock-summary').innerHTML=fallback?'<div class="ops-warning">Detalhamento por local indisponível; exibindo o estoque principal sem travar a tela.</div>':`<p class="ops-muted">${aggregate?'Total consolidado da empresa':`Saldo físico em ${esc(locationId)}`}</p>`;
        body.querySelector('#parity-stock-table').innerHTML=`<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Produto</th><th>Saldo</th><th>Mínimo</th><th>Situação</th></tr></thead><tbody>${balances.map(row=>`<tr><td>${esc(row.name)}</td><td>${qty(row.quantity)} ${esc(row.unit||'')}</td><td>${qty(row.minimumStock)}</td><td>${row.lowStock?'BAIXO':'OK'}</td></tr>`).join('')||'<tr><td colspan="4">Sem produtos.</td></tr>'}</tbody></table></div><details><summary>Movimentações deste local</summary><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Produto</th><th>Tipo</th><th>Movimento</th><th>Depois</th></tr></thead><tbody>${movements.slice(-50).reverse().map(row=>`<tr><td>${esc(row.productId)}</td><td>${esc(accountTypeLabel(row.type))}</td><td>${qty(row.quantityDelta)}</td><td>${qty(row.quantityAfter)}</td></tr>`).join('')||'<tr><td colspan="4">Sem movimentações.</td></tr>'}</tbody></table></div></details>`;
        const productSelect=body.querySelector('#parity-stock-move select[name="productId"]');productSelect.innerHTML=products.map(row=>`<option value="${esc(row.productId)}">${esc(row.name)}</option>`).join('');
        body.querySelector('#parity-stock-move button').disabled=aggregate;
      }
      locationSelect.addEventListener('change',()=>void load());viewSelect.addEventListener('change',()=>void load());
      body.querySelector('#parity-stock-move').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const type=String(data.get('type'));const quantity=Number(data.get('quantity'));const movement={productId:data.get('productId'),locationId:locationSelect.value,type,reason:data.get('reason')};if(type==='inventory-count')movement.countedQuantity=quantity;else movement.quantityDelta=type==='adjustment-out'?-Math.abs(quantity):Math.abs(quantity);try{await api.saveInventoryMovement(movement);toast('Movimentação registrada no local.');event.currentTarget.reset();await load();}catch(error){toast(error.message,true);}});
      try{await load();}catch(error){body.querySelector('#parity-stock-table').innerHTML=`<div class="ops-error">${esc(error.message)}</div><button type="button" class="ops-secondary" data-stock-local-retry>Tentar novamente</button>`;body.querySelector('[data-stock-local-retry]')?.addEventListener('click',()=>void load());}
    }catch(error){card.querySelector('[data-local-stock-body]').innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}
  }

  async function mountLogistics(page=currentPage()){
    if(!page||page.querySelector('#backend-terminal-stock'))return;
    const card=document.createElement('section');card.id='backend-terminal-stock';card.className='ops-card';card.innerHTML='<h2>Estoque por terminal</h2><p class="ops-muted">Defina de qual loja/depósito cada caixa baixa estoque. Vendas já abertas preservam o local original.</p><div data-terminal-stock-body><div class="ops-loader"></div></div>';page.appendChild(card);
    async function load(){try{const [locations,bindings]=await Promise.all([api.stockLocations(),api.terminalStockLocations()]);const body=card.querySelector('[data-terminal-stock-body]');body.innerHTML=`<form id="terminal-stock-form" class="ops-form-grid" novalidate><label class="field"><span>Terminal</span><select name="terminalId">${bindings.map(row=>`<option value="${esc(row.terminalId)}">${esc(row.name||row.terminalId)} (${esc(row.terminalId)})</option>`).join('')}</select></label><label class="field"><span>Local de estoque</span><select name="locationId">${locations.map(row=>`<option value="${esc(row.id)}">${esc(row.name)} (${esc(row.id)})</option>`).join('')}</select></label><button class="ops-primary">Vincular terminal</button></form><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Terminal</th><th>Local</th><th>Origem</th></tr></thead><tbody>${bindings.map(row=>`<tr><td>${esc(row.name||row.terminalId)}</td><td>${esc(row.locationName||row.locationId)} (${esc(row.locationId)})</td><td>${row.fallback?'Padrão MAIN':'Vínculo explícito'}</td></tr>`).join('')||'<tr><td colspan="3">Nenhum terminal cadastrado.</td></tr>'}</tbody></table></div>`;body.querySelector('#terminal-stock-form')?.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{await api.bindTerminalStockLocation(data.get('terminalId'),data.get('locationId'));toast('Local do terminal atualizado.');await load();}catch(error){toast(error.message,true);}});}catch(error){card.querySelector('[data-terminal-stock-body]').innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}}
    await load();
  }

  async function mountReturns(page=currentPage()){
    if(!page||page.querySelector('#backend-return-cancel'))return;
    const card=document.createElement('section');card.id='backend-return-cancel';card.className='ops-card';card.innerHTML='<h2>Gerenciar devoluções</h2><p class="ops-muted">Cancelamento exige motivo e reverte os efeitos da devolução no estoque/caixa.</p><div data-return-manage></div>';page.appendChild(card);
    async function load(){try{const rows=await api.returns();card.querySelector('[data-return-manage]').innerHTML=`<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>ID</th><th>Venda</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.id)}</td><td>${esc(row.saleId)}</td><td>${money(row.totalCents)}</td><td>${esc(statusLabel(row.status))}</td><td>${row.status==='COMPLETED'?`<button class="ops-link danger" data-cancel-return="${esc(row.id)}">Cancelar devolução</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5">Nenhuma devolução registrada.</td></tr>'}</tbody></table></div>`;card.querySelectorAll('[data-cancel-return]').forEach(button=>button.addEventListener('click',async()=>{if(!ux?.openFormDialog){toast('Diálogo de cancelamento indisponível.',true);return;}const result=await ux.openFormDialog({title:'Cancelar devolução',description:'O cancelamento reverte os efeitos desta devolução no estoque e no caixa.',confirmLabel:'Cancelar devolução',tone:'danger',initialFocus:'cancel',body:'<label>Motivo<textarea name="reason" class="ops-input" rows="3"></textarea></label>',validate:data=>String(data.reason||'').trim()?null:{message:'Informe o motivo do cancelamento.',field:'reason'},onConfirm:data=>api.cancelReturn(button.dataset.cancelReturn,String(data.reason||'').trim())});if(result.confirmed){toast('Devolução cancelada.');await load();}}));}catch(error){card.querySelector('[data-return-manage]').innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}}
    await load();
  }

  async function mountFinance(page=currentPage()){
    if(!page||page.querySelector('#backend-finance-parity'))return;
    const card=document.createElement('section');card.id='backend-finance-parity';card.className='ops-card';card.innerHTML='<div class="ops-grid two"><section><h2>Contas financeiras</h2><form id="parity-account-form" class="ops-form-grid" novalidate>'+field('name','Nome','text','required')+'<label class="field"><span>Tipo</span><select name="type"><option value="CASH">Dinheiro</option><option value="BANK">Banco</option><option value="CARD">Cartão</option><option value="OTHER">Outro</option></select></label><button class="ops-primary">Criar conta</button></form><div data-account-list></div></section><section><h2>Estornar baixas</h2><p class="ops-muted">Baixas financeiras podem ser estornadas sem apagar o histórico.</p><div data-settlement-list></div></section></div>';page.appendChild(card);
    async function load(){try{const [accounts,entries]=await Promise.all([api.financeAccounts(true),api.financeEntries()]);card.querySelector('[data-account-list]').innerHTML=accounts.map(row=>`<div class="ops-row"><span>${esc(row.name)}</span><small>${esc(accountTypeLabel(row.type))} · ${row.active?'ATIVA':'INATIVA'}</small></div>`).join('')||'<p class="ops-muted">Nenhuma conta.</p>';const settlements=entries.flatMap(entry=>(entry.settlements||[]).filter(s=>!s.reversedAt).map(s=>({...s,entryDescription:entry.description})));card.querySelector('[data-settlement-list]').innerHTML=settlements.map(row=>`<div class="ops-row"><div><strong>${esc(row.entryDescription)}</strong><small>${money(row.amountCents)} · ${esc(row.method?paymentLabel(row.method):'Manual')}</small></div><button class="ops-link danger" data-reverse-settlement="${esc(row.id)}">Estornar</button></div>`).join('')||'<p class="ops-muted">Nenhuma baixa ativa.</p>';card.querySelectorAll('[data-reverse-settlement]').forEach(button=>button.addEventListener('click',async()=>{if(!ux?.openFormDialog){toast('Diálogo financeiro indisponível.',true);return;}const result=await ux.openFormDialog({title:'Estornar baixa',description:'A baixa continuará no histórico marcada como estornada.',confirmLabel:'Estornar baixa',tone:'danger',initialFocus:'cancel',body:'<label>Motivo<textarea name="reason" class="ops-input" rows="3"></textarea></label>',validate:data=>String(data.reason||'').trim()?null:{message:'Informe o motivo do estorno.',field:'reason'},onConfirm:data=>api.reverseFinanceSettlement(button.dataset.reverseSettlement,String(data.reason||'').trim())});if(result.confirmed){toast('Baixa estornada.');await load();}}));}catch(error){toast(error.message,true);}}
    card.querySelector('#parity-account-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{await api.createFinanceAccount({name:data.get('name'),type:data.get('type')});toast('Conta financeira criada.');event.currentTarget.reset();await load();}catch(error){toast(error.message,true);}});await load();
  }

  async function mountRoute(route,page=currentPage()){
    if(route==='inventory')return mountInventory(page);
    if(route==='returns')return mountReturns(page);
    if(route==='finance')return mountFinance(page);
  }
  window.PdvOperationalRouteExtensions=Object.freeze({mountRoute,mountInventory,mountLogistics,mountReturns,mountFinance});
})();
