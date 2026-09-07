import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const routes = [
  ['home', 'index.html'],
  ['portfolio', 'portfolio/index.html'],
  ['profile', 'profile/index.html'],
  ['services', 'services/index.html'],
  ['pricing', 'pricing/index.html'],
  ['contact', 'contact/index.html'],
];

for (const [name, path] of routes) {
  const html = await readFile(new URL(path, root), 'utf8');

  assert.match(html, /work-v15-navigation\.css/, `${name}: V15 navigation continuity asset is required`);
  assert.match(html, /<a class="brand"[^>]+aria-label=/, `${name}: brand link needs an accessible label`);
  assert.match(html, /<nav class="main-nav"[^>]+aria-label=/, `${name}: primary nav needs an accessible label`);

  assert.match(html, /<picture[^>]*class="(?:hero__picture|subhero__picture)"/, `${name}: hero must use a picture element`);
  assert.match(html, /media="\(max-width: 700px\)"[^>]+type="image\/avif"/, `${name}: mobile AVIF source is required`);
  assert.match(html, /media="\(max-width: 700px\)"[^>]+type="image\/webp"/, `${name}: mobile WebP source is required`);
  assert.match(html, /type="image\/avif"[^>]+srcset="[^"]*768[^"]*1200[^"]*1600/, `${name}: desktop AVIF srcset must expose 768/1200/1600 widths`);
  assert.match(html, /type="image\/webp"[^>]+srcset="[^"]*768[^"]*1200[^"]*1600/, `${name}: desktop WebP srcset must expose 768/1200/1600 widths`);
  assert.match(html, /width="1672"\s+height="941"/, `${name}: fallback hero dimensions must remain explicit`);
  assert.match(html, /loading="eager"[^>]*fetchpriority="high"/, `${name}: first hero must remain eager/high priority`);
}

const home = await readFile(new URL('index.html', root), 'utf8');
const scripts = [...home.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);
assert.equal(scripts.length, 1, 'homepage keeps one external runtime script');

for (const forbidden of ['work-v8-cinematic','work-v9-cinema','work-v10-directors-cut','work-v11-grand-tour','lenis','gsap','three.min.js','barba','swup']) {
  assert.equal(home.toLowerCase().includes(forbidden.toLowerCase()), false, `homepage must not restore ${forbidden}`);
}

console.log(`WORK_V16_FULL_STACK_CONTRACT_PASS routes=${routes.length}`);
