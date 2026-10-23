'use strict';
(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;const lifecycle=window.PdvUiLifecycle;if(!ApiClient||!lifecycle)return;
  const api=new ApiClient();
  const ROUTES=new Set(['home','checkout','products','customers','inventory','finance','reports','management','sellers','cash','sales','returns','settings']);
  let lastRoute='';let queued=false;
  const ALLOWED_MODULES=new Set(['auth','sales','returns','cash','products','customers','inventory','finance','reports','restaurant','printing','settings','network','other']);
  let consentCache=null,consentTenant='',consentLoading=null,requestCount=0;
  const hosted=()=>api.webMode===true;
  function sessionReady(){return hosted()?Boolean(api.tenantId&&api.branchId):Boolean(window.sessionStorage?.getItem('artisys.sessionToken'));}
  function telemetryPath(suffix){return '/api/v1/tenants/'+encodeURIComponent(api.tenantId)+'/telemetry/'+suffix;}
  async function getConsent(force=false){
    if(!hosted())return null;
    if(!sessionReady())return null;
    if(consentTenant!==api.tenantId){consentTenant=api.tenantId;consentCache=null;consentLoading=null;}
    if(!force&&consentCache)return consentCache;
    if(consentLoading&&!force)return consentLoading;
    consentLoading=api.request(telemetryPath('preferences')).then(p=>consentCache=p).catch(()=>null).finally(()=>{consentLoading=null;});
    return consentLoading;
  }
  async function send(eventName,payload={}){
    if(!sessionReady())return;
    try{
      if(!hosted()){await api.request('/api/v1/system/telemetry/events',{method:'POST',body:{eventName,payload}});return;}
      const consent=await getConsent();if(!consent?.enabled)return;
      if(eventName==='ui_error'&&!consent.diagnostics)return;
      const dimensions=payload.dimensions||{},measurements=payload.measurements||{};
      const route=dimensions.route||currentRoute();
      if(!ROUTES.has(route)||typeof window.crypto?.randomUUID!=='function')return;
      const module=String(dimensions.module||'');
      if(module&&!ALLOWED_MODULES.has(module))return;
      const body={id:window.crypto.randomUUID(),eventName,branchId:api.branchId,route,
        module,outcome:dimensions.outcome||'',durationMs:Math.max(0,Math.min(1200000,Math.round(measurements.duration_ms||0)))};
      await api.request(telemetryPath('events'),{method:'POST',body});
    }catch{/* events never block checkout or trigger a UI error */}
  }
  function observeRequest({operation='',status=0,durationMs=0}={}){
    if(!hosted()||!sessionReady())return;
    const raw=String(operation).split('/')[0],module=ALLOWED_MODULES.has(raw)?raw:'other';
    const count=++requestCount,slow=durationMs>=1200,failed=status===0||status>=500;
    if(!failed&&!slow&&count%10!==0)return;
    void send('request_finished',{dimensions:{module,outcome:failed?'failed':slow?'slow':'success'},measurements:{duration_ms:durationMs}});
  }
  async function injectHostedSettings(card){
    try{
      const [prefs,session]=await Promise.all([getConsent(true),api.currentSession()]);
      if(!card.isConnected)return;
      if(!prefs)throw Error('Não foi possível consultar a privacidade.');
      const role=session?.memberships?.find(m=>m.tenantId===api.tenantId)?.profileKey||'';
      const canEdit=['OWNER','ADMINISTRATOR','MANAGER'].includes(role);
      card.innerHTML=`<h2>Privacidade e diagnóstico</h2><p>Métricas opcionais da ArtiSys. Desativadas por padrão, sem impedir a operação do PDV.</p>
        <form id="telemetry-hosted-form" class="ops-form">
        <label class="printing-check"><input name="enabled" type="checkbox" ${prefs.enabled?'checked':''}> Autorizar métricas técnicas e de uso</label>
        <label class="printing-check"><input name="diagnostics" type="checkbox" ${prefs.diagnostics?'checked':''}> Autorizar diagnóstico de erros sem dados pessoais</label>
        <p class="ops-muted">Não enviamos nomes, e-mails, CPF/CNPJ, cartões, textos digitados, conteúdos de pedidos ou tokens. Pode desativar a qualquer momento.</p>
        <div class="ops-actions"><button type="submit" class="ops-primary">Salvar privacidade</button><span id="telemetry-hosted-status" class="ops-muted" role="status"></span></div></form>`;
      const form=card.querySelector('form'),message=card.querySelector('#telemetry-hosted-status');
      if(!canEdit){form.querySelectorAll('input,button').forEach(x=>x.disabled=true);message.textContent='Somente proprietário ou gestor autorizado pode alterar.';return;}
      form.addEventListener('submit',async event=>{
        event.preventDefault();const button=form.querySelector('button');button.disabled=true;
        try{
          const enabled=form.elements.namedItem('enabled').checked;
          const diagnostics=enabled&&form.elements.namedItem('diagnostics').checked;
          consentCache=await api.request(telemetryPath('preferences'),{method:'PUT',body:{enabled,diagnostics}});
          message.textContent='Preferências salvas.';
        }catch{message.textContent='Falha ao salvar preferências.';}finally{button.disabled=false;}
      });
    }catch{card.innerHTML='<h2>Privacidade e diagnóstico</h2><p>Não foi possível consultar suas preferências.</p>';}
  }
  function currentRoute(){const route=String(document.body?.dataset?.activeRoute||'');return ROUTES.has(route)?route:'';}
  function observeRoute(routeValue=''){const route=ROUTES.has(String(routeValue||''))?String(routeValue):currentRoute();if(!route||route===lastRoute)return;lastRoute=route;void send('screen_opened',{dimensions:{route}});if(route==='returns')void send('return_started',{dimensions:{module:'returns'}});}
  function setting(rows,key,defaultValue=null){const row=(rows||[]).find(item=>item.key===key);return row?row.value:defaultValue;}
  function boolSetting(rows,key){return Boolean(setting(rows,key,false));}
  async function injectSettings(){queued=false;if(currentRoute()!=='settings')return;const content=document.getElementById('route-content');const host=content?.querySelector('.ops-page');if(!host||host.querySelector('#telemetry-settings-card'))return;const card=document.createElement('section');card.id='telemetry-settings-card';card.className='ops-card';card.dataset.settingsCategory='privacy';card.innerHTML='<h2>Privacidade e diagnóstico</h2><div class="ops-loader">Carregando preferências…</div>';host.appendChild(card);
  if(hosted()){await injectHostedSettings(card);return;}
    try{const [rows,session]=await Promise.all([api.settings({scope:'global',prefix:'telemetry.'}),api.currentSession()]);if(!card.isConnected)return;const accepted=Number(setting(rows,'telemetry.consent_version',0)||0)>=1&&Boolean(setting(rows,'telemetry.consent_accepted_at',''));const canManage=['admin','manager'].includes(String(session?.user?.role||''));const canEdit=canManage&&accepted;const enabled=accepted&&boolSetting(rows,'telemetry.enabled');const diagnostics=accepted&&boolSetting(rows,'telemetry.diagnostics');const consentMessage=accepted?'Autorização registrada na atualização. Você pode desligar ou religar estes envios a qualquer momento.':'Nenhum envio está autorizado. A autorização inicial é apresentada na conclusão da atualização, não nesta tela.';card.innerHTML=`<div class="ops-card-head"><div><h2>Privacidade e diagnóstico</h2><p>Ajude a ArtiSys a mapear fluxos e falhas técnicas. A coleta é opcional e o PDV continua funcionando sem internet ou Cloudflare.</p></div><span class="ops-badge ${enabled?'status-ok':''}">${enabled?'ATIVA':'DESATIVADA'}</span></div><form id="telemetry-settings-form" class="ops-form"><label class="printing-check"><input name="enabled" type="checkbox" ${enabled?'checked':''}> Enviar métricas anônimas de uso e fluxo</label><label class="printing-check"><input name="diagnostics" type="checkbox" ${diagnostics?'checked':''}> Enviar fingerprints e categorias técnicas de falhas</label><p class="ops-muted">${consentMessage}</p><p class="ops-muted">Nunca são enviados nome, CPF/CNPJ, e-mail, telefone, endereço, senha, token, XML/DANFE, dados de cartão, observações, conteúdo de recibos ou texto digitado.</p><div class="ops-actions"><button type="submit" class="ops-primary">Salvar privacidade</button><span id="telemetry-settings-status" class="ops-muted" aria-live="polite"></span></div></form>${canManage?'':'<p class="ops-muted">Somente gerente ou administrador pode alterar estas opções.</p>'}`;const form=card.querySelector('#telemetry-settings-form');if(!canEdit){form.querySelectorAll('input,button').forEach(node=>{node.disabled=true;});return;}form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button');const status=card.querySelector('#telemetry-settings-status');button.disabled=true;status.textContent='Salvando…';try{const nextEnabled=Boolean(form.elements.namedItem('enabled')?.checked);const nextDiagnostics=Boolean(form.elements.namedItem('diagnostics')?.checked);await api.saveSetting('telemetry.enabled',nextEnabled);await api.saveSetting('telemetry.diagnostics',nextDiagnostics);status.textContent='Preferências salvas.';const badge=card.querySelector('.ops-badge');badge.textContent=nextEnabled?'ATIVA':'DESATIVADA';badge.classList.toggle('status-ok',nextEnabled);}catch(error){status.textContent=error?.message||'Falha ao salvar preferências.';}finally{button.disabled=false;}});
    }catch(error){card.innerHTML=`<h2>Privacidade e diagnóstico</h2><p class="ops-error">${String(error?.message||'Não foi possível carregar as preferências.')}</p>`;}
    window.PdvRouteRegistry?.updated('settings',{surface:'settings-extension',extension:'telemetry'});
  }
  function queueSettings(){if(queued)return;queued=true;setTimeout(()=>{void injectSettings();},0);}
  const onRouteChange=({route})=>{observeRoute(route);if(route==='settings')queueSettings();};
  lifecycle.on('route:mounted',onRouteChange);
  lifecycle.on('route:updated',onRouteChange);
  const initialRoute=currentRoute();if(initialRoute)onRouteChange({route:initialRoute});
  window.PdvTelemetryUi=Object.freeze({send,observeRoute,observeRequest,injectSettings});
})();
