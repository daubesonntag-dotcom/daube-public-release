import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = p => readFile(new URL(`../${p}`, import.meta.url), 'utf8');

test('homepage activates only the curated V15 navigation layer', async () => {
  const [html, css] = await Promise.all([
    read('index.html'),
    read('assets/work-v15-navigation.css'),
  ]);

  assert.match(html, /work-v15-navigation\.css\?v=44761b2/);
  assert.match(html, /loading="eager"[^>]*fetchpriority="high"/);
  assert.match(css, /@view-transition\{navigation:auto\}/);
  assert.match(css, /view-transition-name:daube-brand/);
  assert.match(css, /view-transition-name:daube-hero-media/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /max-height:680px/);
});

test('homepage prefetch is connection-aware and idle-scheduled', async () => {
  const html = await read('index.html');
  assert.match(html, /saveData/);
  assert.match(html, /effectiveType/);
  assert.match(html, /requestIdleCallback/);
  assert.match(html, /IntersectionObserver/);
  assert.match(html, /u\.origin!==location\.origin/);
});

test('V15 does not add a JS router or global animation dependency', async () => {
  const html = await read('index.html');
  const forbidden = ['lenis', 'gsap', 'framer-motion', 'motion.dev', 'three.min.js', 'barba', 'swup'];
  for (const token of forbidden) assert.equal(html.toLowerCase().includes(token), false, `forbidden runtime dependency: ${token}`);
});
