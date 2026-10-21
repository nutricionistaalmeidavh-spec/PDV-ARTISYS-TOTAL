'use strict';

// R4 web/PWA surface: operational orders are never a second POS or stock ledger.
// All mutations use the existing authenticated tenant/branch API client.
(() => {
 const root=window,ApiClient=root.PdvApiClient?.ApiClient;
 if(!ApiClient)return;
 const api=new ApiClient(),host=document.getElementById('route-content');
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=x=>(Number(x||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const can=key=>Boolean(root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,key));
 const path='/api/v1/restaurant';
 const today=new Date().toISOString().slice(0,10);
 const monthAgo=new Date(Date.now()-30*86400000).toISOString().slice(0,10);
 let state={tables:[],orders:[],nextCursor:null,prepayments:null,splitPlan:null,tickets:[],stationTickets:[],printJobs:[],requests:[],products:[],split:null,report:null,reportRows:[],reportNextCursor:null,from:monthAgo,to:today,selected:'',checkout:null,section:'tables'};
 const notice=(value,error=false)=>root.PdvToast?.show?.(value,error?'error':'success');
 const action=(endpoint,method='GET',body)=>api.request(path+endpoint,{method,body});
 const safe=async(fn,fallback=[])=>{try{return await fn();}catch{return fallback;}};
 const field=(label,name,type='text',extra='')=>'<label class="field"><span>'+esc(label)+'</span><input name="'+esc(name)+'" type="'+type+'" '+extra+'></label>';
 const btn=(label,what,id='',extra='')=>'<button class="secondary-button" type="button" data-r4-action="'+esc(what)+'" data-id="'+esc(id)+'" '+extra+'>'+esc(label)+'</button>';
 const form=async(endpoint,body)=>action(endpoint,'POST',body);
 function back(){return '<button type="button" class="secondary-button" data-r4-action="back">← Alimentação</button>';}
 function orderLines(order){return (order.items||[]).map(i=>esc(i.name||i.productName)+' × '+esc(i.quantity)+
   (i.configuration?.flavors?.length?' ('+esc(i.configuration.flavors.map(x=>x.name).join(' / '))+')':'')).join(', ')||'Nenhum item';}
 function orderItemRow(){
   return '<div class="restaurant-card" data-r4-order-item>'+
     '<label class="field"><span>Produto</span><select name="productId" required>'+state.products.filter(p=>p.active!==false).map(p=>
       '<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('')+'</select></label>'+
     field('Quantidade','quantity','number','min="0.001" step="0.001" value="1" required')+
     '<div data-r4-pizza-options aria-live="polite"></div>'+
     '<button type="button" class="secondary-button" data-r4-remove-line>Remover item</button></div>';
 }
 async function preparePizzaRow(row){
   const select=row.querySelector('[name="productId"]'),output=row.querySelector('[data-r4-pizza-options]');
   if(!select||!output)return;
   const id=select.value;
   row.dataset.r4PizzaState='loading';output.textContent='Consultando configurações do produto…';
   try{
     const response=await action('/pizzeria/products/'+encodeURIComponent(id));
     if(select.value!==id)return;
     const profile=response.profile;
     if(!profile){row.dataset.r4PizzaState='none';output.textContent='';return;}
     row.dataset.r4PizzaState='configured';
     row.dataset.r4MaxFlavors=String(profile.maxFlavors||4);
     output.innerHTML='<fieldset><legend>Monte a pizza</legend>'+
       '<label class="field"><span>Tamanho</span><select name="sizeCode" required>'+profile.sizes.map(x=>
         '<option value="'+esc(x.code)+'">'+esc(x.name)+'</option>').join('')+'</select></label>'+
       '<fieldset><legend>Sabores (até '+esc(profile.maxFlavors)+')</legend>'+profile.flavors.map(x=>
         '<label><input type="checkbox" name="flavorCodes" value="'+esc(x.code)+'"> '+esc(x.name)+'</label>').join('')+'</fieldset>'+
       '<label class="field"><span>Borda</span><select name="crustCode"><option value="">Sem borda</option>'+
       profile.crusts.map(x=>'<option value="'+esc(x.code)+'">'+esc(x.name)+'</option>').join('')+'</select></label>'+
       '<fieldset><legend>Adicionais</legend>'+(profile.addons||[]).map(x=>
         '<label><input type="checkbox" name="addonCodes" value="'+esc(x.code)+'"> '+esc(x.name)+' · '+money(x.priceCents)+'</label>').join('')+'</fieldset></fieldset>';
   }catch(e){if(select.value!==id)return;row.dataset.r4PizzaState='error';output.textContent='Não foi possível carregar opções de pizza. Atualize ou selecione outro produto.';}
 }
 function bindOrderRow(row){
   row.querySelector('[name="productId"]')?.addEventListener('change',()=>void preparePizzaRow(row));
   row.querySelector('[data-r4-remove-line]')?.addEventListener('click',()=>{
     if(row.closest('form')?.querySelectorAll('[data-r4-order-item]').length>1)row.remove();
   });
   void preparePizzaRow(row);
 }
 function title(value){return ({TABLE:'Mesa',PICKUP:'Retirada',DELIVERY:'Entrega',OPEN:'Aberto',READY:'Pronto',DELIVERED:'Entregue',CANCELLED:'Cancelado',NEW:'Novo',PREPARING:'Preparando',ACKNOWLEDGED:'Em atendimento',CLOSED:'Finalizado',WAITER:'Garçom',BILL:'Conta'})[value]||value;}
 async function load(){
   const [tables,orderPage,tickets,stationTickets,printJobs,requests,products,report,reportPage,prepayments,splitPlan]=await Promise.all([
     safe(()=>action('/tables').then(v=>v.tables)),safe(()=>action('/orders?limit=40'),{orders:[],nextCursor:null}),
     safe(()=>action('/kitchen').then(v=>v.tickets)),safe(()=>action('/kitchen/station-tickets').then(v=>v.tickets)),safe(()=>action('/kitchen/print-jobs').then(v=>v.jobs)),safe(()=>action('/requests').then(v=>v.requests)),
     safe(()=>api.products(false)),safe(()=>action('/reports/summary?from='+encodeURIComponent(state.from)+'&to='+encodeURIComponent(state.to)).then(v=>v.report),null),
     safe(()=>action('/reports/orders?from='+encodeURIComponent(state.from)+'&to='+encodeURIComponent(state.to)+'&limit=30'),{orders:[],nextCursor:null}),
     state.selected?safe(()=>action('/sessions/'+encodeURIComponent(state.selected)+'/prepayments').then(x=>x.prepayments),null):null,
     state.selected?safe(()=>action('/sessions/'+encodeURIComponent(state.selected)+'/split').then(x=>x.plan),null):null
   ]);
   Object.assign(state,{tables,orders:orderPage.orders||[],nextCursor:orderPage.nextCursor||null,tickets,stationTickets,printJobs,requests,products,report,reportRows:reportPage.orders||[],reportNextCursor:reportPage.nextCursor||null,prepayments:prepayments||null,splitPlan:splitPlan||null});
 }
 function tableSection(){
   if(!can('restaurant.orders.view'))return '<p class="vertical-empty">Seu perfil não possui acesso às mesas.</p>';
   const open=state.tables.filter(t=>t.sessionId),free=state.tables.filter(t=>!t.sessionId&&t.active!==0);
   return '<section class="data-card"><h2>Mesas e comandas</h2>'+
     (can('restaurant.tables.manage')?'<div class="restaurant-actions"><button type="button" class="primary-button" data-r4-new-table>+ Mesa</button></div><div data-r4-new-table-form hidden><form data-r4-form="table" class="vertical-form">'+field('Identificação','label','text','required maxlength="80"')+field('Lugares','seats','number','min="0" max="1000" value="4"')+'<div class="restaurant-actions"><button class="primary-button">Salvar mesa</button><button type="button" class="secondary-button" data-r4-cancel-table>Cancelar</button></div></form></div>':'')+
     '<div class="restaurant-grid">'+state.tables.map(t=>
       '<article class="restaurant-table"><strong>'+esc(t.label)+'</strong><small>'+esc(t.sessionId?'Ocupada / '+title(t.sessionStatus):'Livre')+'</small>'+
       (t.sessionId?'<div class="restaurant-actions">'+btn('Ver comanda','select',t.sessionId)+'</div>':
         can('restaurant.tables.manage')?btn('Abrir mesa','open',t.id):'')+'</article>').join('')+'</div>'+
     (state.selected?(()=>{
       const s=open.find(t=>t.sessionId===state.selected);if(!s)return'';
       const orders=state.orders.filter(o=>o.table_session_id===state.selected);
       const total=orders.filter(o=>o.status!=='CANCELLED').reduce((sum,o)=>sum+Number(o.total_cents||0),0);
       return '<div class="restaurant-card"><h3>'+esc(s.label)+' · Comanda '+esc(state.selected.slice(0,8))+'</h3>'+
         '<p>Pedidos operacionais: '+money(total)+'. A cobrança é feita no Balcão.</p>'+btn('Imprimir pré-conta','prebill-table',state.selected)+
         orders.map(o=>'<div class="restaurant-row">'+esc(orderLines(o))+' · '+esc(title(o.status))+'</div>').join('')+
         (can('restaurant.service.manage')?btn('Chamar garçom','service-waiter',state.selected)+btn('Solicitar conta','service-bill',state.selected):'')+
         '<p>Recebimentos antecipados líquidos: '+money(state.prepayments?.totalCents||0)+'. O saldo é acertado no Balcão.</p>'+
         (state.prepayments?.payments?.length?'<div class="restaurant-list">'+state.prepayments.payments.map(p=>
           '<div class="restaurant-row"><strong>'+esc(p.method)+' · '+money(p.amountCents)+
           '</strong><small>Recebido '+money(p.grossAmountCents)+' · '+esc(p.receivedAt)+
           (p.payerIndex?' · Pagador '+p.payerIndex:'')+'</small>'+
           (p.amountCents>0&&can('finance.manage')?btn('Estornar antecipação','refund-prepay',p.id):'')+'</div>').join('')+'</div>':'')+
         (can('restaurant.orders.transfer')?'<details><summary>Registrar recebimento parcial</summary><form data-r4-form="prepay" class="vertical-form">'+
           '<input type="hidden" name="sessionId" value="'+esc(state.selected)+'">'+
           field('Valor recebido (R$)','amountReais','number','min="0.01" max="10000000" step="0.01" required')+
           (state.splitPlan?'<label class="field"><span>Pagador</span><select name="payerIndex" required>'+
             state.splitPlan.shares.map((share,i)=>'<option value="'+(i+1)+'">Pagador '+(i+1)+' · '+money(share)+'</option>').join('')+'</select></label>':
             '<small>Para atribuir adiantamentos por pessoa, registre a divisão antes de receber.</small>')+
           '<label class="field"><span>Forma</span><select name="method"><option value="CASH">Dinheiro</option><option value="PIX">PIX</option><option value="DEBIT_CARD">Débito</option><option value="CREDIT_CARD">Crédito</option></select></label>'+
           '<p>Registre apenas valores recebidos. O caixa do terminal deve estar aberto.</p><button class="secondary-button">Confirmar antecipação</button></form></details>':'')+
         (can('restaurant.orders.transfer')&&free.length?'<form class="vertical-form" data-r4-form="transfer"><input type="hidden" name="sessionId" value="'+esc(state.selected)+'"><input type="hidden" name="expectedTableId" value="'+esc(s.id)+'"><label class="field"><span>Mudar para mesa livre</span><select name="targetTableId">'+free.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.label)+'</option>').join('')+'</select></label><button class="secondary-button">Transferir mesa</button></form>':'')+
         btn('Dividir / transferir itens','advanced',state.selected)+btn('Preparar cobrança','checkout-session',state.selected)+
         (can('restaurant.tables.manage')?btn('Encerrar mesa','close',state.selected):'')+
         '</div>';
       })():'')+'</section>';
 }
 function orderSection(){
   if(!can('restaurant.orders.view'))return '<p class="vertical-empty">Seu perfil não possui acesso aos pedidos.</p>';
   const products=state.products.filter(p=>p.active!==false);
   const availableTables=state.tables.filter(t=>t.sessionId&&t.sessionStatus==='OPEN');
   return '<section class="data-card"><h2>Pedidos de alimentação</h2>'+
     (can('restaurant.orders.create')?'<details open><summary>Novo pedido</summary><form data-r4-form="order" class="vertical-form">'+
       '<label class="field"><span>Canal</span><select name="fulfillment"><option value="TABLE">Mesa</option><option value="COUNTER">Balcão</option><option value="PICKUP">Retirada</option><option value="DELIVERY">Entrega</option></select></label>'+
       '<label class="field"><span>Comanda (para atendimento em mesa)</span><select name="tableSessionId"><option value="">Selecione a mesa</option>'+availableTables.map(t=>'<option value="'+esc(t.sessionId)+'">'+esc(t.label)+'</option>').join('')+'</select></label>'+
       field('Endereço (obrigatório para entrega)','address','text','maxlength="300"')+
       '<div data-r4-lines>'+orderItemRow()+'</div>'+btn('Adicionar outro item','add-line')+
        '<label><input type="checkbox" name="useTicket"> Gerar senha diária para acompanhar o pedido</label>'+
       '<button class="primary-button" type="submit">Enviar pedido para cozinha</button></form></details>':'')+
     '<div class="restaurant-list">'+state.orders.map(o=>
       '<div class="restaurant-row"><div><strong>'+esc(title(o.service_channel||o.fulfillment))+' · '+esc(o.ticket_number?'Senha '+o.ticket_number:o.id.slice(0,8))+'</strong><small>'+esc(title(o.status))+' · '+esc(orderLines(o))+'</small></div><div class="restaurant-actions">'+
       (o.status==='READY'&&o.fulfillment==='DELIVERY'&&!o.deliveryStage?btn('Despachar','dispatch',o.id):'')+
       (o.status==='READY'&&o.fulfillment==='DELIVERY'&&['DISPATCHED','REDISPATCHED'].includes(o.deliveryStage)?
         btn('Chegou ao destino','delivery-arrived',o.id)+btn('Retornou','delivery-return',o.id):'')+
       (o.status==='READY'&&o.fulfillment==='DELIVERY'&&o.deliveryStage==='ARRIVED'?btn('Retornou','delivery-return',o.id):'')+
       (o.status==='READY'&&o.fulfillment==='DELIVERY'&&o.deliveryStage==='RETURNED'?btn('Novo despacho','delivery-redispatch',o.id):'')+
       (o.status==='READY'&&(o.fulfillment!=='DELIVERY'||o.deliveryStage!=='RETURNED')?btn('Entregue / retirado','deliver',o.id):'')+
       (o.status==='OPEN'?btn('Cancelar','cancel',o.id):'')+
       (o.status==='DELIVERED'&&o.fulfillment!=='TABLE'?btn('Cobrar','checkout-order',o.id):'')+
       '</div></div>').join('')+'</div>'+(state.nextCursor?btn('Carregar mais pedidos','more-orders'):'')+'</section>';
 }
 function kitchenSection(){
   if(!can('kitchen.view'))return '<p class="vertical-empty">Seu perfil não possui acesso à cozinha.</p>';
   const routedIds=new Set(state.stationTickets.map(t=>t.orderId));
   const queue=[
     ...state.stationTickets.map(t=>({...t,stationScoped:true})),
     ...state.tickets.filter(t=>!routedIds.has(t.orderId)).map(t=>({...t,stationScoped:false}))
   ];
   return '<section class="data-card"><h2>KDS · Estações e pedidos</h2><div class="restaurant-list">'+queue.map(t=>
     '<div class="restaurant-row"><div><strong>'+esc(t.stationName||title(t.fulfillment))+' · '+esc(t.orderId.slice(0,8))+'</strong><small>'+
     esc(title(t.status))+(t.items?.length?' · '+esc(t.items.map(x=>x.productName+' × '+x.quantity).join(', ')):' · '+money(t.totalCents))+
     '</small></div>'+(can('kitchen.update_status')?'<div class="restaurant-actions">'+
     (t.status==='NEW'?btn('Iniciar preparo',t.stationScoped?'preparing-station':'preparing',t.id):'')+
     (t.status==='PREPARING'?btn('Marcar pronto',t.stationScoped?'ready-station':'ready',t.id):'')+'</div>':'')+'</div>').join('')+
     '</div><details><summary>Fila de impressão e falhas ('+state.printJobs.filter(x=>x.status==='FAILED').length+' pendentes)</summary>'+
       '<div class="restaurant-list">'+state.printJobs.map(j=>
         '<div class="restaurant-row"><strong>'+esc(j.printerName)+' · '+esc(j.id.slice(0,8))+'</strong>'+
         '<small>'+esc(({PENDING:'Aguardando agente',LEASED:'Em envio',FAILED:'Aguardando nova tentativa',
           PRINTED:'Enviado à fila local',CANCELLED:'Cancelado'})[j.status]||j.status)+
         ' · tentativa '+esc(j.attempts)+'/8</small>'+
         (can('kitchen.update_status')&&['PENDING','FAILED'].includes(j.status)?btn('Enviar ao conector','dispatch-kds',j.id):'')+
         btn('Ver documento','preview-kds',j.id)+'</div>').join('')+'</div>'+
       '<p>O agente local precisa estar conectado à impressora. Enviado à fila não garante papel impresso.</p></details></section>';
 }
 function serviceSection(){
   if(!can('restaurant.service.manage'))return '<p class="vertical-empty">Seu perfil não tem acesso aos chamados.</p>';
   return '<section class="data-card"><h2>Chamados de salão</h2><div class="restaurant-list">'+state.requests.map(r=>
     '<div class="restaurant-row"><div><strong>'+esc(r.tableLabel)+' · '+esc(title(r.type))+'</strong><small>'+esc(title(r.status))+' · '+esc(r.note)+'</small></div><div class="restaurant-actions">'+
     (r.status==='OPEN'?btn('Atender','ack',r.id):r.status==='ACKNOWLEDGED'?btn('Concluir','resolve',r.id):'')+'</div></div>').join('')+'</div></section>';
 }
 function reportSection(){
   if(!can('reports.view'))return '<p class="vertical-empty">Seu perfil não possui acesso aos relatórios.</p>';
   const r=state.report||{};
   return '<section class="data-card"><h2>Relatório operacional</h2><form data-r4-form="dates" class="vertical-form">'+
     '<label class="field"><span>De</span><input type="date" name="from" value="'+esc(state.from)+'" required></label>'+
     '<label class="field"><span>Até</span><input type="date" name="to" value="'+esc(state.to)+'" required></label>'+
     '<button class="secondary-button">Atualizar</button></form>'+
     '<div class="restaurant-kpis"><div class="restaurant-kpi"><span>Pedidos</span><strong>'+esc(r.ordersCount??'—')+'</strong></div>'+
     '<div class="restaurant-kpi"><span>Cancelados</span><strong>'+esc(r.cancelledCount??'—')+'</strong></div>'+
     '<div class="restaurant-kpi"><span>Valor operacional</span><strong>'+money(r.orderedCents)+'</strong></div></div>'+
     '<p>Pedidos não são necessariamente vendas pagas. Consulte o caixa para faturamento e recebimento.</p>'+btn('Exportar CSV','csv')+
     '<h3>Detalhes do período</h3><div class="restaurant-list">'+state.reportRows.map(o=>'<div class="restaurant-row"><strong>'+esc(o.id.slice(0,8))+'</strong><small>'+esc(o.createdAt)+' · '+esc(title(o.serviceChannel||o.fulfillment))+' · '+esc(title(o.status))+' · '+money(o.totalCents)+'</small></div>').join('')+'</div>'+
     (state.reportNextCursor?btn('Carregar mais linhas do relatório','more-report'):'')+'</section>';
 }
 function checkoutSection(){
   const c=state.checkout;if(!c)return '';
   const split=state.split;
   const methodOptions='<option value="PIX">PIX</option><option value="CASH">Dinheiro</option><option value="DEBIT_CARD">Débito</option><option value="CREDIT_CARD">Crédito</option>';
   const prepaid=state.prepayments?.totalCents||0;
   const outstanding=Math.max(0,Number(c.totalCents||0)-prepaid);
   const splitDues=split?split.shares.map((value,i)=>({
     index:i+1,originalCents:value,
     prepaidCents:(state.prepayments?.payments||[]).filter(p=>p.payerIndex===i+1).reduce((sum,p)=>sum+p.amountCents,0)
   })).map(x=>({...x,amountCents:Math.max(0,x.originalCents-x.prepaidCents)})).filter(x=>x.amountCents>0):[];
   const tenders=split?'<fieldset><legend>Divisão por pessoa · saldo após antecipações</legend>'+
      splitDues.map(share=>'<label class="field"><span>Pagador '+share.index+' · restante '+money(share.amountCents)+'</span>'+
        '<select name="shareMethod'+share.index+'">'+methodOptions+'</select></label>').join('')+'</fieldset>':
      '<label class="field"><span>Forma de pagamento</span><select name="method">'+methodOptions+'</select></label>';
   return '<section class="data-card"><h2>Pagamento no Balcão</h2><p>Venda '+esc(c.saleNumber||c.saleId.slice(0,8))+
      ' · '+money(c.totalCents||0)+'</p>'+(prepaid?'<p>Antecipado: '+money(prepaid)+' · Saldo pendente: '+money(outstanding)+'</p>':'')+
      (split?'<p>'+split.parts+' partes · Taxa de serviço '+money(split.serviceChargeCents)+'</p>':'')+
      (c.status==='COMPLETED'?'<p>Pagamento concluído.</p>':
        '<form class="vertical-form" data-r4-form="payment">'+tenders+
        '<input type="hidden" name="saleId" value="'+esc(c.saleId)+'">'+
        '<input type="hidden" name="totalCents" value="'+esc(outstanding)+'">'+
        '<p>Para concluir, o caixa do terminal precisa estar aberto.</p><button class="primary-button">Concluir recebimento</button></form>')+
      '</section>';
 }
 function render(){
   if(!host)return;
   const tabs=[['tables','Mesas'],['orders','Pedidos'],['kitchen','KDS'],['services','Chamados'],['reports','Relatórios']];
   host.innerHTML='<section class="page vertical-page restaurant-page" data-r4-web><header class="page-head"><div><h1>Alimentação</h1><p>Mesas, comandas, preparo e recebimento no mesmo caixa.</p></div>'+back()+'</header>'+
     '<nav class="restaurant-view-switch" aria-label="Operações de alimentação">'+tabs.map(([v,n])=>
       '<button type="button" class="restaurant-btn '+(state.section===v?'':'secondary')+'" data-r4-action="tab" data-id="'+v+'">'+n+'</button>').join('')+
       btn('Configurações de atendimento','advanced')+btn('Atualizar','refresh')+'</nav>'+
     checkoutSection()+
     ({tables:tableSection,orders:orderSection,kitchen:kitchenSection,services:serviceSection,reports:reportSection}[state.section]||tableSection)()+
     '</section>';
   host.querySelectorAll('[data-r4-action]').forEach(el=>el.addEventListener('click',()=>void click(el)));
   const newTableButton=host.querySelector('[data-r4-new-table]'),newTableForm=host.querySelector('[data-r4-new-table-form]');
   newTableButton?.addEventListener('click',()=>{newTableForm.hidden=false;newTableButton.hidden=true;newTableForm.querySelector('[name="label"]')?.focus();});
   host.querySelector('[data-r4-cancel-table]')?.addEventListener('click',()=>{newTableForm.hidden=true;newTableButton.hidden=false;});
   host.querySelectorAll('[data-r4-form]').forEach(el=>el.addEventListener('submit',e=>{e.preventDefault();void submit(el);}));
   host.querySelectorAll('[data-r4-order-item]').forEach(bindOrderRow);
 }
 async function reload(){await load();render();}
 async function show(){
   if(!api.webMode)return root.PdvRestaurantUi?.show?.();
   state.selected='';state.checkout=null;state.split=null;state.section='tables';
   host.innerHTML='<section class="page vertical-page"><h2>Carregando alimentação…</h2></section>';
   try{await reload();}catch(e){host.textContent=e.message;notice(e.message,true);}
 }
 async function click(el){
   const what=el.dataset.r4Action,id=el.dataset.id;
   if(what==='back')return root.PdvAppNavigation?.navigate?.('home');
   if(what==='tab'){state.section=id;state.checkout=null;state.split=null;return render();}
   if(what==='select'){state.selected=id;return reload();}
   if(what==='refresh')return reload();
   if(what==='more-report'){
     if(!state.reportNextCursor)return;
     try{
       const query='/reports/orders?from='+encodeURIComponent(state.from)+'&to='+encodeURIComponent(state.to)+'&limit=30&cursor='+encodeURIComponent(state.reportNextCursor);
       const page=await action(query),known=new Set(state.reportRows.map(x=>x.id));
       state.reportRows.push(...(page.orders||[]).filter(x=>!known.has(x.id)));
       state.reportNextCursor=page.nextCursor||null;render();
     }catch(e){notice(e.message,true);}
     return;
   }
   if(what==='more-orders'){
     if(!state.nextCursor)return;
     try{
       const result=await action('/orders?limit=40&cursor='+encodeURIComponent(state.nextCursor));
       const seen=new Set(state.orders.map(o=>o.id));
       state.orders.push(...(result.orders||[]).filter(o=>!seen.has(o.id)));
       state.nextCursor=result.nextCursor||null;render();
     }catch(e){notice(e.message,true);}
     return;
   }
   if(what==='advanced')return root.PdvR4AdvancedUi?.show?.({sessionId:id||state.selected});
   if(what==='dispatch-kds'){
     if(!can('kitchen.update_status'))return notice('Sem permissão para enviar à impressora.',true);
     const job=state.printJobs.find(j=>j.id===id);
     if(!job)return notice('Atualize a fila para localizar o ticket.',true);
     el.disabled=true;
     try{
       const result=await root.PdvR3KitchenDispatch.dispatch({api,bridge:root.PdvLocalBridge,job});
       notice(result.spoolSubmitted?'Ticket enviado à fila local. Confirme a saída no equipamento.':'Envio não confirmado.');
       await reload();
     }catch(error){notice(error?.message||'Falha ao enviar ticket.',true);await reload();}
     finally{el.disabled=false;}
     return;
   }
   if(['preview-kds','prebill-table'].includes(what)){
     const popup=root.open('','_blank');
     if(!popup)return notice('Libere pop-ups para imprimir documentos não fiscais.',true);
     try{
       const endpoint=what==='prebill-table'
         ?'/api/v1/restaurant/sessions/'+encodeURIComponent(id)+'/prebill'
         :'/api/v1/restaurant/kitchen/print-jobs/'+encodeURIComponent(id)+'/document';
       const doc=await api.request(endpoint);
       root.PdvWebHardware.printTextDocument(doc,{popup});
     }catch(error){try{popup.close();}catch{}notice(error?.message||'Falha ao preparar documento.',true);}
     return;
   }
   if(what==='add-line'){
     const formEl=el.closest('form'),rows=formEl?.querySelector('[data-r4-lines]');
     if(!rows)return;
     if(rows.querySelectorAll('[data-r4-order-item]').length>=80)return notice('Máximo de 80 itens por pedido.',true);
     rows.insertAdjacentHTML('beforeend',orderItemRow());
     bindOrderRow(rows.lastElementChild);
     return;
   }
   try{
     if(what==='open')await form('/tables/'+encodeURIComponent(id)+'/open',{partySize:1});
     if(what==='close')await form('/sessions/'+encodeURIComponent(id)+'/close',{});
     if(what==='service-waiter'||what==='service-bill')await form('/sessions/'+encodeURIComponent(id)+'/requests',{type:what==='service-waiter'?'WAITER':'BILL'});
     if(what==='refund-prepay'){
       if(!can('finance.manage'))throw Error('Perfil sem permissão para estornar.');
       const p=(state.prepayments?.payments||[]).find(x=>x.id===id);
       if(!p||p.amountCents<=0)throw Error('Recebimento sem saldo para estornar.');
       const raw=window.prompt('Quanto devolver (R$)?',String((p.amountCents/100).toFixed(2)).replace('.',','));
       if(raw===null)return;
       if(!/^\\d+(?:[.,]\\d{1,2})?$/.test(raw.trim()))throw Error('Informe valor em reais com até duas casas.');
       const cents=Math.round(Number(raw.trim().replace(',','.'))*100);
       if(!Number.isSafeInteger(cents)||cents<=0||cents>p.amountCents)throw Error('Valor de estorno inválido ou acima do recebido.');
       const reason=window.prompt('Motivo da devolução:');
       if(!reason||reason.trim().length<4)return;
       await form('/sessions/'+encodeURIComponent(state.selected)+'/prepayments/'+encodeURIComponent(id)+'/refund',
         {amountCents:cents,reason:reason.trim()});
     }
     if(what==='cancel')await form('/orders/'+encodeURIComponent(id)+'/cancel',{});
     if(what==='dispatch'){
       const courier=window.prompt('Nome do entregador responsável:');
       if(!courier)return;
       await form('/orders/'+encodeURIComponent(id)+'/dispatch',{courierName:courier.trim()});
     }
     if(what==='delivery-return'){
       const reason=window.prompt('Motivo do retorno (obrigatório):');
       if(!reason?.trim())return;
       await form('/orders/'+encodeURIComponent(id)+'/delivery-events',{kind:'RETURNED',reason:reason.trim()});
     }
     if(what==='delivery-redispatch'){
       const courier=window.prompt('Novo entregador:');
       if(!courier?.trim())return;
       await form('/orders/'+encodeURIComponent(id)+'/delivery-events',{kind:'REDISPATCHED',courierName:courier.trim()});
     }
     if(what==='delivery-arrived')await form('/orders/'+encodeURIComponent(id)+'/delivery-events',{kind:'ARRIVED'});
     if(what==='deliver')await form('/orders/'+encodeURIComponent(id)+'/deliver',{});
     if(what==='preparing'||what==='ready')await action('/kitchen/'+encodeURIComponent(id),'PATCH',{status:what==='preparing'?'PREPARING':'READY'});
     if(what==='preparing-station'||what==='ready-station')await action('/kitchen/station-tickets/'+encodeURIComponent(id),'PATCH',{status:what==='preparing-station'?'PREPARING':'READY'});
     if(what==='ack'||what==='resolve')await action('/requests/'+encodeURIComponent(id),'PATCH',{status:what==='ack'?'ACKNOWLEDGED':'CLOSED',expectedStatus:state.requests.find(r=>r.id===id)?.status});
     if(what==='checkout-session'||what==='checkout-order'){
       const session=what==='checkout-session',endpoint=session?'/sessions/'+encodeURIComponent(id):'/orders/'+encodeURIComponent(id);
       if(session){state.selected=id;state.prepayments=await safe(()=>action('/sessions/'+encodeURIComponent(id)+'/prepayments').then(v=>v.prepayments),null);}
       else state.prepayments=null;
       const opened=await root.PdvAppNavigation.openDocument(session?'COMMAND':'DELIVERY',id);
       state.checkout={saleId:opened.sale.id,status:opened.sale.status,totalCents:opened.sale.totalCents,saleNumber:opened.sale.saleNumber};
       state.split=session?(await action(endpoint+'/split')).plan:null;
       return;
     }
     if(what==='csv'){
       const text=await action('/reports/csv?from='+encodeURIComponent(state.from)+'&to='+encodeURIComponent(state.to));
       const blob=new Blob([text],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
       const a=document.createElement('a');a.href=url;a.download='restaurante-'+state.from+'-'+state.to+'.csv';a.click();URL.revokeObjectURL(url);
     }
     if(what!=='csv')await reload();
   }catch(e){notice(e.message,true);}
 }
 async function submit(formEl){
   const what=formEl.dataset.r4Form,v=Object.fromEntries(new FormData(formEl));
   try{
     if(what==='table')await form('/tables',{label:String(v.label).trim(),seats:Number(v.seats)});
     if(what==='prepay'){
       const reais=Number(v.amountReais),amountCents=Math.round(reais*100);
       if(!Number.isFinite(reais)||!Number.isSafeInteger(amountCents)||amountCents<1||
          Math.abs(reais*100-amountCents)>1e-6)throw Error('Informe o valor recebido em reais, com até duas casas decimais.');
       await form('/sessions/'+encodeURIComponent(v.sessionId)+'/prepayments',{amountCents,method:v.method,...(v.payerIndex?{payerIndex:Number(v.payerIndex)}:{})});
     }
     if(what==='transfer')await form('/sessions/'+encodeURIComponent(v.sessionId)+'/transfer',{targetTableId:v.targetTableId,expectedTableId:v.expectedTableId});
     if(what==='order'){
       const fulfillment=v.fulfillment;
       if(fulfillment==='TABLE'&&!v.tableSessionId)throw new Error('Selecione uma comanda.');
       if(fulfillment==='DELIVERY'&&!String(v.address).trim())throw new Error('Informe o endereço de entrega.');
       const items=[...formEl.querySelectorAll('[data-r4-order-item]')].map(row=>{
         const productId=row.querySelector('[name="productId"]').value,quantity=Number(row.querySelector('[name="quantity"]').value);
         const status=row.dataset.r4PizzaState;
         if(status==='loading'||status==='error')throw new Error('Confira as opções dos produtos antes de enviar.');
         if(!Number.isFinite(quantity)||quantity<=0||quantity>100000)throw new Error('Quantidade inválida.');
         const item={productId,quantity};
         if(status==='configured'){
           const selected=[...row.querySelectorAll('[name="flavorCodes"]:checked')].map(input=>input.value);
           if(!selected.length||selected.length>Number(row.dataset.r4MaxFlavors))throw new Error('Escolha os sabores da pizza.');
           item.pizza={sizeCode:row.querySelector('[name="sizeCode"]').value,
             flavorCodes:selected,crustCode:row.querySelector('[name="crustCode"]').value||null,
             addonCodes:[...row.querySelectorAll('[name="addonCodes"]:checked')].map(input=>input.value)};
         }
         return item;
       });
       await form('/orders',{fulfillment,tableSessionId:fulfillment==='TABLE'?v.tableSessionId:null,
         address:fulfillment==='DELIVERY'?String(v.address).trim():'',useTicket:v.useTicket==='on',items});
     }
     if(what==='dates'){state.from=v.from;state.to=v.to;}
     if(what==='payment'){
       const body=state.split?{shares:state.split.shares.map((amountCents,i)=>({index:i+1,amountCents:amountCents-(state.prepayments?.payments||[]).filter(p=>p.payerIndex===i+1).reduce((sum,p)=>sum+p.amountCents,0),method:v['shareMethod'+(i+1)]})).filter(p=>p.amountCents>0)}:
         {payments:Number(v.totalCents)>0?[{method:v.method,amountCents:Number(v.totalCents)}]:[]};
       const sale=await api.request('/api/v1/sales/'+encodeURIComponent(v.saleId)+'/complete',{method:'POST',body});
       const settled=sale.sale||sale;
       state.checkout={...state.checkout,status:settled.status};
       notice('Pagamento registrado na venda.');
     }
     await reload();
   }catch(e){notice(e.message,true);}
 }
 root.PdvRestaurantWebUi=Object.freeze({show});
})();
