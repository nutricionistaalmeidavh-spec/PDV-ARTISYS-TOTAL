'use strict';

(() => {
  const { ApiClient } = window.PdvApiClient || {};
  const overlay = document.getElementById('auth-overlay');
  const lifecycle = window.PdvUiLifecycle;
  if (!ApiClient || !overlay || !lifecycle) return;

  if (!ApiClient.prototype.requestPasswordRecovery) {
    ApiClient.prototype.requestPasswordRecovery = function requestPasswordRecovery(body) {
      return this.request('/api/v1/auth/password-recovery/request', { method:'POST', body });
    };
  }
  if (!ApiClient.prototype.confirmPasswordRecovery) {
    ApiClient.prototype.confirmPasswordRecovery = function confirmPasswordRecovery(body) {
      return this.request('/api/v1/auth/password-recovery/confirm', { method:'POST', body });
    };
  }

  const api = new ApiClient();
  let config = null;
  let rendering = false;
  let setupCache = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  function showToast(message, type = '') {
    window.PdvToast?.show?.(String(message || 'Falha no primeiro acesso.'),type);
  }

  async function ensureConfig() {
    if (!config) config = await api.initialize();
    return config;
  }

  async function setupStatus(force = false) {
    if (!setupCache || force) setupCache = await api.setupStatus();
    return setupCache;
  }

  function renderFirstAccess(prefillEmail = '') {
    const licensedEmail = String(prefillEmail || '').trim();
    rendering = true;
    overlay.classList.remove('hidden');
    overlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Primeiro acesso ao ArtiSys</h1><p>Crie o administrador principal desta instalação. O acesso ao PDV continua local.</p><form id="first-access-form"><div class="field"><label>Nome</label><input name="name" autocomplete="name" required value="Administrador"></div><div class="field"><label>Usuário</label><input name="username" autocomplete="username" required value="admin"></div><div class="field"><label>${licensedEmail ? 'E-mail da conta' : 'E-mail <small>(opcional)</small>'}</label><input name="email" type="email" autocomplete="email" value="${escapeHtml(licensedEmail)}" ${licensedEmail ? 'required readonly' : ''}></div><div class="field"><label>Senha</label><input name="password" type="password" autocomplete="new-password" minlength="10" required></div><div class="field"><label>Confirmar senha</label><input name="passwordConfirm" type="password" autocomplete="new-password" minlength="10" required></div><button class="primary-button" type="submit">Criar administrador e entrar</button></form></section>`;
    const form = overlay.querySelector('#first-access-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const name = String(values.get('name') || '').trim();
      const username = String(values.get('username') || '').trim();
      const email = licensedEmail || String(values.get('email') || '').trim();
      const password = String(values.get('password') || '');
      const passwordConfirm = String(values.get('passwordConfirm') || '');
      if (password !== passwordConfirm) return showToast('As senhas não conferem.', 'error');
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        const cfg = await ensureConfig();
        const created=await api.setupAdmin({ name, username, password, ...(email ? { email } : {}) });
        const recoveryKey=created.recoveryKey;
        rendering=true;
        overlay.innerHTML=`<section class="auth-card"><h1>Guarde sua chave de recuperação</h1><p>Esta chave recupera sua senha sem e-mail ou internet. Guarde-a fora deste computador. Ela aparece somente agora.</p><textarea id="recovery-key-output" readonly rows="3">${escapeHtml(recoveryKey||'')}</textarea><button type="button" class="secondary-button" id="copy-recovery-key">Copiar chave</button><button type="button" class="secondary-button" id="download-recovery-key">Baixar chave</button><button type="button" class="primary-button" id="continue-after-key">Guardei a chave, continuar</button></section>`;
        overlay.querySelector('#copy-recovery-key').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(recoveryKey);showToast('Chave copiada. Guarde em local seguro.','success');}catch{overlay.querySelector('#recovery-key-output').select();showToast('Selecione e copie a chave.');}});
        overlay.querySelector('#download-recovery-key').addEventListener('click',()=>{const url=URL.createObjectURL(new Blob([`ArtiSys — recuperação local\nUsuário: ${username}\nChave: ${recoveryKey}\nGuarde fora do computador do PDV. Uso único.\n`],{type:'text/plain;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download='artisys-chave-recuperacao.txt';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
        overlay.querySelector('#continue-after-key').addEventListener('click',async event=>{event.currentTarget.disabled=true;try{await api.login({username,password,terminalId:cfg.terminalId});window.location.reload();}catch(error){event.currentTarget.disabled=false;showToast(error.message,'error');}});
      } catch (error) {
        if (button) button.disabled = false;
        showToast(error.message, 'error');
      }
    });
    queueMicrotask(() => { rendering = false; });
  }

  function renderActivation({ continueToSetup = true } = {}) {
    rendering = true;
    overlay.classList.remove('hidden');
    overlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Ativar instalação</h1><p>Informe o e-mail liberado e o código de ativação fornecido pela ArtiSys. Dados operacionais e senhas permanecem neste computador.</p><form id="activation-verify-form"><div class="field"><label>E-mail da conta</label><input name="email" type="email" autocomplete="email" required></div><div class="field"><label>Código de ativação</label><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></div><button class="primary-button" type="submit">Ativar e definir senha</button></form></section>`;
    const form = overlay.querySelector('#activation-verify-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const email = String(values.get('email') || '').trim();
      const code = String(values.get('code') || '').trim();
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        const activation = await api.verifySetupActivation(email, code);
        setupCache = null;
        if (continueToSetup) renderFirstAccess(activation?.accountEmail || email);
        else window.location.reload();
      } catch (error) {
        if (button) button.disabled = false;
        showToast(error.message, 'error');
      }
    });
    queueMicrotask(() => { rendering = false; });
  }

  function renderLocalRecovery() {
    rendering=true;
    overlay.classList.remove('hidden');
    overlay.innerHTML=`<section class="auth-card"><div class="auth-logo">A</div><h1>Recuperar senha</h1><p>Use a chave de recuperação salva quando você ainda tinha acesso. A recuperação é local e não precisa de e-mail ou internet.</p><form id="local-recovery-form"><div class="field"><label>Usuário</label><input name="username" autocomplete="username" required></div><div class="field"><label>Chave de recuperação</label><input name="key" type="password" autocomplete="off" required></div><div class="field"><label>Nova senha</label><input name="password" type="password" autocomplete="new-password" minlength="10" required></div><div class="field"><label>Confirmar senha</label><input name="confirm" type="password" autocomplete="new-password" minlength="10" required></div><button class="primary-button">Alterar senha local</button><button class="secondary-button" type="button" data-email-recovery>Recuperação comercial por e-mail</button><button class="secondary-button" type="button" data-back-login>Voltar</button></form><p>Sem chave? Peça a outro administrador da loja para redefinir seu acesso. Não há senha mestra.</p></section>`;
    overlay.querySelector('[data-back-login]').addEventListener('click',()=>window.location.reload());
    overlay.querySelector('[data-email-recovery]').addEventListener('click',renderRecoveryRequest);
    const form=overlay.querySelector('#local-recovery-form');
    form.addEventListener('submit',async event=>{
      event.preventDefault();const values=Object.fromEntries(new FormData(form));
      if(values.password!==values.confirm)return showToast('As senhas não conferem.','error');
      const button=form.querySelector('button');button.disabled=true;
      try{await api.request('/api/v1/auth/password-recovery/local-confirm',{method:'POST',body:{username:values.username,key:values.key,password:values.password}});showToast('Senha alterada. A chave foi consumida. Entre e gere uma nova chave.','success');window.location.reload();}
      catch(error){button.disabled=false;showToast(error.message,'error');}
    });
    queueMicrotask(()=>{rendering=false;});
  }

  function renderRecoveryRequest() {
    rendering = true;
    overlay.classList.remove('hidden');
    overlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Recuperar senha</h1><p>Informe o e-mail vinculado ao administrador desta instalação.</p><form id="password-recovery-request-form"><div class="field"><label>E-mail</label><input name="recoveryEmail" type="email" autocomplete="email" required></div><button class="primary-button" type="submit">Solicitar recuperação</button><button class="secondary-button" type="button" data-back-login>Voltar</button></form></section>`;
    overlay.querySelector('[data-back-login]')?.addEventListener('click', () => window.location.reload());
    const form = overlay.querySelector('#password-recovery-request-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const email = String(new FormData(form).get('recoveryEmail') || '').trim();
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        const result = await api.requestPasswordRecovery({ email });
        showToast(result?.message || 'Solicite o código de recuperação ao administrador ArtiSys.', 'success');
        renderRecoveryConfirm(email);
      } catch (error) {
        if (button) button.disabled = false;
        showToast(error.message, 'error');
      }
    });
    queueMicrotask(() => { rendering = false; });
  }

  function renderRecoveryConfirm(email) {
    rendering = true;
    overlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Recuperar senha</h1><p>Informe o código de recuperação fornecido pelo administrador ArtiSys e crie uma nova senha local.</p><form id="password-recovery-confirm-form"><div class="field"><label>Código</label><input name="recoveryCode" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" required></div><div class="field"><label>Nova senha</label><input name="newPassword" type="password" autocomplete="new-password" minlength="10" required></div><div class="field"><label>Confirmar nova senha</label><input name="newPasswordConfirm" type="password" autocomplete="new-password" minlength="10" required></div><button class="primary-button" type="submit">Alterar senha</button><button class="secondary-button" type="button" data-resend>Solicitar outro código</button></form></section>`;
    overlay.querySelector('[data-resend]')?.addEventListener('click', renderRecoveryRequest);
    const form = overlay.querySelector('#password-recovery-confirm-form');
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const code = String(values.get('recoveryCode') || '').trim();
      const password = String(values.get('newPassword') || '');
      const passwordConfirm = String(values.get('newPasswordConfirm') || '');
      if (password !== passwordConfirm) return showToast('As senhas não conferem.', 'error');
      const button = form.querySelector('button[type="submit"]');
      if (button) button.disabled = true;
      try {
        await api.confirmPasswordRecovery({ email, code, password });
        overlay.innerHTML = `<section class="auth-card"><div class="auth-logo">A</div><h1>Senha alterada</h1><p>A nova senha foi salva somente neste computador e as sessões anteriores foram encerradas.</p><button class="primary-button" type="button" data-back-login>Entrar com a nova senha</button></section>`;
        overlay.querySelector('[data-back-login]')?.addEventListener('click', () => window.location.reload());
      } catch (error) {
        if (button) button.disabled = false;
        showToast(error.message, 'error');
      }
    });
    queueMicrotask(() => { rendering = false; });
  }

  async function syncAuthOverlay() {
    if (rendering) return;
    const title = overlay.querySelector('.auth-card h1')?.textContent?.trim();
    if (title === 'Configurar ArtiSys PDV') {
      rendering = true;
      try {
        await ensureConfig();
        const setup = await setupStatus(true);
        if (!setup?.needsSetup) return;
        if (setup.activation?.required) renderActivation({ continueToSetup:true });
        else renderFirstAccess(setup.activation?.activation?.accountEmail || '');
      } catch (error) {
        rendering = false;
        showToast(error.message, 'error');
      }
      return;
    }

    if (title === 'ArtiSys PDV' && overlay.querySelector('#login-form') && !overlay.querySelector('[data-password-recovery]')) {
      rendering = true;
      try {
        await ensureConfig();
        const setup = await setupStatus(true);
        if (overlay.querySelector('.auth-card h1')?.textContent?.trim() !== 'ArtiSys PDV') return;
        if (setup?.activation?.required) { renderActivation({ continueToSetup:false }); return; }
        {
          const form = overlay.querySelector('#login-form');
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'secondary-button';
          link.dataset.passwordRecovery = 'true';
          link.textContent = 'Esqueci minha senha';
          link.addEventListener('click', renderLocalRecovery);
          form?.appendChild(link);
        }
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        rendering = false;
      }
    }
  }

  lifecycle.on('auth:rendered', () => { void syncAuthOverlay(); });
  void syncAuthOverlay();
})();