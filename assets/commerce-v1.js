(() => {
  'use strict';

  const pad = (value) => String(value).padStart(2, '0');

  function createReference(prefix) {
    const now = new Date();
    const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
    const random = Math.random().toString(36).slice(2, 6).toUpperCase();
    return `DS-${prefix}-${date}-${random}`;
  }

  function fieldEntries(form) {
    return Array.from(new FormData(form).entries())
      .filter(([, value]) => String(value).trim())
      .map(([name, value]) => {
        const control = form.elements.namedItem(name);
        const label = control?.dataset?.label || name;
        return `${label}: ${String(value).trim()}`;
      });
  }

  function openMailClient(address, subject, body) {
    const href = `mailto:${address}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
  }

  document.querySelectorAll('[data-commerce-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();

      if (!form.reportValidity()) return;

      const address = form.dataset.mailto;
      const prefix = form.dataset.idPrefix || 'REQ';
      const type = form.dataset.requestType || 'Yêu cầu';
      const reference = createReference(prefix);
      const lines = fieldEntries(form);
      const transferLabel = prefix === 'ORD' ? `DAUBE ${reference}` : `DAUBE ${reference}`;

      const subject = `[${reference}] ${type}`;
      const body = [
        `Xin chào D’AUBE SONNTAG,`,
        '',
        `Mã tham chiếu: ${reference}`,
        ...lines,
        '',
        `Nội dung chuyển khoản khi được D’AUBE xác nhận: ${transferLabel}`,
        '',
        'Tôi hiểu rằng QR/thông tin thanh toán chỉ được gửi sau khi D’AUBE xác nhận yêu cầu/đơn hàng.',
      ].join('\n');

      const status = form.querySelector('[data-form-status]');
      if (status) {
        status.dataset.visible = 'true';
        status.innerHTML = `<strong>Đã tạo mã ${reference}</strong>Trình duyệt đang mở email gửi tới <a href="mailto:${address}">${address}</a>. Nếu ứng dụng email không mở, hãy gửi thủ công và ghi mã <b>${reference}</b> trong tiêu đề. D’AUBE chưa yêu cầu thanh toán ở bước này.`;
        status.focus();
      }

      openMailClient(address, subject, body);
    });
  });
})();
