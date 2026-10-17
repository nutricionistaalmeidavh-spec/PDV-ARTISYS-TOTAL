'use strict';

(() => {
  const toastRoot = document.getElementById('toast-root');
  if (!toastRoot) return;

  const SUCCESS_DURATION_MS = 2000;
  const ERROR_DURATION_MS = 6000;
  const DEFAULT_DURATION_MS = 3500;
  const EXIT_DURATION_MS = 180;
  const MAX_VISIBLE = 1;
  const timers = new WeakMap();
  const nativeAppendChild = toastRoot.appendChild.bind(toastRoot);

  function normalizeType(type) {
    if (type === 'error') return 'error';
    if (type === 'success') return 'success';
    return '';
  }

  function durationFor(type) {
    if (type === 'error') return ERROR_DURATION_MS;
    if (type === 'success') return SUCCESS_DURATION_MS;
    return DEFAULT_DURATION_MS;
  }

  function activeToasts() {
    return Array.from(toastRoot.querySelectorAll('.toast[data-toast-managed="true"]'))
      .filter((node) => !node.classList.contains('is-leaving'));
  }

  function findDuplicateToast(message) {
    return activeToasts().find((node) => node.dataset.toastMessage === message) || null;
  }

  function clearTimer(node) {
    const timer = timers.get(node);
    if (timer) clearTimeout(timer);
    timers.delete(node);
  }

  function removeToast(node, { animate = true } = {}) {
    if (!node?.isConnected) return;
    clearTimer(node);
    if (!animate) {
      node.remove();
      return;
    }
    if (node.classList.contains('is-leaving')) return;
    node.classList.add('is-leaving');
    setTimeout(() => node.remove(), EXIT_DURATION_MS);
  }

  function scheduleDismiss(node, type) {
    clearTimer(node);
    const timer = setTimeout(() => removeToast(node), durationFor(type));
    timers.set(node, timer);
  }

  function setToastType(node, type) {
    const normalized = normalizeType(type);
    node.dataset.toastType = normalized;
    node.classList.toggle('error', normalized === 'error');
    node.classList.toggle('success', normalized === 'success');
    node.setAttribute('role', normalized === 'error' ? 'alert' : 'status');
    node.setAttribute('aria-atomic','true');
    return normalized;
  }

  function makeRoom(type) {
    const active = activeToasts();
    if (active.length < MAX_VISIBLE) return true;

    let candidate = null;
    if (type === 'error') {
      candidate = active.find((node) => node.dataset.toastType !== 'error') || active[0];
    } else {
      candidate = active.find((node) => node.dataset.toastType !== 'error') || null;
    }

    if (!candidate) return false;
    removeToast(candidate, { animate: false });
    return true;
  }

  function createToast(message, type) {
    const node = document.createElement('div');
    node.className = 'toast';
    node.dataset.toastManaged = 'true';
    node.dataset.toastMessage = message;

    const messageNode = document.createElement('span');
    messageNode.className = 'toast-message';
    messageNode.textContent = message;

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'toast-close';
    closeButton.setAttribute('data-toast-close', '');
    closeButton.setAttribute('aria-label', 'Fechar notificação');
    closeButton.addEventListener('click', () => removeToast(node));

    node.append(messageNode, closeButton);
    setToastType(node, type);
    return node;
  }

  function show(message, type = '') {
    const text = String(message ?? '').trim();
    if (!text) return null;

    const normalizedType = normalizeType(type);
    const duplicate = findDuplicateToast(text);
    if (duplicate) {
      const effectiveType = duplicate.dataset.toastType === 'error' ? 'error' : normalizedType;
      setToastType(duplicate, effectiveType);
      scheduleDismiss(duplicate, effectiveType);
      return duplicate;
    }

    if (!makeRoom(normalizedType)) return null;

    const node = createToast(text, normalizedType);
    nativeAppendChild(node);
    scheduleDismiss(node, normalizedType);
    return node;
  }


  function bindRouteLifecycle() {
    const lifecycle=window.PdvUiLifecycle;
    if (!lifecycle?.on) return;
    lifecycle.on('route:before', () => {
      activeToasts()
        .filter((node) => node.dataset.toastType !== 'error')
        .forEach((node) => removeToast(node, { animate:false }));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',bindRouteLifecycle,{once:true});
  else bindRouteLifecycle();

  window.PdvToast = Object.freeze({
    show,
    dismiss: removeToast,
    clear() {
      activeToasts().forEach((node) => removeToast(node, { animate: false }));
    }
  });
})();
