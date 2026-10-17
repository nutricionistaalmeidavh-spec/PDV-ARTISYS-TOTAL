export const BUSINESS_PACKS = Object.freeze({
  auth: ['login', 'logout', 'permissions', 'session'],
  commerce: ['sale', 'cancel-sale', 'cash-open', 'cash-close', 'customer', 'inventory'],
  finance: ['income', 'expense', 'reconciliation', 'dre'],
  workforce: ['employee', 'attendance', 'payment', 'receipt'],
  saas: ['smoke', 'auth', 'multitenancy'],
  licensing: ['licenciamento'],
  multitenancy: ['multitenancy'],
});

export function listBusinessPacks() {
  return Object.keys(BUSINESS_PACKS);
}

export function resolveBusinessPack(name, manifest, { strict = true } = {}) {
  const required = BUSINESS_PACKS[name];
  if (!required) throw new Error(`Unknown business pack: ${name}`);
  const declared = new Set(Object.keys(manifest?.flows || {}));
  const available = required.filter(flow => declared.has(flow));
  const missing = required.filter(flow => !declared.has(flow));
  if (strict && missing.length) {
    throw new Error(`Business pack ${name} is missing flows: ${missing.join(', ')}`);
  }
  return { name, required: [...required], available, missing };
}
