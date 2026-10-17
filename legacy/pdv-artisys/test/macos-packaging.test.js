'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = relativePath => fs.readFileSync(path.join(root, relativePath), 'utf8');
const pkg = JSON.parse(read('package.json'));

test('macOS x64 and arm64 DMG plus ZIP targets are configured without changing Windows NSIS', () => {
  assert.equal(pkg.scripts['dist:win'], 'electron-builder --win nsis --x64 --publish never');
  assert.equal(pkg.scripts['dist:mac'], 'bash scripts/build-macos.sh');
  assert.deepEqual(pkg.build.mac.target, ['dmg', 'zip']);
  assert.equal(pkg.build.mac.icon, 'build/artisys-pdv.icns');
  assert.equal(pkg.build.mac.artifactName, 'ArtiSys-PDV-${version}-${arch}.${ext}');
  assert.equal(pkg.build.mac.extendInfo.NSLocalNetworkUsageDescription.length > 0, true);
});

test('macOS build enforces native architecture and generates the existing ArtiSys brand icon', () => {
  const builder = read('scripts/build-macos.sh');
  const icon = read('scripts/make-macos-icon.sh');
  assert.match(builder, /Darwin/);
  assert.match(builder, /process\.arch/);
  assert.match(builder, /make-macos-icon\.sh/);
  assert.match(builder, /--mac dmg zip/);
  assert.match(builder, /CSC_IDENTITY_AUTO_DISCOVERY=false/);
  assert.match(icon, /artisys-pdv-icon\.svg/);
  assert.match(icon, /iconutil -c icns/);
});

test('CI builds both Mac architectures independently and requires packaged launch smoke', () => {
  const workflow = read('.github/workflows/build-macos.yml');
  assert.match(workflow, /macos-15-intel/);
  assert.match(workflow, /macos-15/);
  assert.match(workflow, /arm64/);
  assert.match(workflow, /x64/);
  assert.match(workflow, /npm run dist:mac/);
  assert.match(workflow, /npm version/);
  assert.match(workflow, /github.ref_type == 'tag'/);
  assert.match(workflow, /Smoke test packaged macOS app/);
  assert.match(workflow, /actions\/upload-artifact/);
  assert.doesNotMatch(workflow, /gh release (create|upload)/);
});

test('macOS unsigned updates remain manual until signed and validated', () => {
  const updater = read('desktop/updater-service.cjs');
  assert.match(updater, /platform === 'win32'/);
  const docs = read('docs/operations/macos-packaging.md');
  assert.match(docs, /não assinado/i);
  assert.match(docs, /atualiza[cç][aã]o manual/i);
  assert.match(docs, /Gatekeeper/);
});

test('macOS public release is manual, QA-gated and only uploads DMGs', () => {
  const workflow = read('.github/workflows/publish-macos.yml');
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /qa_approved/);
  assert.match(workflow, /build_sha/);
  assert.match(workflow, /tag_sha/);
  assert.match(workflow, /release_version/);
  assert.match(workflow, /gh release upload/);
  assert.match(workflow, /-name '\*\.dmg'/);
  assert.doesNotMatch(workflow, /push:/);
  assert.doesNotMatch(workflow, /gh release create/);
});
