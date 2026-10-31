/* Public marketing gallery. Authentication belongs only to the legacy app routes. */
(() => {
  'use strict';
  const tabs = Array.from(document.querySelectorAll('[data-demo]'));
  function activate(tab, focus) {
    for (const node of tabs) {
      const selected = node === tab;
      node.setAttribute('aria-selected', String(selected));
      node.tabIndex = selected ? 0 : -1;
      const panel = document.querySelector('[data-panel="' + node.dataset.demo + '"]');
      if (panel) panel.hidden = !selected;
    }
    if (focus) tab.focus();
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab, false));
    tab.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0
        : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[next], true);
    });
  });
})();
