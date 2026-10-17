import { pathToFileURL } from 'node:url';

const HOOK_NAMES = [
  'findDemoAccount',
  'createDemoAccount',
  'authenticateDemoAccount',
  'ensureDemoWorkspace',
  'resetDemoWorkspace',
  'seedDemoFixtures',
  'getDemoProfileStatus',
  'importDemoSnapshot',
  'exportDemoSnapshot',
];

export function validateDemoAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') throw new TypeError('Demo adapter must be an object');
  for (const name of HOOK_NAMES) {
    if (adapter[name] != null && typeof adapter[name] !== 'function') {
      throw new TypeError(`Demo adapter hook ${name} must be a function`);
    }
  }
  if (adapter.capabilities != null) {
    if (!adapter.capabilities || typeof adapter.capabilities !== 'object' || Array.isArray(adapter.capabilities)) {
      throw new TypeError('Demo adapter capabilities must be an object');
    }
    for (const [name, capability] of Object.entries(adapter.capabilities)) {
      if (typeof capability !== 'function') throw new TypeError(`Demo adapter capability ${name} must be a function`);
    }
  }
  if (adapter.fixturePacks != null && !Array.isArray(adapter.fixturePacks)) {
    throw new TypeError('Demo adapter fixturePacks must be an array');
  }
  return adapter;
}

export async function loadDemoAdapter(adapterPath) {
  if (!adapterPath || typeof adapterPath !== 'string') throw new TypeError('Demo adapter path is required');
  const module = await import(pathToFileURL(adapterPath).href);
  const adapter = module.default ?? module.adapter ?? module;
  return validateDemoAdapter(adapter);
}
