'use strict';
const { normalizeDeviceProfile } = require('./device-profile');
const { SerialError, normalizeSerialError, normalizeSerialOpenError } = require('./errors');

function resolveSerialPortClass(SerialPortClass) {
  if (SerialPortClass) return SerialPortClass;
  const electronMajor = Number(String(process.versions?.electron || '').split('.')[0] || 0);
  const packageName = electronMajor > 0 && electronMajor <= 22 ? 'serialport-legacy' : 'serialport';
  const loaded = require(packageName);
  const resolved = loaded?.SerialPort || loaded;
  if (typeof resolved !== 'function') throw new TypeError('SerialPortClass indisponivel.');
  return resolved;
}

function createSerialTransport({ SerialPortClass, profile } = {}) {
  const normalized = normalizeDeviceProfile(profile);
  const PortClass = resolveSerialPortClass(SerialPortClass);
  let port = null;
  let state = 'closed';
  let openingPromise = null;
  let closingPromise = null;
  let lastError = null;
  const dataListeners = new Set();

  function createPort() {
    const instance = new PortClass({ ...normalized, autoOpen:false });
    instance.on?.('data', chunk => { for (const listener of dataListeners) listener(chunk); });
    instance.on?.('error', error => {
      lastError = normalizeSerialError(error, 'SERIAL_DISCONNECTED');
      if (state === 'open') state = 'error';
    });
    return instance;
  }

  async function open() {
    if (state === 'open') return true;
    if (openingPromise) return openingPromise;
    if (closingPromise) await closingPromise;
    if (!port || state === 'error') port = createPort();
    state = 'opening';
    openingPromise = new Promise((resolve, reject) => {
      port.open(error => {
        if (error) {
          lastError = normalizeSerialOpenError(error);
          state = 'error';
          reject(lastError);
          return;
        }
        lastError = null;
        state = 'open';
        resolve(true);
      });
    }).finally(() => { openingPromise = null; });
    return openingPromise;
  }

  async function close() {
    if (closingPromise) return closingPromise;
    if (openingPromise) {
      try { await openingPromise; } catch { state = 'closed'; port = null; return true; }
    }
    if (!port || state === 'closed' || !port.isOpen) {
      state = 'closed';
      port = null;
      return true;
    }
    state = 'closing';
    closingPromise = new Promise((resolve, reject) => {
      port.close(error => {
        if (error) {
          const normalizedError = normalizeSerialError(error, 'SERIAL_DISCONNECTED');
          lastError = normalizedError;
          state = 'error';
          reject(normalizedError);
          return;
        }
        state = 'closed';
        port = null;
        resolve(true);
      });
    }).finally(() => { closingPromise = null; });
    return closingPromise;
  }

  async function write(data) {
    if (state !== 'open' || !port) throw new SerialError('SERIAL_DISCONNECTED', 'Porta serial nao esta aberta.');
    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ''));
    return new Promise((resolve, reject) => {
      port.write(payload, error => {
        if (error) {
          const normalizedError = normalizeSerialError(error, 'SERIAL_WRITE_FAILED');
          lastError = normalizedError;
          state = 'error';
          reject(normalizedError);
          return;
        }
        resolve(true);
      });
    });
  }

  async function drain() {
    if (state !== 'open' || !port) throw new SerialError('SERIAL_DISCONNECTED', 'Porta serial nao esta aberta.');
    if (typeof port.drain !== 'function') return true;
    return new Promise((resolve, reject) => {
      port.drain(error => {
        if (error) {
          const normalizedError = normalizeSerialError(error, 'SERIAL_WRITE_FAILED');
          lastError = normalizedError;
          state = 'error';
          reject(normalizedError);
          return;
        }
        resolve(true);
      });
    });
  }

  function onData(handler) {
    if (typeof handler !== 'function') throw new TypeError('handler deve ser funcao.');
    dataListeners.add(handler);
    return () => dataListeners.delete(handler);
  }

  async function status() {
    return {
      available:true,
      state,
      path:normalized.path,
      baudRate:normalized.baudRate,
      dataBits:normalized.dataBits,
      stopBits:normalized.stopBits,
      parity:normalized.parity,
      errorCode:lastError?.code || null
    };
  }

  return Object.freeze({ open, close, write, drain, onData, status });
}

module.exports = { createSerialTransport, resolveSerialPortClass };
