'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { createTelemetryConsentController } = require('../desktop/telemetry-consent-controller.cjs');

test('controller persiste todas as preferencias antes de instalar a atualizacao', async () => {
  const writes = [];
  let installed = false;
  const settings = { set: async (key, value) => { writes.push([key, value]); } };
  const updater = { install: () => { installed = true; return true; } };
  const controller = createTelemetryConsentController({ settings, updater, now: () => new Date('2026-09-25T21:00:00.000Z') });

  await controller.acceptAndInstall();

  assert.equal(installed, true);
  assert.deepEqual(Object.fromEntries(writes), {
    'telemetry.enabled': true,
    'telemetry.diagnostics': true,
    'telemetry.consent_version': 1,
    'telemetry.consent_accepted_at': '2026-09-25T21:00:00.000Z',
    'telemetry.consent_declined_at': ''
  });
});

test('controller permite instalar sem compartilhar dados', async () => {
  const writes = [];
  let installed = false;
  const settings = { set: async (key, value) => { writes.push([key, value]); } };
  const updater = { install: () => { installed = true; return true; } };
  const controller = createTelemetryConsentController({ settings, updater, now: () => new Date('2026-09-25T21:00:00.000Z') });

  await controller.declineAndInstall();

  assert.equal(installed, true);
  assert.equal(Object.fromEntries(writes)['telemetry.enabled'], false);
  assert.equal(Object.fromEntries(writes)['telemetry.diagnostics'], false);
});