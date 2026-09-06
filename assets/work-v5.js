(() => {
  const header = document.querySelector('.site-header');
  const nav = document.querySelector('.main-nav');
  const menu = document.querySelector('.menu-button');

  const closeMenu = () => {
    if (!header || !menu) return;
    header.classList.remove('is-open');
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Open navigation');
  };

  if (header && menu && nav) {
    menu.addEventListener('click', () => {
      const open = header.classList.toggle('is-open');
      menu.setAttribute('aria-expanded', String(open));
      menu.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
    });
    nav.querySelectorAll('a').forEach((link) => link.addEventListener('click', closeMenu));
    addEventListener('resize', () => { if (innerWidth > 900) closeMenu(); }, { passive: true });
  }

  const updateHeader = () => header?.classList.toggle('is-solid', scrollY > 30);
  updateHeader();
  addEventListener('scroll', updateHeader, { passive: true });

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const items = [...document.querySelectorAll('.reveal')];
  if (reduced || !('IntersectionObserver' in window)) {
    items.forEach((item) => item.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: .08, rootMargin: '0px 0px -7% 0px' });
  items.forEach((item) => observer.observe(item));
})();
