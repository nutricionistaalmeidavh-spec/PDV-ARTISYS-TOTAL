'use strict';
const { normalizeDeviceProfile } = require('../device-profile');
const { SerialError } = require('../errors');

function createScaleAdapter({ session, profile, tare } = {}) {
  if (!session || typeof session.run !== 'function') throw new TypeError('session de balanca invalida.');
  const normalized = normalizeDeviceProfile(profile);
  const adapter = {
    async status() { return { available:true, path:normalized.path, baudRate:normalized.baudRate, unit:'kg' }; },
    async readWeight() {
      const weight = Number(await session.run());
      if (!Number.isFinite(weight) || weight < 0) throw new SerialError('SERIAL_PARSE_FAILED', 'Leitura de peso invalida.');
      return { weight:Math.round(weight * 1000) / 1000, unit:'kg' };
    }
  };
  if (typeof tare === 'function') adapter.tare = () => tare();
  return Object.freeze(adapter);
}

module.exports = { createScaleAdapter };
