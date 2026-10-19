import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('owner administration uses the existing PDV renderer, not a parallel sales app',()=>{
 const html=read('apps/web/index.html'),app=read('apps/web/app.js'),admin=read('apps/web/saas-admin-ui.js');
 assert.match(html,/src=".\/saas-admin-ui.js"/);
 assert.match(app,/profileKey:context.profileKey/);
 assert.match(app,/route==='saas-admin'/);
 assert.match(app,/state.user\?\.profileKey==='OWNER'/);
 assert.match(admin,/\/members\//);
 assert.match(admin,/\/invitations/);
 assert.match(admin,/\/subscription/);
 assert.match(admin,/\/auth\/sessions/);
 assert.doesNotMatch(admin,/PLATFORM_ADMIN_TOKEN|\/api\/v1\/platform|sessionStorage|localStorage/);
});
test('invite activation stays on same-origin login, not a URL token',()=>{
 const app=read('apps/web/app.js'),client=read('apps/web/api-client.js');
 assert.match(app,/id="web-invite-form"/);
 assert.match(app,/\/api\/v1\/auth\/register-invite/);
 assert.match(client,/\/api\/v1\/auth\/register-invite/);
 assert.doesNotMatch(read('apps/web/saas-admin-ui.js'),/\?token=|#token=/);
});
test('platform CLI requires private environment token and HTTPS outside localhost',()=>{
 const cli=read('scripts/saas-admin-cli.mjs');
 assert.match(cli,/PDV_TOTAL_BASE_URL/);
 assert.match(cli,/PLATFORM_ADMIN_TOKEN/);
 assert.match(cli,/url.protocol!=='https:'/);
 assert.match(cli,/\/api\/v1\/platform\/tenants/);
 assert.match(cli,/\/api\/v1\/auth\/session/);
 assert.doesNotMatch(cli,/localStorage|sessionStorage/);
});
