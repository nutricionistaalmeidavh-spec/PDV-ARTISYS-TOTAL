'use strict';

(()=>{
  const ApiClient=window.PdvApiClient?.ApiClient;
  const lifecycle=window.PdvUiLifecycle;
  const content=document.getElementById('route-content');
  const modalRoot=document.getElementById('modal-root');
  if(!ApiClient||!lifecycle||!content||!modalRoot)return;

  const api=new ApiClient();
  let currentUser=null;
  let mounting=false;
  let remountRequested=false;
  const removedCustomerIds=new Set();

  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const can=capability=>Boolean(window.PdvAccessPolicy?.hasCapability(currentUser,capability));
  const toast=(message,type='')=>window.PdvToast?.show?.(message,type);

  async function session(){
    if(currentUser)return currentUser;
    try{currentUser=(await api.currentSession()).user;return currentUser;}
    catch{return null;}
  }

  function closeModal(){
    modalRoot.classList.add('hidden');
    modalRoot.innerHTML='';
  }

  function modal(title,body,onMount){
    modalRoot.classList.remove('hidden');
    modalRoot.innerHTML=`<section class="modal-card"><header><h2>${esc(title)}</h2><button type="button" class="modal-close" data-catalog-remove-close>×</button></header>${body}</section>`;
    modalRoot.querySelector('[data-catalog-remove-close]')?.addEventListener('click',closeModal);
    onMount?.(modalRoot);
  }

  function confirmRemoval(label,item,action,refresh){
    if(!item)return;
    modal(`Excluir ${label}`,`<p>Excluir <strong>${esc(item.name)}</strong> do cadastro ativo?</p><p>O registro não será apagado fisicamente: o histórico continuará preservado.</p><div class="modal-actions"><button type="button" class="secondary-button" data-catalog-remove-close>Cancelar</button><button type="button" class="danger-button" data-catalog-remove-confirm>Excluir</button></div>`,root=>{
      root.querySelectorAll('[data-catalog-remove-close]').forEach(button=>button.addEventListener('click',closeModal));
      root.querySelector('[data-catalog-remove-confirm]')?.addEventListener('click',async()=>{
        try{await action();closeModal();toast(`${item.name} removido do cadastro ativo. Histórico preservado.`,'success');await refresh?.();}
        catch(error){toast(error.message,'error');}
      });
    });
  }

  async function enhanceCustomers(){
    await session();
    if(document.body.dataset.activeRoute!=='customers')return;
    const root=content.querySelector('.page');
    if(!root)return;

    if(!can('customers.manage')){
      root.querySelector('#new-customer')?.remove();
      root.querySelectorAll('[data-edit-customer],[data-remove-customer]').forEach(button=>button.remove());
      return;
    }

    root.querySelectorAll('[data-edit-customer]').forEach(button=>{
      const id=String(button.dataset.editCustomer||'');
      const row=button.closest('.data-row');
      if(!id||!row)return;
      if(removedCustomerIds.has(id)){row.remove();return;}
      if(row.querySelector('[data-remove-customer]'))return;

      const remove=document.createElement('button');
      remove.type='button';
      remove.className='danger-button';
      remove.dataset.removeCustomer=id;
      remove.textContent='Excluir';
      button.insertAdjacentElement('afterend',remove);

      remove.addEventListener('click',async()=>{
        let customer=null;
        try{customer=(await api.customers()).find(item=>String(item.id)===id)||null;}catch{}
        if(!customer)return toast('Não foi possível carregar o cliente para exclusão.','error');
        confirmRemoval('cliente',customer,async()=>{
          const result=await api.removeCustomer(id);
          removedCustomerIds.add(id);
          return result;
        },async()=>row.remove());
      });
    });
  }

  async function enhanceProducts(){
    await session();
    if(document.body.dataset.activeRoute!=='products')return;
    const root=content.querySelector('.page');
    if(!root)return;

    if(!can('products.manage')){
      root.querySelector('#new-product')?.remove();
      root.querySelector('#new-category')?.remove();
      root.querySelectorAll('[data-edit-product],[data-remove-product],[data-remove-category]').forEach(button=>button.remove());
      return;
    }

    if(root.querySelector('#catalog-category-management'))return;
    const [categories,products]=await Promise.all([api.categories(),api.products()]);
    let supportGrid=root.querySelector('.product-support-grid');
    if(!supportGrid){supportGrid=document.createElement('div');supportGrid.className='product-support-grid';root.appendChild(supportGrid);}

    const card=document.createElement('section');
    card.id='catalog-category-management';
    card.className='data-card product-support-card';
    card.innerHTML=`<details><summary><span><strong>Categorias</strong><small>${categories.length} categorias ativas</small></span></summary><div class="product-support-body"><p>Excluir uma categoria não apaga o histórico dos produtos vinculados.</p>${categories.map(category=>{
      const linked=products.filter(product=>product.categoryId===category.id);
      return `<div class="data-row"><div><strong>${esc(category.name)}</strong><small>${linked.length}${linked.length===1?' produto':' produtos'}</small></div><div></div><div></div><button type="button" class="danger-button" data-remove-category="${esc(category.id)}">Excluir</button></div>`;
    }).join('')||'<div class="empty-state">Nenhuma categoria ativa.</div>'}</div></details>`;
    supportGrid.appendChild(card);

    card.querySelectorAll('[data-remove-category]').forEach(button=>button.addEventListener('click',()=>{
      const category=categories.find(item=>item.id===button.dataset.removeCategory);
      confirmRemoval('categoria',category,()=>api.removeCategory(category.id),async()=>{card.remove();await enhanceProducts();});
    }));
  }

  async function enhanceSuppliers(){
    await session();
    if(!can('suppliers.manage'))return;
    const form=content.querySelector('#enterprise-supplier-form');
    if(!form||content.querySelector('#catalog-supplier-management'))return;

    const suppliers=await api.suppliers();
    const host=form.closest('.ops-card');
    if(!host)return;

    const box=document.createElement('div');
    box.id='catalog-supplier-management';
    box.className='catalog-supplier-management';
    box.innerHTML=`<h3>Fornecedores ativos</h3>${suppliers.map(supplier=>`<div class="ops-row"><div><strong>${esc(supplier.name)}</strong><small>${esc(supplier.document||'Sem documento')}</small></div><button type="button" class="danger-button" data-remove-supplier="${esc(supplier.id)}">Excluir</button></div>`).join('')||'<p class="ops-muted">Nenhum fornecedor ativo.</p>'}`;
    host.appendChild(box);

    box.querySelectorAll('[data-remove-supplier]').forEach(button=>button.addEventListener('click',()=>{
      const supplier=suppliers.find(item=>item.id===button.dataset.removeSupplier);
      confirmRemoval('fornecedor',supplier,()=>api.removeSupplier(supplier.id),async()=>{box.remove();await enhanceSuppliers();});
    }));
  }

  async function mount(){
    if(mounting){remountRequested=true;return;}
    mounting=true;
    try{
      await session();
      const route=document.body.dataset.activeRoute;
      if(route==='customers')await enhanceCustomers();
      else if(route==='products')await enhanceProducts();
      else if(route==='inventory')await enhanceSuppliers();
    }catch(error){
      console.warn('Catalog removal UI unavailable:',error?.message||error);
    }finally{
      mounting=false;
      if(remountRequested){remountRequested=false;scheduleMount();}
    }
  }

  const scheduleMount=()=>queueMicrotask(()=>void mount());
  lifecycle.on('route:mounted',scheduleMount);
  lifecycle.on('route:updated',({route,surface})=>{
    if(route==='customers'&&surface==='customers-list')scheduleMount();
    if(route==='inventory'&&surface==='enterprise-purchases')scheduleMount();
  });
  lifecycle.on('user:changed',()=>{currentUser=null;scheduleMount();});
  void mount();
})();
