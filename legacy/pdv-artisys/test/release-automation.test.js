'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const readJson = (file) => JSON.parse(read(file));

test('release profile validates its QA manifest without running legacy E2E flows', () => {
  const config = readJson('.artisys/release.json');
  assert.equal(config.version, '1.3.4');
  assert.deepEqual(config.requiredSteps, ['deps','lint','test','build','installer','qa']);
  assert.deepEqual(config.requiredStepsByProfile.release, ['security','evidence','publish']);
  assert.equal(config.steps.qa, 'npm run qa:validate');
  assert.match(config.steps.security.command, /security-gate\.ps1/);
  assert.match(config.steps.evidence.command, /release-evidence\.cjs/);
  assert.match(config.steps.publish.command, /publish-github-release\.ps1/);
});

test('optional Woodpecker pipelines remain manual-only while GitHub Actions owns automatic CI', () => {
  const optionalPipelines = ['.woodpecker/pdv-publish.yaml','.woodpecker/pdv-release.yaml'];
  for (const filename of optionalPipelines) {
    // Os pipelines manuais são opcionais e podem não estar versionados.
    if (!fs.existsSync(path.join(root, filename))) continue;
    const pipeline = read(filename);
    assert.match(pipeline, /event: manual/);
    assert.doesNotMatch(pipeline, /event: push/);
    assert.doesNotMatch(pipeline, /event: tag/);
    if(filename.endsWith('pdv-publish.yaml')){
      assert.match(pipeline, /-Profile release/);
      assert.match(pipeline, /GITHUB_RELEASE_TOKEN|GITHUB_REPORT_TOKEN/);
    }
  }
  const github = read('.github/workflows/verify.yml');
  assert.match(github, /push:/);
  assert.match(github, /pull_request:/);
  assert.match(github, /npm run capability:check:release/);
  assert.match(github, /run-v1-tests\.js --experimental-test-coverage/);
  assert.doesNotMatch(github, /npm run test:release/);
  assert.doesNotMatch(github, /qa:release|qa:full|qa:crosscut|fiscal:certify/);
});

test('publisher requires updater assets and blocks publication outside tag events', () => {
  const publisher = read('scripts/publish-github-release.ps1');
  assert.match(publisher, /latest\\\.yml|latest\.yml/);
  assert.match(publisher, /blockmap/);
  assert.match(publisher, /ArtiSys-PDV/);
  assert.match(publisher, /CI_PIPELINE_EVENT/);
  assert.match(publisher, /-ne 'tag'/);
});

test('release evidence hashes installer and updater metadata', () => {
  const evidence = read('scripts/release-evidence.cjs');
  assert.match(evidence, /sha256/);
  assert.match(evidence, /latest\\\.yml|latest\.yml/);
  assert.match(evidence, /blockmap/);
});

test('host hardening checks the self-hosted Woodpecker stack', () => {
  const health = read('infra/woodpecker/health-check.ps1');
  assert.match(health, /woodpecker-agent/);
  assert.match(health, /cloudflared/);
  assert.match(health, /artisys-release/);
  assert.match(health, /artisys-ci-reporter/);
  assert.match(health, /ci\.artisys\.dev\/healthz/);
});
