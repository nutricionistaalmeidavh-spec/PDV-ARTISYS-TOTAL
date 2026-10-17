'use strict';

(() => {
  const root=window;
  const {ApiClient}=root.PdvApiClient;
  const api=new ApiClient();
  const routeRegistry=root.PdvRouteRegistry;
  const content=document.getElementById('route-content');
  if(!routeRegistry)throw new Error('PdvRouteRegistry must load before erp-finance-operations-ui.js.');

  const ROUTES=Object.freeze([
    {id:'finance',label:'Lançamentos'},
    {id:'finance-banks',label:'Bancos e conciliação'},
    {id:'finance-recurrences',label:'Recorrências'},
    {id:'finance-alerts',label:'Alertas'}
  ]);
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
  const money=value=>(Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const dateLabel=value=>{if(!value)return '—';const text=String(value).slice(0,10);const date=new Date(`${text}T00:00:00.000Z`);return Number.isNaN(date.getTime())?text:date.toLocaleDateString('pt-BR',{timeZone:'UTC'});};
  const centsInput=value=>{const text=String(value??'').trim().replace(/\./g,'').replace(',','.');const number=Number(text);return Number.isFinite(number)?Math.round(number*100):0;};
  const today=()=>root.PdvBusinessDate.localBusinessDate(new Date());
  const STATEMENT_STATUS_LABELS=Object.freeze({UNMATCHED:'Pendente',MATCHED:'Conciliada'});
  const statementStatusLabel=value=>STATEMENT_STATUS_LABELS[String(value||'').toUpperCase()]||'Situação desconhecida';
  const toast=(message,type='')=>root.PdvToast?.show?.(message,type)||console[type==='error'?'error':'log'](message);

  function navigation(activeRoute){
    return `<nav class="ops-actions finance-subnav" aria-label="Áreas do Financeiro">${ROUTES.map(route=>`<button type="button" class="${route.id===activeRoute?'ops-primary':'ops-secondary'}" data-finance-route="${esc(route.id)}" ${route.id===activeRoute?'aria-current="page"':''}>${esc(route.label)}</button>`).join('')}</nav>`;
  }

  function bindNavigation(scope=document){
    const buttons=[...scope.querySelectorAll('[data-finance-route]')];
    const focusAt=index=>buttons[Math.max(0,Math.min(buttons.length-1,index))]?.focus?.({preventScroll:true});
    buttons.forEach((button,index)=>{
      button.addEventListener('click',()=>{
        const route=button.dataset.financeRoute;
        if(route&&route!==document.body.dataset.activeRoute)void root.PdvAppNavigation?.navigate?.(route);
      });
      button.addEventListener('keydown',event=>{
        let next=null;
        if(event.key==='ArrowRight')next=(index+1)%buttons.length;
        else if(event.key==='ArrowLeft')next=(index-1+buttons.length)%buttons.length;
        else if(event.key==='Home')next=0;
        else if(event.key==='End')next=buttons.length-1;
        if(next===null)return;
        event.preventDefault();
        focusAt(next);
      });
    });
  }

  function canAccess(){
    return Boolean(root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,'finance.view'));
  }

  function routeActive(route){
    return document.body.dataset.activeRoute===route;
  }

  function page(route,subtitle,body,actions=''){
    return `<section class="ops-page finance-operations-page" data-finance-surface="${esc(route)}"><header class="ops-head"><div><h1>Financeiro</h1><p>${esc(subtitle)}</p></div><div class="ops-head-actions">${actions}</div></header>${navigation(route)}${body}</section>`;
  }

  async function requireAccess(route){
    await api.initialize();
    if(canAccess())return true;
    if(routeActive(route))void root.PdvAppNavigation?.navigate?.('home');
    return false;
  }

  async function reviewSuggestion(transactionId,action='accept'){
    try{
      const ux=root.ArtisysUxComponents;
      const suggestions=await api.reconciliationSuggestions(transactionId);
      const choice=suggestions[0];
      if(!choice){toast('Nenhuma sugestão disponível para esta movimentação.','error');return;}
      if(!ux?.openFormDialog){toast('Diálogo de conciliação indisponível.','error');return;}
      const rejecting=action==='reject';
      const dayDistance=Number(choice.reason?.dayDistance||0);
      const textOverlap=Math.round(Number(choice.reason?.textOverlap||0)*100);
      const exactAmount=choice.reason?.exactAmount===true;
      const result=await ux.openFormDialog({
        title:rejecting?'Ignorar sugestão de conciliação':'Revisar conciliação',
        description:rejecting?'A movimentação continuará pendente para outra conciliação.':'Confira extrato, lançamento e valor antes de registrar a baixa.',
        confirmLabel:rejecting?'Ignorar sugestão':'Conciliar',
        initialFocus:rejecting?'cancel':'first',
        body:`<div class="ux-dialog__summary"><strong>Extrato: ${esc(choice.description||'Movimentação bancária')}</strong><span>${dateLabel(choice.postedDate)} · ${money(choice.transactionAmountCents)}</span></div>
          <div class="ux-dialog__summary"><strong>Lançamento: ${esc(choice.entryDescription||choice.entryId)}</strong><span>Vencimento ${dateLabel(choice.dueAt)} · saldo ${money(choice.entryOpenCents)}</span></div>
          <div class="ux-dialog__facts"><div class="ux-dialog__fact"><small>Valor</small><strong>${exactAmount?'Exato':'Dentro da tolerância'}</strong></div><div class="ux-dialog__fact"><small>Datas</small><strong>${dayDistance===0?'Mesmo dia':`${dayDistance} dia${dayDistance===1?'':'s'} de diferença`}</strong></div><div class="ux-dialog__fact"><small>Descrição</small><strong>${textOverlap}% de correspondência</strong></div><div class="ux-dialog__fact"><small>Valor a conciliar</small><strong>${money(choice.amountCents)}</strong></div></div>
          ${rejecting?'<label>Motivo<textarea name="reason" class="ops-input" rows="3"></textarea></label>':''}`,
        validate:rejecting?(data=>String(data.reason||'').trim()?null:{message:'Informe o motivo para ignorar esta sugestão.',field:'reason'}):null,
        onConfirm:rejecting
          ?data=>api.rejectReconciliation(transactionId,{entryId:choice.entryId,reason:String(data.reason||'').trim(),idempotencyKey:api.mutationId()})
          :()=>api.acceptReconciliation(transactionId,{entryId:choice.entryId,amountCents:choice.amountCents,idempotencyKey:api.mutationId()})
      });
      if(result.confirmed){
        toast(rejecting?'Sugestão ignorada.':'Conciliação registrada.','success');
        await renderBanks();
      }
    }catch(error){toast(error.message||String(error),'error');}
  }

  async function manualReconciliation(transaction){
    try{
      const ux=root.ArtisysUxComponents;
      if(!ux?.openFormDialog){toast('Diálogo de conciliação indisponível.','error');return;}
      const expectedKind=transaction.direction==='debit'?'PAYABLE':'RECEIVABLE';
      const entries=(await api.financeEntries({kind:expectedKind})).filter(entry=>entry.status!=='CANCELLED'&&Number(entry.openCents)>0);
      if(!entries.length){toast(expectedKind==='PAYABLE'?'Não há contas a pagar em aberto.':'Não há contas a receber em aberto.','error');return;}
      const byId=new Map(entries.map(entry=>[String(entry.id),entry]));
      const suggestedAmount=(Number(transaction.amountCents||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
      const result=await ux.openFormDialog({
        title:'Conciliar manualmente',
        description:`${transaction.description} · ${dateLabel(transaction.date)} · ${money(transaction.amountCents)}`,
        confirmLabel:'Registrar conciliação',
        body:`<div class="ux-dialog__summary"><strong>${esc(transaction.description)}</strong><span>${transaction.direction==='debit'?'Saída':'Entrada'} · ${money(transaction.amountCents)}</span></div>
          <label>Lançamento<select name="entryId" class="ops-input">${entries.map(entry=>`<option value="${esc(entry.id)}">${esc(entry.description)} · vence ${dateLabel(entry.dueAt)} · aberto ${money(entry.openCents)}</option>`).join('')}</select></label>
          <label>Valor a conciliar (R$)<input name="amount" class="ops-input" inputmode="decimal" value="${esc(suggestedAmount)}"></label>`,
        validate:data=>{
          const entry=byId.get(String(data.entryId||''));if(!entry)return{message:'Selecione um lançamento válido.',field:'entryId'};
          const amountCents=centsInput(data.amount);if(amountCents<=0)return{message:'Informe um valor maior que zero.',field:'amount'};
          if(amountCents>Number(transaction.amountCents||0))return{message:'O valor não pode exceder a movimentação do extrato.',field:'amount'};
          if(amountCents>Number(entry.openCents||0))return{message:'O valor não pode exceder o saldo em aberto do lançamento.',field:'amount'};
          return null;
        },
        onConfirm:data=>api.manualReconciliation(transaction.id,{entryId:data.entryId,amountCents:centsInput(data.amount),idempotencyKey:api.mutationId()})
      });
      if(result.confirmed){toast('Conciliação manual registrada.','success');await renderBanks();}
    }catch(error){toast(error.message||String(error),'error');}
  }

  async function confirmTransfer(pair,accountsById){
    const ux=root.ArtisysUxComponents;
    if(!ux?.openFormDialog){toast('Diálogo financeiro indisponível.','error');return;}
    const from=accountsById.get(String(pair.fromAccountId))?.name||pair.fromAccountId;
    const to=accountsById.get(String(pair.toAccountId))?.name||pair.toAccountId;
    const result=await ux.openFormDialog({
      title:'Confirmar transferência entre contas',
      description:'Esta operação vincula as duas movimentações sem criar receita ou despesa.',
      confirmLabel:'Confirmar transferência',
      body:`<div class="ux-dialog__summary"><strong>${esc(from)} → ${esc(to)}</strong><span>${money(pair.amountCents)} · diferença de ${Number(pair.dateDistance||0)} dia(s)</span></div>`,
      onConfirm:()=>api.confirmFinanceTransfer({...pair,idempotencyKey:api.mutationId()})
    });
    if(result.confirmed){toast('Transferência entre contas confirmada.','success');await renderBanks();}
  }

  async function renderBanks(){
    const route='finance-banks';
    if(!await requireAccess(route))return;
    const [accounts,transactions,transfers,batches]=await Promise.all([
      api.financeAccounts(),
      api.statementTransactions({matchStatus:'UNMATCHED'}),
      api.transferSuggestions(),
      api.statementBatches()
    ]);
    if(!routeActive(route))return;
    const bankAccounts=accounts.filter(account=>account.active!==false&&(account.type==='BANK'||account.type==='CARD'));
    const accountsById=new Map(accounts.map(account=>[String(account.id),account]));
    content.innerHTML=page(route,'Importe extratos, concilie movimentações e reconheça transferências entre contas próprias.',
      `<section class="ops-card"><div class="ops-card-head"><div><h2>Importar extrato OFX</h2><p>O arquivo é lido localmente e só é gravado após a prévia.</p></div></div>
        <div id="erp-statement-import" class="ops-form-grid"><label class="field"><span>Conta</span><select id="erp-statement-account" class="ops-input">${bankAccounts.map(account=>`<option value="${esc(account.id)}">${esc(account.name)}</option>`).join('')}</select></label><div class="ops-actions"><button id="erp-pick-ofx" class="ops-secondary" type="button" ${bankAccounts.length?'':'disabled'}>Selecionar OFX</button></div></div>
        <div id="erp-statement-preview"><p class="ops-muted">${bankAccounts.length?'Selecione um arquivo OFX para visualizar a prévia.':'Cadastre uma conta bancária ou cartão antes de importar extratos.'}</p></div></section>
      <section class="ops-card"><div class="ops-card-head"><div><h2>Movimentações pendentes</h2><p>${transactions.length} movimentação(ões) aguardando conciliação.</p></div></div>
        <div id="erp-reconciliation-list">${transactions.map(tx=>`<div class="ops-detail-row"><div class="ops-detail-copy"><strong>${esc(tx.description)}</strong><small>${dateLabel(tx.date)} · ${tx.direction==='debit'?'Saída':'Entrada'} · ${money(tx.amountCents)}</small></div><div class="ops-actions"><button class="ops-link" type="button" data-reconcile-accept="${esc(tx.id)}">Conciliar</button><button class="ops-link" type="button" data-reconcile-manual="${esc(tx.id)}">Conciliar manualmente</button><button class="ops-link danger" type="button" data-reconcile-reject="${esc(tx.id)}">Ignorar sugestão</button></div></div>`).join('')||'<div class="ops-empty">Nenhuma movimentação pendente.</div>'}</div></section>
      <section class="ops-card"><div class="ops-card-head"><div><h2>Transferências entre suas contas</h2><p>Confirme pares identificados para que não sejam tratados como receita ou despesa.</p></div></div>
        <div id="erp-transfer-suggestions">${transfers.map((pair,index)=>{const from=accountsById.get(String(pair.fromAccountId))?.name||pair.fromAccountId;const to=accountsById.get(String(pair.toAccountId))?.name||pair.toAccountId;return`<div class="ops-detail-row"><div class="ops-detail-copy"><strong>${esc(from)} → ${esc(to)}</strong><small>${money(pair.amountCents)} · diferença de ${Number(pair.dateDistance||0)} dia(s)</small></div><button class="ops-secondary" type="button" data-transfer-index="${index}">Confirmar transferência</button></div>`;}).join('')||'<div class="ops-empty">Nenhuma transferência provável encontrada.</div>'}</div></section>
      <section class="ops-card"><div class="ops-card-head"><div><h2>Extratos importados</h2><p>${batches.length} lote(s) registrados.</p></div></div>
        <div id="erp-statement-history">${batches.map(batch=>`<div class="ops-detail-row"><div class="ops-detail-copy"><strong>${esc(batch.sourceName||'Extrato OFX')}</strong><small>${esc(accountsById.get(String(batch.accountId))?.name||batch.accountId)} · ${dateLabel(batch.createdAt)} · ${Number(batch.inserted||0)} importadas · ${Number(batch.duplicates||0)} duplicadas</small></div><button class="ops-secondary" type="button" data-statement-batch="${esc(batch.id)}">Ver detalhes</button></div>`).join('')||'<div class="ops-empty">Nenhum extrato importado.</div>'}</div></section>`);
    bindNavigation(content);

    document.getElementById('erp-pick-ofx')?.addEventListener('click',async()=>{
      try{
        const file=await root.artisysDesktop.imports.pickFile();if(!file)return;
        if(file.format!=='ofx')throw new Error('Selecione um arquivo OFX.');
        const accountId=document.getElementById('erp-statement-account')?.value;if(!accountId)throw new Error('Selecione a conta do extrato.');
        const preview=await api.statementPreview({accountId,sourceName:file.name,content:file.content});
        const previewHost=document.getElementById('erp-statement-preview');if(!previewHost)return;
        previewHost.innerHTML=`<div class="ops-summary-line"><span>${preview.transactions.length} movimentações · ${preview.duplicates} duplicadas</span><button id="erp-commit-ofx" class="ops-primary" type="button">Importar extrato</button></div>`;
        document.getElementById('erp-commit-ofx')?.addEventListener('click',async()=>{
          try{await api.statementCommit(api.mutationId(),{accountId,sourceName:file.name,content:file.content});toast('Extrato importado.','success');await renderBanks();}catch(error){toast(error.message||String(error),'error');}
        });
      }catch(error){toast(error.message||String(error),'error');}
    });

    content.querySelectorAll('[data-reconcile-accept]').forEach(button=>button.addEventListener('click',()=>void reviewSuggestion(button.dataset.reconcileAccept,'accept')));
    content.querySelectorAll('[data-reconcile-reject]').forEach(button=>button.addEventListener('click',()=>void reviewSuggestion(button.dataset.reconcileReject,'reject')));
    content.querySelectorAll('[data-reconcile-manual]').forEach(button=>button.addEventListener('click',()=>{
      const transaction=transactions.find(row=>String(row.id)===String(button.dataset.reconcileManual));if(transaction)void manualReconciliation(transaction);
    }));
    content.querySelectorAll('[data-transfer-index]').forEach(button=>button.addEventListener('click',()=>{
      const pair=transfers[Number(button.dataset.transferIndex)];if(pair)void confirmTransfer(pair,accountsById);
    }));
    content.querySelectorAll('[data-statement-batch]').forEach(button=>button.addEventListener('click',async()=>{
      try{
        const batch=await api.statementBatch(button.dataset.statementBatch);
        const modal=root.PdvModal;
        if(!modal?.open){toast('Detalhes do extrato indisponíveis.','error');return;}
        const rows=(batch.transactions||[]).map(tx=>`<tr><td>${dateLabel(tx.date)}</td><td>${esc(tx.description)}</td><td>${tx.direction==='debit'?'Saída':'Entrada'}</td><td>${money(tx.amountCents)}</td><td>${esc(statementStatusLabel(tx.matchStatus))}</td></tr>`).join('');
        modal.open(batch.sourceName||'Extrato importado',`<div class="ops-details"><div><dt>Conta</dt><dd>${esc(accountsById.get(String(batch.accountId))?.name||batch.accountId)}</dd></div><div><dt>Importadas</dt><dd>${Number(batch.inserted||0)}</dd></div><div><dt>Duplicadas</dt><dd>${Number(batch.duplicates||0)}</dd></div><div><dt>Data</dt><dd>${dateLabel(batch.createdAt)}</dd></div></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Valor</th><th>Situação</th></tr></thead><tbody>${rows||'<tr><td colspan="5">Nenhuma movimentação neste lote.</td></tr>'}</tbody></table></div>`,{wide:true});
      }catch(error){toast(error.message||String(error),'error');}
    }));
    routeRegistry.updated(route,{surface:'finance-banks'});
  }

  async function setRecurrenceStatus(rule,status){
    const ux=root.ArtisysUxComponents;
    const labels={ACTIVE:'retomada',PAUSED:'pausada',ENDED:'encerrada'};
    try{
    if(status==='ENDED'){
      if(!ux?.openFormDialog){toast('Diálogo financeiro indisponível.','error');return;}
      const result=await ux.openFormDialog({
        title:'Encerrar recorrência',
        description:`${rule.description} · ${money(rule.amountCents)}`,
        confirmLabel:'Encerrar recorrência',
        tone:'danger',
        initialFocus:'cancel',
        body:'<p>Novos lançamentos não serão gerados por esta regra.</p>',
        onConfirm:()=>api.setRecurrenceStatus(rule.id,'ENDED')
      });
      if(!result.confirmed)return;
    }else{
      await api.setRecurrenceStatus(rule.id,status);
    }
    toast(`Recorrência ${labels[status]||'atualizada'}.`,'success');
    await renderRecurrences();
    }catch(error){toast(error.message||String(error),'error');}
  }

  async function renderRecurrences(){
    const route='finance-recurrences';
    if(!await requireAccess(route))return;
    const recurrences=await api.recurrences();
    if(!routeActive(route))return;
    const statusLabel=value=>({ACTIVE:'Ativa',PAUSED:'Pausada',ENDED:'Encerrada'})[String(value||'').toUpperCase()]||value;
    content.innerHTML=page(route,'Crie regras recorrentes e controle quando novos lançamentos financeiros são gerados.',
      `<div class="ops-grid two"><section class="ops-card"><h2>Nova recorrência</h2><form id="erp-recurrence-form" class="ops-form" novalidate>
        <label>Tipo<select name="kind" class="ops-input"><option value="PAYABLE">Conta a pagar</option><option value="RECEIVABLE">Conta a receber</option></select></label>
        <label>Descrição<input name="description" class="ops-input"></label>
        <label>Valor (R$)<input name="amount" class="ops-input" inputmode="decimal"></label>
        <label>Início<input name="startDate" type="text" inputmode="numeric" autocomplete="off" data-date-ptbr class="ops-input" placeholder="dd/mm/aaaa" value="${root.PdvBusinessDate.formatDatePtBr(today())}"></label>
        <label>Dia de vencimento<input name="dueDay" type="number" min="1" max="31" class="ops-input" value="1"></label>
        <button class="ops-primary" type="submit">Criar recorrência</button></form></section>
      <section class="ops-card"><div class="ops-card-head"><div><h2>Regras cadastradas</h2><p>${recurrences.length} regra(s)</p></div><button id="erp-generate-recurrences" class="ops-secondary" type="button">Gerar lançamentos pendentes</button></div>
        <div id="erp-recurrence-list">${recurrences.map(rule=>`<div class="ops-detail-row"><div class="ops-detail-copy"><strong>${esc(rule.description)}</strong><small>${money(rule.amountCents)} · próximo ${dateLabel(rule.nextDueAt)} · ${esc(statusLabel(rule.status))}</small></div><div class="ops-actions">${rule.status==='ACTIVE'?'<button type="button" class="ops-secondary" data-recurrence-action="pause">Pausar</button>':''}${rule.status==='PAUSED'?'<button type="button" class="ops-secondary" data-recurrence-action="resume">Retomar</button>':''}${rule.status!=='ENDED'?'<button type="button" class="ops-link danger" data-recurrence-action="end">Encerrar</button>':''}</div></div>`).join('')||'<div class="ops-empty">Nenhuma recorrência cadastrada.</div>'}</div></section></div>`);
    bindNavigation(content);

    document.getElementById('erp-recurrence-form')?.addEventListener('submit',async event=>{
      event.preventDefault();
      const data=new FormData(event.currentTarget);
      const description=String(data.get('description')||'').trim();
      const amountCents=centsInput(data.get('amount'));
      const dueDay=Number(data.get('dueDay'));
      if(!description){toast('Informe a descrição da recorrência.','error');event.currentTarget.elements.description?.focus();return;}
      if(amountCents<=0){toast('Informe um valor maior que zero.','error');event.currentTarget.elements.amount?.focus();return;}
      if(!Number.isInteger(dueDay)||dueDay<1||dueDay>31){toast('Informe um dia de vencimento entre 1 e 31.','error');event.currentTarget.elements.dueDay?.focus();return;}
      try{const startDate=root.PdvBusinessDate.parseDatePtBr(String(data.get('startDate')||''));await api.createRecurrence({kind:data.get('kind'),description,amountCents,startDate,dueDay});toast('Recorrência criada.','success');await renderRecurrences();}catch(error){toast(error.message||String(error),'error');}
    });

    document.getElementById('erp-generate-recurrences')?.addEventListener('click',async()=>{
      const ux=root.ArtisysUxComponents;
      if(!ux?.openFormDialog){toast('Diálogo financeiro indisponível.','error');return;}
      const result=await ux.openFormDialog({
        title:'Gerar lançamentos pendentes',
        description:'Gera as ocorrências vencidas das regras ativas até a data escolhida.',
        confirmLabel:'Gerar lançamentos',
        body:`<label>Gerar até<input name="asOf" type="text" inputmode="numeric" autocomplete="off" data-date-ptbr class="ops-input" placeholder="dd/mm/aaaa" value="${root.PdvBusinessDate.formatDatePtBr(today())}"></label>`,
        validate:data=>{if(!data.asOf)return {message:'Informe a data limite.',field:'asOf'};try{root.PdvBusinessDate.parseDatePtBr(data.asOf);return null;}catch(error){return {message:error.message,field:'asOf'}}},
        onConfirm:data=>api.generateRecurrences(root.PdvBusinessDate.parseDatePtBr(data.asOf))
      });
      if(result.confirmed){toast(`${Array.isArray(result.value)?result.value.length:0} lançamento(s) gerado(s).`,'success');await renderRecurrences();}
    });

    content.querySelectorAll('#erp-recurrence-list .ops-detail-row').forEach((row,index)=>{
      const rule=recurrences[index];if(!rule)return;
      row.querySelector('[data-recurrence-action="pause"]')?.addEventListener('click',()=>void setRecurrenceStatus(rule,'PAUSED'));
      row.querySelector('[data-recurrence-action="resume"]')?.addEventListener('click',()=>void setRecurrenceStatus(rule,'ACTIVE'));
      row.querySelector('[data-recurrence-action="end"]')?.addEventListener('click',()=>void setRecurrenceStatus(rule,'ENDED'));
    });
    routeRegistry.updated(route,{surface:'finance-recurrences'});
  }

  async function renderAlerts(){
    const route='finance-alerts';
    if(!await requireAccess(route))return;
    const alerts=await api.financeAlerts(true);
    const activeAlerts=alerts.filter(alert=>!alert.hiddenAt);
    const hiddenAlerts=alerts.filter(alert=>Boolean(alert.hiddenAt));
    if(!routeActive(route))return;
    content.innerHTML=page(route,'Acompanhe vencimentos, saldo operacional e projeções que exigem atenção.',
      `<div class="ops-grid two"><section class="ops-card"><div class="ops-card-head"><div><h2>Alertas ativos</h2><p>${activeAlerts.length} alerta(s)</p></div></div><div id="erp-finance-alerts">${activeAlerts.map(alert=>`<div class="ops-detail-row"><div class="ops-detail-copy"><strong>${esc(alert.message)}</strong><small>${alert.amountCents!=null?money(alert.amountCents):''}${alert.dueDate?` · ${dateLabel(alert.dueDate)}`:''}${alert.readAt?' · Lido':''}</small></div><div class="ops-actions"><button class="ops-link" type="button" data-alert-read="${esc(alert.key)}">Marcar como lido</button><button class="ops-link" type="button" data-alert-hide="${esc(alert.key)}">Ocultar</button></div></div>`).join('')||'<div class="ops-empty">Nenhum alerta financeiro ativo.</div>'}</div></section>
      <section class="ops-card"><div class="ops-card-head"><div><h2>Alertas ocultos</h2><p>${hiddenAlerts.length} alerta(s)</p></div></div><div id="erp-finance-alerts-hidden">${hiddenAlerts.map(alert=>`<div class="ops-detail-row"><div class="ops-detail-copy"><strong>${esc(alert.message)}</strong><small>${alert.amountCents!=null?money(alert.amountCents):''}${alert.hiddenAt?` · ocultado em ${dateLabel(alert.hiddenAt)}`:''}</small></div><button class="ops-secondary" type="button" data-alert-unhide="${esc(alert.key)}">Restaurar</button></div>`).join('')||'<div class="ops-empty">Nenhum alerta oculto.</div>'}</div></section></div>`);
    bindNavigation(content);
    content.querySelectorAll('[data-alert-read]').forEach(button=>button.addEventListener('click',async()=>{try{await api.markFinanceAlertRead(button.dataset.alertRead);toast('Alerta marcado como lido.','success');await renderAlerts();}catch(error){toast(error.message||String(error),'error');}}));
    content.querySelectorAll('[data-alert-hide]').forEach(button=>button.addEventListener('click',async()=>{try{await api.hideFinanceAlert(button.dataset.alertHide);toast('Alerta ocultado.','success');await renderAlerts();}catch(error){toast(error.message||String(error),'error');}}));
    content.querySelectorAll('[data-alert-unhide]').forEach(button=>button.addEventListener('click',async()=>{try{await api.unhideFinanceAlert(button.dataset.alertUnhide);toast('Alerta restaurado.','success');await renderAlerts();}catch(error){toast(error.message||String(error),'error');}}));
    routeRegistry.updated(route,{surface:'finance-alerts'});
  }

  routeRegistry.register('finance-banks',{owner:'erp-finance-operations',render:renderBanks});
  routeRegistry.register('finance-recurrences',{owner:'erp-finance-operations',render:renderRecurrences});
  routeRegistry.register('finance-alerts',{owner:'erp-finance-operations',render:renderAlerts});

  root.PdvFinanceOperationsUi=Object.freeze({
    navigation,
    bindNavigation,
    renderBanks,
    renderRecurrences,
    renderAlerts
  });
})();
