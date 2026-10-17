'use strict';

class SerialError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = 'SerialError';
    this.code = code;
  }
}

function normalizeSerialError(error, fallbackCode = 'SERIAL_DISCONNECTED') {
  if (error instanceof SerialError) return error;
  const message = error?.message || String(error || 'Erro serial.');
  return new SerialError(fallbackCode, message, { cause: error instanceof Error ? error : undefined });
}

function normalizeSerialOpenError(error) {
  if (error instanceof SerialError) return error;
  const message = error?.message || String(error || 'Falha ao abrir porta serial.');
  const code = String(error?.code || '').toUpperCase();
  if (code === 'EBUSY' || /\b(busy|resource busy)\b/i.test(message)) {
    return new SerialError('SERIAL_PORT_BUSY', message, { cause:error instanceof Error ? error : undefined });
  }
  return new SerialError('SERIAL_OPEN_FAILED', message, { cause:error instanceof Error ? error : undefined });
}

module.exports = { SerialError, normalizeSerialError, normalizeSerialOpenError };
