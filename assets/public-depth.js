(() => {
  const portal = document.querySelector('.public-mark');
  if (!portal) return;

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
  let frame = 0;

  const reset = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      portal.style.transform = '';
      portal.style.boxShadow = '';
    });
  };

  const update = (event) => {
    if (reducedMotion.matches || !finePointer.matches) return reset();

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
  portal.style.willChange = 'transform';

  portal.addEventListener('pointermove', update, { passive: true });
  portal.addEventListener('pointerleave', reset, { passive: true });
  reducedMotion.addEventListener?.('change', reset);
  finePointer.addEventListener?.('change', reset);
})();
