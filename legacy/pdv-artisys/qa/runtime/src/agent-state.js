import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ensureDir, sanitizeName } from './helpers.js';

export const DEFAULT_AGENT_PORT = 4173;
export const DEFAULT_UPDATE_INTERVAL_MINUTES = 1;
export const DEFAULT_CONSOLE_PORT = 4160;

export function defaultAgentRoot(env = process.env) {
  const base = env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'ArtiSys', 'QA');
}

export function agentStateFile(root = defaultAgentRoot()) {
  return path.join(root, 'agent-state.json');
}

export function createDefaultAgentState() {
  return {
    schemaVersion: 1,
    autoUpdate: true,
    updateIntervalMinutes: DEFAULT_UPDATE_INTERVAL_MINUTES,
    repository: 'https://github.com/nutricionistaalmeidavh-spec/utilidades.git',
    stableRef: 'main',
    activeSlot: 'slot-a',
    previousSlot: null,
    projects: [],
    lastUpdateCheckAt: null,
    lastUpdateResult: null,
    console: {
      enabled: true,
      lanEnabled: false,
      host: '127.0.0.1',
      port: DEFAULT_CONSOLE_PORT,
      token: null,
    },
    cloud: {
      enabled: false,
      endpoint: null,
    },
  };
}

export async function loadAgentState(root = defaultAgentRoot()) {
  const file = agentStateFile(root);
  try {
    const parsed = JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
    const defaults = createDefaultAgentState();
    const state = {
      ...defaults,
      ...parsed,
      projects: Array.isArray(parsed.projects) ? parsed.projects : [],
      console: { ...defaults.console, ...(parsed.console && typeof parsed.console === 'object' ? parsed.console : {}) },
      cloud: { ...defaults.cloud, ...(parsed.cloud && typeof parsed.cloud === 'object' ? parsed.cloud : {}) },
    };
    if (!Number.isFinite(Number(state.updateIntervalMinutes)) || Number(state.updateIntervalMinutes) > DEFAULT_UPDATE_INTERVAL_MINUTES) {
      state.updateIntervalMinutes = DEFAULT_UPDATE_INTERVAL_MINUTES;
    }
    return state;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return createDefaultAgentState();
  }
}

export async function saveAgentState(state, root = defaultAgentRoot()) {
  if (!state || typeof state !== 'object') throw new TypeError('agent state is required');
  await ensureDir(root);
  const file = agentStateFile(root);
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
  return file;
}

export async function ensureAgentConsoleConfiguration(root = defaultAgentRoot()) {
  const state = await loadAgentState(root);
  const current = state.console && typeof state.console === 'object' ? state.console : {};
  const port = Number(current.port);
  state.console = {
    enabled: current.enabled !== false,
    lanEnabled: current.lanEnabled === true,
    host: current.lanEnabled === true ? '0.0.0.0' : '127.0.0.1',
    port: Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_CONSOLE_PORT,
    token: typeof current.token === 'string' && current.token.length >= 16 ? current.token : randomBytes(24).toString('hex'),
  };
  await saveAgentState(state, root);
  return state;
}

export async function setAgentConsoleLan(enabled, { root = defaultAgentRoot() } = {}) {
  const state = await ensureAgentConsoleConfiguration(root);
  state.console.lanEnabled = Boolean(enabled);
  state.console.host = state.console.lanEnabled ? '0.0.0.0' : '127.0.0.1';
  await saveAgentState(state, root);
  return { ...state.console };
}

export async function configureAgentCloud({ enabled, endpoint } = {}, { root = defaultAgentRoot() } = {}) {
  const state = await loadAgentState(root);
  const current = state.cloud && typeof state.cloud === 'object' ? state.cloud : {};
  let normalizedEndpoint = current.endpoint || null;
  if (endpoint != null) {
    const url = new URL(String(endpoint));
    if (url.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(url.hostname)) {
      throw new Error('Cloud observability endpoint must use HTTPS');
    }
    normalizedEndpoint = url.toString().replace(/\/$/, '');
  }
  state.cloud = {
    enabled: enabled == null ? current.enabled === true : Boolean(enabled),
    endpoint: normalizedEndpoint,
  };
  if (state.cloud.enabled && !state.cloud.endpoint) throw new Error('Cloud observability endpoint is required when enabling cloud mode');
  await saveAgentState(state, root);
  return { ...state.cloud };
}

function normalizePort(value) {
  const port = Number(value ?? DEFAULT_AGENT_PORT);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new RangeError('port must be between 1024 and 65535');
  return port;
}

export function normalizeProjectRegistration({ config, name, id, host = '0.0.0.0', port = DEFAULT_AGENT_PORT, token, enabled = true } = {}) {
  if (!config || typeof config !== 'string') throw new TypeError('config is required');
  if (!path.isAbsolute(config)) throw new Error('config must be an absolute path');
  const projectId = sanitizeName(id || name || path.basename(path.dirname(config)) || 'project');
  if (!projectId) throw new Error('project id is required');
  if (!['127.0.0.1', 'localhost', '0.0.0.0', '::1', '::'].includes(host)) throw new Error(`Unsupported agent host: ${host}`);
  return {
    id: projectId,
    name: String(name || projectId),
    config: path.normalize(config),
    host,
    port: normalizePort(port),
    token: token || randomBytes(24).toString('hex'),
    enabled: enabled !== false,
  };
}

export async function registerAgentProject(input, { root = defaultAgentRoot(), access = fs.access } = {}) {
  const state = await loadAgentState(root);
  const requestedId = sanitizeName(input?.id || input?.name || path.basename(path.dirname(input?.config || 'project')) || 'project');
  const existing = state.projects.find(item => item.id === requestedId);
  const project = normalizeProjectRegistration({ ...input, token: input?.token || existing?.token });
  await access(project.config);
  const duplicatePort = state.projects.find(item => item.id !== project.id && item.port === project.port && item.enabled !== false);
  if (duplicatePort) throw new Error(`port ${project.port} is already used by project ${duplicatePort.id}`);
  const index = state.projects.findIndex(item => item.id === project.id);
  if (index >= 0) state.projects[index] = { ...state.projects[index], ...project };
  else state.projects.push(project);
  await saveAgentState(state, root);
  return project;
}

export async function unregisterAgentProject(projectId, { root = defaultAgentRoot() } = {}) {
  const id = sanitizeName(projectId);
  const state = await loadAgentState(root);
  const before = state.projects.length;
  state.projects = state.projects.filter(project => project.id !== id);
  if (state.projects.length === before) throw new Error(`Unknown agent project: ${id}`);
  await saveAgentState(state, root);
  return id;
}

export async function setAgentAutoUpdate(enabled, { root = defaultAgentRoot() } = {}) {
  const state = await loadAgentState(root);
  state.autoUpdate = Boolean(enabled);
  await saveAgentState(state, root);
  return state.autoUpdate;
}
