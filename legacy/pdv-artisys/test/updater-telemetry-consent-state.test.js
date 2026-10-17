'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelemetryConsentController } = require('../desktop/telemetry-consent-controller.cjs');

test('consent state informa quando a versao atual ja foi respondida', () => {
  const settings = {
    set: async () => {},
    get: (key, options) => key === 'telemetry.consent_version' ? 1 : options?.defaultValue
  };
  const controller = createTelemetryConsentController({ settings, updater: { install: () => true } });
  assert.deepEqual(controller.state(), { version: 1, requiredVersion: 1, needsPrompt: false });
});

test('consent state pede prompt quando nunca houve resposta', () => {
  const settings = {
    set: async () => {},
    get: (_key, options) => options?.defaultValue
  };
  const controller = createTelemetryConsentController({ settings, updater: { install: () => true } });
  assert.deepEqual(controller.state(), { version: 0, requiredVersion: 1, needsPrompt: true });
});
