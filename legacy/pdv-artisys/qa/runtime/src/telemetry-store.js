import fs from 'node:fs/promises';
import path from 'node:path';

export const ACTIVE_JOB_STAGES = new Set([
  'QUEUED','SYNCING_PROJECT','INSTALLING_DEPENDENCIES','REGISTERING_PROJECT',
  'STARTING_QA','RUNNING_QA','CAPTURING_ARTIFACTS','GENERATING_REPORT','UPLOADING_ARTIFACTS'
]);

export const TERMINAL_JOB_STAGES = new Set([
  'PASSED','FAILED','EXPIRED','CANCELLED','STALLED','PENDING_UPLOAD','INTERRUPTED'
]);

export const JOB_STAGES = new Set(['IDLE', ...ACTIVE_JOB_STAGES, ...TERMINAL_JOB_STAGES]);

const TRANSITIONS = new Map([
  ['IDLE', new Set(['QUEUED'])],
  ['QUEUED', new Set(['SYNCING_PROJECT','STARTING_QA','EXPIRED','CANCELLED','FAILED'])],
  ['SYNCING_PROJECT', new Set(['INSTALLING_DEPENDENCIES','REGISTERING_PROJECT','FAILED','CANCELLED'])],
  ['INSTALLING_DEPENDENCIES', new Set(['REGISTERING_PROJECT','FAILED','CANCELLED'])],
  ['REGISTERING_PROJECT', new Set(['STARTING_QA','FAILED','CANCELLED'])],
  ['STARTING_QA', new Set(['RUNNING_QA','FAILED','CANCELLED'])],
  ['RUNNING_QA', new Set(['RUNNING_QA','CAPTURING_ARTIFACTS','GENERATING_REPORT','UPLOADING_ARTIFACTS','PASSED','FAILED','CANCELLED','STALLED'])],
  ['CAPTURING_ARTIFACTS', new Set(['CAPTURING_ARTIFACTS','RUNNING_QA','GENERATING_REPORT','UPLOADING_ARTIFACTS','FAILED','STALLED'])],
  ['GENERATING_REPORT', new Set(['UPLOADING_ARTIFACTS','PASSED','FAILED','STALLED'])],
  ['UPLOADING_ARTIFACTS', new Set(['PASSED','FAILED','PENDING_UPLOAD','STALLED'])],
  ['PENDING_UPLOAD', new Set(['UPLOADING_ARTIFACTS','PASSED','FAILED'])],
  ['STALLED', new Set(['RUNNING_QA','FAILED','INTERRUPTED'])],
]);

function iso(now) {
  const value = typeof now === 'function' ? now() : new Date();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function safeId(value, label) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(text)) throw new Error(`${label} is invalid`);
  return text;
}

function safeProgress(value) {
  if (value == null) return null;
  const current = Number(value.current);
  const total = Number(value.total);
  if (!Number.isFinite(current) || !Number.isFinite(total) || current < 0 || total < 0 || current > total) throw new Error('progress is invalid');
  return { current, total };
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error?.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function atomicJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temporary, file);
}

function inside(root, candidate) {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

export function createTelemetryStore({ root, machineId, redact = value => value, now = () => new Date(), maxEvents = 500 } = {}) {
  if (!root) throw new Error('telemetry root is required');
  if (!machineId) throw new Error('machineId is required');
  const telemetryRoot = path.join(root, 'telemetry');
  const currentFile = path.join(telemetryRoot, 'current.json');
  const eventsFile = path.join(telemetryRoot, 'events.ndjson');
  const jobsRoot = path.join(telemetryRoot, 'jobs');
  const artifactRoot = path.join(root, 'artifacts');
  let mutationQueue = Promise.resolve();

  function serializeMutation(operation) {
    const run = mutationQueue.then(operation, operation);
    mutationQueue = run.catch(() => {});
    return run;
  }

  const baseSnapshot = () => ({
    schemaVersion: 1,
    machineId,
    updatedAt: iso(now),
    heartbeatAt: null,
    currentJob: null,
    lastJob: null,
    artifacts: [],
    agent: { stage: 'IDLE', detail: null, projectId: null, updatedAt: iso(now) },
  });

  async function getSnapshot() {
    return await readJson(currentFile, baseSnapshot());
  }

  async function writeSnapshot(snapshot) {
    const clean = redact({ ...snapshot, updatedAt: iso(now) });
    await atomicJson(currentFile, clean);
    return clean;
  }

  async function readAllEvents() {
    try {
      const raw = await fs.readFile(eventsFile, 'utf8');
      return raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function appendEvent(event) {
    const clean = redact(event);
    const events = await readAllEvents();
    events.push(clean);
    const kept = events.slice(-Math.max(1, Number(maxEvents) || 1));
    await fs.mkdir(telemetryRoot, { recursive: true });
    const temporary = `${eventsFile}.${process.pid}.tmp`;
    await fs.writeFile(temporary, kept.map(item => JSON.stringify(item)).join('\n') + (kept.length ? '\n' : ''), 'utf8');
    await fs.rename(temporary, eventsFile);
    return clean;
  }

  async function persistJob(job) {
    if (!job?.jobId) return;
    await atomicJson(path.join(jobsRoot, `${safeId(job.jobId, 'jobId')}.json`), redact(job));
  }

  async function transitionUnlocked(input = {}) {
    const jobId = safeId(input.jobId, 'jobId');
    const projectId = safeId(input.projectId, 'projectId');
    const stage = String(input.stage || '');
    if (!JOB_STAGES.has(stage) || stage === 'IDLE') throw new Error(`Unknown telemetry stage: ${stage}`);
    const snapshot = await getSnapshot();
    const previous = snapshot.currentJob?.jobId === jobId
      ? snapshot.currentJob
      : (snapshot.lastJob?.jobId === jobId && ['PENDING_UPLOAD','STALLED'].includes(snapshot.lastJob.stage) ? snapshot.lastJob : null);
    const previousStage = previous?.stage || 'IDLE';
    const allowed = TRANSITIONS.get(previousStage);
    if (!allowed?.has(stage)) throw new Error(`Invalid telemetry transition: ${previousStage} -> ${stage}`);
    const at = iso(now);
    const next = {
      jobId,
      projectId,
      stage,
      detail: input.detail == null ? previous?.detail || null : String(input.detail),
      progress: input.progress == null ? previous?.progress || null : safeProgress(input.progress),
      flow: input.flow == null ? previous?.flow || null : String(input.flow),
      test: input.test == null ? previous?.test || null : String(input.test),
      error: input.error == null ? null : String(input.error),
      artifacts: Array.isArray(previous?.artifacts) ? previous.artifacts : [],
      startedAt: previous?.startedAt || at,
      updatedAt: at,
      finishedAt: TERMINAL_JOB_STAGES.has(stage) ? at : null,
    };
    const event = { schemaVersion: 1, machineId, at, ...next };
    await appendEvent(event);
    const terminal = TERMINAL_JOB_STAGES.has(stage);
    const nextSnapshot = {
      ...snapshot,
      currentJob: terminal ? null : next,
      lastJob: terminal ? next : snapshot.lastJob,
      artifacts: snapshot.currentJob?.jobId === jobId || snapshot.lastJob?.jobId === jobId ? snapshot.artifacts || [] : [],
    };
    await persistJob(next);
    await writeSnapshot(nextSnapshot);
    return redact(next);
  }

  function transition(input = {}) {
    return serializeMutation(() => transitionUnlocked(input));
  }

  async function heartbeatUnlocked(detail = null) {
    const snapshot = await getSnapshot();
    const at = iso(now);
    const payload = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : { detail };
    if (snapshot.currentJob && payload.detail) snapshot.currentJob = { ...snapshot.currentJob, detail: String(payload.detail), updatedAt: at };
    snapshot.agent = {
      stage: payload.stage ? String(payload.stage) : snapshot.agent?.stage || 'IDLE',
      detail: payload.detail == null ? snapshot.agent?.detail || null : String(payload.detail),
      projectId: payload.projectId == null ? snapshot.agent?.projectId || null : String(payload.projectId),
      updatedAt: at,
    };
    snapshot.heartbeatAt = at;
    return writeSnapshot(snapshot);
  }

  function heartbeat(detail = null) {
    return serializeMutation(() => heartbeatUnlocked(detail));
  }

  async function recordArtifactUnlocked(input = {}) {
    const jobId = safeId(input.jobId, 'jobId');
    const localPath = path.resolve(String(input.localPath || ''));
    if (!inside(artifactRoot, localPath)) throw new Error('artifact path is outside the QA artifact root');
    const record = redact({
      jobId,
      projectId: input.projectId ? safeId(input.projectId, 'projectId') : null,
      type: String(input.type || 'file'),
      name: String(input.name || path.basename(localPath)),
      localPath,
      createdAt: input.createdAt || iso(now),
      size: Number.isFinite(Number(input.size)) ? Number(input.size) : null,
      uploaded: input.uploaded === true,
      provider: input.provider || null,
      remoteKey: input.remoteKey || null,
    });
    const snapshot = await getSnapshot();
    const existing = Array.isArray(snapshot.artifacts) ? snapshot.artifacts : [];
    const artifacts = [...existing.filter(item => !(item.jobId === jobId && item.localPath === localPath)), record].slice(-200);
    snapshot.artifacts = artifacts;

    const attachToJob = job => {
      if (!job || job.jobId !== jobId) return job;
      const jobArtifacts = Array.isArray(job.artifacts) ? job.artifacts : [];
      return {
        ...job,
        artifacts: [...jobArtifacts.filter(item => item.localPath !== localPath), record].slice(-200),
        updatedAt: iso(now),
      };
    };

    snapshot.currentJob = attachToJob(snapshot.currentJob);
    snapshot.lastJob = attachToJob(snapshot.lastJob);

    await appendEvent({ schemaVersion: 1, machineId, at: iso(now), jobId, projectId: record.projectId, stage: 'CAPTURING_ARTIFACTS', detail: `Artifact ${record.name}`, artifact: record });

    const persistedJob = snapshot.currentJob?.jobId === jobId
      ? snapshot.currentJob
      : (snapshot.lastJob?.jobId === jobId ? snapshot.lastJob : await readJson(path.join(jobsRoot, `${jobId}.json`), null));
    if (persistedJob) await persistJob(attachToJob(persistedJob));

    await writeSnapshot(snapshot);
    return record;
  }

  function recordArtifact(input = {}) {
    return serializeMutation(() => recordArtifactUnlocked(input));
  }

  async function readEvents({ jobId = null, limit = 100 } = {}) {
    const events = await readAllEvents();
    const filtered = jobId ? events.filter(item => item.jobId === jobId) : events;
    return filtered.slice(-Math.max(1, Math.min(1000, Number(limit) || 100)));
  }

  async function readJob(jobId) {
    return readJson(path.join(jobsRoot, `${safeId(jobId, 'jobId')}.json`), null);
  }

  async function listHistory(limit = 20) {
    try {
      const entries = await fs.readdir(jobsRoot, { withFileTypes: true });
      const jobs = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        const job = await readJson(path.join(jobsRoot, entry.name), null);
        if (job) jobs.push(job);
      }
      return jobs.sort((a, b) => Date.parse(b.updatedAt || 0) - Date.parse(a.updatedAt || 0)).slice(0, Math.max(1, Number(limit) || 20));
    } catch (error) {
      if (error?.code === 'ENOENT') return [];
      throw error;
    }
  }

  async function recoverInterruptedJobUnlocked() {
    const snapshot = await getSnapshot();
    if (!snapshot.currentJob || !ACTIVE_JOB_STAGES.has(snapshot.currentJob.stage)) return null;
    const previous = snapshot.currentJob;
    const at = iso(now);
    const recovered = { ...previous, stage: 'INTERRUPTED', detail: 'Agent restarted while job was active', updatedAt: at, finishedAt: at };
    await appendEvent({ schemaVersion: 1, machineId, at, ...recovered });
    await persistJob(recovered);
    await writeSnapshot({ ...snapshot, currentJob: null, lastJob: recovered });
    return recovered;
  }

  function recoverInterruptedJob() {
    return serializeMutation(() => recoverInterruptedJobUnlocked());
  }

  return { root: telemetryRoot, getSnapshot, transition, heartbeat, recordArtifact, readEvents, readJob, listHistory, recoverInterruptedJob };
}
