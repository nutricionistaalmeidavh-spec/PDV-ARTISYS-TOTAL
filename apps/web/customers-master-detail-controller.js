'use strict';

(() => {
  const ApiClient = window.PdvApiClient?.ApiClient;
  const content = document.getElementById('route-content');
  const PdvCustomersMasterDetail = window.PdvCustomersMasterDetail;
  const ArtisysUxComponents = window.ArtisysUxComponents;
  const ui = window.PdvUiModel;
  const lifecycle = window.PdvUiLifecycle;
  if (!ApiClient || !content || !PdvCustomersMasterDetail || !ArtisysUxComponents || !lifecycle) return;

  const api = new ApiClient();
  const HISTORY_PAGE_SIZE = 25;
  let selectedCustomerId = '';
  let historyOpen = false;
  let customersById = new Map();
  const historyByCustomer = new Map();
  let customersLoadedAt = 0;
  let scheduled = false;
  let decorating = false;

  const customersPage = () => {
    const page = content.querySelector('section.page');
    return page?.querySelector('.page-head h1')?.textContent?.trim() === 'Clientes' ? page : null;
  };
  const money = cents => ui?.formatCents ? ui.formatCents(Number(cents || 0)) : (Number(cents || 0) / 100).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  const when = value => {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR', { dateStyle:'short', timeStyle:'short' });
  };

  async function loadData(force = false) {
    const now = Date.now();
    if (!force && customersById.size && now - customersLoadedAt < 1500) return;
    try {
      const customers = await api.customers(true);
      const list = Array.isArray(customers) ? customers : [];
      customersById = new Map(list.map(customer => [String(customer.id), customer]));
      customersLoadedAt = now;
    } catch (error) {
      if (!customersById.size) throw error;
    }
  }

  function historyState(customerId) {
    const id = String(customerId || '');
    if (!historyByCustomer.has(id)) {
      historyByCustomer.set(id, { sales:[], offset:0, hasMore:true, loaded:false, loading:false, loadedAt:0 });
    }
    return historyByCustomer.get(id);
  }

  async function loadCustomerHistory(customerId, { reset = false } = {}) {
    const id = String(customerId || '');
    if (!id) return historyState(id);
    const state = historyState(id);
    if (state.loading) return state;
    if (reset) {
      state.sales = [];
      state.offset = 0;
      state.hasMore = true;
      state.loaded = false;
    }
    if (!state.hasMore && state.loaded) return state;
    state.loading = true;
    try {
      const page = await api.salesHistory({
        customerId:id,
        status:'COMPLETED',
        limit:HISTORY_PAGE_SIZE,
        offset:state.offset
      });
      const rows = Array.isArray(page) ? page : [];
      const byId = new Map(state.sales.map(sale => [String(sale.id), sale]));
      for (const sale of rows) byId.set(String(sale.id), sale);
      state.sales = [...byId.values()].sort((a,b) => String(b.completedAt || b.openedAt || '').localeCompare(String(a.completedAt || a.openedAt || '')) || String(b.id).localeCompare(String(a.id)));
      state.offset += rows.length;
      state.hasMore = rows.length === HISTORY_PAGE_SIZE;
      state.loaded = true;
      state.loadedAt = Date.now();
      return state;
    } finally {
      state.loading = false;
    }
  }

  function baseCustomerCard(page) {
    return page.querySelector('#customers-list') || page.querySelector('.toolbar + .data-card') || [...page.querySelectorAll('.data-card')].find(card => card.querySelector('[data-edit-customer]')) || null;
  }

  function ensureToolbar(page) {
    const toolbar = page.querySelector('.toolbar');
    if (!toolbar) return;
    toolbar.classList.add('customers-master-toolbar');
    const search = page.querySelector('#customer-page-search');
    const field = search?.closest('.search-field');
    if (!field) return;
    field.classList.add('customers-master-search');
    if (!field.querySelector('[data-customers-search-shortcut]')) {
      const shortcut = document.createElement('kbd');
      shortcut.dataset.customersSearchShortcut = '1';
      shortcut.textContent = 'Ctrl+K';
      field.appendChild(shortcut);
    }
  }

  function ensureHeader(card) {
    let header = card.querySelector('[data-customers-master-header]');
    if (header) return header;
    header = document.createElement('div');
    header.className = 'customers-master-header';
    header.dataset.customersMasterHeader = '1';
    header.innerHTML = '<span>Cliente</span><span>Telefone</span><span>Crédito</span><span>Última compra</span><span>Ações</span>';
    card.prepend(header);
    return header;
  }

  function ensureLayout(page, card) {
    let layout = page.querySelector('[data-customers-master-layout]');
    if (!layout) {
      layout = document.createElement('div');
      layout.className = 'customers-master-layout';
      layout.dataset.customersMasterLayout = '1';
      card.parentNode.insertBefore(layout, card);
      layout.appendChild(card);
    }
    card.classList.add('customers-master-list');
    let panel = layout.querySelector('[data-customers-master-panel]');
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'customers-master-panel';
      panel.dataset.customersMasterPanel = '1';
      layout.appendChild(panel);
    }
    return panel;
  }

  function ensureLastSaleCell(row, latestSale) {
    let cell = row.querySelector('[data-customer-last-sale]');
    if (!cell) {
      cell = document.createElement('div');
      cell.className = 'customers-master-last-sale';
      cell.dataset.customerLastSale = '1';
      const edit = row.querySelector('[data-edit-customer]');
      if (edit) row.insertBefore(cell, edit);
      else row.appendChild(cell);
    }
    const signature = latestSale ? `${latestSale.id}:${latestSale.completedAt || latestSale.openedAt || ''}:${latestSale.totalCents || 0}` : 'none';
    if (cell.dataset.saleSignature !== signature) {
      cell.dataset.saleSignature = signature;
      cell.innerHTML = latestSale
        ? `<small>${when(latestSale.completedAt || latestSale.openedAt)}</small><strong>${money(latestSale.totalCents || 0)}</strong>`
        : '<small>Sem compras</small><strong>—</strong>';
    }
  }

  function ensureCreditMeta(row, customer) {
    const creditCell = row.children[2];
    if (!creditCell) return;
    creditCell.classList.add('customers-master-credit');
    const credit = PdvCustomersMasterDetail.creditSnapshot(customer);
    let meta = creditCell.querySelector('[data-customer-credit-available]');
    if (!meta) {
      meta = document.createElement('small');
      meta.dataset.customerCreditAvailable = '1';
      creditCell.appendChild(meta);
    }
    const text = `Disponível ${money(credit.availableCents)}`;
    if (meta.textContent !== text) meta.textContent = text;
  }

  function decorateRows(card) {
    const visibleIds = [];
    for (const row of card.querySelectorAll('.data-row')) {
      const edit = row.querySelector('[data-edit-customer]');
      if (!edit) continue;
      const id = String(edit.dataset.editCustomer || '');
      const customer = customersById.get(id);
      if (!customer) continue;
      visibleIds.push(id);
      row.classList.add('customers-master-row');
      row.dataset.customerMasterRow = '1';
      row.dataset.customerId = id;
      row.tabIndex = 0;
      ensureCreditMeta(row, customer);
      ensureLastSaleCell(row, customer.lastSale || null);
    }

    if (!visibleIds.includes(selectedCustomerId)) {
      selectedCustomerId = visibleIds[0] || '';
      historyOpen = false;
    }
    for (const row of card.querySelectorAll('[data-customer-master-row]')) {
      row.setAttribute('aria-selected', String(row.dataset.customerId === selectedCustomerId));
    }
    return visibleIds;
  }

  function renderPanel(page) {
    const panel = page.querySelector('[data-customers-master-panel]');
    if (!panel) return;
    const customer = customersById.get(String(selectedCustomerId)) || null;
    const history = customer ? historyState(customer.id) : { sales:[], loaded:false, loading:false, hasMore:false, offset:0 };
    const sales = history.loaded ? history.sales : (customer?.lastSale ? [customer.lastSale] : []);
    const latest = sales[0] || customer?.lastSale || null;
    const signature = customer
      ? `${customer.id}:${customer.updatedAt || ''}:${customer.creditLimitCents || 0}:${customer.creditUsedCents || 0}:${latest?.id || ''}:${latest?.completedAt || latest?.openedAt || ''}:${historyOpen}:${history.sales.length}:${history.offset}:${history.hasMore}:${history.loading}`
      : `empty:${historyOpen}`;
    if (panel.dataset.renderSignature === signature) return;
    panel.dataset.renderSignature = signature;
    panel.innerHTML = PdvCustomersMasterDetail.renderCustomerDetail({
      customer,
      sales,
      components:ArtisysUxComponents,
      formatCents:money,
      formatDate:when,
      historyOpen,
      historyHasMore:history.hasMore,
      historyLoading:history.loading
    });
  }

  function selectCustomer(page, id) {
    const normalized = String(id || '');
    if (!normalized || normalized === selectedCustomerId) return;
    selectedCustomerId = normalized;
    historyOpen = false;
    for (const row of page.querySelectorAll('[data-customer-master-row]')) row.setAttribute('aria-selected', String(row.dataset.customerId === normalized));
    const panel = page.querySelector('[data-customers-master-panel]');
    if (panel) delete panel.dataset.renderSignature;
    renderPanel(page);
  }

  function invalidatePanel(page) {
    const panel = page.querySelector('[data-customers-master-panel]');
    if (panel) delete panel.dataset.renderSignature;
    renderPanel(page);
  }

  async function decorateCustomers(page = customersPage(), { forceData = false } = {}) {
    if (!page || decorating) return;
    decorating = true;
    try {
      page.dataset.customersView = 'master-detail';
      page.classList.add('customers-master-page');
      ensureToolbar(page);
      const card = baseCustomerCard(page);
      if (!card) return;
      ensureHeader(card);
      ensureLayout(page, card);
      await loadData(forceData);
      if (!page.isConnected) return;
      decorateRows(card);
      renderPanel(page);
    } catch (error) {
      console.warn('Master-detail de Clientes indisponível; mantendo UI legada.', error?.message || error);
    } finally {
      decorating = false;
    }
  }

  function scheduleDecorate({ forceData = false } = {}) {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      const page = customersPage();
      if (page) void decorateCustomers(page, { forceData });
    }, 0);
  }

  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    const page = customersPage();
    if (!page) return;
    const search = page.querySelector('#customer-page-search');
    if (!search) return;
    event.preventDefault();
    search.focus();
    search.select?.();
  });

  document.addEventListener('click', async event => {
    const page = customersPage();
    if (!page) return;

    const row = event.target.closest('[data-customer-master-row]');
    if (row) selectCustomer(page, row.dataset.customerId);

    const panelAction = event.target.closest('[data-customers-master-panel] [data-action]');
    if (panelAction?.dataset.action === 'edit-customer') {
      const id = String(panelAction.dataset.entityId || selectedCustomerId || '');
      const originalEdit = [...page.querySelectorAll('[data-edit-customer]')].find(button => String(button.dataset.editCustomer) === id);
      customersLoadedAt = 0;
      originalEdit?.click();
      return;
    }
    if (panelAction?.dataset.action === 'customer-history') {
      historyOpen = !historyOpen;
      invalidatePanel(page);
      if (historyOpen && selectedCustomerId) {
        try {
          await loadCustomerHistory(selectedCustomerId, { reset:true });
        } catch (error) {
          console.warn('Histórico do cliente indisponível.', error?.message || error);
        }
        invalidatePanel(page);
      }
      return;
    }
    if (panelAction?.dataset.action === 'customer-history-more' && selectedCustomerId) {
      try {
        await loadCustomerHistory(selectedCustomerId);
      } catch (error) {
        console.warn('Não foi possível carregar mais vendas do cliente.', error?.message || error);
      }
      invalidatePanel(page);
      return;
    }

    if (event.target.closest('[data-edit-customer], #new-customer')) customersLoadedAt = 0;
  }, true);

  document.addEventListener('keydown', event => {
    if (!['Enter', ' '].includes(event.key)) return;
    const row = event.target.closest?.('[data-customer-master-row]');
    if (!row || event.target.closest('button, input, select, textarea, a')) return;
    event.preventDefault();
    const page = customersPage();
    if (page) selectCustomer(page, row.dataset.customerId);
  });

  const decorateActiveCustomers = ({ forceData = false } = {}) => {
    const page = customersPage();
    if (page) void decorateCustomers(page, { forceData });
  };
  const onRouteMounted = ({ route }) => {
    if (route === 'customers') decorateActiveCustomers({ forceData:true });
  };
  const onRouteUpdated = ({ route, surface }) => {
    if (route === 'customers') decorateActiveCustomers({ forceData:surface === 'customers' });
  };
  lifecycle.on('route:mounted', onRouteMounted);
  lifecycle.on('route:updated', onRouteUpdated);
  if (document.body.dataset.activeRoute === 'customers') decorateActiveCustomers({ forceData:true });
  window.PdvCustomersMasterDetailController = Object.freeze({ render:decorateCustomers, refresh:() => scheduleDecorate({ forceData:true }) });
})();
