'use strict';

(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PdvUiModel = api;
})(typeof window !== 'undefined' ? window : globalThis, function factory() {
  const HOME_TILES = Object.freeze([
    { key: 'checkout', label: 'Balcão', description: 'Iniciar nova venda', shortcut: 'F2', route: 'checkout', tone: 'blue', icon: 'cart' },
    { key: 'customers', label: 'Cliente', description: 'Cadastrar e consultar clientes', shortcut: 'F3', route: 'customers', tone: 'green', icon: 'users' },
    { key: 'sellers', label: 'Vendedor', description: 'Gerenciar vendedores', shortcut: 'F4', route: 'sellers', tone: 'orange', icon: 'user' },
    { key: 'products', label: 'Cardápio', description: 'Selecionar do estoque ou de fichas técnicas o que pode ser pedido', shortcut: 'F5', route: 'products', tone: 'purple', icon: 'document' },
    { key: 'inventory', label: 'Estoque', description: 'Entradas, saídas e inventário', shortcut: 'F6', route: 'inventory', tone: 'teal', icon: 'cubes' },
    { key: 'cash', label: 'Caixa', description: 'Abertura, fechamento e sangria', shortcut: 'F7', route: 'cash', tone: 'red', icon: 'cash' },
    { key: 'finance', label: 'Financeiro', description: 'Contas a pagar e receber', shortcut: 'F8', route: 'finance', tone: 'emerald', icon: 'money' },
    { key: 'reports', label: 'Relatórios', description: 'Vendas, estoque e resultados', shortcut: 'F9', route: 'reports', tone: 'indigo', icon: 'chart' },
    { key: 'sales', label: 'Últimas vendas', description: 'Consultar vendas recentes', shortcut: 'F10', route: 'sales', tone: 'slate', icon: 'history' },
    { key: 'returns', label: 'Devolução', description: 'Trocas e devoluções', shortcut: 'F11', route: 'returns', tone: 'pink', icon: 'return' }
  ]);

  const GLOBAL_SHORTCUTS = Object.freeze(Object.fromEntries(HOME_TILES.map((tile) => [tile.shortcut, { type: 'navigate', route: tile.route }])));
  const CHECKOUT_SHORTCUTS = Object.freeze({
    F1: { type: 'checkout.new-sale' },
    F2: { type: 'checkout.focus-scan' },
    F3: { type: 'checkout.remove-selected' },
    F4: { type: 'checkout.cancel-sale' },
    F6: { type: 'checkout.suspend-sale' },
    F12: { type: 'checkout.finalize' }
  });

  const STATUS_LABELS = Object.freeze({
    NEW:'Novo pedido',
    WAITING_PRODUCTION:'Aguardando produção',
    PREPARING:'Preparando',
    READY:'Pedido pronto',
    OUT_FOR_DELIVERY:'Saiu para entrega',
    DELIVERED:'Entregue',
    PICKED_UP:'Retirado',
    DRAFT:'Rascunho',
    QUOTED:'Orçamento',
    CONFIRMED:'Confirmado',
    PARTIALLY_FULFILLED:'Parcialmente atendido',
    FULFILLED:'Atendido',
    ORDERED:'Pedido realizado',
    PARTIALLY_RECEIVED:'Recebido parcialmente',
    RECEIVED:'Recebido',
    OPEN:'Em aberto',
    SUSPENDED:'Suspensa',
    COMPLETED:'Concluída',
    CANCELLED:'Cancelado',
    ACTIVE:'Ativo',
    INACTIVE:'Inativo',
    BLOCKED:'Bloqueado',
    FREE:'Livre',
    OCCUPIED:'Ocupada',
    BILL_REQUESTED:'Conta solicitada',
    CHECKOUT:'Em cobrança',
    ACKNOWLEDGED:'Em atendimento',
    PENDING:'Pendente',
    PRINTING:'Imprimindo',
    PRINTED:'Impresso',
    FAILED:'Falhou',
    EXPIRED:'Expirado',
    DIRECT:'Direto',
    PREVIEWED:'Pré-visualizado',
    COMMITTED:'Confirmado',
    IMPORTED:'Importado',
    REVERSED:'Estornado',
    REFUNDED:'Reembolsado',
    APPROVED:'Aprovado',
    REJECTED:'Recusado',
    IN_TRANSIT:'Em trânsito',
    DISPATCHED:'Despachado',
    PROCESSING:'Processando'
  });
  const FULFILLMENT_LABELS = Object.freeze({DELIVERY:'Entrega',PICKUP:'Retirada',TABLE:'Mesa',COUNTER:'Balcão'});
  const DEVICE_TYPE_LABELS = Object.freeze({KITCHEN:'KDS / produção',WAITER:'Garçom'});
  const PAYMENT_METHOD_LABELS = Object.freeze({CASH:'Dinheiro',PIX:'PIX',DEBIT_CARD:'Cartão de débito',CREDIT_CARD:'Cartão de crédito',STORE_CREDIT:'Crédito da loja',OTHER:'Outro'});

  function statusLabel(value,fallback='Em andamento') {
    const key=String(value||'').trim().toUpperCase();
    return STATUS_LABELS[key]||fallback;
  }

  function fulfillmentLabel(value,fallback='Atendimento') {
    const key=String(value||'').trim().toUpperCase();
    return FULFILLMENT_LABELS[key]||fallback;
  }

  function deviceTypeLabel(value,fallback='Dispositivo') {
    const key=String(value||'').trim().toUpperCase();
    return DEVICE_TYPE_LABELS[key]||fallback;
  }

  function selectCheckoutRestoreSale(openSales=[],documents=[],terminalId='',operatorId='') {
    const linkedSaleIds=new Set((Array.isArray(documents)?documents:[]).map(document=>String(document?.saleId||'').trim()).filter(Boolean));
    return (Array.isArray(openSales)?openSales:[]).find(sale=>
      String(sale?.terminalId||'')===String(terminalId||'')
      && String(sale?.operatorId||'')===String(operatorId||'')
      && !linkedSaleIds.has(String(sale?.id||''))
    )||null;
  }

  function paymentMethodLabel(value,fallback='Outro') {
    const key=String(value||'').trim().toUpperCase();
    return PAYMENT_METHOD_LABELS[key]||fallback;
  }

  function resolveShortcut(key, route) {
    const normalized = String(key || '').toUpperCase();
    if (route === 'checkout' && CHECKOUT_SHORTCUTS[normalized]) return { ...CHECKOUT_SHORTCUTS[normalized] };
    const action = GLOBAL_SHORTCUTS[normalized];
    return action ? { ...action } : null;
  }

  function formatCents(value) {
    const cents = Number.isFinite(Number(value)) ? Math.round(Number(value)) : 0;
    return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  function parseCurrencyToCents(value) {
    let text = String(value ?? '').trim().replace(/R\$/gi, '').replace(/\s+/g, '');
    if (!text) return 0;
    if (text.includes(',')) {
      text = text.replace(/\./g, '').replace(',', '.');
    }
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return 0;
    return Math.round(numeric * 100);
  }

  function calculateCashChange(totalCents, receivedCents) {
    const total = Math.max(0, Math.round(Number(totalCents) || 0));
    const received = Math.max(0, Math.round(Number(receivedCents) || 0));
    return {
      receivedCents: received,
      remainingCents: Math.max(total - received, 0),
      changeCents: Math.max(received - total, 0),
      sufficient: received >= total
    };
  }

  function percentageToDiscountCents(subtotalCents, percent) {
    const subtotal = Math.max(0, Math.round(Number(subtotalCents) || 0));
    const bounded = Math.min(Math.max(Number(percent) || 0, 0), 100);
    return Math.min(subtotal, Math.round(subtotal * bounded / 100));
  }

  function calculateMarginPercent(salePriceCents, costCents) {
    const sale = Math.max(0, Number(salePriceCents) || 0);
    const cost = Math.max(0, Number(costCents) || 0);
    if (!sale) return 0;
    return Number((((sale - cost) / sale) * 100).toFixed(2));
  }

  function normalizeSearch(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();
  }

  function filterProducts(products, query = '', categoryId = '') {
    const needle = normalizeSearch(query);
    return (Array.isArray(products) ? products : []).filter((product) => {
      if (categoryId && String(product.categoryId || '') !== String(categoryId)) return false;
      if (!needle) return true;
      const haystack = normalizeSearch([product.name, product.sku, product.barcode].filter(Boolean).join(' '));
      return haystack.includes(needle);
    });
  }

  function paymentMethodFromUi(value) {
    const key = String(value || '').trim().toLowerCase();
    return ({ cash: 'CASH', money: 'CASH', pix: 'PIX', card: 'CREDIT_CARD', credit: 'CREDIT_CARD', debit: 'DEBIT_CARD', tef: 'CREDIT_CARD', storecredit: 'STORE_CREDIT' })[key] || 'OTHER';
  }

  return {
    HOME_TILES,
    GLOBAL_SHORTCUTS,
    CHECKOUT_SHORTCUTS,
    STATUS_LABELS,
    FULFILLMENT_LABELS,
    DEVICE_TYPE_LABELS,
    PAYMENT_METHOD_LABELS,
    statusLabel,
    fulfillmentLabel,
    deviceTypeLabel,
    selectCheckoutRestoreSale,
    paymentMethodLabel,
    resolveShortcut,
    formatCents,
    parseCurrencyToCents,
    calculateCashChange,
    percentageToDiscountCents,
    calculateMarginPercent,
    normalizeSearch,
    filterProducts,
    paymentMethodFromUi
  };
});
