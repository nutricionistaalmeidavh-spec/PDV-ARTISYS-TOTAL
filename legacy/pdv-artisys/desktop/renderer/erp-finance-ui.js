'use strict';
(() => {
  const root=window;const {ApiClient}=root.PdvApiClient;const api=new ApiClient();const content=document.getElementById('route-content');
  const esc=value=>String(value??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[c]);
  const money=value=>(Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const today=()=>new Date().toISOString().slice(0,10);const monthStart=()=>`${today().slice(0,7)}-01`;
  const dateLabel=value=>{const date=new Date(`${String(value||'')}T00:00:00.000Z`);return Number.isNaN(date.getTime())?String(value||''):date.toLocaleDateString('pt-BR',{timeZone:'UTC'});};
  const metric=(label,value,hint='')=>`<article class="ops-metric"><span>${esc(label)}</span><strong>${esc(value)}</strong>${hint?`<small>${esc(hint)}</small>`:''}</article>`;
  function toast(message,type=''){root.PdvToast?.show?.(message,type)||console[type==='error'?'error':'log'](message);}
  async function renderManagement(filters={}){
    const initialized=await api.initialize();
    const access=root.PdvCurrentAccess||initialized?.user||null;
    if(!root.PdvAccessPolicy?.hasCapability(access,'management.view')){document.body.dataset.activeRoute='management';content.innerHTML='<section class="page"><div class="empty-state"><h1>Acesso restrito</h1><p>Seu perfil não possui acesso à área Gestão.</p></div></section>';return;}
    const from=filters.from||monthStart(),to=filters.to||today(),basis=filters.basis||'cash';
    document.body.dataset.activeRoute='management';
    const previous=root.PdvBusinessDate.equivalentPreviousPeriod(from,to);
    const [dashboard,dre,cashflow,compare,costCenters,categories,dreGroups]=await Promise.all([
      api.erpDashboard({from,to,basis}),api.erpDre({from,to,basis}),api.erpCashflow({from,to,projectionDays:30}),api.erpCompare({from,to,previousFrom:previous.previousFrom,previousTo:previous.previousTo,basis}),api.costCenters(),api.financeCategories(),api.financeDreGroups()
    ]);
    const natureLabel=value=>({REVENUE:'Receita',COST:'Custo',EXPENSE:'Despesa',OTHER:'Outros resultados'})[String(value||'').toUpperCase()]||String(value||'—');
    const kindLabel=value=>({PAYABLE:'Conta a pagar',RECEIVABLE:'Conta a receber'})[String(value||'').toUpperCase()]||String(value||'—');
    const categoryKindLabel=value=>({INCOME:'Receita',EXPENSE:'Despesa',BOTH:'Receita ou despesa'})[String(value||'').toUpperCase()]||String(value||'—');
    const groupById=new Map(dreGroups.map(row=>[String(row.id),row]));
    document.body.classList.remove('theme-home');
    content.innerHTML=`<section class="ops-page erp-management-page"><header class="ops-head"><div><h1>Gestão</h1><p>Visão financeira do PDV ArtiSys para o dono da empresa.</p></div><div class="ops-head-actions"><button id="erp-export-dre" class="ops-secondary" type="button">Exportar DRE CSV</button><button class="ops-primary" type="button" data-route="reports">Abrir Relatórios</button></div></header>
      <form id="erp-management-filter" class="ops-card ops-form" novalidate style="grid-template-columns:repeat(4,minmax(140px,1fr));align-items:end"><label>De<input name="from" type="date" class="ops-input" value="${esc(from)}"></label><label>Até<input name="to" type="date" class="ops-input" value="${esc(to)}"></label><label>Base<select name="basis" class="ops-input"><option value="cash" ${basis==='cash'?'selected':''}>Caixa</option><option value="accrual" ${basis==='accrual'?'selected':''}>Competência</option></select></label><button class="ops-primary" type="submit">Atualizar</button></form>
      <div id="erp-management-metrics" class="ops-metrics" data-basis="${esc(basis)}">${metric('Receita',money(dashboard.revenueCents))}${metric('Resultado',money(dashboard.resultCents),`Margem ${dashboard.marginPercent||0}%`)}${metric('A receber',money(dashboard.receivableOpenCents||0))}${metric('A pagar',money(dashboard.payableOpenCents||0))}</div>
      <div class="ops-grid two"><section id="erp-dre" class="ops-card"><div class="ops-card-head"><div><h2>DRE ${basis==='cash'?'por caixa':'por competência'}</h2></div></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Grupo</th><th>Natureza</th><th>Valor</th><th></th></tr></thead><tbody>${(dre.groups||[]).map(row=>`<tr><td>${esc(row.name)}</td><td>${esc(natureLabel(row.nature))}</td><td>${money(row.amountCents)}</td><td><button type="button" class="ops-link" data-dre-group="${esc(row.id)}">Detalhes</button></td></tr>`).join('')||'<tr><td colspan="4">Sem movimento no período.</td></tr>'}</tbody></table></div><div class="ops-summary-line"><span>Custos ${money(dre.costCents)} · Despesas ${money(dre.expenseCents)}</span><strong>Resultado ${money(dre.resultCents)}</strong></div></section>
      <section id="erp-cashflow" class="ops-card"><h2>Fluxo de caixa</h2><dl class="ops-details"><div><dt>Entradas realizadas</dt><dd>${money(cashflow.realizedInflowCents)}</dd></div><div><dt>Saídas realizadas</dt><dd>${money(cashflow.realizedOutflowCents)}</dd></div><div><dt>A receber projetado</dt><dd>${money(cashflow.projectedReceivableCents)}</dd></div><div><dt>A pagar projetado</dt><dd>${money(cashflow.projectedPayableCents)}</dd></div><div><dt>Delta projetado</dt><dd>${money(cashflow.projectedClosingDeltaCents)}</dd></div></dl></section></div>
      <section id="erp-drilldown-panel" class="ops-card"><p>Selecione “Detalhes” em um grupo para conferir os lançamentos ou vendas que compõem o valor.</p><h2>Composição da DRE</h2></section>
      <section id="erp-period-comparison" class="ops-card"><h2>Comparação com período anterior</h2><p class="ops-muted">${dateLabel(previous.previousFrom)} a ${dateLabel(previous.previousTo)} · mesma quantidade de dias do período atual</p><div class="ops-metrics">${metric('Δ Receita',money(compare.delta?.revenueCents||0))}${metric('Δ Custos',money(compare.delta?.costCents||0))}${metric('Δ Despesas',money(compare.delta?.expenseCents||0))}${metric('Δ Resultado',money(compare.delta?.resultCents||0))}</div></section>
      <div class="ops-grid two">
        <section class="ops-card"><h2>Grupos da DRE</h2><form id="erp-dre-group-form" class="ops-form" novalidate><label>Nome<input name="name" class="ops-input" required></label><label>Natureza<select name="nature" class="ops-input"><option value="REVENUE">Receita</option><option value="COST">Custo</option><option value="EXPENSE">Despesa</option><option value="OTHER">Outros resultados</option></select></label><label>Ordem<input name="sortOrder" type="number" class="ops-input" value="50" step="1"></label><button class="ops-secondary" type="submit">Adicionar grupo</button></form><div class="erp-config-badges">${dreGroups.map(row=>`<span class="ops-badge">${esc(row.sortOrder)} · ${esc(row.name)} · ${esc(natureLabel(row.nature))}</span>`).join(' ')||'Nenhum grupo cadastrado.'}</div></section>
        <section class="ops-card"><h2>Categorias financeiras</h2><form id="erp-category-form" class="ops-form" novalidate><label>Nome<input name="name" class="ops-input" required></label><label>Tipo<select name="kind" class="ops-input"><option value="EXPENSE">Despesa</option><option value="INCOME">Receita</option><option value="BOTH">Receita ou despesa</option></select></label><label>Grupo da DRE<select name="dreGroupId" class="ops-input"><option value="">Sem grupo</option>${dreGroups.map(row=>`<option value="${esc(row.id)}">${esc(row.name)}</option>`).join('')}</select></label><button class="ops-secondary" type="submit">Adicionar categoria</button></form><div class="erp-config-badges">${categories.map(row=>`<span class="ops-badge">${esc(row.name)} · ${esc(categoryKindLabel(row.kind))}${row.dreGroupId?` · ${esc(groupById.get(String(row.dreGroupId))?.name||'Sem grupo')}`:''}</span>`).join(' ')||'Nenhuma categoria cadastrada.'}</div></section>
      </div>
      <section class="ops-card"><h2>Centros de custo</h2><form id="erp-cost-center-form" class="ops-form erp-inline-config-form" novalidate><label>Nome<input name="name" class="ops-input" required></label><button class="ops-secondary" type="submit">Adicionar</button></form><div class="erp-config-badges">${costCenters.map(row=>`<span class="ops-badge">${esc(row.name)}</span>`).join(' ')||'Nenhum centro cadastrado.'}</div></section>
    </section>`;

    document.getElementById('erp-management-filter')?.addEventListener('submit',event=>{event.preventDefault();const form=new FormData(event.currentTarget);const nextFrom=String(form.get('from')||''),nextTo=String(form.get('to')||'');if(!nextFrom||!nextTo||nextFrom>nextTo){toast('Informe um período válido.','error');return;}void renderManagement({from:nextFrom,to:nextTo,basis:form.get('basis')});});
    document.getElementById('erp-export-dre')?.addEventListener('click',()=>{
      const cell=value=>{const text=String(value??'');return /[;"\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text;};
      const rows=[['grupo','natureza','valor_centavos','base','data_inicial','data_final'],...(dre.groups||[]).map(row=>[row.name,natureLabel(row.nature),row.amountCents,basis,from,to])];
      const blob=new Blob([`\uFEFF${rows.map(row=>row.map(cell).join(';')).join('\n')}\n`],{type:'text/csv;charset=utf-8'});
      const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`dre-${basis}-${from}-a-${to}.csv`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    });

    document.querySelectorAll('[data-dre-group]').forEach(button=>button.addEventListener('click',async()=>{
      const group=(dre.groups||[]).find(row=>String(row.id)===String(button.dataset.dreGroup));const panel=document.getElementById('erp-drilldown-panel');if(!group||!panel)return;
      panel.innerHTML='<h2>Composição da DRE</h2><div class="ops-loader"></div>';
      try{
        const [entries,sales]=await Promise.all([
          Promise.all((group.entryIds||[]).map(entryId=>api.erpDrilldown(entryId))),
          (group.saleIds||[]).length?api.reportSalesDetails({saleIds:(group.saleIds||[]).join(',')}):Promise.resolve([])
        ]);
        const entryRows=entries.map(entry=>`<tr><td>${dateLabel(String(entry.competencyDate||entry.dueAt||'').slice(0,10))}</td><td>${esc(entry.description)}</td><td>${esc(kindLabel(entry.kind))}</td><td>${money(entry.amountCents)}</td><td>${esc([entry.sourceType,entry.sourceId].filter(Boolean).join(' · ')||'Lançamento manual')}</td></tr>`).join('');
        const saleRows=sales.map(sale=>`<tr><td>${dateLabel(String(sale.completedAt||'').slice(0,10))}</td><td>Venda ${esc(sale.saleNumber)}</td><td>${esc(sale.customerName||'Consumidor não identificado')}</td><td>${money(sale.totalCents)}</td><td>PDV · ${esc(sale.saleId)}</td></tr>`).join('');
        panel.innerHTML=`<div class="ops-card-head"><div><h2>${esc(group.name)}</h2><p>${esc(natureLabel(group.nature))} · ${money(group.amountCents)}</p></div></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Origem</th><th>Tipo / cliente</th><th>Valor</th><th>Rastreabilidade</th></tr></thead><tbody>${entryRows}${saleRows}${entryRows||saleRows?'':'<tr><td colspan="5">Sem itens detalháveis para este grupo.</td></tr>'}</tbody></table></div>`;
      }catch(error){panel.innerHTML=`<h2>Composição da DRE</h2><div class="ops-error">${esc(error.message)}</div>`;}
    }));

    document.getElementById('erp-dre-group-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const name=String(form.get('name')||'').trim();if(!name){toast('Informe o nome do grupo.','error');return;}try{await api.saveDreGroup({name,nature:form.get('nature'),sortOrder:Number(form.get('sortOrder')||0)});toast('Grupo da DRE criado.','success');await renderManagement({from,to,basis});}catch(error){toast(error.message,'error');}});
    document.getElementById('erp-category-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const name=String(form.get('name')||'').trim();if(!name){toast('Informe o nome da categoria.','error');return;}try{await api.saveFinanceCategory({name,kind:form.get('kind'),dreGroupId:form.get('dreGroupId')||null});toast('Categoria financeira criada.','success');await renderManagement({from,to,basis});}catch(error){toast(error.message,'error');}});
    document.getElementById('erp-cost-center-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const name=String(form.get('name')||'').trim();if(!name){toast('Informe o nome do centro de custo.','error');return;}try{await api.saveCostCenter({name});toast('Centro de custo criado.','success');await renderManagement({from,to,basis});}catch(error){toast(error.message,'error');}});
  }

  root.PdvErpFinanceUi=Object.freeze({renderManagement});
})();
