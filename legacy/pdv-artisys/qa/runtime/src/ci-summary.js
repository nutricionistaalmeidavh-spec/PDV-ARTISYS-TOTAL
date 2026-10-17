import fs from 'node:fs/promises';
import path from 'node:path';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function errorShape(error) {
  if (!error) return null;
  if (typeof error === 'string') return { message: error };
  return {
    message: text(error.message) || String(error),
    ...(text(error.stack) ? { stack: error.stack } : {}),
  };
}

function failedStepFromRun(run) {
  if (run?.failedStep && typeof run.failedStep === 'object') return run.failedStep;
  const steps = Array.isArray(run?.summary?.steps) ? run.summary.steps : [];
  const step = steps.find(item => item?.status === 'failed') || null;
  if (!step) return null;
  return {
    index: Number.isInteger(step.index) ? step.index : null,
    action: text(step.action) || null,
    name: text(step.name) || null,
    error: text(step.error) || null,
  };
}

function normalizedStatus(status) {
  const value = text(status).toLowerCase();
  if (value === 'passed' || value === 'pass' || value === 'success') return 'PASS';
  if (value === 'failed' || value === 'fail' || value === 'failure') return 'FAIL';
  return value ? value.toUpperCase() : 'UNKNOWN';
}

function normalizeRun(run) {
  const flow = text(run?.flow) || text(run?.check) || text(run?.summary?.flow) || 'unknown';
  const status = normalizedStatus(run?.status || run?.summary?.status);
  const failedStep = failedStepFromRun(run);
  const outputDir = text(run?.outputDir) || null;
  const failureMessage = text(failedStep?.error)
    || text(run?.error)
    || text(run?.summary?.failure?.message)
    || null;
  return {
    flow,
    status,
    ...(Number.isFinite(run?.durationMs) ? { durationMs: run.durationMs } : {}),
    ...(failureMessage ? { error: failureMessage } : {}),
    ...(failedStep ? { failedStep } : {}),
    ...(run?.summary ? { summary: run.summary } : {}),
    ...(outputDir ? {
      outputDir,
      evidence: {
        outputDir,
        screenshot: path.join(outputDir, 'screenshots', 'failure.png'),
        trace: path.join(outputDir, 'trace.zip'),
        runSummary: path.join(outputDir, 'run-summary.json'),
      },
    } : {}),
  };
}

export function buildCiQaSummary({
  report = null,
  systemId = null,
  profile = null,
  runs = null,
  status = null,
  failure = null,
  lastProgress = null,
  logPath = null,
} = {}) {
  const sourceRuns = Array.isArray(runs)
    ? runs
    : Array.isArray(report?.runs)
      ? report.runs
      : Array.isArray(report?.flows)
        ? report.flows
        : [];
  const flows = sourceRuns.map(normalizeRun);
  const failureInfo = errorShape(failure);

  if (!flows.length && failureInfo && lastProgress?.flow) {
    flows.push({
      flow: text(lastProgress.flow) || 'unknown',
      status: 'FAIL',
      error: failureInfo.message,
      failedStep: {
        index: Number.isInteger(lastProgress.current) ? lastProgress.current - 1 : null,
        action: null,
        name: text(lastProgress.step) || null,
        error: failureInfo.message,
      },
    });
  }

  const flowsPassed = flows.filter(item => item.status === 'PASS').length;
  const flowsFailed = flows.filter(item => item.status === 'FAIL').length;
  const reportStatus = text(report?.status).toUpperCase();
  const gateFailed = report?.gate?.allowed === false;
  const explicitStatus = text(status).toUpperCase();
  const finalStatus = explicitStatus
    || (gateFailed || flowsFailed > 0 || failureInfo ? 'FAIL' : (reportStatus || 'PASS'));

  return {
    schemaVersion: 2,
    source: '@artisys/qa',
    system: text(systemId) || text(report?.systemId) || text(report?.system) || 'unknown',
    profile: text(profile) || text(report?.profile) || 'unknown',
    status: finalStatus,
    generatedAt: new Date().toISOString(),
    counts: { flowsPassed, flowsFailed },
    flows,
    ...(report?.gate ? { gate: report.gate } : {}),
    ...(lastProgress ? { lastProgress } : {}),
    ...(failureInfo ? { failure: failureInfo } : {}),
    artifacts: {
      ...(report?.artifacts && typeof report.artifacts === 'object' ? report.artifacts : {}),
      ...(text(logPath) ? { log: logPath } : {}),
    },
  };
}

export async function writeCiQaSummary({ targetPath = path.resolve('artifacts', 'qa-summary.json'), ...input } = {}) {
  const file = path.resolve(targetPath);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const summary = buildCiQaSummary(input);
  await fs.writeFile(file, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return { file, summary };
}
