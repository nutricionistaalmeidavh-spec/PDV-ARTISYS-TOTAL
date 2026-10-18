'use strict';

(() => {
  const root = window;
  const { ApiClient } = root.PdvApiClient || {};
  if (!ApiClient) return;

  const api = new ApiClient();
  const ui = root.PdvUiModel;
  const modal = root.PdvModal;
  const content = document.getElementById('route-content');
  let config = null;
  let storeTimeZone = 'America/Sao_Paulo';
  let state = { view:'overview',fromDate:'',toDate:'',sellerId:'',customerId:'',productId:'',paymentMethod:'',locationId:'' };
  let webReportContextKey = '';
  let lastWebReportRequest = 0;
  const webReportViews = new Set(['overview','products','payments','inventory','cash','finance','margins','details','coverage','targets']);
  // Keep only presentation preferences per tenant/branch in this browser tab.
  // Never persist monetary aggregates, customer IDs, or authorization data.
  function restoreWebReportContext() {
    const context = String(api.tenantId||'')+'/'+String(api.branchId||'');
    if(webReportContextKey===context)return;
    webReportContextKey=context;
    state={view:'overview',fromDate:'',toDate:'',sellerId:'',customerId:'',
      productId:'',paymentMethod:'',locationId:'',detailOffset:0};
    try {
      const saved=JSON.parse(root.sessionStorage?.getItem('pdv-total.report-view.v1:'+context)||'null');
      if(saved&&webReportViews.has(saved.view))state.view=saved.view;
      if(saved&&/^\d{4}-\d{2}-\d{2}$/.test(saved.fromDate)&&
        /^\d{4}-\d{2}-\d{2}$/.test(saved.toDate)&&saved.fromDate<=saved.toDate){
        state.fromDate=saved.fromDate;state.toDate=saved.toDate;
      }
    } catch {}
  }
  function saveWebReportView() {
    try {root.sessionStorage?.setItem('pdv-total.report-view.v1:'+webReportContextKey,
      JSON.stringify({view:state.view,fromDate:state.fromDate,toDate:state.toDate}));} catch {}
  }

  const PAYMENT_LABELS = Object.freeze({
    CASH:'Dinheiro',PIX:'PIX',DEBIT_CARD:'Cartão de débito',CREDIT_CARD:'Cartão de crédito',STORE_CREDIT:'Crediário / crédito da loja',OTHER:'Outros'
  });
  const MOVEMENT_LABELS = Object.freeze({ OPENING:'Abertura',SUPPLY:'Suprimento',WITHDRAWAL:'Sangria / saída',SALE:'Venda',REVERSAL:'Estorno / devolução' });
  const VIEW_LABELS = Object.freeze({
    overview:'Visão geral',customers:'Venda por cliente',products:'Venda por produto',payments:'Por meio de pagamento',inventory:'Estoque mínimo / compra',cash:'Entradas e saídas do caixa',commissions:'Comissões'
  });
  const SELLER_FILTER_VIEWS = new Set(['overview','customers','products','payments','commissions']);
  const PERIOD_FILTER_VIEWS = new Set(['overview','customers','products','payments','cash','commissions']);
  const PRODUCT_ANALYTIC_EXPORT_FIELDS = Object.freeze(['Desconto rateado','Base do custo','Custo médio unitário']);

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g,char => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
  }
  function money(value) {
    return ui?.formatCents ? ui.formatCents(value) : (Number(value || 0) / 100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  }
  function qty(value) { return Number(value || 0).toLocaleString('pt-BR',{maximumFractionDigits:3}); }
  function when(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});
  }
  function centsInput(value) {
    const text = String(value ?? '').trim().replace(/\./g,'').replace(',','.');
    const number = Number(text);
    return Number.isFinite(number) ? Math.round(number * 100) : 0;
  }
  function showToast(message,type='') {
    root.PdvToast?.show?.(message,type);
  }
  function metric(label,value,hint='') {
    return `<article class="ops-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</article>`;
  }
  function empty(message,cols=1) { return `<tr><td colspan="${cols}"><div class="ops-empty">${escapeHtml(message)}</div></td></tr>`; }
  function paymentLabel(method) { return PAYMENT_LABELS[method] || method || 'Outros'; }
  function movementLabel(type) { return MOVEMENT_LABELS[type] || type || 'Movimento'; }
  function dateValueUtc(date) { return `${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}-${String(date.getUTCDate()).padStart(2,'0')}`; }
  function businessToday(reference=new Date()) { return root.PdvBusinessDate.localBusinessDate(reference,storeTimeZone); }
  function canonicalDateObject(value) {
    const match=String(value||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if(!match)throw new Error('Data comercial inválida.');
    return new Date(Date.UTC(Number(match[1]),Number(match[2])-1,Number(match[3])));
  }
  function csvCell(value) {
    const text = String(value ?? '');
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g,'""')}"` : text;
  }
  function downloadCsvText(name,text) {
    const blob = new Blob([`\uFEFF${String(text||'')}`],{type:'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }
  function downloadCsv(name,headers,rows) {
    const lines = [headers.map(csvCell).join(';'),...rows.map(row => row.map(csvCell).join(';'))];
    downloadCsvText(name,`${lines.join('\n')}\n`);
  }
  async function ready() {
    if (!config) {
      config = await api.initialize();
      try {
        const rows = await api.settings({ scope:'global',prefix:'store.timeZone' });
        const configured = Array.isArray(rows) ? rows.find(row => row.key === 'store.timeZone')?.value : '';
        if (configured) storeTimeZone = String(configured);
      } catch {}
    }
    return config;
  }
  function routeActive() { return document.body.dataset.activeRoute === 'reports'; }
  function markActive() {
    document.body.dataset.activeRoute = 'reports';
    document.body.classList.remove('theme-home');
    document.querySelectorAll('[data-route]').forEach(node => node.classList.toggle('active',node.dataset.route === 'reports'));
  }
  function costBasisLabel(value) {
    if (value === 'HISTORICAL_SNAPSHOT') return 'Histórico (snapshot)';
    if (value === 'ESTIMATED_CURRENT') return 'Estimado pelo custo atual';
    if (value === 'MIXED') return 'Misto: histórico + estimativa';
    return 'Não informado';
  }
  function marginPresentation(sales) {
    if (sales.costBasis === 'ESTIMATED_CURRENT') return { label:'Margem estimada',hint:'Vendas legadas sem snapshot usam o custo atual cadastrado' };
    if (sales.costBasis === 'MIXED') return { label:'Margem parcialmente estimada',hint:'Combina custos históricos congelados e estimativas de vendas legadas' };
    return { label:'Margem histórica',hint:'Custos congelados no momento da venda' };
  }
  function selectedInventory(inventory) {
    if (state.locationId) return inventory.locationSummaries?.[state.locationId] || inventory;
    return inventory.allLocationsSummary || inventory;
  }

  function selectedCustomerRows(sales) {
    const rows = sales.customerSales || [];
    return state.customerId ? rows.filter(row => (row.customerId || '__WALK_IN__') === state.customerId) : rows;
  }
  function selectedProductRows(sales) {
    const rows = sales.productSales || [];
    return state.productId ? rows.filter(row => row.productId === state.productId) : rows;
  }
  function selectedPaymentRows(sales) {
    const rows = sales.paymentMethods || [];
    return state.paymentMethod ? rows.filter(row => row.method === state.paymentMethod) : rows;
  }


  function marginPercent(row) {
    const revenue=Number(row?.netCents ?? row?.netSalesCents ?? 0);
    return revenue ? Number(((Number(row?.estimatedMarginCents||0)/revenue)*100).toFixed(2)) : 0;
  }

  function comparisonPercent(current,previous) {
    const base=Number(previous||0),value=Number(current||0);
    if(base===0)return value===0?0:null;
    return ((value-base)/Math.abs(base))*100;
  }

  function comparisonText(current,previous) {
    const delta=comparisonPercent(current,previous);
    if(delta==null)return 'Sem base no período anterior';
    const prefix=delta>0?'+':'';
    return `${prefix}${delta.toLocaleString('pt-BR',{maximumFractionDigits:1})}% vs período anterior`;
  }

  function managerMetric(label,value,current,previous,hint='') {
    const compare=comparisonText(current,previous);
    return `<article class="ops-metric report-v2-manager-metric"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(compare)}${hint?` · ${escapeHtml(hint)}`:''}</small></article>`;
  }

  function timelineRows(sales) {
    const totals=new Map();
    for(const event of sales.salesTimeline||[]) {
      const day=root.PdvBusinessDate.localBusinessDate(new Date(event.at),storeTimeZone);
      totals.set(day,(totals.get(day)||0)+Number(event.netCents||0));
    }
    const rows=[];
    const cursor=canonicalDateObject(state.fromDate),end=canonicalDateObject(state.toDate);
    while(cursor<=end) {
      const day=dateValueUtc(cursor);
      rows.push({day,netCents:totals.get(day)||0});
      cursor.setUTCDate(cursor.getUTCDate()+1);
    }
    return rows;
  }

  function trendView(sales) {
    const rows=timelineRows(sales);
    const max=Math.max(1,...rows.map(row=>Math.abs(Number(row.netCents||0))));
    return `<section class="ops-card report-print-section report-v2-trend"><div class="ops-card-head"><div><h2>Tendência de vendas líquidas</h2><p class="ops-muted">Vendas após descontos menos devoluções, agrupadas pela data comercial da loja.</p></div></div><div class="report-v2-trend-list">${rows.map(row=>{const width=Math.round((Math.abs(Number(row.netCents||0))/max)*100);return `<div class="report-v2-trend-row"><span>${escapeHtml(root.PdvBusinessDate.formatDatePtBr(row.day))}</span><div class="report-v2-trend-track"><i class="${row.netCents<0?'negative':''}" style="width:${width}%"></i></div><strong>${money(row.netCents)}</strong></div>`;}).join('')}</div></section>`;
  }

  function managerAlerts(sales,previousSales,inventory,cash) {
    const currentInventory=inventory?.allLocationsSummary||inventory||{};
    const alerts=[];
    if(Number(currentInventory.zeroStockCount||0)>0)alerts.push({title:'Produtos sem estoque',detail:`${currentInventory.zeroStockCount} item(ns) zerado(s) · consulte Estoque mínimo / compra`});
    if(Number(currentInventory.belowMinimumCount||0)>0)alerts.push({title:'Estoque abaixo do mínimo',detail:`${currentInventory.belowMinimumCount} item(ns) abaixo do mínimo · consulte Estoque mínimo / compra`});
    if(Number(cash?.divergentSessions||0)>0)alerts.push({title:'Divergência de caixa',detail:`${cash.divergentSessions} fechamento(s) · ${money(cash.divergenceCents||0)} · consulte Entradas e saídas do caixa`});
    const negativeMargin=(sales.productSales||[]).filter(row=>Number(row.netCents||0)>0&&Number(row.estimatedMarginCents||0)<0);
    if(negativeMargin.length)alerts.push({title:'Margem negativa',detail:`${negativeMargin.length} produto(s) com margem negativa · consulte Venda por produto`});
    if(previousSales&&Number(sales.returnedCents||0)>Number(previousSales.returnedCents||0))alerts.push({title:'Devoluções aumentaram',detail:comparisonText(sales.returnedCents,previousSales.returnedCents)});
    return alerts;
  }

  function presetPeriod(key,reference=businessToday()) {
    const end=canonicalDateObject(typeof reference==='string'?reference:businessToday(reference));
    const start=new Date(end);
    if(key==='last7')start.setUTCDate(start.getUTCDate()-6);
    else if(key==='month')start.setUTCDate(1);
    else if(key==='prev-month'){start.setUTCMonth(start.getUTCMonth()-1,1);end.setUTCDate(0);}
    return{fromDate:dateValueUtc(start),toDate:dateValueUtc(end)};
  }

  async function openSalesDrilldown(title,filters={}) {
    if(!modal?.open){showToast('Detalhamento indisponível.','error');return;}
    try{
      const from=new Date(`${state.fromDate}T00:00:00`).toISOString(),to=new Date(`${state.toDate}T23:59:59.999`).toISOString();
      const rows=await api.reportSalesDetails({from,to,sellerId:SELLER_FILTER_VIEWS.has(state.view)?state.sellerId||'':'',...filters});
      const body=`<p class="ops-muted">${escapeHtml(state.fromDate)} a ${escapeHtml(state.toDate)} · ${rows.length} venda${rows.length===1?'':'s'} encontrada${rows.length===1?'':'s'}.</p><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Venda</th><th>Data</th><th>Cliente</th><th>Vendedor</th><th>Pagamento</th><th>Total</th></tr></thead><tbody>${rows.map(row=>`<tr><td><strong>${escapeHtml(row.saleNumber)}</strong><small>${escapeHtml(row.saleId)}</small></td><td>${when(row.completedAt)}</td><td>${escapeHtml(row.customerName||'Consumidor não identificado')}</td><td>${escapeHtml(row.sellerName||'Não identificado')}</td><td>${escapeHtml((row.payments||[]).map(payment=>paymentLabel(payment.method)).join(' + ')||'—')}</td><td><strong>${money(row.totalCents)}</strong></td></tr>`).join('')||empty('Nenhuma venda encontrada para este recorte.',6)}</tbody></table></div>`;
      modal.open(title,body,{wide:true});
    }catch(error){showToast(error.message,'error');}
  }

  function navigateManagement() {
    if(root.PdvAppNavigation?.navigate){
      void root.PdvAppNavigation?.navigate?.('management');
      return;
    }
    void root.PdvErpFinanceUi?.renderManagement?.();
  }

  function overviewView(sales,previousSales,inventory,cash,previousRange) {
    const margin = marginPresentation(sales);
    const currentMarginPercent=marginPercent(sales);
    const previousMarginPercent=marginPercent(previousSales||{});
    const alerts=managerAlerts(sales,previousSales,inventory,cash);
    const topProducts=(sales.topProducts||[]).slice(0,5);
    const lowMargin=(sales.lowMarginProducts||[]).slice(0,5);
    const categories=(sales.categorySales||[]).slice(0,8);
    const previousLabel=previousRange
      ? `${root.PdvBusinessDate.formatDatePtBr(previousRange.previousFrom)} a ${root.PdvBusinessDate.formatDatePtBr(previousRange.previousTo)}`
      : 'sem base comparativa';
    return `<section class="ops-card report-print-section report-v2-manager-summary">
      <div class="ops-card-head"><div><h2>Resultado do período</h2><p class="ops-muted">Comparação com período anterior: ${escapeHtml(previousLabel)}.</p></div></div>
      <div class="ops-metrics report-v2-metrics report-v2-manager-kpis">
        ${managerMetric('Vendas líquidas',money(sales.netSalesCents||0),sales.netSalesCents,previousSales?.netSalesCents)}
        ${managerMetric('Ticket médio das vendas',money(sales.averageTicketCents||0),sales.averageTicketCents,previousSales?.averageTicketCents,'Após descontos, antes de devoluções')}
        ${managerMetric('Margem',`${money(sales.estimatedMarginCents||0)} · ${currentMarginPercent.toLocaleString('pt-BR',{maximumFractionDigits:2})}%`,sales.estimatedMarginCents,previousSales?.estimatedMarginCents,`${(currentMarginPercent-previousMarginPercent).toLocaleString('pt-BR',{maximumFractionDigits:2})} p.p. de Margem %`)}
        ${managerMetric('Vendas',String(sales.salesCount||0),sales.salesCount,previousSales?.salesCount)}
        ${managerMetric('Devoluções',money(sales.returnedCents||0),sales.returnedCents,previousSales?.returnedCents)}
        ${managerMetric('Descontos',money(sales.salesDiscountCents||0),sales.salesDiscountCents,previousSales?.salesDiscountCents)}
      </div>
      <p class="ops-muted report-v2-margin-note">${escapeHtml(margin.hint)}</p>
    </section>
    ${trendView(sales)}
    <div class="ops-grid two report-v2-manager-grid">
      <section class="ops-card report-print-section"><div class="ops-card-head"><div><h2>Atenção</h2><p class="ops-muted">Exceções objetivas que merecem revisão do gestor.</p></div></div><div class="report-v2-alerts">${alerts.map(alert=>`<article class="report-v2-alert"><div><strong>${escapeHtml(alert.title)}</strong><span>${escapeHtml(alert.detail)}</span></div></article>`).join('')||'<div class="ops-empty">Nenhuma exceção gerencial detectada neste recorte.</div>'}</div></section>
      <section class="ops-card report-print-section"><div class="ops-card-head"><div><h2>Clientes no período</h2><p class="ops-muted">Reconhecimento de recorrência sem criar uma regra artificial de inatividade.</p></div></div><div class="report-v2-client-stats"><div><strong>${sales.uniqueCustomersCount||0}</strong><span>Clientes únicos</span></div><div><strong>${sales.firstTimeCustomersCount||0}</strong><span>Primeira compra</span></div><div><strong>${sales.returningCustomersCount||0}</strong><span>Recorrentes</span></div><div><strong>${sales.customersWithoutSalesCount||0}</strong><span>${state.sellerId?'Sem compra com este vendedor':'Sem compra no período'}</span></div></div></section>
    </div>
    <div class="ops-grid two report-v2-manager-grid">
      <section class="ops-card report-print-section"><div class="ops-card-head"><div><h2>Mais vendidos</h2><p class="ops-muted">Ranking canônico já calculado pelo domínio de relatórios.</p></div></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Produto</th><th>Qtd.</th><th>Receita líquida</th></tr></thead><tbody>${topProducts.map(row=>`<tr><td><strong>${escapeHtml(row.productName)}</strong></td><td>${qty(row.netQuantity)}</td><td><strong>${money(row.netCents)}</strong></td></tr>`).join('')||empty('Sem produtos vendidos no período.',3)}</tbody></table></div></section>
      <section class="ops-card report-print-section"><div class="ops-card-head"><div><h2>Menor margem</h2><p class="ops-muted">Prioriza produtos com receita no período e menor Margem %.</p></div></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Produto</th><th>Margem</th><th>Margem %</th></tr></thead><tbody>${lowMargin.map(row=>`<tr><td><strong>${escapeHtml(row.productName)}</strong></td><td>${money(row.estimatedMarginCents)}</td><td><strong>${Number(row.marginPercent||0).toLocaleString('pt-BR',{maximumFractionDigits:2})}%</strong></td></tr>`).join('')||empty('Sem base de margem no período.',3)}</tbody></table></div></section>
    </div>
    <section class="ops-card report-print-section"><div class="ops-card-head"><div><h2>Categorias</h2><p class="ops-muted">Receita, custo e margem pela categoria atual do produto. A venda não possui snapshot histórico de categoria.</p></div></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Categoria</th><th>Receita líquida</th><th>Custo</th><th>Margem</th><th>Margem %</th></tr></thead><tbody>${categories.map(row=>`<tr><td><strong>${escapeHtml(row.categoryName)}</strong></td><td>${money(row.netCents)}</td><td>${money(row.estimatedCostCents)}</td><td>${money(row.estimatedMarginCents)}</td><td><strong>${Number(row.marginPercent||0).toLocaleString('pt-BR',{maximumFractionDigits:2})}%</strong></td></tr>`).join('')||empty('Sem categorias com movimento no período.',5)}</tbody></table></div></section>
    <div class="ops-grid two">
      <section class="ops-card report-print-section"><h2>Resumo por meio de pagamento</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Forma</th><th>Vendas</th><th>Transações</th><th>Recebido</th><th>Reembolsado</th><th>Líquido</th></tr></thead><tbody>${(sales.paymentMethods || []).map(row => `<tr><td>${escapeHtml(paymentLabel(row.method))}</td><td>${row.salesCount || 0}</td><td>${row.transactionCount || 0}</td><td>${money(row.grossCents)}</td><td>${money(row.refundCents)}</td><td><strong>${money(row.netCents)}</strong></td></tr>`).join('') || empty('Sem pagamentos no período.',6)}</tbody></table></div></section>
      <section class="ops-card report-print-section"><h2>Vendas por vendedor / garçom</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Vendedor</th><th>Vendas</th><th>Devoluções</th><th>Líquido</th><th>Canceladas</th></tr></thead><tbody>${(sales.sellers || []).map(row => `<tr><td>${escapeHtml(row.sellerName || row.sellerId || '—')}</td><td>${row.salesCount || 0}</td><td>${money(row.returnedCents || 0)}</td><td><strong>${money(row.salesCents || 0)}</strong></td><td>${row.cancelledSalesCount || 0} · ${money(row.cancelledSalesCents || 0)}</td></tr>`).join('') || empty('Sem vendas no período.',5)}</tbody></table></div></section>
    </div>
    <section class="ops-card report-print-section"><div class="ops-card-head"><div><h2>Operação por operador</h2><p class="ops-muted">Mostra quem registrou as vendas; vendedor/garçom continua sendo a dimensão comercial separada.</p></div></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Operador</th><th>Vendas</th><th>Vendas após descontos</th></tr></thead><tbody>${(sales.operators||[]).map(row=>`<tr><td><strong>${escapeHtml(row.operatorName||row.operatorId||'Não identificado')}</strong></td><td>${row.salesCount||0}</td><td><strong>${money(row.salesCents||0)}</strong></td></tr>`).join('')||empty('Sem operação no período.',3)}</tbody></table></div></section>
    <div class="report-v2-trace-actions report-v2-no-print"><button class="ops-secondary" type="button" data-report-drilldown="period">Ver vendas do período</button></div>`;
  }

  function customersView(sales) {
    const rows = selectedCustomerRows(sales);
    const options = (sales.customerSales || []).map(row => {
      const value = row.customerId || '__WALK_IN__';
      return `<option value="${escapeHtml(value)}" ${state.customerId === value ? 'selected' : ''}>${escapeHtml(row.customerName)}</option>`;
    }).join('');
    return `<section class="ops-card report-print-section"><div class="ops-card-head"><div><h2>Relatório de venda por cliente</h2><p class="ops-muted">Inclui consumidor não identificado. Devoluções reduzem o líquido; cancelamentos ficam separados.</p></div><label class="report-v2-inline-filter">Cliente<select id="report-customer-filter" class="ops-input"><option value="">Todos os clientes</option>${options}</select></label></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Cliente</th><th>Vendas</th><th>Bruto</th><th>Devoluções</th><th>Líquido</th><th>Ticket médio</th><th>Última venda</th><th>Canceladas</th><th></th></tr></thead><tbody>${rows.map(row => {const id=row.customerId||'__WALK_IN__';return `<tr><td><strong>${escapeHtml(row.customerName)}</strong></td><td>${row.salesCount}</td><td>${money(row.grossCents)}</td><td>${money(row.returnedCents)}</td><td><strong>${money(row.netCents)}</strong></td><td>${money(row.averageTicketCents)}</td><td>${when(row.lastSaleAt)}</td><td>${row.cancelledSalesCount || 0} · ${money(row.cancelledSalesCents || 0)}</td><td><button class="ops-link report-v2-no-print" type="button" data-report-drilldown="customer" data-drilldown-id="${escapeHtml(id)}">Ver vendas</button></td></tr>`;}).join('') || empty('Nenhum cliente com movimento no período.',9)}</tbody></table></div></section>`;
  }

  function productsView(sales) {
    const rows = selectedProductRows(sales);
    const options = (sales.productSales || []).map(row => `<option value="${escapeHtml(row.productId)}" ${state.productId === row.productId ? 'selected' : ''}>${escapeHtml(row.productName)}</option>`).join('');
    return `<section class="ops-card report-print-section"><div class="ops-card-head"><div><h2>Relatório de venda por produto</h2><p class="ops-muted">Indicadores para decisão; o CSV mantém o detalhamento analítico.</p></div><label class="report-v2-inline-filter">Produto<select id="report-product-filter" class="ops-input"><option value="">Todos os produtos</option>${options}</select></label></div><div class="ops-table-wrap"><table class="ops-table report-v2-products-table"><thead><tr><th>Produto</th><th>Qtd. líquida</th><th>Receita líquida</th><th>Custo</th><th>Margem</th><th>Margem %</th><th></th></tr></thead><tbody>${rows.map(row => `<tr><td><strong>${escapeHtml(row.productName)}</strong><small>${escapeHtml(row.sku || 'Sem SKU')} · ${escapeHtml(costBasisLabel(row.costBasis))}</small></td><td><strong>${qty(row.netQuantity)}</strong></td><td><strong>${money(row.netCents)}</strong></td><td>${money(row.estimatedCostCents)}</td><td><strong>${money(row.estimatedMarginCents)}</strong></td><td>${marginPercent(row).toLocaleString('pt-BR',{maximumFractionDigits:2})}%</td><td><button class="ops-link report-v2-no-print" type="button" data-report-drilldown="product" data-drilldown-id="${escapeHtml(row.productId)}">Ver vendas</button></td></tr>`).join('') || empty('Nenhum produto vendido no período.',7)}</tbody></table></div></section>`;
  }

  function paymentsView(sales) {
    const rows = selectedPaymentRows(sales);
    const methods = (sales.paymentMethods || []).map(row => `<option value="${escapeHtml(row.method)}" ${state.paymentMethod === row.method ? 'selected' : ''}>${escapeHtml(paymentLabel(row.method))}</option>`).join('');
    const gross = rows.reduce((sum,row) => sum + Number(row.grossCents || 0),0);
    const refunds = rows.reduce((sum,row) => sum + Number(row.refundCents || 0),0);
    return `<div class="ops-metrics report-v2-metrics">${metric('Recebido',money(gross))}${metric('Reembolsado',money(refunds))}${metric('Líquido',money(gross-refunds))}</div><section class="ops-card report-print-section"><div class="ops-card-head"><div><h2>Relatório por meio de pagamento</h2><p class="ops-muted">Vendas com pagamento misto aparecem em cada forma usada, somente pelo valor atribuído àquela forma.</p></div><label class="report-v2-inline-filter">Forma<select id="report-payment-filter" class="ops-input"><option value="">Todas as formas</option>${methods}</select></label></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Forma</th><th>Vendas</th><th>Transações</th><th>Recebido</th><th>Reembolsos</th><th>Líquido</th><th></th></tr></thead><tbody>${rows.map(row => `<tr><td><strong>${escapeHtml(paymentLabel(row.method))}</strong></td><td>${row.salesCount || 0}</td><td>${row.transactionCount || 0}</td><td>${money(row.grossCents)}</td><td>${money(row.refundCents)}</td><td><strong>${money(row.netCents)}</strong></td><td><button class="ops-link report-v2-no-print" type="button" data-report-drilldown="payment" data-drilldown-id="${escapeHtml(row.method)}">Ver vendas</button></td></tr>`).join('') || empty('Sem movimento nesta forma de pagamento.',7)}</tbody></table></div></section>`;
  }

  function inventoryView(inventory) {
    const current = selectedInventory(inventory);
    const rows = current.purchaseList || [];
    return `<div class="ops-metrics report-v2-metrics">${metric('Itens no mínimo/abaixo',String(current.lowStockCount || 0))}${metric('Abaixo do mínimo',String(current.belowMinimumCount || 0))}${metric('Sem estoque',String(current.zeroStockCount || 0))}${metric('Custo para recompor mínimo',money(current.suggestedPurchaseCostCents || 0),'Calculado separadamente por local')}</div><section class="ops-card report-print-section"><div class="ops-card-head"><div><h2>Produtos no estoque mínimo para compra</h2><p class="ops-muted">Posição atual por local. Saldo de outra loja ou depósito não esconde a falta neste local; a sugestão repõe até o mínimo configurado do produto.</p></div></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Local</th><th>Produto</th><th>SKU</th><th>Saldo</th><th>Mínimo</th><th>Falta p/ mínimo</th><th>Custo estimado</th><th>Situação</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.locationName || current.locationName || '—')}</td><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.sku || '—')}</td><td>${qty(row.quantity)} ${escapeHtml(row.unit || '')}</td><td>${qty(row.minimumStock)}</td><td>${qty(row.shortageToMinimum)}</td><td>${money(row.suggestedPurchaseCostCents)}</td><td>${row.zeroStock ? 'SEM ESTOQUE' : row.belowMinimum ? 'ABAIXO' : 'NO MÍNIMO'}</td></tr>`).join('') || empty('Nenhum produto atingiu o estoque mínimo neste recorte.',8)}</tbody></table></div></section>`;
  }

  function cashView(cash) {
    const rows = (cash.movements || []).filter(row => row.isPhysicalCash);
    return `<div class="ops-metrics report-v2-metrics">
      ${metric('Entradas operacionais em dinheiro',money(cash.operatingCashInCents || 0),`Vendas ${money(cash.cashSalesCents || 0)} · Suprimentos ${money(cash.suppliesCents || 0)}`)}
      ${metric('Saídas em dinheiro',money(cash.cashOutCents || 0),`Sangrias ${money(cash.withdrawalsCents || 0)} · Estornos/devoluções ${money(cash.cashReversalCents || 0)}`)}
      ${metric('Fluxo operacional líquido',money(cash.operatingNetCashFlowCents || 0),'Entradas operacionais menos saídas')}
      ${metric('Fundo de abertura',money(cash.openingCashCents || 0))}
      ${metric('Saldo esperado pelos movimentos',money(cash.expectedCashFromMovementsCents ?? cash.netCashFlowCents ?? 0),'Abertura + fluxo operacional')}
      ${metric('Divergência de fechamentos',money(cash.divergenceCents || 0),`${cash.divergentSessions || 0} sessões divergentes`)}
    </div><section class="ops-card report-print-section"><div class="ops-card-head"><div><h2>Dinheiro que entrou e saiu do caixa</h2><p class="ops-muted">Somente dinheiro físico. PIX e cartões não alteram este saldo. Sangrias, devoluções e cancelamentos reembolsados em dinheiro aparecem como saída.</p></div></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Terminal</th><th>Operador</th><th>Movimento</th><th>Observação</th><th>Entrada/Saída</th></tr></thead><tbody>${rows.map(row => `<tr><td>${when(row.createdAt)}</td><td>${escapeHtml(row.terminalId || '—')}</td><td>${escapeHtml(row.operatorName || row.operatorId || '—')}</td><td>${escapeHtml(movementLabel(row.type))}</td><td>${escapeHtml(row.note || '—')}</td><td><strong>${row.signedCents < 0 ? '− ' : '+ '}${money(Math.abs(row.signedCents || 0))}</strong></td></tr>`).join('') || empty('Sem movimento físico de dinheiro no período.',6)}</tbody></table></div></section>`;
  }

  function commissionsView(commissions,sellers,products,rules) {
    const rows = commissions?.sellers || [];
    const outstanding = rows.reduce((sum,row) => sum + Number(row.outstandingCents || 0),0);
    return `<div class="ops-metrics report-v2-metrics">
      ${metric('Comissões geradas',money(commissions?.totalEarnedCents || 0))}
      ${metric('Comissões estornadas',money(commissions?.totalReversedCents || 0))}
      ${metric('Comissões pagas no período',money(commissions?.totalPaidCents || 0))}
      ${metric('Em aberto',money(outstanding),'Saldo atual dos vendedores com movimento no período')}
    </div>
    <div class="ops-grid two">
      <section class="ops-card report-print-section"><h2>Comissões por vendedor / garçom</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Vendedor</th><th>Gerada</th><th>Estornada</th><th>Paga</th><th>Saldo do período</th><th>Em aberto</th><th class="report-v2-no-print"></th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHtml(row.sellerName)}</td><td>${money(row.earnedCents)}</td><td>${money(row.reversedCents)}</td><td>${money(row.paidCents)}</td><td>${money(row.periodBalanceCents)}</td><td><strong>${money(row.outstandingCents)}</strong></td><td class="report-v2-no-print"><button class="ops-link" data-pay-commission="${escapeHtml(row.sellerId)}" data-outstanding="${Number(row.outstandingCents || 0)}" ${Number(row.outstandingCents || 0) <= 0 ? 'disabled' : ''}>Registrar pagamento</button></td></tr>`).join('') || empty('Sem comissões no período.',7)}</tbody></table></div></section>
      <section class="ops-card report-v2-no-print"><h2>Regra de comissão</h2><form id="report-commission-rule" class="ops-form"><label>Vendedor / Garçom<select name="sellerId" class="ops-input" required>${sellers.map(seller => `<option value="${escapeHtml(seller.id)}">${escapeHtml(seller.name)}</option>`).join('')}</select></label><label>Produto específico<select name="productId" class="ops-input"><option value="">Regra padrão para todos os produtos</option>${products.map(product => `<option value="${escapeHtml(product.id)}">${escapeHtml(product.name)}</option>`).join('')}</select></label><label>Comissão (%)<input name="percent" class="ops-input" type="number" min="0" max="100" step="0.01" required></label><button class="ops-primary" type="submit">Salvar regra</button></form></section>
    </div>
    <section class="ops-card report-print-section"><h2>Regras cadastradas</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Vendedor</th><th>Aplicação</th><th>%</th><th>Status</th></tr></thead><tbody>${rules.map(rule => `<tr><td>${escapeHtml(rule.sellerName)}</td><td>${escapeHtml(rule.productName || 'Todos os produtos')}</td><td>${(Number(rule.commissionBps || 0) / 100).toLocaleString('pt-BR')}%</td><td>${rule.active ? 'Ativa' : 'Inativa'}</td></tr>`).join('') || empty('Nenhuma regra cadastrada.',4)}</tbody></table></div></section>`;
  }

  function currentCsv(sales,inventory,cash,commissions) {
    if (state.view === 'customers') return { name:'relatorio-vendas-por-cliente.csv',headers:['cliente','vendas','bruto_centavos','devolucoes_centavos','liquido_centavos','ticket_medio_centavos','ultima_venda','canceladas','canceladas_centavos'],rows:selectedCustomerRows(sales).map(r => [r.customerName,r.salesCount,r.grossCents,r.returnedCents,r.netCents,r.averageTicketCents,r.lastSaleAt || '',r.cancelledSalesCount || 0,r.cancelledSalesCents || 0]) };
    if (state.view === 'products') return { name:'relatorio-vendas-por-produto.csv',detailLabels:PRODUCT_ANALYTIC_EXPORT_FIELDS,headers:['produto','sku','quantidade_vendida','quantidade_devolvida','quantidade_liquida','linhas_antes_desconto_centavos','desconto_rateado_centavos','receita_apos_desconto_centavos','devolvido_centavos','liquido_centavos','custo_liquido_centavos','custo_medio_unitario_centavos','margem_centavos','base_custo'],rows:selectedProductRows(sales).map(r => [r.productName,r.sku || '',r.quantity,r.returnedQuantity,r.netQuantity,r.lineGrossCents || r.grossCents,r.discountCents || 0,r.grossCents,r.returnedCents,r.netCents,r.estimatedCostCents,r.averageUnitCostCents,r.estimatedMarginCents,r.costBasis]) };
    if (state.view === 'payments') return { name:'relatorio-por-meio-de-pagamento.csv',headers:['forma','vendas','transacoes','recebido_centavos','reembolsado_centavos','liquido_centavos'],rows:selectedPaymentRows(sales).map(r => [paymentLabel(r.method),r.salesCount,r.transactionCount,r.grossCents,r.refundCents,r.netCents]) };
    if (state.view === 'inventory') { const selected=selectedInventory(inventory); return { name:'relatorio-estoque-minimo-compra.csv',headers:['local','produto','sku','saldo','minimo','falta_para_minimo','custo_estimado_centavos','situacao'],rows:(selected.purchaseList || []).map(r => [r.locationName || selected.locationName || '',r.name,r.sku || '',r.quantity,r.minimumStock,r.shortageToMinimum,r.suggestedPurchaseCostCents,r.zeroStock ? 'SEM ESTOQUE' : r.belowMinimum ? 'ABAIXO' : 'NO MINIMO']) }; }
    if (state.view === 'cash') return { name:'relatorio-fluxo-caixa-dinheiro.csv',headers:['data','terminal','operador','movimento','observacao','valor_assinado_centavos'],rows:(cash.movements || []).filter(r => r.isPhysicalCash).map(r => [r.createdAt,r.terminalId || '',r.operatorName || r.operatorId || '',movementLabel(r.type),r.note || '',r.signedCents]) };
    if (state.view === 'commissions') return { name:'relatorio-comissoes.csv',headers:['vendedor','gerada_centavos','estornada_centavos','paga_centavos','saldo_periodo_centavos','em_aberto_centavos'],rows:(commissions?.sellers || []).map(r => [r.sellerName,r.earnedCents,r.reversedCents,r.paidCents,r.periodBalanceCents,r.outstandingCents]) };
    return { name:'relatorio-resumo-vendas.csv',headers:['indicador','valor'],rows:[['subtotal_antes_descontos_centavos',sales.subtotalSalesCents || sales.grossSalesCents || 0],['descontos_centavos',sales.salesDiscountCents || 0],['vendas_apos_descontos_centavos',sales.grossSalesCents || 0],['devolucoes_centavos',sales.returnedCents || 0],['vendas_liquidas_centavos',sales.netSalesCents || 0],['ticket_medio_centavos',sales.averageTicketCents || 0],['margem_centavos',sales.estimatedMarginCents || 0],['margem_percentual',marginPercent(sales)],['clientes_unicos',sales.uniqueCustomersCount || 0],['clientes_primeira_compra',sales.firstTimeCustomersCount || 0],['clientes_recorrentes',sales.returningCustomersCount || 0],['clientes_sem_compra_periodo',sales.customersWithoutSalesCount || 0],['base_custo',sales.costBasis || 'HISTORICAL_SNAPSHOT'],['cancelamentos_centavos',sales.cancelledSalesCents || 0]] };
  }

  function filterForm(sellers,inventory) {
    if (state.view === 'inventory') {
      const options=(inventory.locations||[]).map(location=>`<option value="${escapeHtml(location.id)}" ${state.locationId===location.id?'selected':''}>${escapeHtml(location.name)}</option>`).join('');
      return `<section class="ops-card report-v2-filter-card"><div class="report-v2-filter"><label>Local de estoque<select id="report-location-filter" class="ops-input"><option value="" ${state.locationId?'':'selected'}>Todos os locais</option>${options}</select></label><div class="report-v2-filter-note"><strong>Posição atual do estoque</strong><span>Período e vendedor/garçom não se aplicam a este relatório.</span></div></div></section>`;
    }
    if (!PERIOD_FILTER_VIEWS.has(state.view)) {
      return `<section class="ops-card report-v2-filter-card"><strong>Posição atual do estoque</strong><p class="ops-muted">Período e vendedor/garçom não se aplicam a este relatório.</p></section>`;
    }
    const sellerField = SELLER_FILTER_VIEWS.has(state.view)
      ? `<label>Vendedor / Garçom<select name="sellerId" class="ops-input"><option value="">Todos</option>${sellers.map(s => `<option value="${escapeHtml(s.id)}" ${s.id === state.sellerId ? 'selected' : ''}>${escapeHtml(s.name)}</option>`).join('')}</select></label>`
      : `<div class="report-v2-filter-note"><strong>Caixa físico</strong><span>O filtro de vendedor/garçom não se aplica a sangrias, suprimentos e fundo de abertura.</span></div>`;
    return `<section class="ops-card report-v2-filter-card"><div class="report-v2-period-presets" aria-label="Atalhos de período"><button type="button" class="ops-secondary" data-report-period="today">Hoje</button><button type="button" class="ops-secondary" data-report-period="last7">Últimos 7 dias</button><button type="button" class="ops-secondary" data-report-period="month">Este mês</button><button type="button" class="ops-secondary" data-report-period="prev-month">Mês anterior</button></div><form id="report-v2-filter" class="report-v2-filter" novalidate><label>Data inicial<input name="fromDate" type="text" inputmode="numeric" autocomplete="off" data-date-ptbr class="ops-input" placeholder="dd/mm/aaaa" value="${escapeHtml(root.PdvBusinessDate.formatDatePtBr(state.fromDate))}" required></label><label>Data final<input name="toDate" type="text" inputmode="numeric" autocomplete="off" data-date-ptbr class="ops-input" placeholder="dd/mm/aaaa" value="${escapeHtml(root.PdvBusinessDate.formatDatePtBr(state.toDate))}" required></label>${sellerField}<button class="ops-primary" type="submit">Aplicar período</button></form></section>`;
  }

  function printMeta(sellers,inventory) {
    if (state.view === 'inventory') {
      const selected=selectedInventory(inventory);
      return `Posição atual · Local: ${selected.locationName || 'Todos os locais'} · período e vendedor não se aplicam`;
    }
    const periodText = `${root.PdvBusinessDate.formatDatePtBr(state.fromDate)} a ${root.PdvBusinessDate.formatDatePtBr(state.toDate)}`;
    if (!SELLER_FILTER_VIEWS.has(state.view)) return `${periodText} · vendedor/garçom não se aplica ao caixa físico`;
    const sellerName = sellers.find(row => row.id === state.sellerId)?.name || 'Todos';
    return `${periodText} · Vendedor/Garçom: ${sellerName}`;
  }


  // Web mode stays within the original PdvReportsV2 route owner and state.
  // Backend D1 aggregates are authoritative; no replica or browser-side ledger.
  async function renderWebReports(next={}){
    const requestId=++lastWebReportRequest;
    await ready();
    restoreWebReportContext();
    state={...state,...next};
    markActive();
    const date=businessToday();
    if(!state.fromDate)state.fromDate=date.slice(0,8)+'01';
    if(!state.toDate)state.toDate=date;
    const fromDate=state.fromDate,toDate=state.toDate;
    const query=new URLSearchParams({from:fromDate,to:toDate});
    const available=['overview','products','payments','inventory','cash','finance','margins','details','coverage','targets'];
    if(!available.includes(state.view))state.view='overview';
    saveWebReportView();
    let report,comparison=null,trend=null,margin=null,detail=null,coverage=null,ranking=null,sellersForGoals=[];
    try{
      const previous=root.PdvBusinessDate.equivalentPreviousPeriod(fromDate,toDate);
      const spanDays=Math.round((Date.parse(toDate+'T00:00:00Z')-Date.parse(fromDate+'T00:00:00Z'))/86400000)+1;
      [report,comparison,trend,margin,detail,coverage,ranking,sellersForGoals]=await Promise.all([
        api.request('/api/v1/reports/summary?'+query.toString()),
        state.view==='overview'?api.compareSalesPeriods({
          from:fromDate,to:toDate,compareFrom:previous.previousFrom,compareTo:previous.previousTo
        }).catch(()=>null):Promise.resolve(null),
        state.view==='overview'&&spanDays>=1&&spanDays<=90?api.dailySalesTrend({from:fromDate,to:toDate}):Promise.resolve(null),
        state.view==='margins'?api.historicalMarginReport({from:fromDate,to:toDate}):Promise.resolve(null),
        state.view==='details'?api.reportSalesDetailsCanonical({from:fromDate,to:toDate,
          sellerId:state.sellerId||'',customerId:state.customerId||'',
          productId:state.productId||'',paymentMethod:state.paymentMethod||'',
          limit:50,offset:state.detailOffset||0}):Promise.resolve(null),
        state.view==='coverage'?api.reportStockCoverage({asOf:toDate,days:30}):Promise.resolve(null),
        state.view==='targets'?api.sellerSalesRanking({month:state.goalMonth||toDate.slice(0,7)}):Promise.resolve(null),
        state.view==='targets'?api.sellers():Promise.resolve([])
      ]);
    }catch(error){
      if(routeActive()&&requestId===lastWebReportRequest)content.innerHTML=`<section class="ops-page report-v2-page">
        <header class="ops-head"><div><h1>Relatórios</h1><p>Não foi possível consultar os dados.</p></div></header>
        <section class="ops-card"><div class="ops-empty">${escapeHtml(error.message)}</div></section></section>`;
      return;
    }
    if(!routeActive()||requestId!==lastWebReportRequest)return;
    const sale=report.sales||{},cash=report.cash||[],inventory=report.inventory||[],
      payments=report.methodTotals||[],products=report.products||[],finance=report.finance||{};
    const total=Number(sale.totalCents)||0,count=Number(sale.count)||0;
    const value=(v)=>money(Number(v)||0);
    const viewLabels={overview:'Visão geral',products:'Produtos',payments:'Recebimentos',
      inventory:'Estoque',cash:'Caixa',finance:'Financeiro',margins:'Margem histórica',details:'Vendas detalhadas',coverage:'Cobertura do estoque',targets:'Metas e ranking'};
    const table=(heads,rows,colspan=heads.length)=>`<div class="ops-table-wrap"><table class="ops-table">
      <thead><tr>${heads.map(x=>`<th>${escapeHtml(x)}</th>`).join('')}</tr></thead><tbody>
      ${rows.length?rows.join(''):`<tr><td colspan="${colspan}"><div class="ops-empty">Nenhum registro neste período.</div></td></tr>`}
      </tbody></table></div>`;
    const productsTable=()=>table(['Produto','Unidades','Vendas','Valor bruto'],products.map(p=>`<tr>
      <td>${escapeHtml(p.name)}</td><td>${qty(p.quantity)}</td><td>${p.salesCount}</td>
      <td>${value(p.grossCents)}</td></tr>`));
    const paymentsTable=()=>table(['Forma','Recebido'],payments.map(p=>`<tr>
      <td>${escapeHtml(paymentLabel(p.method))}</td><td>${value(p.amountCents)}</td></tr>`));
    const inventoryTable=()=>table(['Produto','SKU','Saldo'],inventory.map(p=>`<tr>
      <td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.sku)}</td><td>${qty(p.quantity)}</td></tr>`));
    const cashTable=()=>table(['Abertura','Fechamento','Esperado','Contado','Divergência'],cash.map(s=>`<tr>
      <td>${when(s.openedAt)}</td><td>${when(s.closedAt)}</td>
      <td>${value(s.expectedCashCents)}</td><td>${s.countedCashCents==null?'—':value(s.countedCashCents)}</td>
      <td>${s.divergenceCents==null?'—':value(s.divergenceCents)}</td></tr>`));
    const financeTable=()=>`<div class="ops-metrics">
      ${metric('A pagar',value(finance.payableOpenCents))}
      ${metric('A receber',value(finance.receivableOpenCents))}
      ${metric('Pago',value(finance.payableSettledCents))}
      ${metric('Recebido',value(finance.receivableSettledCents))}
      </div><p class="ops-muted">Estes valores vêm de contas manuais. Vendas do balcão aparecem separadas no resumo comercial.</p>`;
    const comparisonHint=comparison?.delta?.percentage==null
      ?'Sem base comparativa no período anterior'
      :(comparison.delta.percentage>=0?'+':'')+comparison.delta.percentage.toLocaleString('pt-BR')+'% em relação ao período anterior';
    const marginsTable=()=>{
      if(!margin)return '<p class="ops-muted">Selecione um período para consultar os custos históricos.</p>';
      const summary=`<div class="ops-metrics">
        ${metric('Receita líquida',value(margin.revenueCents))}
        ${metric('Custo histórico identificado',value(margin.costCents))}
        ${metric('Margem sobre custos conhecidos',margin.marginCents==null?'Indeterminada':value(margin.marginCents),
          margin.missingCostLines?'Há '+margin.missingCostLines+' linha(s) sem custo histórico confiável.':'Custo congelado na conclusão das vendas')}
        ${metric('Devoluções',value(margin.returnedCents))}
      </div>`;
      return summary+table(['Produto','Qtd. líquida','Receita líquida','Custo registrado','Margem','Base do custo'],
        (margin.products||[]).map(p=>`<tr>
        <td>${escapeHtml(p.name)}</td><td>${qty(p.quantity)}</td><td>${value(p.revenueCents)}</td>
        <td>${value(p.costCents)}</td>
        <td>${p.marginCents==null?'Não apurada':value(p.marginCents)}</td>
        <td>${p.missingCostLines?'Histórico incompleto':'Snapshot da venda'}</td></tr>`));
    };
    const detailFilters=()=>`<form id="web-report-detail-filter" class="ops-form">
      <div class="ops-grid two">
        <label>Vendedor (ID)<input name="sellerId" class="ops-input" value="${escapeHtml(state.sellerId||'')}"></label>
        <label>Cliente (ID)<input name="customerId" class="ops-input" value="${escapeHtml(state.customerId||'')}"></label>
        <label>Produto (ID)<input name="productId" class="ops-input" value="${escapeHtml(state.productId||'')}"></label>
        <label>Meio de pagamento<select name="paymentMethod" class="ops-input">
          ${[['','Todos'],...Object.entries(PAYMENT_LABELS)].map(([v,label])=>`<option value="${v}" ${state.paymentMethod===v?'selected':''}>${escapeHtml(label)}</option>`).join('')}</select></label>
      </div><button class="ops-secondary" type="submit">Filtrar detalhes</button></form>`;
    const detailedTable=()=>{
      if(!detail)return '<p>Selecione um período.</p>';
      return detailFilters()+`<p class="ops-muted">${detail.total} vendas com os filtros aplicados. ${detail.limit} por página.</p>`+
        table(['Venda','Data','Vendedor','Cliente','Itens','Pagamento','Total','Situação'],
          (detail.items||[]).map(sale=>`<tr>
          <td>${escapeHtml(sale.saleNumber)}</td><td>${when(sale.completedAt)}</td>
          <td>${escapeHtml(sale.sellerId||'—')}</td>
          <td>${escapeHtml(sale.customerId||'Consumidor')}</td>
          <td>${escapeHtml((sale.items||[]).map(i=>[i.sku+' × '+qty(i.quantity),i.configuration?.variant?.name,...(i.configuration?.options||[]).map(o=>o.name),i.note||''].filter(Boolean).join(' / ')).join(' · '))}</td>
          <td>${escapeHtml((sale.payments||[]).map(x=>paymentLabel(x.method)).join(' + '))}</td>
          <td>${value(sale.netTotalCents??sale.totalCents)}</td>
          <td>${escapeHtml(sale.status)}</td></tr>`))+
        `<div class="ops-actions">
          <button class="ops-secondary" type="button" data-report-details-page="-1" ${detail.offset===0?'disabled':''}>Anterior</button>
          <button class="ops-secondary" type="button" data-report-details-page="1" ${detail.offset+detail.items.length>=detail.total?'disabled':''}>Próxima</button></div>`;
    };
    const coverageTable=()=>{
      if(!coverage)return '<p>Selecione um período.</p>';
      const canManage=Boolean(root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,'inventory.adjust'));
      const minimumForm=canManage?`<form id="web-stock-minimum" class="ops-form report-v2-no-print">
        <h3>Estoque mínimo por filial</h3><p class="ops-muted">O mínimo é configurado por produto nesta filial. Não altera o saldo real nem cria pedido automático.</p>
        <div class="ops-grid two"><label>Produto<select name="productId" class="ops-input" required>
          ${(coverage.products||[]).map(p=>`<option value="${escapeHtml(p.productId)}">${escapeHtml(p.name)} · ${escapeHtml(p.sku)} (${p.minimumQuantity==null?'Sem mínimo':'Mínimo '+qty(p.minimumQuantity)})</option>`).join('')}
        </select></label>
        <label>Quantidade mínima<input type="number" name="minimum" class="ops-input" min="0" max="100000" step="0.001" inputmode="decimal" placeholder="Ex.: 5" required></label></div>
        <p role="status" class="web-form-feedback"></p><div class="ops-actions">
          <button class="ops-primary" type="submit" ${coverage.products.length?'':'disabled'}>Salvar mínimo</button>
          <button class="ops-secondary" type="button" id="web-stock-minimum-clear" ${coverage.products.length?'':'disabled'}>Remover mínimo</button>
        </div></form>`:'';
      return `<p class="ops-muted">Consumo efetivo: ${escapeHtml(coverage.period.from)} a ${escapeHtml(coverage.period.to)}.
        Cobertura estimada por consumo líquido de vendas/devoluções e disponibilidade após reservas.
        Produtos sem mínimo configurado não recebem alertas fictícios.</p>`+
        `<div class="ops-metrics">
          ${metric('Sem disponibilidade',String(coverage.zeroOrReservedOut))}
          ${metric('Abaixo do mínimo',String(coverage.belowMinimum||0))}
          ${metric('No mínimo',String(coverage.atMinimum||0))}
          ${metric('Sem consumo no período',String(coverage.coverageUnknown))}
          ${metric('Mínimo não definido',String(coverage.unknownMinimum))}</div>`+
        table(['Produto','Disponível','Reservado','Consumo período','Cobertura (dias)','Mínimo cadastrado','Situação','Entradas por transferência','Saídas por transferência'],
          (coverage.products||[]).map(p=>`<tr>
          <td>${escapeHtml(p.name)} · ${escapeHtml(p.sku)}</td>
          <td>${qty(p.available)}</td><td>${qty(p.reserved)}</td><td>${qty(p.consumed)}</td>
          <td>${p.daysCoverage==null?'Sem base':qty(p.daysCoverage)}</td>
          <td>${p.minimumQuantity==null?'Não definido':qty(p.minimumQuantity)}</td>
          <td>${escapeHtml({BELOW_MINIMUM:'Abaixo do mínimo',AT_MINIMUM:'No mínimo',ABOVE_MINIMUM:'Acima do mínimo',NOT_CONFIGURED:'Não configurado'}[p.minimumStatus]||'Indefinido')}</td>
          <td>${qty(p.transfersIn)}</td><td>${qty(p.transfersOut)}</td></tr>`))+minimumForm;
    };
    const sellerTargetsView=()=>{
      if(!ranking)return '<p>Selecione o mês.</p>';
      const allSellers=Array.isArray(sellersForGoals)?sellersForGoals:[];
      return `<p class="ops-muted">Metas e vendas líquidas do mês ${escapeHtml(ranking.month)}.
        As devoluções são descontadas na data em que foram registradas; comissões são derivadas do livro imutável.</p>
        <form id="web-target-month" class="ops-form">
          <label>Mês de referência<input type="month" name="month" value="${escapeHtml(ranking.month)}" required class="ops-input"></label>
          <button type="submit" class="ops-secondary">Consultar</button>
        </form>
        ${table(['Vendedor','Vendas líquidas','Devoluções','Meta','Atingimento','Comissões geradas','Estornadas','Pagas','Saldo de comissões'],
          (ranking.sellers||[]).map(row=>`<tr>
            <td>${escapeHtml(row.sellerName||row.sellerId)}</td>
            <td>${value(row.netSalesCents)}</td><td>${value(row.refundedCents)}</td>
            <td>${row.targetCents==null?'Não definida':value(row.targetCents)}</td>
            <td>${row.progressPercent==null?'—':qty(row.progressPercent)+'%'}</td>
            <td>${value(row.commissionEarnedCents)}</td>
            <td>${value(row.commissionReversedCents)}</td>
            <td>${value(row.commissionPaidCents)}</td>
            <td>${value(row.commissionBalanceCents)}</td>
          </tr>`))}
        <form id="web-seller-target-form" class="ops-form">
          <h3>Definir meta mensal</h3>
          <div class="ops-grid two">
            <label>Vendedor<select class="ops-input" name="sellerId" required>
              ${allSellers.map(seller=>`<option value="${escapeHtml(seller.id)}">${escapeHtml(seller.name||seller.displayName||seller.id)}</option>`).join('')}
            </select></label>
            <label>Meta mensal (R$)<input class="ops-input" name="target" inputmode="decimal" required placeholder="5000,00"></label>
          </div>
          <p class="ops-muted">Somente gerentes com permissão de gestão de vendedores podem salvar metas.</p>
          <p role="status" class="web-form-feedback"></p>
          <button class="ops-primary" type="submit" ${allSellers.length?'':'disabled'}>Salvar meta</button>
        </form>`;
    };
    const trendTable=()=>{
      if(!trend)return '<p class="ops-muted">Para consultar a evolução diária, selecione até 90 dias no período.</p>';
      const points=trend.points||[];
      return table(['Data','Vendas','Receita original','Devoluções','Líquido'],
        points.map(p=>`<tr><td>${escapeHtml(p.date)}</td><td>${p.count}</td>
          <td>${value(p.grossCents)}</td><td>${value(p.refundedCents)}</td>
          <td>${value(p.netCents)}</td></tr>`));
    };
    const overview=`<div class="ops-metrics">
      ${metric('Faturamento registrado (líquido)',value(total),comparison?comparisonHint:'')}
      ${metric('Vendas concluídas',String(count))}
      ${metric('Ticket médio',value(count?Math.round(total/count):0))}
      ${metric('Devoluções',value(sale.refundedCents||0))}
      ${metric('Descontos',value(sale.discountsCents))}
      </div><div class="ops-grid two">
      <section class="ops-card"><h2>Meios de pagamento</h2>${paymentsTable()}</section>
      <section class="ops-card"><h2>Mais vendidos</h2>${productsTable()}</section></div>
      <section class="ops-card"><h2>Evolução diária de vendas líquidas</h2>
      <p class="ops-muted">Movimentos por data efetiva: vendas concluídas e devoluções são apresentados separadamente, sem reescrever o faturamento de períodos passados.</p>
      ${trendTable()}</section>`;
    const views={overview,products:productsTable(),payments:paymentsTable(),inventory:inventoryTable(),
      cash:cashTable(),finance:financeTable(),margins:marginsTable(),details:detailedTable(),coverage:coverageTable(),targets:sellerTargetsView()};

    const xlsxData=()=>{
      const brl=cents=>Number(cents||0)/100;
      switch(state.view){
        case 'products':return {headers:['Produto','Unidades','Vendas','Valor bruto (R$)'],
          rows:products.map(p=>[p.name,p.quantity,p.salesCount,brl(p.grossCents)])};
        case 'payments':return {headers:['Forma','Recebido (R$)'],
          rows:payments.map(p=>[paymentLabel(p.method),brl(p.amountCents)])};
        case 'inventory':return {headers:['Produto','SKU','Saldo'],
          rows:inventory.map(p=>[p.name,p.sku,p.quantity])};
        case 'cash':return {headers:['Abertura','Fechamento','Esperado (R$)','Contado (R$)','Divergência (R$)'],
          rows:cash.map(s=>[s.openedAt||'',s.closedAt||'',brl(s.expectedCashCents),
            s.countedCashCents==null?'Não informado':brl(s.countedCashCents),
            s.divergenceCents==null?'Não informado':brl(s.divergenceCents)])};
        case 'finance':return {headers:['Indicador','Valor (R$)'],
          rows:[['A pagar',brl(finance.payableOpenCents)],['A receber',brl(finance.receivableOpenCents)],
            ['Pago',brl(finance.payableSettledCents)],['Recebido',brl(finance.receivableSettledCents)]]};
        case 'margins':return {headers:['Produto','Quantidade líquida','Receita líquida (R$)',
          'Custo identificado (R$)','Margem histórica (R$)','Base de custo'],
          rows:(margin?.products||[]).map(p=>[p.name,p.quantity,brl(p.revenueCents),brl(p.costCents),
            p.marginCents==null?'Não apurada':brl(p.marginCents),
            p.missingCostLines?'Histórico incompleto':'Snapshot da venda'])};
        case 'coverage':return {headers:['Produto','SKU','Disponível','Reservado','Consumo',
          'Cobertura em dias','Entradas por transferência','Saídas por transferência','Estoque mínimo'],
          rows:(coverage?.products||[]).map(p=>[p.name,p.sku,p.available,p.reserved,p.consumed,
            p.daysCoverage==null?'Sem base':p.daysCoverage,p.transfersIn,p.transfersOut,
            p.minimumQuantity==null?'Não configurado':p.minimumQuantity])};
        case 'targets':return {headers:['Vendedor','Vendas líquidas (R$)','Devoluções (R$)',
          'Meta (R$)','Atingimento (%)','Comissão gerada (R$)','Comissão estornada (R$)',
          'Comissão paga (R$)','Saldo comissão (R$)'],
          rows:(ranking?.sellers||[]).map(p=>[p.sellerName||p.sellerId,brl(p.netSalesCents),
            brl(p.refundedCents),p.targetCents==null?'Não definida':brl(p.targetCents),
            p.progressPercent==null?'Sem meta':p.progressPercent,brl(p.commissionEarnedCents),
            brl(p.commissionReversedCents),brl(p.commissionPaidCents),brl(p.commissionBalanceCents)])};
        default:return {headers:['Indicador','Valor'],
          rows:[['Vendas líquidas (R$)',brl(total)],['Vendas concluídas',count],
            ['Ticket médio (R$)',count?brl(Math.round(total/count)):0],
            ['Devoluções (R$)',brl(sale.refundedCents)],['Descontos (R$)',brl(sale.discountsCents)]]};
      }
    };
    const tabs=available.map(key=>`<button type="button" data-report-web="${key}"
      class="report-v2-tab ${state.view===key?'active':''}"
      role="tab" aria-selected="${state.view===key?'true':'false'}"
      aria-controls="report-v2-body">${viewLabels[key]}</button>`).join('');
    content.innerHTML=`<section class="ops-page report-v2-page web-report-page">
      <header class="ops-head"><div><span class="web-section-kicker">DADOS CANÔNICOS · D1</span>
        <h1>Relatórios comerciais</h1><p>Dados registrados pelo PDV Total, separados por filial.</p></div>
        <div class="ops-head-actions"><button id="web-report-export" class="ops-secondary" type="button">
          Exportar vendas CSV</button><button id="web-report-xlsx" class="ops-secondary" type="button">
          Exportar aba XLSX</button><button id="web-report-print" class="ops-primary" type="button">
          Imprimir / PDF</button></div></header>
      <form id="web-report-filter" class="web-report-filter">
        <label>De<input name="from" type="date" class="ops-input" value="${escapeHtml(fromDate)}" required></label>
        <label>Até<input name="to" type="date" class="ops-input" value="${escapeHtml(toDate)}" required></label>
        <button class="ops-primary" type="submit">Aplicar período</button>
      </form><nav class="report-v2-tabs" role="tablist" aria-label="Categorias de relatório">${tabs}</nav>
      <div id="report-v2-body" role="tabpanel"><section class="ops-card">
        ${views[state.view]||overview}</section></div>
      <p class="ops-muted">O XLSX contém os dados desta aba; em Vendas detalhadas exporta todos os registros filtrados dentro do limite da API (não apenas a página). O PDF usa a impressão do navegador.</p>
      <p class="ops-muted">Relatório não fiscal. Margens são calculadas sobre custos registrados no fechamento da venda; não representam lucro contábil auditado quando o custo histórico é incompleto. PIX e cartão são pagamentos registrados manualmente.</p>
    </section>`;
    content.querySelector('#web-report-filter')?.addEventListener('submit',event=>{
      event.preventDefault();
      const form=event.currentTarget;
      if(form.elements.from.value>form.elements.to.value){showToast('A data inicial deve ser anterior à final.','error');return;}
      void renderWebReports({fromDate:form.elements.from.value,toDate:form.elements.to.value});
    });
    content.querySelectorAll('[data-report-web]').forEach(button=>{
      button.addEventListener('click',()=>{const target=button.dataset.reportWeb;
        void renderWebReports({view:target}).then(()=>{
          content.querySelector('[data-report-web="'+target+'"]')?.focus({preventScroll:true});
        });});
      button.addEventListener('keydown',event=>{
        const tabs=[...content.querySelectorAll('[data-report-web]')];
        const index=tabs.indexOf(button);
        const nextIndex=event.key==='ArrowRight'?(index+1)%tabs.length:
          event.key==='ArrowLeft'?(index-1+tabs.length)%tabs.length:
          event.key==='Home'?0:event.key==='End'?tabs.length-1:-1;
        if(nextIndex<0)return;
        event.preventDefault();tabs[nextIndex].click();
      });
    });
    content.querySelector('#web-target-month')?.addEventListener('submit',event=>{
      event.preventDefault();void renderWebReports({goalMonth:event.currentTarget.elements.month.value});
    });
    content.querySelector('#web-seller-target-form')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget,feedback=form.querySelector('[role=status]');
      const targetCents=centsInput(form.elements.target.value);
      if(targetCents<=0){feedback.textContent='Informe uma meta mensal positiva.';return;}
      const button=form.querySelector('[type=submit]');button.disabled=true;
      try{
        if(!form.dataset.key)form.dataset.key=api.mutationId();
        await api.saveSellerSalesTarget({sellerId:form.elements.sellerId.value,
          month:ranking.month,targetCents},form.dataset.key);
        showToast('Meta registrada.','success');
        void renderWebReports({goalMonth:ranking.month});
      }catch(error){feedback.textContent=error.message;button.disabled=false;}
    });
    content.querySelector('#web-report-detail-filter')?.addEventListener('submit',event=>{
      event.preventDefault();const form=event.currentTarget;
      void renderWebReports({sellerId:form.elements.sellerId.value,customerId:form.elements.customerId.value,
        productId:form.elements.productId.value,paymentMethod:form.elements.paymentMethod.value,detailOffset:0});
    });
    content.querySelectorAll('[data-report-details-page]').forEach(button=>button.addEventListener('click',()=>{
      if(button.disabled)return;
      void renderWebReports({detailOffset:Math.max(0,detail.offset+Number(button.dataset.reportDetailsPage)*detail.limit)});
    }));
    const minimumForm=content.querySelector('#web-stock-minimum');
    if(minimumForm){
      const saveMinimum=async(remove)=>{
        const feedback=minimumForm.querySelector('[role=status]');
        const id=minimumForm.elements.productId.value;
        const raw=minimumForm.elements.minimum.value.trim().replace(',','.');
        if(!remove&&!/^\\d+(?:\\.\\d{1,3})?$/.test(raw)){
          feedback.textContent='Informe quantidade de 0 a 100000 com até três casas decimais.';return;
        }
        const minimumQuantity=remove?null:Number(raw);
        if(!remove&&(minimumQuantity>100000||!Number.isFinite(minimumQuantity))){
          feedback.textContent='Quantidade fora dos limites.';return;
        }
        const buttons=[...minimumForm.querySelectorAll('button')];
        buttons.forEach(button=>button.disabled=true);
        try{
          await api.setStockMinimum(id,minimumQuantity,api.mutationId());
          showToast(remove?'Mínimo removido.':'Mínimo atualizado.','success');
          await renderWebReports();
        }catch(error){feedback.textContent=error.message;buttons.forEach(button=>button.disabled=false);}
      };
      minimumForm.addEventListener('submit',event=>{event.preventDefault();void saveMinimum(false);});
      minimumForm.querySelector('#web-stock-minimum-clear')?.addEventListener('click',()=>void saveMinimum(true));
    }
    content.querySelector('#web-report-print')?.addEventListener('click',()=>root.print());
    content.querySelector('#web-report-xlsx')?.addEventListener('click',async()=>{
      const button=content.querySelector('#web-report-xlsx');button.disabled=true;
      try{
        if(!root.PdvReportXlsx)throw Error('Exportador XLSX não carregado.');
        const data=state.view==='details'
          ?root.PdvReportXlsx.parseCsv((await api.exportSalesDetailCsvCanonical({
            from:state.fromDate,to:state.toDate,sellerId:state.sellerId||'',
            customerId:state.customerId||'',productId:state.productId||'',
            paymentMethod:state.paymentMethod||''
          })).csv||'')
          :xlsxData();
        root.PdvReportXlsx.download('relatorio-'+state.view+'-'+state.fromDate+'-'+state.toDate+'.xlsx',
          data.headers,data.rows,{sheetName:viewLabels[state.view]});
        showToast('Planilha XLSX gerada localmente.','success');
      }catch(error){showToast(error.message||'Falha ao gerar XLSX.','error');}
      finally{button.disabled=false;}
    });
    content.querySelector('#web-report-export')?.addEventListener('click',async()=>{
      const button=content.querySelector('#web-report-export');
      button.disabled=true;
      try{
        const result=state.view==='details'
          ?await api.exportSalesDetailCsvCanonical({from:state.fromDate,to:state.toDate,
            sellerId:state.sellerId||'',customerId:state.customerId||'',
            productId:state.productId||'',paymentMethod:state.paymentMethod||''})
          :await api.exportSalesCsv({from:state.fromDate,to:state.toDate});
        downloadCsvText((state.view==='details'?'vendas-detalhadas-':'vendas-')+
          state.fromDate+'-'+state.toDate+'.csv',result.csv||'');
        showToast('Relatório exportado.','success');
      }catch(e){showToast(e.message||'Falha ao exportar.','error');}
      finally{button.disabled=false;}
    });
    root.PdvUiLifecycle?.emit?.('reports:updated',{surface:'reports'});
  }

  async function renderReportsV2(next = {}) {
    if(api.webMode)return renderWebReports(next);
    await ready();
    markActive();
    const today = businessToday();
    state = { ...state,...next };
    if (!state.fromDate) state.fromDate = `${today.slice(0,8)}01`;
    if (!state.toDate) state.toDate = today;

    const basePeriod = { from:new Date(`${state.fromDate}T00:00:00`).toISOString(),to:new Date(`${state.toDate}T23:59:59.999`).toISOString() };
    const salesFilters = { ...basePeriod,sellerId:SELLER_FILTER_VIEWS.has(state.view) ? state.sellerId || '' : '' };
    const previousRange = root.PdvBusinessDate.equivalentPreviousPeriod(state.fromDate,state.toDate);
    const previousPeriodFilters = {
      from:new Date(`${previousRange.previousFrom}T00:00:00`).toISOString(),
      to:new Date(`${previousRange.previousTo}T23:59:59.999`).toISOString(),
      sellerId:SELLER_FILTER_VIEWS.has(state.view) ? state.sellerId || '' : ''
    };
    let sales,previousSales=null,inventory,cash,sellers,commissions=null,products=[],rules=[];
    try {
      [sales,previousSales,inventory,cash,sellers] = await Promise.all([
        api.reportSales(salesFilters),
        state.view==='overview'?api.reportSales(previousPeriodFilters):Promise.resolve(null),
        api.reportInventory(),
        api.reportCash(basePeriod),
        api.sellers()
      ]);
      if (state.view === 'commissions') [commissions,products,rules] = await Promise.all([api.commissions(salesFilters),api.products(),api.commissionRules({includeInactive:true})]);
    } catch (error) {
      if (!routeActive()) return;
      content.innerHTML = `<section class="ops-page"><header class="ops-head"><div><h1>Relatórios</h1><p>Não foi possível carregar os dados.</p></div></header><section class="ops-card"><div class="ops-empty">${escapeHtml(error.message)}</div></section></section>`;
      return;
    }

    if (!routeActive()) return;
    if (state.customerId && !sales.customerSales?.some(row => (row.customerId || '__WALK_IN__') === state.customerId)) state.customerId = '';
    if (state.productId && !sales.productSales?.some(row => row.productId === state.productId)) state.productId = '';
    if (state.paymentMethod && !sales.paymentMethods?.some(row => row.method === state.paymentMethod)) state.paymentMethod = '';
    if (state.locationId && !inventory.locations?.some(row => row.id === state.locationId)) state.locationId = '';

    const views = {
      overview:overviewView(sales,previousSales,inventory,cash,previousRange),customers:customersView(sales),products:productsView(sales),payments:paymentsView(sales),inventory:inventoryView(inventory),cash:cashView(cash),commissions:commissionsView(commissions,sellers,products,rules)
    };
    const tabs = Object.entries(VIEW_LABELS).map(([key,label]) => `<button type="button" id="report-tab-${key}" role="tab" aria-selected="${state.view===key?'true':'false'}" aria-controls="report-v2-body" tabindex="${state.view===key?'0':'-1'}" class="report-v2-tab ${state.view === key ? 'active' : ''}" data-report-view="${key}">${escapeHtml(label)}</button>`).join('');

    content.innerHTML = `<section class="ops-page report-v2-page"><header class="ops-head"><div><h1>Relatórios comerciais</h1><p>Vendas, clientes, produtos, pagamentos, estoque mínimo, caixa físico e comissões.</p></div><div class="ops-head-actions report-v2-actions"><button id="report-open-management" class="ops-secondary" type="button">Abrir Gestão</button><button id="report-export" class="ops-secondary" type="button">Exportar CSV</button><button id="report-print" class="ops-primary" type="button">Imprimir / Salvar PDF</button></div></header><div class="report-print-meta"><strong>${escapeHtml(VIEW_LABELS[state.view])}</strong><span>${escapeHtml(printMeta(sellers,inventory))}</span></div>${filterForm(sellers,inventory)}<nav class="report-v2-tabs" role="tablist" aria-label="Tipos de relatório">${tabs}</nav><div id="report-v2-body" role="tabpanel" aria-labelledby="report-tab-${escapeHtml(state.view)}" tabindex="0">${views[state.view] || views.overview}</div></section>`;

    document.getElementById('report-v2-filter')?.addEventListener('submit',event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      let fromDate,toDate;
      try {
        fromDate = root.PdvBusinessDate.parseDatePtBr(String(form.get('fromDate') || ''));
        toDate = root.PdvBusinessDate.parseDatePtBr(String(form.get('toDate') || ''));
      } catch (error) {
        showToast(error.message || 'Informe as datas no formato dd/mm/aaaa.','error');
        return;
      }
      if (fromDate > toDate) { showToast('A data inicial não pode ser posterior à data final.','error'); return; }
      void renderReportsV2({ fromDate,toDate,sellerId:SELLER_FILTER_VIEWS.has(state.view) ? String(form.get('sellerId') || '') : state.sellerId,customerId:'',productId:'',paymentMethod:'' });
    });
    const tabButtons=Array.from(content.querySelectorAll('[data-report-view]'));
    tabButtons.forEach((button,index) => {
      button.addEventListener('click',() => void renderReportsV2({view:button.dataset.reportView,customerId:'',productId:'',paymentMethod:''}));
      button.addEventListener('keydown',event=>{
        if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
        event.preventDefault();
        let nextIndex=index;
        if(event.key==='ArrowRight')nextIndex=(index+1)%tabButtons.length;
        else if(event.key==='ArrowLeft')nextIndex=(index-1+tabButtons.length)%tabButtons.length;
        else if(event.key==='Home')nextIndex=0;
        else if(event.key==='End')nextIndex=tabButtons.length-1;
        tabButtons[nextIndex]?.focus();
      });
    });
    document.getElementById('report-customer-filter')?.addEventListener('change',event => void renderReportsV2({customerId:event.target.value}));
    document.getElementById('report-product-filter')?.addEventListener('change',event => void renderReportsV2({productId:event.target.value}));
    document.getElementById('report-payment-filter')?.addEventListener('change',event => void renderReportsV2({paymentMethod:event.target.value}));
    document.getElementById('report-location-filter')?.addEventListener('change',event => void renderReportsV2({locationId:event.target.value}));
    content.querySelectorAll('[data-report-period]').forEach(button=>button.addEventListener('click',()=>{
      const period=presetPeriod(button.dataset.reportPeriod);
      void renderReportsV2({...period,customerId:'',productId:'',paymentMethod:''});
    }));
    content.querySelectorAll('[data-report-drilldown]').forEach(button=>button.addEventListener('click',()=>{
      const type=button.dataset.reportDrilldown,id=button.dataset.drilldownId||'';
      if(type==='customer')void openSalesDrilldown('Vendas do cliente',{customerId:id});
      else if(type==='product')void openSalesDrilldown('Vendas do produto',{productId:id});
      else if(type==='payment')void openSalesDrilldown('Vendas por meio de pagamento',{paymentMethod:id});
      else void openSalesDrilldown('Vendas do período');
    }));
    document.getElementById('report-open-management')?.addEventListener('click',navigateManagement);
    document.getElementById('report-export')?.addEventListener('click',async() => {
      try{
        if(state.view==='overview'){
          const result=await api.exportSalesCsv({
            from:new Date(`${state.fromDate}T00:00:00`).toISOString(),
            to:new Date(`${state.toDate}T23:59:59.999`).toISOString(),
            sellerId:state.sellerId||''
          });
          downloadCsvText(`vendas-detalhadas-${state.fromDate}-a-${state.toDate}.csv`,result.csv||'');
          return;
        }
        const csv=currentCsv(sales,inventory,cash,commissions);
        downloadCsv(csv.name,csv.headers,csv.rows);
      }catch(error){showToast(error.message||'Não foi possível exportar o relatório.','error');}
    });
    document.getElementById('report-print')?.addEventListener('click',() => root.print());

    document.getElementById('report-commission-rule')?.addEventListener('submit',async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      try {
        await api.saveCommissionRule({sellerId:String(form.get('sellerId')),productId:String(form.get('productId') || '') || null,commissionBps:Math.round(Number(form.get('percent')) * 100)});
        showToast('Regra de comissão salva. Vendas já concluídas não serão alteradas.','success');
        await renderReportsV2();
      } catch (error) { showToast(error.message,'error'); }
    });
    content.querySelectorAll('[data-pay-commission]').forEach(button => button.addEventListener('click',() => {
    const suggested = (Number(button.dataset.outstanding || 0) / 100).toFixed(2).replace('.',',');
    if (!modal?.open) { showToast('Modal interno indisponível.','error'); return; }
    modal.open('Registrar pagamento de comissão', `<form id="commission-payment-form"><div class="field"><label>Valor pago (R$) *</label><input name="amount" inputmode="decimal" required value="${escapeHtml(suggested)}"></div><div class="field"><label>Observação</label><textarea name="note" rows="3" placeholder="Opcional"></textarea></div><div class="modal-actions"><button type="button" class="secondary-button" data-close-modal>Cancelar</button><button type="submit" class="primary-button">Registrar pagamento</button></div></form>`, { onMount(modalRoot) {
      const form = modalRoot.querySelector('#commission-payment-form');
      const amount = form?.querySelector('[name="amount"]');
      amount?.focus();
      amount?.select();
      form?.addEventListener('submit',async event => {
        event.preventDefault();
        const amountCents = centsInput(form.elements.namedItem('amount')?.value);
        if (amountCents <= 0) { showToast('Informe um valor de comissão maior que zero.','error'); return; }
        const note = String(form.elements.namedItem('note')?.value || '').trim();
        try {
          await api.payCommission({sellerId:button.dataset.payCommission,amountCents,periodFrom:basePeriod.from,periodTo:basePeriod.to,note});
          modal.close();
          showToast('Pagamento de comissão registrado.','success');
          await renderReportsV2();
        } catch (error) { showToast(error.message,'error'); }
      });
    } });
  }));
  }

  root.PdvReportsV2 = Object.freeze({ render:renderReportsV2 });
  if (!root.PdvRouteRegistry) throw new Error('PdvRouteRegistry must load before reporting-v2.js.');
  root.PdvRouteRegistry.register('reports', { owner:'reporting-v2', render:() => renderReportsV2() });
})();