'use strict';

(() => {
  const root = window;
  if (root.PdvUiLifecycle) return;

  const listeners = new Map();
  let activeRoute = null;

  function on(eventName, handler) {
    if (typeof handler !== 'function') throw new TypeError('UI lifecycle handler must be a function.');
    const name = String(eventName || '').trim();
    if (!name) throw new TypeError('UI lifecycle event name is required.');
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(handler);
    return () => listeners.get(name)?.delete(handler);
  }

  function emit(eventName, detail = {}) {
    const name = String(eventName || '').trim();
    if (!name) throw new TypeError('UI lifecycle event name is required.');
    const payload = Object.freeze({ ...detail });
    for (const handler of [...(listeners.get(name) || [])]) {
      try { handler(payload); }
      catch (error) { console.error(`ArtiSys UI lifecycle handler failed for ${name}.`, error); }
    }
    root.dispatchEvent(new CustomEvent(`artisys:ui:${name}`, { detail:payload }));
    return payload;
  }

  function beforeRoute(route, detail = {}) {
    return emit('route:before', { route:String(route || ''), ...detail });
  }

  function mounted(route, detail = {}) {
    activeRoute = String(route || '');
    return emit('route:mounted', { route:activeRoute, ...detail });
  }

  function updated(route, detail = {}) {
    return emit('route:updated', { route:String(route || activeRoute || ''), ...detail });
  }

  function unmounted(route, detail = {}) {
    const normalized = String(route || activeRoute || '');
    if (activeRoute === normalized) activeRoute = null;
    return emit('route:unmounted', { route:normalized, ...detail });
  }

  root.PdvUiLifecycle = Object.freeze({
    on,
    emit,
    beforeRoute,
    mounted,
    updated,
    unmounted,
    get activeRoute() { return activeRoute; }
  });
})();
