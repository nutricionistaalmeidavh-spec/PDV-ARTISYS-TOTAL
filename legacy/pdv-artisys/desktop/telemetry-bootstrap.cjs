'use strict';
const {app,safeStorage}=require('electron');
const {onRuntimeTelemetryAttached}=require('../js/core/telemetry/telemetry-runtime');
const {createTelemetryCredentialStore}=require('./telemetry-credentials.cjs');
const {createTelemetryHttpSender}=require('../js/core/telemetry/telemetry-http-sender');
const {createTelemetryBackgroundHost}=require('../js/core/telemetry/telemetry-host');
let host=null;
const unsubscribe=onRuntimeTelemetryAttached(telemetry=>{
 if(host)return;const endpoint=String(process.env.PDV_TELEMETRY_ENDPOINT||'').trim();const credentialStore=createTelemetryCredentialStore({app,safeStorage});const sender=createTelemetryHttpSender({endpoint,credentialStore});host=createTelemetryBackgroundHost({telemetry,httpSender:sender,endpoint});host.start();
});
app.on('before-quit',()=>{unsubscribe();if(host)void host.stop();});
module.exports={};
