'use strict';

(() => {
  function normalizeDecimalInput(input) {
    if (!input || input.inputMode !== 'decimal') return;
    const value = String(input.value || '');
    if (value.includes(',')) return;
    const match = value.match(/^(.*?)(\.)(\d{1,2})$/);
    if (match) input.value = `${match[1]},${match[3]}`;
  }

  document.addEventListener('input', (event) => {
    if (event.target instanceof HTMLInputElement) normalizeDecimalInput(event.target);
  }, true);

  document.addEventListener('submit', (event) => {
    event.target?.querySelectorAll?.('input[inputmode="decimal"]').forEach(normalizeDecimalInput);
  }, true);
})();
