(() => {
  const STOREFRONT_API = 'https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-storefront-api';

  const button = document.querySelector('[data-update-toggle]');
  const note = document.getElementById('update-note');
  if (button && note) {
    button.addEventListener('click', () => {
      const expanded = button.getAttribute('aria-expanded') === 'true';
      button.setAttribute('aria-expanded', String(!expanded));
      note.classList.toggle('isVisible', !expanded);
    });
  }

  const money = (amount) => new Intl.NumberFormat('vi-VN', {
    style: 'currency', currency: 'VND', maximumFractionDigits: 0,
  }).format(Number(amount || 0));

  async function syncFeaturedOffer() {
    const response = await fetch(`${STOREFRONT_API}/products`, {
      method: 'GET', headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store',
    });
    if (!response.ok) throw new Error(`storefront_${response.status}`);
    const payload = await response.json();
    if (!payload || payload.ok !== true || !Array.isArray(payload.products)) throw new Error('storefront_invalid');
    const product = payload.products.find((item) => item && item.featured === true) || payload.products[0];
    if (!product || !product.slug || !product.name || !product.price) return;

    const card = document.querySelector('.flagshipOfferGrid .flagshipOfferCard.flagshipOfferDark');
    if (card) {
      const kicker = card.querySelector('.flagshipKicker');
      const title = card.querySelector('h3');
      const description = card.querySelector(':scope > p:not(.flagshipKicker)');
      const bottom = card.querySelector('.flagshipOfferBottom');
      const price = bottom?.querySelector('span');
      const link = bottom?.querySelector('a');
      if (kicker) kicker.textContent = product.badge || `${product.productKind || 'offer'} · available`;
      if (title) title.textContent = product.name;
      if (description) description.textContent = product.subtitle || product.description || 'A bounded D’AUBE offer with clear delivery and commercial truth.';
      if (price) price.textContent = money(product.price.amountMinor);
      if (link) {
        link.textContent = 'View product →';
        link.href = `/storefront/?product=${encodeURIComponent(product.slug)}`;
      }
    }

    const footerProduct = document.querySelector('.flagshipFooter nav a:first-child');
    if (footerProduct) footerProduct.href = `/storefront/?product=${encodeURIComponent(product.slug)}`;
  }

  syncFeaturedOffer().catch(() => {
    // Fail closed to the approved static fallback. Commerce truth is never inferred
    // from a failed catalog request and no customer action is created here.
  });
})();
