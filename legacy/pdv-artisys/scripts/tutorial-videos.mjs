#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTutorialEditArgs, findTutorial, renderTutorialSrt, validateTutorialCatalog } from '../qa/tutorials/tutorial-video.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const catalogPath = path.join(root, 'qa', 'tutorials', 'catalog.json');

function parseArgs(argv) {
  const [command = 'validate', ...rest] = argv;
  const args = { command };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const value = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    args[key] = value;
  }
  return args;
}

async function readCatalog() {
  return JSON.parse(await fs.readFile(catalogPath, 'utf8'));
}

function run(command, args, { captureStdout = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: captureStdout ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stdout = '';
    let stderr = '';
    if (captureStdout) {
      child.stdout.on('data', chunk => { stdout += chunk; });
      child.stderr.on('data', chunk => { stderr += chunk; });
    }
    child.once('error', reject);
    child.once('close', code => code === 0
      ? resolve(captureStdout ? stdout : undefined)
      : reject(new Error(`${command} exited with code ${code}${stderr ? `: ${stderr}` : ''}`)));
  });
}

async function probeDuration(file) {
  const stdout = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ], { captureStdout: true });
  const seconds = Number(String(stdout).trim());
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not determine media duration: ${file}`);
  return seconds;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const catalog = await readCatalog();

  if (args.command === 'validate') {
    validateTutorialCatalog(catalog);
    console.log(`valid ${catalog.tutorials.length} tutorials (<=${catalog.maxDurationSec}s)`);
    return;
  }

  if (args.command === 'list') {
    validateTutorialCatalog(catalog);
    for (const tutorial of catalog.tutorials) {
      console.log(`${tutorial.id}\t${tutorial.durationTargetSec}s\t${tutorial.title}\t${tutorial.outputFile}`);
    }
    return;
  }

  if (args.command === 'edit') {
    if (!args.tutorial || args.tutorial === true) throw new Error('edit requires --tutorial <id>');
    if (!args.input || args.input === true) throw new Error('edit requires --input <raw.mp4>');

    const tutorial = findTutorial(catalog, String(args.tutorial));
    const inputFile = path.resolve(String(args.input));
    const outputFile = args.output && args.output !== true
      ? path.resolve(String(args.output))
      : path.join(root, 'qa-artifacts', 'tutorials', tutorial.outputFile);
    const subtitleFile = `${outputFile}.captions.srt`;
    const sourceDurationSec = await probeDuration(inputFile);
    if (sourceDurationSec > catalog.maxDurationSec + 0.05) {
      throw new Error(`Tutorial source exceeds ${catalog.maxDurationSec}s: ${sourceDurationSec.toFixed(2)}s`);
    }

    await fs.mkdir(path.dirname(outputFile), { recursive: true });
    await fs.writeFile(subtitleFile, renderTutorialSrt(tutorial), 'utf8');
    try {
      await run('ffmpeg', buildTutorialEditArgs(inputFile, outputFile, subtitleFile));
      const finalDurationSec = await probeDuration(outputFile);
      if (finalDurationSec > catalog.maxDurationSec + 0.05) {
        await fs.rm(outputFile, { force: true });
        throw new Error(`Edited tutorial exceeds ${catalog.maxDurationSec}s: ${finalDurationSec.toFixed(2)}s`);
      }
      console.log(`TUTORIAL_DURATION=${finalDurationSec.toFixed(3)}s`);
    } finally {
      await fs.rm(subtitleFile, { force: true });
    }
    console.log(`TUTORIAL_VIDEO=${outputFile}`);
    return;
  }

  throw new Error(`Unknown command: ${args.command}`);
}

main().catch(error => {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
});
