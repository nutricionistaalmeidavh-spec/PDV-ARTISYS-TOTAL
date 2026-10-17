import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { defaultAgentRoot } from './agent-state.js';

const execFileAsync = promisify(execFile);

export const BRIDGE_JOB_ROOT = 'modules/artisys-qa/bridge/jobs/pending';
export const ALLOWED_BRIDGE_ACTIONS = Object.freeze(['quick', 'full', 'release', 'prints', 'video']);
const ALLOWED_OPTION_KEYS = new Set(['environment', 'viewport', 'visual', 'flow', 'demo', 'preset']);
const BRIDGE_REMOTE_REF = 'refs/remotes/origin/artisys-bridge-poll';

export function processedJobsFile(root = defaultAgentRoot()) {
  return path.join(root, 'bridge-processed.json');
}

export function sanitizeJobOptions(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('job options must be an object');
  const clean = {};
  for (const [key, value] of Object.entries(options)) {
    if (!ALLOWED_OPTION_KEYS.has(key)) throw new Error(`Unsupported bridge option: ${key}`);
    if (value == null || value === '') continue;
    if (key === 'visual') {
      if (typeof value !== 'boolean') throw new TypeError('visual option must be boolean');
      if (value) clean.visual = true;
      continue;
    }
    if (typeof value !== 'string') throw new TypeError(`${key} option must be a string`);
    clean[key] = value;
  }
  if (clean.viewport && !['desktop', 'tablet', 'mobile'].includes(clean.viewport)) throw new Error(`Unsupported viewport: ${clean.viewport}`);
  return clean;
}

export function validateBridgeJob(job, { machineId, projects = [], now = Date.now() } = {}) {
  if (!job || typeof job !== 'object' || Array.isArray(job)) throw new TypeError('bridge job must be an object');
  if (!/^[A-Za-z0-9._-]{8,128}$/.test(String(job.id || ''))) throw new Error('bridge job id is invalid');
  if (!/^[A-Za-z0-9._-]{16,256}$/.test(String(job.nonce || ''))) throw new Error('bridge job nonce is invalid');
  if (!ALLOWED_BRIDGE_ACTIONS.includes(job.action)) throw new Error(`Unsupported bridge action: ${job.action}`);
  if (!job.projectId || typeof job.projectId !== 'string') throw new Error('bridge job projectId is required');
  if (!job.machineId || typeof job.machineId !== 'string') throw new Error('bridge job machineId is required');
  if (!projects.some(project => project.id === job.projectId && project.enabled !== false)) throw new Error(`Unknown or disabled bridge project: ${job.projectId}`);
  if (job.machineId !== '*' && machineId && job.machineId !== machineId) throw new Error('bridge job targets another machine');

  const requestedAt = Date.parse(job.requestedAt || '');
  const expiresAt = Date.parse(job.expiresAt || '');
  if (!Number.isFinite(requestedAt) || !Number.isFinite(expiresAt)) throw new Error('bridge job timestamps are invalid');
  if (expiresAt <= requestedAt) throw new Error('bridge job expiration is invalid');
  if (expiresAt - requestedAt > 30 * 60_000) throw new Error('bridge job TTL exceeds 30 minutes');
  if (now > expiresAt) throw new Error('bridge job expired');
  if (requestedAt - now > 5 * 60_000) throw new Error('bridge job requestedAt is too far in the future');

  return {
    id: String(job.id),
    nonce: String(job.nonce),
    machineId: job.machineId,
    projectId: String(job.projectId),
    action: job.action,
    requestedAt: new Date(requestedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    options: sanitizeJobOptions(job.options || {}),
  };
}

export async function loadProcessedJobs(root = defaultAgentRoot()) {
  try {
    const parsed = JSON.parse((await fs.readFile(processedJobsFile(root), 'utf8')).replace(/^\uFEFF/, ''));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

export async function markBridgeJobProcessed(jobId, result, root = defaultAgentRoot()) {
  await fs.mkdir(root, { recursive: true });
  const file = processedJobsFile(root);
  const processed = await loadProcessedJobs(root);
  processed[jobId] = { ...result, processedAt: new Date().toISOString() };
  const cutoff = Date.now() - 14 * 24 * 60 * 60_000;
  for (const [id, value] of Object.entries(processed)) {
    if (Date.parse(value?.processedAt || 0) < cutoff) delete processed[id];
  }
  const temporary = `${file}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(processed, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
  return processed[jobId];
}

async function git(repoDir, args) {
  const { stdout } = await execFileAsync('git', ['-C', repoDir, ...args], { windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

export async function listPendingBridgeJobs({ repoDir, ref = 'main', jobRoot = BRIDGE_JOB_ROOT } = {}) {
  if (!repoDir) throw new Error('repoDir is required');
  const sourceRef = `refs/heads/${ref}`;
  await git(repoDir, ['fetch', '--quiet', '--no-write-fetch-head', 'origin', `+${sourceRef}:${BRIDGE_REMOTE_REF}`]);
  let listing = '';
  try {
    listing = await git(repoDir, ['ls-tree', '-r', '--name-only', BRIDGE_REMOTE_REF, jobRoot]);
  } catch {
    return [];
  }
  const files = listing.split(/\r?\n/).map(value => value.trim()).filter(value => value.endsWith('.json'));
  const jobs = [];
  for (const file of files) {
    try {
      const raw = await git(repoDir, ['show', `${BRIDGE_REMOTE_REF}:${file}`]);
      jobs.push({ file, job: JSON.parse(raw.replace(/^\uFEFF/, '')) });
    } catch (error) {
      jobs.push({ file, error });
    }
  }
  return jobs;
}
