'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  URANO_POP_S_PROFILE,
  createUranoPopSProtocol,
  parseUranoPopSWeight
} = require('../vendor/artisys-serialport/src/protocols/urano-pop-s');

function useP2WithoutDates(weight = '1.250') {
  const frame = Buffer.alloc(56, 0x20);
  frame[0] = 0x1b;
  frame.write('T2', 1, 'ascii');
  frame[3] = 0x1b;
  frame.write('B', 4, 'ascii');
  frame[5] = 0x1b;
  frame.write('N0', 6, 'ascii');
  frame.write(String(weight).padStart(6, ' '), 18, 'ascii');
  frame.write('kg', 24, 'ascii');
  frame[51] = 0x1b;
  frame.write('E', 52, 'ascii');
  frame[53] = 0x1b;
  frame.write('P1', 54, 'ascii');
  return frame;
}

test('Urano POP-S profile is the documented 9600 8N2 serial configuration', () => {
  assert.deepEqual(URANO_POP_S_PROFILE, {
    baudRate: 9600,
    dataBits: 8,
    stopBits: 2,
    parity: 'none'
  });
});

test('Urano POP-S protocol requests an on-demand reading with 0x04 by default', () => {
  const protocol = createUranoPopSProtocol();
  assert.equal(protocol.id, 'urano-pop-s');
  assert.equal(Buffer.isBuffer(protocol.request), true);
  assert.deepEqual([...protocol.request], [0x04]);
  assert.deepEqual(protocol.serial, URANO_POP_S_PROFILE);
});

test('Urano POP-S protocol also accepts the manufacturer-listed 0x05 request when explicitly selected', () => {
  const protocol = createUranoPopSProtocol({ requestCommand: 0x05 });
  assert.deepEqual([...protocol.request], [0x05]);
  assert.throws(() => createUranoPopSProtocol({ requestCommand: 0x06 }), /0x04|0x05/);
});

test('parses an official-layout USE-P2 frame without dates', () => {
  assert.equal(parseUranoPopSWeight(useP2WithoutDates('1.250')), 1.25);
  assert.equal(parseUranoPopSWeight(useP2WithoutDates('0.000')), 0);
});

test('parses USE-CB2 response by PESO L and does not confuse tare with net weight', () => {
  const frame = Buffer.from('DATA:  00/00/00 VALID.: 00/00/00      TARA:   0.000kg       PESO L:  1.542kg      R$/kg:      0.00      TOTAL R$:      0.00', 'latin1');
  assert.equal(parseUranoPopSWeight(frame), 1.542);
});

test('rejects incomplete or unrelated serial payloads instead of guessing a number', () => {
  assert.throws(() => parseUranoPopSWeight(Buffer.from('1.250', 'ascii')), /Urano|peso|frame/i);
  assert.throws(() => parseUranoPopSWeight(Buffer.from('TARA: 0.500kg', 'ascii')), /Urano|peso|frame/i);
});