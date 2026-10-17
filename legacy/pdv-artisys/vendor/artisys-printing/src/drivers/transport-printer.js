'use strict';
const { wrapPrintingError } = require('../errors');
function createTransportPrinterDriver({ transport } = {}) {
  if (!transport || typeof transport.write !== 'function') throw new TypeError('transport de impressao invalido.');
  async function print(rendered, profile = {}) {
    const source=typeof rendered === 'object' && rendered !== null && !Buffer.isBuffer(rendered) && 'text' in rendered ? rendered.text : rendered;
    const bytes=Buffer.isBuffer(source) ? source : Buffer.from(String(source ?? ''));
    if (!bytes.length) throw wrapPrintingError(new Error('Conteudo de impressao vazio.'),'PRINTER_RENDER_FAILED');
    try {
      if (typeof transport.open === 'function') await transport.open();
      await transport.write(bytes);
      if (typeof transport.drain === 'function') await transport.drain();
      return { success:true, driver:'transport', device:profile.id || null, printedAt:new Date().toISOString() };
    } catch (error) { throw wrapPrintingError(error,'PRINTER_WRITE_FAILED'); }
    finally { if (typeof transport.close === 'function') { try { await transport.close(); } catch {} } }
  }
  async function status() { if (typeof transport.status === 'function') return transport.status(); return { available:true, mode:'transport' }; }
  return Object.freeze({ print, status });
}
module.exports = { createTransportPrinterDriver };
