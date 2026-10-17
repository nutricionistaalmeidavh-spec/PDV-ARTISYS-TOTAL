import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

const CONTENT_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webm', 'video/webm'],
  ['.mp4', 'video/mp4'],
  ['.json', 'application/json'],
  ['.html', 'text/html'],
  ['.zip', 'application/zip'],
  ['.txt', 'text/plain'],
  ['.log', 'text/plain'],
]);

function normalizeEndpoint(value) {
  const url = new URL(String(value || ''));
  if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
    throw new Error('Cloud observability endpoint must use HTTPS');
  }
  return url.toString().replace(/\/$/, '');
}

function safeSegment(value, label) {
  const text = String(value || '');
  if (!/^[A-Za-z0-9._-]{1,160}$/.test(text)) throw new Error(`Invalid ${label}`);
  return text;
}

function contentType(file) {
  return CONTENT_TYPES.get(path.extname(file).toLowerCase()) || 'application/octet-stream';
}

async function parseResponse(response) {
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) throw new Error(`Cloud observability HTTP ${response.status}: ${typeof payload === 'string' ? payload : payload?.error || response.statusText}`);
  return payload;
}

export function createCloudTelemetryMirror({
  endpoint,
  token,
  machineId,
  version = 'unknown',
  machineName = machineId,
  fetchImpl = fetch,
  timeoutMs = 5000,
  artifactTimeoutMs = 120000,
} = {}) {
  if (!endpoint) throw new Error('Cloud observability endpoint is required');
  if (!token) throw new Error('Cloud observability agent token is required');
  if (!machineId) throw new Error('Cloud observability machineId is required');
  const base = normalizeEndpoint(endpoint);
  const uploaded = new Set();
  const status = {
    enabled: true,
    endpoint: base,
    lastSuccessAt: null,
    lastError: null,
  };

  async function request(relative, options = {}, requestTimeoutMs = timeoutMs) {
    const controller = AbortSignal.timeout(Math.max(100, Number(requestTimeoutMs) || timeoutMs));
    const headers = {
      authorization: `Bearer ${token}`,
      ...options.headers,
    };
    try {
      const response = await fetchImpl(`${base}${relative}`, { ...options, headers, signal: controller });
      const payload = await parseResponse(response);
      status.lastSuccessAt = new Date().toISOString();
      status.lastError = null;
      return payload;
    } catch (error) {
      status.lastError = error?.message || String(error);
      throw error;
    }
  }

  async function heartbeat(detail = null) {
    const payload = detail && typeof detail === 'object' && !Array.isArray(detail) ? detail : { detail };
    return request('/api/v1/heartbeat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        machineId,
        name: machineName,
        version,
        status: 'online',
        ...payload,
        at: new Date().toISOString(),
      }),
    });
  }

  async function transition(event = {}) {
    const jobId = safeSegment(event.jobId, 'jobId');
    safeSegment(event.projectId, 'projectId');
    return request(`/api/v1/jobs/${encodeURIComponent(jobId)}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...event,
        jobId,
        machineId,
        version,
        at: event.at || event.updatedAt || new Date().toISOString(),
      }),
    });
  }

  async function recordArtifact(artifact = {}) {
    const jobId = safeSegment(artifact.jobId, 'jobId');
    const projectId = safeSegment(artifact.projectId, 'projectId');
    const localPath = path.resolve(String(artifact.localPath || ''));
    if (uploaded.has(localPath)) return { skipped: true, reason: 'already-uploaded' };
    const stat = await fs.stat(localPath);
    if (!stat.isFile()) throw new Error('Cloud artifact path is not a file');
    const params = new URLSearchParams({
      machineId,
      projectId,
      type: String(artifact.type || 'file'),
      name: String(artifact.name || path.basename(localPath)),
      relativePath: String(artifact.relativePath || artifact.name || path.basename(localPath)),
      createdAt: String(artifact.createdAt || new Date().toISOString()),
    });
    const stream = Readable.toWeb(createReadStream(localPath));
    const result = await request(`/api/v1/jobs/${encodeURIComponent(jobId)}/artifacts?${params.toString()}`, {
      method: 'POST',
      headers: {
        'content-type': contentType(localPath),
        'content-length': String(stat.size),
      },
      body: stream,
      duplex: 'half',
    }, artifactTimeoutMs);
    uploaded.add(localPath);
    return result;
  }

  return {
    transition,
    heartbeat,
    recordArtifact,
    status: () => ({ ...status }),
  };
}

export function createTelemetryFanout(local, mirrors = [], { logger = console } = {}) {
  if (!local) throw new TypeError('Local telemetry is required');
  const remote = mirrors.filter(Boolean);

  function background(method, value) {
    for (const mirror of remote) {
      if (typeof mirror?.[method] !== 'function') continue;
      Promise.resolve().then(() => mirror[method](value)).catch(error => logger.error?.(`[cloud] ${method}: ${error?.message || error}`));
    }
  }

  return {
    root: local.root,
    async transition(event) {
      const result = await local.transition(event);
      background('transition', result);
      return result;
    },
    async heartbeat(detail) {
      const result = await local.heartbeat(detail);
      background('heartbeat', detail);
      return result;
    },
    async recordArtifact(artifact) {
      const result = await local.recordArtifact(artifact);
      background('recordArtifact', result);
      return result;
    },
    getSnapshot: (...args) => local.getSnapshot(...args),
    readEvents: (...args) => local.readEvents(...args),
    readJob: (...args) => local.readJob(...args),
    listHistory: (...args) => local.listHistory(...args),
    recoverInterruptedJob: (...args) => local.recoverInterruptedJob(...args),
  };
}
