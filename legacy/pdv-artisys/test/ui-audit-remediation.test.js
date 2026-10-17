'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

function relativeLuminance(hex){
  const rgb=hex.replace('#','').match(/.{2}/g).map(pair=>parseInt(pair,16)/255).map(value=>value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4);
  return 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
}
function contrast(hex,background='#ffffff'){
  const a=relativeLuminance(hex);const b=relativeLuminance(background);
  return (Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);
}
function cssVar(source,name){
  const match=source.match(new RegExp(`--${name}\\s*:\\s*(#[0-9a-fA-F]{6})`));
  assert.ok(match,`missing --${name}`);
  return match[1];
}

test('muted text tokens meet WCAG AA contrast on white across desktop and mobile surfaces',()=>{
  for(const file of ['desktop/renderer/styles.css','server/mobile/styles.css','server/customer-menu/styles.css']){
    const css=read(file);
    const token=file.includes('desktop/')?cssVar(css,'muted'):cssVar(css,'muted');
    assert.ok(contrast(token)>=4.5,`${file} --muted contrast is ${contrast(token).toFixed(2)}:1`);
  }
  assert.doesNotMatch(read('desktop/renderer/app.js'),/#9aa6bb/i);
});

test('checkout critical controls have programmatic labels',()=>{
  const app=read('desktop/renderer/app.js');
  assert.match(app,/aria-label="Buscar produto por nome, código ou código de barras"/);
  assert.match(app,/aria-label="Buscar cliente"/);
  assert.match(app,/for="seller-select"/);
  assert.match(app,/aria-label="Percentual de desconto"/);
  assert.match(app,/aria-label="Remover cliente"/);
});

test('checkout keeps payment and finalization accessible when the panel scrolls',()=>{
  const js=read('desktop/renderer/ux-home-checkout.js');
  const css=read('desktop/renderer/ux-home-checkout.css');
  assert.match(js,/sale-checkout-footer/);
  assert.match(css,/\.sale-panel\s*\{[^}]*grid-template-rows:[^;}]*minmax\(84px,1fr\)[^;}]*auto[^}]*overflow-y:auto/s);
  assert.match(css,/\.sale-checkout-footer\s*\{/);
  assert.match(css,/\.sale-cart-region \.cart-list\s*\{[^}]*min-height:0[^}]*overflow:auto/s);
});

test('touch-first restaurant surfaces keep interactive targets at least 44px',()=>{
  const mobile=read('server/mobile/styles.css');
  for(const pattern of [
    /\.top>button\{[^}]*min-height:44px/,
    /\.product button,\.request-row button\{[^}]*min-height:44px/,
    /\.qty button\{[^}]*width:44px[^}]*height:44px/
  ]) assert.match(mobile,pattern);

  const menu=read('server/customer-menu/styles.css');
  for(const pattern of [
    /\.clear-search\{[^}]*width:44px[^}]*height:44px/,
    /\.category-chip\{[^}]*min-height:44px/,
    /\.icon-button\{[^}]*width:44px[^}]*height:44px/,
    /\.line-tools button\{[^}]*width:44px[^}]*height:44px/
  ]) assert.match(menu,pattern);
});

test('reduced motion uses explicit alternatives instead of the global 0.01ms kill switch',()=>{
  const desktop=read('desktop/renderer/styles.css');
  assert.doesNotMatch(desktop,/\.01ms/);
  assert.match(desktop,/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none\s*!important/);
});

test('navigation labels remain readable and shell scripts do not block HTML parsing',()=>{
  const css=read('desktop/renderer/styles.css');
  assert.match(css,/\.nav-label\{[^}]*font-size:(?:1[1-9]|[2-9]\d)px/);
  const html=read('desktop/renderer/index.html');
  const scripts=[...html.matchAll(/<script\s+([^>]*src="[^"]+"[^>]*)><\/script>/g)];
  assert.ok(scripts.length>40);
  for(const [,attrs] of scripts)assert.match(attrs,/\bdefer\b/);
});


test('tablet desktop shell collapses secondary topbar context and checkout tools without clipping',()=>{
  const css=read('desktop/renderer/ux-home-checkout.css');
  assert.match(css,/@media \(max-width:1100px\)[\s\S]*#network-status[\s\S]*\.clock[\s\S]*display:none/s);
  assert.match(css,/@media \(max-width:1100px\)[\s\S]*\.checkout-tools\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/s);
  assert.match(css,/@media \(max-width:1100px\)[\s\S]*\.checkout-tools \.search-field\s*\{[^}]*grid-column:1\/-1/s);
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  assert.equal(flow.steps.some(step=>step.action==='expectNoHorizontalOverflow'&&step.selector==='#app-topbar'),true);
});

test('QA verifies finalization is inside the viewport and runs compact plus tablet desktop coverage',()=>{
  const steps=read('qa/runtime/src/steps.js');
  const flow=JSON.parse(read('qa/flows/all-pages-audit.json'));
  const workflow=read('.github/workflows/verify.yml');
  const pkg=JSON.parse(read('package.json'));
  assert.match(steps,/case 'expectInViewport'/);
  assert.equal(flow.steps.some(step=>step.action==='expectInViewport'&&step.selector==='#finalize-sale'),true);
  assert.ok(pkg.scripts['qa:e2e:tablet']);
  assert.match(workflow,/qa:e2e:tablet/);
  assert.match(workflow,/qa:web-surfaces/);
});

test('mobile and public menu are explicit QA-gated surfaces',()=>{
  const pkg=JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['qa:web-surfaces'],'node --test test/ui-web-surfaces.test.js');
  const surfaceTest=read('test/ui-web-surfaces.test.js');
  assert.match(surfaceTest,/\/mobile/);
  assert.match(surfaceTest,/\/m\/\$\{access\.token\}/);
});

test('shared semantic UI colors are represented by tokens instead of repeated raw literals',()=>{
  const css=read('desktop/renderer/styles.css');
  const checkout=read('desktop/renderer/ux-home-checkout.css');
  const app=read('desktop/renderer/app.js');
  for(const token of ['text-subtle','text-label','line-soft','surface-raised','surface-hover','surface-subtle','surface-selected']) {
    assert.match(css,new RegExp(`--${token}:`));
  }
  assert.ok((css.match(/#edf1f6/gi)||[]).length<=1,'soft divider must be tokenized after declaration');
  assert.ok((css.match(/#53627f/gi)||[]).length<=1,'label text must be tokenized after declaration');
  assert.doesNotMatch(checkout,/#edf1f6|#53627f/i);
  assert.match(app,/class="optional-label"/);
  assert.doesNotMatch(app,/style="color:#9aa6bb/);
});


test('operational desktop polish uses the shared visual primitive scale',()=>{
  const foundation=read('desktop/renderer/styles.css');
  for(const token of [
    'radius-sm','radius-md','radius-lg',
    'shadow-sm','shadow-md',
    'border-control','border-card',
    'surface-control','surface-muted',
    'focus-border','focus-ring',
    'text-operational','text-operational-strong',
    'space-1','space-2','space-3','space-4','space-5','space-6'
  ]) assert.match(foundation,new RegExp(`--${token}:`),`missing shared token --${token}`);

  const targets=[
    'desktop/renderer/products-dense-view.css',
    'desktop/renderer/customers-master-detail.css',
    'desktop/renderer/regression-hardening.css',
    'desktop/renderer/access-center-ui.css',
    'desktop/renderer/settings-hub-ui.css'
  ];
  for(const file of targets){
    const css=read(file);
    assert.doesNotMatch(css,/#(?:dce5f0|dce5f2|dbe5f2|edf1f6|f8fafc|53627f|69758c)/i,`${file} still owns a shared visual primitive`);
  }

  for(const file of [
    'desktop/renderer/sale-observation-ui.js',
    'desktop/renderer/app.js',
    'desktop/renderer/delivery-address-ui.js'
  ]) assert.doesNotMatch(read(file),/style="/i,`${file} must use CSS classes instead of static inline visual styles`);
  assert.doesNotMatch(read('desktop/renderer/catalog-removal-ui.js'),/\.style\.marginTop/,'supplier management spacing must be CSS-owned');
  assert.doesNotMatch(read('desktop/renderer/hardware-scale-ui.js'),/\.style\.color/,'hardware status tone must be CSS-owned');
});