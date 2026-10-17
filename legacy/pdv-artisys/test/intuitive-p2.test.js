'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('P2 sidebar exposes short text labels for canonical navigation',()=>{
  const app=read('desktop/renderer/app.js');
  const styles=read('desktop/renderer/styles.css');
  const index=read('desktop/renderer/index.html');
  assert.match(app,/shortLabel:\s*'Balcão'/);
  assert.match(app,/shortLabel:\s*'Vendas'/);
  assert.match(app,/shortLabel:\s*'Cadastros'/);
  assert.match(app,/shortLabel:\s*'Gestão'/);
  assert.match(app,/class="nav-label"/);
  assert.match(styles,/\.nav-label\s*\{/);
  assert.match(index,/class="nav-label">Config\.<\/span>/);
});

test('P2 Mesas e comandas defaults to an operation-only workspace',()=>{
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  assert.match(restaurant,/let activeView=['"]operation['"]/);
  assert.match(restaurant,/data-restaurant-view=/);
  assert.match(restaurant,/function renderOperation\(/);
  assert.match(restaurant,/function renderManagement\(/);
  const operationBody=restaurant.slice(restaurant.indexOf('function renderOperation('),restaurant.indexOf('function renderManagement('));
  assert.doesNotMatch(operationBody,/renderAdmin\(\)|renderReport\(\)/);
});

test('P2 management surface is explicit and capability-gated',()=>{
  const restaurant=read('desktop/renderer/restaurant-ui.js');
  assert.match(restaurant,/function canManageRestaurant\(/);
  assert.match(restaurant,/PdvAccessPolicy\?\.hasCapability\(root\.PdvCurrentAccess,'restaurant\.access'\).*PdvAccessPolicy\?\.hasCapability\(root\.PdvCurrentAccess,'settings\.manage'\)/);
  assert.doesNotMatch(restaurant,/dataset\.userRole|\['admin','manager'\]\.includes/);
  assert.match(restaurant,/data-restaurant-view-target="management"/);
  assert.match(restaurant,/Configuração e indicadores/);
  assert.match(restaurant,/if\(!canManageRestaurant\(\)\).*activeView=['"]operation['"]/);
});

test('P2 E2E covers labeled navigation, management infrastructure and inventory remediation',()=>{
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const names=new Set(flow.steps.map(step=>step.name));
  for(const name of [
    'nav-balcao-rotulo',
    'nav-gestao-rotulo',
    'mesas-comandas-operacao',
    'mesas-comandas-abrir-gestao',
    'mesas-comandas-gestao',
    'gestao-setores-producao',
    'gestao-dispositivos-lan',
    'gestao-alerta-destinos-pendentes',
    'gestao-revisar-primeiro-destino-pendente',
    'estoque-edicao-destino-pendente',
    'estoque-produto-pendente-correto',
    'estoque-destino-pendente'
  ]) assert.equal(names.has(name),true,name);
});
