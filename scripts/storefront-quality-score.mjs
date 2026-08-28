#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const htmlPath = path.join(root, 'storefront/index.html');
const cssPath = path.join(root, 'assets/storefront-v2.css');
const mobilePath = path.join(root, 'assets/storefront-mobile-v3.css');
const jsPath = path.join(root, 'assets/storefront-v2.js');
const payPath = path.join(root, 'pay/index.html');

const html = fs.readFileSync(htmlPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const mobile = fs.readFileSync(mobilePath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');
const pay = fs.readFileSync(payPath, 'utf8');

const checks = [];
function check(category, id, points, pass, detail) {
  checks.push({ category, id, points, pass: Boolean(pass), earned: pass ? points : 0, detail });
}

// Native-currency pricing and truthful settlement — 25 points.
// Do not reward browser-side FX estimates. VND and USD price books must remain native and explicit.
check(
  'native-currency-pricing',
  'native-price-book-separation',
  5,
  /No silent FX/i.test(html) && /canonical VND amounts/i.test(html) && /Native USD offers/i.test(html),
  'VND and USD offers are presented as separate native price books with an explicit no-silent-FX boundary.',
);
check(
  'native-currency-pricing',
  'no-browser-fx',
  5,
  !/USD_REFERENCE_VND/.test(js) && !/moneyUsdEquivalent/.test(js) && /function moneyVnd\(/.test(js),
  'Runtime contains no hard-coded browser FX conversion and keeps canonical VND rendering deterministic.',
);
check(
  'native-currency-pricing',
  'local-settlement-boundary',
  5,
  /(exact canonical VND amount|exact VND settlement amount|local catalog uses VND)/i.test(html)
    && /moneyVnd\(receipt\.payment\.amountVnd\)/.test(js),
  'Local settlement uses the exact order-bound VND amount rather than an estimated converted display price.',
);
check(
  'native-currency-pricing',
  'exact-usd-surface',
  5,
  /href="\/pay\/"/.test(html) && /US\$15/.test(pay) && /US\$39/.test(pay) && /US\$95/.test(pay),
  'Exact native USD Workflow Kit prices remain on the dedicated USD surface.',
);
check(
  'native-currency-pricing',
  'currency-truth-copy',
  5,
  /does not calculate a browser-side USD equivalent/i.test(html)
    && /international USD products use their own native USD price book/i.test(html),
  'Customer-facing copy explains that D’AUBE does not invent an FX equivalent between native price books.',
);

// Information architecture and conversion clarity — 25 points.
check('information-architecture', 'single-purpose-hero', 5, /Better work,<br><em>without the clutter\.<\/em>/.test(html), 'Hero states one clear customer proposition.');
check(
  'information-architecture',
  'curated-catalog',
  5,
  /VND CATALOG/.test(html) && /Choose what moves the work forward\./.test(html),
  'Catalog is framed around customer outcomes and clearly names its native price book.',
);
check('information-architecture', 'professional-collections', 5, ['Infrastructure & Operations','Business Tools & Growth','Gifting & Personal Services','Experimental Studio'].every((value) => js.includes(value)), 'Unrelated offers are separated into professional collections.');
check(
  'information-architecture',
  'checkout-paths',
  5,
  /CHECKOUT PATHS/.test(html) && /Native currency first\. Settlement truth always\./.test(html)
    && html.indexOf('CHECKOUT PATHS') > html.indexOf('id="catalog"'),
  'Payment paths are explained after the catalog and preserve native-currency settlement truth.',
);
check('information-architecture', 'order-recovery', 5, /id="order-status"/.test(html) && /Track without chasing\./.test(html), 'Order status is a dedicated recovery path.');

// Accessibility and interaction quality — 25 points.
check('accessibility', 'skip-link', 5, /class="skipLink"/.test(html) && /href="#catalog"/.test(html), 'Keyboard users can skip navigation.');
check('accessibility', 'single-h1', 5, (html.match(/<h1\b/g) || []).length === 1, 'Exactly one H1 is present.');
check('accessibility', 'focus-visible', 5, /:focus-visible/.test(css) && /outline:3px/.test(css), 'Interactive controls have visible keyboard focus.');
check('accessibility', 'touch-targets', 5, /min-height:44px/.test(mobile) && /min-height:48px/.test(css), 'Primary controls meet the 44px touch-target floor.');
check('accessibility', 'reduced-motion', 5, /prefers-reduced-motion:reduce/.test(css) && /prefers-reduced-motion: reduce/.test(mobile), 'Reduced-motion mode removes nonessential movement.');

// Visual hygiene and performance — 25 points.
const storefrontBytes = {
  html: Buffer.byteLength(html),
  css: Buffer.byteLength(css),
  mobile: Buffer.byteLength(mobile),
  js: Buffer.byteLength(js),
};
check('visual-performance', 'green-system', 5, /--green:#1f6b48/.test(css) && /--green-strong:#0f5132/.test(css), 'Storefront uses the approved green-forward local art direction.');
check('visual-performance', 'no-yellow-red-palette', 5, !/(#eef06a|#f8f6b9|#a53d3d|#7c3737|\bred\b|\byellow\b)/i.test(css), 'Storefront presentation contains no legacy yellow/red palette markers.');
check('visual-performance', 'css-budget', 5, storefrontBytes.css < 40000 && storefrontBytes.mobile < 8000, `CSS bytes: ${storefrontBytes.css} + ${storefrontBytes.mobile}.`);
check('visual-performance', 'js-budget', 5, storefrontBytes.js < 30000, `JS bytes: ${storefrontBytes.js}.`);
check('visual-performance', 'html-budget', 5, storefrontBytes.html < 20000, `HTML bytes: ${storefrontBytes.html}.`);

const score = checks.reduce((sum, item) => sum + item.earned, 0);
const max = checks.reduce((sum, item) => sum + item.points, 0);
const threshold = 95;
const failed = checks.filter((item) => !item.pass);
const report = {
  schema: 'daube.storefront-quality-score.v2',
  generatedAt: new Date().toISOString(),
  score,
  max,
  threshold,
  status: score >= threshold ? 'GREEN' : 'BLOCKED',
  failed: failed.map(({ category, id, detail }) => ({ category, id, detail })),
  checks,
  storefrontBytes,
  truthBoundary: 'A GREEN score proves the bounded storefront source-quality contract. It does not prove external settlement, customer conversion, provider admission, or deployed-domain readback.',
};

const output = path.join(root, 'artifacts/storefront-quality-score.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## D’AUBE Storefront Quality Score\n\n- Score: **${score}/${max}**\n- Threshold: **${threshold}**\n- Status: **${report.status}**\n- Failed checks: **${failed.length}**\n`);
}

process.exit(score >= threshold ? 0 : 1);