import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadAgentState, saveAgentState, defaultAgentRoot } from './agent-state.js';

const execFileAsync = promisify(execFile);
export const AGENT_RESTART_EXIT_CODE = 75;

function npmCommand() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

export function compareVersions(a, b) {
  const parse = value => String(value || '')
    .replace(/^v/i, '')
    .split('.')
    .map(part => {
      const match = String(part).match(/^\d+/);
      return match ? Number(match[0]) : 0;
    });
  const av = parse(a);
  const bv = parse(b);
  for (let i = 0; i < Math.max(av.length, bv.length, 3); i++) {
    const left = av[i] || 0;
    const right = bv[i] || 0;
    if (left < right) return -1;
    if (left > right) return 1;
  }
  return 0;
}

export function isNewerVersion(candidate, current) {
  return compareVersions(candidate, current) > 0;
}

function quoteWindowsCmdArg(value) {
  const text = String(value);
  if (!/[\s&()^|<>\"]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function normalizeWindowsCommand(command, args = [], platform = process.platform, env = process.env) {
  if (platform !== 'win32' || !/\.(?:cmd|bat)$/i.test(String(command))) {
    return { command, args };
  }
  const comspec = env.ComSpec || env.COMSPEC || 'cmd.exe';
  const commandLine = [command, ...args].map(quoteWindowsCmdArg).join(' ');
  return { command: comspec, args: ['/d', '/s', '/c', commandLine] };
}

export async function runCommand(command, args, { cwd, env = process.env, timeout = 10 * 60_000 } = {}) {
  const normalized = normalizeWindowsCommand(command, args, process.platform, env);
  const result = await execFileAsync(normalized.command, normalized.args, {
    cwd,
    env,
    timeout,
    windowsHide: true,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout: result.stdout || '', stderr: result.stderr || '' };
}

async function readJson(file) {
  return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
}

export async function readStableChannel(repoDir, remoteRef = 'FETCH_HEAD', { run = runCommand } = {}) {
  const { stdout } = await run('git', ['-C', repoDir, 'show', `${remoteRef}:modules/artisys-qa/stable-channel.json`]);
  const channel = JSON.parse(String(stdout).replace(/^\uFEFF/, ''));
  if (channel.channel !== 'stable') throw new Error('stable-channel.json must declare channel=stable');
  if (!/^\d+\.\d+\.\d+$/.test(channel.version || '')) throw new Error('stable channel requires a release semantic version (x.y.z)');
  return channel;
}

export async function readInstalledVersion(slotDir) {
  const pkg = await readJson(path.join(slotDir, 'modules', 'artisys-qa', 'package.json'));
  return pkg.version;
}

export function inactiveSlotName(activeSlot) {
  return activeSlot === 'slot-b' ? 'slot-a' : 'slot-b';
}

export async function validateCandidate(slotDir, { run = runCommand } = {}) {
  const moduleDir = path.join(slotDir, 'modules', 'artisys-qa');
  const npm = npmCommand();
  await run(npm, ['ci'], { cwd: moduleDir });
  await run(npm, ['test'], { cwd: moduleDir });
  await run(npm, ['run', 'check'], { cwd: moduleDir });
  return true;
}

export async function prepareInactiveSlot({ repository, candidateSha, slotDir, run = runCommand }) {
  await fs.rm(slotDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(slotDir), { recursive: true });
  await run('git', ['clone', '--no-checkout', repository, slotDir], { timeout: 10 * 60_000 });
  await run('git', ['-C', slotDir, 'checkout', '--detach', candidateSha], { timeout: 2 * 60_000 });
  await validateCandidate(slotDir, { run });
  return slotDir;
}

export async function checkForStableUpdate({ root = defaultAgentRoot(), run = runCommand, now = () => new Date().toISOString() } = {}) {
  const state = await loadAgentState(root);
  if (!state.autoUpdate) return { updated: false, reason: 'disabled' };
  const activeSlot = state.activeSlot || 'slot-a';
  const activeDir = path.join(root, 'slots', activeSlot);
  const currentVersion = await readInstalledVersion(activeDir);
  const stableRef = state.stableRef || 'main';

  try {
    await run('git', ['-C', activeDir, 'fetch', '--quiet', 'origin', stableRef], { timeout: 2 * 60_000 });
    const remoteRef = 'FETCH_HEAD';
    const channel = await readStableChannel(activeDir, remoteRef, { run });
    const checkedAt = now();

    if (!isNewerVersion(channel.version, currentVersion)) {
      const latest = await loadAgentState(root);
      latest.lastUpdateCheckAt = checkedAt;
      latest.lastUpdateResult = { status: 'current', currentVersion, stableVersion: channel.version };
      await saveAgentState(latest, root);
      return { updated: false, reason: 'current', currentVersion, stableVersion: channel.version };
    }

    const { stdout } = await run('git', ['-C', activeDir, 'rev-parse', remoteRef]);
    const candidateSha = stdout.trim();
    if (!/^[a-f0-9]{40}$/i.test(candidateSha)) throw new Error('Could not resolve stable candidate commit');

    const nextSlot = inactiveSlotName(activeSlot);
    const nextDir = path.join(root, 'slots', nextSlot);
    await prepareInactiveSlot({ repository: state.repository, candidateSha, slotDir: nextDir, run });
    const candidateVersion = await readInstalledVersion(nextDir);
    if (candidateVersion !== channel.version) {
      throw new Error(`Stable channel version ${channel.version} does not match candidate package version ${candidateVersion}`);
    }

    const latest = await loadAgentState(root);
    const nextState = {
      ...latest,
      previousSlot: activeSlot,
      activeSlot: nextSlot,
      lastUpdateCheckAt: checkedAt,
      lastUpdateResult: {
        status: 'activated',
        fromVersion: currentVersion,
        toVersion: channel.version,
        candidateSha,
        activatedAt: now(),
      },
    };
    await saveAgentState(nextState, root);
    return { updated: true, fromVersion: currentVersion, toVersion: channel.version, candidateSha, activeSlot: nextSlot };
  } catch (error) {
    const latest = await loadAgentState(root).catch(() => state);
    const failureState = {
      ...latest,
      activeSlot,
      lastUpdateCheckAt: now(),
      lastUpdateResult: { status: 'failed', error: error?.message || String(error), currentVersion },
    };
    await saveAgentState(failureState, root).catch(() => {});
    return { updated: false, reason: 'failed', error };
  }
}

export async function rollbackAgentSlot({ root = defaultAgentRoot(), reason = 'health check failed' } = {}) {
  const state = await loadAgentState(root);
  if (!state.previousSlot || state.previousSlot === state.activeSlot) return false;
  const failedSlot = state.activeSlot;
  state.activeSlot = state.previousSlot;
  state.previousSlot = failedSlot;
  state.lastUpdateResult = {
    status: 'rolled-back',
    failedSlot,
    activeSlot: state.activeSlot,
    reason,
    rolledBackAt: new Date().toISOString(),
  };
  await saveAgentState(state, root);
  return true;
}
