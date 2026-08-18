import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const manifestPath = path.resolve(ROOT, process.argv.find((v) => v.startsWith("--manifest="))?.slice(11) || "assets/treasury/manifest.json");
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const quality = { utility: 1, "polished-ui": 1, "visual-design": 1, "creative-ui": 1, "design-system": 1, premium: 2, hero: 3, "crown-jewel": 4 };
const requiredSurfaceQuality = { homepageHero: "hero", manifesto: "premium", worlds: "premium", featuredProject: "hero", closing: "premium", globalIcons: "utility", typography: "premium" };
const allowedKinds = new Set(["svg-icon", "hero-image", "hero-render", "hero-video", "hero-3d", "project-media", "editorial-image", "font", "font-family", "texture", "hdri", "pbr-material", "3d-model", "motion-asset"]);

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const errors = [];
const warnings = [];
const approved = (manifest.artifacts || []).filter((a) => a.state === "approved-local");
const ids = new Set();
const paths = new Set();

for (const item of approved) {
  if (!item.assetId || !item.localPath || !item.sha256) errors.push(`missing identity/checksum: ${item.assetId || "unknown"}`);
  if (ids.has(item.assetId)) errors.push(`duplicate assetId: ${item.assetId}`);
  ids.add(item.assetId);
  if (paths.has(item.localPath)) errors.push(`duplicate localPath: ${item.localPath}`);
  paths.add(item.localPath);

  if (!allowedKinds.has(item.kind)) errors.push(`unsupported artifact kind: ${item.assetId}:${item.kind || "missing"}`);
  if (!quality[item.qualityTier]) errors.push(`unknown quality tier: ${item.assetId}:${item.qualityTier || "missing"}`);
  if (!item.localPath.startsWith("assets/treasury/") || item.localPath.includes("..")) errors.push(`unsafe local path: ${item.assetId}`);
  if (!item.rights?.licenseSpdx || !item.rights?.licenseEvidence) errors.push(`missing rights evidence: ${item.assetId}`);
  if (!item.source?.repository || !item.source?.path || !/^[0-9a-f]{40}$/i.test(item.source?.commit || "")) errors.push(`missing pinned provenance: ${item.assetId}`);
  if (!Array.isArray(item.consumers) || item.consumers.length === 0) errors.push(`missing consumer binding: ${item.assetId}`);

  try {
    const data = await fs.readFile(path.resolve(ROOT, item.localPath));
    const actual = sha256(data);
    if (actual !== item.sha256) errors.push(`checksum mismatch: ${item.assetId}`);
    if (Number.isInteger(item.bytes) && data.byteLength !== item.bytes) errors.push(`byte-size mismatch: ${item.assetId}`);
  } catch {
    errors.push(`missing local artifact: ${item.assetId}`);
  }

  if (item.rights?.licenseEvidence) {
    try {
      const evidencePath = path.resolve(ROOT, item.rights.licenseEvidence);
      const evidence = await fs.readFile(evidencePath, "utf8");
      if (!evidence.trim()) errors.push(`empty rights evidence: ${item.assetId}`);
    } catch {
      errors.push(`missing rights evidence file: ${item.assetId}`);
    }
  }
}

for (const [surface, minimum] of Object.entries(requiredSurfaceQuality)) {
  const matches = approved.filter((a) => a.consumers.includes(surface));
  if (!matches.length) {
    warnings.push(`surface has no approved local asset: ${surface}`);
    continue;
  }
  if (!matches.some((a) => (quality[a.qualityTier] || 0) >= quality[minimum])) warnings.push(`surface below ${minimum} quality floor: ${surface}`);
}

const heroReady = approved.some((a) => a.consumers.includes("homepageHero") && (quality[a.qualityTier] || 0) >= quality.hero && ["hero-image", "hero-render", "hero-video", "hero-3d"].includes(a.kind));
if (manifest.heroReady !== heroReady) errors.push(`heroReady manifest mismatch: declared=${manifest.heroReady} computed=${heroReady}`);
if (!heroReady) warnings.push("homepage hero media is intentionally unresolved; typography/layout fallback must remain active and synthetic CSS art must not masquerade as approved hero media");

console.log(JSON.stringify({ ok: errors.length === 0, artifacts: approved.length, heroReady, errors, warnings }, null, 2));
if (errors.length) process.exitCode = 1;
