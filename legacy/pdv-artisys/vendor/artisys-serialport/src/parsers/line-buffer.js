'use strict';

function createLineBuffer({ delimiter = '\n', encoding = 'utf8' } = {}) {
  const marker = Buffer.from(String(delimiter), encoding);
  if (marker.length === 0) throw new TypeError('delimiter nao pode ser vazio.');
  let buffer = Buffer.alloc(0);
  function push(chunk) {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), encoding)]);
    const lines = [];
    let index = buffer.indexOf(marker);
    while (index >= 0) {
      lines.push(buffer.subarray(0, index).toString(encoding));
      buffer = buffer.subarray(index + marker.length);
      index = buffer.indexOf(marker);
    }
    return lines;
  }
  function flush() {
    const value = buffer.toString(encoding);
    buffer = Buffer.alloc(0);
    return value;
  }
  return Object.freeze({ push, flush });
}

module.exports = { createLineBuffer };
