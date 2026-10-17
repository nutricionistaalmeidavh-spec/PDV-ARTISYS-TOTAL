'use strict';

(() => {
  const content=document.getElementById('route-content');
  const lifecycle=window.PdvUiLifecycle;
  const ApiClient=window.PdvApiClient?.ApiClient;
  if(!content||!lifecycle||!ApiClient)return;
  const api=new ApiClient();
  const currentSessionToken=()=>window.sessionStorage?.getItem('artisys.sessionToken')||'';
  const categories=[
    ['company','Empresa','Dados da empresa e implantação'],
    ['team','Equipe e permissões','Pessoas, papéis e acessos'],
    ['units','Unidades e dispositivos','Dados, servidor e terminais conectados'],
    ['printing','Impressão e periféricos','Impressoras, balança, leitor e gaveta'],
    ['modules','Áreas','Alimentação e Atacado quando mudam o fluxo principal'],
    ['privacy','Privacidade e telemetria','Consentimento e diagnóstico anônimo'],
    ['diagnostics','Diagnóstico e backup','Saúde, suporte, importação e recuperação']
  ];
  let active='company';let scheduled=false;
  const page=root=>{const node=root?.matches?.('.ops-page')?root:(root?.querySelector?.('.ops-page')||content.querySelector('.ops-page'));return node?.querySelector('.ops-head h1')?.textContent?.trim()==='Configurações'?node:null;};
  const categoryFor=card=>{
    const declared=String(card.dataset.settingsCategory||'');
    if(categories.some(([id])=>id===declared))return declared;
    if(card.id==='settings-team-access')return'team';
    if(card.id==='settings-data-server')return'units';
    if(card.id==='ops-establishment-modules-card')return'modules';
    if(card.id==='telemetry-settings-card')return'privacy';
    if(card.id==='settings-devices')return'printing';
    const title=card.querySelector('h2,h3')?.textContent?.trim()||'';
    if(/privacidade|telemetria/i.test(title))return'privacy';
    if(/módulo/i.test(title))return'modules';
    if(/impress|hardware|periférico|balança|gaveta|leitor/i.test(title))return'printing';
    if(/terminal|unidade|dispositivo|acesso mobile/i.test(title))return'units';
    if(/loja|empresa|marca|identidade|configuração pública/i.test(title))return'company';
    if(/equipe|usuário|papéis|permissões|comiss/i.test(title))return'team';
    return'diagnostics';
  };
  function addTeamCard(root){
    const canOpenAccess=['users.view','profiles.view'].some(capability=>window.PdvAccessPolicy?.hasCapability(window.PdvCurrentAccess,capability));
    if(!canOpenAccess)return;
    if(root.querySelector('#settings-team-access'))return;
    const card=document.createElement('section');card.id='settings-team-access';card.className='ops-card';
    card.innerHTML='<div class="ops-card-head"><div><h2>Equipe e permissões</h2><p class="ops-muted">Cadastre pessoas, defina login, função e áreas liberadas.</p></div><button type="button" class="ops-primary" data-settings-route="access">Abrir Equipe e acessos</button></div>';
    root.appendChild(card);
    card.querySelector('[data-settings-route="access"]')?.addEventListener('click',()=>void window.PdvAppNavigation?.navigate?.('access'));
  }
  function addDataServerCard(root){
    if(root.querySelector('#settings-data-server'))return;
    const canManage=Boolean(window.PdvAccessPolicy?.hasCapability(window.PdvCurrentAccess,'deployment.manage'));
    const card=document.createElement('section');card.id='settings-data-server';card.className='ops-card';
    card.innerHTML=`<div class="ops-card-head"><div><h2>Dados e servidor</h2><p class="ops-muted">Veja onde os dados ficam e qual papel este computador exerce na instalação.</p></div></div><div class="settings-mode-summary" role="status" aria-live="polite"></div><form id="settings-data-server-form" class="field-grid"><div class="field wide"><label for="settings-server-mode">Este computador será</label><select id="settings-server-mode" name="mode" ${canManage?'':'disabled'}><option value="local">Apenas meu caixa · dados neste computador</option><option value="lan-host">PC principal · atende aparelhos da rede local</option><option value="lan-client" disabled>Terminal cliente · conecta a um PC principal</option><option value="own-server" disabled>Terminal conectado a servidor próprio</option></select></div><div class="field" data-server-option="port"><label for="settings-server-port">Porta da rede local</label><input id="settings-server-port" name="port" type="number" min="1" max="65535" value="4174" ${canManage?'':'disabled'}></div><div class="field wide" data-server-option="serverUrl"><label for="settings-server-url">Endereço do servidor</label><input id="settings-server-url" name="serverUrl" placeholder="http://192.168.0.10:4174 ou https://servidor.exemplo" disabled></div><div class="modal-actions wide"><button type="button" class="secondary-button" data-test>Testar conexão</button><button type="submit" class="primary-button" disabled>Salvar escolha e reiniciar</button></div><p class="ops-muted wide">${canManage?'A troca para servidor externo não migra dados locais automaticamente. A aplicação informa e bloqueia a mudança se houver dados sem migração. Para conectar um computador novo ao PC principal, use o código temporário de pareamento no primeiro acesso.':'Somente administradores autorizados podem alterar o papel deste computador ou a origem dos dados.'}</p></form>`;
    root.appendChild(card);
    const form=card.querySelector('form');
    const modeSummary=card.querySelector('.settings-mode-summary');
    const modeCopy={
      local:['Somente neste computador','Os dados permanecem neste PC. Nenhum acesso pela rede é iniciado.'],
      'lan-host':['PC principal da rede local','Este PC atende terminais autorizados na mesma rede.'],
      'lan-client':['Terminal conectado','Este aparelho usa o PC principal configurado; a credencial técnica permanece protegida pelo sistema operacional.'],
      'own-server':['Servidor próprio','Este terminal conecta ao endereço remoto configurado.']
    };
    const syncModeFields=()=>{
      const mode=form.elements.mode.value;
      const [title,copy]=modeCopy[mode]||modeCopy.local;
      modeSummary.innerHTML=`<strong>${title}</strong><span>${copy}</span>`;
      card.querySelectorAll('[data-server-option]').forEach(field=>{
        const key=field.dataset.serverOption;
        const visible=key==='port'?mode==='lan-host':key==='serverUrl'?['lan-client','own-server'].includes(mode):false;
        field.hidden=!visible;
      });
      card.querySelector('[data-test]').hidden=!canManage||!['lan-client','own-server'].includes(mode);
    };
    form.elements.mode.addEventListener('change',syncModeFields);
    syncModeFields();
    window.artisysDesktop.dataServer.state().then(value=>{
      form.elements.mode.value=value.mode;
      form.elements.port.value=value.port;
      form.elements.serverUrl.value=value.serverUrl||'';
      const external=['lan-client','own-server'].includes(value.mode);
      form.elements.mode.disabled=!canManage||external;
      form.elements.port.disabled=!canManage||external;
      form.querySelector('[type="submit"]').disabled=!canManage||external;
      const guidance=card.querySelector('.ops-muted.wide');
      if(external&&guidance)guidance.textContent='Este computador já está pareado como terminal. Para trocar o PC principal ou servidor, faça um novo pareamento controlado; a credencial atual nunca é reaproveitada em outro servidor.';
      syncModeFields();
      if(value.mode==='lan-host'&&Array.isArray(value.lanAddresses)&&value.lanAddresses.length){
        const address=value.lanAddresses.map(item=>`${item}:${value.lanPort||value.port||4174}`).join(' · ');
        modeSummary.querySelector('span').textContent=`Este PC atende terminais autorizados em ${address}.`;
      }
    }).catch(error=>{
      modeSummary.replaceChildren();
      const title=document.createElement('strong');title.textContent='Não foi possível confirmar o modo salvo';
      const detail=document.createElement('span');detail.textContent=String(error?.message||'Verifique a conexão antes de alterar esta opção.');
      modeSummary.append(title,detail);
    });
    form.querySelector('[data-test]').addEventListener('click',async()=>{
      if(!canManage)return;
      try{await window.artisysDesktop.dataServer.test({serverUrl:form.elements.serverUrl.value});window.ToastUI?.show?.('Servidor encontrado.','success');}
      catch(error){window.ToastUI?.show?.(error.message,'error');}
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if(!canManage){window.ToastUI?.show?.('Somente administradores autorizados podem alterar a implantação.','error');return;}
      try{
        await window.artisysDesktop.dataServer.save({
          mode:form.elements.mode.value,
          port:Number(form.elements.port.value),
          serverUrl:form.elements.serverUrl.value
        },currentSessionToken());
        await window.artisysDesktop.dataServer.restart();
      }catch(error){window.ToastUI?.show?.(error.message,'error');}
    });
  }
  function addRecoveryCard(root){
    if(root.querySelector('#settings-local-recovery'))return;
    const card=document.createElement('section');card.id='settings-local-recovery';card.className='ops-card';card.dataset.settingsCategory='team';
    card.innerHTML='<div class="ops-card-head"><div><h2>Recuperação local da sua senha</h2><p class="ops-muted">Guarde uma chave de uso único para recuperar seu acesso sem internet ou e-mail. Gerar outra chave invalida a anterior.</p></div></div><form class="field-grid" data-local-recovery-form><label class="field"><span>Sua senha atual</span><input name="password" type="password" autocomplete="current-password" required></label><div class="modal-actions"><button class="primary-button" type="submit">Gerar chave de recuperação</button></div></form><div data-recovery-key-output hidden></div>';
    root.appendChild(card);
    card.querySelector('form').addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button');button.disabled=true;
      try {const result=await api.request('/api/v1/auth/password-recovery/local-key',{method:'POST',body:{password:form.elements.password.value}});form.reset();const output=card.querySelector('[data-recovery-key-output]');output.hidden=false;output.innerHTML='<p>Guarde esta chave fora deste computador. Ela só será mostrada agora e poderá ser usada uma vez.</p><code data-recovery-key></code><div class="modal-actions"><button type="button" class="secondary-button" data-recovery-copy>Copiar chave</button><button type="button" class="secondary-button" data-recovery-save>Salvar arquivo</button><button type="button" class="secondary-button" data-recovery-hide>Já guardei</button></div>';output.querySelector('[data-recovery-key]').textContent=result.key;
      output.querySelector('[data-recovery-copy]').addEventListener('click',()=>navigator.clipboard.writeText(result.key).catch(()=>window.ToastUI?.show?.('Selecione e copie a chave exibida.','error')));
      output.querySelector('[data-recovery-save]').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([`ArtiSys — chave de recuperação local\n${result.key}\nGuarde em local seguro. Uso único.\n`],{type:'text/plain'}));const link=document.createElement('a');link.href=url;link.download='ArtiSys-chave-recuperacao.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
      output.querySelector('[data-recovery-hide]').addEventListener('click',()=>{output.replaceChildren();output.hidden=true;});
      }catch(error){window.ToastUI?.show?.(error.message,'error');}finally{button.disabled=false;}
    });
  }
  function addNewStoreCard(root){
    if(root.querySelector('#settings-new-store')||!window.PdvAccessPolicy?.hasCapability(window.PdvCurrentAccess,'deployment.manage'))return;
    const card=document.createElement('section');card.id='settings-new-store';card.className='ops-card';card.dataset.settingsCategory='units';
    card.innerHTML='<div class="ops-card-head"><div><h2>Iniciar outra loja neste computador</h2><p class="ops-muted">Cria uma instalação separada. Os dados da loja atual ficam arquivados, com backup de segurança.</p></div><button type="button" class="secondary-button" data-new-store-open>Iniciar nova instalação</button></div><dialog class="new-store-dialog"><form data-new-store-form><h2>Iniciar uma nova loja?</h2><p>O ArtiSys verificará um backup, arquivará os dados e reiniciará no primeiro acesso. Os terminais da loja atual perderão a conexão com este PC.</p><label class="field"><span>Digite NOVA LOJA para confirmar</span><input name="confirmation" required autocomplete="off" pattern="NOVA LOJA"></label><p data-new-store-error role="alert"></p><div class="modal-actions"><button type="button" class="secondary-button" data-new-store-cancel>Cancelar</button><button type="submit" class="primary-button">Criar backup e iniciar nova loja</button></div></form></dialog>';
    root.appendChild(card);const dialog=card.querySelector('dialog');card.querySelector('[data-new-store-open]').addEventListener('click',()=>dialog.showModal());card.querySelector('[data-new-store-cancel]').addEventListener('click',()=>dialog.close());
    card.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget;const button=form.querySelector('[type="submit"]');button.disabled=true;try{await window.artisysDesktop.installation.newStore(form.elements.confirmation.value,currentSessionToken());}catch(error){card.querySelector('[data-new-store-error]').textContent=error.message;button.disabled=false;}});
  }
  function ensureHub(root){
    let hub=root.querySelector('#settings-hub');
    if(hub)return hub;
    root.dataset.settingsPage='true';
    hub=document.createElement('section');hub.id='settings-hub';hub.className='settings-hub';hub.innerHTML=`<nav class="settings-hub-nav" aria-label="Áreas de configuração">${categories.map(([id,label,description])=>`<button type="button" data-settings-category="${id}" class="${id===active?'active':''}" aria-pressed="${id===active}"><strong>${label}</strong><span>${description}</span></button>`).join('')}</nav><div class="settings-hub-current" aria-live="polite"></div>`;
    root.querySelector('.ops-head')?.insertAdjacentElement('afterend',hub);
    hub.querySelectorAll('[data-settings-category]').forEach(button=>button.addEventListener('click',()=>{active=button.dataset.settingsCategory;apply(root,hub);}));
    return hub;
  }
  function apply(root,hub){
    addTeamCard(root);
    addDataServerCard(root);
    addRecoveryCard(root);
    addNewStoreCard(root);
    root.querySelectorAll('.ops-card').forEach(card=>{if(card.closest('#settings-hub'))return;card.dataset.settingsSection=categoryFor(card);card.hidden=card.dataset.settingsSection!==active;});
    root.querySelectorAll('.ops-grid,.vertical-layout').forEach(group=>{if(group.closest('#settings-hub'))return;const cards=[...group.querySelectorAll(':scope > .ops-card,:scope > section,.vertical-settings,.vertical-enabled')];if(cards.length)group.hidden=!cards.some(card=>!card.hidden);});
    hub.querySelectorAll('[data-settings-category]').forEach(button=>{const selected=button.dataset.settingsCategory===active;button.classList.toggle('active',selected);button.setAttribute('aria-pressed',String(selected));});
    const selected=categories.find(([id])=>id===active);const count=root.querySelectorAll(`[data-settings-section="${active}"]`).length;
    const summary=count?`${selected[1]} · ${count} área${count===1?'':'s'}`:`${selected[1]} · nenhuma configuração disponível para este perfil`;const status=hub.querySelector('.settings-hub-current');if(status.textContent!==summary)status.textContent=summary;
  }
  function mount(root){scheduled=false;const settingsRoot=page(root);if(!settingsRoot)return;const hub=ensureHub(settingsRoot);apply(settingsRoot,hub);}
  const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>mount());};
  const onRouteUpdate=({route})=>{if(route==='settings')schedule();};
  lifecycle.on('route:updated',onRouteUpdate);
  window.PdvSettingsHub=Object.freeze({mount});
})();
