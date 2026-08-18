import crypto from 'node:crypto';
import fs from 'node:fs';

const paths = ['index.html', 'assets/flagship-v2.css', 'assets/flagship-v2.js'];
const html = fs.readFileSync(paths[0], 'utf8');
const css = fs.readFileSync(paths[1], 'utf8');
const js = fs.readFileSync(paths[2], 'utf8');
const visualPack = JSON.parse(fs.readFileSync('governance/flagship-visual-pack-v2.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('governance/public-release-20260819-flagship-v2.candidate.json', 'utf8'));
const errors = [];

const failIf = (condition, message) => { if (condition) errors.push(message); };
const requireText = (needle, source, message) => failIf(!source.includes(needle), message);

for (const legacy of ['public-mark__halo', 'public-mark__spark', 'public-mark__scene']) {
  failIf(html.includes(legacy), `legacy faux hero markup remains: ${legacy}`);
}
for (const forbidden of ['radial-gradient(', 'conic-gradient(']) {
  failIf(css.includes(forbidden), `forbidden faux-art primitive remains: ${forbidden}`);
}

requireText('name="robots" content="index,follow', html, 'homepage must be indexable in this candidate');
for (const route of ['launch-presence/', 'launch-kit-01/', 'services/', 'contact/']) {
  requireText(route, html, `required public route missing: ${route}`);
}
requireText('prefers-reduced-motion: reduce', css, 'reduced-motion CSS missing');
requireText('navigator.connection', js, 'Save-Data handling missing');
requireText('IntersectionObserver', js, 'ambient media viewport gating missing');
requireText("event.key === 'Escape'", js, 'keyboard Escape menu behavior missing');

const registered = new Set(visualPack.assets.map(asset => asset.id));
const consumed = [...html.matchAll(/data-asset-id="([^"]+)"/g)].map(match => match[1]);
for (const id of consumed) failIf(!registered.has(id), `unregistered public visual asset: ${id}`);

const registeredMedia = new Set(visualPack.assets.map(asset => asset.mediaUrl));
const externalMedia = [...html.matchAll(/<(?:img|video)\b[^>]*\bsrc="(https:\/\/[^\"]+)"/g)].map(match => match[1]);
for (const url of externalMedia) failIf(!registeredMedia.has(url), `external homepage media missing provenance: ${url}`);

for (const asset of visualPack.assets) {
  failIf(!asset.mediaUrl?.startsWith('https://'), `non-HTTPS media URL: ${asset.id}`);
  failIf(!asset.sourcePage?.startsWith('https://'), `missing HTTPS source page: ${asset.id}`);
  failIf(!asset.license, `missing license: ${asset.id}`);
  failIf(!asset.rightsPosture, `missing rights posture: ${asset.id}`);
}

const publicPayload = [html, css, js].join('\n');
for (const secretPattern of [/github_pat_[A-Za-z0-9_]+/, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, /\bsk-[A-Za-z0-9_-]{20,}\b/]) {
  failIf(secretPattern.test(publicPayload), `obvious secret pattern detected: ${secretPattern}`);
}

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const fileDigests = Object.fromEntries(paths.map(path => [path, sha256(fs.readFileSync(path))]));
for (const path of paths) {
  failIf(fileDigests[path] !== manifest.artifact.fileDigests[path], `digest mismatch: ${path}`);
}
const digestRecord = Object.keys(fileDigests).sort().map(path => `${path}\0${fileDigests[path]}\n`).join('');
failIf(sha256(Buffer.from(digestRecord)) !== manifest.artifact.digest, 'aggregate artifact digest mismatch');

failIf(manifest.source.commit !== 'dc4eab95711cb379880742fe9f948b28303b99f6', 'canonical source commit mismatch');
failIf(manifest.rollback.rollbackReference !== 'daube-site@ae64c522827d2b8ea90b0139be033b69c2106485', 'rollback reference mismatch');
failIf(manifest.approval.releasePassport !== 'PENDING_FOUNDER_APPROVAL', 'candidate must remain unapproved until Founder gate');

if (errors.length) {
  errors.forEach(error => console.error(`ERROR: ${error}`));
  process.exit(1);
}

console.log(`Flagship V2 candidate valid: ${manifest.releaseId}`);
console.log(`Artifact SHA-256: ${manifest.artifact.digest}`);
console.log(`Founder approval: pending`);
