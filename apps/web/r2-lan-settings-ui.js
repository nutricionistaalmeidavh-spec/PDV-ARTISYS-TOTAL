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
      content.innerHTML='<section class="ops-page"><h1>Funcionamento offline</h1><p>Selecione o estabelecimento antes de administrar a rede.</p></section>';
      return;
    }
    const base='/api/v1/tenants/'+encodeURIComponent(tenantId)+'/lan';
    const req=(suffix,options)=>api.request(base+suffix,options);
    content.innerHTML='<section class="ops-page"><header class="ops-head"><h1>Funcionamento offline e segurança</h1><p>Consultando a configuração do servidor…</p></header></section>';
    let access,readiness,health,devices,modules,isAdmin=false;
    try{
      [access,readiness,modules]=await Promise.all([req('/access'),req('/readiness'),req('/modules')]);
      try{devices=await req('/devices');isAdmin=true;health=await req('/health');}
      catch(error){if(error.status!==403)throw error;devices={devices:[]};}
    }catch(error){
      content.innerHTML='<section class="ops-page"><h1>Funcionamento offline</h1><p class="ops-error">'+(error.status===404?'O servidor offline ainda não foi ativado nesta instalação. Acesse esta configuração pelo endereço HTTPS local autorizado.':safe(error.message))+'</p></section>';
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
    const moduleCards=(modules.modules||[]).map(item=>'<article class="ops-card"><h3>'+safe(item.name)+'</h3><p>'+safe(item.description)+'</p><strong>'+(item.enabled?'Ativado':'Desativado')+'</strong> '+
      (isAdmin?'<button type="button" class="ops-secondary" data-r2-module="'+safe(item.id)+'" data-enabled="'+String(!item.enabled)+'">'+(item.enabled?'Desativar':'Ativar')+'</button>':'')+'</article>').join('');
    const checks=readiness.checks.map(item=>
      '<form class="ops-card" data-r2-check="'+safe(item.key)+'"><h3>'+safe(item.title)+'</h3><p class="ops-muted">'+safe(item.category)+(item.optional?' · opcional':' · obrigatório')+'</p>'+
      '<label>Estado<select name="status" class="ops-input" '+(isAdmin?'':'disabled')+'>'+
      Object.entries(statusLabels).filter(([v])=>v!=='NOT_APPLICABLE'||item.optional).map(([value,label])=>
        '<option value="'+value+'" '+(item.status===value?'selected':'')+'>'+safe(label)+'</option>').join('')+'</select></label>'+
      '<label>Descrição do teste<input name="note" class="ops-input" maxlength="500" value="'+safe(item.note)+'" '+(isAdmin?'':'disabled')+'></label>'+
      '<label>Referência da evidência<input name="evidenceRef" class="ops-input" maxlength="250" placeholder="Ex.: QA/LAN/TEST-01" value="'+safe(item.evidenceRef)+'" '+(isAdmin?'':'disabled')+'></label>'+
      (isAdmin?'<button type="submit" class="ops-secondary">Salvar verificação</button>':'')+'</form>').join('');
    content.innerHTML='<section class="ops-page" id="r2-settings"><header class="ops-head"><h1>Funcionamento offline, terminais e recuperação</h1>'+
      '<p>O PC local permite acesso pelo Wi-Fi mesmo sem internet, desde que esteja ligado. A sincronização D1 ↔ SQLite e o compartilhamento de contas SaaS ainda dependem da implantação segura da replicação; não presuma que os dados da nuvem já estão copiados.</p></header>'+
      '<div class="ops-grid two"><section class="ops-card"><h2>Conectar ao servidor offline pelo Wi-Fi</h2><p>O garçom escaneia o QR, entra com sua conta autorizada e vincula o aparelho à filial. Acesse por HTTPS local com certificado confiável.</p>'+
      '<p><code id="r2-lan-origin">'+safe(access.url)+'</code></p><button class="ops-secondary" id="r2-copy-address">Copiar endereço</button>'+
      '<div id="r2-lan-qr" role="img" aria-label="Código QR para endereço HTTPS da rede local" style="max-width:180px"></div>'+
      '<p class="ops-muted">Ao perder conexão com o servidor, nenhuma venda nova deve ser considerada confirmada.</p></section>'+
      '<section class="ops-card"><h2>Sincronização com a nuvem</h2><p role="status">'+(access.replication?.state==='BASELINE_ONLY'?'Cópia local: '+safe(access.replication.lastCloudSyncAt||'sem data')+'. '+(access.replication.inventoryOfflineEnabled?'Entrada e ajuste de estoque podem operar com fila transacional local. Vendas, pagamentos, caixa e comandas continuam bloqueados.':'Operações comerciais offline ainda bloqueadas.')+' Pendências: '+Number(access.replication.pendingOperations||0)+'.':access.replication?.state==='STALE'?'A cópia de consulta está desatualizada. Confira a internet do PC; vendas offline bloqueadas.':access.replication?.state==='ERROR'?'Autorização da cópia recusada ou incompatível. Login local bloqueado; reconfigure o gateway.':'Ainda não configurada. Este servidor local não recebeu uma cópia automática do D1 e as contas SaaS não estão disponíveis até configurar a replicação.')+'</p></section>'+ 
      (isAdmin&&['LOCAL','RECONCILING'].includes(access.replication?.writerMode)?'<section class="ops-card"><h2>Retomar modo online</h2><p>Esta ação interrompe novas operações locais, reenvia o estoque pendente e só desbloqueia a filial na Cloudflare se o D1 confirmar todos os movimentos.</p><button id="r2-offline-finish" type="button" class="ops-primary">Concluir sincronização e voltar ao online</button></section>':'')+
      '<section class="ops-card"><h2>Estado da rede</h2><p>'+(isAdmin?('Dispositivos ativos: '+Number(health.devices.active)+' de '+Number(health.devices.total)+' · Códigos pendentes: '+Number(health.pendingPairings)):'Identifique-se como administrador para consultar todos os dispositivos.')+'</p>'+
      '<p>Checklist: '+Number(readiness.readyCount)+' / '+Number(readiness.total)+' verificados.</p>'+
      (readiness.ready?'<p>Checklist operacional preenchido. A certificação de software é independente.</p>':'<p>Checklist operacional ainda não preenchido; isso não bloqueia código pronto.</p>')+'</section></div>'+
      (isAdmin?'<section class="ops-card"><h2>Gerar QR de vínculo para garçom ou terminal</h2><form id="r2-new-pairing" class="field-grid">'+
      '<label>Filial<select name="branchId" class="ops-input" required><option value="">Selecione…</option></select></label>'+
      '<label>Tipo<select name="kind" class="ops-input"><option value="TERMINAL">Caixa / terminal</option><option value="WAITER">Salão / garçom</option><option value="KITCHEN">Cozinha / KDS</option></select></label>'+
      '<button type="submit" class="ops-primary">Gerar código temporário</button></form>'+
      '<p id="r2-code-output" class="ops-muted" role="status"></p></section>':'')+
      '<section class="ops-card"><h2>Vincular este aparelho</h2><p>Escaneie o QR do administrador e entre com sua conta de funcionário. O vínculo não substitui o login nem permite operar outra filial.</p>'+
      '<form id="r2-pair-device" class="field-grid"><label>Nome do aparelho<input class="ops-input" name="name" maxlength="80" placeholder="Ex.: Tablet salão 01" required></label>'+
      '<label>Código temporário<input class="ops-input" name="code" pattern="[a-f0-9]{64}" autocomplete="off" value="'+safe(window.PdvOfflinePairing?.peek?.()||'')+'" required></label>'+
      '<button type="submit" class="ops-primary">Parear aparelho</button></form><p id="r2-device-status" role="status"></p>'+
      (previousId&&previousCredential?'<button class="ops-secondary" id="r2-check-device" type="button">Verificar vínculo deste aparelho</button>':'')+
      '<p class="ops-muted">A credencial técnica é específica deste navegador, estabelecimento e aparelho autorizado (uso depende do perfil do operador); não concede acesso sem sessão válida. Em computadores compartilhados, apague dados do site ao desativar o terminal.</p></section>'+
      '<section class="ops-card"><h2>Módulos opcionais</h2><p>Ativar ou desativar uma área não exclui vendas, estoque, pedidos ou históricos já registrados.</p><div class="ops-grid two">'+moduleCards+'</div></section>'+
      (isAdmin?'<section class="ops-card"><h2>Dispositivos registrados</h2><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Nome</th><th>Uso</th><th>Filial</th><th>Status</th><th>Ação</th></tr></thead><tbody>'+deviceRows+'</tbody></table></div></section>':'')+
      (isAdmin?'<section class="ops-card"><h2>Diagnóstico sem dados sensíveis</h2><p>Pacote ZIP com saúde, nomes das migrações e eventos administrativos sem senhas, credenciais ou banco de dados.</p><button id="r2-download-diagnostics" type="button" class="ops-secondary">Gerar ZIP de diagnóstico</button></section>':'')+
      '<section class="ops-card"><h2>Checklist opcional de implantação</h2><p class="ops-muted">Checklist para operação em campo, opcional. Não determina se o código está pronto.</p><div class="ops-grid two" id="r2-checks">'+checks+'</div></section></section>';
    const qrHost=content.querySelector('#r2-lan-qr');
    try{const svg=window.PdvLocalQr?.qrSvg(access.url,{scale:4});if(qrHost&&svg)qrHost.innerHTML=svg;}
    catch{if(qrHost)qrHost.textContent='Endereço longo demais para o QR local. Copie a URL acima.';}
    content.querySelector('#r2-offline-finish')?.addEventListener('click',async event=>{
      if(!window.confirm('Encerrar operação local? Novas gravações serão suspensas até o D1 confirmar todas as pendências.'))return;
      const button=event.currentTarget;button.disabled=true;
      try{
        const result=await api.request('/api/v1/tenants/'+encodeURIComponent(tenantId)+'/offline/finish',{method:'POST',body:{}});
        window.alert('Operações confirmadas pelo D1. A filial voltou ao modo online. Eventos enviados: '+Number(result.acknowledged||0));
        await render(content,api);
      }catch(error){window.alert('Reconciliação não concluída: '+error.message);button.disabled=false;}
    });
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
          // The QR carries the same one-use five-minute device approval code.
          // Employee authentication still happens on the local HTTPS PWA.
          const qr=document.createElement('div');
          qr.setAttribute('role','img');
          qr.setAttribute('aria-label','QR Code de vínculo temporário do aparelho');
          qr.style.maxWidth='220px';
          try{
            const url=window.PdvOfflinePairing.link(access.url,data.code);
            const svg=window.PdvLocalQr.qrSvg(url,{scale:3});
            qr.innerHTML=svg;
            const hint=document.createElement('p');
            hint.className='ops-muted';
            hint.textContent='Escaneie no celular conectado ao Wi-Fi, entre com a conta criada pelo administrador e vincule o aparelho. QR válido por 5 minutos.';
            output.append(qr,hint);
          }catch{qr.textContent='Não foi possível gerar o QR. Use o código temporário acima.';output.append(qr);}
        }catch(error){notify(error.message,true);}
      });
      content.querySelectorAll('[data-r2-module]').forEach(button=>button.addEventListener('click',async()=>{
        if(!window.confirm('Alterar disponibilidade deste módulo para todos os operadores da loja?'))return;
        try{await req('/modules/'+encodeURIComponent(button.dataset.r2Module),{method:'PATCH',body:{enabled:button.dataset.enabled==='true'}});await window.PdvModuleGate?.refresh?.();await render(content,api);}
        catch(error){notify(error.message,true);}
      }));
      content.querySelectorAll('[data-r2-revoke]').forEach(button=>button.addEventListener('click',async()=>{
        if(!window.confirm('Revogar o acesso deste dispositivo? Será necessário parear novamente.'))return;
        try{
          await req('/devices/'+encodeURIComponent(button.dataset.r2Revoke),{method:'DELETE'});
          if(button.dataset.r2Revoke===previousId){
            window.localStorage?.removeItem(currentKey+'-id');
            window.localStorage?.removeItem(currentKey+'-credential');
            window.location.reload();
            return;
          }
          await render(content,api);
        }
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
        window.PdvOfflinePairing?.take?.();
        notify('Dispositivo pareado. Carregando o PDV autorizado…');
        // First login intentionally skipped business reads before pairing.
        // Re-enter the canonical web boot now that the terminal is authorized.
        window.location.reload();
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
