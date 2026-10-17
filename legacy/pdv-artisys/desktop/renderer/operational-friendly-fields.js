'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;const content=document.getElementById('route-content');const lifecycle=window.PdvUiLifecycle;
  if(!ApiClient||!content||!lifecycle)return;
  const api=new ApiClient();const cache=new Map();let scheduled=false;
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const loaders={productId:()=>api.products(),customerId:()=>api.customers(),operatorId:()=>api.users(),sellerId:()=>api.sellers(),serviceId:()=>api.request('/api/v1/vertical/services/catalog'),professionalId:()=>api.request('/api/v1/vertical/services/professionals'),orderId:()=>api.delivery()};
  const labels={productId:'Produto',customerId:'Cliente',operatorId:'Operador',sellerId:'Vendedor',serviceId:'Serviço',professionalId:'Profissional',sessionId:'Mesa ou comanda',orderId:'Pedido',referenceId:'Produto ou serviço'};
  const display=(name,row)=>name==='productId'?`${row.name}${row.sku?` · ${row.sku}`:''}`:name==='customerId'?`${row.name}${row.document?` · ${row.document}`:''}`:row.name||row.customerName||row.username||row.id;
  const rows=name=>{if(!cache.has(name))cache.set(name,loaders[name]().catch(()=>[]));return cache.get(name);};
  async function replaceWithSelect(input,name){
    if(input.dataset.friendlyField||!loaders[name]||input.type==='hidden')return;input.dataset.friendlyField='loading';
    const values=await rows(name);if(!input.isConnected)return;
    const select=document.createElement('select');select.name=input.name;select.className=input.className;select.required=input.required;select.disabled=input.disabled;select.dataset.friendlyField='1';
    select.innerHTML=`<option value="">Selecione por nome</option>${values.filter(row=>row.active!==false).map(row=>`<option value="${esc(row.id)}" ${String(input.value)===String(row.id)?'selected':''}>${esc(display(name,row))}</option>`).join('')}`;
    for(const attribute of ['id','aria-label'])if(input.hasAttribute(attribute))select.setAttribute(attribute,input.getAttribute(attribute));
    input.replaceWith(select);
  }
  function relabel(input,name){const label=input.closest('label');const caption=label?.querySelector('span')||label?.childNodes?.[0];if(caption?.nodeType===Node.ELEMENT_NODE)caption.textContent=labels[name];else if(caption?.nodeType===Node.TEXT_NODE)caption.textContent=labels[name];input.placeholder=input.placeholder||`Selecione ${labels[name].toLowerCase()}`;}
  function enhance(){
    scheduled=false;
    content.querySelectorAll('input[name],select[name]').forEach(input=>{const name=input.name;if(!labels[name])return;relabel(input,name);if(input.tagName==='INPUT')void replaceWithSelect(input,name);});
    content.querySelectorAll('label > span,label:not(:has(*)),th,small').forEach(node=>{if(node.children.length)return;const before=node.textContent;const after=before.replace(/ID\s+(?:do\s+|da\s+)?produto\/serviço/gi,'Produto ou serviço').replace(/ID\s+(?:do\s+|da\s+)?produto/gi,'Produto').replace(/ID\s+(?:do\s+|da\s+)?comanda/gi,'Comanda').replace(/ID\s+profissional/gi,'Profissional').replace(/ID\s+OS/gi,'Ordem de serviço').replace(/ID\s+(?:do\s+|da\s+)?pedido/gi,'Pedido').replace(/ID\s+(?:do\s+|da\s+)?tamanho/gi,'Tamanho').replace(/ID\s+(?:do\s+|da\s+)?borda/gi,'Borda').replace(/IDs?\s+(?:do\s+|da\s+|dos\s+|das\s+)?sabores/gi,'Sabores').replace(/ID\s+(?:do\s+|da\s+)?cliente/gi,'Cliente').replace(/ID\s+(?:do\s+|da\s+)?veículo\/equipamento/gi,'Veículo ou equipamento').replace(/ID\s+(?:do\s+|da\s+)?item/gi,'Item').replace(/ID\s+(?:do\s+|da\s+)?divisão/gi,'Divisão');if(after!==before)node.textContent=after;});
  }
  const schedule=()=>{if(scheduled)return;scheduled=true;queueMicrotask(enhance);};
  lifecycle.on('route:mounted',schedule);
  lifecycle.on('route:updated',schedule);
  lifecycle.on('surface:mounted',schedule);
  lifecycle.on('modal:mounted',schedule);
  schedule();
})();
