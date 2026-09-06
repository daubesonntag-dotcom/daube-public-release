(() => {
  if (window.__DAUBE_V9_BOOTSTRAP__) return;
  window.__DAUBE_V9_BOOTSTRAP__ = true;
  const d = document;
  const ensureCss = (href, key) => {
    if (d.querySelector(`link[data-${key}]`)) return;
    const link = d.createElement('link');
    link.rel = 'stylesheet';
    link.href = href;
    link.dataset[key] = 'true';
    d.head.appendChild(link);
  };
  ensureCss('/assets/work-v9-cinema.css?v=e40c19d', 'workV9');
  if (!d.querySelector('script[data-work-v9]')) {
    const script = d.createElement('script');
    script.src = '/assets/work-v9-cinema.js?v=e7b14f8';
    script.defer = true;
    script.dataset.workV9 = 'true';
    d.head.appendChild(script);
  }
})();
