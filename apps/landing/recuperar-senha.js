(()=>{
'use strict';
const status=document.getElementById('status');
const token=new URLSearchParams(location.hash.slice(1)).get('token');
history.replaceState(null,'',location.pathname);
const valid=typeof token==='string'&&/^[a-f0-9]{64}$/.test(token);
const section=id=>document.getElementById(id);
section('confirm-section').hidden=!valid;
section('request-section').hidden=valid;
if(valid)status.textContent='Link identificado. Digite uma nova senha para recuperar seu acesso.';
const submit=async(url,data)=>{
 const r=await fetch(url,{method:'POST',credentials:'same-origin',
  headers:{'content-type':'application/json'},body:JSON.stringify(data)});
 const result=await r.json().catch(()=>({}));
 if(!r.ok)throw Error(result.error||'Não foi possível concluir sua solicitação.');
 return result;
};
section('request-form').addEventListener('submit',async event=>{
 event.preventDefault();const button=event.currentTarget.querySelector('button');button.disabled=true;
 try{
  const res=await submit('/api/v1/auth/password/reset/request',{email:section('recovery-email').value.trim()});
  status.textContent=res.message||'Se existir uma conta, o link será enviado ao e-mail informado.';
 }catch(error){status.textContent=error.message;}
 finally{button.disabled=false;}
});
section('confirm-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
 try{
  if(form.elements.password.value!==form.elements.confirmPassword.value)throw Error('As senhas não conferem.');
  await submit('/api/v1/auth/password/reset/confirm',{token,password:form.elements.password.value});
  form.reset();section('confirm-section').hidden=true;
  status.textContent='Senha alterada. Sessões anteriores foram encerradas. Entre com sua nova senha.';
 }catch(error){status.textContent=error.message;}
 finally{button.disabled=false;}
});
})();
