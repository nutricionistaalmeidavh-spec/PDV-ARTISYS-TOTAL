import fs from 'node:fs/promises';
import path from 'node:path';

export function sanitizeName(value) {
  return String(value ?? 'item')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'item';
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function resolveSecret(step, env = process.env) {
  if (step.valueFromEnv) {
    const value = env[step.valueFromEnv];
    if (value == null) throw new Error(`Missing environment variable: ${step.valueFromEnv}`);
    return value;
  }
  return step.value ?? '';
}

export function stepLabel(step, index) {
  return `${String(index + 1).padStart(2, '0')}-${sanitizeName(step.name || step.action)}`;
}

export async function writeJson(file, data) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function fileExists(file) {
  try { await fs.access(file); return true; } catch { return false; }
}
