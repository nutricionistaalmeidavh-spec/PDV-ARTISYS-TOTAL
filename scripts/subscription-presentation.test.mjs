import test from 'node:test';
import assert from 'node:assert/strict';
import {formatSubscriptionEnd,billingOrderLabel} from '../packages/core/shared/subscription-presentation.mjs';
test('subscription display is independent of device timezone and handles midnight and leap years',()=>{
 assert.equal(formatSubscriptionEnd('2026-11-07T02:46:00Z'),'06/11/2026, 23:46 (Brasília)');
 assert.equal(formatSubscriptionEnd('2026-11-07T03:00:00Z'),'07/11/2026, 00:00 (Brasília)');
 assert.equal(formatSubscriptionEnd('2028-03-01T02:00:00Z'),'29/02/2028, 23:00 (Brasília)');
 assert.equal(formatSubscriptionEnd(null),'Não informado');
 assert.equal(formatSubscriptionEnd('invalid'),'Não informado');
});
test('unknown and failed lookups are never presented as pending or paid',()=>{
 assert.match(billingOrderLabel('pending'),/Pendente/);
 assert.match(billingOrderLabel('paid'),/confirmado/);
 assert.match(billingOrderLabel('expired'),/expirado/);
 for(const state of [undefined,'unavailable','future_state'])assert.match(billingOrderLabel(state),/indisponível/);
});
