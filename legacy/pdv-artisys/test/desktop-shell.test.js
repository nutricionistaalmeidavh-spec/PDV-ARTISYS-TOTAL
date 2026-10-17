const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('desktop shell contains approved navigation and topbar landmarks',()=>{
  const html=read('desktop/renderer/index.html');
  for(const marker of ['id="app-sidebar"','id="app-topbar"','id="network-status"','id="route-content"','ARTISYS']) assert.match(html,new RegExp(marker));
});

test('renderer contains definitive home and checkout flows',()=>{
  const app=read('desktop/renderer/app.js');
  for(const name of ['renderHome','renderCheckout','renderCustomers','renderSellers','renderProducts']) assert.match(app,new RegExp(`function ${name}\\b`));
  assert.match(app,/Finalizar venda/);
  assert.match(app,/Balcão/);
});

test('reporting v2 and seller synchronization are wired into desktop shell',()=>{
  const html=read('desktop/renderer/index.html');
  const sellerSync=read('desktop/renderer/seller-select-sync.js');
  assert.ok(html.indexOf('./seller-select-sync.js')>html.indexOf('./app.js'));
  assert.ok(html.indexOf('./seller-select-sync.js')<html.indexOf('./reporting-v2.js'));
  assert.doesNotThrow(()=>new Function(sellerSync));
  assert.match(sellerSync,/api\.sellers\(\)/);
  assert.match(sellerSync,/PdvUiLifecycle/);
  assert.match(sellerSync,/route:updated/);
  assert.doesNotMatch(sellerSync,/MutationObserver/);
});

test('styles define visual tokens and checkout split layout',()=>{
  const css=read('desktop/renderer/styles.css');
  for(const marker of [/--artisys-blue:/,/\.home-grid/,/\.checkout-layout/,/\.sale-panel/,/\.product-grid/,/:focus-visible/,/@media \(prefers-reduced-motion: reduce\)/]) assert.match(css,marker);
});

test('shared modal traps keyboard focus and restores its accessible dialog semantics',()=>{
  const app=read('desktop/renderer/app.js');
  for(const marker of [/role="dialog"/,/aria-modal="true"/,/aria-labelledby="pdv-modal-title"/,/modalFocusableElements/,/event\.key !== 'Tab'/,/event\.shiftKey/,/modalRoot\._returnFocus/]) assert.match(app,marker);
});

test('Electron preload exposes safe window controls',()=>{
  const preload=read('desktop/preload.cjs');
  assert.match(preload,/contextBridge/);
  assert.match(preload,/minimize/);
  assert.match(preload,/maximize/);
  assert.match(preload,/close/);
  assert.doesNotMatch(preload,/nodeIntegration\s*:\s*true/);
});
