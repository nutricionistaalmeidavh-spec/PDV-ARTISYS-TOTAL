'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const api=new ApiClient();
  const content=document.getElementById('route-content');
  const modalRoot=document.getElementById('modal-root');
  const lifecycle=window.PdvUiLifecycle;
  if(!lifecycle)return;
  let config=null;
  let products=[];
  let variants=[];
  let catalogLoadedAt=0;
  let scheduled=false;
  let enhancing=false;
  let rerunRequested=false;
  let selectedVariantItemId=null;

  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'})[char]);
  const money=value=>(Number(value||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const cents=value=>{const normalized=String(value??'').trim().replace(/\./g,'').replace(',','.');const number=Number(normalized);return Number.isFinite(number)?Math.round(number*100):0;};
  const qty=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));

  function toast(message,type=''){
    window.PdvToast?.show?.(message,type);
  }
  function closeModal(){modalRoot?.classList.add('hidden');if(modalRoot)modalRoot.innerHTML='';}
  function openModal(title,body){
    if(!modalRoot)return;
    modalRoot.classList.remove('hidden');
    modalRoot.innerHTML=`<section class="modal-card modal-wide"><header class="modal-head"><h2>${esc(title)}</h2><button class="modal-close" type="button" data-pv-close>×</button></header><div class="modal-body">${body}</div></section>`;
    modalRoot.querySelector('[data-pv-close]')?.addEventListener('click',closeModal);
    modalRoot.addEventListener('click',event=>{if(event.target===modalRoot)closeModal();},{once:true});
  }

  async function ensureConfig(){if(!config)config=await api.initialize();return config;}
  async function loadCatalog(force=false){
    if(!force&&Date.now()-catalogLoadedAt<700&&products.length)return;
    const [nextProducts,nextVariants]=await Promise.all([api.products(true),api.request('/api/v1/product-variants?includeInactive=true')]);
    products=Array.isArray(nextProducts)?nextProducts:[];
    variants=Array.isArray(nextVariants)?nextVariants:[];
    catalogLoadedAt=Date.now();
  }
  function parent(id){return products.find(product=>product.id===String(id));}
  function children(productId,{activeOnly=false}={}){return variants.filter(variant=>variant.productId===String(productId)&&(!activeOnly||variant.active!==false));}
  function attrsText(attributes={}){return Object.entries(attributes||{}).map(([key,value])=>`${key}: ${value}`).join('; ');}
  function parseAttributes(text){const result={};for(const part of String(text||'').split(';')){const [rawKey,...rest]=part.split(':');const key=String(rawKey||'').trim();const value=rest.join(':').trim();if(key&&value)result[key]=value;}return result;}
  function variantMatches(variant,query){const q=String(query||'').trim().toLowerCase();if(!q)return false;const product=parent(variant.productId);return[variant.name,variant.sku,variant.barcode,product?.name,attrsText(variant.attributes)].some(value=>String(value||'').toLowerCase().includes(q));}
  function exactVariant(query){const q=String(query||'').trim().toLowerCase();return variants.find(variant=>variant.active!==false&&[variant.sku,variant.barcode].some(value=>String(value||'').toLowerCase()===q));}
  function baseProductCard(){
    const canonical=content?.querySelector('#products-list');if(canonical)return canonical;
    const preferred=content?.querySelector('.page .toolbar + .data-card');
    if(preferred?.querySelector('[data-edit-product]'))return preferred;
    return [...(content?.querySelectorAll('.page .data-card')||[])].find(card=>card.querySelector('[data-edit-product]'))||null;
  }

  function variantRowHtml(variant){
    const product=parent(variant.productId);const inactive=variant.active===false?' · Inativa':'';
    return `<div class="data-row variant-child-row" data-product-variant-row="${esc(variant.variantId)}"><div><strong><span class="variant-branch">↳</span>${esc(product?.name||variant.productName)} — ${esc(variant.name)}</strong><small>${esc(variant.sku||'Sem SKU')}${variant.barcode?` · ${esc(variant.barcode)}`:''}${inactive}${attrsText(variant.attributes)?` · ${esc(attrsText(variant.attributes))}`:''}</small></div><div><small>Preço / custo</small><strong>${money(variant.unitPriceCents)} / ${money(variant.costCents)}</strong></div><div><small>Estoque da variação</small><strong>${qty(variant.quantity)} UN</strong></div><button class="secondary-button" type="button" data-edit-product-variant="${esc(variant.variantId)}">Editar variação</button></div>`;
  }

  async function enhanceProducts(){
    await loadCatalog();
    const card=baseProductCard();if(!card)return;
    card.querySelectorAll('.variant-child-row,.variant-search-label').forEach(node=>node.remove());
    const visibleParents=new Set();
    for(const row of [...card.querySelectorAll('.data-row')]){
      const edit=row.querySelector('[data-edit-product]');if(!edit)continue;
      const productId=edit.dataset.editProduct;visibleParents.add(productId);
      row.querySelectorAll('.variant-parent-badge,.variant-add-button,.variant-parent-stock').forEach(node=>node.remove());
      const list=children(productId);const activeList=list.filter(item=>item.active!==false);
      const totalStock=activeList.reduce((sum,item)=>sum+Number(item.quantity||0),0);const product=parent(productId);
      if(list.length)edit.dataset.parentHasVariants='true';else delete edit.dataset.parentHasVariants;
      const title=row.querySelector('div:first-child strong');
      if(title&&list.length){const badge=document.createElement('span');badge.className='variant-parent-badge';badge.textContent=`Produto pai · ${activeList.length} variação${activeList.length===1?'':'ões'} ativa${activeList.length===1?'':'s'}`;title.insertAdjacentElement('afterend',badge);}
      const stockCell=row.querySelector('[data-product-stock-cell]')||row.children[2];if(stockCell&&list.length){const stockValue=stockCell.querySelector('strong');if(stockValue)stockValue.textContent=`${qty(totalStock)} ${product?.unit||'UN'}`;const label=document.createElement('small');label.className='variant-parent-stock';label.textContent='Estoque controlado nos subitens';stockCell.appendChild(label);}
      if(!product?.prepared){const add=document.createElement('button');add.type='button';add.className='secondary-button variant-add-button';add.dataset.newProductVariant=productId;add.textContent='+ Variação';edit.insertAdjacentElement('beforebegin',add);}
      let anchor=row;for(const variant of list){const wrapper=document.createElement('div');wrapper.innerHTML=variantRowHtml(variant);const child=wrapper.firstElementChild;anchor.insertAdjacentElement('afterend',child);anchor=child;}
    }
    const query=content.querySelector('#product-page-search')?.value||'';
    if(query){const missing=variants.filter(variant=>variantMatches(variant,query)&&!visibleParents.has(variant.productId));if(missing.length){const label=document.createElement('div');label.className='variant-search-label';label.textContent='Variações encontradas';card.appendChild(label);for(const variant of missing.slice(0,30)){const wrapper=document.createElement('div');wrapper.innerHTML=variantRowHtml(variant);card.appendChild(wrapper.firstElementChild);}}}
  }

  async function openVariantForm(productId,variantId=null){
    await loadCatalog(true);const product=parent(productId);const variant=variants.find(item=>item.variantId===String(variantId));if(!product)return toast('Produto pai não encontrado.','error');
    const finalPrice=variant?.unitPriceCents??product.salePriceCents??0;
    openModal(variant?'Editar variação':'Nova variação',`<form id="product-variant-form"><div class="variant-form-note"><strong>Produto pai:</strong> ${esc(product.name)}. Cada variação terá SKU/código de barras, preço, custo e estoque próprios. Ao criar a primeira variação, o estoque deixa de ser controlado no item pai; se o pai já tiver saldo, ajuste esse saldo antes.</div><div class="field-grid"><div class="field wide"><label>Nome da variação *</label><input name="name" required placeholder="Ex.: Uva, Limão, 2 L, Tamanho M" value="${esc(variant?.name||'')}"></div><div class="field"><label>SKU / código</label><input name="sku" value="${esc(variant?.sku||'')}"></div><div class="field"><label>Código de barras</label><input name="barcode" value="${esc(variant?.barcode||'')}"></div><div class="field"><label>Preço de venda</label><input name="salePrice" inputmode="decimal" value="${(finalPrice/100).toFixed(2).replace('.',',')}"></div><div class="field"><label>Custo</label><input name="cost" inputmode="decimal" value="${(Number(variant?.costCents??product.costCents??0)/100).toFixed(2).replace('.',',')}"></div><div class="field"><label>Estoque</label><input name="stock" type="number" min="0" step="0.001" value="${Number(variant?.quantity||0)}"></div><div class="field wide"><label>Atributos</label><input name="attributes" placeholder="Ex.: Sabor: Uva; Volume: 25 g; Tamanho: M" value="${esc(attrsText(variant?.attributes))}"></div></div><div class="modal-actions"><button type="button" class="secondary-button" data-pv-close-form>Cancelar</button><button class="primary-button" type="submit">Salvar variação</button></div></form>`);
    modalRoot.querySelector('[data-pv-close-form]')?.addEventListener('click',closeModal);
    modalRoot.querySelector('#product-variant-form')?.addEventListener('submit',async event=>{
      event.preventDefault();const form=event.currentTarget;const value=name=>form.elements.namedItem(name)?.value??'';
      try{
        const saved=await api.request('/api/v1/product-variants',{method:'POST',body:{id:variant?.variantId,productId:product.id,name:value('name'),sku:value('sku'),barcode:value('barcode'),salePriceCents:cents(value('salePrice')),costCents:cents(value('cost')),attributes:parseAttributes(value('attributes')),active:true}});
        await api.request(`/api/v1/product-variants/${encodeURIComponent(saved.variantId)}/stock`,{method:'PUT',body:{quantity:Number(value('stock')||0)}});
        closeModal();await loadCatalog(true);refreshCurrentRoute();toast('Variação salva.','success');
      }catch(error){toast(error.message,'error');}
    });
  }

  async function openVariantPicker(productId){
    await loadCatalog(true);const product=parent(productId);const list=children(productId,{activeOnly:true});if(!product||!list.length)return toast('Este produto não possui variações ativas.','error');
    openModal(`Escolher ${product.name}`,`<div class="variant-form-note">Selecione o subitem. O estoque será baixado somente da variação escolhida.</div><div class="variant-picker-grid">${list.map(variant=>`<button type="button" class="variant-picker-card" data-pick-product-variant="${esc(variant.variantId)}" ${Number(variant.quantity||0)<=0?'disabled':''}><strong>${esc(variant.name)}</strong><small>${esc(variant.sku||variant.barcode||'Sem código')} · Estoque ${qty(variant.quantity)}</small><span class="variant-price">${money(variant.unitPriceCents)}</span></button>`).join('')}</div>`);
    modalRoot.querySelectorAll('[data-pick-product-variant]').forEach(button=>button.addEventListener('click',()=>addVariantToSale(button.dataset.pickProductVariant)));
  }

  async function currentOpenSale({create=false}={}){
    await ensureConfig();
    const remembered=window.PdvPromotionState?.lastSale;
    if(remembered?.status==='OPEN'&&remembered.terminalId===config.terminalId){try{const sale=await api.sale(remembered.id);if(sale?.status==='OPEN')return sale;}catch{}}
    const stored=sessionStorage.getItem('artisys.productVariantSaleId');
    if(stored){try{const sale=await api.sale(stored);if(sale?.status==='OPEN')return sale;}catch{}sessionStorage.removeItem('artisys.productVariantSaleId');}
    const find=async()=>{const sales=await api.sales('OPEN',30);return sales.find(sale=>sale.terminalId===config.terminalId)||null;};
    let sale=await find();if(sale){sessionStorage.setItem('artisys.productVariantSaleId',sale.id);return sale;}
    if(!create)return null;
    document.getElementById('new-sale')?.click();
    for(let attempt=0;attempt<8;attempt++){await delay(80);sale=await find();if(sale){sessionStorage.setItem('artisys.productVariantSaleId',sale.id);return sale;}}
    throw new Error('Inicie uma venda antes de adicionar a variação.');
  }

  function refreshCurrentRoute(){
    const selector=content?.querySelector('.checkout-layout')?'#sidebar-nav [data-route="checkout"]':'#sidebar-nav [data-route="products"]';
    const button=document.querySelector(selector);if(button)button.click();else scheduleEnhance();
  }

  async function addVariantToSale(variantId){
    try{const sale=await currentOpenSale({create:true});await api.request(`/api/v1/product-variants/sales/${encodeURIComponent(sale.id)}/items`,{method:'POST',body:{variantId,quantity:1}});sessionStorage.setItem('artisys.productVariantSaleId',sale.id);selectedVariantItemId=null;closeModal();refreshCurrentRoute();toast('Variação adicionada.','success');}catch(error){toast(error.message,'error');}
  }

  function directVariantCard(variant){const product=parent(variant.productId);return `<button type="button" class="product-card variant-product-card" data-direct-product-variant="${esc(variant.variantId)}"><div><div class="product-visual"><span>${esc(String(variant.name||'?').slice(0,2).toUpperCase())}</span></div><h3>${esc(product?.name||variant.productName)} — ${esc(variant.name)}</h3><small>${esc(variant.sku||variant.barcode||'Sem código')} · estoque ${qty(variant.quantity)}</small></div><strong>${money(variant.unitPriceCents)}<span class="add-cart">+</span></strong></button>`;}

  async function decorateCart(){
    const sale=await currentOpenSale({create:false});if(!sale)return;
    const lines=[...content.querySelectorAll('.cart-line')];
    for(let index=0;index<lines.length;index++){
      const line=lines[index];const item=sale.items?.[index];const variant=item?.configuration?.productVariant;if(!variant)continue;
      line.classList.add('variant-cart-line');line.dataset.variantItemId=item.id;line.dataset.variantSaleId=sale.id;
      if(item.id===selectedVariantItemId)line.classList.add('variant-selected');
      const title=line.querySelector('div:first-child strong');if(title)title.textContent=`${item.productName} — ${variant.name}`;
      const small=line.querySelector('div:first-child small');if(small)small.textContent=`${money(item.unitPriceCents)} · ${variant.sku||variant.barcode||'variação'}`;
    }
  }

  async function enhanceCheckout(){
    await loadCatalog();
    content.querySelectorAll('.variant-search-label,.variant-product-card').forEach(node=>node.remove());
    for(const card of content.querySelectorAll('.product-card[data-add-product]')){
      const list=children(card.dataset.addProduct,{activeOnly:true});
      if(!list.length){delete card.dataset.parentHasVariants;continue;}
      card.dataset.parentHasVariants='true';
      const small=card.querySelector('small');if(small)small.textContent=`${list.length} variação${list.length===1?'':'ões'} · escolher`;
      const add=card.querySelector('.add-cart');if(add)add.textContent='›';
    }
    const search=content.querySelector('#product-search');const query=search?.value||'';const grid=content.querySelector('.product-grid');
    if(grid&&query.trim().length>=2){const matches=variants.filter(variant=>variant.active!==false&&variantMatches(variant,query)).slice(0,12);if(matches.length){const label=document.createElement('div');label.className='variant-search-label';label.textContent='Subitens / variações';grid.appendChild(label);for(const variant of matches){const wrapper=document.createElement('div');wrapper.innerHTML=directVariantCard(variant);grid.appendChild(wrapper.firstElementChild);}}}
    await decorateCart();
  }

  async function mutateVariantLine(line,action){
    const saleId=line?.dataset.variantSaleId;const itemId=line?.dataset.variantItemId;if(!saleId||!itemId)return;
    try{const sale=await api.sale(saleId);const item=sale.items?.find(entry=>entry.id===itemId);if(!item)return;
      if(action==='remove'||(action==='minus'&&Number(item.quantity)<=1))await api.request(`/api/v1/product-variants/sales/${encodeURIComponent(saleId)}/items/${encodeURIComponent(itemId)}`,{method:'DELETE'});
      else{const quantity=Number(item.quantity)+(action==='plus'?1:-1);await api.request(`/api/v1/product-variants/sales/${encodeURIComponent(saleId)}/items/${encodeURIComponent(itemId)}`,{method:'PUT',body:{quantity}});}
      selectedVariantItemId=null;refreshCurrentRoute();
    }catch(error){toast(error.message,'error');}
  }
  async function removeSelectedVariant(){
    if(!selectedVariantItemId)return false;
    const line=[...content.querySelectorAll('.cart-line[data-variant-item-id]')].find(node=>node.dataset.variantItemId===selectedVariantItemId);
    if(!line){selectedVariantItemId=null;return false;}
    await mutateVariantLine(line,'remove');return true;
  }

  function lockParentStockForm(){
    const checkbox=modalRoot?.querySelector('#product-form [name="trackStock"]');if(!checkbox)return;
    checkbox.checked=false;checkbox.disabled=true;
    const field=checkbox.closest('.field');if(field&&!field.querySelector('.variant-parent-stock')){const note=document.createElement('small');note.className='variant-parent-stock';note.textContent='Estoque controlado nas variações deste produto.';field.appendChild(note);}
  }

  async function enhance(){
    if(enhancing){rerunRequested=true;return;}
    enhancing=true;
    try{
      if(content?.querySelector('.checkout-layout'))await enhanceCheckout();
      else if(['Produtos','Cardápio'].includes(content?.querySelector('.page h1')?.textContent?.trim()))await enhanceProducts();
    }catch(error){
      console.warn('Variações de produto indisponíveis; mantendo catálogo base.',error?.message||error);
    }finally{
      enhancing=false;
      if(rerunRequested){rerunRequested=false;scheduleEnhance();}
    }
  }
  function scheduleEnhance(){if(scheduled)return;scheduled=true;setTimeout(()=>{scheduled=false;void enhance();},25);}

  document.addEventListener('click',event=>{
    const parentEdit=event.target.closest?.('[data-edit-product][data-parent-has-variants="true"]');if(parentEdit)setTimeout(lockParentStockForm,0);
    const newVariant=event.target.closest?.('[data-new-product-variant]');if(newVariant){event.preventDefault();event.stopImmediatePropagation();void openVariantForm(newVariant.dataset.newProductVariant);return;}
    const editVariant=event.target.closest?.('[data-edit-product-variant]');if(editVariant){event.preventDefault();event.stopImmediatePropagation();const variant=variants.find(item=>item.variantId===editVariant.dataset.editProductVariant);if(variant)void openVariantForm(variant.productId,variant.variantId);return;}
    const direct=event.target.closest?.('[data-direct-product-variant]');if(direct){event.preventDefault();event.stopImmediatePropagation();void addVariantToSale(direct.dataset.directProductVariant);return;}
    const parentCard=event.target.closest?.('.product-card[data-parent-has-variants="true"]');if(parentCard){event.preventDefault();event.stopImmediatePropagation();void openVariantPicker(parentCard.dataset.addProduct);return;}
    const line=event.target.closest?.('.cart-line[data-variant-item-id]');if(line){
      const plus=event.target.closest?.('[data-qty-plus]');const minus=event.target.closest?.('[data-qty-minus]');const remove=event.target.closest?.('[data-remove]');
      if(plus||minus||remove){event.preventDefault();event.stopImmediatePropagation();void mutateVariantLine(line,plus?'plus':minus?'minus':'remove');return;}
      event.preventDefault();event.stopImmediatePropagation();selectedVariantItemId=line.dataset.variantItemId;content.querySelectorAll('.variant-selected').forEach(node=>node.classList.remove('variant-selected'));line.classList.add('variant-selected');return;
    }
    if(event.target.closest?.('.cart-line'))selectedVariantItemId=null;
    const removeButton=event.target.closest?.('#remove-item');if(removeButton&&selectedVariantItemId){event.preventDefault();event.stopImmediatePropagation();void removeSelectedVariant();}
  },true);

  window.addEventListener('artisys:product-form-opened',event=>{
    const productId=String(event.detail?.productId||'');
    if(productId&&variants.some(item=>String(item.productId)===productId))setTimeout(lockParentStockForm,0);
  });

  window.addEventListener('keydown',event=>{
    if(event.key==='F3'&&selectedVariantItemId){event.preventDefault();event.stopImmediatePropagation();void removeSelectedVariant();return;}
    if(event.key==='Enter'&&event.target?.id==='product-search'){
      const variant=exactVariant(event.target.value);if(variant){event.preventDefault();event.stopImmediatePropagation();void addVariantToSale(variant.variantId);}
    }
  },true);

  const onRouteChange=({route})=>{if(route==='products'||route==='checkout')scheduleEnhance();};
  lifecycle.on('route:mounted',onRouteChange);
  lifecycle.on('route:updated',onRouteChange);
  if(['products','checkout'].includes(document.body.dataset.activeRoute||''))scheduleEnhance();
})();
