'use strict';

(() => {
  const ui = window.PdvUiModel;
  const homeRoleModel = window.PdvHomeRoleModel;
  const { ApiClient } = window.PdvApiClient;
  const api = new ApiClient();
  const routeRegistry = window.PdvRouteRegistry;
  const WEB_ROUTES=new Set(['home','checkout','products','sales','cash','finance','finance-banks','finance-recurrences','management','reports','customers','suppliers','sellers','FOOD','WHOLESALE','credit','commissions']);
  if (!routeRegistry) throw new Error('PdvRouteRegistry must load before app.js.');

  const ROUTES = {
    home: { label: 'Início', shortLabel:'Início', icon: 'home' },
    checkout: { label: 'Balcão', shortLabel:'Balcão', icon: 'cart' },
    FOOD: { label: 'Alimentação', shortLabel:'Alimentação', icon: 'store' },
    WHOLESALE: { label: 'Atacado', shortLabel:'Atacado', icon: 'document' },
    products: { label: 'Produtos', icon: 'document' },
    customers: { label: 'Clientes', icon: 'users' },
    suppliers: { label: 'Fornecedores', icon: 'document' },
    credit: { label: 'Crediário', icon: 'cash' },
    commissions: { label: 'Comissões', icon: 'chart' },
    inventory: { label: 'Estoque', icon: 'cubes', phase: 'E13' },
    finance: { label: 'Financeiro', icon: 'chart', phase: 'E16' },
    'finance-banks': { label: 'Bancos e conciliação', icon: 'chart', phase: 'E16' },
    'finance-recurrences': { label: 'Recorrências', icon: 'history', phase: 'E16' },
    'finance-alerts': { label: 'Alertas financeiros', icon: 'management', phase: 'E16' },
    reports: { label: 'Relatórios', icon: 'document', phase: 'E17' },
    sellers: { label: 'Equipe comercial', icon: 'users' },
    management: { label: 'Gestão', icon: 'management' },
    cash: { label: 'Caixa', shortLabel:'Caixa', icon: 'cash', phase: 'E14' },
    sales: { label: 'Últimas vendas', icon: 'history', phase: 'E15' },
    returns: { label: 'Devolução', icon: 'return', phase: 'E15' },
    settings: { label: 'Configurações', icon: 'settings', phase: 'E23' }
    ,access: { label: 'Acessos e equipe', shortLabel:'Acessos', icon: 'users' }
    ,catalog: { label: 'Cadastros', shortLabel:'Cadastros', icon: 'document' }
    ,'post-sale': { label: 'Vendas e devoluções', shortLabel:'Vendas', icon: 'history' }
    ,'financial-management': { label: 'Gestão financeira', shortLabel:'Gestão', icon: 'management' }
  };

  const state = {
    route: 'home',
    config: null,
    user: null,
    online: false,
    products: [],
    categories: [],
    customers: [],
    users: [],
    sellers: [],
    sale: null,
    checkoutDocumentContext: null,
    cashSession: null,
    suspendedSales: [],
    selectedProductId: null,
    productQuery: '',
    categoryId: '',
    customerQuery: '',
    discountPercent: 0,
    paymentDraft: [],
    selectedSellerId: '',
    pendingNewSaleKey:null,
    photoSyncStatus: null,
    productionRoutes: []
  };

  const content = document.getElementById('route-content');
  const modalRoot = document.getElementById('modal-root');
  const authOverlay = document.getElementById('auth-overlay');

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function icon(name, size = 22) {
    if (name === 'pizza') return `<img class="pdv-icon-pizza" src="./icons/pizza.svg" width="${size}" height="${size}" alt="" aria-hidden="true">`;
    const paths = {
      home: '<path d="M3 11 12 3l9 8v9a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z"/>',
      cart: '<path d="M3 4h2l2 11h10l3-8H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
      box: '<path d="m4 7 8-4 8 4-8 4z"/><path d="m4 7v10l8 4 8-4V7M12 11v10"/>',
      users: '<path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><path d="M17 11a4 4 0 0 0 0-8M23 21v-2a4 4 0 0 0-3-3.9"/>',
      user: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
      cubes: '<path d="m12 2 5 3-5 3-5-3zM7 10l5 3-5 3-5-3zM17 10l5 3-5 3-5-3z"/><path d="M12 8v5M7 16v5M17 16v5"/>',
      chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20V7"/>',
      management: '<path d="M4 20V9l8-5 8 5v11"/><path d="M8 20v-6h8v6M3 20h18M8 9h.01M12 9h.01M16 9h.01"/>',
      document: '<path d="M6 2h8l4 4v16H6z"/><path d="M14 2v5h5M9 13h6M9 17h6"/>',
      cash: '<path d="M5 8h14v11H5zM8 8V5h8v3M8 12h8M9 16h6"/>',
      history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v6l4 2"/>',
      return: '<path d="M9 7 4 12l5 5"/><path d="M4 12h10a6 6 0 0 1 6 6"/>',
      settings: '<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.5-2.5 1a7 7 0 0 0-1.7-1L14.4 3h-4.8L9.3 6a7 7 0 0 0-1.7 1L5 6 3 9.5 5.1 11a7 7 0 0 0 0 2L3 14.5 5 18l2.6-1a7 7 0 0 0 1.7 1l.3 3h4.8l.3-3a7 7 0 0 0 1.7-1l2.6 1 2-3.5-2.1-1.5a7 7 0 0 0 .1-1z"/>',
      store: '<path d="M4 10v11h16V10M3 10l2-6h14l2 6M8 21v-6h8v6"/>',
      terminal: '<rect x="3" y="4" width="18" height="13" rx="1"/><path d="M8 21h8M12 17v4"/>'
    };
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.document}</svg>`;
  }
  window.PdvIcon=icon;

  function hydrateStaticIcons() {
    document.querySelectorAll('[data-icon]').forEach((node) => { node.innerHTML = icon(node.dataset.icon); });
  }

  function centsFromInput(value) {
    const normalized = String(value ?? '').trim().replace(/\./g, '').replace(',', '.');
    const number = Number(normalized);
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
  }

  function quantityLabel(value) {
    return Number(value || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
  }

  function countLabel(value, singular, plural = `${singular}s`) {
    const count=Number(value||0);
    return `${quantityLabel(count)} ${count===1?singular:plural}`;
  }

  function initials(name) {
    return String(name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
  }

  function showToast(message, type = '') {
    window.PdvToast?.show?.(message,type);
  }

  function setOnline(ok) {
    state.online = Boolean(ok);
    const status = document.getElementById('network-status');
    const footer = document.getElementById('footer-status');
    status?.classList.toggle('offline', !state.online);
    footer?.classList.toggle('offline', !state.online);
    if (status) {
      const mode=state.config?.dataServer?.mode;
      const connectedLabel=mode==='cloud'?'Cloudflare · online':mode==='local'?'Neste computador':mode==='lan-host'?'PC principal':'Servidor conectado';
      status.querySelector('span').textContent = state.online ? connectedLabel : 'Servidor indisponível';
    }
  }

  function modalFocusableElements() {
    return [...modalRoot.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])')]
      .filter(node=>!node.hidden&&node.getAttribute('aria-hidden')!=='true'&&node.getClientRects().length);
  }

  function modalKeyboardHandler(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable=modalFocusableElements();
    if (!focusable.length) {
      event.preventDefault();
      modalRoot.querySelector('.modal-card')?.focus();
      return;
    }
    const first=focusable[0],last=focusable[focusable.length-1];
    if (event.shiftKey&&document.activeElement===first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey&&document.activeElement===last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openModal(title, bodyHtml, { wide = false, onMount } = {}) {
    modalRoot._returnFocus = document.activeElement;
    modalRoot.classList.remove('hidden');
    modalRoot.innerHTML = `<section class="modal-card ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="pdv-modal-title" tabindex="-1"><header class="modal-head"><h2 id="pdv-modal-title">${escapeHtml(title)}</h2><button class="modal-close" type="button" data-close-modal aria-label="Fechar">×</button></header><div class="modal-body">${bodyHtml}</div></section>`;
    modalRoot.querySelectorAll('[data-close-modal]').forEach((button) => button.addEventListener('click', closeModal));
    modalRoot.onclick = modalBackdropClose;
    modalRoot.onkeydown = modalKeyboardHandler;
    if (onMount) onMount(modalRoot);
    window.PdvUiLifecycle?.emit('modal:mounted', { title, root:modalRoot });
    queueMicrotask(() => {
      const target = modalRoot.querySelector('input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])');
      target?.focus({ preventScroll:true });
    });
  }
  function modalBackdropClose(event) { if (event.target === modalRoot) closeModal(); }
  function closeModal() {
    const returnFocus = modalRoot._returnFocus;
    modalRoot.classList.add('hidden');
    modalRoot.innerHTML = '';
    modalRoot.onclick = null;
    modalRoot.onkeydown = null;
    modalRoot._returnFocus = null;
    window.PdvUiLifecycle?.emit('modal:closed', {});
    returnFocus?.focus?.({ preventScroll:true });
  }
  window.PdvModal = Object.freeze({ open: openModal, close: closeModal });
  function formValue(form, name) { return form.elements.namedItem(name)?.value ?? ''; }
  function isRouteActive(route) { return document.body.dataset.activeRoute === route; }

  function moduleAccessOptions() {
    return { moduleState:window.PdvModuleGate?.snapshot?.() || {} };
  }

  function canAccessRoute(route) {
    if(api.webMode){
      if(!WEB_ROUTES.has(route))return false;
      const permission={suppliers:'suppliers.view',credit:'customers.view',commissions:'finance.view',FOOD:'restaurant.access',WHOLESALE:'wholesale.access'}[route];
      if(permission)return Boolean(window.PdvAccessPolicy?.hasCapability(state.user,permission));
    }
    return Boolean(window.PdvAccessPolicy?.canAccessRoute(state.user, route, moduleAccessOptions()));
  }

  function renderSidebar() {
    const nav = document.getElementById('sidebar-nav');
    const accessPolicy = window.PdvAccessPolicy;
    const items = api.webMode ? ['home','checkout','customers','suppliers','sellers','FOOD','WHOLESALE','credit','commissions','products','sales','cash','finance','finance-banks','finance-recurrences','management','reports'].filter(route=>canAccessRoute(route))
      : (accessPolicy?.routesForUser(state.user, moduleAccessOptions()) || ['home']).filter(route=>route!=='settings');
    const parentRoute = {
      finance:'financial-management',
      'finance-banks':'financial-management',
      'finance-recurrences':'financial-management',
      'finance-alerts':'financial-management',
      management:'financial-management',
      reports:'financial-management',
      sales:'post-sale',
      returns:'post-sale',
      products:'catalog',
      customers:'catalog',
      inventory:'catalog',
      sellers:'catalog'
    }[state.route] || state.route;
    nav.innerHTML = items.map((route) => `<button class="nav-button ${parentRoute === route ? 'active' : ''}" type="button" data-route="${route}" title="${ROUTES[route].label}" aria-label="${ROUTES[route].label}"><span class="nav-button-icon">${icon(ROUTES[route].icon, 25)}</span><span class="nav-label">${escapeHtml(ROUTES[route].shortLabel || ROUTES[route].label)}</span></button>`).join('');
    const settingsButton = document.querySelector('#app-sidebar [data-route="settings"]');
    if (settingsButton) settingsButton.hidden = !canAccessRoute('settings');
    document.querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', () => navigate(button.dataset.route)));
    window.dispatchEvent(new CustomEvent('artisys:sidebar-rendered'));
  }

  function updateTopbar() {
    if (!state.config) return;
    document.getElementById('store-name').textContent = state.config.storeName;
    document.getElementById('terminal-name').textContent = state.config.terminalName;
    document.getElementById('app-version').textContent = `Versão ${state.config.version}`;
    document.getElementById('operator-name').textContent = state.user?.name || 'Sem operador';
    document.getElementById('operator-role').textContent = state.user?.profile?.name || 'Equipe';
    window.PdvCurrentAccess=state.user||null;
    window.PdvUiLifecycle?.emit('user:changed', { profileId:state.user?.profileId || state.user?.profile?.id || '', permissions:[...(state.user?.permissions||[])], userId:state.user?.id || '' });
  }

  function updateClock() {
    const now = new Date();
    const el = document.getElementById('clock');
    if (!el) return;
    const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    const date = now.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
    el.textContent = `${time}\n${date}`;
  }

  async function loadCommonData() {
    if(api.webMode){
      state.products=await api.products();
      state.categories=await api.categories();state.users=[];
      state.customers=window.PdvAccessPolicy?.hasCapability(state.user,'customers.view')?await api.customers():[];
      state.sellers=window.PdvAccessPolicy?.hasCapability(state.user,'sellers.view')?await api.sellers():[{id:state.user.id,name:state.user.name}];
      state.selectedSellerId=state.user.id;
      state.cashSession=await api.openCash(state.config.terminalId).catch(()=>null);
      return;
    }
    const plan=window.PdvAccessPolicy?.commonDataLoadPlan?.(state.user)||{
      categories:false,products:false,productPhotos:false,customers:false,sellers:false,users:false,cash:false
    };
    const [categories, products, customers, sellers] = await Promise.all([
      plan.categories?api.categories():Promise.resolve([]),
      plan.products?api.products():Promise.resolve([]),
      plan.customers?api.customers():Promise.resolve([]),
      plan.sellers?api.sellers():Promise.resolve([])
    ]);
    state.categories = categories; state.products = products; state.customers = customers; state.sellers = sellers;
    if(plan.productPhotos){
      try { state.photoSyncStatus = await api.syncProductPhotos(false); monitorProductPhotoSync(); }
      catch (error) { state.photoSyncStatus={failed:1,lastError:error.message}; }
    }else state.photoSyncStatus=null;
    if (!state.selectedSellerId || !sellers.some((seller) => seller.id === state.selectedSellerId)) state.selectedSellerId = sellers.find((seller) => seller.id === state.user?.id)?.id || sellers[0]?.id || '';
    if (plan.users) {
      try { state.users = await api.users(true); } catch { state.users = []; }
    } else state.users=[];
    if(plan.cash){
      try { state.cashSession = await api.openCash(state.config.terminalId); } catch { state.cashSession = null; }
    }else state.cashSession=null;
  }

  async function restoreCheckoutState() {
    if(api.webMode){
      const [open,suspended]=await Promise.all([api.sales('OPEN',25),api.sales('SUSPENDED',25)]);
      state.suspendedSales=suspended;
      if(!state.sale||state.sale.status!=='OPEN')state.sale=open.find(sale=>sale.operatorId===state.user?.id)||null;
      state.discountPercent=state.sale?.subtotalCents?Number((state.sale.discountCents/state.sale.subtotalCents*100).toFixed(2)):0;
      return;
    }
    const [openSales,suspended,documents]=await Promise.all([
      api.sales('OPEN',20),
      api.sales('SUSPENDED',30),
      api.checkoutDocuments('').catch(()=>[])
    ]);
    state.suspendedSales=suspended;
    clearCheckoutDocumentContext();
    state.sale=ui.selectCheckoutRestoreSale(openSales,documents,state.config.terminalId,state.user.id);
    if (state.sale?.sellerId) state.selectedSellerId = state.sale.sellerId;
    state.discountPercent = state.sale?.subtotalCents ? Number(((state.sale.discountCents / state.sale.subtotalCents) * 100).toFixed(2)) : 0;
  }

  async function navigate(route) {
    if (!ROUTES[route]) route = 'home';
    if (!canAccessRoute(route)) route = 'home';
    state.route = route;
    document.body.dataset.activeRoute = route;
    delete document.body.dataset.activeModuleWorkspace;
    document.body.classList.toggle('theme-home', route === 'home');
    renderSidebar();
    if (route === 'checkout') {
      try { await restoreCheckoutState(); } catch (error) { showToast(error.message, 'error'); }
    }
    await renderRoute(); content.focus({ preventScroll: true });
  }

  async function renderRoute() {
    if (routeRegistry.has(state.route)) return routeRegistry.render(state.route, { state });
    return renderPlaceholder(state.route);
  }

  function renderFlowHub(title, subtitle, cards) {
    const visibleCards=(Array.isArray(cards)?cards:[]).filter(card=>canAccessRoute(card.route));
    content.innerHTML=`<section class="page flow-hub-page" data-flow-hub="${escapeHtml(title)}"><header class="page-head"><div><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></div></header><div class="flow-hub-grid">${visibleCards.map(card=>`<button type="button" class="home-tile tone-${card.tone || 'blue'}" data-flow-route="${card.route}"><span class="tile-icon">${icon(card.icon,42)}</span><h2>${escapeHtml(card.label)}</h2><p>${escapeHtml(card.description)}</p></button>`).join('')}</div></section>`;
    content.querySelectorAll('[data-flow-route]').forEach(button=>button.addEventListener('click',()=>navigate(button.dataset.flowRoute)));
  }

  function focusHomeSettingsTarget(selector,attempts=24){
    if(!selector||attempts<=0||document.body.dataset.activeRoute!=='settings')return;
    const target=document.querySelector(selector);
    if(target){target.scrollIntoView({behavior:'smooth',block:'start'});target.classList.add('home-target-highlight');window.setTimeout(()=>target.classList.remove('home-target-highlight'),1600);return;}
    window.setTimeout(()=>focusHomeSettingsTarget(selector,attempts-1),100);
  }

  function renderHome() {
    const original=homeRoleModel?.homeForUser?.(state.user,ui.HOME_TILES)||{label:'Operação',title:'Início',subtitle:'Acesso rápido.',sections:[{key:'main',label:'',tiles:ui.HOME_TILES}]};
    const view=api.webMode?{...original,sections:original.sections.map(section=>({...section,tiles:section.tiles.filter(tile=>canAccessRoute(tile.route))})).filter(section=>section.tiles.length)}:original;
    const operatorName=state.user?.name||'';
    content.innerHTML=`<section id="classic-home-grid" class="classic-home-grid" aria-label="Início de ${escapeHtml(view.label)}"><header class="classic-home-head"><div><span class="classic-home-eyebrow">Início · ${escapeHtml(view.label)}</span><h1>${escapeHtml(view.title)}</h1><p>${escapeHtml(view.subtitle)}</p></div>${operatorName?`<span class="classic-home-operator">${escapeHtml(operatorName)}</span>`:''}</header>${view.sections.map(section=>`<section class="classic-home-section" data-home-section="${escapeHtml(section.key)}">${section.label?`<h2>${escapeHtml(section.label)}</h2>`:''}<div class="classic-home-tiles">${section.tiles.map(tile=>`<button type="button" class="home-tile tone-${escapeHtml(tile.tone||'blue')}" data-home-route="${escapeHtml(tile.route)}" aria-label="Abrir ${escapeHtml(tile.label)}"><span class="tile-icon">${icon(tile.icon,46)}</span><h3>${escapeHtml(tile.label)}</h3><p>${escapeHtml(tile.description)}</p>${tile.shortcut?`<span class="shortcut-badge">${escapeHtml(tile.shortcut)}</span>`:''}</button>`).join('')}</div></section>`).join('')}</section>`;
    document.body.classList.add('home-view-classic');
    content.querySelectorAll('[data-home-route]').forEach(button=>button.addEventListener('click',async()=>{
      const tile=view.sections.flatMap(section=>section.tiles).find(item=>item.route===button.dataset.homeRoute);
      await navigate(button.dataset.homeRoute);
      if(tile?.target)focusHomeSettingsTarget(tile.target);
    }));
  }

  function renderPlaceholder(route) {
    const meta = ROUTES[route];
    content.innerHTML = `<section class="page"><header class="page-head"><div><h1>${escapeHtml(meta.label)}</h1><p>Módulo previsto para ${escapeHtml(meta.phase || 'próxima entrega')}.</p></div></header><div class="data-card"><div class="empty-state"><div class="empty-state-icon">${icon(meta.icon, 48)}</div><strong>${escapeHtml(meta.label)}</strong><p>O atalho e a navegação já fazem parte da UI definitiva. A regra operacional será incorporada na etapa ${escapeHtml(meta.phase || 'seguinte')} sem criar funcionalidade simulada.</p></div></div></section>`;
  }

  function selectedCustomer() { return state.customers.find((customer) => customer.id === state.sale?.customerId) || null; }

  function checkoutDocumentContextWhen(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  }

  function clearCheckoutDocumentContext() { state.checkoutDocumentContext = null; }

  function checkoutDocumentContextMarkup() {
    const context=state.checkoutDocumentContext;
    if (!context) return '';
    const document=context.document || {};
    if (context.type === 'ORDER') {
      const number=document.orderNumber || document.id || 'Pedido';
      const customer=document.customerName || selectedCustomer()?.name || 'Cliente não identificado';
      const fulfillment=String(document.fulfillmentType || '').toUpperCase() === 'DELIVERY' ? 'Entrega' : 'Retirada';
      const expected=document.expectedAt ? ` · previsão ${checkoutDocumentContextWhen(document.expectedAt)}` : '';
      return `<div class="checkout-document-context" data-checkout-document-context><div><small>Pedido em atendimento</small><strong>${escapeHtml(number)} · ${escapeHtml(customer)}</strong></div><span>Atacado · ${fulfillment}${expected}</span></div>`;
    }
    if (context.type === 'DELIVERY') {
      const customer=document.customerName || selectedCustomer()?.name || 'Cliente não identificado';
      const fulfillment=String(document.fulfillmentType || '').toUpperCase()==='PICKUP'?'Retirada':'Delivery';
      return `<div class="checkout-document-context" data-checkout-document-context><div><small>Pedido em atendimento</small><strong>${escapeHtml(customer)}</strong></div><span>${escapeHtml(fulfillment)} · ${escapeHtml(checkoutDocumentStatusLabel(document.status))}</span></div>`;
    }
    const table=document.tableLabel || document.label || document.tableId || 'Comanda';
    const opened=document.openedAt ? ` · aberta ${checkoutDocumentContextWhen(document.openedAt)}` : '';
    return `<div class="checkout-document-context" data-checkout-document-context><div><small>Comanda em atendimento</small><strong>${escapeHtml(table)}</strong></div><span>Alimentação${opened}</span></div>`;
  }

  function checkoutProductGridHtml() {
    const products = ui.filterProducts(state.products.filter((product) => product.menuEnabled), state.productQuery, state.categoryId);
    return products.map((product) => productCard(product)).join('') || '<div class="empty-state">Nenhum produto encontrado.</div>';
  }

  function renderCheckout() {
    if (!isRouteActive('checkout')) return;
    const focusId=document.activeElement?.id;
    const oldSearch=document.getElementById('product-search');
    const oldStart=oldSearch?.selectionStart,oldEnd=oldSearch?.selectionEnd;
    const oldList=content.querySelector('.cart-list')?.scrollTop||0;
    const customer = selectedCustomer(); const sale = state.sale;
    content.innerHTML = `<section class="checkout-layout"><div class="checkout-main"><div class="checkout-hero"><div><h1>Balcão</h1><p>Venda rápida e prática para o seu cliente</p></div><em>Agilidade no atendimento,<br>mais vendas todos os dias.</em></div><div class="checkout-tools"><label class="search-field" for="product-search">${icon('document')}<input id="product-search" aria-label="Buscar produto por nome, código ou código de barras" autocomplete="off" placeholder="Buscar produto por nome, código ou código de barras..." value="${escapeHtml(state.productQuery)}"><span>▥</span></label><button id="scan-focus" class="scan-button" type="button">▥ &nbsp; Ler código (F2)</button><button id="peripherals-settings" class="scan-button" type="button">Dispositivos locais</button><button id="checkout-documents" class="scan-button" type="button">${icon('history',18)} &nbsp; Comandas e pedidos</button></div><div class="category-chips"><button class="category-chip ${!state.categoryId ? 'active' : ''}" data-category="">Todos</button>${state.categories.map((category) => `<button class="category-chip ${state.categoryId === category.id ? 'active' : ''}" data-category="${category.id}">${escapeHtml(category.name)}</button>`).join('')}</div><div class="product-grid">${checkoutProductGridHtml()}</div><div class="checkout-actions"><h3>Ações da venda</h3><div class="action-grid"><button class="action-button" id="new-sale" type="button">▶ &nbsp; Iniciar venda <small>F1</small></button><button class="action-button orange" id="remove-item" type="button">⌫ &nbsp; Cancelar item <small>F3</small></button><button class="action-button red" id="cancel-sale" type="button">⊗ &nbsp; Cancelar venda <small>F4</small></button><button class="action-button blue" id="suspend-sale" type="button">Ⅱ &nbsp; Suspender <small>F6</small></button></div></div></div><aside class="sale-panel">${checkoutDocumentContextMarkup()}<div class="customer-block"><h3>Cliente <small class="optional-label">(opcional)</small></h3><label class="search-field" for="customer-search">⌕<input id="customer-search" aria-label="Buscar cliente" autocomplete="off" placeholder="Buscar cliente..." value="${escapeHtml(state.customerQuery)}"></label><div id="customer-suggestions"></div>${customer ? `<div class="customer-selected"><span class="avatar">${escapeHtml(initials(customer.name))}</span><div><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.document || 'Sem documento')}</small></div><button id="remove-customer" type="button" aria-label="Remover cliente">×</button></div>` : ''}</div><div class="cart-head"><h3>Itens da venda (${sale?.items?.length || 0})</h3><button id="clear-cart" class="secondary-button" type="button">Limpar carrinho</button></div><div class="cart-list">${sale?.items?.map((item) => cartLine(item)).join('') || '<div class="empty-state">Nenhum item na venda.</div>'}</div><div class="totals"><div class="total-row"><span>Subtotal</span><strong>${ui.formatCents(sale?.subtotalCents || 0)}</strong></div><div class="total-row"><span>Desconto</span><div class="discount-control"><span>%</span><input id="discount-percent" type="number" aria-label="Percentual de desconto" min="0" max="100" step="0.01" value="${state.discountPercent || 0}"><strong>${ui.formatCents(sale?.discountCents || 0)}</strong></div></div><div class="total-row grand-total"><span>Total da venda</span><strong>${ui.formatCents(sale?.totalCents || 0)}</strong></div></div><div class="payment-strip"><button class="pay-button" data-pay="cash">Dinheiro</button><button class="pay-button card" data-pay="card">Cartão</button><button class="pay-button pix" data-pay="pix">PIX</button></div><button class="finalize-button" id="finalize-sale" type="button">Finalizar venda (F12) &nbsp; ›</button></aside></section>`;
    content.querySelector('.sale-panel')?.insertAdjacentHTML('afterbegin', `<div class="customer-block"><label class="checkout-context-label" for="seller-select">Vendedor / Garçom</label><select id="seller-select" class="secondary-button checkout-seller-select">${state.sellers.map((seller) => `<option value="${seller.id}" ${seller.id === (sale?.sellerId || state.selectedSellerId) ? 'selected' : ''}>${escapeHtml(seller.name)}</option>`).join('')}</select></div>`);
    if(api.webMode){
      content.querySelector('#checkout-documents')?.remove();
      if(!window.PdvAccessPolicy?.hasCapability(state.user,'customers.view'))content.querySelectorAll('.customer-block').forEach(block=>{block.hidden=true;});
      content.querySelector('#scan-focus')?.setAttribute('title','Digite ou use um leitor USB como teclado');
      content.querySelector('#clear-cart')?.setAttribute('title','Remove itens desta venda, sem apagá-la');
      content.querySelector('#discount-percent')?.toggleAttribute('disabled',!window.PdvAccessPolicy?.hasCapability(state.user,'sales.discount'));
      content.querySelectorAll('[data-category]').forEach(node=>node.hidden=Boolean(node.dataset.category));
    }
    hydrateProductPhotos();
    bindCheckoutEvents();
    if(api.webMode){
      const oldScroll=content.querySelector('.cart-list');if(oldScroll)oldScroll.scrollTop=oldList;
      if(focusId){
        const focusTarget=document.getElementById(focusId);
        if(focusTarget){focusTarget.focus({preventScroll:true});
          if(focusId==='product-search'&&oldStart!=null&&oldEnd!=null)focusTarget.setSelectionRange(oldStart,oldEnd);}
      }
    }
    routeRegistry.updated('checkout', { surface:'checkout' });
  }

  function productCard(product) {
    const visual=product.photo?`<img data-product-photo="${product.id}" alt="Foto de ${escapeHtml(product.name)}"><span class="photo-placeholder">${escapeHtml(initials(product.name))}</span>`:`<span>${escapeHtml(initials(product.name))}</span>`;
    const weighted=['KG','G'].includes(String(product.unit||'').toUpperCase());
    const price=`${ui.formatCents(product.salePriceCents)}${weighted?` / ${escapeHtml(String(product.unit||'KG').toLowerCase())}`:''}`;
    return `<button type="button" class="product-card" data-add-product="${product.id}"><div><div class="product-visual">${visual}</div><h3>${escapeHtml(product.name)}</h3><small>${weighted?'Venda por peso · ':''}Cód. ${escapeHtml(product.sku || product.barcode || product.id.slice(0, 8))}</small></div><strong>${price}<span class="add-cart">+</span></strong></button>`;
  }

  function hydrateProductPhotos() {
    content.querySelectorAll('[data-product-photo]').forEach(async image => { try { const source=await api.productPhotoDataUrl(image.dataset.productPhoto);if(source){image.src=source;image.addEventListener('load',()=>image.parentElement?.classList.add('has-photo'),{once:true});} } catch {} });
  }

  function bindCheckoutProductCards(root = content) {
    root.querySelectorAll('[data-add-product]').forEach((button) => button.addEventListener('click', () => addProduct(button.dataset.addProduct)));
  }

  function renderCheckoutProductGrid() {
    const grid = content.querySelector('.product-grid');
    if (!grid) return;
    grid.innerHTML = checkoutProductGridHtml();
    hydrateProductPhotos();
    bindCheckoutProductCards(grid);
  }

  function cartLine(item) {
    const changed = item.catalogUnitPriceCents != null && item.catalogUnitPriceCents !== item.unitPriceCents;
    const weight=item.configuration?.weight||null;
    const sourceDocument=item.configuration?.sourceDocument||null;
    const configured=Boolean(item.configuration?.pizza||item.configuration?.variant||item.configuration?.options?.length||item.configuration?.comboSelections?.length);
    const configurationSummary=configured?window.PdvOrderComposer?.configurationSummary?.(item.configuration)||'':'';
    const weightLabel=weight?`${quantityLabel(Number(weight.grams||0))} g · ${escapeHtml(String(weight.source||'MANUAL')==='SCALE'?'balança':String(weight.source||'MANUAL')==='BARCODE'?'etiqueta':'manual')}`:null;
    const documentLabel=sourceDocument?`${escapeHtml(sourceDocument.orderNumber||sourceDocument.id||'Pedido')} · preço do pedido`:null;
    const priceDetails = changed ? `<small><s>${ui.formatCents(item.catalogUnitPriceCents)}</s> → ${ui.formatCents(item.unitPriceCents)}${item.priceOverrideReason ? ` · ${escapeHtml(item.priceOverrideReason)}` : ''}${documentLabel?` · ${documentLabel}`:''}</small>` : `<small>${ui.formatCents(item.unitPriceCents)}${weightLabel?` · ${weightLabel}`:''}${documentLabel?` · ${documentLabel}`:''}</small>`;
    const priceButton = !sourceDocument&&window.PdvAccessPolicy?.hasCapability(state.user,'sales.discount') ? `<button type="button" class="secondary-button cart-price-edit" data-price-item="${item.id}">Alterar preço</button>` : '';
    const quantityControl=sourceDocument?`<div class="qty-control"><span>${quantityLabel(item.quantity)} · pedido</span></div>`:weight?`<div class="qty-control"><span>${weightLabel}</span></div>`:configured?`<div class="qty-control"><button type="button" data-configured-qty-minus="${item.id}">−</button><span>${quantityLabel(item.quantity)}</span><button type="button" data-configured-qty-plus="${item.id}">＋</button></div>`:`<div class="qty-control"><button type="button" data-qty-minus="${item.productId}">−</button><span>${quantityLabel(item.quantity)}</span><button type="button" data-qty-plus="${item.productId}">＋</button></div>`;
    const remove=sourceDocument?'':weight?`<button type="button" class="cart-remove-button" data-remove-weighted="${item.id}" aria-label="Remover pesagem">×</button>`:configured?`<button type="button" class="cart-remove-button" data-remove-configured="${item.id}" aria-label="Remover esta configuração">×</button>`:`<button type="button" class="cart-remove-button" data-remove="${item.productId}">×</button>`;
    return `<div class="cart-line ${state.selectedProductId === item.productId ? 'selected' : ''}" data-select-product="${item.productId}"><div><strong>${escapeHtml(item.productName)}</strong>${configurationSummary?`<small>${escapeHtml(configurationSummary)}</small>`:''}${priceDetails}${priceButton}</div>${quantityControl}<div class="line-total">${ui.formatCents(item.totalCents)} ${remove}</div></div>`;
  }

  function bindCheckoutEvents() {
    const search = document.getElementById('product-search');
    search?.addEventListener('input', (event) => { state.productQuery = event.target.value; renderCheckoutProductGrid(); });
    document.getElementById('scan-focus')?.addEventListener('click', () => document.getElementById('product-search')?.focus());
    document.getElementById('checkout-documents')?.addEventListener('click', openCheckoutDocuments);
    content.querySelectorAll('[data-category]').forEach((button) => button.addEventListener('click', () => { state.categoryId = button.dataset.category; renderCheckout(); }));
    bindCheckoutProductCards();
    content.querySelectorAll('[data-select-product]').forEach((line) => line.addEventListener('click', (event) => { if (event.target.closest('button')) return; state.selectedProductId = line.dataset.selectProduct; renderCheckout(); }));
    content.querySelectorAll('[data-qty-minus]').forEach((button) => button.addEventListener('click', () => changeQuantity(button.dataset.qtyMinus, -1)));
    content.querySelectorAll('[data-qty-plus]').forEach((button) => button.addEventListener('click', () => changeQuantity(button.dataset.qtyPlus, 1)));
    content.querySelectorAll('[data-configured-qty-minus]').forEach(button=>button.addEventListener('click',()=>changeConfiguredQuantity(button.dataset.configuredQtyMinus,-1)));
    content.querySelectorAll('[data-configured-qty-plus]').forEach(button=>button.addEventListener('click',()=>changeConfiguredQuantity(button.dataset.configuredQtyPlus,1)));
    content.querySelectorAll('[data-remove]').forEach((button) => button.addEventListener('click', () => removeProduct(button.dataset.remove)));
    content.querySelectorAll('[data-remove-weighted]').forEach((button) => button.addEventListener('click', () => removeWeightedItem(button.dataset.removeWeighted)));
    content.querySelectorAll('[data-remove-configured]').forEach(button=>button.addEventListener('click',()=>removeConfiguredItem(button.dataset.removeConfigured)));
    content.querySelectorAll('[data-price-item]').forEach((button) => button.addEventListener('click', () => openPriceOverride(button.dataset.priceItem)));
    document.getElementById('seller-select')?.addEventListener('change', setSelectedSeller);
    document.getElementById('new-sale')?.addEventListener('click', newSale);
    document.getElementById('remove-item')?.addEventListener('click', () => state.selectedProductId ? removeProduct(state.selectedProductId) : showToast('Selecione um item.', 'error'));
    document.getElementById('cancel-sale')?.addEventListener('click', cancelCurrentSale);
    document.getElementById('suspend-sale')?.addEventListener('click', suspendCurrentSale);
    document.getElementById('clear-cart')?.addEventListener('click', clearCart);
    document.getElementById('discount-percent')?.addEventListener('change', applyDiscountFromInput);
    document.getElementById('customer-search')?.addEventListener('input', customerSearchInput);
    document.getElementById('remove-customer')?.addEventListener('click', () => setCustomer(null));
    content.querySelectorAll('[data-pay]').forEach((button) => button.addEventListener('click', () => openPaymentModal(button.dataset.pay)));
    document.getElementById('finalize-sale')?.addEventListener('click', () => openPaymentModal());
  }

  function checkoutDocumentStatusLabel(value) {
    const key=String(value||'').trim().toUpperCase();
    return ({
      NEW:'Novo pedido',
      PREPARING:'Preparando',
      READY:'Pedido pronto',
      OUT_FOR_DELIVERY:'Saiu para entrega',
      DELIVERED:'Entregue',
      PICKED_UP:'Retirado',
      OPEN:'Em aberto',
      SUSPENDED:'Suspensa',
      CHECKOUT:'Em cobrança',
      QUOTED:'Cotado',
      CONFIRMED:'Confirmado',
      PARTIALLY_FULFILLED:'Parcialmente atendido',
      FULFILLED:'Atendido',
      COMPLETED:'Concluída',
      CANCELLED:'Cancelado'
    })[key]||'Em andamento';
  }

  function checkoutDocumentTypeLabel(row) {
    if(row.type==='COMMAND')return 'Alimentação';
    if(row.type==='ORDER')return 'Atacado';
    if(row.type==='DELIVERY')return row.fulfillmentType==='PICKUP'?'Retirada':'Delivery';
    return 'Pedido';
  }

  function openCheckoutDocuments() {
    openModal('Comandas e pedidos', `<div class="field"><label>Localizar</label><input id="checkout-document-query" autocomplete="off" placeholder="Número, mesa, comanda, cliente ou telefone"></div><div class="checkout-document-filters" role="group" aria-label="Filtrar documentos"><button type="button" class="checkout-document-filter" data-checkout-document-filter="" aria-pressed="true">Todos</button><button type="button" class="checkout-document-filter" data-checkout-document-filter="comanda" aria-pressed="false">Comandas</button><button type="button" class="checkout-document-filter" data-checkout-document-filter="atacado" aria-pressed="false">Atacado</button><button type="button" class="checkout-document-filter" data-checkout-document-filter="delivery" aria-pressed="false">Delivery</button><button type="button" class="checkout-document-filter" data-checkout-document-filter="retirada" aria-pressed="false">Retirada</button></div><div id="checkout-document-results" class="data-card"><div class="empty-state">Carregando documentos em aberto…</div></div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Fechar</button></div>`, { wide:true, onMount(root) {
      const input=root.querySelector('#checkout-document-query');
      const host=root.querySelector('#checkout-document-results');
      const filterButtons=[...root.querySelectorAll('[data-checkout-document-filter]')];
      let activeFilter='';let timer=null;
      const render=rows=>{
        host.innerHTML=rows.length?rows.map(row=>`<div class="data-row"><span><strong>${escapeHtml(row.label||row.number)}</strong><small>${escapeHtml(checkoutDocumentTypeLabel(row))} · ${escapeHtml(checkoutDocumentStatusLabel(row.status))}${row.customerName?` · ${escapeHtml(row.customerName)}`:''}</small></span><span><strong>${ui.formatCents(row.totalCents||0)}</strong><button type="button" class="primary-button" data-open-checkout-document="${escapeHtml(row.type)}:${escapeHtml(row.id)}" data-checkout-document-sale="${escapeHtml(row.saleId||'')}">Abrir no caixa</button></span></div>`).join(''):'<div class="empty-state">Nenhuma comanda ou pedido encontrado.</div>';
        host.querySelectorAll('[data-open-checkout-document]').forEach(button=>button.addEventListener('click',async()=>{
          const split=button.dataset.openCheckoutDocument.indexOf(':');
          const type=button.dataset.openCheckoutDocument.slice(0,split);
          const id=button.dataset.openCheckoutDocument.slice(split+1);
          try{
            const currentOperationalDocument=Boolean(state.checkoutDocumentContext);
            const targetSaleId=String(button.dataset.checkoutDocumentSale||'').trim();
            const sameCanonicalSale=Boolean(targetSaleId&&state.sale?.id===targetSaleId);
            if(state.sale?.status==='OPEN'&&state.sale.items?.length&&!currentOperationalDocument&&!sameCanonicalSale)throw new Error('Finalize, suspenda ou cancele a venda atual antes de abrir uma comanda ou pedido.');
            if(state.sale?.status==='OPEN'&&!state.sale.items?.length&&!currentOperationalDocument&&!sameCanonicalSale){await api.cancelSale(state.sale.id,'Substituída por documento operacional');state.sale=null;}
            if(state.sale?.status==='OPEN'&&targetSaleId&&state.sale.id===targetSaleId)state.checkoutDocumentContext={type,document:rows.find(row=>row.type===type&&String(row.id)===String(id))||null};
            button.disabled=true;
            const opened=await api.openCheckoutDocument(type,id);
            state.sale=opened.sale;
            state.checkoutDocumentContext={type,document:opened.document};
            state.discountPercent=0;state.selectedProductId=null;
            closeModal();renderCheckout();
            const label=type==='COMMAND'?'Comanda':type==='DELIVERY'?(opened.document?.fulfillmentType==='PICKUP'?'Retirada':'Delivery'):'Pedido';
            showToast(`${label} carregado no caixa.`,'success');
          }catch(error){button.disabled=false;showToast(error.message,'error');}
        }));
      };
      const load=async()=>{try{host.innerHTML='<div class="empty-state">Buscando…</div>';const query=[activeFilter,input.value].map(value=>String(value||'').trim()).filter(Boolean).join(' ');render(await api.checkoutDocuments(query));}catch(error){host.innerHTML=`<div class="empty-state">${escapeHtml(error.message)}</div>`;}};
      filterButtons.forEach(button=>button.addEventListener('click',()=>{activeFilter=button.dataset.checkoutDocumentFilter||'';filterButtons.forEach(item=>item.setAttribute('aria-pressed',String(item===button)));void load();}));
      input.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(load,180);});
      input.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();clearTimeout(timer);void load();}});
      void load();input.focus();
    }});
  }

  async function ensureSale() {
    if (state.sale?.status === 'OPEN') return state.sale;
    const saleNumber = `${new Date().toISOString().slice(2,10).replace(/-/g,'')}-${Date.now().toString().slice(-6)}`;
    if(api.webMode&&!state.pendingNewSaleKey)state.pendingNewSaleKey=api.mutationId();
    clearCheckoutDocumentContext(); state.sale = await api.openSale({ saleNumber, terminalId: state.config.terminalId, sellerId: state.selectedSellerId || state.user.id },state.pendingNewSaleKey); state.pendingNewSaleKey=null; state.discountPercent = 0; return state.sale;
  }

  async function setSelectedSeller(event) {
    state.selectedSellerId = event.target.value;
    if (!state.sale) return;
    try { state.sale = await api.setSaleSeller(state.sale.id, state.selectedSellerId); renderCheckout(); }
    catch (error) { showToast(error.message, 'error'); renderCheckout(); }
  }

  function openPriceOverride(itemId) {
    const item = state.sale?.items.find((entry) => entry.id === itemId); if (!item) return;
    openModal('Alterar preço do item', `<form id="price-override-form"><div class="field"><label>Novo preço *</label><input name="unitPrice" inputmode="decimal" required value="${(item.unitPriceCents / 100).toFixed(2).replace('.', ',')}"></div><div class="field"><label>Justificativa *</label><textarea name="reason" rows="3" required minlength="3" placeholder="Informe o motivo da alteração"></textarea></div><p>O preço original será preservado no histórico. Esta ação exige perfil de gerente ou administrador.</p><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button class="primary-button" type="submit">Aplicar preço</button></div></form>`, { onMount(root) { root.querySelector('#price-override-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { state.sale = await api.overrideSaleItemPrice(state.sale.id, itemId, { unitPriceCents: centsFromInput(formValue(form, 'unitPrice')), reason: formValue(form, 'reason') }); closeModal(); renderCheckout(); showToast('Preço alterado e registrado na auditoria.', 'success'); } catch (error) { showToast(error.message, 'error'); } }); } });
  }

  async function newSale() {
    try {
      if (state.sale?.status === 'OPEN' && state.sale.items.length) return showToast('Finalize, suspenda ou cancele a venda atual antes de iniciar outra.', 'error');
      if (state.sale?.status === 'OPEN') return showToast('Venda já iniciada.');
      await ensureSale(); renderCheckout(); document.getElementById('product-search')?.focus();
    } catch (error) { showToast(error.message, 'error'); }
  }

  async function addProduct(productId) {
    const product=state.products.find(item=>item.id===productId);
    if(!product)return showToast('Produto não encontrado.','error');
    if(['KG','G'].includes(String(product.unit||'').toUpperCase()))return openWeightedProduct(product);
    try {
      if(api.webMode){
        const sale=await ensureSale();
        state.sale=await api.addSaleItem(sale.id,productId,1);
        state.selectedProductId=productId;
        renderCheckout();
        return;
      }
      const configuration=await api.productConfiguration(productId);
      if(window.PdvOrderComposer?.hasConfiguration?.(configuration)){
        await window.PdvRestaurantOrderComposerUi.configure({
          api,modalRoot,product,
          onAdd:async line=>{
            const sale=await ensureSale();
            state.sale=await api.addConfiguredSaleItem(sale.id,{
              productId:line.productId,quantity:line.quantity,
              variantId:line.configuration?.variantId||undefined,
              selections:line.configuration?.selections||[],
              comboSelections:line.configuration?.comboSelections||[],
              note:line.note||''
            });
            state.selectedProductId=productId;
            renderCheckout();
          }
        });
        return;
      }
      const sale=await ensureSale();
      state.sale=await api.addSaleItem(sale.id,productId,1);
      state.selectedProductId=productId;
      renderCheckout();
    }catch(error){showToast(error.message,'error');}
  }

  async function changeConfiguredQuantity(itemId,delta){
    const item=state.sale?.items.find(row=>row.id===itemId);if(!item)return;
    const next=Number((item.quantity+delta).toFixed(3));
    if(next<=0)return removeConfiguredItem(itemId);
    try{state.sale=await api.updateConfiguredSaleItemQuantity(state.sale.id,itemId,next);renderCheckout();}
    catch(error){showToast(error.message,'error');}
  }

  async function removeConfiguredItem(itemId){
    if(!state.sale)return;
    try{state.sale=await api.removeConfiguredSaleItem(state.sale.id,itemId);state.selectedProductId=null;renderCheckout();}
    catch(error){showToast(error.message,'error');}
  }

  function openWeightedProduct(product) {
    const unit=String(product.unit||'KG').toUpperCase();
    openModal(`Adicionar ${product.name} por peso`, `<form id="weighted-product-form"><p>Preço: <strong>${ui.formatCents(product.salePriceCents)} / ${escapeHtml(unit.toLowerCase())}</strong>. Informe o peso ou leia da balança configurada.</p><div class="field"><label>Peso em gramas *</label><input name="grams" type="number" min="1" step="1" required></div><div class="modal-actions"><button type="button" class="secondary-button" id="weighted-read-scale">Ler balança</button><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button class="primary-button" type="submit">Adicionar à venda</button></div><p id="weighted-product-status"></p></form>`, { onMount(root) {
      const form=root.querySelector('#weighted-product-form');const grams=form.elements.namedItem('grams');const status=root.querySelector('#weighted-product-status');
      root.querySelector('#weighted-read-scale')?.addEventListener('click',async()=>{try{status.textContent='Lendo balança…';const device=window.PdvWebHardware; if(!device)throw new Error("Integração local indisponível.");const reading=await device.readWeight();const kg=String(reading?.unit||'kg').toLowerCase()==='g'?Number(reading.weight)/1000:Number(reading.weight);const value=kg*1000;if(!Number.isFinite(value)||value<=0)throw new Error('Peso inválido.');grams.value=String(Math.round(value));status.textContent=`Peso lido: ${quantityLabel(value)} g`;}catch(error){status.textContent=error.message;showToast(error.message,'error');}});
      form.addEventListener('submit',async event=>{event.preventDefault();const value=Number(grams.value);if(!Number.isSafeInteger(value)||value<=0)return showToast('Informe o peso em gramas inteiras.','error');try{const sale=await ensureSale();state.sale=await api.addWeightedSaleItem(sale.id,{productId:product.id,grams:value,source:status.textContent.startsWith('Peso lido:')?'SCALE':'MANUAL'});state.selectedProductId=product.id;closeModal();renderCheckout();}catch(error){showToast(error.message,'error');}});
    } });
  }

  async function changeQuantity(productId, delta) {
    const item = state.sale?.items.find((entry) => entry.productId === productId); if (!item) return;
    const next = Number((item.quantity + delta).toFixed(3)); if (next <= 0) return removeProduct(productId);
    try { state.sale = await api.updateSaleItem(state.sale.id, productId, next); renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
  }

  async function removeWeightedItem(itemId) {
    if(!state.sale)return;
    try{state.sale=await api.removeWeightedSaleItem(state.sale.id,itemId);state.selectedProductId=null;renderCheckout();}catch(error){showToast(error.message,'error');}
  }

  async function removeProduct(productId) {
    if (!state.sale) return;
    const weighted=state.sale.items.filter(item=>item.productId===productId&&item.configuration?.weight);
    if(weighted.length===1)return removeWeightedItem(weighted[0].id);
    if(weighted.length>1)return showToast('Há mais de uma pesagem deste produto. Remova a linha desejada pelo × do carrinho.','error');
    try { state.sale = await api.removeSaleItem(state.sale.id, productId); if (state.selectedProductId === productId) state.selectedProductId = null; renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
  }

  async function clearCart() {
    if (!state.sale?.items?.length) return;
    try { for (const item of [...state.sale.items]) state.sale = item.configuration?.weight ? await api.removeWeightedSaleItem(state.sale.id,item.id) : item.configuration? await api.removeConfiguredSaleItem(state.sale.id,item.id) : await api.removeSaleItem(state.sale.id,item.productId); state.selectedProductId = null; renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
  }

  async function applyDiscountFromInput() {
    if (!state.sale) return;
    const percent = Number(document.getElementById('discount-percent')?.value || 0); const discountCents = ui.percentageToDiscountCents(state.sale.subtotalCents, percent);
    try { state.sale = await api.discountSale(state.sale.id, discountCents); state.discountPercent = Math.min(Math.max(percent, 0), 100); renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
  }

  function customerSearchInput(event) { state.customerQuery = event.target.value; renderCustomerSuggestions(); }
  function renderCustomerSuggestions() {
    const root = document.getElementById('customer-suggestions'); if (!root) return;
    const needle = ui.normalizeSearch(state.customerQuery); if (!needle) { root.innerHTML = ''; return; }
    const matches = state.customers.filter((customer) => ui.normalizeSearch(`${customer.name} ${customer.document || ''} ${customer.id}`).includes(needle)).slice(0, 5);
    root.innerHTML = matches.map((customer) => `<button type="button" class="customer-selected customer-suggestion-button" data-customer-id="${customer.id}"><span class="avatar">${escapeHtml(initials(customer.name))}</span><div><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.document || '')}</small></div></button>`).join('');
    root.querySelectorAll('[data-customer-id]').forEach((button) => button.addEventListener('click', () => setCustomer(button.dataset.customerId)));
  }

  async function setCustomer(customerId) {
    try { const sale = await ensureSale(); state.sale = await api.setSaleCustomer(sale.id, customerId); state.customerQuery = ''; renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
  }

  async function cancelCurrentSale() {
    if (!state.sale || !['OPEN','SUSPENDED'].includes(state.sale.status)) return showToast('Não há venda aberta para cancelar.', 'error');
    openModal('Cancelar venda', `<p>Informe o motivo do cancelamento da venda atual.</p><div class="field"><label>Motivo</label><input id="cancel-reason" value="Cliente desistiu"></div><div class="modal-actions"><button class="secondary-button" data-close-modal>Voltar</button><button class="danger-button" id="confirm-cancel">Cancelar venda</button></div>`, { onMount(root) { root.querySelector('#confirm-cancel')?.addEventListener('click', async () => { try { await api.cancelSale(state.sale.id, root.querySelector('#cancel-reason').value); state.sale = null; clearCheckoutDocumentContext(); state.selectedProductId = null; closeModal(); renderCheckout(); showToast('Venda cancelada.', 'success'); } catch (error) { showToast(error.message, 'error'); } }); } });
  }

  async function suspendCurrentSale() {
    if (!state.sale?.items?.length) return showToast('Adicione itens antes de suspender.', 'error');
    try { await api.suspendSale(state.sale.id); state.sale = null; clearCheckoutDocumentContext(); state.selectedProductId = null; state.suspendedSales = await api.sales('SUSPENDED', 30); renderCheckout(); if (isRouteActive('checkout')) showSuspendedModal(); } catch (error) { showToast(error.message, 'error'); }
  }

  function showSuspendedModal() {
    if (!isRouteActive('checkout')) return;
    openModal('Vendas suspensas', `<div class="suspended-list">${state.suspendedSales.map((sale) => `<div class="suspended-item"><div><strong>${escapeHtml(sale.saleNumber)}</strong><small>${sale.items.length} itens · ${ui.formatCents(sale.totalCents)}</small></div><button class="primary-button" data-resume="${sale.id}">Retomar</button></div>`).join('') || '<div class="empty-state">Nenhuma venda suspensa.</div>'}</div>`, { onMount(root) { root.querySelectorAll('[data-resume]').forEach((button) => button.addEventListener('click', async () => { try { clearCheckoutDocumentContext(); state.sale = await api.resumeSale(button.dataset.resume); state.discountPercent = state.sale.subtotalCents ? Number(((state.sale.discountCents / state.sale.subtotalCents) * 100).toFixed(2)) : 0; closeModal(); renderCheckout(); } catch (error) { showToast(error.message, 'error'); } })); } });
  }

  async function ensureCashOpen() {
    try { state.cashSession = await api.openCash(state.config.terminalId); } catch { state.cashSession = null; }
    if (state.cashSession) return true;
    return new Promise((resolve) => {
      openModal('Abrir caixa', `<p>É necessário abrir o caixa antes de finalizar a venda.</p><div class="field"><label>Fundo de caixa</label><input id="initial-cash" inputmode="decimal" value="0,00"></div><div class="modal-actions"><button class="secondary-button" id="cancel-open-cash">Cancelar</button><button class="primary-button" id="confirm-open-cash">Abrir caixa</button></div>`, { onMount(root) { root.querySelector('#cancel-open-cash').addEventListener('click', () => { closeModal(); resolve(false); }); root.querySelector('#confirm-open-cash').addEventListener('click', async () => { try { const result = await api.createCash({ terminalId: state.config.terminalId, initialCashCents: centsFromInput(root.querySelector('#initial-cash').value) }); state.cashSession = result.session; closeModal(); resolve(true); } catch (error) { showToast(error.message, 'error'); } }); } });
    });
  }

  function allowedPaymentMethodsForCurrentSale() {
    const policy=(state.sale?.items||[]).map(item=>item.configuration?.commercialPolicySnapshot).find(Boolean);
    const values=Array.isArray(policy?.allowedPaymentMethods)?policy.allowedPaymentMethods:null;
    if(api.webMode)return state.sale?.customerId?['CASH','PIX','DEBIT_CARD','CREDIT_CARD','STORE_CREDIT']:['CASH','PIX','DEBIT_CARD','CREDIT_CARD'];
    return values&&values.length?values:['CASH','PIX','DEBIT_CARD','CREDIT_CARD','STORE_CREDIT'];
  }

  let paymentFlowInFlight = false;
  async function openPaymentModal(preferredMethod = '') {
    if (paymentFlowInFlight || document.getElementById('confirm-payment')) return;
    if (!state.sale?.items?.length) return showToast('Adicione itens antes de finalizar.', 'error');
    paymentFlowInFlight = true;
    try {
      if (!(await ensureCashOpen())) return;
      if (!isRouteActive('checkout')) return;
      const allowed=allowedPaymentMethodsForCurrentSale();let method=preferredMethod ? ui.paymentMethodFromUi(preferredMethod) : allowed[0];if(!allowed.includes(method))method=allowed[0]; state.paymentDraft = [{ method, amountCents: state.sale.totalCents }]; renderPaymentModal();
    } finally {
      paymentFlowInFlight = false;
    }
  }

  function renderPaymentModal() {
    const paid = state.paymentDraft.reduce((sum, payment) => sum + payment.amountCents, 0); const remaining = Math.max((state.sale?.totalCents || 0) - paid, 0);
    openModal('Pagamento da venda', `<div class="total-row grand-total"><span>Total</span><strong>${ui.formatCents(state.sale.totalCents)}</strong></div><div class="payment-list">${state.paymentDraft.map((payment, index) => `<div class="payment-line"><strong>${escapeHtml(paymentLabel(payment.method))}</strong><span>${ui.formatCents(payment.amountCents)}</span><button class="danger-button" data-remove-payment="${index}" aria-label="Remover pagamento">×</button></div>`).join('')}</div><div class="total-row"><span>Restante</span><strong>${ui.formatCents(remaining)}</strong></div><div class="payment-add"><div class="field"><label>Forma</label><select id="new-payment-method">${allowedPaymentMethodsForCurrentSale().map(method=>`<option value="${method}">${escapeHtml(paymentLabel(method))}</option>`).join('')}</select></div><div class="field"><label>Valor</label><input id="new-payment-value" inputmode="decimal" value="${(remaining / 100).toFixed(2).replace('.', ',')}"></div><button class="secondary-button" id="add-payment">Adicionar</button></div><div class="modal-actions"><button class="secondary-button" data-close-modal>Voltar</button><button class="primary-button" id="confirm-payment">Concluir venda</button></div>`, { wide: true, onMount(root) { root.querySelectorAll('[data-remove-payment]').forEach((button) => button.addEventListener('click', () => { state.paymentDraft.splice(Number(button.dataset.removePayment), 1); renderPaymentModal(); })); root.querySelector('#add-payment').addEventListener('click', () => { const amountCents = centsFromInput(root.querySelector('#new-payment-value').value); if (amountCents <= 0) return showToast('Informe um valor maior que zero.', 'error'); state.paymentDraft.push({ method: root.querySelector('#new-payment-method').value, amountCents }); renderPaymentModal(); }); root.querySelector('#confirm-payment').addEventListener('click', completeCurrentSale); } });
  }

  function paymentLabel(method) { return ({ CASH: 'Dinheiro', PIX: 'PIX', DEBIT_CARD: 'Cartão débito', CREDIT_CARD: 'Cartão crédito', STORE_CREDIT: 'A prazo', OTHER: 'Outro' })[method] || method; }

  let saleCompletionInFlight = false;
  async function completeCurrentSale() {
    if (saleCompletionInFlight) return;
    saleCompletionInFlight = true;
    const confirmButton=document.getElementById('confirm-payment');
    if(confirmButton)confirmButton.disabled=true;
    try { const result = await api.completeSale(state.sale.id, state.paymentDraft); const completed = result.sale; closeModal(); state.sale = null; clearCheckoutDocumentContext(); state.selectedProductId = null; state.discountPercent = 0; state.paymentDraft = []; state.products = await api.products(); showToast(`Venda ${completed.saleNumber} finalizada. Troco: ${ui.formatCents(completed.changeCents)}`, 'success'); renderCheckout(); } catch (error) { showToast(error.message, 'error'); }
    finally { saleCompletionInFlight = false; if(confirmButton?.isConnected)confirmButton.disabled=false; }
  }

  function customersListHtml() {
    const query = ui.normalizeSearch(state.customerQuery);
    const customers = state.customers.filter((customer) => !query || ui.normalizeSearch(`${customer.name} ${customer.document || ''} ${customer.phone || ''}`).includes(query));
    return customers.map((customer) => `<div class="data-row"><div><strong>${escapeHtml(customer.name)}</strong><small>${escapeHtml(customer.document || 'Sem documento')}</small></div><div><small>Telefone</small><strong>${escapeHtml(customer.phone || '—')}</strong></div><div><small>Limite</small><strong>${ui.formatCents(customer.creditLimitCents)}</strong></div><button class="secondary-button" data-edit-customer="${customer.id}">Editar</button></div>`).join('') || '<div class="empty-state">Nenhum cliente cadastrado.</div>';
  }

  function bindCustomerRows(root = content) {
    root.querySelectorAll('[data-edit-customer]').forEach((button) => button.addEventListener('click', () => openCustomerForm(state.customers.find((customer) => customer.id === button.dataset.editCustomer))));
  }

  function renderCustomersList() {
    const list = document.getElementById('customers-list');
    if (!list) return;
    list.innerHTML = customersListHtml();
    bindCustomerRows(list);
    routeRegistry.updated('customers', { surface:'customers-list' });
  }

  function renderCustomers() {
    if (!isRouteActive('customers')) return;
    content.innerHTML = `<section class="page" data-customers-canonical="true"><header class="page-head"><div><h1>Clientes</h1><p>Cadastro, consulta e limite de crédito.</p></div><button class="primary-button" id="new-customer">+ Novo cliente</button></header><div class="toolbar"><label class="search-field">⌕<input id="customer-page-search" placeholder="Buscar por nome, CPF/CNPJ ou telefone" value="${escapeHtml(state.customerQuery)}"></label></div><div class="data-card" id="customers-list">${customersListHtml()}</div></section>`;
    document.getElementById('new-customer')?.addEventListener('click', () => openCustomerForm());
    document.getElementById('customer-page-search')?.addEventListener('input', (event) => { state.customerQuery = event.target.value; renderCustomersList(); });
    bindCustomerRows();
    routeRegistry.updated('customers', { surface:'customers' });
  }

  function openCustomerForm(customer = null) {
    openModal(customer ? 'Editar cliente' : 'Novo cliente', `<form id="customer-form"><div class="field-grid"><div class="field wide"><label>Nome completo *</label><input name="name" required value="${escapeHtml(customer?.name || '')}"></div><div class="field"><label>CPF / CNPJ</label><input name="document" value="${escapeHtml(customer?.document || '')}"></div><div class="field"><label>Telefone</label><input name="phone" value="${escapeHtml(customer?.phone || '')}"></div><div class="field"><label>E-mail</label><input name="email" type="email" value="${escapeHtml(customer?.email || '')}"></div><div class="field"><label>Limite de crédito</label><input name="creditLimit" inputmode="decimal" value="${((customer?.creditLimitCents || 0)/100).toFixed(2).replace('.', ',')}"></div><div class="field wide"><label>Observações</label><textarea name="notes" rows="3">${escapeHtml(customer?.notes || '')}</textarea></div><label class="field wide"><span><input name="active" type="checkbox" ${customer?.active === false ? '' : 'checked'}> Cliente ativo</span></label></div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button class="primary-button" type="submit">Salvar cliente</button></div></form>`, { onMount(root) { root.querySelector('#customer-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { const saved = await api.saveCustomer({ id: customer?.id, name: formValue(form,'name'), document: formValue(form,'document'), phone: formValue(form,'phone'), email: formValue(form,'email'), notes: formValue(form,'notes'), creditLimitCents: centsFromInput(formValue(form,'creditLimit')), creditUsedCents: customer?.creditUsedCents || 0, active: form.elements.namedItem('active').checked }); const index = state.customers.findIndex((item) => item.id === saved.id); if (index >= 0) state.customers[index] = saved; else state.customers.push(saved); state.customers.sort((a,b) => a.name.localeCompare(b.name, 'pt-BR')); closeModal(); renderCustomers(); showToast('Cliente salvo.', 'success'); } catch (error) { showToast(error.message, 'error'); } }); } });
  }

  function renderSellers() {
    if (!isRouteActive('sellers')) return;
    if (!window.PdvAccessPolicy?.hasCapability(state.user,'sellers.view')) return renderPermissionDenied('Equipe comercial');
    content.innerHTML = `<section class="page"><header class="page-head"><div><h1>Equipe e acessos</h1><p>Pessoas, funções, áreas permitidas e comissões em um único lugar.</p></div></header><div class="data-card"><div class="empty-state">Carregando equipe…</div></div></section>`;
  }

  function renderPermissionDenied(title) { content.innerHTML = `<section class="page"><header class="page-head"><div><h1>${escapeHtml(title)}</h1><p>Acesso restrito.</p></div></header><div class="data-card"><div class="empty-state">Seu perfil não possui permissão para gerenciar este cadastro.</div></div></section>`; }

  function productUsageLabel(usageType) {
    if (usageType === 'INGREDIENT') return 'Insumo';
    if (usageType === 'BOTH') return 'Produto e insumo';
    return 'Venda direta';
  }

  function productionDestinationMarkup() {
    return `<div class="field wide" data-production-destination data-available="loading"><label>Destino do pedido</label><select name="productionDestination" disabled><option value="">Carregando destinos…</option></select><small>Escolha “Sem KDS — garçom entrega” para itens prontos. Para itens preparados: Produção · enviar ao KDS selecionado.</small></div>`;
  }

  function productionDestinationLabel(productId) {
    const route=(state.productionRoutes||[]).find(item=>item.productId===productId);
    if(!route?.mode)return 'Destino: não configurado';
    if(route.mode==='DIRECT')return 'Destino: Sem KDS · garçom entrega';
    return `Destino: KDS · ${route.stationName||'setor indisponível'}`;
  }

  async function refreshProductionRoutes() {
    try { state.productionRoutes=await api.request('/api/v1/restaurant/kitchen/routing'); }
    catch { state.productionRoutes=[]; }
    return state.productionRoutes;
  }

  async function mountProductionDestination(root,product=null) {
    const host=root.querySelector('[data-production-destination]');
    if(!host)return null;
    const select=host.querySelector('[name="productionDestination"]');
    try {
      const [stations,route]=await Promise.all([
        api.request('/api/v1/restaurant/kitchen/stations'),
        product?.id?api.request(`/api/v1/restaurant/kitchen/routing/${encodeURIComponent(product.id)}`):Promise.resolve(null)
      ]);
      const activeStations=(Array.isArray(stations)?stations:[]).filter(station=>station.active!==false);
      const help=host.querySelector('[data-kds-warning]')||document.createElement('small');help.dataset.kdsWarning='true';help.textContent=activeStations.length?'':'Nenhum setor KDS ativo. Para usar produção, cadastre e ative um setor em Alimentação → Gestão → Setores de produção.';if(!help.isConnected)host.appendChild(help);
      select.innerHTML=`<option value="">Selecione o destino</option><option value="DIRECT">Sem KDS — garçom entrega</option>${activeStations.map(station=>`<option value="PRODUCTION:${escapeHtml(station.id)}">KDS · ${escapeHtml(station.name)}</option>`).join('')}`;
      const current=route?.mode==='DIRECT'?'DIRECT':route?.mode==='PRODUCTION'?`PRODUCTION:${route.stationId}`:'';
      if(current&&![...select.options].some(option=>option.value===current)&&route?.mode==='PRODUCTION'){
        const option=document.createElement('option');
        option.value=current;
        option.textContent=`KDS · ${route.stationName||'setor indisponível'} (inativo)`;
        select.appendChild(option);
      }
      select.value=current;
      select.disabled=false;
      host.dataset.available='true';
      host.hidden=root.querySelector('#product-usage-type')?.value==='INGREDIENT';
      return route||null;
    } catch {
      host.dataset.available='false';
      host.dataset.loadFailed='true';
      const error=host.querySelector('[data-kds-warning]')||document.createElement('small');
      error.dataset.kdsWarning='true';error.textContent='Não foi possível carregar os destinos. Verifique a conexão e reabra o cadastro antes de salvar.';
      if(!error.isConnected)host.appendChild(error);
      select.disabled=true;
      return null;
    }
  }

  async function requireProductionDestination(root) {
    if(root._productionDestinationReady)await root._productionDestinationReady;
    const host=root.querySelector('[data-production-destination]');
    if(!host)return null;
    if(host.dataset.loadFailed==='true'&&!['INGREDIENT'].includes(root.querySelector('#product-usage-type')?.value))throw new Error('Não foi possível carregar os destinos do pedido. Reabra o cadastro para tentar novamente.');
    if(host.hidden)return null;
    if(host.dataset.available!=='true')throw new Error('O destino do pedido ainda não está disponível. Aguarde carregar e tente novamente.');
    const value=String(host.querySelector('[name="productionDestination"]')?.value||'');
    if(!value)throw new Error('Defina o destino do pedido: um KDS ou “Sem KDS — garçom entrega”.');
    return value;
  }

  async function persistProductionDestination(root,productId) {
    const value=await requireProductionDestination(root);
    if(!value)return null;
    const direct=value==='DIRECT';
    const route=await api.request('/api/v1/restaurant/kitchen/routing',{method:'POST',body:{productId,mode:direct?'DIRECT':'PRODUCTION',stationId:direct?null:value.slice('PRODUCTION:'.length)}});
    const index=(state.productionRoutes||[]).findIndex(item=>item.productId===productId);
    if(index>=0)state.productionRoutes[index]=route;else state.productionRoutes.push(route);
    return route;
  }

  async function ensureMenuProductHasDestination(product) {
    if(!product?.id)return null;
    // A listagem de rotas inclui somente produtos já publicados no Cardápio.
    // Para novos itens, consultar a rota individual cadastrada no Estoque.
    const route=await api.request(`/api/v1/restaurant/kitchen/routing/${encodeURIComponent(product.id)}`);
    if(!route?.mode)return null;
    if(route.mode==='PRODUCTION'&&route.stationActive===false)return null;
    return route.mode;
  }

  async function openInventoryItem(productId) {
    let product=state.products.find(item=>item.id===productId);
    if(!product){
      try{
        state.products=await api.products(true);
        product=state.products.find(item=>item.id===productId);
      }catch{}
    }
    if(!product)return false;
    if(product.prepared){await openRecipeForm(product);return true;}
    openProductForm(product);
    return true;
  }

  function openInventoryConfigurationRequired(product) {
    if(!product)return;
    openModal('Configure o destino no Estoque', `<p><strong>${escapeHtml(product.name)}</strong> ainda não tem destino operacional.</p><p>Defina no cadastro do Estoque se o item é atendimento direto ou se deve seguir para um setor de Produção/KDS.</p><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Agora não</button><button type="button" class="primary-button" data-open-inventory-item>Abrir no Estoque</button></div>`, {onMount(root){
      root.querySelector('[data-open-inventory-item]')?.addEventListener('click',async()=>{
        closeModal();
        await window.PdvAppNavigation?.navigate?.('inventory');
        await window.PdvCatalogAdmin?.openInventoryItem?.(product.id);
      });
    }});
  }

  async function addMenuSourceProduct(product) {
    if(!product)return;
    try{
      const mode=await ensureMenuProductHasDestination(product);
      if(!mode){openInventoryConfigurationRequired(product);return;}
      const saved=await api.saveProduct({...product,menuEnabled:true});
      const index=state.products.findIndex(item=>item.id===saved.id);
      if(index>=0)state.products[index]=saved;else state.products.push(saved);
      closeModal();
      renderProducts();
      showToast('Item adicionado ao Cardápio.','success');
    }catch(error){showToast(error.message,'error');}
  }

  function recipeStatusMeta(product) {
    if (!product?.prepared) return null;
    if (product.recipeStockStatus === 'OUT') return { label:'Indisponível por insumo', detail:'Sem insumo suficiente para uma porção' };
    if (product.recipeStockStatus === 'LOW') return { label:'Insumo baixo', detail:`Até ${Number(product.recipeCapacity || 0)} porção(ões)` };
    return { label:'Insumos OK', detail:`Até ${Number(product.recipeCapacity || 0)} porção(ões)` };
  }

  function productsListHtml() {
    const products = ui.filterProducts(state.products.filter((product) => product.menuEnabled), state.productQuery, state.categoryId);
    return products.map((product) => { const status=recipeStatusMeta(product); const destination=productionDestinationLabel(product.id); const missingDestination=destination==='Destino: não configurado'; return `<div class="data-row"><div><strong>${escapeHtml(product.name)}</strong><small>${product.prepared?'Ficha técnica':productUsageLabel(product.usageType)} · ${escapeHtml(product.categoryName || 'Sem categoria')}</small><small data-production-destination="${product.id}">${escapeHtml(destination)}</small></div><div><small>Preço</small><strong>${ui.formatCents(product.salePriceCents)}</strong></div><div><small>${product.prepared?'Capacidade':'Estoque'}</small><strong>${product.prepared?escapeHtml(`Até ${countLabel(product.recipeCapacity||0,'porção','porções')}`):`${quantityLabel(product.stockQuantity)} ${escapeHtml(product.unit)}`}</strong>${product.prepared?'<small>Consumo pela ficha técnica</small>':''}</div><div class="menu-row-actions"><button class="secondary-button" data-product-photo-edit="${product.id}">${product.photo?'Trocar foto':'Adicionar foto'}</button>${product.photo?`<button class="secondary-button" data-product-photo-remove="${product.id}">Remover foto</button>`:''}${missingDestination?`<button class="secondary-button" data-product-inventory-route="${product.id}">Configurar no Estoque</button>`:''}<button class="secondary-button" data-edit-product="${product.id}">${product.prepared?'Ver ficha técnica':'Ver cadastro'}</button><button class="danger-button" data-remove-product="${product.id}">Retirar</button></div></div>`; }).join('') || '<div class="empty-state">Nenhum produto disponível para venda. Clique em “Novo item” para escolher um produto de venda direta ou uma Ficha Técnica.</div>';
  }

  function bindProductRows(root = content) {
    root.querySelectorAll('[data-product-photo-edit]').forEach(button=>button.addEventListener('click',()=>uploadProductPhoto(button.dataset.productPhotoEdit)));
    root.querySelectorAll('[data-product-photo-remove]').forEach(button=>button.addEventListener('click',()=>removeProductPhoto(button.dataset.productPhotoRemove)));
    root.querySelectorAll('[data-product-inventory-route]').forEach(button=>button.addEventListener('click',async()=>{await window.PdvAppNavigation?.navigate?.('inventory');await window.PdvCatalogAdmin?.openInventoryItem?.(button.dataset.productInventoryRoute);}));
    root.querySelectorAll('[data-edit-product]').forEach((button) => button.addEventListener('click', () => openMenuSourceDetails(state.products.find((product) => product.id === button.dataset.editProduct))));
    root.querySelectorAll('[data-remove-product]').forEach((button) => button.addEventListener('click', () => removeMenuItem(button.dataset.removeProduct)));
  }

  function renderProductsList() {
    const list = document.getElementById('products-list');
    if (!list) return;
    list.innerHTML = productsListHtml();
    bindProductRows(list);
    routeRegistry.updated('products', { surface:'products-list' });
  }

  function productPhotoSyncLabel() {
    const sync=state.photoSyncStatus||{};
    return sync.running?`Sincronizando · ${sync.pending||0} pendentes`:sync.failed?`${sync.failed} falha(s) · tentar novamente`:sync.lastCompletedAt?`Última sincronização ${new Date(sync.lastCompletedAt).toLocaleString('pt-BR')}`:'Fotos ainda não sincronizadas';
  }

  function updateProductPhotoSyncStatus() {
    if (!isRouteActive('products')) return;
    const label=content.querySelector('[data-products-canonical="true"] .toolbar small');
    if(label) label.textContent=productPhotoSyncLabel();
  }


  let inactiveWebProducts=[];
  let showInactiveWebProducts=false;
  function renderWebProducts(){
    const canManage=window.PdvAccessPolicy?.hasCapability(state.user,'products.manage');
    const canStock=window.PdvAccessPolicy?.hasCapability(state.user,'inventory.adjust');
    const catalogItems=showInactiveWebProducts?[...state.products,...inactiveWebProducts]:state.products;
    const listed=catalogItems.filter(p=>!state.productQuery||ui.normalizeSearch(p.name+' '+p.sku+' '+(p.barcode||'')+' '+(p.brand||'')+' '+(p.variantLabel||'')).includes(ui.normalizeSearch(state.productQuery)));
    content.innerHTML=`<section class="page web-products-page"><header class="page-head">
      <div><span class="web-section-kicker">CADASTRO CANÔNICO</span><h1>Produtos e estoque</h1>
      <p>Cadastre produtos e registre entradas. O saldo pertence ao histórico de movimentações.</p></div>
      ${canManage?'<button id="web-new-product" class="primary-button" type="button">+ Novo produto</button><button id="web-new-category" class="secondary-button" type="button">+ Categoria</button>':''}
      ${canManage?`<button id="web-toggle-inactive" class="secondary-button" type="button">${showInactiveWebProducts?'Ocultar inativos':'Mostrar inativos'}</button>`:''}</header>
      <div class="toolbar"><label class="search-field" for="web-product-search">⌕ <input id="web-product-search"
        placeholder="Buscar produto, SKU ou código de barras" aria-label="Buscar produtos" value="${escapeHtml(state.productQuery)}"></label></div>
      <div class="data-card web-product-table" id="web-products-list">
        ${listed.length?listed.map(p=>`<div class="data-row web-product-row">
          <div class="web-product-identity"><span class="web-product-monogram">${escapeHtml(initials(p.name))}</span>
          <div><strong>${escapeHtml(p.name)}</strong><small>${p.active===false?'Inativo · ':''}${escapeHtml(p.sku)}</small><small>${escapeHtml([p.brand,p.barcode,p.variantLabel].filter(Boolean).join(' · '))}</small></div></div>
          <div><small>Preço</small><strong>${ui.formatCents(p.salePriceCents)}</strong></div>
          <div><small>Disponível</small><strong>${p.trackStock?quantityLabel(p.available??p.balance):'Por componentes'}</strong></div>
          ${canManage?`<button type="button" class="secondary-button" data-web-edit="${escapeHtml(p.id)}">Editar</button>`:''}
          ${canManage&&!p.trackStock&&p.active!==false?`<button type="button" class="secondary-button" data-web-kit="${escapeHtml(p.id)}">Componentes do kit</button>`:''}
          ${canStock&&p.trackStock&&p.active!==false?`<button type="button" class="secondary-button" data-web-reserve="${escapeHtml(p.id)}">Reservar</button><button type="button" class="secondary-button" data-web-stock="${escapeHtml(p.id)}">Registrar entrada</button>
          <button type="button" class="secondary-button" data-web-adjust="${escapeHtml(p.id)}">Ajustar saldo</button>
          <button type="button" class="secondary-button" data-web-transfer="${escapeHtml(p.id)}">Transferir</button>`:''}
          ${p.trackStock?`<button type="button" class="secondary-button" data-web-moves="${escapeHtml(p.id)}">Movimentações</button>`:''}
        </div>`).join(''):'<div class="empty-state">Nenhum produto encontrado. Cadastre o primeiro produto para começar.</div>'}
      </div></section>`;
    content.querySelector('#web-new-product')?.addEventListener('click',openWebProductForm);
    content.querySelector('#web-new-category')?.addEventListener('click',openWebCategoryForm);
    content.querySelector('#web-toggle-inactive')?.addEventListener('click',async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{
        if(!showInactiveWebProducts){const all=await api.products(true);inactiveWebProducts=all.filter(product=>product.active===false);}
        showInactiveWebProducts=!showInactiveWebProducts;renderWebProducts();
      }catch(error){showToast(error.message,'error');button.disabled=false;}
    });
    content.querySelectorAll('[data-web-edit]').forEach(button=>button.addEventListener('click',()=>{
      const item=catalogItems.find(product=>product.id===button.dataset.webEdit);
      if(item)openWebEditProductForm(item);
    }));
    content.querySelector('#web-product-search')?.addEventListener('input',e=>{
      state.productQuery=e.target.value;
      const focused=document.activeElement===e.target,caret=e.target.selectionStart;
      renderWebProducts();
      if(focused){const el=content.querySelector('#web-product-search');el.focus({preventScroll:true});el.setSelectionRange(caret,caret);}
    });
    content.querySelectorAll('[data-web-kit]').forEach(b=>b.addEventListener('click',()=>{const p=state.products.find(p=>p.id===b.dataset.webKit);if(p)void openWebKitForm(p);}));
    content.querySelectorAll('[data-web-reserve]').forEach(b=>b.addEventListener('click',()=>{const p=state.products.find(p=>p.id===b.dataset.webReserve);if(p)void openWebReserveForm(p);}));
    content.querySelectorAll('[data-web-stock]').forEach(b=>b.addEventListener('click',()=>{
      const product=state.products.find(p=>p.id===b.dataset.webStock);
      if(product)openWebStockForm(product);
    }));
    content.querySelectorAll('[data-web-adjust]').forEach(button=>button.addEventListener('click',()=>{
      const product=state.products.find(p=>p.id===button.dataset.webAdjust);
      if(product)openWebStockAdjustment(product);
    }));
    content.querySelectorAll('[data-web-transfer]').forEach(button=>button.addEventListener('click',async()=>{
      const item=state.products.find(product=>product.id===button.dataset.webTransfer);
      if(!item)return;
      button.disabled=true;
      try{await openWebStockTransfer(item);}catch(error){showToast(error.message,'error');}
      finally{button.disabled=false;}
    }));
    content.querySelectorAll('[data-web-moves]').forEach(button=>button.addEventListener('click',async()=>{
      const product=state.products.find(p=>p.id===button.dataset.webMoves);
      if(!product)return;
      button.disabled=true;
      try{await openWebInventoryHistory(product);}catch(error){showToast(error.message,'error');}
      finally{button.disabled=false;}
    }));
    routeRegistry.updated('products',{surface:'products'});
  }

  function openWebProductForm(){
    openModal('Novo produto',`<form id="web-product-form">
      <div class="field"><label for="web-product-name">Nome do produto</label><input id="web-product-name" name="name" required minlength="2" maxlength="120" autocomplete="off" placeholder="Ex.: Café tradicional"></div>
      <div class="field-grid"><div class="field"><label for="web-product-sku">SKU / código</label><input id="web-product-sku" name="sku" required maxlength="64" pattern="[A-Za-z0-9][A-Za-z0-9._\\-]*" placeholder="Ex.: CAFE-001"></div>
      <div class="field"><label for="web-product-price">Preço de venda (R$)</label><input id="web-product-price" name="price" inputmode="decimal" required placeholder="0,00"></div></div>
      <label class="web-checkbox"><input name="track" type="checkbox" checked> Controlar saldo no estoque</label>
      <p class="web-form-feedback" role="status" aria-live="polite"></p>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancelar</button>
      <button class="primary-button" type="submit">Salvar produto</button></div>
    </form>`,{onMount(root){
      const form=root.querySelector('#web-product-form');
      form.addEventListener('submit',async e=>{
        e.preventDefault();if(form.dataset.pending==='true')return;
        const button=form.querySelector('[type=submit]'),status=form.querySelector('.web-form-feedback');
        form.dataset.pending='true';button.disabled=true;button.textContent='Salvando…';
        try{
          if(!form.dataset.operationKey)form.dataset.operationKey=api.mutationId();
          const product=await api.saveProduct({name:form.elements.name.value.trim(),sku:form.elements.sku.value.trim().toUpperCase(),
            salePriceCents:centsFromInput(form.elements.price.value),trackStock:form.elements.track.checked},form.dataset.operationKey);
          state.products=await api.products();
          closeModal();renderWebProducts();showToast('Produto '+product.name+' cadastrado.','success');
        }catch(error){status.textContent=error.message;}
        finally{form.dataset.pending='false';button.disabled=false;button.textContent='Salvar produto';}
      });
    }});
  }


  function openWebEditProductForm(product){
    const price=(Number(product.salePriceCents||0)/100).toFixed(2).replace('.',',');
    const unitOptions=['UN','KG','G','L','M','M2','M3','CX','PCT'];
    openModal('Editar produto',`<form id="web-edit-product-form">
      <div class="field"><label for="web-edit-product-name">Nome do produto</label><input id="web-edit-product-name" name="name" required minlength="2" maxlength="120" value="${escapeHtml(product.name)}"></div>
      <div class="field-grid"><div class="field"><label for="web-edit-product-sku">SKU</label><input id="web-edit-product-sku" name="sku" required maxlength="64" value="${escapeHtml(product.sku)}"></div>
      <div class="field"><label for="web-edit-product-price">Preço de venda (R$)</label><input id="web-edit-product-price" name="price" required inputmode="decimal" value="${escapeHtml(price)}"></div></div>
      <div class="field"><label for="web-edit-product-unit">Unidade</label><select id="web-edit-product-unit" name="unit">${unitOptions.map(unit=>`<option value="${unit}" ${unit===product.unit?'selected':''}>${unit}</option>`).join('')}</select></div>
      <label class="web-checkbox"><input type="checkbox" name="active" ${product.active!==false?'checked':''}> Produto ativo (desativar preserva vendas e estoque histórico)</label>
      <p class="web-form-feedback" role="status" aria-live="polite"></p>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancelar</button><button class="primary-button" type="submit">Salvar alterações</button></div>
    </form>`,{onMount(root){
      const form=root.querySelector('#web-edit-product-form');
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(form.dataset.pending==='true')return;
        const button=form.querySelector('[type=submit]'),status=form.querySelector('.web-form-feedback');
        form.dataset.pending='true';button.disabled=true;
        try{
          if(!form.dataset.operationKey)form.dataset.operationKey=api.mutationId();
          const result=await api.updateProduct(product.id,{
            name:form.elements.name.value.trim(),sku:form.elements.sku.value.trim().toUpperCase(),
            salePriceCents:centsFromInput(form.elements.price.value),unit:form.elements.unit.value,
            active:form.elements.active.checked
          },form.dataset.operationKey);
          state.products=await api.products();
          if(showInactiveWebProducts){const all=await api.products(true);inactiveWebProducts=all.filter(item=>item.active===false);}
          closeModal();renderWebProducts();
          showToast(result.active?'Produto atualizado.':'Produto desativado sem apagar vendas e estoque.','success');
        }catch(error){status.textContent=error.message;}
        finally{form.dataset.pending='false';button.disabled=false;}
      });
    }});
  }

  function openWebStockForm(product){
    openModal('Registrar entrada no estoque',`<form id="web-stock-form">
      <p>Produto: <strong>${escapeHtml(product.name)}</strong> · Saldo atual: ${quantityLabel(product.balance)}</p>
      <div class="field"><label for="web-stock-qty">Quantidade recebida</label>
      <input id="web-stock-qty" name="quantity" type="number" min="0.001" step="0.001" required placeholder="0"></div>
      <p class="web-form-feedback" role="status" aria-live="polite"></p>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancelar</button>
      <button class="primary-button" type="submit">Registrar entrada</button></div></form>`,{onMount(root){
      const form=root.querySelector('#web-stock-form');
      form.addEventListener('submit',async e=>{
        e.preventDefault();if(form.dataset.pending==='true')return;
        const button=form.querySelector('[type=submit]'),status=form.querySelector('.web-form-feedback');
        form.dataset.pending='true';button.disabled=true;button.textContent='Registrando…';
        try{
          if(!form.dataset.operationKey)form.dataset.operationKey=api.mutationId();
          await api.request('/api/v1/inventory/movements',{method:'POST',mutationId:form.dataset.operationKey,body:{
            productId:product.id,quantity:Number(form.elements.quantity.value),type:'purchase'
          }});
          state.products=await api.products();
          closeModal();renderWebProducts();showToast('Entrada de estoque registrada para '+product.name+'.','success');
        }catch(error){status.textContent=error.message;}
        finally{form.dataset.pending='false';button.disabled=false;button.textContent='Registrar entrada';}
      });
    }});
  }

  function openWebStockAdjustment(product){
    openModal('Ajustar estoque',`<form id="web-adjust-form">
      <p>Produto: <strong>${escapeHtml(product.name)}</strong> · Saldo atual: ${quantityLabel(product.balance)}</p>
      <div class="field"><label for="web-adjust-qty">Variação no saldo (+ entrada / − saída)</label>
      <input id="web-adjust-qty" name="quantityDelta" type="number" step="0.001" required placeholder="Ex.: -1 ou 2.5"></div>
      <div class="field"><label for="web-adjust-reason">Justificativa obrigatória</label>
      <textarea id="web-adjust-reason" name="reason" rows="3" minlength="3" maxlength="240" required placeholder="Ex.: perda identificada na contagem"></textarea></div>
      <p class="web-form-feedback" role="status" aria-live="polite"></p>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancelar</button>
      <button class="primary-button" type="submit">Registrar ajuste</button></div></form>`,{onMount(root){
      const form=root.querySelector('#web-adjust-form');
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(form.dataset.pending==='true')return;
        if(!form.dataset.operationKey)form.dataset.operationKey=api.mutationId();
        const button=form.querySelector('[type=submit]'),feedback=form.querySelector('[role=status]');
        button.disabled=true;form.dataset.pending='true';
        try{
          await api.request('/api/v1/inventory/adjustments',{method:'POST',
            mutationId:form.dataset.operationKey,body:{
              productId:product.id,quantityDelta:Number(form.elements.quantityDelta.value),
              reason:form.elements.reason.value.trim()
            }});
          state.products=await api.products();
          closeModal();renderWebProducts();showToast('Ajuste registrado no histórico de estoque.','success');
        }catch(error){feedback.textContent=error.message;}
        finally{button.disabled=false;form.dataset.pending='false';}
      });
    }});
  }


  async function openWebStockTransfer(product){
    const data=await api.tenantBranches();
    const targets=(data.branches||[]).filter(branch=>branch.id!==api.branchId&&branch.active!==false);
    if(!targets.length){showToast('Cadastre uma segunda filial ativa antes de transferir estoque.','error');return;}
    openModal('Transferir estoque entre filiais',`<form id="web-stock-transfer-form">
      <p>Origem: <strong>${escapeHtml(product.name)}</strong> · Disponível: ${quantityLabel(product.balance)}</p>
      <div class="field"><label for="web-transfer-to">Filial de destino</label>
      <select id="web-transfer-to" name="toBranchId" required>${targets.map(branch=>`<option value="${escapeHtml(branch.id)}">${escapeHtml(branch.name||branch.code||branch.id)}</option>`).join('')}</select></div>
      <div class="field"><label for="web-transfer-qty">Quantidade</label><input id="web-transfer-qty" name="quantity" type="number" min="0.001" max="${Number(product.balance)}" step="0.001" required></div>
      <div class="field"><label for="web-transfer-reason">Justificativa</label><textarea id="web-transfer-reason" name="reason" rows="3" minlength="3" maxlength="240" required></textarea></div>
      <p class="web-form-feedback" role="status" aria-live="polite"></p>
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Cancelar</button><button class="primary-button" type="submit">Confirmar transferência</button></div>
    </form>`,{onMount(root){
      const form=root.querySelector('#web-stock-transfer-form');
      form.addEventListener('submit',async event=>{
        event.preventDefault();if(form.dataset.pending==='true')return;
        const button=form.querySelector('[type=submit]'),feedback=form.querySelector('[role=status]');
        button.disabled=true;form.dataset.pending='true';
        try{
          if(!form.dataset.operationKey)form.dataset.operationKey=api.mutationId();
          await api.transferStock({
            productId:product.id,toBranchId:form.elements.toBranchId.value,
            quantity:Number(form.elements.quantity.value),reason:form.elements.reason.value.trim()
          },form.dataset.operationKey);
          state.products=await api.products();
          closeModal();renderWebProducts();
          showToast('Transferência registrada em ambas as filiais.','success');
        }catch(error){feedback.textContent=error.message;}
        finally{button.disabled=false;form.dataset.pending='false';}
      });
    }});
  }

  async function openWebInventoryHistory(product){
    const result=await api.request('/api/v1/inventory/movements'+api.params({
      productId:product.id,limit:50
    }));
    const rows=result.items||[];
    const named={opening:'Saldo inicial',purchase:'Entrada',adjustment:'Ajuste',
      sale:'Venda',return:'Devolução'};
    const formatDate=value=>value?new Date(value).toLocaleString('pt-BR'):'—';
    openModal('Histórico de estoque — '+product.name,`<div class="web-stock-history">
      <p>Movimentações imutáveis deste produto na filial atual.</p>
      <div class="ops-table-wrap"><table class="ops-table"><thead>
        <tr><th>Quando</th><th>Operação</th><th>Variação</th><th>Motivo</th></tr>
      </thead><tbody>${rows.length?rows.map(row=>`<tr>
        <td>${escapeHtml(formatDate(row.occurredAt))}</td>
        <td>${escapeHtml(named[row.type]||row.type)}</td>
        <td>${row.quantityDelta>0?'+':''}${quantityLabel(row.quantityDelta)}</td>
        <td>${escapeHtml(row.reason||'—')}</td></tr>`).join(''):
        '<tr><td colspan="4">Nenhuma movimentação registrada.</td></tr>'}
      </tbody></table></div>${result.total>rows.length?`<p class="web-history-note">Exibindo as primeiras ${rows.length} de ${result.total} movimentações.</p>`:''}
      <div class="modal-actions"><button class="secondary-button" type="button" data-close-modal>Fechar</button></div>
    </div>`);
  }

  function renderProducts() {
    if (!isRouteActive('products')) return;
    if(api.webMode)return renderWebProducts();
    const syncLabel=productPhotoSyncLabel();
    void refreshProductionRoutes().then(()=>{if(isRouteActive('products'))renderProductsList();});
    content.innerHTML = `<section class="page" data-products-canonical="true"><header class="page-head"><div><h1>Cardápio</h1><p>Itens disponíveis para venda, preços e categorias. Produtos e fichas são cadastrados no Estoque.</p></div><div class="menu-head-actions"><details class="products-secondary-actions" data-products-secondary-actions><summary class="secondary-button">Mais ações</summary><div class="products-secondary-actions-menu" data-products-secondary-actions-menu><button class="products-secondary-action" id="sync-product-photos" type="button">↻ Sincronizar fotos</button><button class="products-secondary-action" id="new-category" type="button">+ Categoria</button></div></details><button class="primary-button" id="new-product">+ Adicionar ao Cardápio</button></div></header><div class="toolbar"><label class="search-field">⌕<input id="product-page-search" placeholder="Buscar produtos" value="${escapeHtml(state.productQuery)}"></label><select id="product-category-filter" class="secondary-button"><option value="">Todas categorias</option>${state.categories.map((category) => `<option value="${category.id}" ${state.categoryId === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select><small>${escapeHtml(syncLabel)}</small></div><div class="data-card" id="products-list">${productsListHtml()}</div></section>`;
    document.getElementById('new-product')?.addEventListener('click', openMenuItemSelector);
    document.getElementById('new-category')?.addEventListener('click', openCategoryForm);
    document.getElementById('product-page-search')?.addEventListener('input', (event) => { state.productQuery = event.target.value; renderProductsList(); });
    document.getElementById('product-category-filter')?.addEventListener('change', (event) => { state.categoryId = event.target.value; renderProductsList(); });
    document.getElementById('sync-product-photos')?.addEventListener('click',()=>syncProductPhotos(true));
    bindProductRows();
    routeRegistry.updated('products', { surface:'products' });
  }
  function openMenuItemSelector() {
    openModal('Adicionar item ao Cardápio', '<div id="menu-source-picker"><div class="empty-state">Carregando produtos de venda direta e Fichas Técnicas…</div></div>', { wide:true, onMount(root){ void hydrateMenuSourcePicker(root); } });
  }

  async function hydrateMenuSourcePicker(root) {
    const host=root.querySelector('#menu-source-picker');if(!host)return;
    try {
      const products=await api.products(true);
      const rows=await Promise.all(products.map(async product=>({product,recipe:await api.recipe(product.id).catch(()=>null)})));
      const candidates=rows.filter(({product,recipe})=>product.active&&(recipe||(product.trackStock&&['DIRECT','BOTH'].includes(product.usageType))));
      const renderGroup=(title,items,kind,id)=>`<section class="menu-source-group" aria-labelledby="${id}"><header class="menu-source-group-head"><h3 id="${id}">${title}</h3><span>${countLabel(items.length,'item','itens')}</span></header>${items.length?items.map(({product,recipe})=>`<button type="button" class="menu-source-row" data-add-menu-source="${escapeHtml(product.id)}" ${product.menuEnabled?'disabled':''}><span class="menu-source-copy"><strong>${escapeHtml(product.name)}</strong><small>${kind==='recipe'?`Ficha técnica · ${countLabel(recipe.components.length,'insumo','insumos')} · custo/porção ${ui.formatCents(recipe.costPerPortionCents||0)}`:`${productUsageLabel(product.usageType)} · estoque ${quantityLabel(product.stockQuantity)} ${escapeHtml(product.unit)}`}</small></span><span class="menu-source-action">${product.menuEnabled?'No Cardápio':'Adicionar'}</span></button>`).join(''):'<div class="empty-state">Nenhum item disponível.</div>'}</section>`;
      const stock=candidates.filter(item=>!item.recipe&&item.product.trackStock&&['DIRECT','BOTH'].includes(item.product.usageType));
      const recipes=candidates.filter(item=>item.recipe);
      const hiddenIngredients=rows.filter(({product,recipe})=>product.active&&!recipe&&product.usageType==='INGREDIENT').length;
      host.innerHTML=`<p class="menu-source-help">Escolha o que será vendido. Produtos de venda direta e Fichas Técnicas podem entrar no Cardápio.</p><div class="field"><label for="menu-source-search">Buscar</label><input id="menu-source-search" placeholder="Nome, SKU ou código de barras"></div>${hiddenIngredients?'<p class="menu-source-note">Insumos usados apenas em fichas técnicas permanecem no Estoque e não aparecem nesta seleção.</p>':''}<div id="menu-source-groups">${renderGroup('Produtos para venda direta',stock,'stock','menu-stock-title')}${renderGroup('Fichas Técnicas',recipes,'recipe','menu-recipe-title')}</div>`;
      host.querySelector('#menu-source-search')?.addEventListener('input',event=>{const term=String(event.target.value||'').toLowerCase();host.querySelectorAll('[data-add-menu-source]').forEach(button=>button.hidden=Boolean(term)&&!button.textContent.toLowerCase().includes(term));});
      host.querySelectorAll('[data-add-menu-source]').forEach(button=>button.addEventListener('click',()=>{const product=products.find(item=>item.id===button.dataset.addMenuSource);if(product)void addMenuSourceProduct(product);}));
    } catch(error) { host.innerHTML=`<div class="empty-state">Não foi possível carregar as origens do Cardápio: ${escapeHtml(error.message)}</div>`; }
  }
  async function openMenuSourceDetails(product) {
    if(!product)return;
    const recipe=await api.recipe(product.id).catch(()=>null);
    if(recipe){
      const cmv=product.salePriceCents>0?(Number(recipe.costPerPortionCents||0)/product.salePriceCents)*100:0;
      const status=recipeStatusMeta(product);
      const statusKey=String(product.recipeStockStatus||'OK').toLowerCase();
      openModal('Origem do item · Ficha Técnica', `<div class="recipe-origin-intro"><div><strong>${escapeHtml(product.name)}</strong><small>Produto preparado · ficha interna</small></div><span class="recipe-origin-status ${escapeHtml(statusKey)}">${escapeHtml(status?.label||'Ficha técnica')}</span></div><section class="recipe-origin-section"><h3>Resumo de produção</h3><div class="recipe-summary-grid recipe-origin-summary"><article><small>Rendimento</small><strong>${quantityLabel(recipe.yieldQuantity)} ${escapeHtml(recipe.yieldUnit||'UN')}</strong></article><article><small>Porção</small><strong>${quantityLabel(recipe.portionQuantity)} ${escapeHtml(recipe.yieldUnit||'UN')}</strong></article><article><small>Custo / porção</small><strong>${ui.formatCents(recipe.costPerPortionCents||0)}</strong></article><article><small>CMV</small><strong>${cmv.toFixed(1)}%</strong></article><article><small>Capacidade atual</small><strong>Até ${countLabel(product.recipeCapacity||0,'porção','porções')}</strong></article><article><small>Tempo de preparo</small><strong>${Number(recipe.prepTimeMinutes||0)} min</strong></article></div></section><section class="recipe-origin-section"><div class="recipe-origin-section-head"><h3>Insumos da receita</h3><small>${countLabel(recipe.components.length,'insumo','insumos')}</small></div><div class="data-card recipe-detail-components">${recipe.components.map(item=>{const componentCost=Math.round(Number(item.costCents||0)*Number(item.quantity||0)*Number(item.conversionFactor||1)*(1+Number(item.lossPercent||0)/100));return `<div class="data-row"><span><strong>${escapeHtml(item.productName)}</strong><small>Perda ${Number(item.lossPercent||0).toFixed(1)}% · fator ${Number(item.conversionFactor||1).toFixed(3)}</small></span><span><small>Quantidade da receita</small><strong>${quantityLabel(item.quantity)} ${escapeHtml(item.unit||'UN')}</strong></span><span><small>Custo na receita</small><strong>${ui.formatCents(componentCost)}</strong></span></div>`;}).join('')}</div></section>${recipe.preparationNotes?`<section class="recipe-origin-section"><h3>Modo de preparo</h3><div class="recipe-notes"><p>${escapeHtml(recipe.preparationNotes)}</p></div></section>`:''}<p class="recipe-origin-footnote">A ficha técnica nunca é exibida ao cliente. O Cardápio usa apenas nome, descrição, preço e opções de venda.</p><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Fechar</button><button type="button" class="primary-button" id="edit-menu-source">Editar ficha no Estoque</button></div>`, { wide:true, onMount(root){root.querySelector('#edit-menu-source')?.addEventListener('click',()=>{closeModal();void openRecipeForm(product);});} });
      return;
    }
    openModal('Origem do item · Estoque', `<p><strong>${escapeHtml(product.name)}</strong> vem diretamente do Estoque.</p><div class="data-card"><div class="data-row"><span>Tipo de cadastro</span><strong>${escapeHtml(productUsageLabel(product.usageType))}</strong></div><div class="data-row"><span>Saldo</span><strong>${quantityLabel(product.stockQuantity)} ${escapeHtml(product.unit)}</strong></div><div class="data-row"><span>Preço de venda</span><strong>${ui.formatCents(product.salePriceCents)}</strong></div></div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Fechar</button><button type="button" class="primary-button" id="edit-menu-source">Editar no Estoque</button></div>`, { onMount(root){root.querySelector('#edit-menu-source')?.addEventListener('click',()=>{closeModal();openProductForm(product);});} });
  }

  async function removeMenuItem(productId) {
    const product=state.products.find(item=>item.id===productId);if(!product)return;
    try{const saved=await api.saveProduct({...product,menuEnabled:false});const index=state.products.findIndex(item=>item.id===saved.id);if(index>=0)state.products[index]=saved;renderProducts();showToast('Item retirado do Cardápio. O cadastro do Estoque foi preservado.','success');}catch(error){showToast(error.message,'error');}
  }

  async function removeCatalogProduct(productId){
  const product=state.products.find(item=>item.id===productId);
  if(!product)return;
  openModal('Inativar produto do Estoque', `<p>Inativar <strong>${escapeHtml(product.name)}</strong>?</p><p>O cadastro será preservado no histórico e também sairá do Cardápio.</p><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="button" class="danger-button" id="confirm-remove-product">Excluir produto</button></div>`, { onMount(root) {
    root.querySelector('#confirm-remove-product')?.addEventListener('click',async()=>{
      try{
        await api.removeProduct(productId);
        state.products=state.products.filter(item=>item.id!==productId);
        closeModal();
        renderProducts();
        showToast('Produto excluído do catálogo. Histórico preservado.','success');
      }catch(error){showToast(error.message,'error');}
    });
  } });
}

function monitorProductPhotoSync(){setTimeout(async()=>{try{state.photoSyncStatus=await api.productPhotoSyncStatus();if(isRouteActive('products'))updateProductPhotoSyncStatus();if(isRouteActive('checkout'))hydrateProductPhotos();if(state.photoSyncStatus.running)monitorProductPhotoSync();}catch{}},1000);}
  async function syncProductPhotos(force=false){try{state.photoSyncStatus=await api.syncProductPhotos(force);updateProductPhotoSyncStatus();showToast('Sincronização de fotos iniciada em segundo plano.','success');monitorProductPhotoSync();}catch(error){showToast(error.message,'error');}}
  async function uploadProductPhoto(productId){try{const saved=await api.uploadProductPhoto(productId);if(!saved)return;state.products=await api.products();renderProducts();showToast('Foto e miniatura salvas no computador principal.','success');}catch(error){showToast(error.message,'error');}}
  async function removeProductPhoto(productId){
  openModal('Remover foto do produto', `<p>Remover a foto deste produto?</p><p>O arquivo ficará protegido por 30 dias.</p><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="button" class="danger-button" id="confirm-remove-product-photo">Remover foto</button></div>`, { onMount(root) {
    root.querySelector('#confirm-remove-product-photo')?.addEventListener('click',async()=>{
      try{
        await api.removeProductPhoto(productId);
        state.products=await api.products();
        closeModal();
        renderProducts();
        showToast('Foto removida com período de segurança de 30 dias.','success');
      }catch(error){showToast(error.message,'error');}
    });
  } });
}

function openCategoryForm() {
    openModal('Nova categoria', `<form id="category-form"><div class="field"><label>Nome *</label><input name="name" required></div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button class="primary-button" type="submit">Salvar categoria</button></div></form>`, { onMount(root) { root.querySelector('#category-form').addEventListener('submit', async (event) => { event.preventDefault(); try { const saved = await api.saveCategory({ name: formValue(event.currentTarget,'name') }); state.categories.push(saved); state.categories.sort((a,b) => a.name.localeCompare(b.name,'pt-BR')); closeModal(); renderProducts(); showToast('Categoria criada.', 'success'); } catch (error) { showToast(error.message, 'error'); } }); } });
  }

  function quantityPricingMarkup() {
    return `<section class="recipe-section" data-quantity-pricing><div class="recipe-section-head"><div><h3>Preço por quantidade</h3><p>Regra comercial do produto. O Balcão e os pedidos de Atacado aplicam automaticamente a maior faixa atingida.</p></div><button type="button" class="secondary-button" data-quantity-tier-add>+ Adicionar faixa</button></div><div data-quantity-pricing-status class="ops-muted">Carregando regras…</div><div data-quantity-tier-rows></div></section>`;
  }

  async function mountQuantityPricingEditor(root, product=null) {
    const section=root.querySelector('[data-quantity-pricing]');if(!section)return;
    const status=section.querySelector('[data-quantity-pricing-status]');const host=section.querySelector('[data-quantity-tier-rows]');const add=section.querySelector('[data-quantity-tier-add]');
    section._quantityRows=[];section._removedQuantityTierIds=[];
    let enabled=false;
    try{const catalog=await api.modules();enabled=Boolean(catalog.find(module=>module.id==='WHOLESALE')?.enabled);}catch{}
    section.dataset.enabled=enabled?'true':'false';
    if(!enabled){status.textContent='Ative Atacado em Configurações → Áreas para usar preço por quantidade.';add.disabled=true;host.innerHTML='';return;}
    if(product?.id){try{section._quantityRows=(await api.wholesaleTiers(product.id)).map(row=>({id:row.id,minQuantity:Number(row.minQuantity),unitPriceCents:Number(row.unitPriceCents)}));}catch(error){status.textContent=error.message;}}
    const render=()=>{
      const rows=section._quantityRows||[];
      status.textContent=rows.length?'A quantidade da venda escolhe a faixa automaticamente. Sem faixa aplicável, usa o preço normal.':'Sem faixas: será usado o preço normal.';
      host.innerHTML=rows.map((row,index)=>`<div class="field-grid" data-quantity-tier-row="${index}"><div class="field"><label>A partir de</label><input data-tier-min type="number" min="0.001" step="0.001" value="${Number(row.minQuantity||1)}" required></div><div class="field"><label>Preço unitário</label><input data-tier-price inputmode="decimal" value="${(Number(row.unitPriceCents||0)/100).toFixed(2).replace('.',',')}" required></div><div class="field"><label>Regra</label><small>Aplicada automaticamente ao atingir esta quantidade.</small><button type="button" class="danger-button" data-tier-remove>Remover faixa</button></div></div>`).join('');
      host.querySelectorAll('[data-quantity-tier-row]').forEach((node,index)=>{
        node.querySelector('[data-tier-min]')?.addEventListener('input',()=>{section._quantityRows[index].minQuantity=Number(node.querySelector('[data-tier-min]').value||0);});
        node.querySelector('[data-tier-price]')?.addEventListener('input',()=>{section._quantityRows[index].unitPriceCents=centsFromInput(node.querySelector('[data-tier-price]').value||'0');});
        node.querySelector('[data-tier-remove]')?.addEventListener('click',()=>{const removed=section._quantityRows[index];if(removed?.id)section._removedQuantityTierIds.push(removed.id);section._quantityRows.splice(index,1);render();});
      });
    };
    add.addEventListener('click',()=>{section._quantityRows.push({id:null,minQuantity:1,unitPriceCents:0});render();});
    render();
  }

  async function persistQuantityPricingEditor(root,productId) {
    const section=root.querySelector('[data-quantity-pricing]');if(!section||section.dataset.enabled!=='true')return;
    const rows=section._quantityRows||[];const thresholds=new Set();
    for(const row of rows){
      const minQuantity=Number(row.minQuantity);const unitPriceCents=Number(row.unitPriceCents);
      if(!Number.isFinite(minQuantity)||minQuantity<=0)throw new Error('Cada faixa precisa de uma quantidade mínima maior que zero.');
      const key=String(Number(minQuantity.toFixed(3)));if(thresholds.has(key))throw new Error('Existem duas faixas com a mesma quantidade mínima.');thresholds.add(key);
      if(!Number.isInteger(unitPriceCents)||unitPriceCents<0)throw new Error('Informe um preço válido em cada faixa.');
    }
    for(const id of new Set(section._removedQuantityTierIds||[]))await api.deactivateWholesaleTier(id);
    for(const row of rows)await api.saveWholesaleTier({id:row.id||undefined,productId,minQuantity:Number(row.minQuantity),unitPriceCents:Number(row.unitPriceCents)});
  }

  function openProductForm(product = null) {
    openModal(product ? 'Editar produto/insumo do Estoque' : 'Novo produto/insumo do Estoque', `<form id="product-form"><div class="field-grid"><div class="field wide"><label>Nome *</label><input name="name" required value="${escapeHtml(product?.name || '')}"></div><div class="field"><label>Tipo de cadastro *</label><select name="usageType" id="product-usage-type" required><option value="INGREDIENT" ${product?.usageType==='INGREDIENT'?'selected':''}>Insumo</option><option value="DIRECT" ${(!product?.usageType||product?.usageType==='DIRECT')?'selected':''}>Venda direta</option><option value="BOTH" ${product?.usageType==='BOTH'?'selected':''}>Produto e insumo</option></select><small>Insumo não aparece como opção no Cardápio. “Produto e insumo” pode ser vendido e usado em fichas.</small></div><div class="field"><label>SKU / código interno</label><input name="sku" value="${escapeHtml(product?.sku || '')}"></div><div class="field"><label>Código de barras</label><input name="barcode" value="${escapeHtml(product?.barcode || '')}"></div><div class="field"><label>Categoria</label><select name="categoryId"><option value="">Sem categoria</option>${state.categories.map((category) => `<option value="${category.id}" ${product?.categoryId === category.id ? 'selected' : ''}>${escapeHtml(category.name)}</option>`).join('')}</select></div><div class="field"><label>Unidade</label><select name="unit"><option value="UN" ${product?.unit === 'UN' ? 'selected' : ''}>UN</option><option value="KG" ${product?.unit === 'KG' ? 'selected' : ''}>KG · vendido por peso</option><option value="G" ${product?.unit === 'G' ? 'selected' : ''}>G · vendido por peso</option><option value="LT" ${product?.unit === 'LT' ? 'selected' : ''}>LT</option><option value="CX" ${product?.unit === 'CX' ? 'selected' : ''}>CX</option></select><small>KG e G usam o fluxo padrão de peso no Balcão; balança é opcional.</small></div><div class="field" data-product-sale-only><label>Preço de venda</label><input id="product-price" name="salePrice" inputmode="decimal" value="${((product?.salePriceCents || 0)/100).toFixed(2).replace('.', ',')}"></div><div class="field"><label>Custo de referência</label><input id="product-cost" name="cost" inputmode="decimal" value="${((product?.costCents || 0)/100).toFixed(2).replace('.', ',')}"></div><div class="field" data-product-sale-only><label>Margem</label><input id="product-margin" readonly value="${ui.calculateMarginPercent(product?.salePriceCents || 0, product?.costCents || 0).toFixed(2)}%"></div><div class="field"><label>Estoque mínimo</label><input name="minimumStock" type="number" min="0" step="0.001" value="${product?.minimumStock || 0}"></div><label class="field"><span><input name="trackStock" type="checkbox" ${product?.trackStock === false ? '' : 'checked'}> Controlar saldo em estoque</span><small>Obrigatório para itens usados como insumo.</small></label><label class="field"><span><input name="active" type="checkbox" ${product?.active === false ? '' : 'checked'}> Cadastro ativo</span><small>Estar ativo não adiciona automaticamente ao Cardápio.</small></label>${productionDestinationMarkup()}</div>${quantityPricingMarkup()}<div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button class="primary-button" type="submit">Salvar no Estoque</button></div></form>`, { wide: true, onMount(root) {
      const usage=root.querySelector('#product-usage-type');
      const price=root.querySelector('#product-price');
      const cost=root.querySelector('#product-cost');
      const margin=root.querySelector('#product-margin');
      const track=root.querySelector('[name="trackStock"]');
      void mountQuantityPricingEditor(root,product);
      root._productionDestinationReady=mountProductionDestination(root,product);
      const updateMargin=()=>{if(margin)margin.value=`${ui.calculateMarginPercent(centsFromInput(price?.value||'0'),centsFromInput(cost?.value||'0')).toFixed(2)}%`;};
      const syncUsage=()=>{const ingredient=usage?.value==='INGREDIENT';const usedAsIngredient=['INGREDIENT','BOTH'].includes(usage?.value);root.querySelectorAll('[data-product-sale-only]').forEach(node=>node.hidden=ingredient);const pricing=root.querySelector('[data-quantity-pricing]');if(pricing)pricing.hidden=ingredient;const destination=root.querySelector('[data-production-destination]');if(destination)destination.hidden=ingredient||destination.dataset.available==='false';if(ingredient&&price)price.value='0,00';if(usedAsIngredient&&track){track.checked=true;track.disabled=true;}else if(track)track.disabled=false;updateMargin();};
      usage?.addEventListener('change',syncUsage);price?.addEventListener('input',updateMargin);cost?.addEventListener('input',updateMargin);syncUsage();
      root.querySelector('#product-form').addEventListener('submit', async (event) => { event.preventDefault(); const form=event.currentTarget; const usageType=formValue(form,'usageType'); let savedProduct=null;try { await requireProductionDestination(root); const saved=await api.saveProduct({ id:product?.id,name:formValue(form,'name'),sku:formValue(form,'sku'),barcode:formValue(form,'barcode'),categoryId:formValue(form,'categoryId'),unit:formValue(form,'unit'),usageType,salePriceCents:usageType==='INGREDIENT'?0:centsFromInput(formValue(form,'salePrice')),costCents:centsFromInput(formValue(form,'cost')),minimumStock:Number(formValue(form,'minimumStock')||0),trackStock:form.elements.namedItem('trackStock').checked,menuEnabled:usageType==='INGREDIENT'?false:(product?.menuEnabled??false),active:form.elements.namedItem('active').checked });savedProduct=saved; await persistQuantityPricingEditor(root,saved.id); await persistProductionDestination(root,saved.id); const index=state.products.findIndex(item=>item.id===saved.id);if(index>=0)state.products[index]=saved;else state.products.push(saved);state.products.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));closeModal();if(isRouteActive('products'))renderProducts();showToast(usageType==='INGREDIENT'?'Insumo salvo no Estoque.':'Produto salvo no Estoque. Adicione-o ao Cardápio quando quiser vendê-lo.','success'); } catch(error){if(!product&&savedProduct){try{await api.removeProduct(savedProduct.id);}catch{showToast('O cadastro parcial não pôde ser revertido. Revise o produto no Estoque.','error');}}showToast(error.message,'error');} });
    } });
    window.dispatchEvent(new CustomEvent('artisys:product-form-opened',{detail:{productId:product?.id||null}}));
  }

  async function openRecipeForm(product = null) {
    try {
      const [allProducts,existingRecipe]=await Promise.all([api.products(true),product?api.recipe(product.id).catch(()=>null):Promise.resolve(null)]);
      const stockItems=allProducts.filter(item=>item.active&&item.trackStock&&item.id!==product?.id);
      const rows=(existingRecipe?.components||[]).map(item=>({productId:item.productId,quantity:Number(item.quantity||1),unit:item.unit||'UN',conversionFactor:Number(item.conversionFactor||1),lossPercent:Number(item.lossPercent||0)}));
      const optionHtml=stockItems.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(productUsageLabel(item.usageType))} · ${escapeHtml(item.sku||'sem SKU')}</option>`).join('');
      openModal(product?'Editar Ficha Técnica':'Nova Ficha Técnica', `<form id="recipe-product-form"><section class="recipe-section"><h3>Item preparado</h3><div class="field-grid"><div class="field wide"><label>Nome *</label><input name="name" required value="${escapeHtml(product?.name||'')}"></div><div class="field"><label>SKU / código interno</label><input name="sku" value="${escapeHtml(product?.sku||'')}"></div><div class="field"><label>Categoria</label><select name="categoryId"><option value="">Sem categoria</option>${state.categories.map(category=>`<option value="${category.id}" ${product?.categoryId===category.id?'selected':''}>${escapeHtml(category.name)}</option>`).join('')}</select></div><div class="field"><label>Preço de venda</label><input id="recipe-sale-price" name="salePrice" inputmode="decimal" value="${((product?.salePriceCents||0)/100).toFixed(2).replace('.',',')}"></div>${productionDestinationMarkup()}</div></section><section class="recipe-section"><h3>Produção e rendimento</h3><div class="field-grid recipe-production-grid"><div class="field"><label>Rendimento da receita</label><input name="yieldQuantity" type="number" min="0.001" step="0.001" value="${existingRecipe?.yieldQuantity||1}" required></div><div class="field"><label>Unidade do rendimento</label><select name="yieldUnit"><option value="UN" ${(existingRecipe?.yieldUnit||'UN')==='UN'?'selected':''}>UN</option><option value="KG" ${existingRecipe?.yieldUnit==='KG'?'selected':''}>KG</option><option value="LT" ${existingRecipe?.yieldUnit==='LT'?'selected':''}>LT</option></select></div><div class="field"><label>Quantidade por porção</label><input name="portionQuantity" type="number" min="0.001" step="0.001" value="${existingRecipe?.portionQuantity||1}" required></div><div class="field"><label>Tempo de preparo (min)</label><input name="prepTimeMinutes" type="number" min="0" step="1" value="${existingRecipe?.prepTimeMinutes||0}"></div></div></section><section class="recipe-section recipe-components-card"><div class="recipe-section-head"><div><h3>Insumos da ficha técnica</h3><p>As quantidades abaixo representam a receita completa; rendimento e porção definem o consumo por venda.</p></div><button type="button" class="secondary-button" id="recipe-create-add">+ Adicionar insumo</button></div><div id="recipe-create-rows"></div></section><section class="recipe-section"><h3>Custos calculados</h3><div class="recipe-summary-grid"><article><small>Custo da receita</small><strong id="recipe-batch-cost">R$ 0,00</strong></article><article><small>Porções</small><strong id="recipe-portions">1</strong></article><article><small>Custo / porção</small><strong id="recipe-portion-cost">R$ 0,00</strong></article><article><small>CMV</small><strong id="recipe-cmv">0,0%</strong></article><article><small>Margem bruta</small><strong id="recipe-margin">0,0%</strong></article></div></section>${quantityPricingMarkup()}<section class="recipe-section"><h3>Preparo</h3><div class="field-grid"><div class="field wide"><label>Modo de preparo</label><textarea name="preparationNotes" rows="4" placeholder="Descreva sequência, montagem e pontos de controle.">${escapeHtml(existingRecipe?.preparationNotes||'')}</textarea></div><div class="field wide"><label>Observações internas</label><textarea name="notes" rows="2" placeholder="Conservação, validade, equipamento ou outra observação interna.">${escapeHtml(existingRecipe?.notes||'')}</textarea></div></div></section><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="submit" class="primary-button">Salvar Ficha Técnica</button></div></form>`, {wide:true,onMount(root){
        const form=root.querySelector('#recipe-product-form');
        void mountQuantityPricingEditor(root,product);
        root._productionDestinationReady=mountProductionDestination(root,product);
        const host=root.querySelector('#recipe-create-rows');
        const readRows=()=>Array.from(root.querySelectorAll('[data-recipe-create-row]')).map(node=>({productId:node.querySelector('[data-recipe-product]').value,quantity:Number(node.querySelector('[data-recipe-quantity]').value||0),unit:node.querySelector('[data-recipe-unit]').value||'UN',conversionFactor:Number(node.querySelector('[data-recipe-conversion]').value||1),lossPercent:Number(node.querySelector('[data-recipe-loss]').value||0)}));
        const metrics=()=>{const components=readRows().filter(item=>item.productId&&item.quantity>0);const batchCostCents=Math.max(0,Math.round(components.reduce((sum,item)=>{const stock=stockItems.find(candidate=>candidate.id===item.productId);return sum+Number(stock?.costCents||0)*item.quantity*item.conversionFactor*(1+item.lossPercent/100);},0)));const yieldQuantity=Math.max(Number(formValue(form,'yieldQuantity')||1),0.000001);const portionQuantity=Math.max(Number(formValue(form,'portionQuantity')||1),0.000001);const portions=Math.max(yieldQuantity/portionQuantity,0.000001);const costPerPortionCents=Math.max(0,Math.round(batchCostCents/portions));const salePriceCents=centsFromInput(formValue(form,'salePrice'));const cmv=salePriceCents>0?(costPerPortionCents/salePriceCents)*100:0;const margin=salePriceCents>0?((salePriceCents-costPerPortionCents)/salePriceCents)*100:0;return{components,batchCostCents,portions,costPerPortionCents,salePriceCents,cmv,margin};};
        const updateSummary=()=>{const data=metrics();root.querySelector('#recipe-batch-cost').textContent=ui.formatCents(data.batchCostCents);root.querySelector('#recipe-portions').textContent=data.portions.toLocaleString('pt-BR',{maximumFractionDigits:3});root.querySelector('#recipe-portion-cost').textContent=ui.formatCents(data.costPerPortionCents);root.querySelector('#recipe-cmv').textContent=`${data.cmv.toFixed(1)}%`;root.querySelector('#recipe-margin').textContent=`${data.margin.toFixed(1)}%`;root.querySelectorAll('[data-recipe-create-row]').forEach(node=>{const item={productId:node.querySelector('[data-recipe-product]').value,quantity:Number(node.querySelector('[data-recipe-quantity]').value||0),conversionFactor:Number(node.querySelector('[data-recipe-conversion]').value||1),lossPercent:Number(node.querySelector('[data-recipe-loss]').value||0)};const stock=stockItems.find(candidate=>candidate.id===item.productId);const line=Math.max(0,Math.round(Number(stock?.costCents||0)*item.quantity*item.conversionFactor*(1+item.lossPercent/100)));const target=node.querySelector('[data-recipe-line-cost]');if(target)target.textContent=ui.formatCents(line);});};
        const syncRows=()=>{const next=readRows();rows.splice(0,rows.length,...next);};
        const renderRows=()=>{host.innerHTML=rows.length?rows.map((row,index)=>`<div class="recipe-component-row" data-recipe-create-row="${index}"><div class="field recipe-component-product"><label>Produto do Estoque</label><select data-recipe-product required><option value="">Selecione</option>${optionHtml}</select></div><div class="field"><label>Quantidade</label><input data-recipe-quantity type="number" min="0.0001" step="0.001" value="${row.quantity||1}" required></div><div class="field"><label>Unidade</label><input data-recipe-unit value="${escapeHtml(row.unit||'UN')}"></div><div class="field"><label>Fator conversão</label><input data-recipe-conversion type="number" min="0.0001" step="0.001" value="${row.conversionFactor||1}"></div><div class="field"><label>Perda %</label><input data-recipe-loss type="number" min="0" max="99.99" step="0.01" value="${row.lossPercent||0}"></div><div class="recipe-line-cost"><small>Custo</small><strong data-recipe-line-cost>R$ 0,00</strong></div><button type="button" class="danger-button recipe-remove" data-recipe-remove aria-label="Remover insumo">Remover</button></div>`).join(''):'<div class="empty-state">Adicione pelo menos um insumo do Estoque.</div>';host.querySelectorAll('[data-recipe-create-row]').forEach((node,index)=>{const select=node.querySelector('[data-recipe-product]');select.value=rows[index].productId||'';select.addEventListener('change',()=>{const chosen=stockItems.find(item=>item.id===select.value);if(chosen)node.querySelector('[data-recipe-unit]').value=chosen.unit||'UN';updateSummary();});node.querySelectorAll('input').forEach(input=>input.addEventListener('input',updateSummary));node.querySelector('[data-recipe-remove]').addEventListener('click',()=>{syncRows();rows.splice(index,1);renderRows();});});updateSummary();};
        root.querySelector('#recipe-create-add').addEventListener('click',()=>{syncRows();rows.push({productId:'',quantity:1,unit:'UN',conversionFactor:1,lossPercent:0});renderRows();});
        form.querySelectorAll('[name="yieldQuantity"],[name="portionQuantity"],[name="salePrice"]').forEach(input=>input.addEventListener('input',updateSummary));
        form.addEventListener('submit',async event=>{event.preventDefault();const data=metrics();if(!data.components.length){showToast('A Ficha Técnica precisa de ao menos um insumo do Estoque.','error');return;}let savedProduct=null;try{await requireProductionDestination(root);savedProduct=await api.saveProduct({id:product?.id,name:formValue(form,'name'),sku:formValue(form,'sku'),barcode:product?.barcode||'',categoryId:formValue(form,'categoryId'),unit:'UN',usageType:'DIRECT',salePriceCents:data.salePriceCents,costCents:data.costPerPortionCents,minimumStock:0,trackStock:false,menuEnabled:product?.menuEnabled??false,active:true});await api.saveRecipe(savedProduct.id,{yieldQuantity:Number(formValue(form,'yieldQuantity')||1),yieldUnit:formValue(form,'yieldUnit')||'UN',portionQuantity:Number(formValue(form,'portionQuantity')||1),prepTimeMinutes:Number(formValue(form,'prepTimeMinutes')||0),preparationNotes:formValue(form,'preparationNotes'),notes:formValue(form,'notes'),components:data.components});await persistQuantityPricingEditor(root,savedProduct.id);await persistProductionDestination(root,savedProduct.id);state.products=await api.products();closeModal();showToast('Ficha Técnica salva com custos e consumo por porção atualizados.','success');navigate('inventory');}catch(error){if(!product&&savedProduct){try{await api.removeProduct(savedProduct.id);}catch{}}showToast(error.message,'error');}});
        renderRows();
      }});
    } catch(error) { showToast(error.message,'error'); }
  }
  window.PdvCatalogAdmin = Object.freeze({
    openStockProductForm:(product=null)=>openProductForm(product),
    openRecipeForm:(product=null)=>void openRecipeForm(product),
    openInventoryItem
  });

  async function mountRecipeEditor(root, product) {
    const host = root.querySelector('#recipe-editor-content');
    if (!host) return;
    try {
      const [recipe, stockItems] = await Promise.all([api.recipe(product.id).catch(() => null), api.products(true)]);
      const rows = (recipe?.components || []).map((item) => ({ productId: item.productId, quantity: item.quantity, unit: item.unit || 'UN', lossPercent: item.lossPercent || 0, conversionFactor: item.conversionFactor || 1 }));
      const options = stockItems.filter((item) => item.id !== product.id).map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.sku || 'insumo')}</option>`).join('');
      const renderRows = () => { host.querySelector('#recipe-rows').innerHTML = rows.length ? rows.map((row, index) => `<div class="field-grid recipe-row" data-recipe-row="${index}"><div class="field wide"><label>Insumo do estoque</label><select data-recipe-product><option value="">Selecione</option>${options}</select></div><div class="field"><label>Quantidade</label><input data-recipe-quantity type="number" min="0.0001" step="0.001" value="${row.quantity || 1}"></div><div class="field"><label>Unidade</label><input data-recipe-unit value="${escapeHtml(row.unit || 'UN')}"></div><button type="button" class="danger-button" data-recipe-remove>Remover</button></div>`).join('') : '<div class="empty-state">Nenhum insumo informado.</div>'; host.querySelectorAll('[data-recipe-row]').forEach((node, index) => { node.querySelector('[data-recipe-product]').value = rows[index].productId || ''; node.querySelector('[data-recipe-remove]').addEventListener('click', () => { rows.splice(index, 1); renderRows(); }); }); };
      host.innerHTML = `<p><small>A ficha técnica define o consumo de insumos. Ela permanece interna e só vira item do Cardápio quando for escolhida no fluxo “Novo item”.</small></p><div id="recipe-rows"></div><div class="modal-actions"><button type="button" class="secondary-button" id="recipe-add">＋ Adicionar insumo</button><button type="button" class="primary-button" id="recipe-save">Salvar ficha técnica</button><span id="recipe-status"></span></div>`;
      host.querySelector('#recipe-add').addEventListener('click', () => { rows.push({ productId: '', quantity: 1, unit: 'UN' }); renderRows(); });
      host.querySelector('#recipe-save').addEventListener('click', async () => { try { const payload = Array.from(host.querySelectorAll('[data-recipe-row]')).map((node) => ({ productId: node.querySelector('[data-recipe-product]').value, quantity: Number(node.querySelector('[data-recipe-quantity]').value || 0), unit: node.querySelector('[data-recipe-unit]').value || 'UN' })).filter((item) => item.productId && item.quantity > 0); await api.saveRecipe(product.id, { components: payload }); host.querySelector('#recipe-status').textContent = 'Ficha técnica salva.'; showToast('Ficha técnica salva. Ela pode ser escolhida no Cardápio.', 'success'); } catch (error) { showToast(error.message, 'error'); } });
      renderRows();
    } catch (error) { host.innerHTML = `<div class="empty-state">Não foi possível carregar a ficha técnica agora. O Cardápio continua disponível.</div>`; }
  }

  function showSetup() {
    authOverlay.classList.remove('hidden');
    authOverlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Configurar ArtiSys PDV</h1><p>Crie o primeiro administrador desta instalação local.</p><form id="setup-form"><div class="field"><label>Nome</label><input name="name" required value="Administrador"></div><div class="field"><label>Usuário</label><input name="username" required value="admin"></div><div class="field"><label>Senha</label><input name="password" type="password" minlength="10" required></div><button class="primary-button" type="submit">Criar administrador</button></form></section>`;
    authOverlay.querySelector('#setup-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { await api.setupAdmin({ name: formValue(form,'name'), username: formValue(form,'username'), password: formValue(form,'password') }); showLogin('Administrador criado. Entre com seus dados.'); } catch (error) { showToast(error.message, 'error'); } });
    window.PdvUiLifecycle?.emit('auth:rendered', { surface:'setup' });
  }

  function showLogin(message = '') {
    authOverlay.classList.remove('hidden');
    authOverlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>ArtiSys PDV</h1><p>${escapeHtml(message || 'Entre para iniciar a operação local.')}</p><form id="login-form"><div class="field"><label>Usuário</label><input name="username" autocomplete="username" required></div><div class="field"><label>Senha</label><input name="password" type="password" autocomplete="current-password" required></div><button class="primary-button" type="submit">Entrar</button></form></section>`;
    authOverlay.querySelector('#login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      try {
        const login = await api.login({ username: formValue(form,'username'), password: formValue(form,'password'), terminalId: state.config.terminalId });
        state.user = login.user;
        window.PdvCurrentAccess=state.user;
        updateTopbar();
        await loadCommonData();
        await navigate('home');
        if (!state.config.dataServer?.selected && state.config.dataServer?.setupIntent === 'new-installation') {
          showPrimaryRoleChoice();
          return;
        }
        authOverlay.classList.add('hidden');
        authOverlay.innerHTML = '';
        reviewSavedDeployment();
        window.PdvUiLifecycle?.emit('auth:hidden', { reason:'authenticated' });
      } catch (error) { showToast(error.message, 'error'); }
    });
    window.PdvUiLifecycle?.emit('auth:rendered', { surface:'login' });
  }

  function showPrimaryRoleChoice() {
    if(!window.PdvAccessPolicy?.hasCapability(state.user,'deployment.manage')){
      showToast('Somente administradores autorizados podem definir o papel deste computador.','error');
      return;
    }
    authOverlay.classList.remove('hidden');
    authOverlay.innerHTML = `<section class="auth-card device-onboarding-card"><div class="auth-logo">A</div><h1>Configuração deste computador</h1><p>Agora escolha onde os dados desta instalação ficarão. Essa decisão pode ser alterada depois por um administrador autorizado.</p><div class="device-choice-grid"><button type="button" class="device-choice-card" data-primary-mode="local"><strong>Usar somente neste computador</strong><span>Ideal para um único caixa. Os dados ficam neste PC e nenhum acesso pela rede é aberto.</span></button><button type="button" class="device-choice-card" data-primary-mode="lan-host"><strong>Tornar este o PC principal</strong><span>Os dados ficam neste computador e outros caixas, totens e painéis autorizados podem se conectar pela rede local.</span></button></div><div class="field" data-primary-port hidden><label>Porta da rede local</label><input name="primaryPort" type="number" min="1" max="65535" value="4174"></div><div class="modal-actions"><button type="button" class="primary-button" data-confirm-primary disabled>Salvar e continuar</button></div></section>`;
    let selectedMode='';
    const portField=authOverlay.querySelector('[data-primary-port]');
    const confirm=authOverlay.querySelector('[data-confirm-primary]');
    authOverlay.querySelectorAll('[data-primary-mode]').forEach(button=>button.addEventListener('click',()=>{
      selectedMode=button.dataset.primaryMode;
      authOverlay.querySelectorAll('[data-primary-mode]').forEach(item=>item.classList.toggle('selected',item===button));
      portField.hidden=selectedMode!=='lan-host';
      confirm.disabled=false;
    }));
    confirm.addEventListener('click',async()=>{
      if(!selectedMode)return;
      confirm.disabled=true;
      try{
        await window.artisysDesktop.dataServer.save({mode:selectedMode,port:Number(authOverlay.querySelector('[name="primaryPort"]').value||4174)},api.sessionToken);
        await window.artisysDesktop.dataServer.restart();
      }catch(error){confirm.disabled=false;showToast(error.message,'error');}
    });
    window.PdvUiLifecycle?.emit('auth:rendered',{surface:'primary-role'});
  }

  function showDataServerChoice() {
    authOverlay.classList.remove('hidden');
    authOverlay.innerHTML = `<section class="auth-card device-onboarding-card"><div class="auth-logo">A</div><h1>Como este computador será usado?</h1><p>Escolha se este PC vai iniciar uma instalação ArtiSys ou se será conectado a uma empresa já configurada.</p><div class="device-choice-grid" data-device-choice-grid><button type="button" class="device-choice-card" data-new-installation><strong>Iniciar uma nova instalação</strong><span>Este computador guardará os dados da empresa. Depois da criação do administrador, você escolhe se ele será usado sozinho ou como PC principal da rede.</span></button><button type="button" class="device-choice-card" data-connect-existing><strong>Conectar a uma instalação existente</strong><span>Use este computador como caixa, cozinha, balcão, totem ou outro terminal ligado a um PC principal já configurado.</span></button></div><form id="terminal-pairing-form" class="device-pairing-form" hidden><section class="device-discovery-panel wide" aria-labelledby="device-discovery-title"><div class="device-discovery-head"><div><strong id="device-discovery-title">PC principal na rede</strong><span>O ArtiSys procura automaticamente computadores principais disponíveis.</span></div><button type="button" class="secondary-button" data-discover-principal>Procurar novamente</button></div><div class="device-discovery-list" data-discovered-servers role="list" aria-live="polite"><p class="device-discovery-status">Procurando na rede local…</p></div></section><div class="field"><label>Código de pareamento</label><input name="pairingCode" data-pairing-code inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></div><div class="field"><label>Nome deste computador</label><input name="terminalName" value="Caixa 02" required></div><details class="device-pairing-advanced wide" data-pairing-advanced><summary>Configuração avançada</summary><div class="field"><label>Endereço do PC principal</label><input name="serverUrl" placeholder="http://192.168.0.10:4174" autocomplete="off"></div><p class="ops-muted">Use o endereço manual somente se a rede bloquear a descoberta automática.</p></details><div class="modal-actions wide"><button type="button" class="secondary-button" data-back-device-choice>Voltar</button><button type="submit" class="primary-button">Conectar</button></div><p class="ops-muted wide">Os dados e o administrador pertencem ao PC principal. Este terminal recebe apenas uma credencial técnica protegida pelo sistema operacional.</p></form></section>`;
    window.PdvUiLifecycle?.emit('auth:rendered', { surface:'data-server' });
    const grid=authOverlay.querySelector('[data-device-choice-grid]');
    const pairForm=authOverlay.querySelector('#terminal-pairing-form');
    const discoveryHost=pairForm.querySelector('[data-discovered-servers]');
    const manualInput=pairForm.elements.serverUrl;
    function selectPrincipal(url){
      manualInput.value=String(url||'');
      pairForm.querySelectorAll('[data-discovered-server]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.discoveredServer===manualInput.value)));
    }
    function renderDiscoveredServers(items=[]){
      if(!Array.isArray(items)||!items.length){
        discoveryHost.innerHTML='<p class="device-discovery-status">Nenhum PC principal foi encontrado automaticamente. Confira se os computadores estão na mesma rede e tente novamente. Se necessário, use Configuração avançada.</p>';
        return;
      }
      discoveryHost.innerHTML=items.map((item,index)=>`<button type="button" class="device-discovery-option" role="listitem" data-discovered-server="${escapeHtml(item.url)}" aria-pressed="false"><strong>${escapeHtml(item.name||'PC principal ArtiSys')}</strong><span>Disponível na rede local${items.length>1?` · opção ${index+1}`:''}</span></button>`).join('');
      discoveryHost.querySelectorAll('[data-discovered-server]').forEach(button=>button.addEventListener('click',()=>{selectPrincipal(button.dataset.discoveredServer);pairForm.elements.pairingCode.focus();}));
      if(items.length===1)selectPrincipal(items[0].url);
    }
    async function discoverPrincipals(){
      const button=pairForm.querySelector('[data-discover-principal]');
      button.disabled=true;
      discoveryHost.innerHTML='<p class="device-discovery-status">Procurando na rede local…</p>';
      try{renderDiscoveredServers(await window.artisysDesktop.dataServer.discover());}
      catch(error){discoveryHost.innerHTML=`<p class="device-discovery-status error">Não foi possível procurar automaticamente: ${escapeHtml(error.message||'falha de rede')}. Você ainda pode usar Configuração avançada.</p>`;}
      finally{button.disabled=false;}
    }
    authOverlay.querySelector('[data-new-installation]').addEventListener('click',async()=>{
      try{
        const result=await window.artisysDesktop.dataServer.beginNewInstallation();
        state.config={...state.config,dataServer:result.config};
        await api.health();
        const setup=await api.setupStatus();
        if(setup.needsSetup)showSetup();
        else showLogin('Entre como administrador para concluir a configuração deste computador.');
      }catch(error){showToast(error.message,'error');}
    });
    authOverlay.querySelector('[data-connect-existing]').addEventListener('click',()=>{
      grid.hidden=true;
      pairForm.hidden=false;
      void discoverPrincipals();
      pairForm.elements.pairingCode.focus();
    });
    pairForm.querySelector('[data-discover-principal]').addEventListener('click',()=>void discoverPrincipals());
    manualInput.addEventListener('input',()=>pairForm.querySelectorAll('[data-discovered-server]').forEach(button=>button.setAttribute('aria-pressed','false')));
    authOverlay.querySelector('[data-back-device-choice]').addEventListener('click',()=>{
      pairForm.hidden=true;
      grid.hidden=false;
      selectPrincipal('');
    });
    pairForm.addEventListener('submit',async(event)=>{
      event.preventDefault();
      const serverUrl=formValue(pairForm,'serverUrl');
      if(!serverUrl){showToast('Selecione um PC principal encontrado ou informe o endereço em Configuração avançada.','error');pairForm.querySelector('[data-pairing-advanced]')?.setAttribute('open','');return;}
      const button=pairForm.querySelector('[type="submit"]');
      button.disabled=true;
      try{
        const result=await window.artisysDesktop.dataServer.pair({
          serverUrl,
          code:formValue(pairForm,'pairingCode'),
          name:formValue(pairForm,'terminalName')
        });
        state.config={...state.config,dataServer:result.config};
        showToast('Computador pareado. Reiniciando para entrar com um usuário local.','success');
        await window.artisysDesktop.dataServer.restart();
      }catch(error){button.disabled=false;showToast(error.message,'error');}
    });
  }

    async function restorePersistedSession() {
    if (!api.sessionToken) return false;
    try {
      const session = await api.currentSession();
      state.user = session.user;
      window.PdvCurrentAccess=state.user;
      updateTopbar();
      await loadCommonData();
      await navigate('home');
      authOverlay.classList.add('hidden');
      authOverlay.innerHTML = '';
      return true;
    } catch (error) {
      if (error.status === 401) {
        api.logout();
        return false;
      }
      throw error;
    }
  }

  async function logout() {
    if(api.webMode){
      try{await api.logout();}catch(error){showToast('Não foi possível encerrar a sessão. Tente novamente.', 'error');return;}
      state.user=null;window.PdvCurrentAccess=null;state.sale=null;clearCheckoutDocumentContext();updateTopbar();renderSidebar();showWebLogin();
      return;
    }
    api.logout();state.user=null;window.PdvCurrentAccess=null;state.sale=null;clearCheckoutDocumentContext();updateTopbar();showLogin();
  }

  async function executeShortcut(action) {
    if (!action || !state.user) return;
    if (action.type === 'navigate') return navigate(action.route);
    if (action.type === 'checkout.new-sale') return newSale();
    if (action.type === 'checkout.focus-scan') return document.getElementById('product-search')?.focus();
    if (action.type === 'checkout.remove-selected') return state.selectedProductId ? removeProduct(state.selectedProductId) : showToast('Selecione um item.', 'error');
    if (action.type === 'checkout.cancel-sale') return cancelCurrentSale();
    if (action.type === 'checkout.suspend-sale') return suspendCurrentSale();
    if (action.type === 'checkout.finalize') return openPaymentModal();
  }

  function bindGlobalEvents() {
    if(api.webMode){document.querySelector('.window-controls')?.remove();}
    document.querySelectorAll('[data-window]').forEach((button) => button.addEventListener('click', () => window.artisysDesktop.window[button.dataset.window]?.()));
    document.getElementById('operator-button').addEventListener('click', () => { if (!state.user) return; openModal('Operador', `<div class="operator-modal-content"><div class="auth-logo operator-modal-avatar">${escapeHtml(initials(state.user.name))}</div><h3>${escapeHtml(state.user.name)}</h3><p>${escapeHtml(state.user.profile?.name||'Equipe')}</p><button id="logout-button" class="danger-button">Sair desta sessão</button></div>`, { onMount(root) { root.querySelector('#logout-button').addEventListener('click', () => { closeModal(); logout(); }); } }); });
    document.addEventListener('keydown', (event) => { if (!/^F\d+$/.test(event.key)) return; const action = ui.resolveShortcut(event.key, document.body.dataset.activeRoute || state.route); if (action) { event.preventDefault(); void executeShortcut(action); } });
  }

  function showExistingInstallation(){
    authOverlay.classList.remove('hidden');
    authOverlay.innerHTML=`<section class="auth-card device-onboarding-card"><div class="auth-logo">A</div><h1>Encontramos uma instalação existente</h1><p>Seus usuários, pedidos e configurações foram preservados. Reinstalar ou atualizar o ArtiSys mantém os dados da loja.</p><div class="device-choice-grid"><button type="button" class="device-choice-card" data-existing-continue><strong>Continuar com meus dados</strong><span>Entrar normalmente nesta loja.</span></button><button type="button" class="device-choice-card" data-existing-review><strong>Revisar o papel deste computador</strong><span>Após entrar, confira se este PC deve trabalhar sozinho ou atender a rede.</span></button></div></section>`;
    const continueWith=async review=>{try{await window.artisysDesktop.installation.acknowledge();if(review)sessionStorage.setItem('artisys.reviewDeployment','1');await completeBoot();}catch(error){showToast(error.message,'error');}};
    authOverlay.querySelector('[data-existing-continue]').addEventListener('click',()=>void continueWith(false));
    authOverlay.querySelector('[data-existing-review]').addEventListener('click',()=>void continueWith(true));
    window.PdvUiLifecycle?.emit('auth:rendered',{surface:'existing-installation'});
  }
  function reviewSavedDeployment(){
    if(sessionStorage.getItem('artisys.reviewDeployment')!=='1')return;
    sessionStorage.removeItem('artisys.reviewDeployment');
    void navigate('settings').then(()=>window.PdvUiLifecycle?.emit('settings:select',{category:'units'}));
  }
  async function completeBoot(){
    const dataServer=state.config.dataServer||{};
    if(!dataServer.selected&&dataServer.setupIntent!=='new-installation'){showDataServerChoice();return;}
    await api.health();setOnline(true);const setup=await api.setupStatus();
    if(setup.needsSetup){showSetup();return;}
    const restored = await restorePersistedSession();
    if(restored&&!dataServer.selected&&dataServer.setupIntent==='new-installation')showPrimaryRoleChoice();
    else if(restored)reviewSavedDeployment();
    if (restored) return;
    showLogin(!dataServer.selected&&dataServer.setupIntent==='new-installation'?'Entre como administrador para concluir a configuração deste computador.':'');
  }


  // This is the original renderer's browser boot path. No second app or state tree.
  function showWebLogin(message=''){
    authOverlay.classList.remove('hidden');
    authOverlay.innerHTML=`<section class="auth-card web-login-card"><div class="auth-logo">A</div>
      <div class="web-login-eyebrow">ARTISYS / PDV TOTAL</div>
      <h1>Entre na sua loja</h1><p>Suas vendas, seu caixa e seu estoque em um só lugar.</p>
      <form id="web-login-form">
        <div class="field"><label for="web-email">E-mail</label><input id="web-email" name="email" type="email" autocomplete="username" required autofocus></div>
        <div class="field"><label for="web-password">Senha</label><input id="web-password" name="password" type="password" autocomplete="current-password" required></div>
        <p class="web-login-feedback" id="web-login-feedback" role="status" aria-live="polite">${escapeHtml(message)}</p>
        <button class="primary-button" type="submit">Entrar no PDV</button>
      </form><small>O acesso depende da liberação do estabelecimento pela ArtiSys.</small></section>`;
    const form=authOverlay.querySelector('#web-login-form');
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(form.dataset.pending==='true')return;
      const button=form.querySelector('button[type=submit]'),feedback=form.querySelector('#web-login-feedback');
      const email=String(form.elements.email.value||'').trim();
      const password=String(form.elements.password.value||'');
      form.dataset.pending='true';button.disabled=true;button.textContent='Entrando…';
      try{
        const session=await api.login({email,password});
        await activateWebSession(session);
      }catch(error){
        feedback.textContent=error.status===503?'O acesso online ainda não foi liberado. Seus dados estão preservados.':error.message;
        form.elements.password.focus({preventScroll:true});
      }finally{form.dataset.pending='false';button.disabled=false;button.textContent='Entrar no PDV';}
    });
    window.PdvUiLifecycle?.emit('auth:rendered',{surface:'login'});
  }

  async function activateWebSession(session){
    const membership=session?.memberships?.[0];
    if(!membership)throw new Error('Você não possui estabelecimento ativo.');
    const {branch,context}=await api.chooseWebTenant(membership);
    state.config={...state.config,
      storeName:context.name||membership.name,
      terminalName:branch.name,
      terminalId:branch.id,
      dataServer:{mode:'cloud',selected:true}
    };
    state.user={
      id:session.user.id,name:session.user.displayName,
      permissions:context.capabilities||[],profileId:'profile-'+String(context.profileKey||'operator').toLowerCase(),
      profile:{name:String(context.profileKey||'Equipe'),permissions:context.capabilities||[]}
    };
    updateTopbar();
    setOnline(true);
    await loadCommonData();
    renderSidebar();
    authOverlay.classList.add('hidden');authOverlay.innerHTML='';
    await navigate('checkout');
    window.PdvUiLifecycle?.emit('auth:hidden',{reason:'authenticated'});
  }

  async function bootWeb(){
    document.body.dataset.runtime='web';
    state.config=await api.initialize();
    document.body.dataset.activeRoute='home';
    renderSidebar();
    updateTopbar();
    try{
      const health=await api.health();
      if(!health.ok)throw new Error('Serviço indisponível.');
      const session=await api.currentSession();
      await activateWebSession(session);
    }catch(error){
      setOnline(false);
      renderHome();
      showWebLogin(error.status===503?'O acesso online ainda não foi liberado.':'');
    }
  }

  async function boot() {
    hydrateStaticIcons(); bindGlobalEvents(); updateClock(); setInterval(updateClock, 30000);
    if(api.webMode){await bootWeb();return;}
    try {
      state.config = await api.initialize();
      updateTopbar();
      renderSidebar();
      document.body.dataset.activeRoute = 'home';
      renderHome();

      if(state.config.installation?.reviewNeeded&&state.config.dataServer?.selected){showExistingInstallation();return;}
      await completeBoot();
    } catch (error) {
      setOnline(false);
      renderSidebar();
      document.body.dataset.activeRoute = 'home';
      renderHome();
      showToast(`Não foi possível conectar ao servidor configurado: ${error.message}`, 'error');
    }
  }

  async function openCheckoutSale(saleId) {
    const id=String(saleId||'').trim();if(!id)throw new Error('Venda do pedido não encontrada.');
    if(state.sale?.id&&state.sale.id!==id&&state.sale.items?.length)throw new Error('Há uma venda em andamento no Balcão. Suspenda ou finalize antes de cobrar outro pedido.');
    let sale=await api.sale(id);
    if(sale.status==='SUSPENDED')sale=await api.resumeSale(id);
    if(sale.status!=='OPEN')throw new Error('Esta venda não está disponível para cobrança no Balcão.');
    clearCheckoutDocumentContext();
    state.sale=sale;
    state.discountPercent=sale.subtotalCents?Number(((sale.discountCents/sale.subtotalCents)*100).toFixed(2)):0;
    state.selectedProductId=null;
    await navigate('checkout');
    renderCheckout();
    return sale;
  }

  function registerBaseRoutes() {
    const ownedRoutes = {
      home: () => renderHome(),
      checkout: () => renderCheckout(),
      customers: () => api.webMode?window.PdvWebParityUi?.show('customers'):renderCustomers(),
      suppliers: () => window.PdvWebParityUi?.show('suppliers'),
      sellers: () => api.webMode?window.PdvWebParityUi?.show('sellers'):renderSellers(),
      credit: () => window.PdvWebParityUi?.show('credit'),
      commissions: () => window.PdvWebParityUi?.show('commissions'),
      management: () => {
        if (!window.PdvAccessPolicy?.hasCapability(state.user,'management.view')) return renderPermissionDenied('Gestão');
        return (api.webMode?window.PdvAdvancedFinanceWeb?.renderDre?.():window.PdvErpFinanceUi?.renderManagement?.()) || renderPlaceholder('management');
      },
      products: () => renderProducts(),
      catalog: () => renderFlowHub('Cadastros','Clientes, produtos, estoque e equipe.',[
        {route:'customers',label:'Clientes',description:'Cadastro, histórico e crédito.',icon:'users',tone:'green'},
        {route:'products',label:'Produtos',description:'Itens de venda e fichas técnicas.',icon:'document',tone:'purple'},
        {route:'inventory',label:'Estoque',description:'Saldos e movimentações.',icon:'cubes',tone:'teal'},
        {route:'sellers',label:'Equipe e acessos',description:'Pessoas, funções e permissões.',icon:'users',tone:'orange'}
      ]),
      'post-sale': () => renderFlowHub('Vendas e devoluções','Histórico de vendas, comprovantes, trocas e devoluções.',[
        {route:'sales',label:'Últimas vendas',description:'Consultar vendas recentes e seus detalhes.',icon:'history',tone:'slate'},
        {route:'returns',label:'Devoluções',description:'Registrar e acompanhar trocas e devoluções.',icon:'return',tone:'pink'}
      ]),
      'financial-management': () => renderFlowHub('Gestão financeira','Resultados, análises e compromissos financeiros em um único fluxo.',[
        {route:'management',label:'Gestão e DRE',description:'Acompanhar resultado, margem e fluxo de caixa.',icon:'management',tone:'rose'},
        {route:'finance',label:'Financeiro',description:'Lançamentos, bancos, conciliação, recorrências e alertas.',icon:'chart',tone:'green'},
        {route:'reports',label:'Relatórios',description:'Consultar vendas, estoque e desempenho do negócio.',icon:'document',tone:'indigo'}
      ])
    };
    for (const [route, render] of Object.entries(ownedRoutes)) routeRegistry.register(route, { owner:'app', render });
  }

  registerBaseRoutes();
  window.PdvAppNavigation = Object.freeze({ navigate,openCheckoutSale });
  window.addEventListener('artisys:modules-state-changed',()=>{
    if(!state.user)return;
    if((state.route==='FOOD'||state.route==='WHOLESALE')&&!canAccessRoute(state.route)){
      void navigate('home');
      return;
    }
    renderSidebar();
  });
  void boot();
})();
