import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

const runtime = await fs.readFile("assets/treasury/runtime.js", "utf8");

test("local production assets stay inside treasury and CDN assets require HTTPS", () => {
  assert.match(runtime, /startsWith\("assets\/treasury\/"\)/);
  assert.match(runtime, /\^https:\\\/\\\//i);
  assert.match(runtime, /!value\.includes\("\.\."\)/);
});

test("audio is explicit-control only and never autoplay", () => {
  assert.match(runtime, /audio\.controls = true/);
  assert.match(runtime, /audio\.autoplay = false/);
  assert.match(runtime, /audio\.preload = "none"/);
});

test("video autoplay is muted decorative only and respects reduced motion", () => {
  assert.match(runtime, /autoplayPolicy === "muted-decorative"/);
  assert.match(runtime, /!prefersReducedMotion\(\)/);
  assert.match(runtime, /video\.muted = true/);
});

test("3D VFX and motion require poster or preview fallback instead of arbitrary execution", () => {
  assert.match(runtime, /\["3d", "vfx-cgi", "motion"\]\.includes\(family\)/);
  assert.match(runtime, /createPosterFallback/);
  assert.doesNotMatch(runtime, /new THREE\./);
  assert.doesNotMatch(runtime, /eval\(/);
});

test("runtime accepts legacy consumers and V4 consumerTargets", () => {
  assert.match(runtime, /item\?\.consumers/);
  assert.match(runtime, /item\?\.consumerTargets/);
});

test("candidate selection is data-only and does not construct speculative media nodes", () => {
  assert.match(runtime, /filter\(canRenderSurfaceMedia\)/);
  assert.doesNotMatch(runtime, /find\(\(item\) => createSurfaceMedia/);
});
