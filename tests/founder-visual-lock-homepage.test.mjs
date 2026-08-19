import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../assets/maison-homepage-v2.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../assets/maison-homepage-v2.js", import.meta.url), "utf8");
const robots = fs.readFileSync(new URL("../robots.txt", import.meta.url), "utf8");
const lock = JSON.parse(fs.readFileSync(new URL("../.daube/visual-locks/homepage-approved-mockup-v2.json", import.meta.url), "utf8"));
const release = JSON.parse(fs.readFileSync(new URL("../.daube/releases/approved-mockup-homepage-v2.json", import.meta.url), "utf8"));

const visualLockSha = "079c497356b44ce29cf3b43a81a8902b1847266c4c24c8bc550b80825ea1c2f8";
const chapters = [
  ["01", "RẠNG TRONG ATELIER", "Light is our first material.", "ENTER THE ATELIER", "rang-trong-atelier.svg"],
  ["02", "OBSIDIAN CINEMA", "We sculpt with time and darkness.", "ENTER THE CINEMA", "obsidian-cinema.svg"],
  ["03", "CELESTIAL THRESHOLD", "Beyond form, a larger harmony.", "CROSS THE THRESHOLD", "celestial-threshold.svg"],
  ["04", "PORCELAIN INDEX", "An index of things that endure.", "EXPLORE THE INDEX", "porcelain-index.svg"],
  ["05", "JADE INTELLIGENCE", "Insight, cut from clarity.", "ENTER THE SYSTEM", "jade-intelligence.svg"],
  ["06", "LACQUER VERMILION", "Tradition is our technology.", "VIEW THE COLLECTION", "lacquer-vermilion.svg"],
  ["07", "MONSOON GLASS", "We collect weather and memory.", "PASS THROUGH", "monsoon-glass.svg"],
  ["08", "SILK PAPER", "Softness is a kind of strength.", "READ THE JOURNAL", "silk-paper.svg"],
  ["09", "NEO-CIVIC MONUMENT", "For tomorrow, we build with purpose.", "SEE THE VISION", "neo-civic-monument.svg"],
  ["10", "FUTURE MAISON", "The future is our atelier.", "ENTER THE MAISON", "future-maison.svg"]
];

test("approved mockup digest is the public visual source of truth", () => {
  assert.equal(lock.id, "DAUBE-APPROVED-HOMEPAGE-MOCKUP-V2");
  assert.equal(lock.reference.sha256, visualLockSha);
  assert.equal(lock.reference.width, 935);
  assert.equal(lock.reference.height, 1683);
  assert.equal(lock.reference.role, "single-primary-visual-source-of-truth");
  assert.ok(index.includes(visualLockSha));
  assert.equal(release.visualLock.sha256, visualLockSha);
  assert.equal(release.approval.kind, "founder-explicit-full-execution");
});

test("all ten approved chapters, headlines, CTAs and local visual assets are present in order", () => {
  let cursor = -1;
  for (const [number, label, headline, cta, asset] of chapters) {
    for (const token of [number, label, headline, cta, `assets/homepage-v2/scenes/${asset}`]) {
      assert.ok(index.includes(token), `missing approved token: ${token}`);
    }
    const next = index.indexOf(`data-chapter="${number}"`);
    assert.ok(next > cursor, `chapter ${number} is out of order`);
    cursor = next;
    const assetPath = new URL(`../assets/homepage-v2/scenes/${asset}`, import.meta.url);
    assert.ok(fs.existsSync(assetPath), `missing local scene asset ${asset}`);
    assert.ok(fs.statSync(assetPath).size > 700, `scene asset too small ${asset}`);
  }
  assert.equal((index.match(/data-chapter="/g) || []).length, 10);
});

test("homepage no longer depends on the rejected stock-portfolio composition", () => {
  for (const forbidden of ["cdn.polyhaven.com","images.pexels.com","videos.pexels.com","fv-worlds","fv-work-grid","fv-object-museum","AUREA","ORISON","SONNTAG STUDY 06"]) {
    assert.equal(index.includes(forbidden), false, `rejected legacy pattern leaked: ${forbidden}`);
  }
  assert.match(index, /assets\/maison-homepage-v2\.css/);
  assert.match(index, /assets\/maison-homepage-v2\.js/);
});

test("document remains semantic, responsive, accessible and deliberately noindex", () => {
  assert.equal((index.match(/<h1\b/gi) || []).length, 1);
  assert.match(index, /<html lang="en">/);
  assert.match(index, /name="viewport"/);
  assert.match(index, /name="robots" content="noindex,nofollow,noarchive,nosnippet"/);
  assert.match(index, /rel="canonical" href="https:\/\/daubesonntag\.com\/"/);
  assert.match(index, /href="#main-content"/);
  assert.match(index, /id="main-content"/);
  assert.match(index, /aria-label="Primary navigation"/);
  assert.match(css, /@media \(max-width:680px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /prefers-reduced-motion/);
  assert.match(robots, /Disallow: \//);
});

test("public truth and authority boundaries remain intact", () => {
  for (const forbidden of ["/creative-market", "/forge", "/founder-os", "/staff-studio", "/engineering-studio", "/revenue-factory"]) {
    assert.equal(index.includes(forbidden), false, `private/draft route leaked: ${forbidden}`);
  }
  for (const unsupported of ["COMMERCE LIVE", "award-winning", "customers", "revenue"]) {
    assert.equal(index.toLowerCase().includes(unsupported.toLowerCase()), false, `unsupported public claim: ${unsupported}`);
  }
  assert.ok(release.claims.notProven.includes("production-domain retrieval of this revision"));
  assert.ok(release.claims.notProven.includes("Founder subjective final visual acceptance after live review"));
});

test("visual lock explicitly rejects loose reinterpretation and generic SaaS regression", () => {
  assert.equal(lock.rules.looseReinterpretationAllowed, false);
  assert.equal(lock.rules.genericSaasAllowed, false);
  assert.equal(lock.rules.stockPortfolioSubstitutionAllowed, false);
  assert.equal(lock.rules.fakeCssPrimaryArtworkAllowed, false);
  assert.equal(lock.rules.chapterOrderMutable, false);
});
