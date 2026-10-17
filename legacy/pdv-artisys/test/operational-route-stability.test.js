'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
const index = read('desktop/renderer/index.html');
const app = read('desktop/renderer/app.js');
const operational = read('desktop/renderer/operational-pages.js');
const reports = read('desktop/renderer/reporting-v2.js');
const returnsUi = read('desktop/renderer/returns-ui.js');

test('renderer loads lifecycle and route registry before app and retires DOM route watchdog', () => {
  assert.ok(index.indexOf('./ui-lifecycle.js') < index.indexOf('./route-registry.js'));
  assert.ok(index.indexOf('./route-registry.js') < index.indexOf('./app.js'));
  assert.doesNotMatch(index, /operational-route-stability\.js/);
  assert.equal(fs.existsSync(path.join(__dirname, '../desktop/renderer/operational-route-stability.js')), false);
});

test('app navigation delegates registered routes to the canonical route registry', () => {
  assert.match(app, /const routeRegistry = window\.PdvRouteRegistry/);
  assert.match(app, /await renderRoute\(\); content\.focus/);
  assert.match(app, /routeRegistry\.render\(state\.route, \{ state \}\)/);
  assert.match(app, /routeRegistry\.register\(route, \{ owner:'app', render \}\)/);
  assert.doesNotMatch(app, /if \(state\.route === 'returns'\) return renderReturns/);
});

test('operational pages own only their canonical routes and no longer intercept navigation clicks', () => {
  assert.match(operational, /const renderers=\{inventory:renderInventory,cash:renderCash,sales:renderSalesHistory,finance:renderFinance,settings:renderSettings\}/);
  assert.match(operational, /routeRegistry\.register\(route,\{owner:'operational-pages',render:\(\)=>showRoute\(route\)\}\)/);
  assert.doesNotMatch(operational, /OPERATIONAL_ROUTES/);
  assert.doesNotMatch(operational, /stopImmediatePropagation\(\).*showRoute/);
});

test('reports and returns have one explicit route owner each', () => {
  assert.match(reports, /register\('reports', \{ owner:'reporting-v2'/);
  assert.doesNotMatch(reports, /route !== 'reports'/);
  assert.doesNotMatch(reports, /event\.key !== 'F9'/);
  assert.match(returnsUi, /register\('returns', \{ owner:'returns-ui'/);
  assert.doesNotMatch(returnsUi, /new MutationObserver/);
  assert.doesNotMatch(returnsUi, /data-route="returns"/);
});

test('operational renderers still refuse stale commits after navigation moved elsewhere', () => {
  assert.match(operational, /function routeActive\(route\)\{return document\.body\.dataset\.activeRoute===route;\}/);
  for (const [name, route] of [
    ['renderInventory','inventory'],
    ['renderCash','cash'],
    ['renderSalesHistory','sales'],
    ['renderFinance','finance'],
    ['renderSettings','settings'],
  ]) {
    const start = operational.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const next = operational.indexOf('\n  async function ', start + 20);
    const block = operational.slice(start, next === -1 ? operational.length : next);
    assert.match(block, new RegExp(`if\\(!routeActive\\('${route}'\\)\\)return;`), `${name} must guard its final render`);
  }
});
