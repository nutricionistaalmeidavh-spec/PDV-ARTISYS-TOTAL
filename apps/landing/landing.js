(function(){
  'use strict';
  const dialog=document.getElementById('registration-dialog');
  const loginDialog=document.getElementById('login-dialog');
  const form=document.getElementById('registration-form');
  const feedback=document.getElementById('registration-feedback');
  const loginForm=document.getElementById('landing-login-form');
  const mfaForm=document.getElementById('landing-mfa-form');
  let mfaChallenge='';
  const closeDialog=node=>{if(node.open)node.close();};
  const open=()=>{closeDialog(loginDialog);if(!dialog.open)dialog.showModal();form.elements.displayName.focus();};
  const openLogin=()=>{
    closeDialog(dialog);
    mfaChallenge='';mfaForm.hidden=true;loginForm.hidden=false;
    document.getElementById('login-feedback').textContent='';
    document.getElementById('mfa-feedback').textContent='';
    if(!loginDialog.open)loginDialog.showModal();
    loginForm.elements.email.focus();
  };
  document.querySelectorAll('[data-open-register]').forEach(button=>button.addEventListener('click',open));
  document.querySelectorAll('[data-open-login]').forEach(button=>button.addEventListener('click',openLogin));
  document.querySelector('[data-close-register]').addEventListener('click',()=>dialog.close());
  document.querySelector('[data-close-login]').addEventListener('click',()=>loginDialog.close());
  document.querySelector('[data-switch-login]').addEventListener('click',openLogin);
  document.querySelector('[data-switch-register]').addEventListener('click',open);
  dialog.addEventListener('click',event=>{
    if(event.target===dialog)dialog.close();
  });
  loginDialog.addEventListener('click',event=>{
    if(event.target===loginDialog)loginDialog.close();
  });
  if(location.hash==='#cadastro')open();
  if(location.hash==='#entrar')openLogin();
  window.addEventListener('hashchange',()=>{if(location.hash==='#cadastro')open();if(location.hash==='#entrar')openLogin();});
  const tabs=Array.from(document.querySelectorAll('[data-demo]'));
  function activate(tab,focus){
    for(const node of tabs){
      const selected=node===tab;
      node.setAttribute('aria-selected',String(selected));
      node.tabIndex=selected?0:-1;
      const panel=document.querySelector('[data-panel="'+node.dataset.demo+'"]');
      if(panel)panel.hidden=!selected;
    }
    if(focus)tab.focus();
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>activate(tab,false));
    tab.addEventListener('keydown',event=>{
      if(!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;
      event.preventDefault();
      const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
      activate(tabs[next],true);
    });
  });
  async function request(path,body){
    const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(body)});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok&&response.status!==202){
      const error=new Error(response.status===503?'O acesso online ainda não foi liberado. Seus dados estão preservados.':payload.error||'Não foi possível entrar no sistema.');
      error.status=response.status;throw error;
    }
    return payload;
  }
  loginForm.addEventListener('submit',async event=>{
    event.preventDefault();if(loginForm.dataset.pending==='true')return;
    const button=loginForm.querySelector('button[type="submit"]');
    const loginFeedback=document.getElementById('login-feedback');
    loginForm.dataset.pending='true';button.disabled=true;button.textContent='Entrando…';loginFeedback.textContent='';
    try{
      const session=await request('/api/v1/auth/login',{email:loginForm.elements.email.value.trim(),password:loginForm.elements.password.value});
      if(session.mfaRequired){
        mfaChallenge=session.challengeToken;mfaForm.hidden=false;loginForm.hidden=true;mfaForm.elements.code.focus();return;
      }
      location.assign('/app/');
    }catch(error){loginFeedback.textContent=error instanceof TypeError?'Sem conexão com o servidor. Tente novamente.':error.message;loginForm.elements.password.focus();}
    finally{loginForm.dataset.pending='false';button.disabled=false;button.textContent='Entrar no PDV';}
  });
  mfaForm.addEventListener('submit',async event=>{
    event.preventDefault();if(mfaForm.dataset.pending==='true')return;
    const button=mfaForm.querySelector('button[type="submit"]');
    const mfaFeedback=document.getElementById('mfa-feedback');
    mfaForm.dataset.pending='true';button.disabled=true;mfaFeedback.textContent='';
    try{await request('/api/v1/auth/mfa/login',{challengeToken:mfaChallenge,code:mfaForm.elements.code.value.trim()});location.assign('/app/');}
    catch(error){mfaFeedback.textContent=error instanceof TypeError?'Sem conexão com o servidor. Tente novamente.':error.message;mfaForm.elements.code.focus();}
    finally{mfaForm.dataset.pending='false';button.disabled=false;}
  });
  document.querySelector('[data-back-login]').addEventListener('click',()=>{mfaChallenge='';mfaForm.reset();mfaForm.hidden=true;loginForm.hidden=false;loginForm.elements.password.focus();});
  form.addEventListener('submit',async event=>{
    event.preventDefault();
    if(form.dataset.pending==='true')return;
    const body=Object.fromEntries(new FormData(form).entries());
    if(String(body.password||'').length<12||!/[\p{L}]/u.test(body.password)||!/\d/.test(body.password)){
      feedback.textContent='A senha precisa ter ao menos 12 caracteres, incluindo letras e números.';
      form.elements.password.focus();return;
    }
    const button=form.querySelector('button[type="submit"]');
    const original=button.textContent;
    form.dataset.pending='true';button.disabled=true;button.textContent='Enviando solicitação…';
    feedback.classList.remove('success');feedback.textContent='';
    try{
      const response=await fetch('/api/v1/auth/register',{
        method:'POST',credentials:'same-origin',
        headers:{'content-type':'application/json','accept':'application/json'},
        body:JSON.stringify(body)
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok){
        const unavailable=response.status===503?'O cadastro ainda não está liberado. A ArtiSys precisa habilitar o acesso ao sistema.':null;
        throw new Error(unavailable||payload.error||'Não foi possível criar a conta.');
      }
      feedback.classList.add('success');
      feedback.textContent=payload.message||'Cadastro recebido. Aguarde a liberação da sua conta.';
      form.reset();
      button.textContent='Solicitação recebida';
    }catch(error){
      feedback.textContent=error instanceof TypeError?'Sem conexão com o servidor. Tente novamente.':error.message;
      button.disabled=false;button.textContent=original;
    }finally{form.dataset.pending='false';}
  });
})();
