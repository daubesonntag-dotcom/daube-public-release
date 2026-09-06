(() => {
  const header = document.querySelector('.site-header');
  const nav = document.querySelector('.main-nav');
  const menu = document.querySelector('.menu-button');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(pointer:fine)').matches;

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
    addEventListener('resize', () => { if (innerWidth > 1000) closeMenu(); }, { passive: true });
  }

  const updateHeader = () => header?.classList.toggle('is-solid', scrollY > 34);
  updateHeader();
  addEventListener('scroll', updateHeader, { passive: true });

  const reveals = [...document.querySelectorAll('.reveal')];
  reveals.forEach((item, index) => item.style.setProperty('--delay', `${Math.min(index * 55, 220)}ms`));
  if (reduced || !('IntersectionObserver' in window)) reveals.forEach((item) => item.classList.add('is-visible'));
  else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: .08, rootMargin: '0px 0px -7% 0px' });
    reveals.forEach((item) => observer.observe(item));
  }

  const setPointer = (element, event) => {
    const rect = element.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 100;
    const y = ((event.clientY - rect.top) / rect.height) * 100;
    element.style.setProperty('--mx', `${x}%`);
    element.style.setProperty('--my', `${y}%`);
  };

  if (!reduced && fine) {
    document.querySelectorAll('.hero,.work-card,.cta-panel,.subhero').forEach((element) => {
      element.addEventListener('pointermove', (event) => setPointer(element, event), { passive: true });
    });

    const heroImage = document.querySelector('.hero__media img,.subhero__media img');
    if (heroImage) {
      let ticking = false;
      const parallax = () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
          const max = Math.min(scrollY, innerHeight * .9);
          heroImage.style.transform = `translate3d(0,${max * .055}px,0) scale(1.035)`;
          ticking = false;
        });
      };
      addEventListener('scroll', parallax, { passive: true });
    }
  }
})();
