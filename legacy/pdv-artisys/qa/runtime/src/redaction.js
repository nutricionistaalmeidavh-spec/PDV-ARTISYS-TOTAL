function normalizedSecrets(secretValues = []) {
  return [...new Set(secretValues.filter(value => typeof value === 'string' && value.length > 0))]
    .sort((a, b) => b.length - a.length);
}

function redactString(value, secrets) {
  let redacted = value;
  for (const secret of secrets) redacted = redacted.split(secret).join('[REDACTED]');
  return redacted;
}

export function redactSecrets(value, secretValues = []) {
  const secrets = normalizedSecrets(secretValues);
  if (typeof value === 'string') return redactString(value, secrets);
  if (Array.isArray(value)) return value.map(item => redactSecrets(item, secrets));
  if (value && typeof value === 'object') {
    if (value instanceof Date) return new Date(value.getTime());
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactSecrets(item, secrets)]));
  }
  return value;
}

export function collectProfileSecretValues(profile, env = process.env) {
  const values = [];
  for (const [key, envName] of Object.entries(profile?.account || {})) {
    if (!key.endsWith('Env') || typeof envName !== 'string') continue;
    const value = env[envName];
    if (typeof value === 'string' && value.length > 0) values.push(value);
  }
  return [...new Set(values)];
}
