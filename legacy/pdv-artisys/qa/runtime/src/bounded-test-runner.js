import { spawn } from 'node:child_process';

function positiveTimeout(value, fallback = 90_000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function runBoundedNodeTestFile({
  file,
  timeoutMs = 90_000,
  cwd = process.cwd(),
  env = process.env,
  onStdout = chunk => process.stdout.write(chunk),
  onStderr = chunk => process.stderr.write(chunk),
  spawnImpl = spawn,
} = {}) {
  if (!file || typeof file !== 'string') throw new TypeError('file is required');
  const effectiveTimeout = positiveTimeout(timeoutMs);
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const mergedEnv = { ...process.env, ...(env || {}) };
    delete mergedEnv.NODE_TEST_CONTEXT;
    let timedOut = false;
    let settled = false;
    const child = spawnImpl(process.execPath, ['--test', file], {
      cwd,
      env: mergedEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    child.stdout?.on('data', chunk => onStdout?.(chunk));
    child.stderr?.on('data', chunk => onStderr?.(chunk));

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGKILL'); } catch {}
    }, effectiveTimeout);
    timer.unref?.();

    const finish = (exitCode, signal = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        file,
        exitCode: Number.isInteger(exitCode) ? exitCode : (timedOut ? 124 : 1),
        signal,
        timedOut,
        durationMs: Date.now() - startedAt,
        timeoutMs: effectiveTimeout,
      });
    };

    child.once('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', finish);
  });
}
