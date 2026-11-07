import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (name) => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

function luminance(hex) {
  const values = hex.replace('#', '').match(/.{2}/g).map(v => parseInt(v, 16) / 255);
  const linear = values.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('muted text and prices have WCAG AA base foreground contrast on light and dark cards', () => {
  const css = read('assets/work-v7.css');
  const inner = read('assets/work-v5-inner.css');
  assert.match(css, /--muted:#475866/);
  assert.match(css, /\.footer-note\{[^}]*color:#465866/);
  assert.match(inner, /\.price-card__tag\{[^}]*color:#71532e/);
  assert.match(inner, /\.price-card:nth-child\(3\) \.price-card__tag\{color:#f1d7ae\}/);
  assert.ok(contrast('#475866', '#fbfaf7') >= 4.5);
  assert.ok(contrast('#465866', '#f4f2ed') >= 4.5);
  assert.ok(contrast('#71532e', '#ffffff') >= 4.5);
  assert.ok(contrast('#f1d7ae', '#0b2945') >= 4.5);
});

test('interactive home cards support JavaScript button roles without invalid article-to-button mapping', () => {
  const html = read('index.html');
  const js = read('assets/work-v12-pure-cinema.js');
  assert.equal((html.match(/<div class="service">/g) || []).length, 4);
  assert.equal((html.match(/<div class="process-step">/g) || []).length, 4);
  assert.doesNotMatch(html, /<article class="service">|<article class="process-step">/);
  assert.match(js, /card\.setAttribute\('role','button'\)/);
  assert.match(js, /card\.addEventListener\('keydown'/);
  assert.match(js, /step\.addEventListener\('keydown'/);
});

test('each navigation landmark has its own accessible label', () => {
  for (const page of ['index.html', 'services/index.html', 'portfolio/index.html', 'pricing/index.html', 'contact/index.html']) {
    const html = read(page);
    const navs = [...html.matchAll(/<nav\b[^>]*>/g)].map(match => match[0]);
    assert.ok(navs.length >= 2, page);
    assert.ok(navs.every(nav => /aria-label=/.test(nav)), page);
  }
});

test('informational hero cards within main content do not create nested complementary landmarks', () => {
  for (const page of ['index.html', 'pay/index.html', 'terms/index.html', 'privacy/index.html']) {
    const html = read(page);
    assert.doesNotMatch(html, /<aside class="hero(?:__aside|-card)"/);
    assert.match(html, /<div class="hero(?:__aside|-card)"/);
  }
});
