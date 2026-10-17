'use strict';

(()=>{
  function hardware(){ return window.artisysDesktop?.hardware; }

  function cleanMessage(message){
    return String(message||'').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');
  }

  function setStatus(id,message,error=false){
    const node=document.getElementById(id);
    if(!node)return;
    node.textContent=cleanMessage(message);
    node.classList.toggle('hardware-scale-status',true);
    node.classList.toggle('is-error',Boolean(error));
  }

  function setRequestVisibility(){
    const profile=document.getElementById('scale-profile');
    const row=document.getElementById('scale-request-row');
    if(row)row.hidden=profile?.value!=='urano-pop-s';
  }

  function fillPortSelect(select,selected,ports){
    if(!select)return;
    select.replaceChildren();
    const none=document.createElement('option');none.value='';none.textContent='Desativado / selecione uma porta';select.appendChild(none);
    for(const item of Array.isArray(ports)?ports:[]){
      if(!item?.path)continue;
      const option=document.createElement('option');
      option.value=String(item.path);
      option.textContent=item.manufacturer?`${item.path} — ${item.manufacturer}`:String(item.path);
      select.appendChild(option);
    }
    if(selected&&![...select.options].some(option=>option.value===selected)){
      const option=document.createElement('option');option.value=selected;option.textContent=`${selected} — configurada (não detectada agora)`;select.appendChild(option);
    }
    select.value=selected;
  }

  async function loadConfiguration(){
    const api=hardware();
    if(!api)return;
    const diagnostics=await api.diagnostics();
    const ports=Array.isArray(diagnostics?.serialPorts)?diagnostics.serialPorts:[];

    const scale=diagnostics?.configuration?.scale||{};
    const scaleProfile=document.getElementById('scale-profile');
    const scalePort=document.getElementById('scale-port');
    const scaleRequest=document.getElementById('scale-request');
    if(scaleProfile&&scalePort&&scaleRequest){
      scaleProfile.value=scale.profile==='urano-pop-s'?'urano-pop-s':'generic';
      fillPortSelect(scalePort,String(scale.port||''),ports);
      scaleRequest.value=scale.requestCommand==='0x05'?'0x05':'0x04';
      setRequestVisibility();
      const summary=scaleProfile.value==='urano-pop-s'
        ? `Urano US 31/2 POP-S · ${scale.port||'sem porta'} · 9600 / 8N2`
        : `${scale.port?'Balança genérica em '+scale.port:'Balança não configurada'}`;
      setStatus('scale-config-status',summary);
    }

    const drawer=diagnostics?.configuration?.drawer||{};
    const drawerPort=document.getElementById('drawer-port');
    const drawerBaud=document.getElementById('drawer-baud');
    if(drawerPort&&drawerBaud){
      fillPortSelect(drawerPort,String(drawer.port||''),ports);
      drawerBaud.value=String(Number(drawer.baud||9600));
      setStatus('drawer-config-status',drawer.configured?`Gaveta configurada em ${drawer.port} · ${drawer.baud||9600} bps`:'Gaveta não configurada.');
    }
    return diagnostics;
  }

  async function refreshDiagnostics(){
    const diagnostics=await loadConfiguration();
    const output=document.getElementById('hw-output');
    if(output)output.textContent=JSON.stringify(diagnostics,null,2);
    const scaleButton=document.getElementById('hw-scale');
    if(scaleButton)scaleButton.disabled=!diagnostics?.status?.scale?.available;
    const drawerButton=document.getElementById('hw-drawer');
    if(drawerButton)drawerButton.disabled=!diagnostics?.status?.cashDrawer?.available;
    return diagnostics;
  }

  async function saveScaleConfiguration(testAfter=false){
    const api=hardware();
    if(!api?.configureScale)throw new Error('Configuração de balança indisponível nesta versão.');
    const profile=document.getElementById('scale-profile')?.value||'generic';
    const port=document.getElementById('scale-port')?.value||'';
    const requestCommand=document.getElementById('scale-request')?.value||'0x04';
    setStatus('scale-config-status','Salvando configuração...');
    const configuration=await api.configureScale({profile,port,requestCommand});
    if(testAfter&&configuration.configured){
      const reading=await api.testScale();
      setStatus('scale-config-status',`Configuração salva. Leitura: ${Number(reading.weight).toLocaleString('pt-BR',{minimumFractionDigits:3,maximumFractionDigits:3})} ${reading.unit||'kg'}`);
    }else setStatus('scale-config-status',configuration.configured?'Configuração salva e aplicada.':'Balança desativada.');
    await refreshDiagnostics();
  }

  async function saveDrawerConfiguration(testAfter=false){
    const api=hardware();
    if(!api?.configureDrawer)throw new Error('Configuração de gaveta indisponível nesta versão.');
    const port=document.getElementById('drawer-port')?.value||'';
    const baud=Number(document.getElementById('drawer-baud')?.value||9600);
    setStatus('drawer-config-status','Salvando configuração...');
    const configuration=await api.configureDrawer({port,baud});
    if(testAfter&&configuration.configured){
      await api.testDrawer();
      setStatus('drawer-config-status','Configuração salva. A gaveta recebeu o teste de abertura.');
    }else setStatus('drawer-config-status',configuration.configured?'Configuração salva e aplicada.':'Gaveta desativada.');
    await refreshDiagnostics();
  }

  function enhance(){
    const output=document.getElementById('hw-output');
    if(!output||document.getElementById('scale-config-card'))return;
    const existing=output.closest('.data-card');
    if(!existing?.parentNode)return;

    const scaleCard=document.createElement('div');
    scaleCard.className='data-card';
    scaleCard.id='scale-config-card';
    scaleCard.innerHTML=`
      <h2>Balança</h2>
      <p>Selecione o perfil e a porta detectada. O perfil Urano aplica automaticamente 9600 / 8N2 e o protocolo POP-S.</p>
      <div class="vertical-form">
        <label class="field"><span>Modelo / protocolo</span><select id="scale-profile"><option value="generic">Genérica</option><option value="urano-pop-s">Urano US 31/2 POP-S</option></select></label>
        <label class="field"><span>Porta serial</span><select id="scale-port"><option value="">Carregando portas...</option></select></label>
        <label class="field" id="scale-request-row"><span>Comando de leitura Urano</span><select id="scale-request"><option value="0x04">0x04 (padrão)</option><option value="0x05">0x05</option></select></label>
        <div class="vertical-actions"><button type="button" id="scale-refresh-ports" class="secondary-button">Detectar portas</button><button type="button" id="scale-save" class="primary-button">Salvar configuração</button><button type="button" id="scale-save-test">Salvar e testar</button></div>
        <p id="scale-config-status" class="vertical-rule" aria-live="polite"></p>
      </div>`;

    const drawerCard=document.createElement('div');
    drawerCard.className='data-card';
    drawerCard.id='drawer-config-card';
    drawerCard.innerHTML=`
      <h2>Gaveta</h2>
      <p>Para gavetas seriais compatíveis com pulso ESC/POS, selecione a porta detectada e a velocidade informada pelo equipamento.</p>
      <div class="vertical-form">
        <label class="field"><span>Porta serial</span><select id="drawer-port"><option value="">Carregando portas...</option></select></label>
        <label class="field"><span>Velocidade (bps)</span><input id="drawer-baud" type="number" min="1" step="1" value="9600" inputmode="numeric"></label>
        <div class="vertical-actions"><button type="button" id="drawer-refresh-ports" class="secondary-button">Detectar portas</button><button type="button" id="drawer-save" class="primary-button">Salvar configuração</button><button type="button" id="drawer-save-test">Salvar e testar</button></div>
        <p id="drawer-config-status" class="vertical-rule" aria-live="polite"></p>
      </div>`;

    existing.parentNode.insertBefore(scaleCard,existing);
    existing.parentNode.insertBefore(drawerCard,existing);
    document.getElementById('scale-profile')?.addEventListener('change',setRequestVisibility);
    document.getElementById('scale-refresh-ports')?.addEventListener('click',()=>refreshDiagnostics().catch(error=>setStatus('scale-config-status',error.message,true)));
    document.getElementById('drawer-refresh-ports')?.addEventListener('click',()=>refreshDiagnostics().catch(error=>setStatus('drawer-config-status',error.message,true)));
    document.getElementById('scale-save')?.addEventListener('click',()=>saveScaleConfiguration(false).catch(error=>setStatus('scale-config-status',error.message,true)));
    document.getElementById('scale-save-test')?.addEventListener('click',()=>saveScaleConfiguration(true).catch(error=>setStatus('scale-config-status',error.message,true)));
    document.getElementById('drawer-save')?.addEventListener('click',()=>saveDrawerConfiguration(false).catch(error=>setStatus('drawer-config-status',error.message,true)));
    document.getElementById('drawer-save-test')?.addEventListener('click',()=>saveDrawerConfiguration(true).catch(error=>setStatus('drawer-config-status',error.message,true)));
    refreshDiagnostics().catch(error=>{setStatus('scale-config-status',error.message,true);setStatus('drawer-config-status',error.message,true);});
  }

  document.addEventListener('click',event=>{
    if(event.target?.closest?.('#e54-hardware-card'))queueMicrotask(enhance);
  });
  enhance();
})();
