/* Progressive enhancement only: auth, register and demo behavior remain in landing.js. */
(() => {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const targets = [
    '.hero-copy', '.hero-visual', '.trust-inner',
    '.section-intro', '.feature-card', '.demo-copy', '.demo-frame',
    '.restaurant-layout > div', '.resource-grid > div', '.cta-content'
  ];
  const nodes = targets.flatMap(selector => Array.from(document.querySelectorAll(selector)));
  if (!nodes.length || reduceMotion.matches || !('IntersectionObserver' in window)) return;
  nodes.forEach(node => node.setAttribute('data-reveal', ''));
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add('in-view');
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '0px 0px -35px 0px', threshold: 0.08 });
  document.documentElement.classList.add('motion-ready');
  nodes.forEach(node => observer.observe(node));
  // The visible state is always the default when JavaScript is absent or interrupted.
  window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
})();
