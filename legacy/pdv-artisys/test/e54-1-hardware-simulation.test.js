'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { createSerialTransport } = require('../vendor/artisys-serialport/src/serial-transport');
const { createRequestResponseSession } = require('../vendor/artisys-serialport/src/request-response-session');
const { parseNumericWeight } = require('../vendor/artisys-serialport/src/parsers/numeric-weight');
const { createThermalPrinterDriver } = require('../vendor/artisys-printing/src/drivers/thermal-printer');
const { createElectronPrinterDriver } = require('../vendor/artisys-printing/src/drivers/electron-printer');
const { STATUSES } = require('../js/core/hardware/hardware-compatibility-service');
const ui = require('../desktop/renderer/ui-model');
const {
  createSerialPortHarness,
  createThermalPrinterHarness,
  createBrowserWindowHarness
} = require('./support/hardware-simulator');

test('E54.1 serial write failure enters error state and reconnects without restarting the PDV', async () => {
  const failure = Object.assign(new Error('device disconnected'), { code:'EIO' });
  const harness = createSerialPortHarness([
    { writeError:failure, emitErrorEvent:false },
    {}
  ]);
  const transport = createSerialTransport({
    SerialPortClass:harness.SerialPortClass,
    profile:{ path:'COM-SIM', baudRate:9600 }
  });

  await transport.open();
  await assert.rejects(transport.write('TEST'), error => Boolean(error?.code));
  assert.equal((await transport.status()).state, 'error');
  await transport.open();
  assert.equal(harness.state.instances.length, 2);
  assert.equal((await transport.status()).state, 'open');
  await transport.close();
});

test('E54.1 scale session waits for fragmented numeric response before parsing', async () => {
  const harness = createSerialPortHarness([{
    chunks:[
      { data:'1.', delayMs:0 },
      { data:'250 kg\r\n', delayMs:4 }
    ]
  }]);
  const transport = createSerialTransport({
    SerialPortClass:harness.SerialPortClass,
    profile:{ path:'COM-SCALE', baudRate:9600 }
  });
  const session = createRequestResponseSession({
    transport,
    request:'W\r\n',
    timeoutMs:100,
    responseIdleMs:10,
    parse:buffer => parseNumericWeight(buffer.toString('utf8'))
  });

  assert.equal(await session.run(), 1.25);
});

test('E54.1 scale timeout is recoverable and the next read can succeed', async () => {
  const harness = createSerialPortHarness([
    { chunks:[] },
    { chunks:[{ data:'1,250 kg\r\n', delayMs:0 }] }
  ]);
  const transport = createSerialTransport({
    SerialPortClass:harness.SerialPortClass,
    profile:{ path:'COM-SCALE', baudRate:9600 }
  });
  const session = createRequestResponseSession({
    transport,
    request:'W\r\n',
    timeoutMs:100,
    responseIdleMs:10,
    parse:buffer => parseNumericWeight(buffer.toString('utf8'))
  });

  await assert.rejects(session.run(), error => error?.code === 'SERIAL_TIMEOUT');
  assert.equal(await session.run(), 1.25);
});

test('E54.1 numeric weight parser accepts common decimal forms and rejects garbage', () => {
  assert.equal(parseNumericWeight('ST,GS,+ 1.250 kg\r\n'), 1.25);
  assert.equal(parseNumericWeight('1,250'), 1.25);
  assert.throws(() => parseNumericWeight('SEM PESO'), error => error?.code === 'SERIAL_PARSE_FAILED');
});

test('E54.1 Epson and Star thermal profiles preserve accents, width, cut and drawer pulse', async () => {
  for (const [printerType, expectedType] of [['epson','EPSON'],['star','STAR']]) {
    const harness = createThermalPrinterHarness();
    const driver = createThermalPrinterDriver({ thermalPrinter:harness.upstream, timeoutMs:100 });
    const result = await driver.print(
      { text:'Ação café — DOCUMENTO NÃO FISCAL' },
      { mode:'thermal', printerType, interface:'tcp://127.0.0.1:9100', width:48, cut:true, openDrawerAfterPrint:true }
    );
    assert.equal(result.success, true);
    const construct = harness.calls.find(call => call[0] === 'construct');
    assert.equal(construct[1].type, expectedType);
    assert.equal(construct[1].width, 48);
    assert.ok(harness.calls.some(call => call[0] === 'println' && call[1].includes('Ação café')));
    assert.ok(harness.calls.some(call => call[0] === 'cut'));
    assert.ok(harness.calls.some(call => call[0] === 'drawer'));
  }
});

test('E54.1 Windows spooler failure stays controlled and a later print can recover', async () => {
  const harness = createBrowserWindowHarness([
    { success:false, reason:'Printer offline' },
    { success:true }
  ]);
  const driver = createElectronPrinterDriver({ BrowserWindow:harness.BrowserWindow });
  const profile = { mode:'electron', width:42, deviceName:'SIMULATED', silent:true };

  const first = await driver.print({ text:'TESTE 1', width:42 }, profile);
  const second = await driver.print({ text:'TESTE 2', width:42 }, profile);

  assert.equal(first.success, false);
  assert.match(first.failureReason, /offline/i);
  assert.equal(second.success, true);
  assert.equal(harness.state.closed, 2);
});

test('E54.1 keyboard-wedge barcode lookup remains deterministic under rapid repeated scans', () => {
  const products = [
    { id:'p1', name:'Produto A', sku:'A-01', barcode:'7891234567890' },
    { id:'p2', name:'Produto B', sku:'B-02', barcode:'7890000000000' }
  ];
  for (let i = 0; i < 500; i += 1) {
    const match = ui.filterProducts(products, '7891234567890');
    assert.equal(match.length, 1);
    assert.equal(match[0].id, 'p1');
  }
  assert.equal(ui.filterProducts(products, 'CODIGO-INVALIDO').length, 0);
});

test('E54.1 serial transport survives repeated open/write/close cycles without retaining an open port', async () => {
  const harness = createSerialPortHarness(Array.from({ length:250 }, () => ({})));
  const transport = createSerialTransport({
    SerialPortClass:harness.SerialPortClass,
    profile:{ path:'COM-STRESS', baudRate:9600 }
  });
  for (let i = 0; i < 250; i += 1) {
    await transport.open();
    await transport.write(`PING-${i}`);
    await transport.close();
  }
  assert.equal(harness.state.instances.length, 250);
  assert.equal((await transport.status()).state, 'closed');
});

test('E54.1 compatibility matrix distinguishes protocol confidence from physical field verification', () => {
  assert.equal(STATUSES.has('PROTOCOL_VERIFIED'), true);
  assert.equal(STATUSES.has('FIELD_VERIFIED'), true);
  assert.equal(STATUSES.has('UNTESTED_MODEL'), true);
  assert.equal(STATUSES.has('BLOCKED_EXTERNAL'), false);
  assert.equal(STATUSES.has('VERIFIED'), false);

  const matrix = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'release', 'hardware-compatibility.json'), 'utf8'));
  const allowed = new Set(['PROTOCOL_VERIFIED','FIELD_VERIFIED','UNTESTED_MODEL','PARTIAL','UNSUPPORTED']);
  assert.ok(matrix.entries.every(entry => allowed.has(entry.status)));
  for (const kind of ['PRINTER','SCALE','DRAWER','SCANNER']) {
    assert.ok(matrix.entries.some(entry => entry.kind === kind && entry.status === 'PROTOCOL_VERIFIED'), `${kind} deve ter protocolo validado`);
  }
  assert.ok(matrix.entries.every(entry => entry.status !== 'FIELD_VERIFIED' || Boolean(entry.evidence)));
});
