'use strict';

function createGenericSerialDevice({ transport } = {}) {
  if (!transport) throw new TypeError('transport serial obrigatorio.');
  return Object.freeze({
    open: () => transport.open(),
    close: () => transport.close(),
    write: data => transport.write(data),
    drain: () => transport.drain(),
    onData: handler => transport.onData(handler),
    status: () => transport.status()
  });
}

module.exports = { createGenericSerialDevice };
