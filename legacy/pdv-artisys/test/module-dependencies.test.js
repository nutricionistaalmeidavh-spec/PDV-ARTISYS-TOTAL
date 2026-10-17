'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

test('ArtiSys serial and printing packages resolve from the PDV dependency boundary', () => {
  const serial = require('@artisys/serialport');
  const printing = require('@artisys/printing');
  assert.equal(typeof serial.createSerialTransport, 'function');
  assert.equal(typeof serial.createScaleAdapter, 'function');
  assert.equal(typeof serial.createDrawerAdapter, 'function');
  assert.equal(typeof printing.createElectronPrinterDriver, 'function');
  assert.equal(typeof printing.createThermalPrinterDriver, 'function');
  assert.equal(typeof printing.createTransportPrinterDriver, 'function');
});
