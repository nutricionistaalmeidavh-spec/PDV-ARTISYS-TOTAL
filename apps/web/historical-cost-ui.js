'use strict';

(() => {
  const root = window;
  const { ApiClient } = root.PdvApiClient || {};
  if (!ApiClient) return;
  const api = new ApiClient();
  const ui = root.PdvUiModel;

  function escapeHtml(value){return String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);}
  function money(value){return ui?.formatCents ? ui.formatCents(value) : (Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});}
  function qty(value){return Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3});}
  function when(value){if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?escapeHtml(value):date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});}
  function showToast(message,type=''){root.PdvToast?.show?.(message,type);}
  function basisLabel(item){
    if(item.costBasis==='ESTIMATED_CURRENT')return 'Estimado pelo custo atual';
    if(item.costBasis==='HISTORICAL_SNAPSHOT')return `Histórico${item.costSnapshotSource?` · ${item.costSnapshotSource}`:''}`;
    return 'Não informado';
  }

  root.addEventListener('click',async event=>{
    const button=event.target.closest?.('[data-sale-details]');
    if(!button)return;
    const target=document.getElementById('ops-sale-detail');
    if(!target)return;
    event.preventDefault();
    event.stopImmediatePropagation();
    try{
      const sale=await api.saleDetails(button.dataset.saleDetails);
      const jobs=await api.printJobs({entityType:'sale',entityId:sale.id});
      target.innerHTML=`<section class="ops-card"><div class="ops-card-head"><div><h2>Venda ${escapeHtml(sale.saleNumber||sale.id)}</h2><p>${when(sale.completedAt||sale.cancelledAt)} · Vendedor: ${escapeHtml(sale.sellerName||sale.sellerId||'—')} · Operador: ${escapeHtml(sale.operatorName||sale.operatorId||'—')}${sale.cancelReason?` · Cancelamento: ${escapeHtml(sale.cancelReason)}`:''}</p></div>${jobs[0]?`<button class="ops-secondary" data-cost-reprint="${escapeHtml(jobs[0].id)}">Reimprimir comprovante</button>`:''}</div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Item</th><th>Qtd.</th><th>Preço original</th><th>Preço aplicado</th><th>Justificativa</th><th>Custo unitário</th><th>Custo total</th><th>Base do custo</th><th>Total</th></tr></thead><tbody>${(sale.items||[]).map(item=>{const unitCost=Number(item.effectiveCostCents??item.costCentsSnapshot??0);return `<tr><td>${escapeHtml(item.productName)}</td><td>${qty(item.quantity)}</td><td>${money(item.catalogUnitPriceCents??item.unitPriceCents)}</td><td>${money(item.unitPriceCents)}</td><td>${escapeHtml(item.priceOverrideReason||'—')}</td><td>${money(unitCost)}</td><td>${money(Math.round(unitCost*Number(item.quantity||0)))}</td><td>${escapeHtml(basisLabel(item))}</td><td>${money(item.totalCents)}</td></tr>`;}).join('')}</tbody></table></div><div class="ops-summary-line"><span>Desconto ${money(sale.discountCents||0)}</span><strong>Total ${money(sale.totalCents)}</strong></div>${(sale.items||[]).some(item=>item.costBasis==='ESTIMATED_CURRENT')?'<p class="ops-muted">Atenção: itens de vendas legadas sem snapshot de custo são exibidos como estimativa pelo custo atual cadastrado.</p>':''}</section>`;
      target.querySelector('[data-cost-reprint]')?.addEventListener('click',async reprintEvent=>{try{await api.reprint(reprintEvent.currentTarget.dataset.costReprint);showToast('Reimpressão adicionada à fila.','success');}catch(error){showToast(error.message,'error');}});
    }catch(error){showToast(error.message,'error');}
  },true);
})();
