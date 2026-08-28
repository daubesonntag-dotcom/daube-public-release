(() => {
  const API = 'https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-storefront-api';
  const ORDER_KEY = 'daube-storefront-order-v2';
  let catalog = [];
  let selected = null;

  const $ = (id) => document.getElementById(id);
  const text = (value) => String(value ?? '').trim();
  const money = (amount) => `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Number(amount || 0))} VND`;

  const COLLECTIONS = [
    {
      id: 'infrastructure',
      title: 'Infrastructure & Operations',
      description: 'Architecture, orchestration and integration services for organizations that need complex systems to work together clearly.',
      matches: (product) => ['farm-orchestration-audit-v1', 'farm-orchestration-build-v1', 'resource-ecosystem-integration-v1'].includes(product.slug),
    },
    {
      id: 'business',
      title: 'Business Tools & Growth',
      description: 'Practical tools and specialist support for planning, reporting, pricing, shop operations and discoverability.',
      matches: (product) => ['money-map-salary-budget', 'office-followup-report-pack', 'micro-shop-launch-system', 'shop-profit-pricing-calculator', 'managed-seo-diagnostic'].includes(product.slug),
    },
    {
      id: 'gifting',
      title: 'Gifting & Personal Services',
      description: 'Guided creative support for messages, meaningful gifts, urgent occasions and shared gifting decisions.',
      matches: (product) => product.slug.startsWith('gift-') || product.slug === 'group-gift-planner',
    },
    {
      id: 'experimental',
      title: 'Experimental Studio',
      description: 'Deliberately unconventional service formats for difficult decisions, unfinished work, wasted capacity and problems that benefit from a different angle.',
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
    heading.style.gridColumn = '1 / -1';
    heading.style.padding = '34px 8px 18px';
    heading.style.background = '#f5f2e9';
    heading.style.borderTop = '1px solid rgba(37,39,34,.12)';

    const kicker = document.createElement('p');
    kicker.className = 'storeKicker';
    kicker.textContent = collection.title;

    const description = document.createElement('p');
    description.textContent = collection.description;
    description.style.maxWidth = '760px';
    description.style.margin = '0';
    description.style.lineHeight = '1.65';
    description.style.color = '#5a6057';

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
    copy.textContent = product.subtitle || product.description || 'A practical D’AUBE product or service.';

    const bottom = document.createElement('div');
    bottom.className = 'catalogBottom';
    const price = document.createElement('strong');
    price.textContent = money(product.price?.amountMinor);
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
      grid.innerHTML = '<p class="errorState">No offers are available right now. Please check again shortly.</p>';
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
        description: 'Additional approved offers that do not yet belong to a dedicated collection.',
      });
      remaining.forEach((product) => renderProductCard(grid, product, 'other'));
    }
  }

  function chooseProduct(slug, { scroll = false } = {}) {
    selected = catalog.find((item) => item.slug === slug)
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
    $('product-price').textContent = money(selected.price?.amountMinor);
    $('product-meta').textContent = `${offerType(selected)} · One-time price`;

    const url = new URL(location.href);
    url.searchParams.set('product', selected.slug);
    history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);

    if (scroll) {
      section.scrollIntoView({
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
        block: 'start',
      });
    }
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
    $('payment-summary').textContent = `Pay exactly ${money(receipt.payment.amountVnd)} using transfer reference ${receipt.payment.reference || receipt.order.publicCode}. Before confirming the transfer, verify the beneficiary shown in your banking app.`;

    const qrHost = $('payment-qr');
    qrHost.replaceChildren();
    const qrDataUrl = text(receipt.payment.qrSvgDataUrl);

    if (receipt.payment.method === 'direct_vietqr_bank_transfer' && qrDataUrl.startsWith('data:image/svg+xml;base64,')) {
      qrHost.hidden = false;
      const frame = document.createElement('div');
      frame.className = 'paymentQrFrame';

      const image = document.createElement('img');
      image.src = qrDataUrl;
      image.alt = `VietQR for order ${receipt.order.publicCode}, amount ${money(receipt.payment.amountVnd)}`;
      image.width = 420;
      image.height = 420;
      image.decoding = 'async';

      const copy = document.createElement('div');
      copy.className = 'paymentQrCopy';
      const badge = document.createElement('strong');
      badge.textContent = 'DIRECT VIETQR · VND';
      const steps = document.createElement('ol');
      [
        'Open a banking app that supports VietQR.',
        'Scan the code and verify the beneficiary.',
        `Confirm the exact amount ${money(receipt.payment.amountVnd)} and transfer reference ${receipt.payment.reference}.`,
        'After payment, return to Order status. D’AUBE updates the order after bank verification.',
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
    paymentDetail(details, 'Amount', money(receipt.payment.amountVnd));
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
    renderCatalog();
    const requested = new URLSearchParams(location.search).get('product');
    chooseProduct(requested || catalog.find((item) => item.featured)?.slug || catalog[0]?.slug || '');
    document.querySelector('.storeShell')?.setAttribute('data-storefront-state', 'ready');
  }

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
      error.textContent = 'Please select an offer before creating an order.';
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
    submit.textContent = 'Preparing your order…';

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
        payment_rail_unavailable: 'VND checkout is temporarily unavailable. No payment has been created.',
        direct_vietqr_bank_unmapped: 'VietQR is temporarily unavailable for the receiving bank. No payment has been created.',
      };
      error.textContent = messages[code] || 'We could not create this order right now. No payment has been created.';
      error.hidden = false;
    } finally {
      submit.disabled = false;
      submit.textContent = 'Create order & get VietQR';
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
      const amount = order.payment_amount_vnd ? ` · ${money(order.payment_amount_vnd)}` : '';
      target.textContent = `${order.public_code} · ${orderStateLabel(order.status)} · ${paymentStateLabel(order.payment_state)}${amount}`;
    } catch {
      target.textContent = 'We could not find an order matching that code and contact information.';
    }
  });

  loadCatalog().catch(() => {
    const grid = $('catalog-grid');
    if (grid) grid.innerHTML = '<p class="errorState">We could not load the store right now. Please try again shortly.</p>';
    document.querySelector('.storeShell')?.setAttribute('data-storefront-state', 'degraded');
  });
})();
