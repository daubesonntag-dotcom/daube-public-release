#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const sourcePath = path.join(root, 'recovery/index.html');
const outputPath = path.join(root, 'index.html');
let html = fs.readFileSync(sourcePath, 'utf8');

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
  '<div class="actions" data-reveal><a class="button buttonPrimary" href="/storefront/">Khám phá sản phẩm <span aria-hidden="true">→</span></a><a class="button" href="/pay/">D’AUBE Pay</a></div>',
  'closing-actions'
);
replaceOnce(
  '<small>RẠNG TRONG · “Meaning, made visible.”<br>Bề mặt này là public recovery presentation — một lối vào có thật, nhưng không tự nhận là sovereign production cuối cùng.</small>',
  '<small>RẠNG TRONG · “Meaning, made visible.”<br>Sản phẩm số, hệ thống hữu ích và trải nghiệm thương hiệu được trình bày với phạm vi, giá, chính sách và trạng thái thanh toán rõ ràng.</small>',
  'footer-copy'
);
replaceOnce(
  '<div class="footerCol"><div class="footerTitle">Surface</div><div>Public recovery</div><div>Zero secret exposure</div><div>Immutable release target</div></div>',
  '<div class="footerCol"><div class="footerTitle">Explore</div><div><a href="/storefront/">Storefront</a></div><div><a href="/pay/">D’AUBE Pay</a></div><div><a href="/pricing/">Pricing</a></div><div><a href="/contact/">Contact</a></div><div><a href="/terms/">Terms</a> · <a href="/privacy/">Privacy</a> · <a href="/refund/">Refunds</a></div></div>',
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

fs.writeFileSync(outputPath, html);
console.log(JSON.stringify({
  schema: 'daube.canonical-dawn-pages-projection.v1',
  ok: true,
  source: 'recovery/index.html',
  output: 'index.html',
  bytes: Buffer.byteLength(html),
  externalHeroMedia: false,
  indexable: true,
  canonical: 'https://daubesonntag.com/',
}));
