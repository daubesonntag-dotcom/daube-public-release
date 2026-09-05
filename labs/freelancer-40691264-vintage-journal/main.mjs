import { countCharacters, formatEntryStamp, nextPaperAccent, normalizeNotes, nextPage, previousPage } from './journal-core.mjs';

const STORAGE_KEY = 'daube-journal-concept-v1';
const PAGE_COUNT = 4;
const app = document.querySelector('#journal-app');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const BOOKMARK_KEY = 'daube-journal-bookmarks-v1';
const ACCENT_KEY = 'daube-journal-paper-accent-v1';

const pageMeta = [
  { kicker: 'Entry I', title: 'A quiet beginning', prompt: 'Write what you want to remember from today…' },
  { kicker: 'Entry II', title: 'Between the pages', prompt: 'Leave a thought, a fragment, a small promise…' },
  { kicker: 'Entry III', title: 'Pressed petals', prompt: 'Capture something ordinary before it disappears…' },
  { kicker: 'Entry IV', title: 'Last light', prompt: 'Close the day with one sentence worth keeping…' },
];

function loadNotes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return normalizeNotes(parsed, PAGE_COUNT);
  } catch {
    return normalizeNotes([], PAGE_COUNT);
  }
}

let notes = loadNotes();
let bookmarks = (() => {
  try { return JSON.parse(localStorage.getItem(BOOKMARK_KEY) || '[false,false,false,false]'); } catch { return [false,false,false,false]; }
})();
let paperAccent = localStorage.getItem(ACCENT_KEY) || 'ivory';
let pageIndex = 0;

function saveNotes() { localStorage.setItem(STORAGE_KEY, JSON.stringify(notes)); }
function saveBookmarks() { localStorage.setItem(BOOKMARK_KEY, JSON.stringify(bookmarks)); }
function savePaperAccent() { localStorage.setItem(ACCENT_KEY, paperAccent); }

function escapeText(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
}
function renderTabs() {
  return pageMeta.map((page, index) => {
    const active = pageIndex === index + 1 ? ' is-active' : '';
    return `<button class="page-tab${active}" data-page-tab="${index + 1}" aria-label="Open ${page.kicker}">${index + 1}</button>`;
  }).join('');
}

function renderCover() {
  return `<section class="paper cover" data-paper>
    <div class="cover-ornament" aria-hidden="true">✦</div>
    <p class="eyebrow">A small place for slow thoughts</p>
    <h1>The Sunday Journal</h1>
    <p class="cover-copy">A lightweight interaction study: editable pages, browser-local memory, page turns, petals and stardust.</p>
    <button class="primary-action" data-next>Open the journal</button>
  </section>`;
}

function renderEntry() {
  const meta = pageMeta[pageIndex - 1];
  const note = notes[pageIndex - 1];
  const bookmarked = Boolean(bookmarks[pageIndex - 1]);
  const finalAction = pageIndex === PAGE_COUNT ? '<button class="text-action" data-cover>Return to cover</button>' : '';
  return `<section class="paper entry accent-${paperAccent}" data-paper>
    <div class="entry-ribbon ${bookmarked ? 'is-bookmarked' : ''}" aria-hidden="true"></div>
    <header class="entry-header"><div><p class="eyebrow">${meta.kicker}</p><h2>${meta.title}</h2></div><time class="entry-stamp">${formatEntryStamp(new Date())}</time></header>
    <label class="sr-only" for="journal-note">Journal text for ${meta.kicker}</label>
    <textarea id="journal-note" data-note maxlength="1200" placeholder="${meta.prompt}">${escapeText(note)}</textarea>
    <div class="entry-meta"><span data-character-count>${countCharacters(note)} / 1200</span><span data-save-status>Saved in this browser</span></div>
    <footer><button class="text-action" data-bookmark>${bookmarked ? 'Remove bookmark' : 'Bookmark this page'}</button>${finalAction}</footer>
  </section>`;
}
function renderOfferPanel() {
  return `<section class="offer-panel" aria-labelledby="offer-title">
    <div class="offer-intro"><p class="eyebrow">Choose the finish, not the risk</p><h2 id="offer-title">Two scopes. Both cared for.</h2><p>The posted scope stays fully available at $129. Collector Edition is an optional premium upgrade, never a bait-and-switch.</p></div>
    <div class="offer-grid">
      <article class="offer-card" data-offer-tier="studio">
        <p class="offer-label">Studio Care Plus</p><h3>Posted Scope — $129</h3><p class="offer-summary">A complete vintage journal experience with tactile interactions, thoughtful personalization and real aftercare.</p>
        <ul><li>Polished vintage journal + responsive QA</li><li>Persistent page bookmarks</li><li>3 subtle paper accents</li><li>Entry date stamp + character counter</li><li>Live autosave feedback</li><li>1 revision round</li><li>14-day in-scope bug care + 7-day launch check-in</li><li>1 minor polish pass</li><li>No surprise billing</li></ul>
        <p class="gift-line">Complimentary gifts: one visual accent/theme variation + one signature decorative motif tailored to the final direction.</p>
      </article>
      <article class="offer-card featured" data-offer-tier="collector">
        <div class="collector-ribbon">Collector privilege</div><p class="offer-label">Collector Care Passport</p><h3>Collector Edition — $300</h3><p class="offer-summary">For a presentation-ready finish with deeper polish, launch care and future-value bonuses.</p>
        <ul><li>Premium visual finish + expanded motion polish</li><li>3 curated mood themes</li><li>2 revision rounds</li><li>30-day in-scope bug care</li><li>14-day launch hypercare</li><li>1 post-launch compatibility check</li><li>Priority handling for in-scope follow-up</li></ul>
        <div class="bonus-box"><strong>Complimentary Collector Bonuses</strong><span>Seasonal theme · signature micro-interaction · future minor enhancement credit</span></div>
      </article>
    </div>
    <p class="offer-footnote">Support applies to delivered in-scope work. Material scope changes are quoted separately before work starts.</p>
  </section>`;
}

function renderShell() {
  app.innerHTML = `<div class="demo-shell">
    <div class="proof-badge">D’AUBE Concept Proof — speculative, not client work</div>
    <div class="journal-stage accent-${paperAccent}">
      <div class="ambient-light" aria-hidden="true"></div><div class="floating-motes" aria-hidden="true"></div><div class="effects" aria-hidden="true"></div>
      ${pageIndex === 0 ? renderCover() : renderEntry()}
      <nav class="page-tabs" aria-label="Journal pages">${renderTabs()}</nav>
    </div>
    <div class="toolbar" aria-label="Journal controls">
      <button data-prev ${pageIndex === 0 ? 'disabled' : ''}>Previous</button>
      <span class="page-status">${pageIndex === 0 ? 'Cover' : `Page ${pageIndex} of ${PAGE_COUNT}`}</span>
      <button data-next>${pageIndex === PAGE_COUNT ? 'Cover' : 'Next'}</button>
      <span class="toolbar-spacer"></span>
      <button data-paper-accent>Paper accent: ${paperAccent}</button>
      <button data-export>Export notes</button>
      <button class="danger-quiet" data-reset>Reset demo</button>
    </div>
    <p class="prototype-note">Concept scope only. Full promo capture and final asset polish remain reserved for an awarded project.</p>
    ${renderOfferPanel()}
  </div>`;
  bindEvents();
}

function animateTurn(direction = 1) {
  if (reducedMotion.matches) return;
  const paper = app.querySelector('[data-paper]');
  if (!paper) return;
  paper.classList.remove('flip-forward', 'flip-back');
  void paper.offsetWidth;
  paper.classList.add(direction >= 0 ? 'flip-forward' : 'flip-back');
  burstEffects();
}
function burstEffects() {
  const layer = app.querySelector('.effects');
  if (!layer || reducedMotion.matches) return;
  layer.replaceChildren();
  const count = pageIndex === PAGE_COUNT ? 18 : 11;
  for (let i = 0; i < count; i += 1) {
    const spark = document.createElement('i');
    spark.className = i % 3 === 0 ? 'petal' : 'stardust';
    spark.style.setProperty('--x', `${8 + Math.random() * 84}%`);
    spark.style.setProperty('--drift', `${-55 + Math.random() * 110}px`);
    spark.style.setProperty('--delay', `${Math.random() * 0.22}s`);
    spark.style.setProperty('--duration', `${0.8 + Math.random() * 0.8}s`);
    layer.append(spark);
  }
  window.setTimeout(() => layer.replaceChildren(), 1900);
}

function goTo(next, direction = 1) {
  pageIndex = Math.max(0, Math.min(PAGE_COUNT, next));
  renderShell();
  animateTurn(direction);
  app.querySelector('[data-paper]')?.focus?.({ preventScroll: true });
}

function exportNotes() {
  const payload = JSON.stringify({ kind: 'daube-speculative-journal', notes }, null, 2);
  const blob = new Blob([payload], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = Object.assign(document.createElement('a'), { href: url, download: 'sunday-journal-notes.json' });
  anchor.click();
  URL.revokeObjectURL(url);
}
function bindEvents() {
  app.querySelectorAll('[data-page-tab]').forEach((button) => {
    button.addEventListener('click', () => goTo(Number(button.dataset.pageTab), Number(button.dataset.pageTab) >= pageIndex ? 1 : -1));
  });
  app.querySelectorAll('[data-next]').forEach((button) => button.addEventListener('click', () => goTo(nextPage(pageIndex, PAGE_COUNT), 1)));
  app.querySelector('[data-prev]')?.addEventListener('click', () => goTo(previousPage(pageIndex, PAGE_COUNT), -1));
  app.querySelector('[data-cover]')?.addEventListener('click', () => goTo(0, 1));
  app.querySelector('[data-note]')?.addEventListener('input', (event) => {
    notes[pageIndex - 1] = event.target.value;
    saveNotes();
    const count = app.querySelector('[data-character-count]');
    const status = app.querySelector('[data-save-status]');
    if (count) count.textContent = `${countCharacters(event.target.value)} / 1200`;
    if (status) status.textContent = 'Saved just now';
  });
  app.querySelector('[data-bookmark]')?.addEventListener('click', () => {
    bookmarks[pageIndex - 1] = !bookmarks[pageIndex - 1];
    saveBookmarks();
    renderShell();
  });
  app.querySelector('[data-paper-accent]')?.addEventListener('click', () => {
    paperAccent = nextPaperAccent(paperAccent);
    savePaperAccent();
    renderShell();
  });
  app.querySelector('[data-export]')?.addEventListener('click', exportNotes);
  app.querySelector('[data-reset]')?.addEventListener('click', () => {
    if (!window.confirm('Reset all notes saved by this concept demo?')) return;
    notes = normalizeNotes([], PAGE_COUNT);
    localStorage.removeItem(STORAGE_KEY);
    bookmarks = [false, false, false, false];
    localStorage.removeItem(BOOKMARK_KEY);
    paperAccent = 'ivory';
    localStorage.removeItem(ACCENT_KEY);
    goTo(0, -1);
  });
  app.querySelector('[data-paper]')?.addEventListener('click', (event) => {
    if (event.target.closest('textarea,button,a,label')) return;
    goTo(nextPage(pageIndex, PAGE_COUNT), 1);
  });
}

renderShell();
