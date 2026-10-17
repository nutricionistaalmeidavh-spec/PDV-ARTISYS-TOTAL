import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultAgentRoot, loadAgentState, registerAgentProject, saveAgentState } from './agent-state.js';
import { runCommand } from './agent-updater.js';
import { sanitizeName } from './helpers.js';

const execFileAsync = promisify(execFile);

export const PROJECT_REGISTRY_PATH = 'modules/artisys-qa/bridge/projects.json';
const PROJECT_REGISTRY_REMOTE_REF = 'refs/remotes/origin/artisys-project-registry';
const MANAGED_PROJECT_REMOTE_REF = 'refs/remotes/origin/artisys-managed';
const ALLOWED_SETUP = new Set(['none', 'npm-ci', 'npm-install', 'dotnet-restore', 'pip-requirements']);
const ALLOWED_REPOSITORY = /^https:\/\/github\.com\/nutricionistaalmeidavh-spec\/([A-Za-z0-9._-]+?)(?:\.git)?$/i;

async function heartbeat(telemetry, payload) {
  try { await telemetry?.heartbeat(payload); } catch {}
}

export function managedProjectsRoot(root = defaultAgentRoot()) {
  return path.join(root, 'projects');
}

export function normalizeManagedProject(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new TypeError('managed project must be an object');
  const id = sanitizeName(input.id || input.name || '');
  if (!id) throw new Error('managed project id is required');
  const repository = String(input.repository || '');
  const match = repository.match(ALLOWED_REPOSITORY);
  if (!match) throw new Error(`managed project repository is not allowed: ${repository || '<empty>'}`);
  const normalizedRepository = `https://github.com/nutricionistaalmeidavh-spec/${match[1]}.git`;
  const ref = String(input.ref || 'main');
  if (!/^[A-Za-z0-9._\/-]{1,120}$/.test(ref) || ref.includes('..') || ref.startsWith('/')) throw new Error(`invalid managed project ref: ${ref}`);
  const configPath = String(input.configPath || 'qa/artisys-qa.config.json').replace(/\\/g, '/');
  const parts = configPath.split('/').filter(Boolean);
  if (!parts.length || path.posix.isAbsolute(configPath) || parts.includes('..')) throw new Error(`invalid managed project configPath: ${configPath}`);
  const setup = String(input.setup || 'none');
  if (!ALLOWED_SETUP.has(setup)) throw new Error(`unsupported managed project setup: ${setup}`);
  return {
    id,
    name: String(input.name || id),
    repository: normalizedRepository,
    ref,
    configPath: parts.join('/'),
    setup,
    enabled: input.enabled !== false,
  };
}

async function git(repoDir, args) {
  const { stdout } = await execFileAsync('git', ['-C', repoDir, ...args], {
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return String(stdout || '');
}

export async function readManagedProjectRegistry({ controlRepoDir, ref = 'main' } = {}) {
  if (!controlRepoDir) throw new Error('controlRepoDir is required');
  const sourceRef = `refs/heads/${ref}`;
  await git(controlRepoDir, ['fetch', '--quiet', '--no-write-fetch-head', 'origin', `+${sourceRef}:${PROJECT_REGISTRY_REMOTE_REF}`]);
  const raw = await git(controlRepoDir, ['show', `${PROJECT_REGISTRY_REMOTE_REF}:${PROJECT_REGISTRY_PATH}`]);
  const parsed = JSON.parse(raw.replace(/^\uFEFF/, ''));
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.projects)) throw new Error('managed project registry must use schemaVersion=1 and projects[]');
  const projects = parsed.projects.map(normalizeManagedProject);
  const ids = new Set();
  for (const project of projects) {
    if (ids.has(project.id)) throw new Error(`duplicate managed project id: ${project.id}`);
    ids.add(project.id);
  }
  return projects;
}

async function ensureRepository(project, destination) {
  try {
    await fs.access(path.join(destination, '.git'));
    const currentOrigin = (await git(destination, ['remote', 'get-url', 'origin'])).trim().replace(/\.git$/i, '');
    const expectedOrigin = project.repository.replace(/\.git$/i, '');
    if (currentOrigin.toLowerCase() !== expectedOrigin.toLowerCase()) {
      throw new Error(`managed project ${project.id} has unexpected origin ${currentOrigin}`);
    }
  } catch (error) {
    if (!String(error?.message || '').includes('ENOENT') && error?.code !== 'ENOENT') throw error;
    await fs.rm(destination, { recursive: true, force: true });
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await execFileAsync('git', ['clone', '--no-checkout', project.repository, destination], {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
  }

  const branchRef = `refs/heads/${project.ref}`;
  await git(destination, ['fetch', '--quiet', '--no-write-fetch-head', 'origin', `+${branchRef}:${MANAGED_PROJECT_REMOTE_REF}`]);
  const sha = (await git(destination, ['rev-parse', MANAGED_PROJECT_REMOTE_REF])).trim();
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error(`could not resolve managed project ${project.id} ref ${project.ref}`);
  await git(destination, ['checkout', '--detach', '--force', sha]);
  return sha;
}

async function syncRepositorySubmodules(project, destination) {
  try {
    await fs.access(path.join(destination, '.gitmodules'));
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  await git(destination, ['submodule', 'sync', '--recursive']);
  await git(destination, ['submodule', 'update', '--init', '--recursive']);
  return true;
}

async function runSetup(project, destination) {
  if (project.setup === 'none') return;
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  if (project.setup === 'npm-ci') {
    await runCommand(npm, ['ci'], { cwd: destination });
    return;
  }
  if (project.setup === 'npm-install') {
    await runCommand(npm, ['install', '--no-audit', '--no-fund'], { cwd: destination });
    return;
  }
  if (project.setup === 'dotnet-restore') {
    await runCommand('dotnet', ['restore'], { cwd: destination });
    return;
  }
  if (project.setup === 'pip-requirements') {
    const python = process.platform === 'win32' ? 'py' : 'python3';
    await runCommand(python, ['-m', 'pip', 'install', '-r', 'requirements.txt'], { cwd: destination });
  }
}

function nextManagedPort(state, id) {
  const existing = state.projects.find(project => project.id === id);
  if (existing?.port) return Number(existing.port);
  const used = new Set(state.projects.filter(project => project.enabled !== false).map(project => Number(project.port)));
  let port = 4173;
  while (used.has(port) && port < 65535) port += 1;
  if (port > 65535) throw new Error('No free agent port available for managed project');
  return port;
}

export async function syncManagedProjects({ root = defaultAgentRoot(), controlRepoDir, ref = 'main', logger = console, telemetry = null } = {}) {
  const definitions = await readManagedProjectRegistry({ controlRepoDir, ref });
  await fs.mkdir(managedProjectsRoot(root), { recursive: true });
  const results = [];

  for (const definition of definitions.filter(project => project.enabled)) {
    let state = await loadAgentState(root);
    const existing = state.projects.find(project => project.id === definition.id);
    if (existing && existing.managedByRegistry !== true && !String(existing.config || '').startsWith(managedProjectsRoot(root))) {
      results.push({ id: definition.id, status: 'manual-existing', config: existing.config });
      continue;
    }

    const destination = path.join(managedProjectsRoot(root), definition.id);
    try {
      await heartbeat(telemetry, { stage: 'SYNCING_PROJECT', detail: `Sincronizando ${definition.name}`, projectId: definition.id });
      const sha = await ensureRepository(definition, destination);
      await syncRepositorySubmodules(definition, destination);
      const config = path.join(destination, ...definition.configPath.split('/'));
      await fs.access(config);
      if (!existing || existing.managedCommit !== sha || existing.managedSetup !== definition.setup) {
        await heartbeat(telemetry, { stage: 'INSTALLING_DEPENDENCIES', detail: `Preparando dependências de ${definition.name}`, projectId: definition.id });
        await runSetup(definition, destination);
      }
      await heartbeat(telemetry, { stage: 'REGISTERING_PROJECT', detail: `Registrando ${definition.name}`, projectId: definition.id });
      const port = nextManagedPort(state, definition.id);
      await registerAgentProject({
        id: definition.id,
        name: definition.name,
        config,
        host: '127.0.0.1',
        port,
        enabled: true,
      }, { root });
      state = await loadAgentState(root);
      const index = state.projects.findIndex(project => project.id === definition.id);
      state.projects[index] = {
        ...state.projects[index],
        managedByRegistry: true,
        managedRepository: definition.repository,
        managedRef: definition.ref,
        managedCommit: sha,
        managedSetup: definition.setup,
      };
      await saveAgentState(state, root);
      await heartbeat(telemetry, { stage: 'IDLE', detail: `${definition.name} pronto`, projectId: definition.id });
      results.push({ id: definition.id, status: existing?.managedCommit === sha ? 'current' : 'synced', commit: sha, config });
    } catch (error) {
      await heartbeat(telemetry, { stage: 'FAILED', detail: `Falha ao preparar ${definition.name}: ${error.message}`, projectId: definition.id });
      logger.error(`[projects] ${definition.id}: ${error.message}`);
      results.push({ id: definition.id, status: 'failed', error: error.message });
    }
  }

  const enabledIds = new Set(definitions.filter(project => project.enabled).map(project => project.id));
  const finalState = await loadAgentState(root);
  let changed = false;
  for (const project of finalState.projects) {
    if (project.managedByRegistry === true && !enabledIds.has(project.id) && project.enabled !== false) {
      project.enabled = false;
      changed = true;
      results.push({ id: project.id, status: 'disabled' });
    }
  }
  if (changed) await saveAgentState(finalState, root);

  return { registryCount: definitions.length, results };
}
