'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('user-facing operational states are translated through the canonical UI model',()=>{
  const model=read('desktop/renderer/ui-model.js');
  const vertical=read('desktop/renderer/vertical-modules.js');
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  const operational=read('desktop/renderer/operational-pages.js');
  const access=read('desktop/renderer/access-center-ui.js');

  for(const marker of ["NEW:'Novo pedido'","PREPARING:'Preparando'","READY:'Pedido pronto'","OUT_FOR_DELIVERY:'Saiu para entrega'","PICKED_UP:'Retirado'","DELIVERED:'Entregue'"]) assert.match(model,new RegExp(marker.replace(/[.*+?^$()|[\]\\]/g,'\\$&')));
  assert.match(vertical,/statusLabel\(order\.status\)/);
  assert.doesNotMatch(vertical,/<span>\$\{escapeHtml\(order\.status\)\}<\/span>/);
  assert.match(restaurant,/ui\?\.statusLabel/);
  assert.match(restaurant,/ui\?\.deviceTypeLabel/);
  assert.doesNotMatch(restaurant,/roleLabel|user\.role/);
  assert.match(operational,/ui\?\.statusLabel/);
  assert.match(access,/ui\?\.statusLabel/);
  assert.match(access,/ui\?\.deviceTypeLabel/);
  assert.doesNotMatch(access,/<input name="tableId"/);
  assert.doesNotMatch(access,/<select name="tableId"/);
});

test('delivery and pickup keep checkout search and WhatsApp regression coverage',()=>{
  const app=read('desktop/renderer/app.js');
  const router=read('server/checkout-document-router.js');
  const checkoutTests=read('test/checkout-document-search.test.js');
  const whatsappTests=read('test/whatsapp-pickup-ready.test.js');
  const vertical=read('desktop/renderer/vertical-modules.js');

  assert.match(app,/data-checkout-document-filter="delivery"/);
  assert.match(app,/data-checkout-document-filter="retirada"/);
  assert.match(router,/checkout\/documents\/delivery\/:id\/open/);
  assert.match(checkoutTests,/canonical linked sale/);
  assert.match(checkoutTests,/existing canonical sale/);
  assert.match(whatsappTests,/buildPickupReadyWhatsappUrl/);
  assert.match(vertical,/Avisar no WhatsApp/);
});

test('Food architecture documents one canonical order-production-checkout model',()=>{
  const ux=read('UX-CONTRACT.md');
  const architecture=read('docs/architecture/e40-e47-verticals.md');
  assert.match(ux,/Balc[aã]o/i);
  assert.match(ux,/Mesas e comandas/i);
  assert.match(ux,/Entrega e retirada/i);
  assert.match(architecture,/KDS/i);
  assert.match(architecture,/SaleService canônico|venda canônica|venda canonica/i);
  assert.match(architecture,/Delivery|Entrega e retirada/i);
});


test('technical vertical fields stay out of everyday operation',()=>{
  const finalUi=read('desktop/renderer/e48-e54-ui.js');
  const vertical=read('desktop/renderer/vertical-modules.js');
  assert.doesNotMatch(finalUi,/ID da venda|ID da variante|ID da mesa \(modo mesa\)|ID do operador local/);
  assert.doesNotMatch(finalUi,/new MutationObserver/);
  assert.doesNotMatch(vertical,/new MutationObserver/);
  assert.doesNotMatch(vertical,/Sabores \(separados por vírgula\)|input\('productId','Produto base'\)|input\('sizeId','Tamanho'\)/);
  assert.match(vertical,/data-pizza-profile-options/);
});

test('delivery and pickup have a real gated Electron flow including WhatsApp and Balcao search',()=>{
  const config=JSON.parse(read('qa/artisys-qa.config.json'));
  const pkg=JSON.parse(read('package.json'));
  const workflow=read('.github/workflows/verify.yml');
  assert.equal(config.flows['delivery-pickup-operational'],'flows/delivery-pickup-operational-e2e.json');
  const flow=JSON.parse(read(path.join('qa',config.flows['delivery-pickup-operational'])));
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of [
    'delivery-abrir-alimentacao','delivery-abrir-painel','retirada-criar-pedido',
    'retirada-aguardando-producao','retirada-kds-iniciar-preparo','retirada-kds-marcar-pronto',
    'retirada-pedido-pronto','retirada-whatsapp-disponivel','retirada-whatsapp-abrir',
    'retirada-whatsapp-confirmado','retirada-marcar-retirado','retirada-historico-confirmado',
    'balcao-senha-criar-pedido','balcao-senha-1-confirmada','balcao-senha-concluir','balcao-senha-segundo-pedido','balcao-senha-2-confirmada',
    'delivery-criar-pedido','delivery-kds-iniciar-preparo','delivery-kds-marcar-pronto','delivery-definir-entregador',
    'delivery-sair-para-entrega','delivery-marcar-entregue','delivery-historico-confirmado',
    'delivery-busca-balcao','delivery-abrir-no-caixa','delivery-finalizar-venda','delivery-confirmar-pagamento',
    'delivery-venda-concluida-api','delivery-caixa-movimento-api','delivery-estoque-baixado-api','delivery-historico-venda-api'
  ]) assert.equal(names.has(name),true,name);
  assert.match(pkg.scripts['qa:e2e:delivery-pickup']||'',/delivery-pickup-operational/);
  assert.match(workflow,/Run Delivery and pickup operational E2E/);
  assert.match(workflow,/qa:e2e:delivery-pickup/);
});

test('administrative surfaces share hierarchy markers and shared components',()=>{
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  const access=read('desktop/renderer/access-center-ui.js');
  const vertical=read('desktop/renderer/vertical-modules.js');
  const styles=read('desktop/renderer/styles.css');
  assert.match(restaurant,/data-admin-surface="restaurant"/);
  assert.match(access,/data-admin-surface="access"/);
  assert.match(vertical,/data-admin-surface="modules"/);
  for(const source of [restaurant,access,vertical])assert.match(source,/admin-section-head/);
  assert.match(styles,/Shared administrative hierarchy/);
  assert.match(styles,/\.admin-section-grid/);
});
