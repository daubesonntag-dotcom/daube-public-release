(() => {
  'use strict';

  const OFFER_ID = 'DAUBE-AUTOMATION-SPRINT-V1';
  const ENDPOINT = 'https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-money-first-lead';
  const SESSION_KEY = 'daube-public-money-first-session-v1';
  const form = document.getElementById('automationSprintForm');
  const status = document.getElementById('formStatus');
  if (!form || !status) return;

  const setStatus = (message, state = '') => {
    status.textContent = message;
    status.dataset.state = state;
  };
  const value = (name) => {
    const field = form.elements.namedItem(name);
    return field && 'value' in field ? String(field.value || '').trim() : '';
  };
  const sessionId = () => {
    try {
      const existing = sessionStorage.getItem(SESSION_KEY);
      if (existing && /^[A-Za-z0-9._:-]{8,120}$/.test(existing)) return existing;
      const created = `public:${crypto.randomUUID()}`;
      sessionStorage.setItem(SESSION_KEY, created);
      return created;
    } catch {
      return `public:${crypto.randomUUID()}`;
    }
  };
  const mapSensitivity = (raw) => {
    const text = String(raw || '').toLowerCase();
    if (text.includes('public')) return 'PUBLIC';
    if (text.includes('internal')) return 'INTERNAL';
    if (text.includes('personal')) return 'CONFIDENTIAL';
    if (text.includes('sensitive')) return 'RESTRICTED';
    return 'UNKNOWN';
  };
  const mapBudget = (raw) => {
    const text = String(raw || '').toLowerCase();
    if (text.includes('starting') || text.includes('prefer')) return 'STARTER';
    if (text.includes('300')) return 'STANDARD';
    if (text.includes('1,000')) return 'ADVANCED';
    return 'UNKNOWN';
  };
  const hasSecret = (text) => /(password|passwd|api[ _-]?key|private[ _-]?key|secret[ _-]?key|recovery[ _-]?code|one[ _-]?time[ _-]?password|\botp\b|\bcvv\b|bearer\s+[A-Za-z0-9._-]{8,}|sk-[A-Za-z0-9]{10,})/i.test(text);

  const contactInput = form.elements.namedItem('contact_channel');
  if (contactInput && 'placeholder' in contactInput) {
    contactInput.placeholder = 'Email or phone number';
    contactInput.setAttribute('autocomplete', 'email');
    const label = document.querySelector('label[for="contact_channel"]');
    if (label) label.textContent = 'Email or phone';
  }

  const firstField = form.querySelector('.field');
  if (firstField && !form.elements.namedItem('customer_name')) {
    const wrap = document.createElement('div');
    wrap.className = 'field';
    wrap.innerHTML = '<label for="customer_name">Full name</label><input id="customer_name" name="customer_name" minlength="2" maxlength="120" autocomplete="name" required placeholder="Your name">';
    form.insertBefore(wrap, firstField);
  }

  async function telemetry(eventType, extra = {}) {
    try {
      await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'omit',
        keepalive: true,
        body: JSON.stringify({ kind: 'event', sessionId: sessionId(), eventType, offerId: OFFER_ID, currency: 'USD', market: 'UNKNOWN', ...extra }),
      });
    } catch {
      // Conversion telemetry never blocks qualification or creates commerce truth.
    }
  }

  void telemetry('money_offer_viewed');
  let started = false;
  form.addEventListener('focusin', () => {
    if (started) return;
    started = true;
    void telemetry('money_offer_qualification_started');
  }, { once: true });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const contact = value('contact_channel');
    const email = contact.includes('@') ? contact : '';
    const phone = email ? '' : contact;
    const secretScan = [value('workflow_problem'), value('desired_outcome'), value('current_tools')].join(' ');
    if (hasSecret(secretScan)) {
      setStatus('Remove passwords, API keys, private keys, OTPs, recovery codes or bank credentials before submitting.', 'error');
      return;
    }

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    setStatus('Sending securely…');

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
      dataSensitivity: mapSensitivity(value('data_sensitivity')),
      targetTiming: value('target_timing'),
      budgetBand: mapBudget(value('budget_band')),
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

      setStatus(`Received · reference ${result.leadRef}. No order or payment was created.`, 'success');
      void telemetry('money_offer_qualification_submitted', { leadRef: result.leadRef });
      form.reset();
      window.dispatchEvent(new CustomEvent('daube:money-offer-qualification-submitted', {
        detail: { offerId: OFFER_ID, leadRef: result.leadRef, orderCreated: false, paymentCreated: false, revenueCountable: false },
      }));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'submission_failed';
      const friendly = code === 'lead_rate_limited'
        ? 'This browser or network has reached the intake limit. No order or payment was created.'
        : code === 'lead_secret_material_forbidden'
          ? 'Secret-like material was detected. Remove credentials and submit again.'
          : 'The verified intake runtime could not accept this request. Nothing was charged.';
      setStatus(friendly, 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  });
})();
