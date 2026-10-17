import fs from 'node:fs/promises';
import path from 'node:path';
import { runQaFlow } from './runner.js';
import { resolveDemoPreset } from './manifest.js';
import { normalizeDemoVideo, probeMediaDuration } from './video.js';
import { writeJson } from './helpers.js';

export function buildDemoSummary({ qaSummary, demoName, preset, durationTargetSec, actualDurationSec, videoDurationSec, video }) {
  const timingDeviationSec = durationTargetSec == null ? null : Number((actualDurationSec - durationTargetSec).toFixed(3));
  return {
    schemaVersion: 1,
    runId: qaSummary.runId,
    systemId: qaSummary.systemId,
    demo: demoName,
    preset: preset.name,
    output: { width: preset.width, height: preset.height, video },
    durationTargetSec: durationTargetSec ?? null,
    actualDurationSec: Number(actualDurationSec.toFixed(3)),
    videoDurationSec: videoDurationSec == null ? null : Number(videoDurationSec.toFixed(3)),
    timingDeviationSec,
    demoProfile: qaSummary.demoProfile || null,
    status: qaSummary.status,
  };
}

export async function runDemoFlow({
  manifest,
  rootDir,
  environmentName,
  environment,
  demoName,
  demoFile,
  presetName,
  durationTargetSec,
  captureViewport,
  outputRoot = 'qa-artifacts',
  demoProfile = null,
  demoAdapter = null,
}) {
  const preset = resolveDemoPreset(presetName);
  const viewport = captureViewport
    ? { name: preset.name, width: captureViewport.width, height: captureViewport.height }
    : manifest.mode === 'electron'
      ? { name: preset.name, width: manifest.demoCaptureViewport?.width || 1440, height: manifest.demoCaptureViewport?.height || 900 }
      : { name: preset.name, ...preset.captureViewport };

  const started = Date.now();
  const demoManifest = {
    ...manifest,
    capture: { ...(manifest.capture || {}), screenshotEachStep: false },
  };
  const result = await runQaFlow({
    manifest: demoManifest,
    rootDir,
    environmentName,
    environment,
    flowName: `demo-${demoName}`,
    flowFile: demoFile,
    viewport,
    outputRoot,
    demoProfile,
    demoAdapter,
  });
  const actualDurationSec = (Date.now() - started) / 1000;
  const sourceVideo = result.summary.video ? path.join(result.outputDir, result.summary.video) : null;
  let normalizedVideo = null;
  let videoDurationSec = null;
  if (sourceVideo) {
    normalizedVideo = path.join(result.outputDir, 'demo-video.mp4');
    await normalizeDemoVideo(sourceVideo, normalizedVideo, preset, { durationTargetSec });
    videoDurationSec = await probeMediaDuration(normalizedVideo);
  }
  const summary = buildDemoSummary({
    qaSummary: result.summary,
    demoName,
    preset,
    durationTargetSec,
    actualDurationSec,
    videoDurationSec,
    video: normalizedVideo ? path.basename(normalizedVideo) : null,
  });
  await writeJson(path.join(result.outputDir, 'demo-summary.json'), summary);
  if (normalizedVideo) await fs.access(normalizedVideo);
  return { outputDir: result.outputDir, summary, qaSummary: result.summary };
}
