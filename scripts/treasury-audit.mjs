import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const manifestPath = path.resolve(ROOT, process.argv.find((v) => v.startsWith("--manifest="))?.slice(11) || "assets/treasury/manifest.json");
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

const quality = { utility: 1, "polished-ui": 1, "visual-design": 1, "creative-ui": 1, "design-system": 1, premium: 2, hero: 3, "crown-jewel": 4 };
const requiredSurfaceQuality = { homepageHero: "hero", manifesto: "premium", worlds: "premium", featuredProject: "hero", closing: "premium", globalIcons: "utility", typography: "premium" };
const supportedFamilies = new Set(["visual", "audio", "video", "motion", "3d", "vfx-cgi", "typography", "ui-ux", "software", "knowledge", "data"]);
const runtimeStates = new Set(["approved-local", "approved-cdn", "hero"]);
const safeLocalPath = (value) => typeof value === "string" && value.startsWith("assets/treasury/") && !value.includes("..") && !value.includes("\\");
const safeCdnPath = (value) => typeof value === "string" && /^https:\/\//i.test(value);
const consumersOf = (item) => Array.isArray(item?.consumers) ? item.consumers : (Array.isArray(item?.consumerTargets) ? item.consumerTargets : []);
const familyOf = (item) => item?.typeFamily || ({
  "svg-icon": "visual", "hero-image": "visual", "hero-render": "visual", "project-media": "visual", "editorial-image": "visual", "animated-image": "visual", illustration: "visual", image: "visual",
  video: "video", "hero-video": "video", "video-loop": "video",
  audio: "audio", music: "audio", sfx: "audio", "ui-sound": "audio",
  motion: "motion", lottie: "motion", rive: "motion", "motion-asset": "motion",
  "3d-model": "3d", "hero-3d": "3d", hdri: "3d", texture: "3d", "pbr-material": "3d", scene: "3d", shader: "3d",
  vfx: "vfx-cgi", cgi: "vfx-cgi", "particle-system": "vfx-cgi", simulation: "vfx-cgi",
  font: "typography", "font-family": "typography", "font-file": "typography",
  component: "ui-ux", "ui-element": "ui-ux", "ui-primitive": "ui-ux",
  module: "software", plugin: "software", package: "software",
  document: "knowledge", documentation: "knowledge", dataset: "data"
}[item?.kind] || null);

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const errors = [];
const warnings = [];
const runtimeAssets = (manifest.artifacts || []).filter((a) => runtimeStates.has(a.state));
const ids = new Set();
const storageRefs = new Set();
const byFamily = {};

for (const item of runtimeAssets) {
  const family = familyOf(item);
  const consumers = consumersOf(item);
  const storageRef = item.localPath || item.cdnPath || null;
  byFamily[family || "unregistered"] = (byFamily[family || "unregistered"] || 0) + 1;

  if (!item.assetId || !item.sha256) errors.push(`missing identity/checksum: ${item.assetId || "unknown"}`);
  if (ids.has(item.assetId)) errors.push(`duplicate assetId: ${item.assetId}`);
  ids.add(item.assetId);
  if (storageRef && storageRefs.has(storageRef)) errors.push(`duplicate storage reference: ${storageRef}`);
  if (storageRef) storageRefs.add(storageRef);

  if (!family || !supportedFamilies.has(family)) errors.push(`unregistered production family: ${item.assetId}:${family || "missing"}`);
  if (!quality[item.qualityTier]) errors.push(`unknown quality tier: ${item.assetId}:${item.qualityTier || "missing"}`);
  if (!item.rights?.licenseSpdx && !item.rights?.licenseType) errors.push(`missing license identity: ${item.assetId}`);
  if (!item.rights?.licenseEvidence) errors.push(`missing rights evidence: ${item.assetId}`);
  if (item.rights?.commercialUse === "unknown" || item.rights?.commercialUse === "prohibited") errors.push(`commercial use unresolved/prohibited: ${item.assetId}`);
  if (!consumers.length) errors.push(`missing consumer binding: ${item.assetId}`);
  if (!/^[0-9a-f]{64}$/i.test(item.sha256 || "")) errors.push(`invalid sha256: ${item.assetId}`);
  if (!Number.isInteger(item.bytes) || item.bytes < 0) errors.push(`missing byte-size evidence: ${item.assetId}`);

  const legacyPinned = item.source?.repository && item.source?.path && /^[0-9a-f]{40}$/i.test(item.source?.commit || "");
  const v4Provenance = Boolean(item.sourceId && item.originalSourceUrl) || Boolean(item.sourceRepository && item.sourcePath && /^[0-9a-f]{40}$/i.test(item.sourceCommit || ""));
  if (!legacyPinned && !v4Provenance) errors.push(`missing production provenance: ${item.assetId}`);

  if (item.state === "approved-local" || (item.state === "hero" && item.localPath)) {
    if (!safeLocalPath(item.localPath)) errors.push(`unsafe local path: ${item.assetId}`);
    if (safeLocalPath(item.localPath)) {
      try {
        const data = await fs.readFile(path.resolve(ROOT, item.localPath));
        const actual = sha256(data);
        if (actual !== item.sha256) errors.push(`checksum mismatch: ${item.assetId}`);
        if (data.byteLength !== item.bytes) errors.push(`byte-size mismatch: ${item.assetId}`);
      } catch {
        errors.push(`missing local artifact: ${item.assetId}`);
      }
    }
  }

  if (item.state === "approved-cdn" || (item.state === "hero" && item.cdnPath)) {
    if (!safeCdnPath(item.cdnPath)) errors.push(`unsafe/non-https CDN path: ${item.assetId}`);
  }

  if (typeof item.rights?.licenseEvidence === "string" && item.rights.licenseEvidence.startsWith("assets/treasury/")) {
    try {
      const evidence = await fs.readFile(path.resolve(ROOT, item.rights.licenseEvidence), "utf8");
      if (!evidence.trim()) errors.push(`empty rights evidence: ${item.assetId}`);
    } catch {
      errors.push(`missing rights evidence file: ${item.assetId}`);
    }
  } else if (!/^https:\/\//i.test(item.rights?.licenseEvidence || "")) {
    errors.push(`unsupported rights evidence reference: ${item.assetId}`);
  }

  if (family === "audio") {
    if (item.autoplay === true || item.autoplayPolicy === "autoplay") errors.push(`audio autoplay forbidden: ${item.assetId}`);
  }
  if (["motion", "video", "vfx-cgi"].includes(family) && item.autoplayPolicy === "muted-decorative" && item.reducedMotionFallback === false) {
    errors.push(`reduced-motion fallback required: ${item.assetId}`);
  }
  if (["3d", "vfx-cgi"].includes(family) && item.runtimeRendererApproved === true && !item.engineCompatibility?.length) {
    errors.push(`engine compatibility required for runtime 3D/VFX: ${item.assetId}`);
  }
}

for (const [surface, minimum] of Object.entries(requiredSurfaceQuality)) {
  const matches = runtimeAssets.filter((a) => consumersOf(a).includes(surface));
  if (!matches.length) {
    warnings.push(`surface has no approved runtime asset: ${surface}`);
    continue;
  }
  if (!matches.some((a) => (quality[a.qualityTier] || 0) >= quality[minimum])) warnings.push(`surface below ${minimum} quality floor: ${surface}`);
}

const heroReady = runtimeAssets.some((a) => {
  if (!consumersOf(a).includes("homepageHero") || (quality[a.qualityTier] || 0) < quality.hero) return false;
  const family = familyOf(a);
  if (["visual", "video"].includes(family)) return true;
  if (["motion", "3d", "vfx-cgi"].includes(family)) return a.runtimeRendererApproved === true;
  return false;
});

if (manifest.heroReady !== heroReady) errors.push(`heroReady manifest mismatch: declared=${manifest.heroReady} computed=${heroReady}`);
if (!heroReady) warnings.push("homepage hero media is intentionally unresolved; typography/layout fallback remains authoritative until real visual/video media or an approved 3D/VFX/motion renderer passes the hero floor");

console.log(JSON.stringify({ ok: errors.length === 0, artifacts: runtimeAssets.length, byFamily, heroReady, errors, warnings }, null, 2));
if (errors.length) process.exitCode = 1;
