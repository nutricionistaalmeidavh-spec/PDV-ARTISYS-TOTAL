'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {stableHostname,createLanDiscovery}=require('../desktop/lan-discovery.cjs');
test('stable server identity is independent of DHCP and unique per installation',()=>{assert.equal(stableHostname('a'),stableHostname('a'));assert.notEqual(stableHostname('a'),stableHostname('b'));assert.match(stableHostname('a'),/^artisys-[a-f0-9]{10}\.local$/);});
test('mDNS publishes only LAN records, refreshes DHCP and falls back when resolution disagrees',async()=>{
 let address='192.168.1.10',resolved=address;const services=[];let destroyed=false;
 const discovery=createLanDiscovery({identity:'test',port:4199,interfaces:()=>({wifi:[{address}],VPN:[{address:'10.8.0.1'}]}),resolve:async()=>[{address:resolved}],bonjourFactory:()=>({publish:config=>{const service=new EventEmitter();service.records=()=>[{type:'SRV',data:config},{type:'A',data:'10.8.0.1'}];service.stop=()=>{};services.push(service);return service;},destroy:()=>{destroyed=true;}})});
 try{assert.equal(await discovery.state(),'');services[0].emit('up');assert.equal(await discovery.state(),discovery.hostname);assert.deepEqual(services[0].records().filter(r=>r.type==='A').map(r=>r.data),[address]);address='192.168.1.99';discovery.refresh();services[1].emit('up');assert.equal(await discovery.state(),'');resolved=address;assert.equal(await discovery.state(),discovery.hostname);assert.equal(services[1].records().find(r=>r.type==='A').data,address);}finally{discovery.stop();}assert.equal(destroyed,true);
});
