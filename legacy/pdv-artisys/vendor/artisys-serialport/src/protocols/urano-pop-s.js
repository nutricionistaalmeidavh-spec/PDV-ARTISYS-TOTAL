'use strict';

const URANO_POP_S_PROFILE = Object.freeze({
  baudRate: 9600,
  dataBits: 8,
  stopBits: 2,
  parity: 'none'
});

function normalizeWeight(value) {
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!/^[+-]?\d+(?:\.\d+)?$/.test(normalized)) {
    throw new Error('Frame Urano POP-S sem peso valido.');
  }
  const weight = Number(normalized);
  if (!Number.isFinite(weight) || weight < 0) {
    throw new Error('Peso Urano POP-S invalido.');
  }
  return Math.round(weight * 1000) / 1000;
}

function parseCb2Weight(buffer) {
  const text = buffer.toString('latin1').replace(/\0/g, ' ');
  const match = text.match(/PESO\s*L\s*:\s*([+-]?\d+(?:[.,]\d+)?)\s*kg/i);
  if (!match) return null;
  return normalizeWeight(match[1]);
}

function parseP2Weight(buffer) {
  const start = buffer.indexOf(Buffer.from([0x1b, 0x54]));
  if (start < 0 || start + 2 >= buffer.length) return null;
  const type = buffer[start + 2];
  if (![0x31, 0x32, 0x33].includes(type)) return null;

  const end = buffer.indexOf(Buffer.from([0x1b, 0x45]), start + 3);
  if (end < 0) return null;

  const frame = buffer.subarray(start, end + 2);
  const text = frame.toString('latin1').replace(/\0/g, ' ');
  const matches = [...text.matchAll(/([+-]?\d+(?:[.,]\d+)?)\s*kg/gi)];
  if (!matches.length) return null;

  return normalizeWeight(matches[matches.length - 1][1]);
}

function parseUranoPopSWeight(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input ?? '');
  if (!buffer.length) throw new Error('Frame Urano POP-S vazio.');

  const cb2 = parseCb2Weight(buffer);
  if (cb2 !== null) return cb2;

  const p2 = parseP2Weight(buffer);
  if (p2 !== null) return p2;

  throw new Error('Frame Urano POP-S invalido ou sem peso liquido reconhecivel.');
}

function createUranoPopSProtocol({ requestCommand = 0x04 } = {}) {
  const command = Number(requestCommand);
  if (![0x04, 0x05].includes(command)) {
    throw new TypeError('Comando Urano POP-S invalido; use 0x04 ou 0x05.');
  }
  return Object.freeze({
    id: 'urano-pop-s',
    manufacturer: 'Urano',
    model: 'US 31/2 POP-S',
    serial: URANO_POP_S_PROFILE,
    request: Buffer.from([command]),
    requestCommand: command,
    parse: parseUranoPopSWeight
  });
}

module.exports = {
  URANO_POP_S_PROFILE,
  createUranoPopSProtocol,
  parseUranoPopSWeight
};