import("./treasury/runtime.js").catch((error) => {
  console.warn("D’AUBE Resource Treasury bootstrap unavailable", error);
});

(() => {
  const portal = document.querySelector('.public-mark');
  if (!portal) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let frame = 0;
  let isVisible = true;

  const setDepthVariables = (x = 0, y = 0) => {
    portal.style.setProperty('--cinema-x', `${x.toFixed(2)}px`);
    portal.style.setProperty('--cinema-y', `${y.toFixed(2)}px`);
    portal.style.setProperty('--cinema-x-near', `${(x * 1.45).toFixed(2)}px`);
    portal.style.setProperty('--cinema-y-near', `${(y * 1.45).toFixed(2)}px`);
    portal.style.setProperty('--cinema-x-far', `${(x * 0.55).toFixed(2)}px`);
    portal.style.setProperty('--cinema-y-far', `${(y * 0.55).toFixed(2)}px`);
  };

  const syncMotionState = () => {
    const shouldRun = isVisible && !document.hidden && !reducedMotion.matches;
    portal.querySelectorAll('.public-mark__halo, .public-mark__horizon, .public-mark__spark').forEach((element) => {
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
      setDepthVariables();
    });
  };

  const update = (event) => {
    if (!isVisible || document.hidden || reducedMotion.matches || !finePointer.matches) return reset();

    const rect = portal.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    const rotateY = (x - 0.5) * 6.2;
    const rotateX = (0.5 - y) * 5.2;
    const depthX = (x - 0.5) * 15;
    const depthY = (y - 0.5) * 11;

    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      portal.style.transform = `perspective(1180px) rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) translateZ(0)`;
      portal.style.boxShadow = `${(-rotateY * 1.8).toFixed(1)}px ${(34 + rotateX * 1.4).toFixed(1)}px 110px color-mix(in srgb, var(--ds-text-primary) 17%, transparent)`;
      setDepthVariables(depthX, depthY);
    });
  };

  portal.style.transformOrigin = '50% 58%';
  portal.style.transition = 'transform 170ms ease-out, box-shadow 260ms ease';
  setDepthVariables();

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
