'use strict';
const { SerialError } = require('./errors');

const PARITY = new Set(['none', 'even', 'odd', 'mark', 'space']);

function normalizeDeviceProfile(input = {}) {
  const path = String(input.path || '').trim();
  if (!path) throw new SerialError('SERIAL_PORT_NOT_FOUND', 'Porta serial nao configurada.');
  const baudRate = Number(input.baudRate ?? 9600);
  const dataBits = Number(input.dataBits ?? 8);
  const stopBits = Number(input.stopBits ?? 1);
  const parity = String(input.parity || 'none').toLowerCase();
  if (!Number.isInteger(baudRate) || baudRate <= 0) throw new TypeError('baudRate invalido.');
  if (![5, 6, 7, 8].includes(dataBits)) throw new TypeError('dataBits invalido.');
  if (![1, 1.5, 2].includes(stopBits)) throw new TypeError('stopBits invalido.');
  if (!PARITY.has(parity)) throw new TypeError('parity invalido.');
  return Object.freeze({ path, baudRate, dataBits, stopBits, parity });
}

module.exports = { normalizeDeviceProfile };
