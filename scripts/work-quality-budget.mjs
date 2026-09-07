import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const html = await readFile(new URL('index.html', root), 'utf8');
const fail = message => { console.error(`QUALITY_BUDGET_FAIL: ${message}`); process.exitCode = 1; };
const pass = message => console.log(`QUALITY_BUDGET_PASS: ${message}`);

const styles = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map(m => m[1]);
const scripts = [...html.matchAll(/<script[^>]+src="([^"]+)"/g)].map(m => m[1]);

if (styles.length <= 4) pass(`stylesheet count ${styles.length} <= 4`); else fail(`stylesheet count ${styles.length} > 4`);
if (scripts.length <= 1) pass(`external script count ${scripts.length} <= 1`); else fail(`external script count ${scripts.length} > 1`);

for (const required of ['work-v12-pure-cinema.css','work-v13-quality-gates.css','work-v15-navigation.css','work-v12-pure-cinema.js']) {
  if (html.includes(required)) pass(`required asset ${required}`); else fail(`missing ${required}`);
}

for (const forbidden of ['work-v8-cinematic','work-v9-cinema','work-v10-directors-cut','work-v11-grand-tour','lenis','gsap','three.min.js','barba','swup']) {
  if (html.toLowerCase().includes(forbidden.toLowerCase())) fail(`forbidden runtime token ${forbidden}`); else pass(`forbidden token absent: ${forbidden}`);
}

if (/width="1672"\s+height="941"/.test(html)) pass('hero intrinsic dimensions are explicit'); else fail('hero intrinsic dimensions missing');
if (/loading="eager"[^>]*fetchpriority="high"/.test(html)) pass('hero is eager/high priority'); else fail('hero priority contract missing');
if (/requestIdleCallback/.test(html) && /saveData/.test(html) && /effectiveType/.test(html)) pass('prefetch is idle and connection-aware'); else fail('prefetch budget guard missing');

if (process.exitCode) process.exit(process.exitCode);
