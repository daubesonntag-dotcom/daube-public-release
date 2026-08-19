import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import test from "node:test";

const manifestPath = "assets/treasury/manifest.json";
const expectedSha256 = "cae940fc482798a58a12c630b48a46666fb4c04b4b806d07234b3d30547e0474";
const expectedGitBlob = "a7fdbfcbf250996665ad0293d8b1163cb76cdb73";

const gitBlobSha1 = (bytes) => crypto.createHash("sha1").update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest("hex");

test("site manifest contains exact byte-backed V5.1 runtime fixture", async () => {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  assert.equal(manifest.heroReady, false);
  assert.equal(manifest.canonicalTreasury.commit, "f80c3556a7e5efee8104c9718a68920be9a78bb0");

  const asset = manifest.artifacts.find((item) => item.assetId === "tonytins-gdq-cc0-godot-button-rect");
  assert.ok(asset);
  assert.equal(asset.state, "approved-local");
  assert.equal(asset.qualityTier, "utility");
  assert.deepEqual(asset.consumers, ["treasuryRuntimeFixture"]);
  assert.equal(asset.publicBrandSurfaceApproved, false);

  const bytes = await fs.readFile(asset.localPath);
  assert.equal(bytes.length, 3349);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), expectedSha256);
  assert.equal(gitBlobSha1(bytes), expectedGitBlob);
  assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(bytes.readUInt32BE(16), 128);
  assert.equal(bytes.readUInt32BE(20), 142);
});

test("utility fixture cannot make homepage hero ready", async () => {
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  const fixture = manifest.artifacts.find((item) => item.assetId === "tonytins-gdq-cc0-godot-button-rect");
  assert.equal(fixture.consumers.includes("homepageHero"), false);
  assert.equal(manifest.heroReady, false);
});
