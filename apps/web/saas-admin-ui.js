// Merchant administration within the canonical PDV web application.
// The platform root secret is NEVER accepted here or sent to the browser.
(function(root){
 'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 const urlPart=v=>encodeURIComponent(String(v||''));
 const roles=Object.freeze(['ADMINISTRATOR','MANAGER','SUPERVISOR','CASHIER','OPERATOR','WAITER','KITCHEN','STOCKKEEPER','PURCHASING','FINANCE','DELIVERY','READ_ONLY']);
 const labels=Object.freeze({ADMINISTRATOR:'Administrador',MANAGER:'Gerente',SUPERVISOR:'Supervisor',CASHIER:'Operador de caixa',OPERATOR:'Operador',WAITER:'Garçom',KITCHEN:'Cozinha',STOCKKEEPER:'Estoque',PURCHASING:'Compras',FINANCE:'Financeiro',DELIVERY:'Entrega',READ_ONLY:'Somente leitura',OWNER:'Proprietário'});
 const option=(key,current)=>'<option value="'+esc(key)+'"'+(key===current?' selected':'')+'>'+esc(labels[key]||key)+'</option>';
 const date=v=>{const d=new Date(v);return Number.isFinite(d.valueOf())?d.toLocaleDateString('pt-BR'):'—';};
 const statusLabel=v=>({TRIAL:'Período de teste',ACTIVE:'Ativa',PAST_DUE:'Pagamento pendente',SUSPENDED:'Suspensa',CANCELLED:'Cancelada'}[v]||'Sem assinatura');
 const message=(host,text,kind='info')=>{const node=host.querySelector('#saas-feedback');if(node){node.textContent=text;node.dataset.kind=kind;}};
 function base(api){if(!api?.webMode||!api.tenantId)throw new Error('Escolha um estabelecimento.');return '/api/v1/tenants/'+urlPart(api.tenantId);}
 async function load(api){
  const path=base(api);
  const requests=[
   api.request(path+'/context'),
   api.request(path+'/branches'),
   api.request(path+'/members'),
   api.request(path+'/invitations'),
   api.request(path+'/subscription'),
   api.request('/api/v1/auth/sessions')
  ];
  const [context,branches,members,invitations,subscription,sessions]=await Promise.all(requests);
  if(context.profileKey!=='OWNER')throw new Error('Somente o proprietário administra este estabelecimento.');
  return {context,branches:branches.branches||[],members:members.members||[],
   invitations:invitations.invitations||[],subscription:subscription.subscription,
   canWrite:subscription.writeEnabled===true,sessions:sessions.sessions||[]};
 }
 function markup(data,ctx){
  const s=data.subscription;
  const canWrite=data.canWrite;
  const own=ctx.user?.id;
  const memberships=Array.isArray(ctx.memberships)?ctx.memberships:[];
  const options=memberships.filter(m=>m.profileKey==='OWNER');
  return '<section class="page saas-admin" id="saas-admin" aria-labelledby="saas-admin-title">'+
   '<header class="page-head saas-admin-head"><div><span class="saas-kicker">PDV TOTAL / ADMINISTRAÇÃO</span>'+
   '<h1 id="saas-admin-title">Seu estabelecimento</h1><p>Equipe, filiais e acessos vinculados à sua empresa.</p></div>'+
   (options.length>1?'<label class="saas-switch">Alternar empresa<select id="saas-tenant-select">'+options.map(m=>'<option value="'+esc(m.tenantId)+'"'+(m.tenantId===ctx.api.tenantId?' selected':'')+'>'+esc(m.name)+'</option>').join('')+'</select></label>':'')+
   '</header><p class="saas-feedback" id="saas-feedback" role="status" aria-live="polite"></p>'+
   '<div class="saas-summary">'+
   '<article class="saas-stat"><span>Empresa</span><strong>'+esc(data.context.name)+'</strong><small>Acesso de proprietário</small></article>'+
   '<article class="saas-stat"><span>Plano</span><strong>'+esc(statusLabel(s?.status))+'</strong><small>'+((s?.endsAt)?'Válido até '+esc(date(s.endsAt)):'Aguardando liberação')+'</small></article>'+
   '<article class="saas-stat"><span>Operações</span><strong>'+(canWrite?'Liberadas':'Somente consultas')+'</strong><small>'+(canWrite?'Assinatura vigente':'Fale com a ArtiSys para regularizar')+'</small></article></div>'+
   '<div class="saas-admin-grid">'+
   '<section class="saas-panel"><h2>Filiais</h2><p>Estabelecimentos da mesma empresa.</p>'+
   '<ul class="saas-list">'+data.branches.map(b=>'<li><strong>'+esc(b.name)+'</strong><span>'+esc(b.code)+'</span></li>').join('')+'</ul>'+
   '<form id="saas-branch-form" class="saas-inline-form"><label>Código<input name="code" maxlength="24" placeholder="FILIAL02" pattern="[A-Za-z0-9_-]{2,24}" required '+(!canWrite?'disabled':'')+'></label>'+
   '<label>Nome da filial<input name="name" maxlength="100" placeholder="Unidade Centro" required '+(!canWrite?'disabled':'')+'></label>'+
   '<button type="submit" '+(!canWrite?'disabled':'')+'>Adicionar filial</button></form></section>'+
   '<section class="saas-panel"><h2>Convidar funcionário</h2><p>O convite dura 48 horas. Envie o código diretamente ao funcionário.</p>'+
   '<form id="saas-invite-form" class="saas-inline-form"><label>E-mail<input name="email" type="email" autocomplete="off" required '+(!canWrite?'disabled':'')+'></label>'+
   '<label>Perfil<select name="profileKey" '+(!canWrite?'disabled':'')+'>'+roles.map(k=>option(k,'CASHIER')).join('')+'</select></label>'+
   '<button type="submit" '+(!canWrite?'disabled':'')+'>Criar convite</button></form>'+
   '<div id="saas-invite-secret" class="saas-secret" hidden><label>Código de uso único<textarea id="saas-invite-code" readonly rows="3"></textarea></label>'+
   '<button type="button" id="saas-copy-invite">Copiar código</button><p>Este código não ficará disponível após fechar ou atualizar a tela.</p></div>'+
   '<h3>Convites enviados</h3><ul class="saas-list">'+(data.invitations.length?data.invitations.map(i=>'<li><div><strong>'+esc(i.email)+'</strong><small>'+esc(labels[i.profileKey]||i.profileKey)+' · '+
    (i.acceptedAt?'Aceito':i.revokedAt?'Revogado':new Date(i.expiresAt)<=new Date()?'Expirado':'Pendente')+'</small></div>'+
    (!i.acceptedAt&&!i.revokedAt&&new Date(i.expiresAt)>new Date()&&canWrite?'<button type="button" data-revoke-invite="'+esc(i.id)+'">Revogar</button>':'')+'</li>').join(''):'<li>Não há convites.</li>')+'</ul></section>'+
   '<section class="saas-panel"><h2>Equipe</h2><p>Permissões são verificadas no servidor em cada operação.</p>'+
   '<ul class="saas-list">'+data.members.map(m=>'<li><div><strong>'+esc(m.displayName)+'</strong><small>'+esc(labels[m.profileKey]||m.profileKey)+'</small></div>'+
    (m.id!==own&&m.profileKey!=='OWNER'?
      '<div class="saas-actions"><label class="saas-visually-hidden" for="saas-role-'+esc(m.id)+'">Perfil de '+esc(m.displayName)+'</label>'+
      '<select id="saas-role-'+esc(m.id)+'" data-role-user="'+esc(m.id)+'" '+(!canWrite?'disabled':'')+'>'+roles.map(k=>option(k,m.profileKey)).join('')+'</select>'+
      '<button type="button" data-save-role="'+esc(m.id)+'" '+(!canWrite?'disabled':'')+'>Salvar</button>'+
      '<button type="button" data-remove-member="'+esc(m.id)+'" '+(!canWrite?'disabled':'')+'>Remover</button></div>':'')+'</li>').join('')+'</ul></section>'+
   '<section class="saas-panel"><h2>Dispositivos e sessões</h2><p>Revogar sessões encerra o acesso daquele navegador.</p>'+
   '<ul class="saas-list">'+data.sessions.map(s=>'<li><div><strong>'+(s.current?'Esta sessão':'Outra sessão')+'</strong><small>Iniciada em '+esc(date(s.createdAt))+'</small></div>'+
    '<button type="button" data-revoke-session="'+esc(s.id)+'">'+(s.current?'Sair deste dispositivo':'Encerrar')+'</button></li>').join('')+'</ul></section></div>'+
   '<p class="saas-admin-footnote">Assinaturas são gerenciadas pela ArtiSys. O estabelecimento não pode alterar o plano pelo navegador.</p>'+
   '</section>';
 }
 async function render(host,ctx){
  if(!ctx?.api?.webMode||ctx.user?.profileKey!=='OWNER'){
   host.innerHTML='<section class="page"><h1>Acesso restrito</h1><p>Somente o proprietário pode gerenciar a empresa.</p></section>';return;
  }
  host.innerHTML='<section class="page saas-admin"><h1>Administração do estabelecimento</h1><p role="status">Carregando dados da empresa…</p></section>';
  try{
   const data=await load(ctx.api);
   if(!host.isConnected||document.body.dataset.activeRoute!=='saas-admin')return;
   host.innerHTML=markup(data,ctx);
   const path=base(ctx.api);
   const run=async(callback,success)=>{
    message(host,'Processando…');
    try{await callback(); if(success)ctx.toast?.(success,'success');await render(host,ctx);}
    catch(e){message(host,e?.message||'Não foi possível concluir a operação.','error');}
   };
   host.querySelector('#saas-branch-form')?.addEventListener('submit',event=>{
    event.preventDefault();const form=event.currentTarget;
    void run(()=>ctx.api.request(path+'/branches',{method:'POST',body:{code:form.elements.code.value,name:form.elements.name.value}}),'Filial cadastrada.');
   });
   host.querySelector('#saas-invite-form')?.addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget;
    message(host,'Criando convite…');
    try{
     const r=await ctx.api.request(path+'/invitations',{method:'POST',body:{
       email:form.elements.email.value,profileKey:form.elements.profileKey.value
     }});
     // Sensitive code is not written to localStorage, URL or console.
     const value=r.invitationToken||'';
     await render(host,ctx);
     const secret=host.querySelector('#saas-invite-secret');
     secret.hidden=false;secret.querySelector('textarea').value=value;
     message(host,'Convite criado. Copie o código agora.','success');
    }catch(e){message(host,e.message,'error');}
   });
   attach(host,ctx);
  }catch(e){host.innerHTML='<section class="page saas-admin"><h1>Administração indisponível</h1><p role="alert">'+esc(e.message)+'</p></section>';}
 }
 function attach(host,ctx){
  const path=base(ctx.api);
  async function mutate(cb,ok){
   message(host,'Processando…');
   try{await cb();ctx.toast?.(ok,'success');await render(host,ctx);}
   catch(e){message(host,e.message,'error');}
  }
  host.querySelector('#saas-tenant-select')?.addEventListener('change',e=>{void ctx.switchTenant?.(e.target.value);});
  host.querySelector('#saas-copy-invite')?.addEventListener('click',async()=>{
   const code=host.querySelector('#saas-invite-code')?.value||'';
   try{await navigator.clipboard.writeText(code);message(host,'Código copiado.','success');}
   catch{host.querySelector('#saas-invite-code')?.select();message(host,'Selecione e copie o código manualmente.');}
  });
  host.querySelectorAll('[data-save-role]').forEach(b=>b.addEventListener('click',()=>{
   const id=b.dataset.saveRole;
   const select=Array.from(host.querySelectorAll('[data-role-user]')).find(s=>s.dataset.roleUser===id);
   void mutate(()=>ctx.api.request(path+'/members/'+urlPart(id)+'/role',{method:'PATCH',body:{profileKey:select.value}}),'Perfil atualizado.');
  }));
  host.querySelectorAll('[data-remove-member]').forEach(b=>b.addEventListener('click',()=>{
   if(!root.confirm('Revogar acesso deste funcionário?'))return;
   void mutate(()=>ctx.api.request(path+'/members/'+urlPart(b.dataset.removeMember)+'/revoke',{method:'POST',body:{}}),'Acesso revogado.');
  }));
  host.querySelectorAll('[data-revoke-invite]').forEach(b=>b.addEventListener('click',()=>{
   void mutate(()=>ctx.api.request(path+'/invitations/'+urlPart(b.dataset.revokeInvite)+'/revoke',{method:'POST',body:{}}),'Convite revogado.');
  }));
  host.querySelectorAll('[data-revoke-session]').forEach(b=>b.addEventListener('click',async()=>{
   const id=b.dataset.revokeSession;const current=b.textContent.includes('Sair');
   try{await ctx.api.request('/api/v1/auth/sessions/'+urlPart(id),{method:'DELETE'});if(current){root.location.assign('/app/');return;}
    ctx.toast?.('Sessão encerrada.','success');await render(host,ctx);
   }catch(e){message(host,e.message,'error');}
  }));
 }
 root.PdvSaasAdmin=Object.freeze({render});
})(window);
