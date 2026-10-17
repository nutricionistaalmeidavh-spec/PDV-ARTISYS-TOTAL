'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSerialTransport } = require('../vendor/artisys-serialport/src/serial-transport');
const { createDrawerAdapter, DEFAULT_PULSE } = require('../vendor/artisys-serialport/src/adapters/drawer');
const { createThermalPrinterDriver } = require('../vendor/artisys-printing/src/drivers/thermal-printer');
const { createSerialPortHarness, createThermalPrinterHarness } = require('./support/hardware-simulator');

test('E54.1 COM busy or missing fails cleanly and a later open can recover', async () => {
  for (const code of ['EBUSY','ENOENT']) {
    const failure = Object.assign(new Error(code === 'EBUSY' ? 'Access denied' : 'File not found'), { code });
    const harness = createSerialPortHarness([{ openError:failure }, {}]);
    const transport = createSerialTransport({
      SerialPortClass:harness.SerialPortClass,
      profile:{ path:'COM-RECOVERY', baudRate:9600 }
    });
    await assert.rejects(transport.open(), error => Boolean(error?.code));
    assert.equal((await transport.status()).state, 'error');
    await transport.open();
    assert.equal((await transport.status()).state, 'open');
    assert.equal(harness.state.instances.length, 2);
    await transport.close();
  }
});

test('E54.1 drawer write failure closes the port and a later pulse succeeds', async () => {
  const failure = Object.assign(new Error('drawer disconnected'), { code:'EIO' });
  const harness = createSerialPortHarness([
    { writeError:failure, emitErrorEvent:false },
    {}
  ]);
  const transport = createSerialTransport({
    SerialPortClass:harness.SerialPortClass,
    profile:{ path:'COM-DRAWER', baudRate:9600 }
  });
  const drawer = createDrawerAdapter({ transport });

  await assert.rejects(drawer.open(), error => Boolean(error?.code));
  assert.equal((await transport.status()).state, 'closed');
  assert.equal(await drawer.open(), true);
  assert.equal((await transport.status()).state, 'closed');
  assert.equal(harness.state.writeBuffers.length, 2);
  assert.deepEqual(harness.state.writeBuffers[1], DEFAULT_PULSE);
});

test('E54.1 thermal protocols accept all supported receipt widths', async () => {
  for (const printerType of ['epson','star']) {
    for (const width of [32,42,48]) {
      const harness = createThermalPrinterHarness();
      const driver = createThermalPrinterDriver({ thermalPrinter:harness.upstream, timeoutMs:100 });
      const result = await driver.print(
        { text:`Largura ${width} — NÃO FISCAL` },
        { mode:'thermal', printerType, interface:'tcp://127.0.0.1:9100', width, cut:true }
      );
      assert.equal(result.success, true);
      const construct = harness.calls.find(call => call[0] === 'construct');
      assert.equal(construct[1].width, width);
    }
  }
});
