import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadAgentState, defaultAgentRoot, ensureAgentConsoleConfiguration } from './agent-state.js';
import { checkForStableUpdate, AGENT_RESTART_EXIT_CODE } from './agent-updater.js';
import { startBridgePolling, ensureBridgeConfiguration } from './bridge-worker.js';
import { createTelemetryStore } from './telemetry-store.js';
import { createAgentConsole } from './agent-console.js';
import { createCloudTelemetryMirror, createTelemetryFanout } from './cloud-observability.js';
import { redactSecrets } from './redaction.js';

const MODULE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI_FILE = path.join(MODULE_DIR, 'src', 'cli.mjs');

export function agentHealthFile(root = defaultAgentRoot()) {
  return path.join(root, 'agent-health.json');
}

export function buildProjectRemoteCommand(project, { node = process.execPath, cliFile = CLI_FILE, root = defaultAgentRoot() } = {}) {
  if (!project?.config) throw new TypeError('project config is required');
  return {
    command: node,
    args: [
      cliFile,
      'remote',
      '--config', project.config,
      '--host', project.host || '0.0.0.0',
      '--port', String(project.port),
      '--token', project.token,
      '--output', path.join(root, 'artifacts', project.id),
    ],
  };
}

function projectSignature(project) {
  return JSON.stringify({
    config: project.config,
    host: project.host || '0.0.0.0',
    port: Number(project.port),
    token: project.token,
    enabled: project.enabled !== false,
  });
}

function consoleSignature(state) {
  return JSON.stringify({
    enabled: state.console?.enabled !== false,
    lanEnabled: state.console?.lanEnabled === true,
    host: state.console?.host || '127.0.0.1',
    port: Number(state.console?.port || 4160),
    token: state.console?.token || null,
  });
}

function environmentSecrets(env = process.env) {
  const secretName = /(TOKEN|SECRET|PASSWORD|PASS|API[_-]?KEY|CREDENTIAL|AUTH)/i;
  return [...new Set(Object.entries(env)
    .filter(([key, value]) => secretName.test(key) && typeof value === 'string' && value.length >= 4)
    .map(([, value]) => value))];
}

export async function writeAgentHealth(health, root = defaultAgentRoot()) {
  await fs.mkdir(root, { recursive: true });
  const file = agentHealthFile(root);
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(health, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
  return file;
}

export async function readAgentHealth(root = defaultAgentRoot()) {
  try {
    return JSON.parse((await fs.readFile(agentHealthFile(root), 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

export async function startAgentSupervisor({
  root = defaultAgentRoot(),
  spawnProcess = spawn,
  checkUpdate = checkForStableUpdate,
  reconcileIntervalMs = 10_000,
  initialUpdateDelayMs = 15_000,
  heartbeatIntervalMs = 2_000,
  stallThresholdMs = 60_000,
  telemetryFactory = options => createTelemetryStore(options),
  consoleFactory = options => createAgentConsole(options),
  cloudFactory = options => createCloudTelemetryMirror(options),
  bridgeStarter = options => startBridgePolling(options),
  exit = code => process.exit(code),
  logger = console,
} = {}) {
  const children = new Map();
  const desired = new Map();
  const restartTimers = new Map();
  let stopping = false;
  let updating = false;
  let reconcileTimer = null;
  let updateTimer = null;
  let initialUpdateTimer = null;
  let heartbeatTimer = null;
  let bridgeControl = null;
  let consoleControl = null;
  let consoleInfo = null;
  let activeConsoleSignature = null;
  let telemetry = null;
  let localTelemetry = null;
  let cloudMirror = null;
  let version = 'unknown';
  try {
    const pkg = JSON.parse((await fs.readFile(path.join(MODULE_DIR, 'package.json'), 'utf8')).replace(/^\uFEFF/, ''));
    version = pkg.version || version;
  } catch {}

  function clearRestart(id) {
    const timer = restartTimers.get(id);
    if (timer) clearTimeout(timer);
    restartTimers.delete(id);
  }

  function stopProject(id) {
    clearRestart(id);
    const entry = children.get(id);
    children.delete(id);
    const child = entry?.child;
    if (child && child.exitCode == null && !child.killed) child.kill();
  }

  function scheduleRestart(id) {
    if (stopping || !desired.has(id) || restartTimers.has(id)) return;
    const timer = setTimeout(() => {
      restartTimers.delete(id);
      const project = desired.get(id);
      if (project) startProject(project);
    }, 3000);
    restartTimers.set(id, timer);
  }

  function startProject(project) {
    if (stopping || project.enabled === false) return;
    const signature = projectSignature(project);
    const current = children.get(project.id);
    if (current?.signature === signature) return;
    if (current) stopProject(project.id);
    clearRestart(project.id);

    const { command, args } = buildProjectRemoteCommand(project, { root });
    const child = spawnProcess(command, args, {
      cwd: path.dirname(project.config),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    children.set(project.id, { child, signature });
    child.stdout?.on('data', chunk => logger.log(`[${project.id}] ${String(chunk).trimEnd()}`));
    child.stderr?.on('data', chunk => logger.error(`[${project.id}] ${String(chunk).trimEnd()}`));

    let settled = false;
    const finish = error => {
      if (settled) return;
      settled = true;
      const currentEntry = children.get(project.id);
      if (currentEntry?.child === child) children.delete(project.id);
      if (error) logger.error(`[${project.id}] ${error.message}`);
      scheduleRestart(project.id);
    };
    child.once('error', finish);
    child.once('exit', () => finish());
  }

  async function consoleAgentState() {
    const state = await loadAgentState(root);
    return {
      ...state,
      cloud: state.cloud ? { ...state.cloud, tokenConfigured: Boolean(process.env.ARTISYS_QA_CLOUD_AGENT_TOKEN) } : null,
      projects: state.projects.map(project => ({ ...project, running: children.has(project.id) })),
    };
  }

  async function agentInfo() {
    const state = await loadAgentState(root);
    return {
      status: stopping ? 'stopping' : 'running',
      pid: process.pid,
      version,
      machineId: state.bridge?.machineId || null,
      autoUpdate: state.autoUpdate,
      bridge: state.bridge ? {
        enabled: state.bridge.enabled !== false,
        pollIntervalSeconds: state.bridge.pollIntervalSeconds || 20,
      } : null,
      drive: state.bridge?.drive ? {
        enabled: state.bridge.drive.enabled === true,
        remote: state.bridge.drive.remote || null,
        rootFolderId: state.bridge.drive.rootFolderId || null,
      } : null,
      cloud: state.cloud ? {
        enabled: state.cloud.enabled === true,
        endpoint: state.cloud.endpoint || null,
        tokenConfigured: Boolean(process.env.ARTISYS_QA_CLOUD_AGENT_TOKEN),
        runtime: cloudMirror?.status?.() || null,
      } : null,
      console: consoleInfo ? { host: consoleInfo.host, port: consoleInfo.port } : null,
    };
  }

  async function refreshConsole(state) {
    if (!telemetry) return;
    const nextSignature = consoleSignature(state);
    if (activeConsoleSignature === nextSignature) return;
    if (consoleControl) {
      await consoleControl.close().catch(error => logger.error(`[console] ${error.message}`));
      consoleControl = null;
      consoleInfo = null;
    }
    activeConsoleSignature = nextSignature;
    if (state.console?.enabled === false) return;
    try {
      consoleControl = consoleFactory({
        host: state.console?.host || '127.0.0.1',
        port: Number(state.console?.port || 4160),
        token: state.console?.token,
        telemetry,
        agentState: consoleAgentState,
        artifactRoot: path.join(root, 'artifacts'),
        lanEnabled: state.console?.lanEnabled === true,
        agentInfo,
      });
      consoleInfo = await consoleControl.start();
    } catch (error) {
      consoleControl = null;
      consoleInfo = null;
      logger.error(`[console] ${error.message}`);
    }
  }

  async function reconcile() {
    const state = await loadAgentState(root);
    desired.clear();
    for (const project of state.projects.filter(item => item.enabled !== false)) desired.set(project.id, project);

    for (const [id, entry] of children) {
      const next = desired.get(id);
      if (!next || entry.signature !== projectSignature(next)) stopProject(id);
    }
    for (const project of desired.values()) startProject(project);
    await refreshConsole(state);

    await writeAgentHealth({
      status: 'running',
      pid: process.pid,
      version,
      updatedAt: new Date().toISOString(),
      autoUpdate: state.autoUpdate,
      bridge: state.bridge ? {
        enabled: state.bridge.enabled !== false,
        machineId: state.bridge.machineId || null,
        pollIntervalSeconds: state.bridge.pollIntervalSeconds || 20,
        drive: state.bridge.drive ? {
          enabled: state.bridge.drive.enabled === true,
          remote: state.bridge.drive.remote || null,
          rootFolderId: state.bridge.drive.rootFolderId || null,
        } : null,
      } : null,
      cloud: state.cloud ? {
        enabled: state.cloud.enabled === true,
        endpoint: state.cloud.endpoint || null,
        tokenConfigured: Boolean(process.env.ARTISYS_QA_CLOUD_AGENT_TOKEN),
        runtime: cloudMirror?.status?.() || null,
      } : null,
      console: state.console ? {
        enabled: state.console.enabled !== false,
        lanEnabled: state.console.lanEnabled === true,
        host: state.console.host || '127.0.0.1',
        port: Number(state.console.port || 4160),
        running: Boolean(consoleInfo),
      } : null,
      projects: state.projects.map(project => ({
        id: project.id,
        name: project.name,
        port: project.port,
        enabled: project.enabled !== false,
        running: children.has(project.id),
      })),
    }, root);
    return state;
  }

  async function updateCycle() {
    if (stopping || updating) return { updated: false, reason: stopping ? 'stopping' : 'busy' };
    updating = true;
    try {
      const result = await checkUpdate({ root });
      if (result.updated) {
        await writeAgentHealth({ status: 'restarting-for-update', pid: process.pid, version, result, updatedAt: new Date().toISOString() }, root);
        await stop();
        exit(AGENT_RESTART_EXIT_CODE);
      }
      return result;
    } finally {
      updating = false;
    }
  }

  async function heartbeatCycle() {
    if (!telemetry || stopping) return;
    try {
      const snapshot = await telemetry.getSnapshot();
      const current = snapshot?.currentJob;
      if (current?.updatedAt && Number(stallThresholdMs) > 0) {
        const age = Date.now() - Date.parse(current.updatedAt);
        if (Number.isFinite(age) && age > Number(stallThresholdMs)) {
          await telemetry.transition({
            jobId: current.jobId,
            projectId: current.projectId,
            stage: 'STALLED',
            detail: `Sem atividade de QA por ${Math.round(age / 1000)}s`,
          }).catch(() => {});
        }
      }
      await telemetry.heartbeat().catch(() => {});
    } catch (error) {
      logger.error(`[telemetry] ${error.message}`);
    }
  }

  async function stop() {
    if (stopping) return;
    stopping = true;
    if (reconcileTimer) clearInterval(reconcileTimer);
    if (updateTimer) clearInterval(updateTimer);
    if (initialUpdateTimer) clearTimeout(initialUpdateTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    bridgeControl?.stop();
    for (const id of [...restartTimers.keys()]) clearRestart(id);
    desired.clear();
    for (const id of [...children.keys()]) stopProject(id);
    if (consoleControl) await consoleControl.close().catch(error => logger.error(`[console] ${error.message}`));
    consoleControl = null;
    consoleInfo = null;
    activeConsoleSignature = null;
    await writeAgentHealth({ status: 'stopped', pid: process.pid, version, updatedAt: new Date().toISOString() }, root).catch(() => {});
  }

  const bridgeState = await ensureBridgeConfiguration(root);
  const configuredState = await ensureAgentConsoleConfiguration(root);
  const secrets = environmentSecrets();
  localTelemetry = telemetryFactory({
    root,
    machineId: bridgeState.bridge.machineId,
    redact: value => redactSecrets(value, secrets),
  });

  if (configuredState.cloud?.enabled === true && configuredState.cloud.endpoint) {
    const token = process.env.ARTISYS_QA_CLOUD_AGENT_TOKEN;
    if (token) {
      try {
        cloudMirror = cloudFactory({
          endpoint: configuredState.cloud.endpoint,
          token,
          machineId: bridgeState.bridge.machineId,
          machineName: bridgeState.bridge.machineId,
          version,
        });
      } catch (error) {
        logger.error(`[cloud] ${error.message}`);
      }
    } else {
      logger.error('[cloud] ARTISYS_QA_CLOUD_AGENT_TOKEN is not configured; cloud mirroring remains disabled');
    }
  }

  telemetry = createTelemetryFanout(localTelemetry, cloudMirror ? [cloudMirror] : [], { logger });
  await telemetry.recoverInterruptedJob().catch(error => logger.error(`[telemetry] recovery: ${error.message}`));
  await telemetry.heartbeat({ stage: 'IDLE', detail: 'Agente iniciado' }).catch(() => {});

  const state = await reconcile();
  const intervalMs = Math.max(1, Number(state.updateIntervalMinutes || 1)) * 60_000;
  reconcileTimer = setInterval(() => { void reconcile().catch(error => logger.error(error)); }, reconcileIntervalMs);
  updateTimer = setInterval(() => { void updateCycle().catch(error => logger.error(error)); }, intervalMs);
  initialUpdateTimer = setTimeout(() => { void updateCycle().catch(error => logger.error(error)); }, Math.max(1000, initialUpdateDelayMs));
  heartbeatTimer = setInterval(() => { void heartbeatCycle(); }, Math.max(10, Number(heartbeatIntervalMs) || 2000));
  bridgeControl = bridgeStarter({ root, logger, telemetry });

  const shutdown = () => { void stop().finally(() => exit(0)); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  return { stop, reconcile, updateCycle, heartbeatCycle, children, bridgeControl, telemetry, localTelemetry, cloudMirror, consoleControl };
}
