'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const flow=()=>JSON.parse(read('qa/flows/all-pages-audit.json'));

test('checkout reserves a readable cart region before finalization',()=>{
  const css=read('desktop/renderer/ux-home-checkout.css');
  assert.match(css,/\.sale-panel\s*\{[^}]*grid-template-rows:auto minmax\(84px,1fr\) auto/s);
  assert.match(css,/@media \(max-height:800px\)[\s\S]*\.sale-cart-region \.cart-list\s*\{[^}]*min-height:72px/s);
  const names=new Set(flow().steps.map(step=>step.name));
  assert.equal(names.has('balcao-carrinho-item-visivel-antes-finalizar'),true);
  assert.equal(names.has('balcao-carrinho-item-legivel-antes-finalizar'),true);
});

test('business date helpers format and parse pt-BR without changing canonical values',()=>{
  const dates=require('../desktop/renderer/business-date');
  assert.equal(dates.formatDatePtBr('2026-10-03'),'03/10/2026');
  assert.equal(dates.parseDatePtBr('03/10/2026'),'2026-10-03');
  assert.equal(dates.formatDateTimePtBr('2026-10-08T17:00'),'08/10/2026 17:00');
  assert.equal(dates.parseDateTimePtBr('08/10/2026 17:00'),'2026-10-08T17:00');
});

test('date entry surfaces are explicit pt-BR instead of browser-locale native date controls',()=>{
  const reports=read('desktop/renderer/reporting-v2.js');
  const finance=read('desktop/renderer/erp-finance-operations-ui.js');
  const wholesale=read('desktop/renderer/wholesale-ui.js');
  for(const source of [reports,finance]) {
    assert.doesNotMatch(source,/type="date"/);
    assert.match(source,/data-date-ptbr/);
  }
  assert.doesNotMatch(wholesale,/datetime-local/);
  assert.match(wholesale,/data-datetime-ptbr/);

  const steps=flow().steps;
  assert.equal(steps.some(step=>step.name==='relatorios-data-inicial-ptbr'&&step.action==='expectValue'&&step.expected==='01/10/2026'),true);
  assert.equal(steps.some(step=>step.name==='atacado-previsao-ptbr'&&step.action==='expectValue'&&step.expected==='08/10/2026 17:00'),true);
});

test('desktop notifications use one managed toast and clear stale success context on route changes',()=>{
  const toast=read('desktop/renderer/toast-ui.js');
  const app=read('desktop/renderer/app.js');
  const wholesale=read('desktop/renderer/wholesale-ui.js');
  const modules=read('desktop/renderer/vertical-modules.js');
  const catalog=read('desktop/renderer/catalog-user-management-ui.js');
  assert.match(toast,/const MAX_VISIBLE = 1;/);
  assert.match(toast,/route:before/);
  for(const source of [app,wholesale,modules,catalog]) assert.match(source,/PdvToast\?\.show/);
});

test('Produtos explains its boundary with Estoque and provides a contextual shortcut',()=>{
  const view=read('desktop/renderer/products-dense-view.js');
  const controller=read('desktop/renderer/products-dense-controller.js');
  assert.match(view,/Catálogo de venda/);
  assert.match(view,/id="open-product-stock"/);
  assert.match(view,/\+ Novo produto/);
  assert.match(controller,/open-product-stock/);
  assert.match(controller,/data-route="inventory"/);
});

test('creation buttons use portable plus text instead of the full-width plus glyph',()=>{
  const app=read('desktop/renderer/app.js');
  const catalog=read('desktop/renderer/catalog-user-management-ui.js');
  assert.match(app,/id="new-customer">\+ Novo cliente/);
  assert.doesNotMatch(app,/id="new-customer">＋/);
  assert.match(catalog,/id="catalog-new-user">\+ Nova pessoa/);
  assert.doesNotMatch(catalog,/id="catalog-new-user">＋/);
});

test('mobile staff surfaces translate internal device labels for operators',()=>{
  const mobile=read('server/mobile/app.js');
  assert.match(mobile,/WAITER:'Garçom'/);
  assert.match(mobile,/KITCHEN:'Cozinha'/);
  assert.doesNotMatch(mobile,/TABLET:'Tablet da mesa'/);
  assert.doesNotMatch(mobile,/SELF_SERVICE|Autoatendimento/);

  const steps=flow().steps;
  assert.equal(steps.some(step=>step.name==='equipe-mobile-tipo-traduzido'&&step.expected==='Garçom'),true);
  assert.equal(steps.some(step=>step.name==='kds-mobile-tipo-traduzido'&&step.expected==='Cozinha'),true);
});


test('business date owns the equivalent previous-period rule used by management and reports',()=>{
  const dates=require('../desktop/renderer/business-date');
  assert.deepEqual(
    dates.equivalentPreviousPeriod('2026-10-01','2026-10-04'),
    {previousFrom:'2026-09-27',previousTo:'2026-09-30'}
  );
  const management=read('desktop/renderer/erp-finance-ui.js');
  const reports=read('desktop/renderer/reporting-v2.js');
  assert.match(management,/PdvBusinessDate\.equivalentPreviousPeriod\(from,to\)/);
  assert.match(reports,/PdvBusinessDate\.equivalentPreviousPeriod\(state\.fromDate,state\.toDate\)/);
  assert.doesNotMatch(reports,/function previousPeriod\s*\(/);
});
