'use strict';

(() => {
  const root = window;
  const content = document.getElementById('route-content');
  const ApiClient = window.PdvApiClient?.ApiClient;
  const ui = window.PdvUiModel;
  if (!content || !ApiClient) return;

  const api = new ApiClient();
  const VALID_REFUNDS = ['CASH','PIX','DEBIT_CARD','CREDIT_CARD','STORE_CREDIT','OTHER'];
  const state = {
    mounted:false,
    session:null,
    query:'',
    sales:[],
    sale:null,
    saleReturns:[],
    approval:null,
    loading:false,
    loadToken:0
  };

  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const money = cents => ui?.formatCents ? ui.formatCents(Number(cents || 0)) : (Number(cents || 0) / 100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const when = value => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  };
  const hasCapability = capability => Boolean(window.PdvAccessPolicy?.hasCapability(state.session?.user,capability));
  const directAllowed = () => hasCapability('returns.approve');
  const requiresApproval = () => hasCapability('returns.manage')&&!directAllowed();
  const canOperate = () => hasCapability('returns.manage');
  const refundLabel = method => ({CASH:'Dinheiro',PIX:'PIX',DEBIT_CARD:'Cartão débito',CREDIT_CARD:'Cartão crédito',STORE_CREDIT:'Crédito na loja',OTHER:'Outro'})[method] || method;

  function currentPage() {
    if (document.body.dataset.activeRoute !== 'returns') return null;
    return content.querySelector('[data-returns-ui]');
  }

  function setStatus(text, tone='') {
    const node = currentPage()?.querySelector('#returns-status');
    if (!node) return;
    node.textContent = text || '';
    node.dataset.tone = tone;
  }

  function returnedQuantityByItem() {
    const totals = new Map();
    for (const ret of state.saleReturns) {
      if (String(ret.status || '').toUpperCase() !== 'COMPLETED') continue;
      for (const item of ret.items || []) {
        const key = String(item.saleItemId || '');
        totals.set(key,(totals.get(key) || 0) + Number(item.quantity || 0));
      }
    }
    return totals;
  }

  function returnedCentsByItem() {
    const totals = new Map();
    for (const ret of state.saleReturns) {
      if (String(ret.status || '').toUpperCase() !== 'COMPLETED') continue;
      for (const item of ret.items || []) {
        const key = String(item.saleItemId || '');
        totals.set(key,(totals.get(key) || 0) + Number(item.totalCents || 0));
      }
    }
    return totals;
  }

  function availableQuantity(item, returned) {
    return Math.max(0, Number((Number(item.quantity || 0) - Number(returned || 0)).toFixed(3)));
  }

  function returnAmountFor(item, quantity, returnedQuantity = 0, returnedCents = 0) {
    const originalQuantity = Number(item?.quantity || 0);
    if (!Number.isFinite(quantity) || quantity <= 0 || originalQuantity <= 0) return 0;
    const lineNetCents = Number(item.netTotalCents ?? item.totalCents ?? Math.round(Number(item.unitPriceCents || 0) * originalQuantity));
    const available = availableQuantity(item,returnedQuantity);
    const remainingCents = Math.max(lineNetCents - Number(returnedCents || 0),0);
    if (quantity >= available) return remainingCents;
    return Math.min(remainingCents,Math.max(0,Math.round((lineNetCents * quantity) / originalQuantity)));
  }

  function renderSales() {
    const page = currentPage();
    const root = page?.querySelector('[data-return-sales-list]');
    if (!root) return;
    root.innerHTML = state.sales.length ? state.sales.map((sale,index) => `
      <button type="button" class="return-sale-row ${state.sale?.id === sale.id ? 'active' : ''}" data-return-sale="${escapeHtml(sale.id)}" data-return-sale-index="${index}">
        <span><strong>${escapeHtml(sale.saleNumber || sale.id)}</strong><small>${when(sale.completedAt || sale.openedAt)}</small></span>
        <span><small>Total</small><strong>${money(sale.totalCents)}</strong></span>
      </button>`).join('') : '<div class="empty-state">Nenhuma venda concluída encontrada.</div>';
    root.querySelectorAll('[data-return-sale]').forEach(button => button.addEventListener('click',() => void selectSale(button.dataset.returnSale)));
  }

  function selectedReturnTotal() {
    const page = currentPage();
    if (!page || !state.sale) return 0;
    const returnedQuantity = returnedQuantityByItem();
    const returnedCents = returnedCentsByItem();
    return [...page.querySelectorAll('[data-return-item]')].reduce((sum,row) => {
      const checkbox = row.querySelector('[data-return-check]');
      if (!checkbox?.checked) return sum;
      const quantity = Number(row.querySelector('[data-return-qty]')?.value || 0);
      const item = (state.sale.items || []).find(entry => String(entry.id) === String(row.dataset.returnItem));
      if (!item || !Number.isFinite(quantity) || quantity <= 0) return sum;
      const key=String(item.id);
      return sum + returnAmountFor(item,quantity,returnedQuantity.get(key)||0,returnedCents.get(key)||0);
    },0);
  }

  function refreshDraftTotal() {
    const page = currentPage();
    if (!page) return;
    const total = selectedReturnTotal();
    const totalNode = page.querySelector('[data-return-draft-total]');
    if (totalNode) totalNode.textContent = money(total);
    const submit = page.querySelector('#confirm-return');
    const approved = directAllowed() || Boolean(state.approval?.approvalToken);
    if (submit) submit.disabled = !canOperate() || !approved || total <= 0;
  }

  function authorizationMarkup() {
    if (directAllowed()) return '';
    if (!requiresApproval()) return '<div class="return-permission-warning">Seu perfil não possui permissão para concluir devoluções.</div>';
    const approvedBy = state.approval?.authorizedBy;
    const approvalText = approvedBy
      ? `Autorizado por ${escapeHtml(approvedBy.name || approvedBy.id || 'perfil autorizador')}${state.approval?.expiresAt ? ` até ${when(state.approval.expiresAt)}` : ''}.`
      : 'Informe as credenciais de um perfil com permissão de aprovação para liberar esta devolução.';
    return `<section class="return-permission-warning" data-return-authorization>
      <strong>Autorização de perfil autorizador</strong>
      <p data-return-authorization-status>${approvalText}</p>
      <div class="return-refund-grid">
        <label class="field"><span>Usuário autorizador</span><input id="return-authorizer-username" autocomplete="username" ${approvedBy ? 'disabled' : ''}></label>
        <label class="field"><span>Senha</span><input id="return-authorizer-password" type="password" autocomplete="current-password" ${approvedBy ? 'disabled' : ''}></label>
      </div>
      <button type="button" class="secondary-button" id="authorize-return" ${approvedBy ? 'disabled' : ''}>${approvedBy ? 'Autorizado' : 'Autorizar devolução'}</button>
    </section>`;
  }

  function renderSaleDetails() {
    const page = currentPage();
    const root = page?.querySelector('[data-return-sale-detail]');
    if (!root) return;
    if (!state.sale) {
      root.innerHTML = '<div class="empty-state">Selecione uma venda concluída para iniciar a devolução.</div>';
      return;
    }

    const returned = returnedQuantityByItem();
    const returnedCents = returnedCentsByItem();
    const originalMethod = VALID_REFUNDS.includes(String(state.sale.payments?.[0]?.method || '').toUpperCase())
      ? String(state.sale.payments[0].method).toUpperCase()
      : 'CASH';
    const operable = canOperate();
    const itemRows = (state.sale.items || []).map(item => {
      const key=String(item.id);
      const already = returned.get(key) || 0;
      const available = availableQuantity(item,already);
      const remainingCents=Math.max(Number(item.netTotalCents ?? item.totalCents ?? 0)-Number(returnedCents.get(key)||0),0);
      return `<div class="return-item-row" data-return-item="${escapeHtml(item.id)}">
        <label class="return-item-check"><input type="checkbox" data-return-check ${available <= 0 || !operable ? 'disabled' : ''}><span><strong>${escapeHtml(item.productName || 'Item')}</strong><small>Vendido ${Number(item.quantity || 0).toLocaleString('pt-BR',{maximumFractionDigits:3})} · já devolvido ${Number(already).toLocaleString('pt-BR',{maximumFractionDigits:3})}</small></span></label>
        <label><small>Quantidade</small><input data-return-qty type="number" min="0.001" step="0.001" max="${available}" value="${available > 0 ? Math.min(1,available) : 0}" ${available <= 0 || !operable ? 'disabled' : ''}></label>
        <span><small>Disponível</small><strong>${Number(available).toLocaleString('pt-BR',{maximumFractionDigits:3})}</strong></span>
        <span><small>Líquido restante</small><strong>${money(remainingCents)}</strong></span>
      </div>`;
    }).join('') || '<div class="empty-state">A venda não possui itens devolvíveis.</div>';

    const history = state.saleReturns.length ? state.saleReturns.map(ret => `<div class="return-history-row"><span><strong>${escapeHtml(ret.id)}</strong><small>${when(ret.createdAt)} · ${escapeHtml(ret.reason || '')}</small></span><span class="status-badge">${escapeHtml(String(ret.status || '').toUpperCase() === 'COMPLETED' ? 'Concluída' : 'Cancelada')}</span><strong>${money(ret.totalCents)}</strong></div>`).join('') : '<div class="empty-state compact">Nenhuma devolução anterior nesta venda.</div>';

    root.innerHTML = `
      <section class="return-sale-summary">
        <div><small>Venda</small><strong>${escapeHtml(state.sale.saleNumber || state.sale.id)}</strong></div>
        <div><small>Concluída</small><strong>${when(state.sale.completedAt || state.sale.openedAt)}</strong></div>
        <div><small>Total original</small><strong>${money(state.sale.totalCents)}</strong></div>
      </section>
      ${authorizationMarkup()}
      <section class="return-items"><h3>Itens e quantidades</h3>${itemRows}</section>
      <section class="return-refund-grid">
        <label class="field wide"><span>Motivo *</span><textarea id="return-reason" rows="3" placeholder="Ex.: produto devolvido pelo cliente" ${operable ? '' : 'disabled'}></textarea></label>
        <label class="field"><span>Forma de reembolso</span><select id="return-refund-method" ${operable ? '' : 'disabled'}>${VALID_REFUNDS.map(method => `<option value="${method}" ${method === originalMethod ? 'selected' : ''}>${refundLabel(method)}</option>`).join('')}</select></label>
        <div class="return-draft-total"><small>Total líquido a devolver</small><strong data-return-draft-total>${money(0)}</strong></div>
      </section>
      <div class="return-submit-row"><span>O servidor usa o valor líquido pago e o consumo histórico da venda; a venda original permanece imutável.</span><button type="button" class="primary-button" id="confirm-return" disabled>Confirmar devolução</button></div>
      <section class="return-history"><h3>Histórico desta venda</h3>${history}</section>`;

    root.querySelectorAll('[data-return-check], [data-return-qty]').forEach(node => node.addEventListener('input',refreshDraftTotal));
    root.querySelector('#authorize-return')?.addEventListener('click',() => void authorizeReturn());
    root.querySelector('#confirm-return')?.addEventListener('click',() => void submitReturn());
    refreshDraftTotal();
  }

  async function loadSales() {
    if (!currentPage()) return;
    const token = ++state.loadToken;
    state.loading = true;
    setStatus('Buscando vendas concluídas…');
    try {
      const rows = await api.salesHistory({status:'COMPLETED',query:state.query,limit:40,offset:0});
      if (token !== state.loadToken || !currentPage()) return;
      state.sales = Array.isArray(rows) ? rows : [];
      renderSales();
      setStatus(`${state.sales.length} venda(s) encontrada(s).`,'ok');
    } catch (error) {
      if (token !== state.loadToken) return;
      state.sales = [];
      renderSales();
      setStatus(error.message || 'Falha ao buscar vendas.','error');
    } finally {
      state.loading = false;
    }
  }

  async function selectSale(saleId) {
    if (!saleId) return;
    state.approval = null;
    setStatus('Carregando detalhes da venda…');
    try {
      const [sale,returns] = await Promise.all([api.saleDetails(saleId),api.returns({saleId})]);
      if (!currentPage()) return;
      state.sale = sale;
      state.saleReturns = Array.isArray(returns) ? returns : [];
      renderSales();
      renderSaleDetails();
      setStatus('Venda carregada. Selecione os itens para devolver.','ok');
    } catch (error) {
      setStatus(error.message || 'Falha ao carregar a venda.','error');
    }
  }

  async function authorizeReturn() {
    const page = currentPage();
    if (!page || !state.sale || !requiresApproval()) return;
    const username = String(page.querySelector('#return-authorizer-username')?.value || '').trim();
    const passwordInput = page.querySelector('#return-authorizer-password');
    const password = String(passwordInput?.value || '');
    if (!username || !password) {
      setStatus('Informe usuário e senha do perfil com permissão de aprovação.','error');
      return;
    }
    const button = page.querySelector('#authorize-return');
    if (button) button.disabled = true;
    setStatus('Validando autorização…');
    try {
      state.approval = await api.authorizeReturn({
        username,
        password,
        scope:'return.complete',
        resource:{ saleId:state.sale.id, terminalId:state.session?.terminalId || null }
      });
      if (passwordInput) passwordInput.value = '';
      renderSaleDetails();
      setStatus(`Devolução autorizada por ${state.approval?.authorizedBy?.name || 'perfil autorizador'}.`,'ok');
    } catch (error) {
      state.approval = null;
      if (passwordInput) passwordInput.value = '';
      setStatus(error.message || 'Falha ao autorizar devolução.','error');
      if (button) button.disabled = false;
      refreshDraftTotal();
    }
  }

  async function submitReturn() {
    const page = currentPage();
    if (!page || !state.sale) return;
    if (!canOperate()) {
      setStatus('Seu perfil não possui permissão para concluir devoluções.','error');
      return;
    }
    if (requiresApproval() && !state.approval?.approvalToken) {
      setStatus('Autorize a devolução com credenciais de perfil com permissão de aprovação.','error');
      return;
    }
    const reason = String(page.querySelector('#return-reason')?.value || '').trim();
    if (!reason) {
      setStatus('Informe o motivo da devolução.','error');
      page.querySelector('#return-reason')?.focus();
      return;
    }

    const items = [];
    for (const row of page.querySelectorAll('[data-return-item]')) {
      if (!row.querySelector('[data-return-check]')?.checked) continue;
      const quantity = Number(row.querySelector('[data-return-qty]')?.value || 0);
      if (!Number.isFinite(quantity) || quantity <= 0) continue;
      items.push({saleItemId:row.dataset.returnItem,quantity});
    }
    const totalCents = selectedReturnTotal();
    if (!items.length || totalCents <= 0) {
      setStatus('Selecione ao menos um item com quantidade válida.','error');
      return;
    }
    const method = page.querySelector('#return-refund-method')?.value || 'CASH';
    const button = page.querySelector('#confirm-return');
    if (button) button.disabled = true;
    setStatus('Registrando devolução…');
    try {
      const payload = {
        saleId:state.sale.id,
        reason,
        items,
        refunds:[{method,amountCents:totalCents}]
      };
      if (requiresApproval()) payload.approvalToken = state.approval.approvalToken;
      const result = await api.createReturn(payload);
      const created = result?.return || result;
      state.approval = null;
      setStatus(`Devolução ${created?.id || ''} concluída: ${money(created?.totalCents ?? totalCents)}.`,'ok');
      const [sale,returns] = await Promise.all([api.saleDetails(state.sale.id),api.returns({saleId:state.sale.id})]);
      state.sale = sale;
      state.saleReturns = Array.isArray(returns) ? returns : [];
      renderSaleDetails();
    } catch (error) {
      if (requiresApproval()) state.approval = null;
      setStatus(error.message || 'Falha ao registrar devolução.','error');
      renderSaleDetails();
    }
  }

  async function mountReturns() {
    if (document.body.dataset.activeRoute !== 'returns') return;
    if (currentPage()) return;
    state.mounted = true;
    state.approval = null;
    content.innerHTML = `<section class="page returns-page" data-returns-ui>
      <header class="page-head"><div><h1>Devolução</h1><p>Localize a venda concluída, selecione itens e registre o reembolso.</p></div></header>
      <div class="returns-toolbar"><label class="search-field">⌕<input id="returns-sale-search" autocomplete="off" placeholder="Buscar por número da venda, cliente ou código"></label><button type="button" class="secondary-button" id="returns-refresh">Atualizar</button></div>
      <div id="returns-status" class="returns-status" aria-live="polite"></div>
      <div class="returns-layout"><aside class="returns-sales"><h3>Vendas concluídas</h3><div data-return-sales-list><div class="empty-state">Carregando vendas…</div></div></aside><main class="returns-detail" data-return-sale-detail><div class="empty-state">Selecione uma venda concluída para iniciar a devolução.</div></main></div>
    </section>`;

    const page = currentPage();
    page?.querySelector('#returns-sale-search')?.addEventListener('input',event => {
      state.query = event.target.value;
      void loadSales();
    });
    page?.querySelector('#returns-refresh')?.addEventListener('click',() => void loadSales());

    try {
      state.session = await api.currentSession();
    } catch (error) {
      setStatus(error.message || 'Sessão indisponível.','error');
    }
    await loadSales();
    await root.PdvOperationalRouteExtensions?.mountReturns?.(page);
    await root.PdvOperationalDetailExtensions?.mountReturns?.(page);
  }

  if (!root.PdvRouteRegistry) throw new Error('PdvRouteRegistry must load before returns-ui.js.');
  root.PdvReturnsUi = Object.freeze({ render:mountReturns });
  root.PdvRouteRegistry.register('returns', { owner:'returns-ui', render:() => mountReturns() });
})();
