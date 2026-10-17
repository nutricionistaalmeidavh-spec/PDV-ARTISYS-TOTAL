'use strict';
(() => {
  const {ApiClient}=window.PdvApiClient||{};
  if(!ApiClient)return;
  const api=new ApiClient();
  const root=document.getElementById('route-content');
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const notify=(message,error=false)=>window.PdvToast?.show?.(message,error?'error':'success');
  const id=value=>encodeURIComponent(String(value||''));
  const price=value=>{
    const raw=String(value||'0').trim().replace(/\./g,'').replace(',','.');
    const n=Number(raw);
    if(!Number.isFinite(n)||n<0||n>10000000)throw new Error('Valor monetário inválido.');
    return Math.round(n*100);
  };
  const formData=form=>Object.fromEntries(new FormData(form));
  const option=(items,value='',label='name')=>items.map(item=>'<option value="'+esc(item.id)+'" '+(item.id===value?'selected':'')+'>'+esc(item[label]||item.name||item.label)+'</option>').join('');
  const section=(title,subtitle,inner)=>'<section class="ops-page web-parity-page"><header class="ops-head"><div><h1>'+esc(title)+'</h1><p>'+esc(subtitle)+'</p></div><button class="ops-secondary" type="button" data-parity-refresh>Atualizar</button></header>'+inner+'</section>';
  const field=(name,label,required=false,value='',type='text')=>'<label class="field"><span>'+esc(label)+'</span><input name="'+esc(name)+'" type="'+esc(type)+'" value="'+esc(value)+'" '+(required?'required ':'')+'autocomplete="off"></label>';
  const select=(name,label,rows,empty='Selecione')=>'<label class="field"><span>'+esc(label)+'</span><select name="'+esc(name)+'"><option value="">'+esc(empty)+'</option>'+option(rows)+'</select></label>';
  const card=(title,body)=>'<section class="ops-card"><h2>'+esc(title)+'</h2>'+body+'</section>';
  const mutation=()=>api.mutationId();
  function active(route){return document.body.dataset.activeRoute===route;}
  function showError(error){notify(error.message||String(error),true);}
  async function call(path,{method='GET',body}={}){
    return api.request('/api/v1/'+path,{method,body,mutationId:method==='GET'?undefined:mutation()});
  }
  async function contacts(kind){
    const customers=kind==='customers',title=customers?'Clientes':'Fornecedores';
    const list=await call(kind);
    const rows=Array.isArray(list)?list:[];
    root.innerHTML=section(title,'Cadastro único por empresa, com dados disponíveis em todos os canais.',card('Novo cadastro ou edição',`
      <form data-contact-form class="ops-form-grid">
        <input type="hidden" name="id">
        ${field('name','Nome / razão social',true)}
        ${field('document','CPF / CNPJ')}
        ${field('phone','Telefone')}
        ${field('email','E-mail',false,'','email')}
        ${field('address','Endereço')}
        ${customers?field('creditLimit','Limite do crediário (R$)',false,'0,00'):''}
        <div class="ops-actions"><button class="ops-primary" type="submit">Salvar</button><button class="ops-secondary" type="reset">Limpar</button></div>
      </form>`)+card(title+' cadastrados',
      '<label class="field"><span>Buscar cadastro</span><input data-contact-search placeholder="Nome, documento ou telefone"></label><div data-contact-list class="data-card"></div>'));
    const form=root.querySelector('[data-contact-form]'),listNode=root.querySelector('[data-contact-list]');
    function draw(q=''){
      const term=q.toLocaleLowerCase('pt-BR');
      const filtered=rows.filter(row=>(row.name+' '+(row.document||'')+' '+(row.phone||'')).toLocaleLowerCase('pt-BR').includes(term));
      listNode.innerHTML=filtered.map(row=>'<div class="data-row"><div><strong>'+esc(row.name)+'</strong><small>'+esc(row.document||'Sem documento')+'</small></div><div>'+esc(row.phone||'')+'</div>'+(customers?'<div>'+money(row.creditLimitCents)+'</div>':'')+'<button class="ops-secondary" type="button" data-contact-id="'+esc(row.id)+'">Editar</button></div>').join('')||'<p class="ops-muted">Nenhum cadastro encontrado.</p>';
      listNode.querySelectorAll('[data-contact-id]').forEach(button=>button.addEventListener('click',()=>{
        const c=rows.find(row=>row.id===button.dataset.contactId);if(!c)return;
        for(const name of ['id','name','document','phone','email','address'])form.elements.namedItem(name).value=c[name]||'';
        if(customers)form.elements.namedItem('creditLimit').value=(Number(c.creditLimitCents||0)/100).toFixed(2).replace('.',',');
        form.scrollIntoView({behavior:'smooth',block:'start'});form.elements.namedItem('name')?.focus();
      }));
    }
    draw();
    root.querySelector('[data-contact-search]').addEventListener('input',e=>draw(e.target.value));
    form.addEventListener('submit',async event=>{
      event.preventDefault();const button=form.querySelector('[type="submit"]');button.disabled=true;
      try{
        const data=formData(form);
        if(customers)data.creditLimitCents=price(data.creditLimit);
        if(!data.id)delete data.id;
        await call(kind,{method:'POST',body:data});
        notify('Cadastro salvo.');
        await show(kind);
      }catch(error){showError(error);}finally{button.disabled=false;}
    });
  }
  async function sellers(){
    const [members,rulesResult,balanceResult]=await Promise.all([call('sellers'),call('commissions/rules'),call('commissions')]);
    const rules=rulesResult.rules||[],balances=balanceResult.balances||[];
    const entries=members.map(s=>'<div class="data-row"><div><strong>'+esc(s.name)+'</strong><small>'+esc(s.profileKey||'Equipe')+'</small></div><strong>'+money(balances.find(x=>x.sellerId===s.id)?.balanceCents||0)+'</strong></div>').join('');
    root.innerHTML=section('Equipe comercial','Vendedores vinculados às contas autorizadas da empresa, sem cadastrar usuários duplicados.',
      card('Vendedores e saldos de comissão',entries||'<p>Nenhum vendedor cadastrado.</p>')+
      card('Regra de comissão',`<form data-commission-form class="ops-form-grid">
      ${select('sellerId','Vendedor',members)}
      ${field('commissionPercent','Comissão (%)',true,'5,00')}
      <div class="ops-actions"><button class="ops-primary" type="submit">Salvar regra geral</button></div>
      </form><p class="ops-muted">Regras específicas por produto continuam consultáveis por API. Comissões são registradas uma vez ao concluir a venda.</p>`)+
      card('Regras ativas',rules.map(r=>'<div class="data-row"><strong>'+esc(members.find(m=>m.id===r.sellerId)?.name||r.sellerId)+'</strong><span>'+(Number(r.commissionBps||0)/100).toLocaleString('pt-BR')+'%</span></div>').join('')||'<p class="ops-muted">Nenhuma regra.</p>'));
    root.querySelector('[data-commission-form]').addEventListener('submit',async event=>{
      event.preventDefault();const d=formData(event.currentTarget),percent=Number(d.commissionPercent.replace(',','.'));
      try{
        if(!Number.isFinite(percent)||percent<0||percent>100)throw new Error('Percentual entre 0 e 100.');
        await call('commissions/rules',{method:'POST',body:{sellerId:d.sellerId,commissionBps:Math.round(percent*100)}});
        notify('Regra salva.');await show('sellers');
      }catch(e){showError(e);}
    });
  }
  async function commissions(){
    const balances=await call('commissions'),rules=await call('commissions/rules');
    root.innerHTML=section('Comissões','Saldo originado por eventos de vendas, sem duplicar caixa nem estoque.',
      card('Saldo por vendedor',(balances.balances||[]).map(v=>'<div class="data-row"><strong>'+esc(v.sellerName)+'</strong><span>'+money(v.balanceCents)+'</span></div>').join('')||'<p class="ops-muted">Sem lançamentos de comissão.</p>')+
      card('Regras', (rules.rules||[]).map(v=>'<div class="data-row"><span>'+esc(v.sellerId)+'</span><strong>'+(v.commissionBps/100).toLocaleString('pt-BR')+'%</strong></div>').join('')||'<p class="ops-muted">Sem regras cadastradas.</p>'));
  }
  async function credit(){
    const customers=await api.customers();
    root.innerHTML=section('Crediário','Limite e saldo por cliente vinculados às vendas reais.',
      card('Consultar cliente',`<form data-credit-form class="ops-form-grid">${select('customerId','Cliente',customers)}<button class="ops-primary" type="submit">Consultar saldo</button></form><div data-credit-result role="status"></div>`));
    root.querySelector('[data-credit-form]').addEventListener('submit',async event=>{
      event.preventDefault();const customerId=formData(event.currentTarget).customerId;if(!customerId)return;
      try{const result=await call('credit/'+id(customerId)),credit=result.credit;
        root.querySelector('[data-credit-result]').innerHTML='<div class="ops-grid"><div class="ops-card"><strong>Limite</strong><h2>'+money(credit.creditLimitCents)+'</h2></div><div class="ops-card"><strong>Utilizado</strong><h2>'+money(credit.balanceCents)+'</h2></div><div class="ops-card"><strong>Disponível</strong><h2>'+money(credit.availableCents)+'</h2></div></div>'+
          card('Movimentações',credit.ledger.map(line=>'<div class="data-row"><span>'+esc(line.type)+'</span><strong>'+money(line.amountCents)+'</strong><small>'+esc(line.occurredAt)+'</small></div>').join('')||'Sem lançamentos');
        if(window.PdvAccessPolicy?.hasCapability(window.PdvCurrentAccess,'finance.manage')){
          const payForm=document.createElement('form');
          payForm.className='ops-form-grid';
          payForm.innerHTML='<h3>Receber pagamento do crediário</h3>'+field('amount','Valor (R$)',true)+
            '<label class="field"><span>Forma</span><select name="method"><option value="PIX">PIX</option><option value="BANK_TRANSFER">Transferência bancária</option><option value="CASH">Dinheiro no caixa</option></select></label>'+
            '<button type="submit" class="ops-primary">Registrar recebimento</button>';
          root.querySelector('[data-credit-result]').append(payForm);
          payForm.addEventListener('submit',async submit=>{
            submit.preventDefault();const button=payForm.querySelector('button');button.disabled=true;
            try{const d=formData(payForm);
              await call('credit/'+id(customerId)+'/payments',{method:'POST',body:{amountCents:price(d.amount),method:d.method}});
              notify('Recebimento registrado.');root.querySelector('[data-credit-form]').dispatchEvent(new Event('submit',{cancelable:true}));
            }catch(e){showError(e);}finally{button.disabled=false;}
          });
        }
      }catch(e){showError(e);}
    });
  }
  async function food(){
    const [tableData,orderData,ticketData,products,customers]=await Promise.all([
      call('restaurant/tables'),call('restaurant/orders'),call('restaurant/kitchen'),api.products(),api.customers()
    ]);
    const tables=tableData.tables||[],orders=orderData.orders||[],tickets=ticketData.tickets||[];
    const tableOptions=tables.filter(t=>t.sessionId).map(t=>({id:t.sessionId,name:t.label}));
    root.innerHTML=section('Restaurante, cozinha e delivery','Mesas, pedidos de salão, retirada e entrega usando o catálogo único.',
      '<div class="ops-grid">'+card('Mapa de mesas',`
        <form data-table-form class="ops-form-grid">${field('label','Identificação da mesa',true)}${field('seats','Lugares',true,'4','number')}
          <button class="ops-primary" type="submit">Criar mesa</button></form>
        ${tables.map(t=>'<div class="data-row"><strong>'+esc(t.label)+'</strong><span>'+esc(t.sessionId?'Ocupada · '+t.partySize+' pessoa(s)':'Livre')+'</span>'+(t.sessionId?'<button class="ops-secondary" type="button" data-close-table="'+esc(t.sessionId)+'">Fechar mesa</button>':'<button class="ops-secondary" type="button" data-open-table="'+esc(t.id)+'">Abrir mesa</button>')+'</div>').join('')||'<p class="ops-muted">Sem mesas.</p>'}`)+
      card('Novo pedido',`<form data-food-form class="ops-form-grid">
      <label class="field"><span>Canal</span><select name="fulfillment"><option value="TABLE">Salão / mesa</option><option value="DELIVERY">Entrega</option><option value="PICKUP">Retirada</option></select></label>
      ${select('tableSessionId','Mesa com comanda aberta',tableOptions)}
      ${select('customerId','Cliente (opcional)',customers)}
      ${select('productId','Produto',products)}
      ${field('quantity','Quantidade',true,'1','number')}
      ${field('address','Endereço de entrega')}
      ${field('contact','Contato')}
      ${field('note','Observações')}
      <div class="ops-actions"><button class="ops-primary" type="submit">Enviar pedido para cozinha</button></div></form>`)+
      '</div>'+card('Fila da cozinha / KDS',
       tickets.map(t=>'<div class="data-row"><div><strong>'+esc(t.fulfillment)+'</strong><small>Pedido '+esc(t.orderId.slice(0,8))+'</small></div><span>'+esc(t.status)+'</span>'+(t.status==='NEW'||t.status==='PREPARING'?'<button type="button" class="ops-secondary" data-kitchen="'+esc(t.id)+'" data-next="'+(t.status==='NEW'?'PREPARING':'READY')+'">'+(t.status==='NEW'?'Iniciar preparo':'Marcar pronto')+'</button>':'')+'</div>').join('')||'<p class="ops-muted">Fila vazia.</p>')+
      card('Pedidos de salão, entrega e retirada',orders.map(o=>'<div class="data-row"><div><strong>'+esc(o.fulfillment)+' · '+money(o.total_cents)+'</strong><small>'+esc(o.address||o.note||'')+'</small></div><strong>'+esc(o.status)+'</strong>'+(o.status==='OPEN'||o.status==='READY'?'<button type="button" class="ops-secondary" data-food-deliver="'+esc(o.id)+'">Concluir entrega</button>':'')+'</div>').join('')||'<p class="ops-muted">Sem pedidos.</p>'));
    root.querySelector('[data-table-form]')?.addEventListener('submit',async event=>{
      event.preventDefault();const d=formData(event.currentTarget);
      try{await call('restaurant/tables',{method:'POST',body:{label:d.label,seats:Number(d.seats)}});notify('Mesa cadastrada.');await show('FOOD');}catch(e){showError(e);}
    });
    root.querySelectorAll('[data-open-table]').forEach(button=>button.addEventListener('click',async()=>{
      try{await call('restaurant/tables/'+id(button.dataset.openTable)+'/open',{method:'POST',body:{partySize:1}});notify('Mesa aberta.');await show('FOOD');}catch(e){showError(e);}
    }));
    root.querySelectorAll('[data-close-table]').forEach(button=>button.addEventListener('click',async()=>{
      try{await call('restaurant/sessions/'+id(button.dataset.closeTable)+'/close',{method:'POST',body:{}});
        notify('Mesa encerrada.');await show('FOOD');}catch(e){showError(e);}
    }));
    root.querySelector('[data-food-form]')?.addEventListener('submit',async event=>{
      event.preventDefault();const data=formData(event.currentTarget),button=event.currentTarget.querySelector('[type="submit"]');button.disabled=true;
      try{
        const delivery=data.fulfillment==='DELIVERY',table=data.fulfillment==='TABLE';
        if(delivery&&!data.address.trim())throw new Error('Informe o endereço de entrega.');
        if(table&&!data.tableSessionId)throw new Error('Abra a mesa antes do pedido.');
        await call('restaurant/orders',{method:'POST',body:{
          fulfillment:data.fulfillment,tableSessionId:table?data.tableSessionId:null,customerId:data.customerId||null,
          address:delivery?data.address:'',contact:data.contact,note:data.note,
          items:[{productId:data.productId,quantity:Number(data.quantity)}]
        }});
        notify('Pedido enviado para produção.');await show('FOOD');
      }catch(e){showError(e);}finally{button.disabled=false;}
    });
    root.querySelectorAll('[data-kitchen]').forEach(button=>button.addEventListener('click',async()=>{
      try{await call('restaurant/kitchen/'+id(button.dataset.kitchen),{method:'PATCH',body:{status:button.dataset.next}});
        notify('Cozinha atualizada.');await show('FOOD');}catch(e){showError(e);}
    }));
    root.querySelectorAll('[data-food-deliver]').forEach(button=>button.addEventListener('click',async()=>{
      try{await call('restaurant/orders/'+id(button.dataset.foodDeliver)+'/deliver',{method:'POST',body:{}});
        notify('Pedido entregue.');await show('FOOD');}catch(e){showError(e);}
    }));
  }
  async function wholesale(){
    const [tiers,quotes,customers,products]=await Promise.all([
      call('wholesale/tiers'),call('wholesale/orders'),api.customers(),api.products()
    ]);
    root.innerHTML=section('Atacado','Preços por volume e cotações preservadas sem duplicar vendas.',
      '<div class="ops-grid">'+
      card('Faixa de preço',`<form data-tier-form class="ops-form-grid">${select('productId','Produto',products)}
        ${field('minQuantity','Quantidade mínima',true,'5','number')}
        ${field('unitPrice','Preço por unidade (R$)',true)}
        <button class="ops-primary" type="submit">Salvar faixa</button></form>`)+
      card('Nova cotação',`<form data-quote-form class="ops-form-grid">
        ${select('customerId','Cliente',customers)}${select('productId','Produto',products)}
        ${field('quantity','Quantidade',true,'5','number')}
        <label class="field"><span>Recebimento</span><select name="fulfillmentType"><option value="PICKUP">Retirada</option><option value="DELIVERY">Entrega</option></select></label>
        <button class="ops-primary" type="submit">Criar cotação</button></form>`)+
      '</div>'+card('Faixas cadastradas',(tiers.tiers||[]).map(t=>'<div class="data-row"><strong>'+esc(products.find(p=>p.id===t.productId)?.name||t.productId)+'</strong><span>≥ '+esc(t.minQuantity)+'</span><strong>'+money(t.unitPriceCents)+'</strong></div>').join('')||'<p>Sem faixas.</p>')+
      card('Cotações',(quotes.orders||[]).map(o=>'<div class="data-row"><div><strong>'+esc(customers.find(c=>c.id===o.customerId)?.name||o.customerId)+'</strong><small>'+money(o.totalCents)+'</small></div><span>'+esc(o.status)+'</span>'+(o.status==='QUOTE'?'<button type="button" class="ops-secondary" data-confirm-quote="'+esc(o.id)+'">Confirmar cotação</button>':o.status==='CONFIRMED'?'<button type="button" class="ops-primary" data-checkout-quote="'+esc(o.id)+'">'+(o.saleId?'Continuar cobrança':'Cobrar no Balcão')+'</button>':'')+'</div>').join('')||'<p>Sem cotações.</p>'));
    root.querySelector('[data-tier-form]')?.addEventListener('submit',async event=>{
      event.preventDefault();const d=formData(event.currentTarget);
      try{await call('wholesale/tiers',{method:'POST',body:{productId:d.productId,minQuantity:Number(d.minQuantity),unitPriceCents:price(d.unitPrice)}});
        notify('Faixa salva.');await show('WHOLESALE');}catch(e){showError(e);}
    });
    root.querySelector('[data-quote-form]')?.addEventListener('submit',async event=>{
      event.preventDefault();const d=formData(event.currentTarget);
      try{await call('wholesale/orders',{method:'POST',body:{customerId:d.customerId,fulfillmentType:d.fulfillmentType,items:[{productId:d.productId,quantity:Number(d.quantity)}]}});
        notify('Cotação criada.');await show('WHOLESALE');}catch(e){showError(e);}
    });
    root.querySelectorAll('[data-checkout-quote]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try{const order=(quotes.orders||[]).find(x=>x.id===button.dataset.checkoutQuote);
        const saleId=order.saleId||(await call('sales',{method:'POST',body:{wholesaleOrderId:order.id}})).id;
        await window.PdvAppNavigation?.openCheckoutSale(saleId);
      }catch(e){showError(e);button.disabled=false;}
    }));
    root.querySelectorAll('[data-confirm-quote]').forEach(button=>button.addEventListener('click',async()=>{
      try{await call('wholesale/orders/'+id(button.dataset.confirmQuote)+'/confirm',{method:'POST',body:{}});
        notify('Cotação confirmada.');await show('WHOLESALE');}catch(e){showError(e);}
    }));
  }
  async function show(route){
    if(!api.webMode)return;
    root.innerHTML=section('Carregando módulo','Buscando dados autorizados do estabelecimento.','<div class="ops-loader" role="status"></div>');
    try{
      const lookup={customers:()=>contacts('customers'),suppliers:()=>contacts('suppliers'),sellers,commissions,credit,FOOD:food,WHOLESALE:wholesale};
      if(!lookup[route])throw new Error('Módulo não disponível.');
      await lookup[route]();
      if(!active(route))return;
      root.querySelector('[data-parity-refresh]')?.addEventListener('click',()=>void show(route));
      window.PdvRouteRegistry?.updated?.(route,{surface:'web-parity'});
    }catch(error){if(active(route)){root.innerHTML=section('Não foi possível abrir o módulo','Consulte o erro e tente novamente.','<p class="ops-error" role="alert">'+esc(error.message)+'</p><button class="ops-secondary" data-parity-retry>Tentar novamente</button>');root.querySelector('[data-parity-retry]')?.addEventListener('click',()=>void show(route));}}
  }
  window.PdvWebParityUi=Object.freeze({show});
})();
