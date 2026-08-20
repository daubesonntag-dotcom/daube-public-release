(() => {
  const root = document.querySelector('[data-coming-soon]');
  if (!root || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const art = root.querySelector('.coming__art img');
  const glow = root.querySelector('.coming__glow');
  let rx = 0;
  let ry = 0;
  let tx = 0;
  let ty = 0;
  let frame = 0;

  const animate = () => {
    rx += (tx - rx) * 0.045;
    ry += (ty - ry) * 0.045;
    if (art) art.style.setProperty('--pointer-x', `${rx}px`);
    if (glow) glow.style.transform = `translate3d(${rx * -0.35}px, ${ry * -0.28}px, 0)`;
    frame = requestAnimationFrame(animate);
  };

  const move = (event) => {
    const x = event.clientX / Math.max(window.innerWidth, 1) - 0.5;
    const y = event.clientY / Math.max(window.innerHeight, 1) - 0.5;
    tx = x * 10;
    ty = y * 8;
  };

  if (window.matchMedia('(pointer:fine)').matches) {
    window.addEventListener('pointermove', move, { passive: true });
    frame = requestAnimationFrame(animate);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && frame) cancelAnimationFrame(frame);
    else if (!document.hidden && window.matchMedia('(pointer:fine)').matches) frame = requestAnimationFrame(animate);
  });
})();
