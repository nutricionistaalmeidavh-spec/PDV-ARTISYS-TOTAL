import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium, _electron as electron } from 'playwright';
import { attachPageTelemetry } from './telemetry.js';
import { executeStep } from './steps.js';
import { createFrameRecorder } from './video.js';
import { startConsumerProcess } from './process.js';
import { ensureDir, sanitizeName, writeJson } from './helpers.js';
import { loadFlowFile, resolveFlowComposition } from './flow-library.js';
import { prepareDemoProfile, finalizeDemoProfile } from './demo-profile.js';
import { collectProfileSecretValues, redactSecrets } from './redaction.js';

function runId({ systemId, flowName, viewportName }) {
  return `${sanitizeName(systemId)}-${sanitizeName(flowName)}-${sanitizeName(viewportName || 'viewport')}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function profileRuntimeContext({ manifest, rootDir, environmentName, environment, demoProfile, preparedProfile }) {
  return {
    manifest,
    rootDir,
    environmentName,
    environment,
    profile: demoProfile,
    credentials: preparedProfile?.credentials || {},
    account: preparedProfile?.account || null,
    workspace: preparedProfile?.workspace || null,
    fixtures: preparedProfile?.fixtures || [],
    vars: {},
  };
}

export async function runQaFlow({
  manifest,
  rootDir,
  environmentName,
  environment,
  flowName,
  flowFile,
  viewport,
  outputRoot = 'qa-artifacts',
  demoProfile = null,
  demoAdapter = null,
  onProgress = null,
}) {
  const notify = async event => {
    try { await onProgress?.(event); } catch {}
  };
  const id = runId({ systemId: manifest.systemId, flowName, viewportName: viewport.name });
  const outputDir = path.resolve(outputRoot, id);
  const screenshotsDir = await ensureDir(path.join(outputDir, 'screenshots'));
  const traceFile = path.join(outputDir, 'trace.zip');
  const telemetry = [];
  const stepsLog = [];
  const startedAt = new Date().toISOString();
  const loaded = await loadFlowFile(flowFile);
  const flow = await resolveFlowComposition(loaded.flow, { rootDir, sourceFile: loaded.file });
  const runtimeEnv = {
    ...process.env,
    ...(manifest.electron?.env || {}),
    ...(environment.env || {}),
    ...(flow.metadata?.qaAutoAdmin === true ? { ARTISYS_QA_AUTO_ADMIN:'1' } : {}),
  };
  const profileSecretValues = demoProfile ? collectProfileSecretValues(demoProfile, process.env) : [];
  let status = 'passed';
  let failure = null;
  let browser;
  let context;
  let page;
  let electronApp;
  let frameRecorder;
  let frameRecorderStarted = false;
  let nativeVideo;
  let consumerProcess;
  let videoFile = null;
  let preparedProfile = null;

  await notify({ type: 'flow-runtime-start', flow: flowName, total: flow.steps.length });
  try {
    if (demoProfile) {
      if (!demoAdapter) throw new Error('Demo profile requires a demo adapter');
      preparedProfile = await prepareDemoProfile({
        profile: demoProfile,
        adapter: demoAdapter,
        env: process.env,
        context: { manifest, rootDir, environmentName, environment },
      });
    }

    if (environment.startCommand) {
      consumerProcess = await startConsumerProcess({
        command: environment.startCommand,
        cwd: rootDir,
        env: environment.env,
        readyUrl: environment.readyUrl,
        timeoutMs: environment.readyTimeoutMs || 30000,
      });
    }

    if (manifest.mode === 'electron') {
      const entry = path.resolve(rootDir, manifest.electron.entry);
      const executablePath = manifest.electron.executablePath ? path.resolve(rootDir, manifest.electron.executablePath) : undefined;
      electronApp = await electron.launch({
        args: [entry, ...(manifest.electron.args || [])],
        executablePath,
        cwd: rootDir,
        env: runtimeEnv,
        timeout: manifest.launchTimeoutMs || 30000,
      });
      context = electronApp.context();
      context.setDefaultTimeout(manifest.actionTimeoutMs || 15000);
      context.setDefaultNavigationTimeout(manifest.navigationTimeoutMs || 30000);
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      page = await electronApp.firstWindow();
      await page.setViewportSize({ width: viewport.width, height: viewport.height }).catch(() => {});
      if (manifest.capture?.video !== false) {
        frameRecorder = createFrameRecorder(page, { dir: path.join(outputDir, '.video-frames'), fps: manifest.capture?.fps || 4 });
      }
    } else {
      browser = await chromium.launch({ headless: manifest.headless ?? true });
      context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        recordVideo: manifest.capture?.video === false ? undefined : { dir: path.join(outputDir, '.native-video'), size: { width: viewport.width, height: viewport.height } },
        storageState: environment.storageState ? path.resolve(rootDir, environment.storageState) : undefined,
      });
      context.setDefaultTimeout(manifest.actionTimeoutMs || 15000);
      context.setDefaultNavigationTimeout(manifest.navigationTimeoutMs || 30000);
      await context.tracing.start({ screenshots: true, snapshots: true, sources: true });
      page = await context.newPage();
      nativeVideo = page.video?.() || null;
    }

    attachPageTelemetry(page, telemetry);
    if (environment.baseURL && manifest.mode === 'web' && flow.autoGoto !== false) {
      await page.goto(environment.baseURL, { waitUntil: flow.waitUntil || 'domcontentloaded' });
    }

    const runtimeContext = profileRuntimeContext({ manifest, rootDir, environmentName, environment, demoProfile, preparedProfile });
    for (let index = 0; index < flow.steps.length; index++) {
      const step = flow.steps[index];
      const stepName = step.name || step.action;
      const stepStart = Date.now();
      await notify({ type: 'step-start', flow: flowName, step: stepName, current: index + 1, total: flow.steps.length });
      try {
        const label = await executeStep({
          page,
          step,
          index,
          screenshotsDir,
          baseURL: environment.baseURL,
          env: runtimeEnv,
          adapter: demoAdapter,
          electronApp,
          runtimeContext,
        });
        if (manifest.capture?.screenshotEachStep) {
          await page.screenshot({ path: path.join(screenshotsDir, `${label}-after.png`), fullPage: false });
        }
        const rendererPageError = telemetry.find(event => event?.type === 'pageerror');
        if (rendererPageError) {
          throw new Error(`Renderer page error: ${rendererPageError.message || 'unknown renderer exception'}`);
        }
        stepsLog.push({ index, action: step.action, name: step.name || null, status: 'passed', durationMs: Date.now() - stepStart });
        await notify({ type: 'step-end', flow: flowName, step: stepName, status: 'passed', current: index + 1, total: flow.steps.length });
        if (!frameRecorderStarted && frameRecorder && ['authenticated','app-ready'].includes(step.name)) {
          frameRecorderStarted = true;
          await frameRecorder.start();
        }
      } catch (error) {
        stepsLog.push({ index, action: step.action, name: step.name || null, status: 'failed', durationMs: Date.now() - stepStart, error: error.message });
        await notify({ type: 'step-end', flow: flowName, step: stepName, status: 'failed', current: index + 1, total: flow.steps.length, error: error.message });
        throw error;
      }
    }

    if (preparedProfile) {
      await finalizeDemoProfile({
        profile: demoProfile,
        adapter: demoAdapter,
        prepared: preparedProfile,
        context: runtimeContext,
      });
    }
  } catch (error) {
    status = 'failed';
    failure = { message: error.message, stack: error.stack };
    if (page) await page.screenshot({ path: path.join(screenshotsDir, 'failure.png'), fullPage: false }).catch(() => {});
  } finally {
    if (context) await context.tracing.stop({ path: traceFile }).catch(() => {});
    if (frameRecorder) videoFile = await frameRecorder.stop(path.join(outputDir, 'video.mp4'));
    if (electronApp) await electronApp.close().catch(() => {});
    if (manifest.mode === 'web' && context) await context.close().catch(() => {});
    if (nativeVideo) {
      try {
        videoFile = path.join(outputDir, 'video.webm');
        await nativeVideo.saveAs(videoFile);
      } catch {
        videoFile = null;
      }
    }
    if (browser) await browser.close().catch(() => {});
    if (consumerProcess) {
      const processLog = redactSecrets(consumerProcess.logs.join(''), profileSecretValues);
      await fs.writeFile(path.join(outputDir, 'process.log'), processLog, 'utf8').catch(() => {});
      await consumerProcess.stop().catch(() => {});
    }
    await fs.rm(path.join(outputDir, '.native-video'), { recursive: true, force: true }).catch(() => {});
  }

  if (status === 'passed') {
    const rendererPageError = telemetry.find(event => event?.type === 'pageerror');
    if (rendererPageError) {
      status = 'failed';
      failure = {
        message: `Renderer page error: ${rendererPageError.message || 'unknown renderer exception'}`,
        stack: rendererPageError.stack || null,
      };
    }
  }

  const summary = redactSecrets({
    schemaVersion: 1,
    runId: id,
    systemId: manifest.systemId,
    mode: manifest.mode,
    environment: environmentName,
    flow: flowName,
    viewport: { width: viewport.width, height: viewport.height, name: viewport.name || null },
    status,
    startedAt,
    finishedAt: new Date().toISOString(),
    video: videoFile ? path.relative(outputDir, videoFile) : null,
    trace: 'trace.zip',
    screenshots: 'screenshots',
    telemetryCount: telemetry.length,
    demoProfile: preparedProfile?.metadata || null,
    steps: stepsLog,
    failure,
  }, profileSecretValues);
  const safeTelemetry = redactSecrets(telemetry, profileSecretValues);
  await writeJson(path.join(outputDir, 'telemetry.json'), safeTelemetry);
  await writeJson(path.join(outputDir, 'run-summary.json'), summary);
  await notify({ type: 'flow-runtime-end', flow: flowName, status, total: flow.steps.length, completed: stepsLog.length });
  if (status !== 'passed') {
    const error = new Error(`QA flow failed: ${manifest.systemId}/${flowName}`);
    error.summary = summary;
    throw error;
  }
  return { outputDir, summary };
}
