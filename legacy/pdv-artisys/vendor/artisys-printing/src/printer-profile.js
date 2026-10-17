'use strict';
const { PrintingError } = require('./errors');

const MODES = new Set(['electron','thermal','transport']);
const TYPES = new Set(['epson','star','generic']);
const WIDTHS = new Set([32,42,48]);

function normalizePrinterProfile(input = {}) {
  const id=String(input.id || 'default');
  const mode=String(input.mode || 'electron').toLowerCase();
  const width=Number(input.width ?? 42);
  const printerType=String(input.printerType || 'generic').toLowerCase();
  const interfaceValue=input.interface == null || input.interface === '' ? null : String(input.interface);
  const deviceName=input.deviceName == null || input.deviceName === '' ? null : String(input.deviceName);
  if (!MODES.has(mode)) throw new PrintingError('PRINTER_UNSUPPORTED', `Modo de impressao nao suportado: ${mode}.`);
  if (!WIDTHS.has(width)) throw new PrintingError('PRINTER_RENDER_FAILED', 'Largura deve ser 32, 42 ou 48 colunas.');
  if (!TYPES.has(printerType)) throw new PrintingError('PRINTER_UNSUPPORTED', `Tipo de impressora nao suportado: ${printerType}.`);
  if (mode === 'thermal' && !interfaceValue) throw new PrintingError('PRINTER_NOT_CONFIGURED', 'Interface da impressora termica nao configurada.');
  return Object.freeze({
    id, mode, width, printerType, interface:interfaceValue, deviceName,
    silent:Boolean(input.silent), cut:Boolean(input.cut), openDrawerAfterPrint:Boolean(input.openDrawerAfterPrint)
  });
}

module.exports = { normalizePrinterProfile };
