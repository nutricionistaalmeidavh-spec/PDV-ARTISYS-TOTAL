'use strict';

(() => {
  const root = window;
  const ui = root.PdvUiModel;
  const ApiClient = root.PdvApiClient?.ApiClient;
  if (!ui || !ApiClient) return;

  let cashReceivedCents = null;
  let cashRequiredCents = 0;
  let enhanceGeneration = 0;

  function normalizeLabel(value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  }

  function isCashLabel(value) {
    const label = normalizeLabel(value);
    return label === 'dinheiro' || label === 'dinheiro recebido';
  }

  function paymentRows(modal) {
    return Array.from(modal?.querySelectorAll('.payment-line') || []).map(row => ({
      methodLabel:row.querySelector('strong')?.textContent || '',
      amountCents:ui.parseCurrencyToCents(row.querySelector('span')?.textContent || '')
    }));
  }

  function resetCashState() {
    cashReceivedCents = null;
    cashRequiredCents = 0;
  }

  function cashSummary(requiredCents, receivedCents) {
    return ui.calculateCashChange(requiredCents, receivedCents);
  }

  if (!ApiClient.prototype.__artisysCashChangePatched) {
    const originalCompleteSale = ApiClient.prototype.completeSale;
    Object.defineProperty(ApiClient.prototype, '__artisysCashChangePatched', { value:true, configurable:false, enumerable:false });
    ApiClient.prototype.completeSale = async function patchedCashCompleteSale(id, payments) {
      let outgoing = Array.isArray(payments) ? payments.map(payment => ({ ...payment })) : [];
      const hasCash = outgoing.some(payment => String(payment?.method || '').toUpperCase() === 'CASH');
      if (hasCash && Number.isSafeInteger(cashReceivedCents) && cashReceivedCents >= 0) {
        let cashWritten = false;
        outgoing = outgoing.flatMap(payment => {
          if (String(payment?.method || '').toUpperCase() !== 'CASH') return [payment];
          if (cashWritten) return [];
          cashWritten = true;
          return [{ ...payment, amountCents:cashReceivedCents }];
        });
      }
      try {
        const result = await originalCompleteSale.call(this, id, outgoing);
        resetCashState();
        return result;
      } catch (error) {
        throw error;
      }
    };
  }

  function enhancePaymentModal() {
    const modalRoot = document.getElementById('modal-root');
    if (!modalRoot) return;
    const modal = modalRoot.querySelector('.modal-card');
    const title = modal?.querySelector('.modal-head h2')?.textContent?.trim();
    if (!modal || title !== 'Pagamento da venda') {
      if (modalRoot.classList.contains('hidden')) resetCashState();
      return;
    }
    if (modal.querySelector('#cash-received-value')) return;

    const rows = paymentRows(modal);
    const cashRows = rows.filter(row => isCashLabel(row.methodLabel));
    if (!cashRows.length) {
      resetCashState();
      return;
    }

    const totalCents = ui.parseCurrencyToCents(modal.querySelector('.grand-total strong')?.textContent || '');
    const nonCashPaidCents = rows.filter(row => !isCashLabel(row.methodLabel)).reduce((sum,row) => sum + row.amountCents, 0);
    cashRequiredCents = Math.max(totalCents - nonCashPaidCents, 0);
    if (!Number.isSafeInteger(cashReceivedCents)) cashReceivedCents = cashRows.reduce((sum,row) => sum + row.amountCents, 0);

    const panel = document.createElement('div');
    panel.className = 'payment-add cash-change-panel';
    panel.innerHTML = `<div class="field"><label for="cash-received-value">Valor recebido</label><input id="cash-received-value" inputmode="decimal" autocomplete="off" value="${(cashReceivedCents / 100).toFixed(2).replace('.', ',')}"></div><div class="total-row cash-change-total"><span>Troco</span><strong id="cash-change-value">${ui.formatCents(0)}</strong></div><small id="cash-change-message" class="ops-muted" aria-live="polite"></small>`;
    const actions = modal.querySelector('.modal-actions');
    if (actions?.parentNode) actions.parentNode.insertBefore(panel, actions);
    else modal.querySelector('.modal-body')?.appendChild(panel);

    const input = panel.querySelector('#cash-received-value');
    const changeNode = panel.querySelector('#cash-change-value');
    const message = panel.querySelector('#cash-change-message');
    const remainingRow = Array.from(modal.querySelectorAll('.total-row')).find(row => row.querySelector('span')?.textContent?.trim() === 'Restante');
    const remainingValue = remainingRow?.querySelector('strong');
    const confirm = modal.querySelector('#confirm-payment');

    function renderCashState() {
      const receivedCents = Math.max(0, ui.parseCurrencyToCents(input?.value || ''));
      cashReceivedCents = receivedCents;
      const summary = cashSummary(cashRequiredCents, receivedCents);
      if (changeNode) changeNode.textContent = ui.formatCents(summary.changeCents);
      if (remainingValue) remainingValue.textContent = ui.formatCents(summary.remainingCents);
      if (message) message.textContent = summary.sufficient ? (summary.changeCents > 0 ? `Troco a devolver: ${ui.formatCents(summary.changeCents)}` : 'Valor recebido suficiente.') : `Faltam ${ui.formatCents(summary.remainingCents)}.`;
      if (confirm) confirm.disabled = !summary.sufficient;
      return summary;
    }

    input?.addEventListener('input', renderCashState);
    input?.addEventListener('blur', () => {
      const received = Math.max(0, ui.parseCurrencyToCents(input.value));
      input.value = (received / 100).toFixed(2).replace('.', ',');
      renderCashState();
    });
    confirm?.addEventListener('click', event => {
      const summary = renderCashState();
      if (summary.sufficient) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      input?.focus();
    }, true);
    renderCashState();
    setTimeout(() => { input?.focus(); input?.select(); }, 0);
  }

  function scheduleEnhance() {
    const generation = ++enhanceGeneration;
    for (const delay of [0,50,150,350,750,1500]) {
      setTimeout(() => {
        if (generation !== enhanceGeneration) return;
        enhancePaymentModal();
      }, delay);
    }
  }

  root.addEventListener('click', scheduleEnhance, true);
  root.addEventListener('keydown', event => {
    if (event.key === 'F12' || event.key === 'Enter' || event.key === ' ') scheduleEnhance();
  }, true);
  scheduleEnhance();

  root.PdvCashChangeUi = Object.freeze({ cashSummary });
})();
