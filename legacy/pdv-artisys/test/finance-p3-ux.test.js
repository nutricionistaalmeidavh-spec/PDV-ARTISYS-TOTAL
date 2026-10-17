'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const read=relative=>fs.readFileSync(path.join(__dirname,'..',relative),'utf8');

test('Financeiro P3 preserves filter state and exposes result context accessibly',()=>{
  const operational=read('desktop/renderer/operational-pages.js');
  const start=operational.indexOf('async function renderFinance');
  const end=operational.indexOf('async function renderReports',start);
  const finance=operational.slice(start,end);

  assert.match(operational,/financeFilterState/);
  assert.match(finance,/aria-label="Filtrar lançamentos financeiros"/);
  assert.match(finance,/aria-live="polite"/);
  assert.match(finance,/<caption class="ops-sr-only">Lançamentos financeiros<\/caption>/);
  assert.match(finance,/<th scope="col">Vencimento<\/th>/);
  assert.match(finance,/restoreFinanceFilterFocus/);
});

test('Financeiro P3 supports keyboard navigation between canonical subroutes',()=>{
  const operations=read('desktop/renderer/erp-finance-operations-ui.js');

  assert.match(operations,/ArrowRight/);
  assert.match(operations,/ArrowLeft/);
  assert.match(operations,/Home/);
  assert.match(operations,/End/);
  assert.match(operations,/aria-current="page"/);
  assert.match(operations,/data-finance-route/);
});

test('Financeiro P3 remains usable on narrow screens without hiding actions',()=>{
  const css=read('desktop/renderer/operational-pages.css');

  assert.match(css,/\.ops-sr-only\{/);
  assert.match(css,/\.finance-subnav\{[^}]*overflow-x:auto/s);
  assert.match(css,/@media\(max-width:720px\)\{[^}]*\.finance-operations-page \.ops-detail-row\{[^}]*flex-direction:column/s);
  assert.match(css,/\.finance-operations-page \.ops-detail-row>\.ops-actions\{[^}]*width:100%/s);
});

test('Financeiro P3 keeps sensitive actions on ArtiSys dialogs and observer-free',()=>{
  const operational=read('desktop/renderer/operational-pages.js');
  const start=operational.indexOf('async function renderFinance');
  const end=operational.indexOf('async function renderReports',start);
  const finance=operational.slice(start,end);
  const operations=read('desktop/renderer/erp-finance-operations-ui.js');

  assert.doesNotMatch(finance,/\b(?:alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(operations,/\b(?:alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(finance,/MutationObserver/);
  assert.doesNotMatch(operations,/MutationObserver/);
  assert.match(finance,/openFormDialog/);
  assert.match(operations,/openFormDialog/);
});
