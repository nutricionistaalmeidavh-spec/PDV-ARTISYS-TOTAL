'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const lifecycleSource = fs.readFileSync(path.join(root, 'desktop/renderer/ui-lifecycle.js'), 'utf8');
const registrySource = fs.readFileSync(path.join(root, 'desktop/renderer/route-registry.js'), 'utf8');

function createRuntime() {
  const domEvents = [];
  class CustomEvent {
    constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
  }
  const sandbox = {
    console,
    CustomEvent,
    window: {
      dispatchEvent(event) { domEvents.push(event); return true; }
    }
  };
  vm.createContext(sandbox);
  vm.runInContext(lifecycleSource, sandbox, { filename:'ui-lifecycle.js' });
  vm.runInContext(registrySource, sandbox, { filename:'route-registry.js' });
  return { ...sandbox.window, domEvents };
}

test('route registry enforces one canonical owner per route', () => {
  const runtime = createRuntime();
  runtime.PdvRouteRegistry.register('cash', { owner:'operational-pages', render() {} });
  assert.equal(runtime.PdvRouteRegistry.ownerOf('cash'), 'operational-pages');
  assert.throws(
    () => runtime.PdvRouteRegistry.register('cash', { owner:'other-renderer', render() {} }),
    /already belongs to operational-pages/
  );
});

test('route registry publishes deterministic before, mounted and unmounted lifecycle events', async () => {
  const runtime = createRuntime();
  const observed = [];
  for (const name of ['route:before','route:mounted','route:unmounted']) {
    runtime.PdvUiLifecycle.on(name, detail => observed.push(`${name}:${detail.route}`));
  }
  runtime.PdvRouteRegistry.register('home', { owner:'app', render() { observed.push('render:home'); } });
  runtime.PdvRouteRegistry.register('cash', { owner:'operational-pages', render() { observed.push('render:cash'); } });

  await runtime.PdvRouteRegistry.render('home');
  await runtime.PdvRouteRegistry.render('cash');

  assert.deepEqual(observed, [
    'route:before:home',
    'render:home',
    'route:mounted:home',
    'route:unmounted:home',
    'route:before:cash',
    'render:cash',
    'route:mounted:cash'
  ]);
  assert.equal(runtime.PdvUiLifecycle.activeRoute, 'cash');
  assert.equal(runtime.PdvRouteRegistry.activeRoute, 'cash');
});

test('renderer MutationObserver budget is zero', () => {
  const rendererDir = path.join(root, 'desktop/renderer');
  const files = fs.readdirSync(rendererDir).filter(name => name.endsWith('.js'));
  let observers = 0;
  for (const file of files) {
    const source = fs.readFileSync(path.join(rendererDir, file), 'utf8');
    observers += (source.match(/new MutationObserver\b/g) || []).length;
  }
  assert.equal(observers, 0, `MutationObserver is forbidden in renderer production code; found ${observers}`);
});
