'use strict';
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function createTelemetryBackgroundHost({telemetry,httpSender=null,endpoint='',intervalMs=60000,setIntervalFn=setInterval,clearIntervalFn=clearInterval,shutdownTimeoutMs=500}={}){
 if(!telemetry?.record||!telemetry?.flush)throw new TypeError('telemetry obrigatoria.');let timer=null;let started=false;
 function start(){if(started)return false;started=true;telemetry.configureTransport?.({httpSender,defaultEndpoint:endpoint});telemetry.record('app_started',{});timer=setIntervalFn(()=>{void telemetry.flush();},intervalMs);timer?.unref?.();void telemetry.flush();return true;}
 async function stop(){if(!started)return false;started=false;if(timer)clearIntervalFn(timer);timer=null;telemetry.record('app_closed',{});await Promise.race([Promise.resolve(telemetry.flush()).catch(()=>{}),delay(shutdownTimeoutMs)]);return true;}
 return{start,stop,get started(){return started;}};
}
module.exports={createTelemetryBackgroundHost};
