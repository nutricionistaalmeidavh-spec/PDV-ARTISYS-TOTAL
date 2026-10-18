import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';

const fixture=JSON.parse(readFileSync(new URL('../../../docs/parity/fixtures/p5-home004-desktop-navigation.json',import.meta.url),'utf8'));
const read=(path)=>readFileSync(new URL(path,import.meta.url));
const sha=(bytes)=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');

function desktopNavigationBaseline(){
 assert.equal(fixture.desktop.commit,'7efea9c61f75be1536a1e516e917218f2b8bf2bf');
 const desktop=read('../../../docs/parity/baseline/desktop-app.js');
 assert.equal(sha(desktop),'87b463226b3440e8811d3fcbf3ddcdd4ccff4275');
 const report=read('../../../docs/parity/baseline/desktop-reporting-v2.js');
 assert.equal(sha(report),fixture.desktop.reportBlob);
 for(const anchor of fixture.desktop.anchors){
   assert.ok(desktop.toString('utf8').includes(anchor),'desktop navigation source missing: '+anchor);
 }
 const web=read('../../web/app.js').toString('utf8');
 assert.ok(web.includes("if (!canAccessRoute(route)) route = 'home';"),'web route auth gate must remain');
 assert.ok(web.includes("await renderRoute(); content.focus({ preventScroll: true });"),'desktop focus contract preserved');
}

function harness(){
 const events=new Map(),tab={dataset:{reportWeb:fixture.selectedTab},focused:0,focus(){this.focused++;}};
 const content={
   scrollTop:0,scrollHeight:1000,clientHeight:600,
   scrollTo({top}){this.scrollTop=top;},
   querySelector(q){return q.includes('data-report-web')?tab:null;},
   querySelectorAll(q){return q.includes('data-report-web')?[tab]:[]}
 };
 const document={
   body:{dataset:{activeRoute:'home'}},documentElement:{scrollTop:0},addEventListener(){},
   getElementById(name){return name==='route-content'?content:null;}
 };
 const window={PdvUiLifecycle:{on(event,cb){events.set(event,cb);}},scrollTo(){}};
 runInNewContext(read('../../web/route-scroll-ui.js').toString('utf8'),{
   window,document,requestAnimationFrame:fn=>fn()
 },{timeout:1500,filename:'route-scroll-ui.js'});
 const mounted=(route,scope)=>{
   document.body.dataset.activeRoute=route;
   events.get('route:mounted')({route,scope});
   events.get('route:focus-ready')?.({route,scope});
 };
 const transition=(next,previous,scope)=>{
   events.get('route:before')({route:next,previousRoute:previous,scope});
   mounted(next,scope);
 };
 const enter=(scope)=>{
   transition('reports','home',scope);
   content.scrollTop=fixture.restoredScroll;
 };
 return {content,tab,events,mounted,transition,enter,document};
}

test('home-004/nominal p5-home004-desktop-navigation-v1 preserve report scroll/focus after same-user roundtrip',()=>{
 desktopNavigationBaseline();
 const h=harness();
 h.enter(fixture.contextA);
 h.transition('checkout','reports',fixture.contextA);
 h.transition('reports','checkout',fixture.contextA);
 assert.equal(h.content.scrollTop,fixture.restoredScroll);
 assert.equal(h.tab.focused,1,'focus returns to the active report tab without scrolling');
});

test('home-004/authorization p5-home004-desktop-navigation-v1 no restoration across different authenticated user',()=>{
 desktopNavigationBaseline();
 const h=harness();
 h.enter(fixture.contextA);
 h.transition('checkout','reports',fixture.contextA);
 h.transition('reports','checkout','tenant-a|branch-a|user-b');
 assert.equal(h.content.scrollTop,0);
 assert.equal(h.tab.focused,0,'no focus is restored from an unrelated user');
});

test('home-004/tenant-isolation p5-home004-desktop-navigation-v1 never restore another tenant or branch position',()=>{
 desktopNavigationBaseline();
 const h=harness();
 h.enter(fixture.contextA);
 h.transition('checkout','reports',fixture.contextA);
 h.transition('reports','checkout',fixture.contextB);
 assert.equal(h.content.scrollTop,0,'a second store cannot inherit the first store scroll');
 assert.equal(h.tab.focused,0);
 h.transition('checkout','reports',fixture.contextB);
 h.transition('reports','checkout',fixture.contextA);
 assert.equal(h.content.scrollTop,fixture.restoredScroll,'original store still owns its scroll');
});

test('home-004/failure-recovery p5-home004-desktop-navigation-v1 route updates and context changes never leak private data',()=>{
 desktopNavigationBaseline();
 const h=harness();
 h.enter(fixture.contextA);
 h.content.scrollTop=fixture.restoredScroll;
 h.transition('checkout','reports',fixture.contextA);
 h.transition('reports','checkout',fixture.contextA);
 assert.equal(h.content.scrollTop,fixture.restoredScroll);
 h.transition('home','reports',fixture.contextA);
 h.transition('reports','home',fixture.contextB);
 assert.equal(h.content.scrollTop,0,'stale scroll from previous context is discarded');
 const code=read('../../web/route-scroll-ui.js').toString('utf8');
 for(const key of fixture.excludedPrivateKeys)assert.ok(!new RegExp('positions\\.set\\([^\\n]*'+key).test(code));
});
