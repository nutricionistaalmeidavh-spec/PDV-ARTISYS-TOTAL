/** Explicitly wait for readiness instead of sleeping an arbitrary duration. */
export async function waitForHealth(url, { timeoutMs = 15000, intervalMs = 100, signal } = {}) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new TypeError('timeoutMs and intervalMs must be positive finite numbers');
  }
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([AbortSignal.timeout(Math.max(1, deadline - Date.now())), ...(signal ? [signal] : [])]),
      });
      await response.body?.cancel();
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) { lastError = error; }
    signal?.throwIfAborted();
    await new Promise(resolve => setTimeout(resolve, Math.min(intervalMs, Math.max(0, deadline - Date.now()))));
  }
  throw new Error(`Health check timed out for ${url}`, { cause: lastError });
}

/** Multiple isolated browser profiles talking to the same server. */
export async function withTerminals(browser, { count = 2, contextOptions = {} } = {}, run) {
  if (!Number.isInteger(count) || count < 1 || count > 16) throw new RangeError('count must be between 1 and 16');
  if (typeof run !== 'function') throw new TypeError('run callback required');
  const contexts = [];
  try {
    for (let i = 0; i < count; i++) contexts.push(await browser.newContext(contextOptions));
    const terminals = await Promise.all(contexts.map(async (context, index) => ({ index, context, page: await context.newPage() })));
    return await run(terminals);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
}

export { createQaConfig, VIEWPORTS, DEMO_PRESETS } from './config.js';
export { loadQaManifest, validateQaManifest, resolveEnvironment, resolveFlow, resolveViewport, resolveDemo, resolveDemoPreset, resolveDemoProfile } from './manifest.js';
export { loadDemoAdapter, validateDemoAdapter } from './adapters.js';
export { prepareDemoProfile, resetDemoProfile, getDemoProfileStatus, finalizeDemoProfile, resolveDemoCredentials } from './demo-profile.js';
export { createFixtureRegistry, resolveFixturePacks, listBuiltInFixturePacks } from './fixture-registry.js';
export { resolveFlowComposition, loadFlowFile, BUILTIN_FLOW_ROOT } from './flow-library.js';
export { redactSecrets, collectProfileSecretValues } from './redaction.js';
export { runQaFlow } from './runner.js';
export { runQaProfile } from './profile-runner.js';
export { resolveQaProfile, listQaProfiles } from './profiles.js';
export { BUSINESS_PACKS, listBusinessPacks, resolveBusinessPack } from './business-packs.js';
export { runDesktopSmoke } from './desktop.js';
export { retryTransient, runConcurrent } from './network.js';
export { aggregateQaReport, renderQaReportHtml, writeQaReport, readQaHistory } from './reporting.js';
export { buildCiQaSummary, writeCiQaSummary } from './ci-summary.js';
export { evaluateReleaseGate } from './release-gate.js';
export { DEFAULT_AGENT_PORT, DEFAULT_UPDATE_INTERVAL_MINUTES, DEFAULT_CONSOLE_PORT, defaultAgentRoot, agentStateFile, createDefaultAgentState, loadAgentState, saveAgentState, ensureAgentConsoleConfiguration, setAgentConsoleLan, configureAgentCloud, normalizeProjectRegistration, registerAgentProject, unregisterAgentProject, setAgentAutoUpdate } from './agent-state.js';
export { compareVersions, isNewerVersion, inactiveSlotName, normalizeWindowsCommand, readStableChannel, readInstalledVersion, validateCandidate, prepareInactiveSlot, checkForStableUpdate, rollbackAgentSlot, AGENT_RESTART_EXIT_CODE } from './agent-updater.js';
export { agentHealthFile, buildProjectRemoteCommand, writeAgentHealth, readAgentHealth, startAgentSupervisor } from './agent-supervisor.js';
export { ALLOWED_BRIDGE_ACTIONS, BRIDGE_JOB_ROOT, processedJobsFile, sanitizeJobOptions, validateBridgeJob, loadProcessedJobs, markBridgeJobProcessed, listPendingBridgeJobs } from './bridge-jobs.js';
export { DEFAULT_DRIVE_ROOT_FOLDER_ID, DEFAULT_BRIDGE_POLL_INTERVAL_SECONDS, ensureBridgeConfiguration, configureBridgeDrive, executeBridgeJob, bridgePollOnce, startBridgePolling } from './bridge-worker.js';
export { PROJECT_REGISTRY_PATH, managedProjectsRoot, normalizeManagedProject, readManagedProjectRegistry, syncManagedProjects } from './project-bootstrap.js';
export { buildDriveProjectPath, buildDriveRunPath, assertRcloneRemote, ensureDriveProjectFolder, uploadRunArtifacts } from './drive-uploader.js';
export { runDemoFlow, buildDemoSummary } from './demo.js';
export { executeStep } from './steps.js';
export { normalizeDemoVideo, buildNormalizeArgs } from './video.js';
export { attachPageTelemetry } from './telemetry.js';
export { ACTIVE_JOB_STAGES, TERMINAL_JOB_STAGES, JOB_STAGES, createTelemetryStore } from './telemetry-store.js';
export { createCloudTelemetryMirror, createTelemetryFanout } from './cloud-observability.js';
export { createAgentConsole } from './agent-console.js';
export { scanQaArtifacts } from './artifact-index.js';
export { QA_PROGRESS_PREFIX, formatQaProgressEvent, createQaProgressParser } from './progress-protocol.js';
export { sanitizeName, resolveSecret, stepLabel } from './helpers.js';
export { createQaRemoteControl } from './remote-control.js';
export { buildQaMatrix, runQaMatrix } from './matrix.js';
export { runApiSweep } from './api-sweep.js';
export { runUiSweep } from './ui-sweep.js';
export { runCrosscutContracts } from './crosscut-runner.js';
export { buildModuleContractPlan, validateModuleProbeConfig } from './module-contracts.js';
export { runRendererHealthContract } from './contracts/renderer-health.js';
export { evaluateProductGate, buildProductQaSummary, renderProductQaText, renderProductQaHtml, writeProductQaBundle } from './product-report.js';
