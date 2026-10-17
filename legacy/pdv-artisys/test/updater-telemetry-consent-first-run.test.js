'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelemetryConsentController } = require('../desktop/telemetry-consent-controller.cjs');

test('primeiro inicio apos update pode salvar aceite sem iniciar outra instalacao', async () => {
  const writes = [];
  let installs = 0;
  const controller = createTelemetryConsentController({
    settings: { set: async (key, value) => writes.push([key, value]), get: () => 0 },
    updater: { install: () => { installs += 1; } },
    now: () => new Date('2026-09-25T21:00:00.000Z')
  });

  await controller.accept();

  assert.equal(installs, 0);
  assert.equal(Object.fromEntries(writes)['telemetry.enabled'], true);
  assert.equal(Object.fromEntries(writes)['telemetry.diagnostics'], true);
});

test('primeiro inicio apos update pode continuar sem compartilhar e limpa fila pendente', async () => {
  const writes = [];
  let purges = 0;
  const controller = createTelemetryConsentController({
    settings: { set: async (key, value) => writes.push([key, value]), get: () => 0 },
    updater: { install: () => true },
    now: () => new Date('2026-09-25T21:00:00.000Z'),
    onDecline: async () => { purges += 1; }
  });

  await controller.decline();

  assert.equal(Object.fromEntries(writes)['telemetry.enabled'], false);
  assert.equal(Object.fromEntries(writes)['telemetry.diagnostics'], false);
  assert.equal(Object.fromEntries(writes)['telemetry.consent_accepted_at'], '');
  assert.equal(purges, 1);
});
