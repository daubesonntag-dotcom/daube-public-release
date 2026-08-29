#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const htmlPath = path.join(root, 'creative-studio', 'index.html');
const jsPath = path.join(root, 'assets', 'creative-studio-v1.js');
const outDir = path.join(root, 'artifacts', 'creative-studio');
const html = fs.readFileSync(htmlPath, 'utf8');
const js = fs.readFileSync(jsPath, 'utf8');
const checks = [];
const add = (id, pass, detail) => checks.push({ id, points: 5, pass: Boolean(pass), earned: pass ? 5 : 0, detail });

add('canonical-route', html.includes('rel="canonical" href="https://daubesonntag.com/creative-studio/"'), 'Canonical Creative Studio route is exact.');
add('indexable', html.includes('index,follow') && !html.includes('noindex'), 'Public business line is intentionally indexable.');
add('offer-html', html.includes('DAUBE-CREATIVE-PRODUCTION-V1'), 'HTML pins the Creative Production offer.');
add('offer-js', js.includes("DAUBE-CREATIVE-PRODUCTION-V1"), 'Browser runtime pins the same offer.');
add('verified-lanes', ['WEB / UI','MOTION','VIDEO / VFX','CGI / 3D','AUDIO'].every((m) => html.includes(m)), 'Verified creative lanes are represented.');
add('truth-gpu', html.includes('GPU/model-provider capacity') && html.includes('capability evidence'), 'GPU/provider claims remain capability-bound.');
add('no-checkout-truth', html.includes('không tạo order, payment, settlement hay revenue') && html.includes('Creative brief · not checkout'), 'Qualification is explicitly separated from commerce truth.');
add('green-palette', html.includes('--deep:#0f3f2d') && html.includes('--green:#24754f') && !/#fff\b/i.test(html) && !/\bwhite\b/i.test(html), 'Public surface uses the green production palette without white fallback tokens.');
add('skip-link', html.includes('class="skip" href="#main"'), 'Keyboard skip navigation exists.');
add('focus-visible', html.includes(':focus-visible'), 'Visible keyboard focus styling exists.');
add('reduced-motion', html.includes('prefers-reduced-motion'), 'Reduced-motion preference is respected.');
add('target-size', html.includes('.button{min-height:50px') && html.includes('.pill{min-height:44px'), 'Primary interaction targets meet the explicit minimums.');
add('live-status', html.includes('role="status" aria-live="polite"'), 'Form status is announced accessibly.');
add('intake-endpoint', js.includes('daube-money-first-lead'), 'Browser posts only to the canonical lead runtime.');
add('idempotency', js.includes("'idempotency-key': idempotencyKey") && js.includes('crypto.randomUUID()'), 'Browser supplies a unique idempotency key.');
add('receipt-contract', js.includes("typeof result.leadRef !== 'string'") && js.includes('result.orderCreated !== false') && js.includes('result.paymentCreated !== false') && js.includes('result.revenueCountable !== false'), 'Success requires the non-commerce receipt contract.');
add('secret-screening', js.includes('hasSecret') && js.includes('lead_secret_material_forbidden'), 'Client and server error path protect against credential-like material.');
add('event-contract', js.includes('daube:creative-qualification-submitted') && js.includes('paymentCreated: false'), 'Successful qualification emits a bounded event only.');
add('no-public-secrets', !/(service_role|SUPABASE_SERVICE_ROLE_KEY|pdl_live_apikey_|webhook_secret|sk_live_)/i.test(`${html}\n${js}`), 'No known server credential markers appear in public assets.');
add('responsive-form', html.includes('@media(max-width:640px)') && html.includes('form{grid-template-columns:1fr}'), 'Mobile form collapses to a single-column layout.');

const score = checks.reduce((sum, c) => sum + c.earned, 0);
const failed = checks.filter((c) => !c.pass).map((c) => c.id);
const receipt = {
  schema: 'daube.creative-studio-quality.v1',
  generatedAt: new Date().toISOString(),
  score,
  max: 100,
  threshold: 95,
  status: score >= 95 ? 'GREEN' : 'RED',
  failed,
  checks,
  truthBoundary: 'GREEN proves the public Creative Studio surface, browser intake contract and static accessibility/security markers. It does not by itself prove GPU/provider capacity, customer acceptance, payment, settlement or revenue.'
};
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'quality-score.json'), `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
if (score < 95) process.exit(1);
