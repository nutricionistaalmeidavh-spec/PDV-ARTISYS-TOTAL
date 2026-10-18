'use strict';

// R4 advanced settings share the same PWA renderer, identity, branch and canonical checkout.
(() => {
  const root=window,ApiClient=root.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const api=new ApiClient(),node=document.getElementById('route-content');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>(Number(v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const can=p=>Boolean(root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,p));
  const safe=async f=>{try{return await f();}catch{return null;}};
  const r4=(path,method='GET',body)=>api.request('/api/v1/restaurant'+path,{method,body});
  const uid=v=>encodeURIComponent(String(v||''));
  const select=(name,rows,labelFn=x=>x.name,empty='Selecione',required=true)=>
    '<select name="'+esc(name)+'" '+(required?'required':'')+'><option value="">'+esc(empty)+'</option>'+
    rows.map(v=>'<option value="'+esc(v.id)+'">'+esc(labelFn(v))+'</option>').join('')+'</select>';
  const field=(name,title,type='text',attr='')=>'<label class="field"><span>'+esc(title)+'</span><input name="'+esc(name)+'" type="'+type+'" '+attr+'></label>';
  const toast=(msg,bad=false)=>root.PdvToast?.show?.(msg,bad?'error':'success');
  let sessionId='',model={};
  const sections=[
    {id:'service',name:'Comandas e divisão'},
    {id:'production',name:'KDS e impressoras'},
    {id:'pizza',name:'Pizzaria'},
    {id:'weight',name:'Padaria / peso'},
    {id:'recipe',name:'Fichas técnicas'},
    {id:'segments',name:'Segmentos'}
  ];
  let section='service';
  const eurosToCents=value=>{
    const input=String(value||'').trim().replaceAll('.','').replace(',','.');
    if(!/^\d+(?:\.\d{1,2})?$/.test(input))throw Error('Valor deve ter até duas casas decimais.');
    const result=Math.round(Number(input)*100);
    if(!Number.isSafeInteger(result)||result>1000000000)throw Error('Preço fora dos limites.');
    return result;
  };
  function parseCatalog(text){
    const rows=String(text||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    return rows.map(line=>{
      const pivot=line.lastIndexOf('=');
      if(pivot<1)throw Error('Escreva uma opção por linha, como Média=30,00.');
      const name=line.slice(0,pivot).trim(),amount=line.slice(pivot+1).trim();
      const code=name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]+/g,'_').replace(/^_|_$/g,'').slice(0,32);
      if(!code||!name)throw Error('Nome da opção inválido.');
      return {code,name,priceCents:eurosToCents(amount)};
    });
  }
  async function load(){
    const [products,stations,routes,tickets,profiles,onboard,orders,tables]=await Promise.all([
      safe(()=>api.products(false)),safe(()=>r4('/kitchen/stations').then(x=>x.stations)),
      safe(()=>r4('/kitchen/routes').then(x=>x.routes)),safe(()=>r4('/kitchen/station-tickets').then(x=>x.tickets)),
      safe(()=>r4('/pizzeria/profiles').then(x=>x.profiles)),
      safe(()=>api.request('/api/v1/onboarding/segments')),
      safe(()=>r4('/orders').then(x=>x.orders)),safe(()=>r4('/tables').then(x=>x.tables))
    ]);
    model={products:products||[],stations:stations||[],routes:routes||[],tickets:tickets||[],
      profiles:profiles||[],onboard:onboard||{},orders:orders||[],tables:tables||[]};
    model.sessionOrders=model.orders.filter(o=>o.table_session_id===sessionId);
    model.orderItems=model.sessionOrders.filter(o=>o.status==='DELIVERED')
      .flatMap(o=>(o.items||[]).map(i=>({...i,orderId:o.id})));
  }
  function service(){
    const active=model.tables.filter(t=>t.sessionId&&t.sessionId!==sessionId);
    const fee=model.products.filter(p=>p.sku==='SERVICE_CHARGE'&&p.trackStock===false);
    if(!sessionId)return '<section class="data-card"><h2>Comandas</h2><p>Selecione uma mesa na tela de alimentação para dividir conta ou transferir itens.</p></section>';
    return '<section class="data-card"><h2>Comanda '+esc(sessionId.slice(0,8))+'</h2>'+
      (can('restaurant.orders.transfer')?'<form data-r4-advanced="split" class="vertical-form"><h3>Divisão de conta</h3><p>A divisão não gera vendas extras: os valores serão pagos no único checkout da comanda.</p>'+
      field('parts','Número de pessoas','number','min="2" max="50" value="2" required')+
      field('bps','Taxa de serviço (%)','number','min="0" max="30" step="0.01" value="0"')+
      '<label class="field"><span>Produto não estocável para taxa (se houver)</span>'+select('serviceChargeProductId',fee,p=>p.name,'Sem taxa',false)+'</label>'+
      '<button class="primary-button">Calcular e registrar divisão</button></form>'+
      '<form data-r4-advanced="transfer-items" class="vertical-form"><h3>Transferir parte de um item</h3>'+
      '<label class="field"><span>Item entregue</span>'+select('orderItemId',model.orderItems,i=>i.name+' × '+i.quantity,'Escolha um item')+'</label>'+
      '<label class="field"><span>Comanda de destino</span>'+select('targetSessionId',active,t=>t.label,'Escolha uma mesa ocupada')+'</label>'+
      field('quantity','Quantidade','number','min="0.001" step="0.001" value="1" required')+
      '<button class="secondary-button">Transferir quantidade</button></form>':'<p>Seu perfil não permite alterar comandas.</p>')+'</section>';
  }
  function production(){
    return '<section class="data-card"><h2>Estações de KDS</h2>'+
      '<div class="restaurant-list">'+model.stations.map(s=>'<div class="restaurant-row"><strong>'+esc(s.name)+'</strong><small>'+
      esc(s.printerName||'Sem impressora vinculada')+' · '+(s.active?'Ativa':'Inativa')+'</small></div>').join('')+'</div>'+
      (can('settings.manage')?'<form class="vertical-form" data-r4-advanced="station"><h3>Adicionar estação</h3>'+
      field('name','Nome do setor','text','required maxlength="100"')+field('printerName','Fila de impressão (opcional)')+
      '<label><input type="checkbox" name="printEnabled"> Habilitar impressão quando houver dispositivo conectado</label>'+
      '<button class="primary-button">Salvar setor</button></form>':'')+
      '<h3>Destino dos produtos</h3><div class="restaurant-list">'+model.routes.map(r=>'<div class="restaurant-row"><strong>'+
      esc(r.productName)+'</strong><small>'+esc(r.mode==='DIRECT'?'Sem KDS':r.stationName)+'</small></div>').join('')+'</div>'+
      (can('products.manage')?'<form class="vertical-form" data-r4-advanced="route"><label class="field"><span>Produto</span>'+
      select('productId',model.products)+'</label><label class="field"><span>Destino</span><select name="mode"><option value="PRODUCTION">Produção / KDS</option><option value="DIRECT">Sem KDS</option></select></label>'+
      '<label class="field"><span>Setor</span>'+select('stationId',model.stations.filter(s=>s.active),s=>s.name,'Escolha estação',false)+'</label>'+
      '<button class="primary-button">Salvar destino</button></form>':'')+
      '<h3>Fila por estação</h3><div class="restaurant-list">'+model.tickets.map(t=>'<div class="restaurant-row"><strong>'+
      esc(t.stationName)+' · '+esc(t.orderId?.slice(0,8))+'</strong><small>'+esc(t.status)+' · '+esc((t.items||[]).map(i=>i.productName+' × '+i.quantity).join(', '))+
      '</small><div class="restaurant-actions">'+(can('kitchen.update_status')?
      (t.status==='NEW'?'<button data-r4-kds="'+esc(t.id)+'" data-next="PREPARING">Iniciar</button>':'')+
      (t.status==='PREPARING'?'<button data-r4-kds="'+esc(t.id)+'" data-next="READY">Pronto</button>':''):'')+'</div></div>').join('')+'</div></section>';
  }
  function pizza(){
    return '<section class="data-card"><h2>Personalização de pizza</h2>'+
      '<p>Preços em reais. Uma opção por linha, por exemplo: Calabresa=42,00.</p>'+
      '<div class="restaurant-list">'+model.profiles.map(p=>'<div class="restaurant-row">'+esc(model.products.find(x=>x.id===p.productId)?.name||p.productId)+' · '+esc(p.policy)+'</div>').join('')+'</div>'+
      (can('products.manage')?'<form data-r4-advanced="pizza" class="vertical-form"><label class="field"><span>Produto base</span>'+select('productId',model.products)+'</label>'+
      '<label class="field"><span>Política</span><select name="policy"><option value="HIGHEST_FLAVOR">Cobrar sabor mais caro</option><option value="PROPORTIONAL_AVERAGE">Média dos sabores</option></select></label>'+
      '<label class="field"><span>Como os preços são definidos?</span><select name="pricingMode"><option value="DESKTOP_DELTAS">Preço base do produto + acréscimos</option><option value="ABSOLUTE_OPTIONS">Tabela de preços finais por opção</option></select></label>'+
      '<p>Em acréscimos, cadastre nos campos abaixo somente a diferença de preço; em tabela final, informe o preço completo.</p>'+
      field('maxFlavors','Máximo de sabores','number','min="1" max="8" value="4"')+
      '<label class="field"><span>Tamanhos</span><textarea name="sizes" required rows="3" placeholder="Média=30,00"></textarea></label>'+
      '<label class="field"><span>Sabores</span><textarea name="flavors" required rows="3" placeholder="Calabresa=42,00"></textarea></label>'+
      '<label class="field"><span>Bordas (opcional)</span><textarea name="crusts" rows="2" placeholder="Catupiry=6,00"></textarea></label>'+
      '<button class="primary-button">Salvar cardápio de pizzas</button></form>':'')+
      '<form data-r4-advanced="pizza-quote" class="vertical-form"><h3>Consultar preço</h3><label class="field"><span>Produto</span>'+
      select('productId',model.profiles.map(p=>({id:p.productId,name:model.products.find(x=>x.id===p.productId)?.name||p.productId})))+'</label>'+
      '<p>Selecione o produto e carregue seu perfil para escolher tamanho e sabores.</p><button class="secondary-button">Carregar opções</button></form>'+
      '<div data-r4-pizza-preview></div></section>';
  }
  function weight(){
    return '<section class="data-card"><h2>Padaria e venda por peso</h2><p>Informe a quantidade em gramas. O preço será calculado no servidor.</p>'+
      '<form data-r4-advanced="weight" class="vertical-form"><label class="field"><span>Produto em quilos</span>'+
      select('productId',model.products.filter(p=>String(p.unit).toUpperCase()==='KG'))+'</label>'+
      field('grams','Peso (gramas)','number','min="1" max="100000000" step="1" required')+
      '<button class="primary-button">Calcular preço</button></form><output data-r4-result></output></section>';
  }
  function recipe(){
    return '<section class="data-card"><h2>Fichas técnicas</h2><p>Versões anteriores permanecem registradas. O débito de insumos ocorre apenas ao concluir uma venda.</p>'+
      (can('products.manage')?'<form data-r4-advanced="recipe" class="vertical-form"><label class="field"><span>Produto preparado sem estoque próprio</span>'+
      select('productId',model.products.filter(p=>p.trackStock===false))+'</label>'+
      '<label class="field"><span>Ingredientes e quantidade (por unidade preparada)</span><textarea name="ingredients" required rows="4" placeholder="SKU-FARINHA=0,250"></textarea></label>'+
      '<p>Uma linha por ingrediente: SKU=quantidade, até três casas decimais.</p>'+
      '<button class="primary-button">Salvar nova versão</button></form>':'')+'<output data-r4-result></output></section>';
  }
  function segments(){
    const data=model.onboard,items=data.segments||[];
    return '<section class="data-card"><h2>Perfil da loja</h2><p>O segmento sugere recursos. Nenhum módulo será ativado automaticamente e não altera a licença.</p>'+
      (can('settings.manage')?'<form data-r4-advanced="segment" class="vertical-form"><label class="field"><span>Segmento</span>'+
        '<select name="segmentId">'+items.map(s=>'<option value="'+esc(s.id)+'" '+(data.selectedId===s.id?'selected':'')+'>'+esc(s.label)+'</option>').join('')+
        '</select></label><button class="primary-button">Salvar preferência</button></form>':'')+
      '<div class="restaurant-list">'+items.map(s=>'<div class="restaurant-row"><strong>'+esc(s.label)+'</strong><small>'+
      (s.recommended.length?'Recomendado: '+esc(s.recommended.join(', ')):'Núcleo padrão')+'</small></div>').join('')+'</div></section>';
  }
  function render(){
    const renderer={service,production,pizza,weight,recipe,segments};
    node.innerHTML='<section class="page vertical-page restaurant-page"><header class="page-head"><div><h1>Alimentação · Configuração avançada</h1>'+
      '<p>Uma operação, um checkout e um cadastro canônico.</p></div><button class="secondary-button" type="button" data-r4-back>← Voltar para mesas</button></header>'+
      '<nav class="restaurant-view-switch" aria-label="Seções da alimentação">'+sections.map(s=>'<button class="restaurant-btn '+(section===s.id?'':'secondary')+
      '" type="button" data-r4-section="'+esc(s.id)+'">'+esc(s.name)+'</button>').join('')+'</nav>'+
      renderer[section]()+'</section>';
    node.querySelector('[data-r4-back]')?.addEventListener('click',()=>void root.PdvRestaurantWebUi?.show?.());
    node.querySelectorAll('[data-r4-section]').forEach(b=>b.addEventListener('click',()=>{section=b.dataset.r4Section;render();}));
    node.querySelectorAll('[data-r4-advanced]').forEach(f=>f.addEventListener('submit',e=>{e.preventDefault();void submit(f);}));
    node.querySelectorAll('[data-r4-kds]').forEach(b=>b.addEventListener('click',async()=>{
      try{await r4('/kitchen/station-tickets/'+uid(b.dataset.r4Kds),'PATCH',{status:b.dataset.next});await show({sessionId,preserve:true});}
      catch(e){toast(e.message,true);}
    }));
  }
  async function submit(form){
    const kind=form.dataset.r4Advanced,v=Object.fromEntries(new FormData(form));
    try{
      if(kind==='station')await r4('/kitchen/stations','POST',{name:v.name,printerName:v.printerName,printEnabled:!!v.printEnabled});
      if(kind==='route')await r4('/kitchen/routes','POST',{productId:v.productId,mode:v.mode,
        stationId:v.mode==='PRODUCTION'?v.stationId:null});
      if(kind==='pizza')await r4('/pizzeria/profiles','POST',{productId:v.productId,policy:v.policy,pricingMode:v.pricingMode,maxFlavors:Number(v.maxFlavors),
        sizes:parseCatalog(v.sizes),flavors:parseCatalog(v.flavors),crusts:parseCatalog(v.crusts)});
      if(kind==='pizza-quote'){
        const result=await r4('/pizzeria/products/'+uid(v.productId));
        const profile=result.profile;
        if(!profile)throw Error('Configure primeiro este produto.');
        const host=node.querySelector('[data-r4-pizza-preview]');
        if(host)host.innerHTML='<form data-r4-pizza-price class="vertical-form"><input type="hidden" name="productId" value="'+esc(v.productId)+'">'+
          '<label class="field"><span>Tamanho</span><select name="sizeCode">'+profile.sizes.map(s=>'<option value="'+esc(s.code)+'">'+esc(s.name)+'</option>').join('')+'</select></label>'+
          '<fieldset><legend>Sabores</legend>'+profile.flavors.map(f=>'<label><input type="checkbox" name="flavorCodes" value="'+esc(f.code)+'">'+esc(f.name)+'</label>').join('')+'</fieldset>'+
          '<label class="field"><span>Borda</span><select name="crustCode"><option value="">Sem borda</option>'+
          profile.crusts.map(c=>'<option value="'+esc(c.code)+'">'+esc(c.name)+'</option>').join('')+'</select></label>'+
          '<button class="primary-button">Calcular</button></form>';
        host.querySelector('form')?.addEventListener('submit',async e=>{
          e.preventDefault();const data=new FormData(e.target);try{
            const quote=await r4('/pizzeria/quote','POST',{productId:data.get('productId'),sizeCode:data.get('sizeCode'),
              flavorCodes:data.getAll('flavorCodes'),crustCode:data.get('crustCode')||null});
            toast('Preço por unidade: '+money(quote.quote.unitPriceCents));
          }catch(error){toast(error.message,true);}
        });
        return;
      }
      if(kind==='weight'){
        const quote=await r4('/weight/quote','POST',{productId:v.productId,grams:Number(v.grams)});
        const output=node.querySelector('[data-r4-result]');
        if(output){
          output.innerHTML='<p>Preço calculado: '+money(quote.quote.totalCents)+'</p><button type="button" class="primary-button" data-r4-bakery-order>Gerar pedido de balcão</button>';
          output.querySelector('[data-r4-bakery-order]')?.addEventListener('click',async()=>{
            try{const order=await r4('/bakery/orders','POST',{items:[{productId:v.productId,quantity:quote.quote.quantity}]});
              toast('Pedido de balcão registrado. Senha '+order.order.ticketNumber+'.');
              await show({sessionId,preserve:true});
            }catch(error){toast(error.message,true);}
          });
        }return;
      }
      if(kind==='recipe'){
        const ingredients=String(v.ingredients).split(/\r?\n/).filter(s=>s.trim()).map(line=>{
          const [sku,qty]=line.split('=');
          const product=model.products.find(p=>p.sku===sku?.trim());
          if(!product||!qty||!/^\d+(?:[.,]\d{1,3})?$/.test(qty.trim()))throw Error('Confira SKU e quantidade de cada insumo.');
          return {ingredientId:product.id,quantity:Number(qty.replace(',','.'))};
        });
        const out=await api.request('/api/v1/recipes/'+uid(v.productId),{method:'PUT',body:{ingredients}});
        toast('Ficha técnica versão '+out.recipe.version+' salva.');
      }
      if(kind==='segment'){
        await api.request('/api/v1/onboarding/segments',{method:'PUT',body:{segmentId:v.segmentId}});
      }
      if(kind==='transfer-items'){
        await r4('/sessions/'+uid(sessionId)+'/transfer-items','POST',{targetSessionId:v.targetSessionId,
          items:[{orderItemId:v.orderItemId,quantity:Number(v.quantity)}]});
      }
      if(kind==='split'){
        const bps=Math.round(Number(v.bps||0)*100);
        const result=await r4('/sessions/'+uid(sessionId)+'/split','POST',{parts:Number(v.parts),serviceChargeBps:bps,
          serviceChargeProductId:bps>0?v.serviceChargeProductId:null});
        toast('Divisão registrada: '+result.plan.shares.map(money).join(' + '));
      }
      if(kind!=='pizza-quote'&&kind!=='weight')await show({sessionId,preserve:true});
    }catch(e){toast(e.message,true);}
  }
  async function show({sessionId:id='',preserve=false}={}){
    sessionId=id||'';if(!preserve)section=sessionId?'service':'production';
    node.innerHTML='<section class="page"><h2>Carregando opções…</h2></section>';
    try{await load();render();}catch(e){node.textContent='Não foi possível carregar: '+e.message;}
  }

  async function offerFirstRun(){
    if(!api.webMode||!can('settings.manage'))return;
    let preference;
    try{preference=await api.request('/api/v1/onboarding/segments');}catch{return;}
    if(preference?.selectedId||!preference?.segments?.length)return;
    const overlay=document.getElementById('auth-overlay');
    if(!overlay)return;
    overlay.classList.remove('hidden');
    overlay.innerHTML='<section class="auth-card" role="dialog" aria-modal="true" aria-labelledby="r4-segment-title">'+
      '<h1 id="r4-segment-title">Qual é o tipo do seu negócio?</h1>'+
      '<p>Esta escolha sugere módulos. Nenhum recurso pago ou área opcional será ativado automaticamente.</p>'+
      '<form id="r4-segment-first-run"><label class="field"><span>Segmento principal</span><select name="segmentId" required>'+
      preference.segments.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.label)+'</option>').join('')+
      '</select></label><div class="modal-actions"><button type="button" class="secondary-button" data-r4-onboard-later>Decidir depois</button>'+
      '<button type="submit" class="primary-button">Salvar e continuar</button></div></form>'+
      '<small>Depois, em Configurações, você poderá escolher quais áreas deseja habilitar.</small></section>';
    const close=()=>{overlay.classList.add('hidden');overlay.innerHTML='';};
    overlay.querySelector('[data-r4-onboard-later]')?.addEventListener('click',close);
    const form=overlay.querySelector('#r4-segment-first-run');
    form?.addEventListener('submit',async e=>{
      e.preventDefault();
      const button=form.querySelector('[type="submit"]');button.disabled=true;
      try{
        const selected=form.elements.segmentId.value;
        await api.request('/api/v1/onboarding/segments',{method:'PUT',body:{segmentId:selected}});
        close();
        toast('Segmento configurado. As áreas opcionais continuam sob seu controle.');
      }catch(error){button.disabled=false;toast(error.message,true);}
    });
    form?.elements.segmentId.focus();
  }

  root.PdvR4AdvancedUi=Object.freeze({show,offerFirstRun});
})();