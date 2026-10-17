'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ROOT=path.join(__dirname,'..');
const read=(rel)=>fs.readFileSync(path.join(ROOT,rel),'utf8');

test('first access UI creates administrator and signs in without a second credential prompt',()=>{
  const ui=read('desktop/renderer/first-access-ui.js');
  const index=read('desktop/renderer/index.html');
  assert.match(index,/first-access-ui\.js/);
  assert.match(ui,/Primeiro acesso ao ArtiSys/);
  assert.match(ui,/name="email"/);
  assert.match(ui,/name="passwordConfirm"/);
  assert.match(ui,/Criar administrador e entrar/);
  const setupSection=ui.slice(ui.indexOf('function renderFirstAccess'),ui.indexOf('function renderActivation'));
  const confirmation=setupSection.indexOf("overlay.querySelector('#continue-after-key').addEventListener('click'");
  assert.ok(setupSection.indexOf('await api.setupAdmin')>=0);
  assert.ok(setupSection.indexOf('Guarde sua chave de recuperação')>setupSection.indexOf('await api.setupAdmin'));
  assert.ok(confirmation>setupSection.indexOf('Guarde sua chave de recuperação'));
  assert.ok(setupSection.indexOf('await api.login')>confirmation,'login waits for explicit recovery-key confirmation');
  assert.match(setupSection,/copy-recovery-key/);
  assert.match(setupSection,/const licensedEmail = String\(prefillEmail \|\| ''\)\.trim\(\)/);
  assert.match(setupSection,/licensedEmail \? 'required readonly' : ''/);
  assert.match(setupSection,/const email = licensedEmail \|\| String\(values\.get\('email'\)/);
  assert.match(setupSection,/download-recovery-key/);
  assert.match(ui,/window\.location\.reload\(\)/);
  assert.doesNotMatch(ui,/Administrador criado\. Entre com seus dados\./);
  assert.match(ui,/PdvUiLifecycle/);
  assert.match(ui,/auth:rendered/);
  assert.doesNotMatch(ui,/new MutationObserver\b/);
});

test('new first access routes through commercial activation when required and preserves local recovery',()=>{
  const ui=read('desktop/renderer/first-access-ui.js');
  const controller=ui.slice(ui.indexOf('async function syncAuthOverlay'));
  assert.match(controller,/if \(setup\.activation\?\.required\) renderActivation\(\{ continueToSetup:true \}\)/);
  assert.match(controller,/else renderFirstAccess\(setup\.activation\?\.activation\?\.accountEmail \|\| ''\)/);
  assert.match(controller,/addEventListener\('click',\s*renderLocalRecovery\)/);
  assert.match(ui,/Ativar instalação/);
  assert.match(ui,/Código de ativação/);
  assert.match(ui,/const activation = await api\.verifySetupActivation\(email, code\)/);
  assert.match(ui,/if \(continueToSetup\) renderFirstAccess\(activation\?\.accountEmail \|\| email\)/);
  assert.match(controller,/setup\?\.activation\?\.required[\s\S]{0,100}renderActivation\(\{ continueToSetup:false \}\)/);
  assert.match(ui,/recuperação é local e não precisa de e-mail ou internet/);
  assert.match(ui,/Recuperação comercial por e-mail/);
  assert.match(ui,/password-recovery\/local-confirm/);
});
test('renderer adds email password recovery without exposing the password to Cloudflare',()=>{
  const ui=read('desktop/renderer/first-access-ui.js');
  assert.match(ui,/Esqueci minha senha/);
  assert.match(ui,/Recuperar senha/);
  assert.match(ui,/name="recoveryEmail"/);
  assert.match(ui,/name="recoveryCode"/);
  assert.match(ui,/name="newPassword"/);
  assert.match(ui,/name="newPasswordConfirm"/);
  assert.match(ui,/api\.requestPasswordRecovery/);
  assert.match(ui,/api\.confirmPasswordRecovery/);
  assert.match(ui,/requestPasswordRecovery[\s\S]{0,500}\/api\/v1\/auth\/password-recovery\/request/);
  assert.match(ui,/confirmPasswordRecovery[\s\S]{0,500}\/api\/v1\/auth\/password-recovery\/confirm/);
});

test('renderer API exposes activation endpoints without changing local login API',()=>{
  const api=read('desktop/renderer/api-client.js');
  assert.match(api,/requestSetupActivation\(/);
  assert.match(api,/verifySetupActivation\(/);
  assert.match(api,/\/api\/v1\/setup\/activation\/request/);
  assert.match(api,/\/api\/v1\/setup\/activation\/verify/);
  assert.match(api,/async login\(body\)/);
});
