import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => fs.existsSync(new URL(`../${path}`, import.meta.url));

const index = read("index.html");
const storefront = read("storefront/index.html");
const robots = read("robots.txt");
const agents = read("AGENTS.md");
const pagesWorkflow = read(".github/workflows/pages.yml");
const recoveryWorkflow = read(".github/workflows/payment-domain-recovery-pages.yml");
const authority = JSON.parse(read("release-authority.v1.json"));
const recovery = JSON.parse(read("release/payment-domain-recovery-v1.json"));
const lock = JSON.parse(read(".daube/visual-locks/homepage-approved-mockup-v2.json"));
const policyRevision = "dc85d60e9222e70a270048321b5252e072a72d9d";
const historicalSceneAssets = ["rang-trong-atelier.svg","obsidian-cinema.svg","celestial-threshold.svg","porcelain-index.svg","jade-intelligence.svg","lacquer-vermilion.svg","monsoon-glass.svg","silk-paper.svg","neo-civic-monument.svg","future-maison.svg"];

test("Free-First governance remains durable provenance during bounded payment recovery", () => {
  assert.match(agents, /free-first-operating-policy-v1\.json/);
  assert.match(agents, /REAL ASSET BEFORE FAKE CSS ART/);
  assert.match(agents, /APPROVED HOMEPAGE MOCKUP V2/);
  assert.equal(lock.freeFirstPolicyRevision, policyRevision);
  assert.equal(authority.canonicalHomepageAuthority.repository, "daubesonntag-dotcom/daube-web");
  assert.equal(authority.mayAuthorCanonicalHomepage, false);
  assert.equal(recovery.status, "ACTIVE_RECOVERY");
  assert.equal(recovery.recoveryAuthority.temporary, true);
});

test("historical local scene assets are preserved without driving the payment recovery root", () => {
  for (const name of historicalSceneAssets) {
    const path = `assets/homepage-v2/scenes/${name}`;
    assert.ok(exists(path), `historical local scene visual lost: ${name}`);
    assert.equal(index.includes(path), false, `recovery root must not regress to historical scene ${name}`);
  }
  assert.equal(index.includes(policyRevision), false, "recovery root must not masquerade as the historical homepage candidate");
});

test("recovery root stays local-asset-first and does not substitute remote stock or fake CSS artwork", () => {
  for (const remote of ["polyhaven.com", "pexels.com", "unsplash.com", "pixabay.com", "cdn.jsdelivr.net", "unpkg.com"]) {
    assert.equal(index.includes(remote), false, `remote content leaked into recovery root: ${remote}`);
  }
  assert.equal(index.includes("assets/maison-homepage-v2.css"), false);
  assert.equal(index.includes("assets/maison-homepage-v2.js"), false);
  assert.equal(index.includes("fv-orbit"), false);
  assert.equal(index.includes("fv-crystal"), false);
  assert.equal(index.includes("fv-spectrum"), false);
  assert.equal(index.includes("fv-system-map"), false);
  assert.match(index, /assets\/mobile-first-flagship-v3\.css/);
});

test("active recovery root is accessible, indexable and canonical for provider website review", () => {
  assert.match(index, /<html lang="en">/);
  assert.match(index, /name="viewport"/);
  assert.match(index, /name="robots" content="index,follow/);
  assert.match(index, /rel="canonical" href="https:\/\/daubesonntag\.com\/"/);
  assert.match(index, /\/pay\//);
  assert.equal((index.match(/<h1\b/gi) || []).length, 1);
  assert.match(robots, /^User-agent: \*\s+Allow: \/$/m);
});

test("normal Pages remains manual mirror while the recovery publisher is narrow and externally verified", () => {
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
  assert.match(storefront, /D’AUBE DIRECT PAY · VIETQR \/ NAPAS/);
  assert.match(storefront, /Create order &amp; get VietQR/);
  assert.match(storefront, /clear scope/i);
  assert.match(storefront, /bank verification/i);
  assert.equal(recovery.paymentTruth.pagesOwnsOrderTruth, false);
  assert.equal(recovery.paymentTruth.pagesOwnsSettlementTruth, false);
});

test("historical visual lock still rejects stock-portfolio and generic SaaS fallback", () => {
  assert.equal(lock.rules.stockPortfolioSubstitutionAllowed, false);
  assert.equal(lock.rules.genericSaasAllowed, false);
  assert.equal(lock.rules.fakeCssPrimaryArtworkAllowed, false);
  assert.equal(lock.rules.localSceneVisualRequired, true);
});
