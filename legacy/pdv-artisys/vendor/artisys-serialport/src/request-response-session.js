'use strict';
const { SerialError, normalizeSerialError } = require('./errors');

function createRequestResponseSession({ transport, request = '', timeoutMs = 1500, responseIdleMs = 0, parse, closeAfterResponse = true } = {}) {
  if (!transport || typeof transport.open !== 'function' || typeof transport.onData !== 'function') throw new TypeError('transport serial invalido.');
  if (typeof parse !== 'function') throw new TypeError('parse deve ser funcao.');
  const timeout = Number(timeoutMs);
  if (!Number.isFinite(timeout) || timeout <= 0) throw new TypeError('timeoutMs invalido.');
  const idle = Number(responseIdleMs);
  if (!Number.isFinite(idle) || idle < 0) throw new TypeError('responseIdleMs invalido.');

  async function run() {
    let unsubscribe = null;
    let timer = null;
    let parseTimer = null;
    await transport.open();
    try {
      return await new Promise((resolve, reject) => {
        let settled = false;
        let buffer = Buffer.alloc(0);
        const clearParseTimer = () => {
          if (parseTimer) clearTimeout(parseTimer);
          parseTimer = null;
        };
        const finish = (error, value) => {
          if (settled) return;
          settled = true;
          if (timer) clearTimeout(timer);
          clearParseTimer();
          unsubscribe?.();
          error ? reject(error) : resolve(value);
        };
        const attemptParse = () => {
          parseTimer = null;
          if (settled) return;
          try {
            const value = parse(buffer);
            if (value !== undefined && value !== null) finish(null, value);
          } catch (error) {
            finish(normalizeSerialError(error, 'SERIAL_PARSE_FAILED'));
          }
        };
        unsubscribe = transport.onData(chunk => {
          buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
          if (idle > 0) {
            clearParseTimer();
            parseTimer = setTimeout(attemptParse, idle);
          } else {
            attemptParse();
          }
        });
        timer = setTimeout(() => finish(new SerialError('SERIAL_TIMEOUT', `Tempo limite de ${timeout}ms excedido.`)), timeout);
        Promise.resolve(request !== '' && request !== null && request !== undefined ? transport.write(request) : true)
          .catch(error => finish(normalizeSerialError(error, error?.code || 'SERIAL_WRITE_FAILED')));
      });
    } finally {
      if (timer) clearTimeout(timer);
      if (parseTimer) clearTimeout(parseTimer);
      unsubscribe?.();
      if (closeAfterResponse && typeof transport.close === 'function') {
        try { await transport.close(); } catch {}
      }
    }
  }

  return Object.freeze({ run });
}

module.exports = { createRequestResponseSession };
