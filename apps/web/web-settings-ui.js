'use strict';

// Hosted settings use the same company, branch and authorizations as commerce.
// Local device preferences remain in the existing peripheral adapter.
(function(root){
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const part=value=>encodeURIComponent(String(value||''));
  const can=capability=>root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,capability)===true;
  const roles={OWNER:'Proprietário',ADMINISTRATOR:'Administrador',MANAGER:'Gerente',SUPERVISOR:'Supervisor',CASHIER:'Operador de caixa',OPERATOR:'Operador',WAITER:'Garçom',KITCHEN:'Cozinha',STOCKKEEPER:'Estoque',PURCHASING:'Compras',FINANCE:'Financeiro',DELIVERY:'Entrega',READ_ONLY:'Somente leitura'};
  const notify=(message,bad=false)=>root.PdvToast?.show?.(message,bad?'error':'success');
  const navigation=(options,route)=>(options?.navigate||root.PdvAppNavigation?.navigate)?.(route);
  const active=(host,route)=>host.isConnected!==false&&root.document.body.dataset.activeRoute===route;
  const base=api=>{
    if(!api?.webMode||!api.tenantId||!api.branchId)throw Error('Selecione o estabelecimento e a filial.');
    return '/api/v1/tenants/'+part(api.tenantId);
  };
  const resultError=value=>value.status==='rejected'?String(value.reason?.message||'Não foi possível carregar.'):'';
  const errorMarkup=error=>error?'<p role="alert">'+esc(error)+'</p>':'';
  function routeButtons(host,options){
    host.querySelectorAll('[data-settings-route]').forEach(button=>button.addEventListener('click',()=>void navigation(options,button.dataset.settingsRoute)));
  }
  let renderGeneration=0;
  async function render(host,api,options={}){
    const generation=++renderGeneration;
    const path=base(api);
    host.innerHTML='<section class="page"><h1>Configurações</h1><p role="status">Carregando configurações da empresa…</p></section>';
    const [contextResult,branchesResult,brandingResult,modulesResult]=await Promise.allSettled([
      api.request(path+'/context'),api.request(path+'/branches'),
      can('settings.view')?api.request('/api/v1/printing/branding?branchId='+part(api.branchId)):Promise.resolve(null),
      can('settings.view')?api.modules():Promise.resolve([])
    ]);
    if(generation!==renderGeneration||!active(host,'settings'))return;
    const context=contextResult.value||{},branches=branchesResult.value?.branches||[];
    const branch=branches.find(item=>item.id===api.branchId);
    const branding=brandingResult.value?.branding;
    const modules=modulesResult.value||[];
    const disabled=can('settings.manage')?'':' disabled';
    const tabs=[['company','Empresa e comprovantes'],['team','Equipe e filiais'],['devices','Impressão e periféricos'],['offline','Funcionamento offline'],['modules','Áreas'],['security','Sua conta e segurança']];
    host.innerHTML='<section class="page web-settings"><header class="page-head"><div><h1>Configurações</h1><p>Empresa, atendimento, impressão e preferências de operação.</p></div><button class="secondary-button" type="button" data-settings-refresh>Atualizar</button></header>'+
      '<nav class="restaurant-view-switch" role="tablist" aria-label="Áreas de configuração">'+tabs.map(([id,label],index)=>'<button class="restaurant-btn '+(index?'secondary':'')+'" type="button" role="tab" id="web-settings-tab-'+id+'" aria-controls="web-settings-panel-'+id+'" aria-selected="'+!index+'" tabindex="'+(index?-1:0)+'" data-settings-tab="'+id+'">'+label+'</button>').join('')+'</nav>'+
      '<section class="data-card" role="tabpanel" id="web-settings-panel-company" aria-labelledby="web-settings-tab-company">'+
      '<h2>Empresa e filial</h2>'+errorMarkup(resultError(contextResult)||resultError(branchesResult))+
      '<p><strong>'+esc(context.name||'Estabelecimento')+'</strong> · '+esc(branch?.name||'Filial selecionada')+'</p>'+
      (can('settings.manage')?'<p><button class="secondary-button" type="button" data-settings-profile>Perfil da loja</button></p>':'')+
      '<h3>Identificação nos comprovantes</h3><p>Nome, endereço, telefone e logotipo impressos nos comprovantes desta filial. Alterações valem para novas vendas; comprovantes anteriores preservam a identificação original.</p>'+
      errorMarkup(resultError(brandingResult))+
      (branding?'<form class="field-grid" data-settings-branding><label class="field"><span>Nome no comprovante</span><input name="name" maxlength="80" required value="'+esc(branding.name)+'"'+disabled+'></label>'+
        '<label class="field"><span>Endereço</span><input name="address" maxlength="160" value="'+esc(branding.address)+'"'+disabled+'></label>'+
        '<label class="field"><span>Telefone</span><input name="phone" maxlength="60" value="'+esc(branding.phone)+'"'+disabled+'></label>'+
        '<label class="field"><span>Logotipo PNG (até 512 KB)</span><input name="logo" type="file" accept="image/png"'+disabled+'></label>'+
        '<label><input name="removeLogo" type="checkbox"'+disabled+'> Remover logotipo atual</label><div><button class="primary-button" type="submit"'+disabled+'>Salvar identificação</button></div><p data-settings-feedback role="status" aria-live="polite"></p></form>':'<p>A identificação não está disponível para seu perfil ou não pôde ser carregada.</p>')+'</section>'+
      '<section class="data-card" role="tabpanel" id="web-settings-panel-team" aria-labelledby="web-settings-tab-team" hidden><h2>Equipe e filiais</h2>'+
      '<p>Equipe e permissões são compartilhadas pelo estabelecimento. Cada operação mantém sua filial identificada.</p>'+
      '<ul>'+branches.map(item=>'<li>'+esc(item.name)+' · '+esc(item.code)+'</li>').join('')+'</ul>'+errorMarkup(resultError(branchesResult))+
      '<button type="button" class="primary-button" data-settings-route="access">Abrir Acessos e equipe</button>'+
      (context.profileKey==='OWNER'?'<button type="button" class="secondary-button" data-settings-route="saas-admin">Administrar empresa e filiais</button>':'')+'</section>'+
      '<section class="data-card" role="tabpanel" id="web-settings-panel-devices" aria-labelledby="web-settings-tab-devices" hidden><h2>Impressão e periféricos</h2>'+
      '<p>Configure papel, impressora, leitor, balança e gaveta para este navegador. A conexão com um equipamento só é solicitada quando você escolher conectá-lo.</p>'+
      '<button type="button" class="primary-button" data-settings-devices>Configurar dispositivos</button></section>'+
      '<section class="data-card" role="tabpanel" id="web-settings-panel-offline" aria-labelledby="web-settings-tab-offline" hidden><h2>Funcionamento offline</h2>'+
      '<p>Seu PDV continuará na Cloudflare. A opção de contingência usará um PC autorizado como servidor local para os aparelhos no Wi-Fi quando a internet externa cair.</p>'+
      '<p role="status"><strong>Etapa disponível: cópia inicial controlada de usuários, perfis e catálogo para consulta.</strong> A autorização depende da configuração no servidor Cloudflare. Sincronização de vendas, caixa e estoque ainda não disponível; nenhuma venda offline pode ser considerada sincronizada.</p>'+
      '<p>O QR Code de garçom é gerado pelo PC local quando o servidor HTTPS e a conta do funcionário estiverem configurados.</p>'+
      (context.profileKey==='OWNER'?'<form data-settings-offline-gateway class="field-grid"><h3>Autorizar PC para cópia inicial (sem vendas)</h3>'+
      '<label>Filial<select name="branchId" required>'+branches.map(b=>'<option value="'+esc(b.id)+'">'+esc(b.name)+'</option>').join('')+'</select></label>'+
      '<label>Identificação do PC<input name="label" maxlength="80" required placeholder="PC principal da loja"></label>'+
      '<button class="secondary-button" type="submit">Gerar autorização da cópia inicial</button>'+
      '<p data-settings-offline-feedback role="status" class="ops-muted">O segredo aparecerá apenas uma vez. Guarde-o somente no PC da loja.</p><button type="button" class="secondary-button" data-settings-offline-activate hidden>Reservar filial para funcionamento offline</button></form>':'<p>Somente o proprietário autoriza PCs para cópia local.</p>')+'</section>'+ 
      '<section class="data-card" role="tabpanel" id="web-settings-panel-modules" aria-labelledby="web-settings-tab-modules" hidden><h2>Áreas da operação</h2>'+
      '<p>Balcão, Caixa, Cardápio, Estoque, Clientes e Gestão usam a mesma base. Alimentação acrescenta mesas, comandas, pedidos e cozinha. Personalizações, fichas técnicas e unidade de venda pertencem ao produto. Ative as áreas que utilizar; esta escolha não cria outra empresa nem uma cobrança.</p>'+errorMarkup(resultError(modulesResult))+
      modules.map(item=>'<article class="module-family"><h3>'+esc(item.name)+'</h3><p>'+esc(item.description)+'</p><label><input type="checkbox" data-settings-module="'+esc(item.id)+'" '+(item.enabled?'checked ':'')+(!can('modules.manage')?'disabled':'')+'> Área ativa</label></article>').join('')+
      '<p data-module-feedback role="status" aria-live="polite"></p></section>'+
      '<section class="data-card" role="tabpanel" id="web-settings-panel-security" aria-labelledby="web-settings-tab-security" hidden><h2>Sua conta e segurança</h2>'+
      '<p>Consulte suas sessões e encerre o acesso de outros navegadores em Acessos. Senha e autenticação em duas etapas são gerenciadas na sua conta.</p>'+
      '<button class="secondary-button" type="button" data-settings-route="access">Ver sessões</button> <a class="secondary-button" href="/conta/">Abrir segurança da conta</a></section></section>';
    host.querySelector('[data-settings-offline-gateway]')?.addEventListener('submit',async event=>{
      event.preventDefault();
      const form=event.currentTarget,feedback=form.querySelector('[data-settings-offline-feedback]');
      const submit=form.querySelector('[type="submit"]');
      submit.disabled=true;
      try{
        if(context.profileKey!=='OWNER')throw Error('Somente o proprietário autoriza o PC.');
        const values=Object.fromEntries(new FormData(form));
        const result=await api.request(path+'/offline/gateways',{method:'POST',body:values});
        form.dataset.gatewayId=result.gateway.id;
        const activate=form.querySelector('[data-settings-offline-activate]');if(activate)activate.hidden=false;
        feedback.textContent='ID do gateway: '+result.gateway.id+' | Credencial (exibida uma única vez): '+result.credential+
          '. Salve em segredo no servidor HTTPS local. Nenhuma venda offline está habilitada.';
      }catch(error){feedback.textContent='Não foi possível autorizar cópia: '+error.message;}
      finally{submit.disabled=false;}
    });
    host.querySelector('[data-settings-offline-activate]')?.addEventListener('click',async event=>{
      const form=event.currentTarget.closest('form'),id=form?.dataset.gatewayId;
      if(!id||context.profileKey!=='OWNER')return;
      if(!root.confirm('Reservar esta filial para operar somente pelo PC local? A Cloudflare bloqueará novas vendas nesta filial até a reconciliação ser concluída no PC.'))return;
      const button=event.currentTarget;button.disabled=true;
      const feedback=form.querySelector('[data-settings-offline-feedback]');
      try{
        const result=await api.request(path+'/offline/gateways/'+encodeURIComponent(id)+'/activate',{method:'POST',body:{}});
        feedback.textContent='Filial reservada para o PC (época '+result.epoch+'). Faça nova cópia no servidor local antes de usar. Depois, retorne ao online pelo próprio PC.';
      }catch(error){feedback.textContent='Não foi possível reservar a filial: '+error.message;button.disabled=false;}
    });
    routeButtons(host,options);
    host.querySelector('[data-settings-profile]')?.addEventListener('click',()=>void root.PdvR4AdvancedUi?.show?.({section:'segments'}));
    host.querySelector('[data-settings-refresh]')?.addEventListener('click',()=>void render(host,api,options));
    const tabButtons=Array.from(host.querySelectorAll('[data-settings-tab]'));
    function selectTab(button){
      for(const item of tabButtons){const selected=item===button;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;item.classList.toggle('secondary',!selected);}
      for(const [id] of tabs)host.querySelector('#web-settings-panel-'+id).hidden=id!==button.dataset.settingsTab;
    }
    for(const button of tabButtons){
      button.addEventListener('click',()=>selectTab(button));
      button.addEventListener('keydown',event=>{
        const position=tabButtons.indexOf(button);
        const index=event.key==='Home'?0:event.key==='End'?tabButtons.length-1:event.key==='ArrowRight'?(position+1)%tabButtons.length:event.key==='ArrowLeft'?(position+tabButtons.length-1)%tabButtons.length:null;
        if(index===null)return;event.preventDefault();selectTab(tabButtons[index]);tabButtons[index].focus();
      });
    }
    host.querySelector('[data-settings-devices]')?.addEventListener('click',()=>{
      try{if(!root.PdvWebHardware?.showSettings)throw Error('Configuração de dispositivos indisponível.');root.PdvWebHardware.showSettings();}
      catch(error){notify(error.message,true);}
    });
    host.querySelector('[data-settings-branding]')?.addEventListener('submit',async event=>{
      event.preventDefault();if(!can('settings.manage'))return;
      const form=event.currentTarget,submit=form.querySelector('[type="submit"]'),feedback=form.querySelector('[data-settings-feedback]');
      submit.disabled=true;
      try{
        const field=name=>form.elements.namedItem(name);
        let logoDataUrl=field('removeLogo').checked?null:branding.logoDataUrl;
        const file=field('logo').files?.[0];
        if(file){
          if(file.type!=='image/png'||file.size>512*1024)throw Error('Escolha um PNG de até 512 KB.');
          logoDataUrl=await new Promise((resolve,reject)=>{const reader=new root.FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Não foi possível ler o logotipo.'));reader.readAsDataURL(file);});
          if(!root.PdvReceiptBranding?.normalize({logoDataUrl}).logoDataUrl)throw Error('Logotipo PNG inválido.');
        }
        const saved=await api.request('/api/v1/printing/branding',{method:'PUT',body:{branchId:api.branchId,name:field('name').value,address:field('address').value,phone:field('phone').value,logoDataUrl}});
        Object.assign(branding,saved.branding);feedback.textContent='Identificação salva para esta filial.';notify(feedback.textContent);
      }catch(error){feedback.textContent=error.message;notify(error.message,true);}finally{submit.disabled=false;}
    });
    host.querySelectorAll('[data-settings-module]').forEach(input=>input.addEventListener('change',async()=>{
      const enabled=input.checked,id=input.dataset.settingsModule;input.disabled=true;
      const feedback=host.querySelector('[data-module-feedback]');
      try{
        if(!can('modules.manage'))throw Error('Seu perfil não permite alterar áreas.');
        const saved=await api.saveSetting('modules.'+id+'.enabled',enabled,'global');
        const confirmed=typeof saved?.module?.enabled==='boolean'?saved.module.enabled:enabled;
        input.checked=confirmed;
        root.PdvModuleGate?.setEnabled?.(id,confirmed);
        feedback.textContent='Área atualizada. Os dados e históricos foram preservados.';
        notify(feedback.textContent);
      }catch(error){input.checked=!enabled;feedback.textContent=error.message;notify(error.message,true);}finally{input.disabled=!can('modules.manage');}
    }));
    root.PdvRouteRegistry?.updated?.('settings',{surface:'web-settings'});
  }

  async function renderAccess(host,{api,user,navigate,toast}={}){
    const generation=++renderGeneration;
    const path=base(api);
    host.innerHTML='<section class="page"><h1>Acessos e equipe</h1><p role="status">Carregando acessos…</p></section>';
    const [membersResult,sessionsResult]=await Promise.allSettled([
      can('users.view')?api.request(path+'/members'):Promise.resolve({members:[]}),
      api.request('/api/v1/auth/sessions')
    ]);
    if(generation!==renderGeneration||!active(host,'access'))return;
    const members=membersResult.value?.members||[],sessions=sessionsResult.value?.sessions||[];
    const date=value=>{const d=new Date(value);return Number.isFinite(d.valueOf())?d.toLocaleString('pt-BR'):'—';};
    host.innerHTML='<section class="page"><header class="page-head"><div><h1>Acessos e equipe</h1><p>Equipe do estabelecimento e sessões da sua conta.</p></div><button type="button" class="secondary-button" data-access-refresh>Atualizar</button></header>'+
      (can('users.view')?'<section class="data-card"><h2>Equipe e perfis</h2>'+errorMarkup(resultError(membersResult))+'<ul class="saas-list">'+members.map(member=>'<li><strong>'+esc(member.displayName)+'</strong><span>'+esc(roles[member.profileKey]||member.profileKey)+'</span></li>').join('')+'</ul>'+
        (user?.profileKey==='OWNER'?'<p>Convide funcionários, atribua perfis ou revogue acessos na administração da empresa.</p><button class="primary-button" type="button" data-settings-route="saas-admin">Gerenciar equipe e convites</button>':'<p>O proprietário gerencia convites e alterações de perfil na administração da empresa.</p>')+'</section>':'')+
      '<section class="data-card"><h2>Suas sessões</h2><p>Esta lista contém os acessos da sua própria conta, inclusive em outros navegadores.</p>'+errorMarkup(resultError(sessionsResult))+
      '<ul class="saas-list">'+sessions.map(session=>'<li><div><strong>'+(session.current?'Este navegador':'Outro navegador')+'</strong><small>Iniciada em '+esc(date(session.createdAt))+'</small></div><button type="button" data-access-revoke="'+esc(session.id)+'" data-current="'+(session.current?'true':'false')+'">'+(session.current?'Sair deste navegador':'Encerrar sessão')+'</button></li>').join('')+'</ul>'+
      '<p data-access-feedback role="status" aria-live="polite"></p><a href="/conta/">Senha e autenticação em duas etapas</a></section></section>';
    routeButtons(host,{navigate});
    host.querySelector('[data-access-refresh]')?.addEventListener('click',()=>void renderAccess(host,{api,user,navigate,toast}));
    host.querySelectorAll('[data-access-revoke]').forEach(button=>button.addEventListener('click',async()=>{
      button.disabled=true;
      try{
        await api.request('/api/v1/auth/sessions/'+part(button.dataset.accessRevoke),{method:'DELETE'});
        if(button.dataset.current==='true'){root.location.assign('/app/');return;}
        toast?.('Sessão encerrada.','success');await renderAccess(host,{api,user,navigate,toast});
      }catch(error){host.querySelector('[data-access-feedback]').textContent=error.message;button.disabled=false;}
    }));
    root.PdvRouteRegistry?.updated?.('access',{surface:'web-access'});
  }
  root.PdvWebSettings=Object.freeze({render,renderAccess});
})(window);
