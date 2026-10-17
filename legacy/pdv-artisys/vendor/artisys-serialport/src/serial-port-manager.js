'use strict';
const { createSerialTransport, resolveSerialPortClass } = require('./serial-transport');

function createSerialPortManager({ SerialPortClass } = {}) {
  const PortClass = resolveSerialPortClass(SerialPortClass);
  return Object.freeze({
    async list() {
      if (typeof PortClass.list !== 'function') return [];
      return PortClass.list();
    },
    createTransport(profile) {
      return createSerialTransport({ SerialPortClass:PortClass, profile });
    }
  });
}

module.exports = { createSerialPortManager };
