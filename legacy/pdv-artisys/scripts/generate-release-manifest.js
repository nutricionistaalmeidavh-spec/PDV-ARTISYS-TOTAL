'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { VERTICAL_SCHEMA_VERSION } = require('../js/core/database/vertical-migrations');
const { HARDWARE_SCHEMA_VERSION } = require('../js/core/database/hardware-migrations');
const { SALE_OBSERVATION_SCHEMA_VERSION } = require('../js/core/database/sale-observation-migrations');

const CURRENT_SCHEMA_VERSION = Math.max(VERTICAL_SCHEMA_VERSION, HARDWARE_SCHEMA_VERSION, SALE_OBSERVATION_SCHEMA_VERSION);

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function resolveCommit(rootDir) {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: rootDir, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

function buildReleaseManifest({
  rootDir = process.cwd(),
  commit = resolveCommit(rootDir),
  builtAt = process.env.RELEASE_BUILT_AT || new Date().toISOString(),
  artifactPaths = [],
  verification = {
    verify: process.env.VERIFY_RESULT || 'unknown',
    verifyRelease: process.env.VERIFY_RELEASE_RESULT || 'unknown',
    windowsBuild: process.env.WINDOWS_BUILD_RESULT || 'unknown'
  }
} = {}) {
  const pkg = readJson(path.join(rootDir, 'package.json'));
  const capabilities = readJson(path.join(rootDir, 'release', 'capabilities.json'));
  const limitations = readJson(path.join(rootDir, 'release', 'limitations.json'));
  const artifacts = artifactPaths.map(input => {
    const filePath = path.resolve(input);
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) throw new Error(`Artefato invalido: ${filePath}`);
    return {
      name: path.basename(filePath),
      sizeBytes: stat.size,
      sha256: sha256File(filePath)
    };
  });
  const checksums = Object.fromEntries(artifacts.map(item => [item.name, item.sha256]));
  return {
    version: pkg.version,
    commit,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    builtAt,
    artifacts,
    checksums,
    verification,
    capabilities,
    limitations
  };
}

function parseArgs(argv) {
  const result = { output: null, artifacts: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--output') result.output = argv[++i];
    else if (arg === '--artifact') result.artifacts.push(argv[++i]);
    else throw new Error(`Argumento desconhecido: ${arg}`);
  }
  if (!result.output) result.output = path.join('dist', 'release-manifest.json');
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = buildReleaseManifest({ artifactPaths: args.artifacts });
  const output = path.resolve(args.output);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`Release manifest: ${output}`);
  for (const artifact of manifest.artifacts) console.log(`${artifact.sha256}  ${artifact.name}`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error.message || error); process.exitCode = 1; }
}

module.exports = { buildReleaseManifest, parseArgs, sha256File, CURRENT_SCHEMA_VERSION };
