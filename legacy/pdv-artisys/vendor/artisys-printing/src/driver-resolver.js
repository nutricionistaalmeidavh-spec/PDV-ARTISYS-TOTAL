'use strict';
const { PrintingError } = require('./errors');

function createPrinterResolver({ electronDriver, thermalDriver, transportDriver } = {}) {
  return function resolve(profile = {}) {
    if (profile.mode === 'electron' && electronDriver) return electronDriver;
    if (profile.mode === 'thermal' && thermalDriver) return thermalDriver;
    if (profile.mode === 'transport' && transportDriver) return transportDriver;
    throw new PrintingError('PRINTER_NOT_AVAILABLE', `Driver indisponivel para ${profile.mode || 'modo desconhecido'}.`);
  };
}

module.exports = { createPrinterResolver };
