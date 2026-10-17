'use strict';

(()=>{
  const ApiClient=window.PdvApiClient?.ApiClient;if(!ApiClient)return;const api=new ApiClient();const ui=window.PdvUiModel;const lifecycle=window.PdvUiLifecycle;const e=encodeURIComponent;
  const FINAL_MODULES=new Set();
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  function content(){return document.getElementById('route-content');}
  function notify(message,error=false){const root=document.getElementById('toast-root');if(!root)return;const node=document.createElement('div');node.className=`toast ${error?'error':'success'}`;node.textContent=message;root.appendChild(node);setTimeout(()=>node.remove(),3200);}
  function back(){const food=document.body.dataset.activeModuleWorkspace==='FOOD';return `<button type="button" class="secondary-button" id="vertical-back">← ${food?'Alimentação':'Início'}</button>`;}
  function bindBack(){document.getElementById('vertical-back')?.addEventListener('click',()=>{if(document.body.dataset.activeModuleWorkspace==='FOOD'){window.PdvVerticalModules?.openWorkspace?.('FOOD');return;}document.querySelector('#sidebar-nav [data-route="home"]')?.click();});}
  function field(name,label,type='text',extra=''){return `<label class="field"><span>${esc(label)}</span><input name="${esc(name)}" type="${type}" ${extra}></label>`;}
  async function req(path,options){return api.request(path,options);}

  async function renderRetail(){
    const root=content();root.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Varejo</h1><p>Variantes, códigos e estoque individual. A venda continua sendo feita pelo Balcão canônico.</p></div>${back()}</header><div class="data-card"><form id="retail-search" class="vertical-form">${field('query','Buscar produto, variante, SKU ou código')}<button class="primary-button">Buscar</button></form><div id="retail-results"></div></div><div class="data-card"><h2>Venda de variantes</h2><p>Escolha a variante pelo produto no Balcão. A venda usa o checkout canônico e os dados já selecionados no catálogo.</p><button type="button" class="primary-button" data-open-retail-checkout>Abrir Balcão</button></div></section>`;bindBack();
    async function search(query=''){try{const rows=await req(`/api/v1/vertical/retail/variants?query=${e(query)}`);document.getElementById('retail-results').innerHTML=rows.map(row=>`<div class="vertical-row"><div><strong>${esc(row.productName)} · ${esc(row.name)}</strong><span>${esc(row.sku||row.barcode||'Sem código')} · ${money(row.unitPriceCents)}</span></div><form data-stock="${esc(row.variantId)}" class="vertical-actions"><label class="field"><span>Estoque</span><input name="quantity" type="number" min="0" step="0.001" value="${Number(row.quantity)}"></label><button>Salvar estoque</button></form></div>`).join('')||'<p class="vertical-empty">Nenhuma variante encontrada.</p>';root.querySelectorAll('[data-stock]').forEach(form=>form.addEventListener('submit',async event=>{event.preventDefault();try{await req(`/api/v1/vertical/retail/variants/${e(form.dataset.stock)}/stock`,{method:'PUT',body:{quantity:Number(new FormData(form).get('quantity'))}});notify('Estoque da variante atualizado.');await search(query);}catch(error){notify(error.message,true);}}));}catch(error){notify(error.message,true);}}
    document.getElementById('retail-search').addEventListener('submit',event=>{event.preventDefault();search(new FormData(event.currentTarget).get('query'));});
    root.querySelector('[data-open-retail-checkout]')?.addEventListener('click',()=>document.querySelector('#sidebar-nav [data-route="checkout"]')?.click());
    await search('');
  }

  async function renderHardware(){
    const root=content();root.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Periféricos</h1><p>Diagnóstico e testes locais. Teste de software não equivale à homologação física de um modelo.</p></div>${back()}</header><div class="data-card"><div class="vertical-actions"><button id="hw-refresh">Diagnóstico</button><button id="hw-printer">Testar impressora NÃO FISCAL</button><button id="hw-scale">Ler balança</button><button id="hw-drawer">Abrir gaveta</button></div><pre id="hw-output" class="vertical-output"></pre></div></section>`;bindBack();const out=document.getElementById('hw-output');async function run(fn){try{out.textContent=JSON.stringify(await fn(),null,2);}catch(error){const message=String(error.message||'Falha no equipamento.').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');out.textContent=message;notify(message,true);}}document.getElementById('hw-refresh').addEventListener('click',()=>run(()=>window.artisysDesktop.hardware.diagnostics()));document.getElementById('hw-printer').addEventListener('click',()=>run(()=>window.artisysDesktop.hardware.testPrinter('TESTE ARTISYS\nDOCUMENTO NAO FISCAL\n')));document.getElementById('hw-scale').addEventListener('click',()=>run(()=>window.artisysDesktop.hardware.testScale()));document.getElementById('hw-drawer').addEventListener('click',()=>run(()=>window.artisysDesktop.hardware.testDrawer()));await run(async()=>{const diagnostics=await window.artisysDesktop.hardware.diagnostics();document.getElementById('hw-scale').disabled=!diagnostics.status?.scale?.available;document.getElementById('hw-drawer').disabled=!diagnostics.status?.cashDrawer?.available;return diagnostics;});
  }

  function renderFinalModule(id){if(id==='RETAIL')return renderRetail();}
  window.PdvFinalModules=Object.freeze({render:id=>FINAL_MODULES.has(id)?renderFinalModule(id):undefined});
  function patchModuleManager(root=document){
    root.querySelectorAll('[data-module-open]').forEach(button=>{const id=button.dataset.moduleOpen;if(!FINAL_MODULES.has(id)||button.dataset.e48Bound)return;button.dataset.e48Bound='1';button.disabled=false;const span=button.querySelector('span');if(span)span.textContent='Abrir módulo';});
    const enabled=root.querySelector('.vertical-enabled');if(enabled&&!enabled.querySelector('#e54-hardware-card')){const box=document.createElement('div');box.className='vertical-card-grid';box.innerHTML='<button id="e54-hardware-card" type="button" class="vertical-card"><strong>Periféricos</strong><span>Configuração, diagnóstico e testes locais</span></button>';enabled.appendChild(box);box.querySelector('#e54-hardware-card').addEventListener('click',renderHardware);}
  }
  const syncModuleManager=()=>patchModuleManager(document);
  lifecycle?.on?.('route:mounted',syncModuleManager);
  lifecycle?.on?.('route:updated',syncModuleManager);
  lifecycle?.on?.('surface:mounted',syncModuleManager);
  document.addEventListener('DOMContentLoaded',syncModuleManager,{once:true});
  patchModuleManager(document);

  let onboardingCheckInFlight=false;
  let onboardingRendered=false;
  let onboardingCompleted=false;
  function homeSurfaceReady(){return document.body.dataset.activeRoute==='home'&&Boolean(content()?.querySelector(':scope > .home-grid'));}
  async function maybeOnboarding(){
    if(onboardingCompleted||onboardingRendered||onboardingCheckInFlight||!homeSurfaceReady())return;
    onboardingCheckInFlight=true;
    try{
      const state=await req('/api/v1/vertical/onboarding');if(state.completed){onboardingCompleted=true;return;}if(!homeSurfaceReady())return;
      const modules=await api.modules();const root=content();if(!root||!root.querySelector('.home-grid'))return;
      const segments={GENERIC:'Comércio / operação padrão',FOOD:'Alimentação',WHOLESALE:'Atacado'};
      const moduleNames={FOOD:'Alimentação',WHOLESALE:'Atacado'};
      const moduleDescriptions={FOOD:'Inclui pedidos e produção/KDS; você usa os canais de atendimento que precisar',WHOLESALE:'Pedidos com cliente obrigatório e preço automático por quantidade'};
      root.innerHTML=`<section class="page vertical-page"><header class="page-head"><div><h1>Configuração inicial</h1><p>Escolha o tipo de operação para receber uma recomendação. O núcleo de Balcão, Caixa, Cardápio, Estoque, Clientes e Gestão já está disponível; as áreas abaixo podem ser alteradas depois em Configurações → Áreas.</p></div><span class="vertical-rule">Uma operação · um caixa · áreas opcionais</span></header><div class="data-card"><form id="onboarding-form" class="vertical-form">${field('businessName','Nome do estabelecimento')}<label class="field"><span>Tipo de operação</span><select name="segment">${Object.entries(segments).map(([value,label])=>`<option value="${value}">${label}</option>`).join('')}</select></label><div class="field wide"><strong>Áreas opcionais recomendadas</strong><small>A escolha do tipo de operação apenas marca uma sugestão. Você pode ajustar antes de concluir.</small></div><div id="onboarding-modules">${modules.map(module=>`<label class="vertical-toggle"><span><strong>${esc(moduleNames[module.id]||module.name)}</strong><small>${esc(moduleDescriptions[module.id]||module.description||'')}</small></span><input type="checkbox" name="moduleIds" value="${module.id}"></label>`).join('')}</div><button class="primary-button" type="submit">Salvar configuração e entrar</button></form></div></section>`;
      onboardingRendered=true;
      const form=document.getElementById('onboarding-form');async function recommend(){const segment=new FormData(form).get('segment');const result=await req(`/api/v1/vertical/onboarding/recommend?segment=${e(segment)}`);form.querySelectorAll('[name="moduleIds"]').forEach(input=>input.checked=result.moduleIds.includes(input.value));}form.querySelector('[name="segment"]').addEventListener('change',()=>recommend().catch(error=>notify(error.message,true)));form.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(form);try{await req('/api/v1/vertical/onboarding/complete',{method:'POST',body:{businessName:data.get('businessName'),segment:data.get('segment'),moduleIds:data.getAll('moduleIds')}});onboardingCompleted=true;onboardingRendered=false;notify('Configuração inicial concluída.');document.querySelector('[data-route="home"]')?.click();}catch(error){notify(error.message,true);}});await recommend();
    }catch{/* app pode ainda estar inicializando */}finally{onboardingCheckInFlight=false;}
  }
  const syncOnboarding=()=>{if(homeSurfaceReady())void maybeOnboarding();};
  lifecycle?.on?.('route:mounted',syncOnboarding);
  lifecycle?.on?.('route:updated',syncOnboarding);
  document.addEventListener('DOMContentLoaded',syncOnboarding,{once:true});
  setTimeout(()=>void maybeOnboarding(),900);
})();
