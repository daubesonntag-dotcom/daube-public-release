const captureButton = document.querySelector('#capture');
const copyButton = document.querySelector('#copy');
const queueButton = document.querySelector('#queue');
const status = document.querySelector('#status');
const preview = document.querySelector('#preview');
let lastEnvelope = null;

function setStatus(message, kind = '') {
  status.textContent = message;
  status.dataset.kind = kind;
}

function isFacebookTab(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && /(^|\.)facebook\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

captureButton.addEventListener('click', async () => {
  setStatus('Capturing selected tab…');
  preview.value = '';
  copyButton.disabled = true;
  queueButton.disabled = true;
  lastEnvelope = null;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !isFacebookTab(tab.url || '')) throw new Error('Open the Facebook post/reel/page you want to capture, then try again.');
    const results = await chrome.scripting.executeScript({ target: { tabId: tab.id, frameIds: [0] }, files: ['capture.js'] });
    const envelope = results?.[0]?.result;
    if (!envelope || envelope.schema !== 'daube.facebook-reader-envelope.v1') throw new Error('Facebook markup could not be captured safely.');
    lastEnvelope = envelope;
    preview.value = JSON.stringify(envelope, null, 2);
    copyButton.disabled = false;
    queueButton.disabled = !envelope.source_url;
    setStatus(envelope.reader_quality === 'full' ? 'Captured. Canonical upstreams still require independent verification.' : 'Captured partial evidence. Do not infer missing content.', 'ok');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  }
});

copyButton.addEventListener('click', async () => {
  if (!lastEnvelope) return;
  try {
    await navigator.clipboard.writeText(JSON.stringify(lastEnvelope, null, 2));
    setStatus('Envelope copied. Paste only into an authorized D’AUBE intake.', 'ok');
  } catch {
    setStatus('Clipboard copy failed. You can select and copy the preview manually.', 'error');
  }
});

queueButton.addEventListener('click', async () => {
  if (!lastEnvelope?.source_url) return;
  const target = new URL('https://daubesonntag.com/radar/share/');
  target.searchParams.set('url', lastEnvelope.source_url);
  if (lastEnvelope.page_title) target.searchParams.set('title', lastEnvelope.page_title.slice(0, 500));
  await chrome.tabs.create({ url: target.toString() });
  setStatus('Opened D’AUBE Radar with source URL only; body text stayed out of the URL.', 'ok');
});
