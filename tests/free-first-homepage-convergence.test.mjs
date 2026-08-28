import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const authority = JSON.parse(fs.readFileSync('release-authority.v1.json', 'utf8'));
const recovery = JSON.parse(fs.readFileSync('release/payment-domain-recovery-v1.json', 'utf8'));
const lock = JSON.parse(fs.readFileSync('.daube/visual-locks/homepage-approved-mockup-v2.json', 'utf8'));
const index = fs.readFileSync('index.html', 'utf8');
const robots = fs.readFileSync('robots.txt', 'utf8');
const pagesWorkflow = fs.readFileSync('.github/workflows/pages.yml', 'utf8');
const recoveryWorkflow = fs.readFileSync('.github/workflows/payment-domain-recovery-pages.yml', 'utf8');
const storefront = fs.readFileSync('storefront/index.html', 'utf8');
const storefrontJs = fs.readFileSync('assets/storefront-v2.js', 'utf8');

test('Free-First governance remains durable provenance during bounded payment recovery', () => {
  assert.equal(authority.pagesPolicy.automaticPushDeployment, false);
  assert.equal(authority.pagesPolicy.mirrorOnly, true);
  assert.equal(authority.pagesPolicy.canonicalApexCustomDomainForbidden, true);
  assert.equal(recovery.status, 'ACTIVE_RECOVERY');
  assert.ok(recovery.requiredExternalReadback.includes('https://daubesonntag.com/'));
  assert.ok(recovery.requiredExternalReadback.includes('https://daubesonntag.com/pay/'));
});

test('historical local scene assets are preserved without driving the payment recovery root', () => {
  assert.equal(lock.rules.localSceneVisualRequired, true);
  assert.equal(lock.rules.stockPortfolioSubstitutionAllowed, false);
  assert.equal(lock.rules.genericSaasAllowed, false);
  assert.equal(lock.rules.fakeCssPrimaryArtworkAllowed, false);
});

test('recovery root stays local-asset-first and does not substitute remote stock or fake CSS artwork', () => {
  assert.doesNotMatch(index, /unsplash|pexels|pixabay|shutterstock/i);
  assert.match(index, /D’AUBE/);
  assert.match(index, /Meaning, made visible\./);
});

test('active recovery root is accessible, indexable and canonical for provider website review', () => {
  assert.match(index, /<html lang="en">/);
  assert.match(index, /name="viewport"/);
  assert.match(index, /name="robots" content="index,follow/);
  assert.match(index, /rel="canonical" href="https:\/\/daubesonntag\.com\/"/);
  assert.match(index, /\/pay\//);
  assert.equal((index.match(/<h1\b/gi) || []).length, 1);
  assert.match(robots, /^User-agent: \*\s+Allow: \/$/m);
});

test('normal Pages remains manual mirror while recovery is narrow, truthful and externally verifiable', () => {
  assert.equal(authority.pagesPolicy.automaticPushDeployment, false);
  assert.equal(authority.pagesPolicy.mirrorOnly, true);
  assert.equal(authority.pagesPolicy.canonicalApexCustomDomainForbidden, true);
  assert.match(pagesWorkflow, /workflow_dispatch:/);
  assert.equal(/\n\s*push:\s*\n/.test(pagesWorkflow), false);
  assert.match(pagesWorkflow, /Homepage authority collision/);
  assert.match(pagesWorkflow, /ci\/github-pages: mirror/);
  assert.match(recoveryWorkflow, /Payment Domain Recovery Pages/);
  assert.match(recoveryWorkflow, /https:\/\/daubesonntag\.com\/pay\//);
  assert.match(recoveryWorkflow, /Verify canonical apex, storefront bridge and Paddle review routes/);

  assert.match(storefront, /No silent FX/);
  assert.match(storefront, /VND CATALOG/);
  assert.match(storefront, /Native USD workflow kits/);
  assert.match(storefront, /Continue to local bank payment/);
  assert.match(storefront, /Beneficiary identity is verified inside your banking app and is not published by this page/);
  assert.match(storefront, /clear scope/i);

  assert.match(storefrontJs, /direct_vietqr_bank_transfer/);
  assert.match(storefrontJs, /qrSvgDataUrl/);
  assert.match(storefrontJs, /Beneficiary verification/);
  assert.doesNotMatch(storefrontJs, /USD_REFERENCE_VND/);
  assert.doesNotMatch(storefrontJs, /moneyUsdEquivalent/);
  assert.doesNotMatch(storefrontJs, /receipt\.payment\.beneficiaryName/);

  assert.equal(recovery.paymentTruth.pagesOwnsOrderTruth, false);
  assert.equal(recovery.paymentTruth.pagesOwnsSettlementTruth, false);
});

test('historical visual lock still rejects stock-portfolio and generic SaaS fallback', () => {
  assert.equal(lock.rules.stockPortfolioSubstitutionAllowed, false);
  assert.equal(lock.rules.genericSaasAllowed, false);
  assert.equal(lock.rules.fakeCssPrimaryArtworkAllowed, false);
  assert.equal(lock.rules.localSceneVisualRequired, true);
});