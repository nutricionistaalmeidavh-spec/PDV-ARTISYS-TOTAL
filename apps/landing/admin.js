(()=>{
'use strict';
const $=id=>document.getElementById(id),state={tenants:[],selected:null};
function message(text){$('feedback').textContent=text;}
function el(tag,value,css){const e=document.createElement(tag);if(value!=null)e.textContent=String(value);if(css)e.className=css;return e;}
async function api(path,method='GET',body){
 const result=await fetch('/api/v1/platform/ui/'+path,{method,credentials:'same-origin',
  headers:{...(body?{'content-type':'application/json'}:{})},
  ...(body?{body:JSON.stringify(body)}:{})});
 const data=await result.json().catch(()=>({}));
 if(!result.ok)throw Error(data.error||'Erro HTTP '+result.status);
 return data;
}
function filter(){
 const v=$('status-filter').value,tbody=$('tenants');tbody.replaceChildren();
 const list=state.tenants.filter(t=>v==='all'||(v==='pending'?!t.active:!!t.active));
 if(!list.length){const row=el('tr');const cell=el('td','Nenhum estabelecimento neste filtro.');cell.colSpan=6;row.append(cell);tbody.append(row);return;}
 for(const t of list){
  const tr=el('tr'),name=el('td'),title=el('strong',t.name),slug=el('small',t.slug);name.append(title,slug);tr.append(name);
  tr.append(el('td',t.ownerEmail||'—'));
  const status=el('td');status.append(el('span',t.active?'Aprovada':'Aguardando',t.active?'pill good':'pill pending'));tr.append(status);
  const subscription=el('td');subscription.append(el('span',t.subscriptionStatus||'Não definida',t.subscriptionStatus==='ACTIVE'?'pill good':'pill'));if(t.planKey)subscription.append(el('small',' '+t.planKey));tr.append(subscription);
  tr.append(el('td',t.endsAt?new Date(t.endsAt).toLocaleDateString('pt-BR'):'—'));
  const actions=el('td'),group=el('div',null,'actions');
  if(!t.active){const a=el('button','Aprovar');a.addEventListener('click',()=>approve(t));group.append(a);}
  else{const b=el('button','Assinatura');b.addEventListener('click',()=>edit(t));group.append(b);}
  actions.append(group);tr.append(actions);tbody.append(tr);
 }
}
async function load(){
 const [summary,tenants,audit]=await Promise.all([api('summary'),api('tenants'),api('audit')]);
 state.tenants=tenants.tenants||[];
 $('total').textContent=summary.summary?.totalTenants??'—';
 $('pending').textContent=summary.summary?.pendingTenants??'—';
 $('approved').textContent=summary.summary?.approvedTenants??'—';
 $('active').textContent=(summary.summary?.subscriptions||[]).find(t=>t.status==='ACTIVE')?.total||0;
 filter();const list=$('audit');list.replaceChildren();
 for(const event of (audit.events||[]).slice(0,25)){
  const item=el('li',event.kind+' · '+event.tenantId);
  item.append(el('time',new Date(event.createdAt).toLocaleString('pt-BR')));
  list.append(item);
 }
 $('dashboard').hidden=false;message('');
}
async function disconnect(){
 try{await fetch('/api/v1/platform/auth/logout',{method:'POST',credentials:'same-origin'});}catch{}
 state.tenants=[];$('admin-ticket').value='';$('dashboard').hidden=true;
 $('disconnect').hidden=true;$('connect').hidden=false;message('Acesso encerrado.');
}
async function exchangeTicket(ticket){
 if(typeof ticket!=='string'||!/^[a-f0-9]{64}$/.test(ticket))throw Error('Código temporário inválido.');
 const response=await fetch('/api/v1/platform/auth/exchange',{method:'POST',credentials:'same-origin',
  headers:{'content-type':'application/json'},body:JSON.stringify({ticket})});
 const payload=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(payload.error||'Convite expirado ou já utilizado.');
 await load();$('connect').hidden=true;$('disconnect').hidden=false;
}
$('connect').addEventListener('click',async()=>{
 const token=$('admin-ticket').value.trim();$('admin-ticket').value='';
 $('connect').disabled=true;message('Validando acesso temporário…');
 try{await exchangeTicket(token);}catch(e){message(e.message);}
 finally{$('connect').disabled=false;}
});
$('disconnect').addEventListener('click',disconnect);
const fragment=new URLSearchParams(location.hash.slice(1)),ticket=fragment.get('ticket');
if(location.hash)history.replaceState(null,'',location.pathname);
if(ticket){exchangeTicket(ticket).catch(e=>message(e.message));}
else api('me').then(()=>load()).then(()=>{$('connect').hidden=true;$('disconnect').hidden=false;}).catch(()=>{});
$('refresh').addEventListener('click',()=>load().catch(e=>message(e.message)));
$('status-filter').addEventListener('change',filter);
async function approve(t){
 if(!window.confirm('Aprovar o cadastro de '+t.name+' e habilitar a avaliação gratuita?'))return;
 try{await api('tenants/'+encodeURIComponent(t.id)+'/approve','POST',{});await load();}catch(e){message(e.message);}
}
function edit(t){
 state.selected=t;$('selected-tenant').textContent=t.name+' · '+(t.ownerEmail||'');
 $('plan-key').value=t.planKey||'monthly';$('subscription-status').value=t.subscriptionStatus||'ACTIVE';
 const future=new Date(t.endsAt||Date.now()+30*86400000);
 $('subscription-ends').value=future.toISOString().slice(0,16);
 $('subscription-dialog').showModal();
}
$('cancel-subscription').addEventListener('click',()=>$('subscription-dialog').close());
$('subscription-form').addEventListener('submit',async e=>{
 e.preventDefault();if(!state.selected)return;
 const ends=$('subscription-ends').value,status=$('subscription-status').value,planKey=$('plan-key').value;
 if(!ends){message('Informe a vigência.');return;}
 const btn=$('save-subscription');btn.disabled=true;
 try{
  await api('tenants/'+encodeURIComponent(state.selected.id)+'/subscription','PUT',{status,planKey,endsAt:new Date(ends+'Z').toISOString()});
  $('subscription-dialog').close();await load();
 }catch(e){message(e.message);}finally{btn.disabled=false;}
});
})();