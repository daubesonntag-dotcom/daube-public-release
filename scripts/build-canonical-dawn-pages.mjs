#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'recovery/index.html');
const outputPath = path.join(root, 'index.html');
const automationPath = path.join(root, 'automation-sprint', 'index.html');
const automationJsPath = path.join(root, 'assets', 'automation-sprint-v2.js');
let html = fs.readFileSync(sourcePath, 'utf8');
const automationHtml = fs.readFileSync(automationPath, 'utf8');
const automationJs = fs.readFileSync(automationJsPath, 'utf8');

function replaceOnce(from, to, label) {
  if (!html.includes(from)) throw new Error(`canonical_projection_missing:${label}`);
  html = html.replace(from, to);
}

replaceOnce(
  '<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">',
  '<meta name="robots" content="index,follow,max-image-preview:large">',
  'robots'
);
replaceOnce(
  '<meta name="description" content="D’AUBE SONNTAG · RẠNG TRONG — public recovery surface. Meaning, made visible.">',
  '<meta name="description" content="D’AUBE SONNTAG · RẠNG TRONG — sản phẩm số, hệ thống hữu ích và trải nghiệm thương hiệu. Meaning, made visible.">\n  <link rel="canonical" href="https://daubesonntag.com/">',
  'description-canonical'
);
replaceOnce('<body>', '<body data-canonical-projection="dawn-clarity-pages-v1">', 'body-marker');
replaceOnce(
  '<div class="actions" data-reveal><a class="button buttonPrimary" href="https://daubesonntag.com/">Về D’AUBE SONNTAG <span aria-hidden="true">→</span></a><a class="button" href="#top">Trở lại bình minh</a></div>',
  '<div class="actions" data-reveal><a class="button buttonPrimary" href="/storefront/">Khám phá sản phẩm <span aria-hidden="true">→</span></a><a class="button" href="/automation-sprint/">Automation Sprint</a><a class="button" href="/pay/">D’AUBE Pay</a></div>',
  'closing-actions'
);
replaceOnce(
  '<small>RẠNG TRONG · “Meaning, made visible.”<br>Bề mặt này là public recovery presentation — một lối vào có thật, nhưng không tự nhận là sovereign production cuối cùng.</small>',
  '<small>RẠNG TRONG · “Meaning, made visible.”<br>Sản phẩm số, hệ thống hữu ích và trải nghiệm thương hiệu được trình bày với phạm vi, giá, chính sách và trạng thái thanh toán rõ ràng.</small>',
  'footer-copy'
);
replaceOnce(
  '<div class="footerCol"><div class="footerTitle">Surface</div><div>Public recovery</div><div>Zero secret exposure</div><div>Immutable release target</div></div>',
  '<div class="footerCol"><div class="footerTitle">Explore</div><div><a href="/storefront/">Storefront</a></div><div><a href="/automation-sprint/">Automation Sprint</a></div><div><a href="/pay/">D’AUBE Pay</a></div><div><a href="/pricing/">Pricing</a></div><div><a href="/contact/">Contact</a></div><div><a href="/terms/">Terms</a> · <a href="/privacy/">Privacy</a> · <a href="/refund/">Refunds</a></div></div>',
  'footer-navigation'
);
replaceOnce(
  '<div class="truthRail" role="status" aria-live="polite"><span class="menuDot" aria-hidden="true"></span><span>Public recovery surface online · canonical apex authority remains daubesonntag.com · recovery ≠ final sovereign production</span></div>',
  '<div class="truthRail" role="status" aria-live="polite"><span class="menuDot" aria-hidden="true"></span><span>D’AUBE public site · evidence-backed release · payment and policy routes remain independently verifiable</span></div>',
  'status-rail'
);

const required = [
  'data-canonical-projection="dawn-clarity-pages-v1"',
  'rel="canonical" href="https://daubesonntag.com/"',
  'Một hiện diện đủ rõ',
  'Rõ trước. Đẹp sau.',
  'Meaning,',
  'href="/storefront/"',
  'href="/automation-sprint/"',
  'href="/pay/"',
  'href="/pricing/"',
  'href="/terms/"',
  'href="/privacy/"',
  'href="/refund/"',
  'href="/contact/"',
];
for (const marker of required) {
  if (!html.includes(marker)) throw new Error(`canonical_projection_required_marker_missing:${marker}`);
}
for (const forbidden of [
  'noindex,nofollow,noarchive,nosnippet',
  'founder-visual-lock/01-hero-dawn.webp',
  'PHYSICAL CGI',
  'recovery ≠ final sovereign production',
]) {
  if (html.includes(forbidden)) throw new Error(`canonical_projection_forbidden_marker:${forbidden}`);
}

for (const marker of [
  'DAUBE-AUTOMATION-SPRINT-V1',
  'No payment is created by this form.',
  'from US$149',
  'from €139',
  'from 2,900,000 VND',
  '/assets/automation-sprint-v2.js',
]) {
  if (!automationHtml.includes(marker)) throw new Error(`automation_sprint_marker_missing:${marker}`);
}
for (const marker of [
  'DAUBE-AUTOMATION-SPRINT-V1',
  'daube-money-first-lead',
  'paymentCreated: false',
  'revenueRecorded: false',
  'daube:money-offer-qualification-submitted',
]) {
  if (!automationJs.includes(marker)) throw new Error(`automation_sprint_js_marker_missing:${marker}`);
}
for (const forbidden of [
  'service_role',
  'SUPABASE_SERVICE_ROLE_KEY',
  'pdl_live_apikey_',
  'webhook_secret',
]) {
  if (automationHtml.includes(forbidden) || automationJs.includes(forbidden)) {
    throw new Error(`automation_sprint_public_secret_marker:${forbidden}`);
  }
}

const healthUrl = 'https://wilqsqndjgckqxbjptxm.supabase.co/functions/v1/daube-money-first-lead/health';
const healthResponse = await fetch(healthUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
if (!healthResponse.ok) throw new Error(`automation_sprint_health_http:${healthResponse.status}`);
const health = await healthResponse.json();
if (health?.ok !== true || health?.status !== 'READY' || health?.offerId !== 'DAUBE-AUTOMATION-SPRINT-V1' || health?.directPublicTableAccess !== false || health?.paymentCreatedByThisEndpoint !== false || health?.revenueRecordedByThisEndpoint !== false) {
  throw new Error('automation_sprint_health_contract_invalid');
}

fs.writeFileSync(outputPath, html);
console.log(JSON.stringify({
  schema: 'daube.canonical-dawn-pages-projection.v2',
  ok: true,
  source: 'recovery/index.html',
  output: 'index.html',
  bytes: Buffer.byteLength(html),
  externalHeroMedia: false,
  indexable: true,
  canonical: 'https://daubesonntag.com/',
  automationSprint: {
    admitted: true,
    offerId: 'DAUBE-AUTOMATION-SPRINT-V1',
    leadRuntime: 'READY',
    paymentCreatedByQualification: false,
    revenueRecordedByQualification: false,
  },
}));
