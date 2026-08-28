#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const htmlPath = path.join(root, 'recovery/index.html');
const receiptPath = path.join(root, 'artifacts/recovery-dawn/receipt.json');
const html = fs.readFileSync(htmlPath, 'utf8');
const receipt = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
const bytes = Buffer.byteLength(html);
const checks = [];

function check(category, id, points, pass, detail) {
  checks.push({ category, id, points, pass: Boolean(pass), earned: pass ? points : 0, detail });
}

const articleCards = (html.match(/<article class="card">/g) || []).length;
const h1Count = (html.match(/<h1\b/g) || []).length;
const desktop = receipt.cases?.find(item => item.name === 'desktop-1440x900');
const mobile = receipt.cases?.find(item => item.name === 'mobile-390x844-reduced');

// 1) Information architecture & semantic clarity — 25 points.
check('clarity', 'single-proposition-hero', 5,
  /Một hiện diện đủ rõ để người phù hợp <em>hiểu bạn\.<\/em>/.test(html),
  'Hero states one specific proposition instead of a CGI/technology capability label.');
check('clarity', 'field-principle', 5,
  /Rõ trước\. Đẹp sau\.<br>Đúng rồi mới mở rộng\./.test(html),
  'The D’AUBE clarity principle is visible as a primary narrative beat.');
check('clarity', 'three-meaning-lanes', 5,
  articleCards === 3 && ['Sản phẩm số','Hệ thống & vận hành','Thương hiệu & trải nghiệm'].every(value => html.includes(value)),
  'The surface explains exactly three distinct ways D’AUBE creates value.');
check('clarity', 'evidence-chapter', 5,
  /Đẹp phải đi cùng<br>bằng chứng\./.test(html) && /Exact revision/.test(html) && /EVIDENCE FIRST/.test(html),
  'Visual craft is explicitly paired with evidence and release discipline.');
check('clarity', 'clear-action-path', 5,
  /href="#worlds">Khám phá D’AUBE/.test(html) && /href="#presence">Xem nguyên tắc/.test(html) && /Có một điều cần<br>thành hình\?/.test(html),
  'Primary, secondary and closing actions form a coherent journey.');

// 2) Accessibility & interaction — 25 points.
check('accessibility', 'skip-link', 5,
  /class="skip" href="#main"/.test(html),
  'Keyboard users can bypass navigation.');
check('accessibility', 'single-h1', 5,
  h1Count === 1,
  `Exactly one H1 is required; found ${h1Count}.`);
check('accessibility', 'focus-visible', 5,
  /:focus-visible\{outline:3px solid var\(--green\)/.test(html),
  'Keyboard focus has a visible 3px high-contrast outline.');
check('accessibility', 'touch-target-floor', 5,
  /\.button\{min-height:48px/.test(html) && /@media\(max-width:620px\)/.test(html),
  'Primary controls exceed the 44px touch-target floor and have a dedicated mobile composition.');
check('accessibility', 'reduced-motion', 5,
  /@media\(prefers-reduced-motion:reduce\)/.test(html) && /matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(html),
  'CSS and runtime both respect reduced-motion preferences.');

// 3) Visual system & performance discipline — 25 points.
check('visual-performance', 'architectural-dawn-language', 5,
  ['archOuter','archInner','curtainLeft','curtainRight','floor','vase','stem'].every(value => html.includes(value)),
  'Hero uses a coherent architectural threshold / first-light vocabulary rather than a generic abstract CGI object.');
check('visual-performance', 'light-dark-rhythm', 5,
  /--paper:#f1eadf/.test(html) && /--night:#171713/.test(html) && /class="night"/.test(html) && /class="closing"/.test(html),
  'The page has deliberate warm-light, dark-evidence and closing tonal chapters.');
check('visual-performance', 'green-status-semantics', 5,
  /--green:#285c49/.test(html) && /\.menuDot\{[^}]*background:var\(--green\)/.test(html) && !/--(?:red|yellow|danger|warning):/i.test(html),
  'Operational/status semantics are green; dawn amber remains art direction rather than warning status.');
check('visual-performance', 'dependency-free-hero', 5,
  !/<img\b/i.test(html) && !/<video\b/i.test(html) && !/<script\s+[^>]*src=/i.test(html) && !/<link\s+[^>]*rel=["']stylesheet/i.test(html),
  'Recovery hero is self-contained and has no external media/font/script dependency.');
check('visual-performance', 'html-byte-budget', 5,
  bytes <= 40000,
  `Self-contained recovery HTML is ${bytes} bytes; budget is 40000 bytes.`);

// 4) Browser evidence & truth boundary — 25 points.
check('browser-evidence', 'receipt-green', 5,
  receipt.ok === true && Array.isArray(receipt.cases) && receipt.cases.length === 2,
  'Chromium verifier produced a green two-viewport receipt.');
check('browser-evidence', 'desktop-runtime', 5,
  desktop?.checks === 'PASS' && desktop?.viewport?.width === 1440 && desktop?.viewport?.height === 900 && desktop?.allRevealsVisible === true,
  'Desktop 1440×900 runtime, accessibility and full-page reveal checks passed.');
check('browser-evidence', 'mobile-reduced-runtime', 5,
  mobile?.checks === 'PASS' && mobile?.viewport?.width === 390 && mobile?.viewport?.height === 844 && mobile?.reducedMotion === true && mobile?.allRevealsVisible === true,
  'Mobile 390×844 reduced-motion runtime and full-page reveal checks passed.');
check('browser-evidence', 'evidence-boundary', 5,
  receipt.truthBoundaryPreserved === true && receipt.fullPageVisualEvidence === true && receipt.externalMediaRequired === false,
  'Evidence proves the bounded recovery surface without inventing provider/canonical-production claims.');
check('browser-evidence', 'recovery-truth-copy', 5,
  /Public recovery surface online/.test(html) && /canonical apex authority remains daubesonntag\.com/.test(html) && /recovery ≠ final sovereign production/.test(html) && /noindex,nofollow,noarchive,nosnippet/.test(html),
  'Recovery is visibly operational while remaining non-canonical and non-indexed.');

const score = checks.reduce((sum, item) => sum + item.earned, 0);
const max = checks.reduce((sum, item) => sum + item.points, 0);
const threshold = 95;
const failed = checks.filter(item => !item.pass);
const report = {
  schema: 'daube.recovery-dawn-quality-score.v1',
  generatedAt: new Date().toISOString(),
  score,
  max,
  threshold,
  status: score >= threshold ? 'GREEN' : 'BLOCKED',
  failed: failed.map(({ category, id, detail }) => ({ category, id, detail })),
  checks,
  metrics: { recoveryHtmlBytes: bytes, h1Count, cardCount: articleCards, browserCases: receipt.cases?.length ?? 0 },
  truthBoundary: 'A GREEN score proves the bounded D’AUBE recovery surface source, interaction, browser and visual-system contract. It does not prove canonical apex cutover, Cloudflare credential availability, commercial conversion, or sovereign production admission.',
};

const output = path.join(root, 'artifacts/recovery-dawn/quality-score.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## D’AUBE Recovery Dawn Quality Score\n\n- Score: **${score}/${max}**\n- Threshold: **${threshold}**\n- Status: **${report.status}**\n- Failed checks: **${failed.length}**\n- HTML bytes: **${bytes}**\n`);
}

process.exit(score >= threshold ? 0 : 1);
