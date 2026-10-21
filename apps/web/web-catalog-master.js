'use strict';

// Stock owns the master register; Cardápio only selects what is offered for sale.
(() => {
  const root=window,ApiClient=root.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const api=new ApiClient();
  if(!api.webMode)return;
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=value=>(Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const qty=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
  const editable=()=>root.PdvAccessPolicy?.hasCapability(root.PdvCurrentAccess,'products.manage')===true;
  let generation=0;

  async function mount(host=document.getElementById('route-content')){
    if(!host||document.body.dataset.activeRoute!=='inventory')return;
    const parent=host.querySelector('.ops-page')||host;
    let panel=parent.querySelector('#web-catalog-master');
    if(!panel){
      panel=document.createElement('section');panel.id='web-catalog-master';panel.className='ops-card';
      const heading=parent.querySelector('.ops-head');
      if(heading)heading.insertAdjacentElement('afterend',panel);else parent.prepend(panel);
    }
    const token=++generation;
    const current=()=>token===generation&&panel.isConnected&&host.contains(panel)&&document.body.dataset.activeRoute==='inventory';
    panel.innerHTML='<h2>Cadastro mestre</h2><p>Carregando produtos, insumos e fichas técnicas…</p>';
    try{
      const products=await api.products(true);
      if(!current())return;
      if(!Array.isArray(products))throw Error('Não foi possível consultar os produtos.');
      const recipes=new Map(),failures=[];
      const candidates=products.filter(p=>p.active!==false&&p.trackStock===false);
      let cursor=0;
      await Promise.all(Array.from({length:Math.min(4,candidates.length)},async()=>{
        while(cursor<candidates.length){
          if(!current())return;
          const product=candidates[cursor++];
          try{
            const result=await api.request('/api/v1/recipes/'+encodeURIComponent(product.id));
            if(result.recipe)recipes.set(product.id,result.recipe);
          }catch(error){failures.push({product,message:error.message||'Consulta indisponível'});}
        }
      }));
      if(!current())return;
      panel.innerHTML='<div class="ops-head"><div><h2>Cadastro mestre</h2><p>Produtos, insumos e fichas técnicas. Adicione ao Cardápio somente os itens que serão vendidos.</p></div><div class="ops-head-actions">'+
        (editable()?'<button class="ops-primary" type="button" data-master-product>+ Produto / insumo</button><button class="secondary-button" type="button" data-master-recipe>+ Ficha técnica</button>':'')+
        '<button class="secondary-button" type="button" data-master-menu>Abrir Cardápio</button></div></div>'+
        '<p>'+products.length+' cadastro(s) · '+recipes.size+' ficha(s) técnica(s)</p>'+
        (failures.length?'<div role="alert"><strong>Algumas fichas não puderam ser consultadas.</strong><p>'+failures.map(f=>esc(f.product.name)+': '+esc(f.message)).join('<br>')+'</p><button class="secondary-button" type="button" data-master-retry>Tentar novamente</button></div>':'')+
        '<div data-master-recipe-choice hidden><h3>Criar ou editar ficha técnica</h3><label class="field"><span>Produto preparado já cadastrado</span><select data-master-prepared><option value="">Selecione o produto</option>'+
        candidates.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.name)+(recipes.has(p.id)?' · já possui ficha':'')+'</option>').join('')+'</select></label>'+
        '<div class="ops-head-actions"><button class="secondary-button" type="button" data-master-open-recipe>Continuar com o produto selecionado</button><button class="ops-primary" type="button" data-master-new-prepared>Criar produto preparado</button></div></div>'+
        '<label class="field"><span>Buscar produto, insumo ou ficha</span><input class="ops-input" type="search" data-master-search placeholder="Nome ou código"></label>'+
        '<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Produto / insumo</th><th>Uso</th><th>Rendimento e custo</th><th>Ações</th></tr></thead><tbody data-master-rows></tbody></table></div>';
      const body=panel.querySelector('[data-master-rows]');
      const renderRows=(query='')=>{
        const normalized=query.trim().toLocaleLowerCase('pt-BR');
        const matches=products.filter(p=>!normalized||(String(p.name)+' '+String(p.sku||'')).toLocaleLowerCase('pt-BR').includes(normalized));
        body.innerHTML=matches.map(p=>{
          const recipe=recipes.get(p.id),failed=failures.some(f=>f.product.id===p.id),badges=[];
          if(p.active===false)badges.push('Inativo');
          if(p.menuEnabled!==false)badges.push('No Cardápio');
          if(p.usageType==='INGREDIENT'||p.usageType==='BOTH')badges.push('Insumo');
          if(recipe)badges.push('Ficha técnica');else if(p.trackStock===false)badges.push('Sem estoque próprio');
          const summary=recipe?qty(recipe.yieldQuantity)+' '+esc(recipe.yieldUnit||'UN')+' por receita · porção '+qty(recipe.portionQuantity)+' '+esc(recipe.yieldUnit||'UN')+
            '<br>Custo da receita '+money(recipe.theoreticalCostCents)+' · por porção '+money(recipe.costPerPortionCents)+
            '<br>Capacidade atual: '+qty(recipe.capacity)+' porções':failed?'Consulta da ficha indisponível':p.trackStock!==false?'Saldo: '+qty(p.balance??p.stockQuantity)+' '+esc(p.unit||'UN'):'Sem ficha cadastrada';
          return '<tr><td><strong>'+esc(p.name)+'</strong><br><small>'+esc(p.sku||'')+'</small></td><td>'+badges.map(b=>'<span class="ops-badge">'+b+'</span>').join(' ')+'</td><td>'+summary+'</td><td>'+
            (editable()?'<button class="secondary-button" type="button" data-master-edit="'+esc(p.id)+'">Editar cadastro</button>'+((p.active!==false&&p.trackStock===false)?'<button class="secondary-button" type="button" data-master-edit-recipe="'+esc(p.id)+'">'+(recipe?'Editar ficha':'Criar ficha')+'</button>':''):'—')+'</td></tr>';
        }).join('')||'<tr><td colspan="4">Nenhum cadastro encontrado.</td></tr>';
      };
      renderRows();
      panel.querySelector('[data-master-search]').addEventListener('input',event=>renderRows(event.target.value));
      panel.onclick=async event=>{
        const button=event.target.closest('button');if(!button||!current())return;
        try{
          if(button.matches('[data-master-menu]'))return void root.PdvAppNavigation?.navigate?.('products');
          if(button.matches('[data-master-retry]'))return void mount(host);
          if(!editable())return;
          if(button.matches('[data-master-product]'))return void root.PdvCatalogAdmin?.openStockProductForm?.();
          if(button.matches('[data-master-recipe]')){panel.querySelector('[data-master-recipe-choice]').hidden=false;panel.querySelector('[data-master-prepared]').focus();return;}
          if(button.matches('[data-master-new-prepared]'))return void root.PdvCatalogAdmin?.openPreparedProductForm?.();
          if(button.matches('[data-master-open-recipe]')){
            const product=products.find(p=>p.id===panel.querySelector('[data-master-prepared]').value);
            if(!product)throw Error('Selecione o produto preparado ou crie um novo.');
            return void root.PdvCatalogAdmin?.openRecipeForm?.(product);
          }
          const product=products.find(p=>p.id===(button.dataset.masterEdit||button.dataset.masterEditRecipe));
          if(!product)return;
          if(button.hasAttribute('data-master-edit-recipe'))return void root.PdvCatalogAdmin?.openRecipeForm?.(product);
          if(button.hasAttribute('data-master-edit'))return void root.PdvCatalogAdmin?.openStockProductForm?.(product);
        }catch(error){root.PdvToast?.show?.(error.message,'error');}
      };
    }catch(error){
      if(current()){
        panel.innerHTML='<h2>Cadastro mestre</h2><p role="alert">'+esc(error.message)+'</p><button class="secondary-button" type="button">Tentar novamente</button>';
        panel.querySelector('button').addEventListener('click',()=>void mount(host));
      }
    }
  }
  const onRoute=({route,surface})=>{if(route==='inventory'&&!String(surface||'').startsWith('enterprise-'))void mount();};
  root.PdvUiLifecycle?.on('route:mounted',onRoute);
  root.PdvUiLifecycle?.on('route:updated',onRoute);
  root.PdvUiLifecycle?.on('route:before',()=>{generation++;});
  root.PdvWebCatalogMaster=Object.freeze({mount});
})();
