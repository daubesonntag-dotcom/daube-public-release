import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => fs.existsSync(new URL(`../${path}`, import.meta.url));

const index = read("index.html");
const css = read("assets/maison-homepage-v2.css");
const js = read("assets/maison-homepage-v2.js");
const agents = read("AGENTS.md");
const lock = JSON.parse(read(".daube/visual-locks/homepage-approved-mockup-v2.json"));
const policyRevision = "dc85d60e9222e70a270048321b5252e072a72d9d";

test("approved homepage inherits canonical Free-First governance", () => {
  assert.ok(index.includes(policyRevision));
  assert.match(agents, /free-first-operating-policy-v1\.json/);
  assert.match(agents, /REAL ASSET BEFORE FAKE CSS ART/);
  assert.match(agents, /APPROVED HOMEPAGE MOCKUP V2/);
  assert.equal(lock.freeFirstPolicyRevision, policyRevision);
});

test("homepage uses ten local visual assets rather than remote stock substitutions", () => {
  const assets = ["rang-trong-atelier.svg","obsidian-cinema.svg","celestial-threshold.svg","porcelain-index.svg","jade-intelligence.svg","lacquer-vermilion.svg","monsoon-glass.svg","silk-paper.svg","neo-civic-monument.svg","future-maison.svg"];
  for (const name of assets) {
    const path = `assets/homepage-v2/scenes/${name}`;
    assert.ok(exists(path), `missing local scene visual ${name}`);
    assert.ok(index.includes(path), `homepage does not use local scene visual ${name}`);
  }
  for (const remote of ["polyhaven.com", "pexels.com", "unsplash.com", "pixabay.com"]) {
    assert.equal(index.includes(remote), false, `remote stock provider leaked into approved homepage: ${remote}`);
  }
});

test("CSS is composition and typography, not primary chapter artwork", () => {
  assert.match(index, /<img src="assets\/homepage-v2\/scenes\/rang-trong-atelier\.svg"/);
  assert.equal(index.includes("fv-orbit"), false);
  assert.equal(index.includes("fv-crystal"), false);
  assert.equal(index.includes("fv-spectrum"), false);
  assert.equal(index.includes("fv-system-map"), false);
  assert.equal(/background-image:\s*url\(/.test(css), false);
});

test("motion remains browser-native, progressive, and reduced-motion aware", () => {
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /requestAnimationFrame|pointermove/);
  assert.match(js, /prefers-reduced-motion/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.equal(/from\s+["'](?:gsap|three|motion)/.test(js), false);
  assert.equal(index.includes("cdn.jsdelivr.net"), false);
  assert.equal(index.includes("unpkg.com"), false);
});

test("critical first chapter is eager and later scene media is lazy", () => {
  assert.match(index, /rang-trong-atelier\.svg" alt="" fetchpriority="high"/);
  const lazy = index.match(/loading="lazy" decoding="async"/g) || [];
  assert.equal(lazy.length, 9);
});

test("approved visual lock prevents stock-portfolio and generic SaaS fallback", () => {
  assert.equal(lock.rules.stockPortfolioSubstitutionAllowed, false);
  assert.equal(lock.rules.genericSaasAllowed, false);
  assert.equal(lock.rules.fakeCssPrimaryArtworkAllowed, false);
  assert.equal(lock.rules.localSceneVisualRequired, true);
});
