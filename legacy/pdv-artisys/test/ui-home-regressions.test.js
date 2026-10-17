'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ui=require('../desktop/renderer/ui-model');
const {homeForUser}=require('../desktop/renderer/home-role-model');
const management={key:'management',label:'Gestão',description:'Resultado, DRE e fluxo de caixa',route:'management',tone:'rose',icon:'management'};

test('Home administrativa contém uma única entrada por destino conceitual',()=>{const view=homeForUser({profile:{name:'Administrador'},permissions:['sales.create','sales.view','returns.view','cash.view','customers.view','products.view','inventory.view','finance.view','reports.view','management.view','users.view','settings.view']},[...ui.HOME_TILES,management]);const keys=view.sections.flatMap(section=>section.tiles.map(tile=>tile.key));assert.equal(new Set(keys).size,keys.length);});
test('cards visíveis da Home administrativa não repetem cor',()=>{const view=homeForUser({profile:{name:'Administrador'},permissions:['sales.create','sales.view','returns.view','cash.view','customers.view','products.view','inventory.view','finance.view','reports.view','management.view','users.view','settings.view']},[...ui.HOME_TILES,management]);const tones=view.sections.flatMap(section=>section.tiles.map(tile=>tile.tone));assert.equal(new Set(tones).size,tones.length);});
test('Home canônica não preserva regra para esconder uma Home nativa paralela',()=>{const css=fs.readFileSync(path.join(__dirname,'../desktop/renderer/classic-home-ui.css'),'utf8');const app=fs.readFileSync(path.join(__dirname,'../desktop/renderer/app.js'),'utf8');assert.doesNotMatch(css,/home-grid\[hidden\]|classic-home-extras/);assert.match(app,/id=\"classic-home-grid\"/);});
test('Financeiro e Gestão usam ícones diferentes no menu',()=>{const app=fs.readFileSync(path.join(__dirname,'../desktop/renderer/app.js'),'utf8');assert.match(app,/finance:\s*\{[^\n]+icon: 'chart'/);assert.match(app,/management:\s*\{[^\n]+icon: 'management'/);});
test('modo local único não monta o detalhamento multi-local que travava Estoque',()=>{const source=fs.readFileSync(path.join(__dirname,'../desktop/renderer/operational-route-extensions.js'),'utf8');assert.match(source,/dataServer\?\.mode==='local'\)return/);});
test('módulos ativos atualizam o menu pelo owner canônico sem reconstrução paralela',()=>{const app=fs.readFileSync(path.join(__dirname,'../desktop/renderer/app.js'),'utf8');const modules=fs.readFileSync(path.join(__dirname,'../desktop/renderer/vertical-modules.js'),'utf8');assert.match(app,/artisys:modules-state-changed/);assert.match(app,/renderSidebar\(\)/);assert.doesNotMatch(modules,/artisys:sidebar-rendered|refreshModuleNavigation|data-module-nav/);});
test('páginas agrupadoras não se identificam como Home nem recebem módulos extras',()=>{const app=fs.readFileSync(path.join(__dirname,'../desktop/renderer/app.js'),'utf8');const restaurant=fs.readFileSync(path.join(__dirname,'../desktop/renderer/restaurant-ui.js'),'utf8');assert.doesNotMatch(app,/home-grid flow-hub-grid/);assert.match(restaurant,/document\.body\.classList\.remove\('theme-home'\)/);});
test('Configurações permanece fixa e acessível fora da rolagem do menu',()=>{const css=fs.readFileSync(path.join(__dirname,'../desktop/renderer/styles.css'),'utf8');assert.match(css,/\.sidebar-nav\s*\{[^}]*overflow-y:auto/s);assert.match(css,/\.sidebar\s*>\s*\[data-route="settings"\][^}]*flex:0 0 auto/s);});
