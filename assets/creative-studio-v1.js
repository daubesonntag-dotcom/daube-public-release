(() => {
  'use strict';

  const OFFER_ID = 'DAUBE-CREATIVE-PRODUCTION-V1';
  const ENDPOINT = 'https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-money-first-lead';
  const VOLUNTEER_QA_URL = 'https://github.com/daubesonntag-dotcom/daube-public-release/issues/176';
  const form = document.getElementById('creativeStudioForm');
  const status = document.getElementById('formStatus');
  if (!form || !status) return;

  const value = (name) => {
    const field = form.elements.namedItem(name);
    return field && 'value' in field ? String(field.value || '').trim() : '';
  };
  const setStatus = (message, state = '') => {
    status.textContent = message;
    status.dataset.state = state;
  };
  const hasSecret = (text) => /(password|passwd|api[ _-]?key|private[ _-]?key|secret[ _-]?key|recovery[ _-]?code|one[ _-]?time[ _-]?password|\botp\b|\bcvv\b|bearer\s+[A-Za-z0-9._-]{8,}|sk-[A-Za-z0-9]{10,})/i.test(text);

  const truthBand = document.querySelector('.band > div:last-child');
  if (truthBand && !document.querySelector('[data-volunteer-qa]')) {
    const wrap = document.createElement('p');
    const link = document.createElement('a');
    link.className = 'button';
    link.href = VOLUNTEER_QA_URL;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.dataset.volunteerQa = 'true';
    link.textContent = 'Volunteer QA / Viewer · 5–15 phút →';
    link.setAttribute('aria-label', 'Mở canonical volunteer QA / Viewer intake của D’AUBE trên GitHub');
    wrap.appendChild(link);
    truthBand.appendChild(wrap);
  }

  async function telemetry(eventType) {
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        keepalive: true,
        body: JSON.stringify({ kind: 'event', eventType, offerId: OFFER_ID }),
      });
    } catch {
      // Telemetry never blocks qualification and creates no commercial truth.
    }
  }

  void telemetry('creative_offer_viewed');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const secretScan = [value('workflow_problem'), value('desired_outcome'), value('current_tools')].join(' ');
    if (hasSecret(secretScan)) {
      setStatus('Hãy xoá password, API/private key, OTP, recovery code hoặc credential trước khi gửi.', 'error');
      return;
    }

    const contact = value('contact_channel');
    const email = contact.includes('@') ? contact : '';
    const phone = email ? '' : contact;
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    setStatus('Đang gửi brief an toàn…');

    const payload = {
      offerId: OFFER_ID,
      customerName: value('customer_name'),
      email: email || undefined,
      phone: phone || undefined,
      preferredChannel: email ? 'email' : 'phone',
      consentPrivacy: Boolean(form.elements.namedItem('consent_to_contact')?.checked),
      billingMarketOrCountry: value('billing_market'),
      customerType: value('customer_type'),
      workflowProblem: value('workflow_problem'),
      currentTools: value('current_tools'),
      desiredOutcome: value('desired_outcome'),
      frequencyOrVolume: value('frequency_or_volume'),
      dataSensitivity: value('data_sensitivity'),
      targetTiming: value('target_timing'),
      budgetBand: value('budget_band'),
      company_website: value('company_website'),
    };

    try {
      const idempotencyKey = `public-lead:${crypto.randomUUID()}`;
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': idempotencyKey },
        credentials: 'omit',
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true || typeof result.leadRef !== 'string' || result.orderCreated !== false || result.paymentCreated !== false || result.revenueCountable !== false) {
        const code = typeof result.error === 'string' ? result.error : `http_${response.status}`;
        throw new Error(code);
      }

      setStatus(`Đã nhận brief · mã ${result.leadRef}. Chưa tạo order hoặc payment.`, 'success');
      void telemetry('creative_offer_qualification_submitted');
      form.reset();
      window.dispatchEvent(new CustomEvent('daube:creative-qualification-submitted', {
        detail: {
          offerId: OFFER_ID,
          leadRef: result.leadRef,
          orderCreated: false,
          paymentCreated: false,
          revenueCountable: false,
        },
      }));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'submission_failed';
      const friendly = code === 'lead_rate_limited'
        ? 'Kênh này đã chạm giới hạn intake trong 24 giờ. Không có order hoặc payment nào được tạo.'
        : code === 'lead_secret_material_forbidden'
          ? 'Runtime phát hiện nội dung giống credential. Hãy xoá dữ liệu bí mật rồi gửi lại.'
          : 'Creative intake chưa nhận được brief. Không có khoản tiền nào bị tạo hoặc thu.';
      setStatus(friendly, 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  });
})();
