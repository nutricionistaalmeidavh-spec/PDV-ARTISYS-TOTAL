import { spawn } from 'node:child_process';
import { waitForHealth } from './index.js';

export async function startConsumerProcess({ command, cwd, env = {}, readyUrl, timeoutMs = 30000 }) {
  if (!command) return null;
  const child = spawn(command, {
    cwd,
    env: { ...process.env, ...env },
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const logs = [];
  const capture = stream => stream?.on('data', chunk => logs.push(String(chunk)));
  capture(child.stdout);
  capture(child.stderr);
  if (readyUrl) {
    try {
      await waitForHealth(readyUrl, { timeoutMs });
    } catch (error) {
      child.kill('SIGTERM');
      throw new Error(`Consumer process did not become ready: ${readyUrl}\n${logs.slice(-20).join('')}`, { cause: error });
    }
  }
  return {
    child,
    logs,
    async stop() {
      if (child.exitCode != null) return;
      child.kill('SIGTERM');
      await new Promise(resolve => {
        const timer = setTimeout(() => { child.kill('SIGKILL'); resolve(); }, 5000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
      });
    },
  };
}
