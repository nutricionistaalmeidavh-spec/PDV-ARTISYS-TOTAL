import fs from 'node:fs/promises';
import path from 'node:path';
import { VIEWPORTS, DEMO_PRESETS } from './config.js';

const MODES = new Set(['web', 'electron']);
const WORKSPACE_STRATEGIES = new Set(['persistent', 'snapshot', 'ephemeral']);
const LITERAL_CREDENTIAL_KEYS = new Set([
  'username',
  'email',
  'password',
  'token',
  'secret',
  'apikey',
  'api_key',
  'accesstoken',
  'access_token',
]);

export async function loadQaManifest(filePath) {
  const absolute = path.resolve(filePath);
  const raw = await fs.readFile(absolute, 'utf8');
  const manifest = JSON.parse(raw);
  validateQaManifest(manifest);
  return { manifest, absolute, rootDir: path.dirname(absolute) };
}

function profileEntries(manifest) {
  if (manifest.demoProfile != null && manifest.demoProfiles != null) {
    throw new TypeError('Use either demoProfile or demoProfiles, not both');
  }
  if (manifest.demoProfiles != null) {
    if (!manifest.demoProfiles || typeof manifest.demoProfiles !== 'object' || Array.isArray(manifest.demoProfiles)) {
      throw new TypeError('demoProfiles must be an object');
    }
    return Object.entries(manifest.demoProfiles);
  }
  if (manifest.demoProfile != null) {
    if (!manifest.demoProfile || typeof manifest.demoProfile !== 'object' || Array.isArray(manifest.demoProfile)) {
      throw new TypeError('demoProfile must be an object');
    }
    return [[manifest.demoProfile.id || 'default', manifest.demoProfile]];
  }
  return [];
}

function validateDemoProfile(name, profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new TypeError(`Invalid demo profile: ${name}`);
  if (!profile.adapter || typeof profile.adapter !== 'string') throw new TypeError(`Demo profile ${name} requires adapter`);

  const account = profile.account || {};
  if (!account || typeof account !== 'object' || Array.isArray(account)) throw new TypeError(`Demo profile ${name} account must be an object`);
  for (const [key, value] of Object.entries(account)) {
    const normalizedKey = key.toLowerCase();
    if (LITERAL_CREDENTIAL_KEYS.has(normalizedKey)) {
      throw new TypeError(`Demo profile ${name} credentials must come from environment variable fields such as ${key}Env`);
    }
    if (key.endsWith('Env')) {
      if (typeof value !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
        throw new TypeError(`Demo profile ${name} ${key} must name an environment variable`);
      }
    }
  }
  if (account.createIfMissing != null && typeof account.createIfMissing !== 'boolean') {
    throw new TypeError(`Demo profile ${name} account.createIfMissing must be boolean`);
  }

  const workspace = profile.workspace || {};
  if (!workspace || typeof workspace !== 'object' || Array.isArray(workspace)) throw new TypeError(`Demo profile ${name} workspace must be an object`);
  const strategy = workspace.strategy || 'persistent';
  if (!WORKSPACE_STRATEGIES.has(strategy)) throw new TypeError(`Demo profile ${name} has unknown workspace strategy: ${strategy}`);

  if (profile.fixtures != null) {
    if (!Array.isArray(profile.fixtures) || profile.fixtures.some(id => typeof id !== 'string' || !id)) {
      throw new TypeError(`Demo profile ${name} fixtures must be an array of fixture ids`);
    }
  }
}

export function validateQaManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new TypeError('QA manifest must be an object');
  if (manifest.schemaVersion !== 1) throw new TypeError('schemaVersion must be 1');
  if (!manifest.systemId || typeof manifest.systemId !== 'string') throw new TypeError('systemId is required');
  if (!MODES.has(manifest.mode)) throw new TypeError('mode must be web or electron');
  const flowCount = manifest.flows && typeof manifest.flows === 'object' ? Object.keys(manifest.flows).length : 0;
  const demoCount = manifest.demos && typeof manifest.demos === 'object' ? Object.keys(manifest.demos).length : 0;
  if (!flowCount && !demoCount) throw new TypeError('At least one flow or demo is required');
  if (!manifest.environments || typeof manifest.environments !== 'object') throw new TypeError('environments is required');
  for (const [name, env] of Object.entries(manifest.environments)) {
    if (!env || typeof env !== 'object') throw new TypeError(`Invalid environment: ${name}`);
    if (manifest.mode === 'web') {
      if (!env.baseURL) throw new TypeError(`baseURL is required for environment ${name}`);
      const protocol = new URL(env.baseURL).protocol;
      if (!['http:', 'https:', 'file:'].includes(protocol)) throw new TypeError(`Unsupported baseURL protocol: ${protocol}`);
    }
  }
  if (manifest.defaultViewport && !VIEWPORTS[manifest.defaultViewport] && typeof manifest.defaultViewport !== 'object') {
    throw new TypeError(`Unknown viewport: ${manifest.defaultViewport}`);
  }
  if (manifest.mode === 'electron' && !manifest.electron?.entry) throw new TypeError('electron.entry is required in electron mode');
  for (const [name, demo] of Object.entries(manifest.demos || {})) {
    const normalized = typeof demo === 'string' ? { file: demo } : demo;
    if (!normalized?.file || typeof normalized.file !== 'string') throw new TypeError(`Demo ${name} requires file`);
    resolveDemoPreset(normalized.preset || 'landscape-16x9');
    if (normalized.durationTargetSec != null && (!Number.isFinite(normalized.durationTargetSec) || normalized.durationTargetSec <= 0)) {
      throw new TypeError(`Demo ${name} durationTargetSec must be positive`);
    }
  }

  const profiles = profileEntries(manifest);
  for (const [name, profile] of profiles) validateDemoProfile(name, profile);
  if (manifest.defaultDemoProfile && !profiles.some(([name]) => name === manifest.defaultDemoProfile)) {
    throw new TypeError(`Unknown default demo profile: ${manifest.defaultDemoProfile}`);
  }
  return true;
}

export function resolveEnvironment(manifest, requested) {
  const name = requested || manifest.defaultEnvironment || Object.keys(manifest.environments)[0];
  const environment = manifest.environments[name];
  if (!environment) throw new Error(`Unknown environment: ${name}`);
  return { name, environment };
}

export function resolveFlow(manifest, requested, rootDir) {
  const flows = manifest.flows || {};
  const name = requested || manifest.defaultFlow || Object.keys(flows)[0];
  const relative = flows[name];
  if (!relative) throw new Error(`Unknown flow: ${name}`);
  return { name, file: path.resolve(rootDir, relative) };
}

export function resolveDemoProfile(manifest, requested, rootDir) {
  const profiles = profileEntries(manifest);
  if (profiles.length === 0) {
    if (requested) throw new Error(`Unknown demo profile: ${requested}`);
    return null;
  }
  const name = requested || manifest.defaultDemoProfile || profiles[0][0];
  const raw = profiles.find(([profileName]) => profileName === name)?.[1];
  if (!raw) throw new Error(`Unknown demo profile: ${name}`);
  validateDemoProfile(name, raw);
  return {
    ...raw,
    name,
    id: raw.id || name,
    adapterPath: path.resolve(rootDir, raw.adapter),
    account: { createIfMissing: false, ...(raw.account || {}) },
    workspace: { strategy: 'persistent', resetBeforeRun: null, ...(raw.workspace || {}) },
    fixtures: [...(raw.fixtures || [])],
  };
}

export function resolveDemoPreset(name = 'landscape-16x9') {
  const preset = DEMO_PRESETS[name];
  if (!preset) throw new Error(`Unknown demo preset: ${name}`);
  return { name: preset.name, width: preset.width, height: preset.height, captureViewport: { ...preset.captureViewport } };
}

export function resolveDemo(manifest, requested, rootDir) {
  const demos = manifest.demos || {};
  const name = requested || manifest.defaultDemo || Object.keys(demos)[0];
  const raw = demos[name];
  if (!raw) throw new Error(`Unknown demo: ${name}`);
  const demo = typeof raw === 'string' ? { file: raw } : raw;
  const preset = demo.preset || 'landscape-16x9';
  resolveDemoPreset(preset);
  return {
    name,
    file: path.resolve(rootDir, demo.file),
    preset,
    durationTargetSec: demo.durationTargetSec ?? null,
    captureViewport: demo.captureViewport || null,
  };
}

export function resolveViewport(manifest, requested) {
  const value = requested || manifest.defaultViewport || 'desktop';
  if (typeof value === 'object') return value;
  const viewport = VIEWPORTS[value];
  if (!viewport) throw new Error(`Unknown viewport: ${value}`);
  return { name: value, ...viewport };
}
