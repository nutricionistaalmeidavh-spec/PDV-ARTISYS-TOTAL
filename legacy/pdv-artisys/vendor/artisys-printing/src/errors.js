'use strict';

class PrintingError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'PrintingError';
    this.code = code;
  }
}

function wrapPrintingError(error, code = 'PRINTER_WRITE_FAILED') {
  if (error instanceof PrintingError) return error;
  return new PrintingError(code, error?.message || String(error || 'Erro de impressao.'), { cause:error instanceof Error ? error : undefined });
}

module.exports = { PrintingError, wrapPrintingError };
