/* Intersection-aware autoplay: static HTML/video controls remain usable without JS. */
(() => {
  'use strict';
  const videos = Array.from(document.querySelectorAll('[data-video]'));
  if (!videos.length) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const dataSaver = navigator.connection?.saveData === true;
  if (reduced.matches || dataSaver || !('IntersectionObserver' in window)) return;
  const manuallyPaused = new WeakSet();
  const pausedByPage = new WeakSet();
  const stop = video => {
    if (video.paused) return;
    pausedByPage.add(video);
    video.pause();
  };
  videos.forEach(video => {
    video.addEventListener('pause', () => {
      if (!pausedByPage.delete(video)) manuallyPaused.add(video);
    });
    video.addEventListener('play', () => manuallyPaused.delete(video));
  });
  const observer = new IntersectionObserver(entries => {
    for (const {target:video,isIntersecting,intersectionRatio} of entries) {
      if (document.hidden || !isIntersecting || intersectionRatio < .55) {
        stop(video);
      } else if (!manuallyPaused.has(video)) {
        video.play().catch(() => { /* user-controlled fallback */ });
      }
    }
  }, {threshold:[0,.55,.9]});
  videos.forEach(video => observer.observe(video));
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) videos.forEach(stop);
  });
  window.addEventListener('pagehide', () => {
    videos.forEach(stop);
    observer.disconnect();
  }, {once:true});
})();
