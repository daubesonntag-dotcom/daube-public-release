import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const robots = fs.readFileSync(new URL("../robots.txt", import.meta.url), "utf8");
const pagesWorkflow = fs.readFileSync(new URL("../.github/workflows/pages.yml", import.meta.url), "utf8");
const authority = JSON.parse(fs.readFileSync(new URL("../release-authority.v1.json", import.meta.url), "utf8"));
const historicalLock = JSON.parse(fs.readFileSync(new URL("../.daube/visual-locks/homepage-approved-mockup-v2.json", import.meta.url), "utf8"));
const historicalRelease = JSON.parse(fs.readFileSync(new URL("../.daube/releases/approved-mockup-homepage-v2.json", import.meta.url), "utf8"));

const historicalVisualLockSha = "079c497356b44ce29cf3b43a81a8902b1847266c4c24c8bc550b80825ea1c2f8";

test("public-release root is a noindex release channel, not a second homepage", () => {
  assert.match(index, /<html lang="en">/);
  assert.match(index, /name="viewport"/);
  assert.match(index, /name="robots" content="noindex,nofollow,noarchive,nosnippet"/);
  assert.match(index, /rel="canonical" href="https:\/\/daubesonntag\.com\/"/);
  assert.match(index, /Public release channel/);
  assert.match(index, /not the canonical homepage authority/i);
  assert.equal((index.match(/<h1\b/gi) || []).length, 1);
  assert.match(robots, /^User-agent: \*\s+Disallow: \/$/m);
});

test("canonical homepage authority is explicitly daube-web on Cloudflare", () => {
  assert.equal(authority.schema, "daube.public-release.authority.v1");
  assert.equal(authority.role, "PUBLIC_RELEASE_PROJECTION");
  assert.equal(authority.canonicalHomepageAuthority.repository, "daubesonntag-dotcom/daube-web");
  assert.equal(authority.canonicalHomepageAuthority.productionRuntime, "CLOUDFLARE");
  assert.equal(authority.canonicalHomepageAuthority.canonicalApex, "https://daubesonntag.com/");
  assert.equal(authority.mayAuthorCanonicalHomepage, false);
  assert.equal(authority.mayClaimCanonicalApexDeployment, false);
  assert.equal(authority.pagesPolicy.automaticPushDeployment, false);
  assert.equal(authority.pagesPolicy.mirrorOnly, true);
  assert.equal(authority.pagesPolicy.canonicalApexCustomDomainForbidden, true);
});

test("GitHub Pages cannot automatically race the canonical apex", () => {
  assert.match(pagesWorkflow, /workflow_dispatch:/);
  assert.equal(/\n\s*push:\s*\n/.test(pagesWorkflow), false, "automatic push publication must stay disabled");
  assert.match(pagesWorkflow, /Homepage authority collision/);
  assert.match(pagesWorkflow, /daubesonntag\.com\|www\.daubesonntag\.com/);
  assert.match(pagesWorkflow, /ci\/github-pages: mirror/);
  assert.equal(pagesWorkflow.includes("ci/github-pages: https"), false);
  assert.equal(pagesWorkflow.includes("Verify canonical HTTPS apex matches current homepage artifact"), false);
});

test("historical visual lock is preserved as provenance but no longer drives this root", () => {
  assert.equal(historicalLock.id, "DAUBE-APPROVED-HOMEPAGE-MOCKUP-V2");
  assert.equal(historicalLock.reference.sha256, historicalVisualLockSha);
  assert.equal(historicalRelease.visualLock.sha256, historicalVisualLockSha);
  assert.equal(index.includes(historicalVisualLockSha), false);
  assert.equal(index.includes("assets/maison-homepage-v2.css"), false);
  assert.equal(index.includes("assets/maison-homepage-v2.js"), false);
});

test("public channel carries no private controls or unsupported outcome claims", () => {
  for (const forbidden of ["/creative-market", "/forge", "/founder-os", "/staff-studio", "/engineering-studio", "/revenue-factory"]) {
    assert.equal(index.includes(forbidden), false, `private/draft route leaked: ${forbidden}`);
  }
  for (const unsupported of ["COMMERCE LIVE", "award-winning", "customers", "revenue verified", "production complete"]) {
    assert.equal(index.toLowerCase().includes(unsupported.toLowerCase()), false, `unsupported public claim: ${unsupported}`);
  }
  assert.equal(authority.truthBoundary.repositoryArtifactIsNotProductionDeployment, true);
  assert.equal(authority.truthBoundary.pagesMirrorIsNotCanonicalApex, true);
  assert.equal(authority.truthBoundary.releaseProjectionDoesNotOwnCommerceTruth, true);
  assert.equal(authority.truthBoundary.externalReadbackRequiredForLiveClaims, true);
});
