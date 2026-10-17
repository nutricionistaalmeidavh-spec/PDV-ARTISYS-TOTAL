(function initUpdaterUi() {
  const updater = window.artisysDesktop?.updater;
  if (!updater) return;

  const root = document.createElement('div');
  root.className = 'updater-toast hidden';
  root.innerHTML = '<strong id="updaterTitle">Atualização</strong><span id="updaterText"></span><div id="updaterProgress" class="updater-progress hidden"><i></i></div><div class="updater-actions"><button id="updaterPrimary" type="button" class="primary">Atualizar</button><button id="updaterDismiss" type="button" class="secondary">Depois</button></div>';
  document.body.appendChild(root);

  const consent = document.createElement('div');
  consent.className = 'updater-consent hidden';
  consent.innerHTML = '<section class="updater-consent-card" role="dialog" aria-modal="true" aria-labelledby="updaterConsentTitle"><div class="updater-consent-head"><span class="updater-consent-mark">A</span><div><strong id="updaterConsentTitle">Privacidade e diagnóstico do ArtiSys</strong><p id="updaterConsentIntro"></p></div></div><div class="updater-consent-copy"><p>Quando permitido, o ArtiSys pode enviar métricas anônimas de uso, desempenho e categorias técnicas de erro. O envio é opcional e não interfere no funcionamento do PDV.</p><p><strong>Não enviamos</strong> nome, CPF/CNPJ, e-mail, telefone, endereço, senha, token, XML/DANFE, dados de cartão, observações, conteúdo de recibos ou texto digitado.</p></div><label class="updater-consent-check"><input id="updaterConsentCheck" type="checkbox"> <span>Li e concordo com estes termos e permito o envio de métricas de uso e diagnóstico.</span></label><div class="updater-consent-actions"><button id="updaterConsentDecline" type="button" class="secondary"></button><button id="updaterConsentAccept" type="button" class="primary" disabled></button></div><button id="updaterConsentClose" class="updater-consent-close" type="button" aria-label="Fechar">×</button></section>';
  document.body.appendChild(consent);

  const title = root.querySelector('#updaterTitle');
  const text = root.querySelector('#updaterText');
  const progress = root.querySelector('#updaterProgress');
  const bar = progress.querySelector('i');
  const primary = root.querySelector('#updaterPrimary');
  const dismiss = root.querySelector('#updaterDismiss');
  const consentIntro = consent.querySelector('#updaterConsentIntro');
  const consentCheck = consent.querySelector('#updaterConsentCheck');
  const consentAccept = consent.querySelector('#updaterConsentAccept');
  const consentDecline = consent.querySelector('#updaterConsentDecline');
  const consentClose = consent.querySelector('#updaterConsentClose');
  let state = { status: 'idle' };
  let consentMode = 'startup';

  const render = (next) => {
    state = next || state;
    root.classList.toggle('hidden', ['idle', 'current', 'unsupported'].includes(state.status));
    progress.classList.toggle('hidden', state.status !== 'downloading');
    bar.style.width = `${state.progress || 0}%`;
    primary.classList.remove('hidden');

    if (state.status === 'checking') {
      title.textContent = 'Atualização';
      text.textContent = 'Verificando nova versão...';
      primary.classList.add('hidden');
    } else if (state.status === 'available') {
      title.textContent = `ArtiSys PDV ${state.availableVersion || ''} disponível`;
      text.textContent = 'Baixe a nova versão sem reinstalar manualmente.';
      primary.textContent = 'Baixar agora';
    } else if (state.status === 'downloading') {
      title.textContent = 'Baixando atualização';
      text.textContent = `${state.progress || 0}% concluído`;
      primary.classList.add('hidden');
    } else if (state.status === 'downloaded') {
      title.textContent = 'Atualização pronta';
      text.textContent = 'O sistema reiniciará para concluir a atualização.';
      primary.textContent = 'Atualizar e reiniciar';
    } else if (state.status === 'error') {
      title.textContent = 'Não foi possível atualizar';
      text.textContent = state.error || 'Tente novamente mais tarde.';
      primary.textContent = 'Tentar novamente';
    }
  };

  function openConsent(mode = 'startup') {
    consentMode = mode;
    const firstRun = mode === 'startup';
    consentIntro.textContent = firstRun
      ? 'Atualização concluída. Antes de continuar, escolha se deseja compartilhar métricas técnicas para ajudar a melhorar o sistema.'
      : 'Antes de concluir esta atualização, escolha se deseja compartilhar métricas técnicas para ajudar a melhorar o sistema.';
    consentDecline.textContent = firstRun ? 'Continuar sem compartilhar' : 'Atualizar sem compartilhar dados';
    consentAccept.textContent = firstRun ? 'Permitir e continuar' : 'Permitir e atualizar';
    consentClose.hidden = firstRun;
    consentCheck.checked = false;
    consentAccept.disabled = true;
    consentDecline.disabled = false;
    consent.classList.remove('hidden');
    consentCheck.focus();
  }

  function closeConsent() {
    consent.classList.add('hidden');
    primary.focus();
  }

  async function consentState() {
    return typeof updater.telemetryConsentState === 'function'
      ? updater.telemetryConsentState()
      : { needsPrompt:false, available:false };
  }

  async function installDownloaded() {
    const current = await consentState();
    if (current?.needsPrompt) {
      openConsent('install');
      return;
    }
    await updater.install();
  }

  async function maybePromptAfterUpdate() {
    try {
      const current = await consentState();
      if (current?.needsPrompt) openConsent('startup');
    } catch {
      // Consentimento permanece desligado se o runtime ainda nao estiver disponivel.
    }
  }

  primary.addEventListener('click', async () => {
    try {
      if (state.status === 'available') await updater.download();
      else if (state.status === 'downloaded') await installDownloaded();
      else await updater.check();
    } catch (error) {
      render({ ...state, status: 'error', error: error.message });
    }
  });

  consentCheck.addEventListener('change', () => { consentAccept.disabled = !consentCheck.checked; });
  consentAccept.addEventListener('click', async () => {
    if (!consentCheck.checked) return;
    consentAccept.disabled = true;
    consentDecline.disabled = true;
    try {
      if (consentMode === 'install') await updater.acceptTelemetryAndInstall();
      else {
        await updater.saveTelemetryConsent(true);
        closeConsent();
      }
    } catch (error) {
      consentAccept.disabled = false;
      consentDecline.disabled = false;
      render({ ...state, status:'error', error:error.message });
      if (consentMode === 'install') closeConsent();
    }
  });
  consentDecline.addEventListener('click', async () => {
    consentAccept.disabled = true;
    consentDecline.disabled = true;
    try {
      if (consentMode === 'install') await updater.declineTelemetryAndInstall();
      else {
        await updater.saveTelemetryConsent(false);
        closeConsent();
      }
    } catch (error) {
      consentAccept.disabled = !consentCheck.checked;
      consentDecline.disabled = false;
      render({ ...state, status:'error', error:error.message });
      if (consentMode === 'install') closeConsent();
    }
  });
  consentClose.addEventListener('click', () => { if (consentMode !== 'startup') closeConsent(); });
  dismiss.addEventListener('click', () => root.classList.add('hidden'));
  updater.onState(render);
  updater.state().then(render).catch(() => {});
  void maybePromptAfterUpdate();
})();
