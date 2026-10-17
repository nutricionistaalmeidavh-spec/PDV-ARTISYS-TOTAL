'use strict';

(() => {
  const overlay = document.getElementById('auth-overlay');
  const toastRoot = document.getElementById('toast-root');
  if (!overlay || !toastRoot) return;

  let guardingKitReload = false;
  let errorWatch = null;

  function stopErrorWatch() {
    if (errorWatch === null) return;
    clearInterval(errorWatch);
    errorWatch = null;
  }

  function releaseReloadGuard() {
    if (!guardingKitReload) return;
    guardingKitReload = false;
    stopErrorWatch();
    delete overlay.dataset.reloadGuard;
    overlay.classList.add('hidden');
    overlay.innerHTML = '';
  }

  function showReloadGuard() {
    guardingKitReload = true;
    stopErrorWatch();
    overlay.classList.remove('hidden');
    overlay.dataset.reloadGuard = 'kit';
    overlay.innerHTML = '<section class="auth-card"><div class="auth-logo">A</div><h1>Atualizando catálogo</h1><p>Salvando o kit e restaurando sua sessão...</p></section>';
    errorWatch = setInterval(() => {
      if (!guardingKitReload) return;
      if (toastRoot.querySelector('.toast.error')) releaseReloadGuard();
    }, 50);
  }

  document.addEventListener('submit', (event) => {
    if (event.target?.id !== 'kc-kit-form') return;
    showReloadGuard();
  }, true);

  window.addEventListener('beforeunload', stopErrorWatch, { once:true });
})();
