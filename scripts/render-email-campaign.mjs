#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((arg, i, all) => arg.startsWith('--') ? [arg.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1]] : null).filter(Boolean));
if (!args.input || !args.out) {
  console.error('Usage: node scripts/render-email-campaign.mjs --input <campaign.json> --out <output.html> [--text <output.txt>]');
  process.exit(2);
}

const campaign = JSON.parse(fs.readFileSync(args.input, 'utf8'));
const required = ['id','mode','subject','preheader','headline','body','cta_label','cta_url','hero_url'];
for (const key of required) {
  if (!campaign[key] || (Array.isArray(campaign[key]) && campaign[key].length === 0)) throw new Error(`Missing required campaign field: ${key}`);
}
if (!['light','dark'].includes(campaign.mode)) throw new Error('mode must be light or dark');
if (!/^https:\/\//.test(campaign.hero_url)) throw new Error('hero_url must use HTTPS');
if (!/^https:\/\//.test(campaign.cta_url)) throw new Error('cta_url must use HTTPS');
if (!Array.isArray(campaign.body)) throw new Error('body must be an array of paragraphs');

const esc = (value='') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const mode = campaign.mode;
const theme = mode === 'dark'
  ? { outer:'#091321', panel:'#0f1a2a', border:'#283a50', title:'#f1e7d6', text:'#c1c8d1', gold:'#d8ad63', button:'#e7bf73', buttonBg:'transparent', footer:'#8996a5' }
  : { outer:'#eee9e0', panel:'#fbf8f2', border:'#ded6ca', title:'#15263b', text:'#5e6874', gold:'#b18f52', button:'#e7bf73', buttonBg:'#17263b', footer:'#8b9198' };

const bodyHtml = campaign.body.map(p => `<p style="margin:0 0 16px;">${esc(p)}</p>`).join('');
const quoteHtml = campaign.quote ? `<tr><td class="email-content" style="padding:0 38px 22px;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${mode === 'dark' ? '#132235' : '#17263b'};border-radius:18px;"><tr><td style="padding:24px 26px 10px;font-family:Georgia,'Times New Roman',serif;font-size:23px;line-height:1.4;font-style:italic;color:#f6f0e6;">${esc(campaign.quote)}</td></tr><tr><td style="padding:0 26px 24px;font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:2px;font-weight:700;color:#d3ad66;">D’AUBE SONNTAG</td></tr></table></td></tr>` : '';
const preheaderPad = '&#847;&zwnj;&nbsp;'.repeat(18);
const ctaBgAttr = mode === 'light' ? ` bgcolor="${theme.buttonBg}"` : '';
const ctaBorder = mode === 'dark' ? '#d5aa62' : theme.buttonBg;

const html = `<!doctype html>
<html lang="${esc(campaign.lang || 'vi')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="format-detection" content="telephone=no,date=no,address=no,email=no"><title>${esc(campaign.subject)}</title><style>
html,body{margin:0!important;padding:0!important;width:100%!important}
table,td{border-collapse:collapse!important;mso-table-lspace:0pt!important;mso-table-rspace:0pt!important}
img{-ms-interpolation-mode:bicubic}
a[x-apple-data-detectors],u+#body a,#MessageViewBody a{color:inherit!important;text-decoration:none!important;font:inherit!important}
@media screen and (max-width:480px){
  .email-shell{padding:0!important}
  .email-panel{border-radius:0!important;border-left:0!important;border-right:0!important}
  .email-content{padding-left:22px!important;padding-right:22px!important}
  .email-title{font-size:34px!important;line-height:1.08!important;letter-spacing:-.5px!important}
  .email-cta-table,.email-cta-cell{width:100%!important}
  .email-cta{display:block!important;text-align:center!important;padding:15px 18px!important}
}
</style></head>
<body id="body" style="margin:0;padding:0;width:100%;background:${theme.outer};-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none!important;max-height:0;max-width:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${esc(campaign.preheader)}${preheaderPad}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:${theme.outer};"><tr><td class="email-shell" align="center" style="padding:20px 10px;">
<table class="email-panel" role="presentation" width="640" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:${theme.panel};border:1px solid ${theme.border};border-radius:22px;overflow:hidden;">
<tr><td align="center" style="padding:22px 24px 18px;font-family:Arial,Helvetica,sans-serif;"><div style="font-size:13px;letter-spacing:3px;font-weight:700;color:${mode === 'dark' ? '#e0bb76' : '#18283b'};">D’AUBE SONNTAG</div><div style="padding-top:7px;font-size:11px;letter-spacing:1.5px;color:${theme.gold};">meaning, made visible.</div></td></tr>
<tr><td><img src="${esc(campaign.hero_url)}" width="640" alt="${esc(campaign.hero_alt || campaign.headline)}" style="display:block;width:100%;height:auto;border:0;outline:none;text-decoration:none;"></td></tr>
<tr><td class="email-content" style="padding:40px 38px 10px;"><h1 class="email-title" style="margin:0;font-family:Georgia,'Times New Roman',serif;font-size:42px;line-height:1.06;letter-spacing:-1px;font-weight:400;color:${theme.title};">${esc(campaign.headline)}</h1></td></tr>
<tr><td class="email-content" style="padding:0 38px 12px;font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;letter-spacing:2.2px;font-weight:700;color:${theme.gold};">${esc(campaign.kicker || 'D’AUBE CORRESPONDENCE')}</td></tr>
<tr><td class="email-content" style="padding:8px 38px 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;color:${theme.text};">${bodyHtml}</td></tr>
${quoteHtml}
<tr><td class="email-content" style="padding:0 38px 40px;"><table class="email-cta-table" role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td class="email-cta-cell"${ctaBgAttr} style="border:1px solid ${ctaBorder};border-radius:999px;background:${theme.buttonBg};mso-padding-alt:14px 20px;"><a class="email-cta" href="${esc(campaign.cta_url)}" style="display:inline-block;padding:14px 20px;border-radius:999px;background:${theme.buttonBg};color:${theme.button};text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1.5px;mso-padding-alt:0;">${esc(campaign.cta_label)} →</a></td></tr></table></td></tr>
<tr><td class="email-content" style="padding:22px 38px 30px;border-top:1px solid ${theme.border};font-family:Arial,Helvetica,sans-serif;font-size:11px;line-height:1.7;color:${theme.footer};">D’AUBE SONNTAG · meaning, made visible.</td></tr>
</table></td></tr></table>
</body></html>`;

fs.mkdirSync(path.dirname(args.out), { recursive: true });
fs.writeFileSync(args.out, html);
if (args.text) {
  const text = `${campaign.subject}\n\n${campaign.headline}\n\n${campaign.body.join('\n\n')}\n\n${campaign.cta_label}: ${campaign.cta_url}\n\nD’AUBE SONNTAG · meaning, made visible.`;
  fs.mkdirSync(path.dirname(args.text), { recursive: true });
  fs.writeFileSync(args.text, text);
}
console.log(JSON.stringify({ok:true,id:campaign.id,mode:campaign.mode,out:args.out,text:args.text || null}, null, 2));
