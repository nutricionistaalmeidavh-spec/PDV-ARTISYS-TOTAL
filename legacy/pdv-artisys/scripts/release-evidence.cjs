'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

function buildEvidence({ product, version, commit, artifacts }) {
  if (!Array.isArray(artifacts) || !artifacts.length) throw new Error('Release evidence requires at least one artifact.');
  return {
    schemaVersion: 1,
    product: String(product || '').trim(),
    version: String(version || '').trim(),
    commit: String(commit || '').trim(),
    generatedAt: new Date().toISOString(),
    artifacts: artifacts.map((artifact) => ({
      name: artifact.name,
      bytes: artifact.data.length,
      sha256: sha256(artifact.data)
    }))
  };
}

function collectFiles(dir) {
  const required = [
    /^ArtiSys-PDV-.*-Setup\.exe$/i,
    /^latest\.yml$/i,
    /\.blockmap$/i
  ];
  const files = fs.readdirSync(dir, { withFileTypes:true }).filter((entry)=>entry.isFile());
  const selected = files.filter((entry)=>required.some((pattern)=>pattern.test(entry.name))).map((entry)=>entry.name).sort();
  for (const pattern of required) {
    if (!selected.some((name)=>pattern.test(name))) throw new Error(`Release artifact required but missing: ${pattern}`);
  }
  return selected.map((name)=>({name,data:fs.readFileSync(path.join(dir,name))}));
}

function main() {
  const repoRoot = path.resolve(__dirname, '..');
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot,'package.json'),'utf8'));
  const dist = path.join(repoRoot,'dist');
  const artifacts = collectFiles(dist);
  const evidence = buildEvidence({
    product: process.env.ARTISYS_RELEASE_PRODUCT || 'PDV-ARTISYS',
    version: process.env.ARTISYS_RELEASE_VERSION || pkg.version,
    commit: process.env.CI_COMMIT_SHA || process.env.GIT_COMMIT || '',
    artifacts
  });
  const outDir = path.join(repoRoot,'artifacts');
  fs.mkdirSync(outDir,{recursive:true});
  const out = path.join(outDir,'release-evidence.json');
  fs.writeFileSync(out,`${JSON.stringify(evidence,null,2)}\n`,'utf8');
  console.log(`[ArtiSys Release] Evidencia: ${out}`);
  for (const artifact of evidence.artifacts) console.log(`[ArtiSys Release] ${artifact.name} sha256=${artifact.sha256}`);
}

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(`[ArtiSys Release] ${error.message}`); process.exitCode=1; }
}

module.exports = { buildEvidence, collectFiles };
