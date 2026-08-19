(() => {
  const root = document.documentElement;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const scenes = [...document.querySelectorAll('[data-motion-scene]')];
  const cards = [...document.querySelectorAll('[data-motion-card]')];
  const depthMedia = [...document.querySelectorAll('[data-depth-media]')];
  let scrollFrame = 0;
  let pointerFrame = 0;

  root.classList.add('ff-motion');

  const setReducedState = () => {
    root.classList.toggle('ff-reduced-motion', reducedMotion.matches);
    if (reducedMotion.matches) {
      scenes.forEach((scene) => scene.classList.add('ff-in-view'));
      cards.forEach((card) => card.classList.add('ff-in-view'));
      depthMedia.forEach((media) => {
        media.style.setProperty('--ff-depth-x', '0px');
        media.style.setProperty('--ff-depth-y', '0px');
      });
    }
  };

  cards.forEach((card, index) => {
    card.style.setProperty('--ff-delay', `${Math.min(index % 6, 5) * 70}ms`);
  });

  if ('IntersectionObserver' in window && !reducedMotion.matches) {
    const sceneObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('ff-in-view');
        sceneObserver.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.12 });

    const cardObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('ff-in-view');
        cardObserver.unobserve(entry.target);
      }
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.08 });

    scenes.forEach((scene) => sceneObserver.observe(scene));
    cards.forEach((card) => cardObserver.observe(card));
  } else {
    scenes.forEach((scene) => scene.classList.add('ff-in-view'));
    cards.forEach((card) => card.classList.add('ff-in-view'));
  }

  const updateScrollDepth = () => {
    scrollFrame = 0;
    if (reducedMotion.matches) return;
    const viewportHeight = window.innerHeight || 1;
    for (const media of depthMedia) {
      const rect = media.getBoundingClientRect();
      if (rect.bottom < -100 || rect.top > viewportHeight + 100) continue;
      const center = rect.top + rect.height / 2;
      const normalized = Math.max(-1, Math.min(1, (center - viewportHeight / 2) / viewportHeight));
      media.style.setProperty('--ff-depth-y', `${(-normalized * 9).toFixed(2)}px`);
    }
  };

  const queueScrollDepth = () => {
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(updateScrollDepth);
  };

  const resetPointerDepth = () => {
    depthMedia.forEach((media) => media.style.setProperty('--ff-depth-x', '0px'));
  };

  const updatePointerDepth = (event) => {
    if (reducedMotion.matches || !finePointer.matches) return;
    if (pointerFrame) cancelAnimationFrame(pointerFrame);
    pointerFrame = requestAnimationFrame(() => {
      const normalizedX = (event.clientX / Math.max(window.innerWidth, 1)) - 0.5;
      const offset = Math.max(-7, Math.min(7, normalizedX * 14));
      depthMedia.forEach((media) => {
        const rect = media.getBoundingClientRect();
        if (rect.bottom < 0 || rect.top > window.innerHeight) return;
        media.style.setProperty('--ff-depth-x', `${offset.toFixed(2)}px`);
      });
    });
  };

  window.addEventListener('scroll', queueScrollDepth, { passive: true });
  window.addEventListener('resize', queueScrollDepth, { passive: true });
  window.addEventListener('pointermove', updatePointerDepth, { passive: true });
  document.documentElement.addEventListener('mouseleave', resetPointerDepth, { passive: true });

  reducedMotion.addEventListener?.('change', () => {
    setReducedState();
    queueScrollDepth();
  });
  finePointer.addEventListener?.('change', resetPointerDepth);

  setReducedState();
  queueScrollDepth();
})();
