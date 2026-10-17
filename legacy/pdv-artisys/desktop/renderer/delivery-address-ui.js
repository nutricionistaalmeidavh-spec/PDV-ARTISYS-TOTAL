'use strict';
(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;
  const lifecycle=window.PdvUiLifecycle;
  if(!ApiClient||!lifecycle)return;
  const api=new ApiClient();
  const p=ApiClient.prototype;
  let editingCustomerId=null;
  let decorateTimer=null;

  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const digits=v=>String(v||'').replace(/\D+/g,'');
  const field=(name,label,value='',extra='')=>`<div class="field"><label>${esc(label)}</label><input name="${esc(name)}" value="${esc(value)}" ${extra}></div>`;
  const addressFromForm=form=>({
    postalCode:digits(form.elements.namedItem('postalCode')?.value),
    street:String(form.elements.namedItem('street')?.value||'').trim(),
    number:String(form.elements.namedItem('number')?.value||'').trim(),
    complement:String(form.elements.namedItem('complement')?.value||'').trim(),
    district:String(form.elements.namedItem('district')?.value||'').trim(),
    city:String(form.elements.namedItem('city')?.value||'').trim(),
    state:String(form.elements.namedItem('state')?.value||'').trim().toUpperCase(),
    reference:String(form.elements.namedItem('reference')?.value||'').trim()
  });
  const formatAddress=a=>a?`${a.street||''}, ${a.number||'s/n'}${a.complement?` · ${a.complement}`:''} · ${a.district||''} · ${a.city||''}/${a.state||''} · CEP ${a.postalCode||'—'}`:'Endereço não informado';

  const originalSaveCustomer=p.saveCustomer;
  p.saveCustomer=function(body){
    const form=document.getElementById('customer-form');
    if(form?.querySelector('[data-customer-address]'))body={...body,address:addressFromForm(form)};
    return originalSaveCustomer.call(this,body);
  };

  const originalCreateSalesQuote=p.createSalesQuote;
  p.createSalesQuote=function(body){
    const form=document.getElementById('enterprise-order-form');
    if(form&&String(body?.fulfillmentType||'').toUpperCase()==='DELIVERY'){
      body={...body,deliveryAddress:addressFromForm(form),deliveryInstructions:String(form.elements.namedItem('deliveryInstructions')?.value||'').trim()};
    }
    return originalCreateSalesQuote.call(this,body);
  };

  document.addEventListener('click',event=>{
    const edit=event.target.closest('[data-edit-customer]');
    if(edit)editingCustomerId=edit.dataset.editCustomer||null;
    if(event.target.closest('#new-customer'))editingCustomerId=null;
  },true);

  async function enhanceCustomerForm(form){
    if(form.querySelector('[data-customer-address]'))return;
    const grid=form.querySelector('.field-grid');if(!grid)return;
    const section=document.createElement('div');
    section.dataset.customerAddress='true';section.className='field wide';
    section.innerHTML=`<div class="field-grid delivery-address-grid"><div class="field wide"><strong>Endereço para entrega</strong><small>Usado como padrão em pedidos com entrega. O pedido guarda uma cópia do endereço usado.</small></div>${field('postalCode','CEP','','inputmode="numeric" maxlength="9"')}${field('street','Logradouro')}${field('number','Número')}${field('complement','Complemento')}${field('district','Bairro')}${field('city','Cidade')}${field('state','UF','','maxlength="2"')}${field('reference','Referência')}</div>`;
    const active=grid.querySelector('label.field.wide:last-of-type');
    if(active)grid.insertBefore(section,active);else grid.appendChild(section);
    if(!editingCustomerId)return;
    try{
      const customers=await api.customers(true);const customer=customers.find(x=>x.id===editingCustomerId);const a=customer?.address;if(!a)return;
      for(const [name,value] of Object.entries({postalCode:a.postalCode,street:a.street,number:a.number,complement:a.complement,district:a.district,city:a.city,state:a.state,reference:a.reference})){
        const input=form.elements.namedItem(name);if(input)input.value=value||'';
      }
    }catch{}
  }

  async function enhanceOrderForm(form){
    if(form.querySelector('[data-delivery-address]'))return;
    const customerInput=form.elements.namedItem('customerId');
    let customers=[];
    try{customers=await api.customers();}catch{}
    if(customerInput?.tagName==='INPUT'){
      const select=document.createElement('select');select.name='customerId';select.required=true;
      select.innerHTML=`<option value="">Selecione o cliente</option>${customers.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}${c.document?` · ${esc(c.document)}`:''}</option>`).join('')}`;
      customerInput.parentElement?.querySelector('span') && (customerInput.parentElement.querySelector('span').textContent='Cliente');
      customerInput.replaceWith(select);
    }
    const fulfillment=form.elements.namedItem('fulfillmentType');
    const block=document.createElement('div');block.dataset.deliveryAddress='true';block.className='ops-card';
    block.innerHTML=`<h3>Endereço de entrega</h3><p class="ops-muted">O endereço fica congelado no pedido, mesmo que o cadastro do cliente seja alterado depois.</p><div class="ops-form-grid">${field('postalCode','CEP','','inputmode="numeric" maxlength="9"')}${field('street','Logradouro')}${field('number','Número')}${field('complement','Complemento')}${field('district','Bairro')}${field('city','Cidade')}${field('state','UF','','maxlength="2"')}${field('reference','Referência')}<label class="field"><span>Instruções de entrega</span><textarea name="deliveryInstructions" rows="2" placeholder="Portaria, horário, contato ou outra orientação"></textarea></label></div>`;
    form.appendChild(block);
    const customerSelect=form.elements.namedItem('customerId');
    const fillCustomer=()=>{const customer=customers.find(c=>c.id===customerSelect?.value);const a=customer?.address||{};for(const [name,value] of Object.entries({postalCode:a.postalCode,street:a.street,number:a.number,complement:a.complement,district:a.district,city:a.city,state:a.state,reference:a.reference})){const input=form.elements.namedItem(name);if(input)input.value=value||'';}};
    const toggle=()=>{const delivery=fulfillment?.value==='DELIVERY';block.hidden=!delivery;for(const name of ['postalCode','street','number','district','city','state']){const input=form.elements.namedItem(name);if(input)input.required=delivery;}if(delivery)fillCustomer();};
    customerSelect?.addEventListener('change',()=>{if(fulfillment?.value==='DELIVERY')fillCustomer();});
    fulfillment?.addEventListener('change',toggle);toggle();
  }

  async function decorateOrders(){
    const root=document.getElementById('route-content');
    if(root?.querySelector('h1')?.textContent?.trim()!=='Orçamentos e pedidos')return;
    let rows=[];try{rows=await api.salesOrders();}catch{return;}
    const byId=new Map(rows.map(o=>[String(o.id),o]));
    root.querySelectorAll('[data-list] .ops-row').forEach(article=>{
      if(article.querySelector('[data-delivery-summary]'))return;
      const id=article.querySelector('strong')?.textContent?.trim();const order=byId.get(id);if(!order||order.fulfillmentType!=='DELIVERY')return;
      const summary=document.createElement('small');summary.dataset.deliverySummary='true';summary.textContent=`Entrega · ${formatAddress(order.deliveryAddress)}${order.deliveryInstructions?` · Instruções: ${order.deliveryInstructions}`:''}`;
      article.querySelector('div')?.appendChild(summary);
    });
  }

  function scheduleDecorate(){clearTimeout(decorateTimer);decorateTimer=setTimeout(()=>void decorateOrders(),50);}
  lifecycle.on('modal:mounted',()=>{
    const customerForm=document.getElementById('customer-form');if(customerForm)void enhanceCustomerForm(customerForm);
  });
  lifecycle.on('route:updated',({route,surface})=>{
    if(route!=='inventory'||surface!=='enterprise-orders')return;
    const orderForm=document.getElementById('enterprise-order-form');if(orderForm)void enhanceOrderForm(orderForm);
    scheduleDecorate();
  });
  const customerForm=document.getElementById('customer-form');if(customerForm)void enhanceCustomerForm(customerForm);
  const orderForm=document.getElementById('enterprise-order-form');if(orderForm)void enhanceOrderForm(orderForm);
  scheduleDecorate();
})();
