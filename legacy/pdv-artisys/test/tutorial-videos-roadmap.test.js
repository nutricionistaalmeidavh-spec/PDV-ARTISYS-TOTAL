'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const root = path.resolve('.');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));

test('tutorial roadmap defines 36 sparse micro-tutorials capped at 30 seconds', async () => {
  const catalog = readJson('qa/tutorials/catalog.json');
  const phaseCounts = catalog.tutorials.reduce((acc, item) => {
    acc[item.phase] = (acc[item.phase] || 0) + 1;
    return acc;
  }, {});

  assert.equal(catalog.schemaVersion, 1);
  assert.equal(catalog.maxDurationSec, 30);
  assert.deepEqual(phaseCounts, { P0: 12, P1: 9, P2: 7, P3: 8 });
  assert.equal(catalog.tutorials.length, 36);

  const ids = new Set();
  const outputs = new Set();
  for (const tutorial of catalog.tutorials) {
    assert.match(tutorial.id, /^\d{2}-[a-z0-9-]+$/);
    assert.equal(ids.has(tutorial.id), false, `duplicate tutorial id: ${tutorial.id}`);
    ids.add(tutorial.id);

    assert.ok(tutorial.durationTargetSec > 0 && tutorial.durationTargetSec <= 30, tutorial.id);
    assert.match(tutorial.outputFile, /^\d{2}-[a-z0-9-]+\.mp4$/);
    assert.equal(outputs.has(tutorial.outputFile), false, `duplicate output file: ${tutorial.outputFile}`);
    outputs.add(tutorial.outputFile);

    assert.ok(['operador', 'admin', 'operador-admin', 'todos'].includes(tutorial.audience), tutorial.id);
    assert.ok(typeof tutorial.goal === 'string' && tutorial.goal.length > 5, tutorial.id);
    assert.ok(typeof tutorial.success === 'string' && tutorial.success.length > 5, tutorial.id);

    assert.ok(Array.isArray(tutorial.overlays) && tutorial.overlays.length >= 2 && tutorial.overlays.length <= 4, tutorial.id);
    for (const overlay of tutorial.overlays) {
      assert.ok(['orient', 'act', 'confirm', 'recover'].includes(overlay.purpose), `${tutorial.id}: ${overlay.purpose}`);
      assert.ok(Number.isFinite(overlay.fromSec) && Number.isFinite(overlay.toSec), tutorial.id);
      assert.ok(overlay.fromSec >= 0 && overlay.toSec > overlay.fromSec, tutorial.id);
      assert.ok(overlay.toSec <= tutorial.durationTargetSec, tutorial.id);
      assert.ok(typeof overlay.text === 'string' && overlay.text.length > 0 && overlay.text.length <= 60, tutorial.id);
    }
  }

  const moduleUrl = pathToFileURL(path.join(root, 'qa/tutorials/tutorial-video.mjs')).href;
  const { validateTutorialCatalog, renderTutorialSrt, buildTutorialEditArgs } = await import(moduleUrl);
  assert.equal(validateTutorialCatalog(catalog), true);

  const first = catalog.tutorials[0];
  const srt = renderTutorialSrt(first);
  assert.match(srt, /Como fazer uma venda/);
  assert.match(srt, /Venda concluída/);

  const args = buildTutorialEditArgs('raw.mp4', 'final.mp4', 'captions.srt');
  assert.deepEqual(args.slice(0, 3), ['-y', '-i', 'raw.mp4']);
  assert.ok(args.includes('libx264'));
  assert.ok(args.some(value => String(value).includes('subtitles=')));
  assert.equal(args.at(-1), 'final.mp4');

  const windowsArgs = buildTutorialEditArgs('raw.mp4', 'final.mp4', 'C:\\tutorials\\captions.srt');
  const windowsFilter = windowsArgs[windowsArgs.indexOf('-vf') + 1];
  assert.match(windowsFilter, /C.*tutorials\/captions\.srt/);
  assert.doesNotMatch(windowsFilter, /\\\\tutorials\\\\/);
});

test('package scripts expose local validation and FFmpeg editing without paid dependencies', () => {
  const pkg = readJson('package.json');
  assert.equal(pkg.scripts['qa:tutorials:validate'], 'node scripts/tutorial-videos.mjs validate');
  assert.equal(pkg.scripts['qa:tutorials:edit'], 'node scripts/tutorial-videos.mjs edit');
  assert.equal(pkg.devDependencies.playwright, '1.63.0');
  assert.equal(pkg.dependencies.ffmpeg, undefined);

  const cli = fs.readFileSync(path.join(root, 'scripts/tutorial-videos.mjs'), 'utf8');
  assert.match(cli, /ffprobe/);
  assert.match(cli, /catalog\.maxDurationSec/);
});
