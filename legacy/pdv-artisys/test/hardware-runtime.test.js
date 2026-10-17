'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const runtimePath = '../desktop/hardware-runtime.cjs';

function fakeModules(calls) {
  return {
    serial: {
      createSerialTransport({ profile }) {
        calls.push(['serial-transport', profile]);
        return {
          async open(){ calls.push(['transport-open', profile.path]); },
          async close(){ calls.push(['transport-close', profile.path]); },
          async write(data){ calls.push(['transport-write', profile.path, Buffer.from(data).toString()]); },
          async drain(){ calls.push(['transport-drain', profile.path]); },
          onData(){ return ()=>{}; },
          async status(){ return { available:true, state:'closed', path:profile.path, baudRate:Number(profile.baudRate || 9600) }; }
        };
      },
      createRequestResponseSession(options){ calls.push(['request-session', options]); return { run:async()=>1.23456 }; },
      createScaleAdapter(){ return { status:async()=>({available:true,path:'COM3',baudRate:9600,unit:'kg'}), readWeight:async()=>({weight:1.235,unit:'kg'}) }; },
      createDrawerAdapter({ transport }) { return { status:()=>transport.status(), open:async()=>{ calls.push('drawer-open'); return true; } }; },
      parseNumericWeight(value){ return Number(value); },
      createUranoPopSProtocol({ requestCommand=0x04 }={}) {
        calls.push(['urano-protocol', requestCommand]);
        return {
          id:'urano-pop-s',
          manufacturer:'Urano',
          model:'US 31/2 POP-S',
          serial:{baudRate:9600,dataBits:8,stopBits:2,parity:'none'},
          request:Buffer.from([requestCommand]),
          requestCommand,
          parse:()=>1.235
        };
      }
    },
    printing: {
      normalizePrinterProfile(profile){ return profile; },
      createElectronPrinterDriver(){ return { status:async()=>({available:true,mode:'electron'}), print:async()=>{ calls.push('electron-print'); return {success:true,driver:'electron'}; } }; },
      createThermalPrinterDriver(){ return { status:async()=>({available:true,mode:'thermal'}), print:async()=>{ calls.push('thermal-print'); return {success:true,driver:'thermal'}; } }; },
      createTransportPrinterDriver(){ return { status:async()=>({available:true,mode:'transport'}), print:async()=>{ calls.push('transport-print'); return {success:true,driver:'transport'}; } }; }
    }
  };
}

test('defaults to Electron printing and reports unconfigured scale/drawer', async () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  const calls=[];
  const runtime=createPdvHardwareRuntime({ BrowserWindow:function(){}, env:{}, modules:fakeModules(calls) });
  const result=await runtime.print({text:'cupom',width:42});
  const status=await runtime.status();
  assert.equal(result.driver,'electron');
  assert.deepEqual(calls,['electron-print']);
  assert.equal(status.printer.mode,'electron');
  assert.equal(status.scale.available,false);
  assert.equal(status.cashDrawer.available,false);
  assert.equal(status.barcodeScanner.mode,'keyboard-wedge');
});

test('runtime resolves persisted printer preferences at every print attempt', async () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  const calls=[];const printed=[];const modules=fakeModules(calls);
  modules.printing.createElectronPrinterDriver=()=>({
    status:async()=>({available:true,mode:'electron'}),
    print:async(job,profile)=>{printed.push({job,profile});return {success:true,driver:'electron'};}
  });
  let prefs={deviceName:'POS80 Printer',paperMm:80,columns:48,showSystemDialog:true,cut:true,openDrawerAfterPrint:false};
  const runtime=createPdvHardwareRuntime({BrowserWindow:function(){},env:{},modules,resolvePrinterPreferences:()=>prefs});
  await runtime.print({text:'primeiro'});
  prefs={deviceName:'POS58 Printer',paperMm:58,columns:32,showSystemDialog:false,cut:false,openDrawerAfterPrint:true};
  await runtime.print({text:'segundo'});
  assert.equal(printed.length,2);
  assert.equal(printed[0].profile.deviceName,'POS80 Printer');
  assert.equal(printed[0].profile.width,48);
  assert.equal(printed[0].profile.silent,false);
  assert.equal(printed[0].job.paperMm,80);
  assert.equal(printed[1].profile.deviceName,'POS58 Printer');
  assert.equal(printed[1].profile.width,32);
  assert.equal(printed[1].profile.silent,true);
  assert.equal(printed[1].profile.cut,false);
  assert.equal(printed[1].profile.openDrawerAfterPrint,true);
  assert.equal(printed[1].job.paperMm,58);
});

test('configured scale and drawer use the shared serial module with fragmented-response settling', async () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  const calls=[];
  const runtime=createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ PDV_SCALE_PORT:'COM3', PDV_SCALE_BAUD:'9600', PDV_SCALE_SETTLE_MS:'30', PDV_DRAWER_PORT:'COM4', PDV_DRAWER_BAUD:'9600' },
    modules:fakeModules(calls)
  });
  assert.deepEqual(await runtime.readWeight(),{weight:1.235,unit:'kg'});
  assert.equal(await runtime.openDrawer(),true);
  const status=await runtime.status();
  assert.equal(status.scale.available,true);
  assert.equal(status.cashDrawer.available,true);
  assert.equal('requestCommand' in status.scale,false);
  const sessionCall=calls.find(entry=>Array.isArray(entry) && entry[0]==='request-session');
  assert.ok(sessionCall);
  assert.equal(sessionCall[1].responseIdleMs,30);
});

test('Urano POP-S scale profile forces documented 9600 8N2 and binary request', async () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  const calls=[];
  const runtime=createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ PDV_SCALE_PORT:'COM7', PDV_SCALE_PROFILE:'urano-pop-s' },
    modules:fakeModules(calls)
  });

  const transportCall=calls.find(entry=>Array.isArray(entry) && entry[0]==='serial-transport');
  assert.deepEqual(transportCall[1],{path:'COM7',baudRate:9600,dataBits:8,stopBits:2,parity:'none'});

  const sessionCall=calls.find(entry=>Array.isArray(entry) && entry[0]==='request-session');
  assert.equal(Buffer.isBuffer(sessionCall[1].request),true);
  assert.deepEqual([...sessionCall[1].request],[0x04]);

  const diagnostics=await runtime.diagnostics();
  assert.equal(diagnostics.configuration.scale.profile,'urano-pop-s');
  assert.equal(diagnostics.configuration.scale.manufacturer,'Urano');
  assert.equal(diagnostics.configuration.scale.model,'US 31/2 POP-S');
  assert.equal(diagnostics.configuration.scale.stopBits,2);
  assert.equal(diagnostics.configuration.scale.requestCommand,'0x04');
});

test('thermal mode selects thermal driver without silent fallback', async () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  const calls=[];
  const runtime=createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ PDV_PRINTER_MODE:'thermal', PDV_PRINTER_TYPE:'epson', PDV_PRINTER_INTERFACE:'tcp://127.0.0.1:9100' },
    modules:fakeModules(calls)
  });
  const result=await runtime.print({text:'cupom',width:42});
  assert.equal(result.driver,'thermal');
  assert.equal(calls.includes('thermal-print'),true);
  assert.equal(calls.includes('electron-print'),false);
});

test('thermal mode requires an explicit Epson or Star protocol', () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  assert.throws(() => createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ PDV_PRINTER_MODE:'thermal', PDV_PRINTER_INTERFACE:'tcp://127.0.0.1:9100' },
    modules:fakeModules([])
  }), /PDV_PRINTER_TYPE/);
});

test('serial printer mode selects transport driver and creates a serial transport', async () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  const calls=[];
  const runtime=createPdvHardwareRuntime({
    BrowserWindow:function(){},
    env:{ PDV_PRINTER_MODE:'serial', PDV_PRINTER_PORT:'COM5', PDV_PRINTER_BAUD:'19200' },
    modules:fakeModules(calls)
  });
  const result=await runtime.print({text:'cupom',width:42});
  assert.equal(result.driver,'transport');
  assert.equal(calls.includes('transport-print'),true);
  assert.equal(calls.some(entry=>Array.isArray(entry) && entry[0]==='serial-transport' && entry[1].path==='COM5'),true);
});

test('invalid printer mode fails at startup instead of guessing a driver', () => {
  const { createPdvHardwareRuntime } = require(runtimePath);
  assert.throws(()=>createPdvHardwareRuntime({ BrowserWindow:function(){}, env:{PDV_PRINTER_MODE:'cloud'}, modules:fakeModules([]) }), /PDV_PRINTER_MODE invalido/);
});

test('drawer configuration applies live, clears explicitly and reports diagnostic configuration', async()=>{
  const {createPdvHardwareRuntime}=require(runtimePath);
  const calls=[];
  const runtime=createPdvHardwareRuntime({BrowserWindow:function(){},env:{},modules:fakeModules(calls)});
  assert.equal((await runtime.status()).cashDrawer.reason,'not-configured');
  assert.deepEqual(await runtime.configureDrawer({port:' COM8 ',baud:19200}),{configured:true,port:'COM8',baud:19200});
  await runtime.openDrawer();
  assert.ok(calls.includes('drawer-open'));
  assert.equal((await runtime.diagnostics()).configuration.drawer.port,'COM8');
  await runtime.configureDrawer({port:''});
  await assert.rejects(()=>runtime.openDrawer(),/nao configurada/i);
});
