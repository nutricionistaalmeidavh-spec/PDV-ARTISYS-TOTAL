#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';
import { defaultAgentRoot, loadAgentState, registerAgentProject, unregisterAgentProject, setAgentAutoUpdate, ensureAgentConsoleConfiguration, setAgentConsoleLan, configureAgentCloud } from './agent-state.js';
import { readAgentHealth, startAgentSupervisor } from './agent-supervisor.js';
import { checkForStableUpdate } from './agent-updater.js';
import { bridgePollOnce, configureBridgeDrive, ensureBridgeConfiguration, DEFAULT_DRIVE_ROOT_FOLDER_ID } from './bridge-worker.js';
import { assertRcloneRemote, ensureDriveProjectFolder } from './drive-uploader.js';

function parseArgs(argv) {
  const [command = 'status', ...rest] = argv;
  const args = { command, positional: [] };
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      args.positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    args[key] = value;
  }
  return args;
}

function usage() {
  console.log(`ArtiSys QA Agent\n\nCommands:\n  artisys-qa-agent register --config C:\\projeto\\qa\\artisys-qa.config.json [--name Sistema] [--port 4173]\n  artisys-qa-agent unregister --project sistema\n  artisys-qa-agent list\n  artisys-qa-agent token --project sistema\n  artisys-qa-agent status\n  artisys-qa-agent bridge status|poll\n  artisys-qa-agent drive status\n  artisys-qa-agent drive enable [--remote artisys-qa-drive] [--root-folder-id ${DEFAULT_DRIVE_ROOT_FOLDER_ID}]\n  artisys-qa-agent drive disable\n  artisys-qa-agent console status\n  artisys-qa-agent console token\n  artisys-qa-agent console lan on|off\n  artisys-qa-agent cloud status\n  artisys-qa-agent cloud enable --url https://SEU-WORKER.workers.dev\n  artisys-qa-agent cloud disable\n  artisys-qa-agent autoupdate on|off\n  artisys-qa-agent check-update\n  artisys-qa-agent run\n\nCloud agent auth is read from ARTISYS_QA_CLOUD_AGENT_TOKEN and is never printed by status commands.`);
}

function safeProject(project) {
  return {
    id: project.id,
    name: project.name,
    config: project.config,
    host: project.host,
    port: project.port,
    enabled: project.enabled !== false,
    url: `http://127.0.0.1:${project.port}`,
  };
}

function consoleUrls(consoleState) {
  const port = Number(consoleState.port || 4160);
  if (!consoleState.lanEnabled) return [`http://127.0.0.1:${port}`];
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family !== 'IPv4' || entry.internal) continue;
      urls.push(`http://${entry.address}:${port}`);
    }
  }
  return [...new Set(urls)];
}

function safeConsole(consoleState) {
  return {
    enabled: consoleState.enabled !== false,
    lanEnabled: consoleState.lanEnabled === true,
    host: consoleState.host,
    port: consoleState.port,
    urls: consoleUrls(consoleState),
  };
}

function safeCloud(cloudState, health = null) {
  return {
    enabled: cloudState?.enabled === true,
    endpoint: cloudState?.endpoint || null,
    tokenConfigured: Boolean(process.env.ARTISYS_QA_CLOUD_AGENT_TOKEN),
    runtime: health?.cloud?.runtime || null,
  };
}

async function nextPort(root) {
  const state = await loadAgentState(root);
  const used = new Set(state.projects.map(project => Number(project.port)));
  let port = 4173;
  while (used.has(port) && port < 65535) port += 1;
  if (port > 65535) throw new Error('No free agent port available');
  return port;
}

function requestedProject(args) {
  return args.project && args.project !== true ? String(args.project) : args.positional[0];
}

async function restartRunningAgent(root) {
  const health = await readAgentHealth(root).catch(() => null);
  const pid = Number(health?.pid);
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return false;
  try {
    process.kill(pid, 'SIGTERM');
    return true;
  } catch {
    return false;
  }
}

const args = parseArgs(process.argv.slice(2));
const root = args.root ? path.resolve(String(args.root)) : defaultAgentRoot();

if (args.help || args.command === 'help') {
  usage();
  process.exit(0);
}

try {
  if (args.command === 'register') {
    if (!args.config || args.config === true) throw new Error('register requires --config');
    const config = path.resolve(String(args.config));
    const port = args.port && args.port !== true ? Number(args.port) : await nextPort(root);
    const project = await registerAgentProject({
      config,
      name: args.name && args.name !== true ? String(args.name) : undefined,
      id: args.id && args.id !== true ? String(args.id) : undefined,
      host: args.host && args.host !== true ? String(args.host) : '0.0.0.0',
      port,
    }, { root });
    const state = await ensureBridgeConfiguration(root);
    const driveFolder = state.bridge.drive.enabled
      ? await ensureDriveProjectFolder(project, state.bridge.drive)
      : { created: false, reason: 'drive-disabled' };
    console.log(JSON.stringify({ ...safeProject(project), token: project.token, driveFolder }, null, 2));
    console.log('Project registered. The running agent will pick it up automatically.');
  } else if (args.command === 'unregister') {
    const project = requestedProject(args);
    if (!project) throw new Error('unregister requires --project <id>');
    const id = await unregisterAgentProject(project, { root });
    console.log(`unregistered ${id}`);
  } else if (args.command === 'list') {
    const state = await loadAgentState(root);
    console.log(JSON.stringify(state.projects.map(safeProject), null, 2));
  } else if (args.command === 'token') {
    const projectId = requestedProject(args);
    if (!projectId) throw new Error('token requires --project <id>');
    const state = await loadAgentState(root);
    const project = state.projects.find(item => item.id === projectId || item.name === projectId);
    if (!project) throw new Error(`Unknown agent project: ${projectId}`);
    console.log(JSON.stringify({ ...safeProject(project), token: project.token }, null, 2));
  } else if (args.command === 'status') {
    const state = await ensureBridgeConfiguration(root);
    const consoleState = (await ensureAgentConsoleConfiguration(root)).console;
    const fresh = await loadAgentState(root);
    const health = await readAgentHealth(root);
    console.log(JSON.stringify({
      root,
      autoUpdate: state.autoUpdate,
      activeSlot: state.activeSlot,
      previousSlot: state.previousSlot,
      lastUpdateCheckAt: state.lastUpdateCheckAt,
      lastUpdateResult: state.lastUpdateResult,
      bridge: state.bridge,
      console: safeConsole(consoleState),
      cloud: safeCloud(fresh.cloud, health),
      projects: fresh.projects.map(safeProject),
      health,
    }, null, 2));
  } else if (args.command === 'bridge') {
    const operation = String(args.positional[0] || 'status').toLowerCase();
    const state = await ensureBridgeConfiguration(root);
    if (operation === 'status') {
      console.log(JSON.stringify(state.bridge, null, 2));
    } else if (operation === 'poll') {
      console.log(JSON.stringify(await bridgePollOnce({ root }), null, 2));
    } else {
      throw new Error('bridge requires status or poll');
    }
  } else if (args.command === 'drive') {
    const operation = String(args.positional[0] || 'status').toLowerCase();
    const state = await ensureBridgeConfiguration(root);
    if (operation === 'status') {
      let available = false;
      let error = null;
      try {
        await assertRcloneRemote(state.bridge.drive.remote);
        available = true;
      } catch (driveError) {
        error = driveError.message;
      }
      console.log(JSON.stringify({ ...state.bridge.drive, available, error }, null, 2));
    } else if (operation === 'enable') {
      const drive = await configureBridgeDrive({
        enabled: true,
        remote: args.remote && args.remote !== true ? String(args.remote) : state.bridge.drive.remote,
        rootFolderId: args['root-folder-id'] && args['root-folder-id'] !== true ? String(args['root-folder-id']) : state.bridge.drive.rootFolderId,
      }, root);
      await assertRcloneRemote(drive.remote);
      const folders = [];
      for (const project of state.projects.filter(item => item.enabled !== false)) {
        folders.push(await ensureDriveProjectFolder(project, drive));
      }
      console.log(JSON.stringify({ ...drive, projectFolders: folders }, null, 2));
    } else if (operation === 'disable') {
      console.log(JSON.stringify(await configureBridgeDrive({ enabled: false }, root), null, 2));
    } else {
      throw new Error('drive requires status, enable or disable');
    }
  } else if (args.command === 'console') {
    const operation = String(args.positional[0] || 'status').toLowerCase();
    const state = await ensureAgentConsoleConfiguration(root);
    if (operation === 'status') {
      console.log(JSON.stringify(safeConsole(state.console), null, 2));
    } else if (operation === 'token') {
      console.log(JSON.stringify({ token: state.console.token, urls: consoleUrls(state.console) }, null, 2));
    } else if (operation === 'lan') {
      const value = String(args.positional[1] || '').toLowerCase();
      if (!['on', 'off'].includes(value)) throw new Error('console lan requires on or off');
      const configured = await setAgentConsoleLan(value === 'on', { root });
      console.log(JSON.stringify(safeConsole(configured), null, 2));
      console.log('The running agent will apply the new console binding automatically within a few seconds.');
    } else {
      throw new Error('console requires status, token, or lan on|off');
    }
  } else if (args.command === 'cloud') {
    const operation = String(args.positional[0] || 'status').toLowerCase();
    const state = await loadAgentState(root);
    const health = await readAgentHealth(root).catch(() => null);
    if (operation === 'status') {
      console.log(JSON.stringify(safeCloud(state.cloud, health), null, 2));
    } else if (operation === 'enable') {
      if (!args.url || args.url === true) throw new Error('cloud enable requires --url https://worker.example.workers.dev');
      const configured = await configureAgentCloud({ enabled: true, endpoint: String(args.url) }, { root });
      console.log(JSON.stringify(safeCloud(configured), null, 2));
      if (!process.env.ARTISYS_QA_CLOUD_AGENT_TOKEN) {
        console.log('Warning: ARTISYS_QA_CLOUD_AGENT_TOKEN is not configured yet. Cloud mirroring will remain inactive until the agent process can read it.');
      }
      console.log('Restart the agent after setting the token so cloud mirroring is initialized.');
    } else if (operation === 'disable') {
      const configured = await configureAgentCloud({ enabled: false }, { root });
      console.log(JSON.stringify(safeCloud(configured), null, 2));
    } else {
      throw new Error('cloud requires status, enable --url <https-url>, or disable');
    }
  } else if (args.command === 'autoupdate') {
    const value = String(args.positional[0] || '').toLowerCase();
    if (!['on', 'off'].includes(value)) throw new Error('autoupdate requires on or off');
    const enabled = await setAgentAutoUpdate(value === 'on', { root });
    console.log(`autoUpdate=${enabled}`);
  } else if (args.command === 'check-update') {
    const result = await checkForStableUpdate({ root });
    const restarted = result.updated ? await restartRunningAgent(root) : false;
    console.log(JSON.stringify({ ...result, restarted, error: result.error?.message || null }, null, 2));
    process.exit(result.reason === 'failed' ? 1 : 0);
  } else if (args.command === 'run') {
    await startAgentSupervisor({ root });
    await new Promise(() => {});
  } else {
    usage();
    throw new Error(`Unknown agent command: ${args.command}`);
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
