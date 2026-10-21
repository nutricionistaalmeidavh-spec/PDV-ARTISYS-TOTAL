'use strict';
(() => {
 const root=window,{ApiClient}=root.PdvApiClient,api=new ApiClient(),routes=root.PdvRouteRegistry;
 const content=document.getElementById('route-content');
 const esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
 const money=v=>(Number(v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const date=()=>root.PdvBusinessDate?.localBusinessDate?.(new Date())||new Date().toISOString().slice(0,10);
 const toast=(s,type='')=>root.PdvToast?.show?.(s,type)||console[type==='error'?'error':'log'](s);
 const cents=v=>{
  const value=String(v??'').replace(/\s|R\$/gi,'');
  const negative=value.startsWith('-'),clean=value.replace(/^[+-]/,'');
  const decimal=clean.lastIndexOf(',')>clean.lastIndexOf('.')?',':'.';
  const parts=clean.split(decimal);
  const integer=parts.length>1?parts.slice(0,-1).join('').replace(/[.,]/g,''):clean.replace(/[.,]/g,'');
  const fraction=parts.length>1?parts.at(-1):'';
  if(!/^\d+$/.test(integer)||fraction&&!/^\d{1,2}$/.test(fraction))throw new Error('Valor monetário inválido.');
  const amount=Number(integer)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(amount)||amount>1e9)throw new Error('Valor fora do limite.');
  return negative?-amount:amount;
 };
 const isoDate=value=>{
  const s=String(value||'').trim();
  if(/^\d{4}-\d\d-\d\d/.test(s))return s.slice(0,10);
  const m=s.match(/^(\d\d)\/(\d\d)\/(\d{4})$/);
  if(m)return m[3]+'-'+m[2]+'-'+m[1];
  if(/^\d{8}$/.test(s))return s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6);
  throw new Error('Data do extrato inválida: '+s);
 };
 const request=(path,options={})=>api.request('/api/v1/finance-advanced/'+path,options);
 const wrap=(heading,subtitle,html)=>'<section class="ops-page"><header class="ops-head"><div><h1>'+esc(heading)+'</h1><p>'+esc(subtitle)+'</p></div></header>'+
  '<nav class="ops-actions" aria-label="Gestão financeira"><button type="button" class="ops-secondary" data-route="finance">Lançamentos</button><button type="button" class="ops-secondary" data-route="finance-banks">Conciliação</button><button type="button" class="ops-secondary" data-route="finance-recurrences">Recorrências</button><button type="button" class="ops-secondary" data-route="management">DRE</button></nav>'+html+'</section>';
 // Escape every external CSV field before placing it in the HTML view.
 function csvCells(text,sep){
  const rows=[],row=[];let part='',quote=false;
  for(let i=0;i<text.length;i++){
   const c=text[i];
   if(c==='"'){if(quote&&text[i+1]==='"'){part+='"';i++;}else quote=!quote;}
   else if(c===sep&&!quote){row.push(part);part='';}
   else if((c==='\r'||c==='\n')&&!quote){if(c==='\r'&&text[i+1]==='\n')i++;row.push(part);if(row.some(s=>s.trim()))rows.push([...row]);row.length=0;part='';}
   else part+=c;
  }
  if(quote)throw new Error('CSV com aspas não fechadas.');
  row.push(part);if(row.some(s=>s.trim()))rows.push(row);
  return rows;
 }
 function fromCsv(text){
  const header=text.split(/\r?\n/,1)[0]||'';
  const sep=[';',',','\t'].sort((a,b)=>header.split(b).length-header.split(a).length)[0];
  const rows=csvCells(text.replace(/^\uFEFF/,''),sep);
  const cols=(rows.shift()||[]).map(x=>x.trim().normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase());
  const at=(...opts)=>cols.findIndex(c=>opts.includes(c));
  const dt=at('data','date','dtposted'),amt=at('valor','amount','trnamt'),desc=at('descricao','historico','description','memo'),fit=at('fitid','id','documento'),type=at('tipo','type','trntype');
  if(dt<0||amt<0||desc<0)throw new Error('CSV precisa das colunas Data, Valor e Descrição.');
  return rows.map(row=>{
   let amount=cents(row[amt]);
   const direction=String(row[type]||'').trim().toUpperCase();
   if(['D','DEBIT','DEBITO','SAIDA'].includes(direction))amount=-Math.abs(amount);
   if(['C','CREDIT','CREDITO','ENTRADA'].includes(direction))amount=Math.abs(amount);
   return {date:isoDate(row[dt]),amountCents:amount,description:String(row[desc]||'').trim(),fitId:fit<0?'':String(row[fit]||'').trim()};
  });
 }
 function fromOfx(text){
  const chunks=text.match(/<STMTTRN>([\s\S]*?)(?=<STMTTRN>|<\/BANKTRANLIST>|$)/gi)||[];
  if(!chunks.length)throw new Error('Nenhuma movimentação STMTTRN no OFX.');
  const tag=(block,name)=>{
   const found=block.match(new RegExp('<'+name+'>\\s*([^<\\r\\n]+)','i'));
   return found?found[1].trim():'';
  };
  return chunks.map(block=>{
   const raw=tag(block,'DTPOSTED');
   const dateString=raw.slice(0,8),amount=cents(tag(block,'TRNAMT'));
   return {date:isoDate(dateString),amountCents:amount,description:tag(block,'MEMO')||tag(block,'NAME')||'Movimentação OFX',fitId:tag(block,'FITID')};
  });
 }
 const bankState={file:null,rows:[]};
 async function renderBanks(filters={}){
  try{
   const bankFilters={accountId:String(filters.accountId||''),status:String(filters.status||''),
     direction:String(filters.direction||''),query:String(filters.query||''),
     from:String(filters.from||''),to:String(filters.to||'')};
   const bankQuery=new URLSearchParams(Object.entries(bankFilters).filter(([,value])=>value));
   const [accounts,batches,transactions,transfers,groups,categories,centers]=await Promise.all([
    request('accounts'),request('statements'),
    request('transactions'+(bankQuery.size?'?'+bankQuery.toString():'')),
    request('transfers/suggestions'),request('dre/groups'),request('dre/categories'),request('dre/cost-centers')
   ]);
   if(document.body.dataset.activeRoute!=='finance-banks')return;
   const list=accounts.accounts||[],items=transactions.transactions||[],
    planGroups=groups.groups||[],planCategories=categories.categories||[],planCenters=centers.costCenters||[];
   const selectOptions=(arr,selected,anyLabel='Todos')=>
    '<option value="">'+esc(anyLabel)+'</option>'+arr.map(x=>
      '<option value="'+esc(x.id)+'" '+(selected===x.id?'selected':'')+'>'+esc(x.name)+'</option>').join('');
   content.innerHTML=wrap('Bancos e conciliação','Extratos OFX/CSV, baixas conciliadas e transferências entre contas sem duplicidade de DRE.',
    '<section class="ops-card"><h2>Carteiras e contas</h2><p class="ops-muted">Movimentações de extrato não representam saldo bancário confirmado: não existe saldo inicial informado neste módulo.</p>'+
    '<form id="cloud-bank-create" class="ops-form erp-inline-config-form"><label>Nome<input class="ops-input" name="name" maxlength="100" required></label>'+
    '<label>Tipo<select class="ops-input" name="walletKind"><option value="BANK">Banco</option><option value="CASH">Dinheiro</option><option value="OTHER">Outra carteira</option></select></label>'+
    '<label>Código do banco (opcional)<input class="ops-input" name="bankCode" maxlength="20"></label><button class="ops-primary" type="submit">Cadastrar carteira</button></form>'+
    '<div class="ops-grid two">'+list.map(x=>'<div class="ops-card"><strong>'+esc(x.name)+'</strong><p class="ops-muted">'+esc(({BANK:'Banco',CASH:'Dinheiro',OTHER:'Outra'}[x.walletKind]||x.walletKind))+'</p>'+
      (x.walletKind==='BANK'?'<small>Movimentação líquida importada: '+money(x.importedNetCents)+' · '+esc(x.importedMovements)+' linhas</small>':'<small>Carteira cadastrada; sem saldo atribuído automaticamente.</small>')+'</div>').join('')+'</div></section>'+
    '<section class="ops-card"><h2>Importar extrato</h2><p>O arquivo é lido e pré-visualizado neste navegador antes de enviar ao D1.</p><div class="ops-form-grid"><label>Conta<select id="cloud-bank-id" class="ops-input">'+list.filter(x=>x.active&&x.walletKind==='BANK').map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join('')+'</select></label><label>Arquivo CSV ou OFX<input id="cloud-bank-file" type="file" class="ops-input" accept=".csv,.ofx,text/csv"></label></div><div id="cloud-bank-preview" class="ops-muted">Selecione um extrato.</div><button id="cloud-bank-confirm" type="button" class="ops-primary" disabled>Confirmar importação</button><small>Máximo de 500 linhas por lote. Lançamentos existentes não são reimportados.</small></section>'+
    '<section class="ops-card"><h2>Movimentações do extrato</h2>'+
    '<form id="cloud-bank-filters" class="ops-form ops-form-grid" aria-label="Filtros bancários">'+
    '<label>Conta<select name="accountId" class="ops-input">'+selectOptions(list.filter(x=>x.walletKind==='BANK'),bankFilters.accountId,'Todas as contas')+'</select></label>'+
    '<label>Situação<select name="status" class="ops-input">'+[['','Todas'],['UNMATCHED','Pendente'],['MATCH','Conciliada'],['IGNORE','Ignorada'],['TRANSFER','Transferência']].map(x=>'<option value="'+x[0]+'" '+(bankFilters.status===x[0]?'selected':'')+'>'+x[1]+'</option>').join('')+'</select></label>'+
    '<label>Direção<select name="direction" class="ops-input">'+[['','Entradas e saídas'],['IN','Entradas'],['OUT','Saídas']].map(x=>'<option value="'+x[0]+'" '+(bankFilters.direction===x[0]?'selected':'')+'>'+x[1]+'</option>').join('')+'</select></label>'+
    '<label>Descrição<input type="search" name="query" class="ops-input" maxlength="100" value="'+esc(bankFilters.query)+'"></label>'+
    '<label>De<input type="date" name="from" class="ops-input" value="'+esc(bankFilters.from)+'"></label>'+
    '<label>Até<input type="date" name="to" class="ops-input" value="'+esc(bankFilters.to)+'"></label>'+
    '<button class="ops-primary" type="submit">Aplicar filtros</button></form>'+
    '<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Movimentação</th><th>Valor</th><th>Situação / ação</th></tr></thead><tbody>'+
    (items.map(x=>'<tr><td>'+esc(x.date)+'</td><td>'+esc(x.description)+'</td><td>'+money(x.amountCents)+'</td><td>'+(x.decision?esc(x.decision):'<button type="button" class="ops-link" data-cloud-suggest="'+esc(x.id)+'">Conciliar</button> <button type="button" class="ops-link" data-cloud-ignore="'+esc(x.id)+'">Ignorar</button>')+'</td></tr><tr id="cloud-match-'+esc(x.id)+'" hidden><td colspan="4"></td></tr>').join('')||'<tr><td colspan="4">Sem movimentações.</td></tr>')+
    '</tbody></table></div></section>'+
    '<section class="ops-card"><h2>Transferências entre contas próprias</h2><p>Transferências internas não contabilizam receita ou despesa.</p>'+
    ((transfers.transfers||[]).map(x=>'<div class="ops-detail-row"><span>'+money(x.amountCents)+' · '+esc(list.find(a=>a.id===x.fromAccountId)?.name||'Conta')+' → '+esc(list.find(a=>a.id===x.toAccountId)?.name||'Conta')+'</span><button class="ops-secondary" data-cloud-transfer="'+esc(x.fromTransactionId)+'" data-to="'+esc(x.toTransactionId)+'" type="button">Confirmar transferência</button></div>').join('')||'<p class="ops-muted">Nenhuma transferência candidata.</p>')+'</section>'+
    '<section class="ops-card"><h2>Importações recentes</h2><p class="ops-muted">'+(batches.batches||[]).map(x=>esc(x.sourceName)).join(' · ')+'</p></section>'+
    '<section class="ops-card"><details id="cloud-chart-of-accounts"><summary><strong>Plano de contas e centros de custo</strong></summary>'+
    '<p class="ops-muted">Classificação canônica usada pelo DRE; cadastros aqui são os mesmos dos relatórios.</p>'+
    '<div class="ops-grid two"><div><h3>Grupos do plano</h3>'+
    '<form id="cloud-plan-group" class="ops-form"><label>Nome<input name="name" class="ops-input" required maxlength="100"></label>'+
    '<label>Natureza<select name="nature" class="ops-input"><option value="REVENUE">Receita</option><option value="COST">Custo</option><option value="EXPENSE">Despesa</option><option value="OTHER">Outros</option></select></label><button type="submit" class="ops-secondary">Adicionar grupo</button></form>'+
    '<p>'+planGroups.map(x=>esc(x.name)).join(' · ')+'</p></div>'+
    '<div><h3>Categorias</h3><form id="cloud-plan-category" class="ops-form"><label>Nome<input name="name" class="ops-input" maxlength="100" required></label>'+
    '<label>Tipo<select name="kind" class="ops-input"><option value="EXPENSE">Despesa</option><option value="INCOME">Receita</option><option value="BOTH">Ambos</option></select></label>'+
    '<label>Grupo<select name="dreGroupId" class="ops-input">'+selectOptions(planGroups,'','Sem grupo')+'</select></label>'+
    '<button type="submit" class="ops-secondary">Adicionar categoria</button></form>'+
    '<p>'+planCategories.map(x=>esc(x.name)+' ('+esc(planGroups.find(g=>g.id===x.dreGroupId)?.name||'Sem grupo')+')').join(' · ')+'</p></div></div>'+
    '<h3>Centros de custo</h3><form id="cloud-plan-center" class="ops-form erp-inline-config-form"><label>Nome<input name="name" class="ops-input" maxlength="100" required></label><button class="ops-secondary" type="submit">Adicionar centro</button></form>'+
    '<p>'+planCenters.map(x=>esc(x.name)).join(' · ')+'</p></details></section>');
   content.querySelector('#cloud-bank-filters')?.addEventListener('submit',ev=>{
    ev.preventDefault();
    const values=Object.fromEntries(new FormData(ev.currentTarget));
    if(values.from&&values.to&&values.from>values.to){toast('Período bancário invertido.','error');return;}
    void renderBanks(values);
   });
   for(const [formId,endpoint] of [['cloud-plan-group','dre/groups'],['cloud-plan-category','dre/categories'],['cloud-plan-center','dre/cost-centers']]){
    content.querySelector('#'+formId)?.addEventListener('submit',async ev=>{
     ev.preventDefault();const button=ev.currentTarget.querySelector('[type=submit]');button.disabled=true;
     const body=Object.fromEntries(new FormData(ev.currentTarget));if(body.dreGroupId==='')body.dreGroupId=null;
     try{await request(endpoint,{method:'POST',body});toast('Plano de contas atualizado.','success');await renderBanks(bankFilters);}
     catch(e){toast(e.message,'error');button.disabled=false;}
    });
   }
   content.querySelector('#cloud-bank-create')?.addEventListener('submit',async ev=>{
    ev.preventDefault();const data=Object.fromEntries(new FormData(ev.currentTarget));
    try{await request('accounts',{method:'POST',body:data});toast('Conta bancária cadastrada.','success');await renderBanks();}catch(e){toast(e.message,'error');}
   });
   content.querySelector('#cloud-bank-file')?.addEventListener('change',async ev=>{
    const file=ev.currentTarget.files?.[0];bankState.file=null;bankState.rows=[];
    const preview=content.querySelector('#cloud-bank-preview'),confirm=content.querySelector('#cloud-bank-confirm');confirm.disabled=true;
    if(!file)return;
    try{
     if(file.size>262144)throw new Error('Arquivo acima de 256 KB: divida o extrato em lotes.');
     const value=await file.text();const records=/\.ofx$/i.test(file.name)||/<STMTTRN>/i.test(value)?fromOfx(value):fromCsv(value);
     if(!records.length||records.length>500)throw new Error('O extrato precisa conter entre 1 e 500 movimentações.');
     if(records.some(row=>!row.amountCents||!row.description))throw new Error('Arquivo contém valores zerados ou descrição vazia.');
     bankState.file=file;bankState.rows=records;
     preview.innerHTML='<strong>'+records.length+' movimentos na prévia</strong><div class="ops-table-wrap"><table class="ops-table"><tbody>'+
      records.slice(0,12).map(row=>'<tr><td>'+esc(row.date)+'</td><td>'+esc(row.description)+'</td><td>'+money(row.amountCents)+'</td></tr>').join('')+'</tbody></table></div>';
     confirm.disabled=!list.some(x=>x.active&&x.walletKind==='BANK');
    }catch(e){preview.textContent=e.message;toast(e.message,'error');}
   });
   content.querySelector('#cloud-bank-confirm')?.addEventListener('click',async ev=>{
    if(!bankState.file||!bankState.rows.length)return;
    ev.currentTarget.disabled=true;
    try{
     const accountId=content.querySelector('#cloud-bank-id').value;
     const result=await request('statements/import',{method:'POST',body:{accountId,sourceName:bankState.file.name,transactions:bankState.rows}});
     toast('Importadas '+result.result.imported+' movimentações; '+result.result.duplicates+' repetidas.','success');await renderBanks();
    }catch(e){toast(e.message,'error');ev.currentTarget.disabled=false;}
   });
   content.querySelectorAll('[data-cloud-ignore]').forEach(btn=>btn.addEventListener('click',async()=>{
    if(!root.confirm('Ignorar esta movimentação? Ela não gerará lançamento financeiro.'))return;
    try{await request('reconcile/ignore',{method:'POST',body:{transactionId:btn.dataset.cloudIgnore}});await renderBanks(bankFilters);}catch(e){toast(e.message,'error');}
   }));
   content.querySelectorAll('[data-cloud-suggest]').forEach(btn=>btn.addEventListener('click',async()=>{
    const panel=document.getElementById('cloud-match-'+btn.dataset.cloudSuggest);
    if(!panel)return;
    try{
     const [openMatches,existingSettlements]=await Promise.all([
      request('suggestions/'+encodeURIComponent(btn.dataset.cloudSuggest)),
      request('settlement-suggestions/'+encodeURIComponent(btn.dataset.cloudSuggest))
     ]);
     const matches=openMatches.suggestions||[],settlements=existingSettlements.settlements||[];
     panel.hidden=false;
     panel.querySelector('td').innerHTML='<strong>Contas em aberto (criar baixa conciliada)</strong> '+
      (matches.map(x=>'<button type="button" class="ops-secondary" data-cloud-match="'+esc(x.id)+'">'+esc(x.description)+' · saldo '+money(x.openCents)+'</button>').join(' ')||
       '<span class="ops-muted">Sem conta aberta compatível.</span>')+
      '<h3>Pagamentos já registrados (sem duplicar baixa)</h3>'+
      (settlements.map(x=>'<button type="button" class="ops-secondary" data-cloud-link="'+esc(x.id)+'">'+esc(x.description)+' · '+money(x.amountCents)+' · '+esc(String(x.occurredAt).slice(0,10))+'</button>').join(' ')||
       '<p class="ops-muted">Nenhum pagamento existente com este valor e natureza.</p>');
     panel.querySelectorAll('[data-cloud-link]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try{
       await request('reconcile/link',{method:'POST',body:{transactionId:btn.dataset.cloudSuggest,settlementId:button.dataset.cloudLink}});
       toast('Pagamento já existente vinculado ao extrato, sem duplicidade.','success');await renderBanks(bankFilters);
      }catch(e){toast(e.message,'error');button.disabled=false;}
     }));
     panel.querySelectorAll('[data-cloud-match]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try{await request('reconcile/match',{method:'POST',body:{transactionId:btn.dataset.cloudSuggest,entryId:button.dataset.cloudMatch}});toast('Baixa financeira conciliada.','success');await renderBanks(bankFilters);}
      catch(e){toast(e.message,'error');button.disabled=false;}
     }));
    }catch(e){toast(e.message,'error');}
   }));
   content.querySelectorAll('[data-cloud-transfer]').forEach(btn=>btn.addEventListener('click',async()=>{
    btn.disabled=true;try{await request('transfers/confirm',{method:'POST',body:{fromTransactionId:btn.dataset.cloudTransfer,toTransactionId:btn.dataset.to}});toast('Transferência conciliada sem afetar DRE.','success');await renderBanks();}
    catch(e){toast(e.message,'error');btn.disabled=false;}
   }));
  }catch(e){content.innerHTML=wrap('Bancos e conciliação','Falha de consulta.','<div class="ops-error">'+esc(e.message)+'</div>');}
 }
 async function renderRecurrences(){
  try{
   const [data,notice,due]=await Promise.all([
    request('recurrences'),request('recurrences/alerts?asOf='+encodeURIComponent(date())+'&horizonDays=14'),
    request('due?asOf='+encodeURIComponent(date())+'&horizonDays=14')
   ]);
   if(document.body.dataset.activeRoute!=='finance-recurrences')return;
   const list=data.recurrences||[],alerts=notice.alerts?.items||[],dueItems=due.due?.items||[];
   const severityText=x=>x==='OVERDUE'?'Atrasada':x==='TODAY'?'Vence hoje':'Próxima';
   content.innerHTML=wrap('Contas recorrentes','Crie compromissos periódicos e gere parcelas em lote, sem duplicar lançamentos.',
    '<section class="ops-card"><h2>Alertas de vencimento e recorrência</h2>'+
    '<p class="ops-muted">Próximos 14 dias. Consultas locais aos registros da filial; nenhum lembrete é enviado a serviços externos.</p>'+
    '<div class="ops-metrics"><article class="ops-metric"><span>Recorrências a gerar</span><strong>'+alerts.length+'</strong></article>'+
    '<article class="ops-metric"><span>Contas em atraso</span><strong>'+dueItems.filter(x=>x.severity==='OVERDUE').length+'</strong></article>'+
    '<article class="ops-metric"><span>Em aberto até 14 dias</span><strong>'+money(due.due?.totals?.todayCents+due.due?.totals?.upcomingCents)+'</strong></article></div>'+
    '<div class="ops-grid two"><div><h3>Regras recorrentes</h3>'+
    (alerts.map(x=>'<p role="status" class="ops-muted">'+esc(severityText(x.severity))+' · '+esc(x.description)+' · '+esc(x.nextDueDate)+' · '+money(x.amountCents)+'</p>').join('')||'<p class="ops-muted">Nenhuma regra requer geração.</p>')+
    '<p class="ops-muted">Use “Gerar contas” para materializar as parcelas. Alertas não criam lançamentos sozinhos.</p></div>'+
    '<div><h3>Vencimentos em aberto</h3>'+
    (dueItems.slice(0,20).map(x=>'<p class="ops-muted">'+esc(severityText(x.severity))+' · '+esc(x.description)+' · '+esc(x.dueDate)+' · '+money(x.openCents)+'</p>').join('')||'<p class="ops-muted">Sem vencimentos pendentes neste período.</p>')+
    '</div></div></section>'+
    '<section class="ops-card"><h2>Nova recorrência</h2><form id="cloud-rec-create" class="ops-form ops-form-grid"><label>Descrição<input name="description" class="ops-input" required></label><label>Tipo<select name="kind" class="ops-input"><option value="PAYABLE">Despesa a pagar</option><option value="RECEIVABLE">Valor a receber</option></select></label><label>Valor (R$)<input name="amount" class="ops-input" placeholder="129,90" required></label><label>Frequência<select name="frequency" class="ops-input"><option value="MONTHLY">Mensal</option><option value="WEEKLY">Semanal</option><option value="YEARLY">Anual</option><option value="DAILY">Diária</option></select></label><label>Primeiro vencimento<input type="date" name="startDate" value="'+esc(date())+'" class="ops-input" required></label><label>Último vencimento (opcional)<input type="date" name="endDate" class="ops-input"></label><button class="ops-primary" type="submit">Salvar recorrência</button></form></section>'+
    '<section class="ops-card"><h2>Gerar parcelas pendentes</h2><form id="cloud-rec-generate" class="ops-form erp-inline-config-form"><label>Gerar até<input class="ops-input" type="date" name="asOf" value="'+esc(date())+'" required></label><button class="ops-primary" type="submit">Gerar contas</button></form><small>Até 100 parcelas por regra em cada execução, com lançamento único por vencimento.</small></section>'+
    '<section class="ops-card"><h2>Recorrências cadastradas</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Compromisso</th><th>Tipo</th><th>Valor</th><th>Próximo vencimento</th><th>Situação</th><th></th></tr></thead><tbody>'+
    (list.map(x=>'<tr><td>'+esc(x.description)+'</td><td>'+esc(x.kind)+' · '+esc(x.frequency)+'</td><td>'+money(x.amountCents)+'</td><td>'+esc(x.nextDueDate)+'</td><td>'+esc(x.status)+'</td><td>'+
     (x.status==='CANCELLED'?'Encerrada':'<button class="ops-secondary" data-cloud-rec="'+esc(x.id)+'" data-status="'+(x.status==='ACTIVE'?'PAUSED':'ACTIVE')+'">'+(x.status==='ACTIVE'?'Pausar':'Reativar')+'</button> <button class="ops-link" data-cloud-rec="'+esc(x.id)+'" data-status="CANCELLED">Cancelar</button>')+'</td></tr>').join('')||'<tr><td colspan="6">Nenhuma recorrência.</td></tr>')+'</tbody></table></div></section>');
   content.querySelector('#cloud-rec-create')?.addEventListener('submit',async ev=>{
    ev.preventDefault();const form=Object.fromEntries(new FormData(ev.currentTarget));
    try{const amountCents=cents(form.amount);if(amountCents<=0)throw new Error('Informe valor positivo.');
     delete form.amount;await request('recurrences',{method:'POST',body:{...form,amountCents,endDate:form.endDate||null}});
     toast('Recorrência salva. Gere as parcelas quando desejar.','success');await renderRecurrences();
    }catch(e){toast(e.message,'error');}
   });
   content.querySelector('#cloud-rec-generate')?.addEventListener('submit',async ev=>{
    ev.preventDefault();const asOf=new FormData(ev.currentTarget).get('asOf');
    try{const x=await request('recurrences/generate',{method:'POST',body:{asOf}});toast(x.result.created+' parcelas geradas.','success');await renderRecurrences();}
    catch(e){toast(e.message,'error');}
   });
   content.querySelectorAll('[data-cloud-rec]').forEach(btn=>btn.addEventListener('click',async()=>{
    if(btn.dataset.status==='CANCELLED'&&!root.confirm('Cancelar definitivamente esta recorrência? Parcelas já criadas serão preservadas.'))return;
    try{await request('recurrences/'+encodeURIComponent(btn.dataset.cloudRec)+'/status',{method:'PATCH',body:{status:btn.dataset.status}});await renderRecurrences();}
    catch(e){toast(e.message,'error');}
   }));
  }catch(e){content.innerHTML=wrap('Recorrências','Falha de consulta.','<div class="ops-error">'+esc(e.message)+'</div>');}
 }
 const currentDre={filters:null};
 async function renderDre(filters={}){
  const from=filters.from||date().slice(0,7)+'-01',to=filters.to||date(),basis=filters.basis||'accrual';
  try{
   const [result,config,centers,categoriesResponse,cashflowResponse]=await Promise.all([
    request('dre?'+new URLSearchParams({from,to,basis})),
    request('dre/groups'),request('dre/cost-centers'),request('dre/categories'),request('dre/cashflow?'+new URLSearchParams({from,to}))
   ]);
   if(document.body.dataset.activeRoute!=='management')return;
   const dre=result.dre,groups=config.groups||[],costCenters=centers.costCenters||[],categories=categoriesResponse.categories||[],cashflow=cashflowResponse.cashflow;
   currentDre.filters={from,to,basis,groups,costCenters};
   content.innerHTML=wrap('Gestão e DRE','Resultado canônico: vendas do PDV + lançamentos financeiros, sem movimentações de transferências internas.',
    '<form id="cloud-dre-filter" class="ops-card ops-form erp-inline-config-form"><label>De<input class="ops-input" name="from" type="date" value="'+esc(from)+'"></label><label>Até<input class="ops-input" name="to" type="date" value="'+esc(to)+'"></label><label>Base<select name="basis" class="ops-input"><option value="accrual" '+(basis==='accrual'?'selected':'')+'>Competência</option><option value="cash" '+(basis==='cash'?'selected':'')+'>Caixa realizado</option></select></label><button class="ops-primary" type="submit">Aplicar</button><button id="cloud-export-dre" type="button" class="ops-secondary">Exportar CSV</button></form>'+
    '<div class="ops-metrics">'+[['Receitas',dre.revenueCents],['Custos',dre.costCents],['Despesas',dre.expenseCents],['Resultado',dre.resultCents]].map(x=>'<article class="ops-metric"><span>'+esc(x[0])+'</span><strong>'+money(x[1])+'</strong></article>').join('')+'</div>'+
    '<section class="ops-card"><h2>Fluxo de caixa · realizado e previsto</h2><div class="ops-metrics">'+[['Entradas realizadas',cashflow.realizedInflowCents],['Saídas realizadas',cashflow.realizedOutflowCents],['A receber',cashflow.projectedReceivableCents],['A pagar',cashflow.projectedPayableCents],['Saldo projetado (variação)',cashflow.projectedClosingDeltaCents]].map(x=>'<article class="ops-metric"><span>'+esc(x[0])+'</span><strong>'+money(x[1])+'</strong></article>').join('')+'</div></section>'+
    '<section class="ops-card"><h2>Demonstração do resultado · margem '+esc(dre.marginPercent)+'%</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Grupo</th><th>Natureza</th><th>Centro de custo</th><th>Valor</th><th></th></tr></thead><tbody>'+
    (dre.groups||[]).map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.nature)+'</td><td>'+esc(costCenters.find(y=>y.id===x.costCenterId)?.name||'—')+'</td><td>'+money(x.amountCents)+'</td><td><button type="button" class="ops-link" data-cloud-drill="'+esc(x.id)+'">Detalhes</button></td></tr>').join('')+'</tbody></table></div></section>'+
    '<section class="ops-card" id="cloud-dre-details"><h2>Detalhamento</h2><p>Selecione um grupo para conferir a origem dos valores e classificá-los.</p></section>'+
    '<section class="ops-card"><h2>Comparação entre períodos</h2><div id="cloud-dre-compare"><button type="button" id="cloud-compare-load" class="ops-secondary">Comparar com período anterior</button></div></section>'+
    '<section class="ops-card"><h2>Configuração de grupos DRE</h2><form id="cloud-dre-group" class="ops-form erp-inline-config-form"><label>Nome<input name="name" class="ops-input" required></label><label>Natureza<select name="nature" class="ops-input"><option value="REVENUE">Receita</option><option value="COST">Custo</option><option value="EXPENSE">Despesa</option><option value="OTHER">Outros</option></select></label><button type="submit" class="ops-secondary">Criar grupo</button></form><p>'+groups.map(g=>esc(g.name)).join(' · ')+'</p></section>'+
    '<section class="ops-card"><h2>Categorias financeiras</h2><form id="cloud-dre-category" class="ops-form erp-inline-config-form"><label>Nome<input name="name" class="ops-input" required></label><label>Tipo<select name="kind" class="ops-input"><option value="EXPENSE">Despesa</option><option value="INCOME">Receita</option><option value="BOTH">Ambos</option></select></label><label>Grupo DRE<select name="dreGroupId" class="ops-input"><option value="">Sem grupo</option>'+groups.map(g=>'<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>').join('')+'</select></label><button type="submit" class="ops-secondary">Criar categoria</button></form><p>'+categories.map(c=>esc(c.name)).join(' · ')+'</p></section>'+
    '<section class="ops-card"><h2>Centros de custo</h2><form id="cloud-dre-center" class="ops-form erp-inline-config-form"><label>Nome<input name="name" class="ops-input" required></label><button type="submit" class="ops-secondary">Criar centro</button></form><p>'+costCenters.map(x=>esc(x.name)).join(' · ')+'</p></section>');
   content.querySelector('#cloud-dre-filter').addEventListener('submit',ev=>{ev.preventDefault();void renderDre(Object.fromEntries(new FormData(ev.currentTarget)));});
   content.querySelector('#cloud-dre-group').addEventListener('submit',async ev=>{ev.preventDefault();try{await request('dre/groups',{method:'POST',body:Object.fromEntries(new FormData(ev.currentTarget))});await renderDre({from,to,basis});}catch(e){toast(e.message,'error');}});
   content.querySelector('#cloud-dre-category').addEventListener('submit',async ev=>{ev.preventDefault();try{const values=Object.fromEntries(new FormData(ev.currentTarget));await request('dre/categories',{method:'POST',body:{...values,dreGroupId:values.dreGroupId||null}});await renderDre({from,to,basis});}catch(e){toast(e.message,'error');}});
   content.querySelector('#cloud-dre-center').addEventListener('submit',async ev=>{ev.preventDefault();try{await request('dre/cost-centers',{method:'POST',body:Object.fromEntries(new FormData(ev.currentTarget))});await renderDre({from,to,basis});}catch(e){toast(e.message,'error');}});
   content.querySelectorAll('[data-cloud-drill]').forEach(btn=>btn.addEventListener('click',async()=>{
    const panel=content.querySelector('#cloud-dre-details');
    try{
     const x=await request('dre/details?'+new URLSearchParams({from,to,basis,groupId:btn.dataset.cloudDrill}));
     panel.innerHTML='<h2>Composição do grupo</h2><div class="ops-table-wrap"><table class="ops-table"><tbody>'+
      (x.details||[]).map(d=>'<tr><td>'+esc(d.date)+'</td><td>'+esc(d.description)+'</td><td>'+money(d.amountCents)+'</td><td>'+
       (d.kind?'<form class="ops-form" data-cloud-classify="'+esc(d.id)+'"><label>Grupo<select name="dreGroupId" class="ops-input"><option value="">Sem grupo</option>'+groups.filter(g=>d.kind==='PAYABLE'?['COST','EXPENSE','OTHER'].includes(g.nature):['REVENUE','OTHER'].includes(g.nature)).map(g=>'<option value="'+esc(g.id)+'">'+esc(g.name)+'</option>').join('')+'</select></label><label>Categoria<select name="categoryId" class="ops-input"><option value="">Sem categoria</option>'+categories.filter(c=>c.kind==='BOTH'||(d.kind==='PAYABLE'?c.kind==='EXPENSE':c.kind==='INCOME')).map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('')+'</select></label><label>Centro<select name="costCenterId" class="ops-input"><option value="">Sem centro</option>'+costCenters.map(c=>'<option value="'+esc(c.id)+'">'+esc(c.name)+'</option>').join('')+'</select></label><button class="ops-secondary" type="submit">Salvar</button></form>':'Venda PDV')+'</td></tr>').join('')+'</tbody></table></div>';
     panel.querySelectorAll('form[data-cloud-classify]').forEach(form=>form.addEventListener('submit',async ev=>{
      ev.preventDefault();const values=Object.fromEntries(new FormData(form));
      try{await request('dre/classify/'+encodeURIComponent(form.dataset.cloudClassify),{method:'POST',body:{
        dreGroupId:values.dreGroupId||null,costCenterId:values.costCenterId||null,categoryId:values.categoryId||null
      }});
       toast('Classificação atualizada.','success');await renderDre({from,to,basis});
      }catch(e){toast(e.message,'error');}
     }));
    }catch(e){panel.textContent=e.message;}
   }));
   content.querySelector('#cloud-compare-load').addEventListener('click',async()=>{
    try{
     const days=Math.round((new Date(to+'T00:00:00Z')-new Date(from+'T00:00:00Z'))/864e5)+1;
     const end=new Date(from+'T00:00:00Z');end.setUTCDate(end.getUTCDate()-1);
     const start=new Date(end);start.setUTCDate(start.getUTCDate()-days+1);
     const old=(await request('dre?'+new URLSearchParams({from:start.toISOString().slice(0,10),to:end.toISOString().slice(0,10),basis}))).dre;
     content.querySelector('#cloud-dre-compare').innerHTML='<p>Período anterior: '+esc(start.toISOString().slice(0,10))+' a '+esc(end.toISOString().slice(0,10))+'</p>'+
      [['Receitas',dre.revenueCents-old.revenueCents],['Custos',dre.costCents-old.costCents],['Despesas',dre.expenseCents-old.expenseCents],['Resultado',dre.resultCents-old.resultCents]].map(x=>'<span class="ops-badge">'+esc(x[0])+' Δ '+money(x[1])+'</span>').join(' ');
    }catch(e){toast(e.message,'error');}
   });
   content.querySelector('#cloud-export-dre').addEventListener('click',()=>{
    const safe=value=>{const text=String(value??'');const guarded=/^[=+@\-\t\r]/.test(text)?"'"+text:text;return '"'+guarded.replace(/"/g,'""')+'"';};
    const rows=[['Grupo','Natureza','Centro de custo','Centavos','Base','De','Até'],...(dre.groups||[]).map(x=>[x.name,x.nature,costCenters.find(c=>c.id===x.costCenterId)?.name||'',x.amountCents,basis,from,to])];
    const blob=new Blob(['\uFEFF'+rows.map(row=>row.map(safe).join(';')).join('\r\n')+'\r\n'],{type:'text/csv;charset=utf-8'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='dre-'+basis+'-'+from+'-'+to+'.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   });
  }catch(e){content.innerHTML=wrap('Gestão e DRE','Falha de consulta.','<div class="ops-error">'+esc(e.message)+'</div>');}
 }
 if(api.webMode){
 routes.register('finance-banks',{owner:'cloud-finance-advanced',render:renderBanks});
 routes.register('finance-recurrences',{owner:'cloud-finance-advanced',render:renderRecurrences});
 content.addEventListener('click',event=>{
  const button=event.target.closest('button[data-route]');
  if(!button||!button.closest('.ops-page'))return;
  const navigation=document.querySelector('#sidebar-nav [data-route="'+button.dataset.route+'"]');
  if(navigation){event.preventDefault();navigation.click();}
 });
}
 root.PdvAdvancedFinanceWeb=Object.freeze({renderBanks,renderRecurrences,renderDre});
})();