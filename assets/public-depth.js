(() => {
  const portal = document.querySelector('.public-mark');
  if (!portal) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  const animatedElements = portal.querySelectorAll(
    '.public-mark__halo, .public-mark__horizon, .public-mark__spark'
  );
  let frame = 0;
  let isVisible = true;

  const syncMotionState = () => {
    const shouldRun = isVisible && !document.hidden && !reducedMotion.matches;
    animatedElements.forEach((element) => {
      element.style.animationPlayState = shouldRun ? 'running' : 'paused';
    });
    portal.dataset.motionState = shouldRun ? 'active' : 'paused';
    portal.style.willChange = shouldRun && finePointer.matches ? 'transform' : 'auto';
  };

  const reset = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      portal.style.transform = '';
      portal.style.boxShadow = '';
    });
  };

  const update = (event) => {
    if (!isVisible || document.hidden || reducedMotion.matches || !finePointer.matches) return reset();

    const rect = portal.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const rotateY = (x - 0.5) * 5.5;
    const rotateX = (0.5 - y) * 4.5;

    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      portal.style.transform = `perspective(980px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(0)`;
      portal.style.boxShadow = `${(-rotateY * 1.6).toFixed(1)}px ${(28 + rotateX * 1.2).toFixed(1)}px 90px color-mix(in srgb, var(--ds-text-primary) 14%, transparent)`;
    });
  };

  portal.style.transformOrigin = '50% 58%';
  portal.style.transition = 'transform 180ms ease-out, box-shadow 260ms ease';

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisible = entry.isIntersecting;
        if (!isVisible) reset();
        syncMotionState();
      },
      { threshold: 0.04 }
    );
    observer.observe(portal);
  }

  portal.addEventListener('pointermove', update, { passive: true });
  portal.addEventListener('pointerleave', reset, { passive: true });
  document.addEventListener('visibilitychange', syncMotionState, { passive: true });
  reducedMotion.addEventListener?.('change', () => {
    reset();
    syncMotionState();
  });
  finePointer.addEventListener?.('change', () => {
    reset();
    syncMotionState();
  });

  syncMotionState();
})();
