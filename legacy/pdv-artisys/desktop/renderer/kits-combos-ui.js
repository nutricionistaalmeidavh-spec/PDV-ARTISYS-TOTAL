'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;
  const lifecycle=window.PdvUiLifecycle;
  if(!ApiClient||!lifecycle)return;
  const api=new ApiClient();
  const content=document.getElementById('route-content');
  const modalRoot=document.getElementById('modal-root');
  const toastRoot=document.getElementById('toast-root');
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
  const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const cents=value=>{const raw=String(value??'').trim().replace(/\s|R\$/g,'').replace(/\./g,'').replace(',','.');const n=Number(raw);return Number.isFinite(n)?Math.round(n*100):0;};
  const currencyValue=value=>(Number(value||0)/100).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2});
  const localDateTime=value=>{if(!value)return'';const date=new Date(value);if(Number.isNaN(date.getTime()))return'';const local=new Date(date.getTime()-date.getTimezoneOffset()*60000);return local.toISOString().slice(0,16);};
  const toast=(message,type='')=>{if(!toastRoot)return;const node=document.createElement('div');node.className=`toast ${type}`;node.textContent=message;toastRoot.appendChild(node);setTimeout(()=>node.remove(),3500);};
  let mounting=false;

  function closeModal(){if(!modalRoot)return;modalRoot.innerHTML='';modalRoot.classList.add('hidden');}
  function openModal(title,body){if(!modalRoot)return;modalRoot.innerHTML=`<div class="modal-card kit-combo-modal"><div class="modal-head"><h2>${esc(title)}</h2><button class="secondary-button" type="button" data-kc-close>Fechar</button></div>${body}</div>`;modalRoot.classList.remove('hidden');modalRoot.querySelector('[data-kc-close]')?.addEventListener('click',closeModal);modalRoot.addEventListener('click',event=>{if(event.target===modalRoot)closeModal();},{once:true});}

  function productOptions(products,selected=''){return products.map(product=>`<option value="${esc(product.id)}" ${String(selected)===String(product.id)?'selected':''}>${esc(product.name)}${product.sku?` · ${esc(product.sku)}`:''}</option>`).join('');}

  async function showKitModal(kit=null){
    const [products,categories,kits]=await Promise.all([api.products(false),api.categories(true),api.kits(true)]);
    const kitIds=new Set(kits.map(item=>item.id));
    const componentsProducts=products.filter(product=>product.id===kit?.id||!kitIds.has(product.id)).filter(product=>product.id!==kit?.id);
    const initial=kit?.components?.length?kit.components:[{productId:componentsProducts[0]?.id||'',quantity:1}];
    openModal(kit?'Editar kit':'Novo kit',`<form id="kc-kit-form" class="kit-combo-form">
      <div class="kit-combo-form-grid">
        <label>Nome do kit<input name="name" required value="${esc(kit?.name||'')}"></label>
        <label>SKU<input name="sku" value="${esc(kit?.sku||'')}"></label>
        <label>Código de barras<input name="barcode" value="${esc(kit?.barcode||'')}"></label>
        <label>Categoria<select name="categoryId"><option value="">Sem categoria</option>${categories.map(category=>`<option value="${esc(category.id)}" ${category.id===kit?.categoryId?'selected':''}>${esc(category.name)}</option>`).join('')}</select></label>
        <label>Preço de venda (R$)<input name="salePrice" inputmode="decimal" required value="${currencyValue(kit?.salePriceCents||0)}"></label>
        <label>Custo (R$)<input name="cost" inputmode="decimal" value="${currencyValue(kit?.costCents||0)}"></label>
      </div>
      <div><strong>Componentes do estoque</strong><p class="kit-combo-help">A venda baixa estes produtos; o kit não cria um estoque paralelo.</p><div id="kc-components" class="kit-component-list"></div><button id="kc-add-component" class="secondary-button" type="button">+ Componente</button></div>
      <label class="kit-combo-check"><input name="active" type="checkbox" ${kit?.active===false?'':'checked'}> Kit ativo para venda</label>
      <div class="kit-combo-actions"><button class="primary-button" type="submit">Salvar kit</button><button class="secondary-button" type="button" data-kc-cancel>Cancelar</button></div>
    </form>`);
    const host=modalRoot.querySelector('#kc-components');
    const addRow=(component={})=>{const row=document.createElement('div');row.className='kit-component-row';row.dataset.kitComponent='1';row.innerHTML=`<label>Produto<select name="componentProduct" required>${productOptions(componentsProducts,component.productId)}</select></label><label>Qtd.<input name="componentQuantity" type="number" min="0.001" step="0.001" required value="${esc(component.quantity??1)}"></label><button class="danger-button" type="button" title="Remover">×</button>`;row.querySelector('button')?.addEventListener('click',()=>row.remove());host.appendChild(row);};
    initial.forEach(addRow);
    modalRoot.querySelector('#kc-add-component')?.addEventListener('click',()=>addRow({productId:componentsProducts[0]?.id||'',quantity:1}));
    modalRoot.querySelector('[data-kc-cancel]')?.addEventListener('click',closeModal);
    modalRoot.querySelector('#kc-kit-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);const components=[...host.querySelectorAll('[data-kit-component]')].map(row=>({productId:row.querySelector('[name="componentProduct"]').value,quantity:Number(row.querySelector('[name="componentQuantity"]').value)}));try{await api.saveKit({id:kit?.id,name:form.get('name'),sku:form.get('sku'),barcode:form.get('barcode'),categoryId:form.get('categoryId')||null,salePriceCents:cents(form.get('salePrice')),costCents:cents(form.get('cost')),components,active:form.get('active')==='on'});toast('Kit salvo.','success');closeModal();setTimeout(()=>window.location.reload(),250);}catch(error){toast(error.message,'error');}});
  }

  async function showComboModal(combo=null){
    const products=await api.products(false);const selected=new Set(combo?.productIds||[]);
    openModal(combo?'Editar combo promocional':'Novo combo promocional',`<form id="kc-combo-form" class="kit-combo-form">
      <div class="kit-combo-form-grid">
        <label>Nome da promoção<input name="name" required value="${esc(combo?.name||'')}"></label>
        <label>Tipo<select name="selectionMode"><option value="SAME_PRODUCT" ${combo?.selectionMode==='ANY_SELECTED'?'':'selected'}>Mesmo produto</option><option value="ANY_SELECTED" ${combo?.selectionMode==='ANY_SELECTED'?'selected':''}>Misturar produtos selecionados</option></select></label>
        <label>Quantidade necessária<input name="requiredQuantity" type="number" min="2" step="1" required value="${esc(combo?.requiredQuantity||3)}"></label>
        <label>Preço do combo (R$)<input name="bundlePrice" inputmode="decimal" required value="${currencyValue(combo?.bundlePriceCents||0)}"></label>
        <label>Máximo de aplicações por venda<input name="maxApplications" type="number" min="1" step="1" placeholder="Sem limite" value="${esc(combo?.maxApplicationsPerSale??'')}"></label>
        <label>Início opcional<input name="startsAt" type="datetime-local" value="${esc(localDateTime(combo?.startsAt))}"></label>
        <label>Fim opcional<input name="endsAt" type="datetime-local" value="${esc(localDateTime(combo?.endsAt))}"></label>
      </div>
      <div><strong>Produtos participantes</strong><p class="kit-combo-help">No modo “Mesmo produto”, cada SKU completa sua própria quantidade. No modo “Misturar”, os produtos marcados podem completar a quantidade juntos.</p><div class="kit-combo-product-picker">${products.map(product=>`<label><input type="checkbox" name="productId" value="${esc(product.id)}" ${selected.has(product.id)?'checked':''}> <span>${esc(product.name)} <small>${money(product.salePriceCents)}</small></span></label>`).join('')}</div></div>
      <div class="kit-combo-form-grid"><label class="kit-combo-check"><input name="allowManualDiscount" type="checkbox" ${combo?.allowManualDiscount===false?'':'checked'}> Permitir acumular desconto manual</label><label class="kit-combo-check"><input name="active" type="checkbox" ${combo?.active===false?'':'checked'}> Combo ativo</label></div>
      <div class="kit-combo-actions"><button class="primary-button" type="submit">Salvar combo</button><button class="secondary-button" type="button" data-kc-cancel>Cancelar</button></div>
    </form>`);
    modalRoot.querySelector('[data-kc-cancel]')?.addEventListener('click',closeModal);
    modalRoot.querySelector('#kc-combo-form')?.addEventListener('submit',async event=>{event.preventDefault();const form=new FormData(event.currentTarget);try{await api.savePromotionalCombo({id:combo?.id,name:form.get('name'),selectionMode:form.get('selectionMode'),requiredQuantity:Number(form.get('requiredQuantity')),bundlePriceCents:cents(form.get('bundlePrice')),maxApplicationsPerSale:form.get('maxApplications')?Number(form.get('maxApplications')):null,startsAt:form.get('startsAt')||null,endsAt:form.get('endsAt')||null,allowManualDiscount:form.get('allowManualDiscount')==='on',active:form.get('active')==='on',productIds:form.getAll('productId')});toast('Combo promocional salvo.','success');closeModal();await refreshProductsAdmin();}catch(error){toast(error.message,'error');}});
  }

  function kitLine(kit){const composition=(kit.components||[]).map(item=>`${item.quantity}× ${item.productName||item.productId}`).join(' · ')||'Sem componentes';return `<div class="kit-combo-item"><div><strong>${esc(kit.name)} · ${money(kit.salePriceCents)}</strong><small>${esc(composition)}</small><small class="kit-combo-status ${kit.active?'active':'inactive'}">${kit.active?'Ativo':'Inativo'}</small></div><button class="secondary-button" type="button" data-edit-kit="${esc(kit.id)}">Editar</button></div>`;}
  function comboLine(combo){const mode=combo.selectionMode==='ANY_SELECTED'?'misturando selecionados':'do mesmo produto';const products=(combo.products||[]).map(item=>item.productName).join(', ');const validity=combo.startsAt||combo.endsAt?` · ${combo.startsAt?new Date(combo.startsAt).toLocaleDateString('pt-BR'):'agora'} até ${combo.endsAt?new Date(combo.endsAt).toLocaleDateString('pt-BR'):'sem fim'}`:'';return `<div class="kit-combo-item"><div><strong>${esc(combo.name)} · ${combo.requiredQuantity} por ${money(combo.bundlePriceCents)}</strong><small>${esc(mode)} · ${esc(products||'Sem produtos')}${esc(validity)}</small><small>${combo.maxApplicationsPerSale?`Máx. ${combo.maxApplicationsPerSale}/venda · `:''}${combo.allowManualDiscount?'aceita desconto manual':'não acumula desconto manual'}</small><small class="kit-combo-status ${combo.active?'active':'inactive'}">${combo.active?'Ativo':'Inativo'}</small></div><button class="secondary-button" type="button" data-edit-combo="${esc(combo.id)}">Editar</button></div>`;}

  async function refreshProductsAdmin(){
    const page=content?.querySelector('section.page');const heading=page?.querySelector('.page-head h1');if(!page||!['Produtos','Cardápio'].includes(heading?.textContent.trim()))return;
    page.querySelector('[data-kit-combo-admin]')?.remove();
    const [kits,combos]=await Promise.all([api.kits(true),api.promotionalCombos(true)]);if(!page.isConnected)return;
    const section=document.createElement('section');section.className='data-card kit-combo-admin product-support-card';section.dataset.kitComboAdmin='1';section.innerHTML=`<details open><summary><span><strong>Kits e combos</strong><small>Combos promocionais e kits montados</small></span></summary><div class="product-support-body"><p>Preço, quantidade, produtos, validade e regras definidos pelo usuário.</p><div class="kit-combo-grid"><div class="kit-combo-column"><h3>Kits</h3><div class="kit-combo-list">${kits.map(kitLine).join('')||'<div class="kit-combo-empty">Nenhum kit cadastrado.</div>'}</div></div><div class="kit-combo-column"><h3>Combos promocionais</h3><div class="kit-combo-list">${combos.map(comboLine).join('')||'<div class="kit-combo-empty">Nenhum combo cadastrado.</div>'}</div></div></div></div></details>`;
    let supportGrid=page.querySelector('.product-support-grid');
    if(!supportGrid){supportGrid=document.createElement('div');supportGrid.className='product-support-grid';page.appendChild(supportGrid);}
    supportGrid.appendChild(section);
    section.querySelectorAll('[data-edit-kit]').forEach(button=>button.addEventListener('click',()=>showKitModal(kits.find(item=>item.id===button.dataset.editKit))));
    section.querySelectorAll('[data-edit-combo]').forEach(button=>button.addEventListener('click',()=>showComboModal(combos.find(item=>item.id===button.dataset.editCombo))));
  }

  async function mountProducts(){
    if(mounting||!content)return;const page=content.querySelector('section.page');const heading=page?.querySelector('.page-head h1');if(!page||!['Produtos','Cardápio'].includes(heading?.textContent.trim())||page.dataset.kitComboMounted==='1')return;
    mounting=true;page.dataset.kitComboMounted='1';
    try{
      const header=page.querySelector('.page-head');const actions=header?.children?.[1]||header;const secondaryMenu=actions?.querySelector('[data-products-secondary-actions-menu]')||actions;
      if(secondaryMenu&&!secondaryMenu.querySelector('[data-new-kit]')){const grouped=secondaryMenu!==actions;const kitButton=document.createElement('button');kitButton.className=grouped?'products-secondary-action':'secondary-button';kitButton.type='button';kitButton.dataset.newKit='1';kitButton.textContent='+ Kit';kitButton.addEventListener('click',()=>showKitModal());const comboButton=document.createElement('button');comboButton.className=grouped?'products-secondary-action':'secondary-button';comboButton.type='button';comboButton.dataset.newCombo='1';comboButton.textContent='+ Combo';comboButton.addEventListener('click',()=>showComboModal());secondaryMenu.prepend(comboButton);secondaryMenu.prepend(kitButton);}
      await refreshProductsAdmin();
    }catch(error){page.dataset.kitComboMounted='';console.warn('Kits/combos UI indisponível:',error?.message||error);}finally{mounting=false;}
  }

  function mountPromotionRow(){
    if(!content)return;const totals=content.querySelector('.sale-panel .totals');if(!totals)return;
    const sale=window.PdvPromotionState?.lastSale;const promo=Number(sale?.promotionDiscountCents||0);
    const existingRow=totals.querySelector('[data-promotion-row]');
    const existingHint=totals.querySelector('[data-promo-locked]');
    const discount=document.getElementById('discount-percent');
    if(!sale||!['OPEN','SUSPENDED'].includes(sale.status)||promo<=0){existingRow?.remove();existingHint?.remove();if(discount)discount.disabled=false;return;}
    const names=(sale.promotions||[]).map(item=>item.name).join(', ');const signature=`${promo}|${names}`;
    let row=existingRow;
    if(!row){row=document.createElement('div');row.className='total-row promotion-total';row.dataset.promotionRow='1';totals.querySelector('.grand-total')?.before(row);}
    if(row.dataset.promotionSignature!==signature){row.dataset.promotionSignature=signature;row.innerHTML=`<span>Combo/Promoção${names?`<small>${esc(names)}</small>`:''}</span><strong>− ${money(promo)}</strong>`;}
    if(sale.blocksManualDiscount&&discount){discount.disabled=true;if(!existingHint){const hint=document.createElement('div');hint.dataset.promoLocked='1';hint.className='promo-locked-hint';hint.textContent='Este combo não permite desconto manual acumulado.';discount.closest('.total-row')?.appendChild(hint);}}
    else{if(discount)discount.disabled=false;existingHint?.remove();}
  }

  const onRouteChange=({route})=>{
    if(route==='products')void mountProducts();
    if(route==='checkout')mountPromotionRow();
  };
  lifecycle.on('route:mounted',onRouteChange);
  lifecycle.on('route:updated',onRouteChange);
  const currentRoute=document.body.dataset.activeRoute||'';
  if(currentRoute)onRouteChange({route:currentRoute});
})();
