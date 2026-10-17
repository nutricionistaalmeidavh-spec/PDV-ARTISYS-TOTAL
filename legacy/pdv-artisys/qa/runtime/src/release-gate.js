export function evaluateReleaseGate({ profile = 'release', results = [], override = false, overrideReason = null } = {}) {
  if (!Array.isArray(results)) throw new TypeError('results must be an array');
  const failedCritical = results.filter(result => result?.status === 'failed' && result?.critical !== false);
  const passed = failedCritical.length === 0;
  if (override && (!overrideReason || typeof overrideReason !== 'string' || overrideReason.trim().length < 3)) {
    throw new Error('overrideReason is required when overriding a failed release gate');
  }
  return {
    schemaVersion: 1,
    profile,
    passed,
    allowed: passed || override,
    overridden: !passed && override,
    overrideReason: override ? overrideReason.trim() : null,
    failedCritical: failedCritical.map(item => ({ flow: item.flow || null, check: item.check || null, error: item.error || null })),
    evaluatedAt: new Date().toISOString(),
  };
}
