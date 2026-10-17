'use strict';

(() => {
  const ApiClient=window.PdvApiClient?.ApiClient;if(!ApiClient)return;
  const api=new ApiClient();
  const ui=window.PdvUiModel;
  const statusLabel=value=>ui?.statusLabel?.(value,String(value||''))||String(value||'');
  const fulfillmentLabel=value=>ui?.fulfillmentLabel?.(value,String(value||''))||String(value||'');
  const paymentLabel=value=>ui?.paymentMethodLabel?.(value,String(value||''))||String(value||'');
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const qty=value=>Number(value||0).toLocaleString('pt-BR',{maximumFractionDigits:3});
  const when=value=>{if(!value)return '—';const date=new Date(value);return Number.isNaN(date.getTime())?esc(value):date.toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'});};
  const content=()=>document.getElementById('route-content');
  const page=()=>content()?.querySelector('.ops-page,.page');
  const toast=(message,error=false)=>window.PdvToast?.show?.(message,error?'error':'success');

  function selectedQuantities(host,selector,itemMap){
    const items=[];
    host.querySelectorAll(selector).forEach(input=>{
      const item=itemMap.get(input.dataset.itemId);if(!item)return;
      const quantity=Number(input.value||0);
      if(quantity>0&&quantity<=Number(item.pendingQuantity||0))items.push({productId:item.productId,quantity});
    });
    return items;
  }

  async function mountPurchases(root=page()){
    if(!root)return;
    if(!root.querySelector('#p0-partial-receipt-panel')){
      const card=document.createElement('section');card.id='p0-partial-receipt-panel';card.className='ops-card';
      card.innerHTML='<div class="ops-card-head"><div><h2>Recebimento parcial</h2><p class="ops-muted">Informe quanto chegou de cada item. Quantidade zero mantém o saldo pendente para uma próxima entrega.</p></div><button class="ops-secondary" data-partial-receive-refresh>Atualizar</button></div><div data-partial-receive-body><div class="ops-loader"></div></div>';
      root.appendChild(card);
      async function load(){
        const host=card.querySelector('[data-partial-receive-body]');
        try{
          const orders=(await api.purchaseOrders()).filter(order=>['ORDERED','PARTIALLY_RECEIVED'].includes(order.status));
          host.innerHTML=orders.map(order=>{
            const pending=(order.items||[]).filter(item=>Number(item.pendingQuantity)>0);
            return `<article class="ops-card"><div class="ops-card-head"><div><strong>${esc(order.orderNumber||order.id)}</strong><p class="ops-muted">${esc(order.supplierName||order.supplierId)} · ${esc(statusLabel(order.status))} · ${money(order.totalCents)}</p></div><button class="ops-primary" data-partial-receive="${esc(order.id)}">Receber informado</button></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Produto</th><th>Pedido</th><th>Já recebido</th><th>Pendente</th><th>Receber agora</th></tr></thead><tbody>${pending.map(item=>`<tr><td>${esc(item.productName||item.productId)}</td><td>${qty(item.quantity)}</td><td>${qty(item.receivedQuantity)}</td><td>${qty(item.pendingQuantity)}</td><td><input class="ops-input compact" data-receive-qty data-order-id="${esc(order.id)}" data-item-id="${esc(item.id)}" type="number" min="0" max="${Number(item.pendingQuantity)}" step="0.001" value="${Number(item.pendingQuantity)}"></td></tr>`).join('')||'<tr><td colspan="5">Sem itens pendentes.</td></tr>'}</tbody></table></div></article>`;
          }).join('')||'<p class="ops-muted">Nenhum pedido aguardando recebimento.</p>';
          for(const order of orders){
            host.querySelector(`[data-partial-receive="${CSS.escape(order.id)}"]`)?.addEventListener('click',async()=>{
              const itemMap=new Map((order.items||[]).map(item=>[String(item.id),item]));
              const items=selectedQuantities(host,`[data-receive-qty][data-order-id="${CSS.escape(order.id)}"]`,itemMap);
              if(!items.length){toast('Informe ao menos uma quantidade maior que zero.',true);return;}
              try{await api.receivePurchaseOrder(order.id,{items});toast('Recebimento registrado.');await load();void loadReceipts();}catch(error){toast(error.message,true);}
            });
          }
        }catch(error){host.innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}
      }
      card.querySelector('[data-partial-receive-refresh]')?.addEventListener('click',()=>void load());
      void load();
    }

    if(!root.querySelector('#p1-purchase-receipts-panel')){
      const history=document.createElement('section');history.id='p1-purchase-receipts-panel';history.className='ops-card';history.innerHTML='<div class="ops-card-head"><div><h2>Histórico de recebimentos</h2><p class="ops-muted">Cada entrega permanece rastreável, inclusive recebimentos parciais.</p></div><button class="ops-secondary" data-receipts-refresh>Atualizar</button></div><div data-receipts-body><div class="ops-loader"></div></div>';root.appendChild(history);
      history.querySelector('[data-receipts-refresh]')?.addEventListener('click',()=>void loadReceipts());
    }
    async function loadReceipts(){
      const host=root.querySelector('#p1-purchase-receipts-panel [data-receipts-body]');if(!host)return;
      try{const receipts=await api.purchaseReceipts();host.innerHTML=`<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Recebimento</th><th>Pedido</th><th>Data</th><th>Itens</th><th>Total</th><th>Conta a pagar</th></tr></thead><tbody>${receipts.slice().reverse().map(receipt=>`<tr><td><strong>${esc(receipt.receiptNumber||receipt.id)}</strong></td><td>${esc(receipt.purchaseOrderId)}</td><td>${when(receipt.receivedAt||receipt.createdAt)}</td><td>${(receipt.items||[]).map(item=>`${esc(item.productId)} × ${qty(item.quantity)}`).join('<br>')||'—'}</td><td>${money(receipt.totalCents)}</td><td>${esc(receipt.payableEntryId||'—')}</td></tr>`).join('')||'<tr><td colspan="6">Nenhum recebimento registrado.</td></tr>'}</tbody></table></div>`;}catch(error){host.innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}
    }
    void loadReceipts();
  }

  async function mountOrders(root=page()){
    if(!root||root.querySelector('#p0-partial-fulfillment-panel'))return;
    const card=document.createElement('section');card.id='p0-partial-fulfillment-panel';card.className='ops-card';
    card.innerHTML='<div class="ops-card-head"><div><h2>Atendimento parcial</h2><p class="ops-muted">Escolha quanto será entregue agora; o restante continua reservado e pendente.</p></div><button class="ops-secondary" data-partial-fulfill-refresh>Atualizar</button></div><div data-partial-fulfill-body><div class="ops-loader"></div></div>';
    root.appendChild(card);
    async function load(){
      const host=card.querySelector('[data-partial-fulfill-body]');
      try{
        const cfg=await api.initialize();
        const orders=(await api.salesOrders()).filter(order=>['CONFIRMED','PARTIALLY_FULFILLED'].includes(order.status));
        host.innerHTML=orders.map(order=>{
          const pending=(order.items||[]).filter(item=>Number(item.pendingQuantity)>0);
          return `<article class="ops-card"><div class="ops-card-head"><div><strong>${esc(order.id)}</strong><p class="ops-muted">${esc(order.customerName||order.customerId)} · ${esc(fulfillmentLabel(order.fulfillmentType))} · ${esc(statusLabel(order.status))}</p></div><div class="ops-actions"><select class="ops-input compact" data-fulfill-payment="${esc(order.id)}"><option value="PIX">PIX</option><option value="CASH">Dinheiro</option><option value="DEBIT_CARD">Débito</option><option value="CREDIT_CARD">Crédito</option></select><button class="ops-primary" data-partial-fulfill="${esc(order.id)}">Atender informado</button></div></div><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Produto</th><th>Pedido</th><th>Já atendido</th><th>Pendente</th><th>Atender agora</th></tr></thead><tbody>${pending.map(item=>`<tr><td>${esc(item.productName||item.productId)}</td><td>${qty(item.quantity)}</td><td>${qty(item.fulfilledQuantity)}</td><td>${qty(item.pendingQuantity)}</td><td><input class="ops-input compact" data-fulfill-qty data-order-id="${esc(order.id)}" data-item-id="${esc(item.id)}" type="number" min="0" max="${Number(item.pendingQuantity)}" step="0.001" value="${Number(item.pendingQuantity)}"></td></tr>`).join('')||'<tr><td colspan="5">Sem itens pendentes.</td></tr>'}</tbody></table></div></article>`;
        }).join('')||'<p class="ops-muted">Nenhum pedido confirmado com saldo pendente.</p>';
        for(const order of orders){
          host.querySelector(`[data-partial-fulfill="${CSS.escape(order.id)}"]`)?.addEventListener('click',async()=>{
            const itemMap=new Map((order.items||[]).map(item=>[String(item.id),item]));
            const items=selectedQuantities(host,`[data-fulfill-qty][data-order-id="${CSS.escape(order.id)}"]`,itemMap);
            if(!items.length){toast('Informe ao menos uma quantidade maior que zero.',true);return;}
            const byProduct=new Map((order.items||[]).map(item=>[String(item.productId),item]));
            const total=items.reduce((sum,item)=>sum+Math.round(Number(byProduct.get(String(item.productId))?.unitPriceCents||0)*item.quantity),0);
            const operatorId=order.createdBy;if(!operatorId){toast('Pedido sem operador de origem; não é possível gerar a venda automaticamente.',true);return;}
            const method=host.querySelector(`[data-fulfill-payment="${CSS.escape(order.id)}"]`)?.value||'PIX';
            try{await api.fulfillSalesOrder(order.id,{items,payments:[{method,amountCents:total}],terminalId:cfg.terminalId,operatorId,sellerId:operatorId});toast('Atendimento parcial registrado.');await load();}catch(error){toast(error.message,true);}
          });
        }
      }catch(error){host.innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}
    }
    card.querySelector('[data-partial-fulfill-refresh]')?.addEventListener('click',()=>void load());
    void load();
  }

  async function mountReturns(root=page()){
    if(!root||root.querySelector('#p2-return-details-panel'))return;
    const card=document.createElement('section');card.id='p2-return-details-panel';card.className='ops-card';card.innerHTML='<div class="ops-card-head"><div><h2>Detalhes das devoluções</h2><p class="ops-muted">Consulte itens, reembolsos, motivo, operador e autorização sem alterar o histórico.</p></div><button class="ops-secondary" data-return-details-refresh>Atualizar</button></div><div data-return-details-list><div class="ops-loader"></div></div><div data-return-details-output></div>';root.appendChild(card);
    async function load(){
      const list=card.querySelector('[data-return-details-list]');
      try{const rows=await api.returns();list.innerHTML=`<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>ID</th><th>Venda</th><th>Data</th><th>Total</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.id)}</td><td>${esc(row.saleId)}</td><td>${when(row.createdAt)}</td><td>${money(row.totalCents)}</td><td>${esc(statusLabel(row.status))}</td><td><button class="ops-link" data-return-details="${esc(row.id)}">Detalhes</button></td></tr>`).join('')||'<tr><td colspan="6">Nenhuma devolução.</td></tr>'}</tbody></table></div>`;card.querySelectorAll('[data-return-details]').forEach(button=>button.addEventListener('click',async()=>{const out=card.querySelector('[data-return-details-output]');try{const ret=await api.returnDetails(button.dataset.returnDetails);out.innerHTML=`<article class="ops-card"><h3>Devolução ${esc(ret.id)}</h3><dl class="ops-details"><div><dt>Venda</dt><dd>${esc(ret.saleId)}</dd></div><div><dt>Motivo</dt><dd>${esc(ret.reason||'—')}</dd></div><div><dt>Operador</dt><dd>${esc(ret.operatorId||'—')}</dd></div><div><dt>Autorizado por</dt><dd>${esc(ret.authorizedById||'—')}</dd></div><div><dt>Terminal</dt><dd>${esc(ret.terminalId||'—')}</dd></div><div><dt>Status</dt><dd>${esc(statusLabel(ret.status))}</dd></div></dl><div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Item</th><th>Qtd.</th><th>Unitário</th><th>Total</th></tr></thead><tbody>${(ret.items||[]).map(item=>`<tr><td>${esc(item.productName||item.productId)}</td><td>${qty(item.quantity)}</td><td>${money(item.unitPriceCents)}</td><td>${money(item.totalCents)}</td></tr>`).join('')}</tbody></table></div><p><strong>Reembolsos:</strong> ${(ret.refunds||[]).map(refund=>`${esc(paymentLabel(refund.method))} ${money(refund.amountCents)}`).join(' · ')||'—'}</p></article>`;}catch(error){out.innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}}));}catch(error){list.innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}
    }
    card.querySelector('[data-return-details-refresh]')?.addEventListener('click',()=>void load());void load();
  }

  async function mountSettings(root=page()){
    if(!root)return;
    if(!root.querySelector('#p1-print-retry-panel')){
      const card=document.createElement('section');card.id='p1-print-retry-panel';card.className='ops-card';card.dataset.settingsCategory='printing';card.innerHTML='<div class="ops-card-head"><div><h2>Fila de impressão com falha</h2><p class="ops-muted">Reenvie somente trabalhos com falha; a reimpressão histórica continua separada no histórico de vendas.</p></div><button class="ops-secondary" data-print-retry-refresh>Atualizar</button></div><div data-print-retry-body></div>';root.appendChild(card);
      async function loadPrint(){const host=card.querySelector('[data-print-retry-body]');try{const rows=await api.printJobs({status:'FAILED'});host.innerHTML=`<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Data</th><th>Tipo</th><th>Entidade</th><th>Tentativas</th><th>Erro</th><th></th></tr></thead><tbody>${rows.map(job=>`<tr><td>${when(job.updatedAt||job.createdAt)}</td><td>${esc(job.type)}</td><td>${esc(`${job.entityType||'—'} ${job.entityId||''}`)}</td><td>${Number(job.attempts||0)}</td><td>${esc(job.lastError||'—')}</td><td><button class="ops-link" data-print-retry="${esc(job.id)}">Reenviar</button></td></tr>`).join('')||'<tr><td colspan="6">Nenhuma impressão com falha.</td></tr>'}</tbody></table></div>`;card.querySelectorAll('[data-print-retry]').forEach(button=>button.addEventListener('click',async()=>{try{await api.retryPrint(button.dataset.printRetry);toast('Job devolvido à fila de impressão.');await loadPrint();}catch(error){toast(error.message,true);}}));}catch(error){host.innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}}
      card.querySelector('[data-print-retry-refresh]')?.addEventListener('click',()=>void loadPrint());void loadPrint();
    }

    if(!root.querySelector('#p1-terminal-admin-panel')){
      const card=document.createElement('section');card.id='p1-terminal-admin-panel';card.className='ops-card';card.dataset.settingsCategory='units';
      card.innerHTML='<div class="ops-card-head"><div><h2>Computador principal e terminais</h2><p class="ops-muted">Veja o endereço da rede, autorize novos computadores e bloqueie ou reative terminais já pareados.</p></div><button class="ops-secondary" data-terminal-refresh>Atualizar</button></div><div data-principal-state></div><div data-pairing-output></div><div data-terminal-body></div>';
      root.appendChild(card);
      window.PdvUiLifecycle?.emit?.('route:updated',{route:'settings',surface:'parity-settings'});
      const canPair=Boolean(window.PdvAccessPolicy?.hasCapability(window.PdvCurrentAccess,'devices.pair'));
      const canBlock=Boolean(window.PdvAccessPolicy?.hasCapability(window.PdvCurrentAccess,'devices.block'));
      const canManageDeployment=Boolean(window.PdvAccessPolicy?.hasCapability(window.PdvCurrentAccess,'deployment.manage'));

      async function loadTerminals(){
        const host=card.querySelector('[data-terminal-body]');
        try{
          const rows=await api.request('/api/v1/terminals');
          host.innerHTML=`<div class="ops-table-wrap"><table class="ops-table"><thead><tr><th>Terminal</th><th>Versão</th><th>Último acesso</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(terminal=>`<tr><td><strong>${esc(terminal.name||terminal.terminalId)}</strong><small>${esc(terminal.terminalId)}</small></td><td>${esc(terminal.appVersion||'—')}</td><td>${when(terminal.lastSeenAt)}</td><td>${esc(statusLabel(terminal.status))}</td><td>${canBlock?`<button class="ops-link ${terminal.status==='ACTIVE'?'danger':''}" data-terminal-status="${esc(terminal.terminalId)}" data-next-status="${terminal.status==='ACTIVE'?'BLOCKED':'ACTIVE'}">${terminal.status==='ACTIVE'?'Bloquear':'Reativar'}</button>`:''}</td></tr>`).join('')||'<tr><td colspan="5">Nenhum terminal pareado.</td></tr>'}</tbody></table></div>`;
          card.querySelectorAll('[data-terminal-status]').forEach(button=>button.addEventListener('click',async()=>{
            try{
              await api.request(`/api/v1/terminals/${encodeURIComponent(button.dataset.terminalStatus)}`,{method:'PATCH',body:{status:button.dataset.nextStatus}});
              toast('Status do terminal atualizado.');
              await loadTerminals();
            }catch(error){toast(error.message,true);}
          }));
        }catch(error){host.innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}
      }

      async function loadPrincipalState(){
        const host=card.querySelector('[data-principal-state]');
        try{
          const state=await window.artisysDesktop.dataServer.state();
          const lanAddresses=Array.isArray(state.lanAddresses)?state.lanAddresses:[];
          if(state.mode!=='lan-host'){
            host.innerHTML='<div class="ops-status-line"><strong>PC principal: INATIVO</strong><span>Este computador não está atendendo terminais pela rede local. A função pode ser ativada em Dados e servidor por um administrador autorizado.</span></div>';
            card.querySelector('[data-pairing-output]').innerHTML='';
            card.querySelector('[data-terminal-body]').innerHTML='';
            return;
          }
          const endpoint=lanAddresses.length?lanAddresses.map(address=>`${esc(address)}:${Number(state.lanPort||state.port||4174)}`).join(' · '):`porta ${Number(state.lanPort||state.port||4174)}`;
          host.innerHTML=`<div class="ops-status-line"><strong>PC principal: ATIVO</strong><span>${endpoint}</span></div><div class="ops-actions">${canPair?'<button class="ops-primary" data-create-pairing-code>Adicionar terminal</button>':''}${canManageDeployment?'<button class="ops-secondary danger" data-disable-lan>Desativar acesso pela rede</button>':''}</div>`;
          host.querySelector('[data-create-pairing-code]')?.addEventListener('click',async()=>{
            const output=card.querySelector('[data-pairing-output]');
            try{
              const result=await api.request('/api/v1/lan/pairing-codes',{method:'POST',body:{ttlSeconds:300}});
              output.innerHTML=`<div class="ops-status-line"><strong>Código ${esc(result.code)}</strong><span>Expira em ${when(result.expiresAt)}. No computador novo, escolha “Conectar a uma instalação existente” e informe este código.</span></div>`;
            }catch(error){toast(error.message,true);}
          });
          host.querySelector('[data-disable-lan]')?.addEventListener('click',async()=>{
            try{
              await window.artisysDesktop.dataServer.save({mode:'local'},api.sessionToken);
              await window.artisysDesktop.dataServer.restart();
            }catch(error){toast(error.message,true);}
          });
          await loadTerminals();
        }catch(error){host.innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}
      }
      card.querySelector('[data-terminal-refresh]')?.addEventListener('click',()=>void loadPrincipalState());
      void loadPrincipalState();
    }

    if(!root.querySelector('#p2-import-batch-panel')){
      const card=document.createElement('section');card.id='p2-import-batch-panel';card.className='ops-card';card.dataset.settingsCategory='diagnostics';card.innerHTML='<div class="ops-card-head"><div><h2>Consultar lote de importação</h2><p class="ops-muted">Use o ID exibido no preview para recuperar status, resumo e erros de um lote anterior.</p></div></div><form id="ops-import-batch-lookup" class="ops-form ops-inline-form"><label>ID do lote<input class="ops-input" name="batchId" required placeholder="import-..."></label><button class="ops-secondary" type="submit">Consultar</button></form><div data-import-batch-output></div>';root.appendChild(card);
      card.querySelector('#ops-import-batch-lookup')?.addEventListener('submit',async event=>{event.preventDefault();const batchId=String(new FormData(event.currentTarget).get('batchId')||'').trim();const host=card.querySelector('[data-import-batch-output]');try{const batch=await api.importBatch(batchId);host.innerHTML=`<article class="ops-card"><div class="ops-status-line"><strong>${esc(batch.batchId)}</strong><span>${esc(batch.type)} · ${esc(batch.format)} · ${esc(statusLabel(batch.status))}</span></div><dl class="ops-details"><div><dt>Criado</dt><dd>${when(batch.createdAt)}</dd></div><div><dt>Confirmado</dt><dd>${when(batch.committedAt)}</dd></div><div><dt>Total</dt><dd>${Number(batch.summary?.total||0)}</dd></div><div><dt>Válidas</dt><dd>${Number(batch.summary?.valid||0)}</dd></div><div><dt>Inválidas</dt><dd>${Number(batch.summary?.invalid||0)}</dd></div></dl>${(batch.errors||[]).length?`<div class="ops-error">${batch.errors.map(error=>`Linha ${Number(error.rowNumber)}: ${esc(error.message)}`).join('<br>')}</div>`:''}</article>`;}catch(error){host.innerHTML=`<div class="ops-error">${esc(error.message)}</div>`;}});
    }
  }

  async function mountSurface(surface,root=page()){
    if(surface==='enterprise-purchases')return mountPurchases(root);
    if(surface==='enterprise-orders')return mountOrders(root);
    if(surface==='returns')return mountReturns(root);
    if(surface==='settings')return mountSettings(root);
  }
  window.PdvOperationalDetailExtensions=Object.freeze({mountSurface,mountPurchases,mountOrders,mountReturns,mountSettings});
})();
