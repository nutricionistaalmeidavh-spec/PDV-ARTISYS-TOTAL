'use strict';

const TELEMETRY_CONSENT_VERSION = 1;

function isoNow(now) {
  const value = now instanceof Date ? now : new Date(now || Date.now());
  if (Number.isNaN(value.getTime())) throw new Error('Data de consentimento invalida.');
  return value.toISOString();
}

function buildTelemetryConsentSettings({ accepted, now = new Date() } = {}) {
  const timestamp = isoNow(now);
  if (accepted) {
    return {
      'telemetry.enabled': true,
      'telemetry.diagnostics': true,
      'telemetry.consent_version': TELEMETRY_CONSENT_VERSION,
      'telemetry.consent_accepted_at': timestamp,
      'telemetry.consent_declined_at': ''
    };
  }
  return {
    'telemetry.enabled': false,
    'telemetry.diagnostics': false,
    'telemetry.consent_version': TELEMETRY_CONSENT_VERSION,
    'telemetry.consent_accepted_at': '',
    'telemetry.consent_declined_at': timestamp
  };
}

module.exports = { TELEMETRY_CONSENT_VERSION, buildTelemetryConsentSettings };
