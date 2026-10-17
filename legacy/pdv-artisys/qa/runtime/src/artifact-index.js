import fs from 'node:fs/promises';
import path from 'node:path';

const TYPES = new Map([
  ['.png','screenshot'],['.jpg','screenshot'],['.jpeg','screenshot'],
  ['.webm','video'],['.mp4','video'],
  ['.zip','trace'],['.json','report'],['.html','report'],
  ['.log','log'],['.txt','log'],
]);

function inside(root, candidate) {
  const base = path.resolve(root);
  const resolved = path.resolve(candidate);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

async function walk(dir, root, out) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (!inside(root, file)) continue;
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) continue;
    if (stat.isDirectory()) {
      await walk(file, root, out);
      continue;
    }
    if (!stat.isFile()) continue;
    const type = TYPES.get(path.extname(entry.name).toLowerCase());
    if (!type) continue;
    out.push({
      type,
      name: entry.name,
      localPath: path.resolve(file),
      relativePath: path.relative(root, file).split(path.sep).join('/'),
      createdAt: new Date(stat.birthtimeMs || stat.ctimeMs || stat.mtimeMs).toISOString(),
      size: stat.size,
    });
  }
}

export async function scanQaArtifacts({ artifactRoot, runDir } = {}) {
  if (!artifactRoot || !runDir) throw new TypeError('artifactRoot and runDir are required');
  const root = path.resolve(artifactRoot);
  const run = path.resolve(runDir);
  if (!inside(root, run)) throw new Error('run directory is outside artifact root');
  const out = [];
  try {
    await walk(run, root, out);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  return out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}
