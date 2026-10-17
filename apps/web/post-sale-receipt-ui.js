'use strict';

(() => {
  const root = window;
  const ApiClient = root.PdvApiClient?.ApiClient;
  if (!ApiClient) return;

  const api = new ApiClient();
  const lifecycle = root.PdvUiLifecycle;
  if (!lifecycle) return;
  let latestCompletedSale = null;
  let settingsInjectionQueued = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, char => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[char]);
  }

  function money(cents) {
    const value = Number(cents || 0) / 100;
    return value.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
  }

  function sessionToken(client = null) {
    return String(client?.sessionToken || root.sessionStorage?.getItem('artisys.sessionToken') || '').trim();
  }

  function postSaleRoot() {
    let panel = document.getElementById('post-sale-receipt-root');
    if (panel) return panel;
    panel = document.createElement('div');
    panel.id = 'post-sale-receipt-root';
    panel.className = 'post-sale-receipt-root hidden';
    panel.setAttribute('aria-live', 'polite');
    Object.assign(panel.style, {
      position:'fixed',
      right:'24px',
      bottom:'24px',
      zIndex:'49',
      maxWidth:'calc(100vw - 32px)',
      pointerEvents:'none'
    });
    document.body.appendChild(panel);
    return panel;
  }

  function closePostSaleModal() {
    const panel = document.getElementById('post-sale-receipt-root');
    if (!panel) return;
    panel.classList.add('hidden');
    panel.innerHTML = '';
    latestCompletedSale = null;
  }

  function setReceiptStatus(message, type = '') {
    const node = document.getElementById('post-sale-receipt-status');
    if (!node) return;
    node.className = `post-sale-status ${type}`.trim();
    node.textContent = message;
  }

  async function runReceiptAction(button, action, successMessage) {
    if (!button || button.dataset.busy === 'true' || !latestCompletedSale) return;
    button.dataset.busy = 'true';
    button.disabled = true;
    const original = button.textContent;
    button.textContent = 'Aguarde…';
    setReceiptStatus('Processando comprovante…');
    try {
      const result = await action();
      if (result?.cancelled) setReceiptStatus('Salvamento do PDF cancelado.');
      else setReceiptStatus(successMessage, 'success');
    } catch (error) {
      setReceiptStatus(error?.message || 'Falha ao processar o comprovante.', 'error');
    } finally {
      button.dataset.busy = 'false';
      button.disabled = false;
      button.textContent = original;
    }
  }

  function showPostSaleModal(sale, token) {
    const panel = postSaleRoot();
    if (!sale?.id) return;
    latestCompletedSale = { ...sale, sessionToken:token };
    panel.classList.remove('hidden');
    panel.innerHTML = `<section class="modal-card post-sale-card" role="dialog" aria-labelledby="post-sale-title">
      <header class="modal-head"><div><h2 id="post-sale-title">Venda concluída</h2><p class="post-sale-subtitle">Venda ${escapeHtml(sale.saleNumber || sale.id)} finalizada com sucesso.</p></div><button class="modal-close" type="button" id="post-sale-close" aria-label="Fechar">×</button></header>
      <div class="modal-body">
        <div class="post-sale-summary"><div><span>Total</span><strong>${money(sale.totalCents)}</strong></div><div><span>Troco</span><strong>${money(sale.changeCents)}</strong></div></div>
        <p class="post-sale-help">Escolha como entregar o comprovante. Salvar PDF funciona sem impressora instalada ou conectada.</p>
        <div class="post-sale-primary-actions" id="post-sale-actions">
          <button type="button" class="primary-button" id="post-sale-print">Imprimir</button>
          <button type="button" class="secondary-button post-sale-pdf-button" id="post-sale-save-pdf">Salvar PDF</button>
        </div>
        <div id="post-sale-receipt-status" class="post-sale-status" aria-live="polite"></div>
        <div class="modal-actions post-sale-footer-actions"><button type="button" class="secondary-button" id="post-sale-new-sale">Nova venda</button></div>
      </div>
    </section>`;

    const card = panel.querySelector('.post-sale-card');
    if (card) card.style.pointerEvents = 'auto';
    const printButton = document.getElementById('post-sale-print');
    const pdfButton = document.getElementById('post-sale-save-pdf');
    printButton?.addEventListener('click', () => runReceiptAction(printButton, () => root.artisysDesktop.receipts.printSale({ saleId:sale.id, sessionToken:token }), 'Comprovante enviado para impressão.'));
    pdfButton?.addEventListener('click', () => runReceiptAction(pdfButton, () => root.artisysDesktop.receipts.saveSalePdf({ saleId:sale.id, sessionToken:token }), 'PDF salvo com sucesso.'));
    document.getElementById('post-sale-close')?.addEventListener('click', closePostSaleModal);
    document.getElementById('post-sale-new-sale')?.addEventListener('click', closePostSaleModal);
  }

  if (!ApiClient.prototype.__artisysPostSaleReceiptPatched) {
    const originalCompleteSale = ApiClient.prototype.completeSale;
    Object.defineProperty(ApiClient.prototype, '__artisysPostSaleReceiptPatched', { value:true, configurable:false, enumerable:false });
    ApiClient.prototype.completeSale = async function patchedCompleteSale(...args) {
      const result = await originalCompleteSale.apply(this, args);
      const completed = result?.sale;
      const token = sessionToken(this);
      if (completed?.id && token) setTimeout(() => showPostSaleModal(completed, token), 0);
      return result;
    };
  }

  function currentRouteIsSettings() {
    return document.body?.dataset?.activeRoute === 'settings';
  }

  function printingPreferenceBody(form) {
    return {
      deviceName:String(form.elements.namedItem('deviceName')?.value || ''),
      paperMm:Number(form.elements.namedItem('paperMm')?.value || 80),
      columnsMode:String(form.elements.namedItem('columnsMode')?.value || 'auto'),
      columns:Number(form.elements.namedItem('columns')?.value || 48),
      autoPrint:Boolean(form.elements.namedItem('autoPrint')?.checked),
      showSystemDialog:Boolean(form.elements.namedItem('showSystemDialog')?.checked),
      cut:Boolean(form.elements.namedItem('cut')?.checked),
      openDrawerAfterPrint:Boolean(form.elements.namedItem('openDrawerAfterPrint')?.checked)
    };
  }

  function syncColumnsUi(form) {
    const paperMm = Number(form.elements.namedItem('paperMm')?.value || 80);
    const mode = String(form.elements.namedItem('columnsMode')?.value || 'auto');
    const columns = form.elements.namedItem('columns');
    if (!columns) return;
    if (mode === 'auto') {
      columns.value = paperMm === 58 ? '32' : '48';
      columns.disabled = true;
    } else columns.disabled = false;
  }

  function printerOptions(printers, selected) {
    const values = new Set((printers || []).map(item => item.name));
    const rows = [`<option value="" ${selected ? '' : 'selected'}>Impressora padrão do Windows</option>`];
    if (selected && !values.has(selected)) rows.push(`<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)} (configurada)</option>`);
    for (const printer of printers || []) {
      const label = `${printer.displayName || printer.name}${printer.isDefault ? ' — padrão' : ''}`;
      rows.push(`<option value="${escapeHtml(printer.name)}" ${selected === printer.name ? 'selected' : ''}>${escapeHtml(label)}</option>`);
    }
    return rows.join('');
  }

  async function injectPrintingSettings() {
    settingsInjectionQueued = false;
    if (!currentRouteIsSettings()) return;
    const content = document.getElementById('route-content');
    if (!content || content.querySelector('#printing-settings-card')) return;

    const host = content.querySelector('.ops-page');
    if (!host) return;
    const card = document.createElement('section');
    card.className = 'ops-card printing-settings-card';
    card.id = 'printing-settings-card';
    card.dataset.settingsCategory = 'printing';
    card.innerHTML = '<h2>Impressão do comprovante</h2><div class="ops-loader" role="status" aria-live="polite" aria-busy="true">Carregando impressoras e preferências…</div>';
    const queueCard = Array.from(host.querySelectorAll('.ops-card')).find(node => node.querySelector('h2')?.textContent?.includes('Fila de impressão'));
    if (queueCard) host.insertBefore(card, queueCard); else host.appendChild(card);

    try {
      const [preferences, printers, current] = await Promise.all([
        api.request('/api/v1/printing/preferences'),
        root.artisysDesktop.hardware.listPrinters().catch(() => []),
        api.currentSession().catch(() => null)
      ]);
      if (!currentRouteIsSettings() || !document.getElementById('printing-settings-card')) return;
      const canEdit = Boolean(window.PdvAccessPolicy?.hasCapability(current?.user,'settings.manage'));
      const noPrinters = !(printers || []).length;
      card.innerHTML = `<div class="ops-card-head"><div><h2>Impressão do comprovante</h2><p>Selecione a impressora térmica e o tamanho físico do papel. O PDF é gerado localmente e não depende desta lista.</p></div><span class="ops-badge ${noPrinters ? 'status-failed' : 'status-ok'}">${noPrinters ? 'SEM IMPRESSORA WINDOWS' : `${printers.length} IMPRESSORA(S)`}</span></div>
        <form id="printing-settings-form" class="ops-form printing-settings-form">
          <label class="printing-field-wide">Impressora<select id="printing-device-name" name="deviceName" class="ops-input">${printerOptions(printers, preferences.deviceName)}</select></label>
          <label>Tamanho do papel<select id="printing-paper-mm" name="paperMm" class="ops-input"><option value="58" ${Number(preferences.paperMm) === 58 ? 'selected' : ''}>58 mm</option><option value="80" ${Number(preferences.paperMm) === 80 ? 'selected' : ''}>80 mm</option></select></label>
          <label>Colunas<select id="printing-columns-mode" name="columnsMode" class="ops-input"><option value="auto" ${preferences.columnsMode === 'auto' ? 'selected' : ''}>Automático pelo papel</option><option value="manual" ${preferences.columnsMode === 'manual' ? 'selected' : ''}>Manual</option></select></label>
          <label>Largura lógica<select id="printing-columns" name="columns" class="ops-input"><option value="32" ${Number(preferences.columns) === 32 ? 'selected' : ''}>32 colunas</option><option value="42" ${Number(preferences.columns) === 42 ? 'selected' : ''}>42 colunas</option><option value="48" ${Number(preferences.columns) === 48 ? 'selected' : ''}>48 colunas</option></select></label>
          <label class="printing-check"><input id="printing-auto-print" name="autoPrint" type="checkbox" ${preferences.autoPrint ? 'checked' : ''}> Imprimir automaticamente ao concluir venda</label>
          <label class="printing-check"><input id="printing-system-dialog" name="showSystemDialog" type="checkbox" ${preferences.showSystemDialog ? 'checked' : ''}> Mostrar diálogo do Windows ao imprimir</label>
          <label class="printing-check"><input id="printing-cut" name="cut" type="checkbox" ${preferences.cut ? 'checked' : ''}> Acionar corte quando suportado</label>
          <label class="printing-check"><input id="printing-drawer" name="openDrawerAfterPrint" type="checkbox" ${preferences.openDrawerAfterPrint ? 'checked' : ''}> Abrir gaveta após impressão</label>
          <div class="ops-actions printing-field-wide"><button id="printing-save" class="ops-primary" type="submit">Salvar impressão</button><button id="printing-test" class="ops-secondary" type="button">Imprimir teste</button><span id="printing-settings-status" class="ops-muted" aria-live="polite"></span></div>
        </form>
        ${noPrinters ? '<p class="printing-no-printer">Nenhuma impressora do Windows foi encontrada. Você ainda pode usar <strong>Salvar PDF</strong> após concluir a venda.</p>' : ''}
        ${canEdit ? '' : '<p class="ops-muted">Seu perfil pode consultar estas opções; é necessária a permissão de gerenciar configurações para alterá-las.</p>'}`;

      const form = card.querySelector('#printing-settings-form');
      const status = card.querySelector('#printing-settings-status');
      syncColumnsUi(form);
      form.elements.namedItem('paperMm')?.addEventListener('change', () => syncColumnsUi(form));
      form.elements.namedItem('columnsMode')?.addEventListener('change', () => syncColumnsUi(form));

      if (!canEdit) {
        form.querySelectorAll('input,select,button').forEach(node => { node.disabled = true; });
        return;
      }

      form.addEventListener('submit', async event => {
        event.preventDefault();
        const save = card.querySelector('#printing-save');
        save.disabled = true;
        status.textContent = 'Salvando…';
        try {
          const saved = await api.request('/api/v1/printing/preferences', { method:'PUT', body:printingPreferenceBody(form) });
          status.textContent = `Salvo: ${saved.paperMm} mm · ${saved.columns} colunas.`;
          form.elements.namedItem('columns').value = String(saved.columns);
          syncColumnsUi(form);
        } catch (error) {
          status.textContent = error?.message || 'Falha ao salvar preferências.';
        } finally { save.disabled = false; }
      });

      card.querySelector('#printing-test')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        status.textContent = 'Enviando impressão de teste…';
        try {
          await root.artisysDesktop.hardware.testPrinter('ARTISYS PDV\nTESTE DE IMPRESSAO\nDOCUMENTO NAO FISCAL\n');
          status.textContent = 'Teste enviado para a impressora.';
        } catch (error) {
          status.textContent = error?.message || 'Falha no teste de impressão.';
        } finally { button.disabled = false; }
      });
    } catch (error) {
      card.innerHTML = `<h2>Impressão do comprovante</h2><div class="ops-error">${escapeHtml(error?.message || 'Não foi possível carregar as configurações de impressão.')}</div>`;
    }
    root.PdvRouteRegistry?.updated('settings', { surface:'settings-extension', extension:'printing' });
  }

  function queueSettingsInjection() {
    if (settingsInjectionQueued) return;
    settingsInjectionQueued = true;
    setTimeout(() => { void injectPrintingSettings(); }, 0);
  }

  lifecycle.on('route:before', () => closePostSaleModal());
  const onSettingsRoute = ({ route }) => { if (route === 'settings') queueSettingsInjection(); };
  lifecycle.on('route:mounted', onSettingsRoute);
  lifecycle.on('route:updated', onSettingsRoute);
  if (document.body.dataset.activeRoute === 'settings') queueSettingsInjection();

  root.PdvPostSaleReceiptUi = Object.freeze({ showPostSaleModal, injectPrintingSettings, closePostSaleModal });
})();
