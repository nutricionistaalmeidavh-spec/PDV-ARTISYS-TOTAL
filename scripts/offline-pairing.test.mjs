import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

const script=readFileSync(new URL('../apps/web/offline-pairing.js',import.meta.url),'utf8');
const code='a'.repeat(64);
function create({hash='',clock=1000}={}){
 const store=new Map(); const navigations=[];
 const location={pathname:'/app/',search:'',hash};
 const sessionStorage={
  getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),
  removeItem:k=>store.delete(k)
 };
 const window={location,sessionStorage,history:{replaceState:(state,title,url)=>navigations.push(url)},Date:{now:()=>clock}};
 runInNewContext(script,{window,URL,Date});
 return {pairing:window.PdvOfflinePairing,window,navigations,store};
}
test('offline waiter QR uses HTTPS local PWA and a five-minute one-use pairing fragment',()=>{
 const x=create();
 const link=x.pairing.link('https://pdv.loja.local:8443/',code);
 const url=new URL(link);
 assert.equal(url.origin,'https://pdv.loja.local:8443');
 assert.equal(url.pathname,'/app/');
 assert.equal(url.search,'');
 assert.match(url.hash,/^#p=[A-Za-z0-9_-]{43}$/);
 assert.ok(link.length<=78,'short local HTTPS link must fit the existing version-4 QR byte capacity');
 assert.equal(url.username,'');
 assert.match(x.pairing.link('https://pdv.loja.local:8443/',code),/#p=/);
 assert.throws(()=>x.pairing.link('http://192.168.1.10/',code),/HTTPS/);
 assert.throws(()=>x.pairing.link('https://pdv.loja.local/', 'abc'),/código/i);
});
test('QR pairing fragment is removed from browser history before login; temporary code survives login without permanent storage',()=>{
 const initial=create();const hash=new URL(initial.pairing.link('https://pdv.loja.local:8443/',code)).hash;
 const x=create({hash});
 assert.equal(x.pairing.peek(),code);
 assert.deepEqual(x.navigations,['/app/']);
 assert.equal(x.pairing.take(),code);
 assert.equal(x.pairing.peek(),'');
 assert.equal(x.store.size,0);
});
test('expired pairing codes and arbitrary hash fragments do not authorize devices',()=>{
 const initial=create();const hash=new URL(initial.pairing.link('https://pdv.loja.local:8443/',code)).hash;
 const x=create({hash,clock:1000});
 assert.equal(x.pairing.peek(),code);
 x.window.Date.now=()=>302000;
 assert.equal(x.pairing.peek(),'');
 assert.equal(x.pairing.take(),'');
 const unrelated=create({hash:'#settings'});
 assert.equal(unrelated.pairing.peek(),'');
 assert.equal(unrelated.navigations.length,0);
});
test('PWA loads offline pairing helper before route/settings and labels offline mode without promising D1 synchronization',()=>{
 const html=readFileSync(new URL('../apps/web/index.html',import.meta.url),'utf8');
 const settings=readFileSync(new URL('../apps/web/r2-lan-settings-ui.js',import.meta.url),'utf8');
 assert.ok(html.indexOf('offline-pairing.js')>0);
 assert.ok(html.indexOf('offline-pairing.js')<html.indexOf('r2-lan-settings-ui.js'));
 assert.match(settings,/Funcionamento offline/);
 assert.match(settings,/PdvOfflinePairing/);
 assert.doesNotMatch(settings,/Sincronização (?:ativada|concluída)/i);
});
