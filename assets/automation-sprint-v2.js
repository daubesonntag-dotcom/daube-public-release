(() => {
  'use strict';

  const OFFER_ID = 'DAUBE-AUTOMATION-SPRINT-V1';
  const ENDPOINT = 'https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-money-first-lead';
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

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;

    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.disabled = true;
    setStatus('Sending securely…');

    const payload = {
      offer_id: OFFER_ID,
      customer_type: value('customer_type'),
      workflow_problem: value('workflow_problem'),
      current_tools: value('current_tools'),
      desired_outcome: value('desired_outcome'),
      frequency_or_volume: value('frequency_or_volume'),
      data_sensitivity: value('data_sensitivity'),
      target_timing: value('target_timing'),
      budget_band: value('budget_band'),
      billing_market: value('billing_market'),
      contact_channel: value('contact_channel'),
      company_website: value('company_website'),
      consent_to_contact: Boolean(form.elements.namedItem('consent_to_contact')?.checked),
    };

    try {
      const response = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true || result.accepted !== true) {
        const code = typeof result.error === 'string' ? result.error : `http_${response.status}`;
        throw new Error(code);
      }

      const receipt = typeof result.leadId === 'string' ? result.leadId.slice(0, 8) : 'received';
      setStatus(`Received · reference ${receipt}. No payment was created.`, 'success');
      form.reset();
      window.dispatchEvent(new CustomEvent('daube:money-offer-qualification-submitted', {
        detail: {
          offerId: OFFER_ID,
          state: result.state || 'RECEIVED',
          paymentCreated: false,
          revenueRecorded: false,
        },
      }));
    } catch (error) {
      const code = error instanceof Error ? error.message : 'submission_failed';
      const friendly = code === 'rate_limited'
        ? 'This contact has reached the 24-hour submission limit. Please use the Contact page if you need help.'
        : 'The intake runtime could not accept this request. Nothing was charged. Please try again or use Contact.';
      setStatus(friendly, 'error');
    } finally {
      if (submit) submit.disabled = false;
    }
  });
})();
