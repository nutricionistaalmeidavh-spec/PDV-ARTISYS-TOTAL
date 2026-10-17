'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPdvHardwareRuntime } = require('../desktop/hardware-runtime.cjs');
const { createHardwareConfigStore } = require('../desktop/hardware-config-store.cjs');

function fakeModules(calls) {
  return {
    serial: {
      createSerialPortManager(){ return { list:async()=>[{path:'COM7',manufacturer:'USB Serial'}] }; },
      createSerialTransport({profile}){ calls.push(['transport',profile]); return {open:async()=>{},close:async()=>{},write:async()=>{},onData(){return()=>{};},status:async()=>({available:true,path:profile.path,baudRate:profile.baudRate})}; },
      createRequestResponseSession(options){ calls.push(['session',options]); return {run:async()=>1.25}; },
      createScaleAdapter({profile}){ return {status:async()=>({available:true,path:profile.path,baudRate:profile.baudRate}),readWeight:async()=>({weight:1.25,unit:'kg'})}; },
      createDrawerAdapter(){ return {status:async()=>({available:false})}; },
      parseNumericWeight(value){ return Number(value); },
      createUranoPopSProtocol({requestCommand=0x04}={}){ return {id:'urano-pop-s',manufacturer:'Urano',model:'US 31/2 POP-S',serial:{baudRate:9600,dataBits:8,stopBits:2,parity:'none'},request:Buffer.from([requestCommand]),requestCommand,parse:()=>1.25}; }
    },
    printing: {
      normalizePrinterProfile(profile){return profile;},
      createElectronPrinterDriver(){return {status:async()=>({available:true,mode:'electron'}),print:async()=>({success:true})};}
    }
  };
}

test('runtime can configure Urano POP-S without restarting Electron', async () => {
  const calls=[];
  const runtime=createPdvHardwareRuntime({BrowserWindow:function(){},env:{},modules:fakeModules(calls)});
  assert.equal(typeof runtime.configureScale,'function');
  const config=await runtime.configureScale({profile:'urano-pop-s',port:'COM7',requestCommand:'0x04'});
  assert.equal(config.profile,'urano-pop-s');
  assert.equal(config.port,'COM7');
  assert.equal(config.baud,9600);
  assert.equal(config.stopBits,2);
  assert.deepEqual(await runtime.readWeight(),{weight:1.25,unit:'kg'});
  const transport=calls.find(row=>row[0]==='transport');
  assert.deepEqual(transport[1],{path:'COM7',baudRate:9600,dataBits:8,stopBits:2,parity:'none'});
});

test('runtime can disable the scale explicitly', async () => {
  const runtime=createPdvHardwareRuntime({BrowserWindow:function(){},env:{PDV_SCALE_PORT:'COM2'},modules:fakeModules([])});
  const config=await runtime.configureScale({profile:'generic',port:''});
  assert.equal(config.configured,false);
  await assert.rejects(()=>runtime.readWeight(),/nao configurada/i);
});

test('hardware config store persists only normalized local scale fields', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-hw-'));
  const filePath=path.join(dir,'hardware.json');
  const store=createHardwareConfigStore({filePath});
  const saved=store.saveScale({profile:'urano-pop-s',port:' COM7 ',requestCommand:'0x04',unexpected:'discard'});
  assert.deepEqual(saved,{profile:'urano-pop-s',port:'COM7',requestCommand:'0x04'});
  assert.deepEqual(store.load().scale,saved);
  const raw=JSON.parse(fs.readFileSync(filePath,'utf8'));
  assert.deepEqual(raw,{scale:saved});
});

test('saving either device preserves the other configuration across restarts',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'artisys-hw-both-'));
  const filePath=path.join(dir,'hardware.json');
  try {
    const store=createHardwareConfigStore({filePath});
    store.saveScale({port:'COM7'});
    store.saveDrawer({port:'COM8',baud:19200});
    store.saveScale({profile:'urano-pop-s',port:'COM9'});
    const restored=createHardwareConfigStore({filePath}).load();
    assert.deepEqual(restored.drawer,{port:'COM8',baud:19200});
    assert.equal(restored.scale.port,'COM9');
    assert.throws(()=>store.saveDrawer({port:'COM1',baud:-1}),/invalida/);
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
