'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {qrSvg,makeMatrix,encodePayload,VERSION,SIZE}=require('../js/core/mobile-access/qr-code');

test('cap-042 R2 QR: canonical generator works offline for HTTPS LAN origin',()=>{
  const origin='https://pdv.local:8443/';
  const matrix=makeMatrix(origin);
  const svg=qrSvg(origin,{scale:4,border:4});
  assert.equal(VERSION,4);
  assert.equal(SIZE,33);
  assert.equal(matrix.length,33);
  assert.ok(matrix.every(row=>row.length===33));
  assert.match(svg,/viewBox="0 0 41 41"/);
  assert.ok(svg.includes('data-qr-payload="https://pdv.local:8443/"'));
  assert.equal(encodePayload(origin).length,100);
  assert.throws(()=>qrSvg('x'.repeat(79)),/capacidade/);
  assert.ok(!svg.includes('<script'));
});
