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
 let state={tables:[],orders:[],tickets:[],requests:[],products:[],report:null,from:monthAgo,to:today,selected:'',checkout:null,section:'tables'};
 const notice=(value,error=false)=>root.PdvToast?.show?.(value,error?'error':'success');
 const action=(endpoint,method='GET',body)=>api.request(path+endpoint,{method,body});
 const safe=async(fn,fallback=[])=>{try{return await fn();}catch{return fallback;}};
 const field=(label,name,type='text',extra='')=>'<label class="field"><span>'+esc(label)+'</span><input name="'+esc(name)+'" type="'+type+'" '+extra+'></label>';
 const btn=(label,what,id='',extra='')=>'<button class="secondary-button" type="button" data-r4-action="'+esc(what)+'" data-id="'+esc(id)+'" '+extra+'>'+esc(label)+'</button>';
 const form=async(endpoint,body)=>action(endpoint,'POST',body);
 function back(){return '<button type="button" class="secondary-button" data-r4-action="back">← Alimentação</button>';}
 function orderLines(order){return (order.items||[]).map(i=>esc(i.name||i.productName)+' × '+esc(i.quantity)).join(', ')||'Nenhum item';}
 function title(value){return ({TABLE:'Mesa',PICKUP:'Retirada',DELIVERY:'Entrega',OPEN:'Aberto',READY:'Pronto',DELIVERED:'Entregue',CANCELLED:'Cancelado',NEW:'Novo',PREPARING:'Preparando',ACKNOWLEDGED:'Em atendimento',CLOSED:'Finalizado',WAITER:'Garçom',BILL:'Conta'})[value]||value;}
 async function load(){
   const [tables,orders,tickets,requests,products,report]=await Promise.all([
     safe(()=>action('/tables').then(v=>v.tables)),safe(()=>action('/orders').then(v=>v.orders)),
     safe(()=>action('/kitchen').then(v=>v.tickets)),safe(()=>action('/requests').then(v=>v.requests)),
     safe(()=>api.products(false)),safe(()=>action('/reports/summary?from='+encodeURIComponent(state.from)+'&to='+encodeURIComponent(state.to)).then(v=>v.report),null)
   ]);
   Object.assign(state,{tables,orders,tickets,requests,products,report});
 }
 function tableSection(){
   if(!can('restaurant.orders.view'))return '<p class="vertical-empty">Seu perfil não possui acesso às mesas.</p>';
   const open=state.tables.filter(t=>t.sessionId),free=state.tables.filter(t=>!t.sessionId&&t.active!==0);
   return '<section class="data-card"><h2>Mesas e comandas</h2>'+
     (can('restaurant.tables.manage')?'<details><summary>Adicionar mesa</summary><form data-r4-form="table" class="vertical-form">'+field('Identificação','label','text','required maxlength="80"')+field('Lugares','seats','number','min="0" max="1000" value="4"')+'<button class="primary-button">Salvar mesa</button></form></details>':'')+
     '<div class="restaurant-grid">'+state.tables.map(t=>
       '<article class="restaurant-table"><strong>'+esc(t.label)+'</strong><small>'+esc(t.sessionId?'Ocupada / '+title(t.sessionStatus):'Livre')+'</small>'+
       (t.sessionId?'<div class="restaurant-actions">'+btn('Ver comanda','select',t.sessionId)+'</div>':
         can('restaurant.tables.manage')?btn('Abrir mesa','open',t.id):'')+'</article>').join('')+'</div>'+
     (state.selected?(()=>{
       const s=open.find(t=>t.sessionId===state.selected);if(!s)return'';
       const orders=state.orders.filter(o=>o.table_session_id===state.selected);
       const total=orders.filter(o=>o.status!=='CANCELLED').reduce((sum,o)=>sum+Number(o.total_cents||0),0);
       return '<div class="restaurant-card"><h3>'+esc(s.label)+' · Comanda '+esc(state.selected.slice(0,8))+'</h3>'+
         '<p>Pedidos operacionais: '+money(total)+'. A cobrança é feita no caixa canônico.</p>'+
         orders.map(o=>'<div class="restaurant-row">'+esc(orderLines(o))+' · '+esc(title(o.status))+'</div>').join('')+
         (can('restaurant.service.manage')?btn('Chamar garçom','service-waiter',state.selected)+btn('Solicitar conta','service-bill',state.selected):'')+
         (can('restaurant.orders.transfer')&&free.length?'<form class="vertical-form" data-r4-form="transfer"><input type="hidden" name="sessionId" value="'+esc(state.selected)+'"><label class="field"><span>Mudar para mesa livre</span><select name="targetTableId">'+free.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.label)+'</option>').join('')+'</select></label><button class="secondary-button">Transferir mesa</button></form>':'')+
         btn('Preparar cobrança','checkout-session',state.selected)+
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
       '<label class="field"><span>Canal</span><select name="fulfillment"><option value="TABLE">Mesa</option><option value="PICKUP">Retirada</option><option value="DELIVERY">Entrega</option></select></label>'+
       '<label class="field"><span>Comanda (para atendimento em mesa)</span><select name="tableSessionId"><option value="">Selecione a mesa</option>'+availableTables.map(t=>'<option value="'+esc(t.sessionId)+'">'+esc(t.label)+'</option>').join('')+'</select></label>'+
       field('Endereço (obrigatório para entrega)','address','text','maxlength="300"')+
       '<label class="field"><span>Produto</span><select name="productId" required>'+products.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+'</option>').join('')+'</select></label>'+
       field('Quantidade','quantity','number','min="0.001" step="0.001" value="1" required')+
       '<button class="primary-button">Enviar pedido para cozinha</button></form></details>':'')+
     '<div class="restaurant-list">'+state.orders.map(o=>
       '<div class="restaurant-row"><div><strong>'+esc(title(o.fulfillment))+' · '+esc(o.id.slice(0,8))+'</strong><small>'+esc(title(o.status))+' · '+esc(orderLines(o))+'</small></div><div class="restaurant-actions">'+
       (o.status==='READY'?btn('Entregue / retirado','deliver',o.id):'')+
       (o.status==='OPEN'?btn('Cancelar','cancel',o.id):'')+
       (o.status==='DELIVERED'&&o.fulfillment!=='TABLE'?btn('Cobrar','checkout-order',o.id):'')+
       '</div></div>').join('')+'</div></section>';
 }
 function kitchenSection(){
   if(!can('kitchen.view'))return '<p class="vertical-empty">Seu perfil não possui acesso à cozinha.</p>';
   return '<section class="data-card"><h2>KDS · Fila de produção</h2><div class="restaurant-list">'+state.tickets.map(t=>
     '<div class="restaurant-row"><div><strong>'+esc(title(t.fulfillment))+' · '+esc(t.orderId.slice(0,8))+'</strong><small>'+esc(title(t.status))+' · '+money(t.totalCents)+'</small></div>'+
     (can('kitchen.update_status')?'<div class="restaurant-actions">'+
       (t.status==='NEW'?btn('Iniciar preparo','preparing',t.id):'')+
       (t.status==='PREPARING'?btn('Marcar pronto','ready',t.id):'')+'</div>':'')+'</div>'
   ).join('')+'</div></section>';
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
     '<p>Pedidos não são necessariamente vendas pagas. Consulte o caixa para faturamento e recebimento.</p>'+btn('Exportar CSV','csv')+'</section>';
 }
 function checkoutSection(){
   const c=state.checkout;if(!c)return '';
   return '<section class="data-card"><h2>Pagamento no caixa canônico</h2><p>Venda '+esc(c.saleNumber||c.saleId.slice(0,8))+' · '+money(c.totalCents||0)+'</p>'+
     (c.status==='COMPLETED'?'<p>Pagamento concluído.</p>':
       '<form class="vertical-form" data-r4-form="payment">'+
       '<label class="field"><span>Forma de pagamento</span><select name="method"><option value="PIX">PIX</option><option value="CASH">Dinheiro</option><option value="DEBIT_CARD">Débito</option><option value="CREDIT_CARD">Crédito</option></select></label>'+
       '<input type="hidden" name="saleId" value="'+esc(c.saleId)+'">'+
       '<input type="hidden" name="totalCents" value="'+esc(c.totalCents)+'">'+
       '<p>Para concluir, o caixa do terminal precisa estar aberto.</p><button class="primary-button">Concluir recebimento</button></form>')+'</section>';
 }
 function render(){
   if(!host)return;
   const tabs=[['tables','Mesas'],['orders','Pedidos'],['kitchen','KDS'],['services','Chamados'],['reports','Relatórios']];
   host.innerHTML='<section class="page vertical-page restaurant-page" data-r4-web><header class="page-head"><div><h1>Alimentação</h1><p>Mesas, comandas, preparo e recebimento no mesmo caixa.</p></div>'+back()+'</header>'+
     '<nav class="restaurant-view-switch" aria-label="Operações de alimentação">'+tabs.map(([v,n])=>
       '<button type="button" class="restaurant-btn '+(state.section===v?'':'secondary')+'" data-r4-action="tab" data-id="'+v+'">'+n+'</button>').join('')+
       btn('Atualizar','refresh')+'</nav>'+
     checkoutSection()+
     ({tables:tableSection,orders:orderSection,kitchen:kitchenSection,services:serviceSection,reports:reportSection}[state.section]||tableSection)()+
     '</section>';
   host.querySelectorAll('[data-r4-action]').forEach(el=>el.addEventListener('click',()=>void click(el)));
   host.querySelectorAll('[data-r4-form]').forEach(el=>el.addEventListener('submit',e=>{e.preventDefault();void submit(el);}));
 }
 async function reload(){await load();render();}
 async function show(){
   if(!api.webMode)return root.PdvRestaurantUi?.show?.();
   state.selected='';state.checkout=null;state.section='tables';
   host.innerHTML='<section class="page vertical-page"><h2>Carregando alimentação…</h2></section>';
   try{await reload();}catch(e){host.textContent=e.message;notice(e.message,true);}
 }
 async function click(el){
   const what=el.dataset.r4Action,id=el.dataset.id;
   if(what==='back')return root.PdvAppNavigation?.navigate?.('home');
   if(what==='tab'){state.section=id;state.checkout=null;return render();}
   if(what==='select'){state.selected=id;return render();}
   if(what==='refresh')return reload();
   try{
     if(what==='open')await form('/tables/'+encodeURIComponent(id)+'/open',{partySize:1});
     if(what==='close')await form('/sessions/'+encodeURIComponent(id)+'/close',{});
     if(what==='service-waiter'||what==='service-bill')await form('/sessions/'+encodeURIComponent(id)+'/requests',{type:what==='service-waiter'?'WAITER':'BILL'});
     if(what==='cancel')await form('/orders/'+encodeURIComponent(id)+'/cancel',{});
     if(what==='deliver')await form('/orders/'+encodeURIComponent(id)+'/deliver',{});
     if(what==='preparing'||what==='ready')await action('/kitchen/'+encodeURIComponent(id),'PATCH',{status:what==='preparing'?'PREPARING':'READY'});
     if(what==='ack'||what==='resolve')await action('/requests/'+encodeURIComponent(id),'PATCH',{status:what==='ack'?'ACKNOWLEDGED':'CLOSED'});
     if(what==='checkout-session'||what==='checkout-order'){
       const session=what==='checkout-session',endpoint=session?'/sessions/'+encodeURIComponent(id):'/orders/'+encodeURIComponent(id);
       let linked=(await action(endpoint+'/checkout')).checkout;
       if(!linked){
         try{
           const opened=await api.request('/api/v1/sales',{method:'POST',body:session?{restaurantSessionId:id}:{restaurantOrderId:id}});
           linked={saleId:opened.sale.id,status:opened.sale.status,totalCents:opened.sale.totalCents,saleNumber:opened.sale.saleNumber};
         }catch(error){
           linked=(await action(endpoint+'/checkout')).checkout;
           if(!linked)throw error;
         }
       }
       state.checkout=linked;
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
     if(what==='transfer')await form('/sessions/'+encodeURIComponent(v.sessionId)+'/transfer',{targetTableId:v.targetTableId});
     if(what==='order'){
       const fulfillment=v.fulfillment;
       if(fulfillment==='TABLE'&&!v.tableSessionId)throw new Error('Selecione uma comanda.');
       if(fulfillment==='DELIVERY'&&!String(v.address).trim())throw new Error('Informe o endereço de entrega.');
       await form('/orders',{fulfillment,tableSessionId:fulfillment==='TABLE'?v.tableSessionId:null,
         address:fulfillment==='DELIVERY'?String(v.address).trim():'',items:[{productId:v.productId,quantity:Number(v.quantity)}]});
     }
     if(what==='dates'){state.from=v.from;state.to=v.to;}
     if(what==='payment'){
       const sale=await api.request('/api/v1/sales/'+encodeURIComponent(v.saleId)+'/complete',{
         method:'POST',body:{payments:[{method:v.method,amountCents:Number(v.totalCents)}]}});
       const settled=sale.sale||sale;
       state.checkout={...state.checkout,status:settled.status};
       notice('Pagamento registrado na venda canônica.');
     }
     await reload();
   }catch(e){notice(e.message,true);}
 }
 root.PdvRestaurantWebUi=Object.freeze({show});
})();
