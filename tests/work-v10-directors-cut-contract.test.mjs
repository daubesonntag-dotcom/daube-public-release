import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const index = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const css = fs.readFileSync(new URL("../assets/work-v10-directors-cut.css", import.meta.url), "utf8");
const js = fs.readFileSync(new URL("../assets/work-v10-directors-cut.js", import.meta.url), "utf8");

test("homepage loads V10 Director's Cut assets", () => {
  assert.match(index, /assets\/work-v10-directors-cut\.css/);
  assert.match(index, /assets\/work-v10-directors-cut\.js/);
});

test("V10 exposes premium interactive stages without fake business claims", () => {
  for (const token of ["director-gallery", "director-capability-stage", "director-process-stage", "director-sound-toggle", "director-reel-controls", "director-hero-reel"]) {
    assert.match(js, new RegExp(token));
  }
  for (const forbidden of ["award-winning", "100+ clients", "95% retention", "revenue verified"]) {
    assert.equal(js.toLowerCase().includes(forbidden.toLowerCase()), false);
  }
});

test("V10 supports swipe navigation, accessibility, and mobile degradation", () => {
  assert.match(js, /pointerdown/);
  assert.match(js, /pointerup/);
  assert.match(css, /touch-action:pan-y/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /@media\(max-width:1000px\)/);
  assert.match(css, /@media\(max-width:620px\)/);
  assert.match(js, /pointer:fine/);
  assert.match(js, /prefers-reduced-motion/);
  assert.match(js, /aria-live/);
});
