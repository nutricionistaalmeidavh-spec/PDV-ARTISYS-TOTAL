'use strict';

const { PrintingError, wrapPrintingError } = require('./errors');
const { createReceiptDocument } = require('./receipt-document');
const { normalizePrinterProfile } = require('./printer-profile');
const { renderPlainText, money, fit, center, columns } = require('./renderers/plain-text');
const { toReceiptLineMarkup, renderReceiptLine, renderReceiptSvg } = require('./renderers/receiptline');
const { createElectronPrinterDriver } = require('./drivers/electron-printer');
const { createTransportPrinterDriver } = require('./drivers/transport-printer');
const { createThermalPrinterDriver } = require('./drivers/thermal-printer');
const { createPrinterResolver } = require('./driver-resolver');

module.exports = {
  PrintingError,
  wrapPrintingError,
  createReceiptDocument,
  normalizePrinterProfile,
  renderPlainText,
  money,
  fit,
  center,
  columns,
  toReceiptLineMarkup,
  renderReceiptLine,
  renderReceiptSvg,
  createElectronPrinterDriver,
  createTransportPrinterDriver,
  createThermalPrinterDriver,
  createPrinterResolver
};
