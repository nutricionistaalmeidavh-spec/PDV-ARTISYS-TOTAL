'use strict';

(()=>{
  const ApiClient=window.PdvApiClient?.ApiClient;
  const registry=window.PdvRouteRegistry;
  const accessPolicy=window.PdvAccessPolicy;
  const ux=window.PdvAccessCenterModel;
  const ui=window.PdvUiModel;
  const content=document.getElementById('route-content');
  if(!ApiClient||!registry||!accessPolicy||!ux||!content)return;

  const api=new ApiClient();
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let activeTab='people';
  let currentUser=null;
  let profileQuery='';
  let accessModel={tabs:[],load:{},actions:{}};
  let snapshot={users:[],profiles:[],devices:[],security:null,permissions:[],permissionGroups:{},stations:[]};

  const TABS=Object.freeze([
    ['people','Pessoas'],
    ['profiles','Perfis'],
    ['devices','Dispositivos'],
    ['security','Segurança']
  ]);

  function toast(message,type=''){window.PdvToast?.show?.(message,type);}
  function canAction(name){return Boolean(accessModel.actions?.[name]);}
  function visibleTabs(){return TABS.filter(([id])=>accessModel.tabs?.includes(id));}
  function plural(value,singular,pluralForm){return `${value} ${value===1?singular:pluralForm}`;}

  async function load(){
    snapshot={users:[],profiles:[],devices:[],security:null,permissions:[],permissionGroups:{},stations:[]};
    const tasks=[];
    if(accessModel.load?.users)tasks.push(api.users(true).then(value=>{snapshot.users=value;}));
    if(accessModel.load?.profiles)tasks.push(api.accessProfiles(true).then(value=>{snapshot.profiles=value;}));
    if(accessModel.load?.permissions)tasks.push(api.accessPermissions().then(value=>{
      snapshot.permissions=value.permissions||[];
      snapshot.permissionGroups=value.groups||{};
    }));
    if(accessModel.load?.devices)tasks.push(Promise.all([api.accessDevices(),api.accessKitchenStations()]).then(([devices,stations])=>{snapshot.devices=devices;snapshot.stations=stations;}));
    if(accessModel.load?.security)tasks.push(api.accessSecurity().then(value=>{snapshot.security=value;}));
    await Promise.all(tasks);
  }

  function profileById(id){return snapshot.profiles.find(profile=>String(profile.id)===String(id))||null;}
  function profileName(id){return profileById(id)?.name||null;}
  function profileDisplay(user){
    if(!accessModel.load?.profiles)return 'Perfil não disponível';
    return profileName(user.profileId)||'Sem perfil';
  }

  function tabs(){
    return `<div class="access-tabs" role="tablist" aria-label="Áreas da Central de Acessos">
      ${visibleTabs().map(([id,label])=>`<button type="button" class="access-tab ${activeTab===id?'active':''}" role="tab" aria-selected="${activeTab===id?'true':'false'}" data-access-tab="${id}">${label}</button>`).join('')}
    </div>`;
  }

  function sectionHead(title,description,action=''){
    return `<div class="access-section-head admin-section-head"><div><h2>${esc(title)}</h2><p>${esc(description)}</p></div>${action}</div>`;
  }

  function peopleView(){
    const createButton=canAction('createPerson')?'<button type="button" class="primary-button" data-new-person>Nova pessoa</button>':'';
    const rows=snapshot.users.map(user=>{
      const canOpen=canAction('editPerson')||canAction('assignProfile');
      const action=canOpen?`<button type="button" class="secondary-button access-row-action" data-edit-person>${canAction('editPerson')?'Editar':'Alterar acesso'}</button>`:'';
      return `<tr data-user-row="${esc(user.id)}" data-user-id="${esc(user.id)}">
        <td><strong>${esc(user.name)}</strong><small>${esc(user.email||user.username||'')}</small></td>
        <td><span class="access-profile-pill">${esc(profileDisplay(user))}</span></td>
        <td>${esc(user.username||'')}</td>
        <td><span class="access-status ${user.active?'is-active':'is-inactive'}">${user.active?'Ativo':'Inativo'}</span></td>
        <td class="access-actions-cell">${action}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="5"><div class="access-empty">Nenhuma pessoa cadastrada.</div></td></tr>';

    return `<section class="access-surface">
      ${sectionHead('Pessoas','Cadastre a equipe e defina o perfil de acesso de cada pessoa no mesmo fluxo.',createButton)}
      <div class="access-table-wrap"><table class="access-table">
        <thead><tr><th>Pessoa</th><th>Perfil</th><th>Login</th><th>Status</th><th aria-label="Ações"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
  }

  function profilesView(){
    const createButton=canAction('createProfile')?'<button type="button" class="primary-button" data-new-profile>Novo perfil</button>':'';
    const profiles=ux.filterProfiles(snapshot.profiles,{query:profileQuery,users:snapshot.users});
    const usageKnown=Boolean(accessModel.load?.users);
    const rows=profiles.map(profile=>{
      const deletion=ux.profileDeleteState(profile,snapshot.users);
      const usage=usageKnown?plural(deletion.usageCount,'pessoa','pessoas'):'Uso não disponível';
      const type=profile.protected?'Sistema':profile.systemKey?'Padrão':'Personalizado';
      const actions=[
        canAction('editProfile')&&!profile.protected?'<button type="button" class="secondary-button access-row-action" data-edit-profile>Editar</button>':'',
        canAction('deleteProfile')&&!profile.protected?'<button type="button" class="danger-button access-row-action" data-delete-profile>Excluir</button>':''
      ].filter(Boolean).join('');
      return `<tr data-profile-card="${esc(profile.id)}" data-profile-id="${esc(profile.id)}">
        <td><strong>${esc(profile.name)}</strong>${profile.protected?'<small>Protegido pelo sistema</small>':profile.systemKey?'<small>Perfil padrão editável</small>':'<small>Configuração personalizada</small>'}</td>
        <td><span class="access-type-badge">${type}</span></td>
        <td>${plural(profile.permissions?.length||0,'permissão','permissões')}</td>
        <td><span class="${deletion.usageCount>0?'access-usage-active':''}">${esc(usage)}</span></td>
        <td><span class="access-status ${profile.active?'is-active':'is-inactive'}">${profile.active?'Ativo':'Inativo'}</span></td>
        <td class="access-actions-cell">${actions||'<span class="access-muted">—</span>'}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="6"><div class="access-empty">Nenhum perfil encontrado.</div></td></tr>';

    return `<section class="access-surface">
      ${sectionHead('Perfis','Perfis agrupam permissões e podem ser reutilizados por várias pessoas.',createButton)}
      <div class="access-toolbar">
        <label class="access-search"><span>Buscar perfil</span><input type="search" data-profile-search placeholder="Nome do perfil" value="${esc(profileQuery)}"></label>
        <div class="access-toolbar-summary">${plural(snapshot.profiles.length,'perfil','perfis')}${usageKnown?` · ${plural(snapshot.users.length,'pessoa','pessoas')}`:''}</div>
      </div>
      <div class="access-table-wrap"><table class="access-table">
        <thead><tr><th>Perfil</th><th>Tipo</th><th>Permissões</th><th>Pessoas</th><th>Status</th><th aria-label="Ações"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
  }

  function devicesView(){
    const createButton=canAction('pairDevice')?'<button type="button" class="primary-button" data-new-device>Novo dispositivo</button>':'';
    const stationName=id=>snapshot.stations.find(station=>String(station.id)===String(id))?.name||id;
    const rows=snapshot.devices.map(device=>{
      const actions=[
        canAction('blockDevice')?`<button type="button" class="secondary-button access-row-action" data-toggle-device>${device.status==='ACTIVE'?'Bloquear':'Reativar'}</button>`:'',
        device.deviceType==='KITCHEN'&&canAction('pairDevice')?'<button type="button" class="secondary-button access-row-action" data-device-stations>Setores</button>':'',
        canAction('rotateDeviceCredential')?'<button type="button" class="secondary-button access-row-action" data-rotate-device>Nova credencial</button>':''
      ].filter(Boolean).join('');
      const scope=device.deviceType==='KITCHEN'
        ?(device.stationIds?.length?device.stationIds.map(stationName).join(', '):'Todos os setores')
        :'Estabelecimento';
      return `<tr data-device-row="${esc(device.id)}" data-device-id="${esc(device.id)}">
        <td><strong>${esc(device.name)}</strong><small>${esc(device.id)}</small></td>
        <td>${esc(ui?.deviceTypeLabel?.(device.deviceType,device.surface||device.deviceType)||device.surface||device.deviceType)}</td>
        <td>${esc(scope)}</td>
        <td><span class="access-status ${device.status==='ACTIVE'?'is-active':'is-inactive'}">${esc(ui?.statusLabel?.(device.status,device.status)||device.status)}</span></td>
        <td>${esc(device.lastSeenAt||'Nunca')}</td>
        <td class="access-actions-cell">${actions}</td>
      </tr>`;
    }).join('')||'<tr><td colspan="6"><div class="access-empty">Nenhum dispositivo pareado.</div></td></tr>';

    return `<section class="access-surface">
      ${sectionHead('Dispositivos','Gerencie credenciais, superfícies e os setores de produção exibidos em cada KDS.',createButton)}
      <div class="access-table-wrap"><table class="access-table">
        <thead><tr><th>Dispositivo</th><th>Superfície</th><th>Escopo</th><th>Status</th><th>Último acesso</th><th aria-label="Ações"></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </section>`;
  }

  function securityView(){
    const security=snapshot.security||{counts:{},sessions:[],recent:[]};
    return `<div class="access-security-grid">
      <article class="access-metric"><span>Logins ativos</span><strong>${Number(security.counts?.sessions||0)}</strong></article>
      <article class="access-metric"><span>Administradores</span><strong>${Number(security.counts?.administrators||0)}</strong></article>
      <article class="access-metric"><span>Dispositivos ativos</span><strong>${Number(security.counts?.devices||0)}</strong></article>
      <article class="access-metric"><span>Bloqueados</span><strong>${Number(security.counts?.blockedDevices||0)}</strong></article>
      </div>
      <section class="access-surface">
        ${sectionHead('Sessões','Sessões humanas atualmente válidas.')}
        <div class="access-table-wrap"><table class="access-table"><thead><tr><th>Pessoa</th><th>Terminal</th><th>Expira</th><th aria-label="Ações"></th></tr></thead><tbody>
          ${(security.sessions||[]).map(session=>`<tr data-session-row="${esc(session.id||'')}" data-session-id="${esc(session.id||'')}"><td>${esc(session.name||session.userId)}</td><td>${esc(session.terminalId||'Local')}</td><td>${esc(session.expiresAt||'')}</td><td class="access-actions-cell">${session.id&&canAction('revokeSession')?'<button type="button" class="secondary-button access-row-action" data-revoke-session>Revogar</button>':''}</td></tr>`).join('')||'<tr><td colspan="4"><div class="access-empty">Nenhuma sessão ativa.</div></td></tr>'}
        </tbody></table></div>
      </section>
      <section class="access-surface">
        ${sectionHead('Eventos recentes','Login, perfis, pessoas, dispositivos e configurações.')}
        <div class="access-table-wrap"><table class="access-table"><thead><tr><th>Quando</th><th>Evento</th><th>Ator</th><th>Entidade</th></tr></thead><tbody>
          ${(security.recent||[]).map(event=>`<tr><td>${esc(event.createdAt)}</td><td>${esc(event.action)}</td><td>${esc(event.actorId||event.actorKind||'sistema')}</td><td>${esc(event.entity)} ${esc(event.entityId||'')}</td></tr>`).join('')||'<tr><td colspan="4"><div class="access-empty">Nenhum evento recente.</div></td></tr>'}
        </tbody></table></div>
      </section>`;
  }

  function view(){
    if(activeTab==='profiles')return profilesView();
    if(activeTab==='devices')return devicesView();
    if(activeTab==='security')return securityView();
    return peopleView();
  }

  function profileStepIndicator(step){
    const labels=['Informações','Permissões','Revisão'];
    return `<ol class="access-stepper" aria-label="Etapas do perfil">${labels.map((label,index)=>{
      const number=index+1;
      const state=number===step?'current':number<step?'done':'upcoming';
      return `<li class="${state}"><span>${number}</span><strong>${label}</strong></li>`;
    }).join('')}</ol>`;
  }

  function profileDialog(profile=null){
    const root=window.PdvModal;
    if(!root?.open)return;

    const state={
      step:1,
      name:profile?.name||'',
      selected:new Set(profile?.permissions||[]),
      query:'',
      activeGroup:null
    };

    function allGroups(){
      return ux.permissionGroups({
        permissions:snapshot.permissions,
        groups:snapshot.permissionGroups,
        selectedIds:[...state.selected],
        query:''
      });
    }

    function ensureActiveGroup(){
      const groups=allGroups();
      if(!groups.length){state.activeGroup=null;return;}
      if(!state.activeGroup||!groups.some(group=>group.id===state.activeGroup))state.activeGroup=groups[0].id;
    }

    function permissionsPane(){
      ensureActiveGroup();
      const groupNav=allGroups();
      const matched=ux.permissionGroups({
        permissions:snapshot.permissions,
        groups:snapshot.permissionGroups,
        selectedIds:[...state.selected],
        query:state.query
      });
      const visible=state.query?matched:matched.filter(group=>group.id===state.activeGroup);
      const sections=visible.map(group=>{
        const bulkAction=ux.permissionGroupBulkAction({selected:group.selected,total:group.total,query:state.query});
        return `<section class="access-permission-section" data-permission-section="${esc(group.id)}">
        <div class="access-permission-section-head"><div><h4>${esc(group.label)}</h4><small>${group.selected} de ${group.total} selecionadas</small></div>
          ${bulkAction?`<button type="button" class="secondary-button access-compact-button" data-toggle-permission-group="${esc(group.id)}">${esc(bulkAction.label)}</button>`:''}
        </div>
        <div class="access-permission-list">${group.permissions.map(permission=>`<label class="access-permission-row">
          <input type="checkbox" name="permission" value="${esc(permission.id)}" ${state.selected.has(permission.id)?'checked':''}>
          <span><strong>${esc(permission.label)}</strong><small>${esc(permission.description)}</small></span>
        </label>`).join('')}</div>
      </section>`;
      }).join('')||'<div class="access-empty">Nenhuma permissão encontrada.</div>';

      return `<div class="access-permission-editor">
        <aside class="access-permission-groups" aria-label="Áreas de permissão">
          ${groupNav.map(group=>`<button type="button" class="${state.activeGroup===group.id&&!state.query?'active':''}" data-permission-group="${esc(group.id)}"><span>${esc(group.label)}</span><small>${group.selected}/${group.total}</small></button>`).join('')}
        </aside>
        <div class="access-permission-content">
          <div class="access-permission-toolbar">
            <label class="access-search"><span>Buscar permissão</span><input type="search" data-permission-search placeholder="Ex.: caixa, vendas, estoque" value="${esc(state.query)}"></label>
            <span class="access-selection-count">${plural(state.selected.size,'selecionada','selecionadas')}</span>
          </div>
          ${sections}
        </div>
      </div>`;
    }

    function reviewPane(){
      const summary=ux.selectedPermissionSummary({
        permissions:snapshot.permissions,
        groups:snapshot.permissionGroups,
        selectedIds:[...state.selected]
      });
      return `<div class="access-review">
        <div class="access-review-profile"><span>Perfil</span><strong>${esc(state.name)}</strong><small>${plural(state.selected.size,'permissão selecionada','permissões selecionadas')}</small></div>
        <div class="access-review-groups">${summary.map(group=>`<div><span>${esc(group.label)}</span><strong>${group.count}</strong></div>`).join('')||'<p>Nenhuma permissão selecionada.</p>'}</div>
        <div class="access-review-note"><strong>Antes de salvar</strong><p>As pessoas que receberem este perfil terão somente as permissões listadas acima. O acesso pode ser alterado depois.</p></div>
      </div>`;
    }

    function body(){
      const contentStep=state.step===1
        ? `<div class="access-profile-basics"><div class="field"><label>Nome do perfil</label><input name="name" required maxlength="80" value="${esc(state.name)}" placeholder="Ex.: Supervisor de vendas"></div><div class="access-helper"><strong>Use um nome fácil de reconhecer.</strong><span>Prefira a função da pessoa ou o nível de acesso, sem termos técnicos.</span></div></div>`
        : state.step===2?permissionsPane():reviewPane();

      return `<form data-profile-form data-profile-step="${state.step}">
        ${profileStepIndicator(state.step)}
        <div class="access-wizard-content">${contentStep}</div>
        <div class="access-wizard-actions">
          <button type="button" class="secondary-button" data-profile-cancel>Cancelar</button>
          <span class="access-wizard-spacer"></span>
          ${state.step>1?'<button type="button" class="secondary-button" data-profile-back>Voltar</button>':''}
          ${state.step<3?'<button type="button" class="primary-button" data-profile-next>Continuar</button>':`<button type="submit" class="primary-button" data-profile-save>${profile?'Salvar alterações':'Criar perfil'}</button>`}
        </div>
      </form>`;
    }

    function syncName(modal){
      const input=modal.querySelector('input[name="name"]');
      if(input)state.name=input.value.trim();
    }

    function renderModal(modal,{focusSearch=false}={}){
      const modalBody=modal.querySelector('.modal-body');
      modalBody.innerHTML=body();
      const form=modalBody.querySelector('[data-profile-form]');

      form.querySelector('[data-profile-cancel]')?.addEventListener('click',()=>window.PdvModal.close());
      form.querySelector('[data-profile-next]')?.addEventListener('click',()=>{
        syncName(modal);
        if(state.step===1&&!state.name){toast('Informe um nome para o perfil.','error');modal.querySelector('input[name="name"]')?.focus();return;}
        state.step=Math.min(3,state.step+1);
        renderModal(modal);
      });
      form.querySelector('[data-profile-back]')?.addEventListener('click',()=>{
        syncName(modal);
        state.step=Math.max(1,state.step-1);
        renderModal(modal);
      });
      form.querySelectorAll('[data-permission-group]').forEach(button=>button.addEventListener('click',()=>{
        state.activeGroup=button.dataset.permissionGroup;
        state.query='';
        renderModal(modal);
      }));
      form.querySelector('[data-permission-search]')?.addEventListener('input',event=>{
        state.query=event.currentTarget.value;
        renderModal(modal,{focusSearch:true});
      });
      form.querySelectorAll('input[name="permission"]').forEach(input=>input.addEventListener('change',()=>{
        if(input.checked)state.selected.add(input.value);else state.selected.delete(input.value);
        renderModal(modal);
      }));
      form.querySelectorAll('[data-toggle-permission-group]').forEach(button=>button.addEventListener('click',()=>{
        const groupId=button.dataset.togglePermissionGroup;
        const ids=snapshot.permissions.filter(permission=>permission.group===groupId&&permission.group!=='public').map(permission=>permission.id);
        const everySelected=ids.length>0&&ids.every(id=>state.selected.has(id));
        for(const id of ids){if(everySelected)state.selected.delete(id);else state.selected.add(id);}
        renderModal(modal);
      }));
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        if(state.step!==3)return;
        try{
          if(profile)await api.updateAccessProfile(profile.id,{name:state.name,permissions:[...state.selected]});
          else await api.createAccessProfile({name:state.name,permissions:[...state.selected]});
          window.PdvModal.close();
          activeTab='profiles';
          profileQuery='';
          await render({state:{user:currentUser}});
          toast(profile?'Perfil atualizado.':'Perfil criado.','success');
        }catch(error){toast(error.message,'error');}
      });
      if(focusSearch){
        const search=modal.querySelector('[data-permission-search]');
        search?.focus();
        if(search)search.setSelectionRange(search.value.length,search.value.length);
      }
    }

    root.open(profile?'Editar perfil':'Novo perfil','<div data-profile-wizard-mount></div>',{wide:true,onMount:modal=>renderModal(modal)});
  }

  function profileSummaryMarkup(profileId){
    const profile=profileById(profileId);
    if(!profile)return '<span>Sem perfil definido.</span>';
    return `<strong>${esc(profile.name)}</strong><span>${plural(profile.permissions?.length||0,'permissão','permissões')} neste perfil.</span>`;
  }

  function personDialog(existing=null){
    const editing=Boolean(existing);
    const canEdit=canAction('editPerson');
    const canAssign=canAction('assignProfile')&&snapshot.profiles.length>0;
    const title=editing?(canEdit?'Editar pessoa':'Alterar acesso'):'Nova pessoa';
    const profileOptions=canAssign?snapshot.profiles.filter(profile=>profile.active||profile.id===existing?.profileId):[];
    const defaultProfileId=existing?.profileId||profileOptions.find(profile=>profile.systemKey==='operator')?.id||profileOptions[0]?.id||'';

    const profileField=canAssign?`<div class="field access-profile-field"><label>Perfil de acesso</label><select name="profileId">${profileOptions.map(profile=>`<option value="${esc(profile.id)}" ${profile.id===defaultProfileId?'selected':''}>${esc(profile.name)}</option>`).join('')}</select><div class="access-profile-summary" data-profile-summary>${profileSummaryMarkup(defaultProfileId)}</div></div>`:'';
    const passwordField=!editing
      ? '<div class="field"><label>Senha inicial</label><input name="password" type="password" minlength="10" required autocomplete="new-password"></div>'
      : canAction('resetPassword')&&canEdit?'<div class="field"><label>Nova senha <span class="access-optional">(opcional)</span></label><input name="password" type="password" minlength="10" autocomplete="new-password"></div>':'';
    const activeField=editing&&canAction('disablePerson')&&canEdit
      ? `<label class="access-toggle-row"><input name="active" type="checkbox" ${existing.active?'checked':''}><span><strong>Acesso ativo</strong><small>Desative para impedir novos logins desta pessoa.</small></span></label>`
      :'';

    const disabled=editing&&!canEdit?'disabled':'';
    window.PdvModal?.open?.(title,`<form data-person-form>
      <div class="access-person-form">
        <section><h3>Dados de acesso</h3><div class="field-grid">
          <div class="field"><label>Nome</label><input name="name" required value="${esc(existing?.name||'')}" ${disabled}></div>
          <div class="field"><label>E-mail <span class="access-optional">(opcional)</span></label><input name="email" type="email" value="${esc(existing?.email||'')}" ${disabled}></div>
          <div class="field"><label>Usuário</label><input name="username" required value="${esc(existing?.username||'')}" ${disabled}></div>
          ${passwordField}
        </div>${activeField}</section>
        ${profileField?`<section><h3>Perfil e permissões</h3>${profileField}</section>`:''}
      </div>
      <div class="access-wizard-actions"><button type="button" class="secondary-button" data-person-cancel>Cancelar</button><span class="access-wizard-spacer"></span><button class="primary-button" type="submit">${editing?'Salvar alterações':'Criar pessoa'}</button></div>
    </form>`,{onMount:modal=>{
      const form=modal.querySelector('[data-person-form]');
      form.querySelector('[data-person-cancel]')?.addEventListener('click',()=>window.PdvModal.close());
      form.elements.profileId?.addEventListener('change',event=>{
        const summary=form.querySelector('[data-profile-summary]');
        if(summary)summary.innerHTML=profileSummaryMarkup(event.currentTarget.value);
      });
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        try{
          const selectedProfileId=form.elements.profileId?.value||null;
          if(editing){
            if(canEdit){
              const payload={id:existing.id,name:form.elements.name.value,email:form.elements.email.value,username:form.elements.username.value};
              if(form.elements.active)payload.active=form.elements.active.checked;
              if(form.elements.password?.value)payload.password=form.elements.password.value;
              await api.saveUser(payload);
            }
            if(canAssign&&selectedProfileId&&selectedProfileId!==existing.profileId)await api.assignAccessProfile(existing.id,selectedProfileId);
          }else{
            const payload={name:form.elements.name.value,email:form.elements.email.value,username:form.elements.username.value,password:form.elements.password.value,active:true};
            if(canAssign&&selectedProfileId)payload.profileId=selectedProfileId;
            await api.saveUser(payload);
          }
          window.PdvModal.close();
          activeTab='people';
          await render({state:{user:currentUser}});
          toast(editing?'Pessoa atualizada.':'Pessoa criada.','success');
        }catch(error){toast(error.message,'error');}
      });
    }});
  }

  function deleteProfileDialog(profile){
    const deletion=ux.profileDeleteState(profile,snapshot.users);
    const usageKnown=Boolean(accessModel.load?.users);
    const linked=usageKnown?snapshot.users.filter(user=>String(user.profileId)===String(profile.id)):[];
    const root=window.PdvModal;
    if(!root?.open)return;

    if(usageKnown&&deletion.usageCount>0){
      root.open('Perfil em uso',`<div class="access-delete-dialog">
        <div class="access-warning"><strong>Este perfil não pode ser excluído agora.</strong><p>${plural(deletion.usageCount,'pessoa usa','pessoas usam')} <strong>${esc(profile.name)}</strong>. Reatribua essas pessoas antes de excluir.</p></div>
        <ul class="access-linked-people">${linked.slice(0,5).map(user=>`<li><strong>${esc(user.name)}</strong><span>${esc(user.username||user.email||'')}</span></li>`).join('')}</ul>
        ${linked.length>5?`<p class="access-muted">E mais ${linked.length-5}.</p>`:''}
        <div class="access-wizard-actions"><button type="button" class="secondary-button" data-delete-cancel>Fechar</button><span class="access-wizard-spacer"></span><button type="button" class="primary-button" data-view-profile-users>Ver pessoas</button></div>
      </div>`,{onMount:modal=>{
        modal.querySelector('[data-delete-cancel]')?.addEventListener('click',()=>window.PdvModal.close());
        modal.querySelector('[data-view-profile-users]')?.addEventListener('click',()=>{
          window.PdvModal.close();
          activeTab='people';
          paint();
        });
      }});
      return;
    }

    root.open('Excluir perfil',`<div class="access-delete-dialog">
      <div class="access-danger"><strong>Excluir “${esc(profile.name)}”?</strong><p>Esta ação não pode ser desfeita.${usageKnown?' Nenhuma pessoa está vinculada a este perfil.':' O sistema verificará vínculos antes de concluir.'}</p></div>
      <div class="access-wizard-actions"><button type="button" class="secondary-button" data-delete-cancel>Cancelar</button><span class="access-wizard-spacer"></span><button type="button" class="danger-button" data-confirm-delete-profile>Excluir perfil</button></div>
    </div>`,{onMount:modal=>{
      modal.querySelector('[data-delete-cancel]')?.addEventListener('click',()=>window.PdvModal.close());
      modal.querySelector('[data-confirm-delete-profile]')?.addEventListener('click',async()=>{
        try{
          await api.deleteAccessProfile(profile.id);
          window.PdvModal.close();
          await render({state:{user:currentUser}});
          toast('Perfil excluído.','success');
        }catch(error){toast(error.message,'error');}
      });
    }});
  }

  function stationChoices(selected=[]){
    const chosen=new Set((selected||[]).map(String));
    return snapshot.stations.length
      ?snapshot.stations.map(station=>`<label class="access-permission-row"><input type="checkbox" name="stationId" value="${esc(station.id)}" ${chosen.has(String(station.id))?'checked':''}><span><strong>${esc(station.name)}</strong><small>Mostrar pedidos enviados para este setor.</small></span></label>`).join('')
      :'<div class="access-empty">Nenhum setor de produção cadastrado.</div>';
  }

  function deviceDialog(){
    window.PdvModal?.open?.('Novo dispositivo',`<form data-device-form>
      <div class="field"><label>Nome</label><input name="name" required></div>
      <div class="field"><label>Superfície</label><select name="deviceType"><option value="WAITER">Garçom</option><option value="KITCHEN">KDS / produção</option></select></div>
      <fieldset class="data-card" data-device-station-fieldset hidden><legend>Setores de produção</legend><p class="helper">Escolha Cozinha, Bar ou outros setores deste painel. Sem seleção, o KDS acompanha todos.</p>${stationChoices()}</fieldset>
      <div class="access-wizard-actions"><button type="button" class="secondary-button" data-device-cancel>Cancelar</button><span class="access-wizard-spacer"></span><button class="primary-button" type="submit">Parear</button></div>
    </form>`,{onMount:modal=>{
      const form=modal.querySelector('[data-device-form]');
      const type=form.elements.deviceType;
      const stationFieldset=form.querySelector('[data-device-station-fieldset]');
      const syncType=()=>{stationFieldset.hidden=type.value!=='KITCHEN';};
      type.addEventListener('change',syncType);syncType();
      form.querySelector('[data-device-cancel]')?.addEventListener('click',()=>window.PdvModal.close());
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        const deviceType=type.value;
        const stationIds=deviceType==='KITCHEN'?[...form.querySelectorAll('input[name="stationId"]:checked')].map(input=>input.value):[];
        try{
          const created=await api.createAccessDevice({name:form.elements.name.value,deviceType,stationIds});
          window.PdvModal.close();
          await render({state:{user:currentUser}});
          window.PdvModal?.open?.('Credencial do dispositivo',`<p>Copie esta credencial agora. Ela não será exibida novamente.</p><div class="data-card"><code>${esc(created.credential)}</code></div>`);
        }catch(error){toast(error.message,'error');}
      });
    }});
  }

  function deviceStationsDialog(device){
    window.PdvModal?.open?.('Setores do KDS',`<form data-device-stations-form>
      <p>Defina quais filas <strong>${esc(device.name)}</strong> deve acompanhar. Sem seleção, o painel acompanha todos os setores.</p>
      <fieldset class="data-card"><legend>Setores de produção</legend>${stationChoices(device.stationIds)}</fieldset>
      <div class="access-wizard-actions"><button type="button" class="secondary-button" data-stations-cancel>Cancelar</button><span class="access-wizard-spacer"></span><button type="submit" class="primary-button">Salvar setores</button></div>
    </form>`,{onMount:modal=>{
      const form=modal.querySelector('[data-device-stations-form]');
      form.querySelector('[data-stations-cancel]')?.addEventListener('click',()=>window.PdvModal.close());
      form.addEventListener('submit',async event=>{
        event.preventDefault();
        const stationIds=[...form.querySelectorAll('input[name="stationId"]:checked')].map(input=>input.value);
        try{
          await api.setAccessDeviceKitchenStations(device.id,stationIds);
          window.PdvModal.close();
          await render({state:{user:currentUser}});
          toast('Setores do KDS atualizados.','success');
        }catch(error){toast(error.message,'error');}
      });
    }});
  }

  function bind(){
    content.querySelectorAll('[data-access-tab]').forEach(button=>button.addEventListener('click',()=>{
      activeTab=button.dataset.accessTab;
      paint();
    }));

    content.querySelector('[data-profile-search]')?.addEventListener('input',event=>{
      profileQuery=event.currentTarget.value;
      paint({focusProfileSearch:true});
    });

    content.querySelector('[data-new-profile]')?.addEventListener('click',()=>profileDialog());
    content.querySelector('[data-new-person]')?.addEventListener('click',()=>personDialog());
    content.querySelector('[data-new-device]')?.addEventListener('click',deviceDialog);

    content.querySelectorAll('[data-profile-id]').forEach(row=>{
      const profile=profileById(row.dataset.profileId);
      row.querySelector('[data-edit-profile]')?.addEventListener('click',()=>profileDialog(profile));
      row.querySelector('[data-delete-profile]')?.addEventListener('click',()=>deleteProfileDialog(profile));
    });

    content.querySelectorAll('[data-user-id]').forEach(row=>{
      const user=snapshot.users.find(item=>String(item.id)===String(row.dataset.userId));
      row.querySelector('[data-edit-person]')?.addEventListener('click',()=>personDialog(user));
    });

    content.querySelectorAll('[data-device-id]').forEach(row=>{
      const device=snapshot.devices.find(item=>String(item.id)===String(row.dataset.deviceId));
      row.querySelector('[data-toggle-device]')?.addEventListener('click',async()=>{
        try{
          await api.setAccessDeviceStatus(device.id,device.status==='ACTIVE'?'BLOCKED':'ACTIVE');
          await render({state:{user:currentUser}});
          toast('Dispositivo atualizado.','success');
        }catch(error){toast(error.message,'error');}
      });
      row.querySelector('[data-device-stations]')?.addEventListener('click',()=>deviceStationsDialog(device));
      row.querySelector('[data-rotate-device]')?.addEventListener('click',async()=>{
        try{
          const result=await api.rotateAccessDevice(device.id);
          await render({state:{user:currentUser}});
          window.PdvModal?.open?.('Nova credencial',`<p>A credencial anterior foi invalidada.</p><div class="data-card"><code>${esc(result.credential)}</code></div>`);
        }catch(error){toast(error.message,'error');}
      });
    });

    content.querySelectorAll('[data-session-id]').forEach(row=>row.querySelector('[data-revoke-session]')?.addEventListener('click',async()=>{
      try{
        await api.revokeAccessSession(row.dataset.sessionId);
        await render({state:{user:currentUser}});
        toast('Sessão revogada.','success');
      }catch(error){toast(error.message,'error');}
    }));
  }

  function paint({focusProfileSearch=false}={}){
    content.innerHTML=`<section class="page access-center-page admin-surface" data-admin-surface="access"><header class="page-head"><div><h1>Acessos e equipe</h1><p>Controle pessoas, perfis, dispositivos e segurança em um único lugar.</p></div></header>${tabs()}<div data-access-panel>${view()}</div></section>`;
    bind();
    registry.updated('access',{tab:activeTab});
    if(focusProfileSearch){
      const search=content.querySelector('[data-profile-search]');
      search?.focus();
      if(search)search.setSelectionRange(search.value.length,search.value.length);
    }
  }

  async function render({state}={}){
    currentUser=state?.user||window.PdvCurrentAccess||null;
    accessModel=accessPolicy.accessCenterModel(currentUser);
    const firstTab=accessModel.tabs[0]||null;
    if(!firstTab){
      content.innerHTML='<section class="page"><div class="data-card"><h2>Acesso indisponível</h2><p>Seu perfil não possui permissão para consultar esta área.</p></div></section>';
      return;
    }
    if(!accessModel.tabs.includes(activeTab))activeTab=firstTab;
    content.innerHTML='<section class="page"><div class="data-card"><p>Carregando acessos...</p></div></section>';
    try{
      await load();
      paint();
    }catch(error){
      content.innerHTML=`<section class="page"><div class="data-card"><h2>Não foi possível carregar os acessos</h2><p>${esc(error.message)}</p></div></section>`;
    }
  }

  registry.register('access',{owner:'access-center',render});
})();
