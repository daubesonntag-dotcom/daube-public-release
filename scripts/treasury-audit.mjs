import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const manifestPath = path.resolve(ROOT, process.argv.find((v) => v.startsWith("--manifest="))?.slice(11) || "assets/treasury/manifest.json");
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const quality = { utility: 1, premium: 2, hero: 3, "crown-jewel": 4 };
const requiredSurfaceQuality = { homepageHero: "hero", manifesto: "premium", worlds: "premium", featuredProject: "hero", closing: "premium", globalIcons: "utility", typography: "premium" };

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const errors = [];
const warnings = [];
const approved = (manifest.artifacts || []).filter((a) => a.state === "approved-local");

for (const item of approved) {
  if (!item.assetId || !item.localPath || !item.sha256) errors.push(`missing identity/checksum: ${item.assetId || "unknown"}`);
  if (!item.rights?.licenseSpdx || !item.rights?.licenseEvidence) errors.push(`missing rights evidence: ${item.assetId}`);
  if (!item.source?.repository || !item.source?.path || !/^[0-9a-f]{40}$/i.test(item.source?.commit || "")) errors.push(`missing pinned provenance: ${item.assetId}`);
  if (!Array.isArray(item.consumers) || item.consumers.length === 0) errors.push(`missing consumer binding: ${item.assetId}`);
  try {
    const data = await fs.readFile(path.resolve(ROOT, item.localPath));
    const actual = sha256(data);
    if (actual !== item.sha256) errors.push(`checksum mismatch: ${item.assetId}`);
  } catch { errors.push(`missing local artifact: ${item.assetId}`); }
}

for (const [surface, minimum] of Object.entries(requiredSurfaceQuality)) {
  const matches = approved.filter((a) => a.consumers.includes(surface));
  if (!matches.length) { warnings.push(`surface has no approved local asset: ${surface}`); continue; }
  if (!matches.some((a) => (quality[a.qualityTier] || 0) >= quality[minimum])) warnings.push(`surface below ${minimum} quality floor: ${surface}`);
}

const heroReady = approved.some((a) => a.consumers.includes("homepageHero") && (quality[a.qualityTier] || 0) >= quality.hero && ["hero-image", "hero-render", "hero-video", "hero-3d"].includes(a.kind));
if (!heroReady) warnings.push("homepage hero media is intentionally unresolved; typography/layout fallback must remain active and synthetic CSS art must not masquerade as approved hero media");

console.log(JSON.stringify({ ok: errors.length === 0, artifacts: approved.length, heroReady, errors, warnings }, null, 2));
if (errors.length) process.exitCode = 1;
