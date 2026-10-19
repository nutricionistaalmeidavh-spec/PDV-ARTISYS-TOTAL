(function(){
  'use strict';
  const dialog=document.getElementById('registration-dialog');
  const form=document.getElementById('registration-form');
  const feedback=document.getElementById('registration-feedback');
  const open=()=>{if(!dialog.open)dialog.showModal();form.elements.displayName.focus();};
  document.querySelectorAll('[data-open-register]').forEach(button=>button.addEventListener('click',open));
  document.querySelector('[data-close-register]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{
    if(event.target===dialog)dialog.close();
  });
  if(location.hash==='#cadastro')open();
  window.addEventListener('hashchange',()=>{if(location.hash==='#cadastro')open();});
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

  const securityDialog=document.getElementById('security-dialog');
  document.querySelectorAll('[data-open-security]').forEach(node=>node.addEventListener('click',()=>{
    if(dialog.open)dialog.close();
    securityDialog.showModal();
    securityDialog.querySelector('input').focus();
  }));
  securityDialog.querySelector('[data-close-security]').addEventListener('click',()=>securityDialog.close());
  securityDialog.addEventListener('click',event=>{if(event.target===securityDialog)securityDialog.close();});
  function bindSecurityForm(id,endpoint){
    const node=document.getElementById(id),feedback=node.querySelector('[role="status"]');
    node.addEventListener('submit',async event=>{
      event.preventDefault();
      if(node.dataset.pending==='true')return;
      const body=Object.fromEntries(new FormData(node).entries());
      const button=node.querySelector('[type="submit"]'),original=button.textContent;
      node.dataset.pending='true';button.disabled=true;feedback.textContent='';
      feedback.classList.remove('success');
      try{
        const response=await fetch(endpoint,{method:'POST',credentials:'same-origin',
          headers:{'content-type':'application/json','accept':'application/json'},body:JSON.stringify(body)});
        const payload=await response.json().catch(()=>({}));
        if(!response.ok)throw new Error(payload.error||'Código não aceito ou expirado.');
        feedback.classList.add('success');
        feedback.textContent=endpoint.endsWith('/verify-email')
         ?'E-mail confirmado. A liberação depende de aprovação da ArtiSys.'
         :'Senha atualizada. Todas as sessões antigas foram encerradas. Faça login novamente.';
        node.reset();
      }catch(error){feedback.textContent=error instanceof TypeError?'Sem conexão com o servidor.':error.message;}
      finally{button.disabled=false;button.textContent=original;node.dataset.pending='false';}
    });
  }
  bindSecurityForm('security-verify-form','/api/v1/auth/verify-email');
  bindSecurityForm('security-recovery-form','/api/v1/auth/reset-password');
})();
