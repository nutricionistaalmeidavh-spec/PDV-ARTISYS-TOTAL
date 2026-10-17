import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function slug(value) {
  return String(value || 'project')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'project';
}

export function buildDriveProjectPath(project) {
  return slug(project?.id);
}

export function buildDriveRunPath(project, job, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return `${buildDriveProjectPath(project)}/${day}/${slug(job.id)}`;
}

export async function assertRcloneRemote(remote, { exec = execFileAsync } = {}) {
  if (!remote) throw new Error('Drive remote is not configured');
  try {
    await exec('rclone', ['about', `${remote}:`, '--json'], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  } catch (error) {
    throw new Error(`rclone remote ${remote} is unavailable. Run the Drive setup command first. ${error?.message || ''}`.trim());
  }
  return true;
}

export async function ensureDriveProjectFolder(project, drive, { exec = execFileAsync } = {}) {
  if (!drive?.enabled) return { created: false, reason: 'drive-disabled' };
  const remote = drive.remote || 'artisys-qa-drive';
  await assertRcloneRemote(remote, { exec });
  const projectPath = buildDriveProjectPath(project);
  await exec('rclone', ['mkdir', `${remote}:${projectPath}`], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  return {
    created: true,
    remote,
    projectPath,
    target: `${remote}:${projectPath}`,
    rootFolderId: drive.rootFolderId || null,
  };
}

export async function uploadRunArtifacts({ project, job, sourceDir, drive, manifest = {} }, { exec = execFileAsync } = {}) {
  if (!drive?.enabled) return { uploaded: false, reason: 'drive-disabled' };
  if (!sourceDir) throw new Error('sourceDir is required for Drive upload');
  await fs.access(sourceDir);
  const remote = drive.remote || 'artisys-qa-drive';
  await ensureDriveProjectFolder(project, drive, { exec });

  const runPath = buildDriveRunPath(project, job);
  const target = `${remote}:${runPath}`;
  const manifestFile = path.join(sourceDir, 'bridge-result.json');
  await fs.writeFile(manifestFile, `${JSON.stringify({
    schemaVersion: 1,
    jobId: job.id,
    projectId: project.id,
    action: job.action,
    generatedAt: new Date().toISOString(),
    ...manifest,
  }, null, 2)}\n`, 'utf8');

  await exec('rclone', [
    'copy', sourceDir, target,
    '--create-empty-src-dirs',
    '--transfers', '4',
    '--checkers', '8',
    '--metadata',
  ], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });

  return {
    uploaded: true,
    remote,
    runPath,
    target,
    rootFolderId: drive.rootFolderId || null,
  };
}
