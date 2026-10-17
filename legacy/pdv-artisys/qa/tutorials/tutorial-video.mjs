import path from 'node:path';

const PURPOSES = new Set(['orient', 'act', 'confirm', 'recover']);
const AUDIENCES = new Set(['operador', 'admin', 'operador-admin', 'todos']);

function assert(condition, message) {
  if (!condition) throw new TypeError(message);
}

function srtTimestamp(seconds) {
  const totalMs = Math.max(0, Math.round(Number(seconds) * 1000));
  const hours = Math.floor(totalMs / 3600000);
  const minutes = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function escapeSubtitlePath(file) {
  const raw = String(file);
  const resolved = /^[A-Za-z]:[\\/]/.test(raw) ? raw : path.resolve(raw);
  return resolved
    .replaceAll('\\', '/')
    .replaceAll(':', '\\:')
    .replaceAll("'", "\\'");
}

export function validateTutorialCatalog(catalog) {
  assert(catalog && typeof catalog === 'object', 'tutorial catalog must be an object');
  assert(catalog.schemaVersion === 1, 'tutorial catalog schemaVersion must be 1');
  assert(Number.isFinite(catalog.maxDurationSec) && catalog.maxDurationSec > 0 && catalog.maxDurationSec <= 30, 'maxDurationSec must be <= 30');
  assert(Array.isArray(catalog.tutorials) && catalog.tutorials.length > 0, 'tutorials must be a non-empty array');

  const ids = new Set();
  const outputs = new Set();
  for (const tutorial of catalog.tutorials) {
    assert(/^\d{2}-[a-z0-9-]+$/.test(tutorial.id || ''), `invalid tutorial id: ${tutorial.id}`);
    assert(!ids.has(tutorial.id), `duplicate tutorial id: ${tutorial.id}`);
    ids.add(tutorial.id);

    assert(['P0', 'P1', 'P2', 'P3'].includes(tutorial.phase), `invalid phase for ${tutorial.id}`);
    assert(AUDIENCES.has(tutorial.audience), `invalid audience for ${tutorial.id}`);
    assert(Number.isFinite(tutorial.durationTargetSec) && tutorial.durationTargetSec > 0 && tutorial.durationTargetSec <= catalog.maxDurationSec, `invalid duration for ${tutorial.id}`);
    assert(typeof tutorial.goal === 'string' && tutorial.goal.trim(), `missing goal for ${tutorial.id}`);
    assert(typeof tutorial.success === 'string' && tutorial.success.trim(), `missing success for ${tutorial.id}`);

    assert(/^\d{2}-[a-z0-9-]+\.mp4$/.test(tutorial.outputFile || ''), `invalid output file for ${tutorial.id}`);
    assert(!outputs.has(tutorial.outputFile), `duplicate output file: ${tutorial.outputFile}`);
    outputs.add(tutorial.outputFile);

    assert(Array.isArray(tutorial.overlays) && tutorial.overlays.length >= 2 && tutorial.overlays.length <= 4, `use 2-4 overlays for ${tutorial.id}`);
    for (const overlay of tutorial.overlays) {
      assert(PURPOSES.has(overlay.purpose), `invalid overlay purpose for ${tutorial.id}`);
      assert(Number.isFinite(overlay.fromSec) && Number.isFinite(overlay.toSec), `invalid overlay timing for ${tutorial.id}`);
      assert(overlay.fromSec >= 0 && overlay.toSec > overlay.fromSec && overlay.toSec <= tutorial.durationTargetSec, `overlay outside duration for ${tutorial.id}`);
      assert(typeof overlay.text === 'string' && overlay.text.trim() && overlay.text.length <= 60, `overlay text must be 1-60 chars for ${tutorial.id}`);
    }
  }
  return true;
}

export function findTutorial(catalog, tutorialId) {
  validateTutorialCatalog(catalog);
  const tutorial = catalog.tutorials.find(item => item.id === tutorialId);
  if (!tutorial) throw new Error(`Unknown tutorial: ${tutorialId}`);
  return tutorial;
}

export function renderTutorialSrt(tutorial) {
  if (!tutorial || !Array.isArray(tutorial.overlays)) throw new TypeError('tutorial overlays are required');
  return tutorial.overlays.map((overlay, index) => [
    String(index + 1),
    `${srtTimestamp(overlay.fromSec)} --> ${srtTimestamp(overlay.toSec)}`,
    overlay.text.trim(),
    '',
  ].join('\n')).join('\n');
}

export function buildTutorialEditArgs(inputFile, outputFile, subtitleFile) {
  const subtitlePath = escapeSubtitlePath(subtitleFile);
  const filter = `subtitles='${subtitlePath}':force_style='Alignment=2,MarginV=48,FontSize=22,BorderStyle=3,Outline=1,Shadow=0'`;
  return [
    '-y', '-i', inputFile,
    '-vf', filter,
    '-c:v', 'libx264',
    '-preset', 'medium',
    '-crf', '20',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    '-c:a', 'copy',
    outputFile,
  ];
}
