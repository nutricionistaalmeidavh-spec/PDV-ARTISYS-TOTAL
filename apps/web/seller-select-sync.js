'use strict';

(() => {
  const ApiClient = window.PdvApiClient?.ApiClient;
  const routeContent = document.getElementById('route-content');
  const lifecycle = window.PdvUiLifecycle;
  if (!ApiClient || !routeContent || !lifecycle) return;

  const api = new ApiClient();
  let activeRequest = null;
  let observedSelect = null;

  async function synchronizeSellerSelect() {
    const select = document.getElementById('seller-select');
    if (!select) {
      observedSelect = null;
      return;
    }
    if (select === observedSelect || activeRequest) return;
    observedSelect = select;

    activeRequest = (async () => {
      try {
        const sellers = await api.sellers();
        if (!select.isConnected) return;

        const currentValue = select.value;
        const selectedLabel = select.selectedOptions?.[0]?.textContent || '';
        const fragment = document.createDocumentFragment();
        for (const seller of sellers) {
          const option = document.createElement('option');
          option.value = seller.id;
          option.textContent = seller.name;
          fragment.appendChild(option);
        }
        select.replaceChildren(fragment);

        const values = new Set(Array.from(select.options, option => option.value));
        if (currentValue && values.has(currentValue)) select.value = currentValue;
        else if (selectedLabel) {
          const sameLabel = Array.from(select.options).find(option => option.textContent === selectedLabel);
          if (sameLabel) select.value = sameLabel.value;
        }
      } catch {
        // Keep the login-time seller list if the local API is temporarily unavailable.
      } finally {
        activeRequest = null;
      }
    })();

    await activeRequest;
  }

  const onRouteChange = ({ route }) => {
    if (route !== 'checkout') return;
    const select = document.getElementById('seller-select');
    if (select !== observedSelect) void synchronizeSellerSelect();
  };
  lifecycle.on('route:mounted', onRouteChange);
  lifecycle.on('route:updated', onRouteChange);

  if (document.body.dataset.activeRoute === 'checkout') void synchronizeSellerSelect();

  window.PdvSellerSelectSync = Object.freeze({
    refresh: synchronizeSellerSelect
  });
})();
