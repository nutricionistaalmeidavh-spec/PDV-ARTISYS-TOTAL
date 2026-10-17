'use strict';

(() => {
  const root=window;
  const ApiClient=root.PdvApiClient?.ApiClient;
  const routeRegistry=root.PdvRouteRegistry;
  if(!ApiClient||!routeRegistry)return;
  const api=new ApiClient();
  const lifecycle=root.PdvUiLifecycle;
  const MODULE_REQUEST_TIMEOUT_MS=5000;
  const ROUTE_RENDERERS={
    FOOD:renderFoodWorkspace,
    WHOLESALE:()=>root.PdvWholesaleUi?.show?.()
  };
  let modules=[];
  const loadingSettingsCards=new WeakSet();

  function escapeHtml(value){return String(value??'').replace(/[&<>'\"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','\"':'&quot;'}[char]));}
  function statusLabel(value){return root.PdvUiModel?.statusLabel?.(value,String(value||''))||String(value||'');}
  function roleLabel(value){return root.PdvUiModel?.roleLabel?.(value,String(value||'Equipe'))||String(value||'Equipe');}
  function notify(message,error=false){if(root.PdvToast?.show){root.PdvToast.show(message,error?'error':'success');return;}const toastRoot=document.getElementById('toast-root');if(!toastRoot)return;const node=document.createElement('div');node.className=`toast ${error?'error':'success'}`;node.textContent=message;toastRoot.appendChild(node);setTimeout(()=>node.remove(),3200);}
  async function withTimeout(promise,timeoutMs=MODULE_REQUEST_TIMEOUT_MS,message='A operação de módulos demorou demais. Tente novamente.'){
    let timer=null;
    try{
      return await Promise.race([
        Promise.resolve(promise),
        new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(message)),timeoutMs);})
      ]);
    }finally{if(timer)clearTimeout(timer);}
  }
  async function loadModules(){const catalog=await withTimeout(api.modules(),MODULE_REQUEST_TIMEOUT_MS,'Não foi possível carregar os módulos dentro do tempo esperado.');root.PdvModuleGate?.reconcile?.(catalog);mergeModuleCatalog(catalog);return modules;}

  function moduleAllowed(module){return Boolean(module&&typeof ROUTE_RENDERERS[module.routeId]==='function'&&root.PdvAccessPolicy?.canAccessRoute(root.PdvCurrentAccess,module.routeId,{moduleState:{[module.routeId]:Boolean(module.enabled)}}));}
  const labelFor=module=>module?.name||module?.id||'';
  const moduleForRoute=routeId=>modules.find(module=>module.routeId===routeId)||null;
  function mergeModuleCatalog(catalog){if(!Array.isArray(catalog))return false;modules=catalog.map(module=>({...module}));return true;}
  function settingsPage(root=document.getElementById('route-content')){
    if(root?.matches?.('.ops-page'))return root;
    return root?.querySelector?.('.ops-page')||null;
  }

  function settingsModulesCard(){return document.getElementById('ops-establishment-modules-card');}

  function renderSettingsModules(card=settingsModulesCard()){
    if(!card||!card.isConnected)return;
    const body=card.querySelector('[data-establishment-modules-body]');
    if(!body)return;
    const impactCopy={
      FOOD:'Adiciona Alimentação ao menu com pedidos, Produção/KDS e canais de atendimento. Cardápio, estoque e caixa continuam compartilhados.',
      WHOLESALE:'Adiciona Atacado ao menu para políticas B2B e pedidos. O Balcão continua sendo o caixa e também aplica preço por quantidade em vendas avulsas.'
    };
    const coreItems=[
      ['Balcão e Caixa','Venda, pagamento e faturamento de comandas e pedidos.'],
      ['Cardápio e Estoque','Produtos, variantes, peso, ficha técnica, insumos e movimentações.'],
      ['Clientes','Cadastro, histórico e limite de crédito.'],
      ['Financeiro e Relatórios','Contas, DRE, indicadores e histórico operacional.']
    ];
    const moduleCard=module=>{
      const canManage=Boolean(module.manageCapability&&root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,module.manageCapability));
      const status=module.enabled?'Ativa':'Desativada';
      const included=module.id==='FOOD'?'<div class="module-included" aria-label="Recursos incluídos com Alimentação"><strong>Incluído ao ativar</strong><span>✓ Pedidos</span><span>✓ Produção / KDS</span><span>✓ Mesas, balcão, retirada e entrega como canais</span></div>':'';
      const openAction=module.enabled&&moduleAllowed(module)?`<div class="vertical-actions"><button type="button" class="secondary-button" data-open-module-route="${escapeHtml(module.routeId)}">Abrir área</button></div>`:'';
      return `<article class="module-family" data-module-config="${escapeHtml(module.id)}"><div class="module-family-head"><div><h4>${escapeHtml(labelFor(module))}</h4><p>${escapeHtml(module.description||'')}</p></div><span class="ops-badge" data-module-status="${escapeHtml(module.id)}">${status}</span></div><p class="vertical-rule">${escapeHtml(impactCopy[module.id]||'Esta área aparece na navegação quando está ativa.')}</p><label class="vertical-toggle"><span><strong>${module.enabled?'Área ativa':'Ativar área'}</strong><small>${canManage?'A alteração vale para este estabelecimento.':'Seu perfil não permite alterar esta área.'}</small></span><input type="checkbox" role="switch" aria-label="Ativar ${escapeHtml(labelFor(module))}" aria-checked="${module.enabled?'true':'false'}" data-module-toggle="${escapeHtml(module.id)}" ${module.enabled?'checked':''} ${canManage?'':'disabled'}></label>${included}${openAction}</article>`;
    };
    body.innerHTML=`<div class="module-config-summary admin-surface" data-admin-surface="modules"><section class="vertical-settings"><div class="module-section-intro admin-section-head"><h3>Áreas opcionais</h3><p>Ative somente os fluxos que realmente mudam a operação. O menu lateral se atualiza imediatamente.</p></div>${modules.map(moduleCard).join('')||'<p class="vertical-empty">Nenhuma área configurável disponível.</p>'}</section><details class="module-family core-area-summary" data-core-area="true"><summary><span><strong>Núcleo ArtiSys</strong><small>Balcão, Caixa, Cardápio, Estoque, Clientes e Gestão já estão sempre disponíveis.</small></span><span class="ops-badge">Sempre ativo</span></summary><div class="vertical-card-grid">${coreItems.map(([title,detail])=>`<div class="vertical-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(detail)}</span></div>`).join('')}</div></details></div>`;
    body.querySelectorAll('[data-module-toggle]').forEach(input=>input.addEventListener('change',async()=>{
      const id=input.dataset.moduleToggle;
      const target=input.checked;
      input.setAttribute('aria-checked',String(target));
      input.disabled=true;
      try{
        await withTimeout(api.saveSetting(`modules.${id}.enabled`,target,'global'),MODULE_REQUEST_TIMEOUT_MS,'A alteração da área demorou demais. Nada foi travado; tente novamente.');
        modules=modules.map(module=>module.id===id?{...module,enabled:target}:module);
        renderSettingsModules(card);
        const label=labelFor(modules.find(module=>module.id===id))||id;
        notify(target?`${label} ativada. Use "Abrir área" para continuar.`:`${label} desativada.`);
      }catch(error){
        input.checked=!target;
        input.setAttribute('aria-checked',String(!target));
        input.disabled=false;
        notify(error.message,true);
      }
    }));
    body.querySelectorAll('[data-open-module-route]').forEach(button=>button.addEventListener('click',()=>void root.PdvAppNavigation?.navigate?.(button.dataset.openModuleRoute)));
  }

  async function loadAndRenderSettingsModules(card=settingsModulesCard()){
    if(!card||loadingSettingsCards.has(card))return;
    const body=card.querySelector('[data-establishment-modules-body]');
    if(!body)return;
    loadingSettingsCards.add(card);
    body.innerHTML='<div class="ops-loader" role="status" aria-live="polite" aria-busy="true"></div><p class="ops-muted">Carregando áreas do estabelecimento…</p>';
    try{
      await loadModules();
      if(card.isConnected)renderSettingsModules(card);
    }catch(error){
      if(card.isConnected){
        body.innerHTML=`<div class="ops-error">${escapeHtml(error.message)}</div><div class="ops-actions"><button type="button" class="ops-secondary" data-modules-retry>Tentar novamente</button></div>`;
        body.querySelector('[data-modules-retry]')?.addEventListener('click',()=>{void loadAndRenderSettingsModules(card);});
      }
      notify(error.message,true);
    }finally{loadingSettingsCards.delete(card);}
  }

  function mountSettingsModules(pageRoot=settingsPage()){
    const page=settingsPage(pageRoot);
    if(!page||page.querySelector('#ops-establishment-modules-card'))return;
    const card=document.createElement('section');
    card.className='ops-card';
    card.id='ops-establishment-modules-card';
    card.dataset.settingsCategory='modules';
    card.innerHTML=`<div class="ops-card-head"><div><h2>Áreas do estabelecimento</h2><p class="ops-muted">O núcleo de venda, caixa, catálogo, estoque, clientes, financeiro e relatórios é único. Aqui você ativa somente fluxos adicionais.</p></div><span class="vertical-rule">Uma operação · um caixa · áreas opcionais</span></div><div data-establishment-modules-body><div class="ops-loader" role="status" aria-live="polite" aria-busy="true"></div><p class="ops-muted">Carregando áreas do estabelecimento…</p></div>`;
    const firstGrid=page.querySelector('.ops-grid');
    if(firstGrid)page.insertBefore(card,firstGrid);else page.appendChild(card);
    void loadAndRenderSettingsModules(card);
  }

  function backButton(){return `<button class="secondary-button" type="button" id="vertical-back">← ${document.body.dataset.activeModuleWorkspace==='FOOD'?'Alimentação':'Início'}</button>`;}
  function bindBack(){document.getElementById('vertical-back')?.addEventListener('click',()=>{if(document.body.dataset.activeModuleWorkspace==='FOOD'){renderFoodWorkspace();return;}void root.PdvAppNavigation?.navigate?.('home');});}
  function input(name,label,type='text',extra=''){return `<label class="field"><span>${label}</span><input name="${name}" type="${type}" ${extra}></label>`;}
  function normalizeNationalPhoneInput(value){
    let digits=String(value??'').replace(/\D/g,'');
    if(digits.length>11&&digits.startsWith('55'))digits=digits.slice(2);
    return digits;
  }
  function bindNationalPhoneInput(input){
    if(!input)return;
    const normalize=()=>{
      const normalized=normalizeNationalPhoneInput(input.value);
      if(input.value!==normalized)input.value=normalized;
      input.setCustomValidity(normalized&&!/^\d{10,11}$/.test(normalized)?'Telefone deve ter 10 ou 11 dígitos, com DDD e sem o 55.':'');
    };
    input.addEventListener('input',normalize);
    input.addEventListener('paste',event=>{
      const text=event.clipboardData?.getData('text');
      if(text==null)return;
      event.preventDefault();
      input.value=normalizeNationalPhoneInput(text);
      normalize();
    });
    normalize();
  }

  async function renderModuleRoute(id){
    if(!modules.length)await loadModules();
    const module=moduleForRoute(id);
    if(!moduleAllowed(module)){
      void root.PdvAppNavigation?.navigate?.('home');
      return;
    }
    document.body.dataset.activeModuleWorkspace=id;
    try{
      return await ROUTE_RENDERERS[id]();
    }catch(error){
      const content=document.getElementById('route-content');
      if(content)content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Não foi possível abrir esta área</h1><p>O restante do sistema continua disponível.</p></div><button class="secondary-button" type="button" id="vertical-back">← Início</button></header><div class="data-card ops-error" role="alert">${escapeHtml(error?.message||'Falha inesperada ao carregar a tela.')}</div><button class="secondary-button" type="button" id="module-retry">Tentar novamente</button></section>`;
      document.getElementById('vertical-back')?.addEventListener('click',()=>void root.PdvAppNavigation?.navigate?.('home'));
      document.getElementById('module-retry')?.addEventListener('click',()=>void root.PdvAppNavigation?.navigate?.(id));
      notify('A tela não abriu. O sistema continua disponível; tente novamente.',true);
    }
  }

  function renderFoodWorkspace(){
    const content=document.getElementById('route-content');if(!content)return;
    document.body.dataset.activeModuleWorkspace='FOOD';
    content.innerHTML=`<section class="page vertical-page food-workspace" data-module-area="FOOD"><header class="page-head food-page-head"><div><h1>Alimentação</h1></div><button class="secondary-button" type="button" id="food-home">← Início</button></header><section class="food-operation-hub" aria-labelledby="food-operation-title"><div class="food-operation-heading"><div><h2 id="food-operation-title">Operação</h2><p>Abra o fluxo que precisa usar agora.</p></div></div><div class="food-module-grid"><button type="button" class="data-card food-module-card" data-food-capability="RESTAURANT"><span>${root.PdvIcon?.('store',28)||''}</span><strong>Mesas e comandas</strong><small>Salão e comandas.</small><span class="secondary-button">Abrir</span></button><button type="button" class="data-card food-module-card" data-food-capability="DELIVERY"><span>${root.PdvIcon?.('document',28)||''}</span><strong>Pedidos</strong><small>Balcão, entrega e retirada.</small><span class="secondary-button">Abrir</span></button><button type="button" class="data-card food-module-card" data-food-capability="PIZZERIA"><span>${root.PdvIcon?.('document',28)||''}</span><strong>Personalização de pizza</strong><small>Tamanhos, sabores e bordas.</small><span class="secondary-button">Abrir</span></button></div></section></section>`;
    content.querySelector('#food-home')?.addEventListener('click',()=>void root.PdvAppNavigation?.navigate?.('home'));
    content.querySelectorAll('[data-food-capability]').forEach(button=>button.addEventListener('click',()=>void renderFoodCapability(button.dataset.foodCapability)));
  }

  async function renderFoodCapability(id){
    document.body.dataset.activeModuleWorkspace='FOOD';
    if(id==='RESTAURANT')return root.PdvRestaurantUi?.show?.();
    if(id==='FAST_FOOD')return renderDelivery();
    if(id==='DELIVERY')return renderDelivery();
    if(id==='PIZZERIA')return renderPizzeria();
  }

  async function renderPizzeria(){
    const content=document.getElementById('route-content');if(!content)return;
    let products=[];try{products=(await withTimeout(api.products(false))).filter(product=>product.active!==false&&product.menuEnabled!==false);}catch(error){notify(error.message,true);}
    const productOptions=products.map(product=>`<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join('');
    content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Personalização de pizza</h1><p>Configure e consulte tamanhos, sabores, bordas e política de preço sem informar códigos técnicos.</p></div>${backButton()}</header>
      <section class="data-card"><div class="section-head"><div><span class="eyebrow">CONFIGURAÇÃO</span><h2>Produto de pizza</h2></div></div><form id="pizza-profile-form" class="vertical-form"><label class="field"><span>Produto base</span><select name="productId" required><option value="">Selecione</option>${productOptions}</select></label><label class="field"><span>Política para vários sabores</span><select name="pricingPolicy"><option value="HIGHEST_FLAVOR">Usar o sabor de maior preço</option><option value="PROPORTIONAL_AVERAGE">Usar média proporcional dos sabores</option></select></label><button class="primary-button" type="submit">Salvar política</button></form></section>
      <section class="data-card"><div class="section-head"><div><span class="eyebrow">SIMULAÇÃO</span><h2>Prévia de preço</h2><p>Escolha as opções pelos nomes usados no cardápio.</p></div></div><form id="pizza-price-form" class="vertical-form"><label class="field"><span>Produto</span><select name="productId" required><option value="">Selecione</option>${productOptions}</select></label><div data-pizza-profile-options><p class="vertical-empty">Selecione um produto configurado para ver tamanhos, sabores e bordas.</p></div><button class="primary-button" type="submit" disabled data-pizza-price-submit>Calcular preço</button></form><output id="pizza-price-output" class="vertical-output" aria-live="polite"></output></section>
    </section>`;bindBack();
    const priceForm=content.querySelector('#pizza-price-form');const optionsHost=content.querySelector('[data-pizza-profile-options]');const priceButton=content.querySelector('[data-pizza-price-submit]');
    async function loadProfile(productId){
      if(!productId){optionsHost.innerHTML='<p class="vertical-empty">Selecione um produto configurado para ver tamanhos, sabores e bordas.</p>';priceButton.disabled=true;return;}
      try{
        const profile=await withTimeout(api.pizzeriaProfile(productId));
        if(!profile){optionsHost.innerHTML='<p class="vertical-empty">Este produto ainda não possui configuração de pizza.</p>';priceButton.disabled=true;return;}
        optionsHost.innerHTML=`<label class="field"><span>Tamanho</span><select name="sizeId" required><option value="">Selecione</option>${(profile.sizes||[]).map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}</select></label><fieldset class="data-card pizza-flavor-options"><legend>Sabores</legend>${(profile.flavors||[]).map(item=>`<label><input type="checkbox" name="flavorId" value="${escapeHtml(item.id)}"> ${escapeHtml(item.name)}</label>`).join('')||'<p class="vertical-empty">Nenhum sabor configurado.</p>'}</fieldset><label class="field"><span>Borda</span><select name="crustId"><option value="">Sem borda adicional</option>${(profile.crusts||[]).map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('')}</select></label>`;
        priceButton.disabled=!(profile.sizes||[]).length||!(profile.flavors||[]).length;
      }catch(error){optionsHost.innerHTML=`<p class="vertical-empty">${escapeHtml(error.message)}</p>`;priceButton.disabled=true;}
    }
    priceForm.elements.productId.addEventListener('change',()=>void loadProfile(priceForm.elements.productId.value));
    content.querySelector('#pizza-profile-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{await withTimeout(api.savePizzeriaProfile({productId:data.get('productId'),pricingPolicy:data.get('pricingPolicy')}));notify('Política da pizza salva.');if(priceForm.elements.productId.value===data.get('productId'))await loadProfile(data.get('productId'));}catch(error){notify(error.message,true);}});
    priceForm.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);const flavorIds=data.getAll('flavorId');if(!flavorIds.length){notify('Selecione ao menos um sabor.',true);return;}try{const result=await withTimeout(api.pricePizza({productId:data.get('productId'),sizeId:data.get('sizeId'),flavorIds,crustId:data.get('crustId')||null}));content.querySelector('#pizza-price-output').textContent=`Preço calculado: ${(Number(result.unitPriceCents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})}`;}catch(error){notify(error.message,true);}});
  }

  async function renderDelivery(){
    const content=document.getElementById('route-content');if(!content)return;
    const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    const phoneForWhatsapp=value=>{const digits=normalizeNationalPhoneInput(value);return /^\d{10,11}$/.test(digits)?digits:null;};
    let view='ALL';let orders=[];let legacyOrders=[];let pendingOrder=null;let refreshing=false;let products=[];let users=[];let config=null;let cart=[];let refreshTimer=null;
    try{const [foodData,nextProducts,nextUsers,nextConfig]=await Promise.all([withTimeout(api.foodOrders()),withTimeout(api.products(false)),withTimeout(api.users(true)),withTimeout(api.initialize())]);orders=Array.isArray(foodData?.orders)?foodData.orders:[];legacyOrders=Array.isArray(foodData?.legacyOrders)?foodData.legacyOrders:[];products=nextProducts;users=nextUsers;config=nextConfig;}catch(error){notify(error.message,true);}
    products=(Array.isArray(products)?products:[]).filter(product=>product.active!==false);
    users=(Array.isArray(users)?users:[]).filter(user=>user.active!==false);
    const productOptions=products.map(product=>`<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)} · ${money(product.salePriceCents)}</option>`).join('');
    const operatorOptions=users.map(user=>`<option value="${escapeHtml(user.id)}">${escapeHtml(user.name)} · ${escapeHtml(roleLabel(user.role))}</option>`).join('');
    content.innerHTML=`<section class="page vertical-page delivery-operations" data-delivery-operations><header class="page-head"><div><h1>Pedidos</h1><p>Balcão, Entrega e retirada: acompanhe os itens, a produção e a cobrança.</p></div>${backButton()}</header>
      <section class="delivery-channel-grid" aria-label="Canais de atendimento"><button type="button" class="data-card delivery-channel-card" data-delivery-view="COUNTER"><span>Balcão</span><strong data-delivery-summary="COUNTER">0 em andamento</strong><small>Itens, produção e cobrança.</small></button>
        <button type="button" class="data-card delivery-channel-card" data-delivery-view="DELIVERY"><span>Delivery</span><strong data-delivery-summary="DELIVERY">0 em andamento</strong><small>Produção, entregador e entrega.</small></button>
        <button type="button" class="data-card delivery-channel-card" data-delivery-view="PICKUP"><span>Retirada</span><strong data-delivery-summary="PICKUP">0 em andamento</strong><small>Produção, WhatsApp e retirada.</small></button>
      </section>
      <section class="data-card delivery-new-order"><div class="section-head"><div><span class="eyebrow">NOVO PEDIDO</span><h2>Registrar e enviar para produção</h2></div></div>
        <form id="delivery-form" class="vertical-form">
          ${input('customerName','Cliente','text','autocomplete="name"')}
          ${input('phone','Telefone','tel','inputmode="numeric" pattern="\\d{10,11}" autocomplete="tel-national"')}
          <label class="field"><span>Atendimento</span><select name="fulfillmentType"><option value="COUNTER">Balcão</option><option value="DELIVERY">Delivery</option><option value="PICKUP">Retirada</option></select></label>
          <label class="field delivery-ticket-toggle"><span>Identificação opcional</span><span><input type="checkbox" name="useTicket"> Gerar senha diária</span></label>${input('region','Bairro / região')}
          <fieldset class="delivery-address-fields" data-delivery-address><legend>Endereço de entrega</legend>
            ${input('street','Rua','text','autocomplete="address-line1"')}${input('number','Número')}${input('complement','Complemento')}${input('district','Bairro')}${input('city','Cidade')}${input('state','UF','text','maxlength="2"')}${input('reference','Referência')}
          </fieldset>
          ${input('fee','Taxa de entrega','text','inputmode="decimal" value="0"')}
          <label class="field"><span>Pagamento</span><select name="paymentMethod"><option value="PIX">PIX</option><option value="CASH">Dinheiro</option><option value="DEBIT_CARD">Débito</option><option value="CREDIT_CARD">Crédito</option><option value="OTHER">Outro</option></select></label>
          <label class="field"><span>Responsável</span><select name="operatorId" required>${operatorOptions}</select></label>
          <div class="delivery-item-picker"><label class="field"><span>Produto</span><select name="productId">${productOptions}</select></label>${input('quantity','Quantidade','number','min="0.001" step="0.001" value="1"')}<button type="button" class="secondary-button" data-delivery-add-item>Adicionar item</button></div>
          <div class="delivery-cart" data-delivery-cart></div>
          <button class="primary-button delivery-send-production" type="submit">Enviar para produção</button>
        </form>
      </section>
      <section class="data-card delivery-board-card"><div class="section-head"><div><span class="eyebrow">OPERAÇÃO</span><h2>Pedidos em andamento</h2></div><div class="vertical-actions"><button type="button" class="secondary-button active" data-delivery-view="ALL">Todos</button><button type="button" class="secondary-button" data-delivery-view="HISTORY">Histórico</button><button type="button" class="secondary-button" data-delivery-refresh>Atualizar</button></div></div><div class="delivery-board" data-delivery-board></div></section>
    </section>`;
    bindBack();
    const form=content.querySelector('#delivery-form');const phoneInput=form?.querySelector('[name="phone"]');bindNationalPhoneInput(phoneInput);
    const addressFields=content.querySelector('[data-delivery-address]');
    function updateAddressVisibility(){const delivery=form?.elements.fulfillmentType?.value==='DELIVERY';if(addressFields)addressFields.hidden=!delivery;for(const name of ['street','number','district','city','state'])if(form?.elements[name])form.elements[name].required=delivery;if(form?.elements.fee)form.elements.fee.closest('.field').hidden=!delivery;if(form?.elements.customerName)form.elements.customerName.required=form.elements.fulfillmentType.value!=='COUNTER';}
    form?.elements.fulfillmentType?.addEventListener('change',updateAddressVisibility);updateAddressVisibility();
    function renderCart(){
      const host=content.querySelector('[data-delivery-cart]');if(!host)return;
      host.innerHTML=cart.length?cart.map((item,index)=>{
        const details=root.PdvOrderComposer?.configurationSummary?.(item.configurationSnapshot)||'';
        return `<div class="delivery-cart-line"><div><strong>${escapeHtml(item.name)}</strong><small>${item.quantity} × ${money(item.unitPriceCents)}</small>${details?`<small>${escapeHtml(details)}</small>`:''}${item.note?`<small>Obs.: ${escapeHtml(item.note)}</small>`:''}</div><button type="button" class="secondary-button" data-delivery-remove-item="${index}">Remover</button></div>`;
      }).join(''):'<p class="vertical-empty">Adicione os itens do pedido.</p>';
      host.querySelectorAll('[data-delivery-remove-item]').forEach(button=>button.addEventListener('click',()=>{cart.splice(Number(button.dataset.deliveryRemoveItem),1);renderCart();}));
    }
    content.querySelector('[data-delivery-add-item]')?.addEventListener('click',async event=>{
      const button=event.currentTarget;
      const product=products.find(item=>item.id===form.elements.productId.value);
      const quantity=Number(form.elements.quantity.value||1);
      if(!product||!Number.isFinite(quantity)||quantity<=0){notify('Selecione um produto e informe uma quantidade válida.',true);return;}
      button.disabled=true;
      try{
        await root.PdvRestaurantOrderComposerUi.configure({
          api,modalRoot:document.getElementById('modal-root'),product,quantity,
          onAdd:item=>{cart.push(item);form.elements.quantity.value='1';renderCart();}
        });
      }catch(error){notify(error.message,true);}
      finally{button.disabled=false;}
    });
    renderCart();
    const terminalStatuses=new Set(['DELIVERED','PICKED_UP','CANCELLED']);
    const stationMarkup=order=>{const stations=order.production?.stations||[];if(!stations.length)return '<small class="delivery-production-direct">Sem etapa de produção pendente.</small>';return `<div class="delivery-production-stations">${stations.map(station=>`<span><strong>${escapeHtml(station.name)}</strong><em class="status ${escapeHtml(station.status)}">${escapeHtml(statusLabel(station.status))}</em></span>`).join('')}</div>`;};
    const itemMarkup=order=>(order.items||[]).map(item=>`<span>${Number(item.quantity)}× ${escapeHtml(item.productName)}</span>`).join('')||'Itens não informados';
    function orderActions(order){
      if(terminalStatuses.has(order.status))return '';
      const actions=[];
      if(order.status==='NEW'&&!order.saleId&&(order.items||[]).length)actions.push(`<button type="button" class="primary-button" data-delivery-send="${escapeHtml(order.id)}">Enviar para produção</button>`);
      if(order.status==='READY'&&order.fulfillmentType==='PICKUP'){
        const phone=phoneForWhatsapp(order.phone);actions.push(`<button type="button" class="secondary-button" data-delivery-whatsapp="${escapeHtml(order.id)}" ${phone?'':'disabled title="Cadastre um telefone com DDD para avisar o cliente."'}>Avisar no WhatsApp</button>`);actions.push(`<button type="button" class="primary-button" data-delivery-status="${escapeHtml(order.id)}:PICKED_UP">Marcar retirado</button>`);
      }
      if(order.status==='READY'&&order.fulfillmentType==='DELIVERY'){
        if(order.courier)actions.push(`<button type="button" class="primary-button" data-delivery-status="${escapeHtml(order.id)}:OUT_FOR_DELIVERY">Saiu para entrega</button>`);
        else actions.push(`<form class="delivery-inline-form" data-delivery-courier-form="${escapeHtml(order.id)}"><input name="courier" aria-label="Nome do entregador" placeholder="Nome do entregador" required><button class="secondary-button" type="submit">Definir entregador</button></form>`);
      }
      if(order.status==='OUT_FOR_DELIVERY')actions.push(`<button type="button" class="primary-button" data-delivery-status="${escapeHtml(order.id)}:DELIVERED">Marcar entregue</button>`);
      if(order.saleId)actions.push(`<button type="button" class="secondary-button" data-delivery-charge="${escapeHtml(order.saleId)}">Cobrar no Balcão</button>`);
      actions.push(`<details class="delivery-cancel"><summary>Cancelar</summary><form data-delivery-cancel-form="${escapeHtml(order.id)}"><input name="reason" aria-label="Motivo do cancelamento" placeholder="Motivo do cancelamento" required><button type="submit" class="danger-button">Confirmar cancelamento</button></form></details>`);
      return `<div class="delivery-order-actions">${actions.join('')}</div>`;
    }
    function orderCard(order){const kind=order.channel==='COUNTER'?'Balcão':order.fulfillmentType==='PICKUP'?'Retirada':'Delivery';return `<article class="delivery-order-card ${escapeHtml(order.status)}" data-delivery-order="${escapeHtml(order.id)}"><header><div><span class="eyebrow">${kind.toUpperCase()}</span><h3>${escapeHtml(order.customerName)}${order.ticketNumber?` · Senha ${order.ticketNumber}`:''}</h3><small>${escapeHtml(order.phone||'Sem telefone')} · ${new Date(order.createdAt).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</small></div><span class="status ${escapeHtml(order.status)}">${escapeHtml(order.status==='NEW'&&order.saleId?'Aguardando produção':statusLabel(order.status))}</span></header><div class="delivery-order-items">${itemMarkup(order)}</div>${stationMarkup(order)}${order.fulfillmentType==='DELIVERY'&&order.address?`<small class="delivery-address-summary">${escapeHtml([order.address.street,order.address.number,order.address.district,order.address.city].filter(Boolean).join(', '))}</small>`:''}${order.courier?`<small>Entregador: <strong>${escapeHtml(order.courier)}</strong></small>`:''}${orderActions(order)}</article>`;}
    function bindOrderActions(host){
      const byId=new Map(orders.map(order=>[String(order.id),order]));
      host.querySelectorAll('[data-delivery-send]').forEach(button=>button.addEventListener('click',async()=>{const order=byId.get(button.dataset.deliverySend);const operatorId=form?.elements.operatorId?.value;if(!order||!operatorId)return;button.disabled=true;try{await api.createDeliverySale(order.id,{terminalId:config?.terminalId,operatorId});notify('Pedido enviado para produção.');await refreshOrders();}catch(error){notify(error.message,true);button.disabled=false;}}));
      host.querySelectorAll('[data-delivery-status]').forEach(button=>button.addEventListener('click',async()=>{const [id,next]=button.dataset.deliveryStatus.split(':');button.disabled=true;try{await api.updateDeliveryStatus(id,next);notify(next==='PICKED_UP'?'Pedido marcado como retirado.':next==='DELIVERED'?'Pedido entregue.':'Pedido saiu para entrega.');await refreshOrders();}catch(error){notify(error.message,true);button.disabled=false;}}));
      host.querySelectorAll('[data-delivery-courier-form]').forEach(node=>node.addEventListener('submit',async event=>{event.preventDefault();const button=node.querySelector('button');button.disabled=true;try{await api.assignDeliveryCourier(node.dataset.deliveryCourierForm,new FormData(node).get('courier'));notify('Entregador atribuído.');await refreshOrders();}catch(error){notify(error.message,true);button.disabled=false;}}));
      host.querySelectorAll('[data-delivery-cancel-form]').forEach(node=>node.addEventListener('submit',async event=>{event.preventDefault();const button=node.querySelector('button');button.disabled=true;try{await api.cancelDelivery(node.dataset.deliveryCancelForm,new FormData(node).get('reason'));notify('Pedido cancelado.');await refreshOrders();}catch(error){notify(error.message,true);button.disabled=false;}}));
      host.querySelectorAll('[data-delivery-whatsapp]').forEach(button=>button.addEventListener('click',async()=>{const order=byId.get(button.dataset.deliveryWhatsapp);const phone=phoneForWhatsapp(order?.phone);const openWhatsapp=root.artisysDesktop?.external?.openWhatsapp;if(!order||!phone||typeof openWhatsapp!=='function'){notify('WhatsApp indisponível ou telefone inválido neste pedido.',true);return;}button.disabled=true;const label=button.textContent;button.textContent='Abrindo WhatsApp...';try{await openWhatsapp({phone,customerName:order.customerName});button.textContent='WhatsApp aberto';}catch(error){button.disabled=false;button.textContent=label;notify(error?.message||'Falha ao abrir WhatsApp.',true);}}));
      host.querySelectorAll('[data-delivery-charge]').forEach(button=>button.addEventListener('click',async()=>{button.disabled=true;try{await root.PdvAppNavigation?.openCheckoutSale?.(button.dataset.deliveryCharge);}catch(error){notify(error.message,true);button.disabled=false;}}));
    }
    function renderOrders(){
      for(const type of ['COUNTER','DELIVERY','PICKUP']){const count=orders.filter(order=>(order.channel||order.fulfillmentType)===type&&!terminalStatuses.has(order.status)).length;const node=content.querySelector(`[data-delivery-summary="${type}"]`);if(node)node.textContent=`${count} em andamento`;}
      content.querySelectorAll('[data-delivery-view]').forEach(button=>button.classList.toggle('active',button.dataset.deliveryView===view));
      const filtered=orders.filter(order=>view==='ALL'||view==='HISTORY'||(order.channel||order.fulfillmentType)===view).filter(order=>view==='HISTORY'?terminalStatuses.has(order.status):!terminalStatuses.has(order.status));
      const laneKey=order=>order.status==='NEW'&&order.saleId?'WAITING_PRODUCTION':order.status;
      const lanes=[['NEW','Novos pedidos'],['WAITING_PRODUCTION','Aguardando produção'],['PREPARING','Preparando'],['READY','Pedidos prontos']];if(view!=='PICKUP')lanes.push(['OUT_FOR_DELIVERY','Em entrega']);
      const board=content.querySelector('[data-delivery-board]');if(!board)return;
      if(view==='HISTORY'){board.innerHTML='<section class="delivery-lane"><h3>Pedidos concluídos e cancelados</h3>'+(filtered.map(orderCard).join('')||'<p class="vertical-empty">Nenhum pedido concluído.</p>')+'</section>';renderLegacy(board,true);return;}
      board.innerHTML=lanes.map(([key,label])=>`<section class="delivery-lane" data-delivery-lane="${key}"><header><span>${label}</span><strong>${filtered.filter(order=>laneKey(order)===key).length}</strong></header><div>${filtered.filter(order=>laneKey(order)===key).map(orderCard).join('')||'<p class="vertical-empty">Nenhum pedido.</p>'}</div></section>`).join('');bindOrderActions(board);renderLegacy(board,false);
    }
    function renderLegacy(board,history){const old=legacyOrders.filter(order=>history?terminalStatuses.has(order.status):!terminalStatuses.has(order.status));if(!old.length)return;const host=document.createElement('section');host.className='data-card';host.innerHTML='<h3>'+ (history?'Histórico de senhas anteriores':'Senhas anteriores ainda em andamento')+'</h3><p>Registros preservados da instalação anterior. Novos pedidos usam os itens e a produção acima.</p>'+old.map(order=>`<div class="vertical-row"><strong>Senha ${Number(order.dailyNumber)}</strong><span>${escapeHtml(new Date(order.createdAt).toLocaleString('pt-BR'))} · ${escapeHtml(statusLabel(order.status))}</span>${history?'':`<button type="button" class="secondary-button" data-legacy-complete="${escapeHtml(order.id)}">${order.status==='NEW'?'Preparar':order.status==='PREPARING'?'Marcar pronto':'Marcar entregue'}</button>`}</div>`).join('');board.appendChild(host);host.querySelectorAll('[data-legacy-complete]').forEach(button=>button.addEventListener('click',async()=>{const order=legacyOrders.find(item=>item.id===button.dataset.legacyComplete);button.disabled=true;try{await api.updateLegacyFoodOrderStatus(order.id,{NEW:'PREPARING',PREPARING:'READY',READY:'DELIVERED'}[order.status]);await refreshOrders();}catch(error){notify(error.message,true);button.disabled=false;}}));}
    async function refreshOrders(){if(refreshing)return;refreshing=true;try{const result=await withTimeout(api.foodOrders());orders=Array.isArray(result?.orders)?result.orders:[];legacyOrders=Array.isArray(result?.legacyOrders)?result.legacyOrders:[];if(content.querySelector('[data-delivery-operations]'))renderOrders();}catch(error){notify('Não foi possível atualizar os pedidos. '+error.message,true);}finally{refreshing=false;}}
    content.querySelectorAll('[data-delivery-view]').forEach(button=>button.addEventListener('click',()=>{view=button.dataset.deliveryView;renderOrders();}));content.querySelector('[data-delivery-refresh]')?.addEventListener('click',()=>void refreshOrders());
    form?.addEventListener('submit',async event=>{event.preventDefault();if(!cart.length){notify('Adicione pelo menos um item antes de enviar para produção.',true);return;}const button=form.querySelector('[type="submit"]');button.disabled=true;button.textContent='Enviando...';if(pendingOrder)for(const control of form.elements)if(control!==button)control.disabled=false;const data=new FormData(form);const fulfillmentType=String(data.get('fulfillmentType'));const phone=normalizeNationalPhoneInput(data.get('phone'));if(phone&&!/^\d{10,11}$/.test(phone)){notify('Telefone deve ter 10 ou 11 dígitos, com DDD e sem o 55.',true);button.disabled=false;button.textContent='Enviar para produção';return;}const fee=fulfillmentType==='DELIVERY'?Math.round(Number(String(data.get('fee')||'0').replace(',','.'))*100)||0:0;const address=fulfillmentType==='DELIVERY'?{street:String(data.get('street')||'').trim(),number:String(data.get('number')||'').trim(),complement:String(data.get('complement')||'').trim(),district:String(data.get('district')||'').trim(),city:String(data.get('city')||'').trim(),state:String(data.get('state')||'').trim().toUpperCase(),reference:String(data.get('reference')||'').trim()}:null;try{const order=pendingOrder||await api.createDelivery({customerName:data.get('customerName'),phone,channel:fulfillmentType,fulfillmentType:fulfillmentType==='COUNTER'?'PICKUP':fulfillmentType,useTicket:data.get('useTicket')==='on',region:data.get('region'),feeCents:fee,paymentMethod:data.get('paymentMethod'),address,items:cart.map(item=>({productId:item.productId,quantity:item.quantity,variantId:item.configuration?.variantId||null,selections:item.configuration?.selections||[],comboSelections:item.configuration?.comboSelections||[],note:item.note||''}))});pendingOrder=order;for(const control of form.elements)if(control!==button)control.disabled=true;await api.createDeliverySale(order.id,{terminalId:config?.terminalId,operatorId:String(data.get('operatorId')||'')});notify('Pedido enviado para produção.');pendingOrder=null;for(const control of form.elements)control.disabled=false;cart=[];renderCart();form.reset();updateAddressVisibility();await refreshOrders();}catch(error){notify(pendingOrder?'Pedido salvo. O envio à produção falhou; tente novamente para enviar este mesmo pedido. '+error.message:error.message,true);}finally{button.disabled=false;button.textContent=pendingOrder?'Tentar envio novamente':'Enviar para produção';}});
    renderOrders();
    lifecycle?.emit('surface:mounted',{surface:'delivery-pickup-operations',moduleId:'FOOD',routeId:'DELIVERY'});
    refreshTimer=setInterval(()=>{if(!content.querySelector('[data-delivery-operations]')){clearInterval(refreshTimer);return;}if(document.visibilityState==='visible')void refreshOrders();},5000);
  }

  function renderRestaurantAdvanced(){
    const content=document.getElementById('route-content');content.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Restaurante avançado</h1><p>Divisão de conta e transferência seletiva usam as mesmas vendas canônicas do balcão.</p></div>${backButton()}</header><div class="data-card"><h2>Consultar saldo de comanda</h2><form id="restaurant-balance-form" class="vertical-form">${input('sessionId','Mesa ou comanda')}<button class="primary-button" type="submit">Consultar</button></form><pre id="restaurant-output" class="vertical-output"></pre></div></section>`;bindBack();document.getElementById('restaurant-balance-form').addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(event.currentTarget);try{const result=await withTimeout(api.restaurantRemaining(data.get('sessionId')));document.getElementById('restaurant-output').textContent=`Saldo: R$ ${(result.totalCents/100).toFixed(2).replace('.',',')} · ${result.items.length} item(ns)`;}catch(error){notify(error.message,true);}});
  }

  root.addEventListener('artisys:modules-state-changed',event=>{
    if(!mergeModuleCatalog(event.detail?.catalog))return;
    const card=settingsModulesCard();
    if(card?.querySelector('[data-module-toggle]'))renderSettingsModules(card);
  });

  routeRegistry.register('FOOD',{owner:'vertical-modules',render:()=>renderModuleRoute('FOOD')});
  routeRegistry.register('WHOLESALE',{owner:'vertical-modules',render:()=>renderModuleRoute('WHOLESALE')});

  root.PdvVerticalModules=Object.freeze({mountSettingsModules,renderSettingsModules});
})();
