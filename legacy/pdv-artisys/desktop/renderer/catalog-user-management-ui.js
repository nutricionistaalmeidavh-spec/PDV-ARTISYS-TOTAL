'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;
  const content=document.getElementById('route-content');
  const modalRoot=document.getElementById('modal-root');
  const toastRoot=document.getElementById('toast-root');
  const lifecycle=window.PdvUiLifecycle;
  if(!ApiClient||!content||!lifecycle)return;
  const api=new ApiClient();
  let mounting=false;
  let remountRequested=false;
  let currentUser=null;
  const removedCustomerIds=new Set();

  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const roleLabel=role=>({admin:'Administrador',manager:'Gerente',cashier:'Operador / vendedor'})[role]||role;
  const canManageCatalog=()=>['admin','manager'].includes(currentUser?.role);
  const isAdmin=()=>currentUser?.role==='admin';
  function toast(message,type=''){if(window.PdvToast?.show){window.PdvToast.show(message,type);return;}if(!toastRoot)return;const el=document.createElement('div');el.className=`toast ${type}`;el.textContent=message;toastRoot.appendChild(el);setTimeout(()=>el.remove(),3500);}
  async function session(){if(currentUser)return currentUser;try{currentUser=(await api.currentSession()).user;return currentUser;}catch{return null;}}
  function closeModal(){if(!modalRoot)return;modalRoot.classList.add('hidden');modalRoot.innerHTML='';}
  function modal(title,body,onMount){if(!modalRoot)return;modalRoot.classList.remove('hidden');modalRoot.innerHTML=`<section class="modal-card"><header><h2>${esc(title)}</h2><button type="button" class="modal-close" data-catalog-modal-close>×</button></header>${body}</section>`;modalRoot.querySelector('[data-catalog-modal-close]')?.addEventListener('click',closeModal);onMount?.(modalRoot);}
  function heading(){return content.querySelector('.page h1,.ops-page h1')?.textContent?.trim()||'';}

  async function renderUsers({force=false}={}){
    await session();
    if(!['admin','manager'].includes(currentUser?.role))return;
    const page=content.querySelector('.page');if(!page||heading()!=='Equipe e acessos')return;
    const existing=page.querySelector('#catalog-user-management-users');
    if(existing&&!force)return;
    existing?.remove();
    const users=await api.users(true);
    const panel=page.querySelector('.data-card')||document.createElement('section');panel.id='catalog-user-management-users';panel.className='data-card';
    panel.innerHTML=`<div style="padding:14px"><nav class="category-chips" aria-label="Seções de equipe"><button class="category-chip active" type="button" data-team-tab="people">Pessoas</button><button class="category-chip" type="button" data-team-tab="access">Acessos</button><button class="category-chip" type="button" data-team-tab="roles">Papéis e permissões</button><button class="category-chip" type="button" data-team-tab="commissions">Comissões</button></nav><header class="page-head"><div><h2>Pessoas</h2><p>Cadastre a equipe e defina, no mesmo fluxo, se a pessoa terá login e quais áreas poderá usar.</p></div><button type="button" class="primary-button" id="catalog-new-user">+ Nova pessoa</button></header><div data-team-panel="people">${users.map(user=>{
      const managerBlocked=currentUser.role==='manager'&&user.role==='admin';
      const status=user.active?'Ativo':'Inativo';
      const activation=isAdmin()?(user.active?`<button type="button" class="danger-button" data-remove-user="${esc(user.id)}">Desativar</button>`:`<button type="button" class="secondary-button" data-reactivate-user="${esc(user.id)}">Ativar</button>`):'';
      return `<div class="data-row" data-user-row="${esc(user.id)}"><div><strong>${esc(user.name)}</strong><small>${user.active?`@${esc(user.username)}`:'Sem acesso ao sistema'}${user.email?` · ${esc(user.email)}`:''}</small></div><div><small>Função</small><strong>${esc(roleLabel(user.role))}</strong></div><div><small>Acesso</small><strong>${status}</strong></div><div style="display:flex;gap:8px;justify-content:flex-end"><button type="button" class="secondary-button" data-edit-user="${esc(user.id)}" ${managerBlocked?'disabled title="Somente administrador pode alterar administradores"':''}>Editar</button>${activation}</div></div>`;
    }).join('')||'<div class="empty-state">Nenhuma pessoa cadastrada.</div>'}</div><div data-team-panel="access" hidden><h2>Acessos</h2><p>Ative, desative ou edite o login de cada pessoa na aba Pessoas. O histórico operacional é sempre preservado.</p></div><div data-team-panel="roles" hidden><h2>Papéis e permissões</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Papel</th><th>Áreas liberadas</th></tr></thead><tbody><tr><td>Operador</td><td>PDV, caixa, clientes e consultas operacionais</td></tr><tr><td>Gerente</td><td>Operação, estoque, financeiro, relatórios, gestão e equipe</td></tr><tr><td>Administrador</td><td>Todas as áreas, configurações e segurança</td></tr></tbody></table></div></div><div data-team-panel="commissions" hidden><h2>Comissões</h2><p>As regras e o acompanhamento de comissões ficam nos relatórios, vinculados à pessoa selecionada.</p><button type="button" class="secondary-button" data-route="reports">Abrir relatórios de comissão</button></div></div>`;
    if(!panel.parentElement)page.appendChild(panel);
    panel.querySelectorAll('[data-team-tab]').forEach(button=>button.addEventListener('click',()=>{panel.querySelectorAll('[data-team-tab]').forEach(item=>item.classList.toggle('active',item===button));panel.querySelectorAll('[data-team-panel]').forEach(item=>{item.hidden=item.dataset.teamPanel!==button.dataset.teamTab;});}));
    panel.querySelector('#catalog-new-user')?.addEventListener('click',()=>openUserForm());
    panel.querySelectorAll('[data-edit-user]').forEach(button=>button.addEventListener('click',()=>{const user=users.find(item=>item.id===button.dataset.editUser);if(user)openUserForm(user);}));
    panel.querySelectorAll('[data-remove-user]').forEach(button=>button.addEventListener('click',()=>confirmUserDeactivation(users.find(item=>item.id===button.dataset.removeUser))));
    panel.querySelectorAll('[data-reactivate-user]').forEach(button=>button.addEventListener('click',async()=>{const user=users.find(item=>item.id===button.dataset.reactivateUser);if(!user)return;try{await api.saveUser({id:user.id,name:user.name,username:user.username,email:user.email||'',role:user.role,password:'',active:true});toast('Usuário ativado.','success');await renderUsers({force:true});}catch(error){toast(error.message,'error');}}));
  }

  function openUserForm(user=null){
    const editing=Boolean(user);const admin=isAdmin();
    if(currentUser?.role==='manager'&&user?.role==='admin')return toast('Somente administrador pode alterar administradores.','error');
    const roles=admin?['cashier','manager','admin']:['cashier','manager'];
    modal(editing?'Editar pessoa':'Nova pessoa',`<form id="catalog-user-form"><div class="field-grid"><div class="field wide"><label>Nome *</label><input name="name" required value="${esc(user?.name||'')}"></div><div class="field"><label>E-mail</label><input name="email" type="email" value="${esc(user?.email||'')}"></div><div class="field"><label>Função *</label><select name="role">${roles.map(role=>`<option value="${role}" ${(user?.role||'cashier')===role?'selected':''}>${esc(roleLabel(role))}</option>`).join('')}</select></div><label class="field wide"><span><input name="hasLogin" type="checkbox" ${user?.active===false?'':'checked'}> Esta pessoa terá login no sistema</span></label><div data-login-fields class="field-grid wide"><div class="field"><label>Usuário *</label><input name="username" autocomplete="off" value="${esc(user?.username||'')}"></div><div class="field"><label>${editing?'Nova senha (opcional)':'Senha *'}</label><input name="password" type="password" minlength="10" autocomplete="new-password"></div></div><div class="field wide"><label>Áreas liberadas pelo papel</label><div data-role-areas class="ops-muted"></div></div></div><div class="modal-actions"><button type="button" class="secondary-button" data-catalog-modal-close>Cancelar</button><button type="submit" class="primary-button">Salvar pessoa</button></div></form>`,root=>{
      root.querySelectorAll('[data-catalog-modal-close]').forEach(button=>button.addEventListener('click',closeModal));
      const form=root.querySelector('#catalog-user-form');const login=form.elements.namedItem('hasLogin');const role=form.elements.namedItem('role');const areas={cashier:'PDV · Caixa · Clientes',manager:'Operação · Estoque · Financeiro · Relatórios · Gestão · Equipe',admin:'Todas as áreas · Configurações · Segurança'};
      const sync=()=>{const enabled=login.checked;root.querySelector('[data-login-fields]').hidden=!enabled;form.elements.namedItem('username').required=enabled;form.elements.namedItem('password').required=enabled&&!editing;root.querySelector('[data-role-areas]').textContent=areas[role.value]||'';};login.addEventListener('change',sync);role.addEventListener('change',sync);sync();
      form.addEventListener('submit',async event=>{event.preventDefault();const data=new FormData(form);const hasLogin=login.checked;const fallback=`sem-acesso-${String(data.get('name')||'pessoa').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')}-${Date.now().toString(36)}`;try{await api.saveUser({id:user?.id,name:String(data.get('name')||''),username:hasLogin?String(data.get('username')||''):(user?.username||fallback),email:String(data.get('email')||''),role:String(data.get('role')||''),password:hasLogin?String(data.get('password')||''):(editing?'':`${crypto.randomUUID()}Aa1!`),active:hasLogin});closeModal();toast(editing?'Pessoa atualizada.':'Pessoa criada.','success');await renderUsers({force:true});}catch(error){toast(error.message,'error');}});
    });
  }

  function confirmUserDeactivation(user){
    if(!user)return;
    modal('Desativar usuário',`<p>Desativar <strong>${esc(user.name)}</strong>? O histórico será preservado e o acesso será encerrado.</p><div class="modal-actions"><button type="button" class="secondary-button" data-catalog-modal-close>Cancelar</button><button type="button" class="danger-button" id="catalog-confirm-remove-user">Desativar</button></div>`,root=>{root.querySelectorAll('[data-catalog-modal-close]').forEach(button=>button.addEventListener('click',closeModal));root.querySelector('#catalog-confirm-remove-user')?.addEventListener('click',async()=>{try{await api.removeUser(user.id);closeModal();toast('Usuário desativado. Histórico preservado.','success');await renderUsers({force:true});}catch(error){toast(error.message,'error');}});});
  }

  async function enhanceCustomers(){
    await session();const root=content.querySelector('.page');if(!root||heading()!=='Clientes')return;
    if(!canManageCatalog()){
      root.querySelector('#new-customer')?.remove();
      root.querySelectorAll('[data-edit-customer]').forEach(button=>button.remove());
      return;
    }
    root.dataset.catalogDeletionEnhanced='1';
    root.querySelectorAll('[data-edit-customer]').forEach(button=>{
      const id=String(button.dataset.editCustomer||'');const row=button.closest('.data-row');
      if(removedCustomerIds.has(id)){row?.remove();return;}
      if(row?.querySelector('[data-remove-customer]'))return;
      const remove=document.createElement('button');remove.type='button';remove.className='danger-button';remove.dataset.removeCustomer=id;remove.textContent='Excluir';button.insertAdjacentElement('afterend',remove);
      remove.addEventListener('click',async()=>{
        let customer=null;try{customer=(await api.customers()).find(item=>String(item.id)===id)||null;}catch{}
        if(!customer)return toast('Não foi possível carregar o cliente para exclusão.','error');
        confirmCatalogRemoval('cliente',customer,async()=>{const result=await api.removeCustomer(id);removedCustomerIds.add(id);return result;},async()=>{row?.remove();});
      });
    });
  }

  async function enhanceProducts(){
    await session();const root=content.querySelector('.page');if(!root||!['Produtos','Cardápio'].includes(heading()))return;
    if(!canManageCatalog()){
      root.querySelector('#new-product')?.remove();root.querySelector('#new-category')?.remove();
      root.querySelectorAll('[data-edit-product],[data-remove-product]').forEach(button=>button.remove());return;
    }
    if(root.querySelector('#catalog-category-management'))return;
    const [categories,products]=await Promise.all([api.categories(),api.products()]);
    let supportGrid=root.querySelector('.product-support-grid');
    if(!supportGrid){supportGrid=document.createElement('div');supportGrid.className='product-support-grid';root.appendChild(supportGrid);}
    const card=document.createElement('section');card.id='catalog-category-management';card.className='data-card product-support-card';
    card.innerHTML=`<details open><summary><span><strong>Categorias</strong><small>${categories.length} categorias ativas</small></span></summary><div class="product-support-body"><p>Produtos de cada categoria e seu histórico permanecem vinculados.</p>${categories.map(category=>{const linked=products.filter(product=>product.categoryId===category.id);return `<div class="data-row"><div><strong>${esc(category.name)}</strong><small>${linked.length?`${linked.length} produto(s): ${linked.slice(0,4).map(product=>esc(product.name)).join(', ')}${linked.length>4?'…':''}`:'Nenhum produto associado'}</small></div><div></div><div></div><button type="button" class="danger-button" data-remove-category="${esc(category.id)}">Excluir</button></div>`;}).join('')||'<div class="empty-state">Nenhuma categoria ativa.</div>'}</div></details>`;
    supportGrid.appendChild(card);
    card.querySelectorAll('[data-remove-category]').forEach(button=>button.addEventListener('click',()=>{const category=categories.find(item=>item.id===button.dataset.removeCategory);confirmCatalogRemoval('categoria',category,()=>api.removeCategory(category.id),async()=>{card.remove();await enhanceProducts();});}));
  }

  async function enhanceSuppliers(){
    await session();if(!canManageCatalog())return;
    const form=content.querySelector('#enterprise-supplier-form');if(!form||content.querySelector('#catalog-supplier-management'))return;
    const suppliers=await api.suppliers();const host=form.closest('.ops-card');if(!host)return;
    const box=document.createElement('div');box.id='catalog-supplier-management';box.style.marginTop='14px';
    box.innerHTML=`<h3>Fornecedores ativos</h3>${suppliers.map(supplier=>`<div class="ops-row"><div><strong>${esc(supplier.name)}</strong><small>${esc(supplier.document||'Sem documento')}</small></div><button type="button" class="danger-button" data-remove-supplier="${esc(supplier.id)}">Excluir</button></div>`).join('')||'<p class="ops-muted">Nenhum fornecedor ativo.</p>'}`;
    host.appendChild(box);
    box.querySelectorAll('[data-remove-supplier]').forEach(button=>button.addEventListener('click',()=>{const supplier=suppliers.find(item=>item.id===button.dataset.removeSupplier);confirmCatalogRemoval('fornecedor',supplier,()=>api.removeSupplier(supplier.id),async()=>{box.remove();content.querySelector(`#enterprise-po-form option[value="${CSS.escape(supplier.id)}"]`)?.remove();await enhanceSuppliers();});}));
  }

  function confirmCatalogRemoval(label,item,action,refresh){
    if(!item)return;
    modal(`Excluir ${label}`,`<p>Excluir <strong>${esc(item.name)}</strong> do cadastro ativo?</p><p>O registro não será apagado fisicamente: vendas, compras e demais históricos continuarão preservados.</p><div class="modal-actions"><button type="button" class="secondary-button" data-catalog-modal-close>Cancelar</button><button type="button" class="danger-button" id="catalog-confirm-remove">Excluir</button></div>`,root=>{root.querySelectorAll('[data-catalog-modal-close]').forEach(button=>button.addEventListener('click',closeModal));root.querySelector('#catalog-confirm-remove')?.addEventListener('click',async()=>{try{await action();closeModal();toast(`${item.name} removido do cadastro ativo. Histórico preservado.`,'success');await refresh?.();}catch(error){toast(error.message,'error');}});});
  }

  async function mount(){
    if(mounting){remountRequested=true;return;}mounting=true;
    try{
      await session();const title=heading();
      if(title==='Equipe e acessos')await renderUsers();
      else if(title==='Clientes')await enhanceCustomers();
      else if(['Produtos','Cardápio'].includes(title))await enhanceProducts();
      else if(title==='Compras e recebimentos')await enhanceSuppliers();
    }catch(error){console.warn('Catalog/user management UI unavailable:',error?.message||error);}finally{mounting=false;if(remountRequested){remountRequested=false;scheduleMount();}}
  }

  const scheduleMount=()=>queueMicrotask(()=>void mount());
  lifecycle.on('route:mounted',scheduleMount);
  lifecycle.on('route:updated',({route,surface})=>{
    if(route==='customers'&&surface==='customers-list')scheduleMount();
    if(route==='inventory'&&surface==='enterprise-purchases')scheduleMount();
  });
  lifecycle.on('surface:mounted',({surface})=>{if(surface==='module-workspace')scheduleMount();});
  lifecycle.on('user:changed',()=>{currentUser=null;scheduleMount();});
  void mount();
})();
