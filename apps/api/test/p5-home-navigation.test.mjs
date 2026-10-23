import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const read=(path)=>readFileSync(new URL(path,import.meta.url));
const navigationScenario={
 contextA:'tenant-a|branch-a|user-a',contextB:'tenant-b|branch-b|user-b',
 selectedTab:'products',restoredScroll:185,
 excludedPrivateKeys:['customerId','sellerId','sale','token','netSalesCents']
};

function currentNavigationContract(){
 const web=read('../../web/app.js').toString('utf8');
 assert.ok(web.includes("if (!canAccessRoute(route)) route = 'home';"),'web route auth gate must remain');
 assert.match(web,/await renderRoute\(\);\s*if\(generation!==navigationGeneration\)return;\s*content\.focus\(\{ preventScroll: true \}\);/,'focus contract preserved after rejecting stale navigation');
}

function harness(){
 const events=new Map(),tab={dataset:{reportWeb:navigationScenario.selectedTab},focused:0,focus(){this.focused++;}};
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
   content.scrollTop=navigationScenario.restoredScroll;
 };
 return {content,tab,events,mounted,transition,enter,document};
}

test('home-004/nominal preserve report scroll/focus after same-user roundtrip',()=>{
 currentNavigationContract();
 const h=harness();
 h.enter(navigationScenario.contextA);
 h.transition('checkout','reports',navigationScenario.contextA);
 h.transition('reports','checkout',navigationScenario.contextA);
 assert.equal(h.content.scrollTop,navigationScenario.restoredScroll);
 assert.equal(h.tab.focused,1,'focus returns to the active report tab without scrolling');
});

test('home-004/authorization no restoration across different authenticated user',()=>{
 currentNavigationContract();
 const h=harness();
 h.enter(navigationScenario.contextA);
 h.transition('checkout','reports',navigationScenario.contextA);
 h.transition('reports','checkout','tenant-a|branch-a|user-b');
 assert.equal(h.content.scrollTop,0);
 assert.equal(h.tab.focused,0,'no focus is restored from an unrelated user');
});

test('home-004/tenant-isolation never restore another tenant or branch position',()=>{
 currentNavigationContract();
 const h=harness();
 h.enter(navigationScenario.contextA);
 h.transition('checkout','reports',navigationScenario.contextA);
 h.transition('reports','checkout',navigationScenario.contextB);
 assert.equal(h.content.scrollTop,0,'a second store cannot inherit the first store scroll');
 assert.equal(h.tab.focused,0);
 h.transition('checkout','reports',navigationScenario.contextB);
 h.transition('reports','checkout',navigationScenario.contextA);
 assert.equal(h.content.scrollTop,navigationScenario.restoredScroll,'original store still owns its scroll');
});

test('home-004/failure-recovery route updates and context changes never leak private data',()=>{
 currentNavigationContract();
 const h=harness();
 h.enter(navigationScenario.contextA);
 h.content.scrollTop=navigationScenario.restoredScroll;
 h.transition('checkout','reports',navigationScenario.contextA);
 h.transition('reports','checkout',navigationScenario.contextA);
 assert.equal(h.content.scrollTop,navigationScenario.restoredScroll);
 h.transition('home','reports',navigationScenario.contextA);
 h.transition('reports','home',navigationScenario.contextB);
 assert.equal(h.content.scrollTop,0,'stale scroll from previous context is discarded');
 const code=read('../../web/route-scroll-ui.js').toString('utf8');
 for(const key of navigationScenario.excludedPrivateKeys)assert.ok(!new RegExp('positions\\.set\\([^\\n]*'+key).test(code));
});
