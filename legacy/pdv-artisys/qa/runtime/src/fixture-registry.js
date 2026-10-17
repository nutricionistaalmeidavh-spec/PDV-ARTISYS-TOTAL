import { COMMON_FIXTURE_PACKS } from './fixtures/common.js';
import { COMMERCE_FIXTURE_PACKS } from './fixtures/commerce.js';

const BUILTIN_PACKS = [...COMMON_FIXTURE_PACKS, ...COMMERCE_FIXTURE_PACKS];

function validatePack(pack) {
  if (!pack || typeof pack !== 'object' || Array.isArray(pack)) throw new TypeError('Fixture pack must be an object');
  if (!pack.id || typeof pack.id !== 'string') throw new TypeError('Fixture pack id is required');
  if (!Number.isInteger(pack.revision) || pack.revision < 1) throw new TypeError(`Fixture pack ${pack.id} revision must be a positive integer`);
  return pack;
}

export function createFixtureRegistry(packs = []) {
  if (!Array.isArray(packs)) throw new TypeError('Fixture packs must be an array');
  const registry = new Map();
  for (const pack of [...BUILTIN_PACKS, ...packs]) {
    validatePack(pack);
    registry.set(pack.id, structuredClone(pack));
  }
  return registry;
}

export function resolveFixturePacks(registry, ids = []) {
  if (!(registry instanceof Map)) throw new TypeError('Fixture registry must be a Map');
  if (!Array.isArray(ids)) throw new TypeError('Fixture ids must be an array');
  const seen = new Set();
  const resolved = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    const pack = registry.get(id);
    if (!pack) throw new Error(`Unknown fixture pack: ${id}`);
    seen.add(id);
    resolved.push(structuredClone(pack));
  }
  return resolved;
}

export function listBuiltInFixturePacks() {
  return BUILTIN_PACKS.map(pack => ({ id: pack.id, revision: pack.revision }));
}
