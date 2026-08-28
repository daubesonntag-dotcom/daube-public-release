(() => {
  const ENDPOINT = 'https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-money-first-lead';
  const OFFER_ID = 'DAUBE-AUTOMATION-SPRINT-V1';
  const form = document.getElementById('automation-lead-form');
  const state = document.getElementById('lead-state');
  const submit = document.getElementById('lead-submit');
  if (!form || !state || !submit) return;

  const value = (id) => String(document.getElementById(id)?.value || '').trim();
  const emit = (event, detail = {}) => {
    window.dispatchEvent(new CustomEvent('daube:money-first', {
      detail: { event, offerId: OFFER_ID, ...detail },
    }));
  };

  emit('offer_view', { surface: 'automation-sprint' });
  let started = false;
  form.addEventListener('input', () => {
    if (started) return;
    started = true;
    emit('qualification_start', { surface: 'automation-sprint' });
  }, { passive: true });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    state.textContent = 'Submitting your qualification request…';
    submit.disabled = true;

    const email = value('lead-email');
    const phone = value('lead-phone');
    if (!email && !phone) {
      state.textContent = 'Please provide an email address or phone number.';
      submit.disabled = false;
      return;
    }

    const idempotencyKey = `web-lead-${crypto.randomUUID()}`;
    const payload = {
      customerName: value('lead-name'),
      customerType: value('lead-type'),
      email,
      phone,
      preferredChannel: value('lead-channel') || 'email',
      workflowProblem: value('lead-problem'),
      currentTools: value('lead-tools'),
      desiredOutcome: value('lead-outcome'),
      frequencyOrVolume: value('lead-frequency'),
      dataSensitivity: value('lead-sensitivity') || 'unknown',
      targetTiming: value('lead-timing'),
      budgetBand: value('lead-budget'),
      billingMarket: value('lead-market') || 'UNKNOWN',
      consentPrivacy: document.getElementById('lead-consent')?.checked === true,
      idempotencyKey,
    };

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        credentials: 'omit',
        cache: 'no-store',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok || body?.ok !== true) throw new Error(body?.error || `http_${response.status}`);
      const leadCode = String(body.leadCode || '').trim();
      state.textContent = leadCode
        ? `Request received · ${leadCode}. No payment was created. D’AUBE will reply through your selected contact channel.`
        : 'Request received. No payment was created. D’AUBE will reply through your selected contact channel.';
      emit('qualification_submit', {
        billingMarket: payload.billingMarket,
        dataSensitivity: payload.dataSensitivity,
        result: 'accepted',
      });
      form.reset();
    } catch (cause) {
      const code = cause instanceof Error ? cause.message : 'operation_failed';
      const messages = {
        privacy_consent_required: 'Please accept the Privacy Policy before submitting.',
        workflow_problem_invalid: 'Please describe the workflow problem in a little more detail.',
        desired_outcome_invalid: 'Please describe the desired outcome.',
        contact_required: 'Please provide an email address or phone number.',
        rate_limited: 'Too many requests were submitted in a short period. Please try again later.',
        secret_field_forbidden: 'Do not include passwords, API keys, OTPs, PINs, CVVs or other secrets.',
      };
      state.textContent = messages[code] || 'The request could not be submitted right now. No payment was created.';
      emit('qualification_submit', { result: 'rejected', errorClass: code });
    } finally {
      submit.disabled = false;
    }
  });
})();
