'use strict';

(() => {
  const root = window;
  if (root.PdvRouteRegistry) return;

  const lifecycle = root.PdvUiLifecycle;
  if (!lifecycle) throw new Error('PdvUiLifecycle must load before PdvRouteRegistry.');

  const routes = new Map();
  let activeRoute = null;
  let renderSequence = 0;

  function normalizeRoute(route) {
    const value = String(route || '').trim();
    if (!value) throw new TypeError('Route id is required.');
    return value;
  }

  function register(route, { owner, render } = {}) {
    const id = normalizeRoute(route);
    const routeOwner = String(owner || '').trim();
    if (!routeOwner) throw new TypeError(`Route ${id} requires an owner.`);
    if (typeof render !== 'function') throw new TypeError(`Route ${id} requires a render function.`);
    const current = routes.get(id);
    if (current) throw new Error(`Route ${id} already belongs to ${current.owner}; ${routeOwner} cannot register a second owner.`);
    routes.set(id, Object.freeze({ owner:routeOwner, render }));
    return () => {
      const registered = routes.get(id);
      if (registered?.owner === routeOwner) routes.delete(id);
    };
  }

  function has(route) {
    return routes.has(String(route || '').trim());
  }

  function ownerOf(route) {
    return routes.get(String(route || '').trim())?.owner || null;
  }

  function list() {
    return [...routes.entries()].map(([route, entry]) => ({ route, owner:entry.owner }));
  }

  async function render(route, context = {}) {
    const id = normalizeRoute(route);
    const entry = routes.get(id);
    if (!entry) throw new Error(`No canonical renderer registered for route ${id}.`);

    const sequence = ++renderSequence;
    const previousRoute = activeRoute;
    if (previousRoute && previousRoute !== id) lifecycle.unmounted(previousRoute, { nextRoute:id });
    lifecycle.beforeRoute(id, { previousRoute, owner:entry.owner });

    try {
      const result = await entry.render(context);
      if (sequence !== renderSequence) return result;
      activeRoute = id;
      lifecycle.mounted(id, { previousRoute, owner:entry.owner });
      return result;
    } catch (error) {
      if (sequence === renderSequence) lifecycle.emit('route:error', { route:id, previousRoute, owner:entry.owner, error });
      throw error;
    }
  }

  function updated(route, detail = {}) {
    const id = String(route || activeRoute || '').trim();
    if (!id) return;
    lifecycle.updated(id, { owner:ownerOf(id), ...detail });
  }

  root.PdvRouteRegistry = Object.freeze({
    register,
    has,
    ownerOf,
    list,
    render,
    updated,
    get activeRoute() { return activeRoute; }
  });
})();
