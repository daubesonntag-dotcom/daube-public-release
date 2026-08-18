(() => {
  const button = document.querySelector('.menu-button');
  const menu = document.querySelector('#mobile-menu');

  if (button && menu) {
    const close = () => {
      menu.hidden = true;
      button.setAttribute('aria-expanded', 'false');
      button.setAttribute('aria-label', 'Mở menu');
    };

    button.addEventListener('click', () => {
      const open = button.getAttribute('aria-expanded') !== 'true';
      menu.hidden = !open;
      button.setAttribute('aria-expanded', String(open));
      button.setAttribute('aria-label', open ? 'Đóng menu' : 'Mở menu');
    });

    menu.querySelectorAll('a').forEach(link => link.addEventListener('click', close));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        close();
        button.focus();
      }
    });
  }

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const saveData = navigator.connection && navigator.connection.saveData;
  const videos = Array.from(document.querySelectorAll('video[data-ambient-video]'));

  if (reducedMotion || saveData) {
    videos.forEach(video => {
      video.pause();
      video.removeAttribute('autoplay');
      video.preload = 'none';
    });
    return;
  }

  const start = video => {
    if (video.dataset.started !== 'true') {
      video.preload = 'metadata';
      video.dataset.started = 'true';
    }
    video.play().catch(() => undefined);
  };

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const video = entry.target;
        if (!(video instanceof HTMLVideoElement)) return;
        if (entry.isIntersecting) start(video);
        else video.pause();
      });
    }, { rootMargin: '160px 0px', threshold: .08 });

    videos.forEach(video => observer.observe(video));
  } else {
    videos.forEach(start);
  }
})();
