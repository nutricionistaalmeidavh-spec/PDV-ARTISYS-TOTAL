'use strict';

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--')) throw new Error(`Argumento inválido: ${key}`);
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw new Error(`Valor ausente para ${key}`);
    values[key.slice(2)] = value;
    index += 1;
  }
  return values;
}

function parseVersion(input, label) {
  const match = String(input || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) throw new Error(`${label} deve usar SemVer estável X.Y.Z.`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    text: `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`
  };
}

function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  return 0;
}

function optionalValue(value) {
  const normalized = String(value || '').trim();
  return normalized && normalized !== '-' && normalized.toLowerCase() !== 'none' ? normalized : '';
}

function resolveReleaseVersion({ packageVersion, latestReleaseTag = '', latestTarget = '', currentCommit = '' }) {
  const packageSemver = parseVersion(packageVersion, 'package-version');
  const releaseTag = optionalValue(latestReleaseTag);
  if (!releaseTag) return packageSemver.text;

  const latestSemver = parseVersion(releaseTag, 'latest-release-tag');
  const target = optionalValue(latestTarget);
  const current = optionalValue(currentCommit);
  if (target && current && target === current) return latestSemver.text;

  const nextPatch = {
    major: latestSemver.major,
    minor: latestSemver.minor,
    patch: latestSemver.patch + 1
  };
  const nextPatchText = `${nextPatch.major}.${nextPatch.minor}.${nextPatch.patch}`;

  return compareVersions(packageSemver, nextPatch) > 0 ? packageSemver.text : nextPatchText;
}

if (require.main === module) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const version = resolveReleaseVersion({
      packageVersion: args['package-version'],
      latestReleaseTag: args['latest-release-tag'],
      latestTarget: args['latest-target'],
      currentCommit: args['current-commit']
    });
    process.stdout.write(`${version}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

module.exports = { parseVersion, compareVersions, resolveReleaseVersion };
