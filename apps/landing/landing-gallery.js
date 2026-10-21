/* Swipeable visual preview gallery. Authentication and canonical tabs remain owned by landing.js. */
(() => {
  'use strict';
  const frame = document.querySelector('.demo-frame');
  const tabs = Array.from(document.querySelectorAll('[data-demo]'));
  const prev = document.querySelector('[data-gallery-prev]');
  const next = document.querySelector('[data-gallery-next]');
  const counter = document.querySelector('[data-gallery-counter]');
  const expand = document.querySelector('[data-gallery-expand]');
  const zoom = document.getElementById('demo-gallery-zoom');
  const zoomTitle = document.querySelector('[data-gallery-zoom-title]');
  const zoomContent = document.querySelector('[data-gallery-zoom-content]');
  const closeZoom = document.querySelector('[data-gallery-zoom-close]');
  if (!frame || !tabs.length || !prev || !next || !counter || !expand || !zoom) return;

  const index = () => Math.max(0, tabs.findIndex(tab => tab.getAttribute('aria-selected') === 'true'));
  const update = () => {
    const selected = index();
    counter.textContent = (selected + 1) + ' de ' + tabs.length;
    prev.disabled = selected === 0;
    next.disabled = selected === tabs.length - 1;
  };
  const select = requested => {
    if (requested < 0 || requested >= tabs.length) return;
    // Existing tab handler remains the only owner of panel state and ARIA.
    tabs[requested].click();
    update();
  };
  tabs.forEach(tab => tab.addEventListener('click', update));
  prev.addEventListener('click', () => select(index() - 1));
  next.addEventListener('click', () => select(index() + 1));

  let gesture = null;
  frame.addEventListener('pointerdown', event => {
    if (event.target.closest('button,a,input,select,textarea,[role="button"]')) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    gesture = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
  });
  frame.addEventListener('pointercancel', () => { gesture = null; });
  frame.addEventListener('pointerup', event => {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const dx = event.clientX - gesture.x;
    const dy = event.clientY - gesture.y;
    gesture = null;
    if (Math.abs(dx) < 46 || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    select(index() + (dx < 0 ? 1 : -1));
  });

  expand.addEventListener('click', () => {
    const current = tabs[index()];
    const panel = document.getElementById(current.getAttribute('aria-controls'));
    if (!panel) return;
    const content = panel.cloneNode(true);
    content.removeAttribute('id');
    content.removeAttribute('hidden');
    content.removeAttribute('role');
    content.removeAttribute('aria-labelledby');
    content.removeAttribute('data-panel');
    zoomContent.replaceChildren(content);
    zoomTitle.textContent = current.querySelector('span')?.firstChild?.textContent?.trim() || 'Visualização ampliada';
    zoom.showModal();
  });
  closeZoom.addEventListener('click', () => zoom.close());
  zoom.addEventListener('click', event => { if (event.target === zoom) zoom.close(); });
  zoom.addEventListener('close', () => zoomContent.replaceChildren());
  update();
})();
