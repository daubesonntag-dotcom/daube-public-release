#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const manifestPath = process.argv[2];
if (!manifestPath) {
  console.error('release handoff manifest path is required');
  process.exit(2);
}

const root = process.cwd();
const absoluteManifest = path.resolve(root, manifestPath);
if (!absoluteManifest.startsWith(`${path.resolve(root)}${path.sep}`)) {
  console.error('release handoff manifest must be inside the repository');
  process.exit(2);
}
if (!fs.existsSync(absoluteManifest) || !fs.statSync(absoluteManifest).isFile()) {
  console.error(`release handoff manifest not found: ${manifestPath}`);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(absoluteManifest, 'utf8'));
const errors = [];
const FULL_SHA = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

if (manifest.schema !== 'daube.public-release.handoff.v1') errors.push('schema must equal daube.public-release.handoff.v1');
if (!FULL_SHA.test(String(manifest.sourceCommit || ''))) errors.push('sourceCommit must be a full Git SHA');
if (manifest.artifactPath !== 'index.html') errors.push('artifactPath must equal index.html');
if (!SHA256.test(String(manifest.artifactDigest || ''))) errors.push('artifactDigest must be a SHA-256 hex digest');
for (const field of ['testSummary', 'releasePassport', 'rollbackReference', 'accountableOwner']) {
  if (typeof manifest[field] !== 'string' || !manifest[field].trim()) errors.push(`${field} must be a non-empty string`);
}
if (!Array.isArray(manifest.limitations) || manifest.limitations.length === 0 || manifest.limitations.some((item) => typeof item !== 'string' || !item.trim())) {
  errors.push('limitations must be a non-empty array of non-empty strings');
}
if (manifest.productionAuthority !== false) errors.push('productionAuthority must remain false for the mirror');
if (manifest.canonicalHomepageAuthority !== 'daubesonntag-dotcom/daube-web') errors.push('canonicalHomepageAuthority must remain daubesonntag-dotcom/daube-web');

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (String(manifest.sourceCommit || '').toLowerCase() !== head.toLowerCase()) errors.push('sourceCommit does not match checked-out HEAD');

const artifact = path.resolve(root, manifest.artifactPath || '');
if (!artifact.startsWith(`${path.resolve(root)}${path.sep}`) || !fs.existsSync(artifact) || !fs.statSync(artifact).isFile()) {
  errors.push('artifactPath does not resolve to a repository file');
} else {
  const digest = crypto.createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
  if (String(manifest.artifactDigest || '').toLowerCase() !== digest) errors.push(`artifactDigest mismatch: expected ${digest}`);
}

if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  schema: manifest.schema,
  sourceCommit: manifest.sourceCommit,
  artifactPath: manifest.artifactPath,
  artifactDigest: manifest.artifactDigest,
  testSummary: manifest.testSummary,
  releasePassport: manifest.releasePassport,
  rollbackReference: manifest.rollbackReference,
  accountableOwner: manifest.accountableOwner,
  limitations: manifest.limitations,
  canonicalHomepageAuthority: manifest.canonicalHomepageAuthority,
  productionAuthority: manifest.productionAuthority,
}, null, 2));
