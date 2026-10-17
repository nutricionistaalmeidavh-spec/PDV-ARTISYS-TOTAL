'use strict';

const DEFAULT_PULSE = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa]);

function createDrawerAdapter({ transport, pulse = DEFAULT_PULSE } = {}) {
  if (!transport || typeof transport.open !== 'function' || typeof transport.write !== 'function') throw new TypeError('transport de gaveta invalido.');
  const command = Buffer.from(pulse);
  return Object.freeze({
    async status() {
      if (typeof transport.status === 'function') return transport.status();
      return { available:true };
    },
    async open() {
      await transport.open();
      try {
        await transport.write(command);
        if (typeof transport.drain === 'function') await transport.drain();
        return true;
      } finally {
        if (typeof transport.close === 'function') {
          try { await transport.close(); } catch {}
        }
      }
    }
  });
}

module.exports = { createDrawerAdapter, DEFAULT_PULSE };
