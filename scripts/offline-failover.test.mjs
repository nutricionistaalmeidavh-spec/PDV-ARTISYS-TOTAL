import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const code=readFileSync(new URL('../apps/web/offline-failover.js',import.meta.url),'utf8');
function context(){
 const memory=new Map(),go=[];
 const localStorage={getItem:key=>memory.get(key)||null,setItem:(key,val)=>memory.set(key,val)};
 const sessionStorage={getItem:key=>memory.get('s-'+key)||null,setItem:(key,val)=>memory.set('s-'+key,val)};
 const window={localStorage,sessionStorage,location:{origin:'https://cloud.example.test',assign:url=>go.push(url)}};
 runInNewContext(code,{window,URL,Date});
 return {window,go};
}
test('failover navigates read-only requests to a previously approved HTTPS LAN PWA but not cash POSTs',()=>{
 const {window,go}=context();
 window.PdvOfflineFailover.configure('tenant-a','https://pdv.loja.lan:8443');
 assert.equal(window.PdvOfflineFailover.onNetworkError('tenant-a','GET'),true);
 assert.deepEqual(go,['https://pdv.loja.lan:8443/app/']);
 assert.equal(window.PdvOfflineFailover.onNetworkError('tenant-a','POST'),false);
 assert.equal(go.length,1,'cash register is not retried against another origin');
});
test('failover refuses insecure/foreign URLs and needs explicit setup per tenant',()=>{
 const {window,go}=context();
 assert.throws(()=>window.PdvOfflineFailover.configure('a','http://192.168.0.4:8080'),/HTTPS/);
 assert.throws(()=>window.PdvOfflineFailover.configure('a','https://evil.example.com'),/local/);
 window.PdvOfflineFailover.configure('a','https://192.168.1.10:8443');
 assert.equal(window.PdvOfflineFailover.onNetworkError('other','GET'),false);
 assert.equal(go.length,0);
});
