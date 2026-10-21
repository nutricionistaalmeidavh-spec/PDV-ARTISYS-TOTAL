'use strict';

// R4 advanced settings share the same PWA renderer, identity, branch and canonical checkout.
(() => {
  const root=window,ApiClient=root.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const api=new ApiClient(),node=document.getElementById('route-content');
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>(Number(v||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const can=p=>Boolean(root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,p));
  const r4=(path,method='GET',body)=>api.request('/api/v1/restaurant'+path,{method,body});
  const uid=v=>encodeURIComponent(String(v||''));
  const select=(name,rows,labelFn=x=>x.name,empty='Selecione',required=true)=>
    '<select name="'+esc(name)+'" '+(required?'required':'')+'><option value="">'+esc(empty)+'</option>'+
    rows.map(v=>'<option value="'+esc(v.id)+'">'+esc(labelFn(v))+'</option>').join('')+'</select>';
  const field=(name,title,type='text',attr='')=>'<label class="field"><span>'+esc(title)+'</span><input name="'+esc(name)+'" type="'+type+'" '+attr+'></label>';
  const toast=(msg,bad=false)=>root.PdvToast?.show?.(msg,bad?'error':'success');
  let sessionId='',recipeProductId='',pizzaProductId='',recipeLoadToken=0,showGeneration=0,editorOrigin='FOOD',model={};
  const sections=[
    {id:'service',name:'Comandas e divisão'},
    {id:'production',name:'KDS e impressoras'},
    {id:'pizza',name:'Opções de pizza'},
    {id:'recipe',name:'Fichas técnicas'},
    {id:'segments',name:'Perfil da loja'}
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
  async function load(target,productId){
    const result={products:[],stations:[],routes:[],tickets:[],profiles:[],onboard:{},modules:[],position:null,orders:[],tables:[],ticketClock:{timeZone:'America/Sao_Paulo'},recipe:null};
    const tasks=[];
    const read=(key,request)=>tasks.push(request.then(value=>{result[key]=value;}));
    if(target!=='segments')read('products',api.products(false));
    if(target==='pizza'&&pizzaProductId)read('profiles',r4('/pizzeria/products/'+uid(pizzaProductId)).then(x=>x.profile?[x.profile]:[]));
    if(target==='recipe'&&productId)read('profiles',api.productConfiguration(productId).then(x=>x.pizzaProfile?[x.pizzaProfile]:[]));
    if(target==='recipe'&&productId)read('recipe',api.request('/api/v1/recipes/'+uid(productId)).then(x=>x.recipe));
    if(target==='service'&&sessionId){
      read('orders',r4('/orders').then(x=>x.orders));
      read('tables',r4('/tables').then(x=>x.tables));
      read('position',r4('/sessions/'+uid(sessionId)+'/position').then(x=>x.position));
    }
    if(target==='production'){
      if(can('settings.manage'))read('ticketClock',r4('/tickets/time-zone'));
      read('stations',r4('/kitchen/stations').then(x=>x.stations));
      read('routes',r4('/kitchen/routes').then(x=>x.routes));
      read('tickets',r4('/kitchen/station-tickets').then(x=>x.tickets));
    }
    if(target==='segments'){
      read('onboard',api.request('/api/v1/onboarding/segments'));
    }
    await Promise.all(tasks);
    result.sessionOrders=result.orders.filter(o=>o.table_session_id===sessionId);
    result.orderItems=result.sessionOrders.filter(o=>o.status==='DELIVERED').flatMap(o=>(o.items||[]).map(i=>({...i,orderId:o.id})));
    return result;
  }
  function service(){
    const active=model.tables.filter(t=>t.sessionId&&t.sessionId!==sessionId);
    const fee=model.products.filter(p=>p.sku==='SERVICE_CHARGE'&&p.trackStock===false);
    if(!sessionId)return '<section class="data-card"><h2>Comandas</h2><p>Selecione uma mesa na tela de alimentação para dividir conta ou transferir itens.</p></section>';
    return '<section class="data-card"><h2>Comanda '+esc(sessionId.slice(0,8))+'</h2>'+
      (can('restaurant.orders.transfer')?'<form data-r4-advanced="split" class="vertical-form"><h3>Divisão de conta</h3><p>A divisão não gera vendas extras: os valores serão pagos no único checkout da comanda.</p>'+
      field('parts','Número de pessoas','number','min="2" max="50" value="2" required')+
      field('bps','Taxa de serviço (%)','number','min="0" max="30" step="0.01" value="0"')+
      field('individualShares','Valores por pessoa (opcional, em R$ separados por ponto e vírgula)','text','placeholder="33,33; 33,34; 33,34"')+
      '<details><summary>Ratear por item entregue (em vez de por valores)</summary><label><input type="checkbox" name="allocationMode"> Atribuir cada item a um pagador</label>'+
      '<p>Indique a parte 1, 2, 3 etc. para cada item. Todas devem ser preenchidas e a quantidade de partes corresponde ao campo acima.</p>'+
      ((model.position?.items)||[]).map(item=>{
        const name=model.orderItems.find(x=>x.id===item.id)?.name||item.id.slice(0,8);
        return '<label class="field"><span>'+esc(name)+' · '+money(item.totalCents)+'</span><select name="payer_'+esc(item.id)+'">'+
          '<option value="">Selecione o pagador</option>'+
          Array.from({length:50},(_,i)=>'<option value="'+(i+1)+'">Pagador '+(i+1)+'</option>').join('')+'</select></label>';
      }).join('')+'</details>'+
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
      (can('products.manage')?'<form data-r4-advanced="pizza" class="vertical-form"><label class="field"><span>Produto base</span>'+'<input type="hidden" name="productId" value="'+esc(pizzaProductId)+'"><strong>'+esc(model.products.find(p=>p.id===pizzaProductId)?.name||'Selecione o produto no Cardápio')+'</strong></label>'+
      '<label class="field"><span>Política</span><select name="policy"><option value="HIGHEST_FLAVOR">Cobrar sabor mais caro</option><option value="PROPORTIONAL_AVERAGE">Média dos sabores</option></select></label>'+
      '<label class="field"><span>Como os preços são definidos?</span><select name="pricingMode"><option value="DESKTOP_DELTAS">Preço base do produto + acréscimos</option><option value="ABSOLUTE_OPTIONS">Tabela de preços finais por opção</option></select></label>'+
      '<p>Em acréscimos, cadastre nos campos abaixo somente a diferença de preço; em tabela final, informe o preço completo.</p>'+
      field('maxFlavors','Máximo de sabores','number','min="1" max="8" value="4"')+
      '<label class="field"><span>Tamanhos</span><textarea name="sizes" required rows="3" placeholder="Média=30,00"></textarea></label>'+
      '<label class="field"><span>Sabores</span><textarea name="flavors" required rows="3" placeholder="Calabresa=42,00"></textarea></label>'+
      '<label class="field"><span>Bordas (opcional)</span><textarea name="crusts" rows="2" placeholder="Catupiry=6,00"></textarea></label>'+
      '<label class="field"><span>Adicionais (opcional)</span><textarea name="addons" rows="2" placeholder="Queijo extra=5,00"></textarea></label>'+
      '<button class="primary-button">Salvar opções do produto</button></form>':'')+
      '<form data-r4-advanced="pizza-quote" class="vertical-form"><h3>Consultar preço</h3><label class="field"><span>Produto</span>'+
      select('productId',model.profiles.map(p=>({id:p.productId,name:model.products.find(x=>x.id===p.productId)?.name||p.productId})))+'</label>'+
      '<p>Selecione o produto e carregue seu perfil para escolher tamanho e sabores.</p><button class="secondary-button">Carregar opções</button></form>'+
      '<div data-r4-pizza-preview></div></section>';
  }
  const recipeUnits=['UN','KG','G','L','ML','M','M2','M3','CX','PCT'];
  const unitSelect=(name,value)=>'<select name="'+esc(name)+'" aria-label="Unidade">'+recipeUnits.map(u=>'<option '+(u===value?'selected ':'')+'value="'+u+'">'+u+'</option>').join('')+'</select>';
  function ingredientRow(component={},detailed=true){
    const current=model.products.find(p=>p.id===(component.productId||component.ingredientId));
    return '<fieldset data-recipe-component class="vertical-form"><legend>Ingrediente</legend><label class="field"><span>Produto / insumo</span>'+
      '<select name="ingredientId" aria-label="Ingrediente" required><option value="">Selecione o insumo</option>'+
      model.products.filter(p=>p.trackStock!==false&&p.id!==recipeProductId).map(p=>'<option value="'+esc(p.id)+'" '+(p.id===current?.id?'selected':'')+'>'+esc(p.name)+' ('+esc(p.unit)+')</option>').join('')+'</select></label>'+
      field('ingredientQuantity',detailed?'Quantidade para a receita inteira':'Quantidade por unidade vendida','number','min="0.001" max="100000000" step="0.001" required value="'+esc(component.quantity||'')+'"')+
      (detailed?'<label class="field"><span>Unidade na receita</span>'+unitSelect('ingredientUnit',component.unit||current?.unit||'UN')+'</label>'+
      field('conversionFactor','Conversão: unidades de estoque por unidade da receita','number','min="0.000001" max="1000000" step="any" required value="'+esc(component.conversionFactor??1)+'"')+
      field('lossPercent','Perda (%)','number','min="0" max="99.999" step="any" required value="'+esc(component.lossPercent??0)+'"'):'')+
      '<button type="button" class="secondary-button" data-recipe-remove>Remover ingrediente</button></fieldset>';
  }
  function recipe(){
    const r=model.recipe||{},prepared=model.products.filter(p=>p.trackStock===false);
    return '<section class="data-card"><h2>Fichas técnicas</h2><p>Cadastre os ingredientes da receita inteira e o rendimento. Cada venda consome somente a quantidade correspondente às porções vendidas.</p>'+
      (can('products.manage')?'<form data-r4-advanced="recipe" class="vertical-form"><label class="field"><span>Produto preparado</span>'+
      '<select name="productId" required><option value="">Selecione o produto</option>'+prepared.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===recipeProductId?'selected':'')+'>'+esc(p.name)+'</option>').join('')+'</select></label>'+
      '<p data-recipe-version>'+(r.version?'Versão atual: '+esc(r.version)+'. Salvar cria uma nova versão, sem alterar vendas anteriores.':'Selecione um produto preparado, com estoque próprio desativado.')+'</p>'+
      field('yieldQuantity','Rendimento da receita inteira','number','min="0.001" max="100000000" step="0.001" required value="'+esc(r.yieldQuantity||1)+'"')+
      '<label class="field"><span>Unidade do rendimento</span>'+unitSelect('yieldUnit',r.yieldUnit||'UN')+'</label>'+
      field('portionQuantity','Quantidade do rendimento por porção vendida','number','min="0.001" max="100000000" step="0.001" required value="'+esc(r.portionQuantity||1)+'"')+
      field('prepTimeMinutes','Tempo de preparo (minutos)','number','min="0" max="100000" step="1" required value="'+esc(r.prepTimeMinutes||0)+'"')+
      '<h3>Ingredientes</h3><div data-recipe-components>'+((r.components?.length?r.components:[{}]).map(c=>ingredientRow(c))).join('')+'</div>'+
      '<button type="button" class="secondary-button" data-recipe-add>+ Adicionar ingrediente</button>'+
      '<output data-recipe-cost aria-live="polite"></output>'+
      '<label class="field"><span>Modo de preparo</span><textarea name="preparationNotes" rows="4" maxlength="10000">'+esc(r.preparationNotes||'')+'</textarea></label>'+
      '<label class="field"><span>Observações internas</span><textarea name="notes" rows="2" maxlength="10000">'+esc(r.notes||'')+'</textarea></label>'+
      '<button class="primary-button">Salvar nova versão da ficha</button></form>'+
      (model.profiles.length?'<details><summary>Fichas de opções de pizza</summary><form data-r4-advanced="option-recipe" class="vertical-form"><h3>Ingredientes de sabor, tamanho, borda ou adicional</h3>'+
      '<label class="field"><span>Produto de pizza</span>'+select('productId',model.profiles.map(p=>({id:p.productId,name:model.products.find(x=>x.id===p.productId)?.name||p.productId})))+'</label>'+
      '<label class="field"><span>Tipo da opção</span><select name="kind"><option value="FLAVOR">Sabor</option><option value="SIZE">Tamanho</option><option value="CRUST">Borda</option><option value="ADDON">Adicional</option></select></label>'+
      '<label class="field"><span>Opção cadastrada</span><select name="code" required><option value="">Selecione o produto de pizza</option></select></label>'+
      '<button type="button" class="secondary-button" data-option-recipe-load>Carregar ficha da opção</button>'+
      '<p>Quantidades na unidade de estoque de cada insumo, por unidade vendida desta opção.</p><div data-recipe-components>'+ingredientRow({},false)+'</div>'+
      '<button type="button" class="secondary-button" data-recipe-add>+ Adicionar ingrediente</button>'+
      '<button class="primary-button">Salvar ficha da opção</button></form></details>':''):'<p>Seu perfil não permite editar fichas técnicas.</p>')+'<output data-r4-result></output></section>';
  }
  function componentsFrom(form,detailed=true){
    return [...form.querySelectorAll('[data-recipe-component]')].map(row=>{
      const value=name=>row.querySelector('[name="'+name+'"]')?.value;
      const productId=value('ingredientId'),quantity=Number(value('ingredientQuantity'));
      if(!productId||!Number.isFinite(quantity)||quantity<=0)throw Error('Selecione o insumo e preencha sua quantidade em cada ingrediente.');
      return {productId,quantity,...(detailed?{unit:value('ingredientUnit'),conversionFactor:Number(value('conversionFactor')),lossPercent:Number(value('lossPercent'))}:{})};
    });
  }
  function updateRecipeCost(form){
    const target=form.querySelector('[data-recipe-cost]');if(!target)return;
    try{
      const components=componentsFrom(form),yieldQuantity=Number(form.elements.yieldQuantity.value),portionQuantity=Number(form.elements.portionQuantity.value);
      if(!(yieldQuantity>0&&portionQuantity>0&&portionQuantity<=yieldQuantity))throw Error('Informe rendimento e porção válidos.');
      const batch=components.reduce((total,c)=>{
        if(!(c.conversionFactor>0&&c.lossPercent>=0&&c.lossPercent<100))throw Error('Confira conversões e perdas.');
        return total+Math.round((model.products.find(p=>p.id===c.productId)?.lastCostCents||0)*c.quantity*c.conversionFactor*(1+c.lossPercent/100));
      },0),perPortion=Math.round(batch/(yieldQuantity/portionQuantity));
      const price=model.products.find(p=>p.id===form.elements.productId.value)?.salePriceCents||0;
      const capacities=components.map(c=>{
        const p=model.products.find(p=>p.id===c.productId),old=model.recipe?.components?.find(x=>x.productId===c.productId);
        const balance=p?.balance??p?.stockQuantity??old?.balance;
        return balance===undefined?null:Math.floor((Number(balance)+1e-9)/(c.quantity*c.conversionFactor*(1+c.lossPercent/100)/(yieldQuantity/portionQuantity)));
      });
      const capacity=capacities.every(x=>x!==null)?Math.max(0,Math.min(...capacities)):null;
      target.textContent='Custo da receita: '+money(batch)+' · Custo por porção: '+money(perPortion)+' · '+(yieldQuantity/portionQuantity).toLocaleString('pt-BR')+' porções'+(price>0?' · CMV: '+(perPortion/price*100).toLocaleString('pt-BR',{maximumFractionDigits:2})+'% · Margem bruta por porção: '+money(price-perPortion):'')+(capacity!==null?' · Capacidade com estoque atual: '+capacity+' porções':'');
    }catch(error){target.textContent=error.message;}
  }
  function wireRecipeForms(){
    node.querySelectorAll('[data-r4-advanced="recipe"], [data-r4-advanced="option-recipe"]').forEach(form=>{
      const detailed=form.dataset.r4Advanced==='recipe';
      form.querySelector('[data-recipe-add]')?.addEventListener('click',()=>{
        form.querySelector('[data-recipe-components]').insertAdjacentHTML('beforeend',ingredientRow({},detailed));updateRecipeCost(form);
      });
      form.addEventListener('click',event=>{const remove=event.target.closest('[data-recipe-remove]');if(remove){remove.closest('[data-recipe-component]').remove();updateRecipeCost(form);}});
      form.addEventListener('input',()=>updateRecipeCost(form));
      form.addEventListener('change',event=>{
        const row=event.target.closest('[data-recipe-component]');
        if(row&&detailed){
          const ingredient=model.products.find(p=>p.id===row.querySelector('[name="ingredientId"]').value);
          const units=row.querySelector('[name="ingredientUnit"]'),conversion=row.querySelector('[name="conversionFactor"]');
          if(event.target.name==='ingredientId'&&ingredient){units.value=ingredient.unit;conversion.value='1';}
          if(event.target.name==='ingredientUnit'&&ingredient){
            const factor=units.value===ingredient.unit?1:({'G:KG':0.001,'KG:G':1000,'ML:L':0.001,'L:ML':1000})[units.value+':'+ingredient.unit];
            if(factor!==undefined)conversion.value=String(factor);
          }
        }
        updateRecipeCost(form);
      });
      if(detailed){
        form.elements.productId.addEventListener('change',async()=>{
          const previous=recipeProductId,requested=form.elements.productId.value,token=++recipeLoadToken;
          recipeProductId=requested;
          const submitButton=form.querySelector('button.primary-button');if(submitButton)submitButton.disabled=true;
          try{
            const [loaded,configuration]=requested?await Promise.all([api.request('/api/v1/recipes/'+uid(requested)).then(x=>x.recipe),api.productConfiguration(requested)]):[null,{}];
            if(token!==recipeLoadToken||!form.isConnected)return;
            model.recipe=loaded;model.profiles=configuration.pizzaProfile?[configuration.pizzaProfile]:[];render();
          }catch(error){
            if(token!==recipeLoadToken||!form.isConnected)return;
            recipeProductId=previous;form.elements.productId.value=previous;
            if(submitButton)submitButton.disabled=false;toast(error.message,true);
          }
        });updateRecipeCost(form);
      }else{
        const options=()=>{
          const profile=model.profiles.find(p=>p.productId===form.elements.productId.value),key={FLAVOR:'flavors',SIZE:'sizes',CRUST:'crusts',ADDON:'addons'}[form.elements.kind.value];
          form.elements.code.innerHTML='<option value="">Selecione a opção</option>'+(profile?.[key]||[]).map(x=>'<option value="'+esc(x.code)+'">'+esc(x.name)+'</option>').join('');
        };
        form.elements.productId.addEventListener('change',options);form.elements.kind.addEventListener('change',options);options();
        form.querySelector('[data-option-recipe-load]').addEventListener('click',async()=>{
          if(!form.elements.productId.value||!form.elements.code.value)return toast('Selecione o produto e a opção.',true);
          const selected=[form.elements.productId.value,form.elements.kind.value,form.elements.code.value].join('|');
          try{
            const {recipe:option}=await api.request('/api/v1/recipes/'+uid(form.elements.productId.value)+'/options/'+uid(form.elements.kind.value)+'/'+uid(form.elements.code.value));
            if(!form.isConnected||selected!==[form.elements.productId.value,form.elements.kind.value,form.elements.code.value].join('|'))return;
            form.querySelector('[data-recipe-components]').innerHTML=(option?.ingredients?.length?option.ingredients:[{}]).map(c=>ingredientRow(c,false)).join('');
            toast(option?'Ficha da opção carregada.':'Esta opção ainda não tem ficha. Adicione seus ingredientes.');
          }catch(error){toast(error.message,true);}
        });
      }
    });
  }
  function ticketClockForm(){
    return '<section class="data-card"><form data-r4-advanced="ticket-clock" class="vertical-form"><h3>Data local da senha diária</h3><label class="field"><span>Fuso horário da filial</span><select name="timeZone">'+
      ['America/Sao_Paulo','America/Manaus','America/Cuiaba','America/Belem','America/Recife','UTC'].map(z=>'<option value="'+esc(z)+'" '+(model.ticketClock?.timeZone===z?'selected':'')+'>'+esc(z)+'</option>').join('')+
      '</select></label><button class="primary-button">Salvar fuso</button></form></section>';
  }
  function segments(){
    const data=model.onboard,items=data.segments||[];
    return '<section class="data-card"><h2>Perfil da loja</h2><p>O segmento sugere recursos. Nenhum módulo será ativado automaticamente e não altera a licença.</p>'+
      (can('settings.manage')?'<form data-r4-advanced="segment" class="vertical-form"><label class="field"><span>Segmento</span>'+
        '<select name="segmentId">'+items.map(s=>'<option value="'+esc(s.id)+'" '+(data.selectedId===s.id?'selected':'')+'>'+esc(s.label)+'</option>').join('')+
        '</select></label><button class="primary-button">Salvar preferência</button></form>':'')+
      '<div class="restaurant-list">'+items.map(s=>'<div class="restaurant-row"><strong>'+esc(s.label)+'</strong><small>'+
      (s.recommended.length?'Recomendado: '+esc(s.recommended.join(', ')):'Núcleo padrão')+'</small></div>').join('')+'</div>'+
      '<p>As áreas disponíveis são administradas em Configurações → Áreas.</p></section>';
  }
  function render(){
    const renderer={service,production,pizza,recipe,segments};
    const titles={recipe:'Fichas técnicas',pizza:'Opções do produto',segments:'Perfil da loja',service:'Atendimento e comandas',production:'Preparo e impressoras'};
    const tabs=['service','production'].includes(section)?sections.filter(s=>['service','production'].includes(s.id)):[];
    node.innerHTML='<section class="page vertical-page restaurant-page"><header class="page-head"><div><h1>'+titles[section]+'</h1>'+
      '<p>'+esc(['recipe','pizza'].includes(section)?(model.products.find(p=>p.id===(section==='recipe'?recipeProductId:pizzaProductId))?.name||'Cadastro do produto'):'Preferências da loja e da operação.')+'</p></div><button class="secondary-button" type="button" data-r4-back>← Voltar para mesas</button></header>'+
      (tabs.length?'<nav class="restaurant-view-switch" aria-label="Atendimento e preparo">'+tabs.map(s=>'<button class="restaurant-btn '+(section===s.id?'':'secondary')+
      '" type="button" data-r4-section="'+esc(s.id)+'">'+esc(s.name)+'</button>').join('')+'</nav>':'')+
      renderer[section]()+(section==='production'&&can('settings.manage')?ticketClockForm():'')+'</section>';
    wireRecipeForms();
    const back=node.querySelector('[data-r4-back]'),origin=editorOrigin;
    if(['inventory','products','settings'].includes(origin))back.textContent=origin==='inventory'?'← Voltar ao Estoque':origin==='settings'?'← Voltar às Configurações':'← Voltar ao Cardápio';
    back?.addEventListener('click',()=>void root.PdvAppNavigation?.navigate?.(['inventory','products','settings'].includes(origin)?origin:'FOOD'));
    node.querySelectorAll('[data-r4-section]').forEach(b=>b.addEventListener('click',()=>{void show({section:b.dataset.r4Section,sessionId,preserve:true});}));
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
      if(kind==='pizza'){
        const {profile}=await r4('/pizzeria/products/'+uid(v.productId));
        const parsed=key=>parseCatalog(v[key]).map(option=>({...option,code:profile?.[key]?.find(previous=>previous.name===option.name)?.code||option.code}));
        await r4('/pizzeria/profiles','POST',{productId:v.productId,policy:v.policy,pricingMode:v.pricingMode,maxFlavors:Number(v.maxFlavors),
          sizes:parsed('sizes'),flavors:parsed('flavors'),crusts:parsed('crusts'),addons:parsed('addons')});
      }
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
          '<fieldset><legend>Adicionais</legend>'+(profile.addons||[]).map(a=>'<label><input type="checkbox" name="addonCodes" value="'+esc(a.code)+'"> '+esc(a.name)+'</label>').join('')+'</fieldset>'+
          '<button class="primary-button">Calcular</button></form>';
        host.querySelector('form')?.addEventListener('submit',async e=>{
          e.preventDefault();const data=new FormData(e.target);try{
            const quote=await r4('/pizzeria/quote','POST',{productId:data.get('productId'),sizeCode:data.get('sizeCode'),
              flavorCodes:data.getAll('flavorCodes'),crustCode:data.get('crustCode')||null,addonCodes:data.getAll('addonCodes')});
            toast('Preço por unidade: '+money(quote.quote.unitPriceCents));
          }catch(error){toast(error.message,true);}
        });
        return;
      }
      if(kind==='option-recipe'){
        const ingredients=componentsFrom(form,false).map(c=>({ingredientId:c.productId,quantity:c.quantity}));
        const out=await api.request('/api/v1/recipes/'+uid(v.productId)+'/options/'+uid(v.kind)+'/'+uid(v.code),{method:'PUT',body:{ingredients}});
        toast('Ficha da opção salva, versão '+out.recipe.version+'.');
      }
      if(kind==='recipe'){
        const components=componentsFrom(form);
        const out=await api.request('/api/v1/recipes/'+uid(v.productId),{method:'PUT',body:{components,
          yieldQuantity:Number(v.yieldQuantity),yieldUnit:v.yieldUnit,portionQuantity:Number(v.portionQuantity),
          prepTimeMinutes:Number(v.prepTimeMinutes),preparationNotes:v.preparationNotes,notes:v.notes}});
        recipeProductId=v.productId;
        toast('Ficha técnica versão '+out.recipe.version+' salva.');
      }
      if(kind==='segment'){
        await api.request('/api/v1/onboarding/segments',{method:'PUT',body:{segmentId:v.segmentId}});
      }
      if(kind==='module-toggle'){
        const target=(model.modules||[]).find(m=>m.id===v.moduleId);
        if(!target||!can('settings.manage')||(target.manageCapability&&!can(target.manageCapability)))
          throw Error('Sem permissão para configurar esta área.');
        await api.saveSetting('modules.'+target.id+'.enabled',v.enabled==='on','global');
        toast('Preferência da área salva para o estabelecimento.');
      }
      if(kind==='transfer-items'){
        await r4('/sessions/'+uid(sessionId)+'/transfer-items','POST',{targetSessionId:v.targetSessionId,
          items:[{orderItemId:v.orderItemId,quantity:Number(v.quantity)}]});
      }
      if(kind==='ticket-clock'){
        await r4('/tickets/time-zone','PUT',{timeZone:String(v.timeZone)});
        toast('Data local das senhas atualizada para '+v.timeZone+'.');
      }
      if(kind==='split'){
        const bps=Math.round(Number(v.bps||0)*100);
        const allocationMode=v.allocationMode==='on';
        if(allocationMode&&String(v.individualShares||'').trim())throw Error('Escolha rateio por itens ou valores, não os dois.');
        if(allocationMode&&!model.position?.items?.length)throw Error('Aguarde os itens serem entregues para ratear.');
        const allocations=allocationMode?model.position.items.map(item=>({itemId:item.id,payerIndex:Number(v['payer_'+item.id])})):null;
        const result=await r4('/sessions/'+uid(sessionId)+'/split','POST',{parts:Number(v.parts),serviceChargeBps:bps,
          serviceChargeProductId:bps>0?v.serviceChargeProductId:null,
          ...(allocationMode?{allocations}:(String(v.individualShares||'').trim()?{shares:String(v.individualShares).split(';').map(x=>eurosToCents(x.trim()))}:{}))});
        toast('Divisão registrada: '+result.plan.shares.map(money).join(' + '));
      }
      if(kind!=='pizza-quote')await show({sessionId,preserve:true});
    }catch(e){toast(e.message,true);}
  }
  async function show({sessionId:id='',preserve=false,section:targetSection,productId}={}){
    const generation=++showGeneration,origin=document.body.dataset.activeRoute;
    const context=()=>[api.tenantId,api.branchId,root.PdvCurrentAccess?.id].join('|'),scope=context();
    if(!preserve)editorOrigin=origin;
    if(targetSection==='weight')return root.PdvAppNavigation?.navigate?.('checkout');
    sessionId=id||'';if(productId!==undefined){if(targetSection==='pizza')pizzaProductId=productId||'';else recipeProductId=productId||'';}
    if(targetSection&&sections.some(s=>s.id===targetSection))section=targetSection;else if(!preserve)section=sessionId?'service':'production';
    node.innerHTML='<section class="page"><h2>Carregando opções…</h2></section>';
    try{
      const loaded=await load(section,recipeProductId);
      if(generation!==showGeneration||document.body.dataset.activeRoute!==origin||scope!==context())return;
      model=loaded;render();
      if(section==='pizza'&&pizzaProductId){
        const form=node.querySelector('[data-r4-advanced="pizza"]');
        if(form){
          form.elements.productId.value=pizzaProductId;
          const profile=model.profiles.find(p=>p.productId===pizzaProductId);
          if(profile&&form.isConnected){
            form.elements.policy.value=profile.policy;form.elements.pricingMode.value=profile.pricingMode;form.elements.maxFlavors.value=profile.maxFlavors;
            for(const kind of ['sizes','flavors','crusts','addons'])form.elements[kind].value=(profile[kind]||[]).map(x=>x.name+'='+(x.priceCents/100).toFixed(2).replace('.',',')).join('\n');
          }
        }
      }
    }catch(e){if(generation===showGeneration&&document.body.dataset.activeRoute===origin&&scope===context())node.textContent='Não foi possível carregar: '+e.message;}
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
