import test from 'node:test';
import assert from 'node:assert/strict';
import {planShares,localTicketDay,parseWeightedEAN13,ean13CheckDigit} from '../src/r4-saas-rules.mjs';

test('cap-032: individualized split preserves cents exactly, rejects under/over allocation and bad money',()=>{
 assert.deepEqual(planShares(10001,3,[3333,3334,3334]),[3333,3334,3334]);
 assert.deepEqual(planShares(10001,3,null),[3334,3334,3333]);
 for(const bad of [[5000,5000,0],[5000,5000],[5000,5002,0],[5000.1,5000.9,0],[-1,5000,5002]]){
  assert.throws(()=>planShares(10001,3,bad),/parcela|soma|inteiro|valor/i);
 }
});

test('cap-038: daily tickets honor store IANA timezone and midnight, not UTC day',()=>{
 const instant='2026-10-19T02:30:00.000Z';
 assert.equal(localTicketDay(instant,'America/Sao_Paulo'),'2026-10-18');
 assert.equal(localTicketDay(instant,'America/Manaus'),'2026-10-18');
 assert.equal(localTicketDay(instant,'UTC'),'2026-10-19');
 assert.equal(localTicketDay('2026-10-19T03:00:00Z','America/Sao_Paulo'),'2026-10-19');
 assert.throws(()=>localTicketDay(instant,'Not/AZone'),/fuso|timezone/i);
});

test('cap-039: verified EAN-13 embedded-weight label parses PLU and grams, never makes a sale',()=>{
 const raw='200004201250';
 const barcode=raw+ean13CheckDigit(raw);
 assert.deepEqual(parseWeightedEAN13(barcode),{barcode,prefix:'20',plu:'00042',grams:1250});
 assert.throws(()=>parseWeightedEAN13(barcode.slice(0,12)+'9'),/dígito|verificação/i);
 assert.throws(()=>parseWeightedEAN13('7891234567895'),/etiqueta|prefixo/i);
 assert.throws(()=>parseWeightedEAN13('20-00042-01250'),/13/);
 assert.throws(()=>parseWeightedEAN13('200004200000'+ean13CheckDigit('200004200000')),/peso/i);
});
