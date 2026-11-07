import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const home = read('../index.html');
const base = read('../assets/work-v7.css');
const inner = read('../assets/work-v5-inner.css');

test('service cards have a role-compatible container for keyboard selection', () => {
  assert.equal((home.match(/<div class="service">/g) ?? []).length, 4);
  assert.doesNotMatch(home, /<article class="service">/);
  const script = read('../assets/work-v12-pure-cinema.js');
  assert.match(script, /card\.setAttribute\('role','button'\)/);
  assert.match(script, /e\.key==='Enter'\|\|e\.key===' '/);
});

test('primary and footer navigation landmarks have distinct accessible names', () => {
  for (const p of ['pricing', 'contact']) {
    const html = read(`../${p}/index.html`);
    assert.match(html, /<nav class="main-nav" aria-label="Primary navigation">/);
    assert.match(html, /<nav class="footer-nav" aria-label="Footer navigation">/);
  }
});

test('static information cards do not create nested complementary landmarks', () => {
  for (const p of ['pay', 'terms', 'privacy']) {
    const html = read(`../${p}/index.html`);
    assert.match(html, /<div class="hero-card">/);
    assert.doesNotMatch(html, /<aside class="hero-card">/);
  }
  assert.match(home, /<div class="hero__aside" aria-label="Studio focus">/);
  assert.doesNotMatch(home, /<aside class="hero__aside"/);
});

function luminance(hex) {
  const values = [1, 3, 5].map(pos => parseInt(hex.slice(pos, pos + 2), 16) / 255);
  const corrected = values.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return corrected[0] * 0.2126 + corrected[1] * 0.7152 + corrected[2] * 0.0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('readable editorial text meets 4.5:1 on representative flat backgrounds', () => {
  assert.match(base, /--muted:#4a5c67;/);
  assert.match(base, /\.footer-note\{[^}]*color:#455761/);
  assert.match(base, /\.work-card p\{color:rgba\(255,255,255,\.94\)\}/);
  assert.match(inner, /\.price-card__tag\{[^}]*color:#664824/);
  assert.match(inner, /\.price-card:nth-child\(3\) \.price-card__tag\{color:#f4dfbd\}/);
  assert.ok(contrast('#4a5c67', '#fbfaf7') >= 4.5);
  assert.ok(contrast('#455761', '#fbfaf7') >= 4.5);
  assert.ok(contrast('#664824', '#ffffff') >= 4.5);
});
