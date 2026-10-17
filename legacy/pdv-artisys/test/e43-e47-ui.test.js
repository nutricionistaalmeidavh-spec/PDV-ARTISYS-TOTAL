'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('desktop loads optional module API and workspace extensions',()=>{
  const html=read('desktop/renderer/index.html');
  assert.match(html,/vertical-modules\.css/);
  assert.match(html,/vertical-api-client\.js/);
  assert.match(html,/vertical-modules\.js/);
  assert.match(html,/settings-hub-ui\.css/);
  assert.match(html,/settings-hub-ui\.js/);
  const settingsHub=read('desktop/renderer/settings-hub-ui.js');
  for(const label of ['Empresa','Equipe e permissões','Unidades e dispositivos','Impressão e periféricos','Áreas','Privacidade e telemetria','Diagnóstico e backup'])assert.match(settingsHub,new RegExp(label));
});

test('vertical UI exposes one Alimentação module with operational capabilities',()=>{
  const source=read('desktop/renderer/vertical-modules.js');
  assert.match(source,/FOOD:renderFoodWorkspace/);
  for(const id of ['PIZZERIA','DELIVERY'])assert.match(source,new RegExp(`data-food-capability="${id}"`));
  assert.doesNotMatch(source,/data-food-capability="SELF_SERVICE"|Autoatendimento/);
  assert.doesNotMatch(source,/data-food-capability="FAST_FOOD"/);
  assert.match(source,/<strong>Pedidos<\/strong>/);
  assert.match(source,/if\(id==='FAST_FOOD'\)return renderDelivery\(\)/);
  assert.match(source,/Produção \/ KDS/);
  assert.match(source,/Incluído ao ativar/);
  assert.doesNotMatch(source,/MARKET_BAKERY:renderMarket/);
  assert.doesNotMatch(source,/RETAIL:\(\)=>/);
  assert.match(source,/modules\(\)/);
  assert.match(source,/saveSetting/);
});

test('manual credit wording is owned by the checkout source without DOM sanitizers',()=>{
  const app=read('desktop/renderer/app.js');
  const source=read('desktop/renderer/vertical-modules.js');
  assert.match(app,/CREDIT_CARD: 'Cartão crédito'/);
  assert.doesNotMatch(app,/Cartão crédito \/ TEF/);
  assert.doesNotMatch(source,/sanitizeLegacyPaymentCopy|createTreeWalker/);
  assert.match(read('docs/superpowers/specs/2026-09-10-e40-e54-modular-verticals-design.md'),/NÃO FISCAL/);
});

test('desktop main authenticates local vertical API calls without exposing install token to renderer',()=>{
  const main=read('desktop/main.cjs');
  const preload=read('desktop/preload.cjs');
  assert.match(main,/rawPath\.startsWith\('\/api\/v1\/vertical\/'\)/);
  assert.doesNotMatch(preload,/installToken|x-pdv-token/);
});

test('business areas are activated in settings and opened from authorized navigation',()=>{
  const source=read('desktop/renderer/vertical-modules.js');
  assert.doesNotMatch(source,/vertical-modules-launcher/);
  assert.doesNotMatch(source,/textContent='M'/);
  assert.match(source,/ops-establishment-modules-card/);
  assert.match(source,/mountSettingsModules/);
  assert.match(source,/MODULE_REQUEST_TIMEOUT_MS/);
  assert.match(source,/withTimeout/);
  assert.match(source,/Tentar novamente/);
  assert.match(source,/routeRegistry\.register\('FOOD',\{owner:'vertical-modules'/);
  assert.match(source,/O menu lateral se atualiza imediatamente/);
  assert.match(source,/Áreas do estabelecimento/);
  assert.match(source,/Núcleo ArtiSys/);
  assert.match(source,/PdvAppNavigation\?\.navigate\?\./);
  assert.doesNotMatch(source,/Abrir módulo|Gerenciar áreas|Gerenciar módulos/);
});

test('Alimentação is one direct module and production is not a separate toggle',()=>{
  const source=read('desktop/renderer/vertical-modules.js');
  const registry=read('js/core/modules/module-registry.js');
  assert.match(registry,/FOOD:Object\.freeze\(\{id:'FOOD',label:'Alimentação'/);
  assert.match(registry,/navigation:'module'/);
  assert.match(registry,/\{id:'FOOD',name:'Alimentação'/);
  assert.doesNotMatch(registry,/\{id:'PIZZERIA'|\{id:'DELIVERY'|\{id:'FAST_FOOD'|\{id:'MARKET_BAKERY'|\{id:'RETAIL'|\{id:'SELF_SERVICE'/);
  assert.match(source,/routeRegistry\.register\('FOOD'/);
  assert.match(source,/module\.id==='FOOD'/);
  assert.doesNotMatch(source,/data-module-toggle="PRODUCTION"|data-module-toggle="KDS"/);
});

test('settings expose server choices with explicit effects and accessible module switches',()=>{
  const settings=read('desktop/renderer/settings-hub-ui.js');
  const modules=read('desktop/renderer/vertical-modules.js');
  const settingsCss=read('desktop/renderer/settings-hub-ui.css');
  assert.match(settings,/settings-mode-summary/);
  assert.match(settings,/Apenas meu caixa · dados neste computador/);
  assert.match(settings,/A troca para servidor externo não migra dados locais automaticamente/);
  assert.match(settings,/data-server-option/);
  assert.match(modules,/role="switch" aria-label="Ativar/);
  assert.match(modules,/aria-checked/);
  assert.match(settingsCss,/\.ops-page\[data-settings-page="true"\]/);
  assert.doesNotMatch(settingsCss,/#classic-home-grid|\.home-tile/);
});
