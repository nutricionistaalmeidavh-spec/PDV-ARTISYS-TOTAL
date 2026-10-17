'use strict';
const { SerialError } = require('../errors');

function parseNumericWeight(input) {
  const match = String(input ?? '').replace(',', '.').match(/-?\d+(?:\.\d+)?/);
  if (!match) throw new SerialError('SERIAL_PARSE_FAILED', 'Resposta sem peso reconhecivel.');
  const value = Number(match[0]);
  if (!Number.isFinite(value)) throw new SerialError('SERIAL_PARSE_FAILED', 'Peso invalido.');
  return value;
}

module.exports = { parseNumericWeight };
