(() => {
  const API = 'https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-storefront-api';
  const header = document.querySelector('.v3-header');
  const products = document.getElementById('v3-products');
  const money = (amount) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(amount || 0));

  const solidHeader = () => header?.classList.toggle('is-solid', scrollY > 24);
  solidHeader();
  addEventListener('scroll', solidHeader, { passive: true });

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reveals = [...document.querySelectorAll('.v3-reveal')];
  if (reduced || !('IntersectionObserver' in window)) reveals.forEach((el) => el.classList.add('is-visible'));
  else {
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); }
    }), { threshold: .12, rootMargin: '0px 0px -8% 0px' });
    reveals.forEach((el) => observer.observe(el));
  }

  function renderProduct(product, featured = false) {
    const article = document.createElement('article');
    article.className = `v3-product${featured ? ' is-featured' : ''}`;
    const badge = document.createElement('small'); badge.textContent = product.badge || product.productKind || 'D’AUBE offer';
    const title = document.createElement('h3'); title.textContent = product.name;
    const copy = document.createElement('p'); copy.textContent = product.subtitle || product.description || 'A bounded D’AUBE offer.';
    const bottom = document.createElement('div'); bottom.className = 'v3-product-bottom';
    const price = document.createElement('strong'); price.textContent = money(product.price?.amountMinor);
    const link = document.createElement('a'); link.href = `/storefront/?product=${encodeURIComponent(product.slug)}`; link.textContent = 'View →';
    bottom.append(price, link); article.append(badge, title, copy, bottom); return article;
  }

  async function loadProducts() {
    if (!products) return;
    const response = await fetch(`${API}/products`, { headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store' });
    const payload = await response.json();
    if (!response.ok || payload?.ok !== true || !Array.isArray(payload.products)) throw new Error('catalog_unavailable');
    const sorted = [...payload.products].sort((a, b) => Number(Boolean(b.featured)) - Number(Boolean(a.featured)));
    const selected = sorted.slice(0, 3);
    products.innerHTML = '';
    selected.forEach((product, index) => products.append(renderProduct(product, index === 0)));
  }

  loadProducts().catch(() => {
    if (!products) return;
    products.innerHTML = '<article class="v3-product is-featured"><small>Storefront live</small><h3>D’AUBE Storefront</h3><p>Browse the canonical catalog directly. No transaction is created until you submit an order.</p><div class="v3-product-bottom"><strong>Live catalog</strong><a href="/storefront/">Open →</a></div></article>';
  });
})();
