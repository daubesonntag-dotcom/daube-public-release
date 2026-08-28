import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const robots = fs.readFileSync(new URL("../robots.txt", import.meta.url), "utf8");
const pay = fs.readFileSync(new URL("../pay/index.html", import.meta.url), "utf8");
const pagesWorkflow = fs.readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
const recoveryWorkflow = fs.readFileSync(new URL("../.github/workflows/payment-domain-recovery-pages.yml", import.meta.url), "utf8");
const authority = JSON.parse(fs.readFileSync(new URL("../release-authority.v1.json", import.meta.url), "utf8"));
const recovery = JSON.parse(fs.readFileSync(new URL("../release/payment-domain-recovery-v1.json", import.meta.url), "utf8"));
const historicalLock = JSON.parse(fs.readFileSync(new URL("../.daube/visual-locks/homepage-approved-mockup-v2.json", import.meta.url), "utf8"));
const historicalRelease = JSON.parse(fs.readFileSync(new URL("../.daube/releases/approved-mockup-homepage-v2.json", import.meta.url), "utf8"));

const historicalVisualLockSha = "079c497356b44ce29cf3b43a81a8902b1847266c4c24c8bc550b80825ea1c2f8";

test("bounded payment recovery makes the actual legacy Pages apex review-ready", () => {
  assert.equal(recovery.schema, "daube.payment-domain-recovery.v1");
  assert.equal(recovery.status, "ACTIVE_RECOVERY");
  assert.equal(recovery.recoveryAuthority.publisher, "github-pages");
  assert.equal(recovery.recoveryAuthority.temporary, true);
  assert.match(index, /<html lang="en">/);
  assert.match(index, /name="robots" content="index,follow/);
  assert.match(index, /rel="canonical" href="https:\/\/daubesonntag\.com\/"/);
  assert.match(index, /\/pay\//);
  assert.match(robots, /^User-agent: \*\s+Allow: \/$/m);
  assert.match(pay, /Workflow Kit — Single/);
  assert.match(pay, /US\$15/);
  assert.match(pay, /US\$39/);
  assert.match(pay, /US\$95/);
  assert.match(pay, /\.\.\/terms\//);
  assert.match(pay, /\.\.\/privacy\//);
  assert.match(pay, /\.\.\/refund\//);
  assert.match(pay, /\.\.\/contact\//);
});

test("canonical long-term homepage authority remains daube-web on Cloudflare", () => {
  assert.equal(authority.schema, "daube.public-release.authority.v1");
  assert.equal(authority.role, "PUBLIC_RELEASE_PROJECTION");
  assert.equal(authority.canonicalHomepageAuthority.repository, "daubesonntag-dotcom/daube-web");
  assert.equal(authority.canonicalHomepageAuthority.productionRuntime, "CLOUDFLARE");
  assert.equal(authority.canonicalHomepageAuthority.canonicalApex, "https://daubesonntag.com/");
  assert.equal(authority.mayAuthorCanonicalHomepage, false);
  assert.equal(authority.mayClaimCanonicalApexDeployment, false);
  assert.match(recovery.exitCondition, /Cloudflare\/daube-web/);
});

test("normal Pages mirror stays quarantined while a separate recovery publisher is explicitly bounded", () => {
  assert.match(pagesWorkflow, /workflow_dispatch:/);
  assert.equal(/\n\s*push:\s*\n/.test(pagesWorkflow), false, "normal mirror automatic push publication must stay disabled");
  assert.match(pagesWorkflow, /Homepage authority collision/);
  assert.match(pagesWorkflow, /ci\/github-pages: mirror/);
  assert.match(recoveryWorkflow, /payment-domain-recovery-pages/);
  assert.match(recoveryWorkflow, /branches: \[main\]/);
  assert.match(recoveryWorkflow, /pay\/index\.html/);
  assert.match(recoveryWorkflow, /https:\/\/daubesonntag\.com\/pay\//);
  assert.match(recoveryWorkflow, /D’AUBE payment surface verified/);
});

test("historical visual lock is preserved as provenance and recovery uses a later approved V3 artifact", () => {
  assert.equal(historicalLock.id, "DAUBE-APPROVED-HOMEPAGE-MOCKUP-V2");
  assert.equal(historicalLock.reference.sha256, historicalVisualLockSha);
  assert.equal(historicalRelease.visualLock.sha256, historicalVisualLockSha);
  assert.equal(index.includes(historicalVisualLockSha), false);
  assert.match(index, /assets\/mobile-first-flagship-v3\.css/);
  assert.match(index, /assets\/mobile-first-flagship-v3\.js/);
});

test("public recovery channel carries no private controls, secrets or unsupported economic claims", () => {
  for (const forbidden of ["/creative-market", "/forge", "/founder-os", "/staff-studio", "/engineering-studio", "/revenue-factory"]) {
    assert.equal(index.includes(forbidden), false, `private/draft route leaked: ${forbidden}`);
  }
  for (const unsupported of ["COMMERCE LIVE", "award-winning", "customers", "revenue verified", "production complete"]) {
    assert.equal(index.toLowerCase().includes(unsupported.toLowerCase()), false, `unsupported public claim: ${unsupported}`);
  }
  assert.equal(recovery.paymentTruth.pagesOwnsOrderTruth, false);
  assert.equal(recovery.paymentTruth.pagesOwnsSettlementTruth, false);
  assert.equal(recovery.paymentTruth.checkoutRedirectCountsAsRevenue, false);
  assert.equal(authority.truthBoundary.releaseProjectionDoesNotOwnCommerceTruth, true);
  assert.equal(authority.truthBoundary.externalReadbackRequiredForLiveClaims, true);
});
