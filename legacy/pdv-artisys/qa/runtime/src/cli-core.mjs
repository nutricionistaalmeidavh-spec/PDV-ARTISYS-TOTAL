#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { loadQaManifest, resolveEnvironment, resolveFlow, resolveViewport, resolveDemo, resolveDemoProfile } from './manifest.js';
import { loadDemoAdapter } from './adapters.js';
import { prepareDemoProfile, resetDemoProfile, getDemoProfileStatus } from './demo-profile.js';
import { runQaFlow } from './runner.js';
import { runQaProfile } from './profile-runner.js';
import { listQaProfiles } from './profiles.js';
import { readQaHistory } from './reporting.js';
import { runDemoFlow } from './demo.js';
import { createQaRemoteControl } from './remote-control.js';
import { formatQaProgressEvent } from './progress-protocol.js';

function parseArgs(argv) {
  const [command = 'run', ...rest] = argv;
  const args = { command, positional: [] };
  for (let i = 0; i < rest.length; i++) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      args.positional.push(token);
      continue;
    }
    const key = token.slice(2);
    const value = rest[i + 1] && !rest[i + 1].startsWith('--') ? rest[++i] : true;
    args[key] = value;
  }
  return args;
}

function usage() {
  console.log(`ArtiSys QA\n\nCommands:\n  validate --config qa/artisys-qa.config.json\n  list --config qa/artisys-qa.config.json\n  run --config qa/artisys-qa.config.json [--flow name] [--profile default] [--environment name] [--viewport desktop|tablet|mobile] [--output qa-artifacts]\n  quick --config qa/artisys-qa.config.json [--environment name] [--viewport desktop|tablet|mobile] [--output qa-artifacts]\n  full --config qa/artisys-qa.config.json [--environment name] [--viewport desktop|tablet|mobile] [--output qa-artifacts]\n  release --config qa/artisys-qa.config.json [--environment name] [--viewport desktop|tablet|mobile] [--output qa-artifacts] [--override-release-gate --override-reason reason]\n  remote --config qa/artisys-qa.config.json [--host 127.0.0.1|0.0.0.0] [--port 4173] [--token secret] [--profile default] [--output qa-artifacts]\n  demo --config qa/artisys-qa.config.json [--demo quick-30s] [--profile default] [--preset reels-9x16] [--environment name] [--output qa-artifacts]\n  demo-profile prepare|reset|status --config qa/artisys-qa.config.json [--profile default] [--environment name]`);
}

function progressLog(event) {
  try { console.log(formatQaProgressEvent(event)); } catch {}
}

async function resolveProfileRuntime(manifest, rootDir, requestedProfile) {
  const profile = resolveDemoProfile(manifest, requestedProfile, rootDir);
  if (!profile) return { demoProfile: null, demoAdapter: null };
  return { demoProfile: profile, demoAdapter: await loadDemoAdapter(profile.adapterPath) };
}

function remoteMeta(manifest) {
  const flows = Object.keys(manifest.flows || {});
  const environments = Object.keys(manifest.environments || {});
  if (!flows.length) throw new Error('Remote control requires at least one QA flow');
  return {
    systemId: manifest.systemId,
    flows,
    profiles: listQaProfiles(manifest),
    environments,
    viewports: ['desktop', 'tablet', 'mobile'],
    defaults: {
      flow: manifest.defaultFlow || flows[0],
      environment: manifest.defaultEnvironment || environments[0],
      viewport: typeof manifest.defaultViewport === 'string' ? manifest.defaultViewport : 'desktop',
    },
  };
}

function lanUrls(port) {
  const urls = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal) urls.push(`http://${entry.address}:${port}`);
    }
  }
  return [...new Set(urls)];
}

async function runNamedProfile({ profileName, args, manifest, rootDir }) {
  const profileRuntime = await resolveProfileRuntime(manifest, rootDir, args.profile);
  const outputRoot = args.output ? path.resolve(String(args.output)) : path.resolve('qa-artifacts');
  const result = await runQaProfile({
    manifest,
    rootDir,
    profileName,
    environment: args.environment,
    viewport: args.viewport,
    outputRoot,
    ...profileRuntime,
    releaseOverride: args['override-release-gate'] === true,
    releaseOverrideReason: args['override-reason'] === true ? null : args['override-reason'],
    onProgress: progressLog,
  });
  console.log(JSON.stringify({ profile: result.profile.name, gate: result.gate, counts: result.report.counts }, null, 2));
  console.log(`ARTISYS_QA_REPORT=${result.jsonFile}`);
  return result;
}

async function runRemoteServer({ args, manifest, rootDir }) {
  const host = args.host === true || !args.host ? '127.0.0.1' : String(args.host);
  const port = args.port === true || !args.port ? 4173 : Number(args.port);
  const token = args.token === true
    ? randomBytes(24).toString('hex')
    : args.token || process.env.ARTISYS_QA_REMOTE_TOKEN || randomBytes(24).toString('hex');
  const outputRoot = args.output ? path.resolve(String(args.output)) : path.resolve('qa-artifacts');
  const meta = remoteMeta(manifest);

  const control = createQaRemoteControl({
    host,
    port,
    token,
    meta,
    getHistory: () => readQaHistory(outputRoot),
    runJob: async request => {
      const profileRuntime = await resolveProfileRuntime(manifest, rootDir, args.profile);
      if (request.profile) {
        const result = await runQaProfile({
          manifest,
          rootDir,
          profileName: request.profile,
          environment: request.environment,
          viewport: request.viewport,
          outputRoot,
          ...profileRuntime,
        });
        return { profile: result.profile.name, gate: result.gate, counts: result.report.counts, report: result.jsonFile };
      }
      const { name: environmentName, environment } = resolveEnvironment(manifest, request.environment);
      const { name: flowName, file: flowFile } = resolveFlow(manifest, request.flow, rootDir);
      const viewport = resolveViewport(manifest, request.viewport);
      const result = await runQaFlow({
        manifest,
        rootDir,
        environmentName,
        environment,
        flowName,
        flowFile,
        viewport,
        outputRoot,
        ...profileRuntime,
      });
      return { summary: result.summary, outputDir: result.outputDir };
    },
  });

  const started = await control.start();
  console.log(`ArtiSys QA Remote Control: ${started.baseURL}`);
  if (host === '0.0.0.0' || host === '::') {
    for (const url of lanUrls(started.port)) console.log(`LAN: ${url}`);
  }
  console.log(`TOKEN=${started.token}`);
  console.log('Press Ctrl+C to stop. GitHub Actions remains available independently.');

  await new Promise(resolve => {
    const stop = () => resolve();
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
  await control.close();
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.command === 'help') {
  usage();
  process.exit(0);
}

if (!args.config) {
  console.error('Missing --config');
  usage();
  process.exit(2);
}

try {
  const { manifest, rootDir } = await loadQaManifest(args.config);
  if (args.command === 'validate') {
    console.log(`valid ${manifest.systemId} (${manifest.mode})`);
  } else if (args.command === 'list') {
    const profileNames = manifest.demoProfiles
      ? Object.keys(manifest.demoProfiles)
      : manifest.demoProfile
        ? [manifest.demoProfile.id || 'default']
        : [];
    console.log(JSON.stringify({
      systemId: manifest.systemId,
      mode: manifest.mode,
      environments: Object.keys(manifest.environments),
      flows: Object.keys(manifest.flows || {}),
      qaProfiles: listQaProfiles(manifest),
      demos: Object.keys(manifest.demos || {}),
      demoProfiles: profileNames,
      viewports: ['desktop', 'tablet', 'mobile'],
      demoPresets: ['landscape-16x9', 'square-1x1', 'reels-9x16'],
    }, null, 2));
  } else if (args.command === 'demo-profile') {
    const operation = args.positional[0] || 'status';
    if (!['prepare', 'reset', 'status'].includes(operation)) throw new Error(`Unknown demo-profile operation: ${operation}`);
    const profile = resolveDemoProfile(manifest, args.profile, rootDir);
    if (!profile) throw new Error('No demo profile configured');
    const adapter = await loadDemoAdapter(profile.adapterPath);
    const { name: environmentName, environment } = resolveEnvironment(manifest, args.environment);
    const context = { manifest, rootDir, environmentName, environment };
    let result;
    if (operation === 'prepare') {
      const prepared = await prepareDemoProfile({ profile, adapter, env: process.env, context });
      result = prepared.metadata;
    } else if (operation === 'reset') {
      result = await resetDemoProfile({ profile, adapter, env: process.env, context });
    } else {
      result = await getDemoProfileStatus({ profile, adapter, env: process.env, context });
    }
    console.log(JSON.stringify(result, null, 2));
  } else if (args.command === 'run') {
    const { name: environmentName, environment } = resolveEnvironment(manifest, args.environment);
    const { name: flowName, file: flowFile } = resolveFlow(manifest, args.flow, rootDir);
    const viewport = resolveViewport(manifest, args.viewport);
    const profileRuntime = await resolveProfileRuntime(manifest, rootDir, args.profile);
    progressLog({ type: 'flow-start', flow: flowName, current: 1, total: 1 });
    const result = await runQaFlow({
      manifest,
      rootDir,
      environmentName,
      environment,
      flowName,
      flowFile,
      viewport,
      outputRoot: args.output ? path.resolve(args.output) : path.resolve('qa-artifacts'),
      ...profileRuntime,
      onProgress: progressLog,
    });
    progressLog({ type: 'flow-end', flow: flowName, status: 'passed', current: 1, total: 1 });
    console.log(JSON.stringify(result.summary, null, 2));
    console.log(`ARTISYS_QA_OUTPUT=${result.outputDir}`);
  } else if (['quick', 'full', 'release'].includes(args.command)) {
    await runNamedProfile({ profileName: args.command, args, manifest, rootDir });
  } else if (args.command === 'remote') {
    await runRemoteServer({ args, manifest, rootDir });
  } else if (args.command === 'demo') {
    const { name: environmentName, environment } = resolveEnvironment(manifest, args.environment);
    const demo = resolveDemo(manifest, args.demo, rootDir);
    const profileRuntime = await resolveProfileRuntime(manifest, rootDir, args.profile);
    progressLog({ type: 'flow-start', flow: `demo:${demo.name}`, current: 1, total: 1 });
    const result = await runDemoFlow({
      manifest,
      rootDir,
      environmentName,
      environment,
      demoName: demo.name,
      demoFile: demo.file,
      presetName: args.preset || demo.preset,
      durationTargetSec: demo.durationTargetSec,
      captureViewport: demo.captureViewport,
      outputRoot: args.output ? path.resolve(args.output) : path.resolve('qa-artifacts'),
      ...profileRuntime,
    });
    progressLog({ type: 'flow-end', flow: `demo:${demo.name}`, status: 'passed', current: 1, total: 1 });
    console.log(JSON.stringify(result.summary, null, 2));
    console.log(`ARTISYS_QA_OUTPUT=${result.outputDir}`);
  } else {
    throw new Error(`Unknown command: ${args.command}`);
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  process.exit(1);
}
