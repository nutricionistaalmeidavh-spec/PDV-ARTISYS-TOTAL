'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('returns UI boots against the renderer global without ReferenceError',()=>{
  const source=read('desktop/renderer/returns-ui.js');
  const registrations=[];
  const routeContent={querySelector(){return null;}};
  const context={
    window:{
      PdvApiClient:{ApiClient:class ApiClient{}},
      PdvUiModel:{},
      PdvRouteRegistry:{register(...args){registrations.push(args);}}
    },
    document:{
      getElementById(id){return id==='route-content'?routeContent:null;},
      body:{dataset:{activeRoute:'home'}}
    },
    Object,console,setTimeout,clearTimeout
  };
  vm.runInNewContext(source,context,{filename:'returns-ui.js'});
  assert.equal(registrations.length,1);
  assert.equal(registrations[0][0],'returns');
});

test('manual payment UI does not advertise TEF integration',()=>{
  const app=read('desktop/renderer/app.js');
  const returns=read('desktop/renderer/returns-ui.js');
  assert.doesNotMatch(app,/data-pay="tef"|>TEF</);
  assert.doesNotMatch(returns,/Cartão crédito \/ TEF/);
  assert.match(app,/data-pay="card">Cartão/);
});

test('checkout document locator presents operational statuses in Portuguese',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/checkoutDocumentStatusLabel/);
  for(const label of ['Em aberto','Confirmado','Parcialmente atendido'])assert.match(app,new RegExp(label));
  assert.doesNotMatch(app,/escapeHtml\(row\.status\)/);
});

test('workflow hubs are compact enough to expose primary destinations above the fold',()=>{
  const css=read('desktop/renderer/classic-home-ui.css');
  assert.match(css,/\.flow-hub-grid\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css,/\.flow-hub-grid \.home-tile\s*\{[^}]*min-height:1[1234]\dpx/s);
});

test('Settings Areas prioritizes optional areas before compact Core explanation',()=>{
  const modules=read('desktop/renderer/vertical-modules.js');
  const optionalIndex=modules.indexOf('<section class="vertical-settings">');
  const coreIndex=modules.indexOf('data-core-area="true"');
  assert.ok(optionalIndex>=0&&coreIndex>optionalIndex,'optional areas must render before Core explanation');
  assert.match(modules,/core-area-summary/);
});

test('checkout context preserves readable seller and customer identity',()=>{
  const css=read('desktop/renderer/ux-home-checkout.css');
  assert.match(css,/\.sale-context-grid \.customer-block[^}]*min-width:0/s);
  assert.match(css,/#seller-select[^}]*text-overflow:ellipsis/s);
  assert.match(css,/\.customer-selected (?:strong|div)[^}]*min-width:0/s);
});

test('optional module navigation reuses canonical sidebar labels and accessible names',()=>{
  const app=read('desktop/renderer/app.js');
  const modules=read('desktop/renderer/vertical-modules.js');
  assert.match(app,/FOOD: \{ label: 'Alimentação'/);
  assert.match(app,/WHOLESALE: \{ label: 'Atacado'/);
  assert.match(app,/aria-label="\$\{ROUTES\[route\]\.label\}"/);
  assert.doesNotMatch(modules,/module-nav-label|data-module-nav/);
});

test('managed toasts announce atomically and remain bounded',()=>{
  const toast=read('desktop/renderer/toast-ui.js');
  assert.match(toast,/MAX_VISIBLE = 1/);
  assert.match(toast,/setAttribute\('role', normalized === 'error' \? 'alert' : 'status'\)/);
  assert.match(toast,/setAttribute\('aria-atomic','true'\)/);
});

test('QA includes explicit wholesale quantity-tier pricing through the UI',()=>{
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of ['seed-faixa-atacado-qa','atacado-selecionar-produto-faixa','atacado-quantidade-faixa','atacado-adicionar-item-faixa','atacado-preco-faixa-visivel']){
    assert.equal(names.has(name),true,name);
  }
});
