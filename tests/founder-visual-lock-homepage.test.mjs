import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../assets/founder-homepage-v1.css", import.meta.url), "utf8");
const robots = fs.readFileSync(new URL("../robots.txt", import.meta.url), "utf8");
const sitemap = fs.readFileSync(new URL("../sitemap.xml", import.meta.url), "utf8");
const release = JSON.parse(fs.readFileSync(new URL("../.daube/releases/founder-visual-lock-homepage-v1.json", import.meta.url), "utf8"));
const heroPath = new URL("../assets/founder-visual-lock/01-hero-dawn.webp", import.meta.url);

const canonicalForgeRevision = "a92c4f30ed06205585dabc9fa1f35cb294b049fe";

test("public homepage is bound to the verified Forge revision", () => {
  assert.equal(release.source.repository, "daubesonntag-dotcom/daube-forge-os");
  assert.equal(release.source.commit, canonicalForgeRevision);
  assert.ok(index.includes(canonicalForgeRevision));
  assert.equal(release.source.pullRequest, 3356);
  assert.equal(release.rollback.publicRepositoryRef, "main@45ca43d63157b39b47198ddeaf0d174efd48c866");
  assert.equal(release.approval.kind, "founder-explicit-full-execution");
});

test("Founder Visual Lock canonical sequence and copy are present", () => {
  for (const copy of [
    "Meaning, made visible.",
    "Ideas are invisible until they take form.",
    "The D’AUBE Universe",
    "One atelier.",
    "re:FILUM",
    "Selected Work",
    "Objects for making.",
    "Creative intelligence,",
    "Journal",
    "What begins as an idea"
  ]) assert.ok(index.includes(copy), `missing canonical copy: ${copy}`);

  for (const marker of [
    "01 / THE DAWN",
    "02 / MANIFESTO",
    "03 / WORLDS IN ORBIT",
    "04 / FOUR WORLDS",
    "05 / FEATURED PROJECT",
    "06 / SELECTED WORK",
    "07 / DIGITAL OBJECTS",
    "08 / SYSTEMS",
    "09 / JOURNAL",
    "D’AUBE SONNTAG — RẠNG TRONG"
  ]) assert.ok(index.includes(marker), `missing scene marker: ${marker}`);
});

test("public document keeps accessible semantic and SEO contracts", () => {
  assert.equal((index.match(/<h1\b/gi) || []).length, 1);
  assert.match(index, /<html lang="en">/);
  assert.match(index, /name="viewport"/);
  assert.match(index, /name="robots" content="index,follow,max-image-preview:large"/);
  assert.match(index, /rel="canonical" href="https:\/\/daubesonntag\.com\/"/);
  assert.match(index, /href="#main-content"/);
  assert.match(index, /id="main-content"/);
  assert.match(index, /aria-label="Primary navigation"/);
  assert.match(css, /@media\(prefers-reduced-motion:reduce\)/);
  assert.doesNotMatch(index, /noindex|nofollow/i);
});

test("Founder hero is local, compact, and identified as the approved artwork", () => {
  assert.ok(fs.existsSync(heroPath));
  const stats = fs.statSync(heroPath);
  assert.ok(stats.size > 10000);
  assert.ok(stats.size <= 500000);
  assert.match(index, /assets\/founder-visual-lock\/01-hero-dawn\.webp/);
  assert.equal(release.visualAsset.derivativeSha256, "f92ee5347656f63b5fec70cfb6c36b1991fcbd3e7deec67854d36e9cc77eaee6");
  assert.equal(release.visualAsset.bytes, stats.size);
  assert.equal(release.visualAsset.sourceKind, "founder-approved-generated-artwork");
});

test("public navigation avoids draft-only or private Forge surfaces and fake authority", () => {
  for (const forbidden of [
    "/creative-market",
    "/refilum/universe",
    "/forge",
    "/founder-os",
    "/staff-studio",
    "/engineering-studio",
    "/revenue-factory"
  ]) assert.equal(index.includes(forbidden), false, `forbidden route leaked: ${forbidden}`);

  for (const unsupported of ["COMMERCE LIVE", "award-winning", "customers", "revenue"])
    assert.equal(index.toLowerCase().includes(unsupported.toLowerCase()), false, `unsupported public claim: ${unsupported}`);
});

test("SEO crawl policy and sitemap agree with the canonical public surface", () => {
  assert.match(robots, /User-agent: \*/);
  assert.match(robots, /Allow: \//);
  assert.doesNotMatch(robots, /Disallow:\s*\//);
  assert.match(robots, /Sitemap: https:\/\/daubesonntag\.com\/sitemap\.xml/);
  assert.match(sitemap, /<loc>https:\/\/daubesonntag\.com\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/daubesonntag\.com\/services\/<\/loc>/);
  assert.match(sitemap, /<loc>https:\/\/daubesonntag\.com\/contact\/<\/loc>/);
});

test("handoff records provenance and static-publication truth boundary", () => {
  assert.equal(release.publicTarget.channel, "existing GitHub Pages production path");
  assert.ok(release.externalIngredients.some((item) => item.provider === "Poly Haven" && item.license === "CC0"));
  assert.ok(release.externalIngredients.some((item) => item.provider === "Pexels" && item.license === "Pexels License"));
  assert.match(release.truthBoundary, /Static publication does not prove a dynamic Next\.js\/API runtime/);
  assert.ok(release.claims.notProvenByStaticPublish.includes("live checkout, customers, revenue, awards, partnerships or press"));
});
