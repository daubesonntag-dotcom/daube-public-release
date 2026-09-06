(() => {
  const header = document.querySelector('.site-header');
  const nav = document.querySelector('.main-nav');
  const menu = document.querySelector('.menu-button');
  const hero = document.querySelector('.hero');
  const heroImage = document.querySelector('.hero__media img');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

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

  const updateHeader = () => header?.classList.toggle('is-solid', scrollY > 24);
  updateHeader();
  addEventListener('scroll', updateHeader, { passive: true });

  const reveals = [...document.querySelectorAll('.reveal')];
  if (reduced || !('IntersectionObserver' in window)) {
    reveals.forEach((el) => el.classList.add('is-visible'));
  } else {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -7% 0px' });
    reveals.forEach((el) => observer.observe(el));
  }

  if (!reduced && hero) {
    hero.addEventListener('pointermove', (event) => {
      const rect = hero.getBoundingClientRect();
      const x = ((event.clientX - rect.left) / rect.width) * 100;
      const y = ((event.clientY - rect.top) / rect.height) * 100;
      hero.style.setProperty('--mx', `${x}%`);
      hero.style.setProperty('--my', `${y}%`);
      if (heroImage && innerWidth > 1000) {
        const tx = (x - 50) * -0.018;
        const ty = (y - 50) * -0.012;
        heroImage.style.transform = `scale(1.025) translate(${tx}px, ${ty}px)`;
      }
    });
    hero.addEventListener('pointerleave', () => {
      hero.style.removeProperty('--mx');
      hero.style.removeProperty('--my');
      if (heroImage) heroImage.style.transform = '';
    });
  }

  if (!reduced) {
    document.querySelectorAll('.work-card').forEach((card) => {
      card.addEventListener('pointermove', (event) => {
        if (innerWidth <= 1000) return;
        const rect = card.getBoundingClientRect();
        const rx = ((event.clientY - rect.top) / rect.height - 0.5) * -1.3;
        const ry = ((event.clientX - rect.left) / rect.width - 0.5) * 1.3;
        card.style.transform = `translateY(-5px) perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg)`;
      });
      card.addEventListener('pointerleave', () => { card.style.transform = ''; });
    });
  }
})();
