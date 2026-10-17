'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const { buildTelemetryConsentSettings } = require('../desktop/telemetry-consent.cjs');

test('aceite da telemetria persiste consentimento versionado e habilita uso + diagnostico', () => {
  const now = new Date('2026-09-25T21:00:00.000Z');
  assert.deepEqual(buildTelemetryConsentSettings({ accepted: true, now }), {
    'telemetry.enabled': true,
    'telemetry.diagnostics': true,
    'telemetry.consent_version': 1,
    'telemetry.consent_accepted_at': '2026-09-25T21:00:00.000Z',
    'telemetry.consent_declined_at': ''
  });
});

test('recusa invalida aceite anterior e registra a versao apresentada', () => {
  const now = new Date('2026-09-25T21:00:00.000Z');
  assert.deepEqual(buildTelemetryConsentSettings({ accepted: false, now }), {
    'telemetry.enabled': false,
    'telemetry.diagnostics': false,
    'telemetry.consent_version': 1,
    'telemetry.consent_accepted_at': '',
    'telemetry.consent_declined_at': '2026-09-25T21:00:00.000Z'
  });
});
