'use strict';

(() => {
  const ApiClient = window.PdvApiClient?.ApiClient;
  const content = document.getElementById('route-content');
  const PdvProductsDenseView = window.PdvProductsDenseView;
  const ArtisysUxComponents = window.ArtisysUxComponents;
  const lifecycle = window.PdvUiLifecycle;
  if (!ApiClient || !content || !PdvProductsDenseView || !ArtisysUxComponents || !lifecycle) return;

  const api = new ApiClient();
  let stockFilter = '';
  let scheduled = false;
  let scheduledForceProducts = false;
  let decorating = false;
  let rerunRequested = false;
  let rerunForceProducts = false;
  let productsById = new Map();
  let productsLoadedAt = 0;

  const productsPage = () => {
    const page = content.querySelector('section.page');
    return ['Produtos','Cardápio'].includes(page?.querySelector('.page-head h1')?.textContent?.trim()) ? page : null;
  };

  async function loadProducts(force = false) {
    if (!force && productsById.size && Date.now() - productsLoadedAt < 1500) return productsById;
    const products = await api.products(true);
    productsById = new Map((Array.isArray(products) ? products : []).map(product => [String(product.id), product]));
    productsLoadedAt = Date.now();
    return productsById;
  }

  function baseProductCard(page) {
    return page.querySelector('#products-list') || page.querySelector('.toolbar + .data-card') || [...page.querySelectorAll('.data-card')].find(card => card.querySelector('[data-edit-product]')) || null;
  }

  function ensureHeader(card) {
    let header = card.querySelector('[data-products-dense-header]');
    if (header) return header;
    header = document.createElement('div');
    header.className = 'products-dense-header';
    header.dataset.productsDenseHeader = '1';
    header.innerHTML = '<span>Produto / SKU</span><span>Preço</span><span>Estoque / ficha</span><span>Status</span><span>Ações</span>';
    card.prepend(header);
    return header;
  }

  function ensureToolbar(page) {
    const toolbar = page.querySelector('.toolbar');
    if (!toolbar) return;
    toolbar.classList.add('products-dense-toolbar');

    const search = page.querySelector('#product-page-search');
    const searchField = search?.closest('.search-field');
    if (searchField) {
      searchField.classList.add('products-dense-search');
      if (!searchField.querySelector('[data-products-search-shortcut]')) {
        const shortcut = document.createElement('kbd');
        shortcut.dataset.productsSearchShortcut = '1';
        shortcut.textContent = 'Ctrl+K';
        searchField.appendChild(shortcut);
      }
    }

    const category = page.querySelector('#product-category-filter');
    category?.classList.add('products-dense-filter');

    let stock = page.querySelector('#products-stock-filter');
    if (!stock) {
      stock = document.createElement('select');
      stock.id = 'products-stock-filter';
      stock.className = 'secondary-button products-dense-filter';
      stock.setAttribute('aria-label', 'Filtrar itens por situação de estoque ou ficha técnica');
      stock.innerHTML = '<option value="">Situação: todas</option><option value="normal">Estoque normal</option><option value="low">Estoque baixo</option><option value="out">Sem estoque</option><option value="uncontrolled">Sem controle</option><option value="recipe-ok">Ficha: insumos OK</option><option value="recipe-low">Ficha: insumo baixo</option><option value="recipe-out">Ficha: indisponível</option>';
      stock.value = stockFilter;
      stock.addEventListener('change', event => {
        stockFilter = event.currentTarget.value;
        const currentPage = productsPage();
        if (currentPage) void decorateProducts(currentPage, { forceProducts:false });
      });
      if (category) category.insertAdjacentElement('afterend', stock);
      else toolbar.appendChild(stock);
    } else if (stock.value !== stockFilter) stock.value = stockFilter;

    const sync = toolbar.querySelector('small');
    sync?.classList.add('products-dense-sync');
  }

  function ensureStatusCell(row, status) {
    let cell = row.querySelector('[data-dense-status-cell]');
    if (!cell) {
      cell = document.createElement('div');
      cell.className = 'products-dense-status-cell';
      cell.dataset.denseStatusCell = '1';
      const actions = row.lastElementChild;
      if (actions) row.insertBefore(cell, actions);
      else row.appendChild(cell);
    }
    const signature = `${status.key}:${status.label}:${status.tone}`;
    if (cell.dataset.statusSignature !== signature) {
      cell.dataset.statusSignature = signature;
      cell.innerHTML = ArtisysUxComponents.StatusBadge(status);
    }
  }

  function decorateBaseRow(row, product) {
    const title = row.children[0];
    const stock = row.children[2];
    if (title) {
      title.dataset.productTitle = '1';
      title.classList.add('products-dense-product-cell');
    }
    if (stock) {
      stock.dataset.productStockCell = '1';
      stock.classList.add('products-dense-stock-cell');
    }
    row.classList.add('products-dense-row');
    row.dataset.denseProductId = String(product.id);
    const status = PdvProductsDenseView.productStatus(product);
    row.dataset.denseStockStatus = status.key;
    ensureStatusCell(row, status);
  }

  function applyStockFilter(card, visibleProducts) {
    const allowed = new Set(PdvProductsDenseView.filterByStock(visibleProducts, stockFilter).map(product => String(product.id)));
    let visibleCount = 0;
    let parentHidden = false;

    for (const row of card.querySelectorAll('.data-row')) {
      const edit = row.querySelector('[data-edit-product]');
      if (edit) {
        parentHidden = Boolean(stockFilter) && !allowed.has(String(edit.dataset.editProduct));
        row.hidden = parentHidden;
        if (!parentHidden) visibleCount += 1;
      } else if (row.classList.contains('variant-child-row')) {
        row.hidden = parentHidden;
      }
    }

    card.querySelector('[data-products-filter-empty]')?.remove();
    if (stockFilter && visibleCount === 0) {
      const empty = document.createElement('div');
      empty.dataset.productsFilterEmpty = '1';
      empty.innerHTML = ArtisysUxComponents.EmptyState({
        title:'Nenhum item nesta situação',
        description:'Selecione outra situação de estoque ou ficha técnica, ou limpe o filtro.'
      });
      card.appendChild(empty);
    }
  }

  async function decorateProducts(page = productsPage(), { forceProducts = false } = {}) {
    if (!page) return;
    if (decorating) {
      rerunRequested = true;
      rerunForceProducts = rerunForceProducts || forceProducts;
      return;
    }
    decorating = true;
    try {
      page.dataset.productsView = 'dense';
      page.classList.add('products-dense-page');
      ensureToolbar(page);
      const card = baseProductCard(page);
      if (!card) return;
      card.classList.add('products-dense-table');
      ensureHeader(card);

      const map = await loadProducts(forceProducts);
      if (!page.isConnected) return;
      const visibleProducts = [];
      for (const row of card.querySelectorAll('.data-row')) {
        const edit = row.querySelector('[data-edit-product]');
        if (!edit) continue;
        const product = map.get(String(edit.dataset.editProduct));
        if (!product) continue;
        visibleProducts.push(product);
        decorateBaseRow(row, product);
      }
      applyStockFilter(card, visibleProducts);
    } catch (error) {
      console.warn('Produtos densos indisponíveis; mantendo UI legada.', error?.message || error);
    } finally {
      decorating = false;
      if (rerunRequested) {
        rerunRequested = false;
        scheduleDecorate({ forceProducts: rerunForceProducts });
        rerunForceProducts = false;
      }
    }
  }

  function scheduleDecorate({ forceProducts = false } = {}) {
    scheduledForceProducts = scheduledForceProducts || forceProducts;
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      const pendingForceProducts = scheduledForceProducts;
      scheduledForceProducts = false;
      const page = productsPage();
      if (page) void decorateProducts(page, { forceProducts: pendingForceProducts });
    }, 0);
  }

  document.addEventListener('keydown', event => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'k') return;
    const page = productsPage();
    if (!page) return;
    const search = page.querySelector('#product-page-search');
    if (!search) return;
    event.preventDefault();
    search.focus();
    search.select?.();
  });

  document.addEventListener('click', event => {
    if (event.target.closest('[data-product-photo-edit], [data-product-photo-remove], [data-edit-product], #new-product, #new-category, #sync-product-photos')) {
      productsLoadedAt = 0;
    }
    if (event.target.closest('#open-product-stock')) {
      document.querySelector('#sidebar-nav [data-route="inventory"]')?.click();
    }
  }, true);

  const onRouteMounted = ({ route }) => {
    if (route === 'products') scheduleDecorate({ forceProducts:true });
  };
  const onRouteUpdated = ({ route, surface }) => {
    if (route === 'products') scheduleDecorate({ forceProducts:surface === 'products' });
  };
  lifecycle.on('route:mounted', onRouteMounted);
  lifecycle.on('route:updated', onRouteUpdated);
  if (document.body.dataset.activeRoute === 'products') scheduleDecorate({ forceProducts:true });
  window.PdvProductsDenseController = Object.freeze({ render:decorateProducts, refresh:() => scheduleDecorate({ forceProducts:true }) });
})();
