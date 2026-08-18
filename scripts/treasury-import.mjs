import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

const ROOT = process.cwd();
const DEFAULT_MANIFEST = "assets/treasury/manifest.json";
const textExtensions = new Set([".svg", ".json", ".txt", ".md", ".css", ".js", ".mjs"]);

function assertRelativeSafe(value, label) {
  if (!value || path.isAbsolute(value) || value.includes("..")) throw new Error(`${label} must be a safe relative path`);
}
function sha256(buffer) { return crypto.createHash("sha256").update(buffer).digest("hex"); }
async function readJson(file) { return JSON.parse(await fs.readFile(file, "utf8")); }
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`);
  await fs.rename(tmp, file);
}
function validatePlanItem(item) {
  const required = ["assetId", "sourceRepo", "sourcePath", "sourceCommit", "licenseSpdx", "consumer", "qualityTier"];
  for (const key of required) if (!item[key]) throw new Error(`missing ${key} for ${item.assetId || "unknown asset"}`);
  if (!/^[0-9a-f]{40}$/i.test(item.sourceCommit)) throw new Error(`sourceCommit must be a full 40-char SHA for ${item.assetId}`);
  assertRelativeSafe(item.sourcePath, "sourcePath");
  if (item.sourceRepo.includes("..") || !item.sourceRepo.includes("/")) throw new Error(`invalid sourceRepo for ${item.assetId}`);
  if (item.approved !== true) throw new Error(`${item.assetId} is not explicitly approved for import`);
  if (!item.licenseEvidence) throw new Error(`missing licenseEvidence for ${item.assetId}`);
}
async function fetchPinnedGithubFile(item, token) {
  const url = `https://raw.githubusercontent.com/${item.sourceRepo}/${item.sourceCommit}/${item.sourcePath}`;
  const headers = { "User-Agent": "daube-treasury-importer/1.0" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, { headers, redirect: "follow" });
  if (!response.ok) throw new Error(`fetch failed ${response.status} for ${item.assetId}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length === 0) throw new Error(`empty upstream file for ${item.assetId}`);
  if (buffer.length > Number(item.maxBytes || 5_000_000)) throw new Error(`asset exceeds size guardrail for ${item.assetId}`);
  return { buffer, sourceUrl: url };
}

async function main() {
  const planArg = process.argv.find((arg) => arg.startsWith("--plan="));
  if (!planArg) throw new Error("Usage: node scripts/treasury-import.mjs --plan=<json> [--dry-run]");
  const dryRun = process.argv.includes("--dry-run");
  const planPath = path.resolve(ROOT, planArg.slice("--plan=".length));
  const plan = await readJson(planPath);
  const manifestPath = path.resolve(ROOT, plan.manifest || DEFAULT_MANIFEST);
  let manifest;
  try { manifest = await readJson(manifestPath); }
  catch { manifest = { schema: "daube.site.resource-treasury.v1", version: 1, artifacts: [] }; }

  const next = new Map((manifest.artifacts || []).map((item) => [item.assetId, item]));
  const imported = [];
  for (const item of plan.items || []) {
    validatePlanItem(item);
    const { buffer, sourceUrl } = await fetchPinnedGithubFile(item, process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
    const digest = sha256(buffer);
    const ext = path.extname(item.sourcePath).toLowerCase();
    if (!textExtensions.has(ext) && item.binaryAllowed !== true) throw new Error(`binary asset requires binaryAllowed=true for ${item.assetId}`);
    const sourceId = item.sourceId || item.sourceRepo.replaceAll("/", "--");
    const filename = item.filename || path.basename(item.sourcePath);
    const relativeOutput = path.posix.join("assets/treasury", sourceId, item.assetId, digest.slice(0, 12), filename);
    const output = path.resolve(ROOT, relativeOutput);
    if (!output.startsWith(path.resolve(ROOT, "assets/treasury") + path.sep)) throw new Error(`unsafe output for ${item.assetId}`);

    const record = {
      assetId: item.assetId,
      kind: item.kind || (ext === ".svg" ? "svg-icon" : "asset"),
      state: "approved-local",
      qualityTier: item.qualityTier,
      consumers: Array.isArray(item.consumer) ? item.consumer : [item.consumer],
      localPath: relativeOutput,
      bytes: buffer.length,
      sha256: digest,
      source: { repository: item.sourceRepo, path: item.sourcePath, commit: item.sourceCommit, url: sourceUrl },
      rights: { licenseSpdx: item.licenseSpdx, licenseEvidence: item.licenseEvidence, attribution: item.attribution || null },
      importedAt: new Date().toISOString()
    };
    if (!dryRun) {
      await fs.mkdir(path.dirname(output), { recursive: true });
      await fs.writeFile(output, buffer);
      next.set(item.assetId, record);
    }
    imported.push(record);
  }
  if (!dryRun) {
    manifest.artifacts = [...next.values()].sort((a, b) => a.assetId.localeCompare(b.assetId));
    manifest.updatedAt = new Date().toISOString();
    await writeJson(manifestPath, manifest);
  }
  console.log(JSON.stringify({ ok: true, dryRun, imported: imported.length, artifacts: imported }, null, 2));
}
main().catch((error) => { console.error(error.stack || error.message || String(error)); process.exitCode = 1; });
