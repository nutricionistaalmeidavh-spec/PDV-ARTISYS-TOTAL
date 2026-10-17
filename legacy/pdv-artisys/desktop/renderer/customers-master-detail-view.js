'use strict';

(function attach(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PdvCustomersMasterDetail = api;
})(typeof window !== 'undefined' ? window : globalThis, function factory() {
  const CUSTOMERS_UX_LEVEL = 4;
  const CUSTOMERS_UX_GUARDS = Object.freeze({
    canonicalRenderer: true,
    lifecycleOwned: true,
    legacyFallbackRemoved: true,
    parityGuarded: true,
    crossFlowGuarded: true,
    releaseRegressionGuarded: true
  });

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  })[char]);

  function creditSnapshot(customer = {}) {
    const limitCents = Math.max(Number(customer.creditLimitCents || 0), 0);
    const usedCents = Math.max(Number(customer.creditUsedCents || 0), 0);
    return {
      limitCents,
      usedCents,
      availableCents: Math.max(limitCents - usedCents, 0)
    };
  }

  function saleTimestamp(sale = {}) {
    const value = sale.completedAt || sale.cancelledAt || sale.openedAt || '';
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function salesForCustomer(sales = [], customerId = '') {
    const id = String(customerId || '');
    if (!id) return [];
    return (Array.isArray(sales) ? sales : [])
      .filter(sale => String(sale?.customerId || '') === id)
      .slice()
      .sort((a, b) => saleTimestamp(b) - saleTimestamp(a));
  }

  function latestSaleForCustomer(sales = [], customerId = '') {
    return salesForCustomer(sales, customerId)[0] || null;
  }

  function formatAddress(address) {
    if (!address || typeof address !== 'object') return '—';
    const parts = [];
    const streetLine = [address.street, address.number].filter(Boolean).join(', ');
    if (streetLine) parts.push(streetLine);
    if (address.complement) parts.push(String(address.complement));
    if (address.district) parts.push(String(address.district));
    const cityState = [address.city, address.state].filter(Boolean).join('/');
    if (cityState) parts.push(cityState);
    if (address.postalCode) parts.push(`CEP ${address.postalCode}`);
    if (address.reference) parts.push(`Ref. ${address.reference}`);
    return parts.join(' · ') || '—';
  }

  function renderHistory(sales, { formatCents, formatDate, hasMore = false, loading = false } = {}) {
    const money = typeof formatCents === 'function' ? formatCents : value => String(value ?? 0);
    const when = typeof formatDate === 'function' ? formatDate : value => String(value || '—');
    const rows = sales.map(sale => `<li class="customers-history-item"><div><strong>${esc(sale.saleNumber || sale.id || 'Venda')}</strong><small>${esc(when(sale.completedAt || sale.openedAt))}</small></div><strong>${esc(money(sale.totalCents || 0))}</strong></li>`).join('');
    const more = hasMore
      ? `<button type="button" class="secondary-button customers-history-more" data-action="customer-history-more"${loading ? ' disabled' : ''}>${loading ? 'Carregando…' : 'Carregar mais'}</button>`
      : '';
    return `<section class="customers-history" data-customer-history-panel><div class="customers-history__head"><strong>Histórico de compras</strong><small>${sales.length} venda${sales.length === 1 ? '' : 's'} vinculada${sales.length === 1 ? '' : 's'}</small></div>${rows ? `<ul>${rows}</ul>` : '<p>Nenhuma venda concluída vinculada a este cliente.</p>'}${more}</section>`;
  }

  function renderCustomerDetail({
    customer = null,
    sales = [],
    components,
    formatCents = value => String(value ?? 0),
    formatDate = value => String(value || '—'),
    historyOpen = false,
    historyHasMore = false,
    historyLoading = false
  } = {}) {
    if (!components?.DetailPanel) throw new Error('DetailPanel da ArtiSys indisponível para Clientes.');
    if (!customer) {
      return components.DetailPanel({
        empty:{
          title:'Selecione um cliente',
          description:'Escolha um registro da lista para consultar os detalhes sem sair da busca.'
        }
      });
    }

    const credit = creditSnapshot(customer);
    const customerSales = salesForCustomer(sales, customer.id);
    const latest = customerSales[0] || customer.lastSale || null;
    const panel = components.DetailPanel({
      eyebrow:'Cliente',
      title:customer.name || 'Cliente sem nome',
      subtitle:customer.document || 'Sem CPF/CNPJ informado',
      badge:{ label:customer.active === false ? 'Inativo' : 'Ativo', tone:customer.active === false ? 'muted' : 'success' },
      fields:[
        { label:'CPF / CNPJ', value:customer.document || '—' },
        { label:'Telefone', value:customer.phone || '—' },
        { label:'E-mail', value:customer.email || '—' },
        { label:'Limite de crédito', value:formatCents(credit.limitCents) },
        { label:'Crédito utilizado', value:formatCents(credit.usedCents) },
        { label:'Crédito disponível', value:formatCents(credit.availableCents) },
        { label:'Última compra', value:latest ? formatDate(latest.completedAt || latest.openedAt) : 'Sem compras' },
        { label:'Endereço de entrega', value:formatAddress(customer.address) },
        { label:'Observações', value:customer.notes || '—' }
      ],
      actions:[
        { key:'edit-customer', label:'Editar ficha', primary:true, entityId:customer.id },
        { key:'customer-history', label:historyOpen ? 'Ocultar histórico' : 'Ver histórico', entityId:customer.id }
      ]
    });

    return `<div class="customers-detail-stack">${panel}${historyOpen ? renderHistory(customerSales, { formatCents, formatDate, hasMore:historyHasMore, loading:historyLoading }) : ''}</div>`;
  }

  return Object.freeze({
    CUSTOMERS_UX_LEVEL,
    CUSTOMERS_UX_GUARDS,
    creditSnapshot,
    salesForCustomer,
    latestSaleForCustomer,
    formatAddress,
    renderCustomerDetail
  });
});
