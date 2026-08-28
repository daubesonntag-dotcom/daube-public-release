(() => {
  const API = 'https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-storefront-api';
  const ORDER_KEY = 'daube-storefront-order-v2';
  const CURRENCY_KEY = 'daube-storefront-display-currency-v1';
  const USD_REFERENCE_VND = 26100;
  let catalog = [];
  let selected = null;
  let displayCurrency = (() => {
    try {
      return localStorage.getItem(CURRENCY_KEY) === 'VND' ? 'VND' : 'USD';
    } catch {
      return 'USD';
    }
  })();

  const $ = (id) => document.getElementById(id);
  const text = (value) => String(value ?? '').trim();

  function moneyVnd(amount) {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(amount || 0))} VND`;
  }

  function moneyUsdEquivalent(amountVnd) {
    const value = Number(amountVnd || 0) / USD_REFERENCE_VND;
    const digits = value >= 50 ? 0 : value >= 10 ? 1 : 2;
    return `US$${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: digits,
    }).format(value)}`;
  }

  function displayMoney(product) {
    const amount = Number(product?.price?.amountMinor || 0);
    return displayCurrency === 'VND' ? moneyVnd(amount) : moneyUsdEquivalent(amount);
  }

  const COLLECTIONS = [
    {
      id: 'infrastructure',
      title: 'Infrastructure & Operations',
      description: 'Architecture, orchestration and integration for teams that need complex systems to become simpler to run.',
      matches: (product) => ['farm-orchestration-audit-v1', 'farm-orchestration-build-v1', 'resource-ecosystem-integration-v1'].includes(product.slug),
    },
    {
      id: 'business',
      title: 'Business Tools & Growth',
      description: 'Focused tools and specialist support for planning, reporting, pricing, launch operations and discoverability.',
      matches: (product) => ['money-map-salary-budget', 'office-followup-report-pack', 'micro-shop-launch-system', 'shop-profit-pricing-calculator', 'managed-seo-diagnostic'].includes(product.slug),
    },
    {
      id: 'gifting',
      title: 'Gifting & Personal Services',
      description: 'Creative support for messages, meaningful gifts, urgent occasions and group decisions.',
      matches: (product) => product.slug.startsWith('gift-') || product.slug === 'group-gift-planner',
    },
    {
      id: 'experimental',
      title: 'Experimental Studio',
      description: 'Unconventional service formats for difficult decisions, unfinished work, wasted capacity and problems that need a different angle.',
      matches: (product) => product.slug.startsWith('paradox-'),
    },
  ];

  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
      },
      ...options,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || `http_${response.status}`);
    return body;
  }

  function productLink(product) {
    return `/storefront/?product=${encodeURIComponent(product.slug)}`;
  }

  function offerType(product) {
    const kind = text(product?.productKind).toLowerCase();
    if (kind.includes('service')) return 'Specialist service';
    if (kind.includes('digital')) return 'Digital product';
    return 'D’AUBE offer';
  }

  function orderStateLabel(value) {
    const state = text(value).toLowerCase();
    const labels = {
      created: 'Order received',
      pending: 'In progress',
      awaiting_payment: 'Awaiting payment',
      paid: 'Payment confirmed',
      processing: 'In progress',
      fulfilled: 'Completed',
      completed: 'Completed',
      cancelled: 'Cancelled',
      refunded: 'Refunded',
    };
    return labels[state] || 'Status available';
  }

  function paymentStateLabel(value) {
    const state = text(value).toLowerCase();
    const labels = {
      awaiting_payment: 'Payment awaiting verification',
      pending: 'Payment awaiting verification',
      paid: 'Payment confirmed',
      settled: 'Payment confirmed',
      failed: 'Payment not confirmed',
      refunded: 'Payment refunded',
    };
    return labels[state] || 'Payment status available';
  }

  function renderCollectionHeading(grid, collection) {
    const heading = document.createElement('header');
    heading.className = 'catalogGroupHeading';

    const kicker = document.createElement('p');
    kicker.className = 'storeKicker';
    kicker.textContent = collection.title;

    const description = document.createElement('p');
    description.textContent = collection.description;

    heading.append(kicker, description);
    grid.append(heading);
  }

  function renderProductCard(grid, product, collectionId) {
    const card = document.createElement('article');
    const featured = product.featured && collectionId !== 'experimental';
    card.className = `catalogCard${featured ? ' isFeatured' : ''}`;

    const badge = document.createElement('p');
    badge.className = 'storeKicker';
    badge.textContent = product.badge || offerType(product);

    const title = document.createElement('h3');
    title.textContent = product.name;

    const copy = document.createElement('p');
    copy.textContent = product.subtitle || product.description || 'A focused D’AUBE product or service.';

    const bottom = document.createElement('div');
    bottom.className = 'catalogBottom';
    const price = document.createElement('strong');
    price.textContent = displayMoney(product);
    price.title = displayCurrency === 'USD'
      ? `USD display equivalent using a reference rate of ${moneyVnd(USD_REFERENCE_VND)} per US$1. Local bank settlement remains in VND.`
      : 'Exact local catalog amount in VND.';

    const link = document.createElement('a');
    link.href = productLink(product);
    link.textContent = 'View details →';

    bottom.append(price, link);
    card.append(badge, title, copy, bottom);
    grid.append(card);
  }

  function renderCatalog() {
    const grid = $('catalog-grid');
    if (!grid) return;
    if (!catalog.length) {
      grid.innerHTML = '<p class="errorState">The catalog is temporarily unavailable. Please try again shortly.</p>';
      return;
    }

    grid.innerHTML = '';
    const rendered = new Set();

    COLLECTIONS.forEach((collection) => {
      const products = catalog.filter((product) => collection.matches(product));
      if (!products.length) return;
      renderCollectionHeading(grid, collection);
      products.forEach((product) => {
        rendered.add(product.slug);
        renderProductCard(grid, product, collection.id);
      });
    });

    const remaining = catalog.filter((product) => !rendered.has(product.slug));
    if (remaining.length) {
      renderCollectionHeading(grid, {
        title: 'More from D’AUBE',
        description: 'Additional approved offers awaiting a dedicated collection.',
      });
      remaining.forEach((product) => renderProductCard(grid, product, 'other'));
    }
  }

  function chooseProduct(slug, { scroll = false, updateUrl = true } = {}) {
    selected = catalog.find((item) => item.slug === slug)
      || selected
      || catalog.find((item) => item.featured)
      || catalog[0]
      || null;

    const section = $('selected-product');
    if (!selected || !section) return;

    section.hidden = false;
    $('product-badge').textContent = selected.badge || offerType(selected);
    $('product-name').textContent = selected.name;
    $('product-subtitle').textContent = selected.subtitle || '';
    $('product-description').textContent = selected.description || '';
    $('product-price').textContent = displayMoney(selected);
    $('product-currency-note').textContent = displayCurrency === 'USD'
      ? 'USD display equivalent · local settlement in VND'
      : 'Exact local catalog amount';
    $('product-meta').textContent = `${offerType(selected)} · One-time offer`;

    if (updateUrl) {
      const url = new URL(location.href);
      url.searchParams.set('product', selected.slug);
      history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
    }

    if (scroll) {
      section.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
    }
  }

  function applyCurrency(nextCurrency) {
    displayCurrency = nextCurrency === 'VND' ? 'VND' : 'USD';
    try { localStorage.setItem(CURRENCY_KEY, displayCurrency); } catch {}

    const usd = $('currency-usd');
    const vnd = $('currency-vnd');
    if (usd && vnd) {
      const usdActive = displayCurrency === 'USD';
      usd.classList.toggle('isActive', usdActive);
      vnd.classList.toggle('isActive', !usdActive);
      usd.setAttribute('aria-pressed', String(usdActive));
      vnd.setAttribute('aria-pressed', String(!usdActive));
    }

    renderCatalog();
    if (selected) chooseProduct(selected.slug, { updateUrl: false });
  }

  async function copyValue(value, button) {
    try {
      await navigator.clipboard.writeText(value);
      const before = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = before; }, 1600);
    } catch {
      button.textContent = 'Copy manually';
    }
  }

  function paymentDetail(details, label, value, { copy = false } = {}) {
    const row = document.createElement('div');
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value || '—';
    row.append(dt, dd);

    if (copy && value) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copyButton';
      button.textContent = 'Copy';
      button.addEventListener('click', () => copyValue(value, button));
      row.append(button);
    }

    details.append(row);
  }

  function renderPayment(receipt) {
    const panel = $('payment-panel');
    if (!panel) return;

    panel.hidden = false;
    $('payment-title').textContent = `Order ${receipt.order.publicCode}`;
    $('payment-summary').textContent = `Local settlement amount: ${moneyVnd(receipt.payment.amountVnd)}. Use transfer reference ${receipt.payment.reference || receipt.order.publicCode} and verify the beneficiary in your banking app before confirming.`;

    const qrHost = $('payment-qr');
    qrHost.replaceChildren();
    const qrDataUrl = text(receipt.payment.qrSvgDataUrl);

    if (receipt.payment.method === 'direct_vietqr_bank_transfer' && qrDataUrl.startsWith('data:image/svg+xml;base64,')) {
      qrHost.hidden = false;
      const frame = document.createElement('div');
      frame.className = 'paymentQrFrame';

      const image = document.createElement('img');
      image.src = qrDataUrl;
      image.alt = `Local bank QR for order ${receipt.order.publicCode}, amount ${moneyVnd(receipt.payment.amountVnd)}`;
      image.width = 420;
      image.height = 420;
      image.decoding = 'async';

      const copy = document.createElement('div');
      copy.className = 'paymentQrCopy';
      const badge = document.createElement('strong');
      badge.textContent = 'LOCAL BANK TRANSFER · VIETQR';
      const steps = document.createElement('ol');
      [
        'Open a banking app that supports VietQR.',
        'Scan the code and verify the beneficiary.',
        `Confirm the exact amount ${moneyVnd(receipt.payment.amountVnd)} and transfer reference ${receipt.payment.reference}.`,
        'Return to Order status after payment. D’AUBE updates the order only after bank verification.',
      ].forEach((value) => {
        const li = document.createElement('li');
        li.textContent = value;
        steps.append(li);
      });

      copy.append(badge, steps);
      frame.append(image, copy);
      qrHost.append(frame);
    } else {
      qrHost.hidden = true;
    }

    const details = $('payment-details');
    details.innerHTML = '';
    paymentDetail(details, 'Bank', text(receipt.payment.bankName));
    paymentDetail(details, 'Account number', text(receipt.payment.accountNumber), { copy: true });
    paymentDetail(details, 'Beneficiary', text(receipt.payment.beneficiaryName));
    paymentDetail(details, 'Settlement amount', moneyVnd(receipt.payment.amountVnd));
    paymentDetail(details, 'Transfer reference', text(receipt.payment.reference || receipt.order.publicCode), { copy: true });
    paymentDetail(details, 'Payment status', 'Awaiting verification');

    panel.scrollIntoView({
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  }

  async function loadCatalog() {
    const payload = await api('/products');
    catalog = Array.isArray(payload.products) ? payload.products : [];
    applyCurrency(displayCurrency);
    const requested = new URLSearchParams(location.search).get('product');
    chooseProduct(requested || catalog.find((item) => item.featured)?.slug || catalog[0]?.slug || '');
    document.querySelector('.storeShell')?.setAttribute('data-storefront-state', 'ready');
  }

  $('currency-usd')?.addEventListener('click', () => applyCurrency('USD'));
  $('currency-vnd')?.addEventListener('click', () => applyCurrency('VND'));

  $('catalog-grid')?.addEventListener('click', (event) => {
    const anchor = event.target.closest('a');
    if (!anchor) return;
    const url = new URL(anchor.href, location.href);
    if (url.pathname !== '/storefront/' && url.pathname !== '/storefront') return;
    const slug = url.searchParams.get('product');
    if (!slug) return;
    event.preventDefault();
    chooseProduct(slug, { scroll: true });
  });

  $('order-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('order-error');
    error.hidden = true;

    if (!selected) {
      error.textContent = 'Please select an offer before continuing.';
      error.hidden = false;
      return;
    }

    const customerName = text($('customer-name').value);
    const email = text($('email').value);
    const phone = text($('phone').value);
    const consentPrivacy = $('consent').checked === true;

    if (!email && !phone) {
      error.textContent = 'Please provide an email address or phone number.';
      error.hidden = false;
      return;
    }

    const submit = $('order-submit');
    submit.disabled = true;
    submit.textContent = 'Preparing local payment…';

    try {
      const idempotencyKey = `web-${crypto.randomUUID()}`;
      const receipt = await api('/order', {
        method: 'POST',
        headers: { 'Idempotency-Key': idempotencyKey },
        body: JSON.stringify({
          productSlug: selected.slug,
          customerName,
          email: email || undefined,
          phone: phone || undefined,
          preferredChannel: $('preferred-channel').value,
          consentPrivacy,
          idempotencyKey,
        }),
      });

      sessionStorage.setItem(ORDER_KEY, JSON.stringify({
        publicCode: receipt.order.publicCode,
        contact: email || phone,
        productSlug: selected.slug,
      }));
      renderPayment(receipt);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'operation_failed';
      const messages = {
        privacy_consent_required: 'Please accept the Privacy Notice before creating the order.',
        contact_required: 'Please provide an email address or phone number.',
        email_invalid: 'Please check the email address and try again.',
        phone_invalid: 'Please check the phone number and try again.',
        rate_limited: 'Too many requests were made in a short period. Please try again in a few minutes.',
        payment_rail_unavailable: 'Local checkout is temporarily unavailable. No payment has been created.',
        direct_vietqr_bank_unmapped: 'Local bank QR is temporarily unavailable. No payment has been created.',
      };
      error.textContent = messages[code] || 'We could not create this order right now. No payment has been created.';
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Continue to local bank payment';
    }
  });

  const remembered = (() => {
    try {
      return JSON.parse(sessionStorage.getItem(ORDER_KEY) || '{}');
    } catch {
      return {};
    }
  })();

  if (remembered.publicCode) $('status-code').value = remembered.publicCode;
  if (remembered.contact) $('status-contact').value = remembered.contact;

  $('status-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const target = $('status-result');
    target.textContent = 'Checking your order…';

    try {
      const payload = await api('/status', {
        method: 'POST',
        body: JSON.stringify({
          publicCode: text($('status-code').value).toUpperCase(),
          contact: text($('status-contact').value),
        }),
      });
      const order = payload.order;
      const amount = order.payment_amount_vnd ? ` · settlement ${moneyVnd(order.payment_amount_vnd)}` : '';
      target.textContent = `${order.public_code} · ${orderStateLabel(order.status)} · ${paymentStateLabel(order.payment_state)}${amount}`;
    } catch {
      target.textContent = 'No matching order was found for that code and contact information.';
    }
  });

  applyCurrency(displayCurrency);
  loadCatalog().catch(() => {
    const grid = $('catalog-grid');
    if (grid) grid.innerHTML = '<p class="errorState">The store is temporarily unavailable. Please try again shortly.</p>';
    document.querySelector('.storeShell')?.setAttribute('data-storefront-state', 'degraded');
  });
})();
