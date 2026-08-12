#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const budget = JSON.parse(fs.readFileSync(path.join(root, 'config/ux-quality-budget.json'), 'utf8'));
const reportArg = process.argv.indexOf('--report');
const reportPath = reportArg >= 0 && process.argv[reportArg + 1]
  ? path.join(root, process.argv[reportArg + 1])
  : path.join(root, 'artifacts/ux-quality-report.json');

const ignoredDirs = new Set(['.git', 'node_modules', 'vendor', 'build', 'dist', 'release']);
const findings = [];
const metrics = {
  html_files: 0,
  css_files: 0,
  image_files: 0,
  email_templates: 0,
  bytes_scanned: 0,
};

function add(severity, file, rule, message) {
  findings.push({ severity, file, rule, message });
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.nojekyll') continue;
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

function rel(file) {
  return path.relative(root, file).split(path.sep).join('/');
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1].trim() : null;
}

function auditHtml(file, text, bytes) {
  const r = rel(file);
  metrics.html_files += 1;
  const isOutgoingEmail = r.startsWith('email-preview/templates/') || r.startsWith('email/');
  if (isOutgoingEmail) metrics.email_templates += 1;

  const maxBytes = isOutgoingEmail ? budget.budgets.email_html_max_bytes : budget.budgets.html_max_bytes;
  if (bytes > maxBytes) add('error', r, 'html-budget', `${bytes} bytes exceeds ${maxBytes}`);

  if (!/^\s*<!doctype html>/i.test(text)) add('error', r, 'doctype', 'Missing HTML5 doctype');
  const htmlTag = text.match(/<html\b[^>]*>/i)?.[0] ?? '';
  if (!attr(htmlTag, 'lang')) add('error', r, 'document-language', 'Missing html[lang]');
  if (!/<meta\s+[^>]*name=["']viewport["'][^>]*>/i.test(text)) add('error', r, 'viewport', 'Missing viewport meta');
  const title = text.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
  if (!title) add('error', r, 'title', 'Missing document title');

  if (!isOutgoingEmail) {
    const h1Count = (text.match(/<h1\b/gi) || []).length;
    if (h1Count !== 1) add('error', r, 'single-h1', `Expected 1 h1, found ${h1Count}`);
  }

  for (const tag of text.match(/<img\b[^>]*>/gi) || []) {
    const alt = attr(tag, 'alt');
    if (alt === null) add('error', r, 'image-alt', `Image is missing alt attribute: ${tag.slice(0, 120)}`);
  }

  for (const tag of text.match(/<a\b[^>]*>/gi) || []) {
    const href = attr(tag, 'href') || '';
    const target = attr(tag, 'target');
    const relValue = attr(tag, 'rel') || '';
    if (/^(javascript:|file:|content:)/i.test(href)) add('error', r, 'unsafe-link-protocol', `Disallowed link protocol: ${href}`);
    if (target === '_blank' && !/\bnoopener\b/i.test(relValue)) add('error', r, 'blank-link-rel', 'target=_blank requires rel=noopener');
  }

  if (isOutgoingEmail) {
    if (/<script\b/i.test(text)) add('error', r, 'email-javascript', 'Outgoing email must not contain script');
    const localProtocol = /(src|href)=["'](?:\.\.?\/|content:|file:|localhost:)/i;
    if (localProtocol.test(text)) add('error', r, 'email-public-assets', 'Outgoing email must use public HTTPS assets/links');
    const ctaCount = (text.match(/href=["']https:\/\/daubesonntag\.com\/?["']/gi) || []).length;
    if (ctaCount > budget.budgets.max_primary_cta_per_email) {
      add('error', r, 'email-primary-cta', `Expected <= ${budget.budgets.max_primary_cta_per_email} canonical CTA, found ${ctaCount}`);
    }
  }
}

function auditCss(file, text, bytes) {
  const r = rel(file);
  metrics.css_files += 1;
  if (bytes > budget.budgets.css_max_bytes) add('error', r, 'css-budget', `${bytes} bytes exceeds ${budget.budgets.css_max_bytes}`);
  const hasMotion = /\b(animation|transition)\s*:/i.test(text) || /@keyframes\b/i.test(text);
  if (hasMotion && !/prefers-reduced-motion/i.test(text)) add('error', r, 'reduced-motion', 'Motion exists without prefers-reduced-motion fallback');
  if (/outline\s*:\s*none/i.test(text) && !/:focus-visible/i.test(text)) add('warning', r, 'focus-visible', 'outline:none found without a focus-visible replacement');
}

function auditImage(file, bytes) {
  const r = rel(file);
  metrics.image_files += 1;
  if (bytes > budget.budgets.image_max_bytes) add('warning', r, 'image-budget', `${bytes} bytes exceeds ${budget.budgets.image_max_bytes}`);
}

for (const file of walk(root)) {
  const ext = path.extname(file).toLowerCase();
  const bytes = fs.statSync(file).size;
  metrics.bytes_scanned += bytes;
  if (ext === '.html') auditHtml(file, fs.readFileSync(file, 'utf8'), bytes);
  else if (ext === '.css') auditCss(file, fs.readFileSync(file, 'utf8'), bytes);
  else if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) auditImage(file, bytes);
}

const errors = findings.filter((f) => f.severity === 'error');
const warnings = findings.filter((f) => f.severity === 'warning');
const report = {
  schema_version: 1,
  contract_id: budget.contract_id,
  ok: errors.length === 0,
  status: errors.length === 0 ? 'UX_QUALITY_GATE_PASS' : 'UX_QUALITY_GATE_FAIL',
  metrics,
  summary: { errors: errors.length, warnings: warnings.length, findings: findings.length },
  findings,
};

fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

if (process.env.GITHUB_STEP_SUMMARY) {
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `## D’AUBE UX Quality Gate\n\n- Status: **${report.status}**\n- HTML: ${metrics.html_files}\n- CSS: ${metrics.css_files}\n- Images: ${metrics.image_files}\n- Email templates: ${metrics.email_templates}\n- Errors: ${errors.length}\n- Warnings: ${warnings.length}\n`);
}

process.exit(errors.length === 0 ? 0 : 1);
