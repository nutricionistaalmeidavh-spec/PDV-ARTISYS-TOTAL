'use strict';

function createSerialPortHarness(scenarios = []) {
  const state = { instances: [], writes: [], writeBuffers: [], opens: 0, closes: 0 };
  let cursor = 0;

  class SimulatedSerialPort {
    constructor(options = {}) {
      this.options = { ...options };
      this.isOpen = false;
      this.handlers = new Map();
      this.scenario = scenarios[cursor++] || {};
      state.instances.push(this);
    }

    on(event, handler) {
      this.handlers.set(event, handler);
      return this;
    }

    emit(event, value) {
      this.handlers.get(event)?.(value);
    }

    open(callback) {
      state.opens += 1;
      if (this.scenario.openError) return callback(this.scenario.openError);
      this.isOpen = true;
      callback(null);
    }

    close(callback) {
      state.closes += 1;
      this.isOpen = false;
      callback(null);
    }

    write(payload, callback) {
      const raw = Buffer.from(payload);
      state.writeBuffers.push(raw);
      state.writes.push(raw.toString('utf8'));
      if (this.scenario.writeError) {
        const error = this.scenario.writeError;
        queueMicrotask(() => {
          if (this.scenario.emitErrorEvent !== false) this.emit('error', error);
          callback(error);
        });
        return;
      }
      callback(null);
      for (const chunk of this.scenario.chunks || []) {
        setTimeout(() => this.emit('data', Buffer.from(chunk.data)), Number(chunk.delayMs || 0));
      }
    }

    drain(callback) {
      if (this.scenario.drainError) return callback(this.scenario.drainError);
      callback(null);
    }
  }

  return { SerialPortClass: SimulatedSerialPort, state };
}

function createThermalPrinterHarness() {
  const calls = [];
  class ThermalPrinter {
    constructor(options) {
      this.options = options;
      calls.push(['construct', options]);
    }
    println(text) { calls.push(['println', text]); }
    openCashDrawer() { calls.push(['drawer']); }
    cut() { calls.push(['cut']); }
    async execute() { calls.push(['execute']); return true; }
    async isPrinterConnected() { return true; }
  }
  return {
    upstream: { ThermalPrinter, PrinterTypes: { EPSON:'EPSON', STAR:'STAR' } },
    calls
  };
}

function createBrowserWindowHarness(outcomes = []) {
  const state = { prints: [], loaded: [], closed: 0 };
  let cursor = 0;
  class BrowserWindow {
    constructor() {
      this.destroyed = false;
      this.webContents = {
        print: (options, callback) => {
          state.prints.push(options);
          const result = outcomes[cursor++] || { success:true, reason:'' };
          callback(Boolean(result.success), result.reason || '');
        }
      };
    }
    async loadURL(url) { state.loaded.push(url); }
    isDestroyed() { return this.destroyed; }
    close() { this.destroyed = true; state.closed += 1; }
  }
  return { BrowserWindow, state };
}

module.exports = {
  createSerialPortHarness,
  createThermalPrinterHarness,
  createBrowserWindowHarness
};
