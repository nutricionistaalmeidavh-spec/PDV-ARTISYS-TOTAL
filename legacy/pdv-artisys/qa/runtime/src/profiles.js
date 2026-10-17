const PROFILE_NAMES = ['quick', 'full', 'release'];

const DEFAULTS = {
  quick: { critical: false, includeDesktop: false, includeNetwork: false, includeCrosscut: false },
  full: { critical: false, includeDesktop: true, includeNetwork: true, includeCrosscut: false },
  release: { critical: true, includeDesktop: true, includeNetwork: true, includeCrosscut: false },
};

function manifestFlows(manifest) {
  return Object.keys(manifest?.flows || {});
}

function defaultFlows(manifest, profile) {
  const flows = manifestFlows(manifest);
  if (profile === 'quick') {
    const preferred = ['smoke', 'login', 'sale'].filter(name => flows.includes(name));
    return preferred.length ? preferred : flows.slice(0, Math.min(3, flows.length));
  }
  return flows;
}

export function listQaProfiles() {
  return [...PROFILE_NAMES];
}

export function resolveQaProfile(manifest, requested = 'quick') {
  if (!PROFILE_NAMES.includes(requested)) throw new Error(`Unknown QA profile: ${requested}`);
  const override = manifest?.qaProfiles?.[requested];
  if (override != null && (!override || typeof override !== 'object' || Array.isArray(override))) {
    throw new TypeError(`qaProfiles.${requested} must be an object`);
  }
  const flows = override?.flows ?? defaultFlows(manifest, requested);
  if (!Array.isArray(flows) || flows.some(flow => typeof flow !== 'string' || !flow)) {
    throw new TypeError(`qaProfiles.${requested}.flows must be an array of flow names`);
  }
  const declared = new Set(manifestFlows(manifest));
  for (const flow of flows) {
    if (!declared.has(flow)) throw new Error(`QA profile ${requested} references unknown flow: ${flow}`);
  }
  return {
    name: requested,
    ...DEFAULTS[requested],
    ...(override || {}),
    flows: [...flows],
    criticalFlows: [...(override?.criticalFlows || (requested === 'release' ? flows : []))],
  };
}
