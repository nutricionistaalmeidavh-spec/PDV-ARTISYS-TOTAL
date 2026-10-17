'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('desktop main delegates physical peripherals to the shared hardware runtime', () => {
  const main = fs.readFileSync(path.join(__dirname,'..','desktop','main.cjs'),'utf8');
  assert.match(main, /createPdvHardwareRuntime/);
  assert.match(main, /hardware-runtime\.cjs/);
  assert.doesNotMatch(main, /require\(['"]serialport['"]\)/);
  assert.doesNotMatch(main, /createSerialScaleDriver|createSerialDrawerDriver|createElectronPrintDriver/);
});
