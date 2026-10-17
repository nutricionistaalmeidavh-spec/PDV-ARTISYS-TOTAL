'use strict';

const path = require('node:path');
const { createPdvRuntime } = require('../js/core/pdv-runtime');
const { createLocalServer } = require('./local-server');
const { createTelemetryHttpSender } = require('../js/core/telemetry/telemetry-http-sender');
const { createTelemetryBackgroundHost } = require('../js/core/telemetry/telemetry-host');

function resolveServerConfig(env = process.env, cwd = process.cwd()) {
  const host = String(env.PDV_HOST || '127.0.0.1').trim();
  const port = Number(env.PDV_PORT || 4174);
  const token = String(env.PDV_INSTALL_TOKEN || '').trim();
  const dbPath = path.resolve(env.PDV_DB_PATH || path.join(cwd, 'data', 'pdv-artisys.sqlite'));
  const allowedOrigins = String(env.PDV_ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
  const telemetryEndpoint = String(env.PDV_TELEMETRY_ENDPOINT || '').trim();
  const telemetryToken = String(env.PDV_TELEMETRY_INGEST_TOKEN || '').trim();
  const releaseId = String(env.PDV_RELEASE_ID || env.PDV_APP_VERSION || 'dev').trim();
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PDV_PORT deve ser um inteiro entre 1 e 65535.');
  const isLoopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (!isLoopback && !token) throw new Error('PDV_INSTALL_TOKEN e obrigatorio quando o servidor aceita conexoes LAN.');
  return { host, port, token, dbPath, allowedOrigins, requireTerminalAuth:!isLoopback, telemetryEndpoint, telemetryToken, releaseId };
}

function createServerFromEnvironment(env = process.env, cwd = process.cwd()) {
  const config = resolveServerConfig(env, cwd);
  const appVersion=env.PDV_APP_VERSION || '1.0.0';
  const runtime = createPdvRuntime({ dbPath: config.dbPath, appVersion, serverVersion:appVersion });
  const credentialStore={load:()=>config.telemetryToken||null,save(){throw new Error('Servidor headless nao persiste credencial automaticamente.');},remove(){}};
  const telemetrySender=config.telemetryEndpoint&&config.telemetryToken?createTelemetryHttpSender({endpoint:config.telemetryEndpoint,credentialStore,allowRegistration:false}):null;
  const server = createLocalServer({ runtime, host: config.host, port: config.port, token: config.token, allowedOrigins: config.allowedOrigins, requireTerminalAuth:config.requireTerminalAuth, telemetrySender, telemetryEndpoint:config.telemetryEndpoint, telemetryReleaseId:config.releaseId });
  const telemetryHost=createTelemetryBackgroundHost({telemetry:runtime.telemetry,httpSender:telemetrySender,endpoint:config.telemetryEndpoint});
  return { config, runtime, server, async start(){telemetryHost.start();return server.start();}, async stop(){try{await telemetryHost.stop();await server.stop();}finally{runtime.close();}} };
}

async function main() {
  const service = createServerFromEnvironment();const address = await service.start();console.log(`PDV ArtiSys Local Server: http://${address.host}:${address.port}/api/v1/health`);
  let stopping=false;const shutdown=async()=>{if(stopping)return;stopping=true;try{await service.stop();process.exitCode=0;}catch(error){console.error(error);process.exitCode=1;}};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={resolveServerConfig,createServerFromEnvironment};
