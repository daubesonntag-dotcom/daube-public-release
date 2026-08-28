(() => {
  const API = 'https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-storefront-api';
  const ORDER_KEY = 'daube-storefront-order-v2';
  let catalog = [];
  let selected = null;

  const $ = (id) => document.getElementById(id);
  const money = (amount) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(amount || 0));
  const text = (value) => String(value ?? '').trim();

  async function api(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
      credentials: 'omit', cache: 'no-store',
      headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) },
      ...options,
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) throw new Error(body?.error || `http_${response.status}`);
    return body;
  }

  function productLink(product) {
    return `/storefront/?product=${encodeURIComponent(product.slug)}`;
  }

  function renderCatalog() {
    const grid = $('catalog-grid');
    if (!grid) return;
    if (!catalog.length) {
      grid.innerHTML = '<p class="errorState">Catalog hiện chưa có offer công khai đủ bằng chứng.</p>';
      return;
    }
    grid.innerHTML = '';
    catalog.forEach((product) => {
      const card = document.createElement('article');
      card.className = `catalogCard${product.featured ? ' isFeatured' : ''}`;
      const badge = document.createElement('p'); badge.className = 'storeKicker'; badge.textContent = product.badge || product.productKind || 'Offer';
      const title = document.createElement('h3'); title.textContent = product.name;
      const copy = document.createElement('p'); copy.textContent = product.subtitle || product.description || 'A bounded D’AUBE offer.';
      const bottom = document.createElement('div'); bottom.className = 'catalogBottom';
      const price = document.createElement('strong'); price.textContent = money(product.price?.amountMinor);
      const link = document.createElement('a'); link.href = productLink(product); link.textContent = 'Xem & đặt →';
      bottom.append(price, link); card.append(badge, title, copy, bottom); grid.append(card);
    });
  }

  function chooseProduct(slug, { scroll = false } = {}) {
    selected = catalog.find((item) => item.slug === slug) || catalog.find((item) => item.featured) || catalog[0] || null;
    const section = $('selected-product');
    if (!selected || !section) return;
    section.hidden = false;
    $('product-badge').textContent = selected.badge || `${selected.productKind || 'offer'} · available`;
    $('product-name').textContent = selected.name;
    $('product-subtitle').textContent = selected.subtitle || '';
    $('product-description').textContent = selected.description || '';
    $('product-price').textContent = money(selected.price?.amountMinor);
    $('product-meta').textContent = `${selected.fulfillmentMode || 'bounded-delivery'} · SKU ${selected.sku || '—'} · revision ${selected.revision || 1}`;
    const url = new URL(location.href);
    url.searchParams.set('product', selected.slug);
    history.replaceState({}, '', `${url.pathname}?${url.searchParams.toString()}`);
    if (scroll) section.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
  }

  async function copyValue(value, button) {
    try {
      await navigator.clipboard.writeText(value);
      const before = button.textContent;
      button.textContent = 'Đã sao chép';
      setTimeout(() => { button.textContent = before; }, 1600);
    } catch {
      button.textContent = 'Hãy sao chép thủ công';
    }
  }

  function paymentDetail(details, label, value, { copy = false } = {}) {
    const row = document.createElement('div');
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.textContent = value || '—';
    row.append(dt, dd);
    if (copy && value) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copyButton';
      button.textContent = 'Sao chép';
      button.addEventListener('click', () => copyValue(value, button));
      row.append(button);
    }
    details.append(row);
  }

  function renderPayment(receipt) {
    const panel = $('payment-panel');
    if (!panel) return;
    panel.hidden = false;
    $('payment-title').textContent = `Đơn ${receipt.order.publicCode}`;
    $('payment-summary').textContent = `Quét VietQR hoặc chuyển đúng ${money(receipt.payment.amountVnd)} với nội dung ${receipt.payment.reference || receipt.order.publicCode}. Hãy kiểm tra người thụ hưởng trong app ngân hàng trước khi xác nhận.`;

    const qrHost = $('payment-qr');
    qrHost.replaceChildren();
    const qrDataUrl = text(receipt.payment.qrSvgDataUrl);
    if (receipt.payment.method === 'direct_vietqr_bank_transfer' && qrDataUrl.startsWith('data:image/svg+xml;base64,')) {
      qrHost.hidden = false;
      const frame = document.createElement('div'); frame.className = 'paymentQrFrame';
      const image = document.createElement('img');
      image.src = qrDataUrl;
      image.alt = `VietQR cho đơn ${receipt.order.publicCode}, số tiền ${money(receipt.payment.amountVnd)}`;
      image.width = 420; image.height = 420; image.decoding = 'async';
      const copy = document.createElement('div'); copy.className = 'paymentQrCopy';
      const badge = document.createElement('strong'); badge.textContent = 'DIRECT VIETQR · VND';
      const steps = document.createElement('ol');
      ['Mở app ngân hàng có hỗ trợ VietQR.', 'Quét mã và kiểm tra đúng người thụ hưởng.', `Xác nhận đúng ${money(receipt.payment.amountVnd)} và reference ${receipt.payment.reference}.`, 'Sau khi chuyển, quay lại Tra đơn. D’AUBE chỉ đánh dấu PAID sau đối chiếu ngân hàng.'].forEach((value) => {
        const li = document.createElement('li'); li.textContent = value; steps.append(li);
      });
      copy.append(badge, steps); frame.append(image, copy); qrHost.append(frame);
    } else {
      qrHost.hidden = true;
    }

    const details = $('payment-details');
    details.innerHTML = '';
    paymentDetail(details, 'Ngân hàng', text(receipt.payment.bankName));
    paymentDetail(details, 'Số tài khoản', text(receipt.payment.accountNumber), { copy: true });
    paymentDetail(details, 'Người thụ hưởng', text(receipt.payment.beneficiaryName));
    paymentDetail(details, 'Số tiền', money(receipt.payment.amountVnd));
    paymentDetail(details, 'Nội dung', text(receipt.payment.reference || receipt.order.publicCode), { copy: true });
    paymentDetail(details, 'Trạng thái', 'AWAITING PAYMENT');

    panel.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
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
    if (!selected) { error.textContent = 'Chưa có sản phẩm hợp lệ.'; error.hidden = false; return; }
    const customerName = text($('customer-name').value);
    const email = text($('email').value);
    const phone = text($('phone').value);
    const consentPrivacy = $('consent').checked === true;
    if (!email && !phone) { error.textContent = 'Vui lòng nhập email hoặc số điện thoại.'; error.hidden = false; return; }
    const submit = $('order-submit'); submit.disabled = true; submit.textContent = 'Đang tạo VietQR…';
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
      sessionStorage.setItem(ORDER_KEY, JSON.stringify({ publicCode: receipt.order.publicCode, contact: email || phone, productSlug: selected.slug }));
      renderPayment(receipt);
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'operation_failed';
      const messages = {
        privacy_consent_required: 'Bạn cần đồng ý Privacy Notice trước khi gửi đơn.',
        contact_required: 'Vui lòng nhập email hoặc số điện thoại.',
        email_invalid: 'Email chưa hợp lệ.',
        phone_invalid: 'Số điện thoại chưa hợp lệ.',
        rate_limited: 'Có quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau ít phút.',
        payment_rail_unavailable: 'Kênh Direct Pay tạm unavailable. Không có khoản tiền nào bị trừ.',
        direct_vietqr_bank_unmapped: 'Ngân hàng nhận chưa có VietQR mapping an toàn. Không có khoản tiền nào bị trừ.',
      };
      error.textContent = messages[code] || 'Chưa thể tạo VietQR lúc này. Không có khoản tiền nào bị trừ.';
      error.hidden = false;
    } finally {
      submit.disabled = false; submit.textContent = 'Tạo đơn & nhận VietQR';
    }
  });

  const remembered = (() => { try { return JSON.parse(sessionStorage.getItem(ORDER_KEY) || '{}'); } catch { return {}; } })();
  if (remembered.publicCode) $('status-code').value = remembered.publicCode;
  if (remembered.contact) $('status-contact').value = remembered.contact;

  $('status-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const target = $('status-result');
    target.textContent = 'Đang kiểm tra…';
    try {
      const payload = await api('/status', { method: 'POST', body: JSON.stringify({ publicCode: text($('status-code').value).toUpperCase(), contact: text($('status-contact').value) }) });
      const order = payload.order;
      target.textContent = `${order.public_code} · ${order.status} · payment ${order.payment_state}${order.payment_amount_vnd ? ` · ${money(order.payment_amount_vnd)}` : ''}`;
    } catch {
      target.textContent = 'Không tìm thấy đơn khớp mã và thông tin liên hệ.';
    }
  });

  loadCatalog().catch(() => {
    const grid = $('catalog-grid');
    if (grid) grid.innerHTML = '<p class="errorState">Storefront hiện chưa thể đọc catalog. Không có giao dịch nào được tạo.</p>';
    document.querySelector('.storeShell')?.setAttribute('data-storefront-state', 'degraded');
  });
})();
