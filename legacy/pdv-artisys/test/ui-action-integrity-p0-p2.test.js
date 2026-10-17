'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('all desktop renderer product UI avoids native alert, confirm and prompt dialogs',()=>{
  const renderer=path.join(root,'desktop','renderer');
  const offenders=[];
  for(const name of fs.readdirSync(renderer).filter(name=>name.endsWith('.js'))){
    const source=fs.readFileSync(path.join(renderer,name),'utf8');
    if(/\b(?:window\.|root\.)?(?:alert|confirm|prompt)\s*\(/.test(source))offenders.push(name);
  }
  assert.deepEqual(offenders,[]);
});

test('operational route extensions use the canonical form dialog and persist through API owners',()=>{
  const source=read('desktop/renderer/operational-route-extensions.js');
  const owner=read('desktop/renderer/operational-pages.js');
  assert.match(source,/const ux=window\.ArtisysUxComponents/);
  assert.match(source,/title:'Cancelar devolução'/);
  assert.match(source,/onConfirm:data=>api\.cancelReturn\([^,]+,String\(data\.reason\|\|''\)\.trim\(\)\)/);
  assert.match(source,/title:'Estornar baixa'/);
  assert.match(source,/onConfirm:data=>api\.reverseFinanceSettlement\([^,]+,String\(data\.reason\|\|''\)\.trim\(\)\)/);
  assert.doesNotMatch(source,/\b(?:window\.|root\.)?(?:alert|confirm|prompt)\s*\(/);
  assert.doesNotMatch(source,/MutationObserver/);
  assert.doesNotMatch(source,/lifecycle\.on|route:mounted|route:updated/);
  assert.match(source,/PdvOperationalRouteExtensions=Object\.freeze/);
  assert.match(owner,/PdvOperationalRouteExtensions\?\.mountRoute\?\.\(route,pageRoot\)/);
  for(const owner of ['bindTerminalStockLocation','saveInventoryMovement','cancelReturn','createFinanceAccount','reverseFinanceSettlement']){
    assert.match(source,new RegExp(`api\\.${owner}\\(`),owner);
  }
});

test('filter chips cannot render as enabled buttons without an explicit action owner',()=>{
  delete require.cache[require.resolve('../desktop/renderer/ux-components.js')];
  const {FilterBar}=require('../desktop/renderer/ux-components.js');
  const passive=FilterBar({activeChips:[{key:'stock',label:'Estoque: baixo'}]});
  assert.doesNotMatch(passive,/<button[^>]*data-(?:remove-filter|action)/);
  assert.match(passive,/ux-filter-chip--static/);

  const actionable=FilterBar({activeChips:[{key:'stock',label:'Estoque: baixo',removeAction:'products.remove-filter'}]});
  assert.match(actionable,/<button[^>]*data-action="products\.remove-filter"[^>]*data-filter-key="stock"/);
});

test('desktop shell is slimmer while preserving 44px interactive targets',()=>{
  const css=read('desktop/renderer/styles.css');
  assert.match(css,/\.app-column\s*\{[^}]*grid-template-rows:\s*72px 1fr 44px/s);
  assert.match(css,/\.brand-mark\s*\{[^}]*height:\s*72px\s*!important/s);
  assert.match(css,/\.status-pill, \.context-pill\s*\{[^}]*height:\s*44px/s);
  assert.match(css,/\.route-content\s*\{[^}]*padding:\s*18px 22px 22px/s);
  assert.match(css,/\.page-head\s*\{[^}]*margin-bottom:\s*14px/s);
  assert.match(css,/\.page-head h1\s*\{[^}]*font-size:\s*29px/s);
  assert.match(css,/\.primary-button, \.secondary-button, \.danger-button\s*\{[^}]*min-height:\s*44px/s);
});

test('operational surfaces use the same blue action hierarchy and denser rhythm',()=>{
  const css=read('desktop/renderer/operational-pages.css');
  assert.match(css,/\.ops-page\{[^}]*padding:22px 28px 36px/s);
  assert.match(css,/\.ops-head\{[^}]*margin-bottom:18px/s);
  assert.match(css,/\.ops-head h1\{[^}]*font-size:29px/s);
  assert.match(css,/\.ops-card\{[^}]*padding:18px/s);
  assert.match(css,/\.ops-table th\{[^}]*padding:10px 12px/s);
  assert.match(css,/\.ops-table td\{[^}]*padding:10px 12px/s);
  assert.match(css,/\.ops-primary\{background:var\(--artisys-blue\)/);
  assert.match(css,/\.ops-secondary\{[^}]*border:1px solid/s);
});


test('all-pages Actions QA exercises reverse settlement through UI and verifies persistence',()=>{
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const steps=flow.steps;
  assert.ok(steps.some(step=>step.action==='capability'&&step.name==='finance.setup'&&step.scenario==='ui-reverse-settlement'));
  assert.ok(steps.some(step=>step.action==='capability'&&step.name==='finance.openReverseDialog'));
  assert.ok(steps.some(step=>step.action==='fill'&&step.selector===".ux-dialog textarea[name='reason']"));
  assert.ok(steps.some(step=>step.action==='click'&&step.selector==='.ux-dialog .ux-dialog__confirm'));
  assert.ok(steps.some(step=>step.action==='expectText'&&step.expected==='Baixa estornada.'));
  assert.ok(steps.some(step=>step.action==='capability'&&step.name==='finance.assert'));
});


test('other operational prompt replacements still call their canonical mutation owners',()=>{
  const admin=read('desktop/renderer/admin-ops.js');
  assert.match(admin,/ux\.openFormDialog\(/);
  assert.match(admin,/title:blocked\?'Registrar bloqueio':'Marcar como não aplicável'/);
  assert.match(admin,/api\.updatePilotCheck\(select\.dataset\.pilotStatus,\{status,note\}\)/);

  const operational=read('desktop/renderer/operational-pages.js');
  assert.match(operational,/title=closing\?'Fechar caixa':action==='supply'\?'Registrar suprimento':'Registrar sangria'/);
  assert.match(operational,/api\.cashAction\(open\.id,'close'/);
  assert.match(operational,/api\.cashAction\(open\.id,action,/);
  assert.match(operational,/title:'Registrar pagamento de comissão'/);
  assert.match(operational,/onConfirm:data=>api\.payCommission\(/);
});


test('cash page localizes movement and payment method codes before rendering',()=>{
  const operational=read('desktop/renderer/operational-pages.js');
  assert.match(operational,/const CASH_MOVEMENT_LABELS=Object\.freeze\(\{[^}]*OPENING:'Abertura'[^}]*SUPPLY:'Suprimento'[^}]*WITHDRAWAL:'Sangria'[^}]*SALE:'Venda'[^}]*REVERSAL:'Estorno \/ devolução'/s);
  assert.match(operational,/const CASH_PAYMENT_LABELS=Object\.freeze\(\{[^}]*CASH:'Dinheiro'[^}]*PIX:'PIX'[^}]*DEBIT_CARD:'Cartão de débito'[^}]*CREDIT_CARD:'Cartão de crédito'/s);
  assert.match(operational,/cashMovementLabel\(row\.type\)/);
  assert.match(operational,/cashPaymentLabel\(row\.paymentMethod\)/);
});
