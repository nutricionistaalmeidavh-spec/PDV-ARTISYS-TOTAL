'use strict';

function requireMethod(driver, name, optional = false) {
  if (driver && typeof driver[name] === 'function') return driver[name].bind(driver);
  if (optional) return null;
  return async () => { throw new Error(`Hardware indisponivel: ${name}.`); };
}

function createStatus(driver, kind) {
  if (driver && typeof driver.status === 'function') return driver.status.bind(driver);
  return async () => ({ available:false, kind, reason:'not-configured' });
}

function createHardwareAdapters({ scanner = null, scale = null, printer = null, drawer = null } = {}) {
  const barcodeScanner = Object.freeze({
    status: createStatus(scanner, 'barcode-scanner'),
    start: requireMethod(scanner, 'start'),
    stop: requireMethod(scanner, 'stop')
  });

  const scaleAdapter = Object.freeze({
    status: createStatus(scale, 'scale'),
    async readWeight() {
      const value = Number(await requireMethod(scale, 'readWeight')());
      if (!Number.isFinite(value) || value < 0) throw new Error('Leitura de peso invalida.');
      return Math.round(value * 1000) / 1000;
    },
    async tare() {
      const fn = requireMethod(scale, 'tare', true);
      if (!fn) throw new Error('Tara nao suportada pela balanca configurada.');
      return fn();
    }
  });

  const receiptPrinter = Object.freeze({
    status: createStatus(printer, 'receipt-printer'),
    async print(job = {}) {
      if (!job || typeof job !== 'object') throw new Error('Trabalho de impressao invalido.');
      return requireMethod(printer, 'print')(job);
    }
  });

  const cashDrawer = Object.freeze({
    status: createStatus(drawer, 'cash-drawer'),
    open: () => requireMethod(drawer, 'open')()
  });

  return Object.freeze({ barcodeScanner, scale: scaleAdapter, receiptPrinter, cashDrawer });
}

module.exports = { createHardwareAdapters };
