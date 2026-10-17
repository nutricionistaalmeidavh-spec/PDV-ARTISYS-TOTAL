'use strict';

(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PdvProductsDenseView = api;
})(typeof window !== 'undefined' ? window : globalThis, function factory() {
  const PRODUCTS_UX_LEVEL = 4;
  const PRODUCTS_UX_GUARDS = Object.freeze({
    canonicalRenderer: true,
    lifecycleOwned: true,
    legacyFallbackRemoved: true,
    parityGuarded: true,
    crossFlowGuarded: true,
    releaseRegressionGuarded: true
  });
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);

  function productStatus(product = {}) {
    if (product.active === false) return { key:'inactive', label:'Inativo', tone:'muted' };
    if (product.prepared) {
      if (product.recipeStockStatus === 'OUT') return { key:'recipe-out', label:'Indisponível por insumo', tone:'danger' };
      if (product.recipeStockStatus === 'LOW') return { key:'recipe-low', label:'Insumo baixo', tone:'warning' };
      return { key:'recipe-ok', label:'Insumos OK', tone:'success' };
    }
    if (product.trackStock === false) return { key:'uncontrolled', label:'Sem controle', tone:'info' };
    const stock = Number(product.stockQuantity || 0);
    const minimum = Math.max(Number(product.minimumStock || 0), 0);
    if (stock <= 0) return { key:'out', label:'Sem estoque', tone:'danger' };
    if (minimum > 0 && stock <= minimum) return { key:'low', label:'Baixo', tone:'warning' };
    return { key:'normal', label:'Normal', tone:'success' };
  }

  function filterByStock(products = [], filter = '') {
    const list = Array.isArray(products) ? products : [];
    if (!filter) return [...list];
    return list.filter(product => productStatus(product).key === filter);
  }

  function renderProductsDense(input = {}, components) {
    if (!components?.DataTable || !components?.StatusBadge || !components?.SearchField || !components?.FilterBar) {
      throw new Error('Componentes UX da ArtiSys indisponíveis para Produtos.');
    }

    const {
      products = [], categories = [], query = '', categoryId = '', stockFilter = '', syncLabel = '',
      formatCents = cents => String(cents ?? 0), quantityLabel = value => String(value ?? 0),
      calculateMarginPercent = () => 0
    } = input;

    const search = components.SearchField({
      id:'product-page-search',
      label:'Buscar produtos',
      placeholder:'Buscar nome, SKU ou código de barras...',
      value:query,
      shortcut:'Ctrl+K'
    });

    const filters = components.FilterBar({
      filters:[
        {
          id:'category',
          label:'Categoria',
          value:categoryId,
          options:[{ value:'', label:'Todas categorias' }, ...categories.map(category => ({ value:category.id, label:category.name }))]
        },
        {
          id:'stock',
          label:'Estoque',
          value:stockFilter,
          options:[
            { value:'', label:'Estoque: todos' },
            { value:'normal', label:'Normal' },
            { value:'low', label:'Baixo' },
            { value:'out', label:'Sem estoque' },
            { value:'uncontrolled', label:'Sem controle' },
            { value:'recipe-ok', label:'Ficha: insumos OK' },
            { value:'recipe-low', label:'Ficha: insumo baixo' },
            { value:'recipe-out', label:'Ficha: indisponível' }
          ]
        }
      ],
      activeChips:[],
      clearAction:'products.clear-filters'
    });

    const columns = [
      {
        key:'product',
        label:'Produto',
        render:product => `<div data-product-title><strong>${esc(product.name)}</strong><small>${esc(product.categoryName || 'Sem categoria')}</small></div>`
      },
      {
        key:'sku',
        label:'SKU',
        render:product => `<div class="products-dense-code"><strong>${esc(product.sku || 'Sem SKU')}</strong><small>${esc(product.barcode || 'Sem código de barras')}</small></div>`
      },
      {
        key:'price',
        label:'Preço',
        align:'end',
        render:product => `<div class="products-dense-price"><strong>${esc(formatCents(product.salePriceCents || 0))}</strong><small>Preço de venda</small></div>`
      },
      {
        key:'stock',
        label:'Estoque',
        align:'end',
        render:product => product.prepared ? `<div data-product-stock-cell><strong>Até ${esc(quantityLabel(product.recipeCapacity || 0))} ${Number(product.recipeCapacity||0)===1?'porção':'porções'}</strong><small>Consumo pela ficha técnica</small></div>` : `<div data-product-stock-cell><strong>${esc(quantityLabel(product.stockQuantity))} ${esc(product.unit || 'UN')}</strong><small>${product.trackStock === false ? 'Venda sem saldo próprio' : `Mín. ${esc(quantityLabel(product.minimumStock || 0))}`}</small></div>`
      },
      {
        key:'status',
        label:'Status',
        render:product => components.StatusBadge(productStatus(product))
      },
      {
        key:'actions',
        label:'Ações',
        align:'end',
        render:product => `<div class="products-dense-actions"><button class="secondary-button" type="button" data-product-photo-edit="${esc(product.id)}">${product.photo ? 'Trocar foto' : 'Adicionar foto'}</button>${product.photo ? `<button class="secondary-button" type="button" data-product-photo-remove="${esc(product.id)}">Remover foto</button>` : ''}<button class="secondary-button" type="button" data-edit-product="${esc(product.id)}">Ver origem</button><button class="danger-button" type="button" data-remove-product="${esc(product.id)}">Retirar</button></div>`
      }
    ];

    const table = components.DataTable({
      ariaLabel:'Produtos',
      className:'products-dense-table data-card',
      columns,
      rows:products,
      empty:{
        title:'Nenhum produto encontrado',
        description:query || categoryId || stockFilter ? 'Revise a busca ou os filtros aplicados.' : 'Adicione um produto do Estoque ou uma Ficha Técnica.'
      }
    });

    return `<section class="page products-dense-page" data-products-view="dense"><header class="page-head"><div><h1>Produtos</h1><p><strong>Catálogo de venda:</strong> nomes, preços e categorias. Ajuste saldo, insumos e fichas técnicas em Estoque.</p></div><div class="products-dense-head-actions"><button class="secondary-button" id="open-product-stock" type="button">Estoque e fichas</button><details class="products-secondary-actions" data-products-secondary-actions><summary class="secondary-button">Mais ações</summary><div class="products-secondary-actions-menu" data-products-secondary-actions-menu><button class="products-secondary-action" id="sync-product-photos" type="button">↻ Sincronizar fotos</button><button class="products-secondary-action" id="new-category" type="button">+ Categoria</button></div></details><button class="primary-button" id="new-product">+ Novo produto</button></div></header><div class="products-dense-toolbar">${search}${filters}<small class="products-dense-sync">${esc(syncLabel)}</small></div>${table}</section>`;
  }

  return Object.freeze({
    PRODUCTS_UX_LEVEL,
    PRODUCTS_UX_GUARDS,
    productStatus,
    filterByStock,
    renderProductsDense
  });
});
