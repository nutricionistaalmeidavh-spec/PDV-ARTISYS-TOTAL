'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const {publicNetworkState,testPublicNetwork}=require('../desktop/public-network.cjs');
const interfaces={wifi:[{family:'IPv4',internal:false,address:'192.168.1.12'}],loopback:[{family:'IPv4',internal:true,address:'127.0.0.1'}]};
test('discovery filters unusable and virtual interfaces and refreshes DHCP addresses',()=>{
  const invalid={VPN:[{address:'10.8.0.2'}],vEthernet:[{address:'172.17.0.1'}],off:[{address:'192.168.2.1',active:false}],bad:[{address:'169.254.1.3'},{address:'127.2.3.4'},{address:'::1'}]};
  const state=publicNetworkState({config:{mode:'lan-host'},lanEnabled:true,interfaces:{...interfaces,...invalid},stableHost:'artisys-example.local'});
  assert.deepEqual(state.addresses,['192.168.1.12']);assert.equal(state.host,'192.168.1.12');assert.equal(state.stableHost,'artisys-example.local');
  const next=publicNetworkState({config:{mode:'lan-host'},lanEnabled:true,interfaces:{wifi:[{address:'192.168.1.99'}]},stableHost:state.stableHost});
  assert.equal(next.host,'192.168.1.99');assert.equal(next.currentAddress,'192.168.1.99');assert.equal(next.stableHost,state.stableHost);
  assert.equal(publicNetworkState({config:{mode:'lan-host'},lanEnabled:true,interfaces:invalid}).enabled,false);
});
test('QR address uses actual host port and excludes loopback',()=>{const state=publicNetworkState({config:{mode:'lan-host',port:4188},lanEnabled:true,interfaces});assert.equal(state.baseUrl,'http://192.168.1.12:4188');assert.deepEqual(state.addresses,['192.168.1.12']);assert.equal(state.enabled,true);});
test('local-only installation cannot publish a reachable QR merely by having an IP',async()=>{const state=publicNetworkState({config:{mode:'local'},interfaces});assert.equal(state.enabled,false);await assert.rejects(testPublicNetwork({state}),/PC principal/);});
test('terminal publishes its principal address rather than its own interface',()=>{const state=publicNetworkState({config:{mode:'lan-client',serverUrl:'http://192.168.1.5:4190'},interfaces});assert.equal(state.host,'192.168.1.5');assert.equal(state.port,4190);});
test('network test checks health and reports connection failures',async()=>{const state=publicNetworkState({config:{mode:'lan-host',port:4190},lanEnabled:true,interfaces});let target;const result=await testPublicNetwork({state,fetchImpl:async url=>{target=url;return {ok:true,json:async()=>({ok:true})}}});assert.equal(target,'http://192.168.1.12:4190/api/v1/health');assert.equal(result.ok,true);await assert.rejects(testPublicNetwork({state,fetchImpl:async()=>{throw new Error('ETIMEDOUT')}}),/Firewall/);});
