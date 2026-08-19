import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => fs.existsSync(new URL(`../${path}`, import.meta.url));

const index = read("index.html");
const css = read("assets/free-first-homepage-v1.css");
const js = read("assets/free-first-homepage-v1.js");
const agents = read("AGENTS.md");

const policyRevision = "dc85d60e9222e70a270048321b5252e072a72d9d";

test("public homepage inherits the canonical Free-First policy without replacing Founder Visual Lock", () => {
  assert.ok(index.includes(policyRevision));
  assert.match(index, /data-public-homepage="founder-visual-lock-10-scene"/);
  assert.match(index, /data-free-first-source-pack="DAUBE-FLAGSHIP-VISUAL-PACK-V1"/);
  assert.match(agents, /free-first-operating-policy-v1\.json/);
  assert.match(agents, /REAL ASSET BEFORE FAKE CSS ART/);
});

test("primary CSS-made placeholder artwork was removed from homepage markup", () => {
  for (const obsolete of ["fv-orbit", "fv-orbit-core", "fv-ring", "fv-crystal", "fv-spectrum", "fv-system-map"]) {
    assert.equal(index.includes(obsolete), false, `obsolete CSS-art surface remains in markup: ${obsolete}`);
  }
  assert.match(index, /fv-manifesto-media/);
  assert.match(index, /fv-universe-media/);
  assert.match(index, /fv-system-index/);
});

test("existing self-hosted OSS treasury assets are reused before adding another icon library", () => {
  const iconPaths = [
    "assets/treasury/iconoir/iconoir-design-pencil/2d984d80f660/design-pencil.svg",
    "assets/treasury/tabler/tabler-brush/4b9fa0b70f28/brush.svg",
    "assets/treasury/lucide/lucide-sparkles/f5499f33f09d/sparkles.svg",
    "assets/treasury/lucide/lucide-gem/377618223555/gem.svg",
    "assets/treasury/lucide/lucide-boxes/7e301f6c3833/boxes.svg",
    "assets/treasury/lucide/lucide-orbit/e2b8b7d7f820/orbit.svg",
    "assets/treasury/heroicons/heroicons-sparkles/a2f417f15d2d/sparkles.svg",
    "assets/treasury/phosphor/phosphor-magic-wand/8416f1e98011/magic-wand.svg"
  ];

  for (const path of iconPaths) {
    assert.ok(exists(path), `missing self-hosted treasury asset: ${path}`);
    assert.ok(index.includes(path), `homepage does not consume treasury asset: ${path}`);
  }
});

test("motion stays browser-native, progressive and reduced-motion aware", () => {
  assert.match(index, /assets\/free-first-homepage-v1\.js/);
  assert.match(index, /assets\/free-first-homepage-v1\.css/);
  assert.match(js, /IntersectionObserver/);
  assert.match(js, /prefers-reduced-motion: reduce/);
  assert.match(js, /requestAnimationFrame/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.equal(/from\s+["'](?:gsap|three|motion)/.test(js), false);
});

test("non-critical remote media remains lazy while the Founder hero remains local and priority-loaded", () => {
  assert.match(index, /assets\/founder-visual-lock\/01-hero-dawn\.webp[^>]*fetchpriority="high"/);
  for (const host of ["cdn.polyhaven.com", "images.pexels.com"]) {
    const remoteTags = index.match(new RegExp(`<img[^>]+${host.replaceAll('.', '\\.')}[^>]*>`, "g")) || [];
    assert.ok(remoteTags.length > 0, `expected existing registered remote source: ${host}`);
    for (const tag of remoteTags) assert.match(tag, /loading="lazy"/);
  }
});

test("Founder canonical scene marker and public truth boundaries survive the visual convergence", () => {
  assert.match(index, /03 \/ WORLDS IN ORBIT/);
  assert.match(index, /name="robots" content="noindex,nofollow,noarchive,nosnippet"/);
  assert.doesNotMatch(index.toLowerCase(), /award-winning|commerce live/);
});
