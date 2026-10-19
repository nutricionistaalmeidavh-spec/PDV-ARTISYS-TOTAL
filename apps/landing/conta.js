(()=>{
'use strict';
const $=id=>document.getElementById(id);
let session=null,owners=[],selected=null,plans=[],codes=[];
const notify=s=>{$('notice').textContent=s;};
async function api(path,method='GET',body){
 const r=await fetch('/api/v1/'+path,{method,credentials:'same-origin',headers:{accept:'application/json',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(data.error||'Erro HTTP '+r.status);
 return data;
}
async function bootstrap(){
 try{session=await api('auth/session');}catch{$('auth-required').hidden=false;return;}
 $('content').hidden=false;$('user-name').textContent=session.user.displayName;$('user-email').textContent=session.user.email;
 await refreshSecurity();owners=(session.memberships||[]).filter(t=>t.profileKey==='OWNER');
 if(owners.length){$('billing-owner').hidden=false;$('billing-not-owner').hidden=true;
  for(const owner of owners){const opt=document.createElement('option');opt.value=owner.tenantId;opt.textContent=owner.name;$('tenant').append(opt);}
  $('tenant').addEventListener('change',refreshBilling);await refreshBilling();
 }
}
async function refreshSecurity(){
 try{const status=await api('auth/security');
  $('verified').textContent=status.emailVerified?'E-mail confirmado':'Confirmação de e-mail pendente';
  $('email-actions').hidden=status.emailVerified;$('mfa-enroll').hidden=status.mfaEnabled;
  $('mfa-disable').hidden=!status.mfaEnabled;$('mfa-status').textContent=status.mfaEnabled?'MFA habilitado na sua conta.':'MFA ainda não habilitado.';
 }catch(e){notify(e.message);}
}
$('send-verification').addEventListener('click',async()=>{
 try{await api('auth/email/request','POST',{});notify('Link de confirmação enviado para seu e-mail.');}
 catch(e){notify(e.message);}
});
$('enroll-form').addEventListener('submit',async e=>{
 e.preventDefault();try{
  const result=await api('auth/mfa/enroll','POST',{password:e.target.elements.password.value});
  $('mfa-secret').textContent=result.secret;$('mfa-otp-link').href=result.otpauthUrl;
  $('mfa-setup').hidden=false;notify('Digite o segredo no aplicativo autenticador e confirme o código.');
 }catch(err){notify(err.message);}
});
$('confirm-form').addEventListener('submit',async e=>{
 e.preventDefault();try{
  const result=await api('auth/mfa/confirm','POST',{code:e.target.elements.code.value});
  codes=result.recoveryCodes||[];$('codes').textContent=codes.join('\n');$('recovery').hidden=false;$('mfa-setup').hidden=true;
  await refreshSecurity();notify('MFA ativado. Guarde os códigos de recuperação.');
 }catch(err){notify(err.message);}
});
$('copy-codes').addEventListener('click',()=>navigator.clipboard.writeText(codes.join('\n')).then(()=>notify('Códigos copiados.'),()=>notify('Não foi possível copiar.')));
$('disable-form').addEventListener('submit',async e=>{
 e.preventDefault();
 if(!confirm('Desativar a autenticação em duas etapas desta conta?'))return;
 try{await api('auth/mfa/disable','POST',{password:e.target.elements.password.value,code:e.target.elements.code.value});
 await refreshSecurity();notify('MFA desativado.');}catch(err){notify(err.message);}
});
function selectedPlan(){return document.querySelector('input[name=period]:checked')?.value||null;}
async function refreshBilling(){
 selected=$('tenant').value;if(!selected)return;
 $('plans').replaceChildren();$('orders').replaceChildren();
 try{
  const status=await api('tenants/'+encodeURIComponent(selected)+'/subscription');
  const s=status.subscription;
  $('subscription-status').textContent=s?'Situação: '+s.status+' · Plano: '+s.planKey+' · Até: '+new Date(s.endsAt).toLocaleDateString('pt-BR'):'Sem assinatura ativa.';
  const [available,orders]=await Promise.all([
   api('tenants/'+encodeURIComponent(selected)+'/billing/plans'),
   api('tenants/'+encodeURIComponent(selected)+'/billing/orders')]);
  plans=available.plans||[];for(const p of plans){
   const label=document.createElement('label');label.className='plan';
   const radio=document.createElement('input');radio.type='radio';radio.name='period';radio.value=p.period;radio.checked=p.period==='monthly'||!document.querySelector('input[name=period]:checked');
   const span=document.createElement('span'),strong=document.createElement('strong'),small=document.createElement('small');
   strong.textContent=p.name;small.textContent=p.period==='monthly'?'Mensal':'Anual';
   span.append(strong,small);const amount=document.createElement('b');
   amount.textContent=(p.amountCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
   label.append(radio,span,amount);$('plans').append(label);
  }
  if(!plans.length)notify('Ainda não existem ofertas de assinatura publicadas na central.');
  for(const o of orders.orders||[]){const li=document.createElement('li');const a=document.createElement('a');
   a.href=o.checkoutUrl;a.target='_blank';a.rel='noopener noreferrer';
   a.textContent=o.period+' · '+(o.amountCents/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
   li.append(a);$('orders').append(li);}
 }catch(e){notify(e.message);}
}
$('checkout-form').addEventListener('submit',async e=>{
 e.preventDefault();const period=selectedPlan();if(!selected||!period){notify('Escolha um plano.');return;}
 const button=$('checkout');button.disabled=true;notify('Criando checkout seguro…');
 try{
  const couponCode=String(e.target.elements.couponCode.value||'').trim().toUpperCase();
  const result=await api('tenants/'+encodeURIComponent(selected)+'/billing/checkout','POST',{period,couponCode,idempotencyKey:crypto.randomUUID()});
  if(!result.checkoutUrl)throw Error('O checkout não retornou endereço de pagamento.');
  window.location.assign(result.checkoutUrl);
 }catch(err){notify(err.message);button.disabled=false;}
});
bootstrap();
})();