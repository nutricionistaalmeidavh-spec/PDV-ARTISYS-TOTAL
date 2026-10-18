'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;
  if(!ApiClient)return;
  const safe=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const kinds={TERMINAL:'Terminal de caixa',WAITER:'Atendimento de salão',KITCHEN:'Cozinha / KDS'};
  const statusLabels={NOT_STARTED:'Não iniciado',IN_PROGRESS:'Em teste',READY:'Validado localmente',BLOCKED:'Bloqueado',NOT_APPLICABLE:'Não se aplica'};
  async function render(content,api=new ApiClient()){
    const tenantId=api.tenantId;
    if(!tenantId){
      content.innerHTML='<section class="ops-page"><h1>Rede local</h1><p>Selecione o estabelecimento antes de administrar a rede.</p></section>';
      return;
    }
    const base='/api/v1/tenants/'+encodeURIComponent(tenantId)+'/lan';
    const req=(suffix,options)=>api.request(base+suffix,options);
    content.innerHTML='<section class="ops-page"><header class="ops-head"><h1>Rede local e segurança</h1><p>Consultando a configuração do servidor…</p></header></section>';
    let access,readiness,health,devices,isAdmin=false;
    try{
      [access,readiness]=await Promise.all([req('/access'),req('/readiness')]);
      try{devices=await req('/devices');isAdmin=true;health=await req('/health');}
      catch(error){if(error.status!==403)throw error;devices={devices:[]};}
    }catch(error){
      content.innerHTML='<section class="ops-page"><h1>Rede local</h1><p class="ops-error">'+safe(error.message)+'</p></section>';
      return;
    }
    if(document.body.dataset.activeRoute!=='settings')return;
    const currentKey='pdv-total-r2-device-'+tenantId;
    const previousId=window.localStorage?.getItem(currentKey+'-id')||'';
    const previousCredential=window.localStorage?.getItem(currentKey+'-credential')||'';
    const deviceRows=devices.devices.map(device=>
      '<tr><td>'+safe(device.name)+'</td><td>'+safe(kinds[device.kind]||device.kind)+'</td><td>'+
      safe(device.branchId)+'</td><td>'+(device.active?'Ativo':'Revogado')+'</td><td>'+
      (device.active?'<button type="button" class="ops-secondary" data-r2-revoke="'+safe(device.id)+'">Revogar</button>':'—')+'</td></tr>').join('');
    const checks=readiness.checks.map(item=>
      '<form class="ops-card" data-r2-check="'+safe(item.key)+'"><h3>'+safe(item.title)+'</h3><p class="ops-muted">'+safe(item.category)+(item.optional?' · opcional':' · obrigatório')+'</p>'+
      '<label>Estado<select name="status" class="ops-input" '+(isAdmin?'':'disabled')+'>'+
      Object.entries(statusLabels).filter(([v])=>v!=='NOT_APPLICABLE'||item.optional).map(([value,label])=>
        '<option value="'+value+'" '+(item.status===value?'selected':'')+'>'+safe(label)+'</option>').join('')+'</select></label>'+
      '<label>Descrição do teste<input name="note" class="ops-input" maxlength="500" value="'+safe(item.note)+'" '+(isAdmin?'':'disabled')+'></label>'+
      '<label>Referência da evidência<input name="evidenceRef" class="ops-input" maxlength="250" placeholder="Ex.: QA/LAN/TEST-01" value="'+safe(item.evidenceRef)+'" '+(isAdmin?'':'disabled')+'></label>'+
      (isAdmin?'<button type="submit" class="ops-secondary">Salvar verificação</button>':'')+'</form>').join('');
    content.innerHTML='<section class="ops-page" id="r2-settings"><header class="ops-head"><h1>Rede local, terminais e recuperação</h1>'+
      '<p>O PC principal mantém os dados em SQLite; os demais aparelhos acessam a mesma interface por HTTPS. Nuvem e serviços pagos não são necessários.</p></header>'+
      '<div class="ops-grid two"><section class="ops-card"><h2>Acesso por HTTPS</h2><p>Use este endereço nos dispositivos da mesma rede. Instale o certificado confiável no próprio dispositivo.</p>'+
      '<p><code id="r2-lan-origin">'+safe(access.url)+'</code></p><button class="ops-secondary" id="r2-copy-address">Copiar endereço</button>'+
      '<div id="r2-lan-qr" role="img" aria-label="Código QR para endereço HTTPS da rede local" style="max-width:180px"></div>'+
      '<p class="ops-muted">Ao perder conexão com o servidor, nenhuma venda nova deve ser considerada confirmada.</p></section>'+
      '<section class="ops-card"><h2>Estado da rede</h2><p>'+(isAdmin?('Dispositivos ativos: '+Number(health.devices.active)+' de '+Number(health.devices.total)+' · Códigos pendentes: '+Number(health.pendingPairings)):'Identifique-se como administrador para consultar todos os dispositivos.')+'</p>'+
      '<p>Checklist: '+Number(readiness.readyCount)+' / '+Number(readiness.total)+' verificados.</p>'+
      (readiness.ready?'<p>Checklist local preenchido. Homologação física independente ainda é necessária.</p>':'<p>Não liberado como operação homologada: verifique os testes pendentes.</p>')+'</section></div>'+
      (isAdmin?'<section class="ops-card"><h2>Autorizar novo dispositivo</h2><form id="r2-new-pairing" class="field-grid">'+
      '<label>Filial<select name="branchId" class="ops-input" required><option value="">Selecione…</option></select></label>'+
      '<label>Tipo<select name="kind" class="ops-input"><option value="TERMINAL">Caixa / terminal</option><option value="WAITER">Salão / garçom</option><option value="KITCHEN">Cozinha / KDS</option></select></label>'+
      '<button type="submit" class="ops-primary">Gerar código temporário</button></form>'+
      '<p id="r2-code-output" class="ops-muted" role="status"></p></section>':'')+
      '<section class="ops-card"><h2>Parear este aparelho</h2><p>Use o código que o administrador gerou na unidade. O login do operador continua obrigatório.</p>'+
      '<form id="r2-pair-device" class="field-grid"><label>Nome do aparelho<input class="ops-input" name="name" maxlength="80" placeholder="Ex.: Tablet salão 01" required></label>'+
      '<label>Código temporário<input class="ops-input" name="code" pattern="[a-f0-9]{64}" autocomplete="off" required></label>'+
      '<button type="submit" class="ops-primary">Parear aparelho</button></form><p id="r2-device-status" role="status"></p>'+
      (previousId&&previousCredential?'<button class="ops-secondary" id="r2-check-device" type="button">Verificar vínculo deste aparelho</button>':'')+
      '<p class="ops-muted">A credencial técnica é específica deste navegador, estabelecimento e usuário; não concede acesso sem sessão válida. Em computadores compartilhados, apague dados do site ao desativar o terminal.</p></section>'+
      (isAdmin?'<section class="ops-card"><h2>Dispositivos registrados</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Nome</th><th>Uso</th><th>Filial</th><th>Status</th><th>Ação</th></tr></thead><tbody>'+deviceRows+'</tbody></table></div></section>':'')+
      (isAdmin?'<section class="ops-card"><h2>Diagnóstico sem dados sensíveis</h2><p>Pacote ZIP com saúde, nomes das migrações e eventos administrativos sem senhas, credenciais ou banco de dados.</p><button id="r2-download-diagnostics" type="button" class="ops-secondary">Gerar ZIP de diagnóstico</button></section>':'')+
      '<section class="ops-card"><h2>Checklist de homologação e piloto</h2><p class="ops-muted">O registro de evidências não substitui a verificação em máquinas reais, por revisor independente.</p><div class="ops-grid two" id="r2-checks">'+checks+'</div></section></section>';
    const qrHost=content.querySelector('#r2-lan-qr');
    try{const svg=window.PdvLocalQr?.qrSvg(access.url,{scale:4});if(qrHost&&svg)qrHost.innerHTML=svg;}
    catch{if(qrHost)qrHost.textContent='Endereço longo demais para o QR local. Copie a URL acima.';}
    const status=content.querySelector('#r2-device-status');
    const notify=(message,error=false)=>{if(status){status.textContent=message;status.className=error?'ops-error':'ops-muted';}};
    content.querySelector('#r2-copy-address')?.addEventListener('click',async()=>{
      try{await navigator.clipboard.writeText(access.url);notify('Endereço copiado.');}
      catch{notify('Selecione e copie o endereço exibido.',true);}
    });
    if(isAdmin){
      content.querySelector('#r2-download-diagnostics')?.addEventListener('click',async()=>{
        try{
          const response=await window.fetch(base+'/diagnostics.zip',{credentials:'same-origin',headers:{accept:'application/zip'}});
          if(!response.ok)throw Error('Não foi possível gerar o pacote de diagnóstico.');
          const blob=await response.blob(),url=URL.createObjectURL(blob);
          try{
            const a=document.createElement('a');a.href=url;a.download='pdv-total-lan-diagnostics.zip';
            document.body.appendChild(a);a.click();a.remove();
          }finally{window.setTimeout(()=>URL.revokeObjectURL(url),1000);}
          notify('Pacote de diagnóstico gerado.');
        }catch(error){notify(error.message,true);}
      });
      try{
        const result=await api.request('/api/v1/tenants/'+encodeURIComponent(tenantId)+'/branches');
        const select=content.querySelector('#r2-new-pairing [name="branchId"]');
        for(const branch of result.branches||[]){
          const option=document.createElement('option');option.value=branch.id;option.textContent=branch.name;select.append(option);
        }
      }catch(error){notify(error.message,true);}
      content.querySelector('#r2-new-pairing')?.addEventListener('submit',async event=>{
        event.preventDefault();
        const form=event.currentTarget;
        try{
          const data=await req('/pairings',{method:'POST',body:Object.fromEntries(new FormData(form))});
          const output=content.querySelector('#r2-code-output');
          output.replaceChildren();
          const text=document.createElement('span');text.textContent='Código válido por 5 minutos: '+data.code+' ';
          const copy=document.createElement('button');copy.type='button';copy.className='ops-secondary';copy.textContent='Copiar código';
          copy.addEventListener('click',()=>navigator.clipboard.writeText(data.code).catch(()=>{}));
          output.append(text,copy);
        }catch(error){notify(error.message,true);}
      });
      content.querySelectorAll('[data-r2-revoke]').forEach(button=>button.addEventListener('click',async()=>{
        if(!window.confirm('Revogar o acesso deste dispositivo? Será necessário parear novamente.'))return;
        try{await req('/devices/'+encodeURIComponent(button.dataset.r2Revoke),{method:'DELETE'});await render(content,api);}
        catch(error){notify(error.message,true);}
      }));
      content.querySelectorAll('[data-r2-check]').forEach(form=>form.addEventListener('submit',async event=>{
        event.preventDefault();
        const values=Object.fromEntries(new FormData(form));
        try{await req('/readiness/'+encodeURIComponent(form.dataset.r2Check),{method:'PATCH',body:values});await render(content,api);}
        catch(error){notify(error.message,true);}
      }));
    }
    content.querySelector('#r2-pair-device')?.addEventListener('submit',async event=>{
      event.preventDefault();
      const values=Object.fromEntries(new FormData(event.currentTarget));
      try{
        const result=await req('/devices/pair',{method:'POST',body:values});
        // Credential is useful only together with the authenticated operator session.
        window.localStorage?.setItem(currentKey+'-id',result.device.id);
        window.localStorage?.setItem(currentKey+'-credential',result.credential);
        notify('Dispositivo pareado. A credencial não substitui o login.');
      }catch(error){notify(error.message,true);}
    });
    content.querySelector('#r2-check-device')?.addEventListener('click',async()=>{
      try{const result=await req('/devices/check',{method:'POST',body:{id:previousId,credential:previousCredential}});
        notify('Vínculo ativo: '+result.device.name+' / '+result.device.kind);}
      catch(error){notify(error.message,true);}
    });
  }
  window.PdvR2LanSettings=Object.freeze({render});
})();
