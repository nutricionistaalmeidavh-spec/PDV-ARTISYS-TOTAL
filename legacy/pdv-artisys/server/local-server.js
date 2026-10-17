'use strict';
const http=require('node:http');
const { createRouter }=require('./router');
const { createSetupAccountRouter }=require('./setup-account-router');
const { createAuthSessionRouter }=require('./auth-session-router');
const { createPasswordRecoveryRouter }=require('./password-recovery-router');
const { createCatalogManagementRouter }=require('./catalog-management-router');
const { createReturnApprovalStore }=require('./return-approval-store');
const { createReturnAuthorizationRouter }=require('./return-authorization-router');
const { createReceiptRouter }=require('./receipt-router');
const { createRestaurantRouter }=require('./restaurant-router');
const { createPublicOrderingRouter }=require('./public-ordering-router');
const { createE48E54Router }=require('./e48-e54-router');
const { createKitComboRouter }=require('./kit-combo-router');
const { createProductVariantRouter }=require('./product-variant-router');
const { createVerticalRouter }=require('./vertical-router');
const { createEnterpriseDepthRouter }=require('./enterprise-depth-router');
const { createWholesaleRouter }=require('./wholesale-router');
const { createCheckoutDocumentRouter }=require('./checkout-document-router');
const { createErpFinanceRouter }=require('./erp-finance-router');
const { createTelemetryRouter }=require('./telemetry-router');
const { createAccessControlRouter }=require('./access-control-router');
const { attachRuntimeTelemetry }=require('../js/core/telemetry/telemetry-runtime');
const { registerTelemetryEffects }=require('../js/core/telemetry/telemetry-effects');
const { observeTelemetryResponse }=require('../js/core/telemetry/telemetry-http');
function createLocalServer({runtime,host='127.0.0.1',port=4174,token='',bodyLimitBytes=1024*1024,allowedOrigins=[],requireTerminalAuth=false,isExistingInstall=true,returnApprovalStore=null,telemetrySender=null,telemetryEndpoint='',telemetryReleaseId=''}={}){
  const telemetry=attachRuntimeTelemetry({runtime,httpSender:telemetrySender,defaultEndpoint:telemetryEndpoint,releaseId:telemetryReleaseId});
  registerTelemetryEffects({bus:runtime.bus,telemetry});
  const sessionStore=new Map();
  const erpFinanceHandler=createErpFinanceRouter({runtime,sessionStore,bodyLimitBytes,requireTerminalAuth});
  const approvalStore=returnApprovalStore||createReturnApprovalStore();
  const setupAccountHandler=createSetupAccountRouter({runtime,installationToken:token,bodyLimitBytes});
  const authSessionHandler=createAuthSessionRouter({runtime,sessionStore,requireTerminalAuth});
  const passwordRecoveryHandler=createPasswordRecoveryRouter({runtime,sessionStore,bodyLimitBytes});
  const catalogManagementHandler=createCatalogManagementRouter({runtime,sessionStore,requireTerminalAuth,bodyLimitBytes});
  const accessControlHandler=createAccessControlRouter({runtime,sessionStore,requireTerminalAuth,bodyLimitBytes});
  const telemetryHandler=createTelemetryRouter({runtime,sessionStore,requireTerminalAuth});
  const returnAuthorizationHandler=createReturnAuthorizationRouter({runtime,sessionStore,approvalStore,bodyLimitBytes,requireTerminalAuth});
  const receiptHandler=createReceiptRouter({runtime,sessionStore,isExistingInstall});
  const publicOrderingHandler=createPublicOrderingRouter({runtime});
  const restaurantHandler=createRestaurantRouter({runtime,installationToken:token,requireTerminalAuth});
  const finalVerticalHandler=createE48E54Router({runtime,installationToken:token,requireTerminalAuth,sessionStore});
  const kitComboHandler=createKitComboRouter({runtime,installationToken:token,requireTerminalAuth});
  const productVariantHandler=createProductVariantRouter({runtime,installationToken:token,requireTerminalAuth});
  const verticalHandler=createVerticalRouter({runtime,installationToken:token,requireTerminalAuth,sessionStore});
  const enterpriseDepthHandler=createEnterpriseDepthRouter({runtime,installationToken:token,requireTerminalAuth,sessionStore});
  const wholesaleHandler=createWholesaleRouter({runtime,requireTerminalAuth,sessionStore});
  const checkoutDocumentHandler=createCheckoutDocumentRouter({runtime,requireTerminalAuth,sessionStore});
  const handler=createRouter({runtime,installationToken:token,bodyLimitBytes,allowedOrigins,requireTerminalAuth,sessionStore});let server=null;
  async function route(req,res){let handled=await publicOrderingHandler(req,res);if(!handled)handled=Boolean(runtime.lanReachability?.handle(req,res));if(!handled)handled=await erpFinanceHandler(req,res);if(!handled)handled=await setupAccountHandler(req,res);if(!handled)handled=await passwordRecoveryHandler(req,res);if(!handled)handled=await authSessionHandler(req,res);if(!handled)handled=await catalogManagementHandler(req,res);if(!handled)handled=await accessControlHandler(req,res);if(!handled)handled=await telemetryHandler(req,res);if(!handled)handled=await returnAuthorizationHandler(req,res);if(!handled)handled=await receiptHandler(req,res);if(!handled)handled=await restaurantHandler(req,res);if(!handled)handled=await finalVerticalHandler(req,res);if(!handled)handled=await kitComboHandler(req,res);if(!handled)handled=await productVariantHandler(req,res);if(!handled)handled=await verticalHandler(req,res);if(!handled)handled=await checkoutDocumentHandler(req,res);if(!handled)handled=await wholesaleHandler(req,res);if(!handled)handled=await enterpriseDepthHandler(req,res);if(!handled)await handler(req,res);}
  async function start(){if(server)throw new Error('Servidor local ja iniciado.');server=http.createServer((req,res)=>{let routeError=null;observeTelemetryResponse({request:req,response:res,telemetry,errorProvider:()=>routeError});Promise.resolve(route(req,res)).catch(error=>{routeError=error;if(!res.headersSent){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:error.message}));}else res.end();});});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});const address=server.address();return{host:typeof address==='object'&&address?address.address:host,port:typeof address==='object'&&address?address.port:port};}
  async function stop(){if(!server)return;const current=server;server=null;await new Promise((resolve,reject)=>current.close(error=>error?reject(error):resolve()));}
  return{start,stop,get running(){return Boolean(server);}};
}
module.exports={createLocalServer};